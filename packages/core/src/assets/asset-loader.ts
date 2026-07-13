import type { TypedEventBus } from "../event-bus.js";
import { AssetCache } from "./asset-cache.js";
import {
  AssetCancelledError,
  AssetSystemError,
  AssetTimeoutError,
  asAssetSystemError,
} from "./asset-errors.js";
import type { AssetEventMap } from "./asset-events.js";
import type { AssetRegistry } from "./asset-registry.js";
import type {
  AssetLoadAdapter,
  AssetLoadAdapterResult,
  AssetLoadFailure,
  AssetLoadOptions,
  AssetLoadResult,
  AssetLoadSuccess,
  AssetOptionalFailurePolicy,
  AssetRetryContext,
  AssetRetryPolicy,
  AssetRuntimeConditions,
  ResolvedAsset,
} from "./asset-types.js";

export interface AssetLoaderOptions<Resource> {
  readonly registry: AssetRegistry;
  readonly adapter: AssetLoadAdapter<Resource>;
  readonly conditions: AssetRuntimeConditions | (() => AssetRuntimeConditions);
  readonly cache?: AssetCache<Resource>;
  readonly concurrencyLimit?: number;
  readonly defaultTimeoutMs?: number;
  readonly retryPolicy?: AssetRetryPolicy;
  readonly optionalFailurePolicy?: AssetOptionalFailurePolicy;
  readonly events?: TypedEventBus<AssetEventMap>;
}

interface QueueItem {
  readonly task: () => Promise<unknown>;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly cancel: () => void;
}

export const DEFAULT_ASSET_LOAD_TIMEOUT_MS = 15_000;
export const DEFAULT_ASSET_LOAD_CONCURRENCY = 4;

export const NO_ASSET_RETRY: AssetRetryPolicy = Object.freeze({
  maximumAttempts: 1,
  shouldRetry: () => false,
  delayMs: () => 0,
});

/** Deterministic key for one logical asset's selected physical resource. */
export function assetCacheKey(asset: ResolvedAsset): string {
  return `${asset.assetId}|${asset.variantId ?? "base"}|${assetPhysicalIdentity(asset)}`;
}

export function assetPhysicalIdentity(asset: Pick<ResolvedAsset, "source" | "checksum">): string {
  return asset.checksum === null ? `source-fnv1a:${fnv1a(asset.source)}` : `checksum:${asset.checksum}`;
}

/** Environment-neutral request coordinator around a host-provided adapter. */
export class AssetLoader<Resource = unknown> {
  readonly registry: AssetRegistry;
  readonly cache: AssetCache<Resource>;
  readonly events: TypedEventBus<AssetEventMap>;
  readonly concurrencyLimit: number;
  readonly defaultTimeoutMs: number;
  private readonly adapter: AssetLoadAdapter<Resource>;
  private readonly conditionsProvider: () => AssetRuntimeConditions;
  private readonly defaultRetryPolicy: AssetRetryPolicy;
  private readonly optionalFailurePolicy: AssetOptionalFailurePolicy;
  private readonly inFlight = new Map<string, Promise<AssetLoadResult<Resource>>>();
  private readonly queue: QueueItem[] = [];
  private activeLoadsValue = 0;
  private failedCountValue = 0;

  constructor(options: AssetLoaderOptions<Resource>) {
    assertPositiveInteger(options.concurrencyLimit ?? DEFAULT_ASSET_LOAD_CONCURRENCY, "concurrency limit");
    assertTimeout(options.defaultTimeoutMs ?? DEFAULT_ASSET_LOAD_TIMEOUT_MS);
    assertRetryPolicy(options.retryPolicy ?? NO_ASSET_RETRY);
    this.registry = options.registry;
    this.events = options.events ?? options.registry.events;
    this.adapter = options.adapter;
    this.conditionsProvider = typeof options.conditions === "function" ? options.conditions : () => options.conditions as AssetRuntimeConditions;
    this.cache = options.cache ?? new AssetCache<Resource>({ events: this.events });
    this.concurrencyLimit = options.concurrencyLimit ?? DEFAULT_ASSET_LOAD_CONCURRENCY;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_ASSET_LOAD_TIMEOUT_MS;
    this.defaultRetryPolicy = options.retryPolicy ?? NO_ASSET_RETRY;
    this.optionalFailurePolicy = options.optionalFailurePolicy ?? "return-failure";
  }

  get pendingCount(): number { return this.inFlight.size; }
  get activeLoadCount(): number { return this.activeLoadsValue; }
  get failedCount(): number { return this.failedCountValue; }

