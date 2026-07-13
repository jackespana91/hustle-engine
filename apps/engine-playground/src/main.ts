import {
  EngineError,
  RoundController,
  installHustleDebugPanel,
  money,
  serializeSnapshot,
  type AnimationCommand,
  type AnimationExecutionContext,
  type AnimationExecutor,
  type EngineEventMap,
  type HustleDebugPanel,
  type RecoverySnapshot,
} from "@hustle/core";
import {
  adaptMockStakeRound,
  type MockStakeRoundResponse,
} from "@hustle/stake-adapter";
import "./style.css";
import { mountAssetThemeDebug } from "./asset-theme-debug.js";
import { mountFeatureDebug } from "./feature-debug.js";
import { mountManifestDebug } from "./manifest-debug.js";
import { mountOutcomeStudio } from "./outcome-studio/index.js";
import { mountRouteRunDebug } from "./routerun-debug.js";

const MOCK_RESPONSE: MockStakeRoundResponse = {
  roundId: "mock-round-001",
  betAmount: 1_000_000,
  totalWin: 2_500_000,
  completed: true,
  resultEvents: [
    { id: "event-001", type: "mock-reveal", order: 0, amount: 0, data: { label: "First deterministic event" } },
    { id: "event-002", type: "mock-award", order: 1, amount: 1_000_000, data: { label: "Award one" } },
    { id: "event-003", type: "mock-award", order: 2, amount: 1_500_000, data: { label: "Award two" } },
  ],
};

let balance = money(10_000_000);
let bet = money(0);
let totalWin = money(0);
let savedSnapshot: string | null = null;
let savedSnapshotObject: RecoverySnapshot | null = null;
let lastSave: string | null = null;
let activeCommand: AnimationCommand | null = null;
let failNextAnimation = false;
let recoveryCount = 0;
let roundSequence = 1;
let lastResponse: MockStakeRoundResponse = MOCK_RESPONSE;
let debugPanel: HustleDebugPanel | null = null;
const eventLog: string[] = [];

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing playground root");

root.innerHTML = `
  <h1>Hustle Engine Playground</h1>
  <p class="subtitle">Deterministic routes · outcomes · replay · lifecycle · features · manifests · assets · themes</p>
  <section class="dashboard">
    <div class="metric"><span>Lifecycle</span><strong id="state">idle</strong></div>
    <div class="metric"><span>Balance</span><strong id="balance">—</strong></div>
    <div class="metric"><span>Bet</span><strong id="bet">—</strong></div>
    <div class="metric"><span>Total win</span><strong id="win">—</strong></div>
    <div class="metric"><span>Round id</span><strong id="round">—</strong></div>
  </section>
  <section id="stage" class="stage"><strong id="current">No active animation</strong></section>
  <section class="controls">
    <button class="primary" data-action="start">Start mocked round</button>
    <button data-action="pause">Pause</button><button data-action="resume">Resume</button>
    <button data-action="skip-current">Skip current</button><button data-action="skip-all">Skip all</button>
    <button data-action="interrupt">Interrupt</button><button data-action="save">Save snapshot</button>
    <button data-action="restore">Restore snapshot</button><button data-action="reset">Reset</button>
    <button data-action="malformed">Trigger malformed response</button>
    <button data-action="failure">Trigger animation failure</button>
  </section>
  <section class="grid">
    <div class="panel"><h2>Pending queue</h2><pre id="pending"></pre></div>
    <div class="panel"><h2>Completed queue</h2><pre id="completed"></pre></div>
    <div class="panel"><h2>Transition history</h2><pre id="history"></pre></div>
    <div class="panel"><h2>Event log</h2><pre id="events"></pre></div>
  </section>
  <div id="routerun-debug-root"></div>
  <div id="outcome-studio-root"></div>
  <div id="feature-debug-root"></div>
  <div id="manifest-debug-root"></div>
  <div id="asset-theme-debug-root"></div>`;

class PlaygroundExecutor implements AnimationExecutor {
  async execute(command: AnimationCommand, context: AnimationExecutionContext): Promise<void> {
    activeCommand = command;
    render();
    if (failNextAnimation) {
      failNextAnimation = false;
      throw new Error("Deliberate playground animation failure");
    }
    await abortableDelay(command.durationMs, context.signal);
    if (!context.skipped()) applyPresentation(command);
  }
}

