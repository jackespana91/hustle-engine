import { OutcomeRegistry } from "./outcome-registry.js";
import { parseOutcome } from "./outcome-serializer.js";
import type { OutcomeDefinition } from "./outcome-types.js";
import type { OutcomeValidator } from "./outcome-validator.js";

export class OutcomeLoader {
  constructor(private readonly validator?: OutcomeValidator) {}
  parse(json: string): OutcomeDefinition { return this.validator ? parseOutcome(json, this.validator) : parseOutcome(json); }
  load(json: string, registry: OutcomeRegistry): OutcomeDefinition { const outcome = this.parse(json); registry.register(outcome); return outcome; }
  loadMany(json: string, registry: OutcomeRegistry): readonly OutcomeDefinition[] {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) throw new Error("Outcome collection JSON must be an array");
    const outcomes = value.map((entry) => this.parse(JSON.stringify(entry)));
    registry.registerMany(outcomes);
    return outcomes;
  }
}
