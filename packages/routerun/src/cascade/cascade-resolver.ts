import { BoardModel } from "../board/board-model.js";
import { coordinateKey, type BoardCell, type BoardDefinition, type Coordinate, type GravityDirection } from "../board/board-types.js";
import type { CascadeMovement, CascadeReport, RefillPlacement, RefillProvider } from "./cascade-types.js";

interface MovableContent {
  readonly source: Coordinate;
  readonly tile: NonNullable<BoardCell["tile"]>;
  readonly overlays: BoardCell["overlays"];
}

export function resolveCascade(
  board: BoardDefinition,
  provider: RefillProvider,
  cascadeIndex: number,
  gravity: GravityDirection = board.gravity,
): CascadeReport {
  if (!Number.isSafeInteger(cascadeIndex) || cascadeIndex < 0) throw new TypeError("Cascade index must be a non-negative safe integer");
  const model = new BoardModel(board, false);
  const updated = new Map(board.cells.map((cell) => [coordinateKey(cell.coordinate), structuredClone(cell)] as const));
  const movements: CascadeMovement[] = [];
  const refills: RefillPlacement[] = [];
  let refillIndex = 0;
  for (const line of buildLines(board, gravity)) {
    for (const segment of splitSegments(line, model)) {
      const contents: MovableContent[] = [];
      for (const coordinate of segment) {
        const cell = model.requireCell(coordinate);
        if (cell.tile && cell.tile.family !== "empty") contents.push({ source: coordinate, tile: cell.tile, overlays: cell.overlays });
      }
      for (const coordinate of segment) {
        const cell = updated.get(coordinateKey(coordinate));
        if (!cell) continue;
        const empty: BoardCell = { ...cell, state: "empty", overlays: [] };
        delete (empty as { tile?: unknown }).tile;
        updated.set(coordinateKey(coordinate), empty);
      }
      contents.forEach((content, index) => {
        const targetCoordinate = segment[index];
        if (!targetCoordinate) return;
        const target = updated.get(coordinateKey(targetCoordinate));
        if (!target) return;
        updated.set(coordinateKey(targetCoordinate), { ...target, state: "active", tile: content.tile, overlays: content.overlays });
        if (coordinateKey(content.source) !== coordinateKey(targetCoordinate)) {
          movements.push({ sequence: movements.length, tileId: content.tile.id, from: structuredClone(content.source), to: structuredClone(targetCoordinate) });
        }
      });
      for (let index = contents.length; index < segment.length; index += 1) {
        const coordinate = segment[index];
        if (!coordinate) continue;
        const content = provider.next({ boardId: board.id, cascadeIndex, refillIndex, coordinate: structuredClone(coordinate), gravity });
        const currentRefillIndex = refillIndex;
        refillIndex += 1;
        if (!content) continue;
        const target = updated.get(coordinateKey(coordinate));
        if (!target) continue;
        updated.set(coordinateKey(coordinate), {
          ...target,
          state: "active",
          tile: structuredClone(content.tile),
          overlays: structuredClone(content.overlays ?? []),
          metadata: { ...target.metadata, ...(content.metadata ?? {}), refilledAtCascade: cascadeIndex },
        });
        refills.push({ sequence: refills.length, tileId: content.tile.id, coordinate: structuredClone(coordinate), refillIndex: currentRefillIndex });
      }
    }
  }
  const nextBoard: BoardDefinition = { ...structuredClone(board), gravity, cells: board.cells.map((cell) => structuredClone(updated.get(coordinateKey(cell.coordinate)) ?? cell)) };
  new BoardModel(nextBoard, false);
  const remainingEmptyCoordinates = nextBoard.cells.filter((cell) => cell.state === "empty" || !cell.tile).map((cell) => structuredClone(cell.coordinate));
  const entryKeys = new Set(nextBoard.entryPositions.map(coordinateKey));
  const mayContainContinuation = nextBoard.cells.some((cell) => entryKeys.has(coordinateKey(cell.coordinate)) && cell.state === "active" && cell.tile !== undefined);
  return {
    cascadeIndex,
    gravity,
    boardBefore: structuredClone(board),
    board: nextBoard,
    movements,
    refills,
    remainingEmptyCoordinates,
    mayContainContinuation,
    providerSnapshot: provider.snapshot?.() ?? null,
  };
}

function buildLines(board: BoardDefinition, gravity: GravityDirection): readonly (readonly Coordinate[])[] {
  const lines: Coordinate[][] = [];
  if (gravity === "down" || gravity === "up") {
    for (let column = 0; column < board.width; column += 1) {
      const line: Coordinate[] = [];
      for (let offset = 0; offset < board.height; offset += 1) {
        const row = gravity === "down" ? board.height - 1 - offset : offset;
        line.push({ row, column });
      }
      lines.push(line);
    }
  } else {
    for (let row = 0; row < board.height; row += 1) {
      const line: Coordinate[] = [];
      for (let offset = 0; offset < board.width; offset += 1) {
        const column = gravity === "right" ? board.width - 1 - offset : offset;
        line.push({ row, column });
      }
      lines.push(line);
    }
  }
  return lines;
}

function splitSegments(line: readonly Coordinate[], board: BoardModel): readonly (readonly Coordinate[])[] {
  const segments: Coordinate[][] = [];
  let current: Coordinate[] = [];
  const flush = (): void => { if (current.length > 0) segments.push(current); current = []; };
  for (const coordinate of line) {
    const cell = board.requireCell(coordinate);
    const barrier = cell.state === "sealed" || cell.state === "blocked" || cell.state === "reserved" || cell.tile?.movable === false;
    if (barrier) flush();
    else current.push(coordinate);
  }
  flush();
  return segments;
}
