import { describe, expect, it } from "vitest";
import {
  FEATURE_SDK_EXAMPLE_ENGINE_ID,
  FeatureRegistry,
  FeatureRunner,
  OutcomeBuilder,
  OutcomeComparator,
  OutcomeDebugAdapter,
  OutcomePlayer,
  OutcomeRegistry,
  OutcomeReplay,
  OutcomeScenarioLibrary,
  OutcomeSystemError,
  OutcomeValidator,
  createExampleFeatureRegistrations,
  createOutcomeEvent,
  createSetReferenceResolver,
  normalizeOutcome,
  outcomeEventId,
  parseOutcome,
  parseReplay,
  safeParseOutcome,
  safeParseReplay,
  serializeOutcome,
  serializeReplay,
  stableSerialize,
  type AnimationCommand,
  type AnimationExecutionContext,
  type AnimationExecutor,
  type OutcomeDefinition,
  type OutcomeEvent,
  type OutcomeReplayRecord,
} from "../src/index.js";

class TestExecutor implements AnimationExecutor {
  readonly calls = new Map<string, number>();
  constructor(private readonly delayMs = 0, private readonly failType?: string) {}
  async execute(command: AnimationCommand, context: AnimationExecutionContext): Promise<void> {
    this.calls.set(command.id, (this.calls.get(command.id) ?? 0) + 1);
    if (command.type === this.failType) throw new Error(`Deliberate animation failure: ${command.type}`);
    if (this.delayMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      context.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    });
  }
}

