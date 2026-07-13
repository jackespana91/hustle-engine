import type { RouteRunEngineInspection } from "../routerun-engine.js";

export interface RouteRunDebugSnapshot {
  readonly engineVersion: string;
  readonly phase: string;
  readonly boardSize: string;
  readonly activeCells: number;
  readonly runnerPosition: string;
  readonly routeLength: number;
  readonly currentStep: number;
  readonly overlaysCollected: number;
  readonly cascadeCount: number;
  readonly expansionCount: number;
  readonly terminalReason: string;
  readonly currentSnapshotVersion: number;
  readonly latestEvent: string;
  readonly latestIssue: string;
}

export interface RouteRunDebugPanelIntegration {
  readonly getState: () => RouteRunDebugSnapshot;
}

export class RouteRunDebugAdapter implements RouteRunDebugPanelIntegration {
  constructor(private readonly inspectEngine: () => RouteRunEngineInspection) {}

  getState = (): RouteRunDebugSnapshot => {
    const inspection = this.inspectEngine();
    return {
      engineVersion: inspection.engineVersion,
      phase: inspection.phase,
      boardSize: inspection.board ? `${inspection.board.width}×${inspection.board.height}` : "—",
      activeCells: inspection.board?.cells.filter(({ state }) => state === "active" || state === "empty").length ?? 0,
      runnerPosition: inspection.runner ? `${inspection.runner.currentCoordinate.row}:${inspection.runner.currentCoordinate.column}` : "—",
      routeLength: inspection.preview?.steps.length ?? 0,
      currentStep: inspection.completedRouteSteps.length,
      overlaysCollected: inspection.collectedOverlays.length,
      cascadeCount: inspection.completedCascades.length,
      expansionCount: inspection.activeExpansions.length,
      terminalReason: inspection.terminalState?.reason ?? "—",
      currentSnapshotVersion: 1,
      latestEvent: inspection.latestEvent ?? "—",
      latestIssue: inspection.latestIssue ?? "None",
    };
  };
}
