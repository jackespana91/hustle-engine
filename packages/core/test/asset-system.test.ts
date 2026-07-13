import { describe, expect, it, vi } from "vitest";
import {
  ASSET_EVENT_NAMES,
  ASSET_VARIANT_CONDITION_ORDER,
  AssetCache,
  AssetDebugAdapter,
  AssetLoader,
  AssetPreloader,
  AssetRecoveryManager,
  AssetRegistry,
  AssetSystemError,
  NIGHT_DROP_ILLUSTRATIVE_ASSET_ENTRIES,
  NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS,
  NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST,
  assetCacheKey,
  assetId,
  assetVariantId,
  type AssetEntry,
  type AssetLoadAdapterRequest,
  type AssetLoadAdapterResult,
  type AssetRuntimeConditions,
} from "../src/assets/index.js";
import {
  MANIFEST_SCHEMA_VERSION,
  assetFileId,
  assetManifestId,
  type AssetManifest,
} from "../src/manifests/manifest-types.js";

const CONDITIONS: AssetRuntimeConditions = Object.freeze({
  platform: "web",
  viewportWidth: 1280,
  viewportHeight: 720,
  devicePixelRatio: 1,
  orientation: "landscape",
  locale: "en-GB",
  reducedMotion: false,
  qualityTier: "medium",
  memoryTier: "standard",
});

type Handler = (request: AssetLoadAdapterRequest) => Promise<AssetLoadAdapterResult<string>>;

