import { BoardError } from "../board/board-errors.js";
import { BoardModel } from "../board/board-model.js";
import { coordinateKey, type BoardCell, type BoardDefinition } from "../board/board-types.js";
import type { ExpansionChange, ExpansionDefinition, ExpansionReport } from "./expansion-types.js";

export interface ExpansionLimits {
  readonly maximumWidth: number;
  readonly maximumHeight: number;
  readonly maximumActiveCells: number;
}

export const DEFAULT_EXPANSION_LIMITS: ExpansionLimits = { maximumWidth: 32, maximumHeight: 32, maximumActiveCells: 512 };

export function applyBoardExpansion(
  board: BoardDefinition,
  expansion: ExpansionDefinition,
  limits: ExpansionLimits = DEFAULT_EXPANSION_LIMITS,
): ExpansionReport {
  const width = expansion.targetWidth ?? board.width;
  const height = expansion.targetHeight ?? board.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < board.width || height < board.height) {
    throw new BoardError("INVALID_DIMENSIONS", "Expansion dimensions cannot shrink the board");
  }
  if (width > limits.maximumWidth || height > limits.maximumHeight || width * height > limits.maximumActiveCells) {
    throw new BoardError("UNSAFE_CONFIGURATION", "Expansion exceeds configured board safety limits", { width, height });
  }
  const byKey = new Map(board.cells.map((cell) => [coordinateKey(cell.coordinate), structuredClone(cell)] as const));
  const changes: ExpansionChange[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const coordinate = { row, column };
      const key = coordinateKey(coordinate);
      if (!byKey.has(key)) {
        const cell: BoardCell = { id: `cell-${row}-${column}`, coordinate, state: "sealed", overlays: [], metadata: { expansionArea: expansion.id } };
        byKey.set(key, cell);
        changes.push({ sequence: changes.length, coordinate, before: null, after: structuredClone(cell), type: "cell-created" });
      }
    }
  }
  const activationKeys = new Set<string>();
  for (const activation of expansion.activations) {
    const key = coordinateKey(activation.coordinate);
    if (activationKeys.has(key)) throw new BoardError("DUPLICATE_COORDINATE", `Expansion ${expansion.id} activates ${key} more than once`);
    activationKeys.add(key);
    const before = byKey.get(key);
    if (!before) throw new BoardError("COORDINATE_OUT_OF_BOUNDS", `Expansion activation ${key} is outside target bounds`);
    if (before.state !== "sealed" && before.state !== "reserved") throw new BoardError("INVALID_CELL", `Expansion activation ${key} must target a sealed or reserved cell`);
    const after: BoardCell = {
      ...before,
      state: activation.tile ? "active" : "empty",
      ...(activation.tile ? { tile: structuredClone(activation.tile) } : {}),
      overlays: structuredClone(activation.overlays ?? []),
      metadata: { ...before.metadata, ...(activation.metadata ?? {}), activatedByExpansion: expansion.id },
    };
    byKey.set(key, after);
    changes.push({ sequence: changes.length, coordinate: structuredClone(activation.coordinate), before, after, type: "cell-activated" });
  }
  if (activationKeys.size === 0) throw new BoardError("INVALID_CELL", `Expansion ${expansion.id} must activate at least one cell`);
  const cells = [...byKey.values()].sort((left, right) => left.coordinate.row - right.coordinate.row || left.coordinate.column - right.coordinate.column);
  const next: BoardDefinition = { ...structuredClone(board), width, height, cells, metadata: { ...board.metadata, lastExpansion: expansion.id } };
  new BoardModel(next, false);
  return { expansionId: expansion.id, boardBefore: structuredClone(board), board: next, changes };
}
