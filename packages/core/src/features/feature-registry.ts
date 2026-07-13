import { TypedEventBus } from "../event-bus.js";
import type { ManifestRegistry } from "../manifests/manifest-registry.js";
import { ManifestValidator } from "../manifests/manifest-validator.js";
import {
  engineManifestId,
  type EngineManifest,
  type EngineManifestId,
  type FeatureManifest,
  type FeatureManifestId,
  type HustleManifest,
} from "../manifests/manifest-types.js";
import {
  assertValidFeatureGraph,
  compareAscii,
  resolveFeatureExecutionOrder,
  validateFeatureConflicts,
  validateFeatureDependencies,
  type FeatureDependencyNode,
} from "./feature-dependencies.js";
import { FeatureSdkError } from "./feature-errors.js";
import type { FeatureEventMap } from "./feature-events.js";
import { assertFeatureState, cloneFeatureState } from "./feature-state.js";
import type {
  FeatureFailureInformation,
  FeatureImplementation,
  FeatureLifecycleStatus,
  FeatureState,
  FeatureWarning,
  RegisteredFeature,
  SerializedFeatureState,
} from "./feature-types.js";

export interface FeatureRegistrationInput<State extends FeatureState = FeatureState> {
  readonly implementation: FeatureImplementation<State>;
  readonly manifest: FeatureManifest;
  readonly enabled?: boolean;
}

export interface FeatureRegistryOptions {
  readonly engineId?: EngineManifestId | string;
  readonly manifestRegistry?: ManifestRegistry;
}

export interface FeatureRuntimeMetadata {
  readonly enabled: boolean;
  readonly lifecycleStatus: FeatureLifecycleStatus;
  readonly executionCount: number;
  readonly lastExecutionOrder: number | null;
  readonly warnings: readonly FeatureWarning[];
  readonly recoverableErrors: readonly FeatureFailureInformation[];
  readonly completedExecutionIds: readonly string[];
}

interface MutableRegistration {
  readonly manifest: FeatureManifest;
  readonly implementation: FeatureImplementation;
  readonly initialState: FeatureState;
  enabled: boolean;
  lifecycleStatus: FeatureLifecycleStatus;
  executionCount: number;
  lastExecutionOrder: number | null;
  warnings: FeatureWarning[];
  recoverableErrors: FeatureFailureInformation[];
  completedExecutionIds: Set<string>;
}

export class FeatureRegistry {
  readonly events = new TypedEventBus<FeatureEventMap>();
  readonly engineId: EngineManifestId | null;
  private readonly manifestRegistry: ManifestRegistry | undefined;
  private readonly validator = new ManifestValidator();
  private registrations = new Map<FeatureManifestId, MutableRegistration>();

  constructor(options: FeatureRegistryOptions = {}) {
    this.engineId = options.engineId === undefined
      ? null
      : typeof options.engineId === "string" ? engineManifestId(options.engineId) : options.engineId;
    this.manifestRegistry = options.manifestRegistry;
  }

  register<State extends FeatureState>(implementation: FeatureImplementation<State>, manifest: FeatureManifest): void {
    this.registerMany([{ implementation, manifest }]);
  }

  registerMany(inputs: readonly FeatureRegistrationInput[]): void {
    const candidate = new Map(this.registrations);
    const staged: MutableRegistration[] = [];
    const stagedIds = new Set<FeatureManifestId>();
    for (const input of inputs) {
      const registration = this.createRegistration(input);
      const id = registration.manifest.id;
      if (candidate.has(id) || stagedIds.has(id)) {
        throw new FeatureSdkError("DUPLICATE_FEATURE", `Feature already registered: ${id}`, {
          featureId: id,
          operation: "register",
        });
      }
      stagedIds.add(id);
      candidate.set(id, registration);
      staged.push(registration);
    }
    this.assertGraph(candidate);
    this.registrations = candidate;
    staged.sort((left, right) => compareAscii(left.manifest.id, right.manifest.id)).forEach((registration) => {
      this.events.publish("feature:registered", { manifest: cloneManifest(registration.manifest) });
    });
  }

