# Hustle Core

Engine-neutral lifecycle and presentation orchestration for Hustle Labs games.

Task 001 provides strongly typed contracts, a typed event bus, an explicit round state machine, an interruptible deterministic animation queue, versioned recovery snapshots, and a round controller. Money is represented as non-negative integer micro-units (`1_000_000` = one major currency unit); no floating-point currency calculations are permitted.

Hustle Core contains no Stake response types and no game-specific mechanics.

## Debug panel

Task 002 exports `installHustleDebugPanel`, a framework-independent browser panel that mounts itself, injects scoped styles, samples frame performance, and exposes game-neutral lifecycle and testing controls. A future game integrates it with one call and supplies a `DebugPanelState` reader plus `DebugPanelActions`; the panel never reads game-specific state directly.

The panel is docked right, collapsible, scrollable, and toggled with `Cmd+Shift+D` or `Ctrl+Shift+D`.

## Feature SDK

Task 003 lives in [`features`](features) and exports the complete reusable plugin contract: metadata, context, state, events, lifecycle, registry, deterministic dependency ordering, loader, serializer, and placeholder feature implementations. See [`docs/features.md`](../../docs/features.md) before adding a production feature.
