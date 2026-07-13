import type { RecoverySnapshot, RoundStatus, TransitionRecord } from "./contracts.js";
import type { AssetDebugSnapshot } from "./assets/asset-types.js";
import type { FeatureDebugSnapshot } from "./features/feature-debug.js";
import type { FeatureManifestId } from "./manifests/manifest-types.js";
import type { ThemeDebugSnapshot } from "./themes/theme-types.js";

export interface DebugPanelState {
  readonly currentState: RoundStatus;
  readonly currentRound: string | null;
  readonly currentEvent: string | null;
  readonly currentAnimation: string | null;
  readonly animationQueueLength: number;
  readonly currentSnapshot: RecoverySnapshot | null;
  readonly lastSave: string | null;
  readonly recoveryVersion: number;
  readonly transitionHistory: readonly TransitionRecord[];
  readonly animationCount: number;
  readonly commandsExecuted: number;
  readonly recoveryCount: number;
}

export interface DebugPanelActions {
  readonly pause: () => void;
  readonly resume: () => void;
  readonly skip: () => void;
  readonly skipAll: () => void;
  readonly replayLastRound: () => void | Promise<void>;
  readonly interrupt: () => void;
  readonly recover: () => void | Promise<void>;
  readonly reset: () => void;
  readonly simulateCrash: () => void | Promise<void>;
  readonly generateSmallRound: () => void | Promise<void>;
  readonly generateMediumRound: () => void | Promise<void>;
  readonly generateHugeRound: () => void | Promise<void>;
  readonly generateBadRound: () => void | Promise<void>;
  readonly generateAnimationFailure: () => void | Promise<void>;
  readonly generateRecoveryTest: () => void | Promise<void>;
}

export interface DebugPanelOptions {
  readonly getState: () => DebugPanelState;
  readonly actions: DebugPanelActions;
  readonly mount?: HTMLElement;
  readonly initiallyOpen?: boolean;
  readonly title?: string;
  readonly features?: DebugPanelFeatureIntegration;
  readonly assetThemes?: DebugPanelAssetThemeIntegration;
}

/** Concise, read-only resource projection shared by every future game host. */
export interface DebugPanelAssetThemeSnapshot {
  readonly assets: AssetDebugSnapshot;
  readonly theme: ThemeDebugSnapshot;
}

export interface DebugPanelAssetThemeIntegration {
  readonly getState: () => DebugPanelAssetThemeSnapshot;
}

export interface DebugPanelFeatureActions {
  readonly loadExamples: () => void | Promise<void>;
  readonly setEnabled: (id: FeatureManifestId | string, enabled: boolean) => void | Promise<void>;
  readonly executeEligible: () => void | Promise<void>;
  readonly compareDeterministicRuns: () => void | Promise<void>;
  readonly serializeStates: () => void | Promise<void>;
  readonly clearRuntimeState: () => void | Promise<void>;
  readonly restoreStates: () => void | Promise<void>;
  readonly loadMissingDependency: () => void | Promise<void>;
  readonly loadCircularDependency: () => void | Promise<void>;
  readonly loadConflict: () => void | Promise<void>;
  readonly simulateBlockingFailure: () => void | Promise<void>;
  readonly simulateNonBlockingFailure: () => void | Promise<void>;
  readonly clearRegistry: () => void | Promise<void>;
}

export interface DebugPanelFeatureIntegration {
  readonly getState: () => FeatureDebugSnapshot;
  readonly actions: DebugPanelFeatureActions;
}

export interface DebugEventRecord {
  readonly sequence: number;
  readonly timestamp: number;
  readonly name: string;
  readonly summary: string;
}

export interface DebugPerformanceSnapshot {
  readonly fps: number;
  readonly deltaTime: number;
  readonly frameTime: number;
  readonly averageFrameTime: number;
  readonly worstFrame: number;
}

const STYLE_ID = "hustle-debug-panel-styles";

