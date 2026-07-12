export type EngineErrorCode =
  | "INVALID_OUTCOME"
  | "ILLEGAL_STATE_TRANSITION"
  | "ANIMATION_EXECUTION_FAILURE"
  | "UNSUPPORTED_SNAPSHOT_VERSION"
  | "CORRUPTED_SNAPSHOT";

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EngineError";
  }
}

export class InvalidOutcomeError extends EngineError {
  constructor(message: string) {
    super("INVALID_OUTCOME", message);
    this.name = "InvalidOutcomeError";
  }
}

export class IllegalStateTransitionError extends EngineError {
  constructor(from: string, to: string) {
    super("ILLEGAL_STATE_TRANSITION", `Illegal round state transition: ${from} -> ${to}`);
    this.name = "IllegalStateTransitionError";
  }
}

export class AnimationExecutionError extends EngineError {
  constructor(commandId: string, cause: unknown) {
    super(
      "ANIMATION_EXECUTION_FAILURE",
      `Animation command ${commandId} failed`,
      cause instanceof Error ? { cause } : undefined,
    );
    this.name = "AnimationExecutionError";
  }
}

export class UnsupportedSnapshotVersionError extends EngineError {
  constructor(version: unknown) {
    super("UNSUPPORTED_SNAPSHOT_VERSION", `Unsupported recovery snapshot version: ${String(version)}`);
    this.name = "UnsupportedSnapshotVersionError";
  }
}

export class CorruptedSnapshotError extends EngineError {
  constructor(message: string) {
    super("CORRUPTED_SNAPSHOT", message);
    this.name = "CorruptedSnapshotError";
  }
}
