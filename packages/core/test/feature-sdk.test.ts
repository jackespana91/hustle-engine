import { describe, expect, it } from "vitest";
import {
  FeatureLoader,
  FeatureRegistry,
  FeatureSdkError,
  FeatureSerializer,
  createFeatureContext,
  createPlaceholderFeatures,
  featureId,
  type Feature,
  type FeatureContext,
  type FeatureMetadata,
  type FeatureState,
} from "../src/index.js";

class TestFeature implements Feature {
  readonly calls: string[] = [];
  private state: FeatureState = { value: 0 };

  constructor(
    id: string,
    priority: number,
    dependencies: readonly string[] = [],
    engines: readonly string[] = ["test"],
  ) {
    this.metadata = {
      id: featureId(id), name: id, version: "1.0.0", description: `${id} test feature`,
      supportedEngines: engines, dependencies: dependencies.map(featureId), priority,
    };
  }

  readonly metadata: FeatureMetadata;
  initialize(): void { this.calls.push("initialize"); }
  canTrigger(): boolean { this.calls.push("canTrigger"); return true; }
  trigger(): void { this.calls.push("trigger"); this.state = { value: Number(this.state.value) + 1 }; }
  update(_context: FeatureContext, _deltaMs: number): void { this.calls.push("update"); }
  serialize(): FeatureState { return { ...this.state }; }
  deserialize(state: FeatureState): void { this.calls.push("deserialize"); this.state = { ...state }; }
  cleanup(): void { this.calls.push("cleanup"); }
}

const context = createFeatureContext({ engineId: "test" });

describe("Feature SDK", () => {
  it("registers and discovers features by engine compatibility", () => {
    const registry = new FeatureRegistry();
    registry.register(new TestFeature("shared", 1, [], ["*"]));
    registry.register(new TestFeature("specific", 1, [], ["other"]));
    expect(registry.list().map(({ feature }) => feature.metadata.id)).toEqual(["shared", "specific"]);
    expect(registry.discover("test").map(({ feature }) => feature.metadata.id)).toEqual(["shared"]);
  });

  it("rejects duplicate registration", () => {
    const registry = new FeatureRegistry();
    registry.register(new TestFeature("duplicate", 1));
    expect(() => registry.register(new TestFeature("duplicate", 2))).toThrowError(FeatureSdkError);
  });

  it("orders dependencies first, then priority and registration order", () => {
    const registry = new FeatureRegistry();
    registry.register(new TestFeature("low", 10));
    registry.register(new TestFeature("high-first", 90));
    registry.register(new TestFeature("high-second", 90));
    registry.register(new TestFeature("dependent", 100, ["low"]));
    expect(registry.executionOrder("test")).toEqual(["high-first", "high-second", "low", "dependent"]);
  });

  it("serializes feature state and enabled flags deterministically", async () => {
    const registry = new FeatureRegistry();
    const feature = new TestFeature("serial", 1);
    registry.register(feature);
    await registry.trigger(context);
    registry.setEnabled(featureId("serial"), false);
    const serializer = new FeatureSerializer();
    expect(serializer.serialize(registry, "test")).toEqual({
      schemaVersion: 1,
      engineId: "test",
      features: [{ id: "serial", version: "1.0.0", enabled: false, state: { value: 1 } }],
    });
  });

  it("deserializes state into a fresh registered implementation", () => {
    const source = new FeatureRegistry();
    const sourceFeature = new TestFeature("restore", 1);
    source.register(sourceFeature);
    sourceFeature.deserialize({ value: 7 });
    const serializer = new FeatureSerializer();
    const snapshot = serializer.serialize(source, "test");

    const restored = new FeatureRegistry();
    const restoredFeature = new TestFeature("restore", 1);
    restored.register(restoredFeature);
    serializer.deserialize(restored, JSON.stringify(snapshot));
    expect(restoredFeature.serialize()).toEqual({ value: 7 });
    expect(restoredFeature.calls).toContain("deserialize");
  });

  it("validates missing dependencies and cycles", () => {
    const missing = new FeatureRegistry();
    missing.register(new TestFeature("dependent", 1, ["absent"]));
    expect(() => missing.validateDependencies()).toThrowError(/missing dependency/i);

    const cycle = new FeatureRegistry();
    cycle.register(new TestFeature("one", 1, ["two"]));
    cycle.register(new TestFeature("two", 1, ["one"]));
    expect(() => cycle.validateDependencies()).toThrowError(/cycle/i);
  });

  it("runs lifecycle methods deterministically and cleans up in reverse order", async () => {
    const registry = new FeatureRegistry();
    const first = new TestFeature("first", 10);
    const second = new TestFeature("second", 5, ["first"]);
    registry.register(first); registry.register(second);
    expect(await registry.initialize(context)).toEqual(["first", "second"]);
    expect((await registry.trigger(context)).triggered).toEqual(["first", "second"]);
    expect(await registry.update(context, 16)).toEqual(["first", "second"]);
    expect(await registry.cleanup(context)).toEqual(["second", "first"]);
    expect(first.calls).toEqual(["initialize", "canTrigger", "trigger", "update", "cleanup"]);
    expect(registry.get(featureId("first"))?.lifecycle).toBe("cleaned");
  });

  it("loads placeholder feature sources sequentially", async () => {
    const registry = new FeatureRegistry();
    const loaded = await new FeatureLoader().load(registry, createPlaceholderFeatures());
    expect(loaded).toHaveLength(6);
    expect(registry.executionOrder("playground")).toEqual([
      "shortcut", "clamp", "five-star", "sticky-wild", "collector", "hold-and-win",
    ]);
  });
});
