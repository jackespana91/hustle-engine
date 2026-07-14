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
      "ink-deep": "#03050b",
      panel: "#0e1220",
      "panel-raised": "#151b2e",
      text: "#f5f7ff",
      "text-muted": "#8e99b8",
      line: "#27304a",
      "line-soft": "#1c2338",
      "off-white": "#fff8e8",
      asphalt: "#090d17",
      smoke: "#11182a",
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
      accent: "#ffd21c",
      "accent-hot": "#fff16a",
      "accent-soft": "#ffe58c",
      cyan: "#40f8ff",
      "cyan-soft": "#9ffcff",
      magenta: "#ff3ec8",
      "magenta-deep": "#8d175f",
      amber: "#ffbd38",
      danger: "#ff516d",
      violet: "#8a20ff",
      "cyan-deep": "#087e91",
      "green-deep": "#306b25",
      "blue-night": "#081d39",
      skin: "#d58f68",
      "skin-light": "#f0b087",
      "skin-shadow": "#9b5a4f",
      street: "#1d2740",
      "street-edge": "#354361",
      destination: "#ff3ec8",
      route: "#9b35ff",
      "route-visited": "#40f8ff",
    },
    effects: {
      "neon-glow": "0 0 18px rgba(255,210,28,.38)",
      "neon-glow-strong": "0 0 10px rgba(255,210,28,.65), 0 0 42px rgba(255,210,28,.38)",
      "cyan-glow": "0 0 22px rgba(64,248,255,.34)",
      "magenta-glow": "0 0 22px rgba(255,62,200,.4)",
      "danger-glow": "0 0 26px rgba(255,81,109,.48)",
      "panel-shadow": "0 26px 70px rgba(0,0,0,.46)",
      "panel-shadow-deep": "0 38px 100px rgba(0,0,0,.66)",
      glass: "blur(18px)",
      "grid-opacity": "0.055",
      "scan-opacity": "0.42",
      "stage-vignette": "inset 0 0 90px rgba(0,0,0,.56)",
      "win-glow": "0 0 42px rgba(255,210,28,.52)",
      "text-glow": "0 0 22px rgba(245,247,255,.24)",
    },
    components: {
      hud: { gap: "0.55rem", padding: "0.7rem", "value-size": "1rem" },
      board: { gap: "0.38rem", padding: "0.75rem", "cell-radius": "0.72rem" },
      button: { radius: "999px", tracking: "0.12em" },
      panel: { padding: "1rem", radius: "1rem" },
    },
    route: { width: "0.18rem", "highlight-opacity": "0.92", "inactive-opacity": "0.36" },
    animation: {
      "dash-step": "360ms",
      collect: "280ms",
      clamp: "520ms",
      expansion: "600ms",
      shortcut: "620ms",
      cascade: "760ms",
      celebration: "1250ms",
      "motion-ease": "cubic-bezier(.18,.82,.2,1)",
      "impact-ease": "cubic-bezier(.2,1.5,.3,1)",
    },
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
    "character.dispatch": NIGHT_DROP_ASSET_IDS.mara,
    "character.enforcement": NIGHT_DROP_ASSET_IDS.clamp,
    "board.street": NIGHT_DROP_ASSET_IDS.street,
    "board.destination": NIGHT_DROP_ASSET_IDS.destination,
    "collectable.tip": NIGHT_DROP_ASSET_IDS.tip,
    "collectable.package": NIGHT_DROP_ASSET_IDS.package,
    "effect.ambient": NIGHT_DROP_ASSET_IDS.neon,
    "effect.shortcut": NIGHT_DROP_ASSET_IDS.shortcut,
    "effect.route-trace": NIGHT_DROP_ASSET_IDS.routeTrace,
    "effect.package-pickup": NIGHT_DROP_ASSET_IDS.packagePickup,
    "effect.five-star": NIGHT_DROP_ASSET_IDS.fiveStar,
    "effect.clamp-warning": NIGHT_DROP_ASSET_IDS.clampWarning,
    "effect.expansion": NIGHT_DROP_ASSET_IDS.expansion,
    "effect.cascade": NIGHT_DROP_ASSET_IDS.cascade,
    "effect.destination": NIGHT_DROP_ASSET_IDS.destinationArrival,
    "effect.win": NIGHT_DROP_ASSET_IDS.win,
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
