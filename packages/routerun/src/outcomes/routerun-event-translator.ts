import { outcomeEventId, type JsonObject, type OutcomeEvent } from "@hustle/core";
import type { RouteRunTimelineEvent } from "./routerun-outcome-types.js";

export function translateRouteRunEvents(events: readonly RouteRunTimelineEvent[]): readonly OutcomeEvent[] {
  return events.map((event, sequence) => ({
    id: outcomeEventId(event.id),
    sequence,
    type: event.type,
    logicalTick: event.logicalTick,
    payload: structuredClone(event.payload),
    blocking: true,
    skippable: true,
    dependsOn: sequence === 0 ? [] : [outcomeEventId(events[sequence - 1]?.id ?? event.id)],
    expectedStateChanges: toJsonObject({ lastRouteRunEvent: event.type, logicalTick: event.logicalTick }),
    animationHints: event.animationType ? [{
      type: event.animationType,
      durationMs: event.durationMs ?? 120,
      payload: structuredClone(event.payload),
      blocking: true,
      skippable: true,
      metadata: { engine: "engine.routerun" },
    }] : [],
    assetIds: [],
    themeIds: [],
    metadata: { engine: "engine.routerun", deterministic: true },
  }));
}

export function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
