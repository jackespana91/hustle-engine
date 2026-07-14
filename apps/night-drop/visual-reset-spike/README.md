# Night Drop Visual Reset — Design Spike

Open the development-only spike at:

`http://127.0.0.1:4177/?visualReset=1`

Press **PLAY** once to run the deterministic 13.5-second presentation. The normal Night Drop URL remains on the existing functional presentation.

The approved composition and asset-replacement boundaries are recorded in [`APPROVED_VISUAL_BASELINE.md`](./APPROVED_VISUAL_BASELINE.md).

## Demonstration sequence

- 0.2s — city tiles settle into the board
- 0.7s — packages react
- 1.0s — the first legal route illuminates
- 1.7s — Dash anticipates
- 2.0–5.5s — Dash runs and collects the first route
- 5.6s — travelled streets clear
- 6.2s — the board compacts
- 6.8s — replacement streets arrive
- 7.5s — the continuation illuminates
- 8.0–11.0s — Dash completes the continuation
- 11.2s — the destination lights activate
- 12.0s — delivery and win resolve
- 13.0s — the screen returns to a stable state

## Removed from the previous presentation

- The pre-revealed route on the idle screen
- Dash / Night Courier heading and portrait treatment
- Deliver to Penthouse technical header
- Permanent Mara space
- Route statistics and stop counters
- Feature chips and persistent feature labels
- Duplicate Five-Star, Priority, and route information
- Debug tabs, technical statuses, and build terminology
- Empty black cells and large unavailable-cell symbols
- Rounded dashboard-card treatment around every cell
- Secondary calls to action and alternate Play wording
- Desktop analytics or side panels

## Spike boundaries

- Development-only and gated by `?visualReset=1`
- Uses the deterministic showcase route as presentation data
- Does not modify Hustle Core or RouteRun
- Does not implement Shortcut, Clamp, expansion, or final win polish
- Does not add production abstractions
- Has not been committed or pushed

## Verification

- 25 visually populated board cells
- Four physical package props: three standard and one premium
- No visible route at idle
- One central button labelled PLAY throughout
- 390×844 has no horizontal or vertical overflow
- 13.5-second observed browser run with all authored phases in order
- No browser console, network, or runtime errors
- Strict Night Drop TypeScript check passes
- Focused Night Drop production build passes; the design spike is excluded from production
