import { renderNightDropLogo } from "../presentation/artwork.js";
import {
  interpretSpatialRunnerSwipe,
  type SpatialRouteObstacleAction,
  type SpatialRunnerCommandType,
  type SpatialRunnerPointerSample,
  type SpatialRunnerSnapshot,
} from "@hustle/routerun";
import { applyNightDropTheme, createNightDropThemeRuntime } from "../theme/night-drop-theme.js";
import { createNightDropRunnerPlan, type RunnerPhase, type RunnerTimelineBeat } from "./runner-plan.js";
import {
  DEFAULT_NIGHT_DROP_RUNNER_ROUTE,
  isNightDropRunnerRouteId,
  type NightDropRunnerRouteId,
} from "./runner-routes.js";
import { NightDropRunnerWorld } from "./runner-world.js";
import {
  NightDropRunnerFeedbackController,
  type NightDropRunnerFeedbackCue,
} from "./night-drop-runner-feedback.js";
import "./runner-spike.css";

const root = requiredElement<HTMLElement>("#app", document, "Night Drop runner spike requires #app");
const { theme } = createNightDropThemeRuntime();
applyNightDropTheme(document.documentElement, theme);

const query = new URLSearchParams(window.location.search);
const productionAssetsEnabled = query.get("assets") === "production";
const feedback = new NightDropRunnerFeedbackController();
const requestedRoute = query.get("route");
let plan = createNightDropRunnerPlan(isNightDropRunnerRouteId(requestedRoute) ? requestedRoute : DEFAULT_NIGHT_DROP_RUNNER_ROUTE);
const timers: number[] = [];
let playing = false;
let savedSnapshot: SpatialRunnerSnapshot | null = null;
let pointerStart: (SpatialRunnerPointerSample & { readonly pointerId: number }) | null = null;
let hasUsedSwipe = false;
let swipeCount = 0;

root.innerHTML = renderRunner();

const stage = requiredElement<HTMLElement>(".nr-stage", root, "Night Drop runner stage failed to mount");
const playButton = requiredElement<HTMLButtonElement>(".nr-play", root, "Night Drop runner Play control failed to mount");
const liveStatus = requiredElement<HTMLElement>(".nr-live-status", root, "Night Drop runner status failed to mount");
const worldCanvas = requiredElement<HTMLCanvasElement>(".nr-runner-world", root, "Night Drop runner world failed to mount");
const routeSelect = requiredElement<HTMLSelectElement>(".nr-route-select", root, "Night Drop route selector failed to mount");
const speedSelect = requiredElement<HTMLSelectElement>(".nr-speed-select", root, "Night Drop speed selector failed to mount");
const runnerViewport = requiredElement<HTMLElement>(".nr-viewport", root, "Night Drop runner viewport failed to mount");
let runnerWorld = createRunnerWorld();

playButton.addEventListener("click", startRound);
routeSelect.addEventListener("change", () => {
  if (isNightDropRunnerRouteId(routeSelect.value)) selectRoute(routeSelect.value);
});
root.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => button.addEventListener("pointerdown", () => executeInput(button.dataset.command as SpatialRunnerCommandType, "button")));
root.querySelectorAll<HTMLButtonElement>("[data-branch]").forEach((button) => button.addEventListener("pointerdown", () => chooseBranch(button.dataset.branch ?? "straight")));
requiredElement<HTMLButtonElement>("[data-lab-action='save']", root, "Snapshot control missing").addEventListener("pointerdown", saveSnapshot);
requiredElement<HTMLButtonElement>("[data-lab-action='interrupt']", root, "Interrupt control missing").addEventListener("pointerdown", interruptRound);
requiredElement<HTMLButtonElement>("[data-lab-action='recover']", root, "Recovery control missing").addEventListener("pointerdown", recoverRound);
window.addEventListener("keydown", handleKeyboardInput);
runnerViewport.addEventListener("pointerdown", handleRunnerPointerDown);
runnerViewport.addEventListener("pointerup", handleRunnerPointerUp);
runnerViewport.addEventListener("pointercancel", clearRunnerPointer);
window.addEventListener("beforeunload", () => {
  clearTimers();
  runnerWorld.dispose();
  feedback.dispose();
});

