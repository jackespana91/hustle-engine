import { describe, expect, it, vi } from "vitest";
import { TypedEventBus } from "../src/index.js";

describe("TypedEventBus", () => {
  it("supports subscribe, unsubscribe, once, publish and clear", () => {
    const bus = new TypedEventBus<{ value: number }>();
    const persistent = vi.fn();
    const once = vi.fn();
    const unsubscribe = bus.subscribe("value", persistent);
    bus.once("value", once);
    bus.publish("value", 1); bus.publish("value", 2);
    unsubscribe(); bus.clear(); bus.publish("value", 3);
    expect(persistent.mock.calls).toEqual([[1], [2]]);
    expect(once).toHaveBeenCalledOnce();
  });
});
