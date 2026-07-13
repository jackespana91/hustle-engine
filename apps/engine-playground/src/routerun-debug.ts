import {
  ROUTERUN_DIAGNOSTIC_THEME,
  ROUTERUN_SCENARIOS,
  RouteRunDebugAdapter,
  RouteRunEngine,
  SequenceRefillProvider,
  coordinateKey,
  createExampleRouteRunOutcome,
  serializeRouteRunSnapshot,
  type BoardCell,
  type Direction,
  type RouteRunDebugPanelIntegration,
  type RouteRunScenario,
  type RouteRunSnapshot,
} from "@hustle/routerun";
import type { OutcomeDefinition } from "@hustle/core";

export interface RouteRunDebugOptions {
  readonly onEvent?: (name: string, payload: unknown) => void;
  readonly onReplayOutcome?: (outcome: OutcomeDefinition) => void | Promise<void>;
}

export interface RouteRunDebugView {
  readonly element: HTMLElement;
  readonly debugPanelIntegration: RouteRunDebugPanelIntegration;
  readonly engine: RouteRunEngine;
  destroy(): void;
}

type Tone = "neutral" | "success" | "warning" | "error";

export function mountRouteRunDebug(mount: HTMLElement, options: RouteRunDebugOptions = {}): RouteRunDebugView {
  const element = document.createElement("section");
  element.className = "routerun-workspace";
  element.dataset.routerunWorkspace = "true";
  element.setAttribute("aria-labelledby", "routerun-title");
  element.innerHTML = markup();
  mount.append(element);

  let scenarioIndex = 14;
  let engine = new RouteRunEngine();
  let snapshot: RouteRunSnapshot | null = null;
  let paused = false;
  let playing = false;
  let destroyed = false;
  let status = "Load a scenario, preview its deterministic route, then step or play it.";
  let tone: Tone = "neutral";

  const selectedScenario = (): RouteRunScenario => structuredClone(ROUTERUN_SCENARIOS[scenarioIndex]!);

  const emit = (name: string, payload: unknown): void => options.onEvent?.(name, payload);

  function load(index = scenarioIndex): void {
    scenarioIndex = (index + ROUTERUN_SCENARIOS.length) % ROUTERUN_SCENARIOS.length;
    engine.dispose();
    engine = new RouteRunEngine();
    const scenario = selectedScenario();
    for (const type of eventTypes) engine.events.subscribe(type, ({ event }) => emit(event.type, event.payload));
    engine.initialize(scenario.board, scenario.runner, `scenario:${scenario.id}`);
    snapshot = null;
    paused = false;
    playing = false;
    status = `${scenario.name} loaded. Board and Runner are initialized.`;
    tone = "success";
    syncScenarioSelect();
    render();
  }

  async function perform(action: string): Promise<void> {
    try {
      const scenario = selectedScenario();
      if (action === "previous") load(scenarioIndex - 1);
      else if (action === "next") load(scenarioIndex + 1);
      else if (action === "load") load(Number(element.querySelector<HTMLSelectElement>("[data-routerun-scenario]")?.value ?? scenarioIndex));
      else if (action === "initialize") load(scenarioIndex);
      else if (action === "preview") {
        const preview = engine.previewRoute(scenario.solverOptions ?? {});
        status = `Preview ready: ${preview.steps.length} steps · ${preview.terminalReason}.`;
        tone = preview.terminalReason === "failed" ? "error" : "success";
      } else if (action === "play") await play();
      else if (action === "pause") { paused = true; status = "Route presentation paused at an explicit step boundary."; tone = "warning"; }
      else if (action === "resume") { paused = false; status = "Route presentation resumed."; tone = "success"; if (playing) void continuePlay(); }
      else if (action === "step") step();
      else if (action === "skip") { paused = false; step(); status = "Current diagnostic movement command skipped to completion."; tone = "warning"; }
      else if (action === "interrupt") {
        snapshot = engine.interrupt(); playing = false;
        status = `Interrupted after ${snapshot.completedRouteSteps.length} completed step(s).`;
        tone = "warning";
      } else if (action === "save") {
        snapshot = engine.createSnapshot(); status = `Snapshot v${snapshot.schemaVersion} saved at logical tick ${snapshot.logicalTick}.`; tone = "success";
      } else if (action === "restore") {
        if (!snapshot) throw new Error("Save or interrupt RouteRun before restoring");
        engine.restoreSnapshot(snapshot); status = "Exact deterministic RouteRun snapshot restored."; tone = "success";
      } else if (action === "clear") {
        const report = engine.clearRoute(); status = `${report.clearedCellIds.length} traversed cell(s) cleared; ${report.retainedCellIds.length} retained.`; tone = "success";
      } else if (action === "cascade") {
        const inspection = engine.inspect();
        const data = inspection.completedCascades.length === 0 ? scenario.refillData : scenario.secondRefillData;
        if (!data) throw new Error("The selected scenario has no predetermined refill data");
        const report = engine.applyCascade(new SequenceRefillProvider(data));
        status = `Cascade ${report.cascadeIndex + 1}: ${report.movements.length} move(s), ${report.refills.length} refill(s).`; tone = "success";
      } else if (action === "expand") {
        if (!scenario.expansion) throw new Error("The selected scenario has no expansion definition");
        const report = engine.applyExpansion(scenario.expansion); status = `${report.expansionId} applied with ${report.changes.length} ordered change(s).`; tone = "success";
      } else if (action === "continuation") {
        const check = engine.checkContinuation(scenario.solverOptions ?? {}); status = check.reason; tone = check.available ? "success" : "warning";
      } else if (action === "replay") {
        const outcome = createExampleRouteRunOutcome(engine.inspect()).definition;
        await options.onReplayOutcome?.(outcome); status = `Sent ${outcome.events.length} RouteRun event(s) to Outcome Studio.`; tone = "success";
      } else if (action === "reset") load(scenarioIndex);
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      const expectedFailure = selectedScenario().expectedFailure;
      tone = expectedFailure !== undefined && status.includes(expectedFailure) ? "warning" : "error";
      emit("routerun.debug.error", { action, message: status });
    }
    render();
  }

  async function play(): Promise<void> {
    if (playing) return;
    if (!engine.inspect().preview) engine.previewRoute(selectedScenario().solverOptions ?? {});
    playing = true;
    paused = false;
    status = "Playing deterministic route movement…";
    tone = "neutral";
    await continuePlay();
  }

  async function continuePlay(): Promise<void> {
    while (playing && !paused && !destroyed) {
      const inspection = engine.inspect();
      if (inspection.phase === "terminal" || inspection.phase === "completed" || inspection.phase === "failed") {
        playing = false;
        status = inspection.terminalState?.message ?? `Route ended in ${inspection.phase}.`;
        tone = inspection.phase === "failed" ? "error" : "success";
        render();
        return;
      }
      step();
      render();
      await delay(180);
    }
  }

  function step(): void {
    if (!engine.inspect().preview) engine.previewRoute(selectedScenario().solverOptions ?? {});
    const steps = engine.playRoute({ maximumNewSteps: 1 });
    status = steps[0] ? `Step ${steps[0].sequence + 1} moved to ${coordinateKey(steps[0].coordinate)}.` : "No pending route movement.";
    tone = "success";
  }

  function render(): void {
    const scenario = selectedScenario();
    const inspection = engine.inspect();
    const board = inspection.board;
    setText("status", status);
    const statusNode = element.querySelector<HTMLElement>("[data-routerun-value='status']");
    if (statusNode) statusNode.dataset.tone = tone;
    setText("scenario-name", scenario.name);
    setText("phase", inspection.phase);
    setText("route-length", `${inspection.preview?.steps.length ?? 0}`);
    setText("tick", `${inspection.logicalTick}`);
    setText("terminal", inspection.terminalState?.reason ?? "—");
    setText("dimensions", board ? `${board.width} × ${board.height}` : "—");
    setText("active-count", `${board?.cells.filter(({ state }) => state === "active" || state === "empty").length ?? 0}`);
    setText("runner-coordinate", inspection.runner ? coordinateKey(inspection.runner.currentCoordinate) : "—");
    setText("direction", inspection.runner?.currentDirection ?? "—");
    setText("decisions", inspection.preview?.decisions.map(({ coordinate, chosen, reason }) => `${coordinateKey(coordinate)} → ${chosen} (${reason})`).join("\n") || "None");
    setText("overlays", inspection.collectedOverlays.map(({ overlayId }) => overlayId).join("\n") || "None");
    setText("value", `${inspection.runner?.accumulatedPresentationValue ?? 0} minor units`);
    setText("cascades", `${inspection.completedCascades.length}`);
    setText("expansions", inspection.activeExpansions.map(({ expansionId }) => expansionId).join("\n") || "None");
    setText("validation", inspection.validationErrors.join("\n") || "Valid");
    setText("snapshot", snapshot ? serializeRouteRunSnapshot(snapshot) : "No snapshot saved");
    setText("raw", board ? JSON.stringify(board, null, 2) : "No board loaded");
    renderBoard();
    renderTimeline();
    const pause = element.querySelector<HTMLButtonElement>("[data-routerun-action='pause']");
    const resume = element.querySelector<HTMLButtonElement>("[data-routerun-action='resume']");
    if (pause) pause.setAttribute("aria-pressed", String(paused));
    if (resume) resume.setAttribute("aria-pressed", String(!paused && playing));
  }

  function renderBoard(): void {
    const inspection = engine.inspect();
    const board = inspection.board;
    const container = element.querySelector<HTMLElement>("[data-routerun-board]");
    if (!container || !board) return;
    container.style.setProperty("--routerun-columns", String(board.width));
    const previewKeys = new Set(inspection.preview?.steps.map(({ coordinate }) => coordinateKey(coordinate)) ?? []);
    const visitedKeys = new Set(inspection.completedRouteSteps.map(({ coordinate }) => coordinateKey(coordinate)));
    const runnerKey = inspection.runner ? coordinateKey(inspection.runner.currentCoordinate) : null;
    container.replaceChildren(...board.cells.map((cell) => cellNode(cell, {
      preview: previewKeys.has(coordinateKey(cell.coordinate)),
      visited: visitedKeys.has(coordinateKey(cell.coordinate)),
      runner: runnerKey === coordinateKey(cell.coordinate),
    })));
  }

  function renderTimeline(): void {
    const inspection = engine.inspect();
    const container = element.querySelector<HTMLElement>("[data-routerun-timeline]");
    if (!container) return;
    container.replaceChildren(...inspection.timeline.map((event, index) => {
      const row = document.createElement("li");
      row.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(event.type)}</strong><small>tick ${event.logicalTick} · ${escapeHtml(summarize(event.payload))}</small></div>`;
      return row;
    }));
    if (inspection.timeline.length === 0) container.textContent = "No RouteRun events yet";
  }

  function syncScenarioSelect(): void {
    const select = element.querySelector<HTMLSelectElement>("[data-routerun-scenario]");
    if (select) select.value = String(scenarioIndex);
  }

  function setText(key: string, value: string): void {
    const target = element.querySelector<HTMLElement>(`[data-routerun-value='${key}']`);
    if (target && target.textContent !== value) target.textContent = value;
  }

  element.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-routerun-action]");
    if (target) void perform(target.dataset.routerunAction ?? "");
  });
  element.querySelector<HTMLSelectElement>("[data-routerun-scenario]")?.addEventListener("change", (event) => load(Number((event.target as HTMLSelectElement).value)));

  load();
  return {
    element,
    get engine() { return engine; },
    debugPanelIntegration: { getState: () => debugAdapterFor(engine).getState() },
    destroy: () => { destroyed = true; engine.dispose(); element.remove(); },
  };
}

function debugAdapterFor(engine: RouteRunEngine): RouteRunDebugAdapter {
  return new RouteRunDebugAdapter(() => engine.inspect());
}

const eventTypes = [
  "routerun.board.initialize", "routerun.runner.place", "routerun.route.resolve", "routerun.route.preview",
  "routerun.runner.move", "routerun.overlay.collect", "routerun.cells.clear", "routerun.cascade.apply",
  "routerun.expansion.apply", "routerun.round.terminal",
] as const;

function cellNode(cell: BoardCell, flags: { readonly preview: boolean; readonly visited: boolean; readonly runner: boolean }): HTMLElement {
  const node = document.createElement("div");
  node.className = "routerun-cell";
  node.dataset.state = cell.state;
  node.dataset.preview = String(flags.preview);
  node.dataset.visited = String(flags.visited);
  node.setAttribute("aria-label", `${coordinateKey(cell.coordinate)} ${cell.state} ${cell.tile?.family ?? "empty"}`);
  const connections = cell.tile?.connections.map((direction) => `<i class="routerun-connection" data-direction="${direction}"></i>`).join("") ?? "";
  const overlays = cell.overlays.map((overlay) => `<b class="routerun-overlay" title="${escapeHtml(overlay.id)}">${overlay.type === "premium-reward" ? "✦" : "+"}</b>`).join("");
  const destination = cell.destination || cell.tile?.family === "destination" ? `<b class="routerun-destination">${ROUTERUN_DIAGNOSTIC_THEME.symbols.destination}</b>` : "";
  const runner = flags.runner ? `<b class="routerun-runner">${ROUTERUN_DIAGNOSTIC_THEME.symbols.runner}</b>` : "";
  node.innerHTML = `${connections}<span class="routerun-coordinate">${cell.coordinate.row}:${cell.coordinate.column}</span><span class="routerun-family">${escapeHtml(cell.tile?.family ?? cell.state)}</span>${destination}${overlays}${runner}`;
  return node;
}

function markup(): string {
  const options = ROUTERUN_SCENARIOS.map((scenario, index) => `<option value="${index}">${String(index + 1).padStart(2, "0")} · ${escapeHtml(scenario.name)}</option>`).join("");
  return `
    <header class="routerun-header">
      <div><span>COMMERCIAL ENGINE 001 · DEVELOPMENT</span><h2 id="routerun-title">RouteRun Engine 001</h2><p>Deterministic route mechanics rendered with diagnostic geometry. No game-pack logic or commercial maths.</p></div>
      <div class="routerun-scenario-control"><label>Scenario<select data-routerun-scenario>${options}</select></label><div><button data-routerun-action="previous">← Previous</button><button data-routerun-action="next">Next →</button><button class="routerun-primary" data-routerun-action="load">Load scenario</button></div></div>
    </header>
    <div class="routerun-status" data-routerun-value="status" data-tone="neutral"></div>
    <div class="routerun-controls" aria-label="RouteRun controls">
      ${controlGroup("Setup", [["initialize", "Initialize"], ["preview", "Preview route"]])}
      ${controlGroup("Movement", [["play", "Play route"], ["pause", "Pause"], ["resume", "Resume"], ["step", "Step one"], ["skip", "Skip animation"]])}
      ${controlGroup("Recovery", [["interrupt", "Interrupt"], ["save", "Save snapshot"], ["restore", "Restore snapshot"]])}
      ${controlGroup("Board", [["clear", "Clear traversed"], ["cascade", "Apply cascade"], ["expand", "Apply expansion"], ["continuation", "Check continuation"]])}
      ${controlGroup("Tools", [["replay", "Replay in Outcome Studio"], ["reset", "Reset"]])}
    </div>
    <div class="routerun-metrics"><div><span>Scenario</span><strong data-routerun-value="scenario-name">—</strong></div><div><span>Phase</span><strong data-routerun-value="phase">—</strong></div><div><span>Route</span><strong data-routerun-value="route-length">0</strong></div><div><span>Logical tick</span><strong data-routerun-value="tick">0</strong></div><div><span>Terminal</span><strong data-routerun-value="terminal">—</strong></div></div>
    <div class="routerun-main">
      <article class="routerun-board-panel"><div class="routerun-panel-heading"><div><span>BOARD VIEW</span><h3>Explicit directional state</h3></div><small>Preview <i data-legend="preview"></i> Visited <i data-legend="visited"></i> Runner <i data-legend="runner"></i></small></div><div class="routerun-board" data-routerun-board></div></article>
      <aside class="routerun-inspector">
        <div class="routerun-panel-heading"><div><span>INSPECTOR</span><h3>Deterministic runtime</h3></div></div>
        <dl><div><dt>Board dimensions</dt><dd data-routerun-value="dimensions">—</dd></div><div><dt>Active cells</dt><dd data-routerun-value="active-count">—</dd></div><div><dt>Runner coordinate</dt><dd data-routerun-value="runner-coordinate">—</dd></div><div><dt>Current direction</dt><dd data-routerun-value="direction">—</dd></div><div><dt>Illustrative value</dt><dd data-routerun-value="value">—</dd></div><div><dt>Cascade count</dt><dd data-routerun-value="cascades">—</dd></div></dl>
        ${inspectionBlock("Route decisions", "decisions")}${inspectionBlock("Collected overlays", "overlays")}${inspectionBlock("Expansions", "expansions")}${inspectionBlock("Validation", "validation")}
      </aside>
    </div>
    <div class="routerun-lower"><article><div class="routerun-panel-heading"><div><span>TIMELINE</span><h3>Ordered engine events</h3></div></div><ol class="routerun-timeline" data-routerun-timeline></ol></article><article><div class="routerun-panel-heading"><div><span>RECOVERY</span><h3>Current snapshot</h3></div></div><pre data-routerun-value="snapshot">No snapshot saved</pre></article><article><div class="routerun-panel-heading"><div><span>BOARD JSON</span><h3>Raw immutable data</h3></div></div><pre data-routerun-value="raw"></pre></article></div>`;
}

function controlGroup(label: string, buttons: readonly (readonly [string, string])[]): string {
  return `<div><span>${label}</span><div>${buttons.map(([action, text]) => `<button data-routerun-action="${action}">${text}</button>`).join("")}</div></div>`;
}
function inspectionBlock(label: string, key: string): string { return `<section><span>${label}</span><pre data-routerun-value="${key}">—</pre></section>`; }
function summarize(value: unknown): string { const text = JSON.stringify(value); return text.length > 120 ? `${text.slice(0, 117)}…` : text; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
