import { describe, expect, it, vi } from "vitest";
import {
  animationId,
  type AnimationCommand,
} from "../src/contracts.js";
import { SequenceRandomSource, type FeatureContext } from "../src/features/feature-context.js";
import { FeatureSdkError } from "../src/features/feature-errors.js";
import { FeatureRegistry } from "../src/features/feature-registry.js";
import {
  FeatureRunner,
  type FeatureRunnerContextInput,
} from "../src/features/feature-runner.js";
import {
  createFeatureResult,
  type FeatureFailurePolicy,
  type FeatureHookResult,
  type FeatureImplementation,
  type FeatureState,
} from "../src/features/feature-types.js";
import {
  MANIFEST_SCHEMA_VERSION,
  engineManifestId,
  featureManifestId,
  type FeatureManifest,
  type FeatureManifestId,
} from "../src/manifests/manifest-types.js";

const ENGINE_ID = engineManifestId("runner-test-engine");

interface TestFeatureState extends FeatureState {
  readonly initialized: number;
  readonly triggered: number;
  readonly updated: number;
  readonly completed: number;
  readonly cleaned: boolean;
  readonly randomValue: number | null;
}

interface TestFeatureOptions {
  readonly priority?: number;
  readonly dependencies?: readonly FeatureManifestId[];
  readonly failurePolicy?: FeatureFailurePolicy;
  readonly eligible?: boolean;
  readonly fail?: "initialize" | "can-trigger" | "trigger" | "update" | "complete-round" | "cleanup";
  readonly output?: boolean;
  readonly useRandom?: boolean;
  readonly deferredTrigger?: boolean;
  readonly calls?: string[];
}

class TestFeature implements FeatureImplementation<TestFeatureState> {
  readonly id: FeatureManifestId;
  readonly version = "1.0.0";
  readonly stateVersion = "1.0.0";
  readonly failurePolicy: FeatureFailurePolicy;
  readonly manifest: FeatureManifest;
  private stateValue: TestFeatureState = initialState();
  private triggerRelease: (() => void) | null = null;
  private triggerStartedResolve: (() => void) | null = null;
  private readonly triggerStartedValue: Promise<void>;

  constructor(id: string, private readonly options: TestFeatureOptions = {}) {
    this.id = featureManifestId(id);
    this.failurePolicy = options.failurePolicy ?? "blocking";
    this.manifest = featureManifest(id, options);
    this.triggerStartedValue = new Promise((resolve) => { this.triggerStartedResolve = resolve; });
  }

  initialize(): FeatureHookResult<TestFeatureState> {
    this.call("initialize");
    this.stateValue = { ...this.stateValue, initialized: this.stateValue.initialized + 1 };
    this.throwIf("initialize");
    return createFeatureResult({ telemetry: { initialized: this.stateValue.initialized } });
  }

  canTrigger(): boolean {
    this.call("can-trigger");
    this.throwIf("can-trigger");
    return this.options.eligible ?? true;
  }

  async trigger(context: FeatureContext<TestFeatureState>): Promise<ReturnType<typeof createFeatureResult<TestFeatureState>>> {
    this.call("trigger");
    this.triggerStartedResolve?.();
    if (this.options.deferredTrigger === true) {
      await new Promise<void>((resolve) => { this.triggerRelease = resolve; });
    }
    const randomValue = this.options.useRandom === true ? context.random.nextInt(0, 100) : this.stateValue.randomValue;
    this.stateValue = {
      ...this.stateValue,
      triggered: this.stateValue.triggered + 1,
      randomValue,
    };
    this.throwIf("trigger");
    if (this.options.output !== true) return createFeatureResult({ triggered: true });

    context.emit(`${this.id}:context-event`, { count: this.stateValue.triggered });
    const command: AnimationCommand = {
      id: animationId(`${this.id}:${context.roundId}:${context.eventId}`),
      type: "feature-placeholder",
      durationMs: 0,
      payload: { featureId: this.id },
      skippable: true,
      blocking: true,
    };
    return createFeatureResult({
      triggered: true,
      emittedEvents: [{ name: `${this.id}:returned-event`, payload: { count: this.stateValue.triggered } }],
      animationCommands: [command],
      sharedStateProposals: [{ key: `${this.id}.visible`, value: true, strategy: "replace" }],
      warnings: [{ code: "PLACEHOLDER", message: `${this.id} is an architectural example` }],
      telemetry: { triggerCount: this.stateValue.triggered, randomValue },
    });
  }

