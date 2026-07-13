import { BoardBuilder } from "../board/board-builder.js";
import type { BoardDefinition, Direction } from "../board/board-types.js";
import type { RefillContent } from "../cascade/cascade-types.js";
import type { ExpansionDefinition } from "../expansion/expansion-types.js";
import type { RouteOverlay } from "../overlays/overlay-types.js";
import type { RouteSolverOptions } from "../route/route-types.js";
import type { PlaceRunnerInput } from "../runner/runner-types.js";
import type { RouteTile, TileFamily } from "../tiles/tile-types.js";

export interface RouteRunScenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly board: BoardDefinition;
  readonly runner: PlaceRunnerInput;
  readonly solverOptions?: RouteSolverOptions;
  readonly refillData?: readonly (RefillContent | null)[];
  readonly secondRefillData?: readonly (RefillContent | null)[];
  readonly expansion?: ExpansionDefinition;
  readonly expectedFailure?: string;
  readonly tags: readonly string[];
}

const overlay = (id: string, valueMinor: number, persistent = false): RouteOverlay => ({
  id, type: valueMinor > 500 ? "premium-reward" : "standard-reward", valueMinor,
  collectable: true, persistent, removeOnCollect: true, metadata: { illustrative: true },
});

const tile = (id: string, family: TileFamily, connections: readonly Direction[], values: Partial<RouteTile> = {}): RouteTile => ({
  id, family, connections, rotation: 0,
  ...(values.oneWay ? { oneWay: values.oneWay } : {}),
  ...(values.persistent === undefined ? {} : { persistent: values.persistent }),
  ...(values.movable === undefined ? {} : { movable: values.movable }),
  metadata: { diagnostic: true, ...values.metadata },
});

function horizontal(id: string, length: number, destination = false, withOverlay = false): BoardDefinition {
  const builder = new BoardBuilder({ id, width: length, height: 1, gravity: "down" });
  builder.addEntry({ row: 0, column: 0 });
  for (let column = 0; column < length; column += 1) {
    const first = column === 0;
    const last = column === length - 1;
    const family: TileFamily = first ? "entry" : last && destination ? "destination" : "straight";
    const connections: Direction[] = ["west"];
    if (!last) connections.push("east");
    builder.setTile({ row: 0, column }, tile(`${id}-tile-${column}`, family, connections, last && destination ? { persistent: true, movable: false } : {}),
      withOverlay && column > 0 ? [overlay(`${id}-overlay-${column}`, column * 250)] : []);
  }
  if (destination) builder.addDestination({ row: 0, column: length - 1 }, { id: `${id}-destination`, retainOnClear: true, metadata: {} });
  return builder.build();
}

function verticalCascadeBoard(id: string): BoardDefinition {
  const builder = new BoardBuilder({ id, width: 1, height: 3, gravity: "down", maximumCascadeCount: 4 });
  builder.addEntry({ row: 0, column: 0 });
  builder.addDestination({ row: 2, column: 0 }, { id: `${id}-destination`, retainOnClear: false, metadata: {} });
  builder.setTile({ row: 0, column: 0 }, tile(`${id}-entry`, "entry", ["north", "south"]));
  builder.setTile({ row: 1, column: 0 }, tile(`${id}-middle`, "straight", ["north", "south"]));
  builder.setTile({ row: 2, column: 0 }, tile(`${id}-destination-tile`, "destination", ["north"]));
  return builder.build();
}

function refillRoute(prefix: string): readonly RefillContent[] {
  // Downward refill requests bottom-to-top for a completely empty column.
  return [
    { tile: tile(`${prefix}-destination`, "destination", ["north"]) },
    { tile: tile(`${prefix}-straight`, "straight", ["north", "south"]), overlays: [overlay(`${prefix}-reward`, 300)] },
    { tile: tile(`${prefix}-entry`, "entry", ["north", "south"]) },
  ];
}

function bendBoard(): BoardDefinition {
  const builder = new BoardBuilder({ id: "bend-route", width: 2, height: 2 });
  builder.addEntry({ row: 0, column: 0 });
  builder.setTile({ row: 0, column: 0 }, tile("bend-entry", "entry", ["west", "east"]));
  builder.setTile({ row: 0, column: 1 }, tile("bend-corner", "bend", ["west", "south"]));
  builder.setTile({ row: 1, column: 1 }, tile("bend-end", "straight", ["north"]));
  return builder.build();
}

