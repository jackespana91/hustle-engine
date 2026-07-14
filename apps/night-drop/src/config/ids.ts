import {
  assetFileId,
  assetManifestId,
  audioManifestId,
  featureManifestId,
  gameManifestId,
  mathManifestId,
  themeManifestId,
} from "@hustle/core";
import { ROUTERUN_ENGINE_ID } from "@hustle/routerun";

export const NIGHT_DROP_GAME_ID = gameManifestId("game.night-drop");
export const NIGHT_DROP_ENGINE_ID = ROUTERUN_ENGINE_ID;
export const NIGHT_DROP_THEME_ID = themeManifestId("night-drop-theme");
export const NIGHT_DROP_FOUNDATION_THEME_ID = themeManifestId("night-drop-foundation-theme");
export const NIGHT_DROP_ASSET_MANIFEST_ID = assetManifestId("assets.night-drop");
export const NIGHT_DROP_AUDIO_MANIFEST_ID = audioManifestId("audio.night-drop");
export const NIGHT_DROP_MATH_MANIFEST_ID = mathManifestId("math.night-drop.external");

export const NIGHT_DROP_FEATURE_IDS = {
  shortcut: featureManifestId("feature.night-drop.shortcut"),
  fiveStar: featureManifestId("feature.night-drop.five-star"),
  clamp: featureManifestId("feature.night-drop.clamp"),
  priorityJobs: featureManifestId("feature.night-drop.priority-jobs"),
  penthouseDrop: featureManifestId("feature.night-drop.penthouse-drop"),
} as const;

export const NIGHT_DROP_ASSET_IDS = {
  dash: assetFileId("character.dash"),
  mara: assetFileId("character.mara"),
  clamp: assetFileId("character.clamp"),
  street: assetFileId("tile.street"),
  destination: assetFileId("tile.destination"),
  tip: assetFileId("overlay.tip"),
  package: assetFileId("overlay.package"),
  neon: assetFileId("effect.neon"),
  shortcut: assetFileId("effect.shortcut"),
  routeTrace: assetFileId("effect.route-trace"),
  packagePickup: assetFileId("effect.package-pickup"),
  fiveStar: assetFileId("effect.five-star"),
  clampWarning: assetFileId("effect.clamp-warning"),
  expansion: assetFileId("effect.expansion"),
  cascade: assetFileId("effect.cascade"),
  destinationArrival: assetFileId("effect.destination"),
  win: assetFileId("effect.win"),
} as const;
