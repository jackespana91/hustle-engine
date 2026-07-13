import { CARDINAL_DIRECTIONS, type Direction } from "../board/board-types.js";
import type { OneWayRule, RouteTile, TileRotation, TileTemplate } from "./tile-types.js";

export function rotateDirection(direction: Direction, rotation: TileRotation): Direction {
  const index = CARDINAL_DIRECTIONS.indexOf(direction);
  const turns = rotation / 90;
  return CARDINAL_DIRECTIONS[(index + turns) % CARDINAL_DIRECTIONS.length] ?? direction;
}

export function rotateDirections(directions: readonly Direction[], rotation: TileRotation): readonly Direction[] {
  return stableDirections(directions.map((direction) => rotateDirection(direction, rotation)));
}

export function rotateTile(tile: RouteTile, rotation: TileRotation): RouteTile {
  const delta = normalizeRotation(tile.rotation + rotation);
  const oneWay = tile.oneWay ? rotateOneWay(tile.oneWay, rotation) : undefined;
  return {
    ...tile,
    connections: rotateDirections(tile.connections, rotation),
    rotation: delta,
    ...(oneWay ? { oneWay } : {}),
  };
}

export function createTile(template: TileTemplate, rotation: TileRotation = 0, instanceId = template.id): RouteTile {
  const oneWay = template.oneWay ? rotateOneWay(template.oneWay, rotation) : undefined;
  return {
    id: instanceId,
    family: template.family,
    connections: rotateDirections(template.baseConnections, rotation),
    rotation,
    ...(oneWay ? { oneWay } : {}),
    ...(template.persistent === undefined ? {} : { persistent: template.persistent }),
    ...(template.movable === undefined ? {} : { movable: template.movable }),
    metadata: structuredClone(template.metadata ?? {}),
  };
}

function rotateOneWay(rule: OneWayRule, rotation: TileRotation): OneWayRule {
  return {
    allowedEntrances: rotateDirections(rule.allowedEntrances, rotation),
    allowedExits: rotateDirections(rule.allowedExits, rotation),
  };
}

function normalizeRotation(value: number): TileRotation {
  return (((value % 360) + 360) % 360) as TileRotation;
}

function stableDirections(directions: readonly Direction[]): readonly Direction[] {
  return CARDINAL_DIRECTIONS.filter((direction) => directions.includes(direction));
}
