import * as THREE from "three";
import {
  SpatialRunnerController,
  resolveSpatialBranchDisplacement,
  resolveSpatialJunctionDecision,
  resolveSpatialRouteWindow,
  type ComposedSpatialRoute,
  type ComposedSpatialRouteBranch,
  type ComposedSpatialRouteSegment,
  type ResolvedSpatialRouteCue,
  type ResolvedSpatialRouteObstacle,
  type SpatialRunnerCommandRecord,
  type SpatialRunnerCommandType,
  type SpatialRunnerSnapshot,
} from "@hustle/routerun";
import type { NightDropRunnerPlan, RunnerTimelineBeat } from "./runner-plan.js";
import { createNightDropBuilding } from "./night-drop-building-kit.js";
import { NightDropDashActor } from "./night-drop-dash-actor.js";
import { resolveNightDropDistrict } from "./night-drop-districts.js";
import { NightDropRunnerEffects } from "./night-drop-runner-effects.js";
import type { NightDropRunnerFeedbackCue } from "./night-drop-runner-feedback.js";
import { createNightDropStreetModule } from "./night-drop-street-kit.js";
import {
  NIGHT_DROP_RUNNER_PRODUCTION_MANIFEST,
  NightDropRunnerProductionLoader,
  disposeNightDropProductionObject,
  resolveNightDropEnvironmentRole,
  selectNightDropRunnerLod,
  validateNightDropRunnerProductionManifest,
  type NightDropEnvironmentRole,
  type NightDropRunnerLod,
  type NightDropRunnerProductionManifest,
} from "./night-drop-runner-assets.js";

interface WorldPackage {
  readonly root: THREE.Group;
  readonly collectedAtMs: number;
}

interface WorldObstacle {
  readonly root: THREE.Group;
  readonly obstacle: ResolvedSpatialRouteObstacle;
}

const CITY_LABELS = ["OPEN LATE", "24/7", "NIGHT MART", "GLASSHOUSE", "SERVICE", "DELIVERIES"] as const;

export interface NightDropRunnerWorldOptions {
  readonly productionAssets?: boolean;
  readonly productionEnvironmentAssets?: boolean;
  readonly productionManifest?: NightDropRunnerProductionManifest;
  readonly onPresentationCue?: (cue: NightDropRunnerFeedbackCue) => void;
}

