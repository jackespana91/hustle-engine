import { TypedEventBus, type AnimationCommand } from "@hustle/core";
import { BoardError } from "./board/board-errors.js";
import { BoardModel } from "./board/board-model.js";
import { coordinateKey, type BoardDefinition, type Coordinate, type Direction } from "./board/board-types.js";
import { validateBoard } from "./board/board-validator.js";
import { clearTraversedCells } from "./cascade/clear-resolver.js";
import { resolveCascade } from "./cascade/cascade-resolver.js";
import type { CascadeReport, ClearReport, RefillProvider } from "./cascade/cascade-types.js";
import { applyBoardExpansion } from "./expansion/expansion-manager.js";
import type { ExpansionDefinition, ExpansionReport } from "./expansion/expansion-types.js";
import { applyRouteRunFeatureResult, type AppliedRouteRunFeatureResult, type RouteRunFeatureBridge, type RouteRunFeatureContext } from "./features/routerun-feature-context.js";
import type { RouteRunFeatureHook } from "./features/routerun-feature-hooks.js";
import { collectRouteOverlays } from "./overlays/overlay-collector.js";
import type { OverlayCollection } from "./overlays/overlay-types.js";
import { toJsonObject } from "./outcomes/routerun-event-translator.js";
import type { RouteRunOutcomeEventType, RouteRunTimelineEvent } from "./outcomes/routerun-outcome-types.js";
import { parseRouteRunSnapshot, ROUTERUN_SNAPSHOT_SCHEMA_VERSION, type RouteRunPhase, type RouteRunSnapshot, type RouteRunTerminalState } from "./recovery/routerun-snapshot.js";
import { validateRouteRunSnapshot } from "./recovery/routerun-recovery.js";
import { createRoutePreview } from "./route/route-preview.js";
import { RouteSolver } from "./route/route-solver.js";
import type { RouteContinuationCheck, RoutePreview, RouteResolution, RouteSolverOptions, RouteStep } from "./route/route-types.js";
import { applyRunnerStep, finalizeRunner } from "./runner/runner-controller.js";
import { createRunnerState } from "./runner/runner-state.js";
import type { PlaceRunnerInput, RunnerState } from "./runner/runner-types.js";
import { cascadeCommands, clearCommands, expansionCommands, overlayCommand, routePreviewCommand, runnerStepCommand, terminalCommand } from "./routerun-animation.js";
import { ROUTERUN_ENGINE_VERSION } from "./routerun-manifest.js";

export interface RouteRunSafetyLimits {
  readonly maximumBoardWidth: number;
  readonly maximumBoardHeight: number;
  readonly maximumActiveCells: number;
  readonly maximumRouteSteps: number;
  readonly maximumOverlaysPerCell: number;
  readonly maximumCascadeCount: number;
  readonly maximumExpansionCount: number;
}

export const DEFAULT_ROUTERUN_LIMITS: RouteRunSafetyLimits = {
  maximumBoardWidth: 16,
  maximumBoardHeight: 16,
  maximumActiveCells: 256,
  maximumRouteSteps: 256,
  maximumOverlaysPerCell: 12,
  maximumCascadeCount: 12,
  maximumExpansionCount: 8,
};

export interface RouteRunEngineOptions {
  readonly limits?: Partial<RouteRunSafetyLimits>;
  readonly featureBridge?: RouteRunFeatureBridge;
  readonly fallbackPriority?: readonly Direction[];
  readonly allowJunctionFallback?: boolean;
}

export interface RouteRunEngineEventMap {
  "routerun.board.initialize": { readonly event: RouteRunTimelineEvent };
  "routerun.runner.place": { readonly event: RouteRunTimelineEvent };
  "routerun.route.resolve": { readonly event: RouteRunTimelineEvent };
  "routerun.route.preview": { readonly event: RouteRunTimelineEvent };
  "routerun.runner.move": { readonly event: RouteRunTimelineEvent };
  "routerun.overlay.collect": { readonly event: RouteRunTimelineEvent };
  "routerun.cells.clear": { readonly event: RouteRunTimelineEvent };
  "routerun.cascade.apply": { readonly event: RouteRunTimelineEvent };
  "routerun.expansion.apply": { readonly event: RouteRunTimelineEvent };
  "routerun.round.terminal": { readonly event: RouteRunTimelineEvent };
}

