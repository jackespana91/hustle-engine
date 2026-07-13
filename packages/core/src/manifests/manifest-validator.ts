import { isSemanticVersion, isValidVersionRange, checkGameCompatibility } from "./manifest-compatibility.js";
import { ManifestSystemError, manifestError, type ManifestValidationError, type ManifestErrorCode } from "./manifest-errors.js";
import {
  MANIFEST_SCHEMA_VERSION,
  type AssetManifest,
  type FeatureManifest,
  type GameManifest,
  type HustleManifest,
  type ManifestType,
} from "./manifest-types.js";

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ManifestValidationError[];
  readonly manifest?: HustleManifest;
}

const TYPES: readonly ManifestType[] = ["engine", "game", "feature", "theme", "audio", "math", "asset"];
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2}|-[0-9]{3})?$/;
const ENGINE_STATUSES = ["experimental", "development", "production", "deprecated"] as const;
const PLATFORMS = ["web", "mobile-web", "desktop-web"] as const;
const ORIENTATIONS = ["portrait", "landscape", "responsive"] as const;
const ASSET_TYPES = [
  "image", "spritesheet", "animation-data", "font-reference", "json", "shader-reference",
  "video-reference", "binary", "other", "audio", "font", "text",
] as const;
const THEME_LAYERS = ["base", "game", "operator", "seasonal", "accessibility"] as const;

export class ManifestValidator {
  validate(input: unknown): ManifestValidationResult {
    const errors: ManifestValidationError[] = [];
    if (!isRecord(input)) {
      return { valid: false, errors: [manifestError("INVALID_TYPE", "Manifest must be an object", "unknown", "$")] };
    }
    const type = TYPES.includes(input.manifestType as ManifestType) ? input.manifestType as ManifestType : "unknown";
    const id = typeof input.id === "string" ? input.id : undefined;
    const issue = (code: ManifestErrorCode, message: string, path: string, context?: Readonly<Record<string, unknown>>) =>
      errors.push(manifestError(code, message, type, path, id, context));

    requiredString(input, "manifestType", issue);
    requiredString(input, "schemaVersion", issue);
    requiredString(input, "id", issue);
    requiredString(input, "name", issue);
    requiredString(input, "version", issue);
    requiredRecord(input, "metadata", issue);
    if (typeof input.manifestType === "string" && !TYPES.includes(input.manifestType as ManifestType)) issue("INVALID_VALUE", `Unknown manifest type ${input.manifestType}`, "manifestType");
    if (typeof input.schemaVersion === "string" && input.schemaVersion !== MANIFEST_SCHEMA_VERSION) issue("UNSUPPORTED_SCHEMA_VERSION", `Unsupported manifest schema ${input.schemaVersion}`, "schemaVersion", { supported: MANIFEST_SCHEMA_VERSION });
    if (typeof input.id === "string" && !ID.test(input.id)) issue("MALFORMED_ID", `Malformed manifest id ${input.id}`, "id");
    if (typeof input.version === "string" && !isSemanticVersion(input.version)) issue("INVALID_VERSION", `Invalid semantic version ${input.version}`, "version");

    if (type === "engine") validateEngine(input, issue);
    if (type === "game") validateGame(input, issue);
    if (type === "feature") validateFeature(input, issue);
    if (type === "theme") validateTheme(input, issue);
    if (type === "audio") validateAudio(input, issue);
    if (type === "math") validateMath(input, issue);
    if (type === "asset") validateAsset(input, issue);
    return errors.length === 0
      ? { valid: true, errors, manifest: structuredClone(input) as unknown as HustleManifest }
      : { valid: false, errors };
  }

  assertValid(input: unknown): HustleManifest {
    const result = this.validate(input);
    if (!result.valid || !result.manifest) throw new ManifestSystemError(result.errors);
    return result.manifest;
  }

