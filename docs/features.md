# Hustle Feature SDK quick-start

The Feature SDK is Hustle Core's engine-neutral plugin layer. Commercial engines register an executable `FeatureImplementation` together with its descriptive `FeatureManifest`, then use `FeatureRunner` to execute it without importing concrete feature classes.

The complete design, recovery rules, and package boundaries are documented in [`architecture/FEATURE_SDK.md`](architecture/FEATURE_SDK.md).

## 1. Pair a manifest with an implementation

The manifest is authoritative for composition and compatibility. The implementation contains lifecycle behavior. Their ID, implementation version, state version, and failure policy must match exactly.

```ts
import {
  MANIFEST_SCHEMA_VERSION,
  createFeatureResult,
  engineManifestId,
  featureManifestId,
  type FeatureContext,
  type FeatureImplementation,
  type FeatureManifest,
  type FeatureResult,
  type FeatureState,
} from "@hustle/core";

const ENGINE_ID = engineManifestId("routerun-engine-001");
const FEATURE_ID = featureManifestId("example-feature");

export const EXAMPLE_FEATURE_MANIFEST: FeatureManifest = {
  manifestType: "feature",
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: FEATURE_ID,
  name: "Example Feature",
  version: "1.0.0",
  description: "Engine-neutral example used to demonstrate the SDK contract.",
  supportedEngineIds: [ENGINE_ID],
  dependencies: [],
  optionalDependencies: [],
  conflicts: [],
  failurePolicy: "blocking",
  priority: 100,
  deterministic: true,
  stateVersion: "1.0.0",
  metadata: { production: false },
};

type ExampleState = FeatureState & {
  readonly initialized: boolean;
  readonly triggerCount: number;
};

export class ExampleFeature implements FeatureImplementation<ExampleState> {
  readonly id = EXAMPLE_FEATURE_MANIFEST.id;
  readonly version = EXAMPLE_FEATURE_MANIFEST.version;
  readonly stateVersion = EXAMPLE_FEATURE_MANIFEST.stateVersion;
  readonly failurePolicy = EXAMPLE_FEATURE_MANIFEST.failurePolicy ?? "blocking";

  private state: ExampleState = { initialized: false, triggerCount: 0 };

  initialize(context: FeatureContext<ExampleState>): FeatureResult<ExampleState> {
    return createFeatureResult<ExampleState>({
      featureStateUpdates: [{
        state: { ...context.featureState.read(), initialized: true },
        strategy: "replace",
      }],
    });
  }

  canTrigger(context: FeatureContext<ExampleState>): boolean {
    return context.featureState.read().initialized;
  }

  trigger(context: FeatureContext<ExampleState>): FeatureResult<ExampleState> {
    const triggerCount = context.featureState.read().triggerCount + 1;
    return createFeatureResult<ExampleState>({
      triggered: true,
      emittedEvents: [{ name: "example:triggered", payload: { triggerCount } }],
      featureStateUpdates: [{ state: { triggerCount }, strategy: "merge" }],
      telemetry: { triggerCount },
    });
  }

  update(_context: FeatureContext<ExampleState>, _deltaMs: number): FeatureResult<ExampleState> {
    return createFeatureResult<ExampleState>();
  }

  serialize(): ExampleState { return structuredClone(this.state); }
  deserialize(state: ExampleState): void { this.state = structuredClone(state); }

  cleanup(_context: FeatureContext<ExampleState>): FeatureResult<ExampleState> {
    return createFeatureResult<ExampleState>();
  }
}
```

Lifecycle methods return explicit results. The runner applies feature-local updates and returns emitted events, animation-command data, shared-state proposals, warnings, telemetry, continuation instructions, and failures to the host. A feature never mutates controller state or executes an animation directly.

## 2. Register and execute

Use `registerMany()` when loading related features so their dependency graph is validated as one candidate set. Subscribe before registration when initial events matter.

