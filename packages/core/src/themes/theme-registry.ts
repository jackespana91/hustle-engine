import { TypedEventBus } from "../event-bus.js";
import type { GameManifestId, ThemeManifest } from "../manifests/manifest-types.js";
import { ThemeSystemError, themeError } from "./theme-errors.js";
import type { ThemeEventMap } from "./theme-events.js";
import {
  THEME_SCHEMA_VERSION,
  themeLayerRank,
  type ThemeAssetAliasMap,
  type ThemeAliasMap,
  type ThemeDefinition,
  type ThemeId,
  type ThemeLayer,
  type ThemeRegistrySnapshot,
  type ThemeTokenTree,
  type ThemeTokenValue,
} from "./theme-types.js";
import {
  assertThemeDefinition,
  assertThemeGraph,
  cloneTheme,
  isReservedThemeKey,
  isSafeThemePath,
} from "./theme-validator.js";

export interface ThemeRegisterOptions { readonly replace?: boolean; }

export interface ThemeManifestAdapterOptions {
  readonly layer?: ThemeLayer;
  readonly parentId?: ThemeId;
  readonly fallbackThemeId?: ThemeId;
  readonly stateVersion?: string;
  readonly aliases?: ThemeAliasMap;
  readonly assetAliases?: ThemeAssetAliasMap;
  readonly supportedGameIds?: readonly GameManifestId[];
  readonly incompatibleGameIds?: readonly GameManifestId[];
  readonly incompatibleThemeIds?: readonly ThemeId[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class ThemeRegistry {
  readonly events = new TypedEventBus<ThemeEventMap>();
  private definitions = new Map<ThemeId, ThemeDefinition>();

  register(definition: ThemeDefinition, options: ThemeRegisterOptions = {}): void {
    this.registerMany([definition], options);
  }

  registerMany(definitions: readonly ThemeDefinition[], options: ThemeRegisterOptions = {}): void {
    let parsed: readonly ThemeDefinition[];
    try { parsed = definitions.map(assertThemeDefinition); }
    catch (error) { this.publishValidation(error); throw error; }
    const candidate = new Map(this.definitions);
    const seen = new Set<ThemeId>();
    for (const definition of parsed) {
      if (seen.has(definition.id) || (candidate.has(definition.id) && !options.replace)) {
        const error = new ThemeSystemError([themeError("DUPLICATE_THEME", `Theme already registered: ${definition.id}`, "id", { themeId: definition.id, layer: definition.layer })]);
        this.publishValidation(error); throw error;
      }
      seen.add(definition.id); candidate.set(definition.id, definition);
    }
    try { assertThemeGraph([...candidate.values()]); }
    catch (error) { this.publishValidation(error); throw error; }
    const previous = this.definitions; this.definitions = candidate;
    parsed.forEach((definition) => {
      const prior = previous.get(definition.id);
      if (prior) this.events.publish("theme:removed", { definition: cloneTheme(prior) });
      this.events.publish("theme:registered", { definition: cloneTheme(definition) });
    });
  }

  registerManifest(manifest: ThemeManifest, options: ThemeManifestAdapterOptions = {}): ThemeDefinition {
    const definition = themeDefinitionFromManifest(manifest, options);
    this.register(definition);
    return definition;
  }

  unregister(id: ThemeId | string): ThemeDefinition | undefined {
    const key = id as ThemeId; const definition = this.definitions.get(key);
    if (!definition) return undefined;
    const candidate = new Map(this.definitions); candidate.delete(key);
    try { assertThemeGraph([...candidate.values()]); }
    catch (error) { this.publishValidation(error); throw error; }
    this.definitions = candidate;
    this.events.publish("theme:removed", { definition: cloneTheme(definition) });
    return cloneTheme(definition);
  }

  get(id: ThemeId | string): ThemeDefinition | undefined {
    const definition = this.definitions.get(id as ThemeId);
    return definition ? cloneTheme(definition) : undefined;
  }

  require(id: ThemeId | string): ThemeDefinition {
    const definition = this.get(id);
    if (!definition) throw new ThemeSystemError([themeError("UNKNOWN_THEME", `Unknown theme: ${id}`, "id", { themeId: id as ThemeId })]);
    return definition;
  }

  has(id: ThemeId | string): boolean { return this.definitions.has(id as ThemeId); }
  list(): readonly ThemeDefinition[] { return [...this.definitions.values()].sort(compareDefinitions).map(cloneTheme); }
  filterByLayer(layer: ThemeLayer): readonly ThemeDefinition[] { return this.list().filter((definition) => definition.layer === layer); }
  filterByEngine(engineId: string): readonly ThemeDefinition[] { return this.list().filter((definition) => definition.supportedEngineIds.some((id) => String(id) === engineId)); }
  filterByGame(gameId: string): readonly ThemeDefinition[] {
    return this.list().filter((definition) =>
      (definition.supportedGameIds.length === 0 || definition.supportedGameIds.some((id) => String(id) === gameId))
      && !definition.incompatibleGameIds.some((id) => String(id) === gameId));
  }
  fallbackFor(id: ThemeId | string): ThemeDefinition | undefined {
    const fallbackId = this.require(id).fallbackThemeId;
    return fallbackId === undefined ? undefined : this.require(fallbackId);
  }
  fallbackChain(id: ThemeId | string): readonly ThemeDefinition[] {
    const chain: ThemeDefinition[] = []; let current = this.require(id);
    while (current.fallbackThemeId !== undefined) {
      current = this.require(current.fallbackThemeId); chain.push(current);
    }
    return chain;
  }
  snapshot(): ThemeRegistrySnapshot { return cloneTheme({ schemaVersion: THEME_SCHEMA_VERSION, definitions: this.list() }); }

  clear(): void {
    const removed = this.list(); this.definitions = new Map();
    removed.forEach((definition) => this.events.publish("theme:removed", { definition }));
  }

  private publishValidation(error: unknown): void {
    const errors = error instanceof ThemeSystemError
      ? error.errors
      : [themeError("INVALID_THEME", error instanceof Error ? error.message : "Theme validation failed", "$")];
    this.events.publish("theme:validation-failed", { errors });
  }
}

export function themeDefinitionFromManifest(
  manifest: ThemeManifest,
  options: ThemeManifestAdapterOptions = {},
): ThemeDefinition {
  const tokens: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(manifest.designTokens).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) setTokenPath(tokens, path, value);
  const categories: readonly (readonly [string, ThemeTokenTree | undefined])[] = [
    ["components", manifest.componentTokens],
    ["typography", manifest.typographyReferences],
    ["spacing", manifest.spacingScale],
    ["sizing", manifest.sizingScale],
    ["effects", manifest.effectsTokens],
    ["animation", manifest.animationTokens],
  ];
  categories.forEach(([category, values]) => {
    if (values !== undefined) setStructuredTokenPaths(tokens, category, values);
  });
  const parentId = options.parentId ?? manifest.parentThemeId;
  const fallbackThemeId = options.fallbackThemeId ?? manifest.fallbackThemeId;
  return assertThemeDefinition({
    schemaVersion: THEME_SCHEMA_VERSION,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    stateVersion: options.stateVersion ?? "1.0.0",
    description: manifest.description,
    layer: options.layer ?? manifest.layer ?? "game",
    ...(parentId === undefined ? {} : { parentId }),
    ...(fallbackThemeId === undefined ? {} : { fallbackThemeId }),
    supportedEngineIds: manifest.supportedEngineIds,
    supportedGameIds: options.supportedGameIds ?? manifest.supportedGameIds ?? [],
    incompatibleGameIds: options.incompatibleGameIds ?? [],
    incompatibleThemeIds: options.incompatibleThemeIds ?? [],
    tokens,
    aliases: options.aliases ?? {},
    assetAliases: options.assetAliases ?? manifest.assetAliases ?? {},
    metadata: {
      ...manifest.metadata,
      ...options.metadata,
      sourceManifest: true,
      assetManifestId: manifest.assetManifestId,
    },
  });
}

function setStructuredTokenPaths(target: Record<string, unknown>, category: string, tree: ThemeTokenTree, parent = category): void {
  for (const [key, value] of Object.entries(tree).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const path = `${parent}.${key}`;
    if (typeof value === "object" && value !== null) setStructuredTokenPaths(target, category, value, path);
    else setTokenPath(target, path, value);
  }
}

function setTokenPath(target: Record<string, unknown>, path: string, value: ThemeTokenValue): void {
  if (!isSafeThemePath(path)) {
    const code = path.split(".").some(isReservedThemeKey) ? "PROTOTYPE_POLLUTION" : "INVALID_TOKEN";
    throw new ThemeSystemError([themeError(code, `Unsafe ThemeManifest token path ${path}`, `designTokens.${path}`)]);
  }
  const segments = path.split("."); let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      const existing = cursor[segment];
      if (typeof existing === "object" && existing !== null) {
        throw new ThemeSystemError([themeError("INVALID_TOKEN", `ThemeManifest token path ${path} collides with a token group`, `designTokens.${path}`)]);
      }
      cursor[segment] = value;
      return;
    }
    const existing = cursor[segment];
    if (existing !== undefined && (typeof existing !== "object" || existing === null || Array.isArray(existing))) {
      throw new ThemeSystemError([themeError("INVALID_TOKEN", `ThemeManifest token path ${path} collides with ${segments.slice(0, index + 1).join(".")}`, `designTokens.${path}`)]);
    }
    if (existing === undefined) cursor[segment] = Object.create(null) as ThemeTokenTree;
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

function compareDefinitions(left: ThemeDefinition, right: ThemeDefinition): number {
  return themeLayerRank(left.layer) - themeLayerRank(right.layer)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
