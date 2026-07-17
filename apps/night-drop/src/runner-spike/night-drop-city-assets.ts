import * as THREE from "three";
import type { NightDropBuildingArchetype } from "./night-drop-building-kit.js";
import { createNightDropPbrMaterial } from "./night-drop-pbr-materials.js";

export type NightDropCityVariant = "a" | "b";

export interface NightDropCityAssetSpec {
  readonly id: string;
  readonly archetype: NightDropBuildingArchetype;
  readonly variant: NightDropCityVariant;
  readonly url: string;
  readonly nodeName: string;
  readonly baseSize: { readonly width: number; readonly depth: number; readonly height: number };
  readonly maximumTriangles: number;
}

export interface NightDropCityKitStatus {
  readonly mode: "production" | "fallback";
  readonly installedBuildings: number;
  readonly loadedTemplates: number;
  readonly reason: string | null;
}

export const NIGHT_DROP_CITY_KIT_BUNDLE_URL = "/assets/night-drop/runner/city-kit/night-drop-city-kit.glb";

export const NIGHT_DROP_CITY_KIT: readonly NightDropCityAssetSpec[] = [
  city("glasshouse", "a", 8, 6.4, 15, 5_500),
  city("glasshouse", "b", 7.2, 6, 12.5, 5_000),
  city("night-market", "a", 9, 6.8, 10.5, 5_500),
  city("night-market", "b", 7.8, 6.2, 12, 6_000),
  city("service-block", "a", 8.4, 6.8, 9, 3_200),
  city("service-block", "b", 7.4, 6, 11, 3_000),
  city("stacked-flats", "a", 8.2, 6.6, 15.5, 7_750),
  city("stacked-flats", "b", 7.4, 6.2, 13.5, 8_000),
];

const PRESERVED_CURVE_SAFE_PARTS = new Set([
  "pavement-frontage",
  "street-kerb",
  "door-light-pool",
  "street-sign",
  "junction-pavement",
  "junction-sign",
]);

export function validateNightDropCityKit(specs: readonly NightDropCityAssetSpec[] = NIGHT_DROP_CITY_KIT): void {
  const keys = new Set<string>();
  specs.forEach((spec) => {
    const key = cityKey(spec.archetype, spec.variant);
    if (keys.has(key)) throw new Error(`Duplicate Night Drop city template: ${key}`);
    keys.add(key);
    if (spec.url !== NIGHT_DROP_CITY_KIT_BUNDLE_URL || !spec.nodeName.startsWith("ND_City_") || spec.url.includes("..")) {
      throw new Error(`Invalid Night Drop city-kit URL: ${spec.url}`);
    }
    if (Math.min(spec.baseSize.width, spec.baseSize.depth, spec.baseSize.height) <= 0 || spec.maximumTriangles <= 0) {
      throw new Error(`${spec.id} has an invalid production budget`);
    }
  });
  const required = ["glasshouse", "night-market", "service-block", "stacked-flats"] as const;
  required.forEach((archetype) => (["a", "b"] as const).forEach((variant) => {
    if (!keys.has(cityKey(archetype, variant))) throw new Error(`Missing Night Drop city template: ${archetype}.${variant}`);
  }));
}

export async function installNightDropCityKit(cityRoot: THREE.Object3D): Promise<NightDropCityKitStatus> {
  validateNightDropCityKit();
  const placements: THREE.Object3D[] = [];
  cityRoot.traverse((object) => {
    if (object.userData.productionKit === "night-drop-city-v2" && object.userData.productionKitInstalled !== true) {
      placements.push(object);
    }
  });
  if (placements.length === 0) return { mode: "fallback", installedBuildings: 0, loadedTemplates: 0, reason: "No curve-safe building placements were found" };

  try {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const templates = new Map<string, THREE.Object3D>();
    const gltf = await loader.loadAsync(NIGHT_DROP_CITY_KIT_BUNDLE_URL);
    NIGHT_DROP_CITY_KIT.forEach((spec) => {
      const template = gltf.scene.getObjectByName(spec.nodeName);
      if (!template) throw new Error(`${spec.id} does not contain a city template root`);
      configureCityTemplate(template);
      templates.set(cityKey(spec.archetype, spec.variant), template);
    });

    let installedBuildings = 0;
    placements.forEach((placement) => {
      const archetype = placement.userData.archetype as NightDropBuildingArchetype;
      const variant = placement.userData.cityVariant === "b" ? "b" : "a";
      const spec = NIGHT_DROP_CITY_KIT.find((candidate) => candidate.archetype === archetype && candidate.variant === variant);
      const template = templates.get(cityKey(archetype, variant));
      if (!spec || !template) return;
      const instance = template.clone(true);
      instance.name = `night-drop-production-${archetype}-${variant}`;
      instance.userData.productionCityAsset = spec.id;
      instance.scale.set(
        Number(placement.userData.desiredWidth ?? spec.baseSize.width) / spec.baseSize.width,
        Number(placement.userData.desiredHeight ?? spec.baseSize.height) / spec.baseSize.height,
        Number(placement.userData.desiredDepth ?? spec.baseSize.depth) / spec.baseSize.depth,
      );
      placement.children.forEach((child) => { child.visible = PRESERVED_CURVE_SAFE_PARTS.has(child.name); });
      placement.add(instance);
      freezeCityTemplate(instance);
      placement.userData.productionKitInstalled = true;
      installedBuildings += 1;
    });
    return { mode: "production", installedBuildings, loadedTemplates: templates.size, reason: null };
  } catch (error) {
    return {
      mode: "fallback",
      installedBuildings: 0,
      loadedTemplates: 0,
      reason: error instanceof Error ? error.message : "Night Drop production city kit could not be loaded",
    };
  }
}

