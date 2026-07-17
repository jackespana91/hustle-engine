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

The application loads the production pack by default. Add `assets=proxy` to a
runner preview URL to compare it with the procedural fallback.

## Validate

```sh
npm run assets:validate --workspace @hustle/night-drop
```

The validator parses every GLB through Three.js, checks the complete environment
inventory, confirms all thirteen Dash clips and verifies the mobile character
budget and material-map files.
