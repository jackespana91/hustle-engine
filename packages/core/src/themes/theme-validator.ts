import { isSemanticVersion } from "../manifests/manifest-compatibility.js";
import type { EngineManifestId, GameManifestId, ThemeManifestId } from "../manifests/manifest-types.js";
import { ThemeSystemError, themeError, type ThemeValidationError } from "./theme-errors.js";
import {
  THEME_LAYERS,
  THEME_SCHEMA_VERSION,
  themeLayerRank,
  type ThemeAliasMap,
  type ThemeDefinition,
  type ThemeId,
  type ThemeLayer,
  type ThemeMetadata,
  type ThemeTokenTree,
} from "./theme-types.js";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEGMENT = /^[a-z][a-z0-9-]*$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

export interface ThemeValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ThemeValidationError[];
  readonly definition?: ThemeDefinition;
}

export function validateThemeDefinition(input: unknown): ThemeValidationResult {
  const errors: ThemeValidationError[] = [];
  if (!isPlainRecord(input)) return { valid: false, errors: [themeError("INVALID_THEME", "Theme definition must be a plain object", "$")] };
  const id = typeof input.id === "string" ? input.id as ThemeId : undefined;
  const layer = typeof input.layer === "string" && THEME_LAYERS.includes(input.layer as ThemeLayer) ? input.layer as ThemeLayer : undefined;
  const issue = (code: ThemeValidationError["code"], message: string, path: string, details?: ThemeMetadata): void => {
    errors.push(themeError(code, message, path, {
      ...(id === undefined ? {} : { themeId: id }),
      ...(layer === undefined ? {} : { layer }),
      ...(details === undefined ? {} : { details }),
    }));
  };

  if (input.schemaVersion !== THEME_SCHEMA_VERSION) issue("INVALID_VERSION", `Unsupported theme schema ${String(input.schemaVersion)}`, "schemaVersion");
  for (const field of ["id", "name", "version", "stateVersion", "description", "layer"] as const) {
    if (typeof input[field] !== "string" || input[field] === "") issue("INVALID_THEME", `${field} must be a non-empty string`, field);
  }
  if (typeof input.id === "string" && !ID.test(input.id)) issue("INVALID_ID", `Invalid theme id ${input.id}`, "id");
  if (typeof input.version === "string" && !isSemanticVersion(input.version)) issue("INVALID_VERSION", `Invalid theme version ${input.version}`, "version");
  if (typeof input.stateVersion === "string" && !isSemanticVersion(input.stateVersion)) issue("INVALID_VERSION", `Invalid theme state version ${input.stateVersion}`, "stateVersion");
  if (typeof input.layer === "string" && !THEME_LAYERS.includes(input.layer as ThemeLayer)) issue("INVALID_LAYER", `Unknown theme layer ${input.layer}`, "layer");
  if (input.parentId !== undefined && (typeof input.parentId !== "string" || !ID.test(input.parentId))) issue("INVALID_ID", "parentId must be a lowercase kebab-case ID", "parentId");
  if (input.fallbackThemeId !== undefined && (typeof input.fallbackThemeId !== "string" || !ID.test(input.fallbackThemeId))) issue("INVALID_ID", "fallbackThemeId must be a lowercase kebab-case ID", "fallbackThemeId");
  if (input.fallbackThemeId !== undefined && input.fallbackThemeId === input.id) issue("FALLBACK_CYCLE", "A theme cannot fall back to itself", "fallbackThemeId");
  validateIdArray(input.supportedEngineIds, "supportedEngineIds", true, issue);
  validateIdArray(input.supportedGameIds, "supportedGameIds", false, issue);
  validateIdArray(input.incompatibleGameIds, "incompatibleGameIds", false, issue);
  validateIdArray(input.incompatibleThemeIds, "incompatibleThemeIds", false, issue);
  if (Array.isArray(input.incompatibleThemeIds) && input.incompatibleThemeIds.includes(input.id)) issue("INCOMPATIBLE_THEME", "A theme cannot be incompatible with itself", "incompatibleThemeIds");
  const supportedGameIds = input.supportedGameIds;
  const incompatibleGameIds = input.incompatibleGameIds;
  if (Array.isArray(supportedGameIds) && Array.isArray(incompatibleGameIds)) {
    const overlap = supportedGameIds.find((gameId) => incompatibleGameIds.includes(gameId));
    if (overlap !== undefined) issue("INCOMPATIBLE_GAME", `Game ${String(overlap)} cannot be both supported and incompatible`, "incompatibleGameIds");
  }

  if (!isPlainRecord(input.tokens)) issue("INVALID_TOKEN", "tokens must be a plain object", "tokens");
  else validateTokenTree(input.tokens, "tokens", issue);
  if (!isPlainRecord(input.aliases)) issue("INVALID_ALIAS", "aliases must be a plain object", "aliases");
  else validateAliases(input.aliases, issue);
  if (!isPlainRecord(input.assetAliases)) issue("INVALID_ALIAS", "assetAliases must be a plain object", "assetAliases");
  else validateAssetAliases(input.assetAliases, issue);
  if (!isPlainRecord(input.metadata)) issue("INVALID_THEME", "metadata must be a plain object", "metadata");
  else validateJsonValue(input.metadata, "metadata", issue, new WeakSet<object>());

  return errors.length === 0
    ? { valid: true, errors, definition: freezeTheme(structuredClone(input) as unknown as ThemeDefinition) }
    : { valid: false, errors };
}

