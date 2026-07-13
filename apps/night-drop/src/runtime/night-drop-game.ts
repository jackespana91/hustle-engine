import type { RoundStatus, TransitionRecord } from "@hustle/core";
import {
  ROUTERUN_SNAPSHOT_SCHEMA_VERSION,
  RouteRunEngine,
  SequenceRefillProvider,
  type RouteRunEngineInspection,
  type RouteRunSnapshot,
} from "@hustle/routerun";
import { NIGHT_DROP_SCENARIOS, getNightDropScenario, type NightDropScenarioConfig } from "../board/night-drop-board.js";
import { createNightDropFeaturePack, type NightDropFeaturePack } from "../features/index.js";

export interface NightDropRuntimeView {
  readonly lifecycle: RoundStatus;
  readonly inspection: RouteRunEngineInspection;
  readonly scenario: NightDropScenarioConfig;
  readonly balanceMinor: number;
  readonly betMinor: number;
  readonly winMinor: number;
  readonly fiveStar: number;
  readonly priorityJobs: number;
  readonly multiplier: number;
  readonly message: string;
  readonly paused: boolean;
  readonly canRecover: boolean;
  readonly recoveryCount: number;
  readonly lastSave: string | null;
  readonly transitions: readonly TransitionRecord[];
}

type Listener = (view: NightDropRuntimeView) => void;

export class NightDropGame {
  private engineValue: RouteRunEngine;
  private featurePackValue: NightDropFeaturePack;
  private scenarioValue = getNightDropScenario("perfect-route");
  private lifecycleValue: RoundStatus = "idle";
  private transitionsValue: TransitionRecord[] = [];
  private listeners = new Set<Listener>();
  private pausedValue = false;
  private skipDelay = false;
  private skipEverything = false;
  private runToken = 0;
  private snapshotValue: RouteRunSnapshot | null = null;
  private lastSaveValue: string | null = null;
  private recoveryCountValue = 0;
  private balanceValue = 10_000;
  private winValue = 0;
  private messageValue = "Mara: Quiet night. Which is usually when Dash gets creative.";

  constructor() {
    this.featurePackValue = createNightDropFeaturePack();
    this.engineValue = new RouteRunEngine({ featureBridge: this.featurePackValue.bridge });
    this.initializeScenario();
  }

