import type { FeatureManifest, FeatureManifestId } from "../manifests/manifest-types.js";
import { assertValidFeatureGraph, compareAscii } from "./feature-dependencies.js";
import { FeatureSdkError, type FeatureErrorRecord } from "./feature-errors.js";
import type { FeatureEventMap, FeatureEventName } from "./feature-events.js";
import {
  type FeatureRegistry,
  type FeatureRuntimeMetadata,
} from "./feature-registry.js";
import type {
  FeatureFailureInformation,
  FeatureLifecycleStatus,
  FeatureState,
  FeatureWarning,
  SerializedFeatureState,
} from "./feature-types.js";

/** The complete typed event surface retained by the debug adapter. */
export const FEATURE_DEBUG_EVENT_NAMES = [
  "feature:registered",
  "feature:removed",
  "feature:enabled",
  "feature:disabled",
  "feature:initialized",
  "feature:triggered",
  "feature:completed",
  "feature:skipped",
  "feature:failed",
  "feature:state-serialized",
  "feature:state-restored",
  "feature:cleanup-completed",
  "feature:dependency-validation-failed",
  "feature:conflict-detected",
] as const satisfies readonly FeatureEventName[];

export const FEATURE_DEBUG_HISTORY_LIMIT = 14 as const;

export type FeatureDebugEventRecord = {
  readonly [Name in FeatureEventName]: {
    readonly sequence: number;
    readonly type: Name;
    readonly payload: FeatureEventMap[Name];
  }
}[FeatureEventName];

export interface FeatureDebugErrorRecord {
  readonly sequence: number;
  readonly featureId: FeatureManifestId | null;
  readonly error: FeatureErrorRecord;
}

export interface FeatureDebugWarningRecord {
  readonly sequence: number;
  readonly featureId: FeatureManifestId;
  readonly warning: FeatureWarning;
}

export interface FeatureDebugRegistration {
  readonly id: FeatureManifestId;
  readonly name: string;
  readonly description: string;
  readonly implementationName: string;
  readonly manifest: FeatureManifest;
  readonly manifestVersion: string;
  readonly implementationVersion: string;
  readonly manifestStateVersion: string;
  readonly implementationStateVersion: string;
  readonly failurePolicy: "blocking" | "non-blocking";
  readonly enabled: boolean;
  readonly lifecycleStatus: FeatureLifecycleStatus;
  readonly priority: number;
  readonly deterministic: boolean;
  readonly supportedEngineIds: readonly string[];
  readonly engineCompatible: boolean;
  readonly dependencies: readonly FeatureManifestId[];
  readonly optionalDependencies: readonly FeatureManifestId[];
  readonly conflicts: readonly FeatureManifestId[];
  readonly currentState: FeatureState;
  readonly executionCount: number;
  readonly lastExecutionOrder: number | null;
  readonly warnings: readonly FeatureWarning[];
  readonly recoverableErrors: readonly FeatureFailureInformation[];
}

export interface FeatureDebugSnapshot {
  readonly registeredFeatures: readonly FeatureDebugRegistration[];
  readonly executionOrder: readonly FeatureManifestId[];
  readonly latestEvents: readonly FeatureDebugEventRecord[];
  readonly latestErrors: readonly FeatureDebugErrorRecord[];
  readonly latestWarnings: readonly FeatureDebugWarningRecord[];
  readonly serializedState: readonly SerializedFeatureState[] | null;
  readonly loadedState: readonly SerializedFeatureState[] | null;
}

/** Mutation is deliberately limited to safe registry/debug operations. */
export interface FeatureDebugActions {
  readonly enable: (id: FeatureManifestId | string) => void;
  readonly disable: (id: FeatureManifestId | string) => void;
  readonly setEnabled: (id: FeatureManifestId | string, enabled: boolean) => void;
  readonly snapshot: () => readonly SerializedFeatureState[];
  readonly load: (state?: readonly SerializedFeatureState[]) => Promise<readonly SerializedFeatureState[]>;
  readonly clearEventHistory: () => void;
}

