import type { EngineManifestId } from "../manifests/manifest-types.js";
import { ThemeSystemError, themeError, type ThemeValidationError } from "./theme-errors.js";
import { ThemeRegistry } from "./theme-registry.js";
import {
  THEME_LAYERS,
  themeLayerRank,
  type ResolvedTheme,
  type ThemeAliasMap,
  type ThemeAssetAliasMap,
  type ThemeConflict,
  type ThemeDefinition,
  type ThemeFlatTokens,
  type ThemeId,
  type ThemeLayer,
  type ThemeSelection,
  type ThemeTokenTree,
  type ThemeTokenValue,
} from "./theme-types.js";
import { cloneTheme, freezeTheme, isSafeThemePath } from "./theme-validator.js";

export class ThemeResolver {
  constructor(readonly registry: ThemeRegistry) {}

  resolve(selection: ThemeSelection): ResolvedTheme {
    try {
      const resolved = resolveSelection(this.registry, selection);
      this.registry.events.publish("theme:resolved", { resolved: cloneTheme(resolved) });
      return resolved;
    } catch (error) {
      const errors = errorsFrom(error, "Theme resolution failed");
      this.registry.events.publish("theme:resolution-failed", { selection: cloneTheme(selection), errors });
      throw error instanceof ThemeSystemError ? error : new ThemeSystemError(errors, undefined, { cause: error });
    }
  }
}

export function resolveSelection(registry: ThemeRegistry, selection: ThemeSelection): ResolvedTheme {
  validateSelectionShape(selection);
  const explicit = selectedLayers(selection);
  const selected = new Map<ThemeId, ThemeDefinition>();
  const visit = (definition: ThemeDefinition, path: readonly ThemeId[]): void => {
    if (path.includes(definition.id)) throw new ThemeSystemError([themeError("PARENT_CYCLE", `Theme parent cycle: ${[...path, definition.id].join(" -> ")}`, "parentId", { themeId: definition.id, layer: definition.layer })]);
    if (selected.has(definition.id)) return;
    if (definition.parentId !== undefined) visit(registry.require(definition.parentId), [...path, definition.id]);
    selected.set(definition.id, definition);
  };
  for (const [layer, id] of explicit) {
    const definition = registry.require(id);
    if (definition.layer !== layer) throw new ThemeSystemError([themeError("INVALID_SELECTION", `Theme ${id} is ${definition.layer}, not ${layer}`, layer, { themeId: id, layer: definition.layer })]);
    visit(definition, []);
  }
  const definitions = orderDefinitions([...selected.values()]);
  validateAppliedThemes(definitions, selection.engineId, selection.gameId);
  validateLayerChains(definitions);

  const flatTokens = new Map<string, ThemeTokenValue>();
  const tokenSources = new Map<string, ThemeId>();
  const aliases = new Map<string, string>();
  const aliasSources = new Map<string, ThemeId>();
  const assetAliases = new Map<string, string>();
  const assetAliasSources = new Map<string, ThemeId>();
  const conflicts: ThemeConflict[] = [];

  for (const definition of definitions) {
    const incoming = flattenThemeTokens(definition.tokens);
    for (const [path, value] of Object.entries(incoming)) {
      const clashes = [...flatTokens.keys()].filter((current) => current === path || current.startsWith(`${path}.`) || path.startsWith(`${current}.`));
      for (const clash of clashes.sort(compareAscii)) {
        const previousValue = flatTokens.get(clash); const previousThemeId = tokenSources.get(clash);
        if (previousValue !== undefined && previousThemeId !== undefined) conflicts.push({
          kind: "token-override", path: clash, previousThemeId, replacingThemeId: definition.id,
          previousValue, replacingValue: value,
        });
        flatTokens.delete(clash); tokenSources.delete(clash);
      }
      flatTokens.set(path, value); tokenSources.set(path, definition.id);
    }
    for (const [alias, target] of Object.entries(definition.aliases).sort(([left], [right]) => compareAscii(left, right))) {
      const previousValue = aliases.get(alias); const previousThemeId = aliasSources.get(alias);
      if (previousValue !== undefined && previousThemeId !== undefined) conflicts.push({
        kind: "alias-override", path: alias, previousThemeId, replacingThemeId: definition.id,
        previousValue, replacingValue: target,
      });
      aliases.set(alias, target); aliasSources.set(alias, definition.id);
    }
    for (const [alias, target] of Object.entries(definition.assetAliases).sort(([left], [right]) => compareAscii(left, right))) {
      const previousValue = assetAliases.get(alias); const previousThemeId = assetAliasSources.get(alias);
      if (previousValue !== undefined && previousThemeId !== undefined) conflicts.push({
        kind: "asset-alias-override", path: alias, previousThemeId, replacingThemeId: definition.id,
        previousValue, replacingValue: target,
      });
      assetAliases.set(alias, target); assetAliasSources.set(alias, definition.id);
    }
  }
  const flatObject = sortedObject(flatTokens) as ThemeFlatTokens;
  const aliasObject = sortedObject(aliases) as ThemeAliasMap;
  const resolvedAliases = resolveAliases(aliasObject, flatObject);
  const appliedThemeIds = definitions.map(({ id }) => id);
  const appliedLayers = definitions.map(({ layer }) => layer);
  const themeVersions = definitions.map(({ id, version, stateVersion }) => ({ id, version, stateVersion }));
  const content = {
    selection: cloneTheme(selection), appliedThemeIds, appliedLayers, themeVersions,
    tokens: unflattenThemeTokens(flatObject), flatTokens: flatObject, aliases: aliasObject,
    resolvedAliases, assetAliases: sortedObject(assetAliases) as ThemeAssetAliasMap,
    tokenSources: sortedObject(tokenSources), aliasSources: sortedObject(aliasSources),
    assetAliasSources: sortedObject(assetAliasSources), conflicts,
  };
  return freezeTheme({ ...content, hash: themeContentHash(content) });
}

