import type { AssetId, AssetPreloadProgress } from "./asset-types.js";

export type AssetProgressOutcome = "loaded" | "failed-required" | "failed-optional" | "skipped";

/** Small deterministic progress reducer shared by preloaders and debug tools. */
export class AssetProgressTracker {
  private readonly outcomes = new Map<string, AssetProgressOutcome>();
  private currentAssetId: AssetId | null = null;

  constructor(readonly group: string, readonly requestedAssetIds: readonly AssetId[]) {}

  begin(id: AssetId): AssetPreloadProgress {
    this.currentAssetId = id;
    return this.snapshot();
  }

  complete(id: AssetId, outcome: AssetProgressOutcome): AssetPreloadProgress {
    if (!this.requestedAssetIds.some((candidate) => candidate === id)) {
      throw new RangeError(`Asset ${id} is not part of preload group ${this.group}`);
    }
    if (!this.outcomes.has(id)) this.outcomes.set(id, outcome);
    this.currentAssetId = id;
    return this.snapshot();
  }

  snapshot(): AssetPreloadProgress {
    const values = [...this.outcomes.values()];
    const completedCount = values.length;
    const requestedCount = this.requestedAssetIds.length;
    return Object.freeze({
      group: this.group,
      requestedCount,
      completedCount,
      loadedCount: values.filter((value) => value === "loaded").length,
      failedRequiredCount: values.filter((value) => value === "failed-required").length,
      failedOptionalCount: values.filter((value) => value === "failed-optional").length,
      skippedCount: values.filter((value) => value === "skipped").length,
      fraction: requestedCount === 0 ? 1 : completedCount / requestedCount,
      currentAssetId: this.currentAssetId,
    });
  }
}