export class NightDropRunnerWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, .1, 260);
  private readonly cameraTarget = new THREE.Vector3();
  private readonly route: ComposedSpatialRoute;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly timeline: readonly RunnerTimelineBeat[];
  private readonly renderLod: NightDropRunnerLod;
  private readonly effects: NightDropRunnerEffects;
  private readonly onPresentationCue: ((cue: NightDropRunnerFeedbackCue) => void) | undefined;
  private readonly dashActor = new NightDropDashActor();
  private readonly runner = this.dashActor.root;
  private readonly runnerController: SpatialRunnerController;
  private readonly routeMarkers = new THREE.Group();
  private readonly junctions: THREE.Group;
  private readonly city: THREE.Group;
  private readonly packages: readonly WorldPackage[];
  private readonly obstacles: readonly WorldObstacle[];
  private readonly gate = createContinuationGate();
  private readonly shortcut = createShortcutTunnel();
  private readonly checkpoint = createCheckpoint();
  private readonly penthouse = createPenthouse();
  private readonly rain = createRain();
  private readonly continuationProgress: number;
  private readonly shortcutProgress: number;
  private readonly checkpointProgress: number;
  private readonly destinationProgress: number;
  private elapsedMs = 0;
  private startedAt = 0;
  private running = false;
  private frameRequest = 0;
  private speed = 1;
  private commandSequence = 0;
  private lastFrameAt = 0;
  private readonly frameTimes: number[] = [];
  private compactRenderMode = false;
  private visualLaneOffset = 0;
  private lastWorldElapsedMs = 0;
  private readonly branchButtons: readonly HTMLButtonElement[];
  private readonly junctionPrompt: HTMLElement | null;
  private readonly junctionWarning: HTMLElement | null;
  private readonly obstacleWarning: HTMLElement | null;
  private readonly obstacleResult: HTMLElement | null;
  private decisionUiKey = "";
  private reportedObstacleInteractions = 0;
  private disposed = false;
  private assetReadiness: Promise<void> = Promise.resolve();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stage: HTMLElement,
    plan: NightDropRunnerPlan,
    options: NightDropRunnerWorldOptions = {},
  ) {
    this.route = plan.spatialRoute;
    this.timeline = plan.timeline;
    this.path = createRoutePath(this.route);
    const deviceMemoryGb = (navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory;
    this.renderLod = selectNightDropRunnerLod({
      viewportWidth: Math.max(1, this.stage.clientWidth || window.innerWidth),
      pixelRatio: window.devicePixelRatio || 1,
      compact: window.matchMedia("(max-width: 540px), (max-height: 700px)").matches,
      ...(deviceMemoryGb ? { deviceMemoryGb } : {}),
    });
    this.effects = new NightDropRunnerEffects(this.renderLod);
    this.onPresentationCue = options.onPresentationCue;
    this.runnerController = new SpatialRunnerController(this.route);
    this.junctions = createJunctionGeometry(this.path, this.route);
    this.city = createCity(this.path, this.route, this.renderLod);
    this.branchButtons = [...this.stage.querySelectorAll<HTMLButtonElement>("[data-branch]")];
    this.junctionPrompt = this.stage.querySelector<HTMLElement>("[data-junction-prompt]");
    this.junctionWarning = this.stage.querySelector<HTMLElement>("[data-junction-warning]");
    this.obstacleWarning = this.stage.querySelector<HTMLElement>("[data-obstacle-warning]");
    this.obstacleResult = this.stage.querySelector<HTMLElement>("[data-obstacle-result]");
    this.continuationProgress = requireCue(this.route, "continuation").progress;
    this.shortcutProgress = requireCue(this.route, "shortcut").progress;
    this.checkpointProgress = requireCue(this.route, "checkpoint").progress;
    this.destinationProgress = requireCue(this.route, "destination").progress;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.48;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x030914);
    this.scene.fog = new THREE.FogExp2(0x050d18, .0095);
    this.stage.dataset.renderer = "three";
    this.stage.dataset.routeId = plan.routeId;
    this.stage.dataset.routeLength = String(Math.round(this.route.totalLength));
    this.stage.dataset.renderLod = this.renderLod;

    this.packages = this.route.cues.filter(({ kind }) => kind === "standard-pickup" || kind === "premium-pickup").map((cue) => ({
      root: createPackage(cue.progress, cue.laneOffset, cue.kind === "premium-pickup", this.path),
      collectedAtMs: timeAtProgress(cue.progress, this.timeline),
    }));
    this.obstacles = this.route.obstacles.map((obstacle) => ({ root: createObstacle(obstacle), obstacle }));

    this.buildScene();
    this.assetReadiness = this.configureProductionAssets(options);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.updateWorld(0, true);
  }

  ready(): Promise<void> {
    return this.assetReadiness;
  }

  start(speed = 1): void {
    this.stopFrame();
    this.runnerController.reset();
    this.running = true;
    this.elapsedMs = 0;
    this.visualLaneOffset = 0;
    this.lastWorldElapsedMs = 0;
    this.reportedObstacleInteractions = 0;
    this.speed = normalizeSpeed(speed);
    this.startedAt = performance.now();
    this.lastFrameAt = this.startedAt;
    this.frameTimes.splice(0);
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  resume(speed = this.speed): void {
    this.stopFrame();
    this.running = true;
    this.speed = normalizeSpeed(speed);
    this.startedAt = performance.now() - this.elapsedMs / this.speed;
    this.lastFrameAt = performance.now();
    this.lastWorldElapsedMs = this.elapsedMs;
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.stopFrame();
    this.running = false;
  }

  reset(): void {
    this.stopFrame();
    this.running = false;
    this.elapsedMs = 0;
    this.visualLaneOffset = 0;
    this.lastWorldElapsedMs = 0;
    this.reportedObstacleInteractions = 0;
    this.runnerController.reset();
    this.updateWorld(0, true);
  }

  showAt(beat: RunnerTimelineBeat): void {
    this.stopFrame();
    this.running = false;
    if (beat.atMs < this.runnerController.inspect().elapsedMs) this.runnerController.reset();
    this.elapsedMs = beat.atMs;
    this.updateWorld(beat.atMs, true);
  }

  showAtProgress(progress: number): void {
    this.stopFrame();
    this.running = false;
    const normalizedProgress = Math.max(0, Math.min(1, progress));
    const elapsedMs = timeAtProgress(normalizedProgress, this.timeline);
    if (elapsedMs < this.runnerController.inspect().elapsedMs) this.runnerController.reset();
    this.elapsedMs = elapsedMs;
    this.updateWorld(elapsedMs, true, normalizedProgress);
  }

  execute(type: Exclude<SpatialRunnerCommandType, "choose-branch">): SpatialRunnerCommandRecord {
    return this.runnerController.execute({ id: `input-${++this.commandSequence}`, type, issuedAtMs: this.elapsedMs });
  }

  chooseBranch(alternativeId: string): SpatialRunnerCommandRecord | null {
    const branch = resolveSpatialJunctionDecision(this.route, this.runnerController.inspect().progress);
    if (!branch) return null;
    const record = this.runnerController.execute({
      id: `branch-${++this.commandSequence}`,
      type: "choose-branch",
      issuedAtMs: this.elapsedMs,
      branchId: branch.id,
      alternativeId,
    });
    if (record.accepted) this.updateWorld(this.elapsedMs, true);
    return record;
  }

  createSnapshot(): SpatialRunnerSnapshot {
    return this.runnerController.createSnapshot();
  }

  restoreSnapshot(snapshot: SpatialRunnerSnapshot): void {
    this.stopFrame();
    this.running = false;
    const state = this.runnerController.restore(snapshot);
    this.elapsedMs = state.elapsedMs;
    this.reportedObstacleInteractions = state.obstacleInteractions.length;
    this.updateWorld(this.elapsedMs, true);
  }

  dispose(): void {
    this.stopFrame();
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    this.dashActor.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => {
      (material as THREE.Material & { map?: THREE.Texture }).map?.dispose();
      material.dispose();
    });
    this.renderer.dispose();
  }

  inspect(): {
    readonly routeId: string;
    readonly routeLength: number;
    readonly elapsedMs: number;
    readonly runnerPosition: readonly [number, number, number];
    readonly cameraPosition: readonly [number, number, number];
    readonly runnerState: ReturnType<SpatialRunnerController["inspect"]>;
    readonly activeSegmentIds: readonly string[];
    readonly averageFrameTimeMs: number;
    readonly worstFrameTimeMs: number;
    readonly renderCalls: number;
    readonly renderedTriangles: number;
    readonly geometries: number;
    readonly textures: number;
    readonly dashAsset: ReturnType<NightDropDashActor["inspect"]>;
  } {
    const runnerState = this.runnerController.inspect();
    const window = resolveSpatialRouteWindow(this.route, runnerState.progress);
    return {
      routeId: this.route.definitionId,
      routeLength: this.route.totalLength,
      elapsedMs: this.elapsedMs,
      runnerPosition: this.runner.position.toArray(),
      cameraPosition: this.camera.position.toArray(),
      runnerState,
      activeSegmentIds: window.activeSegmentIds,
      averageFrameTimeMs: average(this.frameTimes),
      worstFrameTimeMs: Math.max(0, ...this.frameTimes),
      renderCalls: this.renderer.info.render.calls,
      renderedTriangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      dashAsset: this.dashActor.inspect(),
    };
  }

  private async configureProductionAssets(options: NightDropRunnerWorldOptions): Promise<void> {
    const manifest = options.productionManifest ?? NIGHT_DROP_RUNNER_PRODUCTION_MANIFEST;
    validateNightDropRunnerProductionManifest(manifest);
    this.stage.dataset.productionAssets = String(options.productionAssets === true);
    this.stage.dataset.productionEnvironmentAssets = String(options.productionEnvironmentAssets === true);
    this.stage.dataset.dashAssetMode = this.dashActor.inspect().mode;
    this.stage.dataset.environmentAssetMode = options.productionEnvironmentAssets ? "loading" : "curve-safe";
    this.stage.dataset.environmentAssetSegments = "0";
    this.stage.dataset.environmentAssetMissingRoles = "0";
    if (!options.productionAssets) return;
    const loader = new NightDropRunnerProductionLoader();
    const [status] = await Promise.all([
      this.dashActor.loadProduction(loader, manifest.character),
      options.productionEnvironmentAssets
        ? this.loadProductionEnvironment(loader, manifest)
        : Promise.resolve(),
    ]);
    if (this.disposed) return;
    this.stage.dataset.dashAssetMode = status.mode;
    this.stage.dataset.dashAssetFallback = String(Boolean(status.fallbackReason));
    this.stage.dataset.dashAnimationCount = String(status.availableAnimationRoles.length);
    this.updateWorld(this.elapsedMs, true);
  }

  private async loadProductionEnvironment(
    loader: NightDropRunnerProductionLoader,
    manifest: NightDropRunnerProductionManifest,
  ): Promise<void> {
    const specifications = new Map(manifest.environment.map((asset) => [asset.role, asset]));
    const segmentsByRole = new Map<NightDropEnvironmentRole, ComposedSpatialRouteSegment[]>();
    this.route.segments.forEach((segment) => {
      const role = resolveNightDropEnvironmentRole(this.route, segment);
      const segments = segmentsByRole.get(role) ?? [];
      segments.push(segment);
      segmentsByRole.set(role, segments);
    });
    const loaded = await Promise.all([...segmentsByRole.keys()].map(async (role) => {
      const spec = specifications.get(role);
      if (!spec) return { role, spec: null, root: null } as const;
      try {
        return { role, spec, root: await loader.loadEnvironment(spec, this.renderLod) } as const;
      } catch {
        return { role, spec, root: null } as const;
      }
    }));
    if (this.disposed) {
      loaded.forEach(({ root }) => { if (root) disposeNightDropProductionObject(root); });
      return;
    }
    let installedSegments = 0;
    let missingRoles = 0;
    loaded.forEach(({ role, spec, root }) => {
      if (!spec || !root) {
        missingRoles += 1;
        return;
      }
      (segmentsByRole.get(role) ?? []).forEach((segment, index) => {
        const instance = index === 0 ? root : root.clone(true);
        const progress = ((segment.startDistance + segment.endDistance) / 2) / this.route.totalLength;
        const point = this.path.getPointAt(progress);
        const tangent = this.path.getTangentAt(progress).normalize();
        instance.position.copy(point);
        instance.lookAt(point.clone().add(tangent));
        instance.scale.multiply(new THREE.Vector3(
          THREE.MathUtils.clamp((segment.width * 2) / spec.footprint.width, .7, 1.45),
          1,
          THREE.MathUtils.clamp((segment.endDistance - segment.startDistance) / spec.footprint.length, .65, 2.6),
        ));
        instance.userData.segmentId = segment.id;
        instance.userData.productionEnvironment = true;
        this.city.children.forEach((object) => {
          if (object.userData.segmentId === segment.id && !object.userData.productionEnvironment) {
            object.userData.productionReplaced = true;
          }
        });
        this.city.add(instance);
        installedSegments += 1;
      });
    });
    this.stage.dataset.environmentAssetMode = installedSegments > 0 ? "production" : "proxy";
    this.stage.dataset.environmentAssetSegments = String(installedSegments);
    this.stage.dataset.environmentAssetMissingRoles = String(missingRoles);
  }

  private buildScene(): void {
    this.scene.add(new THREE.HemisphereLight(0x7bb7d2, 0x070914, 1.72));
    const key = new THREE.DirectionalLight(0x9fd9ee, 2.65);
    key.position.set(-12, 26, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    this.scene.add(key);

    const magentaFill = new THREE.PointLight(0xff2aaf, 9, 30, 2);
    magentaFill.position.set(14, 8, -48);
    this.scene.add(magentaFill);
    const cyanFill = new THREE.PointLight(0x28eaff, 8, 29, 2);
    cyanFill.position.set(-8, 5, -92);
    this.scene.add(cyanFill);

    this.scene.add(createRoad(this.path));
    this.scene.add(this.city);
    this.scene.add(this.junctions);
    this.buildRouteMarkers();
    this.scene.add(this.routeMarkers);
    this.scene.add(this.runner);
    this.scene.add(this.effects.root);
    this.packages.forEach(({ root }) => this.scene.add(root));
    this.obstacles.forEach(({ root }) => this.scene.add(root));

    placeAt(this.gate, this.path, this.continuationProgress, 0, 0);
    placeAt(this.shortcut, this.path, this.shortcutProgress, 0, 0);
    placeAt(this.checkpoint.root, this.path, this.checkpointProgress, 0, 0);
    placeAt(this.penthouse, this.path, Math.min(.995, this.destinationProgress + .015), 0, 0);
    this.scene.add(this.gate, this.shortcut, this.checkpoint.root, this.penthouse, this.rain);
  }

  private buildRouteMarkers(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0x6cfbff, transparent: true, opacity: .92 });
    const markerCount = Math.min(72, Math.max(24, Math.round(this.route.totalLength / 7.2)));
    for (let index = 1; index < markerCount; index += 1) {
      const progress = index / markerCount;
      const point = this.path.getPointAt(progress);
      const tangent = this.path.getTangentAt(progress).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const back = point.clone().addScaledVector(tangent, -.9);
      const left = back.clone().addScaledVector(side, -.58);
      const tip = point.clone();
      const right = back.clone().addScaledVector(side, .58);
      left.y += .075;
      tip.y += .075;
      right.y += .075;
      const markerCurve = new THREE.CatmullRomCurve3([
        left,
        tip,
        right,
      ]);
      const marker = new THREE.Mesh(new THREE.TubeGeometry(markerCurve, 8, .055, 5, false), material);
      marker.userData.progress = progress;
      this.routeMarkers.add(marker);
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const frameTime = Math.max(0, now - this.lastFrameAt);
    this.lastFrameAt = now;
    if (frameTime > 0 && frameTime < 1_000) {
      this.frameTimes.push(frameTime);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
    this.elapsedMs = Math.max(0, Math.min(this.timeline.at(-1)?.atMs ?? 15_800, (now - this.startedAt) * this.speed));
    this.updateWorld(this.elapsedMs, false);
    if (this.elapsedMs < (this.timeline.at(-1)?.atMs ?? 15_800)) {
      this.frameRequest = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
    }
  };

  private updateWorld(elapsedMs: number, snapCamera: boolean, forcedProgress?: number): void {
    const frameDeltaMs = snapCamera ? 16.67 : Math.max(0, Math.min(100, elapsedMs - this.lastWorldElapsedMs));
    this.lastWorldElapsedMs = elapsedMs;
    const progress = forcedProgress ?? progressAt(elapsedMs, this.timeline);
    const centrePoint = this.path.getPointAt(progress);
    const tangent = this.path.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const moving = elapsedMs >= phaseAt(this.timeline, "start-running") && elapsedMs < phaseAt(this.timeline, "arrival");
    const runnerState = this.runnerController.advance({
      elapsedMs,
      progress,
      collectedCueIds: this.route.cues.filter((cue) => cue.progress <= progress && (cue.kind === "standard-pickup" || cue.kind === "premium-pickup")).map(({ id }) => id),
      status: elapsedMs >= phaseAt(this.timeline, "resolved") ? "resolved" : elapsedMs >= phaseAt(this.timeline, "arrival") ? "arrived" : moving ? "running" : "idle",
    });
    if (!snapCamera && runnerState.obstacleInteractions.length > this.reportedObstacleInteractions) {
      runnerState.obstacleInteractions.slice(this.reportedObstacleInteractions).forEach(({ result }) => {
        this.onPresentationCue?.(result === "cleared" ? "obstacle-clear" : "obstacle-hit");
      });
      this.reportedObstacleInteractions = runnerState.obstacleInteractions.length;
    }
    const branchDisplacement = resolveSpatialBranchDisplacement(this.route, runnerState.branchSelections, progress);
    const decision = resolveSpatialJunctionDecision(this.route, progress);
    const travelledDistance = progress * this.route.totalLength;
    const nextJunction = this.route.branches.find((branch) => branch.entryDistance >= travelledDistance - 1);
    const junctionDistance = nextJunction ? Math.max(0, nextJunction.entryDistance - travelledDistance) : Number.POSITIVE_INFINITY;
    const junctionLeadDistance = nextJunction ? nextJunction.entryDistance - nextJunction.decisionOpensDistance : 0;
    const junctionWarningDistance = Math.max(52, junctionLeadDistance + 18);
    const junctionAnticipation = nextJunction && junctionDistance <= junctionWarningDistance
      ? 1 - junctionDistance / junctionWarningDistance
      : 0;
    const resolvedObstacleIds = new Set(runnerState.obstacleInteractions.map(({ obstacleId }) => obstacleId));
    const nextObstacle = this.route.obstacles.find((obstacle) => obstacle.distance >= travelledDistance - 1 && !resolvedObstacleIds.has(obstacle.id));
    const obstacleDistance = nextObstacle ? Math.max(0, nextObstacle.distance - travelledDistance) : Number.POSITIVE_INFINITY;
    const obstacleAnticipation = nextObstacle && obstacleDistance <= nextObstacle.reactionLeadDistance
      ? 1 - obstacleDistance / nextObstacle.reactionLeadDistance
      : 0;
    const laneTarget = runnerState.lane * 2.55;
    const laneResponse = 1 - Math.exp(-frameDeltaMs / 105);
    this.visualLaneOffset = snapCamera ? laneTarget : this.visualLaneOffset + (laneTarget - this.visualLaneOffset) * laneResponse;
    const actionDuration = Math.max(1, runnerState.actionEndsAtMs - runnerState.actionStartedAtMs);
    const actionProgress = Math.max(0, Math.min(1, (elapsedMs - runnerState.actionStartedAtMs) / actionDuration));
    const jumpHeight = runnerState.action === "jumping" ? Math.sin(Math.PI * actionProgress) * 1.55 : 0;
    const travelTangent = tangent.clone().applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -THREE.MathUtils.degToRad(branchDisplacement.headingOffsetDegrees),
    ).normalize();
    const travelSide = new THREE.Vector3(-travelTangent.z, 0, travelTangent.x).normalize();
    const point = centrePoint.clone()
      .addScaledVector(side, branchDisplacement.lateralOffset)
      .addScaledVector(travelSide, this.visualLaneOffset);
    point.y += branchDisplacement.elevationOffset + jumpHeight;
    const runningBlend = moving ? smoothstep((elapsedMs - phaseAt(this.timeline, "start-running")) / 920) : 0;
    const stride = moving ? Math.sin(elapsedMs * (.014 + runningBlend * .0035)) * runningBlend : 0;
    const bob = moving ? Math.abs(Math.sin(elapsedMs * .034)) * .075 * runningBlend : 0;
    const latestInteraction = runnerState.obstacleInteractions.at(-1);
    const interactionAge = latestInteraction ? elapsedMs - latestInteraction.atMs : Number.POSITIVE_INFINITY;
    const interactionStrength = interactionAge >= 0 && interactionAge <= 620 ? 1 - interactionAge / 620 : 0;
    const hitStrength = latestInteraction?.result === "hit" ? interactionStrength : 0;
    const clearStrength = latestInteraction?.result === "cleared" ? interactionStrength : 0;

    this.runner.position.copy(point).add(new THREE.Vector3(0, bob, 0));
    this.runner.lookAt(point.clone().add(travelTangent).add(new THREE.Vector3(0, bob, 0)));
    const dodgeLean = runnerState.action === "dodging-left" ? -.22 : runnerState.action === "dodging-right" ? .22 : 0;
    this.dashActor.update({
      frameDeltaMs,
      elapsedMs,
      moving,
      action: runnerState.action,
      stride,
      dodgeLean,
      hitStrength,
      clearStrength,
      runningBlend,
    });
    this.effects.update({
      position: this.runner.position,
      tangent: travelTangent,
      elapsedMs,
      moving,
      runningBlend,
      clearStrength,
      hitStrength,
      compact: this.compactRenderMode,
    });
    this.runner.scale.set(.82 + clearStrength * .035, runnerState.action === "sliding" ? .52 : .82 - hitStrength * .08, .82 + hitStrength * .05);

    const cameraDistance = (moving ? 8.85 - runningBlend * 1.2 : 8.85) + junctionAnticipation * 1.15 + obstacleAnticipation * .45;
    const cameraHeight = (moving ? 4.82 - runningBlend * .56 : 4.82) + junctionAnticipation * .52 + obstacleAnticipation * .18;
    const aheadProgress = Math.min(.999, progress + .025);
    const aheadDisplacement = resolveSpatialBranchDisplacement(this.route, runnerState.branchSelections, aheadProgress);
    const aheadTangent = this.path.getTangentAt(aheadProgress).normalize().applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -THREE.MathUtils.degToRad(aheadDisplacement.headingOffsetDegrees),
    ).normalize();
    const turnStrength = Math.max(-1, Math.min(1, travelTangent.x * aheadTangent.z - travelTangent.z * aheadTangent.x));
    const turnOffset = turnStrength * 1.35;
    const desiredCamera = point.clone()
      .addScaledVector(travelTangent, -cameraDistance)
      .addScaledVector(travelSide, turnOffset)
      .add(new THREE.Vector3(0, cameraHeight + bob * .35, 0));
    if (hitStrength > 0) {
      desiredCamera.addScaledVector(travelSide, Math.sin(elapsedMs * .095) * .24 * hitStrength);
      desiredCamera.y += Math.sin(elapsedMs * .12) * .12 * hitStrength;
    }
    const cameraResponse = 1 - Math.exp(-frameDeltaMs / 112);
    if (snapCamera) this.camera.position.copy(desiredCamera);
    else this.camera.position.lerp(desiredCamera, cameraResponse);
    const lookAtDistance = 5.4 + runningBlend * 1.6 + junctionAnticipation * 3;
    const lookAt = point.clone().addScaledVector(travelTangent, lookAtDistance).add(new THREE.Vector3(0, 1.15, 0));
    if (snapCamera) this.cameraTarget.copy(lookAt);
    else this.cameraTarget.lerp(lookAt, 1 - Math.exp(-frameDeltaMs / 92));
    this.camera.lookAt(this.cameraTarget);
    if (!snapCamera && moving) this.camera.rotateZ(Math.sin(elapsedMs * .017) * .0035);

    this.routeMarkers.visible = elapsedMs >= 650 && elapsedMs < 13_700;
    this.routeMarkers.children.forEach((marker) => {
      const markerProgress = marker.userData.progress as number;
      marker.visible = markerProgress > progress + .018 && markerProgress < progress + .24;
    });
    this.packages.forEach(({ root, collectedAtMs }) => {
      const difference = collectedAtMs - elapsedMs;
      root.visible = difference > -360;
      const pickup = difference < 0 ? 1 + Math.min(1.8, Math.abs(difference) / 150) : 1 + Math.sin(elapsedMs * .009) * .08;
      root.scale.setScalar(pickup);
      root.rotation.y = elapsedMs * .0012;
    });
    this.obstacles.forEach(({ root, obstacle }) => {
      placeObstacleAt(root, this.path, this.route, obstacle, runnerState.branchSelections);
      const obstacleDelta = obstacle.distance - travelledDistance;
      root.visible = !resolvedObstacleIds.has(obstacle.id) && obstacleDelta > -2 && obstacleDelta < (this.compactRenderMode ? 96 : 138);
      const pulse = obstacle.id === nextObstacle?.id ? 1 + obstacleAnticipation * .075 + Math.sin(elapsedMs * .012) * .025 : 1;
      root.scale.setScalar(pulse);
    });

    const gateOpen = smoothstep((elapsedMs - phaseAt(this.timeline, "continuation-open") + 500) / 950);
    const gateLeft = this.gate.getObjectByName("gate-left");
    const gateRight = this.gate.getObjectByName("gate-right");
    if (gateLeft) gateLeft.position.x = -1.55 - gateOpen * 1.65;
    if (gateRight) gateRight.position.x = 1.55 + gateOpen * 1.65;

    const clampStart = phaseAt(this.timeline, "clamp");
    const escapeStart = phaseAt(this.timeline, "escape");
    const clampActive = elapsedMs >= clampStart - 250 && elapsedMs <= escapeStart + 200;
    this.checkpoint.redLight.intensity = clampActive ? 35 : 8;
    this.checkpoint.clamp.position.x = elapsedMs > escapeStart - 100 ? 2.05 + smoothstep((elapsedMs - escapeStart + 100) / 500) * 3.8 : 2.05;
    this.checkpoint.clamp.rotation.z = clampActive ? Math.sin(elapsedMs * .012) * .02 : 0;

    const shortcutStart = phaseAt(this.timeline, "shortcut");
    const shortcutActive = elapsedMs >= shortcutStart - 300 && elapsedMs <= clampStart - 100;
    this.shortcut.traverse((object) => {
      if (object instanceof THREE.PointLight) object.intensity = shortcutActive ? 28 : 10;
    });

    const positions = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const nextY = positions.getY(index) - (moving ? .24 : .07);
      positions.setY(index, nextY < .15 ? 15 + seeded(index * 17) * 16 : nextY);
    }
    positions.needsUpdate = true;
    this.rain.position.set(point.x, point.y, point.z);

    const routeWindow = resolveSpatialRouteWindow(this.route, progress, this.compactRenderMode
      ? { distanceBehind: 24, distanceAhead: 92 }
      : { distanceBehind: 42, distanceAhead: 128 });
    const activeSegments = new Set(routeWindow.activeSegmentIds);
    this.city.children.forEach((object) => {
      object.visible = activeSegments.has(String(object.userData.segmentId ?? "")) && object.userData.productionReplaced !== true;
    });
    this.stage.dataset.activeSegments = routeWindow.activeSegmentIds.join(",");
    this.stage.dataset.lane = String(runnerState.lane);
    this.stage.dataset.visualLaneOffset = this.visualLaneOffset.toFixed(3);
    this.stage.dataset.runningBlend = runningBlend.toFixed(3);
    this.stage.dataset.runnerAction = runnerState.action;
    this.stage.dataset.activeBranch = branchDisplacement.activeBranchId ?? "";
    this.stage.dataset.branchAlternative = branchDisplacement.alternativeId ?? "";
    const junctionInRange = Boolean(nextJunction && !decision && junctionDistance <= junctionWarningDistance);
    const obstacleInRange = Boolean(nextObstacle && !decision && obstacleDistance <= nextObstacle.reactionLeadDistance);
    const showJunctionApproach = junctionInRange && (!obstacleInRange || junctionDistance + 8 < obstacleDistance);
    this.stage.dataset.junctionApproach = String(showJunctionApproach);
    this.stage.dataset.junctionApproachDistance = showJunctionApproach ? String(Math.ceil(junctionDistance)) : "";
    this.stage.dataset.junctionApproachType = showJunctionApproach ? nextJunction?.junctionKind ?? "" : "";
    if (this.junctionWarning) {
      this.junctionWarning.textContent = showJunctionApproach
        ? `${nextJunction?.junctionKind === "crossroads" ? "CROSSROADS" : "T-JUNCTION"} · ${Math.ceil(junctionDistance)}m`
        : "";
    }
    const showObstacleApproach = obstacleInRange && !showJunctionApproach;
    this.stage.dataset.obstacleApproach = String(showObstacleApproach);
    this.stage.dataset.obstacleId = showObstacleApproach ? nextObstacle?.id ?? "" : "";
    this.stage.dataset.obstacleKind = showObstacleApproach ? nextObstacle?.kind ?? "" : "";
    this.stage.dataset.obstacleDistance = showObstacleApproach ? String(Math.ceil(obstacleDistance)) : "";
    this.stage.dataset.obstacleAction = showObstacleApproach ? nextObstacle?.requiredAction ?? "" : "";
    this.stage.dataset.obstacleResult = interactionStrength > 0 ? latestInteraction?.result ?? "" : "";
    this.stage.dataset.obstaclesCleared = String(runnerState.clearedObstacleIds.length);
    this.stage.dataset.obstaclesHit = String(runnerState.hitObstacleIds.length);
    if (this.obstacleWarning) {
      this.obstacleWarning.textContent = showObstacleApproach
        ? `${obstacleActionLabel(nextObstacle?.requiredAction ?? "none")} · ${Math.ceil(obstacleDistance)}m`
        : "";
    }
    if (this.obstacleResult) {
      this.obstacleResult.textContent = interactionStrength > 0
        ? latestInteraction?.result === "cleared" ? "CLEAN!" : "BUMP — KEEP MOVING"
        : "";
    }
    this.updateJunctionDecision(decision, runnerState.branchSelections, progress, !snapCamera);

    const baseFov = 52 + runningBlend * 6;
    const targetFov = (decision ? 68 : junctionAnticipation > 0 ? baseFov + junctionAnticipation * 8 : shortcutActive ? 66 : clampActive ? 61 : elapsedMs >= phaseAt(this.timeline, "penthouse-reveal") ? 54 : baseFov)
      + obstacleAnticipation * 3 + clearStrength * 2 - hitStrength * 1.5;
    this.camera.fov += (targetFov - this.camera.fov) * (snapCamera ? 1 : .08);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const averageFrameTimeMs = average(this.frameTimes);
    this.stage.dataset.averageFrameTimeMs = averageFrameTimeMs.toFixed(2);
    this.stage.dataset.worstFrameTimeMs = Math.max(0, ...this.frameTimes).toFixed(2);
    this.stage.dataset.fps = averageFrameTimeMs > 0 ? (1_000 / averageFrameTimeMs).toFixed(1) : "0.0";
    this.stage.dataset.visibleCityObjects = String(this.city.children.filter(({ visible }) => visible).length);
    this.stage.dataset.drawCalls = String(this.renderer.info.render.calls);
    this.stage.dataset.triangles = String(this.renderer.info.render.triangles);
  }

  private readonly resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    this.compactRenderMode = width <= 600;
    const pixelRatioCap = width <= 480 ? 1.35 : width <= 900 ? 1.6 : 2;
    const dynamicShadows = window.innerWidth > 900;
    this.renderer.setPixelRatio(Math.min(pixelRatioCap, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = dynamicShadows;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.stage.dataset.renderScale = String(Math.min(pixelRatioCap, window.devicePixelRatio || 1));
    this.stage.dataset.dynamicShadows = String(dynamicShadows);
  };

  private updateJunctionDecision(
    decision: ComposedSpatialRouteBranch | null,
    selections: Readonly<Record<string, string>>,
    progress: number,
    announce: boolean,
  ): void {
    const selectedId = decision ? selections[decision.id] ?? decision.defaultAlternativeId : "";
    this.stage.dataset.decisionOpen = String(Boolean(decision));
    this.stage.dataset.junctionType = decision?.junctionKind ?? "";
    this.stage.dataset.decisionBranch = decision?.id ?? "";
    this.stage.dataset.decisionSelection = selectedId;
    this.stage.dataset.decisionDistance = decision
      ? String(Math.max(0, Math.round((decision.entryProgress - progress) * this.route.totalLength)))
      : "";

    const previousDecisionId = this.decisionUiKey.split(":", 1)[0];
    const nextKey = `${decision?.id ?? "none"}:${selectedId}`;
    if (this.decisionUiKey === nextKey) return;
    this.decisionUiKey = nextKey;
    if (announce && decision && previousDecisionId !== decision.id) this.onPresentationCue?.("junction-open");
    if (this.junctionPrompt) {
      this.junctionPrompt.textContent = decision?.junctionKind === "crossroads"
        ? "CROSSROADS · CHOOSE"
        : decision?.junctionKind === "t-junction"
          ? "T-JUNCTION · CHOOSE"
          : "ROUTE CHOICE";
    }
    this.branchButtons.forEach((button) => {
      const direction = button.dataset.branch ?? "";
      const alternative = decision?.alternatives.find((item) => item.direction === direction || item.id === direction);
      button.hidden = !alternative;
      button.disabled = !alternative;
      button.dataset.selected = String(Boolean(alternative && alternative.id === selectedId));
      button.setAttribute("aria-pressed", String(Boolean(alternative && alternative.id === selectedId)));
      if (alternative) {
        const label = alternative.metadata.label;
        button.textContent = typeof label === "string" ? label : directionLabel(alternative.direction);
      }
    });

    this.junctions.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.branchId) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshBasicMaterial || material instanceof THREE.MeshStandardMaterial)) return;
      const isActiveBranch = Boolean(decision && object.userData.branchId === decision.id);
      const isSelected = isActiveBranch && object.userData.alternativeId === selectedId;
      const baseOpacity = Number(object.userData.baseOpacity ?? material.opacity);
      material.opacity = decision ? (isSelected ? Math.min(1, baseOpacity * 1.85) : isActiveBranch ? baseOpacity * .72 : baseOpacity * .28) : baseOpacity;
      if (material instanceof THREE.MeshStandardMaterial) {
        const baseEmissive = Number(object.userData.baseEmissiveIntensity ?? material.emissiveIntensity);
        material.emissiveIntensity = isSelected ? Math.max(.7, baseEmissive * 2.2) : baseEmissive;
      }
    });
  }

  private stopFrame(): void {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
  }
}

