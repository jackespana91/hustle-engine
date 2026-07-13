import {
  themeManifestId,
  type EngineManifestId,
  type GameManifestId,
  type ThemeManifestId,
} from "../manifests/manifest-types.js";

export const THEME_SCHEMA_VERSION = "1.0.0" as const;
export const THEME_RUNTIME_STATE_VERSION = "1.0.0" as const;

export type ThemeId = ThemeManifestId;
export const themeId = themeManifestId;

export const THEME_LAYERS = ["base", "game", "operator", "seasonal", "accessibility"] as const;
export type ThemeLayer = typeof THEME_LAYERS[number];

export type ThemeTokenValue = string | number | boolean;
export interface ThemeTokenTree {
  readonly [key: string]: ThemeTokenValue | ThemeTokenTree;
}
export type ThemeComponentTokens = Readonly<Record<string, ThemeTokenTree>>;
/**
 * Standard presentation categories remain open to engine-neutral extensions.
 * A category can contain arbitrarily nested, validated primitive token data.
 */
export type ThemeTokenCategories = ThemeTokenTree & {
  readonly colors?: ThemeTokenTree;
  readonly typography?: ThemeTokenTree;
  readonly spacing?: ThemeTokenTree;
  readonly sizing?: ThemeTokenTree;
  readonly effects?: ThemeTokenTree;
  readonly animation?: ThemeTokenTree;
  readonly components?: ThemeComponentTokens;
};
export type ThemeFlatTokens = Readonly<Record<string, ThemeTokenValue>>;
export type ThemeAliasMap = Readonly<Record<string, string>>;
export type ThemeAssetAliasMap = Readonly<Record<string, string>>;
export type ThemeMetadata = Readonly<Record<string, unknown>>;

export interface ThemeDefinition {
  readonly schemaVersion: typeof THEME_SCHEMA_VERSION;
  readonly id: ThemeId;
  readonly name: string;
  readonly version: string;
  readonly stateVersion: string;
  readonly description: string;
  readonly layer: ThemeLayer;
  readonly parentId?: ThemeId;
  readonly fallbackThemeId?: ThemeId;
  readonly supportedEngineIds: readonly EngineManifestId[];
  /** Empty means engine-wide rather than restricted to a named game. */
  readonly supportedGameIds: readonly GameManifestId[];
  readonly incompatibleGameIds: readonly GameManifestId[];
  readonly incompatibleThemeIds: readonly ThemeId[];
  readonly tokens: ThemeTokenCategories;
  readonly aliases: ThemeAliasMap;
  readonly assetAliases: ThemeAssetAliasMap;
  readonly metadata: ThemeMetadata;
}

export interface ThemeSelection {
  readonly engineId: EngineManifestId;
  readonly gameId?: GameManifestId;
  readonly base: ThemeId;
  readonly game?: ThemeId;
  readonly operator?: ThemeId;
  readonly seasonal?: ThemeId;
  readonly accessibility?: ThemeId;
}

export interface ThemeConflict {
  readonly kind: "token-override" | "alias-override" | "asset-alias-override";
  readonly path: string;
  readonly previousThemeId: ThemeId;
  readonly replacingThemeId: ThemeId;
  readonly previousValue: ThemeTokenValue | string;
  readonly replacingValue: ThemeTokenValue | string;
}

export interface ResolvedTheme {
  readonly selection: ThemeSelection;
  readonly appliedThemeIds: readonly ThemeId[];
  readonly appliedLayers: readonly ThemeLayer[];
  readonly themeVersions: readonly ThemeVersionRecord[];
  readonly tokens: ThemeTokenTree;
  readonly flatTokens: ThemeFlatTokens;
  readonly aliases: ThemeAliasMap;
  readonly resolvedAliases: ThemeFlatTokens;
  readonly assetAliases: ThemeAssetAliasMap;
  readonly tokenSources: Readonly<Record<string, ThemeId>>;
  readonly aliasSources: Readonly<Record<string, ThemeId>>;
  readonly assetAliasSources: Readonly<Record<string, ThemeId>>;
  readonly conflicts: readonly ThemeConflict[];
  readonly hash: string;
}

export interface ThemeRegistrySnapshot {
  readonly schemaVersion: typeof THEME_SCHEMA_VERSION;
  readonly definitions: readonly ThemeDefinition[];
}

export interface ThemeVersionRecord {
  readonly id: ThemeId;
  readonly version: string;
  readonly stateVersion: string;
}
export const THEME_RUNTIME_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export interface ThemeRuntimeSnapshot {
  readonly schemaVersion: typeof THEME_RUNTIME_SNAPSHOT_SCHEMA_VERSION;
  readonly stateVersion: typeof THEME_RUNTIME_STATE_VERSION;
  readonly activeSelection: ThemeSelection | null;
  readonly activeHash: string | null;
  readonly activeThemeIds: readonly ThemeId[];
  readonly activeThemeVersions: readonly ThemeVersionRecord[];
  readonly compositionOrder: readonly ThemeId[];
  readonly compositionLayers: readonly ThemeLayer[];
  readonly aliases: ThemeAliasMap;
  readonly resolvedAliases: ThemeFlatTokens;
  readonly assetAliases: ThemeAssetAliasMap;
}

export interface ThemeDebugEventRecord {
  readonly sequence: number;
  readonly type: string;
  readonly summary: string;
}

export interface ThemeDebugSnapshot {
  readonly registeredThemes: readonly {
    readonly id: ThemeId;
    readonly name: string;
    readonly version: string;
    readonly layer: ThemeLayer;
    readonly parentId: ThemeId | null;
    readonly fallbackThemeId: ThemeId | null;
    readonly supportedEngineIds: readonly EngineManifestId[];
    readonly supportedGameIds: readonly GameManifestId[];
    readonly incompatibleGameIds: readonly GameManifestId[];
  }[];
  readonly activeSelection: ThemeSelection | null;
  readonly activeHash: string | null;
  readonly appliedThemeIds: readonly ThemeId[];
  readonly tokens: ThemeFlatTokens;
  readonly aliases: ThemeAliasMap;
  readonly resolvedAliases: ThemeFlatTokens;
  readonly assetAliases: ThemeAssetAliasMap;
  readonly conflicts: readonly ThemeConflict[];
  readonly latestEvents: readonly ThemeDebugEventRecord[];
  readonly latestErrors: readonly import("./theme-errors.js").ThemeValidationError[];
}

export function themeLayerRank(layer: ThemeLayer): number { return THEME_LAYERS.indexOf(layer); }
