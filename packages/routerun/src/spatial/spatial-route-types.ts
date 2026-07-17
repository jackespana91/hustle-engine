import type { RouteRunMetadata } from "../board/board-types.js";

export type SpatialRouteSegmentKind =
  | "street"
  | "bend"
  | "junction"
  | "alley"
  | "tunnel"
  | "bridge"
  | "ramp"
  | "rooftop"
  | "destination";

export type SpatialRouteCueKind =
  | "standard-pickup"
  | "premium-pickup"
  | "continuation"
  | "shortcut"
  | "checkpoint"
  | "destination"
  | "custom";

export type SpatialRouteJunctionKind = "fork" | "t-junction" | "crossroads";
export type SpatialRouteBranchDirection = "left" | "straight" | "right";
export type SpatialRouteObstacleKind = "barrier" | "low-sign" | "gap" | "ramp" | "traffic" | "route-blocker";
export type SpatialRouteObstacleAction = "jump" | "slide" | "change-lane" | "none";

export interface SpatialPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpatialRouteStart {
  readonly position: SpatialPoint;
  /** Degrees clockwise from world north (-Z). */
  readonly headingDegrees: number;
}

export interface SpatialRouteSegmentDefinition {
  readonly id: string;
  readonly kind: SpatialRouteSegmentKind;
  /** Centre-line distance in presentation-world units. */
  readonly length: number;
  /** Signed clockwise heading change over the segment. */
  readonly turnDegrees?: number;
  /** Signed vertical change over the segment. */
  readonly elevation?: number;
  readonly width?: number;
  readonly sampleSpacing?: number;
  readonly metadata?: RouteRunMetadata;
}

export interface SpatialRouteCueDefinition {
  readonly id: string;
  readonly kind: SpatialRouteCueKind;
  readonly segmentId: string;
  /** Normalized position within the referenced segment. */
  readonly offset?: number;
  readonly laneOffset?: number;
  readonly metadata?: RouteRunMetadata;
}

export interface SpatialRouteObstacleDefinition {
  readonly id: string;
  readonly kind: SpatialRouteObstacleKind;
  readonly segmentId: string;
  /** Normalized position within the referenced segment. */
  readonly offset?: number;
  /** Logical runner lane blocked by the obstacle. Omit when it spans every lane. */
  readonly lane?: number;
  readonly requiredAction?: SpatialRouteObstacleAction;
  /** Distance before the obstacle at which presentation anticipation begins. */
  readonly reactionLeadDistance?: number;
  readonly metadata?: RouteRunMetadata;
}

export interface SpatialRouteAnchor {
  readonly segmentId: string;
  readonly offset?: number;
}

export interface SpatialRouteBranchAlternative {
  readonly id: string;
  /** Player-facing direction at the junction. */
  readonly direction?: SpatialRouteBranchDirection;
  /** Maximum signed lateral displacement from the composed centre line. */
  readonly lateralOffset: number;
  /** Maximum signed vertical displacement from the composed centre line. */
  readonly elevationOffset?: number;
  /** Maximum presentation heading change while taking the branch. */
  readonly headingOffsetDegrees?: number;
  /** End of the turn-away phase, expressed as local branch progress. */
  readonly divergeFraction?: number;
  /** Start of the turn-back phase, expressed as local branch progress. */
  readonly rejoinFraction?: number;
  readonly metadata?: RouteRunMetadata;
}

export interface SpatialRouteBranchDefinition {
  readonly id: string;
  readonly junctionKind?: SpatialRouteJunctionKind;
  readonly entry: SpatialRouteAnchor;
  readonly rejoin: SpatialRouteAnchor;
  /** World-space distance before entry at which the player may choose. */
  readonly decisionLeadDistance?: number;
  /** World-space distance after entry for late input tolerance. */
  readonly decisionTailDistance?: number;
  readonly defaultAlternativeId: string;
  readonly alternatives: readonly SpatialRouteBranchAlternative[];
  readonly metadata?: RouteRunMetadata;
}

