import { animationId, type AnimationCommand } from "@hustle/core";
import type { CascadeReport, ClearReport } from "./cascade/cascade-types.js";
import type { ExpansionReport } from "./expansion/expansion-types.js";
import type { OverlayCollection } from "./overlays/overlay-types.js";
import type { RouteResolution, RouteStep } from "./route/route-types.js";

export type RouteRunAnimationType =
  | "routerun.route.highlight"
  | "routerun.runner.enter"
  | "routerun.runner.travel"
  | "routerun.overlay.collect"
  | "routerun.tile.clear"
  | "routerun.tile.compact"
  | "routerun.tile.refill"
  | "routerun.board.expand"
  | "routerun.route.terminal";

export function routePreviewCommand(route: RouteResolution): AnimationCommand {
  return command(`preview:${route.deterministicSignature.length}:${route.logicalTick}`, "routerun.route.highlight", 180, { steps: route.steps });
}

export function runnerStepCommand(step: RouteStep, runnerId: string): AnimationCommand {
  return command(`runner:${runnerId}:${step.sequence}:${step.logicalTick}`, step.sequence === 0 ? "routerun.runner.enter" : "routerun.runner.travel", 140, { runnerId, step });
}

export function overlayCommand(collection: OverlayCollection): AnimationCommand {
  return command(`overlay:${collection.overlayId}:${collection.logicalTick}`, "routerun.overlay.collect", 110, { collection });
}

export function clearCommands(report: ClearReport, tick: number): readonly AnimationCommand[] {
  return report.changes.filter(({ retained }) => !retained).map((change) => command(`clear:${change.cellId}:${tick}:${change.sequence}`, "routerun.tile.clear", 100, { change }));
}

export function cascadeCommands(report: CascadeReport, tick: number): readonly AnimationCommand[] {
  return [
    ...report.movements.map((movement) => command(`compact:${report.cascadeIndex}:${movement.sequence}:${tick}`, "routerun.tile.compact", 120, { movement })),
    ...report.refills.map((refill) => command(`refill:${report.cascadeIndex}:${refill.sequence}:${tick}`, "routerun.tile.refill", 120, { refill })),
  ];
}

export function expansionCommands(report: ExpansionReport, tick: number): readonly AnimationCommand[] {
  return [command(`expansion:${report.expansionId}:${tick}`, "routerun.board.expand", 220, { expansionId: report.expansionId, changes: report.changes })];
}

export function terminalCommand(route: RouteResolution, tick: number): AnimationCommand {
  return command(`terminal:${route.terminalReason}:${tick}`, "routerun.route.terminal", 160, { terminalReason: route.terminalReason, coordinate: route.terminalCoordinate }, false);
}

function command(id: string, type: RouteRunAnimationType, durationMs: number, payload: Readonly<Record<string, unknown>>, skippable = true): AnimationCommand {
  return { id: animationId(`routerun:${id}`), type, durationMs, payload, skippable, blocking: true, metadata: { engineId: "engine.routerun", dataOnly: true } };
}
