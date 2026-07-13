import type {
  AssetManifest,
  AssetManifestId,
  ManifestMetadata,
} from "../manifests/manifest-types.js";
import type { AssetErrorRecord } from "./asset-errors.js";

type Brand<Value, Name extends string> = Value & { readonly __assetBrand: Name };

/** Stable logical identifier requested by engine and game code. */
export type AssetId = Brand<string, "AssetId">;
export type AssetVariantId = Brand<string, "AssetVariantId">;

export const assetId = (value: string): AssetId => value as AssetId;
export const assetVariantId = (value: string): AssetVariantId => value as AssetVariantId;

export type AssetType =
  | "image"
  | "spritesheet"
  | "animation-data"
  | "font-reference"
  | "json"
  | "shader-reference"
  | "video-reference"
  | "binary"
  | "other";

export type AssetOrientation = "portrait" | "landscape";
export type AssetFailureRequirement = "required" | "optional";
export type AssetOptionalFailurePolicy = "return-failure" | "throw";

export type AssetConditionValue<Value> = Value | readonly Value[];

export interface AssetViewportCondition {
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
}

export interface AssetDensityCondition {
  readonly min?: number;
  readonly max?: number;
}

/** Every value is supplied by the host. Core performs no environment guessing. */
export interface AssetRuntimeConditions {
  readonly platform: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
  readonly orientation: AssetOrientation;
  readonly locale: string;
  readonly reducedMotion: boolean;
  readonly qualityTier: string;
  readonly memoryTier: string;
}

export interface AssetVariantConditions {
  readonly platform?: AssetConditionValue<string>;
  readonly viewport?: AssetViewportCondition;
  readonly density?: AssetDensityCondition;
  readonly orientation?: AssetConditionValue<AssetOrientation>;
  readonly locale?: AssetConditionValue<string>;
  readonly reducedMotion?: boolean;
  readonly qualityTier?: AssetConditionValue<string>;
  readonly memoryTier?: AssetConditionValue<string>;
}

export interface AssetVariant {
  readonly id: AssetVariantId;
  readonly source: string;
  readonly conditions: AssetVariantConditions;
  readonly checksum?: string;
  readonly estimatedBytes?: number;
  readonly metadata?: ManifestMetadata;
}

/**
 * Engine-neutral logical asset definition. Variants contain physical resources;
 * game code consumes only `id`.
 */
export interface AssetEntry {
  readonly id: AssetId;
  readonly type: AssetType;
  readonly source: string;
  readonly required: boolean;
  readonly preloadGroup?: string;
  readonly optionalGroup?: string;
  readonly checksum?: string;
  readonly estimatedBytes?: number;
  readonly tags: readonly string[];
  readonly variants: readonly AssetVariant[];
  readonly fallbackAssetId?: AssetId;
  readonly metadata: ManifestMetadata;
}

export interface AssetResolutionTrace {
  readonly candidateVariantIds: readonly AssetVariantId[];
  readonly matchingVariantIds: readonly AssetVariantId[];
  readonly selectedVariantId: AssetVariantId | null;
  readonly rule: string;
}

export interface ResolvedAsset {
  readonly requestedAssetId: AssetId;
  readonly assetId: AssetId;
  readonly type: AssetType;
  readonly source: string;
  readonly required: boolean;
  readonly preloadGroup: string | null;
  readonly optionalGroup: string | null;
  readonly checksum: string | null;
  readonly estimatedBytes: number;
  readonly tags: readonly string[];
  readonly variantId: AssetVariantId | null;
  readonly fallbackAssetId: AssetId | null;
  readonly metadata: ManifestMetadata;
  readonly conditions: AssetRuntimeConditions;
  readonly trace: AssetResolutionTrace;
}

export interface AssetRegistrySnapshot {
  readonly schemaVersion: 1;
  readonly manifests: readonly AssetManifest[];
  readonly entries: readonly AssetEntry[];
}

export interface AssetRegistryReloadInput {
  readonly manifests?: readonly AssetManifest[];
  readonly entries?: readonly AssetEntry[];
}

export interface AssetRuntimeManifestIdentity {
  readonly id: AssetManifestId;
  readonly version: string;
}

export interface AssetRuntimeResolvedIdentity {
  readonly assetId: AssetId;
  readonly variantId: AssetVariantId | null;
  /** Checksum identity when supplied, otherwise a deterministic hash of the physical reference. */
  readonly physicalIdentity: string;
  readonly checksum: string | null;
  readonly cacheKey: string;
}

/** Recovery metadata only. Host resources and data-URL contents are never embedded. */
export interface AssetRuntimeSnapshot {
  readonly schemaVersion: 1;
  readonly registryIdentity: string;
  readonly manifests: readonly AssetRuntimeManifestIdentity[];
  readonly resolvedAssets: readonly AssetRuntimeResolvedIdentity[];
  readonly cache: AssetCacheSnapshot;
  readonly completedPreloadGroups: readonly string[];
  readonly activePreloadGroup: string | null;
  readonly conditions: AssetRuntimeConditions;
}

export type AssetRecoverySnapshot = AssetRuntimeSnapshot;

export interface AssetRecoveryPlan {
  readonly registryIdentityMatches: boolean;
  readonly reusableCacheKeys: readonly string[];
  readonly assetIdsToReload: readonly AssetId[];
  readonly staleCacheKeys: readonly string[];
  readonly completedPreloadGroups: readonly string[];
  readonly interruptedPreloadGroup: string | null;
  readonly warnings: readonly string[];
}