export class HustleDebugPanel {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly options: DebugPanelOptions;
  private readonly events: DebugEventRecord[] = [];
  private readonly eventTimes: number[] = [];
  private frameTimes: number[] = [];
  private performance: DebugPerformanceSnapshot = {
    fps: 0, deltaTime: 0, frameTime: 0, averageFrameTime: 0, worstFrame: 0,
  };
  private eventSequence = 0;
  private streamPaused = false;
  private filter = "";
  private open: boolean;
  private animationFrame = 0;
  private lastFrameAt = 0;
  private renderTimer = 0;

  constructor(options: DebugPanelOptions) {
    this.options = options;
    this.open = options.initiallyOpen ?? true;
    installStyles();
    this.root = document.createElement("aside");
    this.root.className = "hustle-debug-shell";
    this.root.dataset.open = String(this.open);
    this.root.setAttribute("aria-label", "Hustle Engine Debug Panel");
    this.root.innerHTML = panelMarkup(
      options.title ?? "HUSTLE DEBUG",
      options.features !== undefined,
      options.assetThemes !== undefined,
    );
    this.panel = requireElement(this.root, ".hdebug-panel");
    (options.mount ?? document.body).append(this.root);
    this.bindInteractions();
    this.lastFrameAt = performance.now();
    this.animationFrame = requestAnimationFrame(this.measureFrame);
    this.renderTimer = window.setInterval(() => this.render(), 250);
    this.render();
  }

  recordEvent(name: string, payload?: unknown): void {
    if (this.streamPaused) return;
    const timestamp = Date.now();
    this.eventTimes.push(timestamp);
    this.events.unshift({
      sequence: this.eventSequence,
      timestamp,
      name,
      summary: summarize(payload),
    });
    this.eventSequence += 1;
    this.events.splice(200);
    this.pruneEventTimes(timestamp);
    this.renderEvents();
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.dataset.open = String(this.open);
    this.root.querySelector<HTMLButtonElement>("[data-debug-toggle]")
      ?.setAttribute("aria-expanded", String(this.open));
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    window.clearInterval(this.renderTimer);
    document.removeEventListener("keydown", this.onKeyDown);
    this.root.remove();
  }

  private readonly measureFrame = (now: number): void => {
    const delta = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (delta > 0 && delta < 1_000) {
      this.frameTimes.push(delta);
      this.frameTimes = this.frameTimes.slice(-120);
      const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
      this.performance = {
        fps: Math.round(1_000 / average),
        deltaTime: round(delta),
        frameTime: round(delta),
        averageFrameTime: round(average),
        worstFrame: round(Math.max(...this.frameTimes)),
      };
    }
    this.animationFrame = requestAnimationFrame(this.measureFrame);
  };

