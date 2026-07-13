import type { JsonValue } from "../features/index.js";
import { compareEvents } from "./outcome-validator.js";
import type { OutcomeDefinition, OutcomeEvent } from "./outcome-types.js";

/** Returns a defensive, recursively canonicalized definition. */
export function normalizeOutcome(outcome: OutcomeDefinition): OutcomeDefinition {
  const events = [...outcome.events]
    .sort(compareEvents)
    .map((event) => normalizeEvent(event));
  return canonicalize({
    ...structuredClone(outcome),
    events,
    tags: [...new Set(outcome.tags)].sort(compareAscii),
  }) as OutcomeDefinition;
}

export function normalizeEvent(event: OutcomeEvent): OutcomeEvent {
  return canonicalize({
    ...structuredClone(event),
    dependsOn: [...new Set(event.dependsOn)].sort(compareAscii),
    assetIds: [...new Set(event.assetIds)].sort(compareAscii),
    themeIds: [...new Set(event.themeIds)].sort(compareAscii),
  }) as OutcomeEvent;
}

export function canonicalize<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry)) as Value;
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>).sort(compareAscii).forEach((key) => {
      output[key] = canonicalize((value as Record<string, unknown>)[key]);
    });
    return output as Value;
  }
  return value;
}

export function applyStateChanges(
  current: Readonly<Record<string, JsonValue>>,
  changes: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  return canonicalize({ ...structuredClone(current), ...structuredClone(changes) });
}

function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
