import { installHustleDebugPanel, type HustleDebugPanel } from "@hustle/core";
import type { BoardCell } from "@hustle/routerun";
import { NIGHT_DROP_ASSET_MANIFEST, NIGHT_DROP_AUDIO_MANIFEST, NIGHT_DROP_GAME_MANIFEST } from "./config/manifests.js";
import { NIGHT_DROP_CHARACTERS } from "./characters/characters.js";
import { NIGHT_DROP_SCENARIOS } from "./board/night-drop-board.js";
import { NIGHT_DROP_OUTCOMES } from "./outcomes/night-drop-outcomes.js";
import { renderNightDropHud } from "./hud/night-drop-hud.js";
import { NightDropGame, type NightDropRuntimeView } from "./runtime/night-drop-game.js";
import { applyNightDropTheme, createNightDropThemeRuntime } from "./theme/night-drop-theme.js";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Night Drop requires #app");
const { theme } = createNightDropThemeRuntime();
applyNightDropTheme(document.documentElement, theme);

const game = new NightDropGame();
let debugPanel: HustleDebugPanel | null = null;
let lastEvent = "";

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "play") void game.play();
  else if (action === "pause") game.pause();
  else if (action === "resume") game.resume();
  else if (action === "interrupt") game.interrupt();
  else if (action === "recover") void game.recover();
  else if (action === "replay") void game.replay();
  else if (action === "debug") debugPanel?.toggle();
});
root.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-outcome]");
  if (select) game.select(select.value);
});

game.subscribe((view) => {
  render(view);
  const latest = view.inspection.latestEvent;
  if (latest && latest !== lastEvent) {
    lastEvent = latest;
    debugPanel?.recordEvent(latest, { logicalTick: view.inspection.logicalTick, scenario: view.scenario.id });
  }
});

debugPanel = installHustleDebugPanel({
  title: "NIGHT DROP DEBUG",
  initiallyOpen: false,
  getState: () => {
    const view = game.view();
    return {
      currentState: view.lifecycle,
      currentRound: `night-drop.round.${view.scenario.id}`,
      currentEvent: view.inspection.latestEvent,
      currentAnimation: view.lifecycle === "presenting" ? "character.dash.route-step" : null,
      animationQueueLength: Math.max(0, (view.inspection.preview?.steps.length ?? 0) - view.inspection.completedRouteSteps.length),
      currentSnapshot: null,
      lastSave: view.lastSave,
      recoveryVersion: 1,
      transitionHistory: view.transitions,
      animationCount: view.inspection.animationCommands.length,
      commandsExecuted: view.inspection.completedRouteSteps.length,
      recoveryCount: view.recoveryCount,
    };
  },
  actions: {
    pause: () => game.pause(),
    resume: () => game.resume(),
    skip: () => game.skip(),
    skipAll: () => game.skipAll(),
    replayLastRound: () => game.replay(),
    interrupt: () => game.interrupt(),
    recover: () => game.recover(),
    reset: () => game.reset(true),
    simulateCrash: () => { game.interrupt(); },
    generateSmallRound: () => selectAndPlay("tiny-route"),
    generateMediumRound: () => selectAndPlay("long-route"),
    generateHugeRound: () => selectAndPlay("perfect-route"),
    generateBadRound: () => selectAndPlay("dead-end"),
    generateAnimationFailure: () => selectAndPlay("clamp"),
    generateRecoveryTest: () => selectAndPlay("interrupted-route"),
  },
  routerun: { getState: () => game.debugRouteState() },
});
debugPanel.recordEvent("night-drop:ready", {
  gameManifest: NIGHT_DROP_GAME_MANIFEST.id,
  assets: NIGHT_DROP_ASSET_MANIFEST.files.length,
  audioPlaceholders: NIGHT_DROP_AUDIO_MANIFEST.soundEffects.length,
  outcomes: NIGHT_DROP_OUTCOMES.length,
});

async function selectAndPlay(id: string): Promise<void> {
  game.select(id);
  await game.play();
}

