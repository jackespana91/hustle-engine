import type { FeatureManifestId } from "../manifests/manifest-types.js";
import type {
  FeatureFailurePolicy,
  FeatureLifecycleOperation,
  FeatureState,
} from "./feature-types.js";

export type FeatureErrorCode =
  | "DUPLICATE_FEATURE"
  | "UNKNOWN_FEATURE"
  | "INVALID_IMPLEMENTATION"
  | "MANIFEST_MISMATCH"
  | "IMPLEMENTATION_MANIFEST_MISMATCH"
  | "UNSUPPORTED_VERSION"
  | "VERSION_MISMATCH"
  | "UNSUPPORTED_ENGINE"
  | "MISSING_DEPENDENCY"
  | "CIRCULAR_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "FEATURE_CONFLICT"
  | "FEATURE_DISABLED"
  | "INVALID_CONTEXT"
  | "INVALID_RESULT"
  | "INVALID_STATE"
  | "INVALID_SNAPSHOT"
  | "STATE_VERSION_MISMATCH"
  | "MIGRATION_NOT_FOUND"
  | "RECOVERY_FAILED"
  | "LIFECYCLE_FAILURE"
  | "TRIGGER_FAILURE"
  | "UPDATE_FAILURE"
  | "CLEANUP_FAILURE"
  | "RANDOM_SOURCE_EXHAUSTED";

export interface FeatureErrorOptions {
  readonly featureId?: FeatureManifestId;
  readonly operation?: FeatureLifecycleOperation;
  readonly failurePolicy?: FeatureFailurePolicy;
  readonly recoverable?: boolean;
  readonly context?: FeatureState;
  readonly cause?: unknown;
}

export interface FeatureErrorRecord {
  readonly code: FeatureErrorCode;
  readonly message: string;
  readonly featureId?: FeatureManifestId;
  readonly operation?: FeatureLifecycleOperation;
  readonly failurePolicy?: FeatureFailurePolicy;
  readonly recoverable: boolean;
  readonly context?: FeatureState;
}

/** Structured, policy-aware error surfaced by every Feature SDK layer. */
export class FeatureSdkError extends Error {
  readonly featureId: FeatureManifestId | undefined;
  readonly operation: FeatureLifecycleOperation | undefined;
  readonly failurePolicy: FeatureFailurePolicy | undefined;
  readonly recoverable: boolean;
  readonly context: FeatureState | undefined;

  constructor(
    readonly code: FeatureErrorCode,
    message: string,
    options: FeatureErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FeatureSdkError";
    this.featureId = options.featureId;
    this.operation = options.operation;
    this.failurePolicy = options.failurePolicy;
    this.recoverable = options.recoverable ?? false;
    this.context = options.context;
  }

  toRecord(): FeatureErrorRecord {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      ...(this.featureId === undefined ? {} : { featureId: this.featureId }),
      ...(this.operation === undefined ? {} : { operation: this.operation }),
      ...(this.failurePolicy === undefined ? {} : { failurePolicy: this.failurePolicy }),
      ...(this.context === undefined ? {} : { context: this.context }),
    };
  }
}

export function featureError(
  code: FeatureErrorCode,
  message: string,
  options: FeatureErrorOptions = {},
): FeatureSdkError {
  return new FeatureSdkError(code, message, options);
}

export function asFeatureSdkError(
  error: unknown,
  code: FeatureErrorCode,
  message: string,
  options: FeatureErrorOptions = {},
): FeatureSdkError {
  return error instanceof FeatureSdkError
    ? error
    : new FeatureSdkError(code, message, { ...options, cause: error });
}
