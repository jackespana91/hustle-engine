import { describe, expect, it } from "vitest";
import {
  SpatialRunnerController,
  SpatialRouteError,
  composeSpatialRoute,
  createSpatialRoadPiece,
  createSpatialRoadSequence,
  resolveSpatialBranchDisplacement,
  resolveSpatialJunctionDecision,
  resolveSpatialRouteWindow,
  validateSpatialRouteDefinition,
  type SpatialRouteDefinition,
} from "../src/index.js";

const route: SpatialRouteDefinition = {
  id: "test.city-route",
  name: "City Route",
  description: "A deterministic spatial presentation route.",
  start: { position: { x: 0, y: 0, z: 8 }, headingDegrees: 0 },
  segments: [
    { id: "street-01", kind: "street", length: 40 },
    { id: "bend-01", kind: "bend", length: 20, turnDegrees: 90 },
    { id: "ramp-01", kind: "ramp", length: 30, elevation: 6 },
    { id: "destination-01", kind: "destination", length: 10 },
  ],
  cues: [
    { id: "package-01", kind: "standard-pickup", segmentId: "street-01", offset: .5, laneOffset: -.25 },
    { id: "checkpoint-01", kind: "checkpoint", segmentId: "ramp-01", offset: .25 },
    { id: "final-address", kind: "destination", segmentId: "destination-01", offset: .9 },
  ],
  obstacles: [
    { id: "jump-barrier", kind: "barrier", segmentId: "street-01", offset: .75 },
    { id: "slide-sign", kind: "low-sign", segmentId: "bend-01", offset: .5 },
    { id: "traffic-van", kind: "traffic", segmentId: "ramp-01", offset: .5, lane: 0 },
  ],
  branches: [{
    id: "service-choice",
    junctionKind: "crossroads",
    entry: { segmentId: "bend-01", offset: .2 },
    rejoin: { segmentId: "destination-01", offset: .2 },
    decisionLeadDistance: 24,
    decisionTailDistance: 8,
    defaultAlternativeId: "straight",
    alternatives: [
      { id: "left", direction: "left", lateralOffset: -5, headingOffsetDegrees: -72 },
      { id: "straight", direction: "straight", lateralOffset: 0, headingOffsetDegrees: 0 },
      { id: "right", direction: "right", lateralOffset: 5, elevationOffset: 1, headingOffsetDegrees: 72 },
    ],
  }],
};