function createRoutePath(route: ComposedSpatialRoute): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    route.samples.map(({ position }) => new THREE.Vector3(position.x, position.y, position.z)),
    false,
    "centripetal",
    .28,
  );
}

function createRoad(path: THREE.CatmullRomCurve3): THREE.Group {
  const group = new THREE.Group();
  const road = createRibbon(path, 4.8, .02, new THREE.MeshStandardMaterial({ color: 0x101c2b, roughness: .24, metalness: .86 }));
  road.receiveShadow = true;
  group.add(road);
  group.add(createRibbon(path, 6.4, -.02, new THREE.MeshStandardMaterial({ color: 0x1a2431, roughness: .7, metalness: .22 })));

  const leftPoints: THREE.Vector3[] = [];
  const rightPoints: THREE.Vector3[] = [];
  for (let index = 0; index <= 120; index += 1) {
    const progress = index / 120;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = point.clone().addScaledVector(side, -4.82);
    const right = point.clone().addScaledVector(side, 4.82);
    left.y += .065;
    right.y += .065;
    leftPoints.push(left);
    rightPoints.push(right);
  }
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x25eaff, transparent: true, opacity: .72 });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPoints), edgeMaterial));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPoints), edgeMaterial));
  return group;
}

function createRibbon(path: THREE.CatmullRomCurve3, halfWidth: number, y: number, material: THREE.Material): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const segments = 150;
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = point.clone().addScaledVector(side, -halfWidth);
    const right = point.clone().addScaledVector(side, halfWidth);
    left.y += y;
    right.y += y;
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function createCity(path: THREE.CatmullRomCurve3, route: ComposedSpatialRoute, lod: NightDropRunnerLod): THREE.Group {
  const city = new THREE.Group();
  const buildingCount = Math.min(52, Math.max(28, Math.round(route.totalLength / 22)));
  for (let index = 0; index < buildingCount; index += 1) {
    const progress = .025 + (index / Math.max(1, buildingCount - 1)) * .95;
    const insideJunctionClearance = route.branches.some((junction) => Math.abs(progress - junction.entryProgress) * route.totalLength < 24);
    if (insideJunctionClearance) continue;
    const segmentId = segmentAtProgress(route, progress);
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    ([-1, 1] as const).forEach((side, sideIndex) => {
      const width = 4.5 + seeded(index * 11 + sideIndex) * 3;
      const depth = 4 + seeded(index * 19 + sideIndex) * 3.2;
      const height = 7.5 + seeded(index * 29 + sideIndex) * 11.5;
      const district = resolveNightDropDistrict(progress, route.segments.find(({ id }) => id === segmentId)?.kind);
      const accent = district.primaryAccent;
      const label = (index + sideIndex) % 4 === 0
        ? CITY_LABELS[(index + sideIndex) % CITY_LABELS.length]
        : undefined;
      const building = createNightDropBuilding({
        index,
        sideIndex,
        width,
        depth,
        height,
        accent,
        district: district.id,
        ...(label ? { label } : {}),
      });
      building.position.copy(point).addScaledVector(sideVector, side * (11.6 + depth / 2));
      building.position.y = point.y;
      building.lookAt(point.clone().setY(point.y));
      building.userData.segmentId = segmentId;
      city.add(building);
    });

    if (index % 3 === 0) {
      ([-1, 1] as const).forEach((side) => {
        const lamp = createStreetLamp(accentFor(progress));
        lamp.position.copy(point).addScaledVector(sideVector, side * 6.65);
        lamp.lookAt(point.clone().add(tangent));
        lamp.userData.segmentId = segmentId;
        city.add(lamp);
      });
    }
  }
  route.branches.forEach((junction, junctionIndex) => {
    const architecture = createJunctionArchitecture(path, route, junction, junctionIndex);
    architecture.userData.segmentId = segmentAtProgress(route, junction.entryProgress);
    city.add(architecture);
  });
  route.segments.forEach((roadPiece, index) => {
    city.add(createNightDropStreetModule(path, route, roadPiece, index, lod));
    const furniture = createRoadPieceFurniture(path, route, roadPiece, index);
    if (furniture.children.length === 0) return;
    furniture.userData.segmentId = roadPiece.id;
    city.add(furniture);
  });
  return city;
}

