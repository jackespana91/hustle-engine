import { engineManifestId, gameManifestId } from "../../manifests/manifest-types.js";
import {
  THEME_SCHEMA_VERSION,
  themeId,
  type ThemeDefinition,
  type ThemeSelection,
} from "../theme-types.js";

export const THEME_EXAMPLE_ENGINE_ID = engineManifestId("routerun-engine-001");
export const THEME_EXAMPLE_GAME_ID = gameManifestId("night-drop-game-pack-001");

const exampleMetadata = Object.freeze({
  example: true,
  production: false,
  gameplayImplemented: false,
  purpose: "presentation-only architecture example",
});

export const HUSTLE_BASE_THEME_EXAMPLE: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: themeId("hustle-base-theme"),
  name: "Hustle Base",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Engine-neutral defaults for Hustle game presentation.",
  layer: "base",
  supportedEngineIds: [THEME_EXAMPLE_ENGINE_ID],
  supportedGameIds: [],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: {
    colors: { background: "#111522", foreground: "#f5f7ff", accent: "#77f2c7", danger: "#ff6376" },
    typography: { family: "system-ui", scale: { body: 16, title: 30 } },
    spacing: { small: 8, medium: 16, large: 24 },
    sizing: { control: 44, panel: 320 },
    effects: { shadow: "0 8px 30px rgba(0,0,0,0.35)", glow: "0 0 18px rgba(119,242,199,0.4)" },
    animation: { duration: { fast: 120, standard: 240 }, reduced: false },
    components: { button: { radius: 8, emphasis: "solid" }, panel: { radius: 12 } },
  },
  aliases: {
    "semantic.surface": "colors.background",
    "semantic.text": "colors.foreground",
    "semantic.action": "colors.accent",
  },
  assetAliases: { "shared.logo": "asset://shared/hustle-logo", "shared.panel-texture": "asset://shared/panel-texture" },
  metadata: exampleMetadata,
};

export const NIGHT_DROP_THEME_EXAMPLE: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: themeId("night-drop-theme"),
  name: "Night Drop",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Illustrative Night Drop visual token overrides; contains no mechanics.",
  layer: "game",
  parentId: HUSTLE_BASE_THEME_EXAMPLE.id,
  fallbackThemeId: HUSTLE_BASE_THEME_EXAMPLE.id,
  supportedEngineIds: [THEME_EXAMPLE_ENGINE_ID],
  supportedGameIds: [THEME_EXAMPLE_GAME_ID],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: { colors: { background: "#070913", accent: "#d772ff" }, typography: { scale: { title: 34 } }, components: { route: { glow: "#d772ff" } } },
  aliases: { "semantic.highlight": "colors.accent" },
  assetAliases: { "game.background": "asset://night-drop/background", "game.symbol-set": "asset://night-drop/symbols" },
  metadata: { ...exampleMetadata, gamePack: "night-drop-game-pack-001" },
};

export const OPERATOR_OVERLAY_THEME_EXAMPLE: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: themeId("operator-overlay-theme"),
  name: "Operator Overlay",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Illustrative operator branding layer.",
  layer: "operator",
  parentId: NIGHT_DROP_THEME_EXAMPLE.id,
  supportedEngineIds: [THEME_EXAMPLE_ENGINE_ID],
  supportedGameIds: [THEME_EXAMPLE_GAME_ID],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: { colors: { accent: "#2fe6ff" }, operator: { logo: "operator-placeholder" } },
  aliases: { "semantic.operator-brand": "colors.accent" },
  assetAliases: { "shared.logo": "asset://operator/logo" },
  metadata: exampleMetadata,
};

export const SEASONAL_OVERLAY_THEME_EXAMPLE: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: themeId("seasonal-overlay-theme"),
  name: "Seasonal Overlay",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Illustrative time-limited presentation overlay.",
  layer: "seasonal",
  parentId: NIGHT_DROP_THEME_EXAMPLE.id,
  supportedEngineIds: [THEME_EXAMPLE_ENGINE_ID],
  supportedGameIds: [THEME_EXAMPLE_GAME_ID],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: { colors: { accent: "#ffbf47" }, seasonal: { label: "example-season" } },
  aliases: { "semantic.seasonal-accent": "colors.accent" },
  assetAliases: { "seasonal.overlay": "asset://seasonal/example-overlay" },
  metadata: exampleMetadata,
};

export const HIGH_CONTRAST_THEME_EXAMPLE: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: themeId("high-contrast-theme"),
  name: "High Contrast",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Illustrative accessibility overrides with reduced motion.",
  layer: "accessibility",
  parentId: HUSTLE_BASE_THEME_EXAMPLE.id,
  fallbackThemeId: HUSTLE_BASE_THEME_EXAMPLE.id,
  supportedEngineIds: [THEME_EXAMPLE_ENGINE_ID],
  supportedGameIds: [],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: {
    colors: { background: "#000000", foreground: "#ffffff", accent: "#ffff00" },
    animation: { duration: { fast: 0, standard: 0 }, reduced: true },
    effects: { glow: "none", shadow: "none" },
  },
  aliases: { "semantic.focus": "colors.accent" },
  assetAliases: {},
  metadata: exampleMetadata,
};

export const THEME_SYSTEM_EXAMPLES = [
  HUSTLE_BASE_THEME_EXAMPLE,
  NIGHT_DROP_THEME_EXAMPLE,
  OPERATOR_OVERLAY_THEME_EXAMPLE,
  SEASONAL_OVERLAY_THEME_EXAMPLE,
  HIGH_CONTRAST_THEME_EXAMPLE,
] as const satisfies readonly ThemeDefinition[];

export const THEME_SYSTEM_EXAMPLE_SELECTION: ThemeSelection = {
  engineId: THEME_EXAMPLE_ENGINE_ID,
  gameId: THEME_EXAMPLE_GAME_ID,
  base: HUSTLE_BASE_THEME_EXAMPLE.id,
  game: NIGHT_DROP_THEME_EXAMPLE.id,
  operator: OPERATOR_OVERLAY_THEME_EXAMPLE.id,
  seasonal: SEASONAL_OVERLAY_THEME_EXAMPLE.id,
  accessibility: HIGH_CONTRAST_THEME_EXAMPLE.id,
};
