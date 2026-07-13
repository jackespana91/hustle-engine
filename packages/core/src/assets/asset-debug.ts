import type { TypedEventBus } from "../event-bus.js";
import type { AssetCache } from "./asset-cache.js";
import type { AssetErrorRecord } from "./asset-errors.js";
import {
  ASSET_EVENT_NAMES,
  type AssetEventMap,
  type AssetEventName,
} from "./asset-events.js";
import { assetCacheKey, type AssetLoader } from "./asset-loader.js";
import type { AssetPreloader } from "./asset-preloader.js";
import type { AssetRegistry } from "./asset-registry.js";
import type {
  AssetDebugEventRecord,
  AssetDebugSnapshot,
  AssetRuntimeConditions,
} from "./asset-types.js";

export const ASSET_DEBUG_HISTORY_LIMIT = 30;

export interface AssetDebugAdapterOptions<Resource> {
  readonly registry: AssetRegistry;
  readonly cache: AssetCache<Resource>;
  readonly conditions: AssetRuntimeConditions | (() => AssetRuntimeConditions);
  readonly loader?: AssetLoader<Resource>;
  readonly preloader?: AssetPreloader<Resource>;
  readonly events?: TypedEventBus<AssetEventMap>;
}

export interface AssetDebugActions {
  readonly exportRegistrySnapshot: () => ReturnType<AssetRegistry["snapshot"]>;
  readonly clearCache: (force?: boolean) => number;
  readonly clearHistory: () => void;
}

/** Read-only, DOM-free projection used by Playground and the shared Debug Panel. */
export class AssetDebugAdapter<Resource = unknown> {
  readonly actions: AssetDebugActions;
  private readonly registry: AssetRegistry;
  private readonly cache: AssetCache<Resource>;
  private readonly loader: AssetLoader<Resource> | undefined;
  private readonly preloader: AssetPreloader<Resource> | undefined;
  private readonly conditions: () => AssetRuntimeConditions;
  private readonly events: AssetDebugEventRecord[] = [];
  private readonly errors: AssetErrorRecord[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private sequence = 0;

  constructor(options: AssetDebugAdapterOptions<Resource>) {
    this.registry = options.registry;
    this.cache = options.cache;
    this.loader = options.loader;
    this.preloader = options.preloader;
    this.conditions = typeof options.conditions === "function" ? options.conditions : () => options.conditions as AssetRuntimeConditions;
    const bus = options.events ?? options.registry.events;
    ASSET_EVENT_NAMES.forEach((name) => this.subscribe(bus, name));
    this.actions = Object.freeze({
      exportRegistrySnapshot: () => this.registry.snapshot(),
      clearCache: (force = false) => this.cache.clear({ force }),
      clearHistory: () => this.clearHistory(),
    });
  }

  snapshot(conditions: AssetRuntimeConditions = this.conditions()): AssetDebugSnapshot {
    const cache = this.cache.snapshot();
    const registrations = this.registry.list().map((entry) => {
      let resolved = null;
      try { resolved = this.registry.resolve(entry.id, conditions); }
      catch { /* invalid diagnostic conditions remain visible through a null resolution */ }
      const key = resolved === null ? null : assetCacheKey(resolved);
      const cached = key === null ? undefined : this.cache.entrySnapshot(key);
      return Object.freeze({
        entry,
        resolved,
        cached: cached !== undefined,
        cacheKey: key,
        referenceCount: cached?.referenceCount ?? 0,
        lastAccess: cached?.lastAccess ?? null,
      });
    });
    return Object.freeze({
      registeredCount: registrations.length,
      loadedCount: cache.entryCount,
      pendingCount: this.loader?.pendingCount ?? 0,
      failedCount: this.loader?.failedCount ?? this.errors.length,
      estimatedCacheBytes: cache.totalEstimatedBytes,
      activePreloadGroup: this.preloader?.activeGroup ?? null,
      progress: this.preloader?.progress ?? null,
      latestEvent: this.events[0] === undefined ? null : structuredClone(this.events[0]),
      latestEvents: Object.freeze(structuredClone(this.events)),
      latestErrors: Object.freeze(structuredClone(this.errors)),
      registrations: Object.freeze(registrations),
      cache,
      registry: this.registry.snapshot(),
    });
  }

  clearHistory(): void { this.events.length = 0; this.errors.length = 0; }

  destroy(): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.clearHistory();
  }

  private subscribe<Name extends AssetEventName>(bus: TypedEventBus<AssetEventMap>, name: Name): void {
    this.unsubscribers.push(bus.subscribe(name, (payload) => this.record(name, payload)));
  }

  private record<Name extends AssetEventName>(name: Name, payload: AssetEventMap[Name]): void {
    const sequence = this.sequence;
    this.sequence += 1;
    this.events.unshift(Object.freeze({ sequence, type: name, payload: debugPayload(name, payload) }));
    trim(this.events);
    if (name === "asset:failed") this.recordError((payload as AssetEventMap["asset:failed"]).error);
    else if (name === "asset:cancelled") this.recordError((payload as AssetEventMap["asset:cancelled"]).error);
    else if (name === "asset:reload-failed") this.recordError((payload as AssetEventMap["asset:reload-failed"]).error);
    else if (name === "asset:validation-failed") {
      (payload as AssetEventMap["asset:validation-failed"]).errors.forEach((error) => this.recordError(error));
    }
  }

  private recordError(error: AssetErrorRecord): void {
    this.errors.unshift(structuredClone(error));
    trim(this.errors);
  }
}

function debugPayload<Name extends AssetEventName>(name: Name, payload: AssetEventMap[Name]): unknown {
  if (name === "asset:loaded") {
    const result = (payload as AssetEventMap["asset:loaded"]).result;
    return result.status === "loaded" ? {
      result: {
        status: result.status,
        requestedAssetId: result.requestedAssetId,
        resolvedAsset: result.resolvedAsset,
        cacheKey: result.cacheKey,
        fromCache: result.fromCache,
        usedFallback: result.usedFallback,
        attempts: result.attempts,
        estimatedBytesLoaded: result.estimatedBytesLoaded,
        warnings: result.warnings,
      },
    } : { result };
  }
  try { return structuredClone(payload); }
  catch { return { diagnostic: "Event payload contains a host resource and was not cloned" }; }
}

function trim<Value>(values: Value[]): void {
  if (values.length > ASSET_DEBUG_HISTORY_LIMIT) values.length = ASSET_DEBUG_HISTORY_LIMIT;
}
