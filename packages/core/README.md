# Hustle Core

Engine-neutral lifecycle and presentation orchestration for Hustle Labs games.

Task 001 provides strongly typed contracts, a typed event bus, an explicit round state machine, an interruptible deterministic animation queue, versioned recovery snapshots, and a round controller. Money is represented as non-negative integer micro-units (`1_000_000` = one major currency unit); no floating-point currency calculations are permitted.

Hustle Core contains no Stake response types and no game-specific mechanics.

## Debug panel

Task 002 exports `installHustleDebugPanel`, a framework-independent browser panel that mounts itself, injects scoped styles, samples frame performance, and exposes game-neutral lifecycle and testing controls. A future game integrates it with one call and supplies a `DebugPanelState` reader plus `DebugPanelActions`; the panel never reads game-specific state directly.

The panel is docked right, collapsible, scrollable, and toggled with `Cmd+Shift+D` or `Ctrl+Shift+D`.

## Feature SDK

The Feature SDK lives in [`src/features`](src/features) and exports engine-neutral contracts for manifests, implementations, controlled contexts, explicit results, typed events, lifecycle execution, registration, dependency and conflict validation, deterministic random values, versioned serialization, recovery, migrations, and debug inspection.

Registration pairs executable behavior with a matching `FeatureManifest`. Dependencies always execute first; otherwise enabled features use ascending priority and ASCII feature ID. Blocking failures stop the operation, while explicitly non-blocking failures are isolated and reported. Cleanup remains predictable in both paths.

Read [`FEATURE_SDK.md`](../../docs/architecture/FEATURE_SDK.md) before adding or consuming a reusable feature. The included Shortcut, Clamp, Five-Star, Sticky Wild, Hold and Win, and Collector implementations are placeholders, not production mechanics.

## Engine Manifest System

The [`manifests`](src/manifests) module provides the data-only composition boundary for engines, games, reusable features, themes, audio, illustrative math profiles, and assets. It includes runtime validation, deterministic game resolution, stable JSON serialization, transactional development reloads, schema migration contracts, and typed lifecycle events.

Manifest declarations never contain gameplay, animation, RNG, wagering, rendering, or audio playback logic. See [`MANIFEST_SYSTEM.md`](../../docs/architecture/MANIFEST_SYSTEM.md) for the complete contract and the certification limits of math metadata.

## Asset and Theme System

The [`assets`](src/assets) module owns logical resource contracts, deterministic condition-based variant and fallback resolution, atomic registration/reload, environment-neutral loading, cancellation, timeouts, retries, concurrency, request deduplication, preload progress, estimated-byte caching, metadata-only recovery, typed events, and a DOM-free debug adapter.

The [`themes`](src/themes) module owns validated immutable theme data, safe token and alias resolution, base/game/operator/seasonal/accessibility composition, conflict inspection, atomic activation and swapping, versioned state restore, typed events, and a DOM-free debug adapter.

Core never fetches through a browser API, creates DOM/Pixi resources, emits arbitrary CSS, or contains final game artwork. Hosts inject the loading/decoding adapter and rendering interpretation. Read [`ASSET_THEME_SYSTEM.md`](../../docs/architecture/ASSET_THEME_SYSTEM.md) before adding production assets or themes.

## Outcome Studio

The [`outcomes`](src/outcomes) module treats round outcomes as strongly typed, versioned data. It provides structured validation and normalization, a transactional builder, an atomic registry, deterministic playback through the existing controller and animation queue, Feature SDK hooks, recovery extensions, complete execution recording, offline replay, stable serialization, comparison, divergence reporting, scenarios, typed events, and a DOM-free Debug Panel adapter.

Core does not generate real-money results or understand RouteRun, Night Drop, operator wallets, or certified mathematics. Hosts supply resource preparation and animation execution; commercial engines later interpret outcome events for mechanic-specific presentation. Read [`OUTCOME_STUDIO.md`](../../docs/architecture/OUTCOME_STUDIO.md) for the contract and certification boundary.
