# Engine Manifest System

## Why manifests exist

Hustle Engine constructs commercial games through composition rather than by embedding game-pack choices inside shared code. Manifests are the versioned data contracts that describe how Hustle Core, a commercial engine, a game pack, reusable features, a theme, an audio pack, a math profile, and an asset pack fit together.

The system is infrastructure only. A manifest can declare that a feature is selected or that a theme references an asset pack; it cannot implement traversal, symbols, win evaluation, animation, wagering, RNG, or audio playback.

## Manifest types

- `EngineManifest` describes a commercial engine's Core compatibility, capabilities, supported features, platforms, orientations, status, and integer performance budgets.
- `GameManifest` selects an engine version range, features, theme, audio, math and assets, plus locales and build metadata.
- `FeatureManifest` describes reusable feature compatibility, dependencies, conflicts, deterministic priority and serialized-state version.
- `ThemeManifest` contains design tokens and asset references, never rendering code or final art.
- `AudioManifest` contains data-only music, sound-effect and voice-pack references, never playback code.
- `MathManifest` contains descriptive configuration metadata expressed with integer basis points. It is not a mathematics engine.
- `AssetManifest` lists relative asset files, checksums, tags, and preload/optional groups.

Every registered manifest also carries a `manifestType` discriminator, schema version, permanent lowercase kebab-case ID, semantic implementation version, name and metadata.

## Game composition

`ManifestRegistry.resolveGame()` follows the references in a `GameManifest` and returns the full engine, transitive feature set, theme, audio, math profile and asset pack. Resolution performs compatibility checks and returns a structured report and warnings.

Feature order is deterministic:

1. dependencies precede dependants;
2. among currently available features, higher priority executes first;
3. equal priority sorts by ASCII manifest ID.

Resolution rejects missing references, engine-version mismatches, unsupported engines or features, missing dependencies, cycles, selected feature conflicts and nondeterministic commercial features.

## Validation

Validation has two stages:

1. Intrinsic validation checks required fields, types, IDs, schema and semantic versions, version ranges, locales, paths, duplicate asset IDs, integer performance limits and basis-point bounds.
2. Relational validation checks a prospective registry for duplicate manifest IDs, missing references, feature dependencies/cycles and game compatibility.

Failures use `ManifestValidationError` with a stable code, message, manifest type, optional manifest ID, field path, severity and optional context. Public parsing APIs wrap JSON syntax failures instead of leaking raw `SyntaxError` instances.

`registerMany()` validates a prospective registry before committing it. The development `reload()` API also works transactionally: a valid replacement is committed and emits `manifest:reloaded`; an invalid replacement emits one validation failure and leaves the previous manifest and registry snapshot unchanged. Production file watching and network loading are intentionally out of scope.

## Schema versioning

The current schema version is `1.0.0`. Unsupported versions fail with `UNSUPPORTED_SCHEMA_VERSION`. `ManifestMigration` and `ManifestMigrationRunner` define the future migration boundary, but no historical migration is needed for the initial schema.

Manifest implementation versions and schema versions serve different purposes:

- `schemaVersion` identifies the structure understood by Hustle Core;
- `version` identifies one engine, game, feature, theme, audio, math or asset definition;
- `stateVersion` identifies serialized reusable-feature state;
- `modelVersion` labels descriptive math configuration.

## Registration for future engines and games

Future packages export data-only manifests and register them through `ManifestLoader` or `ManifestRegistry.registerMany()`. Related manifests should be loaded as one batch so references and dependencies are validated atomically. Production packages must use permanent IDs and should test resolution against their supported Core and commercial-engine versions.

The registry supports typed lookup, filtering by manifest type or compatible engine, defensive snapshots, stable serialization, unregistering and explicit safe replacement.

## Manifests versus executable code

Manifests contain identity, versions, compatibility, references, declarative tokens, file metadata, integer configuration values and other JSON-safe composition data.

Executable packages contain lifecycle logic, animation execution, asset loading, event handling, reusable mechanics, rendering, transport clients and platform adapters. Manifests must never become an alternate location for game rules or executable expressions.

## Math manifests are not certified mathematics

`MathManifest` is descriptive configuration metadata only. RTP uses integer basis points (`9_600` = `96.00%`). Multiplier values use a documented basis-point scale (`10_000` = `1x`). Those values do not prove RTP, volatility, exposure or compliance.

The Night Drop math example is explicitly illustrative and uncertified. Any production math model requires separate implementation, large-scale simulation, independent verification, certification and applicable regulatory approval.

## Examples

`packages/core/src/manifests/examples` contains non-production data for RouteRun Engine 001, Night Drop Game Pack 001, Shortcut and Five-Star features, theme, audio, illustrative math and assets. These examples demonstrate composition only and include no RouteRun or Night Drop gameplay.
