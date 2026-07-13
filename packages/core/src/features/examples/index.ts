import { animationId } from "../../contracts.js";
import {
  MANIFEST_SCHEMA_VERSION,
  engineManifestId,
  featureManifestId,
  type EngineManifest,
  type FeatureManifest,
  type FeatureManifestId,
  type HustleManifest,
} from "../../manifests/manifest-types.js";
import type { FeatureContext } from "../feature-context.js";
import type { FeatureRegistrationInput } from "../feature-registry.js";
import {
  createFeatureResult,
  type FeatureFailurePolicy,
  type FeatureImplementation,
  type FeatureResult,
  type FeatureState,
} from "../feature-types.js";

export const FEATURE_SDK_EXAMPLE_ENGINE_ID = engineManifestId("feature-sdk-playground-engine");

const exampleMetadata = Object.freeze({
  example: true,
  production: false,
  gameplayImplemented: false,
  purpose: "Feature SDK architecture validation",
});

const featureIds = {
  shortcut: featureManifestId("shortcut-feature"),
  clamp: featureManifestId("clamp-feature"),
  fiveStar: featureManifestId("five-star-feature"),
  stickyWild: featureManifestId("sticky-wild-feature"),
  collector: featureManifestId("collector-feature"),
  holdAndWin: featureManifestId("hold-and-win-feature"),
} as const;

export const SHORTCUT_FEATURE_SDK_MANIFEST = featureManifest(
  featureIds.shortcut,
  "ShortcutFeature",
  "Architectural placeholder for a reusable shortcut feature boundary.",
  10,
);

export const CLAMP_FEATURE_SDK_MANIFEST = featureManifest(
  featureIds.clamp,
  "ClampFeature",
  "Architectural placeholder for a reusable clamp feature boundary.",
  20,
);

export const FIVE_STAR_FEATURE_SDK_MANIFEST = featureManifest(
  featureIds.fiveStar,
  "FiveStarFeature",
  "Architectural placeholder for a reusable five-star feature boundary.",
  30,
  [featureIds.shortcut],
);

export const STICKY_WILD_FEATURE_SDK_MANIFEST = featureManifest(
  featureIds.stickyWild,
  "StickyWildFeature",
  "Architectural placeholder for a reusable sticky-state feature boundary.",
  40,
);

export const COLLECTOR_FEATURE_SDK_MANIFEST = featureManifest(
  featureIds.collector,
  "CollectorFeature",
  "Architectural placeholder for a reusable collection feature boundary.",
  50,
);

export const HOLD_AND_WIN_FEATURE_SDK_MANIFEST = featureManifest(
  featureIds.holdAndWin,
  "HoldAndWinFeature",
  "Architectural placeholder for a reusable hold-and-win feature boundary.",
  60,
  [featureIds.collector],
);

export const FEATURE_SDK_EXAMPLE_FEATURE_MANIFESTS = Object.freeze([
  SHORTCUT_FEATURE_SDK_MANIFEST,
  CLAMP_FEATURE_SDK_MANIFEST,
  FIVE_STAR_FEATURE_SDK_MANIFEST,
  STICKY_WILD_FEATURE_SDK_MANIFEST,
  COLLECTOR_FEATURE_SDK_MANIFEST,
  HOLD_AND_WIN_FEATURE_SDK_MANIFEST,
]) satisfies readonly FeatureManifest[];

export const FEATURE_SDK_EXAMPLE_ENGINE_MANIFEST: EngineManifest = {
  manifestType: "engine",
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: FEATURE_SDK_EXAMPLE_ENGINE_ID,
  name: "Feature SDK Playground Engine",
  version: "0.1.0",
  description: "Non-production host used to validate engine-agnostic Feature SDK contracts.",
  engineType: "architectural-example",
  coreVersion: "^0.1.0",
  status: "experimental",
  supportedPlatforms: ["web", "mobile-web", "desktop-web"],
  supportedOrientations: ["responsive"],
  requiredCapabilities: ["deterministic-presentation", "snapshot-recovery"],
  optionalCapabilities: ["feature-sdk-debug"],
  supportedFeatureIds: FEATURE_SDK_EXAMPLE_FEATURE_MANIFESTS.map(({ id }) => id),
  incompatibleFeatureIds: [],
  performanceBudget: {
    maxInitialLoadMs: 4_000,
    maxFrameTimeMs: 34,
    maxMemoryMb: 256,
    maxAssetBytes: 25_000_000,
  },
  metadata: exampleMetadata,
};

