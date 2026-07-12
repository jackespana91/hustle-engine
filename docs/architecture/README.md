# Architecture

This directory records Hustle Engine architecture decisions, package boundaries, diagrams, and implementation plans.

## System boundary

- Stake Engine owns operator-side sessions, wallet operations, RNG, and round APIs.
- The Stake adapter converts round responses into an internal, operator-agnostic outcome format.
- Hustle Core owns shared client-side lifecycle and orchestration.
- RouteRun owns reusable directional route mechanics.
- Game packs own only game-specific theme, assets, presentation, and configuration.

Reusable mechanic logic must never be implemented inside a game pack.