function render(view: NightDropRuntimeView): void {
  const board = view.inspection.board;
  const routeKeys = new Set(view.inspection.preview?.steps.map(({ coordinate }) => `${coordinate.row}:${coordinate.column}`) ?? []);
  const visitedKeys = new Set(view.inspection.completedRouteSteps.map(({ coordinate }) => `${coordinate.row}:${coordinate.column}`));
  const collected = new Set(view.inspection.collectedOverlays.map(({ overlayId }) => overlayId));
  const runnerKey = view.inspection.runner ? `${view.inspection.runner.currentCoordinate.row}:${view.inspection.runner.currentCoordinate.column}` : "";
  const cells = board?.cells.map((cell) => renderCell(cell, routeKeys, visitedKeys, runnerKey, collected)).join("") ?? "";
  const activeFeatures = view.scenario.activeFeatures.map((id) => `<span>${featureLabel(id)}</span>`).join("") || "<span>Base route</span>";
  const options = NIGHT_DROP_SCENARIOS.map((scenario) => `<option value="${scenario.id}" ${scenario.id === view.scenario.id ? "selected" : ""}>${scenario.name}</option>`).join("");
  const showClamp = view.scenario.activeFeatures.includes("feature.night-drop.clamp") && view.lifecycle !== "idle";
  root!.innerHTML = `
    <main class="game-shell" data-state="${view.lifecycle}">
      <header class="topbar">
        <div class="brand-lockup"><span class="eyebrow">HUSTLE LABS · GAME PACK 001</span><h1>NIGHT <i>DROP</i></h1></div>
        <div class="top-actions">
          <label class="outcome-picker"><span>Outcome Studio</span><select data-outcome aria-label="Choose predetermined outcome">${options}</select></label>
          <button class="icon-button" data-action="debug" aria-label="Open debug panel">⌘⇧D</button>
        </div>
      </header>
      <section class="hud" aria-label="Hustle Core HUD">${renderNightDropHud(view)}</section>
      <section class="play-layout">
        <aside class="dispatch-card">
          <span class="status-dot"></span><p class="eyebrow">MARA · DISPATCH</p>
          <blockquote>${view.message}</blockquote>
          <div class="feature-chips">${activeFeatures}</div>
          <dl><div><dt>Engine</dt><dd>RouteRun 001</dd></div><div><dt>Board</dt><dd>5×5</dd></div><div><dt>Outcome</dt><dd>${view.scenario.name}</dd></div></dl>
        </aside>
        <section class="city-stage" aria-label="Night Drop RouteRun board">
          <div class="city-grid" aria-hidden="true"></div>
          <div class="board-wrap">
            <div class="board" role="grid" aria-label="5 by 5 delivery route">${cells}</div>
            <div class="board-caption"><span>${view.scenario.name}</span><strong>${view.scenario.tagline}</strong></div>
          </div>
          <div class="dash-card character-card"><span class="character-avatar">D</span><div><strong>DASH</strong><small>Runner · questionable navigator</small></div></div>
          ${showClamp ? `<div class="clamp-card character-card"><span class="character-avatar">C</span><div><strong>CLAMP</strong><small>Enforcement · paperwork enthusiast</small></div></div>` : ""}
        </section>
        <aside class="round-card">
          <p class="eyebrow">LIVE ROUTE</p><h2>${view.scenario.name}</h2><p>${view.scenario.tagline}</p>
          <div class="route-progress"><span style="--progress:${progress(view)}%"></span></div>
          <div class="round-stats"><div><span>Packages</span><strong>${view.inspection.collectedOverlays.length}</strong></div><div><span>Expansion</span><strong>${view.inspection.activeExpansions.length}/1</strong></div><div><span>Continuation</span><strong>${view.inspection.completedCascades.length}/1</strong></div></div>
          <div class="primary-controls">
            <button class="play-button" data-action="play" ${view.lifecycle === "presenting" ? "disabled" : ""}><span>▶</span> PLAY</button>
            <button data-action="replay">Replay</button><button data-action="interrupt" ${view.lifecycle !== "presenting" ? "disabled" : ""}>Interrupt</button>
            <button data-action="recover" ${view.canRecover ? "" : "disabled"}>Recover</button>
          </div>
          <div class="secondary-controls"><button data-action="pause" ${view.paused ? "disabled" : ""}>Pause</button><button data-action="resume" ${view.paused ? "" : "disabled"}>Resume</button></div>
        </aside>
      </section>
      <footer><span>PREDETERMINED DEMO OUTCOMES · NO PRODUCTION MATHS</span><span>Theme ${theme.hash.slice(0, 8)} · ${NIGHT_DROP_CHARACTERS.length} presentation characters · ${NIGHT_DROP_OUTCOMES.length} outcomes</span></footer>
    </main>`;
}

function renderCell(cell: BoardCell, route: Set<string>, visited: Set<string>, runner: string, collected: Set<string>): string {
  const key = `${cell.coordinate.row}:${cell.coordinate.column}`;
  const destination = cell.tile?.family === "destination";
  const remainingOverlays = cell.overlays.filter(({ id }) => !collected.has(id));
  return `<div class="board-cell" role="gridcell" data-state="${cell.state}" data-route="${route.has(key)}" data-visited="${visited.has(key)}" data-destination="${destination}" aria-label="Cell ${key}${destination ? ", destination" : ""}">
    ${cell.tile ? `<span class="road-line"></span>` : ""}
    ${remainingOverlays.length ? `<span class="package" title="Package">◆</span>` : ""}
    ${destination ? `<span class="destination">⌂</span>` : ""}
    ${runner === key ? `<span class="runner" title="Dash">D</span>` : ""}
  </div>`;
}

function featureLabel(id: string): string {
  return id.split(".").at(-1)?.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? id;
}

function progress(view: NightDropRuntimeView): number {
  const total = view.inspection.preview?.steps.length ?? 0;
  return total === 0 ? 0 : Math.min(100, Math.round((view.inspection.completedRouteSteps.length / total) * 100));
}
