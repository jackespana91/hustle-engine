# RouteRun Runner Foundation

## Status

This document freezes the first approved reusable third-person runner response
profile produced by the Night Drop cinematic runner spike. It covers input,
movement presentation, route pacing, junction anticipation, streaming and
recovery. It does not freeze Night Drop artwork, lighting, buildings, character
models, animation clips, audio or VFX.

The foundation is renderer-neutral wherever the behaviour is reusable. RouteRun
owns route composition, the command vocabulary, gesture interpretation,
presentation branches, obstacle records, deterministic snapshots and streaming
windows. Night Drop owns Three.js rendering, camera treatment, scenery and the
game-specific route configurations.

## Frozen response profile

| Behaviour | Approved value |
| --- | ---: |
| Minimum swipe distance | 34px |
| Maximum swipe duration | 650ms |
| Axis dominance required | 1.12× |
| Lane dodge command duration | 420ms |
| Jump command duration | 680ms |
| Slide command duration | 760ms |
| Night Drop visual lane offset | 2.55 world units |
| Night Drop authored obstacle lane offset | 2.8 world units |
| Start acceleration blend | 920ms |
| Obstacle reaction window target | 1.7–3.1 seconds |
| Junction decision window target | 1.9–3.1 seconds |
| Minimum obstacle spacing | 24 world units |
| Maximum active streamed segments in the 88s test | 8 |
| Stored input command limit | 64 |

Left and right swipes produce dodge commands, an upward swipe produces jump and
a downward swipe produces slide. Taps, gestures slower than 650ms and diagonals
without a dominant axis produce no command. The interpreter is a pure function:
the same start and end samples always produce the same result.

When a presentation junction is open, Night Drop maps horizontal swipes to its
visible left/right alternatives. Keyboard and button controls use the same
underlying RouteRun commands. The input source is retained only for debug and
telemetry display; it does not change command resolution.

## Motion and camera contract

Night Drop smooths lane and follow-camera movement using elapsed time rather
than frame count, so the presentation response remains comparable across common
refresh rates. Its 920ms start blend gradually increases speed, lowers and pulls
in the chase camera, increases route look-ahead and opens the field of view.

Jump, slide and dodge are readable presentation actions with fixed command
durations. They may clear or hit a presentation obstacle. Either result records
feedback and recovery state, then continues along the same composed route.

## Route pacing contract

Game packs author an obstacle or junction lead distance. Night Drop derives lead
distances for generated profiles from the route's estimated travel speed and
clamps them to readable bounds. Its ten route configurations are covered by
automated checks that enforce:

- 1.7–3.1 seconds of warning before each obstacle;
- 1.9–3.1 seconds of anticipation before each junction;
- at least 24 world units between consecutive obstacles; and
- the same deterministic cue, prize and terminal data regardless of input.

Crossroads and T-junctions open early enough for the camera to reveal their
physical street options before a choice is due. Each selected option turns away,
holds a separate street and rejoins the resolved journey. Doing nothing selects
the authored deterministic default.

## Long-route stress baseline

The Full Night Shift route is exercised for 88,000ms at 60 updates per second.
The test selects every default junction, responds to each authored obstacle,
takes and restores a recovery snapshot halfway through, and completes with:

- every obstacle resolved;
- no more than eight route segments active in the streaming window;
- no more than 64 retained input commands; and
- the unchanged `long-route` outcome, 100-unit bet and 2,400-unit win.

This is a deterministic simulation test rather than a GPU benchmark. Device and
browser rendering performance must still be profiled after production models,
materials, animation and effects are installed.

## Non-negotiable outcome boundary

Runner input is presentation-only. A dodge, jump, slide, swipe, missed obstacle
or street selection must never:

- select a paid route;
- add, remove or reorder a collection;
- change stake, wallet, prize, multiplier or result data;
- replace server-controlled RNG or mathematics; or
- prevent a resolved paid round from completing and recovering.

Any future mechanic that needs to change the paid result must be resolved by the
appropriate server and outcome layer before this presentation foundation runs.