const requestedState = query.get("runnerState");
const requestedJunction = Number(query.get("junction"));
const requestedObstacle = Number(query.get("obstacle"));
if (query.has("junction") && Number.isSafeInteger(requestedJunction)) {
  showJunction(requestedJunction);
} else if (query.has("obstacle") && Number.isSafeInteger(requestedObstacle)) {
  showObstacle(requestedObstacle);
} else if (requestedState && requestedState !== "idle") {
  const beat = plan.timeline.find(({ phase }) => phase === requestedState);
  if (beat) applyBeat(beat, true);
} else {
  resetRound();
}

Object.assign(window, {
  __nightDropRunnerSpike: {
    get plan() { return plan; },
    routes: plan.availableRoutes,
    start: startRound,
    select: selectRoute,
    inspect: () => runnerWorld.inspect(),
    input: executeInput,
    branch: chooseBranch,
    junction: showJunction,
    obstacle: showObstacle,
    snapshot: () => runnerWorld.createSnapshot(),
    interrupt: interruptRound,
    recover: recoverRound,
    feedback: () => feedback.inspect(),
    show: (phase: RunnerPhase) => {
      const beat = plan.timeline.find((item) => item.phase === phase);
      if (beat) applyBeat(beat, true);
    },
  },
});

function renderRunner(): string {
  return `<main class="nr-stage" data-phase="idle" data-playing="false" data-swipe-used="false" aria-label="Night Drop cinematic runner presentation spike">
    <header class="nr-top-hud">
      <div class="nr-logo">${renderNightDropLogo()}</div>
      <div class="nr-top-value nr-reputation"><span>Five-Star</span><strong data-reputation>○○○○○</strong></div>
      <div class="nr-top-value"><span>Priority</span><strong><b data-priority>0</b>/3</strong></div>
      <div class="nr-top-value nr-multiplier"><span>Route</span><strong data-multiplier>1.0×</strong></div>
      <div class="nr-progress" aria-label="Delivery route progress"><i data-progress></i><b data-progress-label>0m / ${Math.round(plan.spatialRoute.totalLength)}m</b></div>
    </header>

    <section class="nr-viewport">
      <div class="nr-world" aria-hidden="true">
        <canvas class="nr-runner-world"></canvas>
        <div class="nr-camera-vignette"></div>
      </div>

      <div class="nr-establishing"><span>GLASSHOUSE HEIGHTS</span><strong>01:14</strong><b>DELIVERY 07</b></div>
      <div class="nr-moment"><span data-moment-kicker>ROUTE</span><strong data-moment>Waiting for address</strong></div>
      <div class="nr-junction-warning" data-junction-warning></div>
      <div class="nr-obstacle-warning" data-obstacle-warning></div>
      <div class="nr-obstacle-result" data-obstacle-result></div>
      <div class="nr-swipe-hint" data-swipe-hint><b>SWIPE TO MOVE</b><span>← LANE · ↑ JUMP · ↓ SLIDE · LANE →</span></div>
      <div class="nr-live-status" aria-live="polite">Ready for one deterministic delivery</div>
      <label class="nr-route-picker">
        <span>Delivery route</span>
        <select class="nr-route-select" aria-label="Choose delivery route">
          ${plan.availableRoutes.map((route) => `<option value="${route.id}"${route.id === plan.routeId ? " selected" : ""}>${route.label} · ${Math.round(route.distance)}m</option>`).join("")}
        </select>
        <select class="nr-speed-select" aria-label="Route test speed">
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
        <b data-route-meta>${plan.routeDifficulty} · ${formatDuration(plan.durationMs)}</b>
      </label>
      <div class="nr-input-pad" aria-label="Runner controls">
        <button type="button" data-command="dodge-left"><i>←</i><span>Left</span></button>
        <button type="button" data-command="jump"><i>↑</i><span>Jump</span></button>
        <button type="button" data-command="slide"><i>↓</i><span>Slide</span></button>
        <button type="button" data-command="dodge-right"><i>→</i><span>Right</span></button>
      </div>
      <div class="nr-branch-choice" aria-label="Junction route choice">
        <span data-junction-prompt>JUNCTION · CHOOSE</span>
        <button type="button" data-branch="left" aria-pressed="false">← Left</button>
        <button type="button" data-branch="straight" aria-pressed="false">↑ Straight</button>
        <button type="button" data-branch="right" aria-pressed="false">Right →</button>
      </div>
      <div class="nr-recovery-controls" aria-label="Route test recovery controls">
        <button type="button" data-lab-action="save">Save</button>
        <button type="button" data-lab-action="interrupt">Pause</button>
        <button type="button" data-lab-action="recover">Recover</button>
      </div>
      <div class="nr-win-card">
        <span>DELIVERY COMPLETE</span>
        <strong>€24.00</strong>
        <b>24.0×</b>
      </div>
    </section>

    <footer class="nr-bottom-hud">
      <div class="nr-wallet"><span>Balance</span><strong data-balance>€100.00</strong></div>
      <div class="nr-wallet"><span>Bet</span><strong>€1.00</strong></div>
      <div class="nr-wallet nr-win"><span>Win</span><strong data-win>€0.00</strong></div>
      <div class="nr-controls">
        <button class="nr-small" type="button"><i>☰</i><span>Menu</span></button>
        <button class="nr-play" type="button"><i>▶</i><strong>PLAY</strong><small>€1 DELIVERY</small></button>
        <button class="nr-small" type="button"><i>⚡</i><span>Turbo</span></button>
      </div>
    </footer>
  </main>`;
}

