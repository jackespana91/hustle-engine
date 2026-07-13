import {
  MANIFEST_SCHEMA_VERSION,
  animationId,
  createFeatureResult,
  type FeatureContext,
  type FeatureImplementation,
  type FeatureManifest,
  type FeatureManifestId,
  type FeatureResult,
  type FeatureState,
} from "@hustle/core";
import type { RouteRunFeatureContext, RouteRunFeatureHook } from "@hustle/routerun";
import { NIGHT_DROP_ENGINE_ID, NIGHT_DROP_FEATURE_IDS } from "../config/ids.js";

export interface NightDropFeatureState extends FeatureState {
  readonly initialized: boolean;
  readonly triggers: number;
  readonly lastLogicalTick: number;
  readonly cleaned: boolean;
}

export interface NightDropRouteFeature {
  readonly routeHooks: readonly RouteRunFeatureHook[];
  projectRouteHook(hook: RouteRunFeatureHook, context: RouteRunFeatureContext): FeatureResult;
}

const manifest = (
  id: FeatureManifestId,
  name: string,
  description: string,
  priority: number,
  dependencies: readonly FeatureManifestId[] = [],
): FeatureManifest => ({
  manifestType: "feature",
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id,
  name,
  version: "0.1.0",
  description,
  supportedEngineIds: [NIGHT_DROP_ENGINE_ID],
  dependencies,
  optionalDependencies: [],
  conflicts: [],
  failurePolicy: "non-blocking",
  priority,
  deterministic: true,
  stateVersion: "1.0.0",
  metadata: { gamePack: "night-drop", presentationOnly: true },
});

export const NIGHT_DROP_FEATURE_MANIFESTS: readonly FeatureManifest[] = [
  manifest(NIGHT_DROP_FEATURE_IDS.shortcut, "Shortcut", "Presents a predetermined route shortcut.", 10),
  manifest(NIGHT_DROP_FEATURE_IDS.fiveStar, "Five Star", "Presents predetermined Five Star meter progress.", 20),
  manifest(NIGHT_DROP_FEATURE_IDS.clamp, "Clamp", "Presents Clamp intervention through RouteRun feature hooks.", 30),
  manifest(NIGHT_DROP_FEATURE_IDS.priorityJobs, "Priority Jobs", "Presents a predetermined priority delivery callout.", 40, [NIGHT_DROP_FEATURE_IDS.fiveStar]),
  manifest(NIGHT_DROP_FEATURE_IDS.penthouseDrop, "Penthouse Drop", "Presents the configured destination finale.", 50, [NIGHT_DROP_FEATURE_IDS.priorityJobs]),
];

abstract class NightDropFeature implements FeatureImplementation<NightDropFeatureState>, NightDropRouteFeature {
  readonly version = "0.1.0";
  readonly stateVersion = "1.0.0";
  readonly failurePolicy = "non-blocking" as const;
  protected state: NightDropFeatureState = { initialized: false, triggers: 0, lastLogicalTick: 0, cleaned: false };

  constructor(readonly id: FeatureManifestId, readonly routeHooks: readonly RouteRunFeatureHook[], private readonly animationType: string) {}

  initialize(context: FeatureContext<NightDropFeatureState>): FeatureResult<NightDropFeatureState> {
    this.state = { ...this.state, initialized: true, cleaned: false, lastLogicalTick: context.logicalTick };
    return createFeatureResult({ featureStateUpdates: [{ strategy: "replace", state: this.state }] });
  }

  canTrigger(context: FeatureContext<NightDropFeatureState>): boolean {
    const active = context.roundData.activeFeatures;
    return Array.isArray(active) && active.some((id) => id === String(this.id));
  }

  trigger(context: FeatureContext<NightDropFeatureState>): FeatureResult<NightDropFeatureState> {
    this.state = { ...this.state, triggers: this.state.triggers + 1, lastLogicalTick: context.logicalTick };
    return this.result(context.logicalTick, "feature-sdk");
  }

  update(context: FeatureContext<NightDropFeatureState>): FeatureResult<NightDropFeatureState> {
    this.state = { ...this.state, lastLogicalTick: context.logicalTick };
    return createFeatureResult<NightDropFeatureState>({
      featureStateUpdates: [{ strategy: "merge", state: { lastLogicalTick: context.logicalTick } }],
    });
  }