/**
 * DOM-free projection of FeatureRegistry state for development tools.
 *
 * The adapter owns only bounded diagnostic history and copies of the most
 * recently serialized/loaded state. Feature execution remains in the runner,
 * and gameplay or rendering behavior cannot be introduced through this API.
 */
export class FeatureDebugAdapter {
  readonly actions: FeatureDebugActions;
  private readonly events: FeatureDebugEventRecord[] = [];
  private readonly errors: FeatureDebugErrorRecord[] = [];
  private readonly warnings: FeatureDebugWarningRecord[] = [];
  private readonly unsubscribers: (() => void)[] = [];
  private eventSequence = 0;
  private serializedState: readonly SerializedFeatureState[] | null = null;
  private loadedState: readonly SerializedFeatureState[] | null = null;

  constructor(readonly registry: FeatureRegistry) {
    FEATURE_DEBUG_EVENT_NAMES.forEach((name) => this.subscribe(name));
    this.actions = Object.freeze({
      enable: (id: FeatureManifestId | string) => this.runAction(() => this.registry.enable(id)),
      disable: (id: FeatureManifestId | string) => this.runAction(() => this.registry.disable(id)),
      setEnabled: (id: FeatureManifestId | string, enabled: boolean) =>
        this.runAction(() => this.registry.setEnabled(id, enabled)),
      snapshot: () => this.captureState(),
      load: (state?: readonly SerializedFeatureState[]) => this.loadState(state),
      clearEventHistory: () => this.clearEventHistory(),
    });
  }

  snapshot(): FeatureDebugSnapshot {
    return {
      registeredFeatures: this.registry.list().map((registration) => ({
        id: registration.manifest.id,
        name: registration.manifest.name,
        description: registration.manifest.description,
        implementationName: implementationName(registration.implementation),
        manifest: cloneManifest(registration.manifest),
        manifestVersion: registration.manifest.version,
        implementationVersion: registration.implementation.version,
        manifestStateVersion: registration.manifest.stateVersion,
        implementationStateVersion: registration.implementation.stateVersion,
        failurePolicy: registration.manifest.failurePolicy ?? "blocking",
        enabled: registration.enabled,
        lifecycleStatus: registration.lifecycleStatus,
        priority: registration.manifest.priority,
        deterministic: registration.manifest.deterministic,
        supportedEngineIds: registration.manifest.supportedEngineIds.map(String),
        engineCompatible: this.registry.engineId === null || registration.manifest.supportedEngineIds
          .some((engineId) => String(engineId) === String(this.registry.engineId)),
        dependencies: [...registration.manifest.dependencies],
        optionalDependencies: [...(registration.manifest.optionalDependencies ?? [])],
        conflicts: [...registration.manifest.conflicts],
        currentState: this.registry.getState(registration.manifest.id),
        executionCount: registration.executionCount,
        lastExecutionOrder: registration.lastExecutionOrder,
        warnings: structuredClone(registration.warnings),
        recoverableErrors: structuredClone(registration.recoverableErrors),
      })),
      executionOrder: [...this.registry.resolveExecutionOrder()],
      latestEvents: cloneEvents(this.events),
      latestErrors: structuredClone(this.errors),
      latestWarnings: structuredClone(this.warnings),
      serializedState: cloneNullableStates(this.serializedState),
      loadedState: cloneNullableStates(this.loadedState),
    };
  }

  clearEventHistory(): void {
    this.events.length = 0;
    this.errors.length = 0;
    this.warnings.length = 0;
  }