  private bindInteractions(): void {
    this.root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!target) return;
      if (target.hasAttribute("data-debug-toggle")) {
        this.toggle();
        return;
      }
      const action = target.dataset.debugAction;
      const featureId = target.dataset.debugFeatureId;
      if (featureId && this.options.features) {
        const enabled = target.dataset.debugFeatureEnabled === "true";
        void this.runFeatureAction(
          () => this.options.features?.actions.setEnabled(featureId, !enabled),
          `feature:${enabled ? "disable" : "enable"}`,
        );
        return;
      }
      if (action === "clear-events") {
        this.events.length = 0;
        this.eventTimes.length = 0;
        this.renderEvents();
        return;
      }
      if (action === "toggle-stream") {
        this.streamPaused = !this.streamPaused;
        target.textContent = this.streamPaused ? "Resume Event Stream" : "Pause Event Stream";
        target.dataset.active = String(this.streamPaused);
        return;
      }
      if (action) void this.runAction(action);
    });
    this.root.querySelector<HTMLInputElement>("[data-debug-filter]")?.addEventListener("input", (event) => {
      this.filter = (event.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderEvents();
    });
    document.addEventListener("keydown", this.onKeyDown);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      this.toggle();
    }
  };

  private async runAction(action: string): Promise<void> {
    const actions: Readonly<Record<string, () => void | Promise<void>>> = {
      pause: this.options.actions.pause,
      resume: this.options.actions.resume,
      skip: this.options.actions.skip,
      "skip-all": this.options.actions.skipAll,
      replay: this.options.actions.replayLastRound,
      interrupt: this.options.actions.interrupt,
      recover: this.options.actions.recover,
      reset: this.options.actions.reset,
      crash: this.options.actions.simulateCrash,
      small: this.options.actions.generateSmallRound,
      medium: this.options.actions.generateMediumRound,
      huge: this.options.actions.generateHugeRound,
      bad: this.options.actions.generateBadRound,
      "animation-failure": this.options.actions.generateAnimationFailure,
      "recovery-test": this.options.actions.generateRecoveryTest,
      ...(this.options.features ? {
        "feature-load": this.options.features.actions.loadExamples,
        "feature-execute": this.options.features.actions.executeEligible,
        "feature-compare": this.options.features.actions.compareDeterministicRuns,
        "feature-serialize": this.options.features.actions.serializeStates,
        "feature-clear-state": this.options.features.actions.clearRuntimeState,
        "feature-restore": this.options.features.actions.restoreStates,
        "feature-missing": this.options.features.actions.loadMissingDependency,
        "feature-cycle": this.options.features.actions.loadCircularDependency,
        "feature-conflict": this.options.features.actions.loadConflict,
        "feature-blocking": this.options.features.actions.simulateBlockingFailure,
        "feature-non-blocking": this.options.features.actions.simulateNonBlockingFailure,
        "feature-clear": this.options.features.actions.clearRegistry,
      } : {}),
    };
    const selected = actions[action];
    if (!selected) return;
    try {
      await selected();
    } catch (error) {
      this.recordEvent("debug:action-failed", { action, error: error instanceof Error ? error.message : String(error) });
    }
    this.render();
  }

  private async runFeatureAction(action: () => void | Promise<void> | undefined, name: string): Promise<void> {
    try { await action(); }
    catch (error) {
      this.recordEvent("debug:action-failed", { action: name, error: error instanceof Error ? error.message : String(error) });
    }
    this.render();
  }

  private render(): void {
    const state = this.options.getState();
    const previous = state.transitionHistory.at(-1)?.from ?? "—";
    const next = nextStates(state.currentState).join(", ") || "—";
    const currentSnapshot = state.currentSnapshot ? JSON.stringify(state.currentSnapshot, null, 2) : "No snapshot";
    this.set("state", state.currentState);
    this.set("round", state.currentRound ?? "—");
    this.set("event", state.currentEvent ?? "—");
    this.set("fps", `${this.performance.fps}`);
    this.set("delta", `${this.performance.deltaTime} ms`);
    this.set("animation", state.currentAnimation ?? "—");
    this.set("queue", `${state.animationQueueLength}`);
    this.set("snapshot", currentSnapshot);
    this.set("last-save", state.lastSave ?? "Never");
    this.set("recovery-version", `v${state.recoveryVersion}`);
    this.set("machine", state.currentState);
    this.set("transitions", formatTransitions(state.transitionHistory));
    this.set("previous", previous);
    this.set("next", next);
    this.set("eps", `${this.eventsPerSecond()}`);
    this.set("animation-count", `${state.animationCount}`);
    this.set("commands", `${state.commandsExecuted}`);
    this.set("recoveries", `${state.recoveryCount}`);
    this.set("frame", `${this.performance.frameTime} ms`);
    this.set("average-frame", `${this.performance.averageFrameTime} ms`);
    this.set("worst-frame", `${this.performance.worstFrame} ms`);
    this.renderFeatures();
    this.renderAssetThemes();
    this.renderEvents();
  }

  private renderAssetThemes(): void {
    const integration = this.options.assetThemes;
    if (!integration) return;
    const { assets, theme } = integration.getState();
    const progress = assets.progress;
    const latestThemeEvent = theme.latestEvents.at(-1);
    const selection = theme.activeSelection;
    const appliedThemes = new Set(theme.appliedThemeIds.map(String));
    const overrides = theme.registeredThemes
      .filter(({ id, layer }) => appliedThemes.has(String(id)) &&
        (layer === "operator" || layer === "seasonal" || layer === "accessibility"))
      .map(({ id }) => id);
    this.set("asset-count", `${assets.registeredCount}`);
    this.set("asset-loaded", `${assets.loadedCount}`);
    this.set("asset-pending", `${assets.pendingCount}`);
    this.set("asset-failed", `${assets.failedCount}`);
    this.set("asset-cache-bytes", formatEstimatedBytes(assets.estimatedCacheBytes));
    this.set("asset-preload-group", assets.activePreloadGroup ?? "Idle");
    this.set("asset-progress", progress
      ? `${progress.completedCount}/${progress.requestedCount} · ${Math.round(progress.fraction * 100)}%`
      : "No active preload");
    this.set("asset-latest-event", assets.latestEvent?.type ?? "No asset events");
    this.set("theme-composition", theme.appliedThemeIds.join(" → ") || "No active theme");
    this.set("theme-base", selection?.base ?? "—");
    this.set("theme-game", selection?.game ?? "—");
    this.set("theme-overrides", overrides.join(" → ") || "None");
    this.set("theme-token-count", `${Object.keys(theme.tokens).length}`);
    this.set("theme-alias-count", `${Object.keys(theme.assetAliases).length}`);
    this.set("theme-latest-event", latestThemeEvent?.type ?? "No theme events");
  }

  private renderFeatures(): void {
    const integration = this.options.features;
    if (!integration) return;
    const snapshot = integration.getState();
    this.set("feature-count", `${snapshot.registeredFeatures.length}`);
    this.set("feature-order", snapshot.executionOrder.join(" → ") || "No enabled features");
    this.set("feature-state", snapshot.serializedState ? JSON.stringify(snapshot.serializedState, null, 2) : "Not serialized");
    this.set("feature-events", snapshot.latestEvents.map(({ type }) => type).join("\n") || "No feature events");
    this.set("feature-errors", snapshot.latestErrors.map(({ error }) => `[${error.code}] ${error.message}`).join("\n") || "No feature errors");
    this.set("feature-warnings", snapshot.latestWarnings.map(({ warning }) => `[${warning.code}] ${warning.message}`).join("\n") || "No feature warnings");
    const list = this.root.querySelector<HTMLElement>("[data-debug-feature-list]");
    if (!list) return;
    list.replaceChildren(...snapshot.registeredFeatures.map((feature) => {
      const row = document.createElement("div");
      row.className = "hdebug-feature-row";
      const details = document.createElement("span");
      details.innerHTML = `<strong>${escapeHtml(feature.id)}</strong><small>${escapeHtml(feature.lifecycleStatus)} · p${feature.priority} · ${feature.executionCount} run${feature.executionCount === 1 ? "" : "s"}</small>`;
      const toggle = document.createElement("button");
      toggle.dataset.debugFeatureId = feature.id;
      toggle.dataset.debugFeatureEnabled = String(feature.enabled);
      toggle.textContent = feature.enabled ? "Disable" : "Enable";
      toggle.setAttribute("aria-label", `${toggle.textContent} ${feature.name}`);
      row.append(details, toggle);
      return row;
    }));
    if (snapshot.registeredFeatures.length === 0) list.textContent = "No features registered";
  }

  private renderEvents(): void {
    const container = this.root.querySelector<HTMLElement>("[data-debug-value='event-log']");
    if (!container) return;
    const visible = this.events.filter((event) => !this.filter ||
      `${event.name} ${event.summary}`.toLowerCase().includes(this.filter));
    container.replaceChildren(...visible.slice(0, 80).map((event) => {
      const line = document.createElement("div");
      line.className = "hdebug-event";
      const time = new Date(event.timestamp).toLocaleTimeString([], { hour12: false });
      line.innerHTML = `<span>${escapeHtml(time)}</span><strong>${escapeHtml(event.name)}</strong><code>${escapeHtml(event.summary)}</code>`;
      return line;
    }));
    if (visible.length === 0) container.textContent = this.streamPaused ? "Event stream paused" : "No matching events";
  }

  private eventsPerSecond(): number {
    const now = Date.now();
    this.pruneEventTimes(now);
    return this.eventTimes.length;
  }

  private pruneEventTimes(now: number): void {
    while (this.eventTimes[0] !== undefined && this.eventTimes[0] < now - 1_000) this.eventTimes.shift();
  }

  private set(key: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(`[data-debug-value='${key}']`);
    if (element && element.textContent !== value) element.textContent = value;
  }
}

