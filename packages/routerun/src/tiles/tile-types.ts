import type { Direction, RouteRunMetadata } from "../board/board-types.js";

export type TileFamily =
  | "straight"
  | "bend"
  | "t-junction"
  | "cross-junction"
  | "one-way"
  | "destination"
  | "entry"
  | "blocker"
  | "empty";

export type TileRotation = 0 | 90 | 180 | 270;

export interface OneWayRule {
  readonly allowedEntrances: readonly Direction[];
  readonly allowedExits: readonly Direction[];
}

export interface RouteTile {
  readonly id: string;
  readonly family: TileFamily;
  readonly connections: readonly Direction[];
  readonly rotation: TileRotation;
  readonly oneWay?: OneWayRule;
  readonly persistent?: boolean;
  readonly movable?: boolean;
  readonly metadata: RouteRunMetadata;
}

export interface TileTemplate {
  readonly id: string;
  readonly family: TileFamily;
  readonly baseConnections: readonly Direction[];
  readonly oneWay?: OneWayRule;
  readonly persistent?: boolean;
  readonly movable?: boolean;
  readonly metadata?: RouteRunMetadata;
}