  async load(id: string, options: AssetLoadOptions = {}): Promise<AssetLoadResult<Resource>> {
    const conditions = structuredClone(options.conditions ?? this.conditionsProvider());
    const chain = this.registry.resolveFallbackChain(id, conditions);
    const primary = chain[0];
    if (!primary) throw new AssetSystemError("UNKNOWN_ASSET", `Unknown asset: ${id}`);
    this.events.publish("asset:requested", { asset: primary });
    const retain = options.retain ?? true;
    for (let index = 0; index < chain.length; index += 1) {
      const candidate = chain[index];
      if (!candidate) continue;
      const key = assetCacheKey(candidate);
      const resource = this.cache.get(key, retain);
      if (resource === undefined) continue;
      const result: AssetLoadSuccess<Resource> = Object.freeze({
        status: "loaded",
        requestedAssetId: primary.requestedAssetId,
        resolvedAsset: candidate,
        resource,
        cacheKey: key,
        fromCache: true,
        usedFallback: index > 0,
        attempts: 0,
        estimatedBytesLoaded: 0,
        warnings: Object.freeze(index > 0 ? [`Using cached fallback ${candidate.assetId}`] : []),
      });
      this.events.publish("asset:cache-hit", { asset: candidate, cacheKey: key });
      this.events.publish("asset:loaded", { result });
      return result;
    }

    const requestKey = chain.map(assetCacheKey).join("||");
    let shared = this.inFlight.get(requestKey);
    if (!shared) {
      shared = this.performFallbackLoad(chain, options);
      this.inFlight.set(requestKey, shared);
      const cleanup = (): void => { if (this.inFlight.get(requestKey) === shared) this.inFlight.delete(requestKey); };
      void shared.then(cleanup, cleanup);
    }
    const result = await awaitWithSignal(shared, options.signal, primary.assetId);
    if (result.status === "failed" && (options.optionalFailurePolicy ?? this.optionalFailurePolicy) === "throw") {
      throw errorFromRecord(result.error);
    }
    if (result.status === "loaded" && retain) this.cache.retain(result.cacheKey);
    return result;
  }

  release(cacheKey: string): number { return this.cache.release(cacheKey); }
  pin(cacheKey: string): void { this.cache.pin(cacheKey); }
  unpin(cacheKey: string): void { this.cache.unpin(cacheKey); }

  dispose(id: string, conditions: AssetRuntimeConditions = this.conditionsProvider(), force = false): number {
    let removed = 0;
    for (const asset of this.registry.resolveFallbackChain(id, conditions)) {
      if (this.cache.remove(assetCacheKey(asset), force)) removed += 1;
    }
    return removed;
  }

  clearCache(force = false): number { return this.cache.clear({ force }); }

  private async performFallbackLoad(
    chain: readonly ResolvedAsset[],
    options: AssetLoadOptions,
  ): Promise<AssetLoadResult<Resource>> {
    const primary = chain[0];
    if (!primary) throw new AssetSystemError("UNKNOWN_ASSET", "Asset fallback chain is empty");
    const warnings: string[] = [];
    let attempts = 0;
    let lastError: AssetSystemError | null = null;
    for (let index = 0; index < chain.length; index += 1) {
      const candidate = chain[index];
      if (!candidate) continue;
      try {
        const loaded = await this.loadResolved(candidate, options);
        attempts += loaded.attempts;
        const bytes = loaded.adapterResult.estimatedBytes ?? candidate.estimatedBytes;
        const key = assetCacheKey(candidate);
        try {
          this.cache.set(key, loaded.adapterResult.resource, {
            assetId: candidate.assetId,
            estimatedBytes: bytes,
            ...(loaded.adapterResult.dispose === undefined ? {} : { dispose: loaded.adapterResult.dispose }),
          });
        } catch (error) {
          try { loaded.adapterResult.dispose?.(); } catch { /* cache failure remains primary */ }
          throw error;
        }
        const result: AssetLoadSuccess<Resource> = Object.freeze({
          status: "loaded",
          requestedAssetId: primary.requestedAssetId,
          resolvedAsset: candidate,
          resource: loaded.adapterResult.resource,
          cacheKey: key,
          fromCache: false,
          usedFallback: index > 0,
          attempts,
          estimatedBytesLoaded: bytes,
          warnings: Object.freeze([...warnings]),
        });
        this.events.publish("asset:loaded", { result });
        return result;
      } catch (error) {
        const structured = normalizeLoadError(error, candidate);
        if (structured.code === "ASSET_CANCELLED") {
          this.events.publish("asset:cancelled", { assetId: primary.assetId, error: structured.toRecord() });
          throw structured;
        }
        lastError = structured;
        attempts += attemptsFromError(structured);
        const next = chain[index + 1];
        if (next) {
          warnings.push(`Asset ${candidate.assetId} failed (${structured.code}); using fallback ${next.assetId}`);
          continue;
        }
      }
    }
    const finalError = finalizeLoadError(lastError, primary);
    this.failedCountValue += 1;
    this.events.publish("asset:failed", {
      asset: primary,
      error: finalError.toRecord(),
      required: primary.required,
    });
    if (primary.required) throw finalError;
    const failure: AssetLoadFailure = Object.freeze({
      status: "failed",
      requestedAssetId: primary.requestedAssetId,
      resolvedAsset: primary,
      error: finalError.toRecord(),
      attempts,
      warnings: Object.freeze([...warnings]),
    });
    return failure;
  }

