import { describe, expect, it, vi } from "vitest";
import type { FeatureContext } from "../src/features/feature-context.js";
import { SequenceRandomSource, createFeatureContext } from "../src/features/feature-context.js";
import { FeatureSdkError } from "../src/features/feature-errors.js";
import {
  FeatureRegistry,
  type FeatureRegistrationInput,
} from "../src/features/feature-registry.js";
import {
  FeatureSerializer,
  type FeatureSnapshotContext,
} from "../src/features/feature-serializer.js";
import { FeatureStateMigrationRegistry } from "../src/features/feature-state.js";
import type {
  FeatureFailurePolicy,
  FeatureImplementation,
  FeatureState,
} from "../src/features/feature-types.js";
import {
  CLAMP_FEATURE_SDK_MANIFEST,
  FEATURE_SDK_EXAMPLE_ENGINE_ID,
  FEATURE_SDK_EXAMPLE_MANIFESTS,
  FEATURE_SDK_EXAMPLE_FEATURE_MANIFESTS,
  SHORTCUT_FEATURE_SDK_MANIFEST,
  ShortcutFeature,
  createCircularDependencyFeatureExample,
  createConflictingFeatureExample,
  createExampleFeatureRegistrations,
  createMissingDependencyFeatureExample,
  type PlaceholderFeatureState,
} from "../src/features/examples/index.js";
import { ManifestRegistry } from "../src/manifests/manifest-registry.js";
import {
  MANIFEST_SCHEMA_VERSION,
  featureManifestId,
  type FeatureManifest,
  type FeatureManifestId,
} from "../src/manifests/manifest-types.js";

const SNAPSHOT_CONTEXT: FeatureSnapshotContext = {
  engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
  gameId: "feature-sdk-test-game",
  roundId: "round-001",
  eventId: "event-001",
  logicalTick: 42,
  executionLedger: [],
};

class TestFeature implements FeatureImplementation {
  readonly failurePolicy: FeatureFailurePolicy;
  private state: FeatureState;

  constructor(
    readonly id: FeatureManifestId,
    readonly version = "1.0.0",
    readonly stateVersion = "1.0.0",
    initialState: FeatureState = { value: 0 },
    failurePolicy: FeatureFailurePolicy = "blocking",
    private readonly failAfterValue?: number,
  ) {
    this.state = structuredClone(initialState);
    this.failurePolicy = failurePolicy;
  }

  initialize(_context: FeatureContext): void {}
  canTrigger(_context: FeatureContext): boolean { return true; }
  trigger(_context: FeatureContext): void { this.state = { value: Number(this.state.value) + 1 }; }
  update(_context: FeatureContext, _deltaMs: number): void {}
  serialize(): FeatureState { return structuredClone(this.state); }
  deserialize(state: FeatureState): void {
    this.state = structuredClone(state);
    if (this.failAfterValue !== undefined && state.value === this.failAfterValue) {
      throw new Error(`Rejected state value ${this.failAfterValue}`);
    }
  }
  cleanup(_context: FeatureContext): void {}
}

interface RegistrationOptions {
  readonly priority?: number;
  readonly dependencies?: readonly FeatureManifestId[];
  readonly optionalDependencies?: readonly FeatureManifestId[];
  readonly conflicts?: readonly FeatureManifestId[];
  readonly enabled?: boolean;
  readonly implementationId?: FeatureManifestId;
  readonly implementationVersion?: string;
  readonly manifestVersion?: string;
  readonly implementationStateVersion?: string;
  readonly manifestStateVersion?: string;
  readonly implementationFailurePolicy?: FeatureFailurePolicy;
  readonly manifestFailurePolicy?: FeatureFailurePolicy;
  readonly initialState?: FeatureState;
  readonly failAfterValue?: number;
}

