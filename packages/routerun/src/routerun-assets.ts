export const ROUTERUN_ASSET_ALIASES = {
  "routerun.tile.straight": "routerun.tile.straight",
  "routerun.tile.bend": "routerun.tile.bend",
  "routerun.tile.junction": "routerun.tile.junction",
  "routerun.tile.destination": "routerun.tile.destination",
  "routerun.runner.default": "routerun.runner.default",
  "routerun.overlay.standard": "routerun.overlay.standard",
  "routerun.overlay.premium": "routerun.overlay.premium",
  "routerun.effect.route-highlight": "routerun.effect.route-highlight",
} as const;

export const ROUTERUN_DIAGNOSTIC_THEME = {
  id: "theme.routerun-diagnostic",
  name: "RouteRun Diagnostic",
  production: false,
  tokens: {
    boardBackground: "#0a111b",
    activeCell: "#18314a",
    emptyCell: "#111b27",
    sealedCell: "#29303d",
    blockedCell: "#3b2029",
    route: "#5ce1c1",
    visited: "#f2bf63",
    runner: "#ffffff",
    destination: "#9b8cff",
    overlay: "#ff8ab3",
  },
  symbols: { runner: "●", destination: "◆", overlay: "+", blocker: "×", sealed: "▧" },
  assetAliases: ROUTERUN_ASSET_ALIASES,
} as const;
