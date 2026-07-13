import { BoardError } from "../board/board-errors.js";
import type { BoardModel } from "../board/board-model.js";
import type { PlaceRunnerInput, RunnerState } from "./runner-types.js";

export function createRunnerState(board: BoardModel, input: PlaceRunnerInput): RunnerState {
  const cell = board.cellAt(input.coordinate);
  if (!cell || (cell.state !== "active" && cell.state !== "empty") || !cell.tile || cell.tile.family === "blocker" || cell.tile.family === "empty") {
    throw new BoardError("INVALID_CELL", `Runner cannot be placed at ${input.coordinate.row}:${input.coordinate.column}`);
  }
  const configuredEntry = board.entryPositions.some(({ row, column }) => row === input.coordinate.row && column === input.coordinate.column);
  const retained = input.metadata?.retainedPosition === true;
  if (!configuredEntry && !retained) throw new BoardError("INVALID_CELL", "Runner placement must use a configured entry or retained legal position");
  return {
    id: input.id,
    currentCoordinate: structuredClone(input.coordinate),
    entryDirection: input.entryDirection,
    currentDirection: input.currentDirection ?? input.entryDirection,
    movementStatus: "placed",
    visitedCellIds: [],
    collectedOverlayIds: [],
    accumulatedPresentationValue: 0,
    metadata: structuredClone(input.metadata ?? {}),
  };
}
