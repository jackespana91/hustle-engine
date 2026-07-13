import { TypedEventBus } from "../event-bus.js";
import { checkGameCompatibility, satisfiesVersionRange } from "./manifest-compatibility.js";
import { ManifestSystemError, manifestError, type ManifestValidationError } from "./manifest-errors.js";
import {
  MANIFEST_SCHEMA_VERSION,
  type AssetManifest,
  type FeatureManifest,
  type GameManifest,
  type HustleManifest,
  type ManifestEventMap,
  type ManifestId,
  type ManifestRegistrySnapshot,
  type ManifestType,
  type ResolvedGameComposition,
} from "./manifest-types.js";
import { ManifestValidator, validateRelationships } from "./manifest-validator.js";

export interface ManifestRegisterOptions { readonly replace?: boolean; }
type ManifestOf<Type extends ManifestType> = Extract<HustleManifest, { readonly manifestType: Type }>;

export class ManifestRegistry {
  readonly events = new TypedEventBus<ManifestEventMap>();
  private manifests = new Map<string, HustleManifest>();

  constructor(private readonly validator = new ManifestValidator()) {}

  register(manifest: HustleManifest, options: ManifestRegisterOptions = {}): void {
    const parsed = this.validateInput(manifest);
    const existing = this.manifests.get(parsed.id);
    if (existing && !options.replace) this.reject([manifestError("DUPLICATE_ID", `Manifest id already registered: ${parsed.id}`, parsed.manifestType, "id", parsed.id)]);
    if (existing && existing.manifestType !== parsed.manifestType) this.reject([
      manifestError("INVALID_TYPE", `Cannot replace ${existing.manifestType} manifest ${parsed.id} with ${parsed.manifestType}`, parsed.manifestType, "manifestType", parsed.id, { existingType: existing.manifestType }),
    ]);
    const candidate = new Map(this.manifests);
    candidate.set(parsed.id, parsed);
    this.assertRelationships(candidate);
    this.manifests = candidate;
    if (existing) this.events.publish("manifest:reloaded", { manifest: clone(parsed), previous: clone(existing) });
    else this.events.publish("manifest:registered", { manifest: clone(parsed) });
  }

  registerMany(manifests: readonly HustleManifest[], options: ManifestRegisterOptions = {}): void {
    const parsed = manifests.map((manifest) => this.validateInput(manifest));
    const candidate = new Map(this.manifests);
    const seen = new Set<string>();
    const priorById = new Map<string, HustleManifest>();
    for (const manifest of parsed) {
      if (seen.has(manifest.id)) this.reject([manifestError("DUPLICATE_ID", `Manifest id appears more than once in registration batch: ${manifest.id}`, manifest.manifestType, "id", manifest.id)]);
      seen.add(manifest.id);
      const existing = candidate.get(manifest.id);
      if (existing && !options.replace) this.reject([manifestError("DUPLICATE_ID", `Manifest id already registered: ${manifest.id}`, manifest.manifestType, "id", manifest.id)]);
      if (existing && existing.manifestType !== manifest.manifestType) this.reject([
        manifestError("INVALID_TYPE", `Cannot replace ${existing.manifestType} manifest ${manifest.id} with ${manifest.manifestType}`, manifest.manifestType, "manifestType", manifest.id, { existingType: existing.manifestType }),
      ]);
      if (existing) priorById.set(manifest.id, existing);
      candidate.set(manifest.id, manifest);
    }
    this.assertRelationships(candidate);
    this.manifests = candidate;
    parsed.forEach((manifest) => {
      const previous = priorById.get(manifest.id);
      if (previous) this.events.publish("manifest:reloaded", { manifest: clone(manifest), previous: clone(previous) });
      else this.events.publish("manifest:registered", { manifest: clone(manifest) });
    });
  }