export function assertThemeDefinition(input: unknown): ThemeDefinition {
  const result = validateThemeDefinition(input);
  if (!result.definition) throw new ThemeSystemError(result.errors);
  return result.definition;
}

export function validateThemeGraph(definitions: readonly ThemeDefinition[]): readonly ThemeValidationError[] {
  const errors: ThemeValidationError[] = [];
  const byId = new Map<ThemeId, ThemeDefinition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) errors.push(themeError("DUPLICATE_THEME", `Duplicate theme ${definition.id}`, "id", { themeId: definition.id, layer: definition.layer }));
    else byId.set(definition.id, definition);
  }
  for (const definition of definitions) {
    if (definition.parentId !== undefined) {
      const parent = byId.get(definition.parentId);
      if (!parent) errors.push(themeError("MISSING_PARENT", `Theme ${definition.id} requires missing parent ${definition.parentId}`, "parentId", { themeId: definition.id, layer: definition.layer }));
      else {
        if (themeLayerRank(parent.layer) > themeLayerRank(definition.layer)) errors.push(themeError("INVALID_LAYER_ORDER", `Parent ${parent.id} cannot be applied after child ${definition.id}`, "parentId", { themeId: definition.id, layer: definition.layer }));
        if (!parent.supportedEngineIds.some((engine) => definition.supportedEngineIds.includes(engine))) errors.push(themeError("INCOMPATIBLE_ENGINE", `Theme ${definition.id} and parent ${parent.id} share no compatible engine`, "supportedEngineIds", { themeId: definition.id, layer: definition.layer }));
        if (!sharesGame(definition, parent) || conflictsWithSupportedGame(definition, parent)) errors.push(themeError("INCOMPATIBLE_GAME", `Theme ${definition.id} and parent ${parent.id} have incompatible game support`, "supportedGameIds", { themeId: definition.id, layer: definition.layer }));
        if (definition.incompatibleThemeIds.includes(parent.id) || parent.incompatibleThemeIds.includes(definition.id)) errors.push(themeError("INCOMPATIBLE_THEME", `Theme ${definition.id} conflicts with parent ${parent.id}`, "incompatibleThemeIds", { themeId: definition.id, layer: definition.layer }));
      }
    }
    if (definition.fallbackThemeId !== undefined) {
      const fallback = byId.get(definition.fallbackThemeId);
      if (!fallback) errors.push(themeError("MISSING_FALLBACK", `Theme ${definition.id} requires missing fallback ${definition.fallbackThemeId}`, "fallbackThemeId", { themeId: definition.id, layer: definition.layer }));
      else {
        if (themeLayerRank(fallback.layer) > themeLayerRank(definition.layer)) errors.push(themeError("INVALID_LAYER_ORDER", `Fallback ${fallback.id} cannot be applied after theme ${definition.id}`, "fallbackThemeId", { themeId: definition.id, layer: definition.layer }));
        if (!sharesEngine(definition, fallback)) errors.push(themeError("INCOMPATIBLE_ENGINE", `Theme ${definition.id} and fallback ${fallback.id} share no compatible engine`, "supportedEngineIds", { themeId: definition.id, layer: definition.layer }));
        if (!sharesGame(definition, fallback) || conflictsWithSupportedGame(definition, fallback)) errors.push(themeError("INCOMPATIBLE_GAME", `Theme ${definition.id} and fallback ${fallback.id} have incompatible game support`, "supportedGameIds", { themeId: definition.id, layer: definition.layer }));
        if (definition.incompatibleThemeIds.includes(fallback.id) || fallback.incompatibleThemeIds.includes(definition.id)) errors.push(themeError("INCOMPATIBLE_THEME", `Theme ${definition.id} conflicts with fallback ${fallback.id}`, "incompatibleThemeIds", { themeId: definition.id, layer: definition.layer }));
      }
    }
    for (const incompatible of definition.incompatibleThemeIds) {
      if (!byId.has(incompatible)) errors.push(themeError("UNKNOWN_THEME", `Theme ${definition.id} references unknown incompatible theme ${incompatible}`, "incompatibleThemeIds", { themeId: definition.id, layer: definition.layer }));
    }
  }
  errors.push(...parentCycleErrors(definitions, byId));
  errors.push(...fallbackCycleErrors(definitions, byId));
  return dedupe(errors);
}