  private async loadResolved(
    asset: ResolvedAsset,
    options: AssetLoadOptions,
  ): Promise<{ readonly adapterResult: AssetLoadAdapterResult<Resource>; readonly attempts: number }> {
    const retry = options.retryPolicy ?? this.defaultRetryPolicy;
    assertRetryPolicy(retry);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    assertTimeout(timeoutMs);
    let lastError: AssetSystemError | null = null;
    for (let attempt = 1; attempt <= retry.maximumAttempts; attempt += 1) {
      this.events.publish("asset:load-started", { asset, attempt });
      try {
        const adapterResult = await this.schedule(
          () => this.callAdapter(asset, attempt, timeoutMs, options.signal),
          options.signal,
          asset.assetId,
        );
        verifyChecksum(asset, adapterResult);
        return { adapterResult, attempts: attempt };
      } catch (error) {
        const structured = normalizeLoadError(error, asset, attempt);
        lastError = structured;
        if (structured.code === "ASSET_CANCELLED") throw structured;
        const retryContext: AssetRetryContext = { asset, attempt, error: structured.toRecord() };
        if (attempt >= retry.maximumAttempts || !retry.shouldRetry(retryContext)) throw structured;
        const delayMs = retry.delayMs(retryContext);
        if (!Number.isFinite(delayMs) || delayMs < 0) {
          throw new AssetSystemError("INVALID_ASSET", "Retry delay must be a finite non-negative number", {
            assetId: asset.assetId,
            details: { attempt, delayMs },
          });
        }
        this.events.publish("asset:retry-scheduled", {
          asset,
          attempt: attempt + 1,
          delayMs,
          error: structured.toRecord(),
        });
        await abortableDelay(delayMs, options.signal, asset.assetId);
      }
    }
    throw lastError ?? new AssetSystemError("REQUIRED_ASSET_LOAD_FAILURE", `Asset load failed: ${asset.assetId}`, { assetId: asset.assetId });
  }

  private callAdapter(
    asset: ResolvedAsset,
    attempt: number,
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
  ): Promise<AssetLoadAdapterResult<Resource>> {
    if (externalSignal?.aborted === true) return Promise.reject(new AssetCancelledError(asset.assetId, externalSignal.reason));
    const controller = new AbortController();
    let expired = false;
    let accepted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let externalAbort: (() => void) | undefined;
    const adapterPromise = Promise.resolve(this.adapter.load({
      asset,
      signal: controller.signal,
      attempt,
      onProgress: (progress) => this.events.publish("asset:load-progress", { asset, progress }),
    }));
    const barriers: Promise<never>[] = [];
    barriers.push(new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        expired = true;
        reject(new AssetTimeoutError(asset.assetId, timeoutMs));
        controller.abort(new AssetTimeoutError(asset.assetId, timeoutMs));
      }, timeoutMs);
    }));
    if (externalSignal) barriers.push(new Promise<never>((_, reject) => {
      externalAbort = () => {
        expired = true;
        const error = new AssetCancelledError(asset.assetId, externalSignal.reason);
        reject(error);
        controller.abort(error);
      };
      externalSignal.addEventListener("abort", externalAbort, { once: true });
    }));
    void adapterPromise.then((result) => { if (expired && !accepted) result.dispose?.(); }, () => undefined);
    return Promise.race([adapterPromise, ...barriers]).then((result) => {
      accepted = true;
      return result;
    }).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (externalSignal && externalAbort) externalSignal.removeEventListener("abort", externalAbort);
    });
  }

  private schedule<Value>(task: () => Promise<Value>, signal: AbortSignal | undefined, assetId: string): Promise<Value> {
    if (signal?.aborted === true) return Promise.reject(new AssetCancelledError(assetId, signal.reason));
    return new Promise<Value>((resolve, reject) => {
      let item: QueueItem;
      const cancel = (): void => {
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new AssetCancelledError(assetId, signal?.reason));
      };
      item = {
        task,
        signal,
        resolve: (value) => resolve(value as Value),
        reject,
        cancel,
      };
      signal?.addEventListener("abort", cancel, { once: true });
      this.queue.push(item);
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.activeLoadsValue < this.concurrencyLimit) {
      const item = this.queue.shift();
      if (!item) return;
      item.signal?.removeEventListener("abort", item.cancel);
      if (item.signal?.aborted === true) {
        item.reject(new AssetCancelledError("queued-asset", item.signal.reason));
        continue;
      }
      this.activeLoadsValue += 1;
      void Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
        this.activeLoadsValue -= 1;
        this.drainQueue();
      });
    }
  }
}

