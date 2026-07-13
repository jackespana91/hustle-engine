import type { AnimationCommand, FeatureResult, FeatureSharedStateProposal } from "@hustle/core";
import type { BoardDefinition, Coordinate, Direction, RouteRunMetadata } from "../board/board-types.js";
import type { RouteResolution } from "../route/route-types.js";
import type { RunnerState } from "../runner/runner-types.js";
import type { RouteRunFeatureHook } from "./routerun-feature-hooks.js";

export interface RouteRunFeatureContext {
  readonly hook: RouteRunFeatureHook;
  readonly engineId: "engine.routerun";
  readonly engineVersion: string;
  readonly phase: string;
  readonly board: BoardDefinition | null;
  readonly runner: RunnerState | null;
  readonly route: RouteResolution | null;
  readonly coordinate: Coordinate | null;
  readonly direction: Direction | null;
  readonly logicalTick: number;
  readonly metadata: RouteRunMetadata;
}

/**
 * Adapter boundary for the existing Core Feature SDK. A host may project this
 * safe context into FeatureContext and return the SDK's explicit result data.
 * RouteRun never calls concrete feature implementations directly.
 */
export interface RouteRunFeatureBridge {
  execute(hook: RouteRunFeatureHook, context: RouteRunFeatureContext): FeatureResult | void;
}

export interface AppliedRouteRunFeatureResult {
  readonly hook: RouteRunFeatureHook;
  readonly animationCommands: readonly AnimationCommand[];
  readonly sharedStateProposals: readonly FeatureSharedStateProposal[];
  readonly warningMessages: readonly string[];
  readonly requestedStop: boolean;
}

export function applyRouteRunFeatureResult(hook: RouteRunFeatureHook, result: FeatureResult | void): AppliedRouteRunFeatureResult {
  return {
    hook,
    animationCommands: result?.animationCommands ?? [],
    sharedStateProposals: result?.sharedStateProposals ?? [],
    warningMessages: result?.warnings.map(({ code, message }) => `[${code}] ${message}`) ?? [],
    requestedStop: result?.continuation.action === "stop",
  };
}
