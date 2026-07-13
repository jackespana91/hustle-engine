import type { ThemeId, ThemeLayer, ThemeMetadata } from "./theme-types.js";

export type ThemeErrorCode =
  | "INVALID_THEME"
  | "DUPLICATE_THEME"
  | "UNKNOWN_THEME"
  | "INVALID_ID"
  | "INVALID_VERSION"
  | "INVALID_LAYER"
  | "INVALID_TOKEN"
  | "INVALID_ALIAS"
  | "PROTOTYPE_POLLUTION"
  | "MISSING_PARENT"
  | "MISSING_FALLBACK"
  | "PARENT_CYCLE"
  | "FALLBACK_CYCLE"
  | "INVALID_LAYER_ORDER"
  | "INCOMPATIBLE_ENGINE"
  | "INCOMPATIBLE_GAME"
  | "INCOMPATIBLE_THEME"
  | "INVALID_SELECTION"
  | "RESOLUTION_FAILED"
  | "SWAP_FAILED"
  | "INVALID_JSON"
  | "LOAD_FAILED"
  | "INVALID_SNAPSHOT"
  | "STATE_VERSION_MISMATCH"
  | "HASH_MISMATCH"
  | "RESTORE_FAILED";

export interface ThemeValidationError {
  readonly code: ThemeErrorCode;
  readonly message: string;
  readonly path: string;
  readonly themeId?: ThemeId;
  readonly layer?: ThemeLayer;
  readonly details?: ThemeMetadata;
}

export class ThemeSystemError extends Error {
  constructor(
    readonly errors: readonly ThemeValidationError[],
    message = errors.map((error) => error.message).join("; ") || "Theme subsystem error",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ThemeSystemError";
  }

  get code(): ThemeErrorCode { return this.errors[0]?.code ?? "INVALID_THEME"; }
}

export function themeError(
  code: ThemeErrorCode,
  message: string,
  path: string,
  options: {
    readonly themeId?: ThemeId;
    readonly layer?: ThemeLayer;
    readonly details?: ThemeMetadata;
  } = {},
): ThemeValidationError {
  return {
    code,
    message,
    path,
    ...(options.themeId === undefined ? {} : { themeId: options.themeId }),
    ...(options.layer === undefined ? {} : { layer: options.layer }),
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}

export function throwThemeError(error: ThemeValidationError, cause?: unknown): never {
  throw new ThemeSystemError([error], undefined, cause === undefined ? undefined : { cause });
}