describe("RouteRun spatial routes", () => {
  it("composes ordered centre-line samples without renderer dependencies", () => {
    const composed = composeSpatialRoute(route);

    expect(composed.totalLength).toBe(100);
    expect(composed.elevationGain).toBe(6);
    expect(composed.segments.map(({ id }) => id)).toEqual(["street-01", "bend-01", "ramp-01", "destination-01"]);
    expect(composed.samples.every((sample, index, samples) => index === 0 || sample.distance >= samples[index - 1]!.distance)).toBe(true);
    expect(composed.samples.at(-1)?.progress).toBe(1);
    expect(composed.branches[0]).toMatchObject({
      id: "service-choice",
      junctionKind: "crossroads",
      defaultAlternativeId: "straight",
      decisionOpensProgress: .2,
      decisionClosesProgress: .52,
    });
  });

  it("resolves and orders cues by travelled distance", () => {
    const composed = composeSpatialRoute(route);

    expect(composed.cues.map(({ id }) => id)).toEqual(["package-01", "checkpoint-01", "final-address"]);
    expect(composed.cues[0]).toMatchObject({ distance: 20, progress: .2, laneOffset: -.25 });
    expect(composed.cues.at(-1)?.progress).toBeCloseTo(.99);
  });

  it("resolves deterministic obstacle actions and anticipation distances", () => {
    const composed = composeSpatialRoute(route);

    expect(composed.obstacles.map(({ id }) => id)).toEqual(["jump-barrier", "slide-sign", "traffic-van"]);
    expect(composed.obstacles).toMatchObject([
      { distance: 30, progress: .3, requiredAction: "jump", lane: null, reactionOpensDistance: 0 },
      { distance: 50, progress: .5, requiredAction: "slide", lane: null, reactionOpensDistance: 8 },
      { distance: 75, progress: .75, requiredAction: "change-lane", lane: 0, reactionOpensDistance: 33 },
    ]);
  });

  it("produces the same signature and samples on every composition", () => {
    expect(composeSpatialRoute(route)).toEqual(composeSpatialRoute(structuredClone(route)));
  });

  it("splits and rejoins presentation branches without changing route length", () => {
    const composed = composeSpatialRoute(route);
    const branch = composed.branches[0]!;
    const middle = (branch.entryProgress + branch.rejoinProgress) / 2;
    const firstTurn = branch.entryProgress + (branch.rejoinProgress - branch.entryProgress) * .11;
    const rejoinTurn = branch.entryProgress + (branch.rejoinProgress - branch.entryProgress) * .86;

    expect(resolveSpatialBranchDisplacement(composed, { "service-choice": "straight" }, branch.entryProgress).lateralOffset).toBeCloseTo(0);
    const middleDisplacement = resolveSpatialBranchDisplacement(composed, { "service-choice": "right" }, middle);
    expect(middleDisplacement).toMatchObject({
      activeBranchId: "service-choice",
      alternativeId: "right",
      lateralOffset: 5,
      elevationOffset: 1,
    });
    expect(middleDisplacement.headingOffsetDegrees).toBeCloseTo(0);
    expect(resolveSpatialBranchDisplacement(composed, { "service-choice": "right" }, firstTurn).headingOffsetDegrees).toBeCloseTo(72);
    expect(resolveSpatialBranchDisplacement(composed, { "service-choice": "right" }, rejoinTurn).headingOffsetDegrees).toBeCloseTo(-72);
    expect(resolveSpatialBranchDisplacement(composed, { "service-choice": "right" }, branch.rejoinProgress).lateralOffset).toBeCloseTo(0);
    expect(composed.totalLength).toBe(100);
  });

  it("keeps a selected street physically separate before the deterministic rejoin", () => {
    const composed = composeSpatialRoute(route);
    const branch = composed.branches[0]!;
    const sampleAt = (localProgress: number) => resolveSpatialBranchDisplacement(
      composed,
      { "service-choice": "right" },
      branch.entryProgress + (branch.rejoinProgress - branch.entryProgress) * localProgress,
    );

    expect(sampleAt(.22).lateralOffset).toBeCloseTo(5);
    expect(sampleAt(.5).lateralOffset).toBeCloseTo(5);
    expect(sampleAt(.72).lateralOffset).toBeCloseTo(5);
    expect(sampleAt(.5).headingOffsetDegrees).toBeCloseTo(0);
  });

  it("creates deterministic reusable road pieces without renderer code", () => {
    expect(createSpatialRoadPiece({ id: "junction-01", piece: "crossroads" })).toMatchObject({
      id: "junction-01",
      kind: "junction",
      length: 28,
      width: 6.8,
      metadata: { roadPiece: "crossroads" },
    });
    expect(createSpatialRoadSequence("district", [
      { piece: "straight" },
      { piece: "corner-left" },
      { piece: "ramp-up", elevation: 7 },
      { piece: "destination" },
    ])).toMatchObject([
      { id: "district-01", kind: "street" },
      { id: "district-02", kind: "bend", turnDegrees: -90 },
      { id: "district-03", kind: "ramp", elevation: 7 },
      { id: "district-04", kind: "destination" },
    ]);
  });

  it("opens a deterministic player decision window around the physical junction", () => {
    const composed = composeSpatialRoute(route);

    expect(resolveSpatialJunctionDecision(composed, .19)).toBeNull();
    expect(resolveSpatialJunctionDecision(composed, .2)).toMatchObject({ id: "service-choice", junctionKind: "crossroads" });
    expect(resolveSpatialJunctionDecision(composed, .52)).toMatchObject({ id: "service-choice" });
    expect(resolveSpatialJunctionDecision(composed, .53)).toBeNull();
  });

  it("applies deterministic runner inputs and restores exact presentation state", () => {
    const composed = composeSpatialRoute(route);
    const controller = new SpatialRunnerController(composed);
    controller.advance({ elapsedMs: 100, progress: .2, status: "running" });
    expect(controller.execute({ id: "left-1", type: "lane-left", issuedAtMs: 100 })).toMatchObject({ accepted: true, resultingLane: -1 });
    expect(controller.execute({ id: "jump-1", type: "jump", issuedAtMs: 100 })).toMatchObject({ accepted: true });
    expect(controller.execute({ id: "branch-1", type: "choose-branch", issuedAtMs: 100, branchId: "service-choice", alternativeId: "right" })).toMatchObject({ accepted: true });
    expect(controller.execute({ id: "left-1", type: "lane-left", issuedAtMs: 100 })).toMatchObject({ accepted: false, reason: "duplicate-command" });
    const snapshot = controller.createSnapshot();
    const restored = new SpatialRunnerController(composed);
    const state = restored.restore(snapshot);

    expect(state).toMatchObject({ lane: -1, action: "jumping", commandsExecuted: 3, recoveryCount: 1 });
    expect(state.branchSelections).toEqual({ "service-choice": "right" });
    expect(state.commandHistory).toHaveLength(4);
  });

  it("clears or hits authored obstacles from presentation input without changing the route", () => {
    const composed = composeSpatialRoute(route);
    const skilled = new SpatialRunnerController(composed);
    skilled.advance({ elapsedMs: 100, progress: .25, status: "running" });
    skilled.execute({ id: "jump", type: "jump", issuedAtMs: 100 });
    skilled.advance({ elapsedMs: 200, progress: .31, status: "running" });
    skilled.advance({ elapsedMs: 700, progress: .48, status: "running" });
    skilled.execute({ id: "slide", type: "slide", issuedAtMs: 700 });
    skilled.advance({ elapsedMs: 800, progress: .51, status: "running" });
    skilled.advance({ elapsedMs: 1_500, progress: .7, status: "running" });
    skilled.execute({ id: "left", type: "lane-left", issuedAtMs: 1_500 });
    const cleared = skilled.advance({ elapsedMs: 1_600, progress: .76, status: "running" });

    expect(cleared.clearedObstacleIds).toEqual(["jump-barrier", "slide-sign", "traffic-van"]);
    expect(cleared.hitObstacleIds).toEqual([]);
    expect(cleared.obstacleInteractions.map(({ result }) => result)).toEqual(["cleared", "cleared", "cleared"]);
    expect(composed.totalLength).toBe(100);

    const missed = new SpatialRunnerController(composed).advance({ elapsedMs: 1_000, progress: .8, status: "running" });
    expect(missed.hitObstacleIds).toEqual(["jump-barrier", "slide-sign", "traffic-van"]);
    expect(missed.status).toBe("running");
  });

  it("rejects junction choices made before or after the decision window", () => {
    const composed = composeSpatialRoute(route);
    const controller = new SpatialRunnerController(composed);
    expect(controller.execute({ id: "early", type: "choose-branch", issuedAtMs: 0, branchId: "service-choice", alternativeId: "left" })).toMatchObject({
      accepted: false,
      reason: "decision-not-open",
    });
    controller.advance({ elapsedMs: 100, progress: .6, status: "running" });
    expect(controller.execute({ id: "late", type: "choose-branch", issuedAtMs: 100, branchId: "service-choice", alternativeId: "right" })).toMatchObject({
      accepted: false,
      reason: "decision-closed",
    });
  });

  it("resolves a bounded active segment window for long-route streaming", () => {
    const composed = composeSpatialRoute(route);
    const window = resolveSpatialRouteWindow(composed, .55, { distanceBehind: 12, distanceAhead: 20 });

    expect(window.currentSegmentId).toBe("bend-01");
    expect(window.activeSegmentIds).toEqual(["bend-01", "ramp-01"]);
    expect(window.startDistance).toBeCloseTo(43, 8);
    expect(window.endDistance).toBeCloseTo(75, 8);
  });

  it("rejects duplicate segments and cues that reference unknown segments", () => {
    const invalid: SpatialRouteDefinition = {
      ...route,
      segments: [route.segments[0]!, { ...route.segments[0]! }],
      cues: [{ id: "bad-cue", kind: "custom", segmentId: "missing" }],
    };
    const validation = validateSpatialRouteDefinition(invalid);

    expect(validation.valid).toBe(false);
    expect(validation.errors.map(({ code }) => code)).toEqual(expect.arrayContaining(["DUPLICATE_ID", "UNKNOWN_SEGMENT"]));
    expect(() => composeSpatialRoute(invalid)).toThrow(SpatialRouteError);
  });

  it("rejects invalid obstacle ids, segment references, lanes and reaction windows", () => {
    const invalid: SpatialRouteDefinition = {
      ...route,
      obstacles: [
        { id: "bad-obstacle", kind: "traffic", segmentId: "missing", offset: 1.2, lane: 2, reactionLeadDistance: 0 },
        { id: "bad-obstacle", kind: "route-blocker", segmentId: "street-01" },
      ],
    };
    const validation = validateSpatialRouteDefinition(invalid);

    expect(validation.valid).toBe(false);
    expect(validation.errors.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "DUPLICATE_ID", "UNKNOWN_SEGMENT", "INVALID_OFFSET", "INVALID_LANE", "INVALID_DISTANCE", "REQUIRED",
    ]));
    expect(() => composeSpatialRoute(invalid)).toThrow(SpatialRouteError);
  });
});
