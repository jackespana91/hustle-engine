import { assetId, type AssetId } from "./asset-types.js";

export type AssetErrorCode =
  | "UNKNOWN_ASSET"
  | "DUPLICATE_ASSET"
  | "INVALID_ASSET"
  | "INVALID_ASSET_PATH"
  | "VARIANT_RESOLUTION_FAILURE"
  | "MISSING_FALLBACK"
  | "CIRCULAR_FALLBACK"
  | "REQUIRED_ASSET_LOAD_FAILURE"
  | "OPTIONAL_ASSET_LOAD_FAILURE"
  | "ASSET_TIMEOUT"
  | "ASSET_CANCELLED"
  | "CHECKSUM_MISMATCH"
  | "CACHE_CAPACITY"
  | "INVALID_ASSET_MANIFEST"
  | "ASSET_MANIFEST_CONFLICT"
  | "ATOMIC_RELOAD_FAILURE"
  | "INVALID_ASSET_SNAPSHOT"
  | "UNSUPPORTED_ASSET_SNAPSHOT_VERSION"
  | "ASSET_RECOVERY_FAILURE";

export interface AssetErrorOptions {
  readonly assetId?: AssetId | string;
  readonly recoverable?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export interface AssetErrorRecord {
  readonly code: AssetErrorCode;
  readonly message: string;
  readonly assetId: AssetId | null;
  readonly recoverable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Structured error shared by registry, resolver, cache and loader layers. */
export class AssetSystemError extends Error {
  readonly assetId: AssetId | null;
  readonly recoverable: boolean;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: AssetErrorCode,
    message: string,
    options: AssetErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AssetSystemError";
    this.assetId = options.assetId === undefined ? null : assetId(String(options.assetId));
    this.recoverable = options.recoverable ?? false;
    this.details = options.details === undefined ? {} : structuredClone(options.details);
  }

  toRecord(): AssetErrorRecord {
    return {
      code: this.code,
      message: this.message,
      assetId: this.assetId,
      recoverable: this.recoverable,
      details: structuredClone(this.details),
    };
  }
}

export class UnknownAssetError extends AssetSystemError {
  constructor(id: AssetId | string) {
    super("UNKNOWN_ASSET", `Unknown asset: ${String(id)}`, { assetId: id });
    this.name = "UnknownAssetError";
  }
}

export class AssetCancelledError extends AssetSystemError {
  constructor(id: AssetId | string, cause?: unknown) {
    super("ASSET_CANCELLED", `Asset request cancelled: ${String(id)}`, {
      assetId: id,
      recoverable: true,
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = "AssetCancelledError";
  }
}

export class AssetTimeoutError extends AssetSystemError {
  constructor(id: AssetId | string, timeoutMs: number) {
    super("ASSET_TIMEOUT", `Asset request timed out after ${timeoutMs} ms: ${String(id)}`, {
      assetId: id,
      recoverable: true,
      details: { timeoutMs },
    });
    this.name = "AssetTimeoutError";
  }
}

export class AssetCacheCapacityError extends AssetSystemError {
  constructor(id: AssetId | string, requestedBytes: number, maximumBytes: number) {
    super("CACHE_CAPACITY", `Asset ${String(id)} cannot fit within the estimated cache capacity`, {
      assetId: id,
      recoverable: true,
      details: { requestedBytes, maximumEstimatedBytes: maximumBytes },
    });
    this.name = "AssetCacheCapacityError";
  }
}

export function asAssetSystemError(
  error: unknown,
  code: AssetErrorCode,
  message: string,
  options: AssetErrorOptions = {},
): AssetSystemError {
  return error instanceof AssetSystemError
    ? error
    : new AssetSystemError(code, message, { ...options, cause: error });
}
