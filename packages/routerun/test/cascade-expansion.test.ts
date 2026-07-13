import { describe, expect, it } from "vitest";
import {
  BoardBuilder, BoardModel, ROUTERUN_SCENARIOS, SequenceRefillProvider, applyBoardExpansion,
  clearTraversedCells, createRunnerState, resolveCascade, RouteSolver,
  type Direction, type GravityDirection, type RouteTile,
} from "../src/index.js";

const tile = (id: string, connections: readonly Direction[] = ["north", "south"], persistent = false): RouteTile =>
  ({ id, family: "straight", connections, rotation: 0, persistent, metadata: {} });

describe("RouteRun clearing, cascades, and expansion", () => {
  it("clears traversed cells while retaining the original board", () => {
    const selected = ROUTERUN_SCENARIOS.find(({ id }) => id === "straight-route")!;
    const model = new BoardModel(selected.board);
    const route = new RouteSolver(model).resolve(createRunnerState(model, selected.runner));
    const report = clearTraversedCells(selected.board, route.steps);
    expect(report.clearedCellIds).toHaveLength(3);
    expect(selected.board.cells.every(({ tile: value }) => value !== undefined)).toBe(true);
    expect(report.board.cells.every(({ state }) => state === "empty")).toBe(true);
  });

  it("preserves persistent tiles during clearing", () => {
    const selected = ROUTERUN_SCENARIOS.find(({ id }) => id === "destination-reached")!;
    const model = new BoardModel(selected.board);
    const route = new RouteSolver(model).resolve(createRunnerState(model, selected.runner));
    expect(clearTraversedCells(selected.board, route.steps).retainedCellIds.length).toBe(1);
  });

  for (const gravity of ["down", "up", "left", "right"] as const) {
    it(`compacts deterministically toward ${gravity}`, () => {
      const board = compactionBoard(gravity);
      const provider = new SequenceRefillProvider([null, null]);
      const report = resolveCascade(board, provider, 0, gravity);
      expect(report.movements).toHaveLength(1);
      expect(report.movements[0]?.to).toEqual(targetFor(gravity));
    });
  }

  it("places deterministic refills in stable request order", () => {
    const board = compactionBoard("down");
    const report = resolveCascade(board, new SequenceRefillProvider([
      { tile: tile("refill-a") }, { tile: tile("refill-b") },
    ]), 0, "down");
    expect(report.refills.map(({ tileId, refillIndex }) => [tileId, refillIndex])).toEqual([["refill-a", 0], ["refill-b", 1]]);
  });

  it("preserves blocked and sealed cells during cascade", () => {
    const builder = new BoardBuilder({ id: "barriers", width: 1, height: 3 });
    builder.setTile({ row: 0, column: 0 }, tile("top"));
    builder.setState({ row: 1, column: 0 }, "blocked");
    builder.setState({ row: 2, column: 0 }, "sealed");
    const board = builder.build();
    const report = resolveCascade(board, new SequenceRefillProvider([]), 0);
    expect(report.board.cells.map(({ state }) => state)).toEqual(["active", "blocked", "sealed"]);
  });

  it("produces a legal continuation after predetermined refill", () => {
    const selected = ROUTERUN_SCENARIOS.find(({ id }) => id === "clear-downward-cascade")!;
    const model = new BoardModel(selected.board);
    const route = new RouteSolver(model).resolve(createRunnerState(model, selected.runner));
    const cleared = clearTraversedCells(selected.board, route.steps);
    const cascaded = resolveCascade(cleared.board, new SequenceRefillProvider(selected.refillData!), 0);
    const next = new BoardModel(cascaded.board);
    expect(new RouteSolver(next).resolve(createRunnerState(next, selected.runner)).terminalReason).toBe("destination-reached");
  });

  it("activates a valid sealed expansion in deterministic order", () => {
    const selected = ROUTERUN_SCENARIOS.find(({ id }) => id === "sealed-side-expansion")!;
    const report = applyBoardExpansion(selected.board, selected.expansion!);
    expect(report.changes.map(({ coordinate }) => coordinate)).toEqual([{ row: 0, column: 2 }, { row: 0, column: 3 }]);
    expect(report.board.cells.find(({ id }) => id === "cell-0-2")?.state).toBe("active");
  });

  it("rejects invalid expansion activation", () => {
    const selected = ROUTERUN_SCENARIOS.find(({ id }) => id === "sealed-side-expansion")!;
    expect(() => applyBoardExpansion(selected.board, { id: "bad", side: "internal", activations: [{ coordinate: { row: 0, column: 0 } }], metadata: {} })).toThrow();
  });
});

function compactionBoard(gravity: GravityDirection) {
  const vertical = gravity === "down" || gravity === "up";
  const builder = new BoardBuilder({ id: `compact-${gravity}`, width: vertical ? 1 : 3, height: vertical ? 3 : 1, gravity });
  const source = gravity === "down" ? { row: 0, column: 0 } : gravity === "up" ? { row: 2, column: 0 } : gravity === "right" ? { row: 0, column: 0 } : { row: 0, column: 2 };
  builder.setTile(source, tile(`moving-${gravity}`));
  return builder.build(false);
}

function targetFor(gravity: GravityDirection) {
  if (gravity === "down") return { row: 2, column: 0 };
  if (gravity === "up") return { row: 0, column: 0 };
  if (gravity === "right") return { row: 0, column: 2 };
  return { row: 0, column: 0 };
}
