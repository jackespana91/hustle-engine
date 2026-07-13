import { ThemeSystemError, themeError } from "./theme-errors.js";
import { ThemeRegistry, type ThemeRegisterOptions } from "./theme-registry.js";
import { stableThemeStringify } from "./theme-resolver.js";
import { ThemeRuntime, parseRuntimeSnapshot } from "./theme-runtime.js";
import {
  THEME_SCHEMA_VERSION,
  themeLayerRank,
  type ThemeDefinition,
  type ThemeRegistrySnapshot,
  type ThemeRuntimeSnapshot,
} from "./theme-types.js";
import { assertThemeDefinition, assertThemeGraph, cloneTheme } from "./theme-validator.js";

/** Stable serialization facade for registries and live runtime state. */
export class ThemeSerializer {
  serialize(registryOrSnapshot: ThemeRegistry | ThemeRegistrySnapshot, pretty = false): string {
    return this.serializeRegistry(registryOrSnapshot, pretty);
  }

  deserialize(json: string): ThemeRegistrySnapshot {
    return this.deserializeRegistry(json);
  }

  serializeRegistry(registryOrSnapshot: ThemeRegistry | ThemeRegistrySnapshot, pretty = false): string {
    const snapshot = registryOrSnapshot instanceof ThemeRegistry
      ? registryOrSnapshot.snapshot()
      : validateRegistrySnapshot(registryOrSnapshot);
    return stableThemeStringify(snapshot, pretty);
  }

  deserializeRegistry(json: string): ThemeRegistrySnapshot {
    let value: unknown;
    try { value = JSON.parse(json); }
    catch (error) {
      throw new ThemeSystemError([themeError("INVALID_JSON", "Theme registry snapshot is not valid JSON", "$", {
        details: { message: error instanceof Error ? error.message : String(error) },
      })]);
    }
    return validateRegistrySnapshot(value);
  }

  restoreRegistry(registry: ThemeRegistry, json: string, options: ThemeRegisterOptions = {}): ThemeRegistrySnapshot {
    const snapshot = this.deserializeRegistry(json);
    registry.registerMany(snapshot.definitions, options);
    return snapshot;
  }

  serializeRuntime(runtime: ThemeRuntime, pretty = false): string {
    return runtime.serialize(pretty);
  }

  deserializeRuntime(runtime: ThemeRuntime, json: string): ThemeRuntimeSnapshot {
    return runtime.restore(parseRuntimeSnapshot(json));
  }
}

export function validateRegistrySnapshot(value: unknown): ThemeRegistrySnapshot {
  if (!isRecord(value) || value.schemaVersion !== THEME_SCHEMA_VERSION || !Array.isArray(value.definitions)) {
    throw new ThemeSystemError([themeError("INVALID_SNAPSHOT", "Invalid theme registry snapshot", "$")]);
  }
  const definitions = value.definitions.map(assertThemeDefinition).sort(compareDefinitions);
  assertThemeGraph(definitions);
  return cloneTheme({ schemaVersion: THEME_SCHEMA_VERSION, definitions });
}

function compareDefinitions(left: ThemeDefinition, right: ThemeDefinition): number {
  return themeLayerRank(left.layer) - themeLayerRank(right.layer)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
