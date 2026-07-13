import { adaptRouteRunOutcome } from "../outcomes/routerun-outcome-adapter.js";
import type { RouteRunEngineInspection } from "../routerun-engine.js";

export function createExampleRouteRunOutcome(inspection: RouteRunEngineInspection) {
  return adaptRouteRunOutcome({
    id: `routerun-${inspection.board?.id ?? "diagnostic"}`,
    roundReference: `routerun-round-${inspection.board?.id ?? "diagnostic"}`,
    name: `RouteRun · ${inspection.board?.id ?? "Diagnostic"}`,
    description: "Non-production RouteRun scenario exported through the Outcome Studio adapter.",
    events: inspection.timeline,
    expectedFinalState: {
      phase: inspection.phase,
      logicalTick: inspection.logicalTick,
      terminalReason: inspection.terminalState?.reason ?? null,
      routeSteps: inspection.completedRouteSteps.length,
      overlaysCollected: inspection.collectedOverlays.length,
      cascades: inspection.completedCascades.length,
      expansions: inspection.activeExpansions.length,
    },
    tags: [inspection.board?.id ?? "diagnostic"],
  });
}