export interface RouteRunEngineInspection {
  readonly engineVersion: string;
  readonly phase: RouteRunPhase;
  readonly boardDefinition: BoardDefinition | null;
  readonly board: BoardDefinition | null;
  readonly runner: RunnerState | null;
  readonly preview: RoutePreview | null;
  readonly completedRouteSteps: readonly RouteStep[];
  readonly collectedOverlays: readonly OverlayCollection[];
  readonly completedCascades: readonly CascadeReport[];
  readonly activeExpansions: readonly ExpansionReport[];
  readonly terminalState: RouteRunTerminalState | null;
  readonly logicalTick: number;
  readonly timeline: readonly RouteRunTimelineEvent[];
  readonly animationCommands: readonly AnimationCommand[];
  readonly featureApplications: readonly AppliedRouteRunFeatureResult[];
  readonly latestEvent: string | null;
  readonly latestIssue: string | null;
  readonly validationErrors: readonly string[];
}

export interface PlayRouteOptions {
  /** Omit to play every remaining step; use 1 for deterministic single-step presentation. */
  readonly maximumNewSteps?: number;
}

export class RouteRunEngine {
  readonly events = new TypedEventBus<RouteRunEngineEventMap>();
  readonly limits: RouteRunSafetyLimits;
  private phaseValue: RouteRunPhase = "idle";
  private originalBoard: BoardDefinition | null = null;
  private boardModel: BoardModel | null = null;
  private runnerState: RunnerState | null = null;
  private routePreview: RoutePreview | null = null;
  private completedSteps: RouteStep[] = [];
  private collections: OverlayCollection[] = [];
  private cascades: CascadeReport[] = [];
  private expansions: ExpansionReport[] = [];
  private terminal: RouteRunTerminalState | null = null;
  private tick = 0;
  private timelineEvents: RouteRunTimelineEvent[] = [];
  private commands: AnimationCommand[] = [];
  private operations = new Set<string>();
  private featureApplicationsValue: AppliedRouteRunFeatureResult[] = [];
  private latestIssueValue: string | null = null;
  private currentOutcomeReference: string | null = null;
  private pendingRefillData: unknown | null = null;
  private disposed = false;
  private readonly featureBridge: RouteRunFeatureBridge | undefined;
  private readonly fallbackPriority: readonly Direction[] | undefined;
  private readonly allowJunctionFallback: boolean;

  constructor(options: RouteRunEngineOptions = {}) {
    this.limits = { ...DEFAULT_ROUTERUN_LIMITS, ...(options.limits ?? {}) };
    this.featureBridge = options.featureBridge;
    this.fallbackPriority = options.fallbackPriority;
    this.allowJunctionFallback = options.allowJunctionFallback ?? true;
    assertSafeLimits(this.limits);
  }

  get phase(): RouteRunPhase { return this.phaseValue; }

  initialize(board: BoardDefinition, runner?: PlaceRunnerInput, outcomeReference: string | null = null): void {
    this.ensureUsable();
    if (this.phaseValue !== "idle") this.reset();
    this.transition("initializing");
    this.invokeFeature("before-board-created");
    this.loadBoardInternal(board);
    this.currentOutcomeReference = outcomeReference;
    this.emit("routerun.board.initialize", { boardId: board.id, width: board.width, height: board.height });
    this.invokeFeature("after-board-created");
    if (runner) this.placeRunner(runner, true);
    this.transition("idle");
  }

  loadBoard(board: BoardDefinition): void {
    this.ensureUsable();
    if (this.phaseValue !== "idle") throw this.phaseError("loadBoard");
    this.loadBoardInternal(board);
  }

  placeRunner(input: PlaceRunnerInput, duringInitialization = false): RunnerState {
    this.ensureUsable();
    const board = this.requireBoard();
    if (!duringInitialization && this.phaseValue !== "idle") throw this.phaseError("placeRunner");
    this.runnerState = createRunnerState(board, input);
    this.emit("routerun.runner.place", { runner: this.runnerState });
    return structuredClone(this.runnerState);
  }