  get featurePack(): NightDropFeaturePack { return this.featurePackValue; }
  get scenario(): NightDropScenarioConfig { return structuredClone(this.scenarioValue); }
  get inspection(): RouteRunEngineInspection { return this.engineValue.inspect(); }
  get snapshot(): RouteRunSnapshot | null { return this.snapshotValue ? structuredClone(this.snapshotValue) : null; }
  get lifecycle(): RoundStatus { return this.lifecycleValue; }
  get transitions(): readonly TransitionRecord[] { return structuredClone(this.transitionsValue); }
  get recoveryCount(): number { return this.recoveryCountValue; }
  get lastSave(): string | null { return this.lastSaveValue; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.view());
    return () => this.listeners.delete(listener);
  }

  select(id: string): void {
    if (this.lifecycleValue === "presenting") return;
    this.scenarioValue = getNightDropScenario(id);
    this.reset(false);
  }

  async play(): Promise<void> {
    if (this.lifecycleValue === "presenting" || this.lifecycleValue === "requesting") return;
    const token = ++this.runToken;
    this.snapshotValue = null;
    this.winValue = 0;
    this.skipEverything = false;
    this.pausedValue = false;
    this.transition("requesting", "play pressed");
    this.balanceValue = Math.max(0, this.balanceValue - this.scenarioValue.betMinor);
    this.messageValue = "Mara: Package is moving. Definition of ‘carefully’ remains under review.";
    this.initializeScenario();
    if (this.scenarioValue.expansion) {
      this.engineValue.applyExpansion(this.scenarioValue.expansion);
      this.emit();
      await this.delay(600, token);
    }
    this.engineValue.previewRoute();
    this.transition("received", "deterministic RouteRun outcome loaded");
    this.transition("presenting", "presentation started");
    await this.playCurrentRoute(token);
    if (token !== this.runToken) return;
    if (this.scenarioValue.flags.continuation && this.scenarioValue.continuationRefill) {
      this.engineValue.clearRoute();
      this.engineValue.applyCascade(new SequenceRefillProvider(this.scenarioValue.continuationRefill));
      const continuation = this.engineValue.checkContinuation();
      this.messageValue = continuation.available
        ? "Mara: New route. Same package. Different opportunity for regret."
        : "Mara: Route ended early. The building won.";
      this.emit();
      await this.delay(520, token);
      if (continuation.available) await this.playCurrentRoute(token);
    }
    if (token !== this.runToken) return;
    this.winValue = this.scenarioValue.winMinor;
    this.balanceValue += this.winValue;
    this.messageValue = this.scenarioValue.flags.deadEnd
      ? "Mara: That is a wall, Dash. A very committed wall."
      : "Mara: Delivered. Against several excellent reasons.";
    this.transition("completed", "destination presentation complete");
  }

  pause(): void { this.pausedValue = true; this.emit(); }
  resume(): void { this.pausedValue = false; this.emit(); }
  skip(): void { this.skipDelay = true; }
  skipAll(): void { this.skipEverything = true; this.pausedValue = false; }

  interrupt(): void {
    if (this.lifecycleValue !== "presenting" || this.engineValue.phase !== "moving") return;
    this.snapshotValue = this.engineValue.interrupt();
    this.lastSaveValue = new Date().toLocaleTimeString([], { hour12: false });
    this.runToken += 1;
    this.messageValue = "Mara: Signal lost. The bad decision has been safely bookmarked.";
    this.transition("interrupted", "presentation interrupted");
  }

  async recover(): Promise<void> {
    if (!this.snapshotValue) return;
    const token = ++this.runToken;
    this.transition("recovering", "restoring RouteRun snapshot");
    this.engineValue.restoreSnapshot(this.snapshotValue);
    this.recoveryCountValue += 1;
    this.messageValue = "Mara: We are back. Nobody touch anything clever.";
    this.transition("presenting", "snapshot restored");
    await this.playCurrentRoute(token);
    if (token !== this.runToken) return;
    this.winValue = this.scenarioValue.winMinor;
    this.balanceValue += this.winValue;
    this.messageValue = "Mara: Recovered and delivered. Please do not call that a strategy.";
    this.transition("completed", "recovered presentation complete");
  }

  async replay(): Promise<void> { this.reset(false); await this.play(); }

  reset(resetBalance = false): void {
    this.runToken += 1;
    this.pausedValue = false;
    this.skipEverything = false;
    this.skipDelay = false;
    this.snapshotValue = null;
    this.winValue = 0;
    if (resetBalance) this.balanceValue = 10_000;
    this.messageValue = "Mara: Route reset. Dash is pretending this was the plan.";
    this.transition("idle", "game reset", true);
    this.initializeScenario();
  }

  view(): NightDropRuntimeView {
    const inspection = this.engineValue.inspect();
    const fiveStar = Math.min(5, inspection.collectedOverlays.filter(({ overlayId }) => {
      const source = inspection.boardDefinition?.cells.flatMap((cell) => cell.overlays).find(({ id }) => id === overlayId);
      return source?.metadata.fiveStar === true;
    }).length);
    return {
      lifecycle: this.lifecycleValue,
      inspection,
      scenario: structuredClone(this.scenarioValue),
      balanceMinor: this.balanceValue,
      betMinor: this.scenarioValue.betMinor,
      winMinor: this.winValue,
      fiveStar,
      priorityJobs: this.scenarioValue.activeFeatures.includes("feature.night-drop.priority-jobs") ? inspection.collectedOverlays.length : 0,
      multiplier: this.scenarioValue.multiplier,
      message: this.messageValue,
      paused: this.pausedValue,
      canRecover: this.snapshotValue !== null,
      recoveryCount: this.recoveryCountValue,
      lastSave: this.lastSaveValue,
      transitions: structuredClone(this.transitionsValue),
    };
  }

  debugRouteState() {
    const state = this.engineValue.inspect();
    const board = state.board;
    return {
      engineVersion: state.engineVersion,
      phase: state.phase,
      boardSize: board ? `${board.width}×${board.height}` : "—",
      activeCells: board?.cells.filter(({ state: cellState }) => cellState === "active").length ?? 0,
      runnerPosition: state.runner ? `${state.runner.currentCoordinate.row}:${state.runner.currentCoordinate.column}` : "—",
      routeLength: state.preview?.steps.length ?? 0,
      currentStep: state.completedRouteSteps.length,
      overlaysCollected: state.collectedOverlays.length,
      cascadeCount: state.completedCascades.length,
      expansionCount: state.activeExpansions.length,
      terminalReason: state.terminalState?.reason ?? "—",
      currentSnapshotVersion: ROUTERUN_SNAPSHOT_SCHEMA_VERSION,
      latestEvent: state.latestEvent ?? "—",
      latestIssue: state.latestIssue ?? "None",
    };
  }

  private initializeScenario(): void {
    this.featurePackValue = createNightDropFeaturePack();
    this.engineValue.dispose();
    this.engineValue = new RouteRunEngine({ featureBridge: this.featurePackValue.bridge });
    this.engineValue.initialize(this.scenarioValue.board, this.scenarioValue.runner, `night-drop:${this.scenarioValue.id}`);
    this.emit();
  }

  private async playCurrentRoute(token: number): Promise<void> {
    if (!this.engineValue.inspect().preview) this.engineValue.previewRoute();
    let automaticInterruptDone = false;
    while (token === this.runToken && this.engineValue.phase !== "terminal") {
      await this.waitWhilePaused(token);
      if (token !== this.runToken) return;
      this.engineValue.playRoute({ maximumNewSteps: 1 });
      const inspection = this.engineValue.inspect();
      this.emit();
      if (this.scenarioValue.flags.interrupted && !automaticInterruptDone && inspection.completedRouteSteps.length === 2 && this.engineValue.phase === "moving") {
        automaticInterruptDone = true;
        this.interrupt();
        return;
      }
      await this.delay(this.skipEverything ? 0 : 360, token);
    }
  }

  private async waitWhilePaused(token: number): Promise<void> {
    while (this.pausedValue && token === this.runToken) await new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  private async delay(ms: number, token: number): Promise<void> {
    const start = performance.now();
    while (token === this.runToken && performance.now() - start < ms) {
      if (this.skipDelay || this.skipEverything) { this.skipDelay = false; return; }
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }
  }

  private transition(next: RoundStatus, reason: string, force = false): void {
    const previous = this.lifecycleValue;
    if (previous === next && !force) { this.emit(); return; }
    this.lifecycleValue = next;
    this.transitionsValue.push({ from: previous, to: next, sequence: this.transitionsValue.length, reason });
    this.emit();
  }

  private emit(): void {
    const view = this.view();
    this.listeners.forEach((listener) => listener(view));
  }
}

export const NIGHT_DROP_OUTCOME_IDS = NIGHT_DROP_SCENARIOS.map(({ id }) => id);
