import { TypedEventBus } from "../event-bus.js";
import type { AssetManifest } from "../manifests/manifest-types.js";
import type { AssetErrorRecord } from "./asset-errors.js";
import type {
  AssetAdapterProgress,
  AssetCacheEntrySnapshot,
  AssetEntry,
  AssetId,
  AssetLoadResult,
  AssetPreloadGroupResult,
  AssetPreloadProgress,
  AssetRegistrySnapshot,
  ResolvedAsset,
} from "./asset-types.js";

export interface AssetEventMap {
  "asset:registered": { readonly entry: AssetEntry };
  "asset:removed": { readonly entry: AssetEntry };
  "asset:manifest-registered": { readonly manifest: AssetManifest; readonly assetIds: readonly AssetId[] };
  "asset:registry-cleared": { readonly removedCount: number };
  "asset:reload-started": { readonly manifestCount: number; readonly entryCount: number };
  "asset:reload-completed": { readonly snapshot: AssetRegistrySnapshot };
  "asset:reload-failed": { readonly error: AssetErrorRecord };
  "asset:validation-failed": { readonly errors: readonly AssetErrorRecord[] };
  "asset:requested": { readonly asset: ResolvedAsset };
  "asset:load-started": { readonly asset: ResolvedAsset; readonly attempt: number };
  "asset:load-progress": { readonly asset: ResolvedAsset; readonly progress: AssetAdapterProgress };
  "asset:loaded": { readonly result: AssetLoadResult };
  "asset:failed": { readonly asset: ResolvedAsset; readonly error: AssetErrorRecord; readonly required: boolean };
  "asset:cancelled": { readonly assetId: AssetId; readonly error: AssetErrorRecord };
  "asset:retry-scheduled": { readonly asset: ResolvedAsset; readonly attempt: number; readonly delayMs: number; readonly error: AssetErrorRecord };
  "asset:cache-hit": { readonly asset: ResolvedAsset; readonly cacheKey: string };
  "asset:cached": { readonly entry: AssetCacheEntrySnapshot };
  "asset:evicted": { readonly entry: AssetCacheEntrySnapshot; readonly reason: "capacity" | "remove" | "clear" | "replace" };
  "asset:disposed": { readonly entry: AssetCacheEntrySnapshot; readonly reason: "capacity" | "remove" | "clear" | "replace" };
  "asset:preload-started": { readonly group: string; readonly assetIds: readonly AssetId[] };
  "asset:preload-progress": { readonly progress: AssetPreloadProgress };
  "asset:preload-completed": { readonly result: AssetPreloadGroupResult };
}

export type AssetEventName = keyof AssetEventMap;

export const ASSET_EVENT_NAMES = [
  "asset:registered",
  "asset:removed",
  "asset:manifest-registered",
  "asset:registry-cleared",
  "asset:reload-started",
  "asset:reload-completed",
  "asset:reload-failed",
  "asset:validation-failed",
  "asset:requested",
  "asset:load-started",
  "asset:load-progress",
  "asset:loaded",
  "asset:failed",
  "asset:cancelled",
  "asset:retry-scheduled",
  "asset:cache-hit",
  "asset:cached",
  "asset:evicted",
  "asset:disposed",
  "asset:preload-started",
  "asset:preload-progress",
  "asset:preload-completed",
] as const satisfies readonly AssetEventName[];

export const createAssetEventBus = (): TypedEventBus<AssetEventMap> => new TypedEventBus<AssetEventMap>();
