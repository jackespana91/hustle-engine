import * as THREE from "three";
import type {
  ComposedSpatialRoute,
  ComposedSpatialRouteBranch,
  ComposedSpatialRouteBranchAlternative,
} from "@hustle/routerun";

export interface NightDropBranchStreet {
  readonly branchId: string;
  readonly alternativeId: string;
  readonly direction: ComposedSpatialRouteBranchAlternative["direction"];
  readonly entryProgress: number;
  readonly rejoinProgress: number;
  readonly path: THREE.Curve<THREE.Vector3>;
}

export interface NightDropBranchStreetPose {
  readonly branchId: string;
  readonly alternativeId: string;
  readonly direction: ComposedSpatialRouteBranchAlternative["direction"];
  readonly point: THREE.Vector3;
  readonly tangent: THREE.Vector3;
}

export const NIGHT_DROP_BRANCH_STREET_HALF_WIDTH = 3.55;
export const NIGHT_DROP_JUNCTION_CENTRE_ADVANCE = 10;

export function createNightDropBranchStreets(
  mainPath: THREE.CatmullRomCurve3,
  route: ComposedSpatialRoute,
): readonly NightDropBranchStreet[] {
  return route.branches.flatMap((branch) => branch.alternatives.map((alternative) => ({
    branchId: branch.id,
    alternativeId: alternative.id,
    direction: alternative.direction,
    entryProgress: branch.entryProgress,
    rejoinProgress: branch.rejoinProgress,
    path: createAlternativePath(mainPath, branch, alternative),
  })));
}

export function resolveNightDropBranchStreetPose(
  streets: readonly NightDropBranchStreet[],
  route: ComposedSpatialRoute,
  selections: Readonly<Record<string, string>>,
  progress: number,
): NightDropBranchStreetPose | null {
  const branch = route.branches.find((candidate) => progress >= candidate.entryProgress && progress <= candidate.rejoinProgress);
  if (!branch) return null;
  const alternativeId = selections[branch.id] ?? branch.defaultAlternativeId;
  const street = streets.find((candidate) => candidate.branchId === branch.id && candidate.alternativeId === alternativeId);
  if (!street) return null;
  const localProgress = Math.max(0, Math.min(1,
    (progress - street.entryProgress) / Math.max(Number.EPSILON, street.rejoinProgress - street.entryProgress),
  ));
  return {
    branchId: street.branchId,
    alternativeId: street.alternativeId,
    direction: street.direction,
    point: street.path.getPointAt(localProgress),
    tangent: street.path.getTangentAt(localProgress).normalize(),
  };
}

function createAlternativePath(
  mainPath: THREE.CatmullRomCurve3,
  branch: ComposedSpatialRouteBranch,
  alternative: ComposedSpatialRouteBranchAlternative,
): THREE.Curve<THREE.Vector3> {
  if (alternative.direction === "straight") {
    return new THREE.CatmullRomCurve3(
      [0, .25, .5, .75, 1].map((localProgress) => mainPath.getPointAt(globalProgress(branch, localProgress))),
      false,
      "centripetal",
      .24,
    );
  }

  const direction = alternative.direction === "left" ? -1 : 1;
  const entry = mainPath.getPointAt(branch.entryProgress);
  const entryTangent = mainPath.getTangentAt(branch.entryProgress).normalize();
  const entrySide = sideOf(entryTangent);
  const rejoin = mainPath.getPointAt(branch.rejoinProgress);
  const rejoinTangent = mainPath.getTangentAt(branch.rejoinProgress).normalize();
  const rejoinSide = sideOf(rejoinTangent);
  const outward = entrySide.clone().multiplyScalar(direction).normalize();
  const rejoinOutward = rejoinSide.dot(outward) < 0 ? rejoinSide.clone().multiplyScalar(-1) : rejoinSide;
  const branchSpan = branch.rejoinDistance - branch.entryDistance;
  const streetOffset = Math.max(18, Math.min(26, branchSpan * .24));
  const entryForward = NIGHT_DROP_JUNCTION_CENTRE_ADVANCE;
  const rejoinBack = NIGHT_DROP_JUNCTION_CENTRE_ADVANCE;
  const outerEntry = entry.clone()
    .addScaledVector(entryTangent, entryForward)
    .addScaledVector(entrySide, direction * streetOffset);
  const outerRejoin = rejoin.clone()
    .addScaledVector(rejoinTangent, -rejoinBack)
    .addScaledVector(rejoinOutward, streetOffset);
  const mainSamples = Array.from({ length: 13 }, (_, index) => mainPath.getPointAt(globalProgress(branch, index / 12)));
  const mainCentre = mainSamples.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / mainSamples.length);
  const safeProjection = Math.max(...mainSamples.map((point) => point.clone().sub(mainCentre).dot(outward))) + streetOffset;
  const pushOutsideMainRoute = (point: THREE.Vector3): THREE.Vector3 => {
    const projection = point.clone().sub(mainCentre).dot(outward);
    return point.clone().addScaledVector(outward, Math.max(0, safeProjection - projection));
  };
  const connectorOne = pushOutsideMainRoute(outerEntry.clone().lerp(outerRejoin, .3));
  const connectorTwo = pushOutsideMainRoute(outerEntry.clone().lerp(outerRejoin, .7));

  return createRoundedStreetPath([
    entry,
    entry.clone().addScaledVector(entryTangent, entryForward),
    outerEntry,
    connectorOne,
    connectorTwo,
    outerRejoin,
    rejoin.clone().addScaledVector(rejoinTangent, -rejoinBack),
    rejoin,
  ]);
}

function createRoundedStreetPath(points: readonly THREE.Vector3[]): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cursor = points[0]!.clone();
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const incoming = corner.clone().sub(previous);
    const outgoing = next.clone().sub(corner);
    const incomingLength = incoming.length();
    const outgoingLength = outgoing.length();
    if (incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) continue;
    const radius = Math.min(11, incomingLength * .48, outgoingLength * .48);
    const before = corner.clone().addScaledVector(incoming.normalize(), -radius);
    const after = corner.clone().addScaledVector(outgoing.normalize(), radius);
    if (cursor.distanceToSquared(before) > .0001) path.add(new THREE.LineCurve3(cursor, before));
    path.add(new THREE.QuadraticBezierCurve3(before, corner.clone(), after));
    cursor = after;
  }
  const end = points.at(-1)!;
  if (cursor.distanceToSquared(end) > .0001) path.add(new THREE.LineCurve3(cursor, end.clone()));
  return path;
}

function globalProgress(branch: ComposedSpatialRouteBranch, localProgress: number): number {
  return branch.entryProgress + (branch.rejoinProgress - branch.entryProgress) * localProgress;
}

function sideOf(tangent: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
}
