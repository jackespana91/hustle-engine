# RouteRun Engine 001

## Purpose and boundary

RouteRun is Hustle Engine's reusable deterministic directional-route mechanic. A board contains explicitly connected route tiles; one Runner follows a complete predetermined legal route, collects generic overlays, clears traversed cells, receives externally supplied cascades/refills, and may continue after a refill or explicit expansion.

The package owns mechanic state and mechanic-to-Core adapters. Hustle Core continues to own lifecycle orchestration, the typed event bus, animation queue, Feature SDK, manifests, assets/themes, recovery envelope, Debug Panel, and Outcome Studio. RouteRun integrates with those systems and does not create parallel platform services.

Night Drop is intentionally absent. A future Night Drop game pack will configure RouteRun and provide theme, assets, copy, presentation, feature selection, and operator integration without placing reusable route logic inside the pack.

## Board and coordinate model

Coordinates are zero-based integer `{ row, column }` values. Their stable key is `row:column`; engine code never depends on pixels. The initial board is a configurable rectangle with width, height, one cell per coordinate, entries, destinations, gravity, maximum cascade count, and metadata. Five-by-five is supported but not hardcoded.

Cells have stable IDs and one of five states: `active`, `empty`, `sealed`, `blocked`, or `reserved`. A cell may contain one route tile, zero or more generic overlays, optional destination data, and metadata. Board operations return new definitions; the original board remains available for replay and comparison.

## Route tile grammar

The supported families are straight, bend, T-junction, cross-junction, one-way, destination, entry, blocker, and empty. Tiles declare cardinal north, east, south, and west connections explicitly. Rotation transforms those connections in 90-degree increments. Artwork is never used to infer movement.

A structural connection must be present on both neighbouring tiles. One-way tiles then apply a separate allowed-entry/allowed-exit rule during traversal. Sealed and blocked cells are never traversable.

## Deterministic junction rules

RouteRun does not ask the player to choose a path and does not generate randomness. The supplied resolution map uses coordinate keys and ordered preferred exits. At a junction the resolver:

1. checks supplied directions in order;
2. chooses the first legal supplied exit;
3. fails clearly if instructions exist but none is legal;
4. when permitted, uses the configured stable fallback order;
5. records whether the decision was explicit, a single exit, or a fallback.

The default fallback priority is north, east, south, then west. Hosts may replace it or require explicit instructions by disabling fallback.

## Route solving and terminal state

The solver validates entry rules, follows reciprocal connections, enforces one-way traversal, rejects illegal board exits, detects revisits and loops, and applies a maximum-step ceiling. It returns every ordered route step and decision before presentation begins. Repeated resolution of the same board, Runner, instructions, and limits produces the same deterministic signature.

Supported terminal reasons are `dead-end`, `destination-reached`, `blocker`, `sealed-boundary`, `board-exit`, `invalid-connection`, `loop-detected`, `maximum-step-limit`, `interrupted`, and `failed`. A normal dead end is a visible round result, not an exception.

The controlled phases are idle, initializing, previewing, moving, collecting, clearing, cascading, expanding, checking-continuation, terminal, interrupted, recovering, completed, and failed. Illegal transitions report the current and requested phases.

## Runner and overlays

The Runner stores its ID, current coordinate, entry/current direction, movement status, visited cell IDs, collected overlay IDs, accumulated illustrative presentation value, and metadata. Placement must use a configured active entry or an explicitly retained legal position.

Generic overlay categories are standard reward, premium reward, instant value, progress, feature trigger, key, modifier, and custom. Collection is emitted strictly in route order. Persistence and remove-on-collect are explicit; the engine emits collection results and does not update UI directly. Values are illustrative presentation data, not certified mathematics.

## Clearing, cascades, and refill

Clearing produces an ordered before/after change set. Traversed movable tiles become empty, persistent tiles remain, persistent overlays remain, and destinations follow their retain-on-clear flag. Shared state is never mutated invisibly.

Cascades support down, up, left, and right gravity. Every line is processed in stable coordinate order, split around sealed, blocked, reserved, or immovable cells, compacted toward gravity, and refilled through a caller-owned `RefillProvider`. RouteRun never generates commercial RNG. The report contains every movement, refill placement, remaining empty coordinate, provider snapshot, and continuation hint. Both board and engine maximum-cascade limits are enforced.

## Expansion

