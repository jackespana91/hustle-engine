import { ManifestValidator } from "../manifests/manifest-validator.js";
import type {
  AssetFile,
  AssetManifest,
  AssetManifestId,
} from "../manifests/manifest-types.js";
import { AssetSystemError, UnknownAssetError, asAssetSystemError } from "./asset-errors.js";
import { createAssetEventBus, type AssetEventMap } from "./asset-events.js";
import {
  compareAssetAscii,
  resolveAssetEntry,
  resolveAssetFallbackChain,
} from "./asset-resolver.js";
import {
  assetId,
  assetVariantId,
  type AssetEntry,
  type AssetId,
  type AssetRegistryReloadInput,
  type AssetRegistrySnapshot,
  type AssetRuntimeConditions,
  type AssetType,
  type AssetVariantConditions,
  type ResolvedAsset,
} from "./asset-types.js";
import type { TypedEventBus } from "../event-bus.js";

export interface AssetRegistryOptions {
  readonly events?: TypedEventBus<AssetEventMap>;
}

export interface AssetGroupSelectionOptions {
  readonly includeOptional?: boolean;
}

/** Deterministic logical-asset registry. All mutating batch operations are atomic. */
export class AssetRegistry {
  readonly events: TypedEventBus<AssetEventMap>;
  private readonly validator = new ManifestValidator();
  private entries = new Map<string, AssetEntry>();
  private manifests = new Map<string, AssetManifest>();

  constructor(options: AssetRegistryOptions = {}) {
    this.events = options.events ?? createAssetEventBus();
  }

  registerManifest(input: AssetManifest): readonly AssetEntry[] {
    try {
      const manifest = this.validateManifest(input);
      if (this.manifests.has(manifest.id)) {
        throw new AssetSystemError("ASSET_MANIFEST_CONFLICT", `Asset manifest already registered: ${manifest.id}`, {
          details: { manifestId: manifest.id },
        });
      }
      const converted = entriesFromManifest(manifest);
      const candidate = this.stageEntries(converted, this.entries);
      this.entries = candidate;
      this.manifests.set(manifest.id, cloneManifest(manifest));
      converted.slice().sort((left, right) => compareAssetAscii(left.id, right.id))
        .forEach((entry) => this.events.publish("asset:registered", { entry: cloneEntry(entry) }));
      this.events.publish("asset:manifest-registered", {
        manifest: cloneManifest(manifest),
        assetIds: Object.freeze(converted.map(({ id }) => id).sort(compareAssetAscii)),
      });
      return Object.freeze(converted.map(cloneEntry));
    } catch (error) {
      this.publishValidationFailure(error, "Asset manifest registration failed");
      throw error;
    }
  }

  register(entry: AssetEntry): void { this.registerMany([entry]); }

  registerEntries(entries: readonly AssetEntry[]): void { this.registerMany(entries); }

  registerMany(entries: readonly AssetEntry[]): void {
    try {
      const candidate = this.stageEntries(entries, this.entries);
      this.entries = candidate;
      entries.map(cloneEntry).sort((left, right) => compareAssetAscii(left.id, right.id))
        .forEach((entry) => this.events.publish("asset:registered", { entry }));
    } catch (error) {
      this.publishValidationFailure(error, "Asset registration failed");
      throw error;
    }
  }

  unregister(id: AssetId | string): AssetEntry | undefined {
    const key = String(id);
    const existing = this.entries.get(key);
    if (!existing) return undefined;
    const candidate = new Map(this.entries);
    candidate.delete(key);
    try {
      assertFallbackGraph(candidate);
    } catch (error) {
      this.publishValidationFailure(error, `Cannot remove asset ${key}`);
      throw error;
    }
    this.entries = candidate;
    const removed = cloneEntry(existing);
    this.events.publish("asset:removed", { entry: removed });
    return removed;
  }

  get(id: AssetId | string): AssetEntry | undefined {
    const entry = this.entries.get(String(id));
    return entry ? cloneEntry(entry) : undefined;
  }

