import type { AssetCache } from "./asset-cache.js";
import { AssetSystemError, asAssetSystemError } from "./asset-errors.js";
import {
  assetCacheKey,
  assetPhysicalIdentity,
  type AssetLoader,
} from "./asset-loader.js";
import type { AssetPreloader } from "./asset-preloader.js";
import type { AssetRegistry } from "./asset-registry.js";
import { compareAssetAscii } from "./asset-resolver.js";
import {
  assetId,
  type AssetId,
  type AssetRecoveryPlan,
  type AssetRecoveryRestoreResult,
  type AssetRuntimeConditions,
  type AssetRuntimeSnapshot,
} from "./asset-types.js";

export interface AssetRecoveryManagerOptions<Resource> {
  readonly registry: AssetRegistry;
  readonly cache: AssetCache<Resource>;
  readonly conditions: AssetRuntimeConditions | (() => AssetRuntimeConditions);
  readonly loader?: AssetLoader<Resource>;
  readonly preloader?: AssetPreloader<Resource>;
}

export interface AssetRuntimeSnapshotOptions {
  readonly conditions?: AssetRuntimeConditions;
  readonly completedPreloadGroups?: readonly string[];
  readonly activePreloadGroup?: string | null;
}

/** Resource-free snapshot and conservative cache-reuse planning. */
export class AssetRecoveryManager<Resource = unknown> {
  private readonly registry: AssetRegistry;
  private readonly cache: AssetCache<Resource>;
  private readonly loader: AssetLoader<Resource> | undefined;
  private readonly preloader: AssetPreloader<Resource> | undefined;
  private readonly conditions: () => AssetRuntimeConditions;

  constructor(options: AssetRecoveryManagerOptions<Resource>) {
    this.registry = options.registry;
    this.cache = options.cache;
    this.loader = options.loader;
    this.preloader = options.preloader;
    this.conditions = typeof options.conditions === "function" ? options.conditions : () => options.conditions as AssetRuntimeConditions;
  }

  snapshot(options: AssetRuntimeSnapshotOptions = {}): AssetRuntimeSnapshot {
    const conditions = structuredClone(options.conditions ?? this.conditions());
    const manifests = this.registry.listManifests().map(({ id, version }) => ({ id, version }));
    const resolvedAssets = this.registry.list().map(({ id }) => {
      const resolved = this.registry.resolve(id, conditions);
      return Object.freeze({
        assetId: id,
        variantId: resolved.variantId,
        physicalIdentity: assetPhysicalIdentity(resolved),
        checksum: resolved.checksum,
        cacheKey: assetCacheKey(resolved),
      });
    });
    return Object.freeze({
      schemaVersion: 1 as const,
      registryIdentity: createAssetRegistryIdentity(manifests, resolvedAssets),
      manifests: Object.freeze(manifests),
      resolvedAssets: Object.freeze(resolvedAssets),
      cache: this.cache.snapshot(),
      completedPreloadGroups: Object.freeze(uniqueSorted(
        options.completedPreloadGroups ?? this.preloader?.completedGroups ?? [],
      )),
      activePreloadGroup: options.activePreloadGroup === undefined
        ? this.preloader?.activeGroup ?? null
        : options.activePreloadGroup,
      conditions: Object.freeze(conditions),
    });
  }

  createRecoveryPlan(snapshot: AssetRuntimeSnapshot, conditions: AssetRuntimeConditions = this.conditions()): AssetRecoveryPlan {
    assertAssetRuntimeSnapshot(snapshot);
    const current = this.snapshot({ conditions, completedPreloadGroups: snapshot.completedPreloadGroups });
    const currentById = new Map(current.resolvedAssets.map((identity) => [String(identity.assetId), identity]));
    const snapshotByKey = new Map(snapshot.resolvedAssets.map((identity) => [identity.cacheKey, identity]));
    const reusable: string[] = [];
    const reload = new Set<AssetId>();
    const stale: string[] = [];
    const warnings: string[] = [];

    for (const cached of snapshot.cache.entries) {
      const priorIdentity = snapshotByKey.get(cached.key);
      if (!priorIdentity) {
        stale.push(cached.key);
        warnings.push(`Snapshot cache key ${cached.key} has no resolved asset identity`);
        continue;
      }
      const currentIdentity = currentById.get(priorIdentity.assetId);
      if (!currentIdentity) {
        stale.push(cached.key);
        warnings.push(`Previously cached asset ${priorIdentity.assetId} is not registered`);
        continue;
      }
      if (currentIdentity.physicalIdentity !== priorIdentity.physicalIdentity || currentIdentity.variantId !== priorIdentity.variantId) {
        stale.push(cached.key);
        reload.add(currentIdentity.assetId);
        continue;
      }
      if (this.cache.has(currentIdentity.cacheKey)) reusable.push(currentIdentity.cacheKey);
      else reload.add(currentIdentity.assetId);
    }

    const registryIdentityMatches = current.registryIdentity === snapshot.registryIdentity;
    if (!registryIdentityMatches) warnings.push("Asset registry identity changed; only matching cached physical identities will be reused");
    return Object.freeze({
      registryIdentityMatches,
      reusableCacheKeys: Object.freeze(uniqueSorted(reusable)),
      assetIdsToReload: Object.freeze([...reload].sort(compareAssetAscii)),
      staleCacheKeys: Object.freeze(uniqueSorted(stale)),
      completedPreloadGroups: Object.freeze(uniqueSorted(snapshot.completedPreloadGroups)),
      interruptedPreloadGroup: snapshot.activePreloadGroup,
      warnings: Object.freeze(uniqueSorted(warnings)),
    });
  }

