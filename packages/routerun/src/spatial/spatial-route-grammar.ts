import type { RouteRunMetadata } from "../board/board-types.js";
import type { SpatialRouteSegmentDefinition } from "./spatial-route-types.js";

export type SpatialRoadPieceKind =
  | "straight"
  | "corner-left"
  | "corner-right"
  | "t-junction"
  | "crossroads"
  | "alley"
  | "bridge"
  | "ramp-up"
  | "ramp-down"
  | "tunnel"
  | "rooftop"
  | "dead-end"
  | "destination";

export interface SpatialRoadPieceDefinition {
  readonly id: string;
  readonly piece: SpatialRoadPieceKind;
  readonly length?: number;
  readonly width?: number;
  readonly turnDegrees?: number;
  readonly elevation?: number;
  readonly sampleSpacing?: number;
  readonly metadata?: RouteRunMetadata;
}

const DEFAULTS: Readonly<Record<SpatialRoadPieceKind, Omit<SpatialRouteSegmentDefinition, "id">>> = {
  straight: { kind: "street", length: 36, width: 4.8 },
  "corner-left": { kind: "bend", length: 24, width: 4.8, turnDegrees: -90 },
  "corner-right": { kind: "bend", length: 24, width: 4.8, turnDegrees: 90 },
  "t-junction": { kind: "junction", length: 26, width: 6.4 },
  crossroads: { kind: "junction", length: 28, width: 6.8 },
  alley: { kind: "alley", length: 30, width: 3.2 },
  bridge: { kind: "bridge", length: 42, width: 4.2 },
  "ramp-up": { kind: "ramp", length: 34, width: 4.6, elevation: 5 },
  "ramp-down": { kind: "ramp", length: 34, width: 4.6, elevation: -5 },
  tunnel: { kind: "tunnel", length: 38, width: 3.8 },
  rooftop: { kind: "rooftop", length: 36, width: 4.2 },
  "dead-end": { kind: "street", length: 18, width: 4.8 },
  destination: { kind: "destination", length: 24, width: 5.4 },
};

/** Builds renderer-neutral spatial segments from the reusable road-piece vocabulary. */
export function createSpatialRoadPiece(definition: SpatialRoadPieceDefinition): SpatialRouteSegmentDefinition {
  const defaults = DEFAULTS[definition.piece];
  return {
    id: definition.id,
    kind: defaults.kind,
    length: definition.length ?? defaults.length,
    ...(definition.width ?? defaults.width) !== undefined ? { width: definition.width ?? defaults.width } : {},
    ...(definition.turnDegrees ?? defaults.turnDegrees) !== undefined ? { turnDegrees: definition.turnDegrees ?? defaults.turnDegrees } : {},
    ...(definition.elevation ?? defaults.elevation) !== undefined ? { elevation: definition.elevation ?? defaults.elevation } : {},
    ...(definition.sampleSpacing !== undefined ? { sampleSpacing: definition.sampleSpacing } : {}),
    metadata: {
      ...structuredClone(definition.metadata ?? {}),
      roadPiece: definition.piece,
    },
  };
}

/** Expands a deterministic ordered road-piece sequence into route segments. */
export function createSpatialRoadSequence(
  prefix: string,
  pieces: readonly Omit<SpatialRoadPieceDefinition, "id">[],
): readonly SpatialRouteSegmentDefinition[] {
  return pieces.map((piece, index) => createSpatialRoadPiece({
    ...piece,
    id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
  }));
}
