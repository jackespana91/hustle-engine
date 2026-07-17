import { SpatialRouteError } from "./spatial-route-errors.js";
import type { ComposedSpatialRoute } from "./spatial-route-types.js";
import type {
  SpatialRunnerAdvanceInput,
  SpatialRunnerCommand,
  SpatialRunnerCommandRecord,
  SpatialRunnerControllerOptions,
  SpatialRunnerObstacleInteraction,
  SpatialRunnerSnapshot,
  SpatialRunnerState,
} from "./spatial-runner-types.js";

const ACTION_DURATIONS = {
  jump: 680,
  slide: 760,
  "dodge-left": 420,
  "dodge-right": 420,
} as const;

export class SpatialRunnerController {
  private state: SpatialRunnerState;

  constructor(readonly route: ComposedSpatialRoute, options: SpatialRunnerControllerOptions = {}) {
    const laneCount = options.laneCount ?? 3;
    if (!Number.isSafeInteger(laneCount) || laneCount <= 0 || laneCount % 2 === 0) {
      throw new SpatialRouteError("INVALID_DEFINITION", "Spatial runner lane count must be a positive odd integer");
    }
    const maximumLane = Math.floor(laneCount / 2);
    const initialLane = options.initialLane ?? 0;
    if (!Number.isSafeInteger(initialLane) || Math.abs(initialLane) > maximumLane) {
      throw new SpatialRouteError("INVALID_DEFINITION", "Initial lane is outside the configured lane range");
    }
    this.state = {
      routeDefinitionId: route.definitionId,
      routeSignature: route.deterministicSignature,
      elapsedMs: 0,
      progress: 0,
      lane: initialLane,
      laneCount,
      action: "running",
      actionStartedAtMs: 0,
      actionEndsAtMs: 0,
      branchSelections: Object.fromEntries(route.branches.map((branch) => [branch.id, branch.defaultAlternativeId])),
      collectedCueIds: [],
      obstacleInteractions: [],
      clearedObstacleIds: [],
      hitObstacleIds: [],
      commandHistory: [],
      commandsExecuted: 0,
      recoveryCount: 0,
      status: "idle",
    };
  }

  inspect(): SpatialRunnerState {
    return structuredClone(this.state);
  }