  async restore(
    snapshot: AssetRuntimeSnapshot,
    conditions: AssetRuntimeConditions = this.conditions(),
  ): Promise<AssetRecoveryRestoreResult> {
    const plan = this.createRecoveryPlan(snapshot, conditions);
    if (plan.assetIdsToReload.length > 0 && !this.loader) {
      throw new AssetSystemError("ASSET_RECOVERY_FAILURE", "Asset recovery requires a loader for missing cached resources", {
        recoverable: true,
        details: { assetIdsToReload: plan.assetIdsToReload },
      });
    }
    const reloaded: AssetId[] = [];
    const failedOptional: AssetId[] = [];
    const warnings = [...plan.warnings];
    for (const id of plan.assetIdsToReload) {
      try {
        const result = await this.loader?.load(id, { conditions, retain: false });
        if (result?.status === "loaded") reloaded.push(id);
        else if (result?.status === "failed") {
          failedOptional.push(id);
          warnings.push(result.error.message);
        }
      } catch (error) {
        const structured = asAssetSystemError(error, "ASSET_RECOVERY_FAILURE", `Asset recovery failed for ${id}`, {
          assetId: id,
          cause: error,
        });
        throw new AssetSystemError("ASSET_RECOVERY_FAILURE", `Asset recovery failed for ${id}; existing cache entries were preserved`, {
          assetId: id,
          details: { sourceError: structured.toRecord(), reloadedAssetIds: reloaded },
          cause: structured,
        });
      }
    }
    return Object.freeze({
      plan,
      reloadedAssetIds: Object.freeze(reloaded),
      failedOptionalAssetIds: Object.freeze(failedOptional),
      warnings: Object.freeze(uniqueSorted(warnings)),
    });
  }
}

export function assertAssetRuntimeSnapshot(value: unknown): asserts value is AssetRuntimeSnapshot {
  if (!isRecord(value)) throw new AssetSystemError("INVALID_ASSET_SNAPSHOT", "Asset runtime snapshot must be an object");
  if (value.schemaVersion !== 1) {
    throw new AssetSystemError("UNSUPPORTED_ASSET_SNAPSHOT_VERSION", `Unsupported asset snapshot version: ${String(value.schemaVersion)}`);
  }
  if (typeof value.registryIdentity !== "string" || !Array.isArray(value.manifests) ||
      !Array.isArray(value.resolvedAssets) || !isRecord(value.cache) ||
      !Array.isArray(value.completedPreloadGroups) ||
      (value.activePreloadGroup !== null && typeof value.activePreloadGroup !== "string") || !isRecord(value.conditions)) {
    throw new AssetSystemError("INVALID_ASSET_SNAPSHOT", "Asset runtime snapshot is missing required metadata");
  }
  const invalidResolved = value.resolvedAssets.some((item) => !isRecord(item) ||
    typeof item.assetId !== "string" || typeof item.physicalIdentity !== "string" || typeof item.cacheKey !== "string");
  const invalidCache = !Array.isArray(value.cache.entries) || typeof value.cache.totalEstimatedBytes !== "number";
  if (invalidResolved || invalidCache) throw new AssetSystemError("INVALID_ASSET_SNAPSHOT", "Asset runtime snapshot contains invalid identities or cache metadata");
}

export function createAssetRegistryIdentity(
  manifests: readonly { readonly id: string; readonly version: string }[],
  assets: readonly { readonly assetId: AssetId; readonly variantId: string | null; readonly physicalIdentity: string }[],
): string {
  const manifestPart = manifests.slice().sort((left, right) => compareAssetAscii(left.id, right.id))
    .map(({ id, version }) => `${id}@${version}`).join(",");
  const assetPart = assets.slice().sort((left, right) => compareAssetAscii(left.assetId, right.assetId))
    .map(({ assetId: id, variantId, physicalIdentity }) => `${id}@${variantId ?? "base"}@${physicalIdentity}`).join(",");
  return `asset-runtime-v1|manifests:${manifestPart}|assets:${assetPart}`;
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort(compareAssetAscii);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
