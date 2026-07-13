import type { OutcomeValidationIssue } from "./outcome-types.js";

export type OutcomeErrorCode =
  | "INVALID_OUTCOME"
  | "DUPLICATE_OUTCOME"
  | "UNKNOWN_OUTCOME"
  | "INVALID_EDIT"
  | "INVALID_REPLAY"
  | "PLAYBACK_FAILED"
  | "PLAYBACK_NOT_ACTIVE"
  | "RECOVERY_FAILED"
  | "SERIALIZATION_FAILED";

export class OutcomeSystemError extends Error {
  constructor(
    readonly code: OutcomeErrorCode,
    message: string,
    readonly issues: readonly OutcomeValidationIssue[] = [],
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OutcomeSystemError";
  }
}

export function invalidOutcomeError(issues: readonly OutcomeValidationIssue[]): OutcomeSystemError {
  const first = issues[0];
  return new OutcomeSystemError(
    "INVALID_OUTCOME",
    first ? `Outcome validation failed: ${first.message}` : "Outcome validation failed",
    issues,
  );
}
