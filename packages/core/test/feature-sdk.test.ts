import { describe, expect, it, vi } from "vitest";
import {
  FEATURE_DEBUG_EVENT_NAMES,
  FEATURE_SDK_EXAMPLE_ENGINE_ID,
  FEATURE_SDK_EXAMPLE_MANIFESTS,
  FeatureDebugAdapter,
  FeatureLoader,
  FeatureRegistry,
  FeatureRunner,
  FeatureSerializer,
  ManifestRegistry,
  SequenceRandomSource,
  createExampleFeatureRegistrations,
  createFeatureContext,
  eventId,
  gameManifestId,
  roundId,
} from "../src/index.js";

function runtime(): FeatureRegistry {
  const manifests = new ManifestRegistry();
  manifests.registerMany(FEATURE_SDK_EXAMPLE_MANIFESTS);
  const registry = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID, manifestRegistry: manifests });
  registry.registerMany(createExampleFeatureRegistrations());
  return registry;
}

function input(tick = 1) {
  return {
    roundId: roundId("public-round"),
    eventId: eventId("public-event"),
    engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
    gameId: gameManifestId("feature-sdk-playground-game"),
    currentLifecycleState: "received" as const,
    roundData: { source: "public-contract-test" },
    sharedPresentationState: {},
    random: new SequenceRandomSource([0.1, 0.2, 0.3]),
    logicalTick: tick,
  };
}

describe("Feature SDK public contract", () => {
  it("registers all six manifest-backed architectural examples", () => {
    const registry = runtime();
    expect(registry.list().map(({ manifest }) => manifest.id)).toEqual([
      "clamp-feature", "collector-feature", "five-star-feature", "hold-and-win-feature",
      "shortcut-feature", "sticky-wild-feature",
    ]);
    expect(registry.executionOrder()).toEqual([
      "shortcut-feature", "clamp-feature", "five-star-feature", "sticky-wild-feature",
      "collector-feature", "hold-and-win-feature",
    ]);
  });

  it("loads implementation and manifest pairs through FeatureLoader", async () => {
    const registry = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID });
    const sources = createExampleFeatureRegistrations().map((registration) => () => registration);
    expect(await new FeatureLoader().load(registry, sources)).toHaveLength(6);
    expect(registry.list()).toHaveLength(6);
  });

  it("creates an immutable context with caller-supplied deterministic values", () => {
    const random = new SequenceRandomSource([0.25, 0.75]);
    const context = createFeatureContext({
      featureId: "shortcut-feature", roundId: "round", eventId: "event",
      engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID, gameId: "feature-sdk-playground-game",
      currentLifecycleState: "received", roundData: { nested: { stable: true } },
      random, logicalTick: 7,
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.roundData)).toBe(true);
    expect(context.random.nextInt(0, 4)).toBe(1);
    const cursor = random.snapshot(); random.next(); random.restore(cursor);
    expect(random.next()).toBe(0.75);
  });

  it("executes placeholder results without directly running animation commands", async () => {
    const registry = runtime();
    const runner = new FeatureRunner(registry);
    await runner.initializeRound(input());
    const result = await runner.execute(input());
    expect(result.triggeredFeatureIds).toHaveLength(6);
    expect(result.result.animationCommands).toHaveLength(6);
    expect(registry.getState("shortcut-feature")).toMatchObject({ triggerCount: 1 });
  });

  it("serializes a stable, versioned snapshot and restores it", async () => {
    const registry = runtime(); const runner = new FeatureRunner(registry); const serializer = new FeatureSerializer();
    await runner.execute(input());
    const context = { engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID, gameId: "feature-sdk-playground-game", roundId: "public-round", eventId: "public-event", logicalTick: 1, executionLedger: runner.executionLedger };
    const json = serializer.serialize(registry, context);
    await registry.resetRuntimeState(); runner.clearExecutionLedger();
    const restored = await serializer.restore(registry, json);
    runner.restoreExecutionLedger(restored.executionLedger);
    expect(registry.getState("shortcut-feature")).toMatchObject({ triggerCount: 1 });
    expect((await runner.execute(input())).triggeredFeatureIds).toEqual([]);
  });

  it("exposes all fourteen typed feature event names", () => {
    expect(FEATURE_DEBUG_EVENT_NAMES).toHaveLength(14);
    expect(new Set(FEATURE_DEBUG_EVENT_NAMES).size).toBe(14);
  });

  it("projects feature state through a DOM-free debug adapter", async () => {
    const registry = runtime(); const adapter = new FeatureDebugAdapter(registry);
    const listener = vi.fn(); registry.events.subscribe("feature:disabled", listener);
    adapter.actions.disable("sticky-wild-feature");
    const snapshot = adapter.snapshot();
    expect(snapshot.registeredFeatures).toHaveLength(6);
    expect(snapshot.registeredFeatures.find(({ id }) => id === "sticky-wild-feature")?.enabled).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    adapter.destroy();
  });
});