const library = () => new OutcomeScenarioLibrary();
const outcome = (id: string): OutcomeDefinition => library().require(id).outcome as OutcomeDefinition;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("OutcomeDefinition validation and normalization", () => {
  it("accepts a valid, versioned outcome", () => {
    const result = new OutcomeValidator().validate(outcome("tiny-success"));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns structured errors for malformed outcomes", () => {
    const result = new OutcomeValidator().validate(library().require("malformed-outcome").outcome);
    expect(result.valid).toBe(false);
    expect(result.errors.map(({ code }) => code)).toContain("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects duplicate event ids", () => {
    const value = outcome("tiny-success");
    const duplicate = { ...value, events: [value.events[0], { ...value.events[1], id: value.events[0]?.id }] };
    expect(new OutcomeValidator().validate(duplicate).errors.some(({ code }) => code === "DUPLICATE_EVENT_ID")).toBe(true);
  });

  it("rejects invalid sequence order", () => {
    const result = new OutcomeValidator().validate(library().require("invalid-event-ordering").outcome);
    expect(result.errors.some(({ code }) => code === "NON_DETERMINISTIC_ORDER" || code === "INVALID_SEQUENCE")).toBe(true);
  });

  it("rejects a later unresolved dependency", () => {
    const value = outcome("tiny-success");
    const events = value.events.map((event, index) => index === 0 ? { ...event, dependsOn: [value.events[1]?.id] } : event);
    expect(new OutcomeValidator().validate({ ...value, events }).errors.some(({ code }) => code === "LATE_EVENT_DEPENDENCY")).toBe(true);
  });

  it("detects circular dependencies", () => {
    const value = outcome("tiny-success");
    const events = value.events.map((event, index) => ({ ...event, dependsOn: [value.events[index === 0 ? 1 : 0]?.id] }));
    expect(new OutcomeValidator().validate({ ...value, sequencePolicy: "explicit", events }).errors.some(({ code }) => code === "CIRCULAR_EVENT_DEPENDENCY")).toBe(true);
  });

  it("checks declared total-win consistency without floating point money", () => {
    const value = outcome("tiny-success");
    const result = new OutcomeValidator().validate({ ...value, totalWinMinor: value.totalWinMinor + 1 });
    expect(result.errors.some(({ code }) => code === "TOTAL_WIN_MISMATCH")).toBe(true);
  });

  it("validates engine, game, feature, asset and theme references when a resolver is supplied", () => {
    const value = outcome("feature-enabled");
    const validator = new OutcomeValidator({ references: createSetReferenceResolver({
      engines: [String(value.engineId)], games: [String(value.gameId)],
      features: ["shortcut-feature"], assets: [], themes: ["outcome-studio-theme"],
    }) });
    expect(validator.validate(value).valid).toBe(true);
    expect(validator.validate({ ...value, engineId: "missing-engine" }).errors[0]?.code).toBe("INVALID_ENGINE_REFERENCE");
  });

  it("normalizes deterministically", () => {
    const value = outcome("medium-success");
    const reversed = { ...value, tags: [...value.tags].reverse(), events: [...value.events].reverse() };
    const first = normalizeOutcome(reversed as OutcomeDefinition);
    const second = normalizeOutcome(reversed as OutcomeDefinition);
    expect(serializeOutcome(first)).toBe(serializeOutcome(second));
    expect(first.events[0]?.sequence).toBe(0);
  });
});

describe("OutcomeBuilder and OutcomeRegistry", () => {
  it("adds, edits, removes and safely reorders events", () => {
    const builder = OutcomeBuilder.from(outcome("medium-success"));
    const extra = createOutcomeEvent({ id: outcomeEventId("extra-event"), type: "extra", logicalTick: 100, winAmountMinor: 10 });
    builder.addEvent(extra).updateEvent("extra-event", { expectedStateChanges: { extra: true } });
    expect(builder.snapshot().events.at(-1)?.id).toBe("extra-event");
    builder.reorderEvent("extra-event", builder.snapshot().events.length - 1);
    builder.removeEvent("extra-event");
    expect(builder.finalize().events.some(({ id }) => id === "extra-event")).toBe(false);
  });

  it("preserves the previous valid draft after a failed edit", () => {
    const builder = OutcomeBuilder.from(outcome("tiny-success"));
    const before = serializeOutcome(builder.snapshot());
    expect(() => builder.addEvent({ ...builder.snapshot().events[0] } as OutcomeEvent)).toThrow(OutcomeSystemError);
    expect(serializeOutcome(builder.snapshot())).toBe(before);
  });

  it("clones outcomes with new identities", () => {
    const clone = OutcomeBuilder.from(outcome("tiny-success")).clone("tiny-copy", "tiny-copy-round").finalize();
    expect(clone.id).toBe("tiny-copy");
    expect(clone.metadata.clonedFrom).toBe("tiny-success");
  });

  it("supports registry operations and filters", () => {
    const registry = new OutcomeRegistry();
    registry.registerMany([outcome("tiny-success"), outcome("zero-win")]);
    expect(registry.has("tiny-success")).toBe(true);
    expect(registry.filterByTag("zero-win")).toHaveLength(1);
    expect(registry.filterByEngine("outcome-studio-engine")).toHaveLength(2);
    expect(registry.snapshot().outcomes).toHaveLength(2);
    expect(registry.unregister("tiny-success")?.id).toBe("tiny-success");
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it("rejects duplicate registration atomically", () => {
    const registry = new OutcomeRegistry();
    registry.register(outcome("tiny-success"));
    expect(() => registry.registerMany([outcome("zero-win"), outcome("tiny-success")])).toThrow(OutcomeSystemError);
    expect(registry.list().map(({ id }) => id)).toEqual(["tiny-success"]);
  });

  it("replaces atomically and preserves the old value after invalid replacement", () => {
    const registry = new OutcomeRegistry();
    const original = outcome("tiny-success");
    registry.register(original);
    expect(() => registry.replace({ ...original, totalWinMinor: -1 })).toThrow();
    expect(registry.require("tiny-success").totalWinMinor).toBe(original.totalWinMinor);
    registry.replace({ ...original, description: "Updated atomically" });
    expect(registry.require("tiny-success").description).toBe("Updated atomically");
  });
});

describe("OutcomePlayer lifecycle, recovery and integrations", () => {
  it("plays a successful outcome through the Core lifecycle", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor() });
    const result = await player.play(outcome("tiny-success"));
    expect(result.status).toBe("completed");
    expect(player.state.lifecycleState).toBe("completed");
    expect(player.state.actualState).toEqual(outcome("tiny-success").expectedFinalState);
  });

  it("plays a zero-win outcome", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor() });
    const result = await player.play(outcome("zero-win"));
    expect(result.status).toBe("completed");
    expect(player.state.actualTotalMinor).toBe(0);
  });

  it("pauses and resumes playback", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor(15) });
    const running = player.play(outcome("medium-success"));
    await wait(5); player.pause();
    expect(player.state.status).toBe("paused");
    player.resume();
    expect((await running).status).toBe("completed");
  });

  it("skips the current animation", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor(20) });
    const running = player.play(outcome("medium-success"));
    await wait(5); player.skipCurrent();
    expect((await running).status).toBe("completed");
  });

  it("skips all skippable animations", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor(20) });
    const running = player.play(outcome("medium-success"));
    await wait(5); player.skipAll();
    expect((await running).status).toBe("completed");
  });

  it("interrupts and recovers without replaying completed commands", async () => {
    const executor = new TestExecutor(15);
    const player = new OutcomePlayer({ executor });
    const running = player.play(outcome("interrupted-recovery"));
    await wait(50);
    const snapshot = await player.interrupt();
    expect((await running).status).toBe("interrupted");
    const completedBefore = snapshot.completedCommands.map(({ id }) => String(id));
    const recovered = await player.recover(snapshot);
    expect(recovered.status).toBe("completed");
    completedBefore.forEach((id) => expect(executor.calls.get(id)).toBe(1));
    expect(recovered.record.execution.recoveries).toHaveLength(1);
  });

  it("invokes compatible Feature SDK placeholders deterministically", async () => {
    const registry = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID });
    registry.registerMany(createExampleFeatureRegistrations());
    const runner = new FeatureRunner(registry);
    const value = { ...outcome("feature-enabled"), engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID };
    const result = await new OutcomePlayer({ executor: new TestExecutor(), featureRunner: runner }).play(value);
    expect(result.status).toBe("completed");
    expect(result.record.execution.featureExecutions.length).toBeGreaterThan(0);
    expect(result.record.execution.animationCommands.some(({ type }) => type === "feature-example")).toBe(true);
  });

  it("continues after optional asset preparation failure", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor(), prepareEvent: (event) => {
      if (event.metadata.simulateAssetFailure === true) throw new Error("optional unavailable");
    } });
    const result = await player.play(outcome("optional-asset-failure"));
    expect(result.status).toBe("completed");
    expect(result.record.execution.warnings[0]?.code).toBe("OPTIONAL_ASSET_FAILURE");
  });

  it("fails after required asset preparation failure", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor(), prepareEvent: (event) => {
      if (event.metadata.simulateAssetFailure === true) throw new Error("required unavailable");
    } });
    const result = await player.play(outcome("required-asset-failure"));
    expect(result.status).toBe("failed");
    expect(result.record.execution.errors.at(-1)?.message).toContain("Required event preparation failed");
  });

  it("records animation execution failure", async () => {
    const result = await new OutcomePlayer({ executor: new TestExecutor(0, "outcome-animation-failure") }).play(outcome("animation-failure"));
    expect(result.status).toBe("failed");
    expect(result.record.execution.errors.length).toBeGreaterThan(0);
  });

  it("records events, commands, transitions, final state and logical timings", async () => {
    const result = await new OutcomePlayer({ executor: new TestExecutor() }).play(outcome("medium-success"));
    expect(result.record.execution.normalizedEvents).toHaveLength(6);
    expect(result.record.execution.animationCommands.length).toBeGreaterThan(6);
    expect(result.record.execution.stateTransitions.length).toBeGreaterThan(0);
    expect(result.record.execution.eventPublications.filter(({ name }) => name === "outcome:event-completed")).toHaveLength(6);
    expect(result.record.execution.finalState).toEqual(outcome("medium-success").expectedFinalState);
  });
});