function createRoadPieceFurniture(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  segment: ComposedSpatialRouteSegment,
  segmentIndex: number,
): THREE.Group {
  const root = new THREE.Group();
  const progressAt = (offset: number): number => (
    segment.startDistance + (segment.endDistance - segment.startDistance) * offset
  ) / route.totalLength;
  const placeFrame = (frame: THREE.Object3D, offset: number): void => {
    const progress = progressAt(offset);
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    frame.position.copy(point);
    frame.lookAt(point.clone().add(tangent));
    root.add(frame);
  };

  if (segment.kind === "bridge" || segment.kind === "rooftop") {
    const railMaterial = new THREE.MeshStandardMaterial({
      color: segment.kind === "bridge" ? 0x1a3947 : 0x273247,
      emissive: segment.kind === "bridge" ? 0x19c9dd : 0x7020b2,
      emissiveIntensity: .42,
      roughness: .34,
      metalness: .7,
    });
    ([-1, 1] as const).forEach((side) => {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= 12; index += 1) {
        const progress = progressAt(.04 + index / 12 * .92);
        const point = path.getPointAt(progress);
        const tangent = path.getTangentAt(progress).normalize();
        const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        point.addScaledVector(sideVector, side * (segment.width + .5));
        point.y += 1.05;
        points.push(point);
      }
      root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, .08, 6, false), railMaterial));
    });
  }

  if (segment.kind === "tunnel") {
    const tunnelMaterial = new THREE.MeshStandardMaterial({ color: 0x142c38, emissive: 0x20d9e8, emissiveIntensity: .38, metalness: .72, roughness: .32 });
    for (const offset of [.08, .32, .56, .8]) {
      const frame = new THREE.Group();
      const left = new THREE.Mesh(new THREE.BoxGeometry(.16, 4.4, .18), tunnelMaterial);
      left.position.set(-3.5, 2.2, 0);
      const right = left.clone();
      right.position.x = 3.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(7.15, .16, .18), tunnelMaterial);
      top.position.y = 4.38;
      frame.add(left, right, top);
      placeFrame(frame, offset);
    }
  }

  if (segment.kind === "alley") {
    const serviceMaterial = new THREE.MeshStandardMaterial({ color: 0x324453, emissive: 0xff3ec8, emissiveIntensity: .22, metalness: .6, roughness: .38 });
    for (const offset of [.28, .7]) {
      const frame = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(6.4, .12, .18), serviceMaterial);
      bar.position.y = 3.25;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 3.2, 6), serviceMaterial);
      cable.position.set((segmentIndex + Math.round(offset * 10)) % 2 === 0 ? -2.5 : 2.5, 1.65, 0);
      frame.add(bar, cable);
      placeFrame(frame, offset);
    }
  }

  if (segment.kind === "ramp") {
    const sign = createNeonSign(segment.elevation >= 0 ? "RAMP UP" : "RAMP DOWN", 0x40f8ff);
    sign.scale.setScalar(.7);
    placeFrame(sign, .18);
    sign.position.y += 2.4;
  }

  if (segment.kind === "destination") {
    const beacon = new THREE.Group();
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd21c, transparent: true, opacity: .78 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, .08, 8, 36), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .12;
    const light = new THREE.PointLight(0xffc928, 20, 18, 2);
    light.position.y = 2.2;
    beacon.add(ring, light);
    placeFrame(beacon, .72);
  }

  return root;
}

