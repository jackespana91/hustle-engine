import type { ThemeValidationError } from "./theme-errors.js";
import type { ThemeEventMap, ThemeEventName } from "./theme-events.js";
import { ThemeRegistry } from "./theme-registry.js";
import { ThemeRuntime } from "./theme-runtime.js";
import type { ThemeDebugEventRecord, ThemeDebugSnapshot } from "./theme-types.js";
import { cloneTheme } from "./theme-validator.js";

export const THEME_DEBUG_EVENT_NAMES = [
  "theme:registered",
  "theme:removed",
  "theme:loaded",
  "theme:validation-failed",
  "theme:resolved",
  "theme:resolution-failed",
  "theme:activated",
  "theme:deactivated",
  "theme:swapped",
  "theme:swap-failed",
  "theme:token-resolved",
  "theme:alias-resolved",
  "theme:asset-alias-resolved",
  "theme:state-serialized",
  "theme:state-restored",
  "theme:restore-failed",
] as const satisfies readonly ThemeEventName[];

/**
 * Read-only, DOM-free projection for the core debug panel or any future host UI.
 * It owns no presentation and can therefore be used in tests and non-browser hosts.
 */
export class ThemeDebugAdapter {
  private readonly unsubscribe: (() => void)[] = [];
  private readonly eventRecords: ThemeDebugEventRecord[] = [];
  private readonly errorRecords: ThemeValidationError[] = [];
  private sequence = 0;

  constructor(
    readonly registry: ThemeRegistry,
    readonly runtime: ThemeRuntime,
    private readonly recordLimit = 100,
  ) {
    if (!Number.isSafeInteger(recordLimit) || recordLimit < 1) {
      throw new RangeError("Theme debug record limit must be a positive safe integer");
    }
    for (const name of THEME_DEBUG_EVENT_NAMES) this.subscribe(name);
  }

  snapshot(): ThemeDebugSnapshot {
    const active = this.runtime.active;
    return cloneTheme({
      registeredThemes: this.registry.list().map((definition) => ({
        id: definition.id,
        name: definition.name,
        version: definition.version,
        layer: definition.layer,
        parentId: definition.parentId ?? null,
        fallbackThemeId: definition.fallbackThemeId ?? null,
        supportedEngineIds: definition.supportedEngineIds,
        supportedGameIds: definition.supportedGameIds,
        incompatibleGameIds: definition.incompatibleGameIds,
      })),
      activeSelection: active?.selection ?? null,
      activeHash: active?.hash ?? null,
      appliedThemeIds: active?.appliedThemeIds ?? [],
      tokens: active?.flatTokens ?? {},
      aliases: active?.aliases ?? {},
      resolvedAliases: active?.resolvedAliases ?? {},
      assetAliases: active?.assetAliases ?? {},
      conflicts: active?.conflicts ?? [],
      latestEvents: this.eventRecords,
      latestErrors: this.errorRecords,
    });
  }

  clear(): void {
    this.eventRecords.length = 0;
    this.errorRecords.length = 0;
  }

  destroy(): void {
    this.unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
  }

  private subscribe<Name extends ThemeEventName>(name: Name): void {
    this.unsubscribe.push(this.registry.events.subscribe(name, (payload) => {
      this.sequence += 1;
      this.eventRecords.push({ sequence: this.sequence, type: name, summary: summarizeThemeEvent(name, payload) });
      if ("errors" in payload && Array.isArray(payload.errors)) {
        this.errorRecords.push(...payload.errors as readonly ThemeValidationError[]);
      }
      trim(this.eventRecords, this.recordLimit);
      trim(this.errorRecords, this.recordLimit);
    }));
  }
}

function summarizeThemeEvent<Name extends ThemeEventName>(name: Name, payload: ThemeEventMap[Name]): string {
  switch (name) {
    case "theme:registered":
    case "theme:removed":
      return `${name}: ${(payload as ThemeEventMap["theme:registered"]).definition.id}`;
    case "theme:loaded":
      return `${name}: ${(payload as ThemeEventMap["theme:loaded"]).definitions.length} theme(s)`;
    case "theme:resolved":
      return `${name}: ${(payload as ThemeEventMap["theme:resolved"]).resolved.hash}`;
    case "theme:activated":
      return `${name}: ${(payload as ThemeEventMap["theme:activated"]).active.hash}`;
    case "theme:deactivated":
      return `${name}: ${(payload as ThemeEventMap["theme:deactivated"]).previous.hash}`;
    case "theme:swapped":
      return `${name}: ${(payload as ThemeEventMap["theme:swapped"]).active.hash}`;
    case "theme:swap-failed":
      return `${name}: ${(payload as ThemeEventMap["theme:swap-failed"]).errors.length} error(s)`;
    case "theme:token-resolved":
      return `${name}: ${(payload as ThemeEventMap["theme:token-resolved"]).path}`;
    case "theme:alias-resolved":
      return `${name}: ${(payload as ThemeEventMap["theme:alias-resolved"]).alias}`;
    case "theme:asset-alias-resolved":
      return `${name}: ${(payload as ThemeEventMap["theme:asset-alias-resolved"]).alias}`;
    case "theme:state-serialized":
    case "theme:state-restored":
      return `${name}: ${(payload as ThemeEventMap["theme:state-serialized"]).snapshot.activeHash ?? "inactive"}`;
    case "theme:validation-failed":
    case "theme:resolution-failed":
    case "theme:restore-failed":
      return `${name}: ${(payload as ThemeEventMap["theme:validation-failed"]).errors.length} error(s)`;
  }
  return name;
}

function trim<Value>(values: Value[], limit: number): void {
  const excess = values.length - limit;
  if (excess > 0) values.splice(0, excess);
}