describe("Outcome replay, comparison and serialization", () => {
  it("replays deterministically without a network call", async () => {
    const source = await new OutcomePlayer({ executor: new TestExecutor() }).play(outcome("medium-success"));
    const replay = new OutcomeReplay(() => new OutcomePlayer({ executor: new TestExecutor() }));
    const actual = await replay.replay(source.record);
    expect(new OutcomeComparator().compareReplays(source.record, actual.record).equal).toBe(true);
  });

  it("replays from a selected event boundary", async () => {
    const source = await new OutcomePlayer({ executor: new TestExecutor() }).play(outcome("medium-success"));
    const actual = await new OutcomeReplay(() => new OutcomePlayer({ executor: new TestExecutor() })).replayFromEvent(source.record, 3);
    expect(actual.status).toBe("completed");
    expect(actual.record.execution.eventPublications.filter(({ name }) => name === "outcome:event-completed")).toHaveLength(3);
    expect(actual.record.execution.finalState).toEqual(source.record.outcome.expectedFinalState);
  });

  it("replays from a recovery snapshot", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor(10) });
    const running = player.play(outcome("interrupted-recovery"));
    await wait(35); const snapshot = await player.interrupt(); await running;
    const completed = await player.recover(snapshot);
    const replayed = await new OutcomeReplay(() => new OutcomePlayer({ executor: new TestExecutor() })).replayFromSnapshot(completed.record);
    expect(replayed.status).toBe("completed");
    expect(replayed.record.execution.completedAnimationCommandIds.length).toBeGreaterThan(snapshot.completedCommands.length);
  });

  it("rejects unsupported replay versions", async () => {
    const source = await new OutcomePlayer({ executor: new TestExecutor() }).play(outcome("tiny-success"));
    const incompatible = { ...source.record, schemaVersion: 99 } as unknown as OutcomeReplayRecord;
    await expect(new OutcomeReplay(() => new OutcomePlayer({ executor: new TestExecutor() })).replay(incompatible)).rejects.toThrow("Unsupported replay version");
  });

  it("detects divergence and reports the first location", async () => {
    const first = await new OutcomePlayer({ executor: new TestExecutor() }).play(outcome("tiny-success"));
    const second = structuredClone(first.record);
    (second.execution.finalState as Record<string, unknown>).completedEvents = 999;
    const comparison = new OutcomeComparator().compareReplays(first.record, second);
    expect(comparison.equal).toBe(false);
    expect(comparison.firstDivergence?.category).toBe("final-state");
    expect(comparison.firstDivergence?.path).toBe("execution.finalState");
  });

  it("stable-serializes outcomes regardless of object key insertion order", () => {
    const value = outcome("tiny-success");
    expect(stableSerialize({ b: 2, a: 1 })).toBe(stableSerialize({ a: 1, b: 2 }));
    expect(serializeOutcome(parseOutcome(serializeOutcome(value)))).toBe(serializeOutcome(value));
  });

  it("round-trips replay records", async () => {
    const record = (await new OutcomePlayer({ executor: new TestExecutor() }).play(outcome("tiny-success"))).record;
    expect(serializeReplay(parseReplay(serializeReplay(record)))).toBe(serializeReplay(record));
  });

  it("safely reports malformed JSON", () => {
    expect(safeParseOutcome("{").ok).toBe(false);
    expect(safeParseReplay("{").ok).toBe(false);
  });
});

