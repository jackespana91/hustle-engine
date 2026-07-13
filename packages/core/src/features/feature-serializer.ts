import {
  eventId as toEventId,
  roundId as toRoundId,
  type EventId,
  type RoundId,
} from "../contracts.js";
import { stableValue } from "../manifests/manifest-serializer.js";
import { isSemanticVersion } from "../manifests/manifest-compatibility.js";
import {
  engineManifestId,
  gameManifestId,
  type EngineManifestId,
  type FeatureManifestId,
  type GameManifestId,
} from "../manifests/manifest-types.js";
import { compareAscii, validateFeatureGraph } from "./feature-dependencies.js";
import { FeatureSdkError } from "./feature-errors.js";
import type { FeatureRegistry, FeatureRuntimeMetadata } from "./feature-registry.js";
import {
  FeatureStateMigrationRegistry,
  assertFeatureState,
  cloneFeatureState,
  type FeatureStateMigration,
} from "./feature-state.js";
import {
  FEATURE_SNAPSHOT_SCHEMA_VERSION,
  type FeatureFailureInformation,
  type FeatureLifecycleStatus,
  type FeatureRuntimeSnapshot,
  type FeatureState,
  type FeatureWarning,
  type RegisteredFeature,
  type SerializedFeatureState,
} from "./feature-types.js";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LIFECYCLE_STATUSES: readonly FeatureLifecycleStatus[] = [
  "registered", "disabled", "initializing", "initialized", "round-initializing", "ready",
  "evaluating", "triggered", "skipped", "updating", "interrupted", "recovering",
  "completed", "failed", "cleaning", "cleaned",
];

export interface FeatureSnapshotContext {
  readonly engineId: EngineManifestId | string;
  readonly gameId: GameManifestId | string;
  readonly roundId?: RoundId | string | null;
  readonly eventId?: EventId | string | null;
  readonly logicalTick: number;
  readonly executionLedger?: readonly string[];
}

export interface FeatureRestoreExpectation {
  readonly engineId?: EngineManifestId | string;
  readonly gameId?: GameManifestId | string;
  readonly roundId?: RoundId | string | null;
  readonly eventId?: EventId | string | null;
}

interface NormalizedFeatureSnapshotContext {
  readonly engineId: EngineManifestId;
  readonly gameId: GameManifestId;
  readonly roundId: RoundId | null;
  readonly eventId: EventId | null;
  readonly logicalTick: number;
  readonly executionLedger: readonly string[];
}

interface RestoreEntry {
  readonly id: FeatureManifestId;
  readonly featureVersion: string;
  readonly stateVersion: string;
  readonly state: FeatureState;
  readonly metadata: FeatureRuntimeMetadata;
}

export class FeatureSerializer {
  constructor(readonly migrations = new FeatureStateMigrationRegistry()) {}

  registerMigration(migration: FeatureStateMigration): void {
    this.migrations.register(migration);
  }

  createSnapshot(registry: FeatureRegistry, context: FeatureSnapshotContext): FeatureRuntimeSnapshot {
    const normalizedContext = normalizeContext(context);
    const registrations = [...registry.list()].sort((left, right) => compareAscii(left.manifest.id, right.manifest.id));
    assertRegistryEngineCompatibility(registry, registrations, normalizedContext.engineId);
    validateCurrentGraph(registry, registrations);

    const features = registrations.map((registration) => serializeRegistration(registry, registration));
    const executionLedger = mergeLedger(
      normalizedContext.executionLedger,
      features.flatMap(({ completedExecutionIds }) => completedExecutionIds),
    );
    const snapshot: FeatureRuntimeSnapshot = {
      schemaVersion: FEATURE_SNAPSHOT_SCHEMA_VERSION,
      engineId: normalizedContext.engineId,
      gameId: normalizedContext.gameId,
      roundId: normalizedContext.roundId,
      eventId: normalizedContext.eventId,
      logicalTick: normalizedContext.logicalTick,
      executionLedger,
      features,
    };
    assertSnapshotShape(snapshot);
    const output = cloneSnapshot(snapshot);
    for (const state of output.features) {
      registry.events.publish("feature:state-serialized", { state: structuredClone(state), snapshot: cloneSnapshot(output) });
    }
    return output;
  }

