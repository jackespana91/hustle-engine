# Night Drop — Game Pack 001

Night Drop is the first commercial game pack built on RouteRun, Commercial Engine 001. It owns the neon-city theme, character presentation hooks, deterministic demo outcomes and game-pack feature configuration. It does not own reusable route mechanics, lifecycle infrastructure or operator outcome generation.

The bundled browser demo uses predetermined, non-production outcomes. It contains no RNG, paytable or certified maths. Production round results remain the responsibility of Stake Engine.

## Boundaries

- `@hustle/core` supplies lifecycle, Feature SDK, manifests, themes, outcomes, recovery and debug tooling.
- `@hustle/routerun` supplies the reusable route board and deterministic traversal.
- Night Drop supplies only game identity, presentation, feature plugins and content configuration.
- Reusable mechanic logic must never be added to this game pack.

Run it from the monorepo root with `npm run dev --workspace @hustle/night-drop`.
