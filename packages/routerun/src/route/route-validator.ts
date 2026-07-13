import { coordinateKey } from "../board/board-types.js";
import type { RouteResolution } from "./route-types.js";

export interface RouteDivergence {
  readonly index: number;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
}

export interface RouteComparison {
  readonly equal: boolean;
  readonly divergences: readonly RouteDivergence[];
  readonly firstDivergence: RouteDivergence | null;
}

export function compareRouteResolutions(expected: RouteResolution, actual: RouteResolution): RouteComparison {
  const divergences: RouteDivergence[] = [];
  const max = Math.max(expected.steps.length, actual.steps.length);
  for (let index = 0; index < max; index += 1) {
    const left = expected.steps[index];
    const right = actual.steps[index];
    const normalizedLeft = left ? [coordinateKey(left.coordinate), left.enteredFrom, left.exitedTo, left.tileId] : null;
    const normalizedRight = right ? [coordinateKey(right.coordinate), right.enteredFrom, right.exitedTo, right.tileId] : null;
    if (JSON.stringify(normalizedLeft) !== JSON.stringify(normalizedRight)) {
      divergences.push({ index, expected: normalizedLeft, actual: normalizedRight, message: `Route diverged at step ${index}` });
    }
  }
  if (expected.terminalReason !== actual.terminalReason) {
    divergences.push({ index: max, expected: expected.terminalReason, actual: actual.terminalReason, message: "Route terminal reason diverged" });
  }
  return { equal: divergences.length === 0, divergences, firstDivergence: divergences[0] ?? null };
}