  validateSet(inputs: readonly unknown[]): ManifestValidationResult {
    const parsed: HustleManifest[] = [];
    const errors: ManifestValidationError[] = [];
    for (const input of inputs) {
      const result = this.validate(input);
      errors.push(...result.errors);
      if (result.manifest) parsed.push(result.manifest);
    }
    if (errors.length === 0) errors.push(...validateRelationships(parsed));
    return errors.length === 0 ? { valid: true, errors } : { valid: false, errors };
  }

  assertValidSet(inputs: readonly unknown[]): readonly HustleManifest[] {
    const manifests = inputs.map((input) => this.assertValid(input));
    const errors = validateRelationships(manifests);
    if (errors.length > 0) throw new ManifestSystemError(errors);
    return manifests;
  }
}

export function validateRelationships(manifests: readonly HustleManifest[]): readonly ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];
  const byId = new Map<string, HustleManifest>();
  for (const manifest of manifests) {
    const prior = byId.get(manifest.id);
    if (prior) errors.push(manifestError("DUPLICATE_ID", `Duplicate manifest id ${manifest.id}`, manifest.manifestType, "id", manifest.id, { existingType: prior.manifestType }));
    else byId.set(manifest.id, manifest);
  }
  const features = manifests.filter((manifest): manifest is FeatureManifest => manifest.manifestType === "feature");
  for (const feature of features) {
    feature.dependencies.forEach((dependency, index) => {
      const found = byId.get(dependency);
      if (!found || found.manifestType !== "feature") errors.push(manifestError("MISSING_DEPENDENCY", `Feature ${feature.id} requires missing feature ${dependency}`, "feature", `dependencies.${index}`, feature.id, { dependency }));
    });
    feature.conflicts.forEach((conflict, index) => requireReference(byId, conflict, "feature", feature, `conflicts.${index}`, errors));
    feature.supportedEngineIds.forEach((engineId, index) => requireReference(byId, engineId, "engine", feature, `supportedEngineIds.${index}`, errors));
  }
  errors.push(...findFeatureCycles(features));

  for (const manifest of manifests) {
    if (manifest.manifestType === "engine") {
      manifest.supportedFeatureIds.forEach((featureId, index) => requireReference(byId, featureId, "feature", manifest, `supportedFeatureIds.${index}`, errors));
      manifest.incompatibleFeatureIds.forEach((featureId, index) => requireReference(byId, featureId, "feature", manifest, `incompatibleFeatureIds.${index}`, errors));
    }
    if (manifest.manifestType === "theme") {
      requireReference(byId, manifest.assetManifestId, "asset", manifest, "assetManifestId", errors);
      manifest.supportedEngineIds.forEach((engineId, index) => requireReference(byId, engineId, "engine", manifest, `supportedEngineIds.${index}`, errors));
      manifest.supportedGameIds?.forEach((gameId, index) => requireReference(byId, gameId, "game", manifest, `supportedGameIds.${index}`, errors));
      if (manifest.parentThemeId) requireReference(byId, manifest.parentThemeId, "theme", manifest, "parentThemeId", errors);
      if (manifest.fallbackThemeId) requireReference(byId, manifest.fallbackThemeId, "theme", manifest, "fallbackThemeId", errors);
    }
    if (manifest.manifestType === "audio") manifest.supportedEngineIds.forEach((engineId, index) => requireReference(byId, engineId, "engine", manifest, `supportedEngineIds.${index}`, errors));
    if (manifest.manifestType === "math") requireReference(byId, manifest.engineId, "engine", manifest, "engineId", errors);
    if (manifest.manifestType !== "game") continue;
    const engine = requireReference(byId, manifest.engineId, "engine", manifest, "engineId", errors);
    const theme = requireReference(byId, manifest.themeId, "theme", manifest, "themeId", errors);
    const audio = requireReference(byId, manifest.audioManifestId, "audio", manifest, "audioManifestId", errors);
    const math = requireReference(byId, manifest.mathManifestId, "math", manifest, "mathManifestId", errors);
    requireReference(byId, manifest.assetManifestId, "asset", manifest, "assetManifestId", errors);
    const requestedFeatures = manifest.featureIds.map((featureId, index) =>
      requireReference(byId, featureId, "feature", manifest, `featureIds.${index}`, errors)).filter((value): value is FeatureManifest => value?.manifestType === "feature");
    const selectedFeatures = expandFeatureDependencies(requestedFeatures, byId);
    if (engine?.manifestType === "engine" && theme?.manifestType === "theme" && audio?.manifestType === "audio" && math?.manifestType === "math" && requestedFeatures.length === manifest.featureIds.length) {
      errors.push(...checkGameCompatibility(manifest, engine, selectedFeatures, theme, audio, math).errors);
    }
  }
  return deduplicateErrors(errors);
}

