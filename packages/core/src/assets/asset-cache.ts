import type { TypedEventBus } from "../event-bus.js";
import { AssetCacheCapacityError, AssetSystemError } from "./asset-errors.js";
import type { AssetEventMap } from "./asset-events.js";
import { compareAssetAscii } from "./asset-resolver.js";
import type {
  AssetCacheEntrySnapshot,
  AssetCacheSnapshot,
  AssetId,
} from "./asset-types.js";

export interface AssetCacheOptions {
  readonly maximumEstimatedBytes?: number;
  readonly events?: TypedEventBus<AssetEventMap>;
}

export interface AssetCacheSetOptions {
  readonly assetId: AssetId;
  readonly estimatedBytes: number;
  readonly pinned?: boolean;
  readonly dispose?: () => void;
}

export interface AssetCacheClearOptions { readonly force?: boolean; }

interface MutableCacheEntry<Resource> {
  readonly key: string;
  readonly assetId: AssetId;
  readonly resource: Resource;
  readonly estimatedBytes: number;
  readonly dispose: (() => void) | undefined;
  referenceCount: number;
  pinned: boolean;
  lastAccess: number;
}

export const DEFAULT_ASSET_CACHE_MAXIMUM_ESTIMATED_BYTES = 64 * 1024 * 1024;

/** In-memory estimated-byte LRU. It deliberately makes no browser-memory claims. */
export class AssetCache<Resource = unknown> {
  readonly maximumEstimatedBytes: number;
  private readonly events: TypedEventBus<AssetEventMap> | undefined;
  private entries = new Map<string, MutableCacheEntry<Resource>>();
  private accessSequence = 0;
  private estimatedBytesValue = 0;

