import { SpatialRouteError } from "./spatial-route-errors.js";
import type {
  ComposedSpatialRoute,
  ComposedSpatialRouteBranch,
  ComposedSpatialRouteSegment,
  ResolvedSpatialRouteCue,
  ResolvedSpatialRouteObstacle,
  SpatialPoint,
  SpatialRouteDefinition,
  SpatialRouteSample,
} from "./spatial-route-types.js";
import { validateSpatialRouteDefinition } from "./spatial-route-validator.js";

interface DraftSample extends Omit<SpatialRouteSample, "index" | "progress"> {}

const DEFAULT_SAMPLE_SPACING = 4;
const DEFAULT_ROUTE_WIDTH = 4.8;
const DEFAULT_BRANCH_DIVERGE_FRACTION = .22;
const DEFAULT_BRANCH_REJOIN_FRACTION = .72;

export function composeSpatialRoute(definition: SpatialRouteDefinition): ComposedSpatialRoute {
  const validation = validateSpatialRouteDefinition(definition);
  if (!validation.valid) {
    throw new SpatialRouteError("INVALID_DEFINITION", validation.errors.map(({ path, message }) => `${path}: ${message}`).join("; "));
  }

  const draftSamples: DraftSample[] = [{
    segmentId: null,
    segmentProgress: 0,
    position: clonePoint(definition.start.position),
    headingDegrees: normalizeDegrees(definition.start.headingDegrees),
    distance: 0,
  }];
  const segments: ComposedSpatialRouteSegment[] = [];
  let position = clonePoint(definition.start.position);
  let headingDegrees = normalizeDegrees(definition.start.headingDegrees);
  let distance = 0;
  let elevationGain = 0;
  let elevationLoss = 0;

  for (const segment of definition.segments) {
    const startDistance = distance;
    const startPosition = clonePoint(position);
    const startHeadingDegrees = headingDegrees;
    const startSampleIndex = draftSamples.length - 1;
    const elevation = segment.elevation ?? 0;
    const turnDegrees = segment.turnDegrees ?? 0;
    const sampleCount = Math.max(1, Math.ceil(segment.length / (segment.sampleSpacing ?? DEFAULT_SAMPLE_SPACING)));
    const stepLength = segment.length / sampleCount;
    const segmentStartY = position.y;

    for (let step = 1; step <= sampleCount; step += 1) {
      const previousProgress = (step - 1) / sampleCount;
      const segmentProgress = step / sampleCount;
      const midpointHeading = headingDegrees + turnDegrees * ((previousProgress + segmentProgress) / 2);
      const radians = degreesToRadians(midpointHeading);
      position = {
        x: position.x + Math.sin(radians) * stepLength,
        y: segmentStartY + elevation * segmentProgress,
        z: position.z - Math.cos(radians) * stepLength,
      };
      distance = startDistance + segment.length * segmentProgress;
      draftSamples.push({
        segmentId: segment.id,
        segmentProgress,
        position: clonePoint(position),
        headingDegrees: normalizeDegrees(headingDegrees + turnDegrees * segmentProgress),
        distance,
      });
    }

    headingDegrees = normalizeDegrees(headingDegrees + turnDegrees);
    if (elevation > 0) elevationGain += elevation;
    else elevationLoss += Math.abs(elevation);
    segments.push({
      id: segment.id,
      kind: segment.kind,
      startDistance,
      endDistance: distance,
      startSampleIndex,
      endSampleIndex: draftSamples.length - 1,
      startPosition,
      endPosition: clonePoint(position),
      startHeadingDegrees,
      endHeadingDegrees: headingDegrees,
      elevation,
      width: segment.width ?? DEFAULT_ROUTE_WIDTH,
      metadata: structuredClone(segment.metadata ?? {}),
    });
  }

  const samples: SpatialRouteSample[] = draftSamples.map((sample, index) => ({
    ...sample,
    index,
    progress: distance === 0 ? 0 : sample.distance / distance,
  }));
  const cues = resolveCues(definition, segments, samples, distance);
  const obstacles = resolveObstacles(definition, segments, samples, distance);
  const branches = resolveBranches(definition, segments, distance);
  const deterministicSignature = createSignature(definition, segments, cues, obstacles, branches);
  return {
    definitionId: definition.id,
    name: definition.name,
    description: definition.description,
    totalLength: distance,
    elevationGain,
    elevationLoss,
    samples,
    segments,
    cues,
    obstacles,
    branches,
    deterministicSignature,
    metadata: structuredClone(definition.metadata ?? {}),
  };
}