function junctionBoard(): BoardDefinition {
  const builder = new BoardBuilder({ id: "junction-route", width: 3, height: 2 });
  builder.addEntry({ row: 1, column: 0 });
  builder.addDestination({ row: 1, column: 2 }, { id: "junction-destination", metadata: {} });
  builder.setTile({ row: 1, column: 0 }, tile("junction-entry", "entry", ["west", "east"]));
  builder.setTile({ row: 1, column: 1 }, tile("junction", "t-junction", ["west", "north", "east"]));
  builder.setTile({ row: 0, column: 1 }, tile("junction-north-end", "straight", ["south"]));
  builder.setTile({ row: 1, column: 2 }, tile("junction-east-destination", "destination", ["west"]));
  return builder.build();
}

function expansionBoard(): { board: BoardDefinition; expansion: ExpansionDefinition } {
  const builder = new BoardBuilder({ id: "sealed-expansion", width: 4, height: 2 });
  builder.addEntry({ row: 0, column: 0 });
  builder.setTile({ row: 0, column: 0 }, tile("expand-entry", "entry", ["west", "east"]));
  builder.setTile({ row: 0, column: 1 }, tile("expand-end", "straight", ["west"]));
  builder.setState({ row: 0, column: 2 }, "sealed");
  builder.setState({ row: 1, column: 2 }, "sealed");
  builder.setState({ row: 0, column: 3 }, "sealed");
  builder.setState({ row: 1, column: 3 }, "sealed");
  return {
    board: builder.build(),
    expansion: {
      id: "activate-east-side", side: "east",
      activations: [
        { coordinate: { row: 0, column: 2 }, tile: tile("expand-new-straight", "straight", ["west", "east"]) },
        { coordinate: { row: 0, column: 3 }, tile: tile("expand-new-end", "destination", ["west"]) },
      ],
      metadata: { example: true },
    },
  };
}

function invalidReciprocalBoard(): BoardDefinition {
  const builder = new BoardBuilder({ id: "invalid-reciprocal", width: 2, height: 1 });
  builder.addEntry({ row: 0, column: 0 });
  builder.setTile({ row: 0, column: 0 }, tile("invalid-source", "entry", ["west", "east"]));
  builder.setTile({ row: 0, column: 1 }, tile("invalid-target", "straight", ["east"]));
  return builder.build(false);
}

function loopBoard(): BoardDefinition {
  const builder = new BoardBuilder({ id: "loop", width: 2, height: 2 });
  builder.addEntry({ row: 0, column: 0 });
  builder.setTile({ row: 0, column: 0 }, tile("loop-a", "entry", ["west", "east", "south"]));
  builder.setTile({ row: 0, column: 1 }, tile("loop-b", "bend", ["west", "south"]));
  builder.setTile({ row: 1, column: 1 }, tile("loop-c", "bend", ["north", "west"]));
  builder.setTile({ row: 1, column: 0 }, tile("loop-d", "bend", ["east", "north"]));
  return builder.build();
}

function mobileBoard(): BoardDefinition {
  const builder = new BoardBuilder({ id: "mobile-readable-5x5", width: 5, height: 5 });
  builder.addEntry({ row: 2, column: 0 });
  builder.addDestination({ row: 4, column: 4 }, { id: "mobile-destination", metadata: {} });
  builder.setTile({ row: 2, column: 0 }, tile("mobile-entry", "entry", ["west", "east"]));
  builder.setTile({ row: 2, column: 1 }, tile("mobile-1", "straight", ["west", "east"]), [overlay("mobile-overlay", 200)]);
  builder.setTile({ row: 2, column: 2 }, tile("mobile-bend", "bend", ["west", "south"]));
  builder.setTile({ row: 3, column: 2 }, tile("mobile-down", "straight", ["north", "south"]));
  builder.setTile({ row: 4, column: 2 }, tile("mobile-turn", "bend", ["north", "east"]));
  builder.setTile({ row: 4, column: 3 }, tile("mobile-right", "straight", ["west", "east"]));
  builder.setTile({ row: 4, column: 4 }, tile("mobile-destination-tile", "destination", ["west"]));
  builder.setState({ row: 0, column: 4 }, "sealed");
  builder.setState({ row: 1, column: 4 }, "blocked");
  return builder.build();
}

const expansionExample = expansionBoard();

