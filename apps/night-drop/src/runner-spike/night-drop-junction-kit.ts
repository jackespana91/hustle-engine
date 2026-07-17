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
  readonly path: THREE.CatmullRomCurve3;
}

export interface NightDropBranchStreetPose {
  readonly branchId: string;
  readonly alternativeId: string;
  readonly direction: ComposedSpatialRouteBranchAlternative["direction"];
  readonly point: THREE.Vector3;
  readonly tangent: THREE.Vector3;
}

export const NIGHT_DROP_BRANCH_STREET_HALF_WIDTH = 3.55;
export const NIGHT_DROP_JUNCTION_CENTRE_ADVANCE = 3.8;

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
): THREE.CatmullRomCurve3 {
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
  const streetOffset = Math.max(26, Math.abs(alternative.lateralOffset) * 2.2);
  const entryForward = NIGHT_DROP_JUNCTION_CENTRE_ADVANCE;
  const rejoinBack = NIGHT_DROP_JUNCTION_CENTRE_ADVANCE;
  const quarterProgress = globalProgress(branch, .27);
  const quarter = mainPath.getPointAt(quarterProgress);
  const quarterSide = sideOf(mainPath.getTangentAt(quarterProgress).normalize());
  const middleProgress = globalProgress(branch, .5);
  const middle = mainPath.getPointAt(middleProgress);
  const middleSide = sideOf(mainPath.getTangentAt(middleProgress).normalize());
  const threeQuarterProgress = globalProgress(branch, .73);
  const threeQuarter = mainPath.getPointAt(threeQuarterProgress);
  const threeQuarterSide = sideOf(mainPath.getTangentAt(threeQuarterProgress).normalize());

  const points = [
    entry,
    entry.clone().addScaledVector(entryTangent, entryForward * .52),
    entry.clone().addScaledVector(entryTangent, entryForward).addScaledVector(entrySide, direction * 3.5),
    entry.clone().addScaledVector(entryTangent, entryForward).addScaledVector(entrySide, direction * 10),
    entry.clone().addScaledVector(entryTangent, entryForward).addScaledVector(entrySide, direction * streetOffset),
    quarter.clone().addScaledVector(quarterSide, direction * streetOffset),
    middle.clone().addScaledVector(middleSide, direction * streetOffset),
    threeQuarter.clone().addScaledVector(threeQuarterSide, direction * streetOffset),
    rejoin.clone().addScaledVector(rejoinTangent, -rejoinBack).addScaledVector(rejoinSide, direction * streetOffset),
    rejoin.clone().addScaledVector(rejoinTangent, -rejoinBack).addScaledVector(rejoinSide, direction * 10),
    rejoin.clone().addScaledVector(rejoinTangent, -rejoinBack).addScaledVector(rejoinSide, direction * 3.5),
    rejoin.clone().addScaledVector(rejoinTangent, -rejoinBack * .52),
    rejoin,
  ];
  return new THREE.CatmullRomCurve3(points, false, "centripetal", .22);
}

function globalProgress(branch: ComposedSpatialRouteBranch, localProgress: number): number {
  return branch.entryProgress + (branch.rejoinProgress - branch.entryProgress) * localProgress;
}

function sideOf(tangent: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
}
