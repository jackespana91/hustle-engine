import * as THREE from "three";
import type { NightDropRunnerLod } from "./night-drop-runner-assets.js";

export interface NightDropRunnerEffectsFrame {
  readonly position: THREE.Vector3;
  readonly tangent: THREE.Vector3;
  readonly elapsedMs: number;
  readonly moving: boolean;
  readonly runningBlend: number;
  readonly clearStrength: number;
  readonly hitStrength: number;
  readonly shortcutStrength: number;
  readonly dangerStrength: number;
  readonly celebrationStrength: number;
  readonly compact: boolean;
}

interface BurstField {
  readonly points: THREE.Points;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.PointsMaterial;
  readonly seeds: readonly number[];
}

export class NightDropRunnerEffects {
  readonly root = new THREE.Group();
  private readonly speedGeometry: THREE.BufferGeometry;
  private readonly speedMaterial: THREE.PointsMaterial;
  private readonly speedSeeds: readonly number[];
  private readonly footsteps: readonly THREE.Mesh[];
  private readonly collectionRing: THREE.Mesh;
  private readonly shortcutBurst: BurstField;
  private readonly dangerBurst: BurstField;
  private readonly celebrationBurst: BurstField;
  private readonly featureRing: THREE.Mesh;
  private readonly impactLight = new THREE.PointLight(0x40f8ff, 0, 9, 2);
  private readonly lookTarget = new THREE.Vector3();

