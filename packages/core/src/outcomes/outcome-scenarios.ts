import { assetId } from "../assets/index.js";
import { roundId } from "../contracts.js";
import { engineManifestId, featureManifestId, themeManifestId } from "../manifests/index.js";
import { OutcomeBuilder, createOutcomeEvent } from "./outcome-builder.js";
import { outcomeEventId, outcomeId, type OutcomeDefinition, type OutcomeScenario } from "./outcome-types.js";

const ENGINE_ID = "outcome-studio-engine";
const GAME_ID = "outcome-studio-game";

export const OUTCOME_STUDIO_ENGINE_ID = ENGINE_ID;
export const OUTCOME_STUDIO_GAME_ID = GAME_ID;

export class OutcomeScenarioLibrary {
  private scenarios: OutcomeScenario[];
  constructor(scenarios: readonly OutcomeScenario[] = createOutcomeScenarios()) { this.scenarios = structuredClone(scenarios) as OutcomeScenario[]; }
  list(): readonly OutcomeScenario[] { return structuredClone(this.scenarios); }
  get(id: string): OutcomeScenario | undefined { const value = this.scenarios.find((scenario) => scenario.id === id); return value ? structuredClone(value) : undefined; }
  require(id: string): OutcomeScenario { const value = this.get(id); if (!value) throw new Error(`Unknown outcome scenario: ${id}`); return value; }
  search(query: string): readonly OutcomeScenario[] { const key = query.trim().toLowerCase(); return this.list().filter((item) => !key || `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(key)); }
  filter(filters: { readonly engineId?: string; readonly gameId?: string; readonly tag?: string }): readonly OutcomeScenario[] {
    return this.list().filter((item) => (!filters.engineId || item.engineId === filters.engineId) && (!filters.gameId || item.gameId === filters.gameId) && (!filters.tag || item.tags.includes(filters.tag)));
  }
  duplicate(id: string): OutcomeScenario {
    const source = this.require(id);
    const suffix = this.scenarios.filter((item) => item.id.startsWith(`${id}-copy`)).length + 1;
    const copyId = `${id}-copy-${suffix}`;
    const outcome = isOutcome(source.outcome) ? { ...source.outcome, id: `${source.outcome.id}-copy-${suffix}`, roundId: `${source.outcome.roundId}-copy-${suffix}`, name: `${source.outcome.name} copy` } : structuredClone(source.outcome);
    const copy = { ...source, id: copyId, name: `${source.name} copy`, outcome };
    this.scenarios.push(copy);
    return structuredClone(copy);
  }
}

export function createOutcomeScenarios(): readonly OutcomeScenario[] {
  const tiny = makeOutcome("tiny-success", "Tiny successful round", 2, (index) => index === 1 ? 250 : 0, ["success", "tiny"]);
  const medium = makeOutcome("medium-success", "Medium successful round", 6, (index) => index % 2 === 1 ? 200 : 0, ["success", "medium"]);
  const large = makeOutcome("large-success", "Large successful round", 24, (index) => index % 4 === 0 ? 125 : 0, ["success", "large", "stress"]);
  const zero = makeOutcome("zero-win", "Zero-win round", 3, () => 0, ["zero-win"]);
  const interrupted = withMetadata(makeOutcome("interrupted-recovery", "Interrupted and recovered round", 8, (index) => index === 7 ? 500 : 0, ["recovery", "interruption"]), { recommendedInterruptEvent: 3 });
  const feature = { ...replaceEvent(
    makeOutcome("feature-enabled", "Feature-enabled placeholder round", 3, () => 0, ["feature", "placeholder"]),
    1,
    { featureId: featureManifestId("shortcut-feature"), metadata: { placeholderFeatureOnly: true } },
  ), engineId: engineManifestId("feature-sdk-playground-engine") };
  const optionalAsset = replaceEvent(
    makeOutcome("optional-asset-failure", "Optional asset failure round", 3, () => 0, ["asset", "optional-failure"]),
    1,
    { assetIds: [assetId("optional-example-asset")], metadata: { assetRequirement: "optional", simulateAssetFailure: true } },
  );
  const requiredAsset = replaceEvent(
    makeOutcome("required-asset-failure", "Required asset failure round", 3, () => 0, ["asset", "required-failure"]),
    1,
    { assetIds: [assetId("required-example-asset")], metadata: { assetRequirement: "required", simulateAssetFailure: true } },
  );
  const animationFailure = replaceEvent(
    makeOutcome("animation-failure", "Animation failure round", 3, () => 0, ["animation", "failure"]),
    1,
    { animationHints: [{ type: "outcome-animation-failure", durationMs: 30, payload: {}, metadata: { simulateAnimationFailure: true } }] },
  );
  const malformed = { ...tiny, schemaVersion: "0.0.0", id: "Malformed Outcome", events: "not-an-array" };
  const invalidOrdering = { ...medium, id: "invalid-event-ordering", events: medium.events.map((event, index) => ({ ...event, sequence: index === 0 ? 1 : index === 1 ? 0 : index })) };
  const divergence: OutcomeDefinition = {
    ...tiny,
    id: outcomeId("replay-divergence"),
    roundId: roundId("replay-divergence-round"),
    name: "Replay divergence example",
    tags: [...tiny.tags, "divergence"],
    metadata: { ...tiny.metadata, simulateReplayDivergence: true },
  };

  return [
    scenario(tiny), scenario(medium), scenario(large), scenario(zero), scenario(interrupted), scenario(feature),
    scenario(optionalAsset), scenario(requiredAsset), scenario(animationFailure),
    { id: "malformed-outcome", name: "Malformed outcome", description: "Invalid schema and event container used to inspect structured validation.", engineId: ENGINE_ID, gameId: GAME_ID, tags: ["invalid", "validation"], outcome: malformed, expectedFailure: "validation" },
    { id: "invalid-event-ordering", name: "Invalid event ordering", description: "Non-deterministic sequence order used to inspect validation.", engineId: ENGINE_ID, gameId: GAME_ID, tags: ["invalid", "ordering"], outcome: invalidOrdering, expectedFailure: "ordering" },
    scenario(divergence),
  ];
}

function makeOutcome(id: string, name: string, count: number, win: (index: number) => number, tags: readonly string[]): OutcomeDefinition {
  const builder = OutcomeBuilder.create({ id, roundId: `${id}-round`, name, description: "Non-production engine-agnostic Outcome Studio scenario.", engineId: ENGINE_ID, gameId: GAME_ID, seed: `${id}-seed` });
  builder.setTags(tags);
  for (let index = 0; index < count; index += 1) {
    builder.addEvent(createOutcomeEvent({
      id: outcomeEventId(`${id}-event-${index}`), type: index === count - 1 ? "round-summary" : "presentation-step",
      sequence: index, logicalTick: index * 10, blocking: true, skippable: true,
      dependsOn: index === 0 ? [] : [outcomeEventId(`${id}-event-${index - 1}`)],
      payload: { label: `Event ${index + 1} of ${count}` },
      expectedStateChanges: { completedEvents: index + 1, lastEventType: index === count - 1 ? "round-summary" : "presentation-step" },
      animationHints: [{ type: "outcome-presentation-step", durationMs: 30, payload: { index }, blocking: true, skippable: true }],
      assetIds: [], themeIds: index === 0 ? [themeManifestId("outcome-studio-theme")] : [],
      winAmountMinor: win(index), metadata: { nonProduction: true },
    }));
  }
  builder.setExpectedFinalState(count === 0 ? {} : { completedEvents: count, lastEventType: "round-summary" });
  return builder.finalize();
}

function withMetadata(outcome: OutcomeDefinition, metadata: Record<string, string | number | boolean>): OutcomeDefinition { return { ...outcome, metadata: { ...outcome.metadata, ...metadata } }; }
function replaceEvent(outcome: OutcomeDefinition, index: number, update: Partial<OutcomeDefinition["events"][number]>): OutcomeDefinition {
  return { ...outcome, events: outcome.events.map((event, eventIndex) => eventIndex === index ? { ...event, ...update } : event) };
}
function scenario(outcome: OutcomeDefinition): OutcomeScenario { return { id: String(outcome.id), name: outcome.name, description: outcome.description, engineId: String(outcome.engineId), gameId: String(outcome.gameId), tags: outcome.tags, outcome }; }
function isOutcome(value: unknown): value is OutcomeDefinition { return typeof value === "object" && value !== null && "schemaVersion" in value && "events" in value && Array.isArray((value as { events?: unknown }).events); }
