# Night Drop Runner Production Asset Contract

## Status

The first Blender-authored production pack is installed. The armature-skinned
Dash and all thirteen named animation clips are enabled by default.
The player-facing environment now uses eight independently placeable building
templates from one optimized curve-safe city-kit bundle. The pack also retains
twelve semantic whole-street modules at three LOD levels for diagnostics and
contains four shared PBR material-map sets.

Rigid whole-street environment modules are not player-facing by default. A
single transformed module cannot follow a long curved route segment without
its road slab or buildings cutting across the spline. The live game therefore
uses curve-sampled building placement, the continuous route ribbon and the
independent city-kit buildings. The rigid Blender modules remain available only
for asset inspection.

Use the procedural fallback only for comparison or diagnosis:

`?runnerSpike=1&route=cross-city&assets=proxy`

To inspect the quarantined rigid environment modules explicitly:

`?runnerSpike=1&route=cross-city&environment=modules`

A failed production load still returns safely to that fallback without changing
the route, outcome, wallet value or recovery snapshot.

## Coordinate and export rules

- Export GLB 2.0, one file per module, with transforms applied.
- Use metres, Y-up, and place the ground contact plane at `y = 0`.
- Face the module and Dash along positive Z. Do not bake route placement into
  an asset.
- Put the origin at the centre of the near edge of an environment module.
- Keep playable route width clear for three presentation lanes.
- Use PBR metallic/roughness materials and shared textures wherever possible.
- Do not use external image paths inside a GLB. Embed or supply the maps listed
  below at their expected logical paths.
- Keep root node names, material slots and animation clip names stable across
  revisions.
- Root motion must be disabled. RouteRun owns deterministic world movement.
- Avoid animation-driven translation, camera nodes, lights and physics bodies
  in character files.

## Dash

Expected model:

`/assets/night-drop/runner/characters/dash/dash.glb`

The current Blender pack authors 52 overlapping character pieces and batches
them into one armature-skinned Blender object before GLB export. Ten material
primitives retain the visual layers while replacing the original 52 runtime
skin nodes. It includes a lean adult courier silhouette, hood, delivery sling,
gold carabiner, route phone, layered backpack, coat tails, straps, knees,
shoulders and illuminated shoe details. Controlled two-bone weighting softens
the torso, hood, elbow and knee transitions; dedicated delivery-bag and coat-tail
bones provide event-driven secondary motion. The current file contains 12,424
triangles, 17 bones, 11,217 exported weighted vertices, at most two influences
per vertex and all thirteen clips in an 828,108-byte GLB. A later professional
sculpt can replace the modular skin with one continuous skinned mesh without
changing the skeleton, loader or animation contract. The loader accepts the
first listed production clip name or its lowercase fallback alias.

| Role | Production clip | Behaviour |
| --- | --- | --- |
| Idle | `Dash_Idle` | looping anticipation pose |
| Start | `Dash_Start` | one-shot into run |
| Run | `Dash_Run` | looping, in place |
| Stop | `Dash_Stop` | one-shot |
| Jump | `Dash_Jump` | one-shot, in place |
| Slide | `Dash_Slide` | one-shot, in place |
| Dodge left | `Dash_Dodge_L` | one-shot, in place |
| Dodge right | `Dash_Dodge_R` | one-shot, in place |
| Turn left | `Dash_Turn_L` | one-shot, in place |
| Turn right | `Dash_Turn_R` | one-shot, in place |
| Collect | `Dash_Collect` | short one-shot accent |
| Stumble | `Dash_Stumble` | recoverable one-shot |
| Celebrate | `Dash_Celebrate` | one-shot into idle |

`Idle`, `Run`, `Jump` and `Slide` are mandatory. The actor uses controlled
cross-fades and falls back safely when an optional clip is absent.

| LOD | Triangle ceiling | Bone ceiling |
| --- | ---: | ---: |
| Low | 18,000 | 55 |
| Medium | 32,000 | 70 |
| High | 55,000 | 85 |

Keep the same skeleton and animation names at every quality level. Mobile uses
the low profile, standard tablet/desktop uses medium, and capable wide desktop
uses high.

## Modular environment

Twelve semantic modules cover every RouteRun spatial segment. Each needs LOD0,
LOD1 and LOD2 GLBs:

| Role | File slug | Nominal footprint |
| --- | --- | --- |
| Straight street | `street_straight` | 16m × 20m |
| Left corner | `corner_left` | 16m × 20m |
| Right corner | `corner_right` | 16m × 20m |
| T-junction | `t_junction` | 32m × 20m |
| Crossroads | `crossroads` | 38m × 20m |
| Alley | `alley` | 16m × 20m |
| Bridge | `bridge` | 16m × 20m |
| Tunnel | `tunnel` | 16m × 20m |
| Ramp up | `ramp_up` | 16m × 20m |
| Ramp down | `ramp_down` | 16m × 20m |
| Rooftop | `rooftop` | 16m × 20m |
| Destination | `destination` | 16m × 20m |

