import * as THREE from "three";
import { createNightDropDashRig, type NightDropDashParts } from "./night-drop-dash-rig.js";
import {
  disposeNightDropProductionObject,
  type LoadedNightDropDashAsset,
  type NightDropDashAnimationRole,
  type NightDropDashAssetSpec,
  type NightDropRunnerProductionLoader,
} from "./night-drop-runner-assets.js";

export interface NightDropDashMotionFrame {
  readonly frameDeltaMs: number;
  readonly elapsedMs: number;
  readonly moving: boolean;
  readonly action: "idle" | "running" | "jumping" | "sliding" | "dodging-left" | "dodging-right";
  readonly stride: number;
  readonly dodgeLean: number;
  readonly hitStrength: number;
  readonly clearStrength: number;
  readonly runningBlend: number;
}

export interface NightDropDashAssetStatus {
  readonly mode: "proxy" | "loading" | "production";
  readonly sourceUrl: string | null;
  readonly fallbackReason: string | null;
  readonly availableAnimationRoles: readonly NightDropDashAnimationRole[];
}

export class NightDropDashActor {
  readonly root = new THREE.Group();
  private readonly proxy = createNightDropDashRig();
  private readonly parts: NightDropDashParts;
  private production: LoadedNightDropDashAsset | null = null;
  private activeAnimation: NightDropDashAnimationRole | null = null;
  private disposed = false;
  private status: NightDropDashAssetStatus = {
    mode: "proxy",
    sourceUrl: null,
    fallbackReason: null,
    availableAnimationRoles: [],
  };

  constructor() {
    this.root.name = "dash-actor";
    this.root.userData.assetRole = "character.dash";
    this.proxy.scale.setScalar(1);
    this.parts = this.proxy.userData.parts as NightDropDashParts;
    this.root.add(this.proxy);
  }

  inspect(): NightDropDashAssetStatus {
    return this.status;
  }

  async loadProduction(loader: NightDropRunnerProductionLoader, spec: NightDropDashAssetSpec): Promise<NightDropDashAssetStatus> {
    if (this.disposed) return this.status;
    this.status = { mode: "loading", sourceUrl: spec.modelUrl, fallbackReason: null, availableAnimationRoles: [] };
    try {
      const production = await loader.loadDash(spec);
      if (this.disposed) {
        production.mixer.stopAllAction();
        disposeNightDropProductionObject(production.root);
        return this.status;
      }
      this.production = production;
      this.proxy.visible = false;
      this.root.add(production.root);
      this.status = {
        mode: "production",
        sourceUrl: production.sourceUrl,
        fallbackReason: null,
        availableAnimationRoles: Object.keys(production.actions) as NightDropDashAnimationRole[],
      };
      this.playProductionAnimation("idle", 0);
    } catch (error) {
      this.proxy.visible = true;
      this.status = {
        mode: "proxy",
        sourceUrl: spec.modelUrl,
        fallbackReason: error instanceof Error ? error.message : "Dash production asset could not be loaded",
        availableAnimationRoles: [],
      };
    }
    return this.status;
  }

  update(frame: NightDropDashMotionFrame): void {
    if (this.production) {
      const role = resolveProductionAnimation(frame);
      this.playProductionAnimation(role, .12);
      this.production.mixer.update(Math.max(0, Math.min(.1, frame.frameDeltaMs / 1_000)));
      return;
    }
    this.parts.leftLeg.rotation.x = frame.stride * .72;
    this.parts.rightLeg.rotation.x = -frame.stride * .72;
    this.parts.leftArm.rotation.x = -frame.stride * .58;
    this.parts.rightArm.rotation.x = frame.stride * .58;
    this.parts.torso.rotation.z = (frame.moving ? frame.stride * .025 : 0)
      + frame.dodgeLean
      + frame.hitStrength * Math.sin(frame.elapsedMs * .07) * .12;
    this.parts.backpack.rotation.z = frame.moving ? -frame.stride * .03 : 0;
    this.parts.head.rotation.y = frame.moving ? Math.sin(frame.elapsedMs * .0065) * .035 : -.06;
    this.parts.head.rotation.z = frame.dodgeLean * .18 + frame.hitStrength * Math.sin(frame.elapsedMs * .08) * .05;
    this.parts.hair.rotation.x = frame.moving ? -.05 - Math.abs(frame.stride) * .045 : 0;
    this.parts.jacketTail.rotation.x = frame.moving
      ? .16 + Math.abs(frame.stride) * .16 + frame.runningBlend * .08
      : .04;
    this.parts.jacketTail.rotation.z = frame.moving ? frame.stride * .035 : 0;
  }

  dispose(): void {
    this.disposed = true;
    if (!this.production) return;
    this.production.mixer.stopAllAction();
    this.production.mixer.uncacheRoot(this.production.root);
    this.production.root.removeFromParent();
    disposeNightDropProductionObject(this.production.root);
    this.production = null;
  }

  private playProductionAnimation(role: NightDropDashAnimationRole, fadeSeconds: number): void {
    if (!this.production || role === this.activeAnimation) return;
    const next = this.production.actions[role] ?? this.production.actions.run ?? this.production.actions.idle;
    if (!next) return;
    const previous = this.activeAnimation ? this.production.actions[this.activeAnimation] : undefined;
    previous?.fadeOut(fadeSeconds);
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (isOneShot(role)) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      next.clampWhenFinished = false;
    }
    next.fadeIn(fadeSeconds).play();
    this.activeAnimation = role;
  }
}

function resolveProductionAnimation(frame: NightDropDashMotionFrame): NightDropDashAnimationRole {
  if (frame.hitStrength > .08) return "stumble";
  if (frame.clearStrength > .08) return "collect";
  if (frame.action === "jumping") return "jump";
  if (frame.action === "sliding") return "slide";
  if (frame.action === "dodging-left") return "dodge-left";
  if (frame.action === "dodging-right") return "dodge-right";
  if (frame.moving) return frame.runningBlend < .94 ? "start" : "run";
  return "idle";
}

function isOneShot(role: NightDropDashAnimationRole): boolean {
  return !["idle", "run"].includes(role);
}