  require(id: AssetId | string): AssetEntry {
    const entry = this.get(id);
    if (!entry) throw new UnknownAssetError(id);
    return entry;
  }

  has(id: AssetId | string): boolean { return this.entries.has(String(id)); }

  list(): readonly AssetEntry[] {
    return Object.freeze([...this.entries.values()]
      .sort((left, right) => compareAssetAscii(left.id, right.id))
      .map(cloneEntry));
  }

  listManifests(): readonly AssetManifest[] {
    return Object.freeze([...this.manifests.values()]
      .sort((left, right) => compareAssetAscii(left.id, right.id))
      .map(cloneManifest));
  }

  filterByType(type: AssetType): readonly AssetEntry[] {
    return Object.freeze(this.list().filter((entry) => entry.type === type));
  }

  filterByTag(tag: string): readonly AssetEntry[] {
    return Object.freeze(this.list().filter((entry) => entry.tags.includes(tag)));
  }

  listGroup(group: string, options: AssetGroupSelectionOptions = {}): readonly AssetEntry[] {
    const includeOptional = options.includeOptional ?? true;
    return Object.freeze(this.list()
      .filter((entry) => entry.preloadGroup === group || (includeOptional && entry.optionalGroup === group))
      .sort(comparePreloadEntries));
  }

  listOptionalGroup(group: string): readonly AssetEntry[] {
    return Object.freeze(this.list()
      .filter((entry) => entry.optionalGroup === group)
      .sort((left, right) => compareAssetAscii(left.id, right.id)));
  }

  resolve(id: AssetId | string, conditions: AssetRuntimeConditions): ResolvedAsset {
    return resolveAssetEntry(this.require(id), conditions);
  }

  resolveFallbackChain(id: AssetId | string, conditions: AssetRuntimeConditions): readonly ResolvedAsset[] {
    return resolveAssetFallbackChain(id, conditions, (key) => this.entries.get(String(key)));
  }

  validateFallbacks(): void {
    try { assertFallbackGraph(this.entries); }
    catch (error) {
      this.publishValidationFailure(error, "Asset fallback validation failed");
      throw error;
    }
  }

  snapshot(): AssetRegistrySnapshot {
    return Object.freeze({
      schemaVersion: 1 as const,
      manifests: this.listManifests(),
      entries: this.list(),
    });
  }

  snapshotRegistry(): AssetRegistrySnapshot { return this.snapshot(); }

  clear(): void {
    const removed = this.list();
    this.entries = new Map();
    this.manifests = new Map();
    removed.forEach((entry) => this.events.publish("asset:removed", { entry }));
    this.events.publish("asset:registry-cleared", { removedCount: removed.length });
  }

  /** Replaces the complete development registry or preserves the prior state on any failure. */
  atomicReload(input: AssetRegistryReloadInput): AssetRegistrySnapshot {
    this.events.publish("asset:reload-started", {
      manifestCount: input.manifests?.length ?? 0,
      entryCount: input.entries?.length ?? 0,
    });
    try {
      const nextManifests = new Map<string, AssetManifest>();
      const allEntries: AssetEntry[] = [];
      for (const rawManifest of input.manifests ?? []) {
        const manifest = this.validateManifest(rawManifest);
        if (nextManifests.has(manifest.id)) {
          throw new AssetSystemError("ASSET_MANIFEST_CONFLICT", `Duplicate asset manifest during reload: ${manifest.id}`, {
            details: { manifestId: manifest.id },
          });
        }
        nextManifests.set(manifest.id, cloneManifest(manifest));
        allEntries.push(...entriesFromManifest(manifest));
      }
      allEntries.push(...(input.entries ?? []));
      const nextEntries = this.stageEntries(allEntries, new Map());
      this.entries = nextEntries;
      this.manifests = nextManifests;
      const snapshot = this.snapshot();
      this.events.publish("asset:reload-completed", { snapshot });
      return snapshot;
    } catch (error) {
      const source = asAssetSystemError(error, "ATOMIC_RELOAD_FAILURE", "Atomic asset reload failed");
      const wrapped = source.code === "ATOMIC_RELOAD_FAILURE" ? source : new AssetSystemError(
        "ATOMIC_RELOAD_FAILURE",
        `Atomic asset reload failed: ${source.message}`,
        {
          ...(source.assetId === null ? {} : { assetId: source.assetId }),
          details: { sourceError: source.toRecord() },
          cause: source,
        },
      );
      this.events.publish("asset:reload-failed", { error: wrapped.toRecord() });
      throw wrapped;
    }
  }