function configureCityTemplate(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = object.name.toLowerCase().includes("structure");
    object.receiveShadow = true;
    object.frustumCulled = true;
    object.material = Array.isArray(object.material)
      ? object.material.map(cityMaterial)
      : cityMaterial(object.material);
  });
}

function cityMaterial(material: THREE.Material): THREE.Material {
  const name = material.name.toLowerCase();
  if (name.includes("warminterior")) return createNightDropPbrMaterial("nd.material.neon-glass", {
    color: 0x9a5835, roughness: .28, metalness: .08, emissive: 0xff8b35, emissiveIntensity: 1.45, emissiveTexture: false,
  });
  if (name.includes("coolinterior")) return createNightDropPbrMaterial("nd.material.neon-glass", {
    color: 0x365e70, roughness: .26, metalness: .12, emissive: 0x57c8ff, emissiveIntensity: .82, emissiveTexture: false,
  });
  if (name.includes("cyanpractical")) return createNightDropPbrMaterial("nd.material.neon-glass", {
    color: 0x244c58, roughness: .24, metalness: .18, emissive: 0x20d9e8, emissiveIntensity: .72, emissiveTexture: false,
  });
  if (name.includes("magentapractical")) return createNightDropPbrMaterial("nd.material.neon-glass", {
    color: 0x522039, roughness: .26, metalness: .16, emissive: 0xff3ec8, emissiveIntensity: .66, emissiveTexture: false,
  });
  if (name.includes("occupiedglass")) return createNightDropPbrMaterial("nd.material.neon-glass", {
    color: 0x34505b, roughness: .2, metalness: .38, emissive: 0x133e4b, emissiveIntensity: .18, emissiveTexture: false,
  });
  if (name.includes("darkglass")) return createNightDropPbrMaterial("nd.material.neon-glass", {
    color: 0x17242d, roughness: .16, metalness: .48, emissive: 0x092530, emissiveIntensity: .11, emissiveTexture: false,
  });
  if (name.includes("wetbrick")) return createNightDropPbrMaterial("nd.material.city-concrete", {
    repeat: [2, 3], color: 0x5a3939, roughness: .78, metalness: .03, emissive: 0x210a0c, emissiveIntensity: .045,
  });
  if (name.includes("nightplaster")) return createNightDropPbrMaterial("nd.material.city-concrete", {
    repeat: [2, 3], color: 0x4b555c, roughness: .76, metalness: .03, emissive: 0x101d25, emissiveIntensity: .045,
  });
  if (name.includes("agedconcrete")) return createNightDropPbrMaterial("nd.material.city-concrete", {
    repeat: [2, 3], color: 0x485257, roughness: .8, metalness: .04, emissive: 0x101b21, emissiveIntensity: .04,
  });
  if (name.includes("darkconcrete")) return createNightDropPbrMaterial("nd.material.city-concrete", {
    repeat: [2, 3], color: 0x2d3a42, roughness: .76, metalness: .06, emissive: 0x08151b, emissiveIntensity: .035,
  });
  if (name.includes("rooftar")) return createNightDropPbrMaterial("nd.material.rooftop-metal", {
    repeat: [2, 2], color: 0x202a30, roughness: .88, metalness: .06, emissive: 0x070d11, emissiveIntensity: .03,
  });
  if (name.includes("rollershutter")) return createNightDropPbrMaterial("nd.material.rooftop-metal", {
    repeat: [2, 2], color: 0x424e54, roughness: .5, metalness: .66, emissive: 0x0d171d, emissiveIntensity: .04,
  });
  if (name.includes("gunmetal")) return createNightDropPbrMaterial("nd.material.rooftop-metal", {
    repeat: [2, 2], color: 0x34454d, roughness: .38, metalness: .74, emissive: 0x09171d, emissiveIntensity: .055,
  });
  return material;
}

function freezeCityTemplate(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
}

function city(
  archetype: NightDropBuildingArchetype,
  variant: NightDropCityVariant,
  width: number,
  depth: number,
  height: number,
  maximumTriangles: number,
): NightDropCityAssetSpec {
  return {
    id: `city.${archetype}.${variant}`,
    archetype,
    variant,
    url: NIGHT_DROP_CITY_KIT_BUNDLE_URL,
    nodeName: `ND_City_${archetype.replaceAll("-", "_")}_${variant.toUpperCase()}`,
    baseSize: { width, depth, height },
    maximumTriangles,
  };
}

function cityKey(archetype: NightDropBuildingArchetype, variant: NightDropCityVariant): string {
  return `${archetype}:${variant}`;
}
