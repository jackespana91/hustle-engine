import type { ComposedSpatialRoute } from "./spatial-route-types.js";

export type SpatialRunnerAction = "running" | "jumping" | "sliding" | "dodging-left" | "dodging-right";
export type SpatialRunnerStatus = "idle" | "running" | "interrupted" | "arrived" | "resolved";
export type SpatialRunnerCommandType = "lane-left" | "lane-right" | "jump" | "slide" | "dodge-left" | "dodge-right" | "choose-branch";

export interface SpatialRunnerCommand {
  readonly id: string;
  readonly type: SpatialRunnerCommandType;
  readonly issuedAtMs: number;
  readonly branchId?: string;
  readonly alternativeId?: string;
}

export interface SpatialRunnerCommandRecord extends SpatialRunnerCommand {
  readonly accepted: boolean;
  readonly reason: string;
  readonly resultingLane: number;
}

export interface SpatialRunnerObstacleInteraction {
  readonly obstacleId: string;
  readonly result: "cleared" | "hit";
  readonly atMs: number;
  readonly progress: number;
  readonly lane: number;
  readonly action: SpatialRunnerAction;
}

export interface SpatialRunnerState {
  readonly routeDefinitionId: string;
  readonly routeSignature: string;
  readonly elapsedMs: number;
  readonly progress: number;
  readonly lane: number;
  readonly laneCount: number;
  readonly action: SpatialRunnerAction;
  readonly actionStartedAtMs: number;
  readonly actionEndsAtMs: number;
  readonly branchSelections: Readonly<Record<string, string>>;
  readonly collectedCueIds: readonly string[];
  readonly obstacleInteractions: readonly SpatialRunnerObstacleInteraction[];
  readonly clearedObstacleIds: readonly string[];
  readonly hitObstacleIds: readonly string[];
  readonly commandHistory: readonly SpatialRunnerCommandRecord[];
  readonly commandsExecuted: number;
  readonly recoveryCount: number;
  readonly status: SpatialRunnerStatus;
}

export interface SpatialRunnerControllerOptions {
  readonly laneCount?: number;
  readonly initialLane?: number;
}

export interface SpatialRunnerAdvanceInput {
  readonly elapsedMs: number;
  readonly progress: number;
  readonly collectedCueIds?: readonly string[];
  readonly status?: SpatialRunnerStatus;
}

export interface SpatialRunnerSnapshot {
  readonly schemaVersion: 1;
  readonly routeDefinitionId: string;
  readonly routeSignature: string;
  readonly state: SpatialRunnerState;
}

export interface SpatialRouteWindowOptions {
  readonly distanceBehind?: number;
  readonly distanceAhead?: number;
}

export interface SpatialRouteWindow {
  readonly progress: number;
  readonly distance: number;
  readonly startDistance: number;
  readonly endDistance: number;
  readonly currentSegmentId: string;
  readonly activeSegmentIds: readonly string[];
  readonly route: Pick<ComposedSpatialRoute, "definitionId" | "deterministicSignature">;
}