function validateEngine(input: Record<string, unknown>, issue: Issue): void {
  ["description", "engineType", "coreVersion", "status"].forEach((field) => requiredString(input, field, issue));
  ["supportedPlatforms", "supportedOrientations", "requiredCapabilities", "optionalCapabilities"].forEach((field) => stringArray(input, field, issue));
  ["supportedFeatureIds", "incompatibleFeatureIds"].forEach((field) => idArray(input, field, issue));
  requiredRecord(input, "performanceBudget", issue);
  if (typeof input.status === "string" && !ENGINE_STATUSES.includes(input.status as typeof ENGINE_STATUSES[number])) issue("INVALID_VALUE", `Invalid engine status ${input.status}`, "status");
  enumArray(input, "supportedPlatforms", PLATFORMS, issue);
  enumArray(input, "supportedOrientations", ORIENTATIONS, issue);
  if (typeof input.coreVersion === "string" && !isValidVersionRange(input.coreVersion)) issue("INVALID_VERSION_RANGE", `Invalid core version range ${input.coreVersion}`, "coreVersion");
  const performanceBudget = input.performanceBudget;
  if (isRecord(performanceBudget)) {
    ["maxInitialLoadMs", "maxFrameTimeMs", "maxMemoryMb", "maxAssetBytes"].forEach((field) => {
      const value = performanceBudget[field];
      if (!Number.isSafeInteger(value) || Number(value) < 0) issue("NEGATIVE_PERFORMANCE_LIMIT", `${field} must be a non-negative safe integer`, `performanceBudget.${field}`);
    });
  }
}

function validateGame(input: Record<string, unknown>, issue: Issue): void {
  ["engineId", "engineVersionRange", "themeId", "audioManifestId", "mathManifestId", "assetManifestId", "defaultLocale"].forEach((field) => requiredString(input, field, issue));
  ["engineId", "themeId", "audioManifestId", "mathManifestId", "assetManifestId"].forEach((field) => idField(input, field, issue));
  idArray(input, "featureIds", issue);
  stringArray(input, "supportedLocales", issue);
  requiredInteger(input, "buildNumber", issue, 0);
  if (typeof input.engineVersionRange === "string" && !isValidVersionRange(input.engineVersionRange)) issue("INVALID_VERSION_RANGE", `Invalid engine version range ${input.engineVersionRange}`, "engineVersionRange");
  if (Array.isArray(input.supportedLocales)) {
    const locales = input.supportedLocales;
    if (locales.length === 0) issue("INVALID_LOCALE", "At least one supported locale is required", "supportedLocales");
    locales.forEach((locale, index) => { if (typeof locale !== "string" || !LOCALE.test(locale)) issue("INVALID_LOCALE", `Invalid locale ${String(locale)}`, `supportedLocales.${index}`); });
    if (new Set(locales).size !== locales.length) issue("INVALID_LOCALE", "Supported locales contain duplicates", "supportedLocales");
    if (typeof input.defaultLocale === "string" && !locales.includes(input.defaultLocale)) issue("INVALID_LOCALE", "Default locale must be supported", "defaultLocale");
  }
}