```ts
import {
  FeatureRegistry,
  FeatureRunner,
  SequenceRandomSource,
  gameManifestId,
  type FeatureRunnerContextInput,
} from "@hustle/core";

const GAME_ID = gameManifestId("example-game-pack");
const registry = new FeatureRegistry({ engineId: ENGINE_ID });

registry.events.subscribe("feature:failed", ({ error }) => {
  console.error(error.code, error.message);
});

registry.registerMany([{
  manifest: EXAMPLE_FEATURE_MANIFEST,
  implementation: new ExampleFeature(),
}]);

const runner = new FeatureRunner(registry);
const context: FeatureRunnerContextInput = {
  roundId: "round-001",
  eventId: "event-001",
  engineId: ENGINE_ID,
  gameId: GAME_ID,
  currentLifecycleState: "presenting",
  roundData: { outcomeAlreadyProvidedByServer: true },
  sharedPresentationState: {},
  random: new SequenceRandomSource([0.25, 0.75]),
  logicalTick: 1,
  metadata: { source: "example" },
};

await runner.initializeRound(context);
const execution = await runner.execute(context);

// The engine controller validates and applies execution.result.
console.log(execution.executionOrder, execution.result.animationCommands);
```

Do not call `Math.random()` or read ambient time inside a feature. Random values and logical time come from the controlled context.

## 3. Deterministic ordering

The registry resolves one stable topological order:

1. required dependencies execute before their dependants;
2. among ready features, lower numeric priority executes first;
3. equal priorities use feature ID in ASCII lexical order.

Optional dependencies participate in ordering when present. Registration order and locale-sensitive comparison never affect execution. Disabling an enabled required dependency or enabling an active conflict is rejected.

## 4. Save and recover state

`FeatureSerializer` stores every registered feature's implementation version, state version, enabled status, lifecycle, state, execution count, last order, warnings, recoverable errors, and completed-execution IDs.

```ts
import { FeatureSerializer } from "@hustle/core";

const serializer = new FeatureSerializer();
const snapshotJson = serializer.serialize(registry, {
  engineId: ENGINE_ID,
  gameId: GAME_ID,
  roundId: context.roundId,
  eventId: context.eventId,
  logicalTick: context.logicalTick,
  executionLedger: runner.executionLedger,
}, true);

await registry.resetRuntimeState();
runner.clearExecutionLedger();

const restored = await serializer.restore(registry, snapshotJson, {
  engineId: ENGINE_ID,
  gameId: GAME_ID,
});
runner.restoreExecutionLedger(restored.executionLedger);
```

Restore validates and migrates the entire candidate before changing the live registry. Failure leaves the prior valid runtime intact. Restoring the execution ledger prevents completed work from replaying. Register deterministic state migrations with `serializer.registerMigration(...)` when supporting an older state version.

## Failure policy and cleanup

- `blocking` is fail-fast: the operation stops and control returns to the engine.
- `non-blocking` is opt-in isolation: the failure is reported and independent later features may continue.
- Required dependants do not execute as though a failed dependency succeeded.
- `runner.cleanup(...)` attempts cleanup in reverse deterministic order, including after failures.

## Events and debugging

The registry exposes the 14 typed Feature SDK events through Hustle Core's `TypedEventBus`. `FeatureDebugAdapter` provides a DOM-free projection of manifests, implementations, enabled state, order, serialized state, events, warnings, errors, and execution counts for the Hustle Debug Panel and Engine Playground.

The six exported example features and their manifests are non-production architecture fixtures only. They emit simple events, counters, commands, and telemetry; they implement no commercial mechanic.

## Rules for production features

- Keep IDs permanent, lowercase, kebab-case, and globally unique.
- Keep serialized state minimal, JSON-safe, and versioned.
- Return commands and state proposals; never render, animate, or mutate the engine directly.
- Keep RouteRun mechanics in `packages/routerun` and Night Drop presentation/configuration in `apps/night-drop`.
- Never implement wallet, RNG, wagering, certified math, RTP, or Stake transport behavior in this SDK.
- Add tests for binding validation, compatibility, ordering, lifecycle, failure policy, cleanup, serialization, recovery, and migrations.
