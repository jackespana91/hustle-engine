# Night Drop Approved Visual Baseline

Status: approved and frozen for asset replacement
Baseline date: 14 July 2026

## Composition

The Night Drop player view uses one consistent mobile-first composition:

- a compact progress HUD containing the Night Drop logo, Five-Star progress, Priority progress, and route multiplier;
- one continuous 5×5 elevated city board as the dominant play surface;
- Dash physically anchored to the board;
- four physical package props positioned within the environment;
- a cyan `NEXT DROP` stop for the end of the currently illuminated route leg;
- a permanently visible gold `FINAL ADDRESS` penthouse destination;
- one dominant central `PLAY` control;
- a compressed balance, bet, win, Menu, Auto, Play, and Turbo control strip;
- a centred desktop game stage surrounded only by atmospheric city depth.

No permanent side panels, duplicated progress information, developer language, or secondary calls to action belong in the player view.

## Visual hierarchy

1. Dash and the illuminated route
2. The current `NEXT DROP` endpoint
3. Physical packages
4. The gold `FINAL ADDRESS` penthouse
5. Quiet city materials and atmospheric framing
6. Compact HUD information

Cyan identifies the current legal route and route endpoint. Gold identifies packages, value, and the final destination. Magenta/red remains reserved for future Clamp danger. Acid green remains reserved for future Five-Star upgrades.

## Continuation demonstration

The deterministic 13.5-second demonstration communicates the route loop without an instruction screen:

1. The first route leg illuminates and identifies `NEXT DROP`.
2. Dash traverses the route and collects packages.
3. The endpoint resolves and travelled streets clear.
4. Replacement streets arrive.
5. A second route leg illuminates closer to `FINAL ADDRESS`.
6. Dash continues to the penthouse.

Mara is absent during idle. Her `Route locked.` message appears only after `PLAY` and dismisses after approximately 1.8 seconds.

## 390×844 reference geometry

The approved portrait capture uses a 390×844 CSS-pixel viewport at device scale factor 1. Bounding boxes are recorded as `x, y, width, height` in CSS pixels:

| Region | Approved bounding box |
| --- | --- |
| Compact top HUD | `0, 0, 390, 48` |
| Continuous city board shell | `4, 177.90625, 382, 444.171875` |
| Compressed bottom HUD | `0, 752, 390, 92` |
| Central Play control | `154.515625, 784.015625, 155.421875, 55.1875` |

The `NEXT DROP` label is physically tethered to the cyan endpoint ring and current-delivery flag. The board surface retains its approved selective midtone lift; the distant environment remains darker so it cannot compete with Dash, the route, packages, or destination.

## Freeze boundaries

- Preserve this composition when replacing temporary CSS and vector illustration with approved generated assets.
- Preserve the underlying logical 5×5 grid and deterministic presentation timing.
- Do not add permanent interface panels or expose engine terminology.
- Do not move game-specific presentation into Hustle Core or RouteRun.
- Shortcut, Clamp, expansion, and win artwork are outside this baseline pass.
- Further temporary CSS illustration is frozen; the next visual phase is approved asset replacement.