export const FEATURE_SDK_EXAMPLE_MANIFESTS: readonly HustleManifest[] = Object.freeze([
  FEATURE_SDK_EXAMPLE_ENGINE_MANIFEST,
  ...FEATURE_SDK_EXAMPLE_FEATURE_MANIFESTS,
]);

export type PlaceholderFeatureState = FeatureState & {
  readonly initialized: boolean;
  readonly triggerCount: number;
  readonly updateCount: number;
  readonly completedCount: number;
  readonly cleaned: boolean;
};

const INITIAL_PLACEHOLDER_STATE: PlaceholderFeatureState = Object.freeze({
  initialized: false,
  triggerCount: 0,
  updateCount: 0,
  completedCount: 0,
  cleaned: false,
});

/**
 * These examples exercise SDK contracts only. They deliberately contain no
 * outcome calculation or commercial game mechanic.
 */
export abstract class PlaceholderFeature implements FeatureImplementation<PlaceholderFeatureState> {
  readonly version = "0.1.0";
  readonly stateVersion = "1.0.0";
  readonly failurePolicy: FeatureFailurePolicy = "blocking";
  protected state: PlaceholderFeatureState = { ...INITIAL_PLACEHOLDER_STATE };

  constructor(readonly id: FeatureManifestId) {}

  initialize(context: FeatureContext<PlaceholderFeatureState>): FeatureResult<PlaceholderFeatureState> {
    return createFeatureResult<PlaceholderFeatureState>({
      emittedEvents: [{ name: "feature-example:initialized", payload: { featureId: this.id } }],
      featureStateUpdates: [{ state: { ...context.featureState.read(), initialized: true, cleaned: false }, strategy: "replace" }],
      telemetry: { initialized: true },
    });
  }

  canTrigger(): boolean { return true; }

  trigger(context: FeatureContext<PlaceholderFeatureState>): FeatureResult<PlaceholderFeatureState> {
    const triggerCount = context.featureState.read().triggerCount + 1;
    return createFeatureResult<PlaceholderFeatureState>({
      triggered: true,
      emittedEvents: [{ name: "feature-example:triggered", payload: { featureId: this.id, triggerCount } }],
      animationCommands: [{
        id: animationId(`${context.roundId}:${context.eventId}:${this.id}:example`),
        type: "feature-example",
        durationMs: 1,
        payload: { featureId: this.id, triggerCount },
        skippable: true,
        blocking: false,
        metadata: { example: true, production: false },
      }],
      featureStateUpdates: [{ state: { triggerCount }, strategy: "merge" }],
      telemetry: { triggerCount },
    });
  }

  update(context: FeatureContext<PlaceholderFeatureState>, deltaMs: number): FeatureResult<PlaceholderFeatureState> {
    const updateCount = context.featureState.read().updateCount + 1;
    return createFeatureResult<PlaceholderFeatureState>({
      featureStateUpdates: [{ state: { updateCount }, strategy: "merge" }],
      telemetry: { updateCount, deltaMs },
    });
  }

  serialize(): PlaceholderFeatureState { return structuredClone(this.state); }

  deserialize(state: PlaceholderFeatureState): void { this.state = structuredClone(state); }

  completeRound(context: FeatureContext<PlaceholderFeatureState>): FeatureResult<PlaceholderFeatureState> {
    return createFeatureResult<PlaceholderFeatureState>({
      featureStateUpdates: [{ state: { completedCount: context.featureState.read().completedCount + 1 }, strategy: "merge" }],
      telemetry: { completed: true },
    });
  }

  cleanup(context: FeatureContext<PlaceholderFeatureState>): FeatureResult<PlaceholderFeatureState> {
    return createFeatureResult<PlaceholderFeatureState>({
      emittedEvents: [{ name: "feature-example:cleaned", payload: { featureId: this.id } }],
      featureStateUpdates: [{ state: { cleaned: true }, strategy: "merge" }],
      telemetry: { cleaned: true },
    });
  }
}

export class ShortcutFeature extends PlaceholderFeature { constructor() { super(featureIds.shortcut); } }
export class ClampFeature extends PlaceholderFeature { constructor() { super(featureIds.clamp); } }
export class FiveStarFeature extends PlaceholderFeature { constructor() { super(featureIds.fiveStar); } }
export class StickyWildFeature extends PlaceholderFeature { constructor() { super(featureIds.stickyWild); } }
export class CollectorFeature extends PlaceholderFeature { constructor() { super(featureIds.collector); } }
export class HoldAndWinFeature extends PlaceholderFeature { constructor() { super(featureIds.holdAndWin); } }

