import type { JsonObject, OutcomeDefinition } from "@hustle/core";

export const ROUTERUN_OUTCOME_EVENT_TYPES = [
  "routerun.board.initialize",
  "routerun.runner.place",
  "routerun.route.resolve",
  "routerun.route.preview",
  "routerun.runner.move",
  "routerun.overlay.collect",
  "routerun.cells.clear",
  "routerun.cascade.apply",
  "routerun.expansion.apply",
  "routerun.round.terminal",
] as const;

export type RouteRunOutcomeEventType = typeof ROUTERUN_OUTCOME_EVENT_TYPES[number];

export interface RouteRunTimelineEvent {
  readonly id: string;
  readonly type: RouteRunOutcomeEventType;
  readonly logicalTick: number;
  readonly payload: JsonObject;
  readonly animationType?: string;
  readonly durationMs?: number;
}

export interface RouteRunOutcomeAdaptation {
  readonly definition: OutcomeDefinition;
  readonly eventCount: number;
  readonly deterministicSignature: string;
}
