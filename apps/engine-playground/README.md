# Engine Playground

Minimal browser demonstration for Hustle Core lifecycle, manifests, and the Feature SDK. It uses rectangles, counters, and text to show deterministic mocked round execution, queue controls, interruption, snapshot recovery, malformed input, animation failure, and the reusable Hustle Debug Panel.

Run from the repository root with `npm run dev`, then open the Vite URL shown in the terminal. The debug panel is docked on the right and toggles with `Cmd+Shift+D` or `Ctrl+Shift+D`. No real wallet, network, RNG, or final game artwork is involved.

The **Features** workspace shows registered implementations beside their matching manifests, enabled state, compatibility, dependencies, conflicts, deterministic order, serialized state, execution counts, recent events, warnings, and structured errors. Its controls can load the non-production examples, enable or disable a feature, execute eligible features, compare two identical deterministic runs, serialize or restore state, clear runtime state, test dependency/cycle/conflict rejection, simulate blocking and non-blocking failures, and clear the registry.

Feature activity also appears through the existing docked Debug Panel. Toggle the panel with `Cmd+Shift+D` on macOS or `Ctrl+Shift+D` elsewhere. See [`FEATURE_SDK.md`](../../docs/architecture/FEATURE_SDK.md) for the architecture and authoring rules.

The Manifest System section loads non-production composition examples, displays registered manifest metadata and structured errors, exports stable registry snapshots, and resolves the illustrative Night Drop composition without implementing game logic.

## Assets & Themes

The **Assets & Themes** workspace uses Core's real asset registry, deterministic resolver, loader, preloader, estimated-byte cache, theme registry, theme runtime, and DOM-free debug adapters. Its injected browser mock adapter returns generated placeholder values only; it does not fetch final art or implement game behavior.

The workspace displays logical IDs, resolved physical variants, types, groups, required status, cache metadata, reference counts, externally supplied runtime conditions, live preload progress, active theme layers, resolved tokens, asset aliases, typed events, warnings, errors, and raw manifest/composition data.

Controls cover:

- loading the illustrative manifests;
- bootstrap and base-game preloads plus cancellation;
- low/high quality, portrait/landscape, English/Spanish locale, and reduced-motion conditions;
- operator, seasonal, and high-contrast theme layers;
- optional and required failures, timeout and fallback behavior;
- an invalid atomic theme swap that preserves the active theme;
- registry metadata export, cache clearing, and a full workspace reset.

Asset and theme summaries also appear in the docked Debug Panel. All example visual content is non-production placeholder data. See [`ASSET_THEME_SYSTEM.md`](../../docs/architecture/ASSET_THEME_SYSTEM.md) for deterministic resolution, ownership and recovery rules.

## Outcome Studio

The prominent **Outcome Studio** workspace lets a user create or duplicate an engine-neutral outcome, edit metadata and ordered events with forms, import or export stable JSON, validate the document, and exercise deterministic play, pause, resume, skip, interrupt, recover, and replay behavior without changing source code.

The Inspector exposes validation, expected and actual state, feature executions, animation commands, transitions, replay comparison, and first divergence. The Playback Console shows live lifecycle, event, animation, queue, logical tick, progress, logs, warnings, and errors. Concise OUTCOME and REPLAY summaries also appear in the docked Debug Panel.

Scenarios are illustrative development fixtures only. They do not generate certified outcomes, call a real Stake API, implement a commercial mechanic, or contain final game art. See [`OUTCOME_STUDIO.md`](../../docs/architecture/OUTCOME_STUDIO.md).