function createJunctionArchitecture(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  junction: ComposedSpatialRouteBranch,
  junctionIndex: number,
): THREE.Group {
  const root = new THREE.Group();
  const point = path.getPointAt(junction.entryProgress);
  const tangent = path.getTangentAt(junction.entryProgress).normalize();
  const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const placements = junction.junctionKind === "t-junction"
    ? [
        { side: -12.4, forward: 6.5, width: 8.4, depth: 7.4, height: 12.5, blocked: false },
        { side: 12.4, forward: 6.5, width: 8.4, depth: 7.4, height: 14.5, blocked: false },
        { side: 0, forward: 15.5, width: 13.2, depth: 6.8, height: 11.5, blocked: true },
      ]
    : [
        { side: -12.5, forward: -10.5, width: 8.2, depth: 7.2, height: 12, blocked: false },
        { side: 12.5, forward: -10.5, width: 8.2, depth: 7.2, height: 15, blocked: false },
        { side: -12.5, forward: 11, width: 8.8, depth: 7.8, height: 16, blocked: false },
        { side: 12.5, forward: 11, width: 8.8, depth: 7.8, height: 13.5, blocked: false },
      ];

  placements.forEach((placement, placementIndex) => {
    const accent = placement.blocked
      ? 0xff3155
      : [0x20d9e8, 0xff3ec8, 0xffd21c][(junctionIndex + placementIndex) % 3]!;
    const building = createJunctionBuilding(
      placement.width,
      placement.height,
      placement.depth,
      accent,
      placement.blocked,
    );
    building.position.copy(point)
      .addScaledVector(tangent, placement.forward)
      .addScaledVector(sideVector, placement.side);
    building.lookAt(point.clone().setY(building.position.y));
    root.add(building);
  });
  root.userData.routeDefinitionId = route.definitionId;
  root.userData.junctionId = junction.id;
  root.userData.authoredGeometry = true;
  return root;
}