  resolveRoute(options: RouteSolverOptions = {}): RouteResolution {
    this.ensureReadyForRoute("resolveRoute");
    this.transition("previewing");
    this.invokeFeature("before-route-solved");
    try {
      const resolution = new RouteSolver(this.requireBoard()).resolve(this.requireRunner(), this.solverOptions(options));
      this.routePreview = createRoutePreview(resolution);
      this.tick = Math.max(this.tick, resolution.logicalTick);
      this.emit("routerun.route.resolve", { signature: resolution.deterministicSignature, terminalReason: resolution.terminalReason, steps: resolution.steps });
      this.invokeFeature("after-route-solved");
      this.transition("idle");
      return structuredClone(resolution);
    } catch (error) {
      this.latestIssueValue = error instanceof Error ? error.message : String(error);
      this.transition("failed");
      throw error;
    }
  }

  previewRoute(options: RouteSolverOptions = {}): RoutePreview {
    const resolution = this.resolveRoute(options);
    const preview = createRoutePreview(resolution);
    this.routePreview = preview;
    this.commands.push(routePreviewCommand(preview));
    this.emit("routerun.route.preview", { signature: preview.deterministicSignature, routeLength: preview.steps.length, decisions: preview.decisions }, "routerun.route.highlight", 180);
    return structuredClone(preview);
  }

  playRoute(options: PlayRouteOptions = {}): readonly RouteStep[] {
    this.ensureUsable();
    if (this.phaseValue !== "idle" && this.phaseValue !== "moving") throw this.phaseError("playRoute");
    const preview = this.routePreview ?? this.previewRoute();
    this.transition("moving");
    this.invokeFeature("before-runner-moves");
    const pending = preview.steps.filter((step) => !this.operations.has(`step:${step.sequence}`));
    const count = options.maximumNewSteps ?? pending.length;
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("maximumNewSteps must be a non-negative safe integer");
    const selected = pending.slice(0, count);
    for (const step of selected) {
      const operationId = `step:${step.sequence}`;
      if (this.operations.has(operationId)) continue;
      const runner = this.requireRunner();
      this.tick = Math.max(this.tick + 1, step.logicalTick);
      this.commands.push(runnerStepCommand(step, runner.id));
      this.emit("routerun.runner.move", { step, runnerId: runner.id }, step.sequence === 0 ? "routerun.runner.enter" : "routerun.runner.travel", 140);
      this.transition("collecting");
      const applied = collectRouteOverlays(this.requireBoard().toDefinition(), [step], this.collections.map(({ overlayId }) => overlayId), this.tick);
      this.boardModel = new BoardModel(applied.board, false);
      const newCollections = applied.collections.filter(({ overlayId }) => !this.operations.has(`overlay:${overlayId}`));
      this.runnerState = applyRunnerStep(runner, step, newCollections);
      for (const collection of newCollections) {
        this.operations.add(`overlay:${collection.overlayId}`);
        this.collections.push(collection);
        this.commands.push(overlayCommand(collection));
        this.emit("routerun.overlay.collect", { collection }, "routerun.overlay.collect", 110);
        this.invokeFeature("after-overlay-collected", step.coordinate, step.exitedTo);
      }
      this.operations.add(operationId);
      this.completedSteps.push(structuredClone(step));
      this.invokeFeature("after-route-step", step.coordinate, step.exitedTo);
      this.transition("moving");
    }
    const remaining = preview.steps.some((step) => !this.operations.has(`step:${step.sequence}`));
    if (!remaining) this.finishRoute(preview);
    return structuredClone(selected);
  }

  clearRoute(): ClearReport {
    this.ensureUsable();
    if (!["terminal", "completed", "idle"].includes(this.phaseValue)) throw this.phaseError("clearRoute");
    this.transition("clearing");
    this.invokeFeature("before-clear");
    const report = clearTraversedCells(this.requireBoard().toDefinition(), this.completedSteps);
    this.boardModel = new BoardModel(report.board, false);
    for (const change of report.changes) this.operations.add(`clear:${change.cellId}`);
    this.commands.push(...clearCommands(report, this.tick));
    this.tick += report.changes.length > 0 ? 1 : 0;
    this.emit("routerun.cells.clear", { clearedCellIds: report.clearedCellIds, retainedCellIds: report.retainedCellIds, changes: report.changes }, "routerun.tile.clear", 100);
    this.invokeFeature("after-clear");
    this.transition("idle");
    return structuredClone(report);
  }

