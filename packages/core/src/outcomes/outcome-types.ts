import type {
  AnimationCommand,
  EventId,
  RecoverySnapshot,
  RoundId,
  RoundStatus,
  TransitionRecord,
} from "../contracts.js";
import type { AssetId } from "../assets/asset-types.js";
import type { FeatureManifestId, EngineManifestId, GameManifestId, ThemeManifestId } from "../manifests/manifest-types.js";
import type { FeatureRunnerRecord, JsonObject, JsonValue } from "../features/index.js";

type Brand<Value, Name extends string> = Value & { readonly __outcomeBrand: Name };

export type OutcomeId = Brand<string, "OutcomeId">;
export type OutcomeEventId = Brand<string, "OutcomeEventId">;
export type ReplayRecordId = Brand<string, "ReplayRecordId">;

export const outcomeId = (value: string): OutcomeId => value as OutcomeId;
export const outcomeEventId = (value: string): OutcomeEventId => value as OutcomeEventId;
export const replayRecordId = (value: string): ReplayRecordId => value as ReplayRecordId;

export const OUTCOME_SCHEMA_VERSION = "1.0.0" as const;
export const OUTCOME_REPLAY_SCHEMA_VERSION = 1 as const;
export const OUTCOME_RUNTIME_SNAPSHOT_VERSION = 1 as const;

export type OutcomeState = Readonly<Record<string, JsonValue>>;
export type OutcomeMetadata = Readonly<Record<string, JsonValue>>;

export type DeterministicSource =
  | { readonly type: "seed"; readonly value: string }
  | { readonly type: "reference"; readonly value: string };

export interface OutcomeAnimationHint {
  readonly type: string;
  readonly durationMs: number;
  readonly payload: JsonObject;
  readonly blocking?: boolean;
  readonly skippable?: boolean;
  readonly metadata?: OutcomeMetadata;
}

export interface OutcomeEvent {
  readonly id: OutcomeEventId;
  readonly sequence: number;
  readonly type: string;
  readonly logicalTick: number;
  readonly payload: JsonObject;
  readonly blocking: boolean;
  readonly skippable: boolean;
  readonly featureId?: FeatureManifestId;
  readonly dependsOn: readonly OutcomeEventId[];
  readonly expectedStateChanges: OutcomeState;
  readonly animationHints: readonly OutcomeAnimationHint[];
  readonly assetIds: readonly AssetId[];
  readonly themeIds: readonly ThemeManifestId[];
  /** Optional declared contribution to totalWinMinor. */
  readonly winAmountMinor?: number;
  readonly metadata: OutcomeMetadata;
}

export interface OutcomeDefinition {
  readonly schemaVersion: typeof OUTCOME_SCHEMA_VERSION;
  readonly id: OutcomeId;
  readonly roundId: RoundId;
  readonly name: string;
  readonly description: string;
  readonly engineId: EngineManifestId;
  readonly gameId: GameManifestId;
  readonly deterministicSource: DeterministicSource;
  readonly betAmountMinor: number;
  readonly totalWinMinor: number;
  readonly events: readonly OutcomeEvent[];
  readonly expectedFinalState: OutcomeState;
  readonly tags: readonly string[];
  readonly metadata: OutcomeMetadata;
  /** Contiguous is the default. Explicit permits stable, unique sequence gaps. */
  readonly sequencePolicy?: "contiguous" | "explicit";
}

export type OutcomeValidationSeverity = "error" | "warning";

export type OutcomeValidationCode =
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_OUTCOME_ID"
  | "DUPLICATE_OUTCOME_ID"
  | "INVALID_ROUND_ID"
  | "INVALID_REQUIRED_FIELD"
  | "INVALID_MONEY"
  | "DUPLICATE_EVENT_ID"
  | "INVALID_SEQUENCE"
  | "INVALID_LOGICAL_TICK"
  | "INVALID_EVENT"
  | "TOTAL_WIN_MISMATCH"
  | "MISSING_EVENT_DEPENDENCY"
  | "LATE_EVENT_DEPENDENCY"
  | "CIRCULAR_EVENT_DEPENDENCY"
  | "INVALID_ENGINE_REFERENCE"
  | "INVALID_GAME_REFERENCE"
  | "INVALID_FEATURE_REFERENCE"
  | "INVALID_ASSET_REFERENCE"
  | "INVALID_THEME_REFERENCE"
  | "INVALID_FINAL_STATE"
  | "NON_DETERMINISTIC_ORDER"
  | "REFERENCE_VALIDATION_SKIPPED"
  | "REPLAY_VERSION_MISMATCH"
  | "MALFORMED_JSON";