  private stageEntries(inputs: readonly AssetEntry[], base: ReadonlyMap<string, AssetEntry>): Map<string, AssetEntry> {
    const candidate = new Map(base);
    for (const raw of inputs) {
      const entry = validateAndCloneEntry(raw);
      if (candidate.has(entry.id)) {
        throw new AssetSystemError("DUPLICATE_ASSET", `Asset already registered: ${entry.id}`, { assetId: entry.id });
      }
      candidate.set(entry.id, entry);
    }
    assertFallbackGraph(candidate);
    return candidate;
  }

  private validateManifest(input: AssetManifest): AssetManifest {
    const result = this.validator.validate(input);
    if (!result.valid || result.manifest?.manifestType !== "asset") {
      throw new AssetSystemError("INVALID_ASSET_MANIFEST", `Invalid asset manifest: ${String(input.id)}`, {
        details: { manifestErrors: structuredClone(result.errors) },
      });
    }
    return cloneManifest(result.manifest);
  }

  private publishValidationFailure(error: unknown, message: string): void {
    const structured = asAssetSystemError(error, "INVALID_ASSET", message);
    this.events.publish("asset:validation-failed", { errors: [structured.toRecord()] });
  }
}

export const ASSET_PRELOAD_ORDER = "required-first-then-asset-id-ascii" as const;

function comparePreloadEntries(left: AssetEntry, right: AssetEntry): number {
  if (left.required !== right.required) return left.required ? -1 : 1;
  return compareAssetAscii(left.id, right.id);
}

function validateAndCloneEntry(input: AssetEntry): AssetEntry {
  const id = String(input.id);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new AssetSystemError("INVALID_ASSET", `Invalid logical asset ID: ${id}`, { assetId: input.id });
  }
  if (!ASSET_TYPES.includes(input.type)) {
    throw new AssetSystemError("INVALID_ASSET", `Unsupported asset type for ${id}: ${String(input.type)}`, { assetId: input.id });
  }
  assertValidSource(input.source, input.id);
  assertEstimatedBytes(input.estimatedBytes, input.id);
  assertGroup(input.preloadGroup, "preload", input.id);
  assertGroup(input.optionalGroup, "optional", input.id);
  const tags = [...input.tags];
  if (tags.some((tag) => tag.trim().length === 0) || new Set(tags).size !== tags.length) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} contains invalid or duplicate tags`, { assetId: input.id });
  }
  const variantIds = new Set<string>();
  input.variants.forEach((variant) => {
    if (String(variant.id).trim().length === 0 || variantIds.has(variant.id)) {
      throw new AssetSystemError("INVALID_ASSET", `Asset ${id} contains an invalid or duplicate variant ID`, { assetId: input.id });
    }
    variantIds.add(variant.id);
    assertValidSource(variant.source, input.id);
    assertEstimatedBytes(variant.estimatedBytes, input.id);
    assertVariantConditions(variant.conditions, input.id);
  });
  try { return cloneEntry(input); }
  catch (error) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} metadata must be structured-cloneable`, {
      assetId: input.id,
      cause: error,
    });
  }
}