  applyCascade(provider: RefillProvider): CascadeReport {
    this.ensureUsable();
    if (!["idle", "terminal", "completed"].includes(this.phaseValue)) throw this.phaseError("applyCascade");
    const cascadeIndex = this.cascades.length;
    const boardLimit = this.requireBoard().maximumCascadeCount;
    if (cascadeIndex >= Math.min(boardLimit, this.limits.maximumCascadeCount)) throw new BoardError("UNSAFE_CONFIGURATION", "Maximum cascade count reached", { cascadeIndex });
    this.transition("cascading");
    this.invokeFeature("before-cascade");
    const report = resolveCascade(this.requireBoard().toDefinition(), provider, cascadeIndex);
    if (!this.operations.has(`cascade:${cascadeIndex}`)) {
      this.boardModel = new BoardModel(report.board, false);
      this.cascades.push(report);
      this.operations.add(`cascade:${cascadeIndex}`);
      this.pendingRefillData = report.providerSnapshot;
      this.commands.push(...cascadeCommands(report, this.tick));
      this.tick += 1;
      this.emit("routerun.cascade.apply", { cascadeIndex, movements: report.movements, refills: report.refills }, "routerun.tile.compact", 120);
    }
    this.invokeFeature("after-cascade");
    this.routePreview = null;
    this.completedSteps = [];
    this.operations = new Set([...this.operations].filter((id) => !id.startsWith("step:") && !id.startsWith("clear:")));
    this.transition("idle");
    return structuredClone(report);
  }

  applyExpansion(expansion: ExpansionDefinition): ExpansionReport {
    this.ensureUsable();
    if (!["idle", "terminal", "completed"].includes(this.phaseValue)) throw this.phaseError("applyExpansion");
    if (this.expansions.length >= this.limits.maximumExpansionCount) throw new BoardError("UNSAFE_CONFIGURATION", "Maximum expansion count reached");
    if (this.operations.has(`expansion:${expansion.id}`)) {
      const existing = this.expansions.find(({ expansionId }) => expansionId === expansion.id);
      if (!existing) throw new Error(`Expansion ${expansion.id} is recorded without a report`);
      return structuredClone(existing);
    }
    this.transition("expanding");
    this.invokeFeature("before-expansion");
    const report = applyBoardExpansion(this.requireBoard().toDefinition(), expansion, {
      maximumWidth: this.limits.maximumBoardWidth,
      maximumHeight: this.limits.maximumBoardHeight,
      maximumActiveCells: this.limits.maximumActiveCells,
    });
    this.boardModel = new BoardModel(report.board, false);
    this.expansions.push(report);
    this.operations.add(`expansion:${expansion.id}`);
    this.commands.push(...expansionCommands(report, this.tick));
    this.tick += 1;
    this.emit("routerun.expansion.apply", { expansionId: expansion.id, changes: report.changes }, "routerun.board.expand", 220);
    this.invokeFeature("after-expansion");
    this.transition("idle");
    return structuredClone(report);
  }

  checkContinuation(options: RouteSolverOptions = {}): RouteContinuationCheck {
    this.ensureUsable();
    if (!["idle", "terminal", "completed"].includes(this.phaseValue)) throw this.phaseError("checkContinuation");
    this.transition("checking-continuation");
    const board = this.requireBoard();
    const activeEntry = board.entryPositions.find((coordinate) => {
      const cell = board.cellAt(coordinate);
      return cell?.state === "active" && cell.tile !== undefined && cell.tile.family !== "blocker";
    });
    if (!activeEntry) {
      this.transition("terminal");
      return { available: false, preview: null, reason: "No active entry contains a legal route tile" };
    }
    const existing = this.requireRunner();
    this.runnerState = createRunnerState(board, {
      id: existing.id,
      coordinate: activeEntry,
      entryDirection: existing.entryDirection,
      currentDirection: existing.currentDirection,
      metadata: { ...existing.metadata, retainedPosition: true },
    });
    try {
      const resolution = new RouteSolver(board).resolve(this.runnerState, this.solverOptions(options));
      const available = resolution.steps.length > 0 && !["invalid-connection", "blocker", "sealed-boundary", "board-exit", "failed"].includes(resolution.terminalReason);
      this.routePreview = available ? createRoutePreview(resolution) : null;
      this.transition(available ? "idle" : "terminal");
      return { available, preview: this.routePreview ? structuredClone(this.routePreview) : null, reason: available ? "A deterministic continuation is available" : `No continuation: ${resolution.terminalReason}` };
    } catch (error) {
      this.latestIssueValue = error instanceof Error ? error.message : String(error);
      this.transition("terminal");
      return { available: false, preview: null, reason: this.latestIssueValue };
    }
  }

