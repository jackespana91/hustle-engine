import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
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
import { installNightDropCityKit } from "./night-drop-city-assets.js";
import { NightDropCityLife } from "./night-drop-city-life.js";
import { NightDropClampActor } from "./night-drop-clamp-actor.js";
import { NightDropDashActor, type NightDropDashMotionFrame } from "./night-drop-dash-actor.js";
import { resolveNightDropDistrict } from "./night-drop-districts.js";
import {
  NIGHT_DROP_BRANCH_STREET_HALF_WIDTH,
  NIGHT_DROP_JUNCTION_CENTRE_ADVANCE,
  createNightDropBranchStreets,
  resolveNightDropBranchStreetPose,
  type NightDropBranchStreet,
} from "./night-drop-junction-kit.js";
import { NightDropRunnerEffects } from "./night-drop-runner-effects.js";
import type { NightDropRunnerFeedbackCue } from "./night-drop-runner-feedback.js";
import { createNightDropStreetModule } from "./night-drop-street-kit.js";
import { createNightDropPbrMaterial } from "./night-drop-pbr-materials.js";
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
  readonly cue: ResolvedSpatialRouteCue;
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
  private readonly occluderPosition = new THREE.Vector3();
  private readonly occluderOffset = new THREE.Vector3();
  private readonly route: ComposedSpatialRoute;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly branchStreets: readonly NightDropBranchStreet[];
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
  private readonly cityLife: NightDropCityLife;
  private readonly packages: readonly WorldPackage[];
  private readonly obstacles: readonly WorldObstacle[];
  private readonly gate = createContinuationGate();
  private readonly shortcut = createShortcutTunnel();
  private readonly checkpoint = createCheckpoint();
  private readonly penthouse = createPenthouse();
  private readonly rain: THREE.Points;
  private readonly sky = createNightDropSky();
  private readonly runnerKeyLight: THREE.PointLight;
  private readonly runnerWarmLight: THREE.PointLight;
  private readonly environmentTexture: THREE.Texture;
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
  private visualSpeedMps = 0;
  private previousProgress = 0;
  private previousRunnerAction: NightDropDashMotionFrame["action"] = "idle";
  private landingAtMs = Number.NEGATIVE_INFINITY;
  private lastFootstepCueAt = Number.NEGATIVE_INFINITY;
  private cameraShoulderOffset = 0;
  private cameraRoll = 0;
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
    this.branchStreets = createNightDropBranchStreets(this.path, this.route);
    const deviceMemoryGb = (navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory;
    this.renderLod = selectNightDropRunnerLod({
      viewportWidth: Math.max(1, this.stage.clientWidth || window.innerWidth),
      pixelRatio: window.devicePixelRatio || 1,
      compact: window.matchMedia("(max-width: 540px), (max-height: 700px)").matches,
      ...(deviceMemoryGb ? { deviceMemoryGb } : {}),
    });
    this.rain = createRain(this.renderLod);
    this.runnerKeyLight = new THREE.PointLight(0xa9efff, this.renderLod === "low" ? 10 : 13, 28, 2);
    this.runnerWarmLight = new THREE.PointLight(0xffb45f, this.renderLod === "low" ? 6 : 8, 24, 2);
    this.effects = new NightDropRunnerEffects(this.renderLod);
    this.onPresentationCue = options.onPresentationCue;
    this.runnerController = new SpatialRunnerController(this.route);
    this.junctions = createJunctionGeometry(this.path, this.route, this.branchStreets);
    this.city = createCity(this.path, this.route, this.renderLod, this.branchStreets);
    this.cityLife = new NightDropCityLife(this.path, this.route, this.renderLod);
    this.branchButtons = [...this.stage.querySelectorAll<HTMLButtonElement>("[data-branch]")];
    this.junctionPrompt = this.stage.querySelector<HTMLElement>("[data-junction-prompt]");
    this.junctionWarning = this.stage.querySelector<HTMLElement>("[data-junction-warning]");
    this.obstacleWarning = this.stage.querySelector<HTMLElement>("[data-obstacle-warning]");
    this.obstacleResult = this.stage.querySelector<HTMLElement>("[data-obstacle-result]");
    this.continuationProgress = requireCue(this.route, "continuation").progress;
    this.shortcutProgress = requireCue(this.route, "shortcut").progress;
    this.checkpointProgress = requireCue(this.route, "checkpoint").progress;
    this.destinationProgress = requireCue(this.route, "destination").progress;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.renderLod !== "low",
      alpha: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.58;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.environmentTexture = pmrem.fromScene(environment, .04).texture;
    environment.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
    });
    pmrem.dispose();
    this.scene.environment = this.environmentTexture;
    this.scene.environmentIntensity = .4;
    this.scene.background = new THREE.Color(0x030711);
    this.scene.fog = new THREE.FogExp2(0x07121d, .0048);
    this.stage.dataset.renderer = "three";
    this.stage.dataset.routeId = plan.routeId;
    this.stage.dataset.routeLength = String(Math.round(this.route.totalLength));
    this.stage.dataset.renderLod = this.renderLod;

    this.packages = this.route.cues.filter(({ kind }) => kind === "standard-pickup" || kind === "premium-pickup").map((cue) => ({
      root: createPackage(cue.progress, cue.laneOffset, cue.kind === "premium-pickup", this.path),
      cue,
      collectedAtMs: timeAtProgress(cue.progress, this.timeline),
    }));
    this.obstacles = this.route.obstacles.map((obstacle) => ({ root: createObstacle(obstacle), obstacle }));

    this.buildScene();
    this.assetReadiness = Promise.all([
      this.configureProductionAssets(options),
      this.checkpoint.clamp.ready,
    ]).then(() => undefined);
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
    this.resetMotionState();
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
    this.resetMotionState();
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
    this.checkpoint.clamp.dispose();
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
    this.environmentTexture.dispose();
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
    this.stage.dataset.cityKitMode = options.productionAssets ? "loading" : "fallback";
    this.stage.dataset.cityKitBuildings = "0";
    this.stage.dataset.environmentAssetSegments = "0";
    this.stage.dataset.environmentAssetMissingRoles = "0";
    if (!options.productionAssets) return;
    const loader = new NightDropRunnerProductionLoader();
    const cityKitStartedAt = performance.now();
    const [status, cityKit] = await Promise.all([
      this.dashActor.loadProduction(loader, manifest.character),
      installNightDropCityKit(this.city),
      options.productionEnvironmentAssets
        ? this.loadProductionEnvironment(loader, manifest)
        : Promise.resolve(),
    ]);
    if (this.disposed) return;
    this.stage.dataset.dashAssetMode = status.mode;
    this.stage.dataset.dashAssetFallback = String(Boolean(status.fallbackReason));
    this.stage.dataset.dashAnimationCount = String(status.availableAnimationRoles.length);
    this.stage.dataset.cityKitMode = cityKit.mode;
    this.stage.dataset.cityKitBuildings = String(cityKit.installedBuildings);
    this.stage.dataset.cityKitTemplates = String(cityKit.loadedTemplates);
    this.stage.dataset.cityKitFallback = String(Boolean(cityKit.reason));
    this.stage.dataset.cityKitLoadMs = String(Math.round(performance.now() - cityKitStartedAt));
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
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight(0x8fbfce, 0x120f16, 1.75));
    const key = new THREE.DirectionalLight(0xb7dfeb, 2.85);
    key.position.set(-12, 26, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -.00035;
    this.scene.add(key);

    const magentaFill = new THREE.PointLight(0xff2aaf, 3.2, 38, 2);
    magentaFill.position.set(14, 8, -48);
    this.scene.add(magentaFill);
    const cyanFill = new THREE.PointLight(0x28eaff, 3.1, 38, 2);
    cyanFill.position.set(-8, 5, -92);
    this.scene.add(cyanFill);
    this.scene.add(this.runnerKeyLight, this.runnerWarmLight);

    const road = createRoad(this.path, this.route);
    freezeStaticTransforms(road);
    freezeStaticTransforms(this.city);
    freezeStaticTransforms(this.junctions);
    this.scene.add(road);
    this.scene.add(this.city);
    this.scene.add(this.cityLife.root);
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
    const material = new THREE.MeshBasicMaterial({
      color: 0x00d9f5,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x20e8ff,
      transparent: true,
      opacity: .42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const markerCount = Math.min(110, Math.max(36, Math.round(this.route.totalLength / 5.2)));
    for (let index = 1; index < markerCount; index += 1) {
      const progress = index / markerCount;
      const markerCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.08, .09, -1.36),
        new THREE.Vector3(0, .075, 0),
        new THREE.Vector3(1.08, .09, -1.36),
      ]);
      const marker = new THREE.Group();
      marker.name = "route-navigation-chevron";
      marker.add(new THREE.Mesh(new THREE.TubeGeometry(markerCurve, 10, .16, 7, false), material));
      const halo = new THREE.Mesh(new THREE.CircleGeometry(.72, 20), haloMaterial);
      halo.name = "route-navigation-halo";
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(0, .055, -.58);
      halo.scale.set(1.9, .82, 1);
      marker.add(halo);
      marker.userData.progress = progress;
      placeOnSelectedStreet(marker, this.path, this.branchStreets, this.route, {}, progress, 0, 0);
      this.routeMarkers.add(marker);
    }
  }

  private resetMotionState(): void {
    this.visualSpeedMps = 0;
    this.previousProgress = 0;
    this.previousRunnerAction = "idle";
    this.landingAtMs = Number.NEGATIVE_INFINITY;
    this.lastFootstepCueAt = Number.NEGATIVE_INFINITY;
    this.cameraShoulderOffset = 0;
    this.cameraRoll = 0;
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
    this.cityLife.update(elapsedMs, progress, Boolean(branchDisplacement.activeBranchId));
    const cityLifeStatus = this.cityLife.inspect();
    this.stage.dataset.cityLifeActors = String(cityLifeStatus.actors);
    this.stage.dataset.cityLifeVisible = String(cityLifeStatus.visibleActors);
    this.stage.dataset.citySteamColumns = String(cityLifeStatus.steamColumns);
    const branchStreetPose = resolveNightDropBranchStreetPose(this.branchStreets, this.route, runnerState.branchSelections, progress);
    const centrePoint = branchStreetPose?.point ?? this.path.getPointAt(progress);
    const tangent = branchStreetPose?.tangent ?? this.path.getTangentAt(progress).normalize();
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
    const travelTangent = tangent.clone().normalize();
    const travelSide = new THREE.Vector3(-travelTangent.z, 0, travelTangent.x).normalize();
    const instantSpeedMps = !snapCamera && frameDeltaMs > 0
      ? Math.min(22, Math.abs(progress - this.previousProgress) * this.route.totalLength / (frameDeltaMs / 1_000) * .46)
      : moving ? 15 : 0;
    const speedResponse = 1 - Math.exp(-frameDeltaMs / (instantSpeedMps > this.visualSpeedMps ? 180 : 310));
    this.visualSpeedMps += ((moving ? instantSpeedMps : 0) - this.visualSpeedMps) * (snapCamera ? 1 : speedResponse);
    this.previousProgress = progress;
    if (this.previousRunnerAction === "jumping" && runnerState.action !== "jumping") this.landingAtMs = elapsedMs;
    this.previousRunnerAction = runnerState.action;
    const landingAge = elapsedMs - this.landingAtMs;
    const landingStrength = landingAge >= 0 && landingAge <= 420
      ? Math.exp(-landingAge / 145) * Math.max(0, Math.sin(landingAge * .034))
      : 0;
    const speedEnergy = moving ? Math.max(0, Math.min(1, this.visualSpeedMps / 20)) : 0;
    const footstepIntervalMs = 345 - speedEnergy * 105;
    const footstepReady = elapsedMs - this.lastFootstepCueAt >= footstepIntervalMs;
    if (!snapCamera && moving && footstepReady && !["jumping", "sliding"].includes(runnerState.action)) {
      this.lastFootstepCueAt = elapsedMs;
      this.onPresentationCue?.("footstep");
    }
    const cameraLookAheadDistance = 7.5 + speedEnergy * 3.6;
    const aheadProgress = Math.min(.999, progress + cameraLookAheadDistance / this.route.totalLength);
    const aheadStreetPose = resolveNightDropBranchStreetPose(this.branchStreets, this.route, runnerState.branchSelections, aheadProgress);
    const aheadTangent = aheadStreetPose?.tangent ?? this.path.getTangentAt(aheadProgress).normalize();
    const turnStrength = Math.max(-1, Math.min(1, travelTangent.x * aheadTangent.z - travelTangent.z * aheadTangent.x));
    const point = centrePoint.clone()
      .addScaledVector(travelSide, this.visualLaneOffset);
    point.y += branchDisplacement.elevationOffset + jumpHeight;
    const runningBlend = moving ? smoothstep((elapsedMs - phaseAt(this.timeline, "start-running")) / 920) : 0;
    const stridePhase = elapsedMs * (.012 + speedEnergy * .0075);
    const stride = moving ? Math.sin(stridePhase) * runningBlend : 0;
    const bob = moving
      ? (Math.abs(Math.sin(stridePhase * 2)) * .055 + Math.pow(Math.max(0, Math.cos(stridePhase * 2)), 8) * .024) * runningBlend
      : Math.sin(elapsedMs * .0024) * .012;
    const latestInteraction = runnerState.obstacleInteractions.at(-1);
    const interactionAge = latestInteraction ? elapsedMs - latestInteraction.atMs : Number.POSITIVE_INFINITY;
    const interactionStrength = interactionAge >= 0 && interactionAge <= 620 ? 1 - interactionAge / 620 : 0;
    const hitStrength = latestInteraction?.result === "hit" ? interactionStrength : 0;
    const clearStrength = latestInteraction?.result === "cleared" ? interactionStrength : 0;
    const shortcutStart = phaseAt(this.timeline, "shortcut");
    const clampStart = phaseAt(this.timeline, "clamp");
    const escapeStart = phaseAt(this.timeline, "escape");
    const penthouseRevealStart = phaseAt(this.timeline, "penthouse-reveal");
    const winStart = phaseAt(this.timeline, "win");
    const shortcutStrength = presentationEnvelope(elapsedMs, shortcutStart - 300, clampStart - 120, 340);
    const dangerStrength = presentationEnvelope(elapsedMs, clampStart - 260, escapeStart + 260, 260);
    const arrivalFraming = smoothstep((elapsedMs - penthouseRevealStart + 120) / 820);
    const celebrationStrength = smoothstep((elapsedMs - winStart + 520) / 520);

    this.runner.position.copy(point).add(new THREE.Vector3(0, bob - landingStrength * .055, 0));
    this.runner.lookAt(point.clone().add(travelTangent).add(new THREE.Vector3(0, bob, 0)));
    const dodgeLean = runnerState.action === "dodging-left" ? -.22 : runnerState.action === "dodging-right" ? .22 : 0;
    const turnLean = -turnStrength * (.075 + junctionAnticipation * .085) * runningBlend;
    this.runner.rotateZ(turnLean + dodgeLean * .22);
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
      speedEnergy,
      turnLean,
      landingStrength,
    });
    this.effects.update({
      position: this.runner.position,
      tangent: travelTangent,
      elapsedMs,
      moving,
      runningBlend,
      clearStrength,
      hitStrength,
      shortcutStrength,
      dangerStrength,
      celebrationStrength,
      compact: this.compactRenderMode,
    });
    const runnerScale = this.compactRenderMode ? 1.2 : 1.1;
    this.runner.scale.set(
      runnerScale + clearStrength * .045,
      runnerState.action === "sliding" ? .68 : runnerScale - hitStrength * .1,
      runnerScale + hitStrength * .06,
    );

    const baseCameraDistance = this.compactRenderMode ? 6.8 : 7.55;
    const baseCameraHeight = this.compactRenderMode ? 3.68 : 3.96;
    const cameraDistance = (moving ? baseCameraDistance - speedEnergy * .82 : baseCameraDistance) + junctionAnticipation * 1.2 + obstacleAnticipation * .45 + arrivalFraming * 6.4;
    const cameraHeight = (moving ? baseCameraHeight - speedEnergy * .4 : baseCameraHeight) + junctionAnticipation * .54 + obstacleAnticipation * .18 + arrivalFraming * 2.15;
    const shoulderTarget = turnStrength * (1.1 + junctionAnticipation * .75) + arrivalFraming * 2.2;
    this.cameraShoulderOffset += (shoulderTarget - this.cameraShoulderOffset) * (snapCamera ? 1 : 1 - Math.exp(-frameDeltaMs / 155));
    const desiredCamera = point.clone()
      .addScaledVector(travelTangent, -cameraDistance)
      .addScaledVector(travelSide, this.cameraShoulderOffset)
      .add(new THREE.Vector3(0, cameraHeight + bob * .28 - landingStrength * .11, 0));
    if (hitStrength > 0) {
      desiredCamera.addScaledVector(travelSide, Math.sin(elapsedMs * .095) * .24 * hitStrength);
      desiredCamera.y += Math.sin(elapsedMs * .12) * .12 * hitStrength;
    }
    const cameraResponse = 1 - Math.exp(-frameDeltaMs / (moving ? 96 + (1 - speedEnergy) * 42 : 150));
    if (snapCamera) this.camera.position.copy(desiredCamera);
    else this.camera.position.lerp(desiredCamera, cameraResponse);
    const cameraDrifted = this.camera.position.distanceTo(point) > cameraDistance + 3.2;
    if (cameraDrifted) this.camera.position.copy(desiredCamera);
    const lookAtDistance = 5.2 + speedEnergy * 2.2 + junctionAnticipation * 3.4;
    const lookAt = point.clone().addScaledVector(travelTangent, lookAtDistance).add(new THREE.Vector3(0, 1.28 + arrivalFraming * 1.45, 0));
    if (snapCamera || cameraDrifted) this.cameraTarget.copy(lookAt);
    else this.cameraTarget.lerp(lookAt, 1 - Math.exp(-frameDeltaMs / 92));
    this.camera.lookAt(this.cameraTarget);
    const cameraRollTarget = moving
      ? -turnStrength * (.018 + junctionAnticipation * .024) - dodgeLean * .055 + Math.sin(stridePhase * 2) * .0025 * speedEnergy
      : 0;
    this.cameraRoll += (cameraRollTarget - this.cameraRoll) * (snapCamera ? 1 : 1 - Math.exp(-frameDeltaMs / 120));
    if (!snapCamera) this.camera.rotateZ(this.cameraRoll + Math.sin(elapsedMs * .12) * .006 * landingStrength);

    this.routeMarkers.visible = elapsedMs < phaseAt(this.timeline, "arrival");
    this.routeMarkers.children.forEach((marker) => {
      const markerProgress = marker.userData.progress as number;
      placeOnSelectedStreet(marker, this.path, this.branchStreets, this.route, runnerState.branchSelections, markerProgress, 0, 0);
      const markerDistance = (markerProgress - progress) * this.route.totalLength;
      marker.visible = markerDistance > 2 && markerDistance < (this.compactRenderMode ? 94 : 126);
      const routePulse = 1 + Math.sin(elapsedMs * .007 - markerProgress * 34) * .15;
      marker.scale.setScalar(routePulse);
    });
    this.packages.forEach(({ root, cue, collectedAtMs }) => {
      const difference = collectedAtMs - elapsedMs;
      placeOnSelectedStreet(root, this.path, this.branchStreets, this.route, runnerState.branchSelections, cue.progress, cue.laneOffset * 2.8, 0);
      root.visible = !decision && difference > -360;
      const pickup = difference < 0 ? 1 + Math.min(1.8, Math.abs(difference) / 150) : 1 + Math.sin(elapsedMs * .009) * .08;
      root.scale.setScalar(pickup);
      root.rotation.y = elapsedMs * .0012;
    });
    this.obstacles.forEach(({ root, obstacle }) => {
      placeObstacleAt(root, this.path, this.branchStreets, this.route, obstacle, runnerState.branchSelections);
      const obstacleDelta = obstacle.distance - travelledDistance;
      root.visible = !decision && !resolvedObstacleIds.has(obstacle.id) && obstacleDelta > -2 && obstacleDelta < (this.compactRenderMode ? 96 : 138);
      const pulse = obstacle.id === nextObstacle?.id ? 1 + obstacleAnticipation * .075 + Math.sin(elapsedMs * .012) * .025 : 1;
      root.scale.setScalar(pulse);
    });

    placeOnSelectedStreet(this.gate, this.path, this.branchStreets, this.route, runnerState.branchSelections, this.continuationProgress, 0, 0);
    placeOnSelectedStreet(this.shortcut, this.path, this.branchStreets, this.route, runnerState.branchSelections, this.shortcutProgress, 0, 0);
    placeOnSelectedStreet(this.checkpoint.root, this.path, this.branchStreets, this.route, runnerState.branchSelections, this.checkpointProgress, 0, 0);
    placeOnSelectedStreet(this.penthouse, this.path, this.branchStreets, this.route, runnerState.branchSelections, Math.min(.995, this.destinationProgress + .015), 0, 0);
    this.gate.visible = !decision;
    this.shortcut.visible = !decision;
    this.checkpoint.root.visible = !decision;
    this.penthouse.visible = !decision;

    const gateOpen = smoothstep((elapsedMs - phaseAt(this.timeline, "continuation-open") + 500) / 950);
    const gateLeft = this.gate.getObjectByName("gate-left");
    const gateRight = this.gate.getObjectByName("gate-right");
    if (gateLeft) gateLeft.position.x = -1.55 - gateOpen * 1.65;
    if (gateRight) gateRight.position.x = 1.55 + gateOpen * 1.65;

    const clampActive = elapsedMs >= clampStart - 250 && elapsedMs <= escapeStart + 200;
    this.checkpoint.redLight.intensity = clampActive ? 35 : 8;
    const clampEscaped = elapsedMs > escapeStart + 120;
    this.checkpoint.clamp.root.position.x = elapsedMs > escapeStart - 100 ? 2.05 + smoothstep((elapsedMs - escapeStart + 100) / 500) * 3.8 : 2.05;
    this.checkpoint.clamp.update(elapsedMs, clampActive, clampEscaped);

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
    this.sky.position.set(point.x, point.y, point.z);
    this.runnerKeyLight.position.copy(point).addScaledVector(travelTangent, -3.2);
    this.runnerKeyLight.position.y += 5.4;
    this.runnerWarmLight.position.copy(point)
      .addScaledVector(travelTangent, 5.5)
      .addScaledVector(travelSide, 5.8);
    this.runnerWarmLight.position.y += 3.4;

    const routeWindow = resolveSpatialRouteWindow(this.route, progress, this.compactRenderMode
      ? { distanceBehind: 24, distanceAhead: 92 }
      : { distanceBehind: 42, distanceAhead: 128 });
    const activeSegments = new Set(routeWindow.activeSegmentIds);
    this.city.children.forEach((object) => {
      const branchId = typeof object.userData.branchStreet === "string" ? object.userData.branchStreet : null;
      const branch = branchId ? this.route.branches.find(({ id }) => id === branchId) : null;
      const selectedAlternativeId = branch ? runnerState.branchSelections[branch.id] ?? branch.defaultAlternativeId : null;
      const selectedBranchCity = !branch || object.userData.branchAlternative === selectedAlternativeId;
      object.visible = activeSegments.has(String(object.userData.segmentId ?? ""))
        && object.userData.productionReplaced !== true
        && selectedBranchCity;
    });
    const cameraSafeRadius = this.compactRenderMode ? 10.5 : 12.5;
    const cameraRunnerX = point.x - this.camera.position.x;
    const cameraRunnerZ = point.z - this.camera.position.z;
    const cameraRunnerLengthSquared = cameraRunnerX * cameraRunnerX + cameraRunnerZ * cameraRunnerZ;
    this.city.traverse((object) => {
      if (object.userData.cameraOccluder !== true) return;
      object.getWorldPosition(this.occluderPosition);
      const streamedVisible = object.parent === this.city ? object.visible : object.parent?.visible !== false;
      const objectRadius = Number(object.userData.cameraClearanceRadius ?? 0);
      const objectFromCameraX = this.occluderPosition.x - this.camera.position.x;
      const objectFromCameraZ = this.occluderPosition.z - this.camera.position.z;
      const projection = cameraRunnerLengthSquared > 0
        ? (objectFromCameraX * cameraRunnerX + objectFromCameraZ * cameraRunnerZ) / cameraRunnerLengthSquared
        : 0;
      const closestX = this.camera.position.x + cameraRunnerX * THREE.MathUtils.clamp(projection, 0, 1);
      const closestZ = this.camera.position.z + cameraRunnerZ * THREE.MathUtils.clamp(projection, 0, 1);
      const lineClearance = objectRadius + (this.compactRenderMode ? 2.2 : 2.8);
      const blocksRunner = projection > 0 && projection < 1
        && Math.hypot(this.occluderPosition.x - closestX, this.occluderPosition.z - closestZ) < lineClearance;
      object.visible = streamedVisible
        && this.occluderPosition.distanceTo(this.camera.position) > cameraSafeRadius + objectRadius
        && !blocksRunner;
    });
    this.junctions.children.forEach((object) => {
      const segmentId = String(object.userData.segmentId ?? "");
      object.visible = activeSegments.has(segmentId)
        || object.userData.junctionId === decision?.id;
    });
    let visibleAmbientTraffic = 0;
    this.junctions.traverse((object) => {
      if (object.userData.dynamicPresentation !== "ambient-traffic") return;
      const origin = object.userData.trafficOrigin as readonly [number, number, number];
      const direction = object.userData.trafficDirection as readonly [number, number, number];
      const phase = Number(object.userData.trafficPhase ?? 0);
      const travel = ((elapsedMs * .0038 + phase) % 56 + 56) % 56 - 28;
      object.position.fromArray(origin).addScaledVector(this.occluderOffset.fromArray(direction), travel);
      object.visible = !decision && (Math.abs(travel) > 7.5 || junctionDistance > 30);
      object.updateMatrix();
      if (object.visible && object.parent?.visible !== false) visibleAmbientTraffic += 1;
    });
    this.stage.dataset.activeSegments = routeWindow.activeSegmentIds.join(",");
    this.stage.dataset.lane = String(runnerState.lane);
    this.stage.dataset.visualLaneOffset = this.visualLaneOffset.toFixed(3);
    this.stage.dataset.runningBlend = runningBlend.toFixed(3);
    this.stage.dataset.runnerSpeedMps = this.visualSpeedMps.toFixed(2);
    this.stage.dataset.runnerSpeedEnergy = speedEnergy.toFixed(3);
    this.stage.dataset.turnLean = turnLean.toFixed(4);
    this.stage.dataset.landingStrength = landingStrength.toFixed(3);
    this.stage.dataset.cameraRoll = this.cameraRoll.toFixed(4);
    this.stage.dataset.shortcutStrength = shortcutStrength.toFixed(3);
    this.stage.dataset.dangerStrength = dangerStrength.toFixed(3);
    this.stage.dataset.celebrationStrength = celebrationStrength.toFixed(3);
    this.stage.dataset.cameraRunnerDistance = this.camera.position.distanceTo(point).toFixed(3);
    this.stage.dataset.cameraDriftCorrected = String(cameraDrifted);
    this.stage.dataset.runnerAction = runnerState.action;
    this.stage.dataset.activeBranch = branchDisplacement.activeBranchId ?? "";
    this.stage.dataset.branchAlternative = branchDisplacement.alternativeId ?? "";
    this.stage.dataset.ambientTrafficVisible = String(visibleAmbientTraffic);
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
    this.junctions.traverse((object) => {
      if (object.userData.junctionDirectionSign !== true) return;
      object.getWorldPosition(this.occluderPosition);
      const forwardDistance = this.occluderOffset
        .copy(this.occluderPosition)
        .sub(this.camera.position)
        .dot(travelTangent);
      object.visible = Boolean(
        decision
        && object.userData.branchId === decision.id
        && forwardDistance > 5
        && forwardDistance < 36,
      );
    });

    const currentSegmentId = segmentAtProgress(this.route, progress);
    const currentSegmentKind = this.route.segments.find(({ id }) => id === currentSegmentId)?.kind;
    const baseFov = 55 + speedEnergy * 5.5;
    const targetFov = (decision ? 68 : junctionAnticipation > 0 ? baseFov + junctionAnticipation * 8 : shortcutActive ? 66 : clampActive ? 61 : arrivalFraming > 0 ? 58 : baseFov)
      + obstacleAnticipation * 3 + clearStrength * 2 - hitStrength * 1.5
      + (currentSegmentKind === "alley" ? 7 : 0);
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
    const pixelRatioCap = width <= 480 ? 1.15 : width <= 900 ? 1.35 : 1.7;
    const dynamicShadows = width > 700
      && window.innerWidth > 1_400
      && (window.devicePixelRatio || 1) <= 1.25;
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
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line) || !object.userData.branchId) return;
      const material = object.material;
      if (!(
        material instanceof THREE.MeshBasicMaterial
        || material instanceof THREE.MeshStandardMaterial
        || material instanceof THREE.LineBasicMaterial
        || material instanceof THREE.LineDashedMaterial
      )) return;
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

