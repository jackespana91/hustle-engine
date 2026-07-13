import type { AnimationCommand, EventId, RoundId } from "../contracts.js";
import {
  featureManifestId,
  type EngineManifestId,
  type FeatureManifest,
  type FeatureManifestId,
  type GameManifestId,
} from "../manifests/manifest-types.js";
import type { FeatureContext } from "./feature-context.js";

/** Runtime feature identity is the same permanent identity used by FeatureManifest. */
export type FeatureId = FeatureManifestId;
export const featureId = featureManifestId;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue; }

/**
 * Implementations may use narrower state interfaces. Runtime serializers are
 * responsible for rejecting values that are not JSON-safe.
 */
export type FeatureState = Readonly<Record<string, unknown>>;
export type FeatureFailurePolicy = "blocking" | "non-blocking";

export type FeatureLifecycleStatus =
  | "registered"
  | "disabled"
  | "initializing"
  | "initialized"
  | "round-initializing"
  | "ready"
  | "evaluating"
  | "triggered"
  | "skipped"
  | "updating"
  | "interrupted"
  | "recovering"
  | "completed"
  | "failed"
  | "cleaning"
  | "cleaned";

export type FeatureLifecycleOperation =
  | "register"
  | "unregister"
  | "enable"
  | "disable"
  | "validate-dependencies"
  | "validate-conflicts"
  | "resolve-order"
  | "initialize"
  | "initialize-round"
  | "can-trigger"
  | "trigger"
  | "update"
  | "interrupt"
  | "snapshot"
  | "serialize"
  | "deserialize"
  | "recover"
  | "complete-round"
  | "cleanup";

export interface FeatureEmittedEvent<Payload extends FeatureState = FeatureState> {
  readonly name: string;
  readonly payload: Payload;
}

export interface FeatureStateUpdate<State extends FeatureState = FeatureState> {
  /** State updates are local to the currently executing feature. */
  readonly state: State | Readonly<Partial<State>>;
  readonly strategy: "replace" | "merge";
}

export interface FeatureSharedStateProposal {
  readonly key: string;
  readonly value: JsonValue;
  readonly strategy: "replace" | "merge" | "remove";
}

export interface FeatureWarning {
  readonly code: string;
  readonly message: string;
  readonly details?: FeatureState;
}

export type FeatureTelemetryValue = string | number | boolean | null;
export type FeatureTelemetry = Readonly<Record<string, FeatureTelemetryValue>>;

export interface FeatureContinuation {
  readonly action: "continue" | "stop" | "yield";
  readonly reason?: string;
}

export interface FeatureFailureInformation {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: FeatureState;
}

/**
 * Features describe work; they never execute presentation commands directly.
 * The controller decides whether and when returned animation commands are run.
 */
export interface FeatureResult<State extends FeatureState = FeatureState> {
  readonly triggered: boolean;
  readonly emittedEvents: readonly FeatureEmittedEvent[];
  readonly animationCommands: readonly AnimationCommand[];
  readonly featureStateUpdates: readonly FeatureStateUpdate<State>[];
  readonly sharedStateProposals: readonly FeatureSharedStateProposal[];
  readonly warnings: readonly FeatureWarning[];
  readonly telemetry: FeatureTelemetry;
  readonly continuation: FeatureContinuation;
  readonly failure: FeatureFailureInformation | null;
}

export function createFeatureResult<State extends FeatureState = FeatureState>(
  values: Partial<FeatureResult<State>> = {},
): FeatureResult<State> {
  return {
    triggered: values.triggered ?? false,
    emittedEvents: values.emittedEvents ?? [],
    animationCommands: values.animationCommands ?? [],
    featureStateUpdates: values.featureStateUpdates ?? [],
    sharedStateProposals: values.sharedStateProposals ?? [],
    warnings: values.warnings ?? [],
    telemetry: values.telemetry ?? {},
    continuation: values.continuation ?? { action: "continue" },
    failure: values.failure ?? null,
  };
}

export type FeatureHookResult<State extends FeatureState = FeatureState> =
  | void
  | FeatureResult<State>
  | Promise<void | FeatureResult<State>>;

/**
 * Executable behavior deliberately carries only identity/version binding data.
 * Names, compatibility, dependency data and priority remain authoritative in
 * the separately registered FeatureManifest.
 */
export interface FeatureImplementation<State extends FeatureState = FeatureState> {
  readonly id: FeatureManifestId;
  readonly version: string;
  readonly stateVersion: string;
  readonly failurePolicy: FeatureFailurePolicy;
  initialize(context: FeatureContext<State>): FeatureHookResult<State>;
  canTrigger(context: FeatureContext<State>): boolean | Promise<boolean>;
  trigger(context: FeatureContext<State>): FeatureHookResult<State>;
  update(context: FeatureContext<State>, deltaMs: number): FeatureHookResult<State>;
  serialize(): State;
  deserialize(state: State): void | Promise<void>;
  cleanup(context: FeatureContext<State>): FeatureHookResult<State>;
  interrupt?(context: FeatureContext<State>): FeatureHookResult<State>;
  completeRound?(context: FeatureContext<State>): FeatureHookResult<State>;
}

export interface RegisteredFeature<State extends FeatureState = FeatureState> {
  readonly manifest: FeatureManifest;
  readonly implementation: FeatureImplementation<State>;
  readonly enabled: boolean;
  readonly lifecycleStatus: FeatureLifecycleStatus;
  readonly executionCount: number;
  readonly lastExecutionOrder: number | null;
  readonly warnings: readonly FeatureWarning[];
  readonly recoverableErrors: readonly FeatureFailureInformation[];
}

export const FEATURE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface SerializedFeatureState<State extends FeatureState = FeatureState> {
  readonly featureId: FeatureManifestId;
  readonly featureVersion: string;
  readonly stateVersion: string;
  readonly enabled: boolean;
  readonly serializedState: State;
  readonly lifecycleStatus: FeatureLifecycleStatus;
  readonly executionCount: number;
  readonly lastExecutionOrder: number | null;
  readonly warnings: readonly FeatureWarning[];
  readonly recoverableErrors: readonly FeatureFailureInformation[];
  /** Stable execution tokens prevent completed work from replaying on restore. */
  readonly completedExecutionIds: readonly string[];
}

export interface FeatureRuntimeSnapshot {
  readonly schemaVersion: typeof FEATURE_SNAPSHOT_SCHEMA_VERSION;
  readonly engineId: EngineManifestId;
  readonly gameId: GameManifestId;
  readonly roundId: RoundId | null;
  readonly eventId: EventId | null;
  readonly logicalTick: number;
  readonly executionLedger: readonly string[];
  readonly features: readonly SerializedFeatureState[];
}

// Low-cost compatibility names for consumers of the earlier prototype SDK.
export type Feature<State extends FeatureState = FeatureState> = FeatureImplementation<State>;
export type FeatureLifecycle = FeatureLifecycleStatus;
export type FeatureMetadata = FeatureManifest;
export type SerializedFeature<State extends FeatureState = FeatureState> = SerializedFeatureState<State>;
export type FeatureSnapshot = FeatureRuntimeSnapshot;
