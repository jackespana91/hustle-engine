import {
  BoardBuilder,
  type BoardDefinition,
  type Coordinate,
  type Direction,
  type ExpansionDefinition,
  type PlaceRunnerInput,
  type RefillContent,
  type RouteOverlay,
  type RouteTile,
  type TileFamily,
} from "@hustle/routerun";
import { NIGHT_DROP_FEATURE_IDS } from "../config/ids.js";

export interface NightDropScenarioConfig {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly board: BoardDefinition;
  readonly runner: PlaceRunnerInput;
  readonly activeFeatures: readonly string[];
  readonly expansion: ExpansionDefinition | null;
  readonly continuationRefill: readonly RefillContent[] | null;
  readonly flags: {
    readonly expansion: boolean;
    readonly cascade: boolean;
    readonly continuation: boolean;
    readonly interrupted: boolean;
    readonly deadEnd: boolean;
  };
  readonly betMinor: number;
  readonly winMinor: number;
  readonly multiplier: number;
}

const directionBetween = (from: Coordinate, to: Coordinate): Direction => {
  if (to.row === from.row - 1 && to.column === from.column) return "north";
  if (to.row === from.row + 1 && to.column === from.column) return "south";
  if (to.column === from.column - 1 && to.row === from.row) return "west";
  if (to.column === from.column + 1 && to.row === from.row) return "east";
  throw new Error("Night Drop paths must use adjacent cells");
};

const overlay = (id: string, index: number, activeFeatures: readonly string[]): RouteOverlay => ({
  id,
  type: index % 3 === 0 ? "premium-reward" : "standard-reward",
  valueMinor: index % 3 === 0 ? 250 : 100,
  multiplierScaled: index % 4 === 0 ? 2_000 : 1_000,
  collectable: true,
  persistent: false,
  removeOnCollect: true,
  ...(activeFeatures.includes(String(NIGHT_DROP_FEATURE_IDS.fiveStar)) ? { featureId: NIGHT_DROP_FEATURE_IDS.fiveStar } : {}),
  metadata: {
    gamePack: "night-drop",
    logicalAssetId: index % 2 === 0 ? "overlay.package" : "overlay.tip",
    fiveStar: index % 3 === 0,
    priorityJob: activeFeatures.includes(String(NIGHT_DROP_FEATURE_IDS.priorityJobs)) && index === 2,
  },
});

const routeTile = (id: string, family: TileFamily, connections: readonly Direction[], movable = true): RouteTile => ({
  id,
  family,
  connections,
  rotation: 0,
  persistent: false,
  movable,
  metadata: { gamePack: "night-drop", logicalAssetId: family === "destination" ? "tile.destination" : "tile.street" },
});

const STANDARD_PATH: readonly Coordinate[] = [
  { row: 4, column: 0 }, { row: 4, column: 1 }, { row: 4, column: 2 },
  { row: 4, column: 3 }, { row: 4, column: 4 },
];
const TINY_PATH: readonly Coordinate[] = STANDARD_PATH.slice(0, 3);
const LONG_PATH: readonly Coordinate[] = [
  { row: 4, column: 0 }, { row: 4, column: 1 }, { row: 4, column: 2 },
  { row: 3, column: 2 }, { row: 2, column: 2 }, { row: 2, column: 3 },
  { row: 2, column: 4 }, { row: 1, column: 4 }, { row: 0, column: 4 },
];

function createBoard(id: string, path: readonly Coordinate[], activeFeatures: readonly string[], deadEnd = false): BoardDefinition {
  const builder = new BoardBuilder({
    id: `night-drop-${id}`,
    width: 5,
    height: 5,
    gravity: "down",
    maximumCascadeCount: 1,
    defaultCellState: "blocked",
    metadata: {
      gamePack: "night-drop",
      dimensions: "5x5",
      activeFeatures,
      continuationLimit: 1,
      destinationCount: 1,
    },
  });
  builder.addEntry(path[0]!);
  path.forEach((coordinate, index) => {
    const previous = path[index - 1];
    const next = path[index + 1];
    const connections: Direction[] = [];
    if (previous) connections.push(directionBetween(coordinate, previous));
    else connections.push("west");
    if (next) connections.push(directionBetween(coordinate, next));
    const destination = !deadEnd && index === path.length - 1;
    builder.setTile(
      coordinate,
      routeTile(`${id}-street-${index}`, index === 0 ? "entry" : destination ? "destination" : connections.length > 1 && connections[0] !== opposite(connections[1]!) ? "bend" : "straight", connections),
      index > 0 && !destination ? [overlay(`${id}-package-${index}`, index, activeFeatures)] : [],
    );
    if (destination) builder.addDestination(coordinate, { id: `${id}-destination`, retainOnClear: false, metadata: { logicalAssetId: "tile.destination" } });
  });
  if (deadEnd) {
    const destination = { row: 0, column: 4 };
    builder.setTile(destination, routeTile(`${id}-unreached-destination`, "destination", ["west"], false));
    builder.addDestination(destination, { id: `${id}-destination`, retainOnClear: true, metadata: { unreachableDemo: true } });
  }
  builder.setState({ row: 0, column: 0 }, "sealed");
  builder.setState({ row: 0, column: 1 }, "sealed");
  return builder.build();
}

