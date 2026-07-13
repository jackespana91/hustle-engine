# Architecture

This directory records Hustle Engine architecture decisions, package boundaries, diagrams, and implementation plans.

The [`Engine Manifest System`](MANIFEST_SYSTEM.md) guide documents versioned engine and game composition, validation, deterministic resolution, transactional reloads, and schema evolution.

The [`Hustle Feature SDK`](FEATURE_SDK.md) guide documents manifest-backed plugins, controlled execution, dependency and conflict handling, deterministic ordering, failure isolation, recovery, state migrations, and commercial-engine integration.

## Task 001 data flow

```text
Mock Stake-style response
        |
        v
packages/stake-adapter  -- validates mock transport data
        |
        v
RoundOutcome            -- engine-neutral, integer micro-units
        |
        v
RoundController         -- explicit lifecycle and event publication
        |
        v
AnimationCommand[]      -- deterministic presentation data
        |
        v
AnimationQueue          -- executor boundary, pause/skip/interrupt/recover
        |
        v
engine-playground       -- rectangles, counters and text only
```

## Boundaries

- Stake Engine owns operator-side sessions, wallets, RNG, and round APIs. Task 001 does not implement those services.
- `packages/stake-adapter` owns mocked transport validation and translation. Its schema is explicitly not a production Stake API claim.
- `packages/core` has no Stake response knowledge. It owns contracts, lifecycle, events, command generation, presentation orchestration, errors, and recovery.
- Animation commands are serializable data. UI-specific execution remains outside core.
- Recovery snapshots are versioned. Completed commands remain recorded and are never returned to the pending queue.
- Money uses non-negative safe integer micro-units. No floating-point currency assumptions are allowed.
- RouteRun remains a future reusable mechanic package and is not implemented by Task 001.
- Night Drop remains a future consumer game pack and contains no Task 001 logic.

## Recovery semantics

Interrupting aborts the active executor and places its command at the front of the pending queue because completion is not known. A snapshot captures completed, current, and pending commands plus round state, transition history, and presentation progress. Restoration validates version and structure, retains completed commands for inspection, and plays only current/pending work.

Reusable mechanic logic must never be implemented inside a game pack.

## Feature SDK boundary

The Feature SDK pairs executable feature implementations with descriptive `FeatureManifest` data. Commercial engines consume the generic registry, runner, context, result, serializer, and debug contracts; they do not import or branch on concrete feature classes.

Feature execution is a stable topological order. Required dependencies take precedence, then ready features use ascending numeric priority and ASCII feature ID. Registration order, locale-sensitive sorting, ambient time, and `Math.random()` cannot influence execution.

Features return serializable events, animation commands, state updates, and proposals for the controller to apply. They cannot mutate controller state or execute UI animations directly. Versioned feature snapshots participate in the same interruption point as lifecycle and animation recovery, and failed restoration leaves the existing runtime untouched.

## Task 002 debug boundary

`packages/core/src/debug-panel.ts` contains the reusable panel, its contracts, telemetry sampler, event buffer, keyboard shortcut, rendering, and scoped dark-mode styles. It depends only on browser APIs and engine-neutral debug data.

Each game supplies:

- a read-only `DebugPanelState` projection;
- safe `DebugPanelActions` callbacks for lifecycle and test operations;
- engine events through `recordEvent`.

This adapter boundary lets future games install the same panel without putting game-specific logic into Core. The panel cannot generate outcomes itself; testing callbacks remain owned by the host and must use the same validated outcome pipeline as normal rounds.
