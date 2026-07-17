import * as THREE from "three";
import type { ComposedSpatialRoute } from "@hustle/routerun";
import type { NightDropRunnerLod } from "./night-drop-runner-assets.js";

export type NightDropCityLifeKind = "pedestrian" | "umbrella" | "steam";

export interface NightDropCityLifePlacement {
  readonly id: string;
  readonly kind: NightDropCityLifeKind;
  readonly progress: number;
  readonly side: -1 | 1;
  readonly lateral: number;
  readonly routeHalfWidth: number;
  readonly phase: number;
}

interface AnimatedPedestrian {
  readonly root: THREE.Group;
  readonly leftArm: THREE.Object3D;
  readonly rightArm: THREE.Object3D;
  readonly leftLeg: THREE.Object3D;
  readonly rightLeg: THREE.Object3D;
  readonly phase: number;
  readonly progress: number;
}

interface AnimatedSteam {
  readonly root: THREE.Group;
  readonly puffs: readonly THREE.Sprite[];
  readonly phase: number;
  readonly progress: number;
}

const LIMB = new THREE.CapsuleGeometry(.5, .5, 4, 8);
const BODY = new THREE.CapsuleGeometry(.5, .72, 5, 10);
const SPHERE = new THREE.SphereGeometry(.5, 16, 10);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const lifeMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
let steamTexture: THREE.CanvasTexture | null = null;

export class NightDropCityLife {
  readonly root = new THREE.Group();
  private readonly pedestrians: AnimatedPedestrian[] = [];
  private readonly steamColumns: AnimatedSteam[] = [];

  constructor(
    path: THREE.CatmullRomCurve3,
    route: ComposedSpatialRoute,
    lod: NightDropRunnerLod,
  ) {
    this.root.name = "night-drop-city-life";
    resolveNightDropCityLifePlacements(route, lod).forEach((placement) => {
      const point = path.getPointAt(placement.progress);
      const tangent = path.getTangentAt(placement.progress).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const object = placement.kind === "steam"
        ? this.addSteam(placement)
        : this.addPedestrian(placement, placement.kind === "umbrella");
      object.position.copy(point).addScaledVector(side, placement.side * placement.lateral);
      object.position.y = point.y;
      object.lookAt(point.clone().add(tangent).setY(point.y));
      if (placement.side > 0) object.rotateY(Math.PI);
      object.userData.cityLife = true;
      object.userData.baseY = point.y;
      object.userData.routeClearance = placement.lateral - placement.routeHalfWidth;
      this.root.add(object);
    });
  }

  update(elapsedMs: number, runnerProgress: number, branchActive: boolean): void {
    this.root.visible = !branchActive;
    if (branchActive) return;
    this.pedestrians.forEach((person) => {
      const distance = Math.abs(person.progress - runnerProgress);
      person.root.visible = distance < .115;
      const stride = Math.sin(elapsedMs * .0036 + person.phase);
      person.root.position.y = Number(person.root.userData.baseY ?? 0) + Math.max(0, Math.abs(stride)) * .025;
      person.leftArm.rotation.x = stride * .34;
      person.rightArm.rotation.x = -stride * .34;
      person.leftLeg.rotation.x = -stride * .28;
      person.rightLeg.rotation.x = stride * .28;
    });
    this.steamColumns.forEach((column) => {
      column.root.visible = Math.abs(column.progress - runnerProgress) < .13;
      column.puffs.forEach((puff, index) => {
        const cycle = (elapsedMs * .00018 + column.phase + index / column.puffs.length) % 1;
        puff.position.y = .16 + cycle * 1.8;
        puff.position.x = Math.sin(cycle * Math.PI * 2 + column.phase) * .14;
        puff.scale.setScalar(.28 + cycle * .7);
        puff.material.opacity = (1 - cycle) * .13;
      });
    });
  }

  inspect(): { readonly actors: number; readonly visibleActors: number; readonly steamColumns: number } {
    return {
      actors: this.pedestrians.length,
      visibleActors: this.pedestrians.filter(({ root }) => root.visible).length,
      steamColumns: this.steamColumns.length,
    };
  }

  private addPedestrian(placement: NightDropCityLifePlacement, umbrella: boolean): THREE.Group {
    const person = createPedestrian(placement, umbrella);
    this.pedestrians.push({
      root: person.root,
      leftArm: person.leftArm,
      rightArm: person.rightArm,
      leftLeg: person.leftLeg,
      rightLeg: person.rightLeg,
      phase: placement.phase,
      progress: placement.progress,
    });
    return person.root;
  }

  private addSteam(placement: NightDropCityLifePlacement): THREE.Group {
    const root = new THREE.Group();
    root.name = `city-steam-${placement.id}`;
    const grate = mesh("steam-grate", BOX, [0x1d282e, .88, .48], [.62, .045, .34]);
    grate.position.y = .04;
    root.add(grate);
    const texture = resolveSteamTexture();
    const puffs = Array.from({ length: 4 }, (_, index) => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: 0xb8d6dc,
        transparent: true,
        opacity: .08,
        depthWrite: false,
      });
      const puff = new THREE.Sprite(material);
      puff.name = "street-steam-puff";
      puff.position.set(0, .2 + index * .36, 0);
      puff.scale.setScalar(.3 + index * .09);
      root.add(puff);
      return puff;
    });
    this.steamColumns.push({ root, puffs, phase: placement.phase, progress: placement.progress });
    return root;
  }
}

