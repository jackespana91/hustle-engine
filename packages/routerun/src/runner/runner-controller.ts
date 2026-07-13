import type { OverlayCollection } from "../overlays/overlay-types.js";
import type { RouteStep, RouteTerminalReason } from "../route/route-types.js";
import type { RunnerState } from "./runner-types.js";

export function applyRunnerStep(runner: RunnerState, step: RouteStep, collections: readonly OverlayCollection[] = []): RunnerState {
  const collectedAtStep = collections.filter((collection) => collection.routeStepSequence === step.sequence);
  return {
    ...structuredClone(runner),
    currentCoordinate: structuredClone(step.coordinate),
    currentDirection: step.exitedTo ?? runner.currentDirection,
    movementStatus: step.destinationReached ? "destination" : "moving",
    visitedCellIds: runner.visitedCellIds.includes(step.cellId) ? [...runner.visitedCellIds] : [...runner.visitedCellIds, step.cellId],
    collectedOverlayIds: [...new Set([...runner.collectedOverlayIds, ...collectedAtStep.map(({ overlayId }) => overlayId)])],
    accumulatedPresentationValue: runner.accumulatedPresentationValue + collectedAtStep.reduce((sum, item) => sum + item.valueMinor, 0),
  };
}

export function finalizeRunner(runner: RunnerState, terminal: RouteTerminalReason): RunnerState {
  return {
    ...structuredClone(runner),
    movementStatus: terminal === "destination-reached" ? "destination" : terminal === "interrupted" ? "interrupted" : terminal === "failed" ? "failed" : "terminal",
  };
}