function createRoad(path: THREE.CatmullRomCurve3, route: ComposedSpatialRoute): THREE.Group {
  const group = new THREE.Group();
  const road = createVariableWidthRibbon(path, route, 0, .02, createNightDropPbrMaterial("nd.material.wet-asphalt", {
    repeat: [2, Math.max(8, route.totalLength / 8)],
    color: 0xb9c8d1,
    roughness: .42,
    metalness: .34,
    emissive: 0x071821,
    emissiveIntensity: .18,
    normalScale: 1.22,
  }));
  road.name = "wet-asphalt-route";
  road.receiveShadow = true;
  group.add(road);
  const shoulder = createVariableWidthRibbon(path, route, 1.6, -.02, createNightDropPbrMaterial("nd.material.city-concrete", {
    repeat: [2, Math.max(6, route.totalLength / 12)],
    color: 0x687277,
    roughness: .78,
    metalness: .06,
    normalScale: .75,
  }));
  shoulder.name = "route-concrete-shoulder";
  group.add(shoulder);

  const leftPoints: THREE.Vector3[] = [];
  const rightPoints: THREE.Vector3[] = [];
  for (let index = 0; index <= 120; index += 1) {
    const progress = index / 120;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const edge = routeWidthAtProgress(route, progress) + .02;
    const left = point.clone().addScaledVector(side, -edge);
    const right = point.clone().addScaledVector(side, edge);
    left.y += .065;
    right.y += .065;
    leftPoints.push(left);
    rightPoints.push(right);
  }
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xa6b7bd, transparent: true, opacity: .58 });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPoints), edgeMaterial));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPoints), edgeMaterial));
  const centrePoints = Array.from({ length: 161 }, (_, index) => {
    const point = path.getPointAt(index / 160);
    point.y += .085;
    return point;
  });
  const centreLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(centrePoints),
    new THREE.LineDashedMaterial({ color: 0xe8e2c9, transparent: true, opacity: .18, dashSize: 2.6, gapSize: 3.8 }),
  );
  centreLine.computeLineDistances();
  group.add(centreLine);
  return group;
}

