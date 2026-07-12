# Hustle Feature SDK

The Hustle Feature SDK is the engine-neutral plugin layer for reusable commercial-engine capabilities. It lets an engine register, discover, order, execute, disable, serialize, restore, and clean up features without importing their concrete implementations.

Task 003 defines architecture only. The included `ShortcutFeature`, `ClampFeature`, `FiveStarFeature`, `StickyWildFeature`, `HoldAndWinFeature`, and `CollectorFeature` are lifecycle placeholders. They do not contain game rules, win calculations, symbols, reel behavior, RTP logic, or wagering logic.

## Build a feature

Implement the `Feature` interface and provide immutable metadata:

```ts
import {
  featureId,
  type Feature,
  type FeatureContext,
  type FeatureMetadata,
  type FeatureState,
} from "@hustle/core";

interface ExampleState extends FeatureState {
  readonly triggerCount: number;
}

export class ExampleFeature implements Feature<ExampleState> {
  readonly metadata: FeatureMetadata = {
    id: featureId("example"),
    name: "Example Feature",
    version: "1.0.0",
    description: "A reusable example feature.",
    supportedEngines: ["routerun"],
    dependencies: [],
    priority: 50,
  };

  private state: ExampleState = { triggerCount: 0 };

  initialize(_context: FeatureContext): void {}
  canTrigger(_context: FeatureContext): boolean { return true; }
  trigger(_context: FeatureContext): void {
    this.state = { triggerCount: this.state.triggerCount + 1 };
  }
  update(_context: FeatureContext, _deltaMs: number): void {}
  serialize(): ExampleState { return { ...this.state }; }
  deserialize(state: ExampleState): void { this.state = { ...state }; }
  cleanup(_context: FeatureContext): void {}
}
```

Keep feature state JSON-safe and deterministic. Do not store DOM nodes, functions, class instances, timers, random generators, or transport clients inside serialized state.

## Register and load

Use `FeatureLoader` to load feature instances or factories sequentially:

```ts
const registry = new FeatureRegistry();
await new FeatureLoader().load(registry, [
  () => new ExampleFeature(),
  () => import("./another-feature.js").then(({ AnotherFeature }) => new AnotherFeature()),
]);
```

Registration rejects duplicate IDs. Loading validates that every declared dependency exists and that no dependency cycle is present.

## Deterministic execution

The registry calculates one stable topological order:

1. dependencies always execute before dependants;
2. otherwise, higher priority executes first;
3. equal priority uses registration order;
4. feature ID is the final stable tie-breaker.

Initialization, trigger evaluation, triggering, and updates use that order. Cleanup uses its reverse. `canTrigger()` must be deterministic for the same context and state. A feature must never generate or alter a real-money outcome in the presentation client.

## Context and events

`FeatureContext` supplies an engine ID, deterministic tick, JSON-safe input, a feature-event emitter, and read-only access to serialized dependency state. Engine adapters should construct it with `createFeatureContext()`.

Feature events are ordered with a monotonic sequence number. They are suitable for debug inspection and deterministic presentation orchestration, not outcome generation.

## Serialize and restore

`FeatureSerializer` produces a versioned snapshot containing engine ID, feature ID, feature implementation version, enabled state, and JSON-safe state. Restoration rejects unknown features, duplicate IDs, invalid schema versions, dependency violations, and feature-version mismatches.

Feature migrations are intentionally out of scope for Task 003. Change a feature version whenever its serialized state shape becomes incompatible; add an explicit migration layer before accepting older snapshots.

## Compatibility and disabling

Use `supportedEngines` to declare compatibility. `"*"` means engine-agnostic. Discovery and execution can be scoped to an engine ID. Disabling a required dependency while its dependant remains enabled makes execution invalid by design; either disable dependants first or keep the dependency active.

## Design rules

- Feature IDs are permanent and globally unique inside Hustle Engine.
- Metadata is descriptive; concrete game packs must not redefine shared feature behavior.
- Serialized state must be JSON-safe and free of currency floats.
- The frontend presents server-provided outcomes and never controls wagering results.
- Placeholder implementations must not be mistaken for production-ready mechanics.
- New features require registration, ordering, lifecycle, cleanup, and round-trip serialization tests.