export function installHustleDebugPanel(options: DebugPanelOptions): HustleDebugPanel {
  return new HustleDebugPanel(options);
}

function panelMarkup(title: string, includeFeatures: boolean, includeAssetThemes: boolean): string {
  return `
    <button class="hdebug-edge" data-debug-toggle aria-label="Toggle debug panel" aria-expanded="true"><span>DEBUG</span><b>⌘⇧D</b></button>
    <div class="hdebug-panel">
      <header><div><span>HUSTLE ENGINE</span><h2>${escapeHtml(title)}</h2></div><button data-debug-toggle aria-label="Collapse debug panel">×</button></header>
      <div class="hdebug-scroll">
        ${section("GAME", rows([
          ["Current State", "state"], ["Current Round", "round"], ["Current Event", "event"], ["FPS", "fps"],
          ["Delta Time", "delta"], ["Current Animation", "animation"], ["Animation Queue Length", "queue"],
        ]))}
        ${includeFeatures ? featureSection() : ""}
        ${includeAssetThemes ? assetThemeSections() : ""}
        ${section("MEMORY", rows([["Current Snapshot", "snapshot", "pre"], ["Last Save", "last-save"], ["Recovery Version", "recovery-version"]]))}
        ${section("EVENTS", `<input data-debug-filter type="search" placeholder="Filter events" aria-label="Filter events"><div class="hdebug-event-actions">${button("toggle-stream", "Pause Event Stream")}${button("clear-events", "Clear Log")}</div><div class="hdebug-event-log" data-debug-value="event-log"></div>`)}
        ${section("ANIMATIONS", actionGrid([["pause", "Pause"], ["resume", "Resume"], ["skip", "Skip"], ["skip-all", "Skip All"], ["replay", "Replay Last Round"]]))}
        ${section("STATE", rows([["Current State Machine", "machine"], ["Transition History", "transitions", "pre"], ["Previous State", "previous"], ["Next State", "next"]]))}
        ${section("TELEMETRY", rows([["Events Per Second", "eps"], ["Animation Count", "animation-count"], ["Commands Executed", "commands"], ["Recovery Count", "recoveries"]]))}
        ${section("PERFORMANCE", rows([["Frame Time", "frame"], ["Average Frame Time", "average-frame"], ["Worst Frame", "worst-frame"]]))}
        ${section("INPUT", actionGrid([["pause", "Pause"], ["resume", "Resume"], ["interrupt", "Interrupt"], ["recover", "Recover"], ["reset", "Reset"], ["crash", "Simulate Crash"]]))}
        ${section("TESTING", actionGrid([["small", "Generate Small Round"], ["medium", "Generate Medium Round"], ["huge", "Generate Huge Round"], ["bad", "Generate Bad Round"], ["animation-failure", "Generate Animation Failure"], ["recovery-test", "Generate Recovery Test"]]))}
      </div>
    </div>`;
}