function createVariableWidthRibbon(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  additionalWidth: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const segments = 180;
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const halfWidth = routeWidthAtProgress(route, progress) + additionalWidth;
    const left = point.clone().addScaledVector(side, -halfWidth);
    const right = point.clone().addScaledVector(side, halfWidth);
    left.y += y;
    right.y += y;
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, progress, 1, progress);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function routeWidthAtProgress(route: ComposedSpatialRoute, progress: number): number {
  const distance = Math.max(0, Math.min(route.totalLength, progress * route.totalLength));
  return route.segments.find((segment) => distance >= segment.startDistance && distance <= segment.endDistance)?.width
    ?? route.segments.at(-1)?.width
    ?? 4.8;
}

function createRibbon(path: THREE.Curve<THREE.Vector3>, halfWidth: number, y: number, material: THREE.Material): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
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
    uvs.push(0, progress, 1, progress);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function createCity(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  lod: NightDropRunnerLod,
  branchStreets: readonly NightDropBranchStreet[],
): THREE.Group {
  const city = new THREE.Group();
  const branchClearancePoints = sampleStreetPaths(branchStreets.filter(({ direction }) => direction !== "straight"), 32);
  const buildingCount = Math.min(60, Math.max(32, Math.round(route.totalLength / 17)));
  for (let index = 0; index < buildingCount; index += 1) {
    const progress = .025 + (index / Math.max(1, buildingCount - 1)) * .95;
    const insideJunctionClearance = route.branches.some((junction) => Math.abs(progress - junction.entryProgress) * route.totalLength < 24);
    if (insideJunctionClearance) continue;
    const segmentId = segmentAtProgress(route, progress);
    const segmentKind = route.segments.find(({ id }) => id === segmentId)?.kind;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    ([-1, 1] as const).forEach((side, sideIndex) => {
      const width = 4.5 + seeded(index * 11 + sideIndex) * 3;
      const depth = 4 + seeded(index * 19 + sideIndex) * 3.2;
      const height = 7.8 + seeded(index * 29 + sideIndex) * 14.2;
      const district = resolveNightDropDistrict(progress, segmentKind);
      const accent = district.primaryAccent;
      const label = (index + sideIndex) % 4 === 0
        ? CITY_LABELS[(index + sideIndex) % CITY_LABELS.length]
        : undefined;
      const facadeEdge = segmentKind === "alley" ? 6.3 : 8.45;
      const buildingPosition = point.clone().addScaledVector(sideVector, side * (facadeEdge + depth / 2));
      if (isNearStreetNetwork(buildingPosition, branchClearancePoints, depth / 2 + 7.4)) return;
      const building = lod === "low"
        ? createJunctionBuilding(width, height, depth, accent, false, index * 2 + sideIndex)
        : createNightDropBuilding({
            index,
            sideIndex,
            width,
            depth,
            height,
            accent,
            district: district.id,
            ...(label ? { label } : {}),
          });
      building.position.copy(buildingPosition);
      building.position.y = point.y;
      building.lookAt(point.clone().setY(point.y));
      building.userData.segmentId = segmentId;
      city.add(building);
    });

    if (index % 3 === 0) {
      ([-1, 1] as const).forEach((side) => {
        const lamp = createStreetLamp(index % 4 === 0 ? accentFor(progress) : 0xffd2a1);
        const lampOffset = segmentKind === "alley"
          ? (route.segments.find(({ id }) => id === segmentId)?.width ?? 3.4) + 1.15
          : 6.65;
        lamp.position.copy(point).addScaledVector(sideVector, side * lampOffset);
        lamp.lookAt(point.clone().add(tangent));
        lamp.userData.segmentId = segmentId;
        city.add(lamp);
      });
    }
  }
  addBranchStreetBuildings(city, path, route, branchStreets, lod);
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

function addBranchStreetBuildings(
  city: THREE.Group,
  mainPath: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  branchStreets: readonly NightDropBranchStreet[],
  lod: NightDropRunnerLod,
): void {
  const mainClearancePoints = Array.from({ length: 121 }, (_, index) => mainPath.getPointAt(index / 120));
  const buildingSamples = lod === "low"
    ? [.34, .66]
    : lod === "medium"
      ? [.18, .42, .62, .84]
      : [.12, .28, .44, .6, .76, .9];
  branchStreets.filter(({ direction }) => direction !== "straight").forEach((street, streetIndex) => {
    const competingStreetClearancePoints = [
      ...mainClearancePoints,
      ...sampleStreetPaths(branchStreets.filter((candidate) => (
        candidate.direction !== "straight"
        && !(candidate.branchId === street.branchId && candidate.alternativeId === street.alternativeId)
      )), 40),
    ];
    buildingSamples.forEach((localProgress, sampleIndex) => {
      const point = street.path.getPointAt(localProgress);
      const tangent = street.path.getTangentAt(localProgress).normalize();
      const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const globalProgress = street.entryProgress + (street.rejoinProgress - street.entryProgress) * localProgress;
      const segmentId = segmentAtProgress(route, globalProgress);
      const segmentKind = route.segments.find(({ id }) => id === segmentId)?.kind;
      const district = resolveNightDropDistrict(globalProgress, segmentKind);
      ([-1, 1] as const).forEach((side, sideIndex) => {
        const seed = 600 + streetIndex * 31 + sampleIndex * 7 + sideIndex;
        const width = 4.6 + seeded(seed * 11) * 2.3;
        const depth = 4.2 + seeded(seed * 17) * 2.2;
        const height = 7.8 + seeded(seed * 23) * 9.5;
        const facadeEdge = segmentKind === "alley" ? 6 : 8.15;
        const position = point.clone().addScaledVector(sideVector, side * (facadeEdge + depth / 2));
        if (isNearStreetNetwork(position, competingStreetClearancePoints, depth / 2 + 7.2)) return;
        const building = lod === "low"
          ? createJunctionBuilding(width, height, depth, district.primaryAccent, false)
          : createNightDropBuilding({
              index: seed,
              sideIndex,
              width,
              depth,
              height,
              accent: district.primaryAccent,
              district: district.id,
              ...((seed + sideIndex) % 5 === 0 ? { label: CITY_LABELS[seed % CITY_LABELS.length]! } : {}),
            });
        building.position.copy(position);
        building.position.y = point.y;
        building.lookAt(point.clone().setY(point.y));
        building.userData.segmentId = segmentId;
        building.userData.branchStreet = street.branchId;
        building.userData.branchAlternative = street.alternativeId;
        city.add(building);
      });
    });
  });
}

function sampleStreetPaths(streets: readonly NightDropBranchStreet[], count: number): readonly THREE.Vector3[] {
  return streets.flatMap(({ path }) => Array.from({ length: count + 1 }, (_, index) => path.getPointAt(index / count)));
}

function isNearStreetNetwork(position: THREE.Vector3, samples: readonly THREE.Vector3[], clearance: number): boolean {
  const clearanceSquared = clearance * clearance;
  return samples.some((sample) => {
    const x = position.x - sample.x;
    const z = position.z - sample.z;
    return x * x + z * z < clearanceSquared;
  });
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
    root.add(
      createAlleyFacadeStrip(path, route, segment, -1, segmentIndex),
      createAlleyFacadeStrip(path, route, segment, 1, segmentIndex + 1),
    );
    ([-1, 1] as const).forEach((side, sideIndex) => {
      [.14, .4, .66, .9].forEach((offset, buildingIndex) => {
        const progress = progressAt(offset);
        const point = path.getPointAt(progress);
        const tangent = path.getTangentAt(progress).normalize();
        const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const depth = 4.6;
        const building = createNightDropBuilding({
          index: 900 + segmentIndex * 17 + buildingIndex * 3,
          sideIndex,
          width: 5.2,
          depth,
          height: 8.2 + seeded(segmentIndex * 29 + buildingIndex * 7 + sideIndex) * 3.6,
          accent: side < 0 ? 0x20d9e8 : 0xff3ec8,
          district: "service-quarter",
          ...(buildingIndex === 1 ? { label: side < 0 ? "SERVICE" : "OPEN LATE" } : {}),
        });
        building.position.copy(point).addScaledVector(sideVector, side * (6 + depth / 2));
        building.position.y = point.y;
        building.lookAt(point.clone().setY(point.y));
        root.add(building);
      });
    });
    const entrance = new THREE.Group();
    const entranceWidth = segment.width * 2 + 1.6;
    const leftPost = new THREE.Mesh(new THREE.BoxGeometry(.18, 3.7, .22), serviceMaterial);
    leftPost.position.set(-entranceWidth / 2, 1.85, 0);
    const rightPost = leftPost.clone();
    rightPost.position.x = entranceWidth / 2;
    const header = new THREE.Mesh(new THREE.BoxGeometry(entranceWidth, .18, .22), serviceMaterial);
    header.position.y = 3.68;
    const alleySign = createNeonSign("SERVICE ALLEY", 0x4dd6c5);
    alleySign.position.set(0, 4.18, .08);
    alleySign.scale.setScalar(.56);
    entrance.add(leftPost, rightPost, header, alleySign);
    placeFrame(entrance, .06);
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

function createAlleyFacadeStrip(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  segment: ComposedSpatialRouteSegment,
  side: -1 | 1,
  seed: number,
): THREE.Group {
  const root = new THREE.Group();
  const vertices: number[] = [];
  const indices: number[] = [];
  const facadePoints: THREE.Vector3[] = [];
  const facadeOffset = segment.width + 2.2;
  const sampleCount = 20;
  for (let index = 0; index <= sampleCount; index += 1) {
    const segmentProgress = index / sampleCount;
    const progress = (segment.startDistance + (segment.endDistance - segment.startDistance) * segmentProgress) / route.totalLength;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const ground = point.clone().addScaledVector(sideVector, side * facadeOffset);
    const height = 7.2 + seeded(seed * 37 + index * 5) * 2.6;
    const top = ground.clone().add(new THREE.Vector3(0, height, 0));
    vertices.push(ground.x, ground.y, ground.z, top.x, top.y, top.z);
    facadePoints.push(ground.clone());
    if (index < sampleCount) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const accent = side < 0 ? 0x0b3038 : 0x2d1226;
  const facade = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x18232a,
      emissive: accent,
      emissiveIntensity: .07,
      roughness: .86,
      metalness: .12,
      side: THREE.DoubleSide,
    }),
  );
  facade.receiveShadow = true;
  root.add(facade);

  [.12, .3, .48, .66, .84].forEach((segmentProgress, windowIndex) => {
    const progress = (segment.startDistance + (segment.endDistance - segment.startDistance) * segmentProgress) / route.totalLength;
    const roadPoint = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const warmWindow = windowIndex % 3 !== 1;
    const window = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, .82),
      new THREE.MeshBasicMaterial({
        color: warmWindow ? 0xf1c67a : 0x86c7dc,
        transparent: true,
        opacity: windowIndex % 3 === 0 ? .52 : .3,
        side: THREE.DoubleSide,
      }),
    );
    window.position.copy(roadPoint).addScaledVector(sideVector, side * (facadeOffset - .04));
    window.position.y += 2.1 + (windowIndex % 2) * 2.15;
    window.lookAt(roadPoint.clone().setY(window.position.y));
    root.add(window);

    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(.34, 7.5, .34),
      new THREE.MeshStandardMaterial({ color: 0x2c363c, roughness: .9, metalness: .08 }),
    );
    pier.position.copy(roadPoint).addScaledVector(sideVector, side * (facadeOffset - .18));
    pier.position.y += 3.75;
    pier.lookAt(roadPoint.clone().setY(pier.position.y));
    pier.castShadow = true;
    root.add(pier);
  });

  [2.25, 4.8, 7].forEach((height, bandIndex) => {
    const bandGeometry = new THREE.BufferGeometry().setFromPoints(facadePoints.map((point) => point.clone().add(new THREE.Vector3(0, height, 0))));
    const band = new THREE.Line(
      bandGeometry,
      new THREE.LineDashedMaterial({
        color: bandIndex === 1 ? 0x71858c : 0x45545a,
        transparent: true,
        opacity: bandIndex === 1 ? .46 : .28,
        dashSize: bandIndex === 1 ? 1.1 : 2.2,
        gapSize: bandIndex === 1 ? .85 : 1.5,
      }),
    );
    band.computeLineDistances();
    root.add(band);
  });
  return root;
}