export function resolveNightDropCityLifePlacements(
  route: ComposedSpatialRoute,
  lod: NightDropRunnerLod,
): readonly NightDropCityLifePlacement[] {
  const count = lod === "low" ? 12 : lod === "medium" ? 20 : 26;
  const placements: NightDropCityLifePlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = .025 + index / Math.max(1, count - 1) * .95;
    if (route.branches.some((branch) => Math.abs(branch.entryProgress - progress) * route.totalLength < 21)) continue;
    const distance = progress * route.totalLength;
    const segment = route.segments.find((candidate) => distance >= candidate.startDistance && distance <= candidate.endDistance)
      ?? route.segments.at(-1);
    if (!segment || segment.kind === "bridge" || segment.kind === "tunnel" || segment.kind === "rooftop") continue;
    const kind: NightDropCityLifeKind = index % 5 === 2 ? "steam" : index % 4 === 1 ? "umbrella" : "pedestrian";
    const side = (index % 2 === 0 ? -1 : 1) as -1 | 1;
    placements.push({
      id: `life-${index}`,
      kind,
      progress,
      side,
      lateral: segment.width + (kind === "steam" ? .72 : 1.28 + seeded(index * 13) * .32),
      routeHalfWidth: segment.width,
      phase: seeded(index * 29) * Math.PI * 2,
    });
  }
  return placements;
}

function createPedestrian(
  placement: NightDropCityLifePlacement,
  umbrella: boolean,
): {
  readonly root: THREE.Group;
  readonly leftArm: THREE.Object3D;
  readonly rightArm: THREE.Object3D;
  readonly leftLeg: THREE.Object3D;
  readonly rightLeg: THREE.Object3D;
} {
  const root = new THREE.Group();
  root.name = `city-pedestrian-${placement.id}`;
  const palette = [
    [0x344b55, 0x17232b, 0xb7795f],
    [0x4b394e, 0x211c2a, 0x8d604e],
    [0x4a4d42, 0x1e2522, 0xc48a6b],
    [0x303c51, 0x151b28, 0x9a6955],
  ] as const;
  const colors = palette[Math.floor(placement.phase) % palette.length]!;
  const body = mesh("pedestrian-coat", BODY, [colors[0], .78, .08], [.62, .72, .46]);
  body.position.y = 1.12;
  const head = mesh("pedestrian-head", SPHERE, [colors[2], .68, .02], [.42, .48, .42]);
  head.position.y = 1.82;
  const hood = mesh("pedestrian-hood", SPHERE, [colors[1], .82, .04], [.48, .31, .46]);
  hood.position.set(0, 2.03, .02);
  root.add(body, head, hood);

  const limbMaterial = material(`pedestrian-limb-${colors[1]}`, colors[1], .82, .04);
  const leftArm = limb("pedestrian-left-arm", .13, .74, limbMaterial);
  const rightArm = limb("pedestrian-right-arm", .13, .74, limbMaterial);
  leftArm.position.set(-.4, 1.18, 0);
  rightArm.position.set(.4, 1.18, 0);
  const leftLeg = limb("pedestrian-left-leg", .14, .82, limbMaterial);
  const rightLeg = limb("pedestrian-right-leg", .14, .82, limbMaterial);
  leftLeg.position.set(-.19, .47, 0);
  rightLeg.position.set(.19, .47, 0);
  root.add(leftArm, rightArm, leftLeg, rightLeg);

  if (umbrella) {
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(.72, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      material(`umbrella-${colors[0]}`, colors[0], .55, .18),
    );
    canopy.name = "rain-umbrella";
    canopy.scale.y = .36;
    canopy.position.set(.08, 2.45, 0);
    const handle = limb("umbrella-handle", .025, .95, material("umbrella-handle", 0x6b7476, .38, .7));
    handle.position.set(.08, 2.02, 0);
    root.add(canopy, handle);
  }
  root.scale.setScalar(.82 + seeded(Math.round(placement.progress * 10_000)) * .12);
  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

function limb(name: string, radius: number, height: number, surface: THREE.Material): THREE.Mesh {
  const object = new THREE.Mesh(LIMB, surface);
  object.name = name;
  object.scale.set(radius * 2, height, radius * 2);
  object.castShadow = false;
  return object;
}

function mesh(
  name: string,
  geometry: THREE.BufferGeometry,
  surface: readonly [number, number, number],
  scale: readonly [number, number, number],
): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material(`${name}-${surface.join("-")}`, ...surface));
  object.name = name;
  object.scale.set(...scale);
  object.castShadow = false;
  return object;
}

function material(key: string, color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const cached = lifeMaterialCache.get(key);
  if (cached) return cached;
  const created = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  lifeMaterialCache.set(key, created);
  return created;
}

function resolveSteamTexture(): THREE.CanvasTexture {
  if (steamTexture) return steamTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Night Drop steam texture canvas unavailable");
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255,255,255,.62)");
  gradient.addColorStop(.45, "rgba(210,235,240,.24)");
  gradient.addColorStop(1, "rgba(180,215,225,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  steamTexture = new THREE.CanvasTexture(canvas);
  steamTexture.colorSpace = THREE.SRGBColorSpace;
  return steamTexture;
}

function seeded(value: number): number {
  const result = Math.sin(value * 12.9898 + 78.233) * 43_758.5453;
  return result - Math.floor(result);
}
