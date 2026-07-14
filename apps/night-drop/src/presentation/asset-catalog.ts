import type { DashPresentationState, NightDropPresentationPhase } from "./presentation-model.js";

const asset = (path: string): string => `/assets/night-drop/${path}`;

export const NIGHT_DROP_PRODUCTION_ASSETS = {
  brand: {
    compactLogo: asset("brand/logo-compact.png"),
  },
  environment: {
    portrait: asset("environment/glasshouse-portrait.png"),
    landscape: asset("environment/glasshouse-landscape.png"),
  },
  characters: {
    dash: {
      idle: asset("characters/dash/idle.png"),
      neutral: asset("characters/dash/neutral.png"),
      smug: asset("characters/dash/smug.png"),
      startled: asset("characters/dash/startled.png"),
      delighted: asset("characters/dash/delighted.png"),
      run: asset("characters/dash/run.png"),
    },
    mara: {
      neutral: asset("characters/mara/neutral.png"),
      warning: asset("characters/mara/warning.png"),
      amused: asset("characters/mara/amused.png"),
    },
    clamp: {
      authority: asset("characters/clamp/authority.png"),
      scanner: asset("characters/clamp/scanner.png"),
      defeated: asset("characters/clamp/defeated.png"),
    },
  },
  tiles: {
    blocked: asset("tiles/blocked.png"),
    bonus: asset("tiles/bonus.png"),
    "bonus-active": asset("tiles/bonus-active.png"),
    delivery: asset("tiles/delivery.png"),
    "delivery-active": asset("tiles/delivery-active.png"),
    empty: asset("tiles/empty.png"),
    enforcement: asset("tiles/enforcement.png"),
    kiosk: asset("tiles/kiosk.png"),
    legal: asset("tiles/legal.png"),
    "legal-active": asset("tiles/legal-active.png"),
    spawn: asset("tiles/spawn.png"),
    tram: asset("tiles/tram.png"),
  },
} as const;

export type NightDropTileAsset = keyof typeof NIGHT_DROP_PRODUCTION_ASSETS.tiles;

export function dashAssetForState(state: DashPresentationState): string {
  switch (state) {
    case "moving": return NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.run;
    case "clamp-reaction": return NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.startled;
    case "collecting":
    case "arriving":
    case "celebrating": return NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.delighted;
    case "route-ready": return NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.idle;
    case "shortcut": return NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.smug;
    default: return NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.neutral;
  }
}

export function maraAssetForPhase(phase: NightDropPresentationPhase): string {
  if (phase.startsWith("clamp") || phase === "interrupted" || phase === "recovering") {
    return NIGHT_DROP_PRODUCTION_ASSETS.characters.mara.warning;
  }
  if (["final-delivery", "win-celebration", "complete"].includes(phase)) {
    return NIGHT_DROP_PRODUCTION_ASSETS.characters.mara.amused;
  }
  return NIGHT_DROP_PRODUCTION_ASSETS.characters.mara.neutral;
}

export function clampAssetForPhase(phase: NightDropPresentationPhase): string {
  if (phase === "clamp-scan") return NIGHT_DROP_PRODUCTION_ASSETS.characters.clamp.scanner;
  if (phase === "clamp-escape") return NIGHT_DROP_PRODUCTION_ASSETS.characters.clamp.defeated;
  return NIGHT_DROP_PRODUCTION_ASSETS.characters.clamp.authority;
}

export function tileAsset(tile: NightDropTileAsset): string {
  return NIGHT_DROP_PRODUCTION_ASSETS.tiles[tile];
}
