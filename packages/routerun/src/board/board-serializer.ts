import { BoardError } from "./board-errors.js";
import type { BoardDefinition } from "./board-types.js";
import { assertValidBoard } from "./board-validator.js";

export const ROUTERUN_BOARD_SCHEMA_VERSION = 1 as const;

export interface SerializedBoard {
  readonly schemaVersion: typeof ROUTERUN_BOARD_SCHEMA_VERSION;
  readonly board: BoardDefinition;
}

export function serializeBoard(board: BoardDefinition): string {
  assertValidBoard(board, { validateConnections: false });
  return JSON.stringify({ schemaVersion: ROUTERUN_BOARD_SCHEMA_VERSION, board } satisfies SerializedBoard);
}

export function deserializeBoard(value: string): BoardDefinition {
  try {
    const parsed = JSON.parse(value) as Partial<SerializedBoard>;
    if (parsed.schemaVersion !== ROUTERUN_BOARD_SCHEMA_VERSION || !parsed.board) {
      throw new BoardError("SERIALIZATION_FAILURE", "Unsupported or malformed RouteRun board snapshot");
    }
    assertValidBoard(parsed.board, { validateConnections: false });
    return structuredClone(parsed.board);
  } catch (error) {
    if (error instanceof BoardError) throw error;
    throw new BoardError("SERIALIZATION_FAILURE", "RouteRun board JSON could not be parsed", { cause: error instanceof Error ? error.message : String(error) });
  }
}