  reload(manifest: HustleManifest): void {
    const prior = this.manifests.get(manifest.id);
    if (!prior) this.reject([manifestError("MISSING_REFERENCE", `Cannot reload unregistered manifest ${manifest.id}`, manifest.manifestType, "id", manifest.id)]);
    if (prior.manifestType !== manifest.manifestType) this.reject([
      manifestError("INVALID_TYPE", `Cannot reload ${prior.manifestType} manifest ${manifest.id} as ${manifest.manifestType}`, manifest.manifestType, "manifestType", manifest.id, { existingType: prior.manifestType }),
    ]);
    try {
      const parsed = this.validator.assertValid(manifest);
      const candidate = new Map(this.manifests); candidate.set(parsed.id, parsed);
      this.assertRelationships(candidate, false);
      this.manifests = candidate;
      this.events.publish("manifest:reloaded", { manifest: clone(parsed), previous: clone(prior) });
    } catch (error) {
      const errors = error instanceof ManifestSystemError ? error.errors : [manifestError("INVALID_VALUE", error instanceof Error ? error.message : "Manifest reload failed", manifest.manifestType, "$", manifest.id)];
      this.events.publish("manifest:validation-failed", { errors });
      throw new ManifestSystemError(errors);
    }
  }

  unregister(id: ManifestId | string): HustleManifest | undefined {
    const manifest = this.manifests.get(id);
    if (!manifest) return undefined;
    this.manifests.delete(id);
    this.events.publish("manifest:removed", { manifest: clone(manifest) });
    return clone(manifest);
  }

  get(id: ManifestId | string): HustleManifest | undefined { const manifest = this.manifests.get(id); return manifest ? clone(manifest) : undefined; }
  require(id: ManifestId | string): HustleManifest {
    const manifest = this.get(id);
    if (!manifest) throw new ManifestSystemError([manifestError("MISSING_REFERENCE", `Required manifest not found: ${id}`, "unknown", "id", id)]);
    return manifest;
  }
  has(id: ManifestId | string): boolean { return this.manifests.has(id); }
  list(): readonly HustleManifest[] { return sortManifests([...this.manifests.values()]).map(clone); }
  filterByType<Type extends ManifestType>(type: Type): readonly ManifestOf<Type>[] {
    return this.list().filter((manifest): manifest is ManifestOf<Type> => manifest.manifestType === type);
  }

  filterByCompatibleEngine(engineId: string): readonly HustleManifest[] {
    const engine = this.manifests.get(engineId);
    if (engine?.manifestType !== "engine") return [];
    const compatibleGames = this.filterByType("game").filter((game) => game.engineId === engineId && satisfiesVersionRange(engine.version, game.engineVersionRange));
    const compatibleThemes = this.filterByType("theme").filter((theme) => theme.supportedEngineIds.includes(engine.id));
    const referencedAssetIds = new Set<string>([
      ...compatibleGames.map((game) => String(game.assetManifestId)),
      ...compatibleThemes.map((theme) => String(theme.assetManifestId)),
    ]);
    return this.list().filter((manifest) => {
      if (manifest.manifestType === "engine") return manifest.id === engineId;
      if (manifest.manifestType === "game") return compatibleGames.some(({ id }) => id === manifest.id);
      if (manifest.manifestType === "math") return manifest.engineId === engineId;
      if (manifest.manifestType === "feature" || manifest.manifestType === "theme" || manifest.manifestType === "audio") return manifest.supportedEngineIds.some((id) => id === engineId);
      return manifest.manifestType === "asset" && referencedAssetIds.has(manifest.id);
    });
  }

  resolveGame(gameOrId: GameManifest | string): ResolvedGameComposition {
    try {
      const gameCandidate = typeof gameOrId === "string" ? this.require(gameOrId) : gameOrId;
      const game = requireType(gameCandidate, "game", "game");
      const engine = requireType(this.require(game.engineId), "engine", "engineId");
      const theme = requireType(this.require(game.themeId), "theme", "themeId");
      const audio = requireType(this.require(game.audioManifestId), "audio", "audioManifestId");
      const mathProfile = requireType(this.require(game.mathManifestId), "math", "mathManifestId");
      const assets = requireType(this.require(game.assetManifestId), "asset", "assetManifestId");
      const features = this.resolveFeatures(game.featureIds.map(String));
      const compatibilityReport = checkGameCompatibility(game, engine, features, theme, audio, mathProfile);
      if (!compatibilityReport.compatible) throw new ManifestSystemError(compatibilityReport.errors);
      const warnings = [...compatibilityReport.warnings];
      if (theme.assetManifestId !== assets.id) warnings.push(`Theme ${theme.id} references asset manifest ${theme.assetManifestId}; game uses ${assets.id}.`);
      const composition: ResolvedGameComposition = { game, engine, features, theme, audio, mathProfile, assets, compatibilityReport, warnings };
      this.events.publish("manifest:composition-resolved", { composition: clone(composition) });
      return clone(composition);
    } catch (error) {
      const gameId = typeof gameOrId === "string" ? gameOrId : gameOrId.id;
      const errors = error instanceof ManifestSystemError ? error.errors : [manifestError("INVALID_VALUE", error instanceof Error ? error.message : "Composition failed", "game", "$", gameId)];
      this.events.publish("manifest:composition-failed", { gameId, errors });
      throw new ManifestSystemError(errors);
    }
  }

