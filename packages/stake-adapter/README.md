# Stake Adapter

A deliberately small boundary that validates and translates a mocked Stake-style round response into Hustle Core's engine-neutral `RoundOutcome`.

The Task 001 schema is a local testing contract only. It must not be treated as Stake Engine's final production API. Amounts use non-negative integer micro-units and ordered event values must sum to the declared total win.
