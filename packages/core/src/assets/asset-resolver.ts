import { AssetSystemError } from "./asset-errors.js";
import {
  assetId,
  type AssetConditionValue,
  type AssetEntry,
  type AssetId,
  type AssetRuntimeConditions,
  type AssetVariant,
  type AssetVariantConditions,
  type ResolvedAsset,
} from "./asset-types.js";

/**
 * Earlier conditions have greater specificity. Matching uses every declared
 * condition, then equal candidates use their variant ID in raw ASCII order.
 */
export const ASSET_VARIANT_CONDITION_ORDER = [
  "platform",
  "viewport",
  "density",
  "orientation",
  "locale",
  "reducedMotion",
  "qualityTier",
  "memoryTier",
] as const satisfies readonly (keyof AssetVariantConditions)[];

export const ASSET_VARIANT_TIE_BREAK = "variant-id-ascii-ascending" as const;
export const ASSET_VARIANT_RESOLUTION_RULE =
  "all-conditions-match;ordered-specificity;variant-id-ascii-ascending" as const;
export const ASSET_MAXIMUM_FALLBACK_DEPTH = 64 as const;

interface VariantMatch {
  readonly variant: AssetVariant;
  readonly scores: readonly number[];
}

export function compareAssetAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function resolveAssetEntry(
  entry: AssetEntry,
  conditions: AssetRuntimeConditions,
  requestedAssetId: AssetId = entry.id,
): ResolvedAsset {
  assertRuntimeConditions(conditions, entry.id);
  const matches = entry.variants
    .map((variant) => matchVariant(variant, conditions))
    .filter((match): match is VariantMatch => match !== null)
    .sort(compareMatches);
  const selected = matches[0]?.variant ?? null;
  const source = selected?.source ?? entry.source;
  if (source.trim().length === 0) {
    throw new AssetSystemError("VARIANT_RESOLUTION_FAILURE", `Asset ${entry.id} resolved to an empty source`, {
      assetId: entry.id,
      details: { selectedVariantId: selected?.id ?? null },
    });
  }
  return Object.freeze({
    requestedAssetId,
    assetId: entry.id,
    type: entry.type,
    source,
    required: entry.required,
    preloadGroup: entry.preloadGroup ?? null,
    optionalGroup: entry.optionalGroup ?? null,
    checksum: selected?.checksum ?? entry.checksum ?? null,
    estimatedBytes: selected?.estimatedBytes ?? entry.estimatedBytes ?? 0,
    tags: Object.freeze([...entry.tags]),
    variantId: selected?.id ?? null,
    fallbackAssetId: entry.fallbackAssetId ?? null,
    metadata: Object.freeze(structuredClone({ ...entry.metadata, ...(selected?.metadata ?? {}) })),
    conditions: Object.freeze(structuredClone(conditions)),
    trace: Object.freeze({
      candidateVariantIds: Object.freeze(entry.variants.map(({ id }) => id).sort(compareAssetAscii)),
      matchingVariantIds: Object.freeze(matches.map(({ variant }) => variant.id)),
      selectedVariantId: selected?.id ?? null,
      rule: ASSET_VARIANT_RESOLUTION_RULE,
    }),
  });
}

export function resolveAssetFallbackChain(
  requestedId: AssetId | string,
  conditions: AssetRuntimeConditions,
  getEntry: (id: AssetId) => AssetEntry | undefined,
): readonly ResolvedAsset[] {
  const originalId = assetId(String(requestedId));
  const chain: ResolvedAsset[] = [];
  const visited = new Set<string>();
  let currentId: AssetId | null = originalId;
  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new AssetSystemError("CIRCULAR_FALLBACK", `Circular asset fallback includes ${currentId}`, {
        assetId: currentId,
        details: { chain: [...visited, currentId] },
      });
    }
    if (visited.size >= ASSET_MAXIMUM_FALLBACK_DEPTH) {
      throw new AssetSystemError("CIRCULAR_FALLBACK", `Asset fallback chain exceeded ${ASSET_MAXIMUM_FALLBACK_DEPTH} entries`, {
        assetId: currentId,
      });
    }
    visited.add(currentId);
    const entry = getEntry(currentId);
    if (!entry) {
      throw new AssetSystemError("MISSING_FALLBACK", `Missing asset fallback: ${currentId}`, {
        assetId: currentId,
        details: { requestedAssetId: originalId, chain: [...visited] },
      });
    }
    chain.push(resolveAssetEntry(entry, conditions, originalId));
    currentId = entry.fallbackAssetId ?? null;
  }
  return Object.freeze(chain);
}

