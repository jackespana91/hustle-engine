# Night Drop Route Network Baseline

## Status

This document freezes the accepted route-network geometry and chase-camera
response for the Night Drop runner spike. The freeze covers the ten authored
route profiles, their 26 crossroads and T-junctions, alley clearances, branch
rejoins, decision timing and route-aware mobile streaming.

It does not freeze production buildings, character art, materials, lighting,
audio or feature spectacle. Those assets may replace the current presentation
proxies only when they preserve the street and sightline contracts below.

No Hustle Core or RouteRun implementation was changed for this baseline.

## Accepted network

| Route | Distance | Junctions |
| --- | ---: | ---: |
| City Sprint | 228m | 1 |
| Glasshouse Loop | 452m | 2 |
| Cross-City Run | 834m | 3 |
| Rooftop Ascent | 516m | 2 |
| Neon Slalom | 387m | 2 |
| Canal Dash | 555m | 2 |
| Market Maze | 684m | 3 |
| Skybridge Chain | 776m | 3 |
| District Marathon | 1,320m | 4 |
| Full Night Shift | 1,821m | 4 |

## Geometry contract

- A crossroads presents left, straight and right streets.
- A T-junction presents left and right streets and physically closes the road
  ahead.
- Every non-straight alternative owns an independent rounded street path.
- Branches leave and rejoin through ten-metre junction approaches so the chase
  camera can read the intersection before Dash turns.
- Side streets use an adaptive 18–26m block depth and remain outside the sampled
  centre-route envelope.
- A selected branch carries Dash, route arrows, packages, obstacles and feature
  landmarks on the same path.
- The first and last 30% of a branch may overlap the junction merge. Across its
  central 40%, the side street must remain more than ten world units from the
  centre route.
- Left and right alternatives must be more than 25 world units apart at their
  midpoint.
- The sampled local heading change must remain below 50 degrees. The accepted
  network currently peaks at approximately 46.7 degrees.
- Buildings and props must remain outside every playable road and shoulder.

## Camera and decision contract

- Camera turn anticipation samples 9.5 world metres ahead, independent of total
  route length.
- Route arrows are distance-windowed: 8–86m ahead on mobile and 8–118m ahead on
  larger screens.
- Generated routes provide at least 1.9 seconds and no more than 3.1 seconds of
  junction anticipation at authored speed.
- The camera may widen and pull back near a junction, but it may not conceal an
  invalid street or building placement.
- Doing nothing retains the deterministic default presentation branch. A branch
  choice never changes the paid outcome.

## Streaming and mobile contract

- Only junction blocks inside the active RouteRun spatial window are visible.
- Unselected branch dressing is hidden after the decision while the physical
  street surfaces remain available for choice readability.
- Low LOD uses simplified route-safe buildings, reduced rain density, disabled
  multisample antialiasing and frozen transforms for static city geometry.
- The mobile acceptance viewport is 390×844 with a one-device-pixel render
  scale, no dynamic shadows and no horizontal overflow.
- At the fourth Full Night Shift crossroads, the accepted mobile checkpoint
  rendered 10 city objects, 118 draw calls and 8,704 triangles in the in-app
  browser. These numbers are a regression reference, not a universal device
  performance guarantee.

## Acceptance coverage

Automated tests traverse all ten route definitions and every branch alternative.
They reject endpoint discontinuities, folded streets, hairpin heading changes,
centre-route incursions, inadequate left/right separation, invalid decision
timing and paid-outcome changes.

Browser review covered the mobile T-junction, mobile crossroads, the former
Rooftop Ascent fold case, the 1,821m Full Night Shift streaming checkpoint and
the centred 1440×900 desktop stage. The reviewed pages had no horizontal
overflow or console errors.

Any change to route geometry, branch construction, building clearance, decision
lead distance, camera look-ahead or streaming must rerun the complete Night Drop
test suite and repeat mobile T-junction, crossroads and long-route browser QA.