export function resolveSpatialBranchDisplacement(
  route: ComposedSpatialRoute,
  selections: Readonly<Record<string, string>>,
  progress: number,
): {
  readonly lateralOffset: number;
  readonly elevationOffset: number;
  readonly headingOffsetDegrees: number;
  readonly activeBranchId: string | null;
  readonly alternativeId: string | null;
} {
  for (const branch of route.branches) {
    if (progress < branch.entryProgress || progress > branch.rejoinProgress) continue;
    const alternativeId = selections[branch.id] ?? branch.defaultAlternativeId;
    const alternative = branch.alternatives.find(({ id }) => id === alternativeId) ?? branch.alternatives.find(({ id }) => id === branch.defaultAlternativeId)!;
    const localProgress = (progress - branch.entryProgress) / Math.max(Number.EPSILON, branch.rejoinProgress - branch.entryProgress);
    const clampedProgress = Math.max(0, Math.min(1, localProgress));
    const envelope = resolveBranchOffsetEnvelope(clampedProgress, alternative.divergeFraction, alternative.rejoinFraction);
    const turnEnvelope = resolveBranchHeadingEnvelope(clampedProgress, alternative.divergeFraction, alternative.rejoinFraction);
    return {
      lateralOffset: alternative.lateralOffset * envelope,
      elevationOffset: alternative.elevationOffset * envelope,
      headingOffsetDegrees: alternative.headingOffsetDegrees * turnEnvelope,
      activeBranchId: branch.id,
      alternativeId: alternative.id,
    };
  }
  return { lateralOffset: 0, elevationOffset: 0, headingOffsetDegrees: 0, activeBranchId: null, alternativeId: null };
}

export function resolveSpatialJunctionDecision(route: ComposedSpatialRoute, progress: number): ComposedSpatialRouteBranch | null {
  return route.branches.find((branch) => progress >= branch.decisionOpensProgress && progress <= branch.decisionClosesProgress) ?? null;
}

function resolveCues(
  definition: SpatialRouteDefinition,
  segments: readonly ComposedSpatialRouteSegment[],
  samples: readonly SpatialRouteSample[],
  totalLength: number,
): ResolvedSpatialRouteCue[] {
  return (definition.cues ?? []).map((cue) => {
    const segment = segments.find(({ id }) => id === cue.segmentId);
    if (!segment) throw new SpatialRouteError("INVALID_CUE", `Cue ${cue.id} references missing segment ${cue.segmentId}`);
    const segmentProgress = cue.offset ?? .5;
    const distance = segment.startDistance + (segment.endDistance - segment.startDistance) * segmentProgress;
    const sample = interpolateSample(samples, distance);
    return {
      id: cue.id,
      kind: cue.kind,
      segmentId: cue.segmentId,
      segmentProgress,
      laneOffset: cue.laneOffset ?? 0,
      distance,
      progress: totalLength === 0 ? 0 : distance / totalLength,
      position: sample.position,
      headingDegrees: sample.headingDegrees,
      metadata: structuredClone(cue.metadata ?? {}),
    };
  }).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
}

