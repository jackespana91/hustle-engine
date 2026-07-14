export type NightDropPlaybackMode = "normal" | "turbo" | "reduced-motion";

export type NightDropPresentationPhase =
  | "entry"
  | "ready"
  | "round-start"
  | "route-preview"
  | "dash-entry"
  | "standard-package"
  | "five-star-upgrade"
  | "shortcut-preview"
  | "shortcut-entry"
  | "shortcut-exit"
  | "clamp-anticipation"
  | "clamp-scan"
  | "clamp-escape"
  | "expansion-tease"
  | "expansion-unlock"
  | "route-run"
  | "cascade-clear"
  | "cascade-refill"
  | "continuation-preview"
  | "continuation-run"
  | "destination-arrival"
  | "final-delivery"
  | "win-celebration"
  | "complete"
  | "interrupted"
  | "recovering";

export type DashPresentationState =
  | "idle"
  | "route-ready"
  | "moving"
  | "collecting"
  | "shortcut"
  | "clamp-reaction"
  | "arriving"
  | "celebrating";

export type NightDropWinTier = "none" | "standard" | "big" | "premium";

export interface NightDropPresentationEvent {
  readonly sequence: number;
  readonly phase: NightDropPresentationPhase;
  readonly feature: string | null;
  readonly durationMs: number;
  readonly audioCue: string | null;
}

export interface NightDropPresentationAsset {
  readonly alias: string;
  readonly logicalId: string;
  readonly status: "production-raster" | "temporary-vector" | "temporary-css" | "placeholder-audio";
}

export const PREMIUM_SHOWCASE_PHASE_ORDER: readonly NightDropPresentationPhase[] = [
  "round-start",
  "route-preview",
  "dash-entry",
  "standard-package",
  "five-star-upgrade",
  "shortcut-preview",
  "shortcut-entry",
  "shortcut-exit",
  "clamp-anticipation",
  "clamp-scan",
  "clamp-escape",
  "expansion-tease",
  "expansion-unlock",
  "route-run",
  "cascade-clear",
  "cascade-refill",
  "continuation-preview",
  "continuation-run",
  "destination-arrival",
  "final-delivery",
  "win-celebration",
  "complete",
] as const;

export const NIGHT_DROP_PHASE_TIMINGS: Readonly<Record<NightDropPresentationPhase, number>> = {
  entry: 1200,
  ready: 0,
  "round-start": 560,
  "route-preview": 1250,
  "dash-entry": 520,
  "standard-package": 560,
  "five-star-upgrade": 1250,
  "shortcut-preview": 900,
  "shortcut-entry": 1600,
  "shortcut-exit": 750,
  "clamp-anticipation": 1100,
  "clamp-scan": 1600,
  "clamp-escape": 1100,
  "expansion-tease": 1000,
  "expansion-unlock": 1800,
  "route-run": 320,
  "cascade-clear": 1200,
  "cascade-refill": 1600,
  "continuation-preview": 900,
  "continuation-run": 300,
  "destination-arrival": 1300,
  "final-delivery": 1200,
  "win-celebration": 3000,
  complete: 0,
  interrupted: 0,
  recovering: 260,
};

export const NIGHT_DROP_AUDIO_TIMING_MAP = {
  "round-start": "audio.night-drop.music.loop",
  "route-preview": "audio.night-drop.sfx.route-preview",
  "dash-entry": "audio.night-drop.sfx.movement",
  "standard-package": "audio.night-drop.sfx.package",
  "five-star-upgrade": "audio.night-drop.sfx.five-star",
  "shortcut-entry": "audio.night-drop.sfx.shortcut",
  "clamp-scan": "audio.night-drop.sfx.clamp",
  "expansion-unlock": "audio.night-drop.sfx.expansion",
  "cascade-clear": "audio.night-drop.sfx.cascade",
  "destination-arrival": "audio.night-drop.sfx.destination",
  "win-celebration": "audio.night-drop.sfx.win-premium",
} as const;

export const NIGHT_DROP_PRESENTATION_ASSETS: readonly NightDropPresentationAsset[] = [
  { alias: "brand.logo", logicalId: "brand.night-drop.logo", status: "production-raster" },
  { alias: "character.runner", logicalId: "character.dash", status: "production-raster" },
  { alias: "character.dispatch", logicalId: "character.mara", status: "production-raster" },
  { alias: "character.enforcement", logicalId: "character.clamp", status: "production-raster" },
  { alias: "board.street", logicalId: "tile.street", status: "production-raster" },
  { alias: "board.destination", logicalId: "tile.destination", status: "production-raster" },
  { alias: "collectable.package", logicalId: "overlay.package", status: "temporary-vector" },
  { alias: "collectable.tip", logicalId: "overlay.tip", status: "temporary-vector" },
  { alias: "effect.ambient", logicalId: "effect.neon", status: "production-raster" },
  { alias: "effect.shortcut", logicalId: "effect.shortcut", status: "temporary-css" },
  { alias: "effect.route-trace", logicalId: "effect.route-trace", status: "temporary-css" },
  { alias: "effect.clamp-warning", logicalId: "effect.clamp-warning", status: "temporary-css" },
  { alias: "effect.expansion", logicalId: "effect.expansion", status: "temporary-css" },
  { alias: "effect.cascade", logicalId: "effect.cascade", status: "temporary-css" },
  { alias: "effect.destination", logicalId: "effect.destination", status: "temporary-css" },
  { alias: "effect.win", logicalId: "effect.win", status: "temporary-css" },
] as const;

const PHASE_FEATURES: Partial<Record<NightDropPresentationPhase, string>> = {
  "five-star-upgrade": "Five Star",
  "shortcut-preview": "Shortcut",
  "shortcut-entry": "Shortcut",
  "shortcut-exit": "Shortcut",
  "clamp-anticipation": "Clamp",
  "clamp-scan": "Clamp",
  "clamp-escape": "Clamp",
  "expansion-tease": "Penthouse Drop",
  "expansion-unlock": "Penthouse Drop",
  "cascade-clear": "Route continuation",
  "cascade-refill": "Route continuation",
  "continuation-preview": "Route continuation",
  "continuation-run": "Route continuation",
  "final-delivery": "Penthouse Drop",
};

export function featureForPhase(phase: NightDropPresentationPhase): string | null {
  return PHASE_FEATURES[phase] ?? null;
}

export function audioForPhase(phase: NightDropPresentationPhase): string | null {
  return NIGHT_DROP_AUDIO_TIMING_MAP[phase as keyof typeof NIGHT_DROP_AUDIO_TIMING_MAP] ?? null;
}

export function dashStateForPhase(phase: NightDropPresentationPhase): DashPresentationState {
  if (phase === "route-preview" || phase === "ready") return "route-ready";
  if (phase === "standard-package" || phase === "five-star-upgrade" || phase === "final-delivery") return "collecting";
  if (phase.startsWith("shortcut")) return "shortcut";
  if (phase.startsWith("clamp")) return "clamp-reaction";
  if (phase === "destination-arrival") return "arriving";
  if (phase === "win-celebration" || phase === "complete") return "celebrating";
  if (["dash-entry", "route-run", "continuation-run"].includes(phase)) return "moving";
  return "idle";
}

export function winTierFor(amountMinor: number, betMinor: number): NightDropWinTier {
  if (amountMinor <= 0 || betMinor <= 0) return "none";
  const multiple = amountMinor / betMinor;
  if (multiple >= 10) return "premium";
  if (multiple >= 5) return "big";
  return "standard";
}