  advance(input: SpatialRunnerAdvanceInput): SpatialRunnerState {
    if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < this.state.elapsedMs) {
      throw new SpatialRouteError("INVALID_DEFINITION", "Spatial runner time must be finite and monotonic");
    }
    if (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1) {
      throw new SpatialRouteError("INVALID_DEFINITION", "Spatial runner progress must be between zero and one");
    }
    const actionExpired = input.elapsedMs >= this.state.actionEndsAtMs;
    const action = actionExpired ? "running" : this.state.action;
    const status = input.status ?? (input.progress >= 1 ? "arrived" : "running");
    const newInteractions = status === "running"
      ? this.resolveObstacleInteractions(this.state.progress, input.progress, input.elapsedMs, this.state.lane, action)
      : [];
    this.state = {
      ...this.state,
      elapsedMs: input.elapsedMs,
      progress: input.progress,
      action,
      collectedCueIds: [...new Set([...this.state.collectedCueIds, ...(input.collectedCueIds ?? [])])],
      obstacleInteractions: [...this.state.obstacleInteractions, ...newInteractions],
      clearedObstacleIds: [...new Set([
        ...this.state.clearedObstacleIds,
        ...newInteractions.filter(({ result }) => result === "cleared").map(({ obstacleId }) => obstacleId),
      ])],
      hitObstacleIds: [...new Set([
        ...this.state.hitObstacleIds,
        ...newInteractions.filter(({ result }) => result === "hit").map(({ obstacleId }) => obstacleId),
      ])],
      status,
    };
    return this.inspect();
  }

  execute(command: SpatialRunnerCommand): SpatialRunnerCommandRecord {
    if (!command.id.trim()) throw new SpatialRouteError("INVALID_DEFINITION", "Spatial runner command id is required");
    if (!Number.isFinite(command.issuedAtMs) || command.issuedAtMs < this.state.elapsedMs) {
      throw new SpatialRouteError("INVALID_DEFINITION", "Spatial runner command time must not precede current state time");
    }
    if (this.state.commandHistory.some(({ id }) => id === command.id)) {
      return this.record(command, false, "duplicate-command", this.state.lane);
    }
    const maximumLane = Math.floor(this.state.laneCount / 2);
    let lane = this.state.lane;
    let action = this.state.action;
    let actionEndsAtMs = this.state.actionEndsAtMs;
    let branchSelections = this.state.branchSelections;
    let accepted = true;
    let reason = "accepted";

    if (command.type === "lane-left" || command.type === "dodge-left") lane = Math.max(-maximumLane, lane - 1);
    if (command.type === "lane-right" || command.type === "dodge-right") lane = Math.min(maximumLane, lane + 1);
    if ((command.type === "lane-left" || command.type === "dodge-left") && lane === this.state.lane) { accepted = false; reason = "left-boundary"; }
    if ((command.type === "lane-right" || command.type === "dodge-right") && lane === this.state.lane) { accepted = false; reason = "right-boundary"; }
    if (command.type === "jump") { action = "jumping"; actionEndsAtMs = command.issuedAtMs + ACTION_DURATIONS.jump; }
    if (command.type === "slide") { action = "sliding"; actionEndsAtMs = command.issuedAtMs + ACTION_DURATIONS.slide; }
    if (command.type === "dodge-left") { action = "dodging-left"; actionEndsAtMs = command.issuedAtMs + ACTION_DURATIONS["dodge-left"]; }
    if (command.type === "dodge-right") { action = "dodging-right"; actionEndsAtMs = command.issuedAtMs + ACTION_DURATIONS["dodge-right"]; }
    if (command.type === "choose-branch") {
      const branch = this.route.branches.find(({ id }) => id === command.branchId);
      const alternative = branch?.alternatives.find(({ id }) => id === command.alternativeId);
      if (!branch || !alternative) { accepted = false; reason = "invalid-branch"; }
      else if (this.state.progress < branch.decisionOpensProgress) { accepted = false; reason = "decision-not-open"; }
      else if (this.state.progress > branch.decisionClosesProgress) { accepted = false; reason = "decision-closed"; }
      else branchSelections = { ...this.state.branchSelections, [branch.id]: alternative.id };
    }

    if (accepted) {
      this.state = {
        ...this.state,
        elapsedMs: command.issuedAtMs,
        lane,
        action,
        actionStartedAtMs: action === this.state.action ? this.state.actionStartedAtMs : command.issuedAtMs,
        actionEndsAtMs,
        branchSelections,
        commandsExecuted: this.state.commandsExecuted + 1,
      };
    }
    return this.record(command, accepted, reason, lane);
  }

  createSnapshot(): SpatialRunnerSnapshot {
    return {
      schemaVersion: 1,
      routeDefinitionId: this.route.definitionId,
      routeSignature: this.route.deterministicSignature,
      state: this.inspect(),
    };
  }

  restore(snapshot: SpatialRunnerSnapshot): SpatialRunnerState {
    if (snapshot.schemaVersion !== 1) throw new SpatialRouteError("INVALID_DEFINITION", "Unsupported spatial runner snapshot version");
    if (snapshot.routeDefinitionId !== this.route.definitionId || snapshot.routeSignature !== this.route.deterministicSignature) {
      throw new SpatialRouteError("INVALID_DEFINITION", "Spatial runner snapshot route does not match the active route");
    }
    const restored = structuredClone(snapshot.state);
    this.state = {
      ...restored,
      obstacleInteractions: restored.obstacleInteractions ?? [],
      clearedObstacleIds: restored.clearedObstacleIds ?? [],
      hitObstacleIds: restored.hitObstacleIds ?? [],
      recoveryCount: snapshot.state.recoveryCount + 1,
    };
    return this.inspect();
  }

  reset(): SpatialRunnerState {
    const laneCount = this.state.laneCount;
    this.state = new SpatialRunnerController(this.route, { laneCount }).inspect();
    return this.inspect();
  }

  private record(command: SpatialRunnerCommand, accepted: boolean, reason: string, resultingLane: number): SpatialRunnerCommandRecord {
    const record: SpatialRunnerCommandRecord = { ...structuredClone(command), accepted, reason, resultingLane };
    this.state = { ...this.state, commandHistory: [...this.state.commandHistory.slice(-63), record] };
    return structuredClone(record);
  }

  private resolveObstacleInteractions(
    previousProgress: number,
    progress: number,
    elapsedMs: number,
    lane: number,
    action: SpatialRunnerState["action"],
  ): SpatialRunnerObstacleInteraction[] {
    const resolvedIds = new Set(this.state.obstacleInteractions.map(({ obstacleId }) => obstacleId));
    return this.route.obstacles
      .filter((obstacle) => obstacle.progress > previousProgress && obstacle.progress <= progress && !resolvedIds.has(obstacle.id))
      .map((obstacle) => {
        const avoidedLane = obstacle.lane !== null && lane !== obstacle.lane;
        const performedAction = obstacle.requiredAction === "none"
          || obstacle.requiredAction === "jump" && action === "jumping"
          || obstacle.requiredAction === "slide" && action === "sliding"
          || obstacle.requiredAction === "change-lane" && avoidedLane;
        return {
          obstacleId: obstacle.id,
          result: avoidedLane || performedAction ? "cleared" : "hit",
          atMs: elapsedMs,
          progress: obstacle.progress,
          lane,
          action,
        };
      });
  }
}
