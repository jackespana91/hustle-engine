import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ComposedSpatialRoute, ComposedSpatialRouteSegment } from "@hustle/routerun";

export type NightDropRunnerLod = "low" | "medium" | "high";
export type NightDropEnvironmentRole =
  | "street-straight"
  | "corner-left"
  | "corner-right"
  | "t-junction"
  | "crossroads"
  | "alley"
  | "bridge"
  | "tunnel"
  | "ramp-up"
  | "ramp-down"
  | "rooftop"
  | "destination";

export type NightDropDashAnimationRole =
  | "idle"
  | "start"
  | "run"
  | "stop"
  | "jump"
  | "slide"
  | "dodge-left"
  | "dodge-right"
  | "turn-left"
  | "turn-right"
  | "collect"
  | "stumble"
  | "celebrate";

export interface NightDropDashAssetSpec {
  readonly id: "character.dash";
  readonly modelUrl: string;
  readonly scale: number;
  readonly groundOffset: number;
  readonly forwardAxis: "+z" | "-z";
  readonly animations: Readonly<Record<NightDropDashAnimationRole, readonly string[]>>;
  readonly budgets: Readonly<Record<NightDropRunnerLod, { readonly maximumTriangles: number; readonly maximumBones: number }>>;
}

export interface NightDropEnvironmentAssetSpec {
  readonly id: string;
  readonly role: NightDropEnvironmentRole;
  readonly lodUrls: Readonly<Record<NightDropRunnerLod, string>>;
  readonly footprint: { readonly width: number; readonly length: number };
  readonly forwardAxis: "+z" | "-z";
}

export interface NightDropMaterialAssetSpec {
  readonly id: string;
  readonly albedoUrl: string;
  readonly normalUrl?: string;
  readonly roughnessUrl?: string;
  readonly emissiveUrl?: string;
  readonly maximumResolution: Readonly<Record<NightDropRunnerLod, number>>;
}

export interface NightDropRunnerProductionManifest {
  readonly id: "night-drop.runner-production";
  readonly version: string;
  readonly character: NightDropDashAssetSpec;
  readonly environment: readonly NightDropEnvironmentAssetSpec[];
  readonly materials: readonly NightDropMaterialAssetSpec[];
}

export interface NightDropRunnerDeviceProfile {
  readonly viewportWidth: number;
  readonly pixelRatio: number;
  readonly deviceMemoryGb?: number;
  readonly compact: boolean;
}

export interface LoadedNightDropDashAsset {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Readonly<Partial<Record<NightDropDashAnimationRole, THREE.AnimationAction>>>;
  readonly clips: readonly THREE.AnimationClip[];
  readonly sourceUrl: string;
}

export const NIGHT_DROP_DASH_ANIMATION_ROLES: readonly NightDropDashAnimationRole[] = [
  "idle", "start", "run", "stop", "jump", "slide", "dodge-left", "dodge-right",
  "turn-left", "turn-right", "collect", "stumble", "celebrate",
];

export const NIGHT_DROP_RUNNER_PRODUCTION_MANIFEST: NightDropRunnerProductionManifest = {
  id: "night-drop.runner-production",
  version: "1.0.0",
  character: {
    id: "character.dash",
    modelUrl: "/assets/night-drop/runner/characters/dash/dash.glb",
    scale: 1,
    groundOffset: 0,
    forwardAxis: "+z",
    animations: {
      idle: ["Dash_Idle", "idle"],
      start: ["Dash_Start", "run_start"],
      run: ["Dash_Run", "run"],
      stop: ["Dash_Stop", "run_stop"],
      jump: ["Dash_Jump", "jump"],
      slide: ["Dash_Slide", "slide"],
      "dodge-left": ["Dash_Dodge_L", "dodge_left"],
      "dodge-right": ["Dash_Dodge_R", "dodge_right"],
      "turn-left": ["Dash_Turn_L", "turn_left"],
      "turn-right": ["Dash_Turn_R", "turn_right"],
      collect: ["Dash_Collect", "collect"],
      stumble: ["Dash_Stumble", "hit"],
      celebrate: ["Dash_Celebrate", "celebrate"],
    },
    budgets: {
      low: { maximumTriangles: 18_000, maximumBones: 55 },
      medium: { maximumTriangles: 32_000, maximumBones: 70 },
      high: { maximumTriangles: 55_000, maximumBones: 85 },
    },
  },
  environment: [
    environment("nd.street.straight", "street-straight"),
    environment("nd.street.corner-left", "corner-left"),
    environment("nd.street.corner-right", "corner-right"),
    environment("nd.street.t-junction", "t-junction"),
    environment("nd.street.crossroads", "crossroads"),
    environment("nd.street.alley", "alley"),
    environment("nd.street.bridge", "bridge"),
    environment("nd.street.tunnel", "tunnel"),
    environment("nd.street.ramp-up", "ramp-up"),
    environment("nd.street.ramp-down", "ramp-down"),
    environment("nd.street.rooftop", "rooftop"),
    environment("nd.street.destination", "destination"),
  ],
  materials: [
    material("nd.material.wet-asphalt", "wet-asphalt"),
    material("nd.material.city-concrete", "city-concrete"),
    material("nd.material.neon-glass", "neon-glass"),
    material("nd.material.rooftop-metal", "rooftop-metal"),
  ],
};