  snapshot(registry: FeatureRegistry, context: FeatureSnapshotContext): FeatureRuntimeSnapshot {
    return this.createSnapshot(registry, context);
  }

  /** Returns stable JSON with recursively sorted object keys and ASCII-sorted feature entries. */
  serialize(registry: FeatureRegistry, context: FeatureSnapshotContext, pretty = false): string {
    return this.serializeSnapshot(this.createSnapshot(registry, context), pretty);
  }

  stringify(registry: FeatureRegistry, context: FeatureSnapshotContext, pretty = false): string {
    return this.serialize(registry, context, pretty);
  }

  serializeSnapshot(snapshot: FeatureRuntimeSnapshot, pretty = false): string {
    assertSnapshotShape(snapshot);
    const normalized = normalizeFeatureOrder(snapshot);
    const serialized = JSON.stringify(stableValue(normalized), null, pretty ? 2 : undefined);
    if (serialized === undefined) throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature snapshot could not be serialized", { operation: "serialize" });
    return serialized;
  }

  parse(json: string): FeatureRuntimeSnapshot {
    let value: unknown;
    try { value = JSON.parse(json); }
    catch (error) {
      throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature snapshot is not valid JSON", {
        operation: "deserialize",
        cause: error,
      });
    }
    try {
      assertSnapshotShape(value);
      return normalizeFeatureOrder(value);
    } catch (error) {
      throw wrapInvalidSnapshot(error, "Feature snapshot validation failed");
    }
  }

  /**
   * Restores all registered features as one transaction. Validation and state
   * migration finish before the first implementation is mutated.
   */
  async restore(
    registry: FeatureRegistry,
    snapshotOrJson: FeatureRuntimeSnapshot | string,
    expectation: FeatureRestoreExpectation = {},
  ): Promise<FeatureRuntimeSnapshot> {
    const source = typeof snapshotOrJson === "string" ? this.parse(snapshotOrJson) : validateAndCloneSnapshot(snapshotOrJson);
    assertRestoreContext(source, registry, expectation);
    const registrations = [...registry.list()].sort((left, right) => compareAscii(left.manifest.id, right.manifest.id));
    assertExactCoverage(source, registrations);
    assertRegistryEngineCompatibility(registry, registrations, source.engineId);

    // All validation and migration is staged before registry state is touched.
    const staged = this.stageEntries(source, registrations);
    validateStagedGraph(registry, registrations, staged);
    const normalized = normalizeRestoredSnapshot(source, staged);
    const previous = captureRegistryEntries(registry, registrations);

    try {
      await registry.restoreStates(staged);
      assertAppliedExactly(registry, staged);
      for (const state of normalized.features) {
        registry.events.publish("feature:state-restored", { state: structuredClone(state), snapshot: cloneSnapshot(normalized) });
      }
      return cloneSnapshot(normalized);
    } catch (error) {
      let rollbackFailure: unknown;
      try { await registry.restoreStates(previous); }
      catch (rollbackError) { rollbackFailure = rollbackError; }
      throw new FeatureSdkError(
        "RECOVERY_FAILED",
        rollbackFailure === undefined
          ? "Feature snapshot restore failed; the prior valid runtime was restored"
          : "Feature snapshot restore failed and the runtime rejected its rollback state",
        {
          operation: "recover",
          cause: error,
          context: rollbackFailure === undefined ? {} : {
            rollbackFailure: rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure),
          },
        },
      );
    }
  }

  deserialize(
    registry: FeatureRegistry,
    snapshotOrJson: FeatureRuntimeSnapshot | string,
    expectation: FeatureRestoreExpectation = {},
  ): Promise<FeatureRuntimeSnapshot> {
    return this.restore(registry, snapshotOrJson, expectation);
  }

  private stageEntries(
    snapshot: FeatureRuntimeSnapshot,
    registrations: readonly RegisteredFeature[],
  ): readonly RestoreEntry[] {
    const snapshotById = new Map(snapshot.features.map((state) => [state.featureId, state]));
    return registrations.map((registration) => {
      const serialized = snapshotById.get(registration.manifest.id);
      if (!serialized) throw coverageError(`Snapshot is missing feature ${registration.manifest.id}`);
      if (serialized.featureVersion !== registration.implementation.version ||
          serialized.featureVersion !== registration.manifest.version) {
        throw new FeatureSdkError("VERSION_MISMATCH", `Feature ${registration.manifest.id} snapshot version ${serialized.featureVersion} does not match ${registration.implementation.version}`, {
          featureId: registration.manifest.id,
          operation: "recover",
          context: { snapshotVersion: serialized.featureVersion, runtimeVersion: registration.implementation.version },
        });
      }

      let state = cloneFeatureState(serialized.serializedState);
      if (serialized.stateVersion !== registration.implementation.stateVersion) {
        state = this.migrations.migrate(
          registration.manifest.id,
          state,
          serialized.stateVersion,
          registration.implementation.stateVersion,
        );
      }
      assertFeatureState(state);
      return {
        id: registration.manifest.id,
        featureVersion: registration.implementation.version,
        stateVersion: registration.implementation.stateVersion,
        state,
        metadata: {
          enabled: serialized.enabled,
          lifecycleStatus: serialized.lifecycleStatus,
          executionCount: serialized.executionCount,
          lastExecutionOrder: serialized.lastExecutionOrder,
          warnings: structuredClone(serialized.warnings),
          recoverableErrors: structuredClone(serialized.recoverableErrors),
          completedExecutionIds: [...serialized.completedExecutionIds],
        },
      };
    });
  }
}

