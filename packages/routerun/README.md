# RouteRun Engine 001

`@hustle/routerun` is Hustle Engine's first reusable commercial mechanic package. It models a configurable rectangular board, explicit directional tiles, one deterministic Runner, generic overlays, immutable clearing, four-direction cascades, externally supplied refill data, generic expansion, feature hook boundaries, Outcome Studio events, data-only animation commands, and versioned recovery.

RouteRun is not a game pack. It contains no Night Drop theme, character, story, feature branding, commercial mathematics, RNG generation, wallet handling, production Stake payloads, renderer, final artwork, or audio.

## Package entry points

- `board/` owns coordinates, cells, board construction, validation, modelling, and serialization.
- `tiles/` owns route families, explicit connections, rotation, one-way rules, and templates.
- `route/` owns deterministic traversal, previews, junction resolution, terminal reasons, and divergence comparison.
- `spatial/` owns renderer-neutral world routes, reusable road-piece and obstacle grammar, branch/rejoin geometry, deterministic three-lane presentation controls, versioned runner snapshots, bounded streaming windows, cue and obstacle placement, validation, composition, and deterministic signatures.
- `runner/` owns legal placement and immutable Runner movement state.
- `overlays/` owns generic collection data and registries.
- `cascade/` owns ordered clearing, compaction, and injected deterministic refill.
- `expansion/` owns sealed-cell activation and safe board growth.
- `features/` exposes safe hook projections into the existing Hustle Feature SDK.
- `outcomes/` adapts RouteRun events into the existing Outcome Studio format.
- `recovery/` owns the RouteRun portion of versioned snapshots and validation.
- `debug/` supplies the read-only projection used by Hustle Core's shared Debug Panel.
- `examples/` contains 15 non-production diagnostic scenarios.

The public `RouteRunEngine` coordinates these modules and exposes initialize, board loading, Runner placement, preview, resolve, play, clear, cascade, expansion, continuation, interrupt, snapshot, restore, reset, dispose, and inspection operations.

## Determinism boundary

RouteRun never calls `Math.random()`. Junction exits arrive as explicit ordered instructions; an optional fallback uses a documented stable cardinal priority. Refill values arrive through `RefillProvider`. All state changes, movement, collections, clearing, compaction, refills, expansions, events, and animation commands are ordered data.

Spatial presentation routes follow the same rule. They contain ordered segment definitions and cue positions and produce the same sampled centre line and signature on every composition. They do not select or alter the paid outcome.

The road-piece grammar provides straights, left/right corners, T-junctions, crossroads, alleys, bridges, up/down ramps, tunnels, rooftops, dead ends and destinations. It expands into ordinary spatial segment data and has no renderer dependency.

Spatial obstacles are authored data rather than renderer objects. Barriers, low signs, gaps, ramps, traffic and route blockers resolve to stable route distances, lanes, required presentation actions and reaction windows. Their clear/hit records are deterministic and snapshot-safe. A missed obstacle never changes the composed route, cue order, terminal state or paid result.

The spatial runner controller records lane, jump, slide, dodge, obstacle interaction and presentation-branch commands in a stable order. A branch may be declared as a fork, T-junction or crossroads, with an explicit decision window and deterministic default. Alternatives turn away, hold a distinct street and turn back at an authored rejoin phase. These commands only alter the way an already-resolved journey is shown; they cannot alter route cues, collections, prize value or the paid result. Snapshot restoration validates both route id and deterministic signature before recovering exact presentation progress, input history and cleared/hit obstacles, and route windows expose only the nearby segment ids a renderer needs to keep active.

`interpretSpatialRunnerSwipe()` is the renderer-neutral mobile input boundary. It converts a completed pointer gesture into the existing deterministic dodge, jump or slide command vocabulary, while rejecting taps, slow drags and ambiguous diagonals. Games remain responsible for pointer capture and visual feedback. During an open junction, a game may map horizontal swipes onto the already-authored presentation alternatives; the selected street must still rejoin the same resolved journey.

The currently approved runner response profile is documented in [RouteRun Runner Foundation](../../docs/architecture/ROUTERUN_RUNNER_FOUNDATION.md). Those values are presentation defaults rather than game mathematics.

See [the full RouteRun architecture guide](../../docs/engines/ROUTERUN.md).
