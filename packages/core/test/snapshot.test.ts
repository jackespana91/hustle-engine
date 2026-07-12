import { describe, expect, it } from "vitest";
import {
  UnsupportedSnapshotVersionError,
  animationId,
  money,
  parseSnapshot,
  roundId,
  serializeSnapshot,
  type RecoverySnapshot,
} from "../src/index.js";

const snapshot: RecoverySnapshot = {
  version: 1,
  round: { roundId: roundId("round"), bet: money(10), totalWin: money(0), events: [], completed: true },
  lifecycleState: "interrupted",
  completedCommands: [{ id: animationId("done"), type: "done", durationMs: 1, payload: {}, skippable: true, blocking: true }],
  pendingCommands: [], currentCommand: null, transitionHistory: [],
  presentationProgress: { totalWinPresented: money(0), lastEventOrder: -1 },
};

describe("recovery snapshots", () => {
  it("serialize and parse without losing data", () => {
    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
  });

  it("reject unsupported versions", () => {
    expect(() => parseSnapshot('{"version":2,"lifecycleState":"idle"}')).toThrow(UnsupportedSnapshotVersionError);
  });
});
