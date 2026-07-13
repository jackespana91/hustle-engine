import type { BoardCell, BoardDefinition, Coordinate, RouteRunMetadata } from "../board/board-types.js";
import type { RouteOverlay } from "../overlays/overlay-types.js";
import type { RouteTile } from "../tiles/tile-types.js";

export type ExpansionSide = "north" | "east" | "south" | "west" | "internal";

export interface ExpansionActivation {
  readonly coordinate: Coordinate;
  readonly tile?: RouteTile;
  readonly overlays?: readonly RouteOverlay[];
  readonly metadata?: RouteRunMetadata;
}

export interface ExpansionDefinition {
  readonly id: string;
  readonly side: ExpansionSide;
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  readonly activations: readonly ExpansionActivation[];
  readonly metadata: RouteRunMetadata;
}

export interface ExpansionChange {
  readonly sequence: number;
  readonly coordinate: Coordinate;
  readonly before: BoardCell | null;
  readonly after: BoardCell;
  readonly type: "cell-created" | "cell-activated";
}

export interface ExpansionReport {
  readonly expansionId: string;
  readonly boardBefore: BoardDefinition;
  readonly board: BoardDefinition;
  readonly changes: readonly ExpansionChange[];
}
