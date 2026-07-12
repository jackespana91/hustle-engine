import { describe, expect, it } from "vitest";
import { adaptMockStakeRound, type MockStakeRoundResponse } from "../src/index.js";

const response: MockStakeRoundResponse = {
  roundId: "round-001", betAmount: 1_000_000, totalWin: 2_500_000, completed: true,
  resultEvents: [
    { id: "one", type: "generic", order: 0, amount: 1_000_000, data: { label: "one" } },
    { id: "two", type: "generic", order: 1, amount: 1_500_000, data: { label: "two" } },
  ],
};

describe("mock Stake adapter", () => {
  it("produces deterministic output", () => {
    expect(adaptMockStakeRound(response)).toEqual(adaptMockStakeRound(structuredClone(response)));
    expect(adaptMockStakeRound(response).events.map(({ id }) => id)).toEqual(["one", "two"]);
  });

  it("rejects duplicate event ids", () => {
    expect(() => adaptMockStakeRound({
      ...response,
      resultEvents: [response.resultEvents[0]!, { ...response.resultEvents[1]!, id: "one" }],
    })).toThrow(/Duplicate event id/);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects malformed amount %s", (betAmount) => {
    expect(() => adaptMockStakeRound({ ...response, betAmount })).toThrow(/non-negative safe integer/);
  });

  it("rejects inconsistent total win", () => {
    expect(() => adaptMockStakeRound({ ...response, totalWin: 1 })).toThrow(/does not equal/);
  });
});
