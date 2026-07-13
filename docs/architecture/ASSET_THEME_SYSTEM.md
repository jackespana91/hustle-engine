# Asset and Theme System

## Purpose

Hustle games request stable logical asset IDs and presentation tokens. They do not import physical file paths or embed a game pack's visual choices inside Hustle Core.

```text
game or engine code
        |
        |  character.runner.idle
        v
AssetRegistry + AssetResolver
        |
        |  externally supplied runtime conditions
        v
physical variant -> AssetLoader -> AssetCache

GameManifest -> ThemeManifest -> ThemeRegistry -> ThemeRuntime
                                           |
                                           v
                         immutable tokens and asset aliases
```

The system is infrastructure only. It does not implement RouteRun traversal, Night Drop mechanics, wagering, RNG, certified mathematics, real Stake APIs, final artwork, audio playback, DOM image construction, or PixiJS objects.

## Logical IDs and physical resources

`AssetEntry.id` is the API consumed by reusable engines and games. A definition contains a base physical source plus optional variants, tags, failure importance, preload membership, estimated size, fallback ID, checksum, and metadata.

Physical sources are data. The environment-specific adapter decides how to fetch or decode them. A browser may use `fetch`, image decoding, or a renderer-specific adapter; a test can return an in-memory value. Core never constructs DOM or renderer objects.

The first supported resource kinds are images, sprite sheets, animation data, font references, JSON, shader references, video references, binary resources, and an explicit `other` category. Audio references can be carried by manifests, but playback belongs to the later audio runtime.

## Manifest integration

The existing `ManifestRegistry` remains the composition authority. `resolveGame()` returns the game asset pack, the theme's referenced asset pack, and a stable bootstrap/base-game preload plan. An asset registry can also accept individual `AssetEntry` definitions for richer variant metadata.

Registration adapters reuse the Manifest System's validation rather than creating a competing manifest validator. Existing schema 1 manifests remain valid; newer optional fields add variants, estimated byte hints, and fallback IDs.

A host initializes a game in this order:

1. register related manifests transactionally;
2. resolve the `GameManifest` composition;
3. register the game and theme asset packs;
4. register and validate the applicable theme definitions;
5. activate the base and game theme atomically;
6. await the bootstrap preload before entering presentation;
7. start base-game or optional groups according to the host's loading policy.

If the theme and game reference different asset manifests, both are exposed. A host must not silently ignore the theme asset pack.

## Deterministic variant resolution

Runtime conditions are supplied explicitly by the host:

- platform;
- viewport width and height;
- device-pixel ratio;
- portrait or landscape orientation;
- locale;
- reduced-motion preference;
- quality tier;
- memory tier.

Core never guesses from a browser user agent. The same registry plus the same conditions produces the same physical resource.

Variant conditions are evaluated in this documented specificity order:

1. platform;
2. viewport bounds;
3. density;
4. orientation;
5. locale;
6. reduced motion;
7. quality tier;
8. memory tier.

Matching candidates are ranked by the number and specificity of their matching conditions. Equal candidates use ASCII variant ID order as the final stable tie-break. Registration order and locale-sensitive sorting do not affect the result. If no variant matches, the base source is used.

## Fallbacks

An entry may reference another logical asset as a fallback. Registration rejects missing fallback targets and cycles before any request can run. Loading follows the validated chain in order. A required primary can therefore fall back to a safe required placeholder, while diagnostics still report the primary failure and the fallback choice.

Fallbacks are presentation resilience, not a way to hide missing production content. Required production resources should still be validated and monitored.

## Loading boundary

`AssetLoader` coordinates logical requests around an injected `AssetLoadAdapter`. It provides:

- cancellation with `AbortSignal`;
- timeout enforcement;
- bounded concurrency;
- retry-policy injection;
- simultaneous-request deduplication;
- deterministic fallback traversal;
- checksum comparison when both expected and actual checksums exist;
- cache lookup and reference retention;
- disposal hooks;
- typed lifecycle events.

The loader adapter receives the resolved asset, attempt number, signal, and a progress callback. It returns a host resource plus estimated bytes, optional checksum and optional disposal callback. It must not mutate engine state.

### Required and optional failures

Required assets reject when their complete fallback chain fails. Optional assets return a structured failure by default, allowing the caller to continue and display a warning; a host may request throwing behavior explicitly. Preload results keep required failures, optional failures, skipped assets, warnings, duration, and estimated bytes separate.

Cancellation is not treated as a missing resource. Cancelled group entries are reported as skipped.

## Preload groups

Manifests and entries use named groups such as `bootstrap`, `core-ui`, `base-game`, `bonus`, `locale-specific`, and `optional-high-quality`.

Within one group, required entries precede optional entries and equal entries sort by ASCII logical ID. This determines request submission order; the loader's concurrency limit determines how many host operations may run at once. Repeated physical requests are deduplicated and cache-aware.

`AssetPreloadGroupResult` reports requested and loaded counts, required and optional failures, skipped IDs, duration, estimated bytes loaded, warnings, and the ordered per-asset results. Live progress is available through callbacks, typed events, and the debug adapter.