  constructor(lod: NightDropRunnerLod) {
    this.root.name = "night-drop-runner-effects";
    const lineCount = lod === "low" ? 20 : lod === "medium" ? 34 : 48;
    const positions = new Float32Array(lineCount * 3);
    const seeds: number[] = [];
    for (let index = 0; index < lineCount; index += 1) {
      const seed = seeded(index * 17 + 4);
      seeds.push(seed);
      positions[index * 3] = (seeded(index * 29) - .5) * 8;
      positions[index * 3 + 1] = .45 + seeded(index * 41) * 4.8;
      positions[index * 3 + 2] = 2 + seed * 18;
    }
    this.speedSeeds = seeds;
    this.speedGeometry = new THREE.BufferGeometry();
    this.speedGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.speedMaterial = new THREE.PointsMaterial({
      color: 0x83f9ff,
      size: lod === "low" ? .055 : .07,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const speed = new THREE.Points(this.speedGeometry, this.speedMaterial);
    speed.name = "speed-motes";
    this.root.add(speed);

    this.footsteps = [-1, 1].map((side) => {
      const material = new THREE.MeshBasicMaterial({
        color: 0x40f8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(.16, .24, 18), material);
      ring.name = side < 0 ? "left-foot-splash" : "right-foot-splash";
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(side * .24, .05, -.16);
      this.root.add(ring);
      return ring;
    });

    this.collectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(.72, .055, 8, 30),
      new THREE.MeshBasicMaterial({
        color: 0xffd21c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.collectionRing.name = "collection-pulse";
    this.collectionRing.rotation.x = Math.PI / 2;
    this.collectionRing.position.y = 1.15;
    this.root.add(this.collectionRing);

    const burstCount = lod === "low" ? 14 : lod === "medium" ? 24 : 36;
    this.shortcutBurst = createBurstField("shortcut-burst", 0x54f8ff, burstCount, lod === "low" ? .08 : .1);
    this.dangerBurst = createBurstField("danger-burst", 0xff385f, burstCount, lod === "low" ? .085 : .11);
    this.celebrationBurst = createBurstField("celebration-burst", 0xffd84a, burstCount + 8, lod === "low" ? .095 : .125);
    this.root.add(this.shortcutBurst.points, this.dangerBurst.points, this.celebrationBurst.points);

    this.featureRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, .035, 8, 44),
      new THREE.MeshBasicMaterial({
        color: 0x54f8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.featureRing.name = "feature-energy-ring";
    this.featureRing.rotation.x = Math.PI / 2;
    this.featureRing.position.y = .08;
    this.root.add(this.featureRing);

    this.impactLight.position.y = 1.25;
    this.root.add(this.impactLight);
  }

  update(frame: NightDropRunnerEffectsFrame): void {
    this.root.position.copy(frame.position);
    this.lookTarget.copy(frame.position).add(frame.tangent);
    this.root.lookAt(this.lookTarget);
    const intensity = frame.moving ? frame.runningBlend : 0;
    this.speedMaterial.opacity = (frame.compact ? .2 : .32) * intensity;
    const positions = this.speedGeometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const seed = this.speedSeeds[index]!;
      positions.setZ(index, 2 + wrap(seed * 18 - frame.elapsedMs * (.005 + seed * .002), 18));
    }
    positions.needsUpdate = true;

    this.footsteps.forEach((footstep, index) => {
      const material = footstep.material as THREE.MeshBasicMaterial;
      const localPhase = wrap(frame.elapsedMs / 170 + index, 2);
      const pulse = frame.moving && localPhase < 1 ? 1 - localPhase : 0;
      material.opacity = pulse * .42 * frame.runningBlend;
      footstep.scale.setScalar(1 + (1 - pulse) * 1.15);
    });

    const collectionMaterial = this.collectionRing.material as THREE.MeshBasicMaterial;
    collectionMaterial.opacity = frame.clearStrength * .76;
    this.collectionRing.scale.setScalar(1 + (1 - frame.clearStrength) * 1.8);
    this.collectionRing.rotation.z = frame.elapsedMs * .004;
    this.impactLight.color.setHex(frame.hitStrength > frame.clearStrength ? 0xff315e : 0x40f8ff);
    this.impactLight.intensity = frame.hitStrength * 24 + frame.clearStrength * 14
      + frame.shortcutStrength * 9 + frame.dangerStrength * 13 + frame.celebrationStrength * 18;

    updateBurstField(this.shortcutBurst, frame.elapsedMs, frame.shortcutStrength, 3.4, .0011);
    updateBurstField(this.dangerBurst, frame.elapsedMs, frame.dangerStrength, 2.7, .00145);
    updateBurstField(this.celebrationBurst, frame.elapsedMs, frame.celebrationStrength, 4.4, .00082);
    const ringStrength = Math.max(frame.shortcutStrength, frame.dangerStrength, frame.celebrationStrength);
    const featureMaterial = this.featureRing.material as THREE.MeshBasicMaterial;
    featureMaterial.color.setHex(frame.dangerStrength > Math.max(frame.shortcutStrength, frame.celebrationStrength)
      ? 0xff385f
      : frame.celebrationStrength > frame.shortcutStrength ? 0xffd84a : 0x54f8ff);
    featureMaterial.opacity = ringStrength * .58;
    this.featureRing.scale.setScalar(.72 + (1 - ringStrength) * 1.9);
    this.featureRing.rotation.z = frame.elapsedMs * .0025;
  }
}

function createBurstField(name: string, color: number, count: number, size: number): BurstField {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  return {
    points,
    geometry,
    material,
    seeds: Array.from({ length: count }, (_, index) => seeded(index * 31 + color * .0001)),
  };
}

function updateBurstField(field: BurstField, elapsedMs: number, strength: number, radius: number, speed: number): void {
  field.material.opacity = strength * .76;
  field.points.visible = strength > .01;
  if (!field.points.visible) return;
  const positions = field.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const seed = field.seeds[index]!;
    const cycle = wrap(elapsedMs * speed + seed, 1);
    const angle = seed * Math.PI * 12 + cycle * 1.8;
    const spread = (.3 + cycle * radius) * (.55 + seeded(index * 17) * .45);
    positions.setXYZ(
      index,
      Math.cos(angle) * spread,
      .28 + cycle * (1.7 + seeded(index * 23) * 2.4),
      Math.sin(angle) * spread,
    );
  }
  positions.needsUpdate = true;
}

function seeded(value: number): number {
  const result = Math.sin(value * 12.9898 + 78.233) * 43_758.5453;
  return result - Math.floor(result);
}

function wrap(value: number, range: number): number {
  return ((value % range) + range) % range;
}