function createJunctionBuilding(
  width: number,
  height: number,
  depth: number,
  accent: number,
  blocked: boolean,
): THREE.Group {
  const root = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: blocked ? 0x170b12 : 0x08131d,
      roughness: .64,
      metalness: .26,
      emissive: accent,
      emissiveIntensity: blocked ? .038 : .012,
    }),
  );
  shell.position.y = height / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  root.add(shell);

  const pavement = new THREE.Mesh(
    new THREE.BoxGeometry(width + .7, .14, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1d2830, emissive: 0x07131a, emissiveIntensity: .015, roughness: .82, metalness: .12 }),
  );
  pavement.position.set(0, .07, depth / 2 + 1.1);
  pavement.receiveShadow = true;
  root.add(pavement);

  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(width * .72, height * .66),
    createWindowFacadeMaterial(accent),
  );
  facade.position.set(0, height * .54, depth / 2 + .02);
  root.add(facade);

  const entrance = new THREE.Mesh(
    new THREE.BoxGeometry(blocked ? width * .58 : width * .28, Math.min(3.4, height * .28), .18),
    new THREE.MeshStandardMaterial({
      color: blocked ? 0x581326 : 0x17323d,
      emissive: accent,
      emissiveIntensity: blocked ? .58 : .28,
      roughness: .36,
      metalness: .52,
    }),
  );
  entrance.position.set(0, Math.min(1.7, height * .14), depth / 2 + .13);
  root.add(entrance);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + .7, .38, depth + .7),
    new THREE.MeshStandardMaterial({ color: 0x243747, roughness: .38, metalness: .68 }),
  );
  roof.position.y = height + .15;
  root.add(roof);

  const sign = createNeonSign(blocked ? "NO THROUGH ROAD" : CITY_LABELS[Math.round(width + height) % CITY_LABELS.length]!, accent);
  sign.position.set(0, height * .79, depth / 2 + .15);
  sign.scale.setScalar(blocked ? .82 : .64);
  root.add(sign);
  return root;
}

function createWindowFacadeMaterial(accent: number): THREE.MeshBasicMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Night Drop window facade canvas unavailable");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(3, 8, 15, .97)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const accentColour = `#${accent.toString(16).padStart(6, "0")}`;
  const windowColours = ["#9feaff", "#ffd58a", "#7ebcff"] as const;
  for (let row = 0; row < 9; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if ((row * 3 + column * 5) % 7 === 0) continue;
      context.globalAlpha = .38 + ((row + column) % 3) * .18;
      context.fillStyle = windowColours[(row + column) % windowColours.length]!;
      context.fillRect(5 + column * 15, 6 + row * 14, 8, 4);
    }
  }
  context.globalAlpha = .14;
  context.strokeStyle = accentColour;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .94, depthWrite: false });
}

function createJunctionGeometry(path: THREE.CatmullRomCurve3, route: ComposedSpatialRoute): THREE.Group {
  const group = new THREE.Group();
  route.branches.forEach((branchDefinition) => {
    const entryPoint = path.getPointAt(branchDefinition.entryProgress);
    const entryTangent = path.getTangentAt(branchDefinition.entryProgress).normalize();
    const entrySide = new THREE.Vector3(-entryTangent.z, 0, entryTangent.x).normalize();
    const crossStreetPath = new THREE.CatmullRomCurve3([
      entryPoint.clone().addScaledVector(entrySide, -19),
      entryPoint.clone().addScaledVector(entrySide, -7),
      entryPoint.clone(),
      entryPoint.clone().addScaledVector(entrySide, 7),
      entryPoint.clone().addScaledVector(entrySide, 19),
    ], false, "centripetal", .2);
    const crossStreet = createRibbon(
      crossStreetPath,
      4.35,
      .018,
      new THREE.MeshStandardMaterial({ color: 0x1a3140, roughness: .3, metalness: .72, emissive: 0x082a32, emissiveIntensity: .2 }),
    );
    crossStreet.receiveShadow = true;
    group.add(crossStreet);
    const curbMaterial = new THREE.LineBasicMaterial({ color: 0x40f8ff, transparent: true, opacity: .42 });
    ([-1, 1] as const).forEach((edge) => {
      const curbPoints = [
        entryPoint.clone().addScaledVector(entrySide, -19).addScaledVector(entryTangent, edge * 4.35),
        entryPoint.clone().addScaledVector(entrySide, 19).addScaledVector(entryTangent, edge * 4.35),
      ];
      curbPoints.forEach((point) => { point.y += .1; });
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curbPoints), curbMaterial));
    });

    if (branchDefinition.junctionKind === "t-junction") {
      const closure = new THREE.Group();
      const danger = new THREE.MeshStandardMaterial({ color: 0x7f2638, emissive: 0xff264d, emissiveIntensity: .55, roughness: .42 });
      for (let index = -2; index <= 2; index += 1) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.25, .65, .48), danger.clone());
        block.position.set(index * 1.18, .46, 0);
        closure.add(block);
      }
      closure.position.copy(entryPoint).addScaledVector(entryTangent, 6.4);
      closure.lookAt(entryPoint.clone().addScaledVector(entryTangent, 7.4));
      group.add(closure);
    }

    branchDefinition.alternatives.forEach((alternative) => {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index <= 36; index += 1) {
        const localProgress = index / 36;
        const progress = branchDefinition.entryProgress + (branchDefinition.rejoinProgress - branchDefinition.entryProgress) * localProgress;
        const point = path.getPointAt(progress);
        const tangent = path.getTangentAt(progress).normalize();
        const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const displacement = resolveSpatialBranchDisplacement(
          route,
          { [branchDefinition.id]: alternative.id },
          progress,
        );
        point.addScaledVector(side, displacement.lateralOffset);
        point.y += .09 + displacement.elevationOffset;
        points.push(point);
      }
      const branchPath = new THREE.CatmullRomCurve3(points, false, "centripetal", .24);
      if (alternative.direction !== "straight") {
        const roadMaterial = new THREE.MeshStandardMaterial({
          color: 0x1a3444,
          roughness: .25,
          metalness: .82,
          emissive: 0x082b35,
          emissiveIntensity: .28,
          transparent: true,
          opacity: .96,
        });
        const road = createRibbon(branchPath, 3.15, .025, roadMaterial);
        road.receiveShadow = true;
        tagJunctionMesh(road, branchDefinition.id, alternative.id, .96, .28);
        group.add(road);
      }

      const guideMaterial = new THREE.MeshBasicMaterial({
        color: alternative.direction === "straight" ? 0xb7fdff : 0x40f8ff,
        transparent: true,
        opacity: .64,
      });
      const guide = new THREE.Mesh(new THREE.TubeGeometry(branchPath, 56, .11, 6, false), guideMaterial);
      tagJunctionMesh(guide, branchDefinition.id, alternative.id, .64, 0);
      group.add(guide);

      const directionOffset = alternative.direction === "left" ? -3.2 : alternative.direction === "right" ? 3.2 : 0;
      const sign = createNeonSign(directionLabel(alternative.direction).toUpperCase(), alternative.direction === "straight" ? 0xb7fdff : 0x40f8ff);
      sign.position.copy(entryPoint)
        .addScaledVector(entryTangent, -2.2)
        .addScaledVector(entrySide, directionOffset);
      sign.position.y += 2.65;
      sign.lookAt(entryPoint.clone().addScaledVector(entryTangent, -8).setY(sign.position.y));
      sign.scale.setScalar(.76);
      tagJunctionMesh(sign, branchDefinition.id, alternative.id, 1, 0);
      group.add(sign);
    });
  });
  return group;
}