export function validateNightDropRunnerProductionManifest(manifest: NightDropRunnerProductionManifest): void {
  if (manifest.id !== "night-drop.runner-production") throw new Error("Night Drop runner manifest id is invalid");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Night Drop runner manifest version must use semantic versioning");
  validateAssetUrl(manifest.character.modelUrl, manifest.character.id);
  if (manifest.character.scale <= 0) throw new Error("Dash production scale must be positive");
  NIGHT_DROP_DASH_ANIMATION_ROLES.forEach((role) => {
    const aliases = manifest.character.animations[role];
    if (aliases.length === 0 || aliases.some((alias) => alias.trim().length === 0)) {
      throw new Error(`Dash animation ${role} requires at least one valid clip alias`);
    }
  });
  const ids = new Set<string>();
  const roles = new Set<NightDropEnvironmentRole>();
  manifest.environment.forEach((asset) => {
    if (ids.has(asset.id)) throw new Error(`Duplicate Night Drop runner asset id: ${asset.id}`);
    if (roles.has(asset.role)) throw new Error(`Duplicate Night Drop runner environment role: ${asset.role}`);
    ids.add(asset.id);
    roles.add(asset.role);
    if (asset.footprint.width <= 0 || asset.footprint.length <= 0) throw new Error(`${asset.id} requires a positive footprint`);
    Object.values(asset.lodUrls).forEach((url) => validateAssetUrl(url, asset.id));
  });
  manifest.materials.forEach((asset) => {
    if (ids.has(asset.id)) throw new Error(`Duplicate Night Drop runner asset id: ${asset.id}`);
    ids.add(asset.id);
    validateAssetUrl(asset.albedoUrl, asset.id);
    if (asset.normalUrl) validateAssetUrl(asset.normalUrl, asset.id);
    if (asset.roughnessUrl) validateAssetUrl(asset.roughnessUrl, asset.id);
    if (asset.emissiveUrl) validateAssetUrl(asset.emissiveUrl, asset.id);
    if (!(asset.maximumResolution.low <= asset.maximumResolution.medium && asset.maximumResolution.medium <= asset.maximumResolution.high)) {
      throw new Error(`${asset.id} texture resolutions must increase by LOD`);
    }
  });
}

export function selectNightDropRunnerLod(profile: NightDropRunnerDeviceProfile): NightDropRunnerLod {
  const memory = profile.deviceMemoryGb ?? 4;
  if (profile.compact || profile.viewportWidth < 520 || memory <= 3 || profile.pixelRatio > 2.5) return "low";
  if (profile.viewportWidth >= 1_100 && memory >= 8 && profile.pixelRatio <= 2) return "high";
  return "medium";
}

export function resolveNightDropEnvironmentRole(
  route: ComposedSpatialRoute,
  segment: ComposedSpatialRouteSegment,
): NightDropEnvironmentRole {
  if (segment.kind === "bend") {
    const turn = normalizeDegrees(segment.endHeadingDegrees - segment.startHeadingDegrees);
    return turn >= 0 ? "corner-right" : "corner-left";
  }
  if (segment.kind === "junction") {
    const branch = route.branches.find(({ entryDistance }) => entryDistance >= segment.startDistance && entryDistance <= segment.endDistance)
      ?? route.branches.reduce((closest, candidate) => (
        Math.abs(candidate.entryDistance - segment.startDistance) < Math.abs(closest.entryDistance - segment.startDistance) ? candidate : closest
      ), route.branches[0]!);
    return branch?.junctionKind === "t-junction" ? "t-junction" : "crossroads";
  }
  if (segment.kind === "alley") return "alley";
  if (segment.kind === "bridge") return "bridge";
  if (segment.kind === "tunnel") return "tunnel";
  if (segment.kind === "ramp") return segment.elevation < 0 ? "ramp-down" : "ramp-up";
  if (segment.kind === "rooftop") return "rooftop";
  if (segment.kind === "destination") return "destination";
  return "street-straight";
}