export const ROUTERUN_SCENARIOS: readonly RouteRunScenario[] = [
  { id: "straight-route", name: "Straight route", description: "Three horizontal cells ending normally.", board: horizontal("straight", 3), runner: runner("straight", { row: 0, column: 0 }, "west"), tags: ["route"] },
  { id: "bend-route", name: "Bend route", description: "A deterministic ninety-degree turn.", board: bendBoard(), runner: runner("bend", { row: 0, column: 0 }, "west"), tags: ["route", "bend"] },
  { id: "deterministic-t-junction", name: "Deterministic T-junction", description: "An explicit east exit reaches the destination.", board: junctionBoard(), runner: runner("junction", { row: 1, column: 0 }, "west"), solverOptions: { junctionInstructions: { "1:1": ["east"] } }, tags: ["junction"] },
  { id: "dead-end", name: "Dead-end route", description: "A visible normal dead end.", board: horizontal("dead-end", 2), runner: runner("dead-end", { row: 0, column: 0 }, "west"), tags: ["terminal"] },
  { id: "destination-reached", name: "Destination reached", description: "A configured destination completes the route.", board: horizontal("destination", 3, true), runner: runner("destination", { row: 0, column: 0 }, "west"), tags: ["destination"] },
  { id: "overlay-collection", name: "Overlay collection", description: "Generic rewards collect strictly in route order.", board: horizontal("overlays", 4, true, true), runner: runner("overlays", { row: 0, column: 0 }, "west"), tags: ["overlays"] },
  { id: "clear-downward-cascade", name: "Clear and downward cascade", description: "A full route clears before deterministic downward refill.", board: verticalCascadeBoard("cascade-one"), runner: runner("cascade-one", { row: 0, column: 0 }, "north"), refillData: refillRoute("cascade-one-refill"), tags: ["cascade"] },
  { id: "two-cascade-continuation", name: "Two-cascade continuation", description: "Predetermined refills produce another legal route twice.", board: verticalCascadeBoard("cascade-two"), runner: runner("cascade-two", { row: 0, column: 0 }, "north"), refillData: refillRoute("cascade-two-a"), secondRefillData: refillRoute("cascade-two-b"), tags: ["cascade", "continuation"] },
  { id: "sealed-side-expansion", name: "Sealed side-area expansion", description: "An explicit generic command activates the east side.", board: expansionExample.board, runner: runner("expansion", { row: 0, column: 0 }, "west"), expansion: expansionExample.expansion, tags: ["expansion"] },
  { id: "interrupt-recovery", name: "Interrupted movement and recovery", description: "A longer route demonstrates exact resume boundaries.", board: horizontal("recovery", 6, true, true), runner: runner("recovery", { row: 0, column: 0 }, "west"), tags: ["recovery"] },
  { id: "invalid-reciprocal", name: "Invalid reciprocal connection", description: "The target does not accept the source connection.", board: invalidReciprocalBoard(), runner: runner("invalid", { row: 0, column: 0 }, "west"), tags: ["failure"] },
  { id: "illegal-junction", name: "Illegal junction instruction", description: "The outcome explicitly requests an unavailable south exit.", board: junctionBoard(), runner: runner("illegal", { row: 1, column: 0 }, "west"), solverOptions: { junctionInstructions: { "1:1": ["south"] } }, expectedFailure: "ILLEGAL_JUNCTION_INSTRUCTION", tags: ["failure", "junction"] },
  { id: "loop-detection", name: "Loop detection", description: "A supplied east decision enters a closed four-cell loop.", board: loopBoard(), runner: runner("loop", { row: 0, column: 0 }, "west"), solverOptions: { junctionInstructions: { "0:0": ["east"] } }, tags: ["safety"] },
  { id: "maximum-step", name: "Maximum-step protection", description: "A route is stopped by a deliberately low diagnostic step limit.", board: horizontal("max-step", 8, true), runner: runner("max-step", { row: 0, column: 0 }, "west"), solverOptions: { maximumSteps: 3 }, tags: ["safety"] },
  { id: "mobile-readable-5x5", name: "Mobile-readable 5×5", description: "A compact diagnostic route designed for 390×844 inspection.", board: mobileBoard(), runner: runner("mobile", { row: 2, column: 0 }, "west"), tags: ["mobile", "5x5"] },
];

export function getRouteRunScenario(id: string): RouteRunScenario {
  const scenario = ROUTERUN_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown RouteRun scenario ${id}`);
  return structuredClone(scenario);
}

function runner(id: string, coordinate: { readonly row: number; readonly column: number }, entryDirection: Direction): PlaceRunnerInput {
  return { id: `runner-${id}`, coordinate, entryDirection, currentDirection: entryDirection, metadata: { diagnostic: true } };
}