function validateFeature(input: Record<string, unknown>, issue: Issue): void {
  ["description", "stateVersion"].forEach((field) => requiredString(input, field, issue));
  ["supportedEngineIds", "dependencies", "conflicts"].forEach((field) => idArray(input, field, issue));
  if (input.optionalDependencies !== undefined) idArray(input, "optionalDependencies", issue);
  if (input.failurePolicy !== undefined && input.failurePolicy !== "blocking" && input.failurePolicy !== "non-blocking") issue("INVALID_VALUE", "Feature failure policy must be blocking or non-blocking", "failurePolicy");
  requiredInteger(input, "priority", issue);
  requiredBoolean(input, "deterministic", issue);
  if (typeof input.stateVersion === "string" && !isSemanticVersion(input.stateVersion)) issue("INVALID_VERSION", `Invalid state version ${input.stateVersion}`, "stateVersion");
  if (input.deterministic === false) issue("INVALID_VALUE", "Commercial features must declare deterministic execution", "deterministic");
}

function validateTheme(input: Record<string, unknown>, issue: Issue): void {
  ["description", "assetManifestId"].forEach((field) => requiredString(input, field, issue));
  idField(input, "assetManifestId", issue);
  idArray(input, "supportedEngineIds", issue);
  if (input.supportedGameIds !== undefined) idArray(input, "supportedGameIds", issue);
  ["parentThemeId", "fallbackThemeId"].forEach((field) => {
    if (input[field] !== undefined) { requiredString(input, field, issue); idField(input, field, issue); }
  });
  if (input.layer !== undefined && !THEME_LAYERS.includes(input.layer as typeof THEME_LAYERS[number])) {
    issue("INVALID_VALUE", `Invalid theme layer ${String(input.layer)}`, "layer");
  }
  requiredRecord(input, "designTokens", issue);
  if (isRecord(input.designTokens)) for (const [token, value] of Object.entries(input.designTokens)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") issue("INVALID_TYPE", `Design token ${token} must be a string, number, or boolean`, `designTokens.${token}`);
    if (typeof value === "number" && !Number.isFinite(value)) issue("INVALID_VALUE", `Design token ${token} must be finite`, `designTokens.${token}`);
  }
  ["componentTokens", "typographyReferences", "spacingScale", "sizingScale", "effectsTokens", "animationTokens"].forEach((field) => {
    if (input[field] !== undefined) validateTokenTree(input[field], field, issue);
  });
  if (input.assetAliases !== undefined) {
    if (!isRecord(input.assetAliases)) issue("INVALID_TYPE", "assetAliases must be an object", "assetAliases");
    else for (const [alias, assetId] of Object.entries(input.assetAliases)) {
      if (!isSafeTokenPath(alias)) issue("INVALID_VALUE", `Invalid asset alias ${alias}`, `assetAliases.${alias}`);
      if (typeof assetId !== "string" || !ID.test(assetId)) issue("MALFORMED_ID", `Invalid aliased asset id ${String(assetId)}`, `assetAliases.${alias}`);
    }
  }
}

function validateAudio(input: Record<string, unknown>, issue: Issue): void {
  idArray(input, "supportedEngineIds", issue);
  ["music", "soundEffects", "voicePacks"].forEach((field) => {
    const resources = input[field];
    if (!Array.isArray(resources)) { issue("MISSING_FIELD", `${field} must be an array`, field); return; }
    resources.forEach((resource, index) => {
      if (!isRecord(resource)) { issue("INVALID_TYPE", "Audio resource must be an object", `${field}.${index}`); return; }
      requiredString(resource, "id", (code, message, path) => issue(code, message, `${field}.${index}.${path}`));
      requiredString(resource, "path", (code, message, path) => issue(code, message, `${field}.${index}.${path}`));
      requiredRecord(resource, "metadata", (code, message, path) => issue(code, message, `${field}.${index}.${path}`));
      if (typeof resource.path === "string" && !isSafeAssetPath(resource.path)) issue("INVALID_ASSET_PATH", `Invalid audio path ${resource.path}`, `${field}.${index}.path`);
      if (typeof resource.id === "string" && !ID.test(resource.id)) issue("MALFORMED_ID", `Malformed audio resource id ${resource.id}`, `${field}.${index}.id`);
    });
  });
}