export function matchesAssetVariant(variant: AssetVariant, conditions: AssetRuntimeConditions): boolean {
  return matchVariant(variant, conditions) !== null;
}

function matchVariant(variant: AssetVariant, runtime: AssetRuntimeConditions): VariantMatch | null {
  const condition = variant.conditions;
  const platform = valueScore(condition.platform, runtime.platform);
  if (platform < 0) return null;
  const viewport = viewportScore(condition.viewport, runtime);
  if (viewport < 0) return null;
  const density = rangeScore(condition.density, runtime.devicePixelRatio);
  if (density < 0) return null;
  const orientation = valueScore(condition.orientation, runtime.orientation);
  if (orientation < 0) return null;
  const locale = localeScore(condition.locale, runtime.locale);
  if (locale < 0) return null;
  const reducedMotion = booleanScore(condition.reducedMotion, runtime.reducedMotion);
  if (reducedMotion < 0) return null;
  const qualityTier = valueScore(condition.qualityTier, runtime.qualityTier);
  if (qualityTier < 0) return null;
  const memoryTier = valueScore(condition.memoryTier, runtime.memoryTier);
  if (memoryTier < 0) return null;
  return { variant, scores: [platform, viewport, density, orientation, locale, reducedMotion, qualityTier, memoryTier] };
}

function compareMatches(left: VariantMatch, right: VariantMatch): number {
  for (let index = 0; index < ASSET_VARIANT_CONDITION_ORDER.length; index += 1) {
    const difference = (right.scores[index] ?? 0) - (left.scores[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return compareAssetAscii(left.variant.id, right.variant.id);
}

function valueScore<Value extends string>(condition: AssetConditionValue<Value> | undefined, runtime: Value): number {
  if (condition === undefined) return 0;
  const values: readonly Value[] = Array.isArray(condition) ? condition : [condition as Value];
  return values.includes(runtime) ? 1 : -1;
}

function localeScore(condition: AssetConditionValue<string> | undefined, runtime: string): number {
  if (condition === undefined) return 0;
  const normalizedRuntime = normalizeLocale(runtime);
  const baseRuntime = normalizedRuntime.split("-")[0] ?? normalizedRuntime;
  const values: readonly string[] = Array.isArray(condition) ? condition : [condition as string];
  let score = -1;
  for (const value of values) {
    const normalized = normalizeLocale(value);
    if (normalized === normalizedRuntime) score = Math.max(score, 2);
    else if (!normalized.includes("-") && normalized === baseRuntime) score = Math.max(score, 1);
  }
  return score;
}

function viewportScore(
  condition: AssetVariantConditions["viewport"],
  runtime: AssetRuntimeConditions,
): number {
  if (condition === undefined) return 0;
  if (condition.minWidth !== undefined && runtime.viewportWidth < condition.minWidth) return -1;
  if (condition.maxWidth !== undefined && runtime.viewportWidth > condition.maxWidth) return -1;
  if (condition.minHeight !== undefined && runtime.viewportHeight < condition.minHeight) return -1;
  if (condition.maxHeight !== undefined && runtime.viewportHeight > condition.maxHeight) return -1;
  return [condition.minWidth, condition.maxWidth, condition.minHeight, condition.maxHeight]
    .filter((value) => value !== undefined).length;
}

function rangeScore(condition: AssetVariantConditions["density"], value: number): number {
  if (condition === undefined) return 0;
  if (condition.min !== undefined && value < condition.min) return -1;
  if (condition.max !== undefined && value > condition.max) return -1;
  return Number(condition.min !== undefined) + Number(condition.max !== undefined);
}

function booleanScore(condition: boolean | undefined, value: boolean): number {
  if (condition === undefined) return 0;
  return condition === value ? 1 : -1;
}

function normalizeLocale(locale: string): string { return locale.trim().replaceAll("_", "-").toLowerCase(); }

function assertRuntimeConditions(conditions: AssetRuntimeConditions, id: AssetId): void {
  const valid = conditions.platform.trim().length > 0 &&
    Number.isFinite(conditions.viewportWidth) && conditions.viewportWidth >= 0 &&
    Number.isFinite(conditions.viewportHeight) && conditions.viewportHeight >= 0 &&
    Number.isFinite(conditions.devicePixelRatio) && conditions.devicePixelRatio > 0 &&
    conditions.locale.trim().length > 0 && conditions.qualityTier.trim().length > 0 &&
    conditions.memoryTier.trim().length > 0;
  if (!valid) {
    throw new AssetSystemError("VARIANT_RESOLUTION_FAILURE", `Invalid runtime conditions for ${id}`, {
      assetId: id,
      details: { conditions: structuredClone(conditions) },
    });
  }
}
