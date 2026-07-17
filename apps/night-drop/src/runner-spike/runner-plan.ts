import { RouteRunEngine, type ComposedSpatialRoute, type Coordinate, type Direction } from "@hustle/routerun";
import { getNightDropScenario } from "../board/night-drop-board.js";
import {
  DEFAULT_NIGHT_DROP_RUNNER_ROUTE,
  NIGHT_DROP_RUNNER_ROUTES,
  composeNightDropRunnerRoute,
  getNightDropRunnerRoute,
  type NightDropRunnerRouteId,
} from "./runner-routes.js";

export type RunnerPhase =
  | "establishing"
  | "route-guidance"
  | "start-running"
  | "package-one"
  | "package-two"
  | "turn"
  | "premium-package"
  | "continuation-open"
  | "shortcut"
  | "clamp"
  | "escape"
  | "penthouse-reveal"
  | "arrival"
  | "delivery"
  | "win"
  | "resolved";

export interface RunnerTimelineBeat {
  readonly atMs: number;
  readonly phase: RunnerPhase;
  readonly routeStepIndex: number;
  readonly routeProgress: number;
  readonly label: string;
}

export interface RunnerRouteStep {
  readonly index: number;
  readonly coordinate: Coordinate;
  readonly direction: Direction | null;
  readonly turn: "left" | "right" | null;
  readonly packageCount: number;
}

export interface RunnerRouteOption {
  readonly id: NightDropRunnerRouteId;
  readonly label: string;
  readonly difficulty: string;
  readonly durationMs: number;
  readonly distance: number;
}

export interface NightDropRunnerPlan {
  readonly outcomeId: string;
  readonly roundId: string;
  readonly betMinor: number;
  readonly winMinor: number;
  readonly routeId: NightDropRunnerRouteId;
  readonly routeName: string;
  readonly routeDescription: string;
  readonly routeDifficulty: string;
  readonly routeSteps: readonly RunnerRouteStep[];
  readonly spatialRoute: ComposedSpatialRoute;
  readonly availableRoutes: readonly RunnerRouteOption[];
  readonly timeline: readonly RunnerTimelineBeat[];
  readonly durationMs: number;
}

export const NIGHT_DROP_RUNNER_TIMELINE: readonly RunnerTimelineBeat[] = createRunnerTimeline(
  composeNightDropRunnerRoute(DEFAULT_NIGHT_DROP_RUNNER_ROUTE),
  getNightDropRunnerRoute(DEFAULT_NIGHT_DROP_RUNNER_ROUTE).durationMs,
  9,
);

const NIGHT_DROP_RUNNER_OPTIONS: readonly RunnerRouteOption[] = NIGHT_DROP_RUNNER_ROUTES.map((route) => ({
  id: route.id,
  label: route.label,
  difficulty: route.difficulty,
  durationMs: route.durationMs,
  distance: composeNightDropRunnerRoute(route.id).totalLength,
}));

export function createNightDropRunnerPlan(routeId: NightDropRunnerRouteId = DEFAULT_NIGHT_DROP_RUNNER_ROUTE): NightDropRunnerPlan {
  const scenario = getNightDropScenario("long-route");
  const profile = getNightDropRunnerRoute(routeId);
  const spatialRoute = composeNightDropRunnerRoute(routeId);
  const engine = new RouteRunEngine();
  engine.initialize(scenario.board, scenario.runner, `night-drop:runner-spike:${routeId}`);
  engine.previewRoute();
  const inspection = engine.inspect();
  const preview = inspection.preview;
  const definition = inspection.boardDefinition;
  if (!preview || !definition || preview.steps.length < 9) {
    engine.dispose();
    throw new Error("Night Drop runner spike requires the deterministic long-route outcome");
  }

  const routeSteps = preview.steps.map(({ coordinate }, index, steps): RunnerRouteStep => {
    const previousDirection = index > 1 ? directionBetween(steps[index - 2]!.coordinate, steps[index - 1]!.coordinate) : null;
    const direction = steps[index + 1] ? directionBetween(coordinate, steps[index + 1]!.coordinate) : null;
    const cell = definition.cells.find(({ coordinate: item }) => sameCoordinate(item, coordinate));
    return {
      index,
      coordinate: structuredClone(coordinate),
      direction,
      turn: previousDirection && direction && previousDirection !== direction ? turnBetween(previousDirection, direction) : null,
      packageCount: cell?.overlays.filter(({ collectable }) => collectable).length ?? 0,
    };
  });

  engine.dispose();
  const timeline = createRunnerTimeline(spatialRoute, profile.durationMs, routeSteps.length);
  return {
    outcomeId: scenario.id,
    roundId: `night-drop:runner-spike:${routeId}`,
    betMinor: scenario.betMinor,
    winMinor: 2_400,
    routeId,
    routeName: profile.label,
    routeDescription: profile.definition.description,
    routeDifficulty: profile.difficulty,
    routeSteps,
    spatialRoute,
    availableRoutes: structuredClone(NIGHT_DROP_RUNNER_OPTIONS),
    timeline,
    durationMs: profile.durationMs,
  };
}