describe("canonical Feature SDK registry and recovery", () => {
  it("registers a valid implementation with its separate manifest", () => {
    const registry = createRegistry();
    const registered = vi.fn();
    registry.events.subscribe("feature:registered", registered);
    const input = registration("valid-feature");

    registry.register(input.implementation, input.manifest);

    expect(registry.require(input.manifest.id)).toMatchObject({ enabled: true, lifecycleStatus: "registered" });
    expect(registered).toHaveBeenCalledOnce();
    expect(registered.mock.calls[0]?.[0].manifest.id).toBe(input.manifest.id);
  });

  it("rejects duplicate registration without changing the existing entry", () => {
    const registry = createRegistry();
    const input = registration("duplicate-feature");
    registry.register(input.implementation, input.manifest);

    expectFeatureError(() => registry.register(registration("duplicate-feature").implementation, input.manifest), "DUPLICATE_FEATURE");
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects an implementation and manifest ID mismatch", () => {
    const registry = createRegistry();
    const input = registration("declared-feature", { implementationId: featureManifestId("different-feature") });
    expectFeatureError(() => registry.register(input.implementation, input.manifest), "IMPLEMENTATION_MANIFEST_MISMATCH");
  });

  it("rejects an implementation and manifest version mismatch", () => {
    const registry = createRegistry();
    const input = registration("version-feature", { implementationVersion: "1.1.0", manifestVersion: "1.0.0" });
    expectFeatureError(() => registry.register(input.implementation, input.manifest), "IMPLEMENTATION_MANIFEST_MISMATCH");
  });

  it("rejects state-version and failure-policy binding mismatches", () => {
    const stateMismatch = registration("state-version-feature", {
      implementationStateVersion: "2.0.0",
      manifestStateVersion: "1.0.0",
    });
    expectFeatureError(() => createRegistry().register(stateMismatch.implementation, stateMismatch.manifest), "IMPLEMENTATION_MANIFEST_MISMATCH");

    const policyMismatch = registration("policy-feature", {
      implementationFailurePolicy: "non-blocking",
      manifestFailurePolicy: "blocking",
    });
    expectFeatureError(() => createRegistry().register(policyMismatch.implementation, policyMismatch.manifest), "IMPLEMENTATION_MANIFEST_MISMATCH");
  });

  it("orders ready features by ascending priority", () => {
    const registry = createRegistry();
    registry.registerMany([
      registration("priority-high", { priority: 90 }),
      registration("priority-low", { priority: 10 }),
      registration("priority-middle", { priority: 50 }),
    ]);
    expect(registry.executionOrder()).toEqual(["priority-low", "priority-middle", "priority-high"]);
  });

  it("uses ASCII feature ID as the only stable priority tie-breaker", () => {
    const registry = createRegistry();
    registry.registerMany([
      registration("tie-zeta", { priority: 10 }),
      registration("tie-alpha", { priority: 10 }),
      registration("tie-beta", { priority: 10 }),
    ]);
    expect(registry.executionOrder()).toEqual(["tie-alpha", "tie-beta", "tie-zeta"]);
  });

  it("always places dependencies before dependants regardless of priority", () => {
    const dependencyId = featureManifestId("late-priority-dependency");
    const registry = createRegistry();
    registry.registerMany([
      registration(String(dependencyId), { priority: 100 }),
      registration("early-priority-dependent", { priority: 1, dependencies: [dependencyId] }),
    ]);
    expect(registry.executionOrder()).toEqual([dependencyId, "early-priority-dependent"]);
  });

  it("enables and disables an independent feature transactionally", () => {
    const registry = createRegistry();
    const input = registration("toggle-feature");
    const disabled = vi.fn(); const enabled = vi.fn();
    registry.events.subscribe("feature:disabled", disabled);
    registry.events.subscribe("feature:enabled", enabled);
    registry.register(input.implementation, input.manifest);

    registry.disable(input.manifest.id);
    expect(registry.isEnabled(input.manifest.id)).toBe(false);
    expect(registry.executionOrder()).toEqual([]);
    registry.enable(input.manifest.id);
    expect(registry.isEnabled(input.manifest.id)).toBe(true);
    expect(disabled).toHaveBeenCalledOnce();
    expect(enabled).toHaveBeenCalledOnce();
  });

  it("rejects registration for an incompatible engine", () => {
    const registry = new FeatureRegistry({ engineId: "different-engine" });
    const input = registration("engine-bound-feature");
    expectFeatureError(() => registry.register(input.implementation, input.manifest), "UNSUPPORTED_ENGINE");
  });

  it("rejects a missing required dependency atomically", () => {
    const registry = createRegistry();
    expectFeatureError(() => registry.registerMany(createMissingDependencyFeatureExample()), "MISSING_DEPENDENCY");
    expect(registry.list()).toEqual([]);
  });

  it("rejects a circular dependency graph atomically", () => {
    const registry = createRegistry();
    expectFeatureError(() => registry.registerMany(createCircularDependencyFeatureExample()), "CIRCULAR_DEPENDENCY");
    expect(registry.list()).toEqual([]);
  });

  it("rejects active conflicts including one-sided declarations", () => {
    const registry = createRegistry();
    const conflictEvent = vi.fn();
    registry.events.subscribe("feature:conflict-detected", conflictEvent);
    expectFeatureError(() => registry.registerMany(createConflictingFeatureExample()), "FEATURE_CONFLICT");
    expect(conflictEvent).toHaveBeenCalledOnce();
    expect(registry.list()).toEqual([]);
  });

  it("produces identical stable JSON regardless of registration and object-key order", async () => {
    const first = createRegistry();
    const second = createRegistry();
    const alpha = registration("stable-alpha");
    const beta = registration("stable-beta");
    first.registerMany([beta, alpha]);
    second.registerMany([registration("stable-alpha"), registration("stable-beta")]);
    await first.replaceState(alpha.manifest.id, { zeta: 2, alpha: 1 });
    await second.replaceState(alpha.manifest.id, { alpha: 1, zeta: 2 });
    const serializer = new FeatureSerializer();

    expect(serializer.serialize(first, SNAPSHOT_CONTEXT)).toBe(serializer.serialize(second, SNAPSHOT_CONTEXT));
  });

  it("serializes disabled registrations and publishes typed serialized events", () => {
    const registry = createRegistry();
    const input = registration("disabled-snapshot-feature");
    registry.register(input.implementation, input.manifest);
    registry.disable(input.manifest.id);
    const serializedEvent = vi.fn();
    registry.events.subscribe("feature:state-serialized", serializedEvent);

    const snapshot = new FeatureSerializer().createSnapshot(registry, SNAPSHOT_CONTEXT);

    expect(snapshot.features).toHaveLength(1);
    expect(snapshot.features[0]).toMatchObject({ featureId: input.manifest.id, enabled: false, lifecycleStatus: "disabled" });
    expect(serializedEvent).toHaveBeenCalledOnce();
  });

  it("deserializes complete state and runtime metadata exactly", async () => {
    const input = registration("round-trip-feature");
    const source = createRegistry(); source.register(input.implementation, input.manifest);
    await source.replaceState(input.manifest.id, { value: 27, nested: { beta: 2, alpha: 1 } });
    source.setLifecycle(input.manifest.id, "completed");
    source.markExecution(input.manifest.id, 3, "round-001:event-001:round-trip-feature");
    source.addWarning(input.manifest.id, { code: "EXAMPLE", message: "Recoverable example warning" });
    const serializer = new FeatureSerializer();
    const json = serializer.serialize(source, SNAPSHOT_CONTEXT);

    const targetInput = registration("round-trip-feature");
    const target = createRegistry(); target.register(targetInput.implementation, targetInput.manifest);
    const restoredEvent = vi.fn(); target.events.subscribe("feature:state-restored", restoredEvent);
    await serializer.deserialize(target, json, { gameId: SNAPSHOT_CONTEXT.gameId });

    expect(target.getState(input.manifest.id)).toEqual({ value: 27, nested: { beta: 2, alpha: 1 } });
    expect(target.runtimeMetadata(input.manifest.id)).toMatchObject({
      lifecycleStatus: "completed", executionCount: 1, lastExecutionOrder: 3,
      completedExecutionIds: ["round-001:event-001:round-trip-feature"],
    });
    expect(restoredEvent).toHaveBeenCalledOnce();
  });

  it("rejects an incompatible state version when no migration exists", async () => {
    const input = registration("state-rejection-feature");
    const source = createRegistry(); source.register(input.implementation, input.manifest);
    const snapshot = new FeatureSerializer().createSnapshot(source, SNAPSHOT_CONTEXT);
    const incompatible = replaceSnapshotFeature(snapshot, input.manifest.id, { stateVersion: "0.9.0" });

    const targetInput = registration("state-rejection-feature");
    const target = createRegistry(); target.register(targetInput.implementation, targetInput.manifest);
    await expect(new FeatureSerializer().restore(target, incompatible)).rejects.toMatchObject({ code: "MIGRATION_NOT_FOUND" });
  });

  it("rejects an incompatible implementation version before mutation", async () => {
    const input = registration("implementation-version-feature");
    const source = createRegistry(); source.register(input.implementation, input.manifest);
    const snapshot = new FeatureSerializer().createSnapshot(source, SNAPSHOT_CONTEXT);
    const incompatible = replaceSnapshotFeature(snapshot, input.manifest.id, { featureVersion: "2.0.0" });

    const targetInput = registration("implementation-version-feature", { initialState: { value: 8 } });
    const target = createRegistry(); target.register(targetInput.implementation, targetInput.manifest);
    await expect(new FeatureSerializer().restore(target, incompatible)).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
    expect(target.getState(input.manifest.id)).toEqual({ value: 8 });
  });

  it("requires exact registered-feature coverage during recovery", async () => {
    const registry = createRegistry();
    const alpha = registration("coverage-alpha"); const beta = registration("coverage-beta");
    registry.registerMany([alpha, beta]);
    const snapshot = new FeatureSerializer().createSnapshot(registry, SNAPSHOT_CONTEXT);
    const missing = { ...snapshot, features: snapshot.features.filter(({ featureId }) => featureId !== beta.manifest.id) };

    await expect(new FeatureSerializer().restore(registry, missing)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("restores the exact saved snapshot into a fresh equivalent registry", async () => {
    const sourceInputs = [registration("exact-alpha"), registration("exact-beta")];
    const source = createRegistry(); source.registerMany(sourceInputs);
    await source.replaceState(sourceInputs[0]!.manifest.id, { value: 11 });
    source.markExecution(sourceInputs[0]!.manifest.id, 0, "exact-execution");
    const serializer = new FeatureSerializer();
    const saved = serializer.createSnapshot(source, SNAPSHOT_CONTEXT);

    const target = createRegistry(); target.registerMany([registration("exact-alpha"), registration("exact-beta")]);
    const restored = await serializer.restore(target, serializer.serializeSnapshot(saved));

    expect(serializer.serializeSnapshot(restored)).toBe(serializer.serializeSnapshot(saved));
    expect(target.getState("exact-alpha")).toEqual({ value: 11 });
  });

  it("preserves the prior valid runtime when implementation deserialization fails", async () => {
    const sourceInput = registration("transaction-feature");
    const source = createRegistry(); source.register(sourceInput.implementation, sourceInput.manifest);
    const snapshot = new FeatureSerializer().createSnapshot(source, SNAPSHOT_CONTEXT);
    const failingSnapshot = replaceSnapshotFeature(snapshot, sourceInput.manifest.id, { serializedState: { value: 999 } });

    const targetInput = registration("transaction-feature", { initialState: { value: 5 }, failAfterValue: 999 });
    const target = createRegistry(); target.register(targetInput.implementation, targetInput.manifest);
    await expect(new FeatureSerializer().restore(target, failingSnapshot)).rejects.toMatchObject({ code: "RECOVERY_FAILED" });
    expect(target.getState(targetInput.manifest.id)).toEqual({ value: 5 });
    expect(target.runtimeMetadata(targetInput.manifest.id)).toMatchObject({ executionCount: 0, lifecycleStatus: "registered" });
  });

  it("migrates serialized state before applying it transactionally", async () => {
    const input = registration("migration-feature");
    const source = createRegistry(); source.register(input.implementation, input.manifest);
    const snapshot = new FeatureSerializer().createSnapshot(source, SNAPSHOT_CONTEXT);
    const legacy = replaceSnapshotFeature(snapshot, input.manifest.id, {
      stateVersion: "0.5.0",
      serializedState: { legacyValue: 73 },
    });
    const migrations = new FeatureStateMigrationRegistry();
    migrations.register({
      featureId: input.manifest.id,
      fromStateVersion: "0.5.0",
      toStateVersion: "1.0.0",
      migrate: (state) => ({ value: Number(state.legacyValue) }),
    });
    const targetInput = registration("migration-feature");
    const target = createRegistry(); target.register(targetInput.implementation, targetInput.manifest);

    const restored = await new FeatureSerializer(migrations).restore(target, legacy);

    expect(target.getState(input.manifest.id)).toEqual({ value: 73 });
    expect(restored.features[0]?.stateVersion).toBe("1.0.0");
  });

  it("preserves replay ledgers and completed execution tokens", async () => {
    const input = registration("ledger-feature");
    const source = createRegistry(); source.register(input.implementation, input.manifest);
    source.markExecution(input.manifest.id, 0, "feature-execution-token");
    const context = { ...SNAPSHOT_CONTEXT, executionLedger: ["round-ledger-token"] };
    const serializer = new FeatureSerializer();
    const snapshot = serializer.createSnapshot(source, context);
    expect(snapshot.executionLedger).toEqual(["round-ledger-token", "feature-execution-token"]);

    const targetInput = registration("ledger-feature");
    const target = createRegistry(); target.register(targetInput.implementation, targetInput.manifest);
    const restored = await serializer.restore(target, snapshot);
    expect(restored.executionLedger).toEqual(snapshot.executionLedger);
    expect(target.hasCompletedExecution(input.manifest.id, "feature-execution-token")).toBe(true);
  });

  it("provides six matching non-production placeholder manifests and implementations", () => {
    const inputs = createExampleFeatureRegistrations();
    expect(inputs).toHaveLength(6);
    expect(FEATURE_SDK_EXAMPLE_FEATURE_MANIFESTS).toHaveLength(6);
    for (const { implementation, manifest } of inputs) {
      expect(implementation.id).toBe(manifest.id);
      expect(implementation.version).toBe(manifest.version);
      expect(implementation.stateVersion).toBe(manifest.stateVersion);
      expect(manifest.metadata).toMatchObject({ example: true, production: false, gameplayImplemented: false });
    }
    const registry = createRegistry(); registry.registerMany(inputs);
    expect(registry.list()).toHaveLength(6);
  });

  it("keeps placeholder behavior deterministic and presentation-only", async () => {
    const feature = new ShortcutFeature();
    const context = createFeatureContext<PlaceholderFeatureState>({
      featureId: feature.id,
      roundId: "placeholder-round",
      eventId: "placeholder-event",
      engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
      gameId: "placeholder-game",
      currentLifecycleState: "presenting",
      getLocalState: () => feature.serialize(),
      random: new SequenceRandomSource([0.25]),
      logicalTick: 1,
    });

    const result = await feature.trigger(context);

    expect(result.triggered).toBe(true);
    expect(result.animationCommands).toHaveLength(1);
    expect(result.animationCommands[0]).toMatchObject({ type: "feature-example", blocking: false });
    expect(result.telemetry).toEqual({ triggerCount: 1 });
  });

  it("binds canonical features to the same manifests held by ManifestRegistry", () => {
    const manifests = new ManifestRegistry(); manifests.registerMany(FEATURE_SDK_EXAMPLE_MANIFESTS);
    const registry = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID, manifestRegistry: manifests });

    registry.registerMany(createExampleFeatureRegistrations());

    expect(registry.list().map(({ manifest }) => manifest.id)).toEqual(
      FEATURE_SDK_EXAMPLE_FEATURE_MANIFESTS.map(({ id }) => id).sort(),
    );
  });

  it("rejects a runtime manifest that differs from the ManifestRegistry copy", () => {
    const manifests = new ManifestRegistry(); manifests.registerMany(FEATURE_SDK_EXAMPLE_MANIFESTS);
    const registry = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID, manifestRegistry: manifests });
    const changed: FeatureManifest = { ...SHORTCUT_FEATURE_SDK_MANIFEST, description: "Changed after manifest registration" };

    expectFeatureError(() => registry.register(new ShortcutFeature(), changed), "MANIFEST_MISMATCH");
  });

  it("filters registrations by engine compatibility", () => {
    const registry = createRegistry();
    registry.registerMany([
      { implementation: new ShortcutFeature(), manifest: SHORTCUT_FEATURE_SDK_MANIFEST },
      { implementation: new (class extends TestFeature {
        constructor() { super(CLAMP_FEATURE_SDK_MANIFEST.id, "0.1.0"); }
      })(), manifest: CLAMP_FEATURE_SDK_MANIFEST },
    ]);
    expect(registry.filterByEngineCompatibility(FEATURE_SDK_EXAMPLE_ENGINE_ID)).toHaveLength(2);
    expect(registry.filterByEngineCompatibility("different-engine")).toEqual([]);
  });
});

