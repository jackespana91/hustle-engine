import type { AnimationCommand } from "@hustle/core";
import type { BoardDefinition } from "../board/board-types.js";
import type { CascadeReport } from "../cascade/cascade-types.js";
import type { ExpansionReport } from "../expansion/expansion-types.js";
import type { OverlayCollection } from "../overlays/overlay-types.js";
import type { RoutePreview, RouteStep, RouteTerminalReason } from "../route/route-types.js";
import type { RunnerState } from "../runner/runner-types.js";

export const ROUTERUN_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type RouteRunPhase =
  | "idle" | "initializing" | "previewing" | "moving" | "collecting" | "clearing" | "cascading"
  | "expanding" | "checking-continuation" | "terminal" | "interrupted" | "recovering" | "completed" | "failed";

export interface RouteRunTerminalState {
  readonly reason: RouteTerminalReason;
  readonly message: string;
  readonly logicalTick: number;
}

export interface RouteRunSnapshot {
  readonly schemaVersion: typeof ROUTERUN_SNAPSHOT_SCHEMA_VERSION;
  readonly engineVersion: string;
  readonly boardDefinition: BoardDefinition;
  readonly currentBoardState: BoardDefinition;
  readonly runnerState: RunnerState | null;
  readonly completedRouteSteps: readonly RouteStep[];
  readonly activeRoutePreview: RoutePreview | null;
  readonly collectedOverlays: readonly OverlayCollection[];
  readonly completedCascades: readonly CascadeReport[];
  readonly pendingRefillData: unknown | null;
  readonly activeExpansions: readonly ExpansionReport[];
  readonly currentPhase: RouteRunPhase;
  readonly currentOutcomeReference: string | null;
  readonly logicalTick: number;
  readonly terminalState: RouteRunTerminalState | null;
  readonly completedOperationIds: readonly string[];
  readonly pendingAnimationCommands: readonly AnimationCommand[];
  readonly schemaMetadata: Readonly<Record<string, unknown>>;
}

export function serializeRouteRunSnapshot(snapshot: RouteRunSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseRouteRunSnapshot(value: string): RouteRunSnapshot {
  const parsed = JSON.parse(value) as Partial<RouteRunSnapshot>;
  if (parsed.schemaVersion !== ROUTERUN_SNAPSHOT_SCHEMA_VERSION) throw new Error(`Unsupported RouteRun snapshot schema ${String(parsed.schemaVersion)}`);
  return structuredClone(parsed as RouteRunSnapshot);
}