  interrupt(): RouteRunSnapshot {
    this.ensureUsable();
    if (["idle", "completed", "failed", "interrupted"].includes(this.phaseValue)) throw this.phaseError("interrupt");
    const resumePhase = this.phaseValue;
    this.transition("interrupted");
    if (this.runnerState) this.runnerState = { ...this.runnerState, movementStatus: "interrupted" };
    return this.createSnapshot({ resumePhase });
  }

  createSnapshot(metadata: Readonly<Record<string, unknown>> = {}): RouteRunSnapshot {
    const board = this.requireBoard().toDefinition();
    if (!this.originalBoard) throw new Error("RouteRun has no original board definition");
    return {
      schemaVersion: ROUTERUN_SNAPSHOT_SCHEMA_VERSION,
      engineVersion: ROUTERUN_ENGINE_VERSION,
      boardDefinition: structuredClone(this.originalBoard),
      currentBoardState: board,
      runnerState: this.runnerState ? structuredClone(this.runnerState) : null,
      completedRouteSteps: structuredClone(this.completedSteps),
      activeRoutePreview: this.routePreview ? structuredClone(this.routePreview) : null,
      collectedOverlays: structuredClone(this.collections),
      completedCascades: structuredClone(this.cascades),
      pendingRefillData: structuredClone(this.pendingRefillData),
      activeExpansions: structuredClone(this.expansions),
      currentPhase: this.phaseValue,
      currentOutcomeReference: this.currentOutcomeReference,
      logicalTick: this.tick,
      terminalState: this.terminal ? structuredClone(this.terminal) : null,
      completedOperationIds: [...this.operations].sort(),
      pendingAnimationCommands: structuredClone(this.commands),
      schemaMetadata: structuredClone(metadata),
    };
  }

  restoreSnapshot(input: RouteRunSnapshot | string): void {
    this.ensureUsable();
    const candidate = typeof input === "string" ? parseRouteRunSnapshot(input) : structuredClone(input);
    // Validate the complete candidate before changing any live runtime field.
    validateRouteRunSnapshot(candidate);
    const candidateBoard = new BoardModel(candidate.currentBoardState, false);
    const resumePhase = candidate.currentPhase === "interrupted" && typeof candidate.schemaMetadata.resumePhase === "string"
      ? candidate.schemaMetadata.resumePhase as RouteRunPhase : candidate.currentPhase;
    this.phaseValue = "recovering";
    this.originalBoard = structuredClone(candidate.boardDefinition);
    this.boardModel = candidateBoard;
    this.runnerState = candidate.runnerState ? structuredClone(candidate.runnerState) : null;
    this.completedSteps = [...structuredClone(candidate.completedRouteSteps)];
    this.routePreview = candidate.activeRoutePreview ? structuredClone(candidate.activeRoutePreview) : null;
    this.collections = [...structuredClone(candidate.collectedOverlays)];
    this.cascades = [...structuredClone(candidate.completedCascades)];
    this.pendingRefillData = structuredClone(candidate.pendingRefillData);
    this.expansions = [...structuredClone(candidate.activeExpansions)];
    this.currentOutcomeReference = candidate.currentOutcomeReference;
    this.tick = candidate.logicalTick;
    this.terminal = candidate.terminalState ? structuredClone(candidate.terminalState) : null;
    this.operations = new Set(candidate.completedOperationIds);
    this.commands = [...structuredClone(candidate.pendingAnimationCommands)];
    this.phaseValue = resumePhase === "recovering" || resumePhase === "interrupted" ? "moving" : resumePhase;
    if (this.runnerState && this.phaseValue === "moving") this.runnerState = { ...this.runnerState, movementStatus: "moving" };
  }