describe("Asset registry and deterministic resolver", () => {
  it("registers, discovers, filters, requires, and unregisters valid logical assets", () => {
    const registry = new AssetRegistry();
    const removed = vi.fn();
    registry.events.subscribe("asset:removed", removed);
    registry.registerMany([
      entry("ui.beta", { type: "json", tags: ["ui"] }),
      entry("ui.alpha", { type: "image", tags: ["ui", "bootstrap"] }),
    ]);

    expect(registry.list().map(({ id }) => id)).toEqual([assetId("ui.alpha"), assetId("ui.beta")]);
    expect(registry.filterByType("image").map(({ id }) => id)).toEqual([assetId("ui.alpha")]);
    expect(registry.filterByTag("ui")).toHaveLength(2);
    expect(registry.has("ui.alpha")).toBe(true);
    expect(registry.require("ui.alpha").id).toBe("ui.alpha");
    expect(registry.unregister("ui.beta")?.id).toBe("ui.beta");
    expect(removed).toHaveBeenCalledOnce();
  });

  it("rejects duplicates atomically with a structured error", () => {
    const registry = new AssetRegistry();
    registry.register(entry("asset.original"));
    expect(() => registry.registerMany([entry("asset.new"), entry("asset.original")]))
      .toThrowError(expect.objectContaining({ code: "DUPLICATE_ASSET" }));
    expect(registry.list().map(({ id }) => id)).toEqual([assetId("asset.original")]);
  });

  it("rejects unsafe physical sources", () => {
    const registry = new AssetRegistry();
    expect(() => registry.register(entry("asset.bad", { source: "javascript:alert(1)" })))
      .toThrowError(expect.objectContaining({ code: "INVALID_ASSET_PATH" }));
  });

  it("registers existing AssetManifest data through the canonical validator", () => {
    const registry = new AssetRegistry();
    const converted = registry.registerManifest(manifest());
    expect(converted.map(({ id }) => id)).toEqual([assetId("manifest-image"), assetId("manifest-json")]);
    expect(registry.require("manifest-image")).toMatchObject({
      type: "spritesheet",
      preloadGroup: "bootstrap",
      required: true,
      estimatedBytes: 100,
      variants: [{ id: "quality-high", source: "assets/image-high.png" }],
    });
    expect(registry.require("manifest-json")).toMatchObject({
      optionalGroup: "locale-specific",
      fallbackAssetId: "manifest-image",
    });
    expect(registry.listManifests()).toHaveLength(1);
  });

  it("publishes a broad typed event surface", () => {
    expect(ASSET_EVENT_NAMES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(ASSET_EVENT_NAMES).size).toBe(ASSET_EVENT_NAMES.length);
    expect(ASSET_EVENT_NAMES).toEqual(expect.arrayContaining([
      "asset:registered", "asset:requested", "asset:load-started", "asset:loaded",
      "asset:failed", "asset:cancelled", "asset:evicted", "asset:preload-completed",
      "asset:validation-failed",
    ]));
  });

  it("resolves identical registry and runtime inputs identically", () => {
    const registry = new AssetRegistry();
    registry.register(variantEntry());
    const first = registry.resolve("asset.variant", CONDITIONS);
    const second = registry.resolve("asset.variant", structuredClone(CONDITIONS));
    expect(second).toEqual(first);
    expect(ASSET_VARIANT_CONDITION_ORDER).toEqual([
      "platform", "viewport", "density", "orientation", "locale", "reducedMotion", "qualityTier", "memoryTier",
    ]);
  });

  it("uses raw ASCII variant ID as the final stable tie-break", () => {
    const registry = new AssetRegistry();
    registry.register(entry("asset.tie", {
      variants: [
        { id: assetVariantId("z-variant"), source: "assets/z.bin", conditions: { platform: "web" } },
        { id: assetVariantId("A-variant"), source: "assets/a.bin", conditions: { platform: "web" } },
      ],
    }));
    expect(registry.resolve("asset.tie", CONDITIONS).variantId).toBe("A-variant");
  });

  it("selects a platform condition without user-agent inference", () => {
    expect(resolveWith({ platform: "desktop-web" }, { platform: "desktop-web" }).source).toBe("assets/matched.bin");
  });

  it("selects a viewport condition", () => {
    expect(resolveWith({ viewport: { minWidth: 1000, maxHeight: 800 } }).source).toBe("assets/matched.bin");
  });

  it("selects a density condition", () => {
    expect(resolveWith({ density: { min: 2 } }, { devicePixelRatio: 2 }).source).toBe("assets/matched.bin");
  });

  it("selects an orientation condition", () => {
    expect(resolveWith({ orientation: "portrait" }, {
      orientation: "portrait", viewportWidth: 600, viewportHeight: 900,
    }).source).toBe("assets/matched.bin");
  });

  it("selects exact and base-language locale conditions deterministically", () => {
    const registry = new AssetRegistry();
    registry.register(entry("asset.locale", {
      variants: [
        { id: assetVariantId("locale-base"), source: "assets/es.bin", conditions: { locale: "es" } },
        { id: assetVariantId("locale-exact"), source: "assets/es-es.bin", conditions: { locale: "es-ES" } },
      ],
    }));
    expect(registry.resolve("asset.locale", conditions({ locale: "es-ES" })).variantId).toBe("locale-exact");
    expect(registry.resolve("asset.locale", conditions({ locale: "es-MX" })).variantId).toBe("locale-base");
  });

  it("selects reduced-motion, quality-tier, and memory-tier conditions", () => {
    expect(resolveWith({ reducedMotion: true }, { reducedMotion: true }).variantId).toBe("matched");
    expect(resolveWith({ qualityTier: "high" }, { qualityTier: "high" }).variantId).toBe("matched");
    expect(resolveWith({ memoryTier: "constrained" }, { memoryTier: "constrained" }).variantId).toBe("matched");
  });

  it("resolves a validated fallback chain while retaining the original requested ID", () => {
    const registry = new AssetRegistry();
    registry.registerMany([
      entry("fallback.safe"),
      entry("fallback.primary", { fallbackAssetId: assetId("fallback.safe") }),
    ]);
    const chain = registry.resolveFallbackChain("fallback.primary", CONDITIONS);
    expect(chain.map(({ assetId }) => assetId)).toEqual([assetId("fallback.primary"), assetId("fallback.safe")]);
    expect(chain.every(({ requestedAssetId }) => requestedAssetId === "fallback.primary")).toBe(true);
  });

  it("rejects missing fallbacks without mutating the valid registry", () => {
    const registry = new AssetRegistry();
    registry.register(entry("fallback.existing"));
    expect(() => registry.register(entry("fallback.bad", { fallbackAssetId: assetId("fallback.missing") })))
      .toThrowError(expect.objectContaining({ code: "MISSING_FALLBACK" }));
    expect(registry.list().map(({ id }) => id)).toEqual([assetId("fallback.existing")]);
  });

  it("rejects circular fallback chains", () => {
    const registry = new AssetRegistry();
    expect(() => registry.registerMany([
      entry("fallback.a", { fallbackAssetId: assetId("fallback.b") }),
      entry("fallback.b", { fallbackAssetId: assetId("fallback.a") }),
    ])).toThrowError(expect.objectContaining({ code: "CIRCULAR_FALLBACK" }));
  });

  it("snapshots metadata only and clears deterministically", () => {
    const registry = new AssetRegistry();
    registry.register(entry("snapshot.asset", { estimatedBytes: 20 }));
    expect(registry.snapshot()).toMatchObject({ schemaVersion: 1, entries: [{ id: "snapshot.asset", estimatedBytes: 20 }] });
    registry.clear();
    expect(registry.snapshot().entries).toEqual([]);
  });

  it("reloads atomically and preserves the previous registry on invalid development data", () => {
    const registry = new AssetRegistry();
    registry.register(entry("reload.old"));
    registry.atomicReload({ entries: [entry("reload.new")] });
    expect(registry.has("reload.new")).toBe(true);
    expect(() => registry.atomicReload({
      entries: [entry("reload.bad", { fallbackAssetId: assetId("reload.missing") })],
    })).toThrowError(expect.objectContaining({ code: "ATOMIC_RELOAD_FAILURE" }));
    expect(registry.list().map(({ id }) => id)).toEqual([assetId("reload.new")]);
  });
});