function assetThemeSections(): string {
  return `${section("ASSETS", rows([
    ["Registered Count", "asset-count"],
    ["Loaded Count", "asset-loaded"],
    ["Pending Count", "asset-pending"],
    ["Failed Count", "asset-failed"],
    ["Estimated Cache Bytes", "asset-cache-bytes"],
    ["Active Preload Group", "asset-preload-group"],
    ["Progress", "asset-progress"],
    ["Latest Asset Event", "asset-latest-event"],
  ]))}${section("THEME", rows([
    ["Active Composition", "theme-composition", "pre"],
    ["Current Base Theme", "theme-base"],
    ["Game Theme", "theme-game"],
    ["Active Overrides", "theme-overrides", "pre"],
    ["Token Count", "theme-token-count"],
    ["Current Asset Alias Count", "theme-alias-count"],
    ["Latest Theme Event", "theme-latest-event"],
  ]))}`;
}

function featureSection(): string {
  return section("FEATURES", `${rows([
    ["Registered", "feature-count"],
    ["Execution Order", "feature-order", "pre"],
    ["Serialized State", "feature-state", "pre"],
    ["Latest Events", "feature-events", "pre"],
    ["Latest Errors", "feature-errors", "pre"],
    ["Latest Warnings", "feature-warnings", "pre"],
  ])}<div class="hdebug-feature-list" data-debug-feature-list></div>${actionGrid([
    ["feature-load", "Load Examples"],
    ["feature-execute", "Execute Eligible"],
    ["feature-compare", "Compare Two Runs"],
    ["feature-serialize", "Serialize States"],
    ["feature-clear-state", "Clear Runtime State"],
    ["feature-restore", "Restore States"],
    ["feature-missing", "Missing Dependency"],
    ["feature-cycle", "Circular Dependency"],
    ["feature-conflict", "Conflict"],
    ["feature-blocking", "Blocking Failure"],
    ["feature-non-blocking", "Non-blocking Failure"],
    ["feature-clear", "Clear Registry"],
  ])}`);
}