function startRound(): void {
  if (playing) return;
  clearTimers();
  resetRound();
  savedSnapshot = null;
  playing = true;
  stage.dataset.playing = "true";
  playButton.disabled = true;
  routeSelect.disabled = true;
  speedSelect.disabled = true;
  setText("[data-balance]", "€99.00");
  void feedback.unlock().then(() => feedback.cue("round-start"));
  runnerWorld.start(currentSpeed());
  scheduleTimeline(0);
}

function resetRound(): void {
  playing = false;
  stage.dataset.phase = "idle";
  stage.dataset.playing = "false";
  stage.dataset.interrupted = "false";
  stage.dataset.snapshot = "";
  stage.dataset.branchChoice = "";
  stage.dataset.swipeUsed = String(hasUsedSwipe);
  stage.dataset.swipeCount = String(swipeCount);
  stage.style.setProperty("--route-progress", "0%");
  runnerWorld.reset();
  setText("[data-balance]", "€100.00");
  setText("[data-win]", "€0.00");
  setText("[data-reputation]", "○○○○○");
  setText("[data-priority]", "0");
  setText("[data-multiplier]", "1.0×");
  setText("[data-progress-label]", `0m / ${Math.round(plan.spatialRoute.totalLength)}m`);
  setText("[data-route-meta]", `${plan.routeDifficulty} · ${formatDuration(plan.durationMs)}`);
  setText("[data-moment-kicker]", "DELIVERY 07");
  setText("[data-moment]", "Glasshouse Heights");
  playButton.disabled = false;
  routeSelect.disabled = false;
  speedSelect.disabled = false;
  requiredElement<HTMLElement>(".nr-play strong", playButton, "Play label missing").textContent = "PLAY";
  requiredElement<HTMLElement>(".nr-play small", playButton, "Play price missing").textContent = "€1 DELIVERY";
  liveStatus.textContent = "Ready for one deterministic delivery";
}

