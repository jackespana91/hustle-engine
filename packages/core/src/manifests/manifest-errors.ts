import type { ManifestType } from "./manifest-types.js";

export type ManifestErrorSeverity = "error" | "warning";
export type ManifestErrorCode =
  | "MISSING_FIELD" | "INVALID_TYPE" | "MALFORMED_ID" | "INVALID_VERSION"
  | "INVALID_VERSION_RANGE" | "UNSUPPORTED_SCHEMA_VERSION" | "DUPLICATE_ID"
  | "MISSING_DEPENDENCY" | "CIRCULAR_DEPENDENCY" | "FEATURE_CONFLICT"
  | "UNSUPPORTED_ENGINE" | "UNSUPPORTED_FEATURE" | "MISSING_REFERENCE"
  | "INVALID_LOCALE" | "INVALID_ASSET_PATH" | "DUPLICATE_ASSET_ID"
  | "NEGATIVE_PERFORMANCE_LIMIT" | "INVALID_BASIS_POINTS" | "INVALID_JSON"
  | "INCOMPATIBLE_VERSION" | "INVALID_VALUE";

export interface ManifestValidationError {
  readonly code: ManifestErrorCode;
  readonly message: string;
  readonly manifestType: ManifestType | "unknown";
  readonly manifestId?: string;
  readonly fieldPath: string;
  readonly severity: ManifestErrorSeverity;
  readonly context?: Readonly<Record<string, unknown>>;
}

export class ManifestSystemError extends Error {
  constructor(
    public readonly errors: readonly ManifestValidationError[],
    message = errors.map((error) => error.message).join("; ") || "Manifest system error",
  ) {
    super(message);
    this.name = "ManifestSystemError";
  }
}

export function manifestError(
  code: ManifestErrorCode,
  message: string,
  manifestType: ManifestType | "unknown",
  fieldPath: string,
  manifestId?: string,
  context?: Readonly<Record<string, unknown>>,
  severity: ManifestErrorSeverity = "error",
): ManifestValidationError {
  return {
    code, message, manifestType, fieldPath, severity,
    ...(manifestId === undefined ? {} : { manifestId }),
    ...(context === undefined ? {} : { context }),
  };
}