export interface SpatialRouteDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly start: SpatialRouteStart;
  readonly segments: readonly SpatialRouteSegmentDefinition[];
  readonly cues?: readonly SpatialRouteCueDefinition[];
  readonly obstacles?: readonly SpatialRouteObstacleDefinition[];
  readonly branches?: readonly SpatialRouteBranchDefinition[];
  readonly metadata?: RouteRunMetadata;
}

export interface SpatialRouteSample {
  readonly index: number;
  readonly segmentId: string | null;
  readonly segmentProgress: number;
  readonly position: SpatialPoint;
  readonly headingDegrees: number;
  readonly distance: number;
  readonly progress: number;
}

export interface ComposedSpatialRouteSegment {
  readonly id: string;
  readonly kind: SpatialRouteSegmentKind;
  readonly startDistance: number;
  readonly endDistance: number;
  readonly startSampleIndex: number;
  readonly endSampleIndex: number;
  readonly startPosition: SpatialPoint;
  readonly endPosition: SpatialPoint;
  readonly startHeadingDegrees: number;
  readonly endHeadingDegrees: number;
  readonly elevation: number;
  readonly width: number;
  readonly metadata: RouteRunMetadata;
}

export interface ResolvedSpatialRouteCue {
  readonly id: string;
  readonly kind: SpatialRouteCueKind;
  readonly segmentId: string;
  readonly segmentProgress: number;
  readonly laneOffset: number;
  readonly distance: number;
  readonly progress: number;
  readonly position: SpatialPoint;
  readonly headingDegrees: number;
  readonly metadata: RouteRunMetadata;
}

export interface ResolvedSpatialRouteObstacle {
  readonly id: string;
  readonly kind: SpatialRouteObstacleKind;
  readonly segmentId: string;
  readonly segmentProgress: number;
  readonly lane: number | null;
  readonly requiredAction: SpatialRouteObstacleAction;
  readonly reactionLeadDistance: number;
  readonly reactionOpensDistance: number;
  readonly reactionOpensProgress: number;
  readonly distance: number;
  readonly progress: number;
  readonly position: SpatialPoint;
  readonly headingDegrees: number;
  readonly metadata: RouteRunMetadata;
}

export interface ComposedSpatialRouteBranchAlternative {
  readonly id: string;
  readonly direction: SpatialRouteBranchDirection;
  readonly lateralOffset: number;
  readonly elevationOffset: number;
  readonly headingOffsetDegrees: number;
  readonly divergeFraction: number;
  readonly rejoinFraction: number;
  readonly metadata: RouteRunMetadata;
}

export interface ComposedSpatialRouteBranch {
  readonly id: string;
  readonly junctionKind: SpatialRouteJunctionKind;
  readonly entryDistance: number;
  readonly rejoinDistance: number;
  readonly decisionOpensDistance: number;
  readonly decisionClosesDistance: number;
  readonly entryProgress: number;
  readonly rejoinProgress: number;
  readonly decisionOpensProgress: number;
  readonly decisionClosesProgress: number;
  readonly defaultAlternativeId: string;
  readonly alternatives: readonly ComposedSpatialRouteBranchAlternative[];
  readonly metadata: RouteRunMetadata;
}

export interface ComposedSpatialRoute {
  readonly definitionId: string;
  readonly name: string;
  readonly description: string;
  readonly totalLength: number;
  readonly elevationGain: number;
  readonly elevationLoss: number;
  readonly samples: readonly SpatialRouteSample[];
  readonly segments: readonly ComposedSpatialRouteSegment[];
  readonly cues: readonly ResolvedSpatialRouteCue[];
  readonly obstacles: readonly ResolvedSpatialRouteObstacle[];
  readonly branches: readonly ComposedSpatialRouteBranch[];
  readonly deterministicSignature: string;
  readonly metadata: RouteRunMetadata;
}

export interface SpatialRouteValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface SpatialRouteValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SpatialRouteValidationIssue[];
  readonly warnings: readonly SpatialRouteValidationIssue[];
}