function applyBeat(beat: RunnerTimelineBeat, frozen: boolean): void {
  const phaseIndex = plan.timeline.findIndex(({ phase }) => phase === beat.phase);
  const displayedProgress = ["arrival", "delivery", "win", "resolved"].includes(beat.phase) ? 1 : beat.routeProgress;
  stage.dataset.phase = beat.phase;
  stage.dataset.playing = frozen ? "false" : "true";
  stage.style.setProperty("--route-progress", `${Math.round(displayedProgress * 100)}%`);
  setText("[data-progress-label]", `${Math.round(displayedProgress * plan.spatialRoute.totalLength)}m / ${Math.round(plan.spatialRoute.totalLength)}m`);
  setText("[data-moment]", beat.label);
  setText("[data-moment-kicker]", kickerFor(beat.phase));
  liveStatus.textContent = statusFor(beat.phase);
  if (frozen) runnerWorld.showAt(beat);
  updateRoundValues(beat.phase);
  const feedbackCue = feedbackCueForPhase(beat.phase);
  if (!frozen && feedbackCue) feedback.cue(feedbackCue);

  if (beat.phase === "resolved") {
    playing = false;
    stage.dataset.playing = "false";
    playButton.disabled = false;
    routeSelect.disabled = false;
    speedSelect.disabled = false;
    requiredElement<HTMLElement>(".nr-play strong", playButton, "Play label missing").textContent = "PLAY";
    requiredElement<HTMLElement>(".nr-play small", playButton, "Play price missing").textContent = "RUN AGAIN";
  } else if (frozen) {
    playButton.disabled = true;
  }

  stage.style.setProperty("--timeline-index", String(Math.max(0, phaseIndex)));
}

function selectRoute(routeId: NightDropRunnerRouteId): void {
  if (playing || routeId === plan.routeId) return;
  clearTimers();
  runnerWorld.dispose();
  plan = createNightDropRunnerPlan(routeId);
  runnerWorld = createRunnerWorld();
  savedSnapshot = null;
  routeSelect.value = routeId;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("route", routeId);
  nextUrl.searchParams.delete("runnerState");
  nextUrl.searchParams.delete("junction");
  nextUrl.searchParams.delete("obstacle");
  window.history.replaceState({}, "", nextUrl);
  resetRound();
}

function scheduleTimeline(fromMs: number): void {
  const speed = currentSpeed();
  plan.timeline.filter(({ atMs }) => atMs >= fromMs).forEach((beat) => {
    timers.push(window.setTimeout(() => applyBeat(beat, false), Math.max(0, (beat.atMs - fromMs) / speed)));
  });
}

function executeInput(type: SpatialRunnerCommandType, source = "automation"): void {
  if (!playing || type === "choose-branch") return;
  const record = runnerWorld.execute(type);
  const runnerState = runnerWorld.inspect().runnerState;
  liveStatus.textContent = record.accepted ? `${type.replaceAll("-", " ")} accepted` : `Input ignored: ${record.reason}`;
  stage.dataset.lastInput = type;
  stage.dataset.lastInputSource = source;
  stage.dataset.lastInputAccepted = String(record.accepted);
  stage.dataset.commandsExecuted = String(runnerState.commandsExecuted);
  stage.dataset.lane = String(runnerState.lane);
  stage.dataset.runnerAction = runnerState.action;
  if (record.accepted) feedback.cue(type === "jump" ? "jump" : type === "slide" ? "slide" : "dodge");
}

function chooseBranch(alternativeId: string): void {
  const record = runnerWorld.chooseBranch(alternativeId);
  if (!record) {
    liveStatus.textContent = "No junction decision is open.";
    return;
  }
  const runnerState = runnerWorld.inspect().runnerState;
  const label = alternativeId === "left" ? "Left route" : alternativeId === "right" ? "Right route" : "Straight route";
  liveStatus.textContent = record.accepted ? `${label} selected. Round outcome unchanged.` : `Route choice ignored: ${record.reason}`;
  stage.dataset.branchChoice = alternativeId;
  stage.dataset.lastInputAccepted = String(record.accepted);
  stage.dataset.commandsExecuted = String(runnerState.commandsExecuted);
  if (record.accepted) feedback.cue("branch-selected");
}

function handleRunnerPointerDown(event: PointerEvent): void {
  if (!playing || !event.isPrimary) return;
  if (event.target instanceof Element && event.target.closest("button, select, label")) return;
  pointerStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, atMs: event.timeStamp };
  runnerViewport.setPointerCapture?.(event.pointerId);
}

