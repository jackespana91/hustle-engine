import { coordinateKey, type BoardCell, type BoardDefinition } from "../board/board-types.js";
import type { RouteStep } from "../route/route-types.js";
import type { ClearChange, ClearReport } from "./cascade-types.js";

export function clearTraversedCells(board: BoardDefinition, steps: readonly RouteStep[]): ClearReport {
  const byKey = new Map(board.cells.map((cell) => [coordinateKey(cell.coordinate), structuredClone(cell)] as const));
  const changes: ClearChange[] = [];
  const clearedCellIds: string[] = [];
  const retainedCellIds: string[] = [];
  for (const step of steps) {
    const key = coordinateKey(step.coordinate);
    const before = byKey.get(key);
    if (!before) continue;
    const destinationRetained = before.destination?.retainOnClear !== false && before.destination !== undefined;
    const persistentTile = before.tile?.persistent === true;
    const retained = destinationRetained || persistentTile;
    const after: BoardCell = retained ? structuredClone(before) : {
      ...structuredClone(before),
      state: "empty",
      overlays: before.overlays.filter(({ persistent }) => persistent),
      metadata: { ...before.metadata, cleared: true },
    };
    if (!retained) delete (after as { tile?: unknown }).tile;
    byKey.set(key, after);
    (retained ? retainedCellIds : clearedCellIds).push(before.id);
    changes.push({
      sequence: changes.length,
      coordinate: structuredClone(before.coordinate),
      cellId: before.id,
      before,
      after,
      retained,
      reason: destinationRetained ? "destination-retained" : persistentTile ? "persistent-tile" : "traversed",
    });
  }
  return {
    board: { ...structuredClone(board), cells: board.cells.map((cell) => structuredClone(byKey.get(coordinateKey(cell.coordinate)) ?? cell)) },
    changes,
    clearedCellIds,
    retainedCellIds,
  };
}