Naming pattern:

`/assets/night-drop/runner/environment/<file_slug>_lod0.glb`

Use `_lod1.glb` and `_lod2.glb` for the lower-detail variants. The manifest
maps high to LOD0, medium to LOD1 and low to LOD2. Preserve the street join
planes and origin across all three files so an LOD swap cannot create seams.

The game chooses one of five Night Drop district palettes from route progress
and segment semantics: Glasshouse Heights, Afterhours Market, Service Quarter,
Canal Works and Upper Heights. District identity should come from modular
facades, signs, props, materials and lighting; do not add a painted background.
The physical streamed city is the environment.

### Chase-camera sightline rules

- Treat the route as the primary silhouette. Standard facades begin beyond the
  full pavement plus a 4.5m visibility setback; the alley uses a smaller
  service-pavement setback while keeping every facade outside the playable
  road and shoulder.
- Leave visible gaps between neighbouring building shells. A continuous wall
  beside the camera is not an acceptable substitute for city density.
- Crossroads, T-junctions and corners use dedicated compact corner buildings.
  Never reuse the long straight-street facade strips across a driveable branch.
- Keep every junction exit open from the chase camera before the decision UI
  appears. Buildings may frame a choice, but may not mask its road surface,
  lane marker or directional sign.
- Reduce near-route mass before changing the camera. Camera movement must not
  be used to hide invalid physical placement.

Production manifest `1.9.0` preserves these rules. City-kit generator v2 is
the first player-facing Blender architecture pack to satisfy them without
changing a RouteRun route.

### Curve-safe night city kit

The player-facing city kit treats the route as protected geometry:

- the continuous road uses each authored segment's half-width;
- pavements, granite kerbs and service clearances remain outside that road;
- building origins are sampled directly from the route tangent and normal;
- standard facade faces begin at 8.45m from the centreline, branch facades at
  8.15m and alley facades at 6.0–6.3m, always beyond their local route width;
- local pavement frontage approaches the route but stops outside the road edge;
- junction buildings use explicit corner placements and never inherit a long
  straight module transform.

The city bundle contains Glasshouse, Night Market, Service Block and Stacked
Flats archetypes in two variants each. Every template has authored windows,
entrances, frontage, rooftop services and practical lights. Geometry is batched
into at most five physical surface groups: structure, metal, glass, warm
interiors and local practical light. The eight templates total 41,864 triangles;
the combined bundle is 2,960,908 bytes. Runtime placement scales and rotates
these buildings independently while road and junction geometry remains
authoritative.

Night lighting follows a restrained hierarchy. Building mass is dark navy,
charcoal or deep plum; warm and cool windows provide occupancy; entrances,
shops, signs and street lamps add local pools of light; district neon is an
accent rather than a whole-building wash. No painted background is used. The
visible city remains physical, route-aware geometry. Route-side dressing adds
Glasshouse directories and lockers, an Afterhours kiosk, Service Quarter
shutters and ducts, Canal Works tram shelters, and Upper Heights beacons while
preserving the road-clearance contract.

## Clamp and Mara presentation

Clamp uses the supplied approved game-pack art as a camera-facing 2.5D actor
inside the physical checkpoint. Authority, scanner and defeated poses share a
world-space contact shadow, threat light and deterministic entrance/exit
timing. A compact geometric proxy remains visible until the textures finish
loading, so the encounter never loses its blocker or threat silhouette.

Mara remains a transient dispatcher layer rather than a resident HUD panel.
Her neutral, warning and amused portraits accompany short route, junction,
continuation, Clamp, penthouse and win messages. Each message self-dismisses
after 1.8 seconds, and Mara is absent in idle. Neither character adds outcome,
collision, route or recovery state.

### Junction and alley street network

Night Drop does not render a left or right choice as a lateral offset from the
main road. Each non-straight alternative owns a separate, deterministic
presentation curve that:

- enters through the physical junction centre;
- turns onto a perpendicular cross street;
- travels around an adaptive 18–26m city block, sized to the available route
  span;
- rejoins the authored RouteRun centre route at the declared rejoin point;
- carries Dash, route arrows, packages, obstacles and feature landmarks on the
  same selected curve.

Crossroads retain a straight route plus left and right side streets.
T-junctions expose only left and right streets; the forward road is covered by
a physical dead-end apron, barrier and blocked facade. The cross street owns a
separate wet-road surface, shoulders, curbs and dashed centre markings so it
reads as street geometry even before a choice is made.