function createRunnerTimeline(
  spatialRoute: ComposedSpatialRoute,
  durationMs: number,
  routeStepCount: number,
): readonly RunnerTimelineBeat[] {
  const cueProgress = (kind: ComposedSpatialRoute["cues"][number]["kind"]): number => {
    const found = spatialRoute.cues.find((cue) => cue.kind === kind);
    if (!found) throw new Error(`Spatial route ${spatialRoute.definitionId} requires a ${kind} cue`);
    return found.progress;
  };
  const standardPickups = spatialRoute.cues.filter(({ kind }) => kind === "standard-pickup");
  if (standardPickups.length < 2) throw new Error(`Spatial route ${spatialRoute.definitionId} requires two standard pickups`);
  const startProgress = Math.min(.015, standardPickups[0]!.progress * .25);
  const packageOne = standardPickups[0]!.progress;
  const packageTwo = standardPickups[1]!.progress;
  const premium = cueProgress("premium-pickup");
  const continuation = cueProgress("continuation");
  const shortcut = cueProgress("shortcut");
  const checkpoint = cueProgress("checkpoint");
  const destination = cueProgress("destination");
  const turn = packageTwo + (premium - packageTwo) * .42;
  const escape = Math.min(destination - .12, checkpoint + (destination - checkpoint) * .3);
  const penthouseReveal = Math.max(escape + .015, destination - .075);
  const travelStartMs = Math.min(1_750, Math.round(durationMs * .11));
  const arrivalMs = durationMs - 3_050;
  const timeAt = (progress: number): number => {
    const normalized = (progress - startProgress) / Math.max(Number.EPSILON, destination - startProgress);
    return Math.round(travelStartMs + Math.max(0, Math.min(1, normalized)) * (arrivalMs - travelStartMs));
  };
  const stepAt = (progress: number): number => Math.min(routeStepCount - 1, Math.max(0, Math.round(progress * (routeStepCount - 1))));
  const beat = (atMs: number, phase: RunnerPhase, routeProgress: number, label: string): RunnerTimelineBeat => ({
    atMs,
    phase,
    routeStepIndex: stepAt(routeProgress),
    routeProgress,
    label,
  });
  return [
    beat(0, "establishing", startProgress, "Glasshouse Heights · 01:14"),
    beat(Math.min(700, Math.round(durationMs * .045)), "route-guidance", startProgress, `${spatialRoute.name} locked`),
    beat(travelStartMs, "start-running", startProgress, "Delivery live"),
    beat(timeAt(packageOne), "package-one", packageOne, "Package secured"),
    beat(timeAt(packageTwo), "package-two", packageTwo, "Second pickup"),
    beat(timeAt(turn), "turn", turn, "Route changing"),
    beat(timeAt(premium), "premium-package", premium, "Priority package"),
    beat(timeAt(continuation), "continuation-open", continuation, "Route continues"),
    beat(timeAt(shortcut), "shortcut", shortcut, "Service passage"),
    beat(timeAt(checkpoint), "clamp", checkpoint, "Enforcement scan"),
    beat(timeAt(escape), "escape", escape, "Clear"),
    beat(timeAt(penthouseReveal), "penthouse-reveal", penthouseReveal, "Final address"),
    beat(arrivalMs, "arrival", destination, "2401 · Penthouse"),
    beat(durationMs - 2_200, "delivery", destination, "Delivered"),
    beat(durationMs - 1_300, "win", destination, "Delivery complete"),
    beat(durationMs, "resolved", destination, "Round complete"),
  ] as const;
}

function directionBetween(from: Coordinate, to: Coordinate): Direction {
  if (to.row < from.row) return "north";
  if (to.row > from.row) return "south";
  if (to.column < from.column) return "west";
  return "east";
}

function turnBetween(from: Direction, to: Direction): "left" | "right" {
  const clockwise: readonly Direction[] = ["north", "east", "south", "west"];
  const fromIndex = clockwise.indexOf(from);
  const toIndex = clockwise.indexOf(to);
  return (toIndex - fromIndex + clockwise.length) % clockwise.length === 1 ? "right" : "left";
}

function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
  return left.row === right.row && left.column === right.column;
}