  serialize(): NightDropFeatureState { return structuredClone(this.state); }
  deserialize(state: NightDropFeatureState): void { this.state = structuredClone(state); }

  cleanup(context: FeatureContext<NightDropFeatureState>): FeatureResult<NightDropFeatureState> {
    this.state = { ...this.state, cleaned: true, lastLogicalTick: context.logicalTick };
    return createFeatureResult({ featureStateUpdates: [{ strategy: "replace", state: this.state }] });
  }

  projectRouteHook(hook: RouteRunFeatureHook, context: RouteRunFeatureContext): FeatureResult {
    if (!this.routeHooks.includes(hook) || !this.isConfigured(context)) return createFeatureResult();
    this.state = { ...this.state, triggers: this.state.triggers + 1, lastLogicalTick: context.logicalTick };
    return this.result(context.logicalTick, hook);
  }

  protected isConfigured(context: RouteRunFeatureContext): boolean {
    const configured = context.board?.metadata.activeFeatures;
    return Array.isArray(configured) && configured.some((id) => id === String(this.id));
  }

  private result(logicalTick: number, source: string): FeatureResult<NightDropFeatureState> {
    const shortId = String(this.id).split(".").at(-1) ?? String(this.id);
    return createFeatureResult({
      triggered: true,
      emittedEvents: [{ name: `night-drop.feature.${shortId}`, payload: { logicalTick, source } }],
      animationCommands: [{
        id: animationId(`night-drop-${shortId}-${logicalTick}-${this.state.triggers}`),
        type: this.animationType,
        durationMs: this.durationMs(),
        payload: { featureId: String(this.id), logicalTick, presentationOnly: true },
        skippable: true,
        blocking: false,
        metadata: { gamePack: "night-drop", source },
      }],
      featureStateUpdates: [{ strategy: "replace", state: this.state }],
      sharedStateProposals: this.proposals(),
      telemetry: { featureId: String(this.id), logicalTick, triggers: this.state.triggers },
    });
  }

  protected durationMs(): number { return 320; }
  protected proposals(): FeatureResult["sharedStateProposals"] { return []; }
}

export class ShortcutFeature extends NightDropFeature {
  constructor() { super(NIGHT_DROP_FEATURE_IDS.shortcut, ["after-route-solved"], "night-drop.shortcut.flash"); }
  protected override proposals(): FeatureResult["sharedStateProposals"] { return [{ key: "shortcutVisible", value: true, strategy: "replace" }]; }
}

export class FiveStarFeature extends NightDropFeature {
  constructor() { super(NIGHT_DROP_FEATURE_IDS.fiveStar, ["after-overlay-collected"], "night-drop.five-star.collect"); }
  protected override proposals(): FeatureResult["sharedStateProposals"] { return [{ key: "fiveStarDelta", value: 1, strategy: "replace" }]; }
}

export class ClampFeature extends NightDropFeature {
  constructor() { super(NIGHT_DROP_FEATURE_IDS.clamp, ["before-runner-moves"], "night-drop.clamp.arrive"); }
  protected override durationMs(): number { return 520; }
  protected override proposals(): FeatureResult["sharedStateProposals"] { return [{ key: "clampVisible", value: true, strategy: "replace" }]; }
}

export class PriorityJobsFeature extends NightDropFeature {
  constructor() { super(NIGHT_DROP_FEATURE_IDS.priorityJobs, ["after-overlay-collected"], "night-drop.priority-jobs.pulse"); }
  protected override proposals(): FeatureResult["sharedStateProposals"] { return [{ key: "priorityJobsDelta", value: 1, strategy: "replace" }]; }
}

export class PenthouseDropFeature extends NightDropFeature {
  constructor() { super(NIGHT_DROP_FEATURE_IDS.penthouseDrop, ["before-terminal"], "night-drop.penthouse.arrive"); }
  protected override durationMs(): number { return 600; }
  protected override proposals(): FeatureResult["sharedStateProposals"] { return [{ key: "penthouseReached", value: true, strategy: "replace" }]; }
}

export function createNightDropFeatures(): readonly (FeatureImplementation<NightDropFeatureState> & NightDropRouteFeature)[] {
  return [new ShortcutFeature(), new FiveStarFeature(), new ClampFeature(), new PriorityJobsFeature(), new PenthouseDropFeature()];
}