function section(title: string, body: string): string {
  return `<section class="hdebug-section"><h3>${title}</h3>${body}</section>`;
}

function rows(items: readonly (readonly [string, string, string?])[]): string {
  return `<dl>${items.map(([label, key, type]) => `<div class="${type === "pre" ? "hdebug-stack" : ""}"><dt>${label}</dt><dd class="${type === "pre" ? "hdebug-pre" : ""}" data-debug-value="${key}">—</dd></div>`).join("")}</dl>`;
}

function actionGrid(items: readonly (readonly [string, string])[]): string {
  return `<div class="hdebug-actions">${items.map(([action, label]) => button(action, label)).join("")}</div>`;
}

function button(action: string, label: string): string {
  return `<button data-debug-action="${action}">${label}</button>`;
}

function formatTransitions(history: readonly TransitionRecord[]): string {
  return history.length === 0 ? "No transitions" : history.slice(-12).map((record) => `${record.sequence}  ${record.from} → ${record.to}`).join("\n");
}

function nextStates(state: RoundStatus): readonly RoundStatus[] {
  const transitions: Readonly<Record<RoundStatus, readonly RoundStatus[]>> = {
    idle: ["requesting", "recovering"], requesting: ["received", "failed"], received: ["presenting", "failed"],
    presenting: ["interrupted", "completed", "failed"], interrupted: ["recovering", "idle", "failed"],
    recovering: ["presenting", "completed", "failed"], completed: ["idle", "requesting", "recovering"],
    failed: ["idle", "requesting", "recovering"],
  };
  return transitions[state];
}

