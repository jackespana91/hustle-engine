import {
  InvalidOutcomeError,
  eventId,
  money,
  roundId,
  type RoundOutcome,
} from "@hustle/core";

/** Mock-only schema for Task 001. This is not a production Stake Engine API contract. */
export interface MockStakeResultEvent {
  readonly id: string;
  readonly type: string;
  readonly order: number;
  readonly amount: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Mock-only schema for Task 001. This is not a production Stake Engine API contract. */
export interface MockStakeRoundResponse {
  readonly roundId: string;
  readonly betAmount: number;
  readonly totalWin: number;
  readonly resultEvents: readonly MockStakeResultEvent[];
  readonly completed: boolean;
}

export function adaptMockStakeRound(response: MockStakeRoundResponse): RoundOutcome {
  if (!response || typeof response !== "object") throw invalid("Response is required");
  if (!isNonEmptyString(response.roundId)) throw invalid("Round id is required");
  assertAmount(response.betAmount, "bet amount");
  assertAmount(response.totalWin, "total win");
  if (!Array.isArray(response.resultEvents)) throw invalid("Result events are required");
  if (response.completed !== true) throw invalid("Only completed mock rounds are supported");

  const ids = new Set<string>();
  let computedWin = 0;
  const events = response.resultEvents.map((event, index) => {
    if (!event || typeof event !== "object") throw invalid(`Event ${index} is malformed`);
    if (!isNonEmptyString(event.id) || !isNonEmptyString(event.type)) {
      throw invalid(`Event ${index} requires an id and type`);
    }
    if (ids.has(event.id)) throw invalid(`Duplicate event id: ${event.id}`);
    ids.add(event.id);
    if (event.order !== index) throw invalid("Result events must use stable zero-based ordering");
    assertAmount(event.amount, `event ${event.id} amount`);
    computedWin += event.amount;
    if (!Number.isSafeInteger(computedWin)) throw invalid("Event win total exceeds safe integer range");
    return {
      id: eventId(event.id),
      type: event.type,
      order: event.order,
      value: money(event.amount),
      payload: { ...(event.data ?? {}) },
    };
  });

  if (computedWin !== response.totalWin) {
    throw invalid(`Total win ${response.totalWin} does not equal ordered event values ${computedWin}`);
  }

  return {
    roundId: roundId(response.roundId),
    bet: money(response.betAmount),
    totalWin: money(response.totalWin),
    events,
    completed: true,
  };
}

function assertAmount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${name} must be a non-negative safe integer`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalid(message: string): InvalidOutcomeError {
  return new InvalidOutcomeError(`Mock Stake response invalid: ${message}`);
}
