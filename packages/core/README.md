# Hustle Core

Engine-neutral lifecycle and presentation orchestration for Hustle Labs games.

Task 001 provides strongly typed contracts, a typed event bus, an explicit round state machine, an interruptible deterministic animation queue, versioned recovery snapshots, and a round controller. Money is represented as non-negative integer micro-units (`1_000_000` = one major currency unit); no floating-point currency calculations are permitted.

Hustle Core contains no Stake response types and no game-specific mechanics.
