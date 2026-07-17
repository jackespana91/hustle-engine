import { describe, expect, it } from "vitest";
import { interpretSpatialRunnerSwipe } from "../src/index.js";

describe("RouteRun spatial runner swipe input", () => {
  it.each([
    [{ x: 100, y: 100, atMs: 0 }, { x: 35, y: 104, atMs: 180 }, "left", "dodge-left"],
    [{ x: 100, y: 100, atMs: 0 }, { x: 170, y: 96, atMs: 160 }, "right", "dodge-right"],
    [{ x: 100, y: 100, atMs: 0 }, { x: 104, y: 32, atMs: 190 }, "up", "jump"],
    [{ x: 100, y: 100, atMs: 0 }, { x: 96, y: 172, atMs: 210 }, "down", "slide"],
  ] as const)("maps a %s gesture to a deterministic presentation command", (start, end, direction, commandType) => {
    expect(interpretSpatialRunnerSwipe(start, end)).toMatchObject({ direction, commandType });
  });

  it("rejects taps, slow drags and ambiguous diagonals", () => {
    expect(interpretSpatialRunnerSwipe({ x: 0, y: 0, atMs: 0 }, { x: 12, y: 4, atMs: 100 })).toBeNull();
    expect(interpretSpatialRunnerSwipe({ x: 0, y: 0, atMs: 0 }, { x: 80, y: 2, atMs: 800 })).toBeNull();
    expect(interpretSpatialRunnerSwipe({ x: 0, y: 0, atMs: 0 }, { x: 60, y: 58, atMs: 180 })).toBeNull();
  });

  it("is reproducible and exposes speed for presentation tuning", () => {
    const start = { x: 20, y: 180, atMs: 1_000 };
    const end = { x: 22, y: 80, atMs: 1_200 };
    const first = interpretSpatialRunnerSwipe(start, end);

    expect(first).toEqual(interpretSpatialRunnerSwipe(structuredClone(start), structuredClone(end)));
    expect(first?.velocity).toBeCloseTo(Math.hypot(2, -100) / 200);
  });
});
