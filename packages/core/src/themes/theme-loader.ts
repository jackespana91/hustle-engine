import { ThemeSystemError, themeError } from "./theme-errors.js";
import { ThemeRegistry, type ThemeRegisterOptions } from "./theme-registry.js";
import type { ThemeDefinition } from "./theme-types.js";

export type ThemeSource = ThemeDefinition | (() => ThemeDefinition | Promise<ThemeDefinition>);

export class ThemeLoader {
  async load(
    registry: ThemeRegistry,
    sources: readonly ThemeSource[],
    options: ThemeRegisterOptions = {},
  ): Promise<readonly ThemeDefinition[]> {
    const definitions: ThemeDefinition[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      try {
        if (source === undefined) throw new TypeError("Theme source is missing");
        definitions.push(typeof source === "function" ? await source() : source);
      } catch (error) {
        if (error instanceof ThemeSystemError) throw error;
        throw new ThemeSystemError([themeError("LOAD_FAILED", `Theme source ${index} failed to load`, `sources.${index}`, {
          details: { message: error instanceof Error ? error.message : String(error) },
        })], undefined, { cause: error });
      }
    }
    registry.registerMany(definitions, options);
    const loaded = definitions.map((definition) => registry.require(definition.id));
    registry.events.publish("theme:loaded", { definitions: loaded });
    return loaded;
  }

  loadJson(registry: ThemeRegistry, json: string, options: ThemeRegisterOptions = {}): readonly ThemeDefinition[] {
    let value: unknown;
    try { value = JSON.parse(json); }
    catch (error) {
      throw new ThemeSystemError([themeError("INVALID_JSON", "Theme JSON could not be parsed", "$", { details: { message: error instanceof Error ? error.message : String(error) } })]);
    }
    const definitions = (Array.isArray(value) ? value : [value]) as readonly ThemeDefinition[];
    registry.registerMany(definitions, options);
    const loaded = definitions.map((definition) => registry.require(definition.id));
    registry.events.publish("theme:loaded", { definitions: loaded });
    return loaded;
  }
}
