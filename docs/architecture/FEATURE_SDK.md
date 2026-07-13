# Hustle Feature SDK

## Purpose and scope

The Hustle Feature SDK is Hustle Core's engine-neutral plugin boundary for reusable gameplay features. A commercial engine can register, validate, execute, persist, recover, and inspect features without importing or branching on their concrete classes.

Features are plugins because reusable mechanics evolve independently from engines and game packs. The boundary gives each feature a stable identity, explicit compatibility rules, deterministic lifecycle, versioned state, and observable events. Engines coordinate those contracts; they do not need feature-specific code.

The SDK is client-side presentation architecture. It does not generate wagering outcomes, replace Stake Engine, or certify mathematics.

## Executable implementation and manifest metadata

A feature is intentionally split into two parts:

| Part | Responsibility |
| --- | --- |
| `FeatureManifest` | Versioned descriptive data: ID, name, version, description, supported engines, dependencies, conflicts, priority, deterministic declaration, state version, and metadata. |
| `Feature` implementation | Executable lifecycle behavior: initialize, evaluate eligibility, return a trigger result, update, serialize, deserialize, and clean up. |

Manifests contain no executable gameplay or presentation code. Implementations do not redefine their compatibility contract. Registration always pairs one implementation with one manifest and rejects mismatched IDs or versions before the pair can enter the active registry.

This separation allows the Manifest System to inspect and compose an engine without loading feature code, while the Feature SDK can prove that the code it runs matches the selected composition.

## Architectural components

The SDK lives in `packages/core/src/features/` and is divided into small, engine-neutral modules:

- feature contracts, context, state, results, errors, and typed events;
- dependency, conflict, compatibility, and deterministic ordering validation;
- a registry for implementation/manifest pairs and enabled state;
- a runner for lifecycle execution and failure policy;
- stable, versioned serialization, recovery, and migration contracts;
- a read-only debug adapter for the Hustle Debug Panel;
- non-production placeholder examples.

The registry owns registration and configuration. The runner owns execution. The serializer owns persistence. A commercial engine remains responsible for applying returned commands and shared-state proposals through its normal controller boundary.

## Feature context and results

Every lifecycle call receives a controlled context supplied by the host. It contains the round ID, event ID, engine ID, game ID, lifecycle state, round data, shared presentation state, read-only feature-state access, a deterministic random source, an event publisher, an externally supplied timestamp or logical tick, and metadata.

The context must not expose arbitrary mutation of controller or game state. A feature communicates through an explicit result containing, as applicable:

- whether it triggered;
- emitted events;
- animation-command data for the controller to schedule;
- feature-local state updates;
- shared-state proposals for the controller to validate and apply;
- warnings and deterministic telemetry;
- continuation instructions;
- structured failure information.

A feature never starts a UI animation directly. Animation commands remain serializable data and are executed by the existing animation orchestration boundary.

## Deterministic execution

For the same context, registered and enabled feature set, initial feature states, and supplied deterministic values, the SDK must produce the same ordered output.

Ordering is a stable topological sort:

1. Required dependencies always execute before their dependants.
2. Among features whose dependencies are satisfied, lower numeric priority executes first.
3. Equal priorities are ordered by feature ID using an ASCII lexical comparison.

Dependency precedence is absolute. A dependency still runs first when its numeric priority would otherwise place it later. Registration order, object insertion order, locale-sensitive comparison, and asynchronous completion timing must not affect the result.

`canTrigger()` must be deterministic and free of side effects. Lifecycle methods must not call `Math.random()`, read the wall clock, or depend on uncontrolled ambient state. Any random value comes from the context's deterministic random-source interface. Time is an external logical tick or supplied timestamp.

The runner evaluates and executes eligible features sequentially in the resolved order unless a future contract explicitly defines a deterministic parallel model. Cleanup runs in predictable reverse execution order.

## Dependencies, conflicts, and compatibility

Required dependencies must be registered, compatible with the selected engine, enabled when their dependant is enabled, and free of cycles. Optional dependencies do not prevent registration when absent; when present, their ordering and compatibility are still validated.

Two enabled features with an active conflict cannot share one runtime composition. A feature that is incompatible with the selected engine cannot be registered into that engine runtime. Dependency failures, cycles, conflicts, unsupported versions, and incompatible engines produce structured SDK errors and corresponding typed events.

Bulk registration and scenario loading should validate a candidate set before replacing the active set. Failed validation leaves the previously valid registry untouched.

## Lifecycle

The runner supports the following lifecycle:

1. **Registry initialization** validates implementation/manifest pairs, compatibility, dependencies, conflicts, and deterministic order.
2. **Per-round initialization** prepares enabled features for one round without carrying accidental work across rounds.
3. **Trigger evaluation** calls `canTrigger()` in resolved order.
4. **Ordered execution** calls `trigger()` for eligible features and returns explicit results.
5. **Update** advances features from an externally supplied deterministic delta or tick.
6. **Interruption** stops new feature work and records recoverable runtime state.
7. **Snapshot** captures the exact feature runtime required for recovery.
8. **Recovery** transactionally restores a compatible snapshot without replaying completed executions.
9. **Round completion** records completion before cleanup.
10. **Cleanup** releases per-round resources in a predictable order, including after failures.

Cleanup is guaranteed through the runner's failure path. A feature must make cleanup idempotent because interruption, recovery failure, or host teardown may request it after partial initialization.

## Blocking and non-blocking failures

Every feature declares or is registered with a clear failure policy:

- A **blocking** feature uses fail-fast behavior. Its structured failure stops subsequent feature execution for that lifecycle operation and returns control to the engine controller. The engine decides whether to fail, interrupt, or recover the round.
- An explicitly **non-blocking** feature uses isolate-and-report behavior. Its failure is recorded, its safe cleanup is attempted, and independent later features may continue in deterministic order.