  destroy(): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.clearEventHistory();
  }

  private subscribe<Name extends FeatureEventName>(type: Name): void {
    this.unsubscribers.push(this.registry.events.subscribe(type, (payload) => {
      this.recordEvent(type, payload);
    }));
  }

  private recordEvent<Name extends FeatureEventName>(type: Name, payload: FeatureEventMap[Name]): void {
    const sequence = this.eventSequence;
    this.eventSequence += 1;
    const event = {
      sequence,
      type,
      payload: structuredClone(payload),
    } as FeatureDebugEventRecord;
    this.events.unshift(event);
    trim(this.events);
    this.captureDiagnostics(event);
  }

  private captureDiagnostics(event: FeatureDebugEventRecord): void {
    if (event.type === "feature:failed") {
      this.recordError(event.sequence, event.payload.error);
      return;
    }
    if (event.type === "feature:dependency-validation-failed") {
      event.payload.errors.forEach((error) => this.recordError(event.sequence, error));
      return;
    }
    if (event.type === "feature:conflict-detected") {
      this.recordError(event.sequence, event.payload.error);
      return;
    }
    if (event.type === "feature:completed") {
      event.payload.result.warnings.forEach((warning) => {
        this.warnings.unshift({
          sequence: event.sequence,
          featureId: event.payload.featureId,
          warning: structuredClone(warning),
        });
      });
      trim(this.warnings);
      return;
    }
    if (event.type === "feature:state-serialized") {
      this.serializedState = cloneSerializedStates(event.payload.snapshot.features);
      return;
    }
    if (event.type === "feature:state-restored") {
      this.loadedState = cloneSerializedStates(event.payload.snapshot.features);
    }
  }

  private recordError(sequence: number, error: FeatureErrorRecord): void {
    const record: FeatureDebugErrorRecord = {
      sequence,
      featureId: error.featureId ?? null,
      error: structuredClone(error),
    };
    const previous = this.errors[0];
    if (previous && errorSignature(previous.error) === errorSignature(record.error)) return;
    this.errors.unshift(record);
    trim(this.errors);
  }

  private captureState(): readonly SerializedFeatureState[] {
    try {
      const snapshot = this.registry.list()
        .map(({ manifest }) => serializeRegistration(this.registry, manifest.id))
        .sort((left, right) => compareAscii(left.featureId, right.featureId));
      this.serializedState = cloneSerializedStates(snapshot);
      return cloneSerializedStates(snapshot);
    } catch (error) {
      this.captureActionError(error, "INVALID_STATE", "Feature debug snapshot failed");
      throw error;
    }
  }

  private async loadState(
    supplied?: readonly SerializedFeatureState[],
  ): Promise<readonly SerializedFeatureState[]> {
    const source = supplied ?? this.serializedState;
    if (source === null) {
      const error = new FeatureSdkError("INVALID_SNAPSHOT", "No feature debug snapshot is available to load", {
        operation: "deserialize",
      });
      this.recordError(this.eventSequence, error.toRecord());
      throw error;
    }

    try {
      const states = validateLoadCandidate(this.registry, source);
      await this.registry.restoreStates(states.map((state) => ({
        id: state.featureId,
        state: state.serializedState,
        metadata: runtimeMetadata(state),
      })));
      this.loadedState = cloneSerializedStates(states);
      return cloneSerializedStates(states);
    } catch (error) {
      this.captureActionError(error, "RECOVERY_FAILED", "Feature debug state load failed");
      throw error;
    }
  }

  private runAction(action: () => void): void {
    try { action(); }
    catch (error) {
      this.captureActionError(error, "LIFECYCLE_FAILURE", "Feature debug action failed");
      throw error;
    }
  }

  private captureActionError(
    error: unknown,
    fallbackCode: "INVALID_STATE" | "RECOVERY_FAILED" | "LIFECYCLE_FAILURE",
    fallbackMessage: string,
  ): void {
    const record = error instanceof FeatureSdkError
      ? error.toRecord()
      : new FeatureSdkError(fallbackCode, fallbackMessage, { cause: error }).toRecord();
    this.recordError(this.eventSequence, record);
  }
}

export function createFeatureDebugAdapter(registry: FeatureRegistry): FeatureDebugAdapter {
  return new FeatureDebugAdapter(registry);
}