function createJunctionArchitecture(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  junction: ComposedSpatialRouteBranch,
  junctionIndex: number,
): THREE.Group {
  const root = new THREE.Group();
  const entry = path.getPointAt(junction.entryProgress);
  const tangent = path.getTangentAt(junction.entryProgress).normalize();
  const point = entry.clone().addScaledVector(tangent, NIGHT_DROP_JUNCTION_CENTRE_ADVANCE);
  const sideVector = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const placements = junction.junctionKind === "t-junction"
    ? [
        { side: -13.2, forward: 10.4, width: 8.4, depth: 7.4, height: 12.5, blocked: false },
        { side: 13.2, forward: 10.4, width: 8.4, depth: 7.4, height: 14.5, blocked: false },
        { side: 0, forward: 16.8, width: 13.2, depth: 6.8, height: 11.5, blocked: true },
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
      junctionIndex * 10 + placementIndex,
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
  kitIndex = 0,
): THREE.Group {
  const root = new THREE.Group();
  root.userData.cameraOccluder = true;
  root.userData.cameraClearanceRadius = Math.hypot(width, depth) * .5;
  root.userData.productionKit = "night-drop-city-v2";
  root.userData.archetype = blocked ? "service-block" : (["glasshouse", "night-market", "stacked-flats"] as const)[Math.abs(kitIndex) % 3];
  root.userData.cityVariant = Math.abs(kitIndex) % 2 === 0 ? "a" : "b";
  root.userData.desiredWidth = width;
  root.userData.desiredDepth = depth;
  root.userData.desiredHeight = height;
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    createNightDropPbrMaterial("nd.material.city-concrete", {
      repeat: [2, Math.max(2, height / 4)],
      color: blocked ? 0x80616b : 0x8a9ba6,
      roughness: .64,
      metalness: .26,
      emissive: accent,
      emissiveIntensity: blocked ? .038 : .012,
    }),
  );
  shell.name = "junction-building-shell";
  shell.position.y = height / 2;
  shell.castShadow = true;
  shell.receiveShadow = true;
  root.add(shell);

  const pavement = new THREE.Mesh(
    new THREE.BoxGeometry(width + .7, .14, 2.2),
    createNightDropPbrMaterial("nd.material.city-concrete", {
      repeat: [2, 1],
      color: 0x89949c,
      emissive: 0x07131a,
      emissiveIntensity: .04,
      roughness: .82,
      metalness: .12,
    }),
  );
  pavement.position.set(0, .07, depth / 2 + 1.1);
  pavement.name = "junction-pavement";
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
    createNightDropPbrMaterial("nd.material.rooftop-metal", {
      repeat: [2, 2],
      color: 0x8798a5,
      roughness: .48,
      metalness: .64,
    }),
  );
  roof.position.y = height + .15;
  root.add(roof);

  const sign = createNeonSign(blocked ? "NO THROUGH ROAD" : CITY_LABELS[Math.round(width + height) % CITY_LABELS.length]!, accent);
  sign.name = "junction-sign";
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

