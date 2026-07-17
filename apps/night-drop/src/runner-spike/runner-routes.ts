import {
  composeSpatialRoute,
  type ComposedSpatialRoute,
  type SpatialRouteBranchDefinition,
  type SpatialRouteJunctionKind,
  type SpatialRouteCueDefinition,
  type SpatialRouteDefinition,
  type SpatialRouteObstacleDefinition,
  type SpatialRouteSegmentDefinition,
  type SpatialRouteSegmentKind,
} from "@hustle/routerun";

export type NightDropRunnerRouteId =
  | "city-sprint"
  | "glasshouse-loop"
  | "cross-city"
  | "rooftop-ascent"
  | "neon-slalom"
  | "canal-dash"
  | "market-maze"
  | "skybridge-chain"
  | "district-marathon"
  | "night-shift";

export interface NightDropRunnerRouteProfile {
  readonly id: NightDropRunnerRouteId;
  readonly label: string;
  readonly durationMs: number;
  readonly difficulty: "Quick" | "Standard" | "Extended" | "Technical";
  readonly definition: SpatialRouteDefinition;
}

const start = { position: { x: 0, y: 0, z: 8 }, headingDegrees: 0 } as const;

const segment = (
  id: string,
  kind: SpatialRouteSegmentKind,
  length: number,
  turnDegrees = 0,
  elevation = 0,
  width = 4.8,
): SpatialRouteSegmentDefinition => ({ id, kind, length, turnDegrees, elevation, width, metadata: { gamePack: "night-drop" } });

const cue = (
  id: string,
  kind: SpatialRouteCueDefinition["kind"],
  segmentId: string,
  offset: number,
  laneOffset = 0,
): SpatialRouteCueDefinition => ({ id, kind, segmentId, offset, laneOffset, metadata: { gamePack: "night-drop" } });

const obstacle = (
  id: string,
  kind: SpatialRouteObstacleDefinition["kind"],
  segmentId: string,
  offset: number,
  lane?: number,
  reactionLeadDistance = 46,
): SpatialRouteObstacleDefinition => ({
  id,
  kind,
  segmentId,
  offset,
  ...(lane !== undefined ? { lane } : {}),
  reactionLeadDistance,
  metadata: { gamePack: "night-drop", presentationOnly: true, outcomeSafe: true },
});

const branch = (
  id: string,
  entrySegmentId: string,
  rejoinSegmentId: string,
  junctionKind: Exclude<SpatialRouteJunctionKind, "fork">,
  defaultAlternativeId: "left" | "straight" | "right" = junctionKind === "crossroads" ? "straight" : "right",
  decisionLeadDistance = 42,
): SpatialRouteBranchDefinition => ({
  id,
  junctionKind,
  entry: { segmentId: entrySegmentId, offset: .08 },
  rejoin: { segmentId: rejoinSegmentId, offset: .82 },
  decisionLeadDistance,
  decisionTailDistance: 8,
  defaultAlternativeId,
  alternatives: junctionKind === "crossroads" ? [
    { id: "left", direction: "left", lateralOffset: -11.5, headingOffsetDegrees: -78, divergeFraction: .2, rejoinFraction: .76, metadata: { label: "← Left street", outcomeSafe: true } },
    { id: "straight", direction: "straight", lateralOffset: 0, headingOffsetDegrees: 0, divergeFraction: .2, rejoinFraction: .76, metadata: { label: "↑ Straight", outcomeSafe: true } },
    { id: "right", direction: "right", lateralOffset: 11.5, headingOffsetDegrees: 78, divergeFraction: .2, rejoinFraction: .76, metadata: { label: "Right street →", outcomeSafe: true } },
  ] : [
    { id: "left", direction: "left", lateralOffset: -11.5, headingOffsetDegrees: -82, divergeFraction: .2, rejoinFraction: .76, metadata: { label: "← Turn left", outcomeSafe: true } },
    { id: "right", direction: "right", lateralOffset: 11.5, headingOffsetDegrees: 82, divergeFraction: .2, rejoinFraction: .76, metadata: { label: "Turn right →", outcomeSafe: true } },
  ],
  metadata: { gamePack: "night-drop", presentationOnly: true, outcomeSafe: true, rejoins: true },
});