export interface AssetRecoveryRestoreResult {
  readonly plan: AssetRecoveryPlan;
  readonly reloadedAssetIds: readonly AssetId[];
  readonly failedOptionalAssetIds: readonly AssetId[];
  readonly warnings: readonly string[];
}

export interface AssetCacheEntrySnapshot {
  readonly key: string;
  readonly assetId: AssetId;
  readonly estimatedBytes: number;
  readonly referenceCount: number;
  readonly pinned: boolean;
  /** Monotonic access sequence, not a wall-clock timestamp. */
  readonly lastAccess: number;
}

export interface AssetCacheSnapshot {
  readonly maximumEstimatedBytes: number;
  readonly totalEstimatedBytes: number;
  readonly entryCount: number;
  readonly entries: readonly AssetCacheEntrySnapshot[];
}

export interface AssetAdapterProgress {
  readonly loadedEstimatedBytes: number;
  readonly totalEstimatedBytes: number | null;
}

export interface AssetLoadAdapterRequest {
  readonly asset: ResolvedAsset;
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly onProgress: (progress: AssetAdapterProgress) => void;
}

export interface AssetLoadAdapterResult<Resource = unknown> {
  readonly resource: Resource;
  readonly estimatedBytes?: number;
  readonly checksum?: string;
  readonly dispose?: () => void;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Host-specific fetching/decoding boundary. Core never constructs DOM or Pixi objects. */
export interface AssetLoadAdapter<Resource = unknown> {
  load(request: AssetLoadAdapterRequest): Promise<AssetLoadAdapterResult<Resource>>;
}

export interface AssetRetryContext {
  readonly asset: ResolvedAsset;
  readonly attempt: number;
  readonly error: AssetErrorRecord;
}

export interface AssetRetryPolicy {
  readonly maximumAttempts: number;
  shouldRetry(context: AssetRetryContext): boolean;
  delayMs(context: AssetRetryContext): number;
}

export interface AssetLoadOptions {
  readonly conditions?: AssetRuntimeConditions;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly retryPolicy?: AssetRetryPolicy;
  readonly retain?: boolean;
  readonly optionalFailurePolicy?: AssetOptionalFailurePolicy;
}

export interface AssetLoadSuccess<Resource = unknown> {
  readonly status: "loaded";
  readonly requestedAssetId: AssetId;
  readonly resolvedAsset: ResolvedAsset;
  readonly resource: Resource;
  readonly cacheKey: string;
  readonly fromCache: boolean;
  readonly usedFallback: boolean;
  readonly attempts: number;
  readonly estimatedBytesLoaded: number;
  readonly warnings: readonly string[];
}

export interface AssetLoadFailure {
  readonly status: "failed";
  readonly requestedAssetId: AssetId;
  readonly resolvedAsset: ResolvedAsset;
  readonly error: AssetErrorRecord;
  readonly attempts: number;
  readonly warnings: readonly string[];
}

export type AssetLoadResult<Resource = unknown> = AssetLoadSuccess<Resource> | AssetLoadFailure;

export interface AssetPreloadProgress {
  readonly group: string;
  readonly requestedCount: number;
  readonly completedCount: number;
  readonly loadedCount: number;
  readonly failedRequiredCount: number;
  readonly failedOptionalCount: number;
  readonly skippedCount: number;
  readonly fraction: number;
  readonly currentAssetId: AssetId | null;
}

export interface AssetPreloadGroupResult {
  readonly group: string;
  readonly requestedCount: number;
  readonly loadedCount: number;
  readonly failedRequiredAssets: readonly AssetErrorRecord[];
  readonly failedOptionalAssets: readonly AssetErrorRecord[];
  readonly skippedAssetIds: readonly AssetId[];
  readonly durationMs: number;
  readonly estimatedBytesLoaded: number;
  readonly warnings: readonly string[];
  readonly results: readonly AssetLoadResult[];
}

export interface AssetPreloadOptions extends AssetLoadOptions {
  readonly includeOptional?: boolean;
  readonly onProgress?: (progress: AssetPreloadProgress) => void;
}

export interface AssetDebugEventRecord {
  readonly sequence: number;
  readonly type: string;
  readonly payload: unknown;
}

export interface AssetDebugRegistration {
  readonly entry: AssetEntry;
  readonly resolved: ResolvedAsset | null;
  readonly cached: boolean;
  readonly cacheKey: string | null;
  readonly referenceCount: number;
  readonly lastAccess: number | null;
}

export interface AssetDebugSnapshot {
  readonly registeredCount: number;
  readonly loadedCount: number;
  readonly pendingCount: number;
  readonly failedCount: number;
  readonly estimatedCacheBytes: number;
  readonly activePreloadGroup: string | null;
  readonly progress: AssetPreloadProgress | null;
  readonly latestEvent: AssetDebugEventRecord | null;
  readonly latestEvents: readonly AssetDebugEventRecord[];
  readonly latestErrors: readonly AssetErrorRecord[];
  readonly registrations: readonly AssetDebugRegistration[];
  readonly cache: AssetCacheSnapshot;
  readonly registry: AssetRegistrySnapshot;
}