function createJunctionGeometry(
  path: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
  branchStreets: readonly NightDropBranchStreet[],
): THREE.Group {
  const group = new THREE.Group();
  route.branches.forEach((branchDefinition) => {
    const junctionGroup = new THREE.Group();
    junctionGroup.userData.segmentId = segmentAtProgress(route, branchDefinition.entryProgress);
    junctionGroup.userData.junctionId = branchDefinition.id;
    group.add(junctionGroup);
    const branchEntry = path.getPointAt(branchDefinition.entryProgress);
    const entryTangent = path.getTangentAt(branchDefinition.entryProgress).normalize();
    const entryPoint = branchEntry.clone().addScaledVector(entryTangent, NIGHT_DROP_JUNCTION_CENTRE_ADVANCE);
    const entrySide = new THREE.Vector3(-entryTangent.z, 0, entryTangent.x).normalize();
    const crossStreetPath = new THREE.CatmullRomCurve3([
      entryPoint.clone().addScaledVector(entrySide, -30),
      entryPoint.clone().addScaledVector(entrySide, -12),
      entryPoint.clone(),
      entryPoint.clone().addScaledVector(entrySide, 12),
      entryPoint.clone().addScaledVector(entrySide, 30),
    ], false, "centripetal", .2);
    const crossStreetShoulder = createRibbon(
      crossStreetPath,
      5.8,
      .006,
      createNightDropPbrMaterial("nd.material.city-concrete", {
        repeat: [2, 7],
        color: 0x89959d,
        roughness: .8,
        metalness: .08,
      }),
    );
    crossStreetShoulder.receiveShadow = true;
    junctionGroup.add(crossStreetShoulder);
    const crossStreet = createRibbon(
      crossStreetPath,
      4.35,
      .024,
      createNightDropPbrMaterial("nd.material.wet-asphalt", {
        repeat: [2, 8],
        color: 0xc2d1d9,
        roughness: .5,
        metalness: .28,
        emissive: 0x0a2830,
        emissiveIntensity: .22,
      }),
    );
    crossStreet.receiveShadow = true;
    junctionGroup.add(crossStreet);
    const curbMaterial = new THREE.LineBasicMaterial({ color: 0xaebbc0, transparent: true, opacity: .52 });
    ([-1, 1] as const).forEach((edge) => {
      const curbPoints = [
        entryPoint.clone().addScaledVector(entrySide, -30).addScaledVector(entryTangent, edge * 4.35),
        entryPoint.clone().addScaledVector(entrySide, 30).addScaledVector(entryTangent, edge * 4.35),
      ];
      curbPoints.forEach((point) => { point.y += .1; });
      junctionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curbPoints), curbMaterial));
    });
    const laneMarkingMaterial = new THREE.MeshBasicMaterial({ color: 0xb7fdff, transparent: true, opacity: .64 });
    for (let distance = -26; distance <= 26; distance += 4) {
      const marking = new THREE.Mesh(new THREE.BoxGeometry(.12, .035, 1.65), laneMarkingMaterial);
      marking.position.copy(entryPoint).addScaledVector(entrySide, distance);
      marking.position.y += .075;
      marking.lookAt(entryPoint.clone().addScaledVector(entrySide, distance + 2));
      junctionGroup.add(marking);
    }

    const ambientTraffic = createAmbientTrafficCar(branchDefinition.entryDistance);
    ambientTraffic.userData.dynamicPresentation = "ambient-traffic";
    ambientTraffic.userData.trafficOrigin = entryPoint.toArray();
    ambientTraffic.userData.trafficDirection = entrySide.toArray();
    ambientTraffic.userData.trafficPhase = seeded(branchDefinition.entryDistance * 1.73) * 56;
    ambientTraffic.position.copy(entryPoint).addScaledVector(entrySide, -24);
    ambientTraffic.lookAt(entryPoint.clone().add(entrySide));
    junctionGroup.add(ambientTraffic);

    if (branchDefinition.junctionKind === "t-junction") {
      const deadEndApron = new THREE.Mesh(
        new THREE.BoxGeometry(10.4, .09, 13.5),
        createNightDropPbrMaterial("nd.material.wet-asphalt", {
          repeat: [3, 4],
          color: 0x8f969b,
          roughness: .78,
          metalness: .12,
          emissive: 0x260611,
          emissiveIntensity: .16,
        }),
      );
      deadEndApron.position.copy(entryPoint).addScaledVector(entryTangent, 7.7);
      deadEndApron.position.y += .07;
      deadEndApron.lookAt(entryPoint.clone().add(entryTangent));
      deadEndApron.receiveShadow = true;
      junctionGroup.add(deadEndApron);
      const closure = new THREE.Group();
      const danger = new THREE.MeshStandardMaterial({ color: 0x7f2638, emissive: 0xff264d, emissiveIntensity: .55, roughness: .42 });
      for (let index = -2; index <= 2; index += 1) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.25, .65, .48), danger.clone());
        block.position.set(index * 1.18, .46, 0);
        closure.add(block);
      }
      closure.position.copy(entryPoint).addScaledVector(entryTangent, 6.4);
      closure.lookAt(entryPoint.clone().addScaledVector(entryTangent, 7.4));
      junctionGroup.add(closure);
      const stopLine = new THREE.Mesh(
        new THREE.BoxGeometry(8.4, .045, .32),
        new THREE.MeshBasicMaterial({ color: 0xff5275, transparent: true, opacity: .88 }),
      );
      stopLine.position.copy(entryPoint).addScaledVector(entryTangent, -1.6);
      stopLine.position.y += .09;
      stopLine.lookAt(entryPoint.clone().add(entryTangent));
      junctionGroup.add(stopLine);
    }

    branchDefinition.alternatives.forEach((alternative) => {
      const branchStreet = branchStreets.find((candidate) => (
        candidate.branchId === branchDefinition.id && candidate.alternativeId === alternative.id
      ));
      if (!branchStreet) return;
      const branchPath = branchStreet.path;
      if (alternative.direction !== "straight") {
        const shoulderMaterial = createNightDropPbrMaterial("nd.material.city-concrete", {
          repeat: [2, Math.max(4, branchPath.getLength() / 10)],
          color: 0x879199,
          roughness: .72,
          metalness: .12,
          transparent: true,
          opacity: .98,
        });
        const shoulder = createRibbon(
          branchPath,
          NIGHT_DROP_BRANCH_STREET_HALF_WIDTH + 1.55,
          .008,
          shoulderMaterial,
        );
        shoulder.receiveShadow = true;
        tagJunctionMesh(shoulder, branchDefinition.id, alternative.id, .98, 0);
        junctionGroup.add(shoulder);

        const roadMaterial = createNightDropPbrMaterial("nd.material.wet-asphalt", {
          repeat: [2, Math.max(4, branchPath.getLength() / 8)],
          color: 0xb7c8d0,
          roughness: .5,
          metalness: .3,
          emissive: 0x082b35,
          emissiveIntensity: .2,
          transparent: true,
          opacity: .96,
        });
        const road = createRibbon(branchPath, NIGHT_DROP_BRANCH_STREET_HALF_WIDTH, .028, roadMaterial);
        road.receiveShadow = true;
        tagJunctionMesh(road, branchDefinition.id, alternative.id, .96, .28);
        junctionGroup.add(road);

        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xa8b7bd, transparent: true, opacity: .48 });
        const leftEdge = createStreetEdgeLine(branchPath, -NIGHT_DROP_BRANCH_STREET_HALF_WIDTH, edgeMaterial);
        const rightEdge = createStreetEdgeLine(branchPath, NIGHT_DROP_BRANCH_STREET_HALF_WIDTH, edgeMaterial);
        const centreLine = createStreetCentreLine(branchPath);
        tagJunctionMesh(leftEdge, branchDefinition.id, alternative.id, .48, 0);
        tagJunctionMesh(rightEdge, branchDefinition.id, alternative.id, .48, 0);
        tagJunctionMesh(centreLine, branchDefinition.id, alternative.id, .52, 0);
        junctionGroup.add(leftEdge, rightEdge, centreLine);
      }

      const guideMaterial = new THREE.MeshBasicMaterial({
        color: alternative.direction === "straight" ? 0xb7fdff : 0x40f8ff,
        transparent: true,
        opacity: .64,
      });
      const guide = new THREE.Mesh(new THREE.TubeGeometry(branchPath, 56, .11, 6, false), guideMaterial);
      tagJunctionMesh(guide, branchDefinition.id, alternative.id, .64, 0);
      junctionGroup.add(guide);

      const directionOffset = alternative.direction === "left" ? -3.2 : alternative.direction === "right" ? 3.2 : 0;
      const sign = createNeonSign(directionLabel(alternative.direction).toUpperCase(), alternative.direction === "straight" ? 0xb7fdff : 0x40f8ff);
      sign.position.copy(entryPoint)
        .addScaledVector(entryTangent, 5.5)
        .addScaledVector(entrySide, directionOffset * 1.2);
      sign.position.y += 1.4;
      sign.lookAt(entryPoint.clone().addScaledVector(entryTangent, -8).setY(sign.position.y));
      sign.scale.setScalar(.42);
      sign.userData.junctionDirectionSign = true;
      tagJunctionMesh(sign, branchDefinition.id, alternative.id, 1, 0);
      junctionGroup.add(sign);
    });
  });
  return group;
}

