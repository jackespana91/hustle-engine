import { describe, expect, it } from "vitest";
import {
  BoardBuilder, BoardError, BoardModel, ROUTERUN_SCENARIOS, acceptsEntry, createDiagnosticTileRegistry,
  deserializeBoard, hasReciprocalConnection, rotateDirection, rotateTile, serializeBoard, validateBoard,
  type Direction, type RouteTile,
} from "../src/index.js";

const tile = (id: string, connections: readonly Direction[], family: RouteTile["family"] = "straight"): RouteTile =>
  ({ id, family, connections, rotation: 0, metadata: {} });

describe("RouteRun board and tile contracts", () => {
  it("accepts a valid configurable 5x5 board", () => {
    const scenario = ROUTERUN_SCENARIOS.find(({ id }) => id === "mobile-readable-5x5");
    expect(scenario?.board.width).toBe(5);
    expect(validateBoard(scenario!.board).valid).toBe(true);
  });

  it("rejects invalid dimensions", () => {
    expect(() => new BoardBuilder({ id: "bad", width: 0, height: 2 }).build()).toThrowError(BoardError);
  });

  it("rejects duplicate cell ids", () => {
    const board = new BoardBuilder({ id: "duplicates", width: 2, height: 1 }).build();
    const cells = board.cells.map((cell) => ({ ...cell, id: "same" }));
    expect(validateBoard({ ...board, cells }).errors[0]?.code).toBe("DUPLICATE_CELL_ID");
  });

  it("rejects coordinate consistency gaps and duplicates", () => {
    const board = new BoardBuilder({ id: "coordinates", width: 2, height: 1 }).build();
    const duplicate = { ...board.cells[1]!, coordinate: { row: 0, column: 0 } };
    const result = validateBoard({ ...board, cells: [board.cells[0]!, duplicate] });
    expect(result.errors.map(({ code }) => code)).toContain("DUPLICATE_COORDINATE");
  });

  it("preserves sealed cell behaviour", () => {
    const board = new BoardBuilder({ id: "sealed", width: 1, height: 1 }).setState({ row: 0, column: 0 }, "sealed").build();
    expect(new BoardModel(board).requireCell({ row: 0, column: 0 }).state).toBe("sealed");
  });

  it("preserves blocked cell behaviour", () => {
    const board = new BoardBuilder({ id: "blocked", width: 1, height: 1 }).setState({ row: 0, column: 0 }, "blocked").build();
    expect(new BoardModel(board).requireCell({ row: 0, column: 0 }).state).toBe("blocked");
  });

  it("recognizes reciprocal connections", () => {
    expect(hasReciprocalConnection(tile("left", ["east"]), "east", tile("right", ["west"]))).toBe(true);
  });

  it("reports a non-reciprocal connection", () => {
    const scenario = ROUTERUN_SCENARIOS.find(({ id }) => id === "invalid-reciprocal")!;
    expect(validateBoard(scenario.board).errors.some(({ code }) => code === "INVALID_CONNECTION")).toBe(true);
  });

  it("rotates tile connections deterministically", () => {
    const rotated = rotateTile(tile("bend", ["north", "east"], "bend"), 90);
    expect(rotated.connections).toEqual(["east", "south"]);
    expect(rotateDirection("west", 270)).toBe("south");
  });

  it("enforces one-way entry rules", () => {
    const oneWay: RouteTile = {
      ...tile("one-way", ["west", "east"], "one-way"),
      oneWay: { allowedEntrances: ["west"], allowedExits: ["east"] },
    };
    expect(acceptsEntry(oneWay, "west")).toBe(true);
    expect(acceptsEntry(oneWay, "east")).toBe(false);
  });

  it("round-trips board serialization", () => {
    const board = ROUTERUN_SCENARIOS[0]!.board;
    expect(deserializeBoard(serializeBoard(board))).toEqual(board);
  });

  it("registers all diagnostic tile families", () => {
    expect(createDiagnosticTileRegistry().list().map(({ family }) => family)).toEqual([
      "straight", "bend", "t-junction", "cross-junction", "one-way", "destination", "entry", "blocker", "empty",
    ]);
  });
});