export function resolveThemeToken(resolved: ResolvedTheme, path: string): ThemeTokenValue {
  if (!isSafeThemePath(path)) throw new ThemeSystemError([themeError("INVALID_TOKEN", `Invalid token path ${path}`, path)]);
  const value = resolved.flatTokens[path];
  if (value === undefined) throw new ThemeSystemError([themeError("INVALID_TOKEN", `Unknown resolved token ${path}`, path)]);
  return value;
}

export function resolveThemeAlias(resolved: ResolvedTheme, alias: string): ThemeTokenValue {
  if (!isSafeThemePath(alias)) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Invalid alias ${alias}`, alias)]);
  const value = resolved.resolvedAliases[alias];
  if (value === undefined) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Unknown resolved alias ${alias}`, alias)]);
  return value;
}

export function resolveThemeAssetAlias(resolved: ResolvedTheme, alias: string): string {
  if (!isSafeThemePath(alias)) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Invalid asset alias ${alias}`, alias)]);
  const target = resolved.assetAliases[alias];
  if (target === undefined) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Unknown resolved asset alias ${alias}`, alias)]);
  return target;
}

export function flattenThemeTokens(tree: ThemeTokenTree, prefix = ""): ThemeFlatTokens {
  const entries = new Map<string, ThemeTokenValue>();
  const visit = (value: ThemeTokenTree, parent: string): void => {
    for (const [key, token] of Object.entries(value).sort(([left], [right]) => compareAscii(left, right))) {
      const path = parent === "" ? key : `${parent}.${key}`;
      if (typeof token === "object" && token !== null) visit(token, path);
      else entries.set(path, token);
    }
  };
  visit(tree, prefix);
  return sortedObject(entries) as ThemeFlatTokens;
}

export function unflattenThemeTokens(flat: ThemeFlatTokens): ThemeTokenTree {
  const root: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [path, value] of Object.entries(flat).sort(([left], [right]) => compareAscii(left, right))) {
    if (!isSafeThemePath(path)) throw new ThemeSystemError([themeError("PROTOTYPE_POLLUTION", `Unsafe resolved token path ${path}`, path)]);
    const segments = path.split("."); let cursor = root;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) { cursor[segment] = value; return; }
      const existing = cursor[segment];
      if (existing === undefined) cursor[segment] = Object.create(null) as Record<string, unknown>;
      else if (typeof existing !== "object" || existing === null || Array.isArray(existing)) throw new ThemeSystemError([themeError("INVALID_TOKEN", `Resolved token path collision at ${path}`, path)]);
      cursor = cursor[segment] as Record<string, unknown>;
    });
  }
  return root as ThemeTokenTree;
}

export function stableThemeStringify(value: unknown, pretty = false): string {
  const serialized = JSON.stringify(stableValue(value), null, pretty ? 2 : undefined);
  if (serialized === undefined) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Theme value is not serializable", "$")]);
  return serialized;
}