  unregister(id: FeatureManifestId | string): RegisteredFeature | undefined {
    const key = id as FeatureManifestId;
    const registration = this.registrations.get(key);
    if (!registration) return undefined;
    const candidate = new Map(this.registrations);
    candidate.delete(key);
    this.assertGraph(candidate);
    this.registrations = candidate;
    this.events.publish("feature:removed", { manifest: cloneManifest(registration.manifest) });
    return snapshotRegistration(registration);
  }

  get(id: FeatureManifestId | string): RegisteredFeature | undefined {
    const registration = this.registrations.get(id as FeatureManifestId);
    return registration ? snapshotRegistration(registration) : undefined;
  }

  require(id: FeatureManifestId | string): RegisteredFeature {
    const registration = this.get(id);
    if (!registration) throw new FeatureSdkError("UNKNOWN_FEATURE", `Unknown feature: ${id}`, {
      featureId: id as FeatureManifestId,
      operation: "resolve-order",
    });
    return registration;
  }

  has(id: FeatureManifestId | string): boolean { return this.registrations.has(id as FeatureManifestId); }

  list(): readonly RegisteredFeature[] {
    return [...this.registrations.values()]
      .sort((left, right) => compareAscii(left.manifest.id, right.manifest.id))
      .map(snapshotRegistration);
  }

  enable(id: FeatureManifestId | string): void { this.setEnabled(id, true); }
  disable(id: FeatureManifestId | string): void { this.setEnabled(id, false); }

  setEnabled(id: FeatureManifestId | string, enabled: boolean): void {
    const key = id as FeatureManifestId;
    const current = this.mutable(key);
    if (current.enabled === enabled) return;
    const candidate = cloneRegistrationMap(this.registrations);
    const changed = candidate.get(key);
    if (!changed) throw new FeatureSdkError("UNKNOWN_FEATURE", `Unknown feature: ${id}`, { featureId: key, operation: enabled ? "enable" : "disable" });
    changed.enabled = enabled;
    changed.lifecycleStatus = enabled ? "registered" : "disabled";
    this.assertGraph(candidate);
    current.enabled = enabled;
    current.lifecycleStatus = changed.lifecycleStatus;
    this.events.publish(enabled ? "feature:enabled" : "feature:disabled", reference(current));
  }

  isEnabled(id: FeatureManifestId | string): boolean { return this.mutable(id as FeatureManifestId).enabled; }

  filterByEngineCompatibility(engineId: EngineManifestId | string): readonly RegisteredFeature[] {
    const key = String(engineId);
    return this.list().filter(({ manifest }) => manifest.supportedEngineIds.some((id) => String(id) === key));
  }

  discover(engineId?: EngineManifestId | string): readonly RegisteredFeature[] {
    return engineId === undefined ? this.list() : this.filterByEngineCompatibility(engineId);
  }

  validateDependencies(): void {
    const result = validateFeatureDependencies(this.graphNodes());
    if (!result.valid) {
      this.events.publish("feature:dependency-validation-failed", { errors: result.errors.map((error) => error.toRecord()) });
      throw result.errors[0];
    }
  }

  validateConflicts(): void {
    const result = validateFeatureConflicts(this.graphNodes());
    if (!result.valid) {
      const error = result.errors[0];
      if (error) this.events.publish("feature:conflict-detected", {
        featureIds: conflictIds(error),
        error: error.toRecord(),
      });
      throw error;
    }
  }

  resolveExecutionOrder(engineId: EngineManifestId | string | null = this.engineId): readonly FeatureManifestId[] {
    const compatible = this.graphNodes().filter(({ manifest }) => engineId === null || manifest.supportedEngineIds.some((id) => String(id) === String(engineId)));
    return resolveFeatureExecutionOrder(compatible);
  }

  executionOrder(engineId?: EngineManifestId | string): readonly FeatureManifestId[] {
    return this.resolveExecutionOrder(engineId ?? this.engineId);
  }

  snapshotState(): readonly SerializedFeatureState[] {
    return [...this.registrations.keys()].sort(compareAscii).map((id) => this.serializedState(id));
  }

  clear(): void {
    const removed = [...this.registrations.values()].sort((left, right) => compareAscii(left.manifest.id, right.manifest.id));
    this.registrations = new Map();
    removed.forEach((registration) => this.events.publish("feature:removed", { manifest: cloneManifest(registration.manifest) }));
  }

