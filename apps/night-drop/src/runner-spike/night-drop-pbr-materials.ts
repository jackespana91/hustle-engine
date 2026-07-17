import * as THREE from "three";
import { NIGHT_DROP_RUNNER_PRODUCTION_MANIFEST } from "./night-drop-runner-assets.js";

export type NightDropPbrSurfaceId =
  | "nd.material.wet-asphalt"
  | "nd.material.city-concrete"
  | "nd.material.neon-glass"
  | "nd.material.rooftop-metal";

export interface NightDropPbrMaterialOptions {
  readonly repeat?: readonly [number, number];
  readonly color?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly emissiveTexture?: boolean;
  readonly normalScale?: number;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: THREE.Side;
}

const textureCache = new Map<string, THREE.Texture>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const loader = new THREE.TextureLoader();

export function createNightDropPbrMaterial(
  id: NightDropPbrSurfaceId,
  options: NightDropPbrMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const spec = NIGHT_DROP_RUNNER_PRODUCTION_MANIFEST.materials.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Night Drop PBR surface is not registered: ${id}`);
  const repeat = options.repeat ?? [1, 1];
  const cacheKey = [
    id,
    repeat.join("x"),
    options.color ?? "default",
    options.roughness ?? "default",
    options.metalness ?? "default",
    options.emissive ?? "default",
    options.emissiveIntensity ?? "default",
    options.emissiveTexture ?? false,
    options.normalScale ?? "default",
    options.transparent ?? false,
    options.opacity ?? 1,
    options.side ?? THREE.FrontSide,
  ].join(":");
  const cached = materialCache.get(cacheKey);
  if (cached) return cached;

  const wetSurface = id === "nd.material.wet-asphalt";
  const glassSurface = id === "nd.material.neon-glass";
  const material = new THREE.MeshPhysicalMaterial({
    map: texture(spec.albedoUrl, repeat, true),
    ...(spec.normalUrl ? { normalMap: texture(spec.normalUrl, repeat, false) } : {}),
    ...(spec.roughnessUrl ? { roughnessMap: texture(spec.roughnessUrl, repeat, false) } : {}),
    ...(spec.emissiveUrl && (options.emissiveTexture ?? id === "nd.material.neon-glass")
      ? { emissiveMap: texture(spec.emissiveUrl, repeat, true) }
      : {}),
    color: options.color ?? 0xffffff,
    roughness: options.roughness ?? .72,
    metalness: options.metalness ?? .08,
    emissive: options.emissive ?? 0x111111,
    emissiveIntensity: options.emissiveIntensity ?? .12,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: !(options.transparent ?? false),
    side: options.side ?? THREE.FrontSide,
    clearcoat: wetSurface ? .72 : glassSurface ? .42 : .08,
    clearcoatRoughness: wetSurface ? .17 : glassSurface ? .24 : .5,
    reflectivity: wetSurface ? .58 : glassSurface ? .72 : .36,
  });
  const normalScale = options.normalScale ?? .7;
  material.normalScale.set(normalScale, normalScale);
  materialCache.set(cacheKey, material);
  return material;
}

function texture(url: string, repeat: readonly [number, number], colour: boolean): THREE.Texture {
  const key = `${url}:${repeat.join("x")}:${colour}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const created = loader.load(url);
  created.wrapS = THREE.RepeatWrapping;
  created.wrapT = THREE.RepeatWrapping;
  created.repeat.set(repeat[0], repeat[1]);
  created.anisotropy = 4;
  if (colour) created.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, created);
  return created;
}