function resolveBranches(
  definition: SpatialRouteDefinition,
  segments: readonly ComposedSpatialRouteSegment[],
  totalLength: number,
): ComposedSpatialRouteBranch[] {
  const anchorDistance = (segmentId: string, offset: number): number => {
    const segment = segments.find(({ id }) => id === segmentId);
    if (!segment) throw new SpatialRouteError("INVALID_SEGMENT", `Branch references missing segment ${segmentId}`);
    return segment.startDistance + (segment.endDistance - segment.startDistance) * offset;
  };
  return (definition.branches ?? []).map((branch) => {
    const entryDistance = anchorDistance(branch.entry.segmentId, branch.entry.offset ?? 0);
    const rejoinDistance = anchorDistance(branch.rejoin.segmentId, branch.rejoin.offset ?? 1);
    if (rejoinDistance <= entryDistance) throw new SpatialRouteError("INVALID_DEFINITION", `Branch ${branch.id} must rejoin after its entry`);
    const decisionOpensDistance = Math.max(0, entryDistance - (branch.decisionLeadDistance ?? 24));
    const decisionClosesDistance = Math.min(rejoinDistance, entryDistance + (branch.decisionTailDistance ?? 8));
    const junctionKind = branch.junctionKind ?? "fork";
    return {
      id: branch.id,
      junctionKind,
      entryDistance,
      rejoinDistance,
      decisionOpensDistance,
      decisionClosesDistance,
      entryProgress: entryDistance / totalLength,
      rejoinProgress: rejoinDistance / totalLength,
      decisionOpensProgress: decisionOpensDistance / totalLength,
      decisionClosesProgress: decisionClosesDistance / totalLength,
      defaultAlternativeId: branch.defaultAlternativeId,
      alternatives: branch.alternatives.map((alternative) => ({
        id: alternative.id,
        direction: alternative.direction ?? directionFromOffset(alternative.lateralOffset),
        lateralOffset: alternative.lateralOffset,
        elevationOffset: alternative.elevationOffset ?? 0,
        headingOffsetDegrees: alternative.headingOffsetDegrees ?? defaultHeadingOffset(junctionKind, alternative.lateralOffset),
        divergeFraction: alternative.divergeFraction ?? DEFAULT_BRANCH_DIVERGE_FRACTION,
        rejoinFraction: alternative.rejoinFraction ?? DEFAULT_BRANCH_REJOIN_FRACTION,
        metadata: structuredClone(alternative.metadata ?? {}),
      })),
      metadata: structuredClone(branch.metadata ?? {}),
    };
  }).sort((left, right) => left.entryDistance - right.entryDistance || left.id.localeCompare(right.id));
}

function resolveObstacles(
  definition: SpatialRouteDefinition,
  segments: readonly ComposedSpatialRouteSegment[],
  samples: readonly SpatialRouteSample[],
  totalLength: number,
): ResolvedSpatialRouteObstacle[] {
  return (definition.obstacles ?? []).map((obstacle) => {
    const segment = segments.find(({ id }) => id === obstacle.segmentId);
    if (!segment) throw new SpatialRouteError("INVALID_SEGMENT", `Obstacle ${obstacle.id} references missing segment ${obstacle.segmentId}`);
    const segmentProgress = obstacle.offset ?? .5;
    const distance = segment.startDistance + (segment.endDistance - segment.startDistance) * segmentProgress;
    const reactionLeadDistance = obstacle.reactionLeadDistance ?? 42;
    const reactionOpensDistance = Math.max(0, distance - reactionLeadDistance);
    const sample = interpolateSample(samples, distance);
    return {
      id: obstacle.id,
      kind: obstacle.kind,
      segmentId: obstacle.segmentId,
      segmentProgress,
      lane: obstacle.lane ?? null,
      requiredAction: obstacle.requiredAction ?? defaultObstacleAction(obstacle.kind),
      reactionLeadDistance,
      reactionOpensDistance,
      reactionOpensProgress: reactionOpensDistance / totalLength,
      distance,
      progress: distance / totalLength,
      position: sample.position,
      headingDegrees: sample.headingDegrees,
      metadata: structuredClone(obstacle.metadata ?? {}),
    };
  }).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
}

