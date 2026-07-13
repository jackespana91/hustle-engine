import { OutcomeRegistry, type OutcomeDefinition } from "@hustle/core";
import { RouteRunEngine, SequenceRefillProvider, adaptRouteRunOutcome } from "@hustle/routerun";
import { NIGHT_DROP_GAME_ID, NIGHT_DROP_THEME_ID } from "../config/ids.js";
import { NIGHT_DROP_SCENARIOS, type NightDropScenarioConfig } from "../board/night-drop-board.js";
import { createNightDropFeaturePack } from "../features/index.js";

export function buildNightDropOutcome(scenario: NightDropScenarioConfig): OutcomeDefinition {
  const featurePack = createNightDropFeaturePack();
  const engine = new RouteRunEngine({ featureBridge: featurePack.bridge });
  engine.initialize(scenario.board, scenario.runner, `night-drop:${scenario.id}`);
  if (scenario.expansion) engine.applyExpansion(scenario.expansion);
  engine.previewRoute();
  engine.playRoute(scenario.flags.interrupted ? { maximumNewSteps: 2 } : {});
  if (scenario.flags.continuation && !scenario.flags.interrupted && scenario.continuationRefill) {
    engine.clearRoute();
    engine.applyCascade(new SequenceRefillProvider(scenario.continuationRefill));
    const continuation = engine.checkContinuation();
    if (continuation.available) engine.playRoute();
  }
  const inspection = engine.inspect();
  const lastTimelineEvent = inspection.timeline.at(-1);
  const adapted = adaptRouteRunOutcome({
    id: `night-drop.${scenario.id}`,
    roundReference: `night-drop.round.${scenario.id}`,
    name: scenario.name,
    description: scenario.tagline,
    events: inspection.timeline,
    expectedFinalState: {
      lastRouteRunEvent: lastTimelineEvent?.type ?? null,
      logicalTick: lastTimelineEvent?.logicalTick ?? 0,
    },
    tags: [scenario.id, ...Object.entries(scenario.flags).filter(([, active]) => active).map(([name]) => name)],
    gameId: String(NIGHT_DROP_GAME_ID),
  }).definition;
  return {
    ...adapted,
    betAmountMinor: scenario.betMinor,
    totalWinMinor: scenario.winMinor,
    events: adapted.events.map((event) => ({
      ...event,
      themeIds: [NIGHT_DROP_THEME_ID],
      metadata: { ...event.metadata, gamePack: "night-drop", activeFeatures: scenario.activeFeatures },
    })),
    tags: [...adapted.tags.filter((tag) => tag !== "diagnostic"), "game-pack-001"],
    metadata: {
      ...adapted.metadata,
      production: false,
      commercialMath: false,
      source: "predetermined-demo-outcome",
      activeFeatures: scenario.activeFeatures,
      routeRunFeatureApplications: inspection.featureApplications.filter((application) => application.animationCommands.length > 0).length,
      expansionCount: inspection.activeExpansions.length,
      cascadeCount: inspection.completedCascades.length,
      continuationCount: scenario.flags.continuation ? 1 : 0,
    },
  };
}

export const NIGHT_DROP_OUTCOMES: readonly OutcomeDefinition[] = NIGHT_DROP_SCENARIOS.map(buildNightDropOutcome);

export function createNightDropOutcomeRegistry(): OutcomeRegistry {
  const registry = new OutcomeRegistry();
  registry.registerMany(NIGHT_DROP_OUTCOMES);
  return registry;
}