function validateMath(input: Record<string, unknown>, issue: Issue): void {
  ["engineId", "modelVersion", "volatilityLabel", "configurationReference"].forEach((field) => requiredString(input, field, issue));
  idField(input, "engineId", issue);
  requiredBoolean(input, "currencyNeutral", issue);
  const rtp = input.targetRtpBasisPoints;
  if (!Number.isSafeInteger(rtp) || Number(rtp) < 0 || Number(rtp) > 10_000) issue("INVALID_BASIS_POINTS", "Target RTP basis points must be an integer from 0 to 10,000", "targetRtpBasisPoints");
  const multiplier = input.maxWinMultiplierBasisPoints;
  if (!Number.isSafeInteger(multiplier) || Number(multiplier) < 0) issue("INVALID_BASIS_POINTS", "Max-win multiplier basis points must be a non-negative safe integer (10,000 = 1x)", "maxWinMultiplierBasisPoints");
}

function validateAsset(input: Record<string, unknown>, issue: Issue): void {
  const files = input.files;
  const fileIds: string[] = [];
  if (!Array.isArray(files)) issue("MISSING_FIELD", "files must be an array", "files");
  else {
    files.forEach((file, index) => {
      if (!isRecord(file)) { issue("INVALID_TYPE", "Asset file must be an object", `files.${index}`); return; }
      ["id", "path", "type", "checksum"].forEach((field) => requiredString(file, field, (code, message, path) => issue(code, message, `files.${index}.${path}`)));
      requiredBoolean(file, "required", (code, message, path) => issue(code, message, `files.${index}.${path}`));
      stringArray(file, "tags", (code, message, path) => issue(code, message, `files.${index}.${path}`));
      requiredRecord(file, "metadata", (code, message, path) => issue(code, message, `files.${index}.${path}`));
      if (typeof file.id === "string") fileIds.push(file.id);
      if (typeof file.id === "string" && !ID.test(file.id)) issue("MALFORMED_ID", `Malformed asset file id ${file.id}`, `files.${index}.id`);
      if (typeof file.type === "string" && !ASSET_TYPES.includes(file.type as typeof ASSET_TYPES[number])) issue("INVALID_VALUE", `Invalid asset file type ${file.type}`, `files.${index}.type`);
      if (typeof file.path === "string" && !isSafeAssetPath(file.path)) issue("INVALID_ASSET_PATH", `Invalid asset path ${file.path}`, `files.${index}.path`);
      if (file.estimatedBytes !== undefined && (!Number.isSafeInteger(file.estimatedBytes) || Number(file.estimatedBytes) < 0)) issue("INVALID_VALUE", "estimatedBytes must be a non-negative safe integer", `files.${index}.estimatedBytes`);
      if (file.fallbackAssetId !== undefined && (typeof file.fallbackAssetId !== "string" || !ID.test(file.fallbackAssetId))) issue("MALFORMED_ID", `Invalid fallback asset id ${String(file.fallbackAssetId)}`, `files.${index}.fallbackAssetId`);
      if (file.variants !== undefined) validateAssetVariants(file.variants, index, issue);
    });
    if (new Set(fileIds).size !== fileIds.length) issue("DUPLICATE_ASSET_ID", "Asset manifest contains duplicate file ids", "files");
  }
  ["preloadGroups", "optionalGroups"].forEach((field) => {
    requiredRecord(input, field, issue);
    if (isRecord(input[field])) for (const [group, groupIds] of Object.entries(input[field])) {
      if (!ID.test(group)) issue("MALFORMED_ID", `Malformed asset group id ${group}`, `${field}.${group}`);
      if (!Array.isArray(groupIds) || !groupIds.every((id) => typeof id === "string")) { issue("INVALID_TYPE", `Asset group ${group} must contain asset ids`, `${field}.${group}`); continue; }
      groupIds.forEach((id, index) => {
        if (!ID.test(id)) issue("MALFORMED_ID", `Malformed asset id ${id}`, `${field}.${group}.${index}`);
        if (!fileIds.includes(id)) issue("MISSING_REFERENCE", `Asset group ${group} references missing file ${id}`, `${field}.${group}.${index}`, { referencedId: id });
      });
    }
  });
}