function interpolateSample(samples: readonly SpatialRouteSample[], distance: number): Pick<SpatialRouteSample, "position" | "headingDegrees"> {
  const nextIndex = samples.findIndex((sample) => sample.distance >= distance);
  if (nextIndex <= 0) return { position: clonePoint(samples[0]!.position), headingDegrees: samples[0]!.headingDegrees };
  if (nextIndex < 0) {
    const last = samples.at(-1)!;
    return { position: clonePoint(last.position), headingDegrees: last.headingDegrees };
  }
  const previous = samples[nextIndex - 1]!;
  const next = samples[nextIndex]!;
  const progress = (distance - previous.distance) / Math.max(Number.EPSILON, next.distance - previous.distance);
  return {
    position: {
      x: lerp(previous.position.x, next.position.x, progress),
      y: lerp(previous.position.y, next.position.y, progress),
      z: lerp(previous.position.z, next.position.z, progress),
    },
    headingDegrees: normalizeDegrees(previous.headingDegrees + shortestAngle(previous.headingDegrees, next.headingDegrees) * progress),
  };
}

function createSignature(
  definition: SpatialRouteDefinition,
  segments: readonly ComposedSpatialRouteSegment[],
  cues: readonly ResolvedSpatialRouteCue[],
  obstacles: readonly ResolvedSpatialRouteObstacle[],
  branches: readonly ComposedSpatialRouteBranch[],
): string {
  return JSON.stringify({
    id: definition.id,
    start: [definition.start.position.x, definition.start.position.y, definition.start.position.z, normalizeDegrees(definition.start.headingDegrees)],
    segments: segments.map((segment) => [segment.id, segment.kind, segment.startDistance, segment.endDistance, segment.endHeadingDegrees, segment.elevation, segment.width]),
    cues: cues.map((cue) => [cue.id, cue.kind, cue.segmentId, cue.segmentProgress, cue.laneOffset, cue.distance]),
    obstacles: obstacles.map((obstacle) => [
      obstacle.id,
      obstacle.kind,
      obstacle.segmentId,
      obstacle.segmentProgress,
      obstacle.lane,
      obstacle.requiredAction,
      obstacle.reactionLeadDistance,
      obstacle.distance,
    ]),
    branches: branches.map((branch) => [
      branch.id,
      branch.junctionKind,
      branch.entryDistance,
      branch.rejoinDistance,
      branch.decisionOpensDistance,
      branch.decisionClosesDistance,
      branch.defaultAlternativeId,
      branch.alternatives.map((alternative) => [
        alternative.id,
        alternative.direction,
        alternative.lateralOffset,
        alternative.elevationOffset,
        alternative.headingOffsetDegrees,
        alternative.divergeFraction,
        alternative.rejoinFraction,
      ]),
    ]),
  });
}

function defaultObstacleAction(kind: ResolvedSpatialRouteObstacle["kind"]): ResolvedSpatialRouteObstacle["requiredAction"] {
  if (kind === "barrier" || kind === "gap") return "jump";
  if (kind === "low-sign") return "slide";
  if (kind === "traffic" || kind === "route-blocker") return "change-lane";
  return "none";
}

function directionFromOffset(lateralOffset: number): "left" | "straight" | "right" {
  if (lateralOffset < 0) return "left";
  if (lateralOffset > 0) return "right";
  return "straight";
}

function defaultHeadingOffset(junctionKind: ComposedSpatialRouteBranch["junctionKind"], lateralOffset: number): number {
  if (junctionKind === "fork" || lateralOffset === 0) return 0;
  return lateralOffset < 0 ? -72 : 72;
}

function resolveBranchOffsetEnvelope(progress: number, divergeFraction: number, rejoinFraction: number): number {
  if (progress <= divergeFraction) {
    return Math.sin((progress / divergeFraction) * Math.PI / 2);
  }
  if (progress < rejoinFraction) return 1;
  return Math.cos(((progress - rejoinFraction) / (1 - rejoinFraction)) * Math.PI / 2);
}

function resolveBranchHeadingEnvelope(progress: number, divergeFraction: number, rejoinFraction: number): number {
  if (progress < divergeFraction) {
    return Math.sin(Math.PI * (progress / divergeFraction));
  }
  if (progress <= rejoinFraction) return 0;
  return -Math.sin(Math.PI * ((progress - rejoinFraction) / (1 - rejoinFraction)));
}

function clonePoint(point: SpatialPoint): SpatialPoint {
  return { x: point.x, y: point.y, z: point.z };
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function shortestAngle(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}
