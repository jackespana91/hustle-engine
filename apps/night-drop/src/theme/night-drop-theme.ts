import {
  THEME_SCHEMA_VERSION,
  ThemeRegistry,
  ThemeRuntime,
  engineManifestId,
  gameManifestId,
  type ResolvedTheme,
  type ThemeDefinition,
} from "@hustle/core";
import {
  NIGHT_DROP_ASSET_IDS,
  NIGHT_DROP_ENGINE_ID,
  NIGHT_DROP_FOUNDATION_THEME_ID,
  NIGHT_DROP_GAME_ID,
  NIGHT_DROP_THEME_ID,
} from "../config/ids.js";

// Theme System 1.0 validates kebab-case compatibility identities while the
// Manifest System supports the permanent dotted RouteRun/Game IDs. These
// app-owned aliases bridge that schema difference without modifying Core.
const THEME_ROUTERUN_ENGINE_ID = engineManifestId("routerun-engine-001");
const THEME_NIGHT_DROP_GAME_ID = gameManifestId("night-drop-game-pack-001");

export const NightDropFoundationTheme: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: NIGHT_DROP_FOUNDATION_THEME_ID,
  name: "Night Drop Foundation",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Standalone dark foundation owned by the Night Drop game pack.",
  layer: "base",
  supportedEngineIds: [THEME_ROUTERUN_ENGINE_ID],
  supportedGameIds: [THEME_NIGHT_DROP_GAME_ID],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: {
    colors: {
      ink: "#070913",
      panel: "#0e1220",
      "panel-raised": "#151b2e",
      text: "#f5f7ff",
      "text-muted": "#8e99b8",
      line: "#27304a",
    },
    typography: {
      display: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
      body: "Inter, ui-sans-serif, system-ui, sans-serif",
      mono: "'SFMono-Regular', Consolas, monospace",
      "title-size": "clamp(2.8rem, 9vw, 6.8rem)",
      "label-size": "0.7rem",
      "body-size": "0.92rem",
    },
    spacing: { xxs: "0.25rem", xs: "0.45rem", sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
    sizing: { radius: "0.85rem", control: "2.75rem", panel: "18rem", "board-max": "38rem" },
    animation: { fast: "120ms", standard: "260ms", route: "420ms", ease: "cubic-bezier(.2,.8,.2,1)" },
  },
  aliases: {
    "surface.page": "colors.ink",
    "surface.panel": "colors.panel",
    "surface.raised": "colors.panel-raised",
    "content.primary": "colors.text",
    "content.muted": "colors.text-muted",
    "border.default": "colors.line",
  },
  assetAliases: {},
  metadata: {
    gamePack: "night-drop",
    standaloneFoundation: true,
    manifestEngineId: String(NIGHT_DROP_ENGINE_ID),
    manifestGameId: String(NIGHT_DROP_GAME_ID),
  },
};

export const NightDropTheme: ThemeDefinition = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: NIGHT_DROP_THEME_ID,
  name: "NightDropTheme",
  version: "0.1.0",
  stateVersion: "1.0.0",
  description: "Neon city presentation tokens for Game Pack 001.",
  layer: "game",
  supportedEngineIds: [THEME_ROUTERUN_ENGINE_ID],
  supportedGameIds: [THEME_NIGHT_DROP_GAME_ID],
  incompatibleGameIds: [],
  incompatibleThemeIds: [],
  tokens: {
    colors: {
      accent: "#92ff3e",
      "accent-soft": "#baff86",
      cyan: "#40f8ff",
      magenta: "#ff3ec8",
      amber: "#ffbd38",
      danger: "#ff516d",
      street: "#1d2740",
      "street-edge": "#354361",
      destination: "#ff3ec8",
      route: "#92ff3e",
      "route-visited": "#40f8ff",
    },
    effects: {
      "neon-glow": "0 0 18px rgba(146,255,62,.38)",
      "cyan-glow": "0 0 22px rgba(64,248,255,.34)",
      "panel-shadow": "0 26px 70px rgba(0,0,0,.46)",
      glass: "blur(18px)",
      "grid-opacity": "0.055",
    },
    components: {
      hud: { gap: "0.55rem", padding: "0.7rem", "value-size": "1rem" },
      board: { gap: "0.38rem", padding: "0.75rem", "cell-radius": "0.72rem" },
      button: { radius: "999px", tracking: "0.12em" },
      panel: { padding: "1rem", radius: "1rem" },
    },
    route: { width: "0.18rem", "highlight-opacity": "0.92", "inactive-opacity": "0.36" },
    animation: { "dash-step": "360ms", collect: "280ms", clamp: "520ms", expansion: "600ms" },
  },
  aliases: {
    "brand.primary": "colors.accent",
    "brand.secondary": "colors.cyan",
    "brand.feature": "colors.magenta",
    "feedback.warning": "colors.amber",
    "feedback.danger": "colors.danger",
    "route.active": "colors.route",
    "route.visited": "colors.route-visited",
    "hud.gap": "components.hud.gap",
    "hud.padding": "components.hud.padding",
  },
  assetAliases: {
    "character.runner": NIGHT_DROP_ASSET_IDS.dash,
    "character.enforcement": NIGHT_DROP_ASSET_IDS.clamp,
    "board.street": NIGHT_DROP_ASSET_IDS.street,
    "board.destination": NIGHT_DROP_ASSET_IDS.destination,
    "collectable.tip": NIGHT_DROP_ASSET_IDS.tip,
    "collectable.package": NIGHT_DROP_ASSET_IDS.package,
    "effect.ambient": NIGHT_DROP_ASSET_IDS.neon,
    "effect.shortcut": NIGHT_DROP_ASSET_IDS.shortcut,
  },
  metadata: {
    gamePack: "night-drop",
    commercialGamePackNumber: 1,
    manifestEngineId: String(NIGHT_DROP_ENGINE_ID),
    manifestGameId: String(NIGHT_DROP_GAME_ID),
  },
};

export function createNightDropThemeRuntime(): { readonly registry: ThemeRegistry; readonly runtime: ThemeRuntime; readonly theme: ResolvedTheme } {
  const registry = new ThemeRegistry();
  registry.registerMany([NightDropFoundationTheme, NightDropTheme]);
  const runtime = new ThemeRuntime(registry);
  const theme = runtime.activate({
    engineId: THEME_ROUTERUN_ENGINE_ID,
    gameId: THEME_NIGHT_DROP_GAME_ID,
    base: NIGHT_DROP_FOUNDATION_THEME_ID,
    game: NIGHT_DROP_THEME_ID,
  });
  return { registry, runtime, theme };
}

export function applyNightDropTheme(root: HTMLElement, theme: ResolvedTheme): void {
  for (const [path, value] of Object.entries(theme.flatTokens)) {
    root.style.setProperty(`--nd-${path.replaceAll(".", "-")}`, String(value));
  }
  for (const [alias, value] of Object.entries(theme.resolvedAliases)) {
    root.style.setProperty(`--nd-alias-${alias.replaceAll(".", "-")}`, String(value));
  }
  root.dataset.theme = String(NIGHT_DROP_THEME_ID);
}
