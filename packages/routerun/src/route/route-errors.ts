export type RouteErrorCode = "ILLEGAL_JUNCTION_INSTRUCTION" | "INVALID_RUNNER" | "ROUTE_DIVERGENCE" | "INVALID_ROUTE";

export class RouteError extends Error {
  constructor(
    readonly code: RouteErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "RouteError";
  }
}
