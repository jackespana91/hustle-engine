# RouteRun Engine 001

`@hustle/routerun` is Hustle Engine's first reusable commercial mechanic package. It models a configurable rectangular board, explicit directional tiles, one deterministic Runner, generic overlays, immutable clearing, four-direction cascades, externally supplied refill data, generic expansion, feature hook boundaries, Outcome Studio events, data-only animation commands, and versioned recovery.

RouteRun is not a game pack. It contains no Night Drop theme, character, story, feature branding, commercial mathematics, RNG generation, wallet handling, production Stake payloads, renderer, final artwork, or audio.

## Package entry points

- `board/` owns coordinates, cells, board construction, validation, modelling, and serialization.
- `tiles/` owns route families, explicit connections, rotation, one-way rules, and templates.
- `route/` owns deterministic traversal, previews, junction resolution, terminal reasons, and divergence comparison.
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

See [the full RouteRun architecture guide](../../docs/engines/ROUTERUN.md).