export function stableSerializeFeatureSnapshot(snapshot: FeatureRuntimeSnapshot, pretty = false): string {
  return new FeatureSerializer().serializeSnapshot(snapshot, pretty);
}

export function parseFeatureSnapshot(json: string): FeatureRuntimeSnapshot {
  return new FeatureSerializer().parse(json);
}

function serializeRegistration(registry: FeatureRegistry, registration: RegisteredFeature): SerializedFeatureState {
  const metadata = registry.runtimeMetadata(registration.manifest.id);
  return {
    featureId: registration.manifest.id,
    featureVersion: registration.implementation.version,
    stateVersion: registration.implementation.stateVersion,
    enabled: metadata.enabled,
    serializedState: registry.getState(registration.manifest.id),
    lifecycleStatus: metadata.lifecycleStatus,
    executionCount: metadata.executionCount,
    lastExecutionOrder: metadata.lastExecutionOrder,
    warnings: structuredClone(metadata.warnings),
    recoverableErrors: structuredClone(metadata.recoverableErrors),
    completedExecutionIds: [...metadata.completedExecutionIds].sort(compareAscii),
  };
}

function captureRegistryEntries(
  registry: FeatureRegistry,
  registrations: readonly RegisteredFeature[],
): readonly RestoreEntry[] {
  return registrations.map((registration) => ({
    id: registration.manifest.id,
    featureVersion: registration.implementation.version,
    stateVersion: registration.implementation.stateVersion,
    state: registry.getState(registration.manifest.id),
    metadata: registry.runtimeMetadata(registration.manifest.id),
  }));
}

function validateCurrentGraph(registry: FeatureRegistry, registrations: readonly RegisteredFeature[]): void {
  validateStagedGraph(registry, registrations, registrations.map((registration) => ({
    id: registration.manifest.id,
    featureVersion: registration.implementation.version,
    stateVersion: registration.implementation.stateVersion,
    state: registry.getState(registration.manifest.id),
    metadata: registry.runtimeMetadata(registration.manifest.id),
  })));
}

function validateStagedGraph(
  registry: FeatureRegistry,
  registrations: readonly RegisteredFeature[],
  staged: readonly RestoreEntry[],
): void {
  const enabledById = new Map(staged.map(({ id, metadata }) => [id, metadata.enabled]));
  const result = validateFeatureGraph(registrations.map(({ manifest }) => ({
    manifest,
    enabled: enabledById.get(manifest.id) ?? false,
  })));
  const first = result.errors[0];
  if (!first) return;
  if (first.code === "FEATURE_CONFLICT") {
    const conflict = first.context?.conflictingFeatureId;
    registry.events.publish("feature:conflict-detected", {
      featureIds: [first.featureId, conflict]
        .filter((id): id is FeatureManifestId => typeof id === "string")
        .sort(compareAscii),
      error: first.toRecord(),
    });
  } else {
    registry.events.publish("feature:dependency-validation-failed", { errors: result.errors.map((error) => error.toRecord()) });
  }
  throw first;
}