function handleRunnerPointerUp(event: PointerEvent): void {
  if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
  const start = pointerStart;
  clearRunnerPointer(event);
  const swipe = interpretSpatialRunnerSwipe(start, {
    x: event.clientX,
    y: event.clientY,
    atMs: Math.max(event.timeStamp, start.atMs + 1),
  });
  if (!swipe) return;
  hasUsedSwipe = true;
  swipeCount += 1;
  stage.dataset.swipeUsed = "true";
  stage.dataset.swipeCount = String(swipeCount);
  stage.dataset.swipeDirection = swipe.direction;
  stage.dataset.swipeVelocity = swipe.velocity.toFixed(3);

  if (stage.dataset.decisionOpen === "true") {
    const direction = swipe.direction === "left" ? "left" : swipe.direction === "right" ? "right" : swipe.direction === "up" ? "straight" : null;
    const branch = plan.spatialRoute.branches.find(({ id }) => id === stage.dataset.decisionBranch);
    const alternative = direction ? branch?.alternatives.find((item) => item.direction === direction) : undefined;
    if (alternative) chooseBranch(alternative.id);
    else liveStatus.textContent = "Swipe toward one of the visible streets.";
    return;
  }
  executeInput(swipe.commandType, "swipe");
}

function clearRunnerPointer(event: PointerEvent): void {
  if (pointerStart?.pointerId !== event.pointerId) return;
  if (runnerViewport.hasPointerCapture?.(event.pointerId)) runnerViewport.releasePointerCapture(event.pointerId);
  pointerStart = null;
}

function showJunction(index: number): void {
  const branch = plan.spatialRoute.branches[index];
  if (!branch) {
    liveStatus.textContent = `Junction ${index + 1} is not available on this route.`;
    return;
  }
  clearTimers();
  playing = false;
  runnerWorld.reset();
  const previewLead = Math.min(22 / plan.spatialRoute.totalLength, Math.max(0, branch.entryProgress - branch.decisionOpensProgress));
  const progress = Math.max(branch.decisionOpensProgress, branch.entryProgress - previewLead);
  runnerWorld.showAtProgress(progress);
  stage.dataset.phase = "turn";
  stage.dataset.playing = "false";
  stage.style.setProperty("--route-progress", `${Math.round(progress * 100)}%`);
  setText("[data-progress-label]", `${Math.round(progress * plan.spatialRoute.totalLength)}m / ${Math.round(plan.spatialRoute.totalLength)}m`);
  setText("[data-moment-kicker]", branch.junctionKind === "crossroads" ? "CROSSROADS" : "T-JUNCTION");
  setText("[data-moment]", "Choose Dash's street");
  liveStatus.textContent = "Choose a visible route. The round result remains predetermined.";
}

function showObstacle(index: number): void {
  const obstacle = plan.spatialRoute.obstacles[index];
  if (!obstacle) {
    liveStatus.textContent = `Obstacle ${index + 1} is not available on this route.`;
    return;
  }
  clearTimers();
  playing = false;
  runnerWorld.reset();
  const progress = Math.max(obstacle.reactionOpensProgress, obstacle.progress - 18 / plan.spatialRoute.totalLength);
  runnerWorld.showAtProgress(progress);
  stage.dataset.phase = "start-running";
  stage.dataset.playing = "false";
  stage.style.setProperty("--route-progress", `${Math.round(progress * 100)}%`);
  setText("[data-progress-label]", `${Math.round(progress * plan.spatialRoute.totalLength)}m / ${Math.round(plan.spatialRoute.totalLength)}m`);
  setText("[data-moment-kicker]", "RUNNER INPUT");
  setText("[data-moment]", obstacleActionText(obstacle.requiredAction));
  liveStatus.textContent = `${obstacle.kind.replaceAll("-", " ")} preview. Runner input changes presentation only; the paid result remains predetermined.`;
}

