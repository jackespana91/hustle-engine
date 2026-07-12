export type FeatureErrorCode =
  | "DUPLICATE_FEATURE"
  | "MISSING_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "UNKNOWN_FEATURE"
  | "UNSUPPORTED_ENGINE"
  | "INVALID_SNAPSHOT"
  | "VERSION_MISMATCH";

export class FeatureSdkError extends Error {
  constructor(public readonly code: FeatureErrorCode, message: string) {
    super(message);
    this.name = "FeatureSdkError";
  }
}