export function createExampleFeatureRegistrations(): readonly FeatureRegistrationInput[] {
  return [
    { implementation: new ShortcutFeature(), manifest: SHORTCUT_FEATURE_SDK_MANIFEST },
    { implementation: new ClampFeature(), manifest: CLAMP_FEATURE_SDK_MANIFEST },
    { implementation: new FiveStarFeature(), manifest: FIVE_STAR_FEATURE_SDK_MANIFEST },
    { implementation: new StickyWildFeature(), manifest: STICKY_WILD_FEATURE_SDK_MANIFEST },
    { implementation: new CollectorFeature(), manifest: COLLECTOR_FEATURE_SDK_MANIFEST },
    { implementation: new HoldAndWinFeature(), manifest: HOLD_AND_WIN_FEATURE_SDK_MANIFEST },
  ];
}

export function createPlaceholderFeatures(): readonly FeatureImplementation[] {
  return createExampleFeatureRegistrations().map(({ implementation }) => implementation);
}

export function createMissingDependencyFeatureExample(): readonly FeatureRegistrationInput[] {
  const id = featureManifestId("missing-dependency-example");
  return [{
    implementation: new ConfigurableExampleFeature(id, "blocking"),
    manifest: featureManifest(id, "Missing Dependency Example", "Intentionally invalid dependency graph.", 10, [featureManifestId("absent-feature")]),
  }];
}

export function createCircularDependencyFeatureExample(): readonly FeatureRegistrationInput[] {
  const firstId = featureManifestId("cycle-alpha-example");
  const secondId = featureManifestId("cycle-beta-example");
  return [
    { implementation: new ConfigurableExampleFeature(firstId, "blocking"), manifest: featureManifest(firstId, "Cycle Alpha Example", "Intentionally invalid dependency graph.", 10, [secondId]) },
    { implementation: new ConfigurableExampleFeature(secondId, "blocking"), manifest: featureManifest(secondId, "Cycle Beta Example", "Intentionally invalid dependency graph.", 10, [firstId]) },
  ];
}

export function createConflictingFeatureExample(): readonly FeatureRegistrationInput[] {
  const firstId = featureManifestId("conflict-alpha-example");
  const secondId = featureManifestId("conflict-beta-example");
  return [
    { implementation: new ConfigurableExampleFeature(firstId, "blocking"), manifest: featureManifest(firstId, "Conflict Alpha Example", "Intentionally invalid conflict graph.", 10, [], [secondId]) },
    { implementation: new ConfigurableExampleFeature(secondId, "blocking"), manifest: featureManifest(secondId, "Conflict Beta Example", "Intentionally invalid conflict graph.", 20) },
  ];
}

export function createFailureFeatureExample(
  failurePolicy: FeatureFailurePolicy,
  id = featureManifestId(`${failurePolicy}-failure-example`),
): FeatureRegistrationInput {
  return {
    implementation: new FailingExampleFeature(id, failurePolicy),
    manifest: featureManifest(id, `${failurePolicy} Failure Example`, "Deliberately throws so host failure policy can be inspected.", 5, [], [], failurePolicy),
  };
}

class ConfigurableExampleFeature extends PlaceholderFeature {
  override readonly failurePolicy: FeatureFailurePolicy;
  constructor(id: FeatureManifestId, policy: FeatureFailurePolicy) { super(id); this.failurePolicy = policy; }
}

class FailingExampleFeature extends ConfigurableExampleFeature {
  override trigger(): FeatureResult<PlaceholderFeatureState> {
    throw new Error(`Deliberate ${this.failurePolicy} Feature SDK example failure`);
  }
}

function featureManifest(
  id: FeatureManifestId,
  name: string,
  description: string,
  priority: number,
  dependencies: readonly FeatureManifestId[] = [],
  conflicts: readonly FeatureManifestId[] = [],
  failurePolicy: FeatureFailurePolicy = "blocking",
): FeatureManifest {
  return {
    manifestType: "feature",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id,
    name,
    version: "0.1.0",
    description,
    supportedEngineIds: [FEATURE_SDK_EXAMPLE_ENGINE_ID],
    dependencies,
    optionalDependencies: [],
    conflicts,
    failurePolicy,
    priority,
    deterministic: true,
    stateVersion: "1.0.0",
    metadata: exampleMetadata,
  };
}
