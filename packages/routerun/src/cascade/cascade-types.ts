import type { BoardCell, BoardDefinition, Coordinate, GravityDirection, RouteRunMetadata } from "../board/board-types.js";
import type { RouteOverlay } from "../overlays/overlay-types.js";
import type { RouteTile } from "../tiles/tile-types.js";

export interface ClearChange {
  readonly sequence: number;
  readonly coordinate: Coordinate;
  readonly cellId: string;
  readonly before: BoardCell;
  readonly after: BoardCell;
  readonly retained: boolean;
  readonly reason: "traversed" | "persistent-tile" | "destination-retained";
}

export interface ClearReport {
  readonly board: BoardDefinition;
  readonly changes: readonly ClearChange[];
  readonly clearedCellIds: readonly string[];
  readonly retainedCellIds: readonly string[];
}

export interface RefillContent {
  readonly tile: RouteTile;
  readonly overlays?: readonly RouteOverlay[];
  readonly metadata?: RouteRunMetadata;
}

export interface RefillRequest {
  readonly boardId: string;
  readonly cascadeIndex: number;
  readonly refillIndex: number;
  readonly coordinate: Coordinate;
  readonly gravity: GravityDirection;
}

export interface RefillProvider {
  next(request: RefillRequest): RefillContent | null;
  snapshot?(): unknown;
}

export interface CascadeMovement {
  readonly sequence: number;
  readonly tileId: string;
  readonly from: Coordinate;
  readonly to: Coordinate;
}

export interface RefillPlacement {
  readonly sequence: number;
  readonly tileId: string;
  readonly coordinate: Coordinate;
  readonly refillIndex: number;
}

export interface CascadeReport {
  readonly cascadeIndex: number;
  readonly gravity: GravityDirection;
  readonly boardBefore: BoardDefinition;
  readonly board: BoardDefinition;
  readonly movements: readonly CascadeMovement[];
  readonly refills: readonly RefillPlacement[];
  readonly remainingEmptyCoordinates: readonly Coordinate[];
  readonly mayContainContinuation: boolean;
  readonly providerSnapshot: unknown | null;
}
