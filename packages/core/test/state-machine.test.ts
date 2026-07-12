import { describe, expect, it } from "vitest";
import { IllegalStateTransitionError, RoundStateMachine } from "../src/index.js";

describe("RoundStateMachine", () => {
  it("accepts the successful lifecycle and records history", () => {
    const machine = new RoundStateMachine();
    for (const state of ["requesting", "received", "presenting", "completed"] as const) machine.transition(state);
    expect(machine.state).toBe("completed");
    expect(machine.history.map(({ from, to }) => `${from}:${to}`)).toEqual([
      "idle:requesting", "requesting:received", "received:presenting", "presenting:completed",
    ]);
  });

  it("rejects illegal transitions predictably", () => {
    const machine = new RoundStateMachine();
    expect(() => machine.transition("completed")).toThrow(IllegalStateTransitionError);
    expect(machine.state).toBe("idle");
  });
});