const controller = new RoundController(new PlaygroundExecutor());
wireEvents();
const outcomeStudioMount = document.querySelector<HTMLElement>("#outcome-studio-root");
if (!outcomeStudioMount) throw new Error("Missing Outcome Studio mount");
const outcomeStudioView = mountOutcomeStudio(outcomeStudioMount, {
  onEvent: (name, payload) => debugPanel?.recordEvent(name, payload),
});
const routeRunMount = document.querySelector<HTMLElement>("#routerun-debug-root");
if (!routeRunMount) throw new Error("Missing RouteRun debug mount");
const routeRunView = mountRouteRunDebug(routeRunMount, {
  onEvent: (name, payload) => debugPanel?.recordEvent(name, payload),
  onReplayOutcome: (outcome) => outcomeStudioView.loadExternalOutcome(outcome, true),
});
const featureMount = document.querySelector<HTMLElement>("#feature-debug-root");
if (!featureMount) throw new Error("Missing feature debug mount");
const featureView = mountFeatureDebug(featureMount, {
  loadExamplesOnMount: false,
  onEvent: (name, payload) => debugPanel?.recordEvent(name, payload),
});
const assetThemeMount = document.querySelector<HTMLElement>("#asset-theme-debug-root");
if (!assetThemeMount) throw new Error("Missing asset and theme debug mount");
const assetThemeView = mountAssetThemeDebug(assetThemeMount, {
  loadExamplesOnMount: false,
  onEvent: (name, payload) => debugPanel?.recordEvent(name, payload),
});
debugPanel = installHustleDebugPanel({
  getState: () => {
    const currentEvent = controller.outcome?.events.find((event) => event.order === controller.progress.lastEventOrder);
    return {
      currentState: controller.state,
      currentRound: controller.outcome?.roundId ?? null,
      currentEvent: currentEvent ? `${currentEvent.type} · ${currentEvent.id}` : null,
      currentAnimation: activeCommand ? `${activeCommand.type} · ${activeCommand.id}` : null,
      animationQueueLength: controller.queue.pending.length,
      currentSnapshot: savedSnapshotObject,
      lastSave,
      recoveryVersion: 1,
      transitionHistory: controller.transitionHistory,
      animationCount: controller.queue.completed.length + controller.queue.pending.length + (controller.queue.current ? 1 : 0),
      commandsExecuted: controller.queue.completed.length,
      recoveryCount,
    };
  },
  actions: {
    pause: () => controller.queue.pause(),
    resume: () => controller.queue.resume(),
    skip: () => controller.queue.skipCurrent(),
    skipAll: () => controller.queue.skipAll(),
    replayLastRound: () => startRound({ ...lastResponse, roundId: nextRoundId("replay") }),
    interrupt: () => saveSnapshot(controller.interrupt()),
    recover: () => restoreSnapshot(),
    reset,
    simulateCrash,
    generateSmallRound: () => startRound(createDebugRound("small", 2)),
    generateMediumRound: () => startRound(createDebugRound("medium", 8)),
    generateHugeRound: () => startRound(createDebugRound("huge", 60)),
    generateBadRound: () => startRound({ ...createDebugRound("bad", 3), totalWin: -1 }),
    generateAnimationFailure: async () => {
      failNextAnimation = true;
      await startRound(createDebugRound("animation-failure", 3));
    },
    generateRecoveryTest: runRecoveryTest,
  },
  features: featureView.debugPanelIntegration,
  assetThemes: assetThemeView.debugPanelIntegration,
  outcomes: outcomeStudioView.debugPanelIntegration,
  routerun: routeRunView.debugPanelIntegration,
  title: "DEBUG PANEL",
});
void featureView.loadExamples();
void assetThemeView.loadExamples();
const manifestMount = document.querySelector<HTMLElement>("#manifest-debug-root");
if (!manifestMount) throw new Error("Missing manifest debug mount");
mountManifestDebug(manifestMount, { onEvent: (name, payload) => debugPanel?.recordEvent(name, payload) });
render();

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  void perform(button.dataset.action ?? "");
});


async function perform(action: string): Promise<void> {
  try {
    if (action === "start") await startRound(MOCK_RESPONSE);
    else if (action === "pause") controller.queue.pause();
    else if (action === "resume") controller.queue.resume();
    else if (action === "skip-current") controller.queue.skipCurrent();
    else if (action === "skip-all") controller.queue.skipAll();
    else if (action === "interrupt") saveSnapshot(controller.interrupt());
    else if (action === "save") { saveSnapshot(controller.createSnapshot()); log("snapshot saved"); }
    else if (action === "restore") await restoreSnapshot();
    else if (action === "reset") reset();
    else if (action === "malformed") await startRound({ ...MOCK_RESPONSE, totalWin: -1 });
    else if (action === "failure") { failNextAnimation = true; await startRound({ ...MOCK_RESPONSE, roundId: "mock-failure-001" }); }
  } catch (error) {
    log(`control error: ${error instanceof Error ? error.message : String(error)}`);
  }
  render();
}