function serializeRegistration(registry: FeatureRegistry, id: FeatureManifestId): SerializedFeatureState {
  const registration = registry.require(id);
  const metadata = registry.runtimeMetadata(id);
  return {
    featureId: id,
    featureVersion: registration.implementation.version,
    stateVersion: registration.implementation.stateVersion,
    enabled: metadata.enabled,
    serializedState: registry.getState(id),
    lifecycleStatus: metadata.lifecycleStatus,
    executionCount: metadata.executionCount,
    lastExecutionOrder: metadata.lastExecutionOrder,
    warnings: structuredClone(metadata.warnings),
    recoverableErrors: structuredClone(metadata.recoverableErrors),
    completedExecutionIds: [...metadata.completedExecutionIds].sort(compareAscii),
  };
}

function validateLoadCandidate(
  registry: FeatureRegistry,
  source: readonly SerializedFeatureState[],
): readonly SerializedFeatureState[] {
  const states = cloneSerializedStates(source);
  const ids = new Set<FeatureManifestId>();
  for (const state of states) {
    if (ids.has(state.featureId)) {
      throw new FeatureSdkError("INVALID_SNAPSHOT", `Feature debug snapshot contains duplicate ${state.featureId}`, {
        featureId: state.featureId,
        operation: "deserialize",
      });
    }
    ids.add(state.featureId);
    const registration = registry.require(state.featureId);
    if (registration.implementation.version !== state.featureVersion) {
      throw new FeatureSdkError("VERSION_MISMATCH", `Feature ${state.featureId} implementation version does not match the snapshot`, {
        featureId: state.featureId,
        operation: "deserialize",
        context: { expected: registration.implementation.version, received: state.featureVersion },
      });
    }
    if (registration.implementation.stateVersion !== state.stateVersion) {
      throw new FeatureSdkError("STATE_VERSION_MISMATCH", `Feature ${state.featureId} state version does not match the snapshot`, {
        featureId: state.featureId,
        operation: "deserialize",
        context: { expected: registration.implementation.stateVersion, received: state.stateVersion },
      });
    }
  }

  const registeredIds = registry.list().map(({ manifest }) => manifest.id);
  if (states.length !== registeredIds.length || registeredIds.some((id) => !ids.has(id))) {
    throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature debug snapshot must contain every registered feature exactly once", {
      operation: "deserialize",
      context: { registeredIds, snapshotIds: [...ids].sort(compareAscii) },
    });
  }

  const byId = new Map(states.map((state) => [state.featureId, state]));
  assertValidFeatureGraph(registry.list().map(({ manifest }) => ({
    manifest,
    enabled: byId.get(manifest.id)?.enabled ?? false,
  })));
  return [...states].sort((left, right) => compareAscii(left.featureId, right.featureId));
}

function runtimeMetadata(state: SerializedFeatureState): FeatureRuntimeMetadata {
  return {
    enabled: state.enabled,
    lifecycleStatus: state.lifecycleStatus,
    executionCount: state.executionCount,
    lastExecutionOrder: state.lastExecutionOrder,
    warnings: structuredClone(state.warnings),
    recoverableErrors: structuredClone(state.recoverableErrors),
    completedExecutionIds: [...state.completedExecutionIds],
  };
}

function implementationName(implementation: object): string {
  const name = implementation.constructor.name.trim();
  return name === "" ? "AnonymousFeatureImplementation" : name;
}

function cloneManifest(manifest: FeatureManifest): FeatureManifest {
  return structuredClone(manifest);
}

function cloneSerializedStates(states: readonly SerializedFeatureState[]): readonly SerializedFeatureState[] {
  return structuredClone(states);
}

function cloneNullableStates(
  states: readonly SerializedFeatureState[] | null,
): readonly SerializedFeatureState[] | null {
  return states === null ? null : cloneSerializedStates(states);
}

function cloneEvents(events: readonly FeatureDebugEventRecord[]): readonly FeatureDebugEventRecord[] {
  return structuredClone(events) as readonly FeatureDebugEventRecord[];
}

function trim<Value>(values: Value[]): void {
  values.splice(FEATURE_DEBUG_HISTORY_LIMIT);
}

function errorSignature(error: FeatureErrorRecord): string {
  return `${error.code}:${String(error.featureId ?? "")}:${error.message}`;
}