  getState(id: FeatureManifestId | string): FeatureState {
    const state = this.mutable(id as FeatureManifestId).implementation.serialize();
    assertFeatureState(state);
    return cloneFeatureState(state);
  }

  async replaceState(id: FeatureManifestId | string, state: FeatureState): Promise<void> {
    const key = id as FeatureManifestId;
    const next = cloneFeatureState(state);
    await this.mutable(key).implementation.deserialize(next);
  }

  resetRuntimeState(): Promise<void> {
    return this.restoreStates([...this.registrations.values()].map((registration) => ({
      id: registration.manifest.id,
      state: registration.initialState,
      metadata: defaultRuntimeMetadata(registration.enabled),
    })));
  }

  runtimeMetadata(id: FeatureManifestId | string): FeatureRuntimeMetadata {
    const registration = this.mutable(id as FeatureManifestId);
    return cloneRuntimeMetadata(registration);
  }

  setLifecycle(id: FeatureManifestId | string, lifecycleStatus: FeatureLifecycleStatus): void {
    this.mutable(id as FeatureManifestId).lifecycleStatus = lifecycleStatus;
  }

  addWarning(id: FeatureManifestId | string, warning: FeatureWarning): void {
    this.mutable(id as FeatureManifestId).warnings.push(structuredClone(warning));
  }

  addRecoverableError(id: FeatureManifestId | string, error: FeatureFailureInformation): void {
    this.mutable(id as FeatureManifestId).recoverableErrors.push(structuredClone(error));
  }

  markExecution(id: FeatureManifestId | string, executionOrder: number, executionId: string): void {
    const registration = this.mutable(id as FeatureManifestId);
    registration.executionCount += 1;
    registration.lastExecutionOrder = executionOrder;
    registration.completedExecutionIds.add(executionId);
  }

  hasCompletedExecution(id: FeatureManifestId | string, executionId: string): boolean {
    return this.mutable(id as FeatureManifestId).completedExecutionIds.has(executionId);
  }

  applyRuntimeMetadata(id: FeatureManifestId | string, metadata: FeatureRuntimeMetadata): void {
    const registration = this.mutable(id as FeatureManifestId);
    registration.enabled = metadata.enabled;
    registration.lifecycleStatus = metadata.lifecycleStatus;
    registration.executionCount = metadata.executionCount;
    registration.lastExecutionOrder = metadata.lastExecutionOrder;
    registration.warnings = structuredClone(metadata.warnings) as FeatureWarning[];
    registration.recoverableErrors = structuredClone(metadata.recoverableErrors) as FeatureFailureInformation[];
    registration.completedExecutionIds = new Set(metadata.completedExecutionIds);
  }

  async restoreStates(entries: readonly { readonly id: FeatureManifestId; readonly state: FeatureState; readonly metadata: FeatureRuntimeMetadata }[]): Promise<void> {
    const previous = entries.map(({ id }) => ({ id, state: this.getState(id), metadata: this.runtimeMetadata(id) }));
    try {
      for (const entry of entries) await this.replaceState(entry.id, entry.state);
      entries.forEach((entry) => this.applyRuntimeMetadata(entry.id, entry.metadata));
    } catch (error) {
      for (const entry of previous) {
        try { await this.replaceState(entry.id, entry.state); this.applyRuntimeMetadata(entry.id, entry.metadata); }
        catch { /* preserve the original restore failure */ }
      }
      throw new FeatureSdkError("RECOVERY_FAILED", "Feature runtime restore failed; prior state was reapplied", {
        operation: "recover",
        cause: error,
      });
    }
  }

  private createRegistration(input: FeatureRegistrationInput): MutableRegistration {
    const manifest = this.validateManifest(input.manifest);
    validateBinding(input.implementation, manifest);
    this.validateEngineCompatibility(manifest);
    const initialState = input.implementation.serialize();
    assertFeatureState(initialState);
    return {
      manifest,
      implementation: input.implementation,
      initialState: cloneFeatureState(initialState),
      enabled: input.enabled ?? true,
      lifecycleStatus: input.enabled === false ? "disabled" : "registered",
      executionCount: 0,
      lastExecutionOrder: null,
      warnings: [],
      recoverableErrors: [],
      completedExecutionIds: new Set(),
    };
  }