const profiles: readonly NightDropRunnerRouteProfile[] = [
  {
    id: "city-sprint",
    label: "City Sprint",
    durationMs: 16_000,
    difficulty: "Quick",
    definition: {
      id: "night-drop.city-sprint",
      name: "City Sprint",
      description: "A compact street delivery with two clear corners and one service passage.",
      start,
      segments: [
        segment("sprint-entry", "street", 28),
        segment("sprint-market-bend", "bend", 24, 75),
        segment("sprint-market", "street", 30),
        segment("sprint-canal-bend", "bend", 22, -75),
        segment("sprint-canal", "street", 32),
        segment("sprint-service-turn", "junction", 20),
        segment("sprint-service", "alley", 24, 0, 0, 3.4),
        segment("sprint-checkpoint", "bend", 18, -45),
        segment("sprint-address", "destination", 30),
      ],
      cues: [
        cue("sprint-package-01", "standard-pickup", "sprint-market", .2, -.35),
        cue("sprint-package-02", "standard-pickup", "sprint-market", .78, .35),
        cue("sprint-package-premium", "premium-pickup", "sprint-canal", .62, -.12),
        cue("sprint-continuation", "continuation", "sprint-service-turn", .28),
        cue("sprint-shortcut", "shortcut", "sprint-service", .42),
        cue("sprint-checkpoint-cue", "checkpoint", "sprint-checkpoint", .72),
        cue("sprint-final-address", "destination", "sprint-address", .92),
      ],
      obstacles: [
        obstacle("sprint-jump-barrier", "barrier", "sprint-market", .52, undefined, 44),
        obstacle("sprint-traffic", "traffic", "sprint-canal", .38, 0, 44),
        obstacle("sprint-low-sign", "low-sign", "sprint-service", .58, undefined, 44),
      ],
      branches: [branch("sprint-t-junction", "sprint-service-turn", "sprint-checkpoint", "t-junction", "right", 38)],
      metadata: { gamePack: "night-drop", routeClass: "short", environmentSeed: 11 },
    },
  },
  {
    id: "glasshouse-loop",
    label: "Glasshouse Loop",
    durationMs: 24_500,
    difficulty: "Standard",
    definition: {
      id: "night-drop.glasshouse-loop",
      name: "Glasshouse Loop",
      description: "A full district run mixing broad streets, an alley, a bridge and a tunnel.",
      start,
      segments: [
        segment("loop-entry", "street", 30),
        segment("loop-market-bend", "bend", 26, 80),
        segment("loop-market", "street", 38),
        segment("loop-switchback", "bend", 30, -110),
        segment("loop-alley", "alley", 34, 0, 0, 3.2),
        segment("loop-boulevard", "junction", 40, 0, 0, 6.4),
        segment("loop-bridge-turn", "bend", 26, 95),
        segment("loop-bridge", "bridge", 44, 0, 2),
        segment("loop-descent-turn", "bend", 28, 75, -2),
        segment("loop-arcade", "junction", 38),
        segment("loop-service-tunnel", "tunnel", 34, 0, 0, 3.6),
        segment("loop-checkpoint-turn", "bend", 24, -90),
        segment("loop-final-street", "street", 42),
        segment("loop-address", "destination", 18),
      ],
      cues: [
        cue("loop-package-01", "standard-pickup", "loop-market", .36, -.32),
        cue("loop-package-02", "standard-pickup", "loop-alley", .48, .28),
        cue("loop-package-premium", "premium-pickup", "loop-boulevard", .72, -.1),
        cue("loop-continuation", "continuation", "loop-bridge-turn", .45),
        cue("loop-shortcut", "shortcut", "loop-service-tunnel", .4),
        cue("loop-checkpoint-cue", "checkpoint", "loop-checkpoint-turn", .66),
        cue("loop-final-address", "destination", "loop-address", .9),
      ],
      obstacles: [
        obstacle("loop-market-traffic", "traffic", "loop-market", .58, -1, 46),
        obstacle("loop-alley-sign", "low-sign", "loop-alley", .54, undefined, 46),
        obstacle("loop-boulevard-barrier", "barrier", "loop-boulevard", .64, undefined, 46),
        obstacle("loop-bridge-gap", "gap", "loop-bridge", .56, undefined, 46),
        obstacle("loop-final-blocker", "route-blocker", "loop-final-street", .52, 1, 46),
      ],
      branches: [
        branch("loop-boulevard-t-junction", "loop-boulevard", "loop-bridge", "t-junction", "right", 44),
        branch("loop-crossroads", "loop-arcade", "loop-checkpoint-turn", "crossroads", "straight", 44),
      ],
      metadata: { gamePack: "night-drop", routeClass: "medium", environmentSeed: 29 },
    },
  },
  {
    id: "cross-city",
    label: "Cross-City Run",
    durationMs: 37_500,
    difficulty: "Extended",
    definition: {
      id: "night-drop.cross-city",
      name: "Cross-City Run",
      description: "A long multi-district route with repeated direction changes and two major transitions.",
      start,
      segments: [
        segment("cross-entry", "street", 34),
        segment("cross-market-curve", "bend", 32, 70),
        segment("cross-market", "street", 42),
        segment("cross-lane-turn", "bend", 28, -100),
        segment("cross-lane", "alley", 38, 0, 0, 3.4),
        segment("cross-junction-a", "junction", 30),
        segment("cross-boulevard-a", "street", 48),
        segment("cross-bridge-rise", "ramp", 36, 20, 5),
        segment("cross-bridge", "bridge", 54),
        segment("cross-bridge-fall", "ramp", 36, -20, -5),
        segment("cross-junction-b", "junction", 30),
        segment("cross-night-market", "street", 46),
        segment("cross-tunnel-entry", "bend", 26, 70),
        segment("cross-tunnel", "tunnel", 52, 0, 0, 3.7),
        segment("cross-tunnel-exit", "bend", 28, 55),
        segment("cross-warehouse", "street", 44),
        segment("cross-switchback-a", "bend", 24, -85),
        segment("cross-service-road", "junction", 42, 0, 0, 6.4),
        segment("cross-switchback-b", "bend", 24, 85),
        segment("cross-checkpoint", "street", 38),
        segment("cross-final-curve", "bend", 30, -70),
        segment("cross-final-avenue", "street", 50),
        segment("cross-address", "destination", 22),
      ],
      cues: [
        cue("cross-package-01", "standard-pickup", "cross-market", .42, -.38),
        cue("cross-package-02", "standard-pickup", "cross-lane", .58, .3),
        cue("cross-package-premium", "premium-pickup", "cross-boulevard-a", .68, -.12),
        cue("cross-continuation", "continuation", "cross-bridge-rise", .5),
        cue("cross-shortcut", "shortcut", "cross-tunnel", .46),
        cue("cross-checkpoint-cue", "checkpoint", "cross-checkpoint", .58),
        cue("cross-final-address", "destination", "cross-address", .92),
      ],
      obstacles: [
        obstacle("cross-market-traffic", "traffic", "cross-market", .58, -1, 52),
        obstacle("cross-lane-sign", "low-sign", "cross-lane", .62, undefined, 52),
        obstacle("cross-boulevard-barrier", "barrier", "cross-boulevard-a", .44, undefined, 52),
        obstacle("cross-bridge-gap", "gap", "cross-bridge", .56, undefined, 52),
        obstacle("cross-tunnel-sign", "low-sign", "cross-tunnel", .5, undefined, 52),
        obstacle("cross-warehouse-blocker", "route-blocker", "cross-warehouse", .54, 0, 52),
        obstacle("cross-final-ramp", "ramp", "cross-final-avenue", .32, undefined, 52),
      ],
      branches: [
        branch("cross-market-crossroads", "cross-junction-a", "cross-bridge-rise", "crossroads", "straight", 50),
        branch("cross-canal-t-junction", "cross-junction-b", "cross-tunnel-entry", "t-junction", "left", 50),
        branch("cross-warehouse-crossroads", "cross-service-road", "cross-final-curve", "crossroads", "right", 50),
      ],
      metadata: { gamePack: "night-drop", routeClass: "long", environmentSeed: 47 },
    },
  },
  {
    id: "rooftop-ascent",
    label: "Rooftop Ascent",
    durationMs: 30_500,
    difficulty: "Technical",
    definition: {
      id: "night-drop.rooftop-ascent",
      name: "Rooftop Ascent",
      description: "A vertical route climbing parking ramps, roof bridges and narrow service decks.",
      start,
      segments: [
        segment("roof-entry", "street", 30),
        segment("roof-ramp-a", "ramp", 42, 35, 7),
        segment("roof-deck-a", "rooftop", 38, 0, 0, 4.2),
        segment("roof-ramp-b", "ramp", 40, -70, 8),
        segment("roof-deck-b", "junction", 34, 0, 0, 6.4),
        segment("roof-bridge-turn", "bend", 24, 80),
        segment("roof-skybridge", "bridge", 48, 0, 2, 3.8),
        segment("roof-service-bend", "junction", 26),
        segment("roof-service", "alley", 34, 0, 0, 3.1),
        segment("roof-ramp-c", "ramp", 38, -45, 6),
        segment("roof-upper-deck", "rooftop", 42),
        segment("roof-checkpoint-turn", "bend", 26, -90),
        segment("roof-checkpoint", "rooftop", 34),
        segment("roof-final-ramp", "ramp", 36, 45, 5),
        segment("roof-address", "destination", 24),
      ],
      cues: [
        cue("roof-package-01", "standard-pickup", "roof-ramp-a", .58, -.28),
        cue("roof-package-02", "standard-pickup", "roof-deck-b", .46, .28),
        cue("roof-package-premium", "premium-pickup", "roof-skybridge", .52),
        cue("roof-continuation", "continuation", "roof-service-bend", .42),
        cue("roof-shortcut", "shortcut", "roof-service", .48),
        cue("roof-checkpoint-cue", "checkpoint", "roof-checkpoint", .5),
        cue("roof-final-address", "destination", "roof-address", .9),
      ],
      obstacles: [
        obstacle("roof-entry-traffic", "traffic", "roof-entry", .62, 1, 44),
        obstacle("roof-ramp-barrier", "barrier", "roof-ramp-a", .58, undefined, 44),
        obstacle("roof-deck-blocker", "route-blocker", "roof-deck-a", .52, -1, 44),
        obstacle("roof-bridge-gap", "gap", "roof-skybridge", .56, undefined, 44),
        obstacle("roof-service-sign", "low-sign", "roof-service", .5, undefined, 44),
        obstacle("roof-final-boost", "ramp", "roof-final-ramp", .42, undefined, 44),
      ],
      branches: [
        branch("roof-deck-crossroads", "roof-deck-b", "roof-skybridge", "crossroads", "straight", 44),
        branch("roof-t-junction", "roof-service-bend", "roof-checkpoint", "t-junction", "right", 44),
      ],
      metadata: { gamePack: "night-drop", routeClass: "vertical", environmentSeed: 71 },
    },
  },
  generatedProfile({
    id: "neon-slalom", label: "Neon Slalom", durationMs: 21_000, difficulty: "Technical",
    description: "A rapid sequence of alternating corners through the neon retail lanes.",
    segmentCount: 13, segmentLength: 27, turns: [0, 58, -62, 48, -52, 0], verticality: 0, routeClass: "slalom", seed: 83,
  }),
  generatedProfile({
    id: "canal-dash", label: "Canal Dash", durationMs: 28_000, difficulty: "Standard",
    description: "Long waterside straights broken by bridge turns and a maintenance tunnel.",
    segmentCount: 15, segmentLength: 34, turns: [0, 0, 42, 0, -42, 0, 0, 65, -65], verticality: 1.5, routeClass: "canal", seed: 97,
  }),
  generatedProfile({
    id: "market-maze", label: "Market Maze", durationMs: 34_000, difficulty: "Technical",
    description: "Dense junctions, narrow alleys and repeated switchbacks through the night market.",
    segmentCount: 18, segmentLength: 35, turns: [70, -40, 55, -85, 35, 0], verticality: .6, routeClass: "maze", seed: 113,
  }),
  generatedProfile({
    id: "skybridge-chain", label: "Skybridge Chain", durationMs: 42_000, difficulty: "Technical",
    description: "An elevated chain of ramps, roof decks and exposed bridges across the district.",
    segmentCount: 19, segmentLength: 38, turns: [0, 45, 0, -70, 0, 55, -30], verticality: 5.5, routeClass: "elevated", seed: 131,
  }),
  generatedProfile({
    id: "district-marathon", label: "District Marathon", durationMs: 66_000, difficulty: "Extended",
    description: "A multi-leg delivery joining markets, canals, warehouses and the upper district.",
    segmentCount: 30, segmentLength: 41, turns: [0, 38, 0, -52, 25, 0, 0, 62, -45], verticality: 2.8, routeClass: "marathon", seed: 149,
  }),
  generatedProfile({
    id: "night-shift", label: "Full Night Shift", durationMs: 88_000, difficulty: "Extended",
    description: "The full reusable route stress test: multiple districts, branches, climbs and long continuations.",
    segmentCount: 38, segmentLength: 45, turns: [0, 32, 0, -48, 0, 65, -35, 0, -28, 42], verticality: 3.4, routeClass: "ultra", seed: 167,
  }),
] as const;

