# Night Drop Cinematic Runner Spike

This development-only presentation spike translates the existing deterministic
RouteRun `long-route` outcome into variable-length player-facing delivery
sequences. It does not introduce RNG, payout or wallet behaviour.

The current spatial pass is a true third-person Three.js greybox rather than a
layered 2D scene. A temporary rigged 3D Dash runs along a curved world-space
route while the camera follows from behind. Packages, the continuation gate,
Shortcut passage, Clamp checkpoint, and penthouse are physical 3D locations.

The primitive character and environment geometry are intentionally temporary.
Commercial presentation requires production GLB models, skeletal animation,
PBR materials, environment dressing, authored VFX, and final lighting. The
greybox exists to approve camera, scale, route motion, and event staging first.

The primitive environment volumes are the replacement contract for future game
packs. Tall blocks become that pack's buildings, lower blocks become its street
edges, rooftops, props or natural terrain, and route-segment metadata selects the
authored environment set. The player stage deliberately has no painted backdrop:
the streamed world geometry is the environment, not decoration placed behind it.

Junction architecture is authored directly from reusable 3D Night Drop geometry.
Corner buildings are positioned from each route tangent and side vector so they
meet crossroads and T-junctions at controlled angles. No environment artwork or
game-specific asset from another project is used.

The route-network pass uses reusable straights, bends, junctions, alleys,
bridges, ramps, tunnels, rooftops and destinations. Bridge rails, tunnel frames,
alley services, ramp signs and destination beacons are generated from the route
piece itself. Every junction choice now turns into a visibly separate street,
holds that separation, and rejoins later. An authored approach signal and wider,
higher anticipation camera prepare the player before the choice UI opens. Each
route derives or supplies that approach distance from expected travel speed so
short, medium and long profiles offer comparable decision time.

The interaction pass adds presentation-only barriers, low signs, gaps, ramps,
traffic and lane blockers. Each has a stable world position, reaction warning
and clear/bump record. Jump, slide and lane inputs produce readable animation
and camera feedback, while a miss keeps Dash moving and leaves the paid result
unchanged. Exact obstacle interactions are included in the recovery snapshot.

Decision counts are intentionally varied: City Sprint has one; Glasshouse Loop,
Rooftop Ascent, Neon Slalom and Canal Dash have two; Cross-City, Market Maze and
Skybridge Chain have three; District Marathon and Full Night Shift have four.
This is route/presentation variety only and never changes an outcome.

## Preview routes

- Default route: `?runnerSpike=1`
- City Sprint: `?runnerSpike=1&route=city-sprint`
- Glasshouse Loop: `?runnerSpike=1&route=glasshouse-loop`
- Cross-City Run: `?runnerSpike=1&route=cross-city`
- Rooftop Ascent: `?runnerSpike=1&route=rooftop-ascent`
- Neon Slalom: `?runnerSpike=1&route=neon-slalom`
- Canal Dash: `?runnerSpike=1&route=canal-dash`
- Market Maze: `?runnerSpike=1&route=market-maze`
- Skybridge Chain: `?runnerSpike=1&route=skybridge-chain`
- District Marathon: `?runnerSpike=1&route=district-marathon`
- Full Night Shift: `?runnerSpike=1&route=night-shift`
- Cross-City crossroads decision: `?runnerSpike=1&route=cross-city&junction=0`
- Cross-City T-junction decision: `?runnerSpike=1&route=cross-city&junction=1`
- Cross-City first obstacle: `?runnerSpike=1&route=cross-city&obstacle=0`
- Cross-City fourth obstacle: `?runnerSpike=1&route=cross-city&obstacle=3`
- Frozen board baseline: `?visualReset=1`
- The Blender Dash is enabled by default. Buildings use curve-sampled placement
  so they follow the real route rather than a rigid module chord. Append
  `&environment=modules` only to inspect the quarantined whole-street GLBs, or
  `&assets=proxy` to compare the complete procedural fallback.

Stable approval frames can be selected with `runnerState`, for example:

`?runnerSpike=1&runnerState=shortcut`

## Boundaries

- RouteRun remains the source of logical route coordinates, turns and collectable data.
- RouteRun now composes renderer-neutral spatial segments and cues; Night Drop supplies only its route configurations and Three.js presentation.
- The runner timeline is presentation-only and deterministic.
- Hustle Core is unchanged and RouteRun has no Three.js or Night Drop dependency.
- The 5×5 board remains available only as the internal visual-reset/debug view.

The PNG stills and MP4 in this folder are the approval artefacts for this spike.
The production GLB, animation, material, LOD and audio contract is documented in
`docs/architecture/NIGHT_DROP_RUNNER_PRODUCTION_ASSETS.md`.

The first Blender production pass is captured in:

- `blender-production-mobile.jpg` — 390×844 live Cross-City frame;
- `blender-production-desktop.jpg` — 1440×900 centred live frame.

## Route lab controls

- On touch devices, swipe left/right to dodge, up to jump and down to slide.
- A horizontal swipe selects a visible left/right street while a junction is
  open; a tap or unclear diagonal is ignored.
- Arrow keys or A/D dodge between three presentation lanes.
- Up, W or Space jumps; Down or S slides.
- Gold warning pills announce jump, slide, lane-change and ramp interactions.
- Clearing an obstacle produces a cyan `CLEAN!` beat; a miss produces a brief
  magenta bump, then Dash continues along the same deterministic route.
- `1`, `2` and `3` choose left, straight and right while a junction is open.
- T-junctions expose two choices; crossroads expose three. Ignoring a decision
  takes its deterministic default, and every option rejoins the same journey.
- Save, Interrupt and Recover prove exact presentation snapshot restoration.
- The speed selector runs the same deterministic timeline at 0.5×, 1×, 2× or
  4× for QA. It does not alter the resolved outcome.

## Frozen foundation checks

- All ten routes provide 1.7–3.1 seconds of obstacle warning.
- All ten routes provide 1.65–3.1 seconds of junction anticipation.
- Consecutive authored obstacles remain at least 24 world units apart.
- Full Night Shift completes an 88-second, 60-updates-per-second simulation,
  including mid-route save and recovery.
- The runner keeps at most eight nearby route segments active in that stress
  simulation and bounds its stored command history at 64.
- Gesture, obstacle and junction input never alters the paid outcome.
