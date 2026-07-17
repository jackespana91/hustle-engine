# Night Drop Blender Production Pack

The generator creates the first complete 3D production pack for the Night Drop
cinematic runner. It is deterministic and does not contain outcome, RNG, wallet
or RouteRun logic.

## Generate

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python \
  apps/night-drop/tools/blender/generate-night_drop_runner_assets.py

# Regenerate only the rigged Dash character while preserving the city report:
/Applications/Blender.app/Contents/MacOS/Blender --background --python \
  apps/night-drop/tools/blender/generate-night_drop_runner_assets.py -- --dash-only

/Applications/Blender.app/Contents/MacOS/Blender --background --python \
  apps/night-drop/tools/blender/generate_night_drop_city_kit.py

/Applications/Blender.app/Contents/MacOS/Blender --background --python \
  apps/night-drop/tools/blender/regenerate_night_drop_materials.py
```

Outputs are written under
`apps/night-drop/public/assets/night-drop/runner/`:

- one runtime-batched armature-skinned Dash GLB, authored from 52 overlapping
  silhouette parts and exported as one weighted object with ten material
  primitives, seventeen bones, controlled two-bone deformation, three
  secondary-motion controls and thirteen animation clips;
- twelve semantic environment pieces at LOD0, LOD1 and LOD2;
- four PBR material sets with albedo, normal, roughness and emissive maps;
- eight curve-safe building templates plus one optimized city-kit bundle;
- `production-report.json` with asset budgets and inventory.

The application loads production Dash and the independent city-kit bundle by
default. The city templates contain architecture only: RouteRun continues to
own every road and the runtime places buildings beyond curve-sampled clearance
lines. Whole-street environment GLBs are retained for inspection but are not
installed into the player-facing route because a rigid module cannot follow a
long curved segment safely. Add `environment=modules` to inspect them
explicitly, or `assets=proxy` to compare the complete procedural fallback.

## Validate

```sh
npm run assets:validate --workspace @hustle/night-drop
```

The validator parses every GLB through Three.js, checks the complete environment
inventory, confirms all thirteen Dash clips, verifies every Dash renderable is
a weighted `SkinnedMesh`, enforces the joint/influence/mobile budgets, and
checks the combined city bundle, eight building templates and material-map
files. It also validates the production-audio manifest and every mastered file
listed there; an empty file map intentionally keeps the procedural timing mix.