function generatedProfile(values: {
  readonly id: NightDropRunnerRouteId;
  readonly label: string;
  readonly durationMs: number;
  readonly difficulty: NightDropRunnerRouteProfile["difficulty"];
  readonly description: string;
  readonly segmentCount: number;
  readonly segmentLength: number;
  readonly turns: readonly number[];
  readonly verticality: number;
  readonly routeClass: string;
  readonly seed: number;
}): NightDropRunnerRouteProfile {
  const segments = Array.from({ length: values.segmentCount }, (_, index): SpatialRouteSegmentDefinition => {
    const last = index === values.segmentCount - 1;
    const cycle = index % 9;
    const kind: SpatialRouteSegmentKind = last ? "destination" : cycle === 2 ? "bend" : cycle === 3 ? "alley" : cycle === 4 ? "junction" : cycle === 5 ? "bridge" : cycle === 6 ? "ramp" : cycle === 7 ? "tunnel" : cycle === 8 ? "rooftop" : "street";
    const elevation = values.verticality === 0 ? 0 : index % 6 === 1 ? values.verticality : index % 6 === 4 ? -values.verticality * .4 : 0;
    const width = kind === "alley" ? 3.1 : kind === "tunnel" ? 3.5 : kind === "bridge" ? 4.1 : 4.8;
    return segment(`${values.id}-${String(index + 1).padStart(2, "0")}`, kind, values.segmentLength + (index % 3) * 3, values.turns[index % values.turns.length] ?? 0, elevation, width);
  });
  const indexAt = (progress: number): number => Math.min(segments.length - 1, Math.max(0, Math.floor(progress * segments.length)));
  const idAt = (progress: number): string => segments[indexAt(progress)]!.id;
  const branchSpans = values.segmentCount >= 24
    ? [[.14, .24], [.34, .44], [.55, .66], [.75, .86]] as const
    : values.segmentCount >= 16
      ? [[.18, .3], [.45, .58], [.68, .82]] as const
      : [[.25, .39], [.58, .73]] as const;
  const junctionPoints = branchSpans.map(([entry]) => entry);
  junctionPoints.forEach((progress) => {
    const index = indexAt(progress);
    const current = segments[index]!;
    segments[index] = { ...current, kind: "junction", turnDegrees: 0, width: Math.max(6.2, current.width ?? 4.8), metadata: { ...current.metadata, decisionPoint: true } };
  });
  const totalLength = segments.reduce((total, item) => total + item.length, 0);
  const travelStartMs = Math.min(1_750, Math.round(values.durationMs * .11));
  const travelDurationSeconds = Math.max(1, (values.durationMs - 3_050 - travelStartMs) / 1_000);
  const estimatedSpeed = totalLength / travelDurationSeconds;
  const junctionLeadDistance = Math.round(Math.max(38, Math.min(56, estimatedSpeed * 2.05)));
  const obstacleLeadDistance = Math.round(Math.max(42, Math.min(58, estimatedSpeed * 2.1)));
  const branches = branchSpans.map(([entry, rejoin], index) => {
    const junctionKind: Exclude<SpatialRouteJunctionKind, "fork"> = (values.seed + index) % 2 === 0 ? "crossroads" : "t-junction";
    const defaultAlternative = junctionKind === "crossroads" ? "straight" : (values.seed + index) % 3 === 0 ? "left" : "right";
    return branch(
      `${values.id}-${String(index + 1).padStart(2, "0")}-${junctionKind}`,
      idAt(entry),
      idAt(rejoin),
      junctionKind,
      defaultAlternative,
      junctionLeadDistance,
    );
  });
  const obstacleProgresses = values.segmentCount >= 24
    ? [.09, .2, .31, .43, .54, .65, .76, .86] as const
    : values.segmentCount >= 16
      ? [.11, .25, .39, .54, .69, .83] as const
      : [.13, .3, .47, .65, .82] as const;
  const obstacleKinds = ["traffic", "barrier", "low-sign", "gap", "route-blocker", "ramp"] as const;
  const obstacles = obstacleProgresses.map((progress, index) => {
    const kind = obstacleKinds[(values.seed + index) % obstacleKinds.length]!;
    const lane = kind === "traffic" || kind === "route-blocker" ? ((values.seed + index) % 3) - 1 : undefined;
    return obstacle(
      `${values.id}-obstacle-${String(index + 1).padStart(2, "0")}`,
      kind,
      idAt(progress),
      .34 + (index % 3) * .16,
      lane,
      obstacleLeadDistance,
    );
  });
  return {
    id: values.id,
    label: values.label,
    durationMs: values.durationMs,
    difficulty: values.difficulty,
    definition: {
      id: `night-drop.${values.id}`,
      name: values.label,
      description: values.description,
      start,
      segments,
      cues: [
        cue(`${values.id}-package-01`, "standard-pickup", idAt(.13), .42, -.34),
        cue(`${values.id}-package-02`, "standard-pickup", idAt(.25), .58, .32),
        cue(`${values.id}-package-premium`, "premium-pickup", idAt(.38), .62, -.08),
        cue(`${values.id}-continuation`, "continuation", idAt(.49), .48),
        cue(`${values.id}-shortcut`, "shortcut", idAt(.61), .45),
        cue(`${values.id}-checkpoint`, "checkpoint", idAt(.77), .55),
        cue(`${values.id}-destination`, "destination", segments.at(-1)!.id, .92),
      ],
      obstacles,
      branches,
      metadata: { gamePack: "night-drop", routeClass: values.routeClass, environmentSeed: values.seed, generatedGreybox: true },
    },
  };
}

export const NIGHT_DROP_RUNNER_ROUTES: readonly NightDropRunnerRouteProfile[] = profiles;
export const DEFAULT_NIGHT_DROP_RUNNER_ROUTE: NightDropRunnerRouteId = "glasshouse-loop";

export function getNightDropRunnerRoute(id: NightDropRunnerRouteId = DEFAULT_NIGHT_DROP_RUNNER_ROUTE): NightDropRunnerRouteProfile {
  const profile = profiles.find((route) => route.id === id);
  if (!profile) throw new Error(`Unknown Night Drop runner route ${id}`);
  return structuredClone(profile);
}

export function composeNightDropRunnerRoute(id: NightDropRunnerRouteId = DEFAULT_NIGHT_DROP_RUNNER_ROUTE): ComposedSpatialRoute {
  return composeSpatialRoute(getNightDropRunnerRoute(id).definition);
}

export function isNightDropRunnerRouteId(value: string | null): value is NightDropRunnerRouteId {
  return profiles.some(({ id }) => id === value);
}