## Cache policy

`AssetCache` is an in-memory host-resource cache. It records:

- deterministic cache key and logical asset ID;
- estimated bytes;
- reference count;
- pinned status;
- monotonic last-access sequence.

The byte total is an estimate supplied by manifests or adapters. It is not claimed to be exact browser memory usage.

When capacity is needed, unreferenced and unpinned entries are evicted by least-recent access, with cache-key ASCII order as the tie-break. Referenced or pinned resources survive ordinary clear and eviction operations. Forced diagnostic cleanup is explicit. Disposal occurs after removal and cannot roll back an already-completed eviction.

## Theme definitions and tokens

A `ThemeDefinition` contains identity, version, layer, optional parent, compatible engines, incompatibilities, immutable token data, aliases and metadata.

Tokens remain typed data and can describe colours, gradients, typography, spacing, sizing, borders, radii, shadows, opacity, motion durations and easing, z-index, or component-specific values. Values are strings, finite numbers, or booleans. Core does not generate arbitrary CSS.

Token aliases map semantic names to token paths. Asset aliases are a separate map from semantic names to logical asset targets. Rendering packages decide how tokens become CSS variables, canvas styles, renderer configuration, or component props.

Unsafe paths and prototype-pollution keys are rejected. Resolved token trees, flat token maps and alias maps are immutable defensive copies.

## Inheritance and composition

Theme layers always resolve in this order:

1. base;
2. game;
3. operator;
4. seasonal;
5. accessibility.

Later values override earlier values. Parent themes are included before their children. The resolver validates missing parents, parent cycles, selected layer identity, layer ordering, engine compatibility and declared theme incompatibilities.

Every override is recorded as a token or alias conflict for inspection. Conflicts are informative when the later layer is valid; they do not depend on object insertion order. Deep merge code accepts plain data only and blocks prototype pollution.

## Atomic theme runtime

`ThemeRuntime.activate()` resolves before committing an initial composition. `swap()` also resolves the complete candidate before replacing the active value. An invalid swap therefore preserves the previous valid theme.

The runtime can:

- activate and deactivate;
- atomically swap a composition;
- inspect the resolved composition and stable hash;
- resolve tokens and aliases;
- serialize active theme metadata;
- restore active state transactionally.

Activation, deactivation, swaps, token and alias reads, serialization, restoration and failures publish typed events through the Core event bus.

## Snapshots and recovery

Resource recovery stores metadata only.

An asset runtime snapshot contains registry/manifests identity, resolved logical-to-physical identities, checksums, cache metadata, completed or active preload groups, and the explicit runtime conditions. It never contains decoded resources, blobs, byte arrays, data-URL contents, DOM nodes, or renderer objects.

During recovery, the asset runtime compares registry identity and physical/checksum identities. Cache entries still valid in the current host can be reused; missing required entries form a deterministic reload plan. The snapshot does not pretend that serialized cache metadata recreates a host resource.

A theme runtime snapshot contains its schema/state versions, active selection, ordered active theme IDs, definition versions, resolved token and asset aliases, and stable resolved hash. Restore resolves a candidate against the current registry, verifies this metadata, and only then replaces the active composition. A failed restore preserves the prior active theme.

`RecoverySnapshot.resourceRuntime` is optional for schema version 1, preserving older snapshots. Hosts should restore or validate resource state before resuming visible animation. Feature state and animation progress remain separate concerns.

## Events and diagnostics

Assets publish registration, removal, manifest registration, reload, request, start, progress, load, failure, cancellation, retry, cache, eviction, disposal and preload events. Themes publish registration, loading, validation, resolution, activation, deactivation, swapping, token/alias resolution and state events.

`AssetDebugAdapter` and `ThemeDebugAdapter` turn these runtimes into bounded, DOM-free snapshots. The shared Hustle Debug Panel displays concise ASSETS and THEME summaries. The Engine Playground owns the full responsive diagnostic workspace, host mock adapter and scenario controls.

## Ownership boundaries

Hustle Core owns contracts, deterministic resolution, registries, loader orchestration, cache policy, theme composition, events, recovery metadata, and DOM-free debug projections.

Commercial engine packages own reusable rendering interpretation and engine-specific presentation conventions. Game packs own their theme definitions, visual resources, final art, and configuration. A game pack must not contain a reusable loading, caching, variant-resolution, or theme-composition implementation.

Reusable mechanic logic must never be implemented in themes or asset metadata.

## Playground examples

The illustrative examples use generated/data-URL payloads and placeholder paths only. They cover low/high quality, portrait/landscape, locale, density, fallback, optional failure, required failure, timeout, operator, seasonal and high-contrast compositions. They are non-production presentation data and contain no Night Drop gameplay.

Run `npm run dev`, open the Vite URL, and scroll to **Assets & Themes**. The workspace exposes every required condition, preload, failure, fallback, cache, export and atomic-swap control. `Cmd+Shift+D` on macOS or `Ctrl+Shift+D` elsewhere opens the concise docked view.