describe("Estimated-byte LRU asset cache", () => {
  it("stores resources and reports clearly estimated usage", () => {
    const cache = new AssetCache<string>({ maximumEstimatedBytes: 100 });
    cache.set("a", "resource-a", { assetId: assetId("cache.a"), estimatedBytes: 25 });
    expect(cache.get("a")).toBe("resource-a");
    expect(cache.snapshot()).toMatchObject({ totalEstimatedBytes: 25, entryCount: 1 });
  });

  it("tracks references and protects referenced resources from removal", () => {
    const cache = new AssetCache<string>({ maximumEstimatedBytes: 100 });
    cache.set("a", "resource-a", { assetId: assetId("cache.a"), estimatedBytes: 25 });
    cache.retain("a");
    expect(cache.remove("a")).toBe(false);
    expect(cache.release("a")).toBe(0);
    expect(cache.remove("a")).toBe(true);
  });

  it("keeps pinned entries during normal clear and eviction", () => {
    const cache = new AssetCache<string>({ maximumEstimatedBytes: 10 });
    cache.set("pinned", "p", { assetId: assetId("cache.pinned"), estimatedBytes: 10, pinned: true });
    expect(cache.clear()).toBe(0);
    expect(() => cache.set("new", "n", { assetId: assetId("cache.new"), estimatedBytes: 1 }))
      .toThrowError(expect.objectContaining({ code: "CACHE_CAPACITY" }));
    expect(cache.has("pinned")).toBe(true);
  });

  it("evicts least-recently-used unreferenced entries with ASCII tie-breaking", () => {
    const cache = new AssetCache<string>({ maximumEstimatedBytes: 20 });
    cache.set("a", "a", { assetId: assetId("cache.a"), estimatedBytes: 10 });
    cache.set("b", "b", { assetId: assetId("cache.b"), estimatedBytes: 10 });
    cache.get("a");
    cache.set("c", "c", { assetId: assetId("cache.c"), estimatedBytes: 10 });
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("invokes disposal hooks when resources leave the cache", () => {
    const dispose = vi.fn();
    const cache = new AssetCache<string>({ maximumEstimatedBytes: 10 });
    cache.set("a", "a", { assetId: assetId("cache.a"), estimatedBytes: 10, dispose });
    cache.set("b", "b", { assetId: assetId("cache.b"), estimatedBytes: 10 });
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("Environment-neutral asset loader", () => {
  it("deduplicates simultaneous requests, caches once, and retains per consumer", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn<Handler>(async ({ asset }) => { await gate; return { resource: asset.source, estimatedBytes: 12 }; });
    const runtime = setup([entry("load.dedupe", { estimatedBytes: 12 })], handler);

    const first = runtime.loader.load("load.dedupe");
    const second = runtime.loader.load("load.dedupe");
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe("loaded");
    expect(secondResult.status).toBe("loaded");
    const key = firstResult.status === "loaded" ? firstResult.cacheKey : "";
    expect(runtime.cache.entrySnapshot(key)?.referenceCount).toBe(2);
  });

  it("enforces the configured adapter concurrency limit", async () => {
    let active = 0;
    let maximum = 0;
    const handler: Handler = async ({ asset }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await delay(5);
      active -= 1;
      return { resource: asset.source };
    };
    const runtime = setup([
      entry("concurrency.a"), entry("concurrency.b"), entry("concurrency.c"), entry("concurrency.d"),
    ], handler, { concurrencyLimit: 2 });
    await Promise.all(runtime.registry.list().map(({ id }) => runtime.loader.load(id, { retain: false })));
    expect(maximum).toBe(2);
  });

  it("cancels an active adapter request with AbortSignal", async () => {
    let started: (() => void) | undefined;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const runtime = setup([entry("load.cancel")], ({ signal }) => new Promise<AssetLoadAdapterResult<string>>((_, reject) => {
      started?.();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const controller = new AbortController();
    const request = runtime.loader.load("load.cancel", { signal: controller.signal });
    await didStart;
    controller.abort("test cancellation");
    await expect(request).rejects.toMatchObject({ code: "ASSET_CANCELLED" });
    expect(runtime.cache.size).toBe(0);
  });

  it("times out an adapter that does not settle", async () => {
    const runtime = setup([entry("load.timeout")], () => new Promise<AssetLoadAdapterResult<string>>(() => undefined));
    await expect(runtime.loader.load("load.timeout", { timeoutMs: 5 }))
      .rejects.toMatchObject({ code: "ASSET_TIMEOUT" });
  });

  it("applies an explicit retry policy", async () => {
    let calls = 0;
    const runtime = setup([entry("load.retry")], async ({ asset }) => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { resource: asset.source };
    });
    const result = await runtime.loader.load("load.retry", {
      retryPolicy: { maximumAttempts: 2, shouldRetry: () => true, delayMs: () => 0 },
    });
    expect(result).toMatchObject({ status: "loaded", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("returns a visible structured failure for an optional asset", async () => {
    const runtime = setup([entry("load.optional", { required: false })], async () => { throw new Error("missing"); });
    const result = await runtime.loader.load("load.optional");
    expect(result).toMatchObject({ status: "failed", error: { code: "OPTIONAL_ASSET_LOAD_FAILURE", recoverable: true } });
  });

  it("throws a structured required failure", async () => {
    const runtime = setup([entry("load.required")], async () => { throw new Error("missing"); });
    await expect(runtime.loader.load("load.required"))
      .rejects.toMatchObject({ code: "REQUIRED_ASSET_LOAD_FAILURE", assetId: "load.required" });
  });

  it("loads a validated fallback after a primary adapter failure", async () => {
    const runtime = setup([
      entry("load.fallback.safe", { source: "assets/safe.bin" }),
      entry("load.fallback.primary", { source: "assets/fail.bin", fallbackAssetId: assetId("load.fallback.safe") }),
    ], async ({ asset }) => {
      if (asset.source.includes("fail")) throw new Error("primary unavailable");
      return { resource: asset.source };
    });
    const result = await runtime.loader.load("load.fallback.primary");
    expect(result).toMatchObject({ status: "loaded", usedFallback: true, resolvedAsset: { assetId: "load.fallback.safe" } });
  });

  it("rejects an adapter-reported checksum mismatch", async () => {
    const runtime = setup([entry("load.checksum", { checksum: "expected" })], async ({ asset }) => ({
      resource: asset.source,
      checksum: "actual",
    }));
    await expect(runtime.loader.load("load.checksum")).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
  });

  it("serves later requests from cache without reloading", async () => {
    const handler = vi.fn<Handler>(async ({ asset }) => ({ resource: asset.source, estimatedBytes: 8 }));
    const runtime = setup([entry("load.cached")], handler);
    const first = await runtime.loader.load("load.cached", { retain: false });
    const second = await runtime.loader.load("load.cached", { retain: false });
    expect(first).toMatchObject({ status: "loaded", fromCache: false });
    expect(second).toMatchObject({ status: "loaded", fromCache: true });
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("Preload groups and DOM-free diagnostics", () => {
  it("requests required assets first and then uses ASCII logical-ID order", async () => {
    const calls: string[] = [];
    const runtime = setup([
      entry("group.z-optional", { required: false, optionalGroup: "base-game" }),
      entry("group.b-required", { preloadGroup: "base-game" }),
      entry("group.a-required", { preloadGroup: "base-game" }),
    ], async ({ asset }) => { calls.push(asset.assetId); return { resource: asset.source }; }, { concurrencyLimit: 1 });
    const preloader = new AssetPreloader(runtime.registry, runtime.loader, { clock: sequenceClock([0, 10]) });
    const result = await preloader.preloadGroup("base-game");
    expect(calls).toEqual(["group.a-required", "group.b-required", "group.z-optional"]);
    expect(result).toMatchObject({ requestedCount: 3, loadedCount: 3, durationMs: 10 });
  });

  it("reports required and optional failures separately while completing the group", async () => {
    const runtime = setup([
      entry("group.good", { preloadGroup: "failure-group" }),
      entry("group.required-fail", { preloadGroup: "failure-group", source: "assets/fail-required.bin" }),
      entry("group.optional-fail", { required: false, optionalGroup: "failure-group", source: "assets/fail-optional.bin" }),
    ], async ({ asset }) => {
      if (asset.source.includes("fail")) throw new Error("illustrative failure");
      return { resource: asset.source, estimatedBytes: 7 };
    });
    const preloader = new AssetPreloader(runtime.registry, runtime.loader, { clock: sequenceClock([5, 17]) });
    const result = await preloader.preloadGroup("failure-group");
    expect(result.loadedCount).toBe(1);
    expect(result.failedRequiredAssets).toHaveLength(1);
    expect(result.failedOptionalAssets).toHaveLength(1);
    expect(result.durationMs).toBe(12);
  });

  it("reports monotonic progress ending at one", async () => {
    const runtime = setup([
      entry("progress.a", { preloadGroup: "bootstrap" }),
      entry("progress.b", { preloadGroup: "bootstrap" }),
    ], async ({ asset }) => ({ resource: asset.source }));
    const progress: number[] = [];
    const preloader = new AssetPreloader(runtime.registry, runtime.loader);
    await preloader.preloadGroup("bootstrap", { onProgress: (value) => progress.push(value.fraction) });
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0))).toBe(true);
  });

  it("marks a pre-cancelled preload as skipped", async () => {
    const runtime = setup([entry("group.skipped", { preloadGroup: "bootstrap" })], async ({ asset }) => ({ resource: asset.source }));
    const controller = new AbortController();
    controller.abort();
    const result = await new AssetPreloader(runtime.registry, runtime.loader).preloadGroup("bootstrap", { signal: controller.signal });
    expect(result.skippedAssetIds).toEqual([assetId("group.skipped")]);
  });

  it("projects registry, cache, progress, and sanitized event history without DOM dependencies", async () => {
    const runtime = setup([entry("debug.asset", { estimatedBytes: 9 })], async ({ asset }) => ({ resource: asset.source, estimatedBytes: 9 }));
    const preloader = new AssetPreloader(runtime.registry, runtime.loader);
    const debug = new AssetDebugAdapter({
      registry: runtime.registry,
      cache: runtime.cache,
      loader: runtime.loader,
      preloader,
      conditions: CONDITIONS,
    });
    await runtime.loader.load("debug.asset", { retain: false });
    const snapshot = debug.snapshot();
    expect(snapshot).toMatchObject({ registeredCount: 1, loadedCount: 1, estimatedCacheBytes: 9 });
    expect(snapshot.registrations[0]).toMatchObject({ cached: true, resolved: { assetId: "debug.asset" } });
    expect(snapshot.latestEvents.some(({ type }) => type === "asset:loaded")).toBe(true);
    debug.destroy();
  });

  it("provides non-production Night Drop resolution and explicit failure scenarios", () => {
    const registry = new AssetRegistry();
    registry.registerMany(NIGHT_DROP_ILLUSTRATIVE_ASSET_ENTRIES);
    expect(registry.resolve(NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.qualityExample, conditions({ qualityTier: "high" })).variantId)
      .toBe("quality-high");
    expect(registry.resolve(NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.orientationExample, conditions({
      orientation: "portrait", viewportWidth: 600, viewportHeight: 900,
    })).variantId).toBe("layout-portrait");
    expect(registry.resolve(NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.localeExample, conditions({ locale: "es-ES" })).variantId)
      .toBe("locale-es");
    expect(registry.require(NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.optionalFailure).metadata).toMatchObject({ illustrativeFailure: "missing-optional" });
    expect(registry.require(NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.requiredFailure).required).toBe(true);
    expect(NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST.metadata).toMatchObject({ nonProduction: true });
  });

  it("captures resource-free recovery metadata and stable physical identities", async () => {
    const runtime = setup([
      entry("recovery.asset", {
        source: "data:text/plain,resource-bytes-must-not-enter-snapshot",
        preloadGroup: "bootstrap",
        checksum: "recovery-checksum",
      }),
    ], async () => ({ resource: "decoded-host-resource", estimatedBytes: 22, checksum: "recovery-checksum" }));
    await runtime.loader.load("recovery.asset", { retain: false });
    const recovery = new AssetRecoveryManager({
      registry: runtime.registry,
      cache: runtime.cache,
      loader: runtime.loader,
      conditions: CONDITIONS,
    });
    const snapshot = recovery.snapshot({ completedPreloadGroups: ["bootstrap"], activePreloadGroup: "bonus" });
    const serialized = JSON.stringify(snapshot);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      completedPreloadGroups: ["bootstrap"],
      activePreloadGroup: "bonus",
      resolvedAssets: [{ assetId: "recovery.asset", physicalIdentity: "checksum:recovery-checksum" }],
    });
    expect(serialized).not.toContain("resource-bytes-must-not-enter-snapshot");
    expect(serialized).not.toContain("decoded-host-resource");
  });

  it("reuses valid cache identities and reloads only missing recovery resources", async () => {
    const handler = vi.fn<Handler>(async ({ asset }) => ({ resource: asset.source, estimatedBytes: 10 }));
    const runtime = setup([entry("recovery.reload")], handler);
    await runtime.loader.load("recovery.reload", { retain: false });
    const recovery = new AssetRecoveryManager({
      registry: runtime.registry,
      cache: runtime.cache,
      loader: runtime.loader,
      conditions: CONDITIONS,
    });
    const snapshot = recovery.snapshot();
    expect(recovery.createRecoveryPlan(snapshot).assetIdsToReload).toEqual([]);
    runtime.cache.clear({ force: true });
    expect(recovery.createRecoveryPlan(snapshot).assetIdsToReload).toEqual([assetId("recovery.reload")]);
    const restored = await recovery.restore(snapshot);
    expect(restored.reloadedAssetIds).toEqual([assetId("recovery.reload")]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("rejects incompatible recovery metadata without clearing valid cache entries", async () => {
    const runtime = setup([entry("recovery.valid")], async ({ asset }) => ({ resource: asset.source }));
    await runtime.loader.load("recovery.valid", { retain: false });
    const recovery = new AssetRecoveryManager({ registry: runtime.registry, cache: runtime.cache, conditions: CONDITIONS });
    const invalid = { ...recovery.snapshot(), schemaVersion: 2 } as unknown as Parameters<typeof recovery.createRecoveryPlan>[0];
    expect(() => recovery.createRecoveryPlan(invalid)).toThrowError(expect.objectContaining({
      code: "UNSUPPORTED_ASSET_SNAPSHOT_VERSION",
    }));
    expect(runtime.cache.size).toBe(1);
  });
});

function entry(id: string, overrides: Omit<Partial<AssetEntry>, "id"> = {}): AssetEntry {
  return {
    id: assetId(id),
    type: "binary",
    source: `assets/${id}.bin`,
    required: true,
    tags: [],
    variants: [],
    metadata: { test: true },
    ...overrides,
  };
}

function variantEntry(): AssetEntry {
  return entry("asset.variant", {
    variants: [
      { id: assetVariantId("platform-web"), source: "assets/web.bin", conditions: { platform: "web" } },
      { id: assetVariantId("quality-high"), source: "assets/high.bin", conditions: { qualityTier: "high" } },
    ],
  });
}

function conditions(overrides: Partial<AssetRuntimeConditions> = {}): AssetRuntimeConditions {
  return { ...CONDITIONS, ...overrides };
}

function resolveWith(
  variantConditions: AssetEntry["variants"][number]["conditions"],
  runtimeOverrides: Partial<AssetRuntimeConditions> = {},
) {
  const registry = new AssetRegistry();
  registry.register(entry("asset.condition", {
    variants: [{ id: assetVariantId("matched"), source: "assets/matched.bin", conditions: variantConditions }],
  }));
  return registry.resolve("asset.condition", conditions(runtimeOverrides));
}

function manifest(): AssetManifest {
  return {
    manifestType: "asset",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id: assetManifestId("asset-test-manifest"),
    name: "Asset Test Manifest",
    version: "1.0.0",
    files: [
      {
        id: assetFileId("manifest-image"), path: "assets/image.png", type: "spritesheet", required: true,
        checksum: "image-v1", estimatedBytes: 100, tags: ["ui"],
        variants: [{
          id: "quality-high", path: "assets/image-high.png", estimatedBytes: 200,
          conditions: { qualityTier: "high" }, metadata: { testVariant: true },
        }],
        metadata: { test: true },
      },
      {
        id: assetFileId("manifest-json"), path: "assets/locale.json", type: "json", required: false,
        checksum: "json-v1", fallbackAssetId: assetFileId("manifest-image"), tags: ["locale"], metadata: { test: true },
      },
    ],
    preloadGroups: { bootstrap: [assetFileId("manifest-image")] },
    optionalGroups: { "locale-specific": [assetFileId("manifest-json")] },
    metadata: { test: true },
  };
}

function setup(
  entries: readonly AssetEntry[],
  handler: Handler,
  options: { readonly concurrencyLimit?: number; readonly maximumEstimatedBytes?: number } = {},
) {
  const registry = new AssetRegistry();
  registry.registerMany(entries);
  const cache = new AssetCache<string>({
    events: registry.events,
    maximumEstimatedBytes: options.maximumEstimatedBytes ?? 1024,
  });
  const loader = new AssetLoader<string>({
    registry,
    cache,
    adapter: { load: handler },
    conditions: CONDITIONS,
    concurrencyLimit: options.concurrencyLimit ?? 4,
    defaultTimeoutMs: 100,
  });
  return { registry, cache, loader };
}

function sequenceClock(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
