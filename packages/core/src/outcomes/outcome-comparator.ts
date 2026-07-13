import { stableSerialize } from "./outcome-serializer.js";
import type {
  OutcomeComparisonResult,
  OutcomeDefinition,
  OutcomeDiffCategory,
  OutcomeDivergence,
  OutcomeReplayRecord,
} from "./outcome-types.js";

export class OutcomeComparator {
  compareOutcomeToReplay(expected: OutcomeDefinition, actual: OutcomeReplayRecord): OutcomeComparisonResult {
    const divergences: OutcomeDivergence[] = [];
    compareList(
      "event-order",
      expected.events.map(({ id }) => String(id)),
      actual.execution.normalizedEvents.map(({ id }) => String(id)),
      "events",
      divergences,
    );
    compareValue("final-state", expected.expectedFinalState, actual.execution.finalState, "finalState", divergences);
    return finish(divergences);
  }

  compareReplays(expected: OutcomeReplayRecord, actual: OutcomeReplayRecord): OutcomeComparisonResult {
    const divergences: OutcomeDivergence[] = [];
    compareList(
      "event-order",
      expected.execution.eventPublications.filter(({ name }) => name === "outcome:event-completed").map(({ eventId }) => eventId),
      actual.execution.eventPublications.filter(({ name }) => name === "outcome:event-completed").map(({ eventId }) => eventId),
      "execution.eventPublications",
      divergences,
    );
    compareList(
      "animation-order",
      expected.execution.animationCommands.map(({ id }) => String(id)),
      actual.execution.animationCommands.map(({ id }) => String(id)),
      "execution.animationCommands",
      divergences,
    );
    compareList(
      "feature-execution",
      expected.execution.featureExecutions.map((item) => `${item.eventId}:${item.featureId}:${item.operation}:${item.executionOrder}`),
      actual.execution.featureExecutions.map((item) => `${item.eventId}:${item.featureId}:${item.operation}:${item.executionOrder}`),
      "execution.featureExecutions",
      divergences,
    );
    compareList(
      "transition-history",
      expected.execution.stateTransitions.map((item) => `${item.from}->${item.to}:${item.reason ?? ""}`),
      actual.execution.stateTransitions.map((item) => `${item.from}->${item.to}:${item.reason ?? ""}`),
      "execution.stateTransitions",
      divergences,
    );
    compareValue("final-state", expected.execution.finalState, actual.execution.finalState, "execution.finalState", divergences);
    return finish(divergences);
  }

  compareExpectedAndActual(expected: OutcomeReplayRecord | OutcomeDefinition, actual: OutcomeReplayRecord): OutcomeComparisonResult {
    return "execution" in expected ? this.compareReplays(expected, actual) : this.compareOutcomeToReplay(expected, actual);
  }
}

function compareList(
  category: OutcomeDiffCategory,
  expected: readonly unknown[],
  actual: readonly unknown[],
  path: string,
  output: OutcomeDivergence[],
): void {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (serializeComparable(expected[index]) !== serializeComparable(actual[index])) {
      output.push({ category, index, path: `${path}.${index}`, expected: expected[index], actual: actual[index], message: `${category} differs at index ${index}` });
    }
  }
}

function serializeComparable(value: unknown): string {
  return value === undefined ? "[undefined]" : stableSerialize(value);
}

function compareValue(
  category: OutcomeDiffCategory,
  expected: unknown,
  actual: unknown,
  path: string,
  output: OutcomeDivergence[],
): void {
  if (stableSerialize(expected) !== stableSerialize(actual)) {
    output.push({ category, index: 0, path, expected, actual, message: `${category} differs` });
  }
}

function finish(divergences: OutcomeDivergence[]): OutcomeComparisonResult {
  return { equal: divergences.length === 0, divergences, firstDivergence: divergences[0] ?? null };
}
