import type { Coordinate, Direction, RouteRunMetadata } from "../board/board-types.js";

export type RunnerMovementStatus = "idle" | "placed" | "previewed" | "moving" | "interrupted" | "destination" | "terminal" | "completed" | "failed";

export interface RunnerState {
  readonly id: string;
  readonly currentCoordinate: Coordinate;
  readonly entryDirection: Direction;
  readonly currentDirection: Direction;
  readonly movementStatus: RunnerMovementStatus;
  readonly visitedCellIds: readonly string[];
  readonly collectedOverlayIds: readonly string[];
  readonly accumulatedPresentationValue: number;
  readonly metadata: RouteRunMetadata;
}

export interface PlaceRunnerInput {
  readonly id: string;
  readonly coordinate: Coordinate;
  readonly entryDirection: Direction;
  readonly currentDirection?: Direction;
  readonly metadata?: RouteRunMetadata;
}
