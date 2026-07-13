export {
  ASSET_MAXIMUM_FALLBACK_DEPTH,
  ASSET_VARIANT_CONDITION_ORDER,
  ASSET_VARIANT_RESOLUTION_RULE,
  ASSET_VARIANT_TIE_BREAK,
  compareAssetAscii,
  matchesAssetVariant,
  resolveAssetEntry,
  resolveAssetFallbackChain,
} from "./asset-resolver.js";

export type {
  AssetDensityCondition,
  AssetOrientation,
  AssetRuntimeConditions,
  AssetVariant,
  AssetVariantConditions,
  AssetViewportCondition,
  ResolvedAsset,
} from "./asset-types.js";