export class NightDropRunnerProductionLoader {
  async loadDash(spec: NightDropDashAssetSpec): Promise<LoadedNightDropDashAsset> {
    validateAssetUrl(spec.modelUrl, spec.id);
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(spec.modelUrl);
    return prepareDashAsset(gltf, spec);
  }

  async loadEnvironment(asset: NightDropEnvironmentAssetSpec, lod: NightDropRunnerLod): Promise<THREE.Group> {
    const url = asset.lodUrls[lod];
    validateAssetUrl(url, asset.id);
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.name = asset.id;
    root.userData.assetId = asset.id;
    root.userData.assetRole = asset.role;
    root.userData.lod = lod;
    configureProductionMeshes(root);
    if (asset.forwardAxis === "-z") root.rotation.y = Math.PI;
    return root;
  }
}

export function disposeNightDropProductionObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((item) => materials.add(item));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((item) => {
    const materialWithMaps = item as THREE.Material & Record<string, unknown>;
    Object.values(materialWithMaps).forEach((value) => {
      if (value instanceof THREE.Texture) value.dispose();
    });
    item.dispose();
  });
}

function prepareDashAsset(gltf: GLTF, spec: NightDropDashAssetSpec): LoadedNightDropDashAsset {
  const root = gltf.scene;
  root.name = "dash-production";
  root.scale.setScalar(spec.scale);
  root.position.y = spec.groundOffset;
  if (spec.forwardAxis === "-z") root.rotation.y = Math.PI;
  root.userData.assetId = spec.id;
  root.userData.sourceUrl = spec.modelUrl;
  configureProductionMeshes(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions: Partial<Record<NightDropDashAnimationRole, THREE.AnimationAction>> = {};
  NIGHT_DROP_DASH_ANIMATION_ROLES.forEach((role) => {
    const clip = findClip(gltf.animations, spec.animations[role]);
    if (clip) actions[role] = mixer.clipAction(clip);
  });
  if (!actions.idle || !actions.run || !actions.jump || !actions.slide) {
    mixer.stopAllAction();
    throw new Error("Dash GLB requires idle, run, jump and slide animation clips");
  }
  return { root, mixer, actions, clips: gltf.animations, sourceUrl: spec.modelUrl };
}

function findClip(clips: readonly THREE.AnimationClip[], aliases: readonly string[]): THREE.AnimationClip | undefined {
  const normalized = new Map(clips.map((clip) => [normalizeClipName(clip.name), clip]));
  return aliases.map(normalizeClipName).map((alias) => normalized.get(alias)).find(Boolean);
}

function normalizeClipName(name: string): string {
  return name.trim().toLowerCase().replaceAll(/[\s_-]+/g, "");
}

function configureProductionMeshes(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
  });
}

function environment(id: string, role: NightDropEnvironmentRole): NightDropEnvironmentAssetSpec {
  const slug = role.replaceAll("-", "_");
  return {
    id,
    role,
    lodUrls: {
      low: `/assets/night-drop/runner/environment/${slug}_lod2.glb`,
      medium: `/assets/night-drop/runner/environment/${slug}_lod1.glb`,
      high: `/assets/night-drop/runner/environment/${slug}_lod0.glb`,
    },
    footprint: { width: role === "crossroads" ? 38 : role === "t-junction" ? 32 : 16, length: 20 },
    forwardAxis: "+z",
  };
}

function material(id: string, slug: string): NightDropMaterialAssetSpec {
  const root = `/assets/night-drop/runner/materials/${slug}`;
  return {
    id,
    albedoUrl: `${root}_albedo.webp`,
    normalUrl: `${root}_normal.webp`,
    roughnessUrl: `${root}_roughness.webp`,
    emissiveUrl: `${root}_emissive.webp`,
    maximumResolution: { low: 512, medium: 1_024, high: 2_048 },
  };
}

function validateAssetUrl(url: string, id: string): void {
  if (!url.startsWith("/assets/night-drop/runner/") || url.includes("..") || /\s/.test(url)) {
    throw new Error(`${id} has an invalid Night Drop runner asset URL`);
  }
}

function normalizeDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}
