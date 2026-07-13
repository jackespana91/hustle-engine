import { roundId } from "../contracts.js";
import { engineManifestId, gameManifestId } from "../manifests/manifest-types.js";
import { OutcomeSystemError, invalidOutcomeError } from "./outcome-errors.js";
import { normalizeOutcome } from "./outcome-normalizer.js";
import { OUTCOME_SCHEMA_VERSION, outcomeEventId, outcomeId, type OutcomeDefinition, type OutcomeEvent, type OutcomeMetadata, type OutcomeState } from "./outcome-types.js";
import { OutcomeValidator } from "./outcome-validator.js";

export interface CreateOutcomeInput {
  readonly id?: string;
  readonly roundId?: string;
  readonly name?: string;
  readonly description?: string;
  readonly engineId?: string;
  readonly gameId?: string;
  readonly seed?: string;
}

export class OutcomeBuilder {
  private value: OutcomeDefinition;

  private constructor(
    outcome: OutcomeDefinition,
    private readonly validator: OutcomeValidator,
  ) {
    this.value = structuredClone(outcome);
  }

  static create(input: CreateOutcomeInput = {}, validator = new OutcomeValidator()): OutcomeBuilder {
    return new OutcomeBuilder({
      schemaVersion: OUTCOME_SCHEMA_VERSION,
      id: outcomeId(input.id ?? "untitled-outcome"),
      roundId: roundId(input.roundId ?? "round-001"),
      name: input.name ?? "Untitled outcome",
      description: input.description ?? "Engine-agnostic deterministic outcome draft.",
      engineId: engineManifestId(input.engineId ?? "outcome-studio-engine"),
      gameId: gameManifestId(input.gameId ?? "outcome-studio-game"),
      deterministicSource: { type: "seed", value: input.seed ?? "outcome-studio-seed" },
      betAmountMinor: 0,
      totalWinMinor: 0,
      events: [],
      expectedFinalState: {},
      tags: ["draft"],
      metadata: { nonProduction: true },
      sequencePolicy: "contiguous",
    }, validator);
  }

  static from(outcome: OutcomeDefinition, validator = new OutcomeValidator()): OutcomeBuilder {
    const validation = validator.validate(outcome);
    if (!validation.valid) throw invalidOutcomeError(validation.errors);
    return new OutcomeBuilder(normalizeOutcome(outcome), validator);
  }

  snapshot(): OutcomeDefinition { return structuredClone(this.value); }

  setIdentity(id: string, name = this.value.name, description = this.value.description): this {
    return this.commit({ ...this.value, id: outcomeId(id), name, description });
  }

  setRoundIdentity(id: string): this { return this.commit({ ...this.value, roundId: roundId(id) }); }

  setEngineAndGame(engineId: string, gameId: string): this {
    return this.commit({ ...this.value, engineId: engineManifestId(engineId), gameId: gameManifestId(gameId) });
  }

  setDeterministicSource(type: "seed" | "reference", value: string): this {
    return this.commit({ ...this.value, deterministicSource: { type, value } });
  }

  setBet(amountMinor: number): this { return this.commit({ ...this.value, betAmountMinor: amountMinor }); }

  setExpectedTotalWin(amountMinor: number): this { return this.commit({ ...this.value, totalWinMinor: amountMinor }); }

  setExpectedFinalState(state: OutcomeState): this { return this.commit({ ...this.value, expectedFinalState: structuredClone(state) }); }

  setTags(tags: readonly string[]): this { return this.commit({ ...this.value, tags: [...tags] }); }

  setMetadata(metadata: OutcomeMetadata): this { return this.commit({ ...this.value, metadata: structuredClone(metadata) }); }

  addEvent(event: OutcomeEvent): this { return this.insertEvent(this.value.events.length, event); }

