import type { ThemeValidationError } from "./theme-errors.js";
import type {
  ResolvedTheme,
  ThemeDefinition,
  ThemeRuntimeSnapshot,
  ThemeSelection,
  ThemeTokenValue,
} from "./theme-types.js";

export interface ThemeEventMap {
  "theme:registered": { readonly definition: ThemeDefinition };
  "theme:removed": { readonly definition: ThemeDefinition };
  "theme:loaded": { readonly definitions: readonly ThemeDefinition[] };
  "theme:validation-failed": { readonly errors: readonly ThemeValidationError[] };
  "theme:resolved": { readonly resolved: ResolvedTheme };
  "theme:resolution-failed": { readonly selection: ThemeSelection; readonly errors: readonly ThemeValidationError[] };
  "theme:activated": { readonly active: ResolvedTheme };
  "theme:deactivated": { readonly previous: ResolvedTheme };
  "theme:swapped": { readonly previous: ResolvedTheme | null; readonly active: ResolvedTheme };
  "theme:swap-failed": { readonly selection: ThemeSelection; readonly previous: ResolvedTheme | null; readonly errors: readonly ThemeValidationError[] };
  "theme:token-resolved": { readonly path: string; readonly value: ThemeTokenValue; readonly hash: string };
  "theme:alias-resolved": { readonly alias: string; readonly target: string; readonly value: ThemeTokenValue; readonly hash: string };
  "theme:asset-alias-resolved": { readonly alias: string; readonly target: string; readonly hash: string };
  "theme:state-serialized": { readonly snapshot: ThemeRuntimeSnapshot };
  "theme:state-restored": { readonly snapshot: ThemeRuntimeSnapshot; readonly active: ResolvedTheme | null };
  "theme:restore-failed": { readonly snapshot: unknown; readonly errors: readonly ThemeValidationError[] };
}

export type ThemeEventName = keyof ThemeEventMap;
export type ThemeEvent = {
  readonly [Name in ThemeEventName]: { readonly type: Name; readonly payload: ThemeEventMap[Name] }
}[ThemeEventName];