function saveSnapshot(): void {
  if (!playing) return;
  savedSnapshot = runnerWorld.createSnapshot();
  liveStatus.textContent = `Route saved at ${Math.round(savedSnapshot.state.progress * 100)}%`;
  stage.dataset.snapshot = "saved";
  stage.dataset.snapshotProgress = savedSnapshot.state.progress.toFixed(6);
}

function interruptRound(): void {
  if (!playing) return;
  savedSnapshot = runnerWorld.createSnapshot();
  runnerWorld.pause();
  clearTimers();
  playing = false;
  stage.dataset.playing = "false";
  stage.dataset.interrupted = "true";
  playButton.disabled = true;
  routeSelect.disabled = true;
  speedSelect.disabled = true;
  liveStatus.textContent = "Route interrupted. Recovery snapshot preserved.";
  stage.dataset.snapshotProgress = savedSnapshot.state.progress.toFixed(6);
}

function recoverRound(): void {
  if (!savedSnapshot) {
    liveStatus.textContent = "Save or interrupt the route before recovering.";
    return;
  }
  clearTimers();
  runnerWorld.restoreSnapshot(savedSnapshot);
  const fromMs = savedSnapshot.state.elapsedMs;
  playing = true;
  stage.dataset.playing = "true";
  stage.dataset.interrupted = "false";
  playButton.disabled = true;
  routeSelect.disabled = true;
  speedSelect.disabled = true;
  runnerWorld.resume(currentSpeed());
  scheduleTimeline(fromMs);
  liveStatus.textContent = `Recovered at ${Math.round(savedSnapshot.state.progress * 100)}%`;
  stage.dataset.recoveryCount = String(runnerWorld.inspect().runnerState.recoveryCount);
  feedback.cue("recovery");
}

function createRunnerWorld(): NightDropRunnerWorld {
  return new NightDropRunnerWorld(worldCanvas, stage, plan, {
    productionAssets: productionAssetsEnabled,
    onPresentationCue: (cue) => feedback.cue(cue),
  });
}

function handleKeyboardInput(event: KeyboardEvent): void {
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
  const command = ({
    ArrowLeft: "dodge-left",
    a: "dodge-left",
    ArrowRight: "dodge-right",
    d: "dodge-right",
    ArrowUp: "jump",
    w: "jump",
    " ": "jump",
    ArrowDown: "slide",
    s: "slide",
  } as const)[event.key];
  if (command) {
    event.preventDefault();
    executeInput(command, "keyboard");
  }
  if (event.key === "1") chooseBranch("left");
  if (event.key === "2") chooseBranch("straight");
  if (event.key === "3") chooseBranch("right");
  if (event.key.toLowerCase() === "i") interruptRound();
  if (event.key.toLowerCase() === "r") recoverRound();
}

function currentSpeed(): number {
  return Number(speedSelect.value);
}

function obstacleActionText(action: SpatialRouteObstacleAction): string {
  if (action === "jump") return "Jump the obstacle";
  if (action === "slide") return "Slide under the sign";
  if (action === "change-lane") return "Move into a clear lane";
  return "Hold speed over the ramp";
}

function updateRoundValues(phase: RunnerPhase): void {
  const values: Partial<Record<RunnerPhase, { win: string; reputation: string; priority: string; multiplier: string }>> = {
    "package-one": { win: "€1.20", reputation: "●○○○○", priority: "0", multiplier: "1.2×" },
    "package-two": { win: "€3.20", reputation: "●●○○○", priority: "0", multiplier: "3.2×" },
    turn: { win: "€3.20", reputation: "●●○○○", priority: "0", multiplier: "3.2×" },
    "premium-package": { win: "€7.50", reputation: "●●●○○", priority: "1", multiplier: "7.5×" },
    "continuation-open": { win: "€12.00", reputation: "●●●●○", priority: "1", multiplier: "12.0×" },
    shortcut: { win: "€14.00", reputation: "●●●●○", priority: "1", multiplier: "14.0×" },
    clamp: { win: "€14.00", reputation: "●●●●○", priority: "1", multiplier: "14.0×" },
    escape: { win: "€18.00", reputation: "●●●●●", priority: "2", multiplier: "18.0×" },
    "penthouse-reveal": { win: "€18.00", reputation: "●●●●●", priority: "2", multiplier: "18.0×" },
    arrival: { win: "€24.00", reputation: "●●●●●", priority: "3", multiplier: "24.0×" },
    delivery: { win: "€24.00", reputation: "●●●●●", priority: "3", multiplier: "24.0×" },
    win: { win: "€24.00", reputation: "●●●●●", priority: "3", multiplier: "24.0×" },
    resolved: { win: "€24.00", reputation: "●●●●●", priority: "3", multiplier: "24.0×" },
  };
  const value = values[phase] ?? { win: "€0.00", reputation: "○○○○○", priority: "0", multiplier: "1.0×" };
  setText("[data-win]", value.win);
  setText("[data-reputation]", value.reputation);
  setText("[data-priority]", value.priority);
  setText("[data-multiplier]", value.multiplier);
  if (phase !== "establishing") setText("[data-balance]", "€99.00");
}