Non-blocking is opt-in; an unspecified policy must never silently swallow a failure. Required dependants of a failed feature cannot execute as though their dependency succeeded. All failures include the feature ID, lifecycle phase, error code, recoverability, and original cause where safe. Cleanup failures are reported without replacing the primary failure.

## Typed events

The SDK publishes engine-neutral events through Hustle Core for:

- feature registered and removed;
- feature enabled and disabled;
- feature initialized, triggered, completed, skipped, and failed;
- feature state serialized and restored;
- feature cleanup completed;
- dependency validation failed;
- conflict detected.

Events are suitable for lifecycle observation, telemetry, the Debug Panel, and tests. They are not a source of wagering truth. Subscribers must attach before loading a feature set if they need the initial registration events.

## Serialization and recovery

Feature state is JSON-safe, stable, and versioned. Each snapshot entry contains:

- feature ID and implementation version;
- state version;
- enabled status;
- serialized feature-local state;
- lifecycle status;
- execution count;
- last execution order;
- warnings or recoverable errors.

Snapshot creation emits state-serialized events. Recovery first parses and validates the complete candidate snapshot, including schema, duplicate IDs, implementation versions, state versions, dependencies, conflicts, and engine compatibility. Only then may it change the active runtime.

A failed recovery leaves the existing valid runtime untouched. A successful recovery restores enabled flags, lifecycle and feature state, execution counters, and completion markers. Completed executions remain completed and are not replayed.

Feature recovery data is coordinated with the Hustle Core recovery snapshot so lifecycle, animation queue, and feature state describe the same interruption point. Hosts must not restore one side while silently retaining a different version of the other.

### State migrations

State migrations are explicit, deterministic functions from one state version to the next. A migration declares its feature ID, source version, target version, and transformation. It must be pure, JSON-safe, ordered, and tested with representative old snapshots.

The recovery layer may apply a complete migration chain before validation and commit. If no complete chain exists, migration throws, or the migrated value fails validation, recovery is rejected atomically. Migrations never reinterpret a wagering outcome or introduce game rules.

## Consuming features from a commercial engine

A commercial engine integrates the SDK through the same sequence:

1. Resolve its game composition through the Manifest System.
2. Load only implementations for the resolved feature manifests.
3. Register each implementation together with its matching manifest.
4. Validate engine compatibility, versions, dependencies, conflicts, and execution order.
5. Create a controlled context for the current round or event.
6. Run initialization, eligibility, trigger, and update through the feature runner.
7. Validate and apply returned commands or state proposals through the engine controller.
8. Include feature state in interruption and recovery snapshots.
9. Expose the read-only feature debug adapter to the Hustle Debug Panel in development builds.
10. Complete the round and clean up through the runner.

An engine must not switch on concrete feature class names. It may depend only on SDK contracts, manifests, explicit results, and typed events.

## Creating a reusable feature

To add a feature:

1. Choose a permanent, globally unique lowercase feature ID.
2. Create a `FeatureManifest` with semantic versions, supported engine IDs, required and optional dependencies, conflicts, ascending priority, deterministic declaration, state version, failure policy metadata, and a clear description.
3. Implement the generic feature contract without importing an engine or game pack.
4. Keep state private, minimal, JSON-safe, and versioned.
5. Read only controlled context data and return explicit results.
6. Use the supplied deterministic random source and logical time.
7. Make initialization and cleanup safe under interruption and partial failure.
8. Register the implementation with its manifest and resolve the order before executing it.
9. Add tests for registration, compatibility, ordering, eligibility, results, failure policy, cleanup, serialization, recovery, and migrations.
10. Inspect it in the Engine Playground before an engine adopts it.

Reviewers should reject a feature that mutates engine state directly, starts animations, uses `Math.random()`, stores non-serializable objects, hides a dependency, changes order through registration timing, or contains game-pack presentation.

## Debugging and inspection

The Engine Playground provides a Features workspace for loading the illustrative feature set, enabling and disabling features, executing eligible features, comparing repeated deterministic runs, serializing and restoring state, clearing runtime state, and exercising dependency, cycle, conflict, blocking-failure, and non-blocking-failure scenarios.

The Feature SDK debug adapter supplies the existing Hustle Debug Panel with registered implementations, matching manifests, enabled status, resolved order, lifecycle, execution counts, serialized state, recent events, warnings, and errors. It is read-only and contains no game-specific behavior.

## Placeholder examples

`ShortcutFeature`, `ClampFeature`, `FiveStarFeature`, `StickyWildFeature`, `HoldAndWinFeature`, and `CollectorFeature` are non-production architectural examples. Their behavior is limited to deterministic counters, named events, simple command data, and telemetry. Every example has a matching `FeatureManifest`.

The names describe intended extension points, not implemented mechanics. They must not be presented as production features.

## What remains outside the Feature SDK

The SDK must not contain:

- RouteRun board, route, cascade, expansion, overlay, or bonus logic;
- Night Drop theme, feature configuration, assets, or presentation;
- reels, clusters, symbols, paylines, wins, awards, or real mechanic behavior;
- certified math, RTP models, RNG, probability selection, or wagering decisions;
- Stake Engine sessions, wallet operations, round APIs, or production transport schemas;
- DOM rendering, PixiJS scenes, direct UI animation execution, final art, or audio playback;
- network-based plugin discovery or file watching.

Reusable mechanic behavior belongs in its commercial engine package once specified. Game-specific configuration and presentation belong in the game pack. Operator and outcome authority remains on the server side.