async function startRound(response: MockStakeRoundResponse): Promise<void> {
  lastResponse = response;
  bet = money(Number.isSafeInteger(response.betAmount) && response.betAmount >= 0 ? response.betAmount : 0);
  totalWin = money(0);
  controller.startRequest(bet);
  let outcome: ReturnType<typeof adaptMockStakeRound>;
  try {
    outcome = adaptMockStakeRound(response);
  } catch (error) {
    controller.fail(error);
    return;
  }
  await controller.receiveOutcome(outcome);
}

function wireEvents(): void {
  const keys: readonly (keyof EngineEventMap)[] = [
    "round:requesting", "round:received", "round:state", "round:completed", "round:interrupted",
    "round:recovered", "round:failed", "animation:started", "animation:completed", "animation:skipped",
  ];
  for (const key of keys) {
    controller.events.subscribe(key, (payload) => {
      log(`${key} ${summarize(payload)}`);
      debugPanel?.recordEvent(key, payload);
      if (key === "animation:completed" || key === "animation:skipped") activeCommand = null;
      if (key === "round:recovered") recoveryCount += 1;
      render();
    });
  }
}

function applyPresentation(command: AnimationCommand): void {
  if (command.type === "balance-debit" && typeof command.payload.amount === "number") {
    balance = money(Math.max(0, balance - command.payload.amount));
  }
  if (command.type === "increment-win" && typeof command.payload.amount === "number") {
    totalWin = money(totalWin + command.payload.amount);
  }
  if (command.type === "round-complete") balance = money(balance + totalWin);
  render();
}

function reset(): void {
  controller.reset();
  balance = money(10_000_000); bet = money(0); totalWin = money(0);
  activeCommand = null; savedSnapshot = null; eventLog.length = 0;
  savedSnapshotObject = null; lastSave = null; recoveryCount = 0;
}

function simulateCrash(): void {
  if (["idle", "completed", "failed"].includes(controller.state)) controller.startRequest(money(0));
  controller.fail(new EngineError("ANIMATION_EXECUTION_FAILURE", "Simulated debug crash"));
}

function saveSnapshot(snapshot: RecoverySnapshot): void {
  savedSnapshotObject = snapshot;
  savedSnapshot = serializeSnapshot(snapshot);
  lastSave = new Date().toLocaleTimeString([], { hour12: false });
  debugPanel?.recordEvent("debug:snapshot-saved", { version: snapshot.version, state: snapshot.lifecycleState });
}

async function restoreSnapshot(): Promise<void> {
  if (!savedSnapshot) throw new Error("Save or interrupt a round first");
  await controller.restore(savedSnapshot);
}

async function runRecoveryTest(): Promise<void> {
  const running = startRound(createDebugRound("recovery", 8));
  await delay(520);
  if (controller.state === "presenting") saveSnapshot(controller.interrupt());
  await running;
  await restoreSnapshot();
}

function createDebugRound(label: string, eventCount: number): MockStakeRoundResponse {
  const resultEvents = Array.from({ length: eventCount }, (_, order) => ({
    id: `${label}-event-${order}`,
    type: "debug-step",
    order,
    amount: order % 3 === 0 ? 250_000 : 0,
    data: { label: `Debug event ${order + 1} of ${eventCount}`, scale: label },
  }));
  return {
    roundId: nextRoundId(label),
    betAmount: 1_000_000,
    totalWin: resultEvents.reduce((sum, event) => sum + event.amount, 0),
    completed: true,
    resultEvents,
  };
}

function nextRoundId(label: string): string {
  const id = `debug-${label}-${String(roundSequence).padStart(3, "0")}`;
  roundSequence += 1;
  return id;
}

function render(): void {
  setText("state", controller.state);
  setText("balance", units(balance)); setText("bet", units(bet)); setText("win", units(totalWin));
  setText("round", controller.outcome?.roundId ?? "—");
  setText("current", activeCommand ? `${activeCommand.type} · ${activeCommand.id}` : "No active animation");
  setText("pending", controller.queue.pending.map((command) => command.type).join("\n") || "Empty");
  setText("completed", controller.queue.completed.map((command) => command.type).join("\n") || "Empty");
  setText("history", controller.transitionHistory.map((item) => `${item.sequence}: ${item.from} → ${item.to}`).join("\n") || "No transitions");
  setText("events", eventLog.join("\n") || "No events");
  const stage = document.querySelector("#stage");
  stage?.classList.toggle("active", activeCommand !== null);
  stage?.classList.toggle("failed", controller.state === "failed");
}

function setText(id: string, text: string): void { const node = document.querySelector(`#${id}`); if (node) node.textContent = text; }
function units(value: number): string { return `${(value / 1_000_000).toFixed(2)} units`; }
function log(message: string): void { eventLog.unshift(message); eventLog.splice(80); }
function summarize(payload: unknown): string { try { return JSON.stringify(payload); } catch { return "[unserializable]"; } }

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timeout); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