type Issue = (code: ManifestErrorCode, message: string, path: string, context?: Readonly<Record<string, unknown>>) => void;
function requiredString(record: Record<string, unknown>, field: string, issue: Issue): void { if (typeof record[field] !== "string" || record[field] === "") issue(record[field] === undefined ? "MISSING_FIELD" : "INVALID_TYPE", `${field} must be a non-empty string`, field); }
function requiredRecord(record: Record<string, unknown>, field: string, issue: Issue): void { if (!isRecord(record[field])) issue(record[field] === undefined ? "MISSING_FIELD" : "INVALID_TYPE", `${field} must be an object`, field); }
function requiredBoolean(record: Record<string, unknown>, field: string, issue: Issue): void { if (typeof record[field] !== "boolean") issue(record[field] === undefined ? "MISSING_FIELD" : "INVALID_TYPE", `${field} must be boolean`, field); }
function requiredInteger(record: Record<string, unknown>, field: string, issue: Issue, minimum?: number): void { const value = record[field]; if (!Number.isSafeInteger(value) || (minimum !== undefined && Number(value) < minimum)) issue(value === undefined ? "MISSING_FIELD" : "INVALID_VALUE", `${field} must be a safe integer${minimum === undefined ? "" : ` >= ${minimum}`}`, field); }
function stringArray(record: Record<string, unknown>, field: string, issue: Issue): void { const value = record[field]; if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) issue(value === undefined ? "MISSING_FIELD" : "INVALID_TYPE", `${field} must be a string array`, field); }
function idField(record: Record<string, unknown>, field: string, issue: Issue): void { const value = record[field]; if (typeof value === "string" && !ID.test(value)) issue("MALFORMED_ID", `Malformed manifest id ${value}`, field); }
function idArray(record: Record<string, unknown>, field: string, issue: Issue): void { stringArray(record, field, issue); const value = record[field]; if (Array.isArray(value)) value.forEach((id, index) => { if (typeof id === "string" && !ID.test(id)) issue("MALFORMED_ID", `Malformed manifest id ${id}`, `${field}.${index}`); }); }
function enumArray<const Values extends readonly string[]>(record: Record<string, unknown>, field: string, values: Values, issue: Issue): void { const input = record[field]; if (Array.isArray(input)) input.forEach((value, index) => { if (typeof value === "string" && !(values as readonly string[]).includes(value)) issue("INVALID_VALUE", `Invalid ${field} value ${value}`, `${field}.${index}`); }); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isSafeAssetPath(path: string): boolean {
  if (path.length === 0 || path.includes("\\") || path.includes("..")) return false;
  if (path.startsWith("https://")) return true;
  if (path.startsWith("data:")) return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(path);
  return !path.startsWith("/") && !/^[a-z]+:/i.test(path);
}

function validateTokenTree(value: unknown, path: string, issue: Issue): void {
  if (!isRecord(value)) { issue("INVALID_TYPE", `${path} must be an object`, path); return; }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (!isSafeTokenKey(key)) { issue("INVALID_VALUE", `Unsafe theme token key ${key}`, childPath); continue; }
    if (isRecord(child)) validateTokenTree(child, childPath, issue);
    else if (typeof child !== "string" && typeof child !== "number" && typeof child !== "boolean") issue("INVALID_TYPE", `Theme token ${childPath} must be a string, number, boolean, or token object`, childPath);
    else if (typeof child === "number" && !Number.isFinite(child)) issue("INVALID_VALUE", `Theme token ${childPath} must be finite`, childPath);
  }
}