export function assertThemeGraph(definitions: readonly ThemeDefinition[]): void {
  const errors = validateThemeGraph(definitions);
  if (errors.length > 0) throw new ThemeSystemError(errors);
}

export function freezeTheme<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) value.forEach((entry) => freezeTheme(entry));
  else Object.values(value as Record<string, unknown>).forEach((entry) => freezeTheme(entry));
  return Object.freeze(value);
}

export function cloneTheme<Value>(value: Value): Value { return freezeTheme(structuredClone(value)); }
export function isSafeThemePath(path: string): boolean { return path.split(".").every((segment) => SEGMENT.test(segment) && !RESERVED.has(segment)); }
export function isReservedThemeKey(key: string): boolean { return RESERVED.has(key); }

function validateIdArray(value: unknown, path: string, requireValue: boolean, issue: Issue): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !ID.test(entry))) { issue("INVALID_ID", `${path} must contain lowercase kebab-case IDs`, path); return; }
  if (requireValue && value.length === 0) issue("INCOMPATIBLE_ENGINE", "At least one supported engine is required", path);
  if (new Set(value).size !== value.length) issue("INVALID_THEME", `${path} contains duplicates`, path);
}

function validateTokenTree(tree: Record<string, unknown>, path: string, issue: Issue): void {
  for (const [key, value] of Object.entries(tree)) {
    const next = `${path}.${key}`;
    if (RESERVED.has(key)) { issue("PROTOTYPE_POLLUTION", `Reserved token key ${key} is forbidden`, next); continue; }
    if (!SEGMENT.test(key)) issue("INVALID_TOKEN", `Invalid token key ${key}`, next);
    if (isPlainRecord(value)) validateTokenTree(value, next, issue);
    else if (typeof value === "number") { if (!Number.isFinite(value)) issue("INVALID_TOKEN", "Numeric tokens must be finite", next); }
    else if (typeof value !== "string" && typeof value !== "boolean") issue("INVALID_TOKEN", "Token values must be strings, finite numbers, booleans, or nested token objects", next);
  }
}

function validateAliases(aliases: Record<string, unknown>, issue: Issue): void {
  for (const [alias, target] of Object.entries(aliases)) {
    if (!isSafeThemePath(alias)) issue(RESERVED_PATH(alias) ? "PROTOTYPE_POLLUTION" : "INVALID_ALIAS", `Invalid alias path ${alias}`, `aliases.${alias}`);
    if (typeof target !== "string" || !isSafeThemePath(target)) issue(typeof target === "string" && RESERVED_PATH(target) ? "PROTOTYPE_POLLUTION" : "INVALID_ALIAS", `Invalid alias target ${String(target)}`, `aliases.${alias}`);
  }
}

function validateAssetAliases(aliases: Record<string, unknown>, issue: Issue): void {
  for (const [alias, target] of Object.entries(aliases)) {
    if (!isSafeThemePath(alias)) issue(RESERVED_PATH(alias) ? "PROTOTYPE_POLLUTION" : "INVALID_ALIAS", `Invalid asset alias ${alias}`, `assetAliases.${alias}`);
    if (typeof target !== "string" || target.trim() === "") issue("INVALID_ALIAS", `Asset alias ${alias} requires a non-empty target`, `assetAliases.${alias}`);
  }
}

function validateJsonValue(value: unknown, path: string, issue: Issue, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) issue("INVALID_THEME", "Metadata numbers must be finite", path); return; }
  if (typeof value !== "object") { issue("INVALID_THEME", `Metadata contains unsupported ${typeof value}`, path); return; }
  if (seen.has(value)) { issue("INVALID_THEME", "Metadata cannot contain cycles", path); return; }
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => validateJsonValue(entry, `${path}.${index}`, issue, seen));
  else if (!isPlainRecord(value)) issue("INVALID_THEME", "Metadata must contain only arrays and plain objects", path);
  else for (const [key, entry] of Object.entries(value)) {
    if (RESERVED.has(key)) issue("PROTOTYPE_POLLUTION", `Reserved metadata key ${key} is forbidden`, `${path}.${key}`);
    else validateJsonValue(entry, `${path}.${key}`, issue, seen);
  }
  seen.delete(value);
}

