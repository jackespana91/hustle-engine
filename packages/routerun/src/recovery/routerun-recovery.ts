import { BoardModel } from "../board/board-model.js";
import { ROUTERUN_ENGINE_VERSION } from "../routerun-manifest.js";
import { ROUTERUN_SNAPSHOT_SCHEMA_VERSION, type RouteRunSnapshot } from "./routerun-snapshot.js";

export function validateRouteRunSnapshot(snapshot: RouteRunSnapshot): void {
  if (snapshot.schemaVersion !== ROUTERUN_SNAPSHOT_SCHEMA_VERSION) throw new Error(`Unsupported RouteRun snapshot schema ${String(snapshot.schemaVersion)}`);
  if (snapshot.engineVersion !== ROUTERUN_ENGINE_VERSION) throw new Error(`Unsupported RouteRun engine snapshot version ${snapshot.engineVersion}`);
  new BoardModel(snapshot.boardDefinition, false);
  new BoardModel(snapshot.currentBoardState, false);
  if (!Number.isSafeInteger(snapshot.logicalTick) || snapshot.logicalTick < 0) throw new Error("RouteRun snapshot logical tick is invalid");
  const operationIds = new Set(snapshot.completedOperationIds);
  if (operationIds.size !== snapshot.completedOperationIds.length) throw new Error("RouteRun snapshot contains duplicate operation ids");
  const stepSequences = new Set(snapshot.completedRouteSteps.map(({ sequence }) => sequence));
  if (stepSequences.size !== snapshot.completedRouteSteps.length) throw new Error("RouteRun snapshot contains duplicate route steps");
  const overlayIds = new Set(snapshot.collectedOverlays.map(({ overlayId }) => overlayId));
  if (overlayIds.size !== snapshot.collectedOverlays.length) throw new Error("RouteRun snapshot contains duplicate overlay collections");
  const cascadeIds = new Set(snapshot.completedCascades.map(({ cascadeIndex }) => cascadeIndex));
  if (cascadeIds.size !== snapshot.completedCascades.length) throw new Error("RouteRun snapshot contains duplicate cascades");
}