function validateAssetVariants(value: unknown, fileIndex: number, issue: Issue): void {
  if (!Array.isArray(value)) { issue("INVALID_TYPE", "variants must be an array", `files.${fileIndex}.variants`); return; }
  const ids = new Set<string>();
  value.forEach((variant, variantIndex) => {
    const base = `files.${fileIndex}.variants.${variantIndex}`;
    if (!isRecord(variant)) { issue("INVALID_TYPE", "Asset variant must be an object", base); return; }
    ["id", "path"].forEach((field) => requiredString(variant, field, (code, message, child) => issue(code, message, `${base}.${child}`)));
    requiredRecord(variant, "conditions", (code, message, child) => issue(code, message, `${base}.${child}`));
    if (typeof variant.id === "string") {
      if (ids.has(variant.id)) issue("DUPLICATE_ASSET_ID", `Duplicate variant id ${variant.id}`, `${base}.id`);
      ids.add(variant.id);
    }
    if (typeof variant.path === "string" && !isSafeAssetPath(variant.path)) issue("INVALID_ASSET_PATH", `Invalid variant path ${variant.path}`, `${base}.path`);
    if (variant.estimatedBytes !== undefined && (!Number.isSafeInteger(variant.estimatedBytes) || Number(variant.estimatedBytes) < 0)) issue("INVALID_VALUE", "estimatedBytes must be a non-negative safe integer", `${base}.estimatedBytes`);
  });
}

function isSafeTokenPath(path: string): boolean { return path.length > 0 && path.split(".").every(isSafeTokenKey); }
function isSafeTokenKey(key: string): boolean { return key.length > 0 && !["__proto__", "prototype", "constructor"].includes(key); }

function requireReference(map: ReadonlyMap<string, HustleManifest>, id: string, type: ManifestType, owner: HustleManifest, path: string, errors: ManifestValidationError[]): HustleManifest | undefined {
  const found = map.get(id);
  if (!found || found.manifestType !== type) errors.push(manifestError("MISSING_REFERENCE", `${owner.id} references missing ${type} manifest ${id}`, owner.manifestType, path, owner.id, { referencedId: id, expectedType: type }));
  return found?.manifestType === type ? found : undefined;
}

function expandFeatureDependencies(requested: readonly FeatureManifest[], manifests: ReadonlyMap<string, HustleManifest>): readonly FeatureManifest[] {
  const selected = new Map<string, FeatureManifest>();
  const visiting = new Set<string>();
  const visit = (feature: FeatureManifest): void => {
    if (selected.has(feature.id) || visiting.has(feature.id)) return;
    visiting.add(feature.id);
    feature.dependencies.forEach((dependency) => {
      const target = manifests.get(dependency);
      if (target?.manifestType === "feature") visit(target);
    });
    visiting.delete(feature.id);
    selected.set(feature.id, feature);
  };
  requested.forEach(visit);
  return [...selected.values()];
}

function findFeatureCycles(features: readonly FeatureManifest[]): readonly ManifestValidationError[] {
  const errors: ManifestValidationError[] = []; const byId = new Map(features.map((feature) => [feature.id, feature]));
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (feature: FeatureManifest, path: readonly string[]): void => {
    if (visiting.has(feature.id)) {
      const cycleStart = path.indexOf(feature.id); const cycle = [...path.slice(cycleStart), feature.id];
      errors.push(manifestError("CIRCULAR_DEPENDENCY", `Feature dependency cycle: ${cycle.join(" -> ")}`, "feature", "dependencies", feature.id, { cycle })); return;
    }
    if (visited.has(feature.id)) return;
    visiting.add(feature.id);
    for (const dependency of feature.dependencies) { const target = byId.get(dependency); if (target) visit(target, [...path, feature.id]); }
    visiting.delete(feature.id); visited.add(feature.id);
  };
  [...features].sort((left, right) => compareAscii(left.id, right.id)).forEach((feature) => visit(feature, []));
  return errors;
}

function deduplicateErrors(errors: readonly ManifestValidationError[]): readonly ManifestValidationError[] {
  const seen = new Set<string>(); return errors.filter((error) => { const key = `${error.code}|${error.manifestId ?? ""}|${error.fieldPath}|${error.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
