# Hustle Engine

Hustle Engine is the shared internal technology platform for Hustle Labs games. It owns the client-side game lifecycle, deterministic result presentation, animation, reusable mechanics, themes, and development tools.

Stake Engine remains responsible for operator-side sessions, wallet operations, RNG, and round APIs. Hustle Engine consumes those round results through a deliberately isolated adapter boundary.

## Platform structure

### Hustle Core

[`packages/core`](packages/core) provides the shared game lifecycle, event bus, state management, animation orchestration, asset loading, recovery hooks, and shared contracts. It contains no game-specific logic.

### Stake adapter

[`packages/stake-adapter`](packages/stake-adapter) translates Stake Engine round responses into Hustle Engine's internal outcome format. All Stake-specific integration code belongs at this boundary.

### RouteRun Engine 001

[`packages/routerun`](packages/routerun) is the first commercial reusable engine built on Hustle Core. It provides the directional route mechanic, including its board model, route grammar, deterministic traversal, overlays, cascades, expansion, persistent bonus state, and feature plugins.

### Night Drop Game Pack 001

[`apps/night-drop`](apps/night-drop) is the first game pack built with Hustle Core, the Stake adapter, and RouteRun. Night Drop owns its theme, assets, presentation, and feature configuration.

### Engine playground

[`apps/engine-playground`](apps/engine-playground) is an internal test application for forced outcomes, state inspection, animation debugging, and responsive previews.

## Architecture rule

Reusable mechanic logic must never be placed inside a game pack. Game packs contain only game-specific theme, assets, presentation, and configuration. Any mechanic intended for reuse belongs in an engine package such as RouteRun, while platform-wide lifecycle and orchestration capabilities belong in Hustle Core.

Architecture decisions, boundaries, diagrams, and implementation plans live in [`docs/architecture`](docs/architecture).

## Workspace

This repository is a private npm monorepo with workspaces under `apps/*` and `packages/*`.

## Hustle Core Task 001

Task 001 is the first reusable vertical slice: a mocked Stake-style response is validated at the adapter boundary, translated into an engine-neutral outcome, converted into a deterministic animation-command sequence, and presented through an interruptible queue. Versioned snapshots restore pending work without replaying completed commands.

Amounts are integer micro-units (`1_000_000` represents one major currency unit). The mocked response schema is not presented as Stake Engine's final production API, and this slice performs no networking, wagering, RNG, RTP, or game-specific outcome logic.

### Hustle Debug Panel · Task 002

Hustle Core exports a reusable, game-neutral debug panel for every future browser game. It provides live lifecycle, queue, snapshot, event, telemetry, frame-performance, input, and deterministic testing controls in a dark docked interface. Install it with `installHustleDebugPanel(...)`, supplying only a debug-state reader and safe action callbacks. Toggle it with `Cmd+Shift+D` on macOS or `Ctrl+Shift+D` elsewhere.

### Hustle Feature SDK

The Feature SDK is Hustle Core's manifest-backed plugin architecture for reusable commercial-engine capabilities. It validates implementation/manifest pairs, resolves dependencies and conflicts, executes enabled features deterministically, publishes typed lifecycle events, and preserves versioned feature state through interruption and recovery. Dependencies run first; otherwise execution uses ascending priority and an ASCII feature-ID tie-breaker.

The six included feature implementations are non-production architectural examples only. See the authoritative [`Feature SDK architecture guide`](docs/architecture/FEATURE_SDK.md) for lifecycle, failure policy, recovery, migrations, commercial-engine integration, and authoring boundaries.

### Engine Manifest System

The Manifest System describes commercial engines, game packs, feature packs, themes, audio packs, math profiles, and assets as validated versioned data. Run `npm run dev`, open the Vite URL, and use the **Manifest System** workspace to load examples, inspect validation errors, export a stable snapshot, and resolve the illustrative Night Drop composition.

### Installation

Requires Node.js 20 or newer and npm.

```bash
npm install
```

### Run the playground

```bash
npm run dev
```

Open the local URL printed by Vite. Use the lifecycle controls to complete a fixed round, pause or skip commands, interrupt and restore, or trigger validation and executor failures. The **Features** workspace loads and inspects placeholder plugins, compares deterministic executions, exercises dependency and failure scenarios, and serializes or restores feature state. Feature activity is also visible in the docked Debug Panel.

### Validate the repository

```bash
npm test
npm run typecheck
npm run build
```