  constructor(options: AssetCacheOptions = {}) {
    const maximum = options.maximumEstimatedBytes ?? DEFAULT_ASSET_CACHE_MAXIMUM_ESTIMATED_BYTES;
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new AssetSystemError("CACHE_CAPACITY", "Maximum estimated cache bytes must be a non-negative safe integer", {
        details: { maximumEstimatedBytes: maximum },
      });
    }
    this.maximumEstimatedBytes = maximum;
    this.events = options.events;
  }

  get totalEstimatedBytes(): number { return this.estimatedBytesValue; }
  get size(): number { return this.entries.size; }

  has(key: string): boolean { return this.entries.has(key); }

  get(key: string, retain = false): Resource | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.touch(entry);
    if (retain) entry.referenceCount += 1;
    return entry.resource;
  }

  peek(key: string): Resource | undefined { return this.entries.get(key)?.resource; }

  set(key: string, resource: Resource, options: AssetCacheSetOptions): AssetCacheEntrySnapshot {
    if (key.length === 0) throw new AssetSystemError("INVALID_ASSET", "Cache key must not be empty", { assetId: options.assetId });
    assertEstimatedBytes(options.estimatedBytes, options.assetId);
    const existing = this.entries.get(key);
    if (existing && (existing.referenceCount > 0 || existing.pinned)) {
      throw new AssetCacheCapacityError(options.assetId, options.estimatedBytes, this.maximumEstimatedBytes);
    }
    const baseUsage = this.estimatedBytesValue - (existing?.estimatedBytes ?? 0);
    const bytesToFree = Math.max(0, baseUsage + options.estimatedBytes - this.maximumEstimatedBytes);
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.key !== key && entry.referenceCount === 0 && !entry.pinned)
      .sort(compareEvictionCandidates);
    const selected: MutableCacheEntry<Resource>[] = [];
    let selectedBytes = 0;
    for (const candidate of candidates) {
      if (selectedBytes >= bytesToFree) break;
      selected.push(candidate);
      selectedBytes += candidate.estimatedBytes;
    }
    if (selectedBytes < bytesToFree) {
      throw new AssetCacheCapacityError(options.assetId, options.estimatedBytes, this.maximumEstimatedBytes);
    }
    selected.forEach((entry) => this.evict(entry, "capacity"));
    if (existing) this.evict(existing, "replace");
    const entry: MutableCacheEntry<Resource> = {
      key,
      assetId: options.assetId,
      resource,
      estimatedBytes: options.estimatedBytes,
      dispose: options.dispose,
      referenceCount: 0,
      pinned: options.pinned ?? false,
      lastAccess: this.nextAccess(),
    };
    this.entries.set(key, entry);
    this.estimatedBytesValue += entry.estimatedBytes;
    const snapshot = snapshotEntry(entry);
    this.events?.publish("asset:cached", { entry: snapshot });
    return snapshot;
  }

  remove(key: string, force = false): boolean {
    const entry = this.entries.get(key);
    if (!entry || (!force && (entry.referenceCount > 0 || entry.pinned))) return false;
    this.evict(entry, "remove");
    return true;
  }

  clear(options: AssetCacheClearOptions = {}): number {
    const candidates = [...this.entries.values()]
      .filter((entry) => options.force === true || (entry.referenceCount === 0 && !entry.pinned))
      .sort(compareEvictionCandidates);
    candidates.forEach((entry) => this.evict(entry, "clear"));
    return candidates.length;
  }

  retain(key: string): number {
    const entry = this.requiredEntry(key);
    entry.referenceCount += 1;
    this.touch(entry);
    return entry.referenceCount;
  }

  release(key: string): number {
    const entry = this.requiredEntry(key);
    if (entry.referenceCount === 0) {
      throw new AssetSystemError("INVALID_ASSET", `Cannot release unreferenced cache entry: ${key}`, {
        assetId: entry.assetId,
        details: { cacheKey: key },
      });
    }
    entry.referenceCount -= 1;
    this.touch(entry);
    return entry.referenceCount;
  }

  pin(key: string): void { const entry = this.requiredEntry(key); entry.pinned = true; this.touch(entry); }
  unpin(key: string): void { const entry = this.requiredEntry(key); entry.pinned = false; this.touch(entry); }

  entrySnapshot(key: string): AssetCacheEntrySnapshot | undefined {
    const entry = this.entries.get(key);
    return entry ? snapshotEntry(entry) : undefined;
  }

  findByAssetId(id: AssetId | string): readonly AssetCacheEntrySnapshot[] {
    return Object.freeze([...this.entries.values()]
      .filter((entry) => String(entry.assetId) === String(id))
      .sort((left, right) => compareAssetAscii(left.key, right.key))
      .map(snapshotEntry));
  }

  snapshot(): AssetCacheSnapshot {
    return Object.freeze({
      maximumEstimatedBytes: this.maximumEstimatedBytes,
      totalEstimatedBytes: this.estimatedBytesValue,
      entryCount: this.entries.size,
      entries: Object.freeze([...this.entries.values()]
        .sort((left, right) => compareAssetAscii(left.key, right.key))
        .map(snapshotEntry)),
    });
  }

  private requiredEntry(key: string): MutableCacheEntry<Resource> {
    const entry = this.entries.get(key);
    if (!entry) throw new AssetSystemError("UNKNOWN_ASSET", `Unknown cache entry: ${key}`, { details: { cacheKey: key } });
    return entry;
  }

  private evict(
    entry: MutableCacheEntry<Resource>,
    reason: "capacity" | "remove" | "clear" | "replace",
  ): void {
    if (!this.entries.delete(entry.key)) return;
    this.estimatedBytesValue -= entry.estimatedBytes;
    const snapshot = snapshotEntry(entry);
    this.events?.publish("asset:evicted", { entry: snapshot, reason });
    try { entry.dispose?.(); }
    catch { /* disposal cannot roll back an already-removed host resource */ }
    this.events?.publish("asset:disposed", { entry: snapshot, reason });
  }

  private touch(entry: MutableCacheEntry<Resource>): void { entry.lastAccess = this.nextAccess(); }
  private nextAccess(): number { const value = this.accessSequence; this.accessSequence += 1; return value; }
}

function compareEvictionCandidates<Resource>(left: MutableCacheEntry<Resource>, right: MutableCacheEntry<Resource>): number {
  if (left.lastAccess !== right.lastAccess) return left.lastAccess - right.lastAccess;
  return compareAssetAscii(left.key, right.key);
}

function snapshotEntry<Resource>(entry: MutableCacheEntry<Resource>): AssetCacheEntrySnapshot {
  return Object.freeze({
    key: entry.key,
    assetId: entry.assetId,
    estimatedBytes: entry.estimatedBytes,
    referenceCount: entry.referenceCount,
    pinned: entry.pinned,
    lastAccess: entry.lastAccess,
  });
}

function assertEstimatedBytes(value: number, id: AssetId): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AssetSystemError("CACHE_CAPACITY", `Estimated cache bytes for ${id} must be a non-negative safe integer`, {
      assetId: id,
      details: { estimatedBytes: value },
    });
  }
}
