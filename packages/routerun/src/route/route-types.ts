import type { Coordinate, Direction, RouteRunMetadata } from "../board/board-types.js";
import type { RunnerState } from "../runner/runner-types.js";

export type RouteTerminalReason =
  | "dead-end"
  | "destination-reached"
  | "blocker"
  | "sealed-boundary"
  | "board-exit"
  | "invalid-connection"
  | "loop-detected"
  | "maximum-step-limit"
  | "interrupted"
  | "failed";

export type JunctionResolutionReason = "explicit" | "stable-fallback" | "single-exit";
export type JunctionResolutionMap = Readonly<Record<string, readonly Direction[] | Direction>>;

export interface RouteDecision {
  readonly coordinate: Coordinate;
  readonly requested: readonly Direction[];
  readonly legalExits: readonly Direction[];
  readonly chosen: Direction;
  readonly reason: JunctionResolutionReason;
}

export interface RouteStep {
  readonly sequence: number;
  readonly coordinate: Coordinate;
  readonly cellId: string;
  readonly tileId: string;
  readonly enteredFrom: Direction | null;
  readonly exitedTo: Direction | null;
  readonly collectedOverlayIds: readonly string[];
  readonly destinationReached: boolean;
  readonly cumulativePresentationValue: number;
  readonly logicalTick: number;
  readonly metadata: RouteRunMetadata;
}

export interface RouteResolution {
  readonly runnerId: string;
  readonly steps: readonly RouteStep[];
  readonly decisions: readonly RouteDecision[];
  readonly terminalReason: RouteTerminalReason;
  readonly terminalCoordinate: Coordinate;
  readonly deterministicSignature: string;
  readonly logicalTick: number;
  readonly warnings: readonly string[];
}

export interface RoutePreview extends RouteResolution {
  readonly preview: true;
}

export interface RouteSolverOptions {
  readonly junctionInstructions?: JunctionResolutionMap;
  readonly fallbackPriority?: readonly Direction[];
  readonly allowFallback?: boolean;
  readonly maximumSteps?: number;
  readonly startingLogicalTick?: number;
}

export interface RouteContinuationCheck {
  readonly available: boolean;
  readonly preview: RoutePreview | null;
  readonly reason: string;
}

export interface RouteSolverInput {
  readonly runner: RunnerState;
  readonly options?: RouteSolverOptions;
}