function parentCycleErrors(definitions: readonly ThemeDefinition[], byId: ReadonlyMap<ThemeId, ThemeDefinition>): ThemeValidationError[] {
  const errors: ThemeValidationError[] = []; const visited = new Set<ThemeId>(); const visiting = new Set<ThemeId>(); const path: ThemeId[] = [];
  const signatures = new Set<string>();
  const visit = (definition: ThemeDefinition): void => {
    if (visited.has(definition.id)) return;
    if (visiting.has(definition.id)) {
      const start = path.indexOf(definition.id); const cycle = [...path.slice(start), definition.id];
      const signature = [...new Set(cycle)].sort().join("|");
      if (!signatures.has(signature)) { signatures.add(signature); errors.push(themeError("PARENT_CYCLE", `Theme parent cycle: ${cycle.join(" -> ")}`, "parentId", { themeId: definition.id, layer: definition.layer, details: { cycle } })); }
      return;
    }
    visiting.add(definition.id); path.push(definition.id);
    const parent = definition.parentId === undefined ? undefined : byId.get(definition.parentId);
    if (parent) visit(parent);
    path.pop(); visiting.delete(definition.id); visited.add(definition.id);
  };
  [...definitions].sort((a, b) => a.id < b.id ? -1 : 1).forEach(visit);
  return errors;
}

function fallbackCycleErrors(definitions: readonly ThemeDefinition[], byId: ReadonlyMap<ThemeId, ThemeDefinition>): ThemeValidationError[] {
  const errors: ThemeValidationError[] = []; const visited = new Set<ThemeId>(); const visiting = new Set<ThemeId>(); const path: ThemeId[] = [];
  const signatures = new Set<string>();
  const visit = (definition: ThemeDefinition): void => {
    if (visited.has(definition.id)) return;
    if (visiting.has(definition.id)) {
      const start = path.indexOf(definition.id); const cycle = [...path.slice(start), definition.id];
      const signature = [...new Set(cycle)].sort().join("|");
      if (!signatures.has(signature)) { signatures.add(signature); errors.push(themeError("FALLBACK_CYCLE", `Theme fallback cycle: ${cycle.join(" -> ")}`, "fallbackThemeId", { themeId: definition.id, layer: definition.layer, details: { cycle } })); }
      return;
    }
    visiting.add(definition.id); path.push(definition.id);
    const fallback = definition.fallbackThemeId === undefined ? undefined : byId.get(definition.fallbackThemeId);
    if (fallback) visit(fallback);
    path.pop(); visiting.delete(definition.id); visited.add(definition.id);
  };
  [...definitions].sort((a, b) => a.id < b.id ? -1 : 1).forEach(visit);
  return errors;
}

function sharesEngine(left: ThemeDefinition, right: ThemeDefinition): boolean {
  return left.supportedEngineIds.some((engineId) => right.supportedEngineIds.includes(engineId));
}

function sharesGame(left: ThemeDefinition, right: ThemeDefinition): boolean {
  return left.supportedGameIds.length === 0 || right.supportedGameIds.length === 0
    || left.supportedGameIds.some((gameId) => right.supportedGameIds.includes(gameId));
}

function conflictsWithSupportedGame(left: ThemeDefinition, right: ThemeDefinition): boolean {
  return left.supportedGameIds.some((gameId) => right.incompatibleGameIds.includes(gameId))
    || right.supportedGameIds.some((gameId) => left.incompatibleGameIds.includes(gameId));
}

function dedupe(errors: readonly ThemeValidationError[]): ThemeValidationError[] {
  const seen = new Set<string>(); return errors.filter((error) => { const key = `${error.code}|${error.themeId ?? ""}|${error.path}|${error.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function RESERVED_PATH(path: string): boolean { return path.split(".").some((segment) => RESERVED.has(segment)); }
function isPlainRecord(value: unknown): value is Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value) as object | null; return prototype === Object.prototype || prototype === null; }
type Issue = (code: ThemeValidationError["code"], message: string, path: string, details?: ThemeMetadata) => void;

// Keep branded imports visible to generated declarations without widening IDs.
export type { EngineManifestId, GameManifestId, ThemeManifestId, ThemeAliasMap, ThemeTokenTree };