function tagJunctionMesh(
  mesh: THREE.Mesh,
  branchId: string,
  alternativeId: string,
  baseOpacity: number,
  baseEmissiveIntensity: number,
): void {
  mesh.userData.branchId = branchId;
  mesh.userData.alternativeId = alternativeId;
  mesh.userData.baseOpacity = baseOpacity;
  mesh.userData.baseEmissiveIntensity = baseEmissiveIntensity;
}

function directionLabel(direction: "left" | "straight" | "right"): string {
  if (direction === "left") return "← Left";
  if (direction === "right") return "Right →";
  return "↑ Straight";
}

function createPackage(progress: number, lane: number, premium: boolean, path: THREE.CatmullRomCurve3): THREE.Group {
  const group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: premium ? 0xfff16a : 0xffd21c, roughness: .24, metalness: .55, emissive: 0xffb900, emissiveIntensity: premium ? 1.5 : .72 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(.7, .55, .7), gold);
  box.position.y = .55;
  box.rotation.y = Math.PI / 4;
  box.castShadow = true;
  group.add(box);
  const light = new THREE.PointLight(0xffc928, premium ? 22 : 11, 7, 2);
  light.position.y = .8;
  group.add(light);
  placeAt(group, path, progress, lane * 2.8, 0);
  return group;
}

function createObstacle(obstacle: ResolvedSpatialRouteObstacle): THREE.Group {
  const root = new THREE.Group();
  const cyan = new THREE.MeshStandardMaterial({
    color: 0x163540,
    emissive: 0x40f8ff,
    emissiveIntensity: .72,
    roughness: .34,
    metalness: .66,
  });
  const danger = new THREE.MeshStandardMaterial({
    color: 0x8b1934,
    emissive: 0xff315e,
    emissiveIntensity: .74,
    roughness: .4,
    metalness: .48,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x080d14, roughness: .66, metalness: .42 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xffc928,
    emissive: 0xffa400,
    emissiveIntensity: .78,
    roughness: .34,
    metalness: .5,
  });
  const makeBox = (
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: THREE.Material,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  if (obstacle.kind === "barrier") {
    root.add(makeBox([7.5, .72, .38], [0, .58, 0], danger));
    root.add(makeBox([7.65, .1, .46], [0, 1, 0], gold));
    ([-3.2, 3.2] as const).forEach((x) => root.add(makeBox([.25, 1.2, .25], [x, .6, 0], dark)));
  } else if (obstacle.kind === "low-sign") {
    ([-3.45, 3.45] as const).forEach((x) => root.add(makeBox([.26, 2.45, .3], [x, 1.22, 0], cyan)));
    root.add(makeBox([7.15, .72, .4], [0, 2.2, 0], danger));
    const sign = createNeonSign("LOW CLEARANCE", 0xff315e);
    sign.position.set(0, 2.2, .24);
    sign.scale.setScalar(.58);
    root.add(sign);
  } else if (obstacle.kind === "gap") {
    root.add(makeBox([8.4, .1, 3.1], [0, -.03, 0], dark));
    ([-1.45, 1.45] as const).forEach((z) => root.add(makeBox([8.45, .08, .16], [0, .08, z], cyan)));
    const voidGlow = new THREE.PointLight(0x40f8ff, 9, 7, 2);
    voidGlow.position.set(0, -.25, 0);
    root.add(voidGlow);
  } else if (obstacle.kind === "traffic") {
    root.add(makeBox([2.15, 1.35, 3.4], [0, .82, 0], danger));
    root.add(makeBox([1.82, .84, 1.65], [0, 1.72, -.35], dark));
    ([-.72, .72] as const).forEach((x) => root.add(makeBox([.38, .16, .08], [x, .8, 1.74], gold)));
    const light = new THREE.PointLight(0xff315e, 12, 7, 2);
    light.position.set(0, 1.2, 1.8);
    root.add(light);
  } else if (obstacle.kind === "route-blocker") {
    root.add(makeBox([2.4, .82, .38], [0, .58, 0], danger));
    ([-.92, .92] as const).forEach((x) => root.add(makeBox([.2, 1.2, .22], [x, .6, 0], dark)));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 8), gold);
    beacon.position.set(0, 1.18, 0);
    root.add(beacon);
  } else {
    const ramp = makeBox([3.8, .34, 4.7], [0, .48, 0], cyan);
    ramp.rotation.x = -.16;
    root.add(ramp);
    ([-1.15, 0, 1.15] as const).forEach((x) => {
      const stripe = makeBox([.28, .06, 2.25], [x, .76, .25], gold);
      stripe.rotation.x = -.16;
      root.add(stripe);
    });
  }

  root.userData.obstacleId = obstacle.id;
  root.userData.obstacleKind = obstacle.kind;
  return root;
}

function createContinuationGate(): THREE.Group {
  const group = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x101d28, roughness: .45, metalness: .65, emissive: 0x0c8290, emissiveIntensity: .4 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x071018, roughness: .38, metalness: .76 });
  const left = new THREE.Mesh(new THREE.BoxGeometry(3, 4.4, .4), doorMaterial);
  left.name = "gate-left";
  left.position.set(-1.55, 2.2, 0);
  const right = left.clone();
  right.name = "gate-right";
  right.position.x = 1.55;
  const top = new THREE.Mesh(new THREE.BoxGeometry(7.5, .35, .55), frameMaterial);
  top.position.y = 4.55;
  const leftPost = new THREE.Mesh(new THREE.BoxGeometry(.3, 4.7, .55), frameMaterial);
  leftPost.position.set(-3.65, 2.35, 0);
  const rightPost = leftPost.clone();
  rightPost.position.x = 3.65;
  group.add(left, right, top, leftPost, rightPost);
  return group;
}

function createShortcutTunnel(): THREE.Group {
  const group = new THREE.Group();
  const cyan = new THREE.MeshBasicMaterial({ color: 0x20cfe2 });
  for (let index = 0; index < 6; index += 1) {
    const z = 1 + index * 2.1;
    const left = new THREE.Mesh(new THREE.BoxGeometry(.12, 4.1, .12), cyan);
    left.position.set(-3.35, 2.1, z);
    const right = left.clone();
    right.position.x = 3.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(6.8, .12, .12), cyan);
    top.position.set(0, 4.1, z);
    group.add(left, right, top);
  }
  const light = new THREE.PointLight(0x24eaff, 12, 14, 2);
  light.position.set(0, 2.8, 5.5);
  group.add(light);
  return group;
}