  reset(): void {
    this.phaseValue = "idle";
    this.originalBoard = null;
    this.boardModel = null;
    this.runnerState = null;
    this.routePreview = null;
    this.completedSteps = [];
    this.collections = [];
    this.cascades = [];
    this.expansions = [];
    this.terminal = null;
    this.tick = 0;
    this.timelineEvents = [];
    this.commands = [];
    this.operations.clear();
    this.featureApplicationsValue = [];
    this.latestIssueValue = null;
    this.currentOutcomeReference = null;
    this.pendingRefillData = null;
  }

  dispose(): void {
    this.reset();
    this.events.clear();
    this.disposed = true;
  }

  inspect(): RouteRunEngineInspection {
    const validation = this.boardModel ? validateBoard(this.boardModel.toDefinition(), { validateConnections: false, maximumWidth: this.limits.maximumBoardWidth, maximumHeight: this.limits.maximumBoardHeight, maximumActiveCells: this.limits.maximumActiveCells, maximumOverlaysPerCell: this.limits.maximumOverlaysPerCell }) : null;
    return {
      engineVersion: ROUTERUN_ENGINE_VERSION,
      phase: this.phaseValue,
      boardDefinition: this.originalBoard ? structuredClone(this.originalBoard) : null,
      board: this.boardModel?.toDefinition() ?? null,
      runner: this.runnerState ? structuredClone(this.runnerState) : null,
      preview: this.routePreview ? structuredClone(this.routePreview) : null,
      completedRouteSteps: structuredClone(this.completedSteps),
      collectedOverlays: structuredClone(this.collections),
      completedCascades: structuredClone(this.cascades),
      activeExpansions: structuredClone(this.expansions),
      terminalState: this.terminal ? structuredClone(this.terminal) : null,
      logicalTick: this.tick,
      timeline: structuredClone(this.timelineEvents),
      animationCommands: structuredClone(this.commands),
      featureApplications: structuredClone(this.featureApplicationsValue),
      latestEvent: this.timelineEvents.at(-1)?.type ?? null,
      latestIssue: this.latestIssueValue,
      validationErrors: validation?.errors.map(({ message }) => message) ?? [],
    };
  }

  private loadBoardInternal(board: BoardDefinition): void {
    const validation = validateBoard(board, {
      validateConnections: false,
      maximumWidth: this.limits.maximumBoardWidth,
      maximumHeight: this.limits.maximumBoardHeight,
      maximumActiveCells: this.limits.maximumActiveCells,
      maximumOverlaysPerCell: this.limits.maximumOverlaysPerCell,
    });
    if (!validation.valid) {
      const issue = validation.errors[0];
      throw new BoardError(issue?.code ?? "INVALID_CELL", issue?.message ?? "Invalid board", { errors: validation.errors });
    }
    if (board.maximumCascadeCount > this.limits.maximumCascadeCount) throw new BoardError("UNSAFE_CONFIGURATION", "Board cascade limit exceeds engine safety limit");
    this.originalBoard = structuredClone(board);
    this.boardModel = new BoardModel(board, false);
  }

  private finishRoute(route: RoutePreview): void {
    this.invokeFeature("before-terminal", route.terminalCoordinate, null);
    if (this.runnerState) this.runnerState = finalizeRunner(this.runnerState, route.terminalReason);
    this.terminal = { reason: route.terminalReason, message: terminalMessage(route.terminalReason), logicalTick: ++this.tick };
    this.commands.push(terminalCommand(route, this.tick));
    this.transition("terminal");
    this.emit("routerun.round.terminal", { terminal: this.terminal, routeSignature: route.deterministicSignature }, "routerun.route.terminal", 160);
    this.invokeFeature("after-terminal", route.terminalCoordinate, null);
  }

  private invokeFeature(hook: RouteRunFeatureHook, coordinate: Coordinate | null = null, direction: Direction | null = null): void {
    if (!this.featureBridge) return;
    const context: RouteRunFeatureContext = {
      hook,
      engineId: "engine.routerun",
      engineVersion: ROUTERUN_ENGINE_VERSION,
      phase: this.phaseValue,
      board: this.boardModel?.toDefinition() ?? null,
      runner: this.runnerState ? structuredClone(this.runnerState) : null,
      route: this.routePreview ? structuredClone(this.routePreview) : null,
      coordinate: coordinate ? structuredClone(coordinate) : null,
      direction,
      logicalTick: this.tick,
      metadata: { outcomeReference: this.currentOutcomeReference },
    };
    const applied = applyRouteRunFeatureResult(hook, this.featureBridge.execute(hook, Object.freeze(context)));
    this.featureApplicationsValue.push(applied);
    this.commands.push(...applied.animationCommands);
    if (applied.warningMessages.length > 0) this.latestIssueValue = applied.warningMessages.at(-1) ?? null;
  }

