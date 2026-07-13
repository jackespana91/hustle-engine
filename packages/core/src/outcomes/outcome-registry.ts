import { TypedEventBus } from "../event-bus.js";
import { OutcomeSystemError, invalidOutcomeError } from "./outcome-errors.js";
import type { OutcomeEventMap } from "./outcome-events.js";
import { normalizeOutcome } from "./outcome-normalizer.js";
import type { OutcomeDefinition, OutcomeRegistrySnapshot } from "./outcome-types.js";
import { OutcomeValidator } from "./outcome-validator.js";

export class OutcomeRegistry {
  readonly events = new TypedEventBus<OutcomeEventMap>();
  private outcomes = new Map<string, OutcomeDefinition>();

  constructor(readonly validator = new OutcomeValidator()) {}

  register(outcome: OutcomeDefinition): void { this.registerMany([outcome]); }

  registerMany(outcomes: readonly OutcomeDefinition[]): void {
    const candidate = new Map(this.outcomes);
    const staged: OutcomeDefinition[] = [];
    for (const value of outcomes) {
      const outcome = this.validate(value);
      if (candidate.has(outcome.id)) throw new OutcomeSystemError("DUPLICATE_OUTCOME", `Outcome already registered: ${outcome.id}`);
      candidate.set(outcome.id, outcome); staged.push(outcome);
    }
    this.outcomes = candidate;
    staged.sort(compareOutcome).forEach((outcome) => this.events.publish("outcome:registered", { outcome: structuredClone(outcome) }));
  }

  unregister(id: string): OutcomeDefinition | undefined {
    const outcome = this.outcomes.get(id);
    if (!outcome) return undefined;
    this.outcomes.delete(id);
    this.events.publish("outcome:removed", { outcome: structuredClone(outcome) });
    return structuredClone(outcome);
  }

  get(id: string): OutcomeDefinition | undefined { const value = this.outcomes.get(id); return value ? structuredClone(value) : undefined; }
  require(id: string): OutcomeDefinition { const value = this.get(id); if (!value) throw new OutcomeSystemError("UNKNOWN_OUTCOME", `Unknown outcome: ${id}`); return value; }
  has(id: string): boolean { return this.outcomes.has(id); }
  list(): readonly OutcomeDefinition[] { return [...this.outcomes.values()].sort(compareOutcome).map((value) => structuredClone(value)); }
  filterByEngine(engineId: string): readonly OutcomeDefinition[] { return this.list().filter((outcome) => String(outcome.engineId) === engineId); }
  filterByGame(gameId: string): readonly OutcomeDefinition[] { return this.list().filter((outcome) => String(outcome.gameId) === gameId); }
  filterByTag(tag: string): readonly OutcomeDefinition[] { return this.list().filter((outcome) => outcome.tags.includes(tag)); }

  replace(outcome: OutcomeDefinition): OutcomeDefinition {
    if (!this.outcomes.has(outcome.id)) throw new OutcomeSystemError("UNKNOWN_OUTCOME", `Unknown outcome: ${outcome.id}`);
    const valid = this.validate(outcome);
    const previous = this.require(outcome.id);
    const candidate = new Map(this.outcomes); candidate.set(valid.id, valid); this.outcomes = candidate;
    this.events.publish("outcome:removed", { outcome: previous });
    this.events.publish("outcome:registered", { outcome: structuredClone(valid) });
    return previous;
  }

  snapshot(): OutcomeRegistrySnapshot { return { schemaVersion: 1, outcomes: this.list() }; }

  clear(): void {
    const removed = this.list(); this.outcomes.clear();
    removed.forEach((outcome) => this.events.publish("outcome:removed", { outcome }));
  }

  private validate(value: OutcomeDefinition): OutcomeDefinition {
    const validation = this.validator.validate(value);
    if (!validation.valid) {
      this.events.publish("outcome:validation-failed", { outcome: value, validation });
      throw invalidOutcomeError(validation.errors);
    }
    const outcome = normalizeOutcome(value);
    this.events.publish("outcome:validation-passed", { outcome, validation });
    return outcome;
  }
}

function compareOutcome(left: OutcomeDefinition, right: OutcomeDefinition): number { return String(left.id).localeCompare(String(right.id), "en"); }
