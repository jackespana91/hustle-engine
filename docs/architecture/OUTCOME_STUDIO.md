# Outcome Studio MVP

Outcome Studio is Hustle Core's engine-neutral authoring, validation, playback, recording, replay, and inspection layer for deterministic round outcomes. It treats an outcome as versioned serializable data rather than executable game logic.

The same valid outcome, initial state, feature set, and deterministic source must produce the same normalized event order, feature execution order, animation-command order, state transitions, final presentation state, and replay record. Ambient time, registration order, locale-sensitive sorting, network responses, and `Math.random()` are not ordering inputs.

## Ownership and boundaries

`packages/core/src/outcomes` owns the reusable contracts and runtime. `apps/engine-playground/src/outcome-studio` is a development host that renders forms, timelines, inspection data, and playback controls. Commercial engines can later translate generic event payloads and animation hints into mechanic-specific presentation without changing the outcome pipeline.

Stake Engine remains responsible for operator sessions, wallet operations, RNG, and round APIs. A future mathematics service may produce an `OutcomeDefinition` after independently certified evaluation. The Stake adapter may translate the operator response into that definition. Outcome Studio consumes or authors representative data; it does not decide a real-money result.

```text
Maths/RGS or development fixture
              |
              v
      OutcomeDefinition
              |
      validate + normalize
              |
              v
        OutcomePlayer
       /      |       \
Feature SDK  Events  Animation commands
       \      |       /
        RoundController
              |
      recorder + snapshots
              |
              v
       ReplayRecord + diff
```

## Outcome data

`OutcomeDefinition` is schema-versioned and includes outcome and round identity, engine/game references, a deterministic source, integer minor-unit bet and win amounts, ordered events, expected final state, tags, and metadata. Events contain a stable ID, sequence, logical tick, type, payload, flow flags, optional feature reference, dependencies, expected state changes, animation hints, optional asset/theme references, and metadata.

Money is always a non-negative safe integer in minor units. Floating-point currency is rejected.

The validator returns structured errors and warnings. It checks schema support, IDs and references, unique event IDs, sequence continuity, stable logical-tick order, safe money values and declared totals, dependencies and cycles, feature/asset/theme references when resolvers are supplied, deterministic ordering, and expected final-state compatibility. Validation never mutates the source document.

## Builder and registry

`OutcomeBuilder` provides transactional create, identity, engine/game, bet, total, event add/insert/update/remove/reorder, dependency, expected-state, clone, snapshot, and finalize operations. Each operation validates its candidate before replacing the builder's current document, so a failed edit preserves the previous valid document.

`OutcomeRegistry` registers validated definitions and provides lookup, filtering, stable listing, snapshots, clearing, and atomic replacement. Bulk registration and replacement stage the complete change before publishing it; a rejected candidate leaves the registry unchanged.

`OutcomeLoader` and the serializer provide safe JSON parsing, stable key ordering, outcome round-trips, replay round-trips, and explicit version checks. Registry snapshots contain data only.

## Deterministic playback

`OutcomePlayer` validates and normalizes an outcome, initializes the existing `RoundController`, invokes compatible Feature SDK hooks, builds a complete deterministic animation plan, and runs it through the existing interruptible animation queue. Core emits typed lifecycle, event, recording, replay, and comparison notifications without importing RouteRun or a game pack.

Event ordering is sequence-first after validation. Dependencies must point to already-resolved events. Feature ordering uses the Feature SDK's stable dependency/priority/ID rules. Animation commands retain outcome/event identity in metadata, allowing the player to update state precisely at event boundaries.

The host owns resource preparation and animation execution. An optional asset preparation failure is recorded as a warning and playback continues. A required preparation failure or animation executor failure is recorded as a structured playback error.

## Recording and replay

`OutcomeRecorder` captures the normalized outcome, event publications, feature executions, planned and completed animation commands, controller transitions, interruptions, recoveries, warnings, errors, snapshots, final state, and logical or externally supplied clock values. It produces a versioned `OutcomeReplayRecord` that can be serialized without a network call.

`OutcomeReplay` supports:

- full deterministic replay;
- replay from a selected event boundary;
- replay from a recovery snapshot;
- replay-version compatibility checks;
- replay comparison and divergence events.

Boundary replay reconstructs presentation state through the omitted prefix before executing the selected suffix. Recovery restores completed, active, and pending identities from the snapshot. Completed commands remain audit data and never return to the pending queue.

## Snapshots and recovery

The existing recovery snapshot can include a backward-compatible `outcomeRuntime` extension containing outcome identity/version, event index, completed and pending event IDs, active event, replay reference, logical tick, and comparator state. Feature state and animation state use the same interruption boundary.

Restoration validates snapshot and outcome compatibility before mutation. This prevents a snapshot for one outcome or schema version from being applied to another.

## Comparison and divergence

`OutcomeComparator` compares expected and actual event order, animation order, feature execution order, transition history, and final state. It can compare an outcome to a replay or two replay records. Results include a stable list of structured differences and the first divergence category, path, index, expected value, actual value, and message.

The Playground Inspector and Debug Panel expose both the summary status and first divergence so deterministic regressions are visible without reading raw logs.

## Playground workflow

Run `npm run dev` and open the Vite URL. The Outcome Studio workspace provides:

- a searchable scenario library with engine, game, and tag filters;
- blank creation, duplication, JSON import, and stable JSON export;
- form-based outcome metadata and event editing;
- ordered event cards with move, clone, and remove controls;
- validate, play, pause, resume, skip, interrupt, recover, and replay controls;
- expected/actual state, feature, command, transition, comparison, and divergence inspection;
- a live playback console and OUTCOME/REPLAY sections in the reusable Debug Panel.

The included scenarios are non-production fixtures: small/medium/large and zero-win successes, interruption/recovery, placeholder-feature execution, optional and required asset failure, animation failure, malformed data, invalid ordering, and a deliberate expected-state divergence.

## What this MVP does not do

Outcome Studio is not a certified mathematics simulator, RNG, RTP evaluator, wallet, operator console, real Stake API client, RouteRun implementation, Night Drop implementation, final-art pipeline, or full no-code game editor. Its scenario outcomes and feature implementations are illustrative only. Production maths, probability, paytable, jurisdictional, and operator behavior require separate design, certification, and review.

The form editor intentionally handles a useful deterministic subset. Complex mechanic-specific payload schemas, visual graphs, collaborative editing, production persistence, access control, and large-record streaming remain future work.
