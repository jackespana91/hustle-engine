import {
  MANIFEST_SCHEMA_VERSION,
  assetFileId,
  assetManifestId,
  type AssetManifest,
} from "../../manifests/manifest-types.js";
import {
  assetId,
  assetVariantId,
  type AssetEntry,
} from "../asset-types.js";

const SAFE_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20placeholder";
const LOW_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20low";
const HIGH_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20high";
const PORTRAIT_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20portrait";
const LANDSCAPE_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20landscape";
const EN_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20title%20EN";
const ES_PLACEHOLDER = "data:text/plain,Hustle%20illustrative%20title%20ES";

export const NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS = Object.freeze({
  safeFallback: assetId("system.placeholder.safe"),
  qualityExample: assetId("scene.illustrative.quality"),
  orientationExample: assetId("scene.illustrative.orientation"),
  localeExample: assetId("ui.illustrative.title"),
  densityExample: assetId("ui.illustrative.density"),
  optionalFailure: assetId("scenario.optional.missing"),
  requiredFailure: assetId("scenario.required.failure"),
  fallbackExample: assetId("scenario.fallback.primary"),
});

/** Non-production data-only examples. They are not Night Drop mechanics or final art. */
export const NIGHT_DROP_ILLUSTRATIVE_ASSET_ENTRIES: readonly AssetEntry[] = Object.freeze(([
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.safeFallback,
    type: "other",
    source: SAFE_PLACEHOLDER,
    required: true,
    preloadGroup: "bootstrap",
    estimatedBytes: 36,
    tags: ["illustrative", "fallback"],
    variants: [],
    metadata: { nonProduction: true, description: "Generic safe fallback payload" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.qualityExample,
    type: "image",
    source: SAFE_PLACEHOLDER,
    required: true,
    preloadGroup: "base-game",
    estimatedBytes: 36,
    tags: ["illustrative", "quality"],
    variants: [
      { id: assetVariantId("quality-high"), source: HIGH_PLACEHOLDER, conditions: { qualityTier: "high" }, estimatedBytes: 34 },
      { id: assetVariantId("quality-low"), source: LOW_PLACEHOLDER, conditions: { qualityTier: "low" }, estimatedBytes: 33 },
    ],
    metadata: { nonProduction: true, description: "Low/high quality selection example" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.orientationExample,
    type: "image",
    source: SAFE_PLACEHOLDER,
    required: true,
    preloadGroup: "base-game",
    tags: ["illustrative", "orientation"],
    variants: [
      { id: assetVariantId("layout-landscape"), source: LANDSCAPE_PLACEHOLDER, conditions: { orientation: "landscape" } },
      { id: assetVariantId("layout-portrait"), source: PORTRAIT_PLACEHOLDER, conditions: { orientation: "portrait" } },
    ],
    metadata: { nonProduction: true, description: "Portrait/landscape selection example" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.localeExample,
    type: "image",
    source: EN_PLACEHOLDER,
    required: false,
    optionalGroup: "locale-specific",
    tags: ["illustrative", "locale"],
    variants: [
      { id: assetVariantId("locale-en"), source: EN_PLACEHOLDER, conditions: { locale: "en" } },
      { id: assetVariantId("locale-es"), source: ES_PLACEHOLDER, conditions: { locale: ["es", "es-ES"] } },
    ],
    metadata: { nonProduction: true, description: "Locale selection example" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.densityExample,
    type: "image",
    source: LOW_PLACEHOLDER,
    required: false,
    optionalGroup: "optional-high-quality",
    tags: ["illustrative", "density"],
    variants: [
      { id: assetVariantId("density-1x"), source: LOW_PLACEHOLDER, conditions: { density: { min: 1, max: 1.99 } } },
      { id: assetVariantId("density-2x"), source: HIGH_PLACEHOLDER, conditions: { density: { min: 2 } } },
    ],
    metadata: { nonProduction: true, description: "Externally supplied density example" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.optionalFailure,
    type: "json",
    source: "data:application/json,%7B%22scenario%22%3A%22missing-optional%22%7D",
    required: false,
    optionalGroup: "failure-scenarios",
    tags: ["illustrative", "failure"],
    variants: [],
    metadata: { nonProduction: true, illustrativeFailure: "missing-optional" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.requiredFailure,
    type: "binary",
    source: "data:application/octet-stream,required-failure",
    required: true,
    preloadGroup: "failure-scenarios",
    tags: ["illustrative", "failure"],
    variants: [],
    metadata: { nonProduction: true, illustrativeFailure: "required-load-failure" },
  },
  {
    id: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.fallbackExample,
    type: "other",
    source: "data:text/plain,illustrative-primary-failure",
    required: true,
    preloadGroup: "failure-scenarios",
    tags: ["illustrative", "fallback", "failure"],
    variants: [],
    fallbackAssetId: NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.safeFallback,
    metadata: { nonProduction: true, illustrativeFailure: "fallback-primary" },
  },
] satisfies readonly AssetEntry[]).map((entry) => structuredClone(entry)));

/** Existing Manifest System-compatible view used to demonstrate registration integration. */
export const NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST: AssetManifest = Object.freeze({
  manifestType: "asset",
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: assetManifestId("night-drop-illustrative-assets"),
  name: "Night Drop Illustrative Assets",
  version: "1.0.0",
  files: [
    {
      id: assetFileId("night-drop-shell"),
      path: "illustrative/night-drop-shell.placeholder",
      type: "image",
      required: true,
      checksum: "illustrative-shell-v1",
      tags: ["illustrative", "base-game"],
      metadata: { nonProduction: true },
    },
    {
      id: assetFileId("night-drop-locale"),
      path: "illustrative/night-drop-locale.placeholder",
      type: "json",
      required: false,
      checksum: "illustrative-locale-v1",
      tags: ["illustrative", "locale"],
      metadata: { nonProduction: true },
    },
    {
      id: assetFileId("night-drop-required-failure"),
      path: "illustrative/night-drop-required-failure.placeholder",
      type: "binary",
      required: true,
      checksum: "illustrative-failure-v1",
      tags: ["illustrative", "failure"],
      metadata: { nonProduction: true, illustrativeFailure: "required-load-failure" },
    },
  ],
  preloadGroups: {
    bootstrap: [assetFileId("night-drop-shell")],
    "failure-scenarios": [assetFileId("night-drop-required-failure")],
  },
  optionalGroups: {
    "locale-specific": [assetFileId("night-drop-locale")],
  },
  metadata: { nonProduction: true, gamePack: "night-drop-illustrative" },
} satisfies AssetManifest);

export function createNightDropIllustrativeAssetEntries(): readonly AssetEntry[] {
  return Object.freeze(structuredClone(NIGHT_DROP_ILLUSTRATIVE_ASSET_ENTRIES));
}

export function createNightDropIllustrativeAssetManifest(): AssetManifest {
  return structuredClone(NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST);
}