Expansion definitions identify a stable ID, side, optional larger rectangular bounds, and ordered cell activations. Existing sealed or reserved cells can become active/empty, and new bounds initially create sealed cells. Validation prevents shrinkage, duplicate activations, active-coordinate replacement, and safety-limit breaches. Expansion reports and active expansion state are preserved in recovery snapshots.

## Feature SDK hooks

RouteRun exposes before/after hooks for board creation, route solving, Runner movement/steps, overlay collection, clearing, cascades, expansion, and terminal handling. The bridge receives a defensive mechanic projection containing only board, Runner, route, phase, coordinate/direction, outcome reference, and logical tick. It returns the existing Core `FeatureResult`; RouteRun consumes explicit animation commands, shared-state proposals, warnings, and continuation intent. It never imports a concrete commercial feature.

## Outcome Studio and animation integration

The RouteRun adapter translates mechanic activity to `routerun.*` Outcome Studio events: board initialization, Runner placement, resolution, preview, movement, collection, clearing, cascade, expansion, and terminal. The Playground sends its current timeline directly to Outcome Studio for deterministic playback and comparison. Route divergence compares ordered coordinates, entry/exit directions, tile IDs, and terminal reason.

RouteRun animation output is Core `AnimationCommand` data. Types cover route highlight, Runner enter/travel, overlay collection, tile clear/compact/refill, board expansion, and terminal state. The package imports no DOM, Canvas, PixiJS, Svelte, or rendering library.

## Snapshots and recovery

Snapshot schema version 1 stores engine version, original/current board, Runner, completed steps, active preview, collected overlays, completed cascades, pending refill/provider state, expansions, phase, outcome reference, logical tick, terminal state, completed-operation ledger, and pending animation data.

Recovery validates the complete candidate before changing live state. Unsupported schema/engine versions, duplicate operation/step/overlay/cascade records, unsafe boards, and invalid ticks are rejected while preserving the existing valid runtime. Stable operation IDs prevent completed steps, collections, clears, cascades, and expansions from executing twice.

## Manifest, assets, and theme boundary

The real development manifest is `engine.routerun`, named RouteRun, version `0.1.0`, engine type `route`. It declares Core compatibility, browser/mobile platforms, responsive orientations, required platform capabilities, supported hooks, determinism, and conservative performance budgets.

The package exposes logical aliases such as `routerun.tile.straight`, `routerun.runner.default`, and `routerun.effect.route-highlight`. It contains no final physical asset paths. The Playground's RouteRun Diagnostic theme uses CSS-safe colours, rectangles, and symbols only and is explicitly non-production.

## Default safety limits

| Limit | Default |
| --- | ---: |
| Board width | 16 |
| Board height | 16 |
| Active cells | 256 |
| Route steps | 256 |
| Overlays per cell | 12 |
| Cascades per round | 12 |
| Expansions per round | 8 |

Hosts may lower these values. Validators reject non-positive, non-integer, contradictory, or unsafe configurations before execution.

## Consuming RouteRun from a future game pack

1. Register the RouteRun engine manifest.
2. Resolve a game theme and physical assets against RouteRun's logical aliases.
3. Build or load a validated board and predetermined outcome instructions.
4. Initialize `RouteRunEngine` and supply a legal Runner placement.
5. Preview the route, then enqueue returned Core animation commands.
6. Present ordered movement and collection results through the game-pack renderer.
7. Apply clear, supplied refill/cascade, expansion, and continuation commands from the outcome.
8. Store RouteRun's snapshot inside the host's Core recovery boundary.

The game pack may change appearance and configuration. It must not reimplement reusable route solving, junction resolution, collection, clearing, cascades, expansion, or recovery.

## Diagnostic scenarios

The Playground includes straight, bend, explicit T-junction, dead-end, destination, overlay, clear/cascade, two-cascade continuation, sealed expansion, interrupted recovery, invalid reciprocal, illegal junction, loop, maximum-step, and mobile-readable 5×5 scenarios.

## Intentionally outside RouteRun

This MVP does not include Night Drop characters/story, Dash or Clamp gameplay, branded reward/features, Priority Run, Penthouse presentation, certified RTP, commercial outcome generation, bonus buying, wallet/session APIs, production Stake payloads, final art/audio, renderer code, or a no-code game builder. Production feature policy, operator payload mapping, audited mathematics, asset delivery, and game-pack presentation require separate review.
