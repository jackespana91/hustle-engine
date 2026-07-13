# Engine Playground

Minimal browser demonstration for Hustle Core lifecycle, manifests, and the Feature SDK. It uses rectangles, counters, and text to show deterministic mocked round execution, queue controls, interruption, snapshot recovery, malformed input, animation failure, and the reusable Hustle Debug Panel.

Run from the repository root with `npm run dev`, then open the Vite URL shown in the terminal. The debug panel is docked on the right and toggles with `Cmd+Shift+D` or `Ctrl+Shift+D`. No real wallet, network, RNG, or final game artwork is involved.

The **Features** workspace shows registered implementations beside their matching manifests, enabled state, compatibility, dependencies, conflicts, deterministic order, serialized state, execution counts, recent events, warnings, and structured errors. Its controls can load the non-production examples, enable or disable a feature, execute eligible features, compare two identical deterministic runs, serialize or restore state, clear runtime state, test dependency/cycle/conflict rejection, simulate blocking and non-blocking failures, and clear the registry.

Feature activity also appears through the existing docked Debug Panel. Toggle the panel with `Cmd+Shift+D` on macOS or `Ctrl+Shift+D` elsewhere. See [`FEATURE_SDK.md`](../../docs/architecture/FEATURE_SDK.md) for the architecture and authoring rules.

The Manifest System section loads non-production composition examples, displays registered manifest metadata and structured errors, exports stable registry snapshots, and resolves the illustrative Night Drop composition without implementing game logic.
