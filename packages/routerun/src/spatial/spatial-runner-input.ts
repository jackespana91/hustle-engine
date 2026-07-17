import type { SpatialRunnerCommandType } from "./spatial-runner-types.js";

export type SpatialRunnerSwipeDirection = "left" | "right" | "up" | "down";

export interface SpatialRunnerPointerSample {
  readonly x: number;
  readonly y: number;
  readonly atMs: number;
}

export interface SpatialRunnerSwipeOptions {
  readonly minimumDistance?: number;
  readonly maximumDurationMs?: number;
  readonly dominanceRatio?: number;
}

export interface SpatialRunnerSwipe {
  readonly direction: SpatialRunnerSwipeDirection;
  readonly commandType: Exclude<SpatialRunnerCommandType, "choose-branch" | "lane-left" | "lane-right">;
  readonly distance: number;
  readonly durationMs: number;
  readonly velocity: number;
}

const COMMAND_BY_DIRECTION = {
  left: "dodge-left",
  right: "dodge-right",
  up: "jump",
  down: "slide",
} as const;

/**
 * Converts two pointer samples into a deterministic runner gesture. It owns no
 * DOM state and never changes a route or outcome; renderers decide when to turn
 * the returned presentation command into an input record.
 */
export function interpretSpatialRunnerSwipe(
  start: SpatialRunnerPointerSample,
  end: SpatialRunnerPointerSample,
  options: SpatialRunnerSwipeOptions = {},
): SpatialRunnerSwipe | null {
  const minimumDistance = options.minimumDistance ?? 34;
  const maximumDurationMs = options.maximumDurationMs ?? 650;
  const dominanceRatio = options.dominanceRatio ?? 1.12;
  if (!isFiniteSample(start) || !isFiniteSample(end)) return null;
  if (!Number.isFinite(minimumDistance) || minimumDistance <= 0) return null;
  if (!Number.isFinite(maximumDurationMs) || maximumDurationMs <= 0) return null;
  if (!Number.isFinite(dominanceRatio) || dominanceRatio < 1) return null;

  const durationMs = end.atMs - start.atMs;
  if (durationMs <= 0 || durationMs > maximumDurationMs) return null;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < minimumDistance) return null;

  const horizontal = absoluteX >= absoluteY * dominanceRatio;
  const vertical = absoluteY >= absoluteX * dominanceRatio;
  if (!horizontal && !vertical) return null;
  const direction: SpatialRunnerSwipeDirection = horizontal
    ? deltaX < 0 ? "left" : "right"
    : deltaY < 0 ? "up" : "down";
  return {
    direction,
    commandType: COMMAND_BY_DIRECTION[direction],
    distance,
    durationMs,
    velocity: distance / durationMs,
  };
}

function isFiniteSample(sample: SpatialRunnerPointerSample): boolean {
  return Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.atMs);
}