function assertFallbackGraph(entries: ReadonlyMap<string, AssetEntry>): void {
  for (const entry of entries.values()) {
    if (entry.fallbackAssetId !== undefined && !entries.has(entry.fallbackAssetId)) {
      throw new AssetSystemError("MISSING_FALLBACK", `Asset ${entry.id} references missing fallback ${entry.fallbackAssetId}`, {
        assetId: entry.id,
        details: { fallbackAssetId: entry.fallbackAssetId },
      });
    }
  }
  const complete = new Set<string>();
  for (const entry of entries.values()) {
    if (complete.has(entry.id)) continue;
    const visiting = new Map<string, number>();
    const path: string[] = [];
    let current: AssetEntry | undefined = entry;
    while (current !== undefined) {
      if (complete.has(current.id)) break;
      const cycleStart = visiting.get(current.id);
      if (cycleStart !== undefined) {
        const cycle = [...path.slice(cycleStart), current.id];
        throw new AssetSystemError("CIRCULAR_FALLBACK", `Circular asset fallback: ${cycle.join(" -> ")}`, {
          assetId: current.id,
          details: { cycle },
        });
      }
      visiting.set(current.id, path.length);
      path.push(current.id);
      current = current.fallbackAssetId === undefined ? undefined : entries.get(current.fallbackAssetId);
    }
    path.forEach((id) => complete.add(id));
  }
}

function entriesFromManifest(manifest: AssetManifest): AssetEntry[] {
  const preloadMembership = groupMembership(manifest.preloadGroups);
  const optionalMembership = groupMembership(manifest.optionalGroups);
  return manifest.files.map((file) => {
    const preloadGroups = preloadMembership.get(file.id) ?? [];
    const optionalGroups = optionalMembership.get(file.id) ?? [];
    return {
      id: assetId(file.id),
      type: mapManifestAssetType(file),
      source: file.path,
      required: file.required,
      ...(preloadGroups[0] === undefined ? {} : { preloadGroup: preloadGroups[0] }),
      ...(optionalGroups[0] === undefined ? {} : { optionalGroup: optionalGroups[0] }),
      ...(file.checksum.length === 0 ? {} : { checksum: file.checksum }),
      ...(file.estimatedBytes === undefined ? {} : { estimatedBytes: file.estimatedBytes }),
      tags: Object.freeze([...file.tags]),
      variants: Object.freeze((file.variants ?? []).map((variant) => ({
        id: assetVariantId(variant.id),
        source: variant.path,
        conditions: structuredClone(variant.conditions) as AssetVariantConditions,
        ...(variant.checksum === undefined ? {} : { checksum: variant.checksum }),
        ...(variant.estimatedBytes === undefined ? {} : { estimatedBytes: variant.estimatedBytes }),
        ...(variant.metadata === undefined ? {} : { metadata: structuredClone(variant.metadata) }),
      }))),
      ...(file.fallbackAssetId === undefined ? {} : { fallbackAssetId: assetId(file.fallbackAssetId) }),
      metadata: Object.freeze(structuredClone({
        ...file.metadata,
        assetManifestId: manifest.id,
        manifestPreloadGroups: preloadGroups,
        manifestOptionalGroups: optionalGroups,
      })),
    } satisfies AssetEntry;
  });
}

function groupMembership(groups: Readonly<Record<string, readonly string[]>>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const group of Object.keys(groups).sort(compareAssetAscii)) {
    for (const id of groups[group] ?? []) {
      const current = result.get(id) ?? [];
      current.push(group);
      result.set(id, current);
    }
  }
  return result;
}

function mapManifestAssetType(file: AssetFile): AssetType {
  const mapped: Readonly<Record<AssetFile["type"], AssetType>> = {
    image: "image",
    spritesheet: "spritesheet",
    "animation-data": "animation-data",
    "font-reference": "font-reference",
    "shader-reference": "shader-reference",
    "video-reference": "video-reference",
    other: "other",
    audio: "other",
    font: "font-reference",
    json: "json",
    text: "other",
    binary: "binary",
  };
  return mapped[file.type];
}

