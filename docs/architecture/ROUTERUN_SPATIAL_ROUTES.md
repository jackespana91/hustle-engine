# RouteRun Spatial Routes

RouteRun spatial routes are a renderer-neutral projection layer for presenting a
deterministic board outcome as movement through a continuous world. They solve a
specific engine limitation exposed by the Night Drop runner spike: the logical
5×5 route was deterministic and reusable, but its 3D centre line was hard-coded
inside one game screen.

The spatial layer does not replace board traversal. RouteRun still resolves the
legal route, collections, continuation, terminal state, replay and recovery.
Spatial routes describe only how that resolved journey is staged in presentation
space.

## Data model

A `SpatialRouteDefinition` contains:

- a stable route id, name and description;
- a world-space start position and heading;
- ordered reusable segments;
- optional ordered presentation cues;
- optional ordered presentation obstacles;
- metadata owned by the consuming engine or game pack.

Segments define length, signed turn, signed elevation, width and semantic kind.
Available kinds cover streets, bends, junctions, alleys, tunnels, bridges,
ramps, rooftops and destinations. The composer samples those definitions into a
continuous centre line without importing Three.js, PixiJS or another renderer.

Cues attach generic presentation moments to a segment and normalized offset.
They include standard and premium pickups, continuation, shortcut, checkpoint,
destination and custom cues. A game pack decides what those cues look and sound
like.

Obstacles attach generic runner interactions to a segment and normalized offset.
The reusable kinds are barrier, low sign, gap, ramp, traffic and route blocker.
Composition resolves each obstacle to a deterministic distance, progress, blocked
lane, required action and reaction-open distance. A game pack owns the visual
geometry and feedback; RouteRun owns the ordered data and clear/hit record.

`createSpatialRoadPiece()` and `createSpatialRoadSequence()` provide a compact,
renderer-neutral grammar for straights, corners, T-junctions, crossroads,
alleys, bridges, up/down ramps, tunnels, rooftops, dead ends and destinations.
Each piece expands to normal `SpatialRouteSegmentDefinition` data, so games can
share route construction without sharing scenery, characters or renderer code.

## Determinism

`composeSpatialRoute()` performs no random work. The same definition always
produces the same samples, distances, headings, cue ordering, obstacle ordering
and deterministic signature. Definitions are validated before composition for
duplicate ids, unknown cue or obstacle targets, invalid lengths, turns,
elevations, widths, lanes, reaction windows and offsets.

Spatial recovery persists the definition id, deterministic signature, normalized
travel progress, lane, active action, presentation-branch selections, collected
cue ids, cleared/hit obstacle interactions and ordered command history. It never
persists renderer objects. A snapshot for another route or signature is rejected
before restoration.

## Presentation controls and branches

The `SpatialRunnerController` supports deterministic three-lane movement,
jump, slide, left/right dodge and explicit branch selection. Every command has
a stable id and timestamp; duplicates and lane-boundary commands are recorded
as rejected rather than silently changing state.

Branches contain an entry anchor, a rejoin anchor, a junction kind and ordered
alternatives. T-junctions expose left/right; crossroads expose
left/straight/right. Each branch also owns an explicit decision-open and
decision-close distance. A renderer can therefore show the physical junction
before Dash reaches it, accept one presentation choice during the stable
window, and fall back to the authored default when the player does nothing.

A selected alternative has three deterministic phases: turn away, hold a
separate street, and turn back. `divergeFraction` and `rejoinFraction` define
the boundaries of those phases. The held section prevents a choice from reading
as a brief lane dodge and gives the game several seconds of visibly different
city before the paths reunite. Lateral/elevation and heading displacement still
return exactly to the same centre line at the authored rejoin. Every option
uses the same route definition, distance, cue order, collections, terminal
state, payout and server-provided outcome. In a paid round, junctions and
actions are presentation choices only. They provide a sense of navigating the
city without moving gambling logic into the client.

Obstacle resolution follows the same boundary. Jump and slide obstacles check
the active presentation action as the authored point is crossed; lane obstacles
check whether the blocked lane was avoided. A clear or hit is recorded for
feedback and recovery, but the runner continues along the same predetermined
journey. Inputs never add, remove or reorder collections, never change a prize,
and never choose a gambling outcome.

Completed pointer gestures may be passed through
`interpretSpatialRunnerSwipe()`. The interpreter rejects taps, slow drags and
ambiguous diagonals, then maps a valid dominant direction onto the existing
runner command vocabulary. It has no DOM or renderer dependency. Night Drop's
approved profile uses a 34px minimum distance, 650ms maximum duration and 1.12×
axis-dominance threshold.

## Segment streaming

`resolveSpatialRouteWindow()` projects normalized progress into a bounded
distance behind and ahead of the runner. It returns the current segment and the
ordered segment ids a renderer should keep active. The Night Drop spike uses
this window to hide district objects outside the camera corridor while RouteRun
remains renderer-neutral.

## Night Drop profiles

Night Drop currently supplies ten presentation configurations:

| Route | Class | Distance | Decisions | Obstacles | Target sequence |
| --- | --- | ---: | ---: | ---: | ---: |
| City Sprint | Quick | 228m | 1 | 3 | 16s |
| Glasshouse Loop | Standard | 452m | 2 | 5 | 24.5s |
| Cross-City Run | Extended | 834m | 3 | 7 | 37.5s |
| Rooftop Ascent | Technical | 516m | 2 | 6 | 30.5s |
| Neon Slalom | Technical | 387m | 2 | 5 | 21s |
| Canal Dash | Standard | 555m | 2 | 5 | 28s |
| Market Maze | Technical | 684m | 3 | 6 | 34s |
| Skybridge Chain | Technical | 776m | 3 | 6 | 42s |
| District Marathon | Extended | 1,320m | 4 | 8 | 66s |
| Full Night Shift | Extended | 1,821m | 4 | 8 | 88s |

These configurations belong to Night Drop. The segment composer, validation,
cue resolution and deterministic signatures belong to RouteRun.

Night Drop balances authored lead distance against each route's estimated
travel speed. Automated coverage holds obstacle warnings between 1.7 and 3.1
seconds, junction anticipation between 1.9 and 3.1 seconds and consecutive
obstacle spacing at or above 24 world units across all ten profiles. The Full
Night Shift profile is additionally simulated for its complete 88-second
timeline at 60 updates per second, including mid-route snapshot recovery.

See [RouteRun Runner Foundation](./ROUTERUN_RUNNER_FOUNDATION.md) for the frozen
input, response and stress-test values.

## Boundary rules

- No RNG, wallet, payout or certified mathematics belong in spatial routes.
- Route choice for a paid round must come from the server-controlled outcome.
- The frontend may select routes only in diagnostic and non-production tools.
- RouteRun contains no Night Drop characters, districts, lighting or artwork.
- Renderers consume composed samples; RouteRun never imports a renderer.
- Physical roads, closures, signs, buildings and game-specific façades are renderer/game-pack concerns.
- Game packs may configure segments, cues and obstacles but must not reimplement composition.
- Lane, action and branch input may alter presentation path and timing only; it
  must never determine prize value or replace the resolved outcome.
