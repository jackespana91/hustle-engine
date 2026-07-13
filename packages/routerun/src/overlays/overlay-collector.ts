import { coordinateKey, type BoardCell, type BoardDefinition } from "../board/board-types.js";
import type { RouteStep } from "../route/route-types.js";
import type { OverlayCollection, OverlayCollectionResult } from "./overlay-types.js";

export interface OverlayCollectionApplication extends OverlayCollectionResult {
  readonly board: BoardDefinition;
}

export function collectRouteOverlays(
  board: BoardDefinition,
  steps: readonly RouteStep[],
  alreadyCollected: readonly string[] = [],
  startingLogicalTick = 0,
): OverlayCollectionApplication {
  const collected = new Set(alreadyCollected);
  const collections: OverlayCollection[] = [];
  let accumulatedValueMinor = 0;
  const cellUpdates = new Map<string, BoardCell>();
  const byCoordinate = new Map(board.cells.map((cell) => [coordinateKey(cell.coordinate), cell] as const));
  for (const step of steps) {
    const original = cellUpdates.get(coordinateKey(step.coordinate)) ?? byCoordinate.get(coordinateKey(step.coordinate));
    if (!original) continue;
    const remaining = [];
    for (const overlay of original.overlays) {
      if (!overlay.collectable || collected.has(overlay.id)) {
        remaining.push(overlay);
        continue;
      }
      collected.add(overlay.id);
      const removed = overlay.removeOnCollect && !overlay.persistent;
      collections.push({
        sequence: collections.length,
        overlayId: overlay.id,
        type: overlay.type,
        coordinate: structuredClone(step.coordinate),
        routeStepSequence: step.sequence,
        valueMinor: overlay.valueMinor ?? 0,
        multiplierScaled: overlay.multiplierScaled ?? 0,
        removed,
        logicalTick: startingLogicalTick + collections.length + 1,
      });
      accumulatedValueMinor += overlay.valueMinor ?? 0;
      if (!removed) remaining.push(overlay);
    }
    cellUpdates.set(coordinateKey(step.coordinate), { ...original, overlays: remaining });
  }
  return {
    board: { ...structuredClone(board), cells: board.cells.map((cell) => structuredClone(cellUpdates.get(coordinateKey(cell.coordinate)) ?? cell)) },
    collections,
    collectedOverlayIds: [...collected],
    accumulatedValueMinor,
  };
}