  clear(): void {
    const removed = this.list(); this.manifests.clear();
    removed.forEach((manifest) => this.events.publish("manifest:removed", { manifest }));
  }

  snapshot(): ManifestRegistrySnapshot { return { schemaVersion: MANIFEST_SCHEMA_VERSION, manifests: this.list() }; }

  private resolveFeatures(requested: readonly string[]): readonly FeatureManifest[] {
    const selected = new Map<string, FeatureManifest>();
    const visit = (id: string, path: readonly string[]): void => {
      if (path.includes(id)) throw new ManifestSystemError([manifestError("CIRCULAR_DEPENDENCY", `Feature dependency cycle: ${[...path, id].join(" -> ")}`, "feature", "dependencies", id, { cycle: [...path, id] })]);
      const feature = requireType(this.require(id), "feature", `featureIds.${id}`);
      if (selected.has(id)) return;
      feature.dependencies.forEach((dependency) => visit(dependency, [...path, id]));
      selected.set(id, feature);
    };
    requested.forEach((id) => visit(id, []));
    return deterministicFeatureOrder([...selected.values()]);
  }

  private assertRelationships(candidate: ReadonlyMap<string, HustleManifest>, publishFailure = true): void {
    const errors = validateRelationships([...candidate.values()]);
    if (errors.length > 0) {
      if (publishFailure) this.events.publish("manifest:validation-failed", { errors });
      throw new ManifestSystemError(errors);
    }
  }

  private validateInput(manifest: HustleManifest): HustleManifest {
    try { return this.validator.assertValid(manifest); }
    catch (error) {
      const errors = error instanceof ManifestSystemError ? error.errors : [manifestError("INVALID_VALUE", error instanceof Error ? error.message : "Manifest validation failed", manifest.manifestType, "$", manifest.id)];
      this.events.publish("manifest:validation-failed", { errors });
      throw new ManifestSystemError(errors);
    }
  }

  private reject(errors: readonly ManifestValidationError[]): never {
    this.events.publish("manifest:validation-failed", { errors });
    throw new ManifestSystemError(errors);
  }
}

export function deterministicFeatureOrder(features: readonly FeatureManifest[]): readonly FeatureManifest[] {
  const byId = new Map(features.map((feature) => [feature.id, feature])); const resolved: FeatureManifest[] = []; const remaining = new Set(byId.keys());
  while (remaining.size > 0) {
    const ready = [...remaining].map((id) => byId.get(id)).filter((feature): feature is FeatureManifest => feature !== undefined)
      .filter((feature) => feature.dependencies.every((dependency) => !byId.has(dependency) || resolved.some(({ id }) => id === dependency)))
      .sort((left, right) => left.priority - right.priority || compareAscii(left.id, right.id));
    const next = ready[0];
    if (!next) throw new ManifestSystemError([manifestError("CIRCULAR_DEPENDENCY", "Feature dependencies contain a cycle", "feature", "dependencies")]);
    resolved.push(next); remaining.delete(next.id);
  }
  return resolved;
}

function requireType<Type extends ManifestType>(manifest: HustleManifest, type: Type, path: string): ManifestOf<Type> {
  if (manifest.manifestType !== type) throw new ManifestSystemError([manifestError("MISSING_REFERENCE", `Expected ${type} manifest at ${path}, received ${manifest.manifestType}`, manifest.manifestType, path, manifest.id)]);
  return manifest as ManifestOf<Type>;
}
function clone<Value>(value: Value): Value { return structuredClone(value); }
function sortManifests(manifests: HustleManifest[]): HustleManifest[] { return manifests.sort((left, right) => compareAscii(left.manifestType, right.manifestType) || compareAscii(left.id, right.id)); }
function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