function createCheckpoint(): { readonly root: THREE.Group; readonly clamp: THREE.Group; readonly redLight: THREE.PointLight } {
  const root = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xff415d, emissive: 0xff173d, emissiveIntensity: 1.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: .5 });
  for (const x of [-2.2, 2.2]) {
    const barrier = new THREE.Group();
    for (let index = 0; index < 7; index += 1) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(.7, .2, .22), index % 2 === 0 ? red : white);
      stripe.position.x = (index - 3) * .67;
      stripe.rotation.z = index % 2 === 0 ? -.12 : .12;
      barrier.add(stripe);
    }
    barrier.position.set(x, 1.05, 0);
    root.add(barrier);
  }
  const clamp = createClampModel();
  clamp.position.set(2.05, 0, -.4);
  root.add(clamp);
  const redLight = new THREE.PointLight(0xff234d, 8, 18, 2);
  redLight.position.set(0, 4, 1);
  root.add(redLight);
  return { root, clamp, redLight };
}

function createClampModel(): THREE.Group {
  const root = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0x81963c, roughness: .72, emissive: 0x28330e, emissiveIntensity: .25 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: .8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa56f50, roughness: .82 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(.78, 18, 12), coat);
  body.scale.set(1, 1.25, .72);
  body.position.y = 1.45;
  const shirtPanel = new THREE.Mesh(new THREE.BoxGeometry(.52, .85, .14), shirt);
  shirtPanel.position.set(0, 1.5, .58);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.34, 16, 12), skin);
  head.position.y = 2.65;
  const legLeft = createCharacterLimb(.18, .72, coat);
  legLeft.position.set(-.3, .75, 0);
  const legRight = createCharacterLimb(.18, .72, coat);
  legRight.position.set(.3, .75, 0);
  root.add(body, shirtPanel, head, legLeft, legRight);
  root.scale.setScalar(1.12);
  return root;
}

function createCharacterLimb(radius: number, length: number, material: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();
  const limb = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 10), material);
  limb.position.y = -length / 2;
  limb.castShadow = true;
  pivot.add(limb);
  return pivot;
}

function createPenthouse(): THREE.Group {
  const group = new THREE.Group();
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x0a1019, roughness: .42, metalness: .58, emissive: 0x4c3600, emissiveIntensity: .16 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd21c, emissive: 0xffc400, emissiveIntensity: 1.8, roughness: .24, metalness: .62 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x8a6d21, emissive: 0xffc94d, emissiveIntensity: .38, roughness: .2, metalness: .36 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(11, 25, 6), towerMaterial);
  tower.position.set(0, 12.5, 4.5);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.2, .35), glass);
  door.position.set(0, 2.1, 1.32);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(6, .25, 2.5), gold);
  canopy.position.set(0, 4.45, .72);
  group.add(tower, door, canopy);
  for (let row = 0; row < 9; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      if ((row + column + 2) % 4 === 0) continue;
      const window = new THREE.Mesh(new THREE.PlaneGeometry(.72, .28), glass);
      window.position.set(column * 1.55, 6.1 + row * 1.75, 1.46);
      group.add(window);
    }
  }
  const address = createNeonSign("PENTHOUSE 2401", 0xffd21c);
  address.position.set(0, 5.15, 1.5);
  address.scale.setScalar(.75);
  group.add(address);
  const light = new THREE.PointLight(0xffc933, 38, 22, 2);
  light.position.set(0, 5, 2);
  group.add(light);
  return group;
}

function createStreetLamp(color: number): THREE.Group {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035, .055, 3.7, 8), new THREE.MeshStandardMaterial({ color: 0x263540, roughness: .45, metalness: .8 }));
  pole.position.y = 1.85;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.72, .055, .055), new THREE.MeshStandardMaterial({ color: 0x263540, roughness: .42, metalness: .82 }));
  arm.position.set(.32, 3.65, 0);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), new THREE.MeshBasicMaterial({ color }));
  bulb.position.set(.68, 3.6, 0);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .11, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(1.25, .65, 1);
  pool.position.set(.68, .08, 0);
  group.add(pole, arm, bulb, pool);
  return group;
}

function createNeonSign(label: string, color: number): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Night Drop neon sign canvas unavailable");
  context.fillStyle = "rgba(2,5,11,.92)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.lineWidth = 5;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  context.fillStyle = context.strokeStyle;
  context.font = "900 24px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  return new THREE.Mesh(new THREE.PlaneGeometry(2.8, .8), material);
}

function createRain(): THREE.Points {
  const positions = new Float32Array(540 * 3);
  for (let index = 0; index < 540; index += 1) {
    positions[index * 3] = -35 + seeded(index * 3) * 70;
    positions[index * 3 + 1] = .2 + seeded(index * 5) * 30;
    positions[index * 3 + 2] = -35 + seeded(index * 7) * 70;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x9feaff, size: .035, transparent: true, opacity: .55, sizeAttenuation: true });
  return new THREE.Points(geometry, material);
}

function placeAt(group: THREE.Object3D, path: THREE.CatmullRomCurve3, progress: number, lateral: number, y: number): void {
  const point = path.getPointAt(progress);
  const tangent = path.getTangentAt(progress).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  group.position.copy(point).addScaledVector(side, lateral);
  group.position.y += y;
  group.lookAt(point.clone().add(tangent).add(new THREE.Vector3(0, y, 0)));
}

function placeObstacleAt(
  group: THREE.Object3D,
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  obstacle: ResolvedSpatialRouteObstacle,
  selections: Readonly<Record<string, string>>,
): void {
  const point = path.getPointAt(obstacle.progress);
  const centreTangent = path.getTangentAt(obstacle.progress).normalize();
  const centreSide = new THREE.Vector3(-centreTangent.z, 0, centreTangent.x).normalize();
  const displacement = resolveSpatialBranchDisplacement(route, selections, obstacle.progress);
  const travelTangent = centreTangent.clone().applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -THREE.MathUtils.degToRad(displacement.headingOffsetDegrees),
  ).normalize();
  const travelSide = new THREE.Vector3(-travelTangent.z, 0, travelTangent.x).normalize();
  group.position.copy(point)
    .addScaledVector(centreSide, displacement.lateralOffset)
    .addScaledVector(travelSide, (obstacle.lane ?? 0) * 2.8);
  group.position.y += displacement.elevationOffset;
  group.lookAt(group.position.clone().add(travelTangent));
}

function obstacleActionLabel(action: ResolvedSpatialRouteObstacle["requiredAction"]): string {
  if (action === "jump") return "JUMP";
  if (action === "slide") return "SLIDE";
  if (action === "change-lane") return "CHANGE LANE";
  return "RAMP — KEEP SPEED";
}

function progressAt(elapsedMs: number, timeline: readonly RunnerTimelineBeat[]): number {
  const nextIndex = timeline.findIndex(({ atMs }) => atMs >= elapsedMs);
  if (nextIndex <= 0) return timeline[0]!.routeProgress;
  if (nextIndex < 0) return timeline.at(-1)!.routeProgress;
  const previous = timeline[nextIndex - 1]!;
  const next = timeline[nextIndex]!;
  const range = Math.max(1, next.atMs - previous.atMs);
  const progress = smoothstep((elapsedMs - previous.atMs) / range);
  return previous.routeProgress + (next.routeProgress - previous.routeProgress) * progress;
}

function timeAtProgress(progress: number, timeline: readonly RunnerTimelineBeat[]): number {
  const nextIndex = timeline.findIndex((beat) => beat.routeProgress >= progress && beat.phase !== "establishing" && beat.phase !== "route-guidance");
  if (nextIndex <= 0) return timeline[0]!.atMs;
  if (nextIndex < 0) return timeline.at(-1)!.atMs;
  const previous = timeline[nextIndex - 1]!;
  const next = timeline[nextIndex]!;
  const range = Math.max(Number.EPSILON, next.routeProgress - previous.routeProgress);
  return previous.atMs + ((progress - previous.routeProgress) / range) * (next.atMs - previous.atMs);
}

function phaseAt(timeline: readonly RunnerTimelineBeat[], phase: RunnerTimelineBeat["phase"]): number {
  return timeline.find((beat) => beat.phase === phase)?.atMs ?? 0;
}

function requireCue(route: ComposedSpatialRoute, kind: ResolvedSpatialRouteCue["kind"]): ResolvedSpatialRouteCue {
  const cue = route.cues.find((item) => item.kind === kind);
  if (!cue) throw new Error(`Spatial route ${route.definitionId} requires a ${kind} cue`);
  return cue;
}

function segmentAtProgress(route: ComposedSpatialRoute, progress: number): string {
  const distance = route.totalLength * progress;
  return route.segments.find((segment) => segment.startDistance <= distance && segment.endDistance >= distance)?.id ?? route.segments.at(-1)!.id;
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function seeded(value: number): number {
  const result = Math.sin(value * 12.9898 + 78.233) * 43_758.5453;
  return result - Math.floor(result);
}

function accentFor(progress: number): number {
  if (progress > .7 && progress < .82) return 0xff315e;
  if (progress > .88) return 0xffcf33;
  if (progress > .36 && progress < .58) return 0xff31c7;
  return 0x35e9ff;
}

function normalizeSpeed(value: number): number {
  return [0.5, 1, 2, 4].includes(value) ? value : 1;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
