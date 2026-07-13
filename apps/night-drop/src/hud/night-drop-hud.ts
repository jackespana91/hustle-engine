import type { NightDropRuntimeView } from "../runtime/night-drop-game.js";

export function renderNightDropHud(view: NightDropRuntimeView): string {
  const stars = Array.from({ length: 5 }, (_, index) => `<span class="star" data-active="${index < view.fiveStar}">★</span>`).join("");
  return `
    <div class="hud-item"><span>Balance</span><strong>${money(view.balanceMinor)}</strong></div>
    <div class="hud-item"><span>Bet</span><strong>${money(view.betMinor)}</strong></div>
    <div class="hud-item hud-win"><span>Win</span><strong>${money(view.winMinor)}</strong></div>
    <div class="hud-item hud-stars"><span>Five Star Meter</span><strong aria-label="${view.fiveStar} out of 5 stars">${stars}</strong></div>
    <div class="hud-item"><span>Priority Jobs</span><strong>${view.priorityJobs}</strong></div>
    <div class="hud-item"><span>Current Route</span><strong>${view.inspection.completedRouteSteps.length}/${view.inspection.preview?.steps.length ?? 0}</strong></div>
    <div class="hud-item"><span>Multiplier</span><strong>${view.multiplier.toFixed(1)}×</strong></div>`;
}

export function money(minor: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
}