  private emit(type: RouteRunOutcomeEventType, payload: unknown, animationType?: string, durationMs?: number): void {
    const event: RouteRunTimelineEvent = {
      id: `routerun-event-${String(this.timelineEvents.length).padStart(4, "0")}`,
      type,
      logicalTick: this.tick,
      payload: toJsonObject(payload),
      ...(animationType ? { animationType } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
    this.timelineEvents.push(event);
    this.events.publish(type, { event });
  }

  private solverOptions(options: RouteSolverOptions): RouteSolverOptions {
    const fallbackPriority = options.fallbackPriority ?? this.fallbackPriority;
    return {
      ...options,
      maximumSteps: Math.min(options.maximumSteps ?? this.limits.maximumRouteSteps, this.limits.maximumRouteSteps),
      startingLogicalTick: options.startingLogicalTick ?? this.tick,
      ...(fallbackPriority === undefined ? {} : { fallbackPriority }),
      allowFallback: options.allowFallback ?? this.allowJunctionFallback,
    };
  }

  private ensureReadyForRoute(operation: string): void {
    this.ensureUsable();
    if (this.phaseValue !== "idle") throw this.phaseError(operation);
    this.requireBoard();
    this.requireRunner();
  }

  private ensureUsable(): void { if (this.disposed) throw new Error("RouteRunEngine has been disposed"); }
  private requireBoard(): BoardModel { if (!this.boardModel) throw new Error("RouteRun board is not loaded"); return this.boardModel; }
  private requireRunner(): RunnerState { if (!this.runnerState) throw new Error("RouteRun runner is not placed"); return this.runnerState; }
  private phaseError(operation: string): Error { return new Error(`Cannot ${operation} while RouteRun is in phase ${this.phaseValue}`); }

  private transition(next: RouteRunPhase): void {
    if (next === this.phaseValue) return;
    const legal = LEGAL_TRANSITIONS[this.phaseValue];
    if (!legal.includes(next)) throw new Error(`Illegal RouteRun phase transition ${this.phaseValue} → ${next}`);
    this.phaseValue = next;
  }
}

const LEGAL_TRANSITIONS: Readonly<Record<RouteRunPhase, readonly RouteRunPhase[]>> = {
  idle: ["initializing", "previewing", "moving", "clearing", "cascading", "expanding", "checking-continuation", "recovering"],
  initializing: ["idle", "failed"],
  previewing: ["idle", "failed"],
  moving: ["collecting", "terminal", "interrupted", "failed"],
  collecting: ["moving", "interrupted", "failed"],
  clearing: ["idle", "interrupted", "failed"],
  cascading: ["idle", "interrupted", "failed"],
  expanding: ["idle", "interrupted", "failed"],
  "checking-continuation": ["idle", "terminal", "failed"],
  terminal: ["idle", "clearing", "cascading", "expanding", "checking-continuation", "completed", "recovering"],
  interrupted: ["recovering", "idle", "failed"],
  recovering: ["idle", "moving", "collecting", "clearing", "cascading", "expanding", "checking-continuation", "terminal", "completed", "failed"],
  completed: ["idle", "initializing", "clearing", "cascading", "expanding", "checking-continuation", "recovering"],
  failed: ["idle", "initializing", "recovering"],
};

function terminalMessage(reason: RouteRunTerminalState["reason"]): string {
  if (reason === "dead-end") return "No legal continuation remains.";
  if (reason === "destination-reached") return "The configured destination was reached.";
  return `Route terminated: ${reason}.`;
}

function assertSafeLimits(limits: RouteRunSafetyLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  }
  if (limits.maximumActiveCells > limits.maximumBoardWidth * limits.maximumBoardHeight) {
    throw new TypeError("maximumActiveCells cannot exceed the maximum rectangular board area");
  }
}