export interface OutcomeValidationIssue {
  readonly code: OutcomeValidationCode;
  readonly severity: OutcomeValidationSeverity;
  readonly message: string;
  readonly path: string;
  readonly outcomeId?: string;
  readonly eventId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface OutcomeValidationResult {
  readonly valid: boolean;
  readonly errors: readonly OutcomeValidationIssue[];
  readonly warnings: readonly OutcomeValidationIssue[];
}

export interface OutcomeRegistrySnapshot {
  readonly schemaVersion: 1;
  readonly outcomes: readonly OutcomeDefinition[];
}

export type OutcomePlaybackStatus =
  | "idle"
  | "validating"
  | "ready"
  | "playing"
  | "paused"
  | "interrupted"
  | "recovering"
  | "completed"
  | "failed";

export interface OutcomeEventPublication {
  readonly sequence: number;
  readonly name: string;
  readonly eventId: OutcomeEventId | null;
  readonly logicalTick: number;
}

export interface OutcomeFeatureExecution {
  readonly eventId: OutcomeEventId;
  readonly featureId: FeatureManifestId;
  readonly operation: string;
  readonly executionOrder: number;
  readonly executionId: string;
}

export interface OutcomeTimingRecord {
  readonly name: string;
  readonly logicalTick: number;
  readonly externalTime: number | null;
}

export interface OutcomeExecutionError {
  readonly code: string;
  readonly message: string;
  readonly eventId: OutcomeEventId | null;
}

export interface OutcomeExecutionWarning {
  readonly code: string;
  readonly message: string;
  readonly eventId: OutcomeEventId | null;
}

export interface OutcomeExecutionRecord {
  readonly normalizedEvents: readonly OutcomeEvent[];
  readonly featureExecutions: readonly OutcomeFeatureExecution[];
  readonly eventPublications: readonly OutcomeEventPublication[];
  readonly animationCommands: readonly AnimationCommand[];
  readonly completedAnimationCommandIds: readonly string[];
  readonly stateTransitions: readonly TransitionRecord[];
  readonly snapshots: readonly RecoverySnapshot[];
  readonly interruptions: readonly OutcomeTimingRecord[];
  readonly recoveries: readonly OutcomeTimingRecord[];
  readonly warnings: readonly OutcomeExecutionWarning[];
  readonly errors: readonly OutcomeExecutionError[];
  readonly finalState: OutcomeState;
  readonly timings: readonly OutcomeTimingRecord[];
}

export interface OutcomeReplayRecord {
  readonly schemaVersion: typeof OUTCOME_REPLAY_SCHEMA_VERSION;
  readonly id: ReplayRecordId;
  readonly outcomeId: OutcomeId;
  readonly outcomeSchemaVersion: typeof OUTCOME_SCHEMA_VERSION;
  readonly outcome: OutcomeDefinition;
  readonly status: "completed" | "interrupted" | "failed";
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly execution: OutcomeExecutionRecord;
  readonly metadata: OutcomeMetadata;
}

export type OutcomeDiffCategory =
  | "event-order"
  | "animation-order"
  | "final-state"
  | "feature-execution"
  | "transition-history"
  | "replay-record";

export interface OutcomeDivergence {
  readonly category: OutcomeDiffCategory;
  readonly index: number;
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
}

export interface OutcomeComparisonResult {
  readonly equal: boolean;
  readonly divergences: readonly OutcomeDivergence[];
  readonly firstDivergence: OutcomeDivergence | null;
}

export interface OutcomeRuntimeSnapshot {
  readonly schemaVersion: typeof OUTCOME_RUNTIME_SNAPSHOT_VERSION;
  readonly outcomeId: OutcomeId;
  readonly outcomeSchemaVersion: typeof OUTCOME_SCHEMA_VERSION;
  readonly currentEventIndex: number;
  readonly completedEventIds: readonly OutcomeEventId[];
  readonly pendingEventIds: readonly OutcomeEventId[];
  readonly activeEventId: OutcomeEventId | null;
  readonly replayRecordId: ReplayRecordId | null;
  readonly logicalTick: number;
  readonly comparatorState: OutcomeComparisonResult | null;
}

export interface OutcomePlaybackResult {
  readonly status: "completed" | "interrupted" | "failed";
  readonly record: OutcomeReplayRecord;
  readonly comparison: OutcomeComparisonResult;
  readonly snapshot: RecoverySnapshot | null;
}

export interface OutcomeScenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly engineId: string;
  readonly gameId: string;
  readonly tags: readonly string[];
  readonly outcome: unknown;
  readonly expectedFailure?: string;
}

export interface OutcomeClock {
  now(): number;
}

export interface OutcomeReferenceResolver {
  hasEngine(id: string): boolean;
  hasGame(id: string): boolean;
  hasFeature(id: string): boolean;
  hasAsset(id: string): boolean;
  hasTheme(id: string): boolean;
}

export interface OutcomeFeatureRunProjection {
  readonly records: readonly FeatureRunnerRecord[];
  readonly commands: readonly AnimationCommand[];
}

export interface OutcomeDebugSnapshot {
  readonly activeOutcome: string | null;
  readonly eventCount: number;
  readonly currentEvent: string | null;
  readonly validationStatus: string;
  readonly playbackStatus: OutcomePlaybackStatus;
  readonly expectedTotalMinor: number;
  readonly actualTotalMinor: number;
  readonly latestWarningOrError: string | null;
  readonly recordingStatus: "idle" | "recording" | "completed" | "failed";
  readonly replayVersion: number;
  readonly commandCount: number;
  readonly transitionCount: number;
  readonly recoveryCount: number;
  readonly divergenceStatus: "not-compared" | "matching" | "diverged";
  readonly firstDivergence: string | null;
}

export interface OutcomeDebugPanelIntegration {
  readonly getState: () => OutcomeDebugSnapshot;
}

export interface OutcomePlayerState {
  readonly status: OutcomePlaybackStatus;
  readonly activeOutcome: OutcomeDefinition | null;
  readonly currentEvent: OutcomeEvent | null;
  readonly actualState: OutcomeState;
  readonly actualTotalMinor: number;
  readonly replayRecord: OutcomeReplayRecord | null;
  readonly comparison: OutcomeComparisonResult | null;
  readonly snapshot: RecoverySnapshot | null;
  readonly lifecycleState: RoundStatus;
}