The branch street is built from independent rounded line and corner sections,
not an offset copy of the centre route. Its outer connectors are projected
beyond the sampled centre-route envelope so a tight bend cannot fold the side
street back through the main road.

The city generator samples every non-straight branch before placing buildings.
It treats each road and shoulder as protected geometry, excludes the street
being dressed from its own collision test, and checks proposed buildings
against the main road and every competing branch. Only the dressing for the
chosen alternative is active at runtime; the other street surfaces remain
visible for decision readability without rendering duplicate cities.

Alley segments use their authored narrower width, close service facades,
window bands, a labelled entrance and a restrained overhead shortcut frame.
The mobile camera widens slightly inside an alley so both walls and the clear
running corridor remain visible. Buildings, props and signs may compress the
space, but none may cross the playable asphalt.

## Materials and textures

The first shared material set is:

- `wet-asphalt`
- `city-concrete`
- `neon-glass`
- `rooftop-metal`

Expected folder pattern:

`/assets/night-drop/runner/materials/<material>_albedo.webp`

Optional maps use `_normal.webp`, `_roughness.webp` and `_emissive.webp`. The
installed v2 maps are 512px and include material-specific aggregate, seams,
rain streaks, repair tone, metal ribbing and controlled roughness variation.
Maximum dimensions are 512px low, 1024px medium and 2048px high. Use square,
power-of-two maps, avoid baked text, pack repeated signage separately and keep
emissive areas restrained enough that route cyan and collection gold remain the
brightest gameplay cues. KTX2/Basis compression can replace WebP after the
first approved integration without changing logical IDs.

## Feedback and audio handoff

Seventeen timing hooks are wired. Production audio should be OGG, 48 kHz, with a
short clean tail and no built-in silence. Keep one-shot cues mono unless the
sound genuinely needs width; the runtime owns spatial placement and gain.

| Logical ID | Expected file |
| --- | --- |
| `audio.runner.start` | `runner_start.ogg` |
| `audio.runner.footstep` | `runner_footstep_01.ogg` |
| `audio.runner.jump` | `runner_jump.ogg` |
| `audio.runner.slide` | `runner_slide.ogg` |
| `audio.runner.dodge` | `runner_dodge.ogg` |
| `audio.route.junction` | `route_junction.ogg` |
| `audio.route.select` | `route_select.ogg` |
| `audio.package.collect` | `package_collect.ogg` |
| `audio.package.premium` | `package_premium.ogg` |
| `audio.obstacle.clear` | `obstacle_clear.ogg` |
| `audio.obstacle.hit` | `obstacle_hit.ogg` |
| `audio.route.continuation` | `route_continuation.ogg` |
| `audio.feature.shortcut` | `feature_shortcut.ogg` |
| `audio.feature.clamp` | `feature_clamp.ogg` |
| `audio.destination.arrival` | `destination_arrival.ogg` |
| `audio.round.win` | `round_win.ogg` |
| `audio.runner.recovery` | `runner_recovery.ogg` |

All files live under `/assets/night-drop/runner/audio/`. The current deterministic
procedural mix provides filtered rain, paced footsteps, layered tonal cues,
short noise transients and restrained haptic patterns. It is a timing and mix
placeholder only; the supplied codex packs contain an audio brief but no
mastered audio or voice files.

The runtime reads `/assets/night-drop/runner/audio/production-audio.json` after
the first user gesture. Add only delivered files to its `files` map, using the
feedback cue key and a path relative to the manifest. Successfully decoded
buffers replace their procedural cue independently; missing or invalid entries
fall back without muting the rest of the round. The asset validator rejects
unknown cue keys, unsafe paths and listed files that do not exist.

## Reproducible Blender source

The base pack generator is
`apps/night-drop/tools/blender/generate-night_drop_runner_assets.py`. The
player-facing architecture generator is
`apps/night-drop/tools/blender/generate_night_drop_city_kit.py`, and
`regenerate_night_drop_materials.py` refreshes only the shared PBR maps. All
three write only to the Night Drop public runner directory. Their JSON reports
contain file sizes, mesh counts, triangle counts, animation names and bone
counts. Blender 5.2 LTS generated the current pack.

## Existing 2D source packages

The approved Night Drop codex PNGs, spritesheets and contact sheets remain valid
reference art and can continue to support board-mode or transient UI
presentation. They are flattened PNGs rather than layered skeletal sources and
do not replace the skinned Dash GLB, modular environment GLBs, PBR materials or
authored runner audio required by this third-person presentation. The playable
runner does not use a Spine runtime: Blender armature animation and GLB are the
production character path for a physically navigable 3D city.

## Performance and QA gate

The production character chooses low LOD at 390×844 and medium on the tested
desktop profile. The quarantined rigid environment modules remain batched by
material for diagnostic comparison, but their earlier performance results are
not an acceptance signal: correct route geometry takes priority over a module
that renders quickly in the wrong position.

