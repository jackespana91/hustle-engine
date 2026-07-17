export type SpatialRouteErrorCode = "INVALID_DEFINITION" | "INVALID_SEGMENT" | "INVALID_CUE";

export class SpatialRouteError extends Error {
  override readonly name = "SpatialRouteError";

  constructor(readonly code: SpatialRouteErrorCode, message: string) {
    super(message);
  }
}
