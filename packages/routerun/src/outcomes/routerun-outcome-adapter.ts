import { OUTCOME_SCHEMA_VERSION, engineManifestId, gameManifestId, outcomeId, roundId, type JsonObject, type OutcomeDefinition } from "@hustle/core";
import { ROUTERUN_ENGINE_ID } from "../routerun-manifest.js";
import { translateRouteRunEvents, toJsonObject } from "./routerun-event-translator.js";
import type { RouteRunOutcomeAdaptation, RouteRunTimelineEvent } from "./routerun-outcome-types.js";

export interface AdaptRouteRunOutcomeOptions {
  readonly id: string;
  readonly roundReference: string;
  readonly name: string;
  readonly description: string;
  readonly events: readonly RouteRunTimelineEvent[];
  readonly expectedFinalState: JsonObject;
  readonly tags?: readonly string[];
  readonly gameId?: string;
}

export function adaptRouteRunOutcome(options: AdaptRouteRunOutcomeOptions): RouteRunOutcomeAdaptation {
  const events = translateRouteRunEvents(options.events);
  const definition: OutcomeDefinition = {
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    id: outcomeId(options.id),
    roundId: roundId(options.roundReference),
    name: options.name,
    description: options.description,
    engineId: engineManifestId(ROUTERUN_ENGINE_ID),
    gameId: gameManifestId(options.gameId ?? "routerun-diagnostic-game"),
    deterministicSource: { type: "reference", value: `routerun:${options.id}` },
    betAmountMinor: 0,
    totalWinMinor: 0,
    events,
    expectedFinalState: toJsonObject(options.expectedFinalState),
    tags: [...(options.tags ?? []), "routerun", "diagnostic", "non-production"],
    metadata: { engineVersion: "0.1.0", commercialMath: false, production: false },
    sequencePolicy: "contiguous",
  };
  return { definition, eventCount: events.length, deterministicSignature: JSON.stringify(events.map(({ type, payload }) => [type, payload])) };
}
