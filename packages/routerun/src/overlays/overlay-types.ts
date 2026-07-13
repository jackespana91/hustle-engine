import type { Coordinate, RouteRunMetadata } from "../board/board-types.js";

export type OverlayType =
  | "standard-reward"
  | "premium-reward"
  | "instant-value"
  | "progress"
  | "feature-trigger"
  | "key"
  | "modifier"
  | "custom";

export interface RouteOverlay {
  readonly id: string;
  readonly type: OverlayType;
  readonly valueMinor?: number;
  readonly multiplierScaled?: number;
  readonly collectable: boolean;
  readonly persistent: boolean;
  readonly removeOnCollect: boolean;
  readonly featureId?: string;
  readonly metadata: RouteRunMetadata;
}

export interface OverlayCollection {
  readonly sequence: number;
  readonly overlayId: string;
  readonly type: OverlayType;
  readonly coordinate: Coordinate;
  readonly routeStepSequence: number;
  readonly valueMinor: number;
  readonly multiplierScaled: number;
  readonly removed: boolean;
  readonly logicalTick: number;
}

export interface OverlayCollectionResult {
  readonly collections: readonly OverlayCollection[];
  readonly collectedOverlayIds: readonly string[];
  readonly accumulatedValueMinor: number;
}
