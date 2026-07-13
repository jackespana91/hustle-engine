import { BoardError, type BoardValidationIssue, type BoardValidationResult } from "./board-errors.js";
import { CARDINAL_DIRECTIONS, coordinateKey, moveCoordinate, oppositeDirection, type BoardDefinition } from "./board-types.js";

export interface BoardValidationOptions {
  readonly validateConnections?: boolean;
  readonly maximumWidth?: number;
  readonly maximumHeight?: number;
  readonly maximumActiveCells?: number;
  readonly maximumOverlaysPerCell?: number;
}

export function validateBoard(definition: BoardDefinition, options: BoardValidationOptions = {}): BoardValidationResult {
  const errors: BoardValidationIssue[] = [];
  const warnings: BoardValidationIssue[] = [];
  const add = (code: BoardValidationIssue["code"], message: string, path: string, details: Readonly<Record<string, unknown>> = {}) =>
    errors.push({ code, message, path, details });

  if (!Number.isSafeInteger(definition.width) || !Number.isSafeInteger(definition.height) || definition.width <= 0 || definition.height <= 0) {
    add("INVALID_DIMENSIONS", "Board width and height must be positive safe integers", "$", { width: definition.width, height: definition.height });
    return { valid: false, errors, warnings };
  }
  if (definition.width > (options.maximumWidth ?? 32) || definition.height > (options.maximumHeight ?? 32)) {
    add("UNSAFE_CONFIGURATION", "Board dimensions exceed configured safety limits", "$", { width: definition.width, height: definition.height });
  }
  const byCoordinate = new Map<string, typeof definition.cells[number]>();
  const ids = new Set<string>();
  definition.cells.forEach((cell, index) => {
    const path = `cells.${index}`;
    if (ids.has(cell.id)) add("DUPLICATE_CELL_ID", `Duplicate cell id ${cell.id}`, `${path}.id`, { id: cell.id });
    ids.add(cell.id);
    const key = coordinateKey(cell.coordinate);
    if (byCoordinate.has(key)) add("DUPLICATE_COORDINATE", `Duplicate coordinate ${key}`, `${path}.coordinate`, { key });
    byCoordinate.set(key, cell);
    if (cell.coordinate.row < 0 || cell.coordinate.column < 0 || cell.coordinate.row >= definition.height || cell.coordinate.column >= definition.width) {
      add("COORDINATE_OUT_OF_BOUNDS", `Cell ${cell.id} is outside the board`, `${path}.coordinate`, { key });
    }
    if ((cell.state === "sealed" || cell.state === "blocked") && cell.tile && cell.tile.family !== "blocker") {
      add("INVALID_CELL", `${cell.state} cell ${cell.id} cannot contain a route tile`, `${path}.tile`, { family: cell.tile.family });
    }
    if (cell.overlays.length > (options.maximumOverlaysPerCell ?? 16)) {
      add("UNSAFE_CONFIGURATION", `Cell ${cell.id} exceeds the overlay safety limit`, `${path}.overlays`, { count: cell.overlays.length });
    }
    if (cell.tile) {
      const unique = new Set(cell.tile.connections);
      if (unique.size !== cell.tile.connections.length || cell.tile.connections.some((direction) => !CARDINAL_DIRECTIONS.includes(direction))) {
        add("INVALID_CONNECTION", `Tile ${cell.tile.id} contains invalid connection data`, `${path}.tile.connections`);
      }
    }
  });
  if (definition.cells.length !== definition.width * definition.height) {
    add("COORDINATE_MISMATCH", "Rectangular boards require exactly one cell per coordinate", "cells", { expected: definition.width * definition.height, actual: definition.cells.length });
  }
  const activeCount = definition.cells.filter((cell) => cell.state === "active" || cell.state === "empty").length;
  if (activeCount > (options.maximumActiveCells ?? 512)) add("UNSAFE_CONFIGURATION", "Board exceeds the active-cell safety limit", "cells", { activeCount });
  [...definition.entryPositions, ...definition.destinationPositions].forEach((coordinate, index) => {
    const cell = byCoordinate.get(coordinateKey(coordinate));
    if (!cell) add("MISSING_CELL", "Configured entry or destination has no cell", `positions.${index}`, { coordinate });
    else if (cell.state === "sealed" || cell.state === "blocked") add("INVALID_CELL", "Entry and destination positions must be active", `positions.${index}`, { coordinate, state: cell.state });
  });
  if (options.validateConnections ?? true) {
    for (const cell of definition.cells) {
      if (!cell.tile || cell.state !== "active") continue;
      for (const direction of cell.tile.connections) {
        const targetCoordinate = moveCoordinate(cell.coordinate, direction);
        const target = byCoordinate.get(coordinateKey(targetCoordinate));
        if (!target || !target.tile || target.state !== "active") continue;
        // Structural reciprocity is independent of one-way traversal rules.
        if (!target.tile.connections.includes(oppositeDirection(direction))) {
          add("INVALID_CONNECTION", `Connection from ${cell.id} to ${target.id} is not reciprocal`, `cells.${cell.id}.tile.connections`, { direction, target: target.id });
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function assertValidBoard(definition: BoardDefinition, options: BoardValidationOptions = {}): void {
  const result = validateBoard(definition, options);
  const issue = result.errors[0];
  if (issue) throw new BoardError(issue.code, issue.message, { path: issue.path, ...issue.details });
}