function summarize(payload: unknown): string {
  if (payload === undefined) return "";
  try {
    const value = JSON.stringify(payload);
    return value.length > 220 ? `${value.slice(0, 217)}…` : value;
  } catch {
    return "[unserializable]";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatEstimatedBytes(value: number): string {
  if (value < 1_024) return `${value} B est.`;
  if (value < 1_024 * 1_024) return `${round(value / 1_024)} KiB est.`;
  return `${round(value / (1_024 * 1_024))} MiB est.`;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Debug panel element missing: ${selector}`);
  return element;
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DEBUG_PANEL_CSS;
  document.head.append(style);
}

const DEBUG_PANEL_CSS: string = `
.hustle-debug-shell{--hd-bg:#0b0e14;--hd-card:#111722;--hd-line:#252d3b;--hd-text:#e8edf6;--hd-muted:#7f8ba1;--hd-accent:#54e6bd;position:fixed;z-index:99999;inset:0 0 0 auto;width:min(410px,92vw);pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--hd-text)}
.hdebug-panel{height:100%;background:linear-gradient(180deg,#0f141e 0%,var(--hd-bg) 100%);border-left:1px solid var(--hd-line);box-shadow:-18px 0 50px #0008;transform:translateX(0);transition:transform .24s ease;pointer-events:auto;display:flex;flex-direction:column}
.hustle-debug-shell[data-open=false] .hdebug-panel{transform:translateX(100%)}
.hdebug-edge{position:absolute;right:100%;top:80px;width:42px;padding:10px 7px;border:1px solid var(--hd-line);border-right:0;border-radius:8px 0 0 8px;background:#111722;color:var(--hd-text);pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:-8px 6px 20px #0005;cursor:pointer}
.hdebug-edge span{font-size:10px;font-weight:800;letter-spacing:.16em;writing-mode:vertical-rl;transform:rotate(180deg)}.hdebug-edge b{font-size:8px;color:var(--hd-muted)}
.hdebug-panel header{display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:1px solid var(--hd-line);background:#111722cc;backdrop-filter:blur(14px)}
.hdebug-panel header span{font-size:9px;letter-spacing:.2em;color:var(--hd-accent);font-weight:800}.hdebug-panel header h2{font-size:17px;letter-spacing:.04em;margin:3px 0 0}
.hdebug-panel header button{width:32px;height:32px;border:1px solid var(--hd-line);border-radius:7px;background:#171e2b;color:var(--hd-muted);font-size:21px;cursor:pointer}
.hdebug-scroll{overflow-y:auto;overscroll-behavior:contain;padding:0 18px 40px;scrollbar-width:thin;scrollbar-color:#364258 transparent}
.hdebug-section{padding:19px 0;border-bottom:1px solid var(--hd-line)}.hdebug-section h3{margin:0 0 12px;color:var(--hd-accent);font-size:10px;letter-spacing:.18em}
.hdebug-section dl{margin:0}.hdebug-section dl>div{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:6px 0}.hdebug-section dt{font-size:11px;color:var(--hd-muted)}.hdebug-section dd{font-size:11px;margin:0;text-align:right;max-width:62%;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.hdebug-section .hdebug-stack{display:block}.hdebug-stack dd{max-width:none;text-align:left;margin-top:7px}.hdebug-pre{white-space:pre-wrap;max-height:150px;overflow:auto;background:#080b10;border:1px solid #1c2330;border-radius:6px;padding:9px!important;color:#9eabc0!important;font-size:9px!important;line-height:1.5}
.hdebug-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.hdebug-actions button,.hdebug-event-actions button{min-height:32px;padding:7px 9px;border:1px solid #2a3547;border-radius:6px;background:#171e2b;color:#c8d1df;font:600 10px/1.2 inherit;cursor:pointer;text-align:left}.hdebug-actions button:hover,.hdebug-event-actions button:hover{border-color:#4c6a6b;color:#fff;background:#1c2635}.hdebug-actions button:active{transform:translateY(1px)}
.hdebug-section input{width:100%;height:34px;border:1px solid #293345;border-radius:6px;background:#080b10;color:var(--hd-text);padding:0 10px;outline:none;font:11px inherit}.hdebug-section input:focus{border-color:var(--hd-accent)}
.hdebug-event-actions{display:flex;gap:7px;margin:8px 0}.hdebug-event-actions button{flex:1}.hdebug-event-actions button[data-active=true]{border-color:#e5aa55;color:#ffdca4}
.hdebug-event-log{min-height:100px;max-height:250px;overflow:auto;background:#080b10;border:1px solid #1c2330;border-radius:6px;padding:4px;color:#647087;font:9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
.hdebug-event{display:grid;grid-template-columns:54px minmax(88px,auto) 1fr;gap:6px;padding:5px;border-bottom:1px solid #151b25}.hdebug-event span{color:#4f5b6f}.hdebug-event strong{color:#73d7bd;font-weight:600}.hdebug-event code{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#8996aa}
.hdebug-feature-list{display:grid;gap:6px;margin:9px 0}.hdebug-feature-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #222d3d;border-radius:6px;background:#0a0e15;padding:8px}.hdebug-feature-row span{min-width:0;display:grid;gap:3px}.hdebug-feature-row strong{overflow-wrap:anywhere;color:#c7d2e1;font:9px ui-monospace,SFMono-Regular,Menlo,monospace}.hdebug-feature-row small{color:#718096;font-size:8px}.hdebug-feature-row button{flex:0 0 auto;border:1px solid #2f4e50;border-radius:5px;background:#15282a;color:#8de6cf;padding:5px 7px;font:700 8px inherit;cursor:pointer}
@media(max-width:600px){.hustle-debug-shell{width:min(360px,90vw)}.hdebug-edge{top:60px}}
@media(prefers-reduced-motion:reduce){.hdebug-panel{transition:none}}
`;