  update(_context: FeatureContext<TestFeatureState>, _deltaMs: number): FeatureHookResult<TestFeatureState> {
    this.call("update");
    this.stateValue = { ...this.stateValue, updated: this.stateValue.updated + 1 };
    this.throwIf("update");
    return createFeatureResult({ telemetry: { updated: this.stateValue.updated } });
  }

  serialize(): TestFeatureState { return structuredClone(this.stateValue); }

  deserialize(state: TestFeatureState): void { this.stateValue = structuredClone(state); }

  interrupt(): FeatureHookResult<TestFeatureState> {
    this.call("interrupt");
    return createFeatureResult();
  }

  completeRound(): FeatureHookResult<TestFeatureState> {
    this.call("complete-round");
    this.stateValue = { ...this.stateValue, completed: this.stateValue.completed + 1 };
    this.throwIf("complete-round");
    return createFeatureResult({ telemetry: { completed: this.stateValue.completed } });
  }

  cleanup(): FeatureHookResult<TestFeatureState> {
    this.call("cleanup");
    this.stateValue = { ...this.stateValue, cleaned: true };
    this.throwIf("cleanup");
    return createFeatureResult();
  }

  waitUntilTriggerStarts(): Promise<void> { return this.triggerStartedValue; }

  releaseTrigger(): void { this.triggerRelease?.(); }

  private call(operation: string): void { this.options.calls?.push(`${this.id}:${operation}`); }

  private throwIf(operation: TestFeatureOptions["fail"]): void {
    if (this.options.fail === operation) throw new Error(`${this.id} ${operation} failure`);
  }
}