function assertRegistryEngineCompatibility(
  registry: FeatureRegistry,
  registrations: readonly RegisteredFeature[],
  engineId: EngineManifestId,
): void {
  if (registry.engineId !== null && String(registry.engineId) !== String(engineId)) {
    throw new FeatureSdkError("UNSUPPORTED_ENGINE", `Snapshot engine ${engineId} does not match runtime engine ${registry.engineId}`, {
      operation: "recover",
      context: { snapshotEngineId: engineId, runtimeEngineId: registry.engineId },
    });
  }
  for (const registration of registrations) {
    if (!registration.manifest.supportedEngineIds.some((supported) => String(supported) === String(engineId))) {
      throw new FeatureSdkError("UNSUPPORTED_ENGINE", `Feature ${registration.manifest.id} does not support snapshot engine ${engineId}`, {
        featureId: registration.manifest.id,
        operation: "recover",
        context: { engineId },
      });
    }
  }
}

function assertExactCoverage(snapshot: FeatureRuntimeSnapshot, registrations: readonly RegisteredFeature[]): void {
  const registeredIds = registrations.map(({ manifest }) => String(manifest.id)).sort(compareAscii);
  const snapshotIds = snapshot.features.map(({ featureId }) => String(featureId)).sort(compareAscii);
  if (canonical(registeredIds) !== canonical(snapshotIds)) {
    throw coverageError("Feature snapshot must contain every registered feature exactly once", {
      registeredIds,
      snapshotIds,
    });
  }
}

function assertRestoreContext(
  snapshot: FeatureRuntimeSnapshot,
  registry: FeatureRegistry,
  expectation: FeatureRestoreExpectation,
): void {
  const expectedEngine = expectation.engineId ?? registry.engineId;
  if (expectedEngine !== null && expectedEngine !== undefined && String(snapshot.engineId) !== String(expectedEngine)) {
    throw contextMismatch("engineId", snapshot.engineId, expectedEngine);
  }
  if (expectation.gameId !== undefined && String(snapshot.gameId) !== String(expectation.gameId)) {
    throw contextMismatch("gameId", snapshot.gameId, expectation.gameId);
  }
  if (expectation.roundId !== undefined && nullableString(snapshot.roundId) !== nullableString(expectation.roundId)) {
    throw contextMismatch("roundId", snapshot.roundId, expectation.roundId);
  }
  if (expectation.eventId !== undefined && nullableString(snapshot.eventId) !== nullableString(expectation.eventId)) {
    throw contextMismatch("eventId", snapshot.eventId, expectation.eventId);
  }
}

function assertAppliedExactly(registry: FeatureRegistry, staged: readonly RestoreEntry[]): void {
  for (const entry of staged) {
    if (canonical(registry.getState(entry.id)) !== canonical(entry.state) ||
        canonical(registry.runtimeMetadata(entry.id)) !== canonical(entry.metadata)) {
      throw new FeatureSdkError("RECOVERY_FAILED", `Feature ${entry.id} did not restore the staged state exactly`, {
        featureId: entry.id,
        operation: "recover",
      });
    }
  }
}

function normalizeRestoredSnapshot(
  source: FeatureRuntimeSnapshot,
  staged: readonly RestoreEntry[],
): FeatureRuntimeSnapshot {
  const sourceById = new Map(source.features.map((state) => [state.featureId, state]));
  const features = staged.map((entry): SerializedFeatureState => {
    const sourceState = sourceById.get(entry.id);
    if (!sourceState) throw coverageError(`Snapshot is missing feature ${entry.id}`);
    return {
      ...sourceState,
      featureVersion: entry.featureVersion,
      stateVersion: entry.stateVersion,
      serializedState: cloneFeatureState(entry.state),
      enabled: entry.metadata.enabled,
      lifecycleStatus: entry.metadata.lifecycleStatus,
      executionCount: entry.metadata.executionCount,
      lastExecutionOrder: entry.metadata.lastExecutionOrder,
      warnings: structuredClone(entry.metadata.warnings),
      recoverableErrors: structuredClone(entry.metadata.recoverableErrors),
      completedExecutionIds: [...entry.metadata.completedExecutionIds].sort(compareAscii),
    };
  }).sort((left, right) => compareAscii(left.featureId, right.featureId));
  return cloneSnapshot({
    ...source,
    executionLedger: mergeLedger(source.executionLedger, features.flatMap(({ completedExecutionIds }) => completedExecutionIds)),
    features,
  });
}

