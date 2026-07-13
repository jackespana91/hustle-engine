import { AssetCancelledError, AssetSystemError, asAssetSystemError } from "./asset-errors.js";
import type { AssetLoader } from "./asset-loader.js";
import { AssetProgressTracker } from "./asset-progress.js";
import type { AssetRegistry } from "./asset-registry.js";
import type {
  AssetEntry,
  AssetLoadResult,
  AssetPreloadGroupResult,
  AssetPreloadOptions,
  AssetPreloadProgress,
} from "./asset-types.js";

export interface AssetPreloaderOptions {
  readonly clock?: () => number;
}

/** Deterministic group coordinator; actual parallelism remains owned by AssetLoader. */
export class AssetPreloader<Resource = unknown> {
  private readonly clock: () => number;
  private activeGroupValue: string | null = null;
  private progressValue: AssetPreloadProgress | null = null;
  private readonly completedGroupsValue = new Set<string>();

  constructor(
    readonly registry: AssetRegistry,
    readonly loader: AssetLoader<Resource>,
    options: AssetPreloaderOptions = {},
  ) {
    this.clock = options.clock ?? monotonicNow;
  }

  get activeGroup(): string | null { return this.activeGroupValue; }
  get progress(): AssetPreloadProgress | null { return this.progressValue === null ? null : structuredClone(this.progressValue); }
  get completedGroups(): readonly string[] { return Object.freeze([...this.completedGroupsValue].sort()); }

  preloadGroup(group: string, options: AssetPreloadOptions = {}): Promise<AssetPreloadGroupResult> {
    return this.preloadEntries(group, this.registry.listGroup(group, { includeOptional: options.includeOptional ?? true }), options);
  }

  loadOptionalGroup(group: string, options: AssetPreloadOptions = {}): Promise<AssetPreloadGroupResult> {
    return this.preloadEntries(group, this.registry.listOptionalGroup(group), options);
  }

  private async preloadEntries(
    group: string,
    entries: readonly AssetEntry[],
    options: AssetPreloadOptions,
  ): Promise<AssetPreloadGroupResult> {
    if (this.activeGroupValue !== null) {
      throw new AssetSystemError("INVALID_ASSET", `Preload group ${this.activeGroupValue} is already active`, {
        details: { requestedGroup: group },
      });
    }
    const ids = Object.freeze(entries.map(({ id }) => id));
    const tracker = new AssetProgressTracker(group, ids);
    const startedAt = this.clock();
    this.activeGroupValue = group;
    this.progressValue = tracker.snapshot();
    this.loader.events.publish("asset:preload-started", { group, assetIds: ids });
    this.publishProgress(this.progressValue, options);

    const results: AssetLoadResult[] = [];
    const requiredErrors: ReturnType<AssetSystemError["toRecord"]>[] = [];
    const optionalErrors: ReturnType<AssetSystemError["toRecord"]>[] = [];
    const skipped: AssetEntry[] = [];
    const warnings: string[] = [];
    try {
      await Promise.all(entries.map(async (entry) => {
        this.publishProgress(tracker.begin(entry.id), options);
        if (options.signal?.aborted === true) {
          skipped.push(entry);
          this.publishProgress(tracker.complete(entry.id, "skipped"), options);
          return;
        }
        try {
          const result = await this.loader.load(entry.id, { ...options, retain: options.retain ?? false });
          results.push(result);
          warnings.push(...result.warnings);
          if (result.status === "loaded") this.publishProgress(tracker.complete(entry.id, "loaded"), options);
          else {
            optionalErrors.push(result.error);
            this.publishProgress(tracker.complete(entry.id, "failed-optional"), options);
          }
        } catch (error) {
          const structured = asAssetSystemError(
            error,
            entry.required ? "REQUIRED_ASSET_LOAD_FAILURE" : "OPTIONAL_ASSET_LOAD_FAILURE",
            `Preload failed for ${entry.id}`,
            { assetId: entry.id, recoverable: !entry.required },
          );
          if (structured instanceof AssetCancelledError || structured.code === "ASSET_CANCELLED") {
            skipped.push(entry);
            this.publishProgress(tracker.complete(entry.id, "skipped"), options);
          } else if (entry.required) {
            requiredErrors.push(structured.toRecord());
            this.publishProgress(tracker.complete(entry.id, "failed-required"), options);
          } else {
            optionalErrors.push(structured.toRecord());
            this.publishProgress(tracker.complete(entry.id, "failed-optional"), options);
          }
        }
      }));
      const endedAt = this.clock();
      const orderedResults = results.slice().sort((left, right) => {
        const leftIndex = ids.indexOf(left.requestedAssetId);
        const rightIndex = ids.indexOf(right.requestedAssetId);
        return leftIndex - rightIndex;
      });
      const result: AssetPreloadGroupResult = Object.freeze({
        group,
        requestedCount: entries.length,
        loadedCount: orderedResults.filter((item) => item.status === "loaded").length,
        failedRequiredAssets: Object.freeze(requiredErrors),
        failedOptionalAssets: Object.freeze(optionalErrors),
        skippedAssetIds: Object.freeze(skipped.map(({ id }) => id)),
        durationMs: Math.max(0, endedAt - startedAt),
        estimatedBytesLoaded: orderedResults.reduce((total, item) =>
          total + (item.status === "loaded" ? item.estimatedBytesLoaded : 0), 0),
        warnings: Object.freeze(uniqueStrings(warnings)),
        results: Object.freeze(orderedResults),
      });
      this.completedGroupsValue.add(group);
      this.loader.events.publish("asset:preload-completed", { result });
      return result;
    } finally {
      this.progressValue = tracker.snapshot();
      this.activeGroupValue = null;
    }
  }

  private publishProgress(progress: AssetPreloadProgress, options: AssetPreloadOptions): void {
    this.progressValue = progress;
    this.loader.events.publish("asset:preload-progress", { progress });
    options.onProgress?.(progress);
  }
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