export function themeContentHash(value: unknown): string {
  const input = stableThemeStringify(value); let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) { hash ^= BigInt(input.charCodeAt(index)); hash = BigInt.asUintN(64, hash * 0x100000001b3n); }
  return `fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}

function validateSelectionShape(selection: ThemeSelection): void {
  if (!selection || typeof selection !== "object" || typeof selection.engineId !== "string" || typeof selection.base !== "string") throw new ThemeSystemError([themeError("INVALID_SELECTION", "Theme selection requires engineId and base", "$")]);
  if (selection.gameId !== undefined && typeof selection.gameId !== "string") throw new ThemeSystemError([themeError("INVALID_SELECTION", "gameId must be a string when present", "gameId")]);
}

function selectedLayers(selection: ThemeSelection): readonly (readonly [ThemeLayer, ThemeId])[] {
  return THEME_LAYERS.flatMap((layer) => {
    const id = selection[layer]; return id === undefined ? [] : [[layer, id] as const];
  });
}

function orderDefinitions(definitions: readonly ThemeDefinition[]): ThemeDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition])); const depth = (definition: ThemeDefinition): number => {
    let value = 0; let current = definition;
    while (current.parentId !== undefined && byId.has(current.parentId)) { value += 1; current = byId.get(current.parentId)!; }
    return value;
  };
  return [...definitions].sort((left, right) => themeLayerRank(left.layer) - themeLayerRank(right.layer) || depth(left) - depth(right) || compareAscii(left.id, right.id));
}

function validateAppliedThemes(definitions: readonly ThemeDefinition[], engineId: EngineManifestId, gameId: ThemeSelection["gameId"]): void {
  const selected = new Set(definitions.map(({ id }) => id));
  for (const definition of definitions) {
    if (!definition.supportedEngineIds.some((supported) => String(supported) === String(engineId))) throw new ThemeSystemError([themeError("INCOMPATIBLE_ENGINE", `Theme ${definition.id} does not support engine ${engineId}`, "engineId", { themeId: definition.id, layer: definition.layer })]);
    if (gameId === undefined && (definition.supportedGameIds.length > 0 || definition.incompatibleGameIds.length > 0)) {
      throw new ThemeSystemError([themeError("INCOMPATIBLE_GAME", `Theme ${definition.id} requires a gameId for compatibility validation`, "gameId", { themeId: definition.id, layer: definition.layer })]);
    }
    if (gameId !== undefined && definition.supportedGameIds.length > 0 && !definition.supportedGameIds.includes(gameId)) {
      throw new ThemeSystemError([themeError("INCOMPATIBLE_GAME", `Theme ${definition.id} does not support game ${gameId}`, "gameId", { themeId: definition.id, layer: definition.layer })]);
    }
    if (gameId !== undefined && definition.incompatibleGameIds.includes(gameId)) {
      throw new ThemeSystemError([themeError("INCOMPATIBLE_GAME", `Theme ${definition.id} is incompatible with game ${gameId}`, "gameId", { themeId: definition.id, layer: definition.layer })]);
    }
    const conflict = definition.incompatibleThemeIds.find((id) => selected.has(id));
    if (conflict) throw new ThemeSystemError([themeError("INCOMPATIBLE_THEME", `Theme ${definition.id} conflicts with selected theme ${conflict}`, "incompatibleThemeIds", { themeId: definition.id, layer: definition.layer, details: { conflict } })]);
  }
}

function validateLayerChains(definitions: readonly ThemeDefinition[]): void {
  for (const layer of THEME_LAYERS) {
    const sameLayer = definitions.filter((definition) => definition.layer === layer);
    for (let index = 1; index < sameLayer.length; index += 1) {
      const prior = sameLayer[index - 1]; const current = sameLayer[index];
      if (prior && current && current.parentId !== prior.id) throw new ThemeSystemError([themeError("INVALID_SELECTION", `Multiple unrelated ${layer} themes were selected`, layer, { themeId: current.id, layer })]);
    }
  }
}

function resolveAliases(aliases: ThemeAliasMap, tokens: ThemeFlatTokens): ThemeFlatTokens {
  const resolved = new Map<string, ThemeTokenValue>(); const visiting = new Set<string>();
  const visit = (alias: string, path: readonly string[]): ThemeTokenValue => {
    const cached = resolved.get(alias); if (cached !== undefined) return cached;
    if (visiting.has(alias)) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Theme alias cycle: ${[...path, alias].join(" -> ")}`, `aliases.${alias}`)]);
    const target = aliases[alias];
    if (target === undefined) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Unknown theme alias ${alias}`, `aliases.${alias}`)]);
    visiting.add(alias);
    const value = tokens[target] ?? (aliases[target] === undefined ? undefined : visit(target, [...path, alias]));
    visiting.delete(alias);
    if (value === undefined) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Alias ${alias} targets missing token or alias ${target}`, `aliases.${alias}`)]);
    resolved.set(alias, value); return value;
  };
  Object.keys(aliases).sort(compareAscii).forEach((alias) => visit(alias, []));
  return sortedObject(resolved) as ThemeFlatTokens;
}

function sortedObject<Value>(map: ReadonlyMap<string, Value>): Readonly<Record<string, Value>> {
  const result: Record<string, Value> = Object.create(null) as Record<string, Value>;
  [...map].sort(([left], [right]) => compareAscii(left, right)).forEach(([key, value]) => { result[key] = value; }); return result;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort(compareAscii).map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
}

function errorsFrom(error: unknown, message: string): readonly ThemeValidationError[] {
  return error instanceof ThemeSystemError ? error.errors : [themeError("RESOLUTION_FAILED", error instanceof Error ? error.message : message, "$")];
}
function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
