import type { ComposedSpatialRoute } from "./spatial-route-types.js";
import type { SpatialRouteWindow, SpatialRouteWindowOptions } from "./spatial-runner-types.js";

export function resolveSpatialRouteWindow(
  route: ComposedSpatialRoute,
  progress: number,
  options: SpatialRouteWindowOptions = {},
): SpatialRouteWindow {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const distance = route.totalLength * clampedProgress;
  const startDistance = Math.max(0, distance - (options.distanceBehind ?? 55));
  const endDistance = Math.min(route.totalLength, distance + (options.distanceAhead ?? 150));
  const activeSegments = route.segments.filter((segment) => segment.endDistance >= startDistance && segment.startDistance <= endDistance);
  const current = route.segments.find((segment) => segment.startDistance <= distance && segment.endDistance >= distance) ?? route.segments.at(-1)!;
  return {
    progress: clampedProgress,
    distance,
    startDistance,
    endDistance,
    currentSegmentId: current.id,
    activeSegmentIds: activeSegments.map(({ id }) => id),
    route: { definitionId: route.definitionId, deterministicSignature: route.deterministicSignature },
  };
}