describe("Debug adapter and Playground scenario library", () => {
  it("adapts player state for the shared Debug Panel", async () => {
    const player = new OutcomePlayer({ executor: new TestExecutor() });
    const debug = new OutcomeDebugAdapter(player);
    await player.play(outcome("tiny-success"));
    const snapshot = debug.snapshot();
    expect(snapshot.activeOutcome).toBe("tiny-success");
    expect(snapshot.commandCount).toBeGreaterThan(0);
    expect(snapshot.validationStatus).toContain("Valid");
    expect(snapshot.divergenceStatus).toBe("matching");
    debug.destroy();
  });

  it("loads, searches, filters and duplicates Playground scenarios", () => {
    const scenarios = library();
    expect(scenarios.list()).toHaveLength(12);
    expect(scenarios.search("recovery").length).toBeGreaterThan(0);
    expect(scenarios.filter({ tag: "failure" }).length).toBeGreaterThan(0);
    const copy = scenarios.duplicate("tiny-success");
    expect(copy.id).toBe("tiny-success-copy-1");
    expect((copy.outcome as OutcomeDefinition).id).toBe("tiny-success-copy-1");
    const divergence = outcome("replay-divergence");
    expect(new OutcomeValidator().validate(divergence).valid).toBe(true);
    expect(divergence.metadata.simulateReplayDivergence).toBe(true);
  });
});