function opposite(direction: Direction): Direction {
  return ({ north: "south", south: "north", east: "west", west: "east" } as const)[direction];
}

export const NIGHT_DROP_EXPANSION: ExpansionDefinition = {
  id: "night-drop-rooftop-extension",
  side: "north",
  activations: [
    { coordinate: { row: 0, column: 0 }, tile: routeTile("rooftop-extension-a", "straight", ["east"], false), metadata: { simpleExpansion: true } },
    { coordinate: { row: 0, column: 1 }, tile: routeTile("rooftop-extension-b", "straight", ["west"], false), overlays: [overlay("rooftop-tip", 3, [])], metadata: { simpleExpansion: true } },
  ],
  metadata: { gamePack: "night-drop", simpleExpansion: true },
};

export const NIGHT_DROP_CONTINUATION_REFILL: readonly RefillContent[] = STANDARD_PATH.map((_, index) => ({
  tile: routeTile(
    `continuation-street-${index}`,
    index === 0 ? "entry" : index === STANDARD_PATH.length - 1 ? "destination" : "straight",
    index === 0 ? ["west", "east"] : index === STANDARD_PATH.length - 1 ? ["west"] : ["west", "east"],
  ),
  ...(index > 0 && index < STANDARD_PATH.length - 1 ? { overlays: [overlay(`continuation-package-${index}`, index, [String(NIGHT_DROP_FEATURE_IDS.fiveStar)])] } : {}),
  metadata: { continuation: 1 },
}));

const feature = (key: keyof typeof NIGHT_DROP_FEATURE_IDS): string => String(NIGHT_DROP_FEATURE_IDS[key]);
const allFeatures = Object.values(NIGHT_DROP_FEATURE_IDS).map(String);
const baseFlags = { expansion: false, cascade: false, continuation: false, interrupted: false, deadEnd: false } as const;

function scenario(values: {
  id: string; name: string; tagline: string; path?: readonly Coordinate[]; features?: readonly string[];
  flags?: Partial<NightDropScenarioConfig["flags"]>; betMinor?: number; winMinor: number; multiplier?: number;
}): NightDropScenarioConfig {
  const flags = { ...baseFlags, ...(values.flags ?? {}) };
  const path = values.path ?? STANDARD_PATH;
  const features = values.features ?? [];
  return {
    id: values.id,
    name: values.name,
    tagline: values.tagline,
    board: createBoard(values.id, path, features, flags.deadEnd),
    runner: { id: "character.dash", coordinate: path[0]!, entryDirection: "west", currentDirection: "west", metadata: { character: "dash" } },
    activeFeatures: features,
    expansion: flags.expansion ? NIGHT_DROP_EXPANSION : null,
    continuationRefill: flags.continuation ? NIGHT_DROP_CONTINUATION_REFILL : null,
    flags,
    betMinor: values.betMinor ?? 100,
    winMinor: values.winMinor,
    multiplier: values.multiplier ?? Math.max(1, values.winMinor / (values.betMinor ?? 100)),
  };
}

export const NIGHT_DROP_SCENARIOS: readonly NightDropScenarioConfig[] = [
  scenario({ id: "tiny-route", name: "Tiny Route", tagline: "Two turns late. Still technically early.", path: TINY_PATH, winMinor: 120 }),
  scenario({ id: "shortcut", name: "Shortcut", tagline: "Dash found a road the map denies exists.", features: [feature("shortcut")], winMinor: 240 }),
  scenario({ id: "long-route", name: "Long Route", tagline: "Scenic, if you enjoy fire escapes.", path: LONG_PATH, features: [feature("fiveStar")], winMinor: 580 }),
  scenario({ id: "clamp", name: "Clamp", tagline: "The route now has paperwork.", features: [feature("clamp")], winMinor: 180 }),
  scenario({ id: "expansion", name: "Expansion", tagline: "Apparently the roof counts as a lane.", features: [feature("penthouseDrop")], flags: { expansion: true }, winMinor: 420 }),
  scenario({ id: "cascade", name: "Cascade", tagline: "New streets. Same questionable brakes.", features: [feature("fiveStar")], flags: { cascade: true, continuation: true }, winMinor: 650 }),
  scenario({ id: "priority-jobs", name: "Priority Jobs", tagline: "Urgent means Mara used the red emoji.", features: [feature("fiveStar"), feature("priorityJobs")], winMinor: 760 }),
  scenario({ id: "dead-end", name: "Dead End", tagline: "Dash has located the exact opposite of progress.", path: TINY_PATH, flags: { deadEnd: true }, winMinor: 0 }),
  scenario({ id: "perfect-route", name: "Perfect Route", tagline: "No notes. Several witnesses.", features: allFeatures, flags: { expansion: true }, winMinor: 1250, multiplier: 12.5 }),
  scenario({ id: "interrupted-route", name: "Interrupted Route", tagline: "Connection dropped. Bad decisions preserved.", features: [feature("shortcut"), feature("clamp")], flags: { interrupted: true }, winMinor: 330 }),
];

export function getNightDropScenario(id: string): NightDropScenarioConfig {
  const found = NIGHT_DROP_SCENARIOS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown Night Drop outcome ${id}`);
  return structuredClone(found);
}
