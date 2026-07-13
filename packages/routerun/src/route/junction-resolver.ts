import { CARDINAL_DIRECTIONS, coordinateKey, type Coordinate, type Direction } from "../board/board-types.js";
import { RouteError } from "./route-errors.js";
import type { JunctionResolutionMap, RouteDecision } from "./route-types.js";

export const DEFAULT_JUNCTION_FALLBACK: readonly Direction[] = ["north", "east", "south", "west"];

export interface ResolveJunctionOptions {
  readonly coordinate: Coordinate;
  readonly legalExits: readonly Direction[];
  readonly instructions?: JunctionResolutionMap;
  readonly fallbackPriority?: readonly Direction[];
  readonly allowFallback?: boolean;
}

export function resolveJunction(options: ResolveJunctionOptions): RouteDecision {
  const requestedValue = options.instructions?.[coordinateKey(options.coordinate)];
  const requested = requestedValue === undefined ? [] : Array.isArray(requestedValue) ? requestedValue : [requestedValue];
  const explicit = requested.find((direction) => options.legalExits.includes(direction));
  if (requested.length > 0 && !explicit) {
    throw new RouteError("ILLEGAL_JUNCTION_INSTRUCTION", `Junction instruction at ${coordinateKey(options.coordinate)} requests no legal exit`, {
      coordinate: options.coordinate, requested, legalExits: options.legalExits,
    });
  }
  if (explicit) return { coordinate: structuredClone(options.coordinate), requested, legalExits: [...options.legalExits], chosen: explicit, reason: "explicit" };
  if (options.legalExits.length === 1) {
    const chosen = options.legalExits[0];
    if (!chosen) throw new RouteError("INVALID_ROUTE", "A single-exit junction had no exit");
    return { coordinate: structuredClone(options.coordinate), requested, legalExits: [...options.legalExits], chosen, reason: "single-exit" };
  }
  if (options.allowFallback === false) {
    throw new RouteError("ILLEGAL_JUNCTION_INSTRUCTION", `Junction at ${coordinateKey(options.coordinate)} requires an explicit instruction`, { legalExits: options.legalExits });
  }
  const priority = options.fallbackPriority ?? DEFAULT_JUNCTION_FALLBACK;
  if (new Set(priority).size !== priority.length || priority.some((direction) => !CARDINAL_DIRECTIONS.includes(direction))) {
    throw new RouteError("INVALID_ROUTE", "Fallback priority must contain unique cardinal directions");
  }
  const chosen = priority.find((direction) => options.legalExits.includes(direction));
  if (!chosen) throw new RouteError("INVALID_ROUTE", "Fallback priority contains no legal junction exit");
  return { coordinate: structuredClone(options.coordinate), requested, legalExits: [...options.legalExits], chosen, reason: "stable-fallback" };
}
