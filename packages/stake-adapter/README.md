# Stake Adapter

The boundary between Stake Engine round responses and Hustle Engine's internal outcome format.

Stake Engine owns operator-side sessions, wallet operations, RNG, and round APIs. This package isolates all Stake-specific translation and integration code so the rest of Hustle Engine remains operator-agnostic.
