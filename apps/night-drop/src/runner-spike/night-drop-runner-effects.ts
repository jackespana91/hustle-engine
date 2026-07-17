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
  readonly compact: boolean;
}

export class NightDropRunnerEffects {
  readonly root = new THREE.Group();
  private readonly speedGeometry: THREE.BufferGeometry;
  private readonly speedMaterial: THREE.PointsMaterial;
  private readonly speedSeeds: readonly number[];
  private readonly footsteps: readonly THREE.Mesh[];
  private readonly collectionRing: THREE.Mesh;
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
    this.impactLight.intensity = frame.hitStrength * 24 + frame.clearStrength * 14;
  }
}

function seeded(value: number): number {
  const result = Math.sin(value * 12.9898 + 78.233) * 43_758.5453;
  return result - Math.floor(result);
}

function wrap(value: number, range: number): number {
  return ((value % range) + range) % range;
}
