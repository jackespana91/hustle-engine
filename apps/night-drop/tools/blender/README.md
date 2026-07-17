# Night Drop Blender Production Pack

The generator creates the first complete 3D production pack for the Night Drop
cinematic runner. It is deterministic and does not contain outcome, RNG, wallet
or RouteRun logic.

## Generate

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python \
  apps/night-drop/tools/blender/generate-night_drop_runner_assets.py
```

Outputs are written under
`apps/night-drop/public/assets/night-drop/runner/`:

- one segmented bone-rigged Dash GLB with thirteen animation clips;
- twelve semantic environment pieces at LOD0, LOD1 and LOD2;
- four PBR material sets with albedo, normal, roughness and emissive maps;
- `production-report.json` with asset budgets and inventory.

The application loads the production Dash by default. Whole-street environment
GLBs are retained for inspection but are not installed into the player-facing
route because a rigid module cannot follow long curved segments safely. Add
`environment=modules` to inspect them explicitly, or `assets=proxy` to compare
the complete procedural fallback. Future environment exports must split
buildings and props into independently placeable pieces before becoming the
default.

## Validate

```sh
npm run assets:validate --workspace @hustle/night-drop
```

The validator parses every GLB through Three.js, checks the complete environment
inventory, confirms all thirteen Dash clips and verifies the mobile character
budget and material-map files.