  private validateManifest(input: FeatureManifest): FeatureManifest {
    const result = this.validator.validate(input);
    if (!result.valid || result.manifest?.manifestType !== "feature") {
      throw new FeatureSdkError("MANIFEST_MISMATCH", `Invalid FeatureManifest ${String(input.id)}`, {
        featureId: input.id,
        operation: "register",
        context: { errors: result.errors.map(({ code, message, fieldPath }) => ({ code, message, fieldPath })) },
      });
    }
    const manifest = normalizeManifest(result.manifest);
    const registeredManifest = this.manifestRegistry?.get(manifest.id);
    if (registeredManifest && (registeredManifest.manifestType !== "feature" || canonical(normalizeManifest(registeredManifest)) !== canonical(manifest))) {
      throw new FeatureSdkError("MANIFEST_MISMATCH", `Runtime manifest ${manifest.id} does not match the Manifest Registry`, {
        featureId: manifest.id,
        operation: "register",
      });
    }
    return manifest;
  }

  private validateEngineCompatibility(manifest: FeatureManifest): void {
    if (this.engineId === null) return;
    if (!manifest.supportedEngineIds.some((id) => id === this.engineId)) {
      throw new FeatureSdkError("UNSUPPORTED_ENGINE", `Feature ${manifest.id} does not support engine ${this.engineId}`, {
        featureId: manifest.id,
        operation: "register",
        context: { engineId: this.engineId },
      });
    }
    const engine = this.manifestRegistry?.get(this.engineId);
    if (engine) validateEngineAllowsFeature(engine, manifest);
  }

  private assertGraph(candidate: ReadonlyMap<FeatureManifestId, MutableRegistration>): void {
    const nodes = [...candidate.values()].map(({ manifest, enabled }) => ({ manifest, enabled }));
    try { assertValidFeatureGraph(nodes); }
    catch (error) {
      if (error instanceof FeatureSdkError && error.code === "FEATURE_CONFLICT") {
        this.events.publish("feature:conflict-detected", { featureIds: conflictIds(error), error: error.toRecord() });
      } else if (error instanceof FeatureSdkError) {
        this.events.publish("feature:dependency-validation-failed", { errors: [error.toRecord()] });
      }
      throw error;
    }
  }

  private graphNodes(): readonly FeatureDependencyNode[] {
    return [...this.registrations.values()].map(({ manifest, enabled }) => ({ manifest, enabled }));
  }

  private mutable(id: FeatureManifestId): MutableRegistration {
    const registration = this.registrations.get(id);
    if (!registration) throw new FeatureSdkError("UNKNOWN_FEATURE", `Unknown feature: ${id}`, { featureId: id, operation: "resolve-order" });
    return registration;
  }

  private serializedState(id: FeatureManifestId): SerializedFeatureState {
    const registration = this.mutable(id);
    return {
      featureId: id,
      featureVersion: registration.implementation.version,
      stateVersion: registration.implementation.stateVersion,
      enabled: registration.enabled,
      serializedState: this.getState(id),
      lifecycleStatus: registration.lifecycleStatus,
      executionCount: registration.executionCount,
      lastExecutionOrder: registration.lastExecutionOrder,
      warnings: structuredClone(registration.warnings),
      recoverableErrors: structuredClone(registration.recoverableErrors),
      completedExecutionIds: [...registration.completedExecutionIds].sort(compareAscii),
    };
  }
}

