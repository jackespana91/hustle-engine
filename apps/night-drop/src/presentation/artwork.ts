import {
  NIGHT_DROP_PRODUCTION_ASSETS,
  clampAssetForPhase,
  dashAssetForState,
  maraAssetForPhase,
  tileAsset,
  type NightDropTileAsset,
} from "./asset-catalog.js";
import type { DashPresentationState, NightDropPresentationPhase } from "./presentation-model.js";

export function renderNightDropLogo(): string {
  return `<img class="night-drop-logo production-logo" src="${NIGHT_DROP_PRODUCTION_ASSETS.brand.compactLogo}" data-asset-alias="brand.logo" alt="Night Drop" draggable="false">`;
}

export function renderEnvironmentArtwork(surface: "entry" | "stage"): string {
  return `<picture class="environment-art environment-art-${surface}" data-asset-alias="effect.ambient">
    <source media="(orientation: portrait)" srcset="${NIGHT_DROP_PRODUCTION_ASSETS.environment.portrait}">
    <img src="${NIGHT_DROP_PRODUCTION_ASSETS.environment.landscape}" alt="" draggable="false">
  </picture>`;
}

export function renderMaraArtwork(phase: NightDropPresentationPhase): string {
  return `<img class="mara-art production-character" src="${maraAssetForPhase(phase)}" data-asset-alias="character.dispatch" alt="Mara, Night Drop dispatcher" draggable="false">`;
}

export function renderDashArtwork(state: DashPresentationState): string {
  return `<img class="dash-art production-character" src="${dashAssetForState(state)}" data-dash-state="${state}" data-asset-alias="character.runner" alt="Dash, Night Drop courier" draggable="false">`;
}

export function renderClampArtwork(phase: NightDropPresentationPhase): string {
  return `<img class="clamp-art production-character" src="${clampAssetForPhase(phase)}" data-asset-alias="character.enforcement" alt="Clamp, overzealous city enforcement officer" draggable="false">`;
}

export function renderBoardTileArtwork(tile: NightDropTileAsset): string {
  return `<img class="board-tile-art" src="${tileAsset(tile)}" data-tile-art="${tile}" alt="" draggable="false">`;
}

export function renderPackageArtwork(kind: "standard" | "premium" | "mystery"): string {
  const label = kind === "premium" ? "Premium package" : kind === "mystery" ? "Mystery package" : "Package";
  return `<svg class="package-art package-${kind}" data-asset-alias="collectable.package" viewBox="0 0 64 64" role="img" aria-label="${label}">
    <path class="package-shadow" d="m8 46 25 14 25-14-25-8Z"/>
    <path class="package-box" d="M7 18 32 5l25 13v31L32 62 7 49Z"/>
    <path class="package-top" d="M7 18 32 5l25 13-25 14Z"/>
    <path class="package-side" d="m32 32 25-14v31L32 62Z"/>
    <path class="package-fold" d="M7 18 32 32l25-14M32 32v30M19 12l25 14"/>
    <path class="package-tape" d="m24 9 25 13-8 5-25-13Z"/>
    ${kind === "premium" ? `<path class="package-star" d="m32 15 4 8 9 1-7 7 2 10-8-5-9 5 2-10-7-7 10-1Z"/>` : ""}
    ${kind === "mystery" ? `<path class="package-question" d="M25 28c1-9 16-9 16 0 0 7-9 5-9 13m0 7v2"/>` : ""}
  </svg>`;
}

export function renderDestinationArtwork(): string {
  return `<svg class="destination-art" data-asset-alias="board.destination" viewBox="0 0 86 86" role="img" aria-label="Penthouse destination">
    <path class="destination-halo" d="M43 3 79 25v39L43 84 7 64V25Z"/>
    <path class="destination-building" d="M16 75V30h16V16h25v22h15v37Z"/>
    <path class="destination-roof" d="m25 20 19-13 20 13"/>
    <path class="destination-windows" d="M25 39h8v8h-8Zm15 0h8v8h-8Zm15 0h8v8h-8ZM25 55h8v8h-8Zm15 0h9v20h-9Zm16 0h8v8h-8Z"/>
    <path class="destination-helipad" d="M34 22h20M44 16v13"/>
    <path class="destination-beacon" d="M44 6V0M31 10l-6-6m32 6 6-6"/>
  </svg>`;
}
