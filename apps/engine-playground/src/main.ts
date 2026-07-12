import {
  RoundController,
  money,
  serializeSnapshot,
  type AnimationCommand,
  type AnimationExecutionContext,
  type AnimationExecutor,
  type EngineEventMap,
} from "@hustle/core";
import {
  adaptMockStakeRound,
  type MockStakeRoundResponse,
} from "@hustle/stake-adapter";
import "./style.css";

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
let activeCommand: AnimationCommand | null = null;
let failNextAnimation = false;
const eventLog: string[] = [];

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing playground root");

root.innerHTML = `
  <h1>Hustle Engine Playground</h1>
  <p class="subtitle">Task 001 · deterministic lifecycle · mocked data only</p>
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
  </section>`;

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
    else if (action === "interrupt") { savedSnapshot = serializeSnapshot(controller.interrupt()); }
    else if (action === "save") { savedSnapshot = serializeSnapshot(controller.createSnapshot()); log("snapshot saved"); }
    else if (action === "restore") {
      if (!savedSnapshot) throw new Error("Save or interrupt a round first");
      await controller.restore(savedSnapshot);
    } else if (action === "reset") reset();
    else if (action === "malformed") await startRound({ ...MOCK_RESPONSE, totalWin: -1 });
    else if (action === "failure") { failNextAnimation = true; await startRound({ ...MOCK_RESPONSE, roundId: "mock-failure-001" }); }
  } catch (error) {
    log(`control error: ${error instanceof Error ? error.message : String(error)}`);
  }
  render();
}

async function startRound(response: MockStakeRoundResponse): Promise<void> {
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
      if (key === "animation:completed" || key === "animation:skipped") activeCommand = null;
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
