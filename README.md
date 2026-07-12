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

This repository is a private npm monorepo with workspaces under `apps/*` and `packages/*`. The initial structure intentionally contains no dependencies or game implementation.