function assertValidSource(source: string, id: AssetId): void {
  const value = source.trim();
  const hasControl = [...value].some((character) => character.charCodeAt(0) < 32);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  const relativeSegments = value.split(/[/?#]/)[0]?.split("/") ?? [];
  const validScheme = scheme === undefined || scheme === "http" || scheme === "https" || scheme === "data";
  const validData = scheme !== "data" || value.includes(",");
  if (value.length === 0 || hasControl || value.includes("\\") || relativeSegments.includes("..") || !validScheme || !validData) {
    throw new AssetSystemError("INVALID_ASSET_PATH", `Invalid asset source for ${id}: ${source}`, { assetId: id });
  }
}

function assertEstimatedBytes(value: number | undefined, id: AssetId): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new AssetSystemError("INVALID_ASSET", `Estimated bytes for ${id} must be a non-negative safe integer`, { assetId: id });
  }
}

function assertGroup(value: string | undefined, label: string, id: AssetId): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} has an empty ${label} group`, { assetId: id });
  }
}

function assertVariantConditions(conditions: AssetEntry["variants"][number]["conditions"], id: AssetId): void {
  if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} variant conditions must be an object`, { assetId: id });
  }
  const allowed = new Set(["platform", "viewport", "density", "orientation", "locale", "reducedMotion", "qualityTier", "memoryTier"]);
  if (Object.keys(conditions).some((key) => !allowed.has(key))) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} variant contains an unsupported condition`, { assetId: id });
  }
  assertStringCondition(conditions.platform, "platform", id);
  assertStringCondition(conditions.locale, "locale", id);
  assertStringCondition(conditions.qualityTier, "qualityTier", id);
  assertStringCondition(conditions.memoryTier, "memoryTier", id);
  assertStringCondition(conditions.orientation, "orientation", id, ["portrait", "landscape"]);
  if (conditions.reducedMotion !== undefined && typeof conditions.reducedMotion !== "boolean") {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} reducedMotion condition must be boolean`, { assetId: id });
  }
  const viewport = conditions.viewport;
  const density = conditions.density;
  if (viewport !== undefined && (typeof viewport !== "object" || viewport === null || Array.isArray(viewport))) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} viewport condition must be an object`, { assetId: id });
  }
  if (density !== undefined && (typeof density !== "object" || density === null || Array.isArray(density))) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} density condition must be an object`, { assetId: id });
  }
  const finite = (value: number | undefined): boolean => value === undefined || Number.isFinite(value);
  if (viewport && (![viewport.minWidth, viewport.maxWidth, viewport.minHeight, viewport.maxHeight].every(finite) ||
      (viewport.minWidth !== undefined && viewport.maxWidth !== undefined && viewport.minWidth > viewport.maxWidth) ||
      (viewport.minHeight !== undefined && viewport.maxHeight !== undefined && viewport.minHeight > viewport.maxHeight))) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} has invalid viewport variant bounds`, { assetId: id });
  }
  if (density && (![density.min, density.max].every(finite) ||
      (density.min !== undefined && density.min <= 0) || (density.max !== undefined && density.max <= 0) ||
      (density.min !== undefined && density.max !== undefined && density.min > density.max))) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} has invalid density variant bounds`, { assetId: id });
  }
}

function assertStringCondition(
  condition: unknown,
  name: string,
  id: AssetId,
  allowed?: readonly string[],
): void {
  if (condition === undefined) return;
  const values = Array.isArray(condition) ? condition : [condition];
  if (values.length === 0 || values.some((value) => typeof value !== "string" || value.length === 0 ||
      (allowed !== undefined && !allowed.includes(value)))) {
    throw new AssetSystemError("INVALID_ASSET", `Asset ${id} has an invalid ${name} condition`, { assetId: id });
  }
}

const ASSET_TYPES: readonly AssetType[] = [
  "image", "spritesheet", "animation-data", "font-reference", "json",
  "shader-reference", "video-reference", "binary", "other",
];

function cloneEntry(entry: AssetEntry): AssetEntry { return structuredClone(entry); }
function cloneManifest(manifest: AssetManifest): AssetManifest { return structuredClone(manifest); }