function normalizeContext(context: FeatureSnapshotContext): NormalizedFeatureSnapshotContext {
  if (!Number.isSafeInteger(context.logicalTick) || context.logicalTick < 0) {
    throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature snapshot logical tick must be a non-negative safe integer", {
      operation: "snapshot",
      context: { logicalTick: context.logicalTick },
    });
  }
  const engineId = engineManifestId(String(context.engineId));
  const gameId = gameManifestId(String(context.gameId));
  if (!ID.test(engineId) || !ID.test(gameId)) throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature snapshot engine and game IDs must be lowercase kebab-case", { operation: "snapshot" });
  const executionLedger = [...(context.executionLedger ?? [])];
  assertStringSet(executionLedger, "executionLedger");
  return {
    engineId,
    gameId,
    roundId: context.roundId === undefined || context.roundId === null ? null : toRoundId(String(context.roundId)),
    eventId: context.eventId === undefined || context.eventId === null ? null : toEventId(String(context.eventId)),
    logicalTick: context.logicalTick,
    executionLedger,
  };
}

function validateAndCloneSnapshot(snapshot: FeatureRuntimeSnapshot): FeatureRuntimeSnapshot {
  try { assertSnapshotShape(snapshot); }
  catch (error) { throw wrapInvalidSnapshot(error, "Feature snapshot validation failed"); }
  return normalizeFeatureOrder(snapshot);
}

function assertSnapshotShape(value: unknown): asserts value is FeatureRuntimeSnapshot {
  if (!isRecord(value)) throw invalidSnapshot("Snapshot must be an object");
  if (value.schemaVersion !== FEATURE_SNAPSHOT_SCHEMA_VERSION) throw invalidSnapshot(`Unsupported feature snapshot schema ${String(value.schemaVersion)}`);
  if (typeof value.engineId !== "string" || !ID.test(value.engineId)) throw invalidSnapshot("Snapshot engineId must be lowercase kebab-case");
  if (typeof value.gameId !== "string" || !ID.test(value.gameId)) throw invalidSnapshot("Snapshot gameId must be lowercase kebab-case");
  if (value.roundId !== null && (typeof value.roundId !== "string" || value.roundId.length === 0)) throw invalidSnapshot("Snapshot roundId must be a non-empty string or null");
  if (value.eventId !== null && (typeof value.eventId !== "string" || value.eventId.length === 0)) throw invalidSnapshot("Snapshot eventId must be a non-empty string or null");
  if (!Number.isSafeInteger(value.logicalTick) || Number(value.logicalTick) < 0) throw invalidSnapshot("Snapshot logicalTick must be a non-negative safe integer");
  if (!Array.isArray(value.executionLedger)) throw invalidSnapshot("Snapshot executionLedger must be an array");
  assertStringSet(value.executionLedger, "executionLedger");
  if (!Array.isArray(value.features)) throw invalidSnapshot("Snapshot features must be an array");
  const ids: string[] = [];
  value.features.forEach((state, index) => {
    validateSerializedFeature(state, `features.${index}`);
    ids.push(state.featureId);
  });
  if (new Set(ids).size !== ids.length) throw invalidSnapshot("Snapshot contains duplicate feature IDs");
}

function validateSerializedFeature(value: unknown, path: string): asserts value is SerializedFeatureState {
  if (!isRecord(value)) throw invalidSnapshot(`${path} must be an object`);
  if (typeof value.featureId !== "string" || !ID.test(value.featureId)) throw invalidSnapshot(`${path}.featureId must be lowercase kebab-case`);
  if (typeof value.featureVersion !== "string" || !isSemanticVersion(value.featureVersion)) throw invalidSnapshot(`${path}.featureVersion must be semantic version`);
  if (typeof value.stateVersion !== "string" || !isSemanticVersion(value.stateVersion)) throw invalidSnapshot(`${path}.stateVersion must be semantic version`);
  if (typeof value.enabled !== "boolean") throw invalidSnapshot(`${path}.enabled must be boolean`);
  if (typeof value.lifecycleStatus !== "string" || !LIFECYCLE_STATUSES.includes(value.lifecycleStatus as FeatureLifecycleStatus)) throw invalidSnapshot(`${path}.lifecycleStatus is invalid`);
  if (!Number.isSafeInteger(value.executionCount) || Number(value.executionCount) < 0) throw invalidSnapshot(`${path}.executionCount must be non-negative safe integer`);
  if (value.lastExecutionOrder !== null && (!Number.isSafeInteger(value.lastExecutionOrder) || Number(value.lastExecutionOrder) < 0)) throw invalidSnapshot(`${path}.lastExecutionOrder must be non-negative safe integer or null`);
  try { assertFeatureState(value.serializedState, `${path}.serializedState`); }
  catch (error) { throw invalidSnapshot(error instanceof Error ? error.message : `${path}.serializedState is invalid`, error); }
  validateWarnings(value.warnings, `${path}.warnings`);
  validateRecoverableErrors(value.recoverableErrors, `${path}.recoverableErrors`);
  if (!Array.isArray(value.completedExecutionIds)) throw invalidSnapshot(`${path}.completedExecutionIds must be an array`);
  assertStringSet(value.completedExecutionIds, `${path}.completedExecutionIds`);
}