describe("FeatureRunner lifecycle", () => {
  it("initializes each enabled implementation once", async () => {
    const calls: string[] = [];
    const feature = new TestFeature("initialize-once", { calls });
    const { registry, runner } = setup(feature);

    await runner.initialize(context());
    const second = await runner.initialize(context());

    expect(calls).toEqual(["initialize-once:initialize"]);
    expect(registry.getState(feature.id)).toMatchObject({ initialized: 1 });
    expect(second.skippedFeatureIds).toEqual([feature.id]);
  });

  it("prepares deterministic per-round status after global initialization", async () => {
    const feature = new TestFeature("round-initialization");
    const { registry, runner } = setup(feature);

    const result = await runner.initializeRound(context());

    expect(result.records.map(({ operation }) => operation)).toEqual(["initialize", "initialize-round"]);
    expect(registry.require(feature.id).lifecycleStatus).toBe("ready");
  });

  it("skips trigger execution when canTrigger returns false and does not reevaluate a replay token", async () => {
    const calls: string[] = [];
    const feature = new TestFeature("not-eligible", { eligible: false, calls });
    const { runner } = setup(feature);
    const skipped = vi.fn();
    runner.registry.events.subscribe("feature:skipped", skipped);

    const first = await runner.trigger(context());
    const replay = await runner.trigger(context());

    expect(calls).toEqual(["not-eligible:can-trigger"]);
    expect(first.skippedFeatureIds).toEqual([feature.id]);
    expect(replay.skippedFeatureIds).toEqual([feature.id]);
    expect(skipped).toHaveBeenCalledTimes(2);
  });

  it("triggers multiple features in dependency-safe ascending-priority order", async () => {
    const calls: string[] = [];
    const alpha = new TestFeature("ordered-alpha", { priority: 20, calls });
    const beta = new TestFeature("ordered-beta", { priority: 10, calls });
    const dependent = new TestFeature("ordered-dependent", {
      priority: 0,
      dependencies: [alpha.id],
      calls,
    });
    const { runner } = setup(alpha, beta, dependent);

    const result = await runner.trigger(context());

    expect(result.executionOrder).toEqual([beta.id, alpha.id, dependent.id]);
    expect(result.triggeredFeatureIds).toEqual([beta.id, alpha.id, dependent.id]);
    expect(calls.filter((entry) => entry.endsWith(":trigger"))).toEqual([
      "ordered-beta:trigger",
      "ordered-alpha:trigger",
      "ordered-dependent:trigger",
    ]);
  });

  it("produces identical output from fresh runtimes with identical state, context, and supplied random values", async () => {
    const first = setup(new TestFeature("deterministic-feature", { output: true, useRandom: true }));
    const second = setup(new TestFeature("deterministic-feature", { output: true, useRandom: true }));

    const firstResult = await first.runner.trigger(context({ randomValues: [0.42] }));
    const secondResult = await second.runner.trigger(context({ randomValues: [0.42] }));

    expect(secondResult.result).toEqual(firstResult.result);
    expect(second.registry.getState("deterministic-feature")).toEqual(first.registry.getState("deterministic-feature"));
  });

  it("restores state and the replay ledger without duplicating a completed trigger", async () => {
    const sourceFeature = new TestFeature("restore-feature");
    const source = setup(sourceFeature);
    const input = context();
    await source.runner.trigger(input);
    const savedState = source.registry.getState(sourceFeature.id);
    const savedMetadata = source.registry.runtimeMetadata(sourceFeature.id);
    const savedLedger = source.runner.executionLedger;

    const restoredFeature = new TestFeature("restore-feature");
    const restored = setup(restoredFeature);
    await restored.registry.restoreStates([{ id: restoredFeature.id, state: savedState, metadata: savedMetadata }]);
    await restored.runner.recover(context({ lifecycle: "recovering" }), savedLedger);
    const replay = await restored.runner.trigger(input);

    expect(replay.triggeredFeatureIds).toEqual([]);
    expect(replay.skippedFeatureIds).toEqual([restoredFeature.id]);
    expect(restored.registry.getState(restoredFeature.id)).toEqual(savedState);
    expect(restored.registry.runtimeMetadata(restoredFeature.id).executionCount).toBe(1);
  });

  it("fails fast for a blocking feature and does not execute its required dependant", async () => {
    const calls: string[] = [];
    const blocking = new TestFeature("blocking-failure", { fail: "trigger", calls });
    const dependant = new TestFeature("blocking-dependant", { dependencies: [blocking.id], calls });
    const { runner } = setup(blocking, dependant);

    await expect(runner.trigger(context())).rejects.toMatchObject({ code: "TRIGGER_FAILURE" });
    expect(calls).toContain("blocking-failure:trigger");
    expect(calls).not.toContain("blocking-dependant:trigger");
  });

  it("isolates a non-blocking failure, restores its state, and continues independent features", async () => {
    const calls: string[] = [];
    const isolated = new TestFeature("isolated-failure", {
      failurePolicy: "non-blocking",
      fail: "trigger",
      priority: 1,
      calls,
    });
    const survivor = new TestFeature("isolated-survivor", { priority: 2, calls });
    const { registry, runner } = setup(isolated, survivor);

    const result = await runner.trigger(context());

    expect(result.failures).toHaveLength(1);
    expect(result.triggeredFeatureIds).toEqual([survivor.id]);
    expect(registry.getState(isolated.id)).toMatchObject({ triggered: 0 });
    expect(registry.getState(survivor.id)).toMatchObject({ triggered: 1 });
  });

  it("does not execute a required dependant after its non-blocking dependency fails", async () => {
    const calls: string[] = [];
    const dependency = new TestFeature("failed-dependency", {
      failurePolicy: "non-blocking",
      fail: "trigger",
      priority: 1,
      calls,
    });
    const dependant = new TestFeature("skipped-dependant", {
      dependencies: [dependency.id],
      priority: 2,
      calls,
    });
    const { runner } = setup(dependency, dependant);

    const result = await runner.trigger(context());

    expect(result.skippedFeatureIds).toContain(dependant.id);
    expect(calls).not.toContain("skipped-dependant:trigger");
  });

  it("updates once per logical tick and replays neither the hook nor state mutation", async () => {
    const calls: string[] = [];
    const feature = new TestFeature("update-feature", { calls });
    const { registry, runner } = setup(feature);

    await runner.update(context({ logicalTick: 10 }), 16);
    const replay = await runner.update(context({ logicalTick: 10 }), 16);
    await runner.update(context({ logicalTick: 11 }), 16);

    expect(calls.filter((entry) => entry.endsWith(":update"))).toHaveLength(2);
    expect(replay.skippedFeatureIds).toEqual([feature.id]);
    expect(registry.getState(feature.id)).toMatchObject({ updated: 2 });
  });

  it("invalidates an in-flight generation so late trigger state cannot commit after interruption", async () => {
    const feature = new TestFeature("interrupt-feature", { deferredTrigger: true });
    const { registry, runner } = setup(feature);
    const triggerRun = runner.trigger(context());
    await feature.waitUntilTriggerStarts();

    const interruptRun = runner.interrupt(context({ lifecycle: "interrupted", logicalTick: 2 }));
    feature.releaseTrigger();
    await Promise.all([triggerRun, interruptRun]);

    expect(registry.getState(feature.id)).toMatchObject({ triggered: 0 });
    expect(registry.require(feature.id).lifecycleStatus).toBe("interrupted");
  });

  it("runs the optional round-completion hook and records completed lifecycle state", async () => {
    const feature = new TestFeature("completion-feature");
    const { registry, runner } = setup(feature);

    const result = await runner.completeRound(context({ lifecycle: "completed" }));

    expect(result.executedFeatureIds).toEqual([feature.id]);
    expect(registry.getState(feature.id)).toMatchObject({ completed: 1 });
    expect(registry.require(feature.id).lifecycleStatus).toBe("completed");
  });

  it("cleans features in reverse deterministic execution order", async () => {
    const calls: string[] = [];
    const first = new TestFeature("cleanup-first", { priority: 1, calls });
    const second = new TestFeature("cleanup-second", { priority: 2, calls });
    const third = new TestFeature("cleanup-third", { priority: 3, calls });
    const { runner } = setup(first, second, third);

    await runner.cleanup(context());

    expect(calls.filter((entry) => entry.endsWith(":cleanup"))).toEqual([
      "cleanup-third:cleanup",
      "cleanup-second:cleanup",
      "cleanup-first:cleanup",
    ]);
  });

  it("attempts every cleanup even when a blocking cleanup fails", async () => {
    const calls: string[] = [];
    const first = new TestFeature("cleanup-all-first", { priority: 1, calls });
    const failing = new TestFeature("cleanup-all-failing", { priority: 2, fail: "cleanup", calls });
    const third = new TestFeature("cleanup-all-third", { priority: 3, calls });
    const { runner } = setup(first, failing, third);

    await expect(runner.cleanup(context())).rejects.toMatchObject({ code: "CLEANUP_FAILURE" });
    expect(calls.filter((entry) => entry.endsWith(":cleanup"))).toEqual([
      "cleanup-all-third:cleanup",
      "cleanup-all-failing:cleanup",
      "cleanup-all-first:cleanup",
    ]);
  });

  it("publishes typed lifecycle events for initialization, triggering, completion, failure, skip, and cleanup", async () => {
    const registry = new FeatureRegistry({ engineId: ENGINE_ID });
    const events: string[] = [];
    const names = [
      "feature:registered",
      "feature:initialized",
      "feature:triggered",
      "feature:completed",
      "feature:skipped",
      "feature:failed",
      "feature:cleanup-completed",
    ] as const;
    names.forEach((name) => registry.events.subscribe(name, () => events.push(name)));
    const success = new TestFeature("event-success");
    const skipped = new TestFeature("event-skipped", { eligible: false });
    const failed = new TestFeature("event-failed", { failurePolicy: "non-blocking", fail: "trigger" });
    registry.registerMany([
      { implementation: success, manifest: success.manifest },
      { implementation: skipped, manifest: skipped.manifest },
      { implementation: failed, manifest: failed.manifest },
    ]);
    const runner = new FeatureRunner(registry);

    await runner.initialize(context());
    await runner.trigger(context());
    await runner.cleanup(context({ logicalTick: 3 }));

    expect(events).toEqual(expect.arrayContaining([...names]));
  });

  it("aggregates emitted events, animation commands, shared proposals, warnings, and telemetry without executing UI work", async () => {
    const first = new TestFeature("aggregate-first", { priority: 1, output: true });
    const second = new TestFeature("aggregate-second", { priority: 2, output: true });
    const { runner } = setup(first, second);

    const result = await runner.trigger(context());

    expect(result.result.emittedEvents.map(({ name }) => name)).toEqual([
      "aggregate-first:context-event",
      "aggregate-first:returned-event",
      "aggregate-second:context-event",
      "aggregate-second:returned-event",
    ]);
    expect(result.result.animationCommands.map(({ id }) => id)).toHaveLength(2);
    expect(result.result.sharedStateProposals).toHaveLength(2);
    expect(result.result.warnings).toHaveLength(2);
    expect(result.result.telemetry).toMatchObject({
      "aggregate-first.triggerCount": 1,
      "aggregate-second.triggerCount": 1,
    });
  });
});