function createRegistry(): FeatureRegistry {
  return new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID });
}

function registration(id: string, options: RegistrationOptions = {}): FeatureRegistrationInput {
  const manifestId = featureManifestId(id);
  const manifestVersion = options.manifestVersion ?? "1.0.0";
  const manifestStateVersion = options.manifestStateVersion ?? "1.0.0";
  const manifestFailurePolicy = options.manifestFailurePolicy ?? "blocking";
  const manifest: FeatureManifest = {
    manifestType: "feature",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id: manifestId,
    name: id,
    version: manifestVersion,
    description: `Test feature ${id}`,
    supportedEngineIds: [FEATURE_SDK_EXAMPLE_ENGINE_ID],
    dependencies: options.dependencies ?? [],
    optionalDependencies: options.optionalDependencies ?? [],
    conflicts: options.conflicts ?? [],
    failurePolicy: manifestFailurePolicy,
    priority: options.priority ?? 10,
    deterministic: true,
    stateVersion: manifestStateVersion,
    metadata: { test: true },
  };
  return {
    implementation: new TestFeature(
      options.implementationId ?? manifestId,
      options.implementationVersion ?? manifestVersion,
      options.implementationStateVersion ?? manifestStateVersion,
      options.initialState ?? { value: 0 },
      options.implementationFailurePolicy ?? manifestFailurePolicy,
      options.failAfterValue,
    ),
    manifest,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  };
}

function replaceSnapshotFeature(
  snapshot: ReturnType<FeatureSerializer["createSnapshot"]>,
  id: FeatureManifestId,
  replacement: Partial<(typeof snapshot.features)[number]>,
): ReturnType<FeatureSerializer["createSnapshot"]> {
  return {
    ...snapshot,
    features: snapshot.features.map((state) => state.featureId === id ? { ...state, ...replacement } : state),
  };
}

function expectFeatureError(action: () => unknown, code: FeatureSdkError["code"]): void {
  try { action(); }
  catch (error) {
    expect(error).toBeInstanceOf(FeatureSdkError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected FeatureSdkError ${code}`);
}
