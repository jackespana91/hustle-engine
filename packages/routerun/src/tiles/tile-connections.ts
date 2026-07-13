import { oppositeDirection, type Direction } from "../board/board-types.js";
import type { RouteTile } from "./tile-types.js";

export function acceptsEntry(tile: RouteTile, enteredFrom: Direction): boolean {
  if (!tile.connections.includes(enteredFrom)) return false;
  return tile.oneWay?.allowedEntrances.includes(enteredFrom) ?? true;
}

export function permitsExit(tile: RouteTile, exitedTo: Direction): boolean {
  if (!tile.connections.includes(exitedTo)) return false;
  return tile.oneWay?.allowedExits.includes(exitedTo) ?? true;
}

export function hasReciprocalConnection(source: RouteTile, direction: Direction, target: RouteTile): boolean {
  return permitsExit(source, direction) && acceptsEntry(target, oppositeDirection(direction));
}

export function legalExits(tile: RouteTile, enteredFrom: Direction | null): readonly Direction[] {
  return tile.connections.filter((direction) => direction !== enteredFrom && permitsExit(tile, direction));
}