function setup(...features: readonly TestFeature[]): { readonly registry: FeatureRegistry; readonly runner: FeatureRunner } {
  const registry = new FeatureRegistry({ engineId: ENGINE_ID });
  registry.registerMany(features.map((feature) => ({ implementation: feature, manifest: feature.manifest })));
  return { registry, runner: new FeatureRunner(registry) };
}

function featureManifest(id: string, options: TestFeatureOptions): FeatureManifest {
  return {
    manifestType: "feature",
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id: featureManifestId(id),
    name: id,
    version: "1.0.0",
    description: `${id} runner test feature`,
    supportedEngineIds: [ENGINE_ID],
    dependencies: options.dependencies ?? [],
    optionalDependencies: [],
    conflicts: [],
    priority: options.priority ?? 10,
    deterministic: true,
    stateVersion: "1.0.0",
    failurePolicy: options.failurePolicy ?? "blocking",
    metadata: { test: true },
  };
}

function initialState(): TestFeatureState {
  return {
    initialized: 0,
    triggered: 0,
    updated: 0,
    completed: 0,
    cleaned: false,
    randomValue: null,
  };
}

function context(options: {
  readonly randomValues?: readonly number[];
  readonly lifecycle?: FeatureRunnerContextInput["currentLifecycleState"];
  readonly logicalTick?: number;
} = {}): FeatureRunnerContextInput {
  return {
    roundId: "runner-round",
    eventId: "runner-event",
    engineId: ENGINE_ID,
    gameId: "runner-game",
    currentLifecycleState: options.lifecycle ?? "received",
    roundData: { source: "runner-test" },
    sharedPresentationState: { visible: true },
    random: new SequenceRandomSource(options.randomValues ?? [0.1, 0.2, 0.3, 0.4]),
    logicalTick: options.logicalTick ?? 1,
    metadata: { test: true },
  };
}