function normalizeLoadError(error: unknown, asset: ResolvedAsset, attempt?: number): AssetSystemError {
  if (error instanceof AssetSystemError) {
    if (attempt === undefined || error.details.attempt !== undefined) return error;
    return new AssetSystemError(error.code, error.message, {
      assetId: error.assetId ?? asset.assetId,
      recoverable: error.recoverable,
      details: { ...error.details, attempt },
      cause: error,
    });
  }
  return new AssetSystemError(
    asset.required ? "REQUIRED_ASSET_LOAD_FAILURE" : "OPTIONAL_ASSET_LOAD_FAILURE",
    `Adapter failed to load ${asset.assetId}`,
    { assetId: asset.assetId, recoverable: !asset.required, details: { attempt: attempt ?? 1 }, cause: error },
  );
}

function finalizeLoadError(error: AssetSystemError | null, primary: ResolvedAsset): AssetSystemError {
  const source = error ?? new AssetSystemError(
    primary.required ? "REQUIRED_ASSET_LOAD_FAILURE" : "OPTIONAL_ASSET_LOAD_FAILURE",
    `Asset failed to load: ${primary.assetId}`,
    { assetId: primary.assetId },
  );
  if (["ASSET_TIMEOUT", "CHECKSUM_MISMATCH", "CACHE_CAPACITY"].includes(source.code)) return source;
  const code = primary.required ? "REQUIRED_ASSET_LOAD_FAILURE" : "OPTIONAL_ASSET_LOAD_FAILURE";
  if (source.code === code) return source;
  return new AssetSystemError(code, `Asset failed to load: ${primary.assetId}`, {
    assetId: primary.assetId,
    recoverable: !primary.required,
    details: { sourceError: source.toRecord() },
    cause: source,
  });
}

function verifyChecksum<Resource>(asset: ResolvedAsset, result: AssetLoadAdapterResult<Resource>): void {
  if (asset.checksum !== null && result.checksum !== undefined && result.checksum !== asset.checksum) {
    throw new AssetSystemError("CHECKSUM_MISMATCH", `Checksum mismatch for ${asset.assetId}`, {
      assetId: asset.assetId,
      details: { expected: asset.checksum, actual: result.checksum },
    });
  }
}

function attemptsFromError(error: AssetSystemError): number {
  const attempt = error.details.attempt;
  return typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
}

function errorFromRecord(record: import("./asset-errors.js").AssetErrorRecord): AssetSystemError {
  return new AssetSystemError(record.code, record.message, {
    ...(record.assetId === null ? {} : { assetId: record.assetId }),
    recoverable: record.recoverable,
    details: record.details,
  });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AssetSystemError("INVALID_ASSET", `Asset ${label} must be a positive safe integer`);
}

function assertTimeout(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new AssetSystemError("INVALID_ASSET", "Asset timeout must be a finite non-negative number");
}

function assertRetryPolicy(policy: AssetRetryPolicy): void { assertPositiveInteger(policy.maximumAttempts, "retry maximum attempts"); }

function abortableDelay(delayMs: number, signal: AbortSignal | undefined, id: string): Promise<void> {
  if (delayMs === 0) return signal?.aborted === true ? Promise.reject(new AssetCancelledError(id, signal.reason)) : Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) { reject(new AssetCancelledError(id, signal.reason)); return; }
    const timeout = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    const cancel = (): void => { clearTimeout(timeout); cleanup(); reject(new AssetCancelledError(id, signal?.reason)); };
    const cleanup = (): void => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function awaitWithSignal<Value>(promise: Promise<Value>, signal: AbortSignal | undefined, id: string): Promise<Value> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AssetCancelledError(id, signal.reason));
  return new Promise((resolve, reject) => {
    const cancel = (): void => { cleanup(); reject(new AssetCancelledError(id, signal.reason)); };
    const cleanup = (): void => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    void promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