function validateWarnings(value: unknown, path: string): asserts value is readonly FeatureWarning[] {
  if (!Array.isArray(value)) throw invalidSnapshot(`${path} must be an array`);
  value.forEach((warning, index) => {
    if (!isRecord(warning) || typeof warning.code !== "string" || warning.code.length === 0 || typeof warning.message !== "string") {
      throw invalidSnapshot(`${path}.${index} must contain code and message`);
    }
    if (warning.details !== undefined) assertFeatureState(warning.details, `${path}.${index}.details`);
  });
}

function validateRecoverableErrors(value: unknown, path: string): asserts value is readonly FeatureFailureInformation[] {
  if (!Array.isArray(value)) throw invalidSnapshot(`${path} must be an array`);
  value.forEach((error, index) => {
    if (!isRecord(error) || typeof error.code !== "string" || error.code.length === 0 || typeof error.message !== "string" || typeof error.recoverable !== "boolean") {
      throw invalidSnapshot(`${path}.${index} must contain code, message and recoverable`);
    }
    if (error.details !== undefined) assertFeatureState(error.details, `${path}.${index}.details`);
  });
}

function normalizeFeatureOrder(snapshot: FeatureRuntimeSnapshot): FeatureRuntimeSnapshot {
  return cloneSnapshot({
    ...snapshot,
    executionLedger: [...snapshot.executionLedger],
    features: [...snapshot.features]
      .sort((left, right) => compareAscii(left.featureId, right.featureId))
      .map((state) => ({ ...state, completedExecutionIds: [...state.completedExecutionIds].sort(compareAscii) })),
  });
}

function mergeLedger(primary: readonly string[], completed: readonly string[]): readonly string[] {
  const ledger = [...primary];
  const seen = new Set(ledger);
  [...completed].sort(compareAscii).forEach((entry) => { if (!seen.has(entry)) { seen.add(entry); ledger.push(entry); } });
  return ledger;
}

function assertStringSet(value: unknown, path: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw invalidSnapshot(`${path} must contain non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw invalidSnapshot(`${path} contains duplicates`);
}

function coverageError(message: string, context: FeatureState = {}): FeatureSdkError {
  return new FeatureSdkError("INVALID_SNAPSHOT", message, { operation: "recover", context });
}

function contextMismatch(field: string, actual: unknown, expected: unknown): FeatureSdkError {
  return new FeatureSdkError("INVALID_SNAPSHOT", `Feature snapshot ${field} does not match the restore context`, {
    operation: "recover",
    context: { field, actual, expected },
  });
}

function invalidSnapshot(message: string, cause?: unknown): FeatureSdkError {
  return new FeatureSdkError("INVALID_SNAPSHOT", message, {
    operation: "deserialize",
    ...(cause === undefined ? {} : { cause }),
  });
}

function wrapInvalidSnapshot(error: unknown, message: string): FeatureSdkError {
  return error instanceof FeatureSdkError && error.code === "INVALID_SNAPSHOT"
    ? error
    : invalidSnapshot(message, error);
}

function nullableString(value: unknown): string | null { return value === null ? null : String(value); }
function cloneSnapshot(snapshot: FeatureRuntimeSnapshot): FeatureRuntimeSnapshot { return structuredClone(snapshot); }
function canonical(value: unknown): string { return JSON.stringify(stableValue(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
