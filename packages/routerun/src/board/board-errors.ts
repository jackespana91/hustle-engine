export type BoardErrorCode =
  | "INVALID_DIMENSIONS"
  | "UNSAFE_CONFIGURATION"
  | "DUPLICATE_CELL_ID"
  | "DUPLICATE_COORDINATE"
  | "COORDINATE_OUT_OF_BOUNDS"
  | "COORDINATE_MISMATCH"
  | "INVALID_CELL"
  | "INVALID_CONNECTION"
  | "MISSING_CELL"
  | "SERIALIZATION_FAILURE";

export class BoardError extends Error {
  constructor(
    readonly code: BoardErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "BoardError";
  }
}

export interface BoardValidationIssue {
  readonly code: BoardErrorCode;
  readonly message: string;
  readonly path: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface BoardValidationResult {
  readonly valid: boolean;
  readonly errors: readonly BoardValidationIssue[];
  readonly warnings: readonly BoardValidationIssue[];
}