function validateBinding(implementation: FeatureImplementation, manifest: FeatureManifest): void {
  const policy = manifest.failurePolicy ?? "blocking";
  if (implementation.id !== manifest.id || implementation.version !== manifest.version ||
      implementation.stateVersion !== manifest.stateVersion || implementation.failurePolicy !== policy) {
    throw new FeatureSdkError("IMPLEMENTATION_MANIFEST_MISMATCH", `Implementation does not match FeatureManifest ${manifest.id}`, {
      featureId: manifest.id,
      operation: "register",
      context: {
        implementationId: implementation.id,
        implementationVersion: implementation.version,
        implementationStateVersion: implementation.stateVersion,
        implementationFailurePolicy: implementation.failurePolicy,
        manifestVersion: manifest.version,
        manifestStateVersion: manifest.stateVersion,
        manifestFailurePolicy: policy,
      },
    });
  }
  if (!manifest.deterministic) throw new FeatureSdkError("INVALID_IMPLEMENTATION", `Feature ${manifest.id} must declare deterministic execution`, {
    featureId: manifest.id,
    operation: "register",
  });
}

function validateEngineAllowsFeature(engine: HustleManifest, manifest: FeatureManifest): void {
  if (engine.manifestType !== "engine") {
    throw new FeatureSdkError("UNSUPPORTED_ENGINE", `Registered engine reference ${engine.id} is not an EngineManifest`, {
      featureId: manifest.id,
      operation: "register",
    });
  }
  const typed = engine as EngineManifest;
  if (!typed.supportedFeatureIds.includes(manifest.id) || typed.incompatibleFeatureIds.includes(manifest.id)) {
    throw new FeatureSdkError("UNSUPPORTED_ENGINE", `Engine ${typed.id} does not allow feature ${manifest.id}`, {
      featureId: manifest.id,
      operation: "register",
      context: { engineId: typed.id },
    });
  }
}

function normalizeManifest(manifest: FeatureManifest): FeatureManifest {
  return {
    ...structuredClone(manifest),
    optionalDependencies: [...(manifest.optionalDependencies ?? [])],
    failurePolicy: manifest.failurePolicy ?? "blocking",
  };
}

function snapshotRegistration(registration: MutableRegistration): RegisteredFeature {
  return {
    manifest: cloneManifest(registration.manifest),
    implementation: registration.implementation,
    enabled: registration.enabled,
    lifecycleStatus: registration.lifecycleStatus,
    executionCount: registration.executionCount,
    lastExecutionOrder: registration.lastExecutionOrder,
    warnings: structuredClone(registration.warnings),
    recoverableErrors: structuredClone(registration.recoverableErrors),
  };
}

function reference(registration: MutableRegistration): { featureId: FeatureManifestId; lifecycleStatus: FeatureLifecycleStatus } {
  return { featureId: registration.manifest.id, lifecycleStatus: registration.lifecycleStatus };
}

function cloneManifest(manifest: FeatureManifest): FeatureManifest { return structuredClone(manifest); }

function cloneRegistrationMap(source: ReadonlyMap<FeatureManifestId, MutableRegistration>): Map<FeatureManifestId, MutableRegistration> {
  return new Map([...source].map(([id, registration]) => [id, {
    ...registration,
    warnings: structuredClone(registration.warnings) as FeatureWarning[],
    recoverableErrors: structuredClone(registration.recoverableErrors) as FeatureFailureInformation[],
    completedExecutionIds: new Set(registration.completedExecutionIds),
  }]));
}

function cloneRuntimeMetadata(registration: MutableRegistration): FeatureRuntimeMetadata {
  return {
    enabled: registration.enabled,
    lifecycleStatus: registration.lifecycleStatus,
    executionCount: registration.executionCount,
    lastExecutionOrder: registration.lastExecutionOrder,
    warnings: structuredClone(registration.warnings),
    recoverableErrors: structuredClone(registration.recoverableErrors),
    completedExecutionIds: [...registration.completedExecutionIds].sort(compareAscii),
  };
}

function defaultRuntimeMetadata(enabled: boolean): FeatureRuntimeMetadata {
  return { enabled, lifecycleStatus: enabled ? "registered" : "disabled", executionCount: 0, lastExecutionOrder: null, warnings: [], recoverableErrors: [], completedExecutionIds: [] };
}

function conflictIds(error: FeatureSdkError): readonly FeatureManifestId[] {
  const ids = [error.featureId, error.context?.conflictingFeatureId]
    .filter((id): id is FeatureManifestId => typeof id === "string")
    .sort(compareAscii);
  return ids;
}

function canonical(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareAscii(left, right)).map(([key, item]) => [key, sortValue(item)]));
  return value;
}