  insertEvent(index: number, event: OutcomeEvent): this {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.value.events.length) throw invalidEdit("Event insertion index is outside the timeline");
    if (this.value.events.some(({ id }) => id === event.id)) throw invalidEdit(`Duplicate event id: ${event.id}`);
    const events = [...this.value.events];
    events.splice(index, 0, structuredClone(event));
    const normalized = resequence(events);
    return this.commit({ ...this.value, events: normalized, totalWinMinor: sumWins(normalized) });
  }

  updateEvent(id: string, update: Partial<OutcomeEvent> | ((current: OutcomeEvent) => OutcomeEvent)): this {
    const index = this.indexOf(id);
    const current = requireAt(this.value.events, index);
    const next = typeof update === "function" ? update(structuredClone(current)) : { ...current, ...structuredClone(update) };
    if (next.id !== current.id && this.value.events.some((event, eventIndex) => eventIndex !== index && event.id === next.id)) {
      throw invalidEdit(`Duplicate event id: ${next.id}`);
    }
    const events = this.value.events.map((event, eventIndex) => {
      if (eventIndex === index) return next;
      if (next.id !== current.id && event.dependsOn.includes(current.id)) {
        return { ...event, dependsOn: event.dependsOn.map((dependency) => dependency === current.id ? next.id : dependency) };
      }
      return event;
    });
    return this.commit({ ...this.value, events: resequence(events), totalWinMinor: sumWins(events) });
  }

  removeEvent(id: string): this {
    this.indexOf(id);
    const key = outcomeEventId(id);
    const events = this.value.events
      .filter((event) => event.id !== key)
      .map((event) => ({ ...event, dependsOn: event.dependsOn.filter((dependency) => dependency !== key) }));
    return this.commit({ ...this.value, events: resequence(events), totalWinMinor: sumWins(events) });
  }

  reorderEvent(id: string, targetIndex: number): this {
    if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.value.events.length) throw invalidEdit("Event target index is outside the timeline");
    const sourceIndex = this.indexOf(id);
    const events = [...this.value.events];
    const [event] = events.splice(sourceIndex, 1);
    if (!event) throw invalidEdit(`Unknown event: ${id}`);
    events.splice(targetIndex, 0, event);
    return this.commit({ ...this.value, events: resequence(events) });
  }

  declareDependencies(id: string, dependencies: readonly string[]): this {
    return this.updateEvent(id, { dependsOn: dependencies.map(outcomeEventId) });
  }

  clone(newOutcomeId: string, newRoundId: string): OutcomeBuilder {
    const cloned = {
      ...this.value,
      id: outcomeId(newOutcomeId),
      roundId: roundId(newRoundId),
      name: `${this.value.name} copy`,
      metadata: { ...this.value.metadata, clonedFrom: this.value.id },
    };
    return new OutcomeBuilder(cloned, this.validator);
  }

  finalize(): OutcomeDefinition {
    const normalized = normalizeOutcome(this.value);
    const validation = this.validator.validate(normalized);
    if (!validation.valid) throw invalidOutcomeError(validation.errors);
    this.value = structuredClone(normalized);
    return structuredClone(normalized);
  }

  private commit(candidate: OutcomeDefinition): this {
    // Stage first. A failed structural edit never mutates the previous draft.
    const validation = new OutcomeValidator().validate(candidate);
    const structural = validation.errors.filter((error) => [
      "INVALID_OUTCOME_ID", "INVALID_ROUND_ID", "INVALID_REQUIRED_FIELD", "INVALID_MONEY",
      "DUPLICATE_EVENT_ID", "INVALID_SEQUENCE", "INVALID_LOGICAL_TICK", "INVALID_EVENT",
      "MISSING_EVENT_DEPENDENCY", "LATE_EVENT_DEPENDENCY", "CIRCULAR_EVENT_DEPENDENCY", "NON_DETERMINISTIC_ORDER",
    ].includes(error.code));
    if (structural.length > 0) throw invalidEdit(structural[0]?.message ?? "Invalid outcome edit");
    this.value = structuredClone(candidate);
    return this;
  }

  private indexOf(id: string): number {
    const index = this.value.events.findIndex((event) => String(event.id) === id);
    if (index < 0) throw invalidEdit(`Unknown event: ${id}`);
    return index;
  }
}

export function createOutcomeEvent(values: Partial<OutcomeEvent> & Pick<OutcomeEvent, "id" | "type">): OutcomeEvent {
  return {
    id: values.id,
    sequence: values.sequence ?? 0,
    type: values.type,
    logicalTick: values.logicalTick ?? 0,
    payload: values.payload ?? {},
    blocking: values.blocking ?? true,
    skippable: values.skippable ?? true,
    ...(values.featureId === undefined ? {} : { featureId: values.featureId }),
    dependsOn: values.dependsOn ?? [],
    expectedStateChanges: values.expectedStateChanges ?? {},
    animationHints: values.animationHints ?? [],
    assetIds: values.assetIds ?? [],
    themeIds: values.themeIds ?? [],
    ...(values.winAmountMinor === undefined ? {} : { winAmountMinor: values.winAmountMinor }),
    metadata: values.metadata ?? {},
  };
}

function resequence(events: readonly OutcomeEvent[]): readonly OutcomeEvent[] { return events.map((event, sequence) => ({ ...structuredClone(event), sequence })); }
function sumWins(events: readonly OutcomeEvent[]): number { return events.reduce((sum, event) => sum + (event.winAmountMinor ?? 0), 0); }
function invalidEdit(message: string): OutcomeSystemError { return new OutcomeSystemError("INVALID_EDIT", message); }
function requireAt(values: readonly OutcomeEvent[], index: number): OutcomeEvent { const value = values[index]; if (!value) throw invalidEdit("Event does not exist"); return value; }