function createStreetEdgeLine(
  path: THREE.Curve<THREE.Vector3>,
  offset: number,
  material: THREE.LineBasicMaterial,
): THREE.Line {
  const points = Array.from({ length: 73 }, (_, index) => {
    const progress = index / 72;
    const point = path.getPointAt(progress);
    const tangent = path.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    point.addScaledVector(side, offset);
    point.y += .105;
    return point;
  });
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function createStreetCentreLine(path: THREE.Curve<THREE.Vector3>): THREE.Line {
  const points = Array.from({ length: 97 }, (_, index) => {
    const point = path.getPointAt(index / 96);
    point.y += .115;
    return point;
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({ color: 0xe8e2c9, transparent: true, opacity: .42, dashSize: 1.4, gapSize: 2.1 }),
  );
  line.computeLineDistances();
  return line;
}

function tagJunctionMesh(
  mesh: THREE.Object3D,
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
  const darkGold = new THREE.MeshStandardMaterial({ color: 0x8b5900, roughness: .48, metalness: .2, emissive: 0x3a2000, emissiveIntensity: .12 });
  const labelMaterial = new THREE.MeshBasicMaterial({ color: 0xfff5c2 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(.72, .5, .64), gold);
  box.position.y = .48;
  box.castShadow = true;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(.76, .12, .68), darkGold);
  lid.position.y = .78;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(.13, .08, .7), darkGold);
  strap.position.y = .81;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(.28, .19), labelMaterial);
  label.position.set(0, .52, .326);
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(.78, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc928, transparent: true, opacity: .2, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = .035;
  contact.scale.set(1.55, .72, 1);
  group.add(box, lid, strap, label, contact);
  const light = new THREE.PointLight(0xffc928, premium ? 22 : 11, 7, 2);
  light.position.y = .8;
  group.add(light);
  placeAt(group, path, progress, lane * 2.8, 0);
  return group;
}

function createAmbientTrafficCar(seed: number): THREE.Group {
  const root = new THREE.Group();
  root.name = "ambient-cross-traffic";
  const bodyColor = [0x33464e, 0x4a383f, 0x5a5338][Math.floor(seeded(seed * 2.7) * 3)]!;
  const body = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    roughness: .4,
    metalness: .48,
    clearcoat: .35,
    clearcoatRoughness: .28,
  });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x10252d, roughness: .16, metalness: .28, clearcoat: .5 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x090a0b, roughness: .96 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xdbe6d8, emissive: 0xffd895, emissiveIntensity: .72, roughness: .3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x8d172b, emissive: 0xff274d, emissiveIntensity: .55, roughness: .34 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.72, .54, 3.35), body);
  base.position.y = .52;
  base.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, .6, 1.72), glass);
  cabin.position.set(0, .99, .18);
  cabin.castShadow = true;
  root.add(base, cabin);
  ([-.76, .76] as const).forEach((x) => {
    ([-1.05, 1.06] as const).forEach((z) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .18, 12), tyre);
      wheel.position.set(x, .29, z);
      wheel.rotation.z = Math.PI / 2;
      root.add(wheel);
    });
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(.32, .18, .07), lamp);
    headlight.position.set(x * .62, .54, 1.71);
    const taillight = new THREE.Mesh(new THREE.BoxGeometry(.3, .16, .07), tail);
    taillight.position.set(x * .62, .54, -1.71);
    root.add(headlight, taillight);
  });
  root.scale.setScalar(.86);
  return root;
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
    color: 0x672634,
    emissive: 0xff315e,
    emissiveIntensity: .22,
    roughness: .52,
    metalness: .34,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x080d14, roughness: .66, metalness: .42 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x777b79, roughness: .9, metalness: .02 });
  const warningWhite = new THREE.MeshStandardMaterial({ color: 0xe4dfcf, roughness: .7, metalness: .08 });
  const warningOrange = new THREE.MeshStandardMaterial({ color: 0xc85a28, emissive: 0x6e1d08, emissiveIntensity: .16, roughness: .62, metalness: .14 });
  const vehicleBody = new THREE.MeshPhysicalMaterial({ color: 0x263944, roughness: .34, metalness: .58, clearcoat: .45, clearcoatRoughness: .22 });
  const vehicleGlass = new THREE.MeshPhysicalMaterial({ color: 0x0b202b, roughness: .14, metalness: .38, clearcoat: .7, clearcoatRoughness: .12 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x090a0c, roughness: .96, metalness: .02 });
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
  const makeWheel = (position: readonly [number, number, number]): THREE.Mesh => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.31, .31, .24, 12), tyre);
    wheel.position.set(...position);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    return wheel;
  };

  if (obstacle.kind === "barrier") {
    ([-2.45, 0, 2.45] as const).forEach((x, index) => {
      root.add(makeBox([2.15, .48, .24], [x, .72, 0], index % 2 === 0 ? warningWhite : warningOrange));
      root.add(makeBox([.92, .5, .255], [x + (index % 2 === 0 ? .43 : -.43), .72, -.01], index % 2 === 0 ? warningOrange : warningWhite));
    });
    ([-3.55, 3.55] as const).forEach((x) => {
      root.add(makeBox([.22, 1.28, .22], [x, .64, 0], dark));
      root.add(makeBox([.72, .12, .58], [x, .08, 0], concrete));
    });
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
    root.add(makeBox([2.08, .62, 3.72], [0, .58, 0], vehicleBody));
    root.add(makeBox([1.92, .42, 1.18], [0, .94, -1.08], vehicleBody));
    const cabin = makeBox([1.72, .7, 1.62], [0, 1.25, -.16], vehicleGlass);
    cabin.rotation.x = -.035;
    root.add(cabin, makeBox([1.5, .12, 1.36], [0, 1.64, -.18], vehicleBody));
    ([-1.05, 1.05] as const).forEach((x) => {
      root.add(makeWheel([x, .36, -1.12]), makeWheel([x, .36, 1.12]));
    });
    ([-.68, .68] as const).forEach((x) => {
      root.add(makeBox([.34, .15, .07], [x, .66, 1.89], danger));
      root.add(makeBox([.3, .14, .07], [x, .68, -1.89], warningWhite));
    });
    root.add(makeBox([.58, .16, .05], [0, .46, 1.91], warningWhite));
    const light = new THREE.PointLight(0xff315e, 5, 5.5, 2);
    light.position.set(0, .8, 1.95);
    root.add(light);
  } else if (obstacle.kind === "route-blocker") {
    root.add(makeBox([2.65, .72, .62], [0, .4, 0], concrete));
    root.add(makeBox([2.25, .18, .08], [0, .72, .35], warningOrange));
    ([-1.02, 1.02] as const).forEach((x) => root.add(makeBox([.16, 1.18, .18], [x, .76, 0], dark)));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 8), gold);
    beacon.position.set(0, 1.18, 0);
    root.add(beacon);
  } else {
    const ramp = makeBox([3.8, .3, 4.7], [0, .46, 0], dark);
    ramp.rotation.x = -.16;
    root.add(ramp);
    ([-1.15, 0, 1.15] as const).forEach((x) => {
      const stripe = makeBox([.2, .055, 2.25], [x, .72, .25], warningOrange);
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
  const serviceMetal = new THREE.MeshStandardMaterial({
    color: 0x1a3039,
    emissive: 0x087683,
    emissiveIntensity: .28,
    roughness: .42,
    metalness: .76,
  });
  for (let index = 0; index < 4; index += 1) {
    const z = 1.5 + index * 3;
    const left = new THREE.Mesh(new THREE.BoxGeometry(.14, 3.25, .14), serviceMetal);
    left.position.set(-3.35, 1.63, z);
    const right = left.clone();
    right.position.x = 3.35;
    const top = new THREE.Mesh(new THREE.BoxGeometry(6.8, .14, .14), serviceMetal);
    top.position.set(0, 3.25, z);
    group.add(left, right, top);
  }
  const sign = createNeonSign("SHORTCUT", 0x24eaff);
  sign.position.set(0, 3.72, 1.48);
  sign.scale.setScalar(.62);
  const light = new THREE.PointLight(0x24eaff, 8, 12, 2);
  light.position.set(0, 2.5, 5.5);
  group.add(sign, light);
  return group;
}

function createCheckpoint(): { readonly root: THREE.Group; readonly clamp: NightDropClampActor; readonly redLight: THREE.PointLight } {
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
  const clamp = new NightDropClampActor();
  clamp.root.position.set(2.05, 0, -.4);
  root.add(clamp.root);
  const redLight = new THREE.PointLight(0xff234d, 8, 18, 2);
  redLight.position.set(0, 4, 1);
  root.add(redLight);
  return { root, clamp, redLight };
}

function createPenthouse(): THREE.Group {
  const group = new THREE.Group();
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x111b26, roughness: .5, metalness: .48, emissive: 0x241b08, emissiveIntensity: .1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x32424b, emissive: 0x4d3b12, emissiveIntensity: .12, roughness: .34, metalness: .7 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd21c, emissive: 0xffc400, emissiveIntensity: 1.12, roughness: .24, metalness: .62 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x7f6429,
    emissive: 0xffc94d,
    emissiveIntensity: .24,
    roughness: .2,
    metalness: .36,
    side: THREE.DoubleSide,
  });
  const towerGeometry = new THREE.BoxGeometry(3.2, 15.5, 5);
  const leftTower = new THREE.Mesh(towerGeometry, towerMaterial);
  leftTower.position.set(-4.4, 7.75, 4);
  const rightTower = new THREE.Mesh(towerGeometry, towerMaterial);
  rightTower.position.set(4.4, 7.75, 4);
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(5.8, 8.4, 1.2), towerMaterial);
  lobby.position.set(0, 4.2, 5.55);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.5, .35), glass);
  door.position.set(0, 1.75, 4.88);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(5.2, .25, 2), gold);
  canopy.position.set(0, 3.82, 4.25);
  group.add(leftTower, rightTower, lobby, door, canopy);
  for (const towerX of [-4.4, 4.4]) {
    for (const edgeX of [-1.42, 1.42]) {
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(.16, 15.6, .18), trim);
      vertical.position.set(towerX + edgeX, 7.8, 1.42);
      group.add(vertical);
    }
    for (let floor = 1; floor < 8; floor += 1) {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(3.1, .09, .26), trim);
      ledge.position.set(towerX, floor * 1.82, 1.38);
      group.add(ledge);
    }
  }
  for (let row = 0; row < 5; row += 1) {
    ([-1, 1] as const).forEach((side) => {
      for (let column = -1; column <= 1; column += 1) {
        if ((row + column + side + 3) % 4 === 0) continue;
        const window = new THREE.Mesh(new THREE.PlaneGeometry(.62, .26), glass);
        window.position.set(side * 4.4 + column * .78, 5.3 + row * 1.75, 1.46);
        group.add(window);
      }
    });
  }
  const address = createNeonSign("PENTHOUSE 2401", 0xffd21c);
  address.position.set(0, 4.55, 4.84);
  address.scale.setScalar(.68);
  group.add(address);
  const rooftopBeacon = new THREE.Mesh(new THREE.TorusGeometry(1.25, .06, 8, 36), gold);
  rooftopBeacon.rotation.x = Math.PI / 2;
  rooftopBeacon.position.set(0, 16.2, 4.2);
  group.add(rooftopBeacon);
  const lobbyLight = new THREE.PointLight(0xffce68, 6, 14, 2);
  lobbyLight.position.set(0, 3.1, 3.5);
  group.add(lobbyLight);
  const light = new THREE.PointLight(0xffc933, 24, 20, 2);
  light.position.set(0, 4.5, 3.2);
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
  const practicalLight = new THREE.PointLight(color, 13, 13, 2);
  practicalLight.position.set(.68, 3.45, 0);
  group.add(pole, arm, bulb, pool, practicalLight);
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

function createNightDropSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      float hash(vec3 point) {
        return fract(sin(dot(point, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }
      void main() {
        float height = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 horizon = vec3(0.035, 0.105, 0.16);
        vec3 middle = vec3(0.012, 0.035, 0.075);
        vec3 zenith = vec3(0.002, 0.005, 0.018);
        vec3 colour = mix(horizon, middle, smoothstep(0.42, 0.68, height));
        colour = mix(colour, zenith, smoothstep(0.68, 0.98, height));
        float cityGlow = 1.0 - smoothstep(0.0, 0.34, abs(vDirection.y + 0.02));
        colour += cityGlow * vec3(0.028, 0.045, 0.06);
        float star = step(0.9977, hash(floor(vDirection * 190.0)));
        star *= smoothstep(0.53, 0.82, height);
        colour += star * vec3(0.55, 0.72, 0.82);
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(218, 30, 18), material);
  sky.name = "night-drop-procedural-sky";
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}

function createRain(lod: NightDropRunnerLod): THREE.Points {
  const dropCount = lod === "low" ? 220 : lod === "medium" ? 380 : 540;
  const positions = new Float32Array(dropCount * 3);
  for (let index = 0; index < dropCount; index += 1) {
    positions[index * 3] = -35 + seeded(index * 3) * 70;
    positions[index * 3 + 1] = .2 + seeded(index * 5) * 30;
    positions[index * 3 + 2] = -35 + seeded(index * 7) * 70;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x9feaff, size: .035, transparent: true, opacity: .55, sizeAttenuation: true });
  return new THREE.Points(geometry, material);
}

function freezeStaticTransforms(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object.userData.dynamicPresentation) {
      object.matrixAutoUpdate = true;
      return;
    }
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
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
  branchStreets: readonly NightDropBranchStreet[],
  route: ComposedSpatialRoute,
  obstacle: ResolvedSpatialRouteObstacle,
  selections: Readonly<Record<string, string>>,
): void {
  const displacement = resolveSpatialBranchDisplacement(route, selections, obstacle.progress);
  placeOnSelectedStreet(
    group,
    path,
    branchStreets,
    route,
    selections,
    obstacle.progress,
    (obstacle.lane ?? 0) * 2.8,
    displacement.elevationOffset,
  );
}

function placeOnSelectedStreet(
  object: THREE.Object3D,
  mainPath: THREE.CatmullRomCurve3,
  branchStreets: readonly NightDropBranchStreet[],
  route: ComposedSpatialRoute,
  selections: Readonly<Record<string, string>>,
  progress: number,
  lateral: number,
  y: number,
): void {
  const branchPose = resolveNightDropBranchStreetPose(branchStreets, route, selections, progress);
  const point = branchPose?.point ?? mainPath.getPointAt(progress);
  const tangent = branchPose?.tangent ?? mainPath.getTangentAt(progress).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  object.position.copy(point).addScaledVector(side, lateral);
  object.position.y += y;
  object.lookAt(object.position.clone().add(tangent));
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

function presentationEnvelope(elapsedMs: number, startsAtMs: number, endsAtMs: number, fadeMs: number): number {
  const enter = smoothstep((elapsedMs - startsAtMs) / Math.max(1, fadeMs));
  const exit = 1 - smoothstep((elapsedMs - endsAtMs + fadeMs) / Math.max(1, fadeMs));
  return enter * exit;
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
