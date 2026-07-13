import type { RouteOverlay } from "../overlays/overlay-types.js";
import type { RouteTile } from "../tiles/tile-types.js";

export type Direction = "north" | "east" | "south" | "west";
export type GravityDirection = "down" | "up" | "left" | "right";
export type CellState = "active" | "empty" | "sealed" | "blocked" | "reserved";
export type RouteRunMetadata = Readonly<Record<string, unknown>>;

export interface Coordinate {
  readonly row: number;
  readonly column: number;
}

export interface DestinationData {
  readonly id: string;
  readonly completed?: boolean;
  readonly retainOnClear?: boolean;
  readonly metadata: RouteRunMetadata;
}

export interface BoardCell {
  readonly id: string;
  readonly coordinate: Coordinate;
  readonly state: CellState;
  readonly tile?: RouteTile;
  readonly overlays: readonly RouteOverlay[];
  readonly destination?: DestinationData;
  readonly metadata: RouteRunMetadata;
}

export interface BoardDefinition {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly BoardCell[];
  readonly entryPositions: readonly Coordinate[];
  readonly destinationPositions: readonly Coordinate[];
  readonly gravity: GravityDirection;
  readonly maximumCascadeCount: number;
  readonly metadata: RouteRunMetadata;
}

export const CARDINAL_DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row}:${coordinate.column}`;
}

export function coordinatesEqual(left: Coordinate, right: Coordinate): boolean {
  return left.row === right.row && left.column === right.column;
}

export function moveCoordinate(coordinate: Coordinate, direction: Direction): Coordinate {
  if (direction === "north") return { row: coordinate.row - 1, column: coordinate.column };
  if (direction === "east") return { row: coordinate.row, column: coordinate.column + 1 };
  if (direction === "south") return { row: coordinate.row + 1, column: coordinate.column };
  return { row: coordinate.row, column: coordinate.column - 1 };
}

export function oppositeDirection(direction: Direction): Direction {
  if (direction === "north") return "south";
  if (direction === "east") return "west";
  if (direction === "south") return "north";
  return "east";
}

export function isCoordinate(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Coordinate>;
  return Number.isSafeInteger(candidate.row) && Number(candidate.row) >= 0 &&
    Number.isSafeInteger(candidate.column) && Number(candidate.column) >= 0;
}
