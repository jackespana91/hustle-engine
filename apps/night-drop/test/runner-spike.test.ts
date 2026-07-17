import { describe, expect, it } from "vitest";
import { SpatialRunnerController, resolveSpatialRouteWindow } from "@hustle/routerun";
import {
  NIGHT_DROP_RUNNER_TIMELINE,
  createNightDropRunnerPlan,
} from "../src/runner-spike/runner-plan.js";
import {
  DEFAULT_NIGHT_DROP_RUNNER_ROUTE,
  NIGHT_DROP_RUNNER_ROUTES,
  composeNightDropRunnerRoute,
} from "../src/runner-spike/runner-routes.js";
import { describeNightDropBuilding } from "../src/runner-spike/night-drop-building-kit.js";

describe("Night Drop cinematic runner routes", () => {
  it("projects a real deterministic RouteRun preview into a spatial presentation route", () => {
    const plan = createNightDropRunnerPlan();

    expect(plan.outcomeId).toBe("long-route");
    expect(plan.roundId).toBe(`night-drop:runner-spike:${DEFAULT_NIGHT_DROP_RUNNER_ROUTE}`);
    expect(plan.routeSteps).toHaveLength(9);
    expect(plan.routeSteps[0]?.coordinate).toEqual({ row: 4, column: 0 });
    expect(plan.routeSteps.at(-1)?.coordinate).toEqual({ row: 0, column: 4 });
    expect(plan.routeSteps.some(({ packageCount }) => packageCount > 0)).toBe(true);
    expect(plan.routeSteps.some(({ turn }) => turn !== null)).toBe(true);
    expect(plan.spatialRoute.definitionId).toBe("night-drop.glasshouse-loop");
  });

  it("ships ten materially different route lengths and shapes", () => {
    const routes = NIGHT_DROP_RUNNER_ROUTES.map(({ id }) => composeNightDropRunnerRoute(id));
    const lengths = routes.map(({ totalLength }) => totalLength);

    expect(NIGHT_DROP_RUNNER_ROUTES.map(({ id }) => id)).toEqual([
      "city-sprint", "glasshouse-loop", "cross-city", "rooftop-ascent", "neon-slalom",
      "canal-dash", "market-maze", "skybridge-chain", "district-marathon", "night-shift",
    ]);
    expect(new Set(lengths).size).toBe(10);
    expect(Math.min(...lengths)).toBeLessThan(250);
    expect(Math.max(...lengths)).toBeGreaterThan(700);
    expect(routes.find(({ definitionId }) => definitionId.endsWith("rooftop-ascent"))?.elevationGain).toBeGreaterThan(20);
    expect(routes.every(({ cues }) => cues.some(({ kind }) => kind === "destination"))).toBe(true);
    expect(routes.every(({ obstacles }) => obstacles.length >= 3)).toBe(true);
    expect(new Set(routes.flatMap(({ obstacles }) => obstacles.map(({ kind }) => kind)))).toEqual(new Set([
      "barrier", "low-sign", "gap", "ramp", "traffic", "route-blocker",
    ]));
    expect(routes.every(({ branches }) => branches.length >= 1 && branches.every(({ junctionKind }) => junctionKind === "t-junction" || junctionKind === "crossroads"))).toBe(true);
    expect(routes.some(({ branches }) => branches.some(({ junctionKind }) => junctionKind === "t-junction"))).toBe(true);
    expect(routes.some(({ branches }) => branches.some(({ junctionKind }) => junctionKind === "crossroads"))).toBe(true);
    expect(routes.find(({ definitionId }) => definitionId.endsWith("city-sprint"))?.branches).toHaveLength(1);
    expect(routes.filter(({ definitionId }) => !definitionId.endsWith("city-sprint")).every(({ branches }) => branches.length >= 2)).toBe(true);
    expect(routes.filter(({ totalLength }) => totalLength > 600 && totalLength < 1_000).every(({ branches }) => branches.length >= 3)).toBe(true);
    expect(routes.filter(({ totalLength }) => totalLength > 1_000).every(({ branches }) => branches.length >= 4)).toBe(true);
    expect(routes.every(({ obstacles }) => obstacles.every(({ metadata }) => metadata.outcomeSafe === true && metadata.presentationOnly === true))).toBe(true);
    routes.forEach(({ branches }) => {
      branches.forEach((junction, index) => {
        expect(junction.decisionOpensProgress).toBeLessThan(junction.entryProgress);
        expect(junction.decisionClosesProgress).toBeGreaterThan(junction.entryProgress);
        expect(junction.metadata.outcomeSafe).toBe(true);
        expect(junction.alternatives.every(({ metadata }) => metadata.outcomeSafe === true)).toBe(true);
        expect(junction.alternatives.every(({ divergeFraction, rejoinFraction }) => divergeFraction < rejoinFraction)).toBe(true);
        expect((junction.rejoinDistance - junction.entryDistance) * (junction.alternatives[0]!.rejoinFraction - junction.alternatives[0]!.divergeFraction)).toBeGreaterThan(20);
        if (index > 0) expect(branches[index - 1]!.rejoinDistance).toBeLessThan(junction.entryDistance);
        if (junction.junctionKind === "t-junction") expect(junction.alternatives.map(({ direction }) => direction)).toEqual(["left", "right"]);
        if (junction.junctionKind === "crossroads") expect(junction.alternatives.map(({ direction }) => direction)).toEqual(["left", "straight", "right"]);
      });
    });
  });

  it("scales the deterministic sequence with route distance", () => {
    const plans = NIGHT_DROP_RUNNER_ROUTES.map(({ id }) => createNightDropRunnerPlan(id));

    expect(plans.map(({ durationMs }) => durationMs)).toEqual([16_000, 24_500, 37_500, 30_500, 21_000, 28_000, 34_000, 42_000, 66_000, 88_000]);
    expect(plans.filter(({ durationMs }) => durationMs >= 60_000 && durationMs <= 90_000)).toHaveLength(2);
    plans.forEach((plan) => {
      const times = plan.timeline.map(({ atMs }) => atMs);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(plan.timeline.map(({ phase }) => phase)).toEqual([
        "establishing",
        "route-guidance",
        "start-running",
        "package-one",
        "package-two",
        "turn",
        "premium-package",
        "continuation-open",
        "shortcut",
        "clamp",
        "escape",
        "penthouse-reveal",
        "arrival",
        "delivery",
        "win",
        "resolved",
      ]);
      expect(plan.timeline.every((beat, index, timeline) => index === 0 || beat.atMs >= timeline[index - 1]!.atMs)).toBe(true);
      expect(plan.timeline.every((beat, index, timeline) => index === 0 || beat.routeProgress >= timeline[index - 1]!.routeProgress)).toBe(true);
      expect(plan.timeline.at(-1)?.atMs).toBe(plan.durationMs);
    });
    expect(createNightDropRunnerPlan().timeline).toEqual(NIGHT_DROP_RUNNER_TIMELINE);
  });

  it("keeps obstacle and junction reaction windows consistent across route speeds", () => {
    NIGHT_DROP_RUNNER_ROUTES.forEach(({ id }) => {
      const plan = createNightDropRunnerPlan(id);
      const start = plan.timeline.find(({ phase }) => phase === "start-running")!;
      const arrival = plan.timeline.find(({ phase }) => phase === "arrival")!;
      const travelSeconds = (arrival.atMs - start.atMs) / 1_000;
      const travelDistance = (arrival.routeProgress - start.routeProgress) * plan.spatialRoute.totalLength;
      const unitsPerSecond = travelDistance / travelSeconds;
      const obstacleReactionSeconds = plan.spatialRoute.obstacles.map(({ reactionLeadDistance }) => reactionLeadDistance / unitsPerSecond);
      const junctionReactionSeconds = plan.spatialRoute.branches.map(({ entryDistance, decisionOpensDistance }) => (entryDistance - decisionOpensDistance) / unitsPerSecond);
      const obstacleSpacing = plan.spatialRoute.obstacles.slice(1).map((obstacle, index) => obstacle.distance - plan.spatialRoute.obstacles[index]!.distance);

      expect(Math.min(...obstacleReactionSeconds), `${id} obstacle warning`).toBeGreaterThanOrEqual(1.7);
      expect(Math.max(...obstacleReactionSeconds), `${id} obstacle warning`).toBeLessThanOrEqual(3.1);
      expect(Math.min(...junctionReactionSeconds), `${id} junction warning`).toBeGreaterThanOrEqual(1.65);
      expect(Math.max(...junctionReactionSeconds), `${id} junction warning`).toBeLessThanOrEqual(3.1);
      expect(Math.min(...obstacleSpacing), `${id} obstacle spacing`).toBeGreaterThanOrEqual(24);
    });
  });

  it("recreates every route exactly on every load", () => {
    NIGHT_DROP_RUNNER_ROUTES.forEach(({ id }) => {
      expect(createNightDropRunnerPlan(id)).toEqual(createNightDropRunnerPlan(id));
    });
  });

  it("keeps the paid result identical for every presentation-only junction choice", () => {
    const plan = createNightDropRunnerPlan("cross-city");
    const baseline = {
      outcomeId: plan.outcomeId,
      betMinor: plan.betMinor,
      winMinor: plan.winMinor,
      routeSteps: plan.routeSteps,
      cues: plan.spatialRoute.cues,
      obstacles: plan.spatialRoute.obstacles,
      totalLength: plan.spatialRoute.totalLength,
    };

    plan.spatialRoute.branches.forEach((junction, junctionIndex) => {
      junction.alternatives.forEach((alternative, alternativeIndex) => {
        const controller = new SpatialRunnerController(plan.spatialRoute);
        controller.advance({
          elapsedMs: 100,
          progress: junction.entryProgress,
          status: "running",
        });
        expect(controller.execute({
          id: `choice-${junctionIndex}-${alternativeIndex}`,
          type: "choose-branch",
          issuedAtMs: 100,
          branchId: junction.id,
          alternativeId: alternative.id,
        })).toMatchObject({ accepted: true });
        expect({
          outcomeId: plan.outcomeId,
          betMinor: plan.betMinor,
          winMinor: plan.winMinor,
          routeSteps: plan.routeSteps,
          cues: plan.spatialRoute.cues,
          obstacles: plan.spatialRoute.obstacles,
          totalLength: plan.spatialRoute.totalLength,
        }).toEqual(baseline);
      });
    });
  });

  it("restores obstacle progress and input history without changing the paid result", () => {
    const plan = createNightDropRunnerPlan("city-sprint");
    const obstacle = plan.spatialRoute.obstacles[0]!;
    const controller = new SpatialRunnerController(plan.spatialRoute);
    const beforeProgress = Math.max(0, obstacle.progress - .01);
    const beforeMs = 100;
    controller.advance({ elapsedMs: beforeMs, progress: beforeProgress, status: "running" });
    expect(controller.execute({ id: "jump-first-barrier", type: "jump", issuedAtMs: beforeMs })).toMatchObject({ accepted: true });
    const cleared = controller.advance({ elapsedMs: 200, progress: obstacle.progress + .01, status: "running" });
    const snapshot = controller.createSnapshot();
    const restored = new SpatialRunnerController(plan.spatialRoute).restore(snapshot);

    expect(obstacle.requiredAction).toBe("jump");
    expect(cleared.clearedObstacleIds).toContain(obstacle.id);
    expect(cleared.hitObstacleIds).not.toContain(obstacle.id);
    expect(restored).toMatchObject({
      progress: cleared.progress,
      lane: cleared.lane,
      recoveryCount: 1,
      clearedObstacleIds: cleared.clearedObstacleIds,
      obstacleInteractions: cleared.obstacleInteractions,
    });
    expect({ outcomeId: plan.outcomeId, betMinor: plan.betMinor, winMinor: plan.winMinor }).toEqual({
      outcomeId: "long-route",
      betMinor: 100,
      winMinor: 2_400,
    });
  });

  it("stress-runs Full Night Shift at 60 updates per second with bounded streaming and exact recovery", () => {
    const plan = createNightDropRunnerPlan("night-shift");
    const totalFrames = Math.round(plan.durationMs / 1_000 * 60);
    const selectedBranches = new Set<string>();
    const armedObstacles = new Set<string>();
    let controller = new SpatialRunnerController(plan.spatialRoute);
    let maximumActiveSegments = 0;

    for (let frame = 0; frame < totalFrames; frame += 1) {
      const elapsedMs = frame / 60 * 1_000;
      const progress = frame / totalFrames;
      const state = controller.advance({ elapsedMs, progress, status: "running" });
      maximumActiveSegments = Math.max(maximumActiveSegments, resolveSpatialRouteWindow(plan.spatialRoute, progress).activeSegmentIds.length);

      plan.spatialRoute.branches.forEach((branch) => {
        if (selectedBranches.has(branch.id) || progress < branch.decisionOpensProgress || progress > branch.decisionClosesProgress) return;
        expect(controller.execute({
          id: `stress-branch-${branch.id}`,
          type: "choose-branch",
          issuedAtMs: elapsedMs,
          branchId: branch.id,
          alternativeId: branch.defaultAlternativeId,
        })).toMatchObject({ accepted: true });
        selectedBranches.add(branch.id);
      });

      const nextObstacle = plan.spatialRoute.obstacles.find((obstacle) => !armedObstacles.has(obstacle.id) && obstacle.progress > progress);
      if (nextObstacle && nextObstacle.progress - progress <= 1.5 / totalFrames) {
        if (nextObstacle.requiredAction === "jump" || nextObstacle.requiredAction === "slide") {
          expect(controller.execute({
            id: `stress-input-${nextObstacle.id}`,
            type: nextObstacle.requiredAction,
            issuedAtMs: elapsedMs,
          })).toMatchObject({ accepted: true });
        } else if (nextObstacle.requiredAction === "change-lane" && nextObstacle.lane === state.lane) {
          const type = state.lane >= 0 ? "dodge-left" : "dodge-right";
          expect(controller.execute({ id: `stress-input-${nextObstacle.id}`, type, issuedAtMs: elapsedMs })).toMatchObject({ accepted: true });
        }
        armedObstacles.add(nextObstacle.id);
      }

      if (frame === Math.floor(totalFrames / 2)) {
        const snapshot = controller.createSnapshot();
        controller = new SpatialRunnerController(plan.spatialRoute);
        expect(controller.restore(snapshot)).toMatchObject({ recoveryCount: 1 });
      }
    }

    const finalState = controller.advance({ elapsedMs: plan.durationMs, progress: 1, status: "resolved" });
    expect(plan.durationMs).toBe(88_000);
    expect(finalState.status).toBe("resolved");
    expect(finalState.recoveryCount).toBe(1);
    expect(finalState.obstacleInteractions).toHaveLength(plan.spatialRoute.obstacles.length);
    expect(selectedBranches.size).toBe(plan.spatialRoute.branches.length);
    expect(finalState.commandHistory.length).toBeLessThanOrEqual(64);
    expect(maximumActiveSegments).toBeLessThanOrEqual(8);
    expect({ outcomeId: plan.outcomeId, betMinor: plan.betMinor, winMinor: plan.winMinor }).toEqual({
      outcomeId: "long-route",
      betMinor: 100,
      winMinor: 2_400,
    });
  });
});

describe("Night Drop 3D building kit", () => {
  it("produces a deterministic mix of authored city archetypes", () => {
    const firstPass = Array.from({ length: 12 }, (_, index) => describeNightDropBuilding(index, index % 2));
    const secondPass = Array.from({ length: 12 }, (_, index) => describeNightDropBuilding(index, index % 2));

    expect(secondPass).toEqual(firstPass);
    expect(new Set(firstPass.map(({ archetype }) => archetype))).toEqual(new Set([
      "glasshouse", "night-market", "service-block", "stacked-flats",
    ]));
    expect(new Set(firstPass.map(({ roofTreatment }) => roofTreatment)).size).toBeGreaterThanOrEqual(3);
    expect(firstPass.some(({ hasAwning }) => hasAwning)).toBe(true);
  });
});