function kickerFor(phase: RunnerPhase): string {
  if (phase.startsWith("package")) return "PICKUP";
  if (phase === "premium-package") return "PRIORITY";
  if (phase === "continuation-open") return "CONTINUATION";
  if (phase === "shortcut") return "SHORTCUT";
  if (phase === "clamp") return "CLAMP";
  if (phase === "escape") return "ROUTE CLEAR";
  if (["penthouse-reveal", "arrival", "delivery"].includes(phase)) return "FINAL ADDRESS";
  if (["win", "resolved"].includes(phase)) return "ROUND COMPLETE";
  return "ROUTE";
}

function statusFor(phase: RunnerPhase): string {
  const statuses: Record<RunnerPhase, string> = {
    establishing: "Address received in Glasshouse Heights",
    "route-guidance": "The deterministic route is illuminated",
    "start-running": "Dash is moving automatically",
    "package-one": "First package added to the round value",
    "package-two": "Second package added to the round value",
    turn: "RouteRun bend translated into a cinematic turn",
    "premium-package": "Premium package secured",
    "continuation-open": "The same paid round continues into a new street section",
    shortcut: "Shortcut opens a service passage",
    clamp: "Clamp is scanning the route",
    escape: "Dash clears the immediate enforcement threat",
    "penthouse-reveal": "The final address is visible",
    arrival: "Dash reaches the penthouse",
    delivery: "Delivery resolves",
    win: "Total win paid",
    resolved: "Stable ending state",
  };
  return statuses[phase];
}

function feedbackCueForPhase(phase: RunnerPhase): NightDropRunnerFeedbackCue | null {
  if (phase === "package-one" || phase === "package-two") return "package";
  if (phase === "premium-package") return "premium-package";
  if (phase === "continuation-open") return "continuation";
  if (phase === "shortcut") return "shortcut";
  if (phase === "clamp") return "clamp";
  if (phase === "arrival") return "arrival";
  if (phase === "win") return "win";
  return null;
}

function clearTimers(): void {
  timers.splice(0).forEach((timer) => window.clearTimeout(timer));
}

function setText(selector: string, text: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
}

function requiredElement<T extends Element>(selector: string, parent: ParentNode, message: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(message);
  return element;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

declare global {
  interface Window {
    __nightDropRunnerSpike?: {
      readonly plan: typeof plan;
      readonly routes: typeof plan.availableRoutes;
      readonly start: () => void;
      readonly select: (routeId: NightDropRunnerRouteId) => void;
      readonly inspect: () => ReturnType<NightDropRunnerWorld["inspect"]>;
      readonly input: (type: SpatialRunnerCommandType) => void;
      readonly branch: (alternativeId: string) => void;
      readonly junction: (index: number) => void;
      readonly obstacle: (index: number) => void;
      readonly snapshot: () => SpatialRunnerSnapshot;
      readonly interrupt: () => void;
      readonly recover: () => void;
      readonly feedback: () => ReturnType<NightDropRunnerFeedbackController["inspect"]>;
      readonly show: (phase: RunnerPhase) => void;
    };
  }
}
