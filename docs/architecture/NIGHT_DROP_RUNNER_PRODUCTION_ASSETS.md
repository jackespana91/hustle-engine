# Night Drop Runner Production Asset Contract

## Status

The cinematic runner composition, camera scale, route staging, controls and
deterministic timing are ready for production assets. The current character,
buildings, street dressing and feedback tones are intentional fallbacks. They
keep every route playable when an external file is unavailable; they are not
final commercial artwork or audio.

Production loading is opt-in during integration:

`?runnerSpike=1&route=cross-city&assets=production`

The default preview does not request missing production files. A failed
production load returns to the procedural fallback without changing the route,
outcome, wallet value or recovery snapshot.

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

The file may use one skinned mesh or a small controlled set of skinned meshes.
The loader accepts the first listed production clip name or its lowercase
fallback alias.

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

## Materials and textures

The first shared material set is:

- `wet-asphalt`
- `city-concrete`
- `neon-glass`
- `rooftop-metal`

Expected folder pattern:

`/assets/night-drop/runner/materials/<material>_albedo.webp`

Optional maps use `_normal.webp`, `_roughness.webp` and `_emissive.webp`.
Maximum dimensions are 512px low, 1024px medium and 2048px high. Use square,
power-of-two maps, avoid baked text, pack repeated signage separately and keep
emissive areas restrained enough that route cyan and collection gold remain the
brightest gameplay cues. KTX2/Basis compression can replace WebP after the
first approved integration without changing logical IDs.

## Feedback and audio handoff

Sixteen timing hooks are wired. Production audio should be OGG, 48 kHz, with a
short clean tail and no built-in silence. Keep one-shot cues mono unless the
sound genuinely needs width; the runtime owns spatial placement and gain.

| Logical ID | Expected file |
| --- | --- |
| `audio.runner.start` | `runner_start.ogg` |
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

All files live under `/assets/night-drop/runner/audio/`. The current oscillator
sounds and restrained haptic patterns are timing placeholders only.

## Existing 2D source packages

The approved Night Drop codex PNGs, spritesheets and contact sheets remain valid
reference art and can continue to support board-mode or UI production. They do
not replace the skinned Dash GLB, modular environment GLBs, PBR materials or
authored runner audio required by this third-person presentation.

## Performance and QA gate

The procedural fallback currently chooses low LOD at 390×844, medium at
900×1000 and high at 1440×900. The Full Night Shift mobile sample held 60.0 FPS
with a 16.67ms average frame, a 17.70ms worst sampled frame, 70 draw calls,
5,024 rendered triangles and four active streamed segments. These numbers are a
fallback reference, not permission for production assets to consume the entire
budget.

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

## External production dependencies

The remaining blockers to a final commercial visual release are deliberately
outside this code pass:

- approved skinned Dash GLB with the thirteen animation roles;
- twelve modular environment sets at three LODs each;
- approved PBR texture/material package and signage atlas;
- final authored effects, audio mix and voice work;
- device profiling and art optimisation using the real files.

Until those assets arrive, the fallback remains the honest preview of route
design, timing, camera, controls, recovery and presentation architecture.
