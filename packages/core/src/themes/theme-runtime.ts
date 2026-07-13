import { ThemeSystemError, themeError, type ThemeValidationError } from "./theme-errors.js";
import { ThemeRegistry } from "./theme-registry.js";
import {
  ThemeResolver,
  resolveThemeAlias,
  resolveThemeAssetAlias,
  resolveThemeToken,
  stableThemeStringify,
} from "./theme-resolver.js";
import {
  THEME_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
  THEME_RUNTIME_STATE_VERSION,
  THEME_LAYERS,
  type ResolvedTheme,
  type ThemeRuntimeSnapshot,
  type ThemeSelection,
  type ThemeTokenValue,
} from "./theme-types.js";
import { cloneTheme } from "./theme-validator.js";

export class ThemeRuntime {
  readonly resolver: ThemeResolver;
  private activeValue: ResolvedTheme | null = null;

  constructor(readonly registry: ThemeRegistry, resolver?: ThemeResolver) {
    this.resolver = resolver ?? new ThemeResolver(registry);
  }

  get active(): ResolvedTheme | null { return this.activeValue ? cloneTheme(this.activeValue) : null; }

  activate(selection: ThemeSelection): ResolvedTheme {
    const resolved = this.resolver.resolve(selection);
    this.activeValue = resolved;
    this.registry.events.publish("theme:activated", { active: cloneTheme(resolved) });
    return cloneTheme(resolved);
  }

  deactivate(): ResolvedTheme | null {
    const previous = this.activeValue;
    if (!previous) return null;
    this.activeValue = null;
    this.registry.events.publish("theme:deactivated", { previous: cloneTheme(previous) });
    return cloneTheme(previous);
  }

  /** Resolves completely before changing the active theme. */
  swap(selection: ThemeSelection): ResolvedTheme {
    const previous = this.activeValue;
    try {
      const resolved = this.resolver.resolve(selection);
      this.activeValue = resolved;
      this.registry.events.publish("theme:swapped", { previous: previous ? cloneTheme(previous) : null, active: cloneTheme(resolved) });
      return cloneTheme(resolved);
    } catch (error) {
      this.activeValue = previous;
      const errors = [
        themeError("SWAP_FAILED", "Atomic theme swap failed; the previous theme remains active", "$"),
        ...errorsFrom(error),
      ];
      this.registry.events.publish("theme:swap-failed", {
        selection: cloneTheme(selection), previous: previous ? cloneTheme(previous) : null, errors,
      });
      throw new ThemeSystemError(errors, undefined, { cause: error });
    }
  }

  resolveToken(path: string): ThemeTokenValue {
    const active = this.requireActive(); const value = resolveThemeToken(active, path);
    this.registry.events.publish("theme:token-resolved", { path, value, hash: active.hash });
    return value;
  }

  resolveAlias(alias: string): ThemeTokenValue {
    const active = this.requireActive(); const value = resolveThemeAlias(active, alias); const target = active.aliases[alias];
    if (target === undefined) throw new ThemeSystemError([themeError("INVALID_ALIAS", `Unknown alias ${alias}`, alias)]);
    this.registry.events.publish("theme:alias-resolved", { alias, target, value, hash: active.hash });
    return value;
  }

  resolveAssetAlias(alias: string): string {
    const active = this.requireActive(); const target = resolveThemeAssetAlias(active, alias);
    this.registry.events.publish("theme:asset-alias-resolved", { alias, target, hash: active.hash });
    return target;
  }

  snapshot(): ThemeRuntimeSnapshot {
    const snapshot: ThemeRuntimeSnapshot = {
      schemaVersion: THEME_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
      stateVersion: THEME_RUNTIME_STATE_VERSION,
      activeSelection: this.activeValue?.selection ?? null,
      activeHash: this.activeValue?.hash ?? null,
      activeThemeIds: this.activeValue?.appliedThemeIds ?? [],
      activeThemeVersions: this.activeValue?.themeVersions ?? [],
      compositionOrder: this.activeValue?.appliedThemeIds ?? [],
      compositionLayers: this.activeValue?.appliedLayers ?? [],
      aliases: this.activeValue?.aliases ?? {},
      resolvedAliases: this.activeValue?.resolvedAliases ?? {},
      assetAliases: this.activeValue?.assetAliases ?? {},
    };
    const output = cloneTheme(snapshot);
    this.registry.events.publish("theme:state-serialized", { snapshot: output });
    return output;
  }

