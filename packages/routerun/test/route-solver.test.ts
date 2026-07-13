import { describe, expect, it } from "vitest";
import {
  BoardBuilder, BoardModel, ROUTERUN_SCENARIOS, RouteError, RouteSolver, compareRouteResolutions,
  createRunnerState, type Direction, type RouteRunScenario, type RouteTile,
} from "../src/index.js";

const scenario = (id: string): RouteRunScenario => ROUTERUN_SCENARIOS.find((entry) => entry.id === id)!;
const resolve = (id: string) => {
  const selected = scenario(id);
  const board = new BoardModel(selected.board, false);
  return new RouteSolver(board).resolve(createRunnerState(board, selected.runner), selected.solverOptions);
};
const tile = (id: string, connections: readonly Direction[], family: RouteTile["family"] = "straight"): RouteTile =>
  ({ id, family, connections, rotation: 0, metadata: {} });

describe("RouteRun deterministic route solver", () => {
  it("resolves a straight route", () => expect(resolve("straight-route").steps).toHaveLength(3));
  it("resolves a bend", () => expect(resolve("bend-route").steps.map(({ coordinate }) => coordinate)).toEqual([
    { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 1, column: 1 },
  ]));
  it("uses an explicit T-junction decision", () => expect(resolve("deterministic-t-junction").decisions[0]).toMatchObject({ chosen: "east", reason: "explicit" }));
  it("uses the stable configurable junction fallback", () => {
    const selected = scenario("deterministic-t-junction");
    const board = new BoardModel(selected.board);
    const result = new RouteSolver(board).resolve(createRunnerState(board, selected.runner), { fallbackPriority: ["north", "east", "south", "west"] });
    expect(result.decisions[0]).toMatchObject({ chosen: "north", reason: "stable-fallback" });
  });
  it("rejects an illegal junction decision", () => expect(() => resolve("illegal-junction")).toThrowError(RouteError));
  it("identifies destination completion", () => expect(resolve("destination-reached").terminalReason).toBe("destination-reached"));
  it("identifies a normal dead end without throwing", () => expect(resolve("dead-end").terminalReason).toBe("dead-end"));
  it("identifies a blocker", () => expect(resolveTerminalBoard("blocked")).toBe("blocker"));
  it("identifies a sealed boundary", () => expect(resolveTerminalBoard("sealed")).toBe("sealed-boundary"));
  it("identifies a board exit", () => {
    const builder = new BoardBuilder({ id: "exit", width: 1, height: 1 });
    builder.addEntry({ row: 0, column: 0 }).setTile({ row: 0, column: 0 }, tile("exit-tile", ["west", "east"], "entry"));
    const board = new BoardModel(builder.build());
    const result = new RouteSolver(board).resolve(createRunnerState(board, { id: "runner", coordinate: { row: 0, column: 0 }, entryDirection: "west" }));
    expect(result.terminalReason).toBe("board-exit");
  });
  it("identifies invalid reciprocal movement", () => expect(resolve("invalid-reciprocal").terminalReason).toBe("invalid-connection"));
  it("detects loops and prevents revisits", () => expect(resolve("loop-detection").terminalReason).toBe("loop-detected"));
  it("enforces maximum-step protection", () => expect(resolve("maximum-step")).toMatchObject({ terminalReason: "maximum-step-limit", steps: { length: 3 } }));
  it("repeats deterministically", () => {
    const first = resolve("deterministic-t-junction");
    const second = resolve("deterministic-t-junction");
    expect(first.deterministicSignature).toBe(second.deterministicSignature);
    expect(compareRouteResolutions(first, second).equal).toBe(true);
  });
  it("detects route divergence", () => {
    const expected = resolve("deterministic-t-junction");
    const selected = scenario("deterministic-t-junction");
    const board = new BoardModel(selected.board);
    const actual = new RouteSolver(board).resolve(createRunnerState(board, selected.runner), { fallbackPriority: ["north", "east", "south", "west"] });
    expect(compareRouteResolutions(expected, actual).firstDivergence).not.toBeNull();
  });
});

function resolveTerminalBoard(state: "blocked" | "sealed") {
  const builder = new BoardBuilder({ id: state, width: 2, height: 1 });
  builder.addEntry({ row: 0, column: 0 }).setTile({ row: 0, column: 0 }, tile(`${state}-entry`, ["west", "east"], "entry"));
  builder.setState({ row: 0, column: 1 }, state);
  const board = new BoardModel(builder.build());
  return new RouteSolver(board).resolve(createRunnerState(board, { id: "runner", coordinate: { row: 0, column: 0 }, entryDirection: "west" })).terminalReason;
}