The player-facing curve-safe Cross-City view at 390×844 renders at a 1.0 scale
with dynamic shadows disabled in favour of material depth, practical lights and
the grounded character shadow. The verified v1.5 idle frame used 134 render
calls and 49,340 triangles; the verified early movement frame used 205 render
calls and 65,948 triangles at 59.5 FPS. Production Dash, 111 mobile city
placements and eight
deterministic street-life placements loaded; two nearby actors were visible in
both measured frames, with no horizontal or vertical overflow. Desktop can
raise render scale while the same deterministic spatial placement remains
unchanged.

Play is disabled briefly while the production character loads. Curve-sampled
environment placement is available immediately; rigid environment modules load
only when explicitly requested for diagnosis. The full proxy path remains
available for recovery comparison.

Before accepting a production pack:

1. Validate all GLBs against the manifest and verify mandatory Dash clips.
2. Test idle, start, movement, jump, slide, dodge, turn, collect, stumble and
   celebration transitions without foot sliding.
3. Check every environment role at all three LODs and inspect street joins.
4. Run all ten deterministic routes at 390×844, 900×1000 and 1440×900.
5. Verify Save → Interrupt → Recover restores the exact position, decision,
   obstacle history and presentation state.
6. Confirm production files do not change results, pay values, input commands
   or deterministic replay.
7. Profile real mid-tier iOS and Android devices with audio enabled.

## Premium vertical-slice presentation pass

The v1.5 Cross-City slice adds presentation quality without changing a paid
result or RouteRun command:

- Dash cadence is calibrated independently from the compressed demonstration
  timeline, with acceleration smoothing, turn lean and landing compression;
- the chase camera responds to speed, route curvature, junction anticipation,
  obstacle proximity and arrival staging while keeping a bounded runner gap;
- deterministic cross traffic appears only as distant junction dressing and is
  never a collider or outcome input;
- cyan Shortcut, red Clamp and gold delivery particle fields share strict
  mobile budgets and preserve the route as the brightest navigation cue;
- the final address uses an open two-tower entrance so Dash remains visible
  throughout delivery and celebration;
- the player shell includes an asset-loading presentation, functional menu,
  sound toggle and pre-round Turbo control;
- GLTFLoader is isolated into an on-demand production-asset chunk rather than
  being duplicated inside the main runner module.

At 390×844 the idle, movement and win frames have no horizontal or vertical
overflow. Turbo changes presentation speed only; it does not change the route,
feature state, recovery snapshot or deterministic result.

## Production consolidation milestone

The Cross-City runner entry is dynamically loaded, and its application code is
now separated from Three.js, the optional GLTF loader, Hustle Core and RouteRun.
The verified production build emits a 157.30 kB runner application chunk
(50.49 kB gzip) instead of a single 781.45 kB runner bundle. The cached Three.js
runtime remains 603.20 kB minified (152.12 kB gzip); it is shared rather than
duplicated and remains the next profiling target after approved art is frozen.

This milestone does not claim studio audio, a final character sculpt or mobile
certification. Those require the external production sources and physical
devices listed below. The local implementation is ready to ingest them without
changing route, outcome, recovery or wallet contracts.

## External production dependencies

The production pipeline is no longer blocked by missing GLBs. Remaining work
for a top-tier commercial release is iterative rather than architectural:

- replace the segmented Dash prototype with an approved sculpted, skinned model;
- expand facade, vehicle, pedestrian, prop and signage variety across districts;
- replace the improved 512px procedural maps with authored 1K/2K PBR surfaces;
- add baked light/AO detail and device-tiered post-processing after mobile
  profiling;
- produce final effects, audio mix and voice work;
- profile and optimise the approved art on real iOS and Android hardware.

The proxy remains available as a recovery and performance reference, not as the
default player-facing presentation.

## Deterministic street-life and obstacle dressing

Street life is presentation-only and is derived from the selected spatial
route. Pedestrians, umbrella walkers and steam vents are seeded from the route
definition, so a replay produces the same placement and motion timing without
adding gameplay state.

- actors remain at least 0.72m beyond the playable road half-width;
- junction entries retain a 21m exclusion zone for clear decisions and sightlines;
- actors are revealed only inside the active camera window;
- street life is hidden while a branch detour is active, preventing main-route
  dressing from appearing inside an alternate street;
- no pedestrian, vehicle or steam element participates in collision, outcomes,
  payouts, command timing or recovery data.

Roadwork barriers, parked vehicles, ramps and route blockers retain their
existing RouteRun obstacle metadata and action windows. Their Night Drop meshes
are cosmetic replacements only. Alley walls use neutral concrete, warm/cool
window light and structural piers rather than uninterrupted neon planes, keeping
the road surface and route guidance dominant during motion.