  serialize(pretty = false): string { return stableThemeStringify(this.snapshot(), pretty); }

  restore(snapshotOrJson: ThemeRuntimeSnapshot | string): ThemeRuntimeSnapshot {
    const previous = this.activeValue;
    let candidate: unknown = snapshotOrJson;
    try {
      const snapshot = typeof snapshotOrJson === "string" ? parseRuntimeSnapshot(snapshotOrJson) : validateRuntimeSnapshot(snapshotOrJson);
      candidate = snapshot;
      const staged = snapshot.activeSelection === null ? null : this.resolver.resolve(snapshot.activeSelection);
      if (staged === null) {
        if (snapshot.activeHash !== null || snapshot.activeThemeIds.length !== 0 || snapshot.activeThemeVersions.length !== 0
          || snapshot.compositionOrder.length !== 0 || Object.keys(snapshot.aliases).length !== 0
          || snapshot.compositionLayers.length !== 0
          || Object.keys(snapshot.resolvedAliases).length !== 0 || Object.keys(snapshot.assetAliases).length !== 0) {
          throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Inactive theme snapshot cannot contain active composition data", "activeHash")]);
        }
      } else {
        if (stableThemeStringify(snapshot.activeThemeIds) !== stableThemeStringify(staged.appliedThemeIds)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Resolved theme IDs do not match the saved snapshot", "activeThemeIds")]);
        if (stableThemeStringify(snapshot.activeThemeVersions) !== stableThemeStringify(staged.themeVersions)) throw new ThemeSystemError([themeError("STATE_VERSION_MISMATCH", "Theme definition versions do not match the saved snapshot", "activeThemeVersions")]);
        if (stableThemeStringify(snapshot.compositionOrder) !== stableThemeStringify(staged.appliedThemeIds)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Theme composition order does not match the saved snapshot", "compositionOrder")]);
        if (stableThemeStringify(snapshot.compositionLayers) !== stableThemeStringify(staged.appliedLayers)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Theme composition layers do not match the saved snapshot", "compositionLayers")]);
        if (stableThemeStringify(snapshot.aliases) !== stableThemeStringify(staged.aliases)
          || stableThemeStringify(snapshot.resolvedAliases) !== stableThemeStringify(staged.resolvedAliases)
          || stableThemeStringify(snapshot.assetAliases) !== stableThemeStringify(staged.assetAliases)) {
          throw new ThemeSystemError([themeError("HASH_MISMATCH", "Resolved theme aliases do not match the saved snapshot", "aliases")]);
        }
        if (snapshot.activeHash !== staged.hash) throw new ThemeSystemError([themeError("HASH_MISMATCH", "Resolved theme hash does not match the saved snapshot", "activeHash", { details: { saved: snapshot.activeHash, resolved: staged.hash } })]);
      }
      this.activeValue = staged;
      const output = cloneTheme(snapshot);
      this.registry.events.publish("theme:state-restored", { snapshot: output, active: staged ? cloneTheme(staged) : null });
      return output;
    } catch (error) {
      this.activeValue = previous;
      const errors = errorsFrom(error);
      this.registry.events.publish("theme:restore-failed", { snapshot: candidate, errors });
      throw error instanceof ThemeSystemError ? error : new ThemeSystemError(errors, undefined, { cause: error });
    }
  }

  deserialize(snapshotOrJson: ThemeRuntimeSnapshot | string): ThemeRuntimeSnapshot { return this.restore(snapshotOrJson); }

  private requireActive(): ResolvedTheme {
    if (!this.activeValue) throw new ThemeSystemError([themeError("RESOLUTION_FAILED", "No theme is active", "active")]);
    return this.activeValue;
  }
}

export function parseRuntimeSnapshot(json: string): ThemeRuntimeSnapshot {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new ThemeSystemError([themeError("INVALID_JSON", "Theme runtime snapshot is not valid JSON", "$", { details: { message: error instanceof Error ? error.message : String(error) } })]); }
  return validateRuntimeSnapshot(value);
}

export function validateRuntimeSnapshot(value: unknown): ThemeRuntimeSnapshot {
  if (!isRecord(value)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Theme runtime snapshot must be an object", "$")]);
  if (value.schemaVersion !== THEME_RUNTIME_SNAPSHOT_SCHEMA_VERSION) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", `Unsupported theme snapshot schema ${String(value.schemaVersion)}`, "schemaVersion")]);
  if (value.stateVersion !== THEME_RUNTIME_STATE_VERSION) throw new ThemeSystemError([themeError("STATE_VERSION_MISMATCH", `Unsupported theme runtime state ${String(value.stateVersion)}`, "stateVersion")]);
  if (value.activeSelection !== null && !isRecord(value.activeSelection)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "activeSelection must be an object or null", "activeSelection")]);
  if (isRecord(value.activeSelection)) {
    if (typeof value.activeSelection.engineId !== "string" || typeof value.activeSelection.base !== "string") {
      throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "activeSelection requires string engineId and base values", "activeSelection")]);
    }
    for (const layer of ["game", "operator", "seasonal", "accessibility"] as const) {
      const id = value.activeSelection[layer];
      if (id !== undefined && typeof id !== "string") throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", `${layer} must be a string when present`, `activeSelection.${layer}`)]);
    }
    if (value.activeSelection.gameId !== undefined && typeof value.activeSelection.gameId !== "string") throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "gameId must be a string when present", "activeSelection.gameId")]);
  }
  if (value.activeHash !== null && typeof value.activeHash !== "string") throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "activeHash must be a string or null", "activeHash")]);
  if (!Array.isArray(value.activeThemeIds) || value.activeThemeIds.some((id) => typeof id !== "string") || new Set(value.activeThemeIds).size !== value.activeThemeIds.length) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "activeThemeIds must contain unique IDs", "activeThemeIds")]);
  if (!Array.isArray(value.activeThemeVersions) || value.activeThemeVersions.some((entry) => !isVersionRecord(entry))
    || new Set(value.activeThemeVersions.map((entry) => (entry as { id: string }).id)).size !== value.activeThemeVersions.length) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "activeThemeVersions must contain unique id, version and stateVersion records", "activeThemeVersions")]);
  if (!Array.isArray(value.compositionOrder) || value.compositionOrder.some((id) => typeof id !== "string") || new Set(value.compositionOrder).size !== value.compositionOrder.length) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "compositionOrder must contain unique theme IDs", "compositionOrder")]);
  if (!Array.isArray(value.compositionLayers) || value.compositionLayers.some((layer) => typeof layer !== "string" || !THEME_LAYERS.includes(layer as typeof THEME_LAYERS[number]))) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "compositionLayers must contain valid theme layers", "compositionLayers")]);
  if (!isStringRecord(value.aliases)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "aliases must contain string targets", "aliases")]);
  if (!isPrimitiveRecord(value.resolvedAliases)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "resolvedAliases must contain primitive token values", "resolvedAliases")]);
  if (!isStringRecord(value.assetAliases)) throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "assetAliases must contain string targets", "assetAliases")]);
  return cloneTheme(value as unknown as ThemeRuntimeSnapshot);
}

function errorsFrom(error: unknown): readonly ThemeValidationError[] {
  return error instanceof ThemeSystemError ? error.errors : [themeError("RESTORE_FAILED", error instanceof Error ? error.message : "Theme restore failed", "$")];
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isVersionRecord(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.version === "string" && typeof value.stateVersion === "string";
}
function isPrimitiveRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean");
}
function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
