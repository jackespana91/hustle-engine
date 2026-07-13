import { describe, expect, it } from "vitest";
import { ManifestValidator, createFeatureResult } from "@hustle/core";
import {
  ROUTERUN_ASSET_ALIASES, ROUTERUN_ENGINE_ID, ROUTERUN_MANIFEST, ROUTERUN_SCENARIOS,
  RouteRunDebugAdapter, RouteRunEngine, SequenceRefillProvider, adaptRouteRunOutcome,
  compareRouteResolutions, createExampleRouteRunOutcome, type RouteRunFeatureBridge, type RouteRunFeatureHook,
} from "../src/index.js";

const scenario = (id: string) => ROUTERUN_SCENARIOS.find((entry) => entry.id === id)!;

describe("RouteRun Core integration", () => {
  it("uses legal Runner placement and ordered movement", () => {
    const selected = scenario("destination-reached");
    const engine = new RouteRunEngine();
    engine.initialize(selected.board, selected.runner);
    engine.previewRoute();
    engine.playRoute();
    expect(engine.inspect().completedRouteSteps.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(engine.inspect().runner?.movementStatus).toBe("destination");
  });

  it("rejects illegal Runner placement", () => {
    const selected = scenario("destination-reached");
    const engine = new RouteRunEngine();
    engine.initialize(selected.board);
    expect(() => engine.placeRunner({ ...selected.runner, coordinate: { row: 0, column: 1 } })).toThrow();
  });

  it("collects overlays in route order and accumulates illustrative value", () => {
    const selected = scenario("overlay-collection");
    const engine = new RouteRunEngine();
    engine.initialize(selected.board, selected.runner);
    engine.previewRoute(selected.solverOptions);
    engine.playRoute();
    const inspection = engine.inspect();
    expect(inspection.collectedOverlays.map(({ routeStepSequence }) => routeStepSequence)).toEqual([1, 2, 3]);
    expect(inspection.runner?.accumulatedPresentationValue).toBe(1_500);
  });

  it("retains persistent overlays", () => {
    const selected = structuredClone(scenario("overlay-collection"));
    const cell = selected.board.cells[1]!;
    const persistent = { ...cell.overlays[0]!, persistent: true };
    const board = { ...selected.board, cells: selected.board.cells.map((entry, index) => index === 1 ? { ...entry, overlays: [persistent] } : entry) };
    const engine = new RouteRunEngine();
    engine.initialize(board, selected.runner);
    engine.previewRoute(); engine.playRoute();
    expect(engine.inspect().board?.cells[1]?.overlays).toHaveLength(1);
  });

  it("publishes typed lifecycle events and data-only animation commands", () => {
    const selected = scenario("straight-route");
    const engine = new RouteRunEngine();
    const events: string[] = [];
    engine.events.subscribe("routerun.runner.move", ({ event }) => events.push(event.type));
    engine.initialize(selected.board, selected.runner); engine.previewRoute(); engine.playRoute();
    expect(events).toHaveLength(3);
    expect(engine.inspect().animationCommands.every(({ type }) => type.startsWith("routerun."))).toBe(true);
  });

  it("invokes Feature SDK bridge hooks in deterministic order", () => {
    const hooks: RouteRunFeatureHook[] = [];
    const bridge: RouteRunFeatureBridge = { execute: (hook) => { hooks.push(hook); return createFeatureResult(); } };
    const selected = scenario("straight-route");
    const engine = new RouteRunEngine({ featureBridge: bridge });
    engine.initialize(selected.board, selected.runner); engine.previewRoute(); engine.playRoute();
    expect(hooks.slice(0, 4)).toEqual(["before-board-created", "after-board-created", "before-route-solved", "after-route-solved"]);
    expect(hooks).toContain("after-route-step");
    expect(hooks.slice(-2)).toEqual(["before-terminal", "after-terminal"]);
  });

  it("exposes a valid real RouteRun manifest", () => {
    expect(ROUTERUN_ENGINE_ID).toBe("engine.routerun");
    expect(ROUTERUN_MANIFEST).toMatchObject({ name: "RouteRun", version: "0.1.0", engineType: "route", status: "development" });
    expect(new ManifestValidator().validate(ROUTERUN_MANIFEST).valid).toBe(true);
  });

  it("uses logical asset aliases only", () => {
    expect(Object.entries(ROUTERUN_ASSET_ALIASES).every(([alias, value]) => alias === value && !value.includes("/"))).toBe(true);
  });

  it("translates the engine timeline for Outcome Studio", () => {
    const selected = scenario("destination-reached");
    const engine = new RouteRunEngine();
    engine.initialize(selected.board, selected.runner); engine.previewRoute(); engine.playRoute();
    const adapted = createExampleRouteRunOutcome(engine.inspect());
    expect(adapted.definition.engineId).toBe("engine.routerun");
    expect(adapted.definition.events.some(({ type }) => type === "routerun.runner.move")).toBe(true);
  });

  it("adapts an explicit deterministic outcome", () => {
    const adapted = adaptRouteRunOutcome({ id: "route-outcome", roundReference: "route-round", name: "Route", description: "Diagnostic", events: [], expectedFinalState: {} });
    expect(adapted.definition.metadata.production).toBe(false);
  });

  it("replays deterministically and detects divergence", () => {
    const selected = scenario("deterministic-t-junction");
    const run = () => { const engine = new RouteRunEngine(); engine.initialize(selected.board, selected.runner); return engine.previewRoute(selected.solverOptions); };
    expect(compareRouteResolutions(run(), run()).equal).toBe(true);
  });

  it("interrupts and restores without duplicate steps or overlays", () => {
    const selected = scenario("interrupt-recovery");
    const engine = new RouteRunEngine();
    engine.initialize(selected.board, selected.runner); engine.previewRoute(); engine.playRoute({ maximumNewSteps: 2 });
    const snapshot = engine.interrupt();
    const restored = new RouteRunEngine();
    restored.restoreSnapshot(snapshot); restored.playRoute();
    const inspection = restored.inspect();
    expect(new Set(inspection.completedRouteSteps.map(({ sequence }) => sequence)).size).toBe(inspection.completedRouteSteps.length);
    expect(new Set(inspection.collectedOverlays.map(({ overlayId }) => overlayId)).size).toBe(inspection.collectedOverlays.length);
  });

  it("does not duplicate a completed cascade after restore", () => {
    const selected = scenario("clear-downward-cascade");
    const engine = new RouteRunEngine();
    engine.initialize(selected.board, selected.runner); engine.previewRoute(); engine.playRoute(); engine.clearRoute();
    engine.applyCascade(new SequenceRefillProvider(selected.refillData!));
    const restored = new RouteRunEngine(); restored.restoreSnapshot(engine.createSnapshot());
    expect(restored.inspect().completedCascades).toHaveLength(1);
  });

  it("preserves expansion in snapshots", () => {
    const selected = scenario("sealed-side-expansion");
    const engine = new RouteRunEngine(); engine.initialize(selected.board, selected.runner); engine.applyExpansion(selected.expansion!);
    const restored = new RouteRunEngine(); restored.restoreSnapshot(engine.createSnapshot());
    expect(restored.inspect().activeExpansions[0]?.expansionId).toBe("activate-east-side");
  });

  it("rejects unsupported snapshots while preserving valid live state", () => {
    const selected = scenario("straight-route");
    const engine = new RouteRunEngine(); engine.initialize(selected.board, selected.runner);
    const before = engine.inspect();
    const bad = { ...engine.createSnapshot(), schemaVersion: 99 } as never;
    expect(() => engine.restoreSnapshot(bad)).toThrow();
    expect(engine.inspect().board).toEqual(before.board);
  });

  it("enforces maximum cascade protection", () => {
    const selected = scenario("clear-downward-cascade");
    const engine = new RouteRunEngine({ limits: { maximumCascadeCount: 1 } });
    engine.initialize({ ...selected.board, maximumCascadeCount: 1 }, selected.runner);
    engine.previewRoute(); engine.playRoute(); engine.clearRoute(); engine.applyCascade(new SequenceRefillProvider(selected.refillData!));
    expect(() => engine.applyCascade(new SequenceRefillProvider(selected.refillData!))).toThrow();
  });

  it("provides a Debug Panel adapter", () => {
    const selected = scenario("mobile-readable-5x5");
    const engine = new RouteRunEngine(); engine.initialize(selected.board, selected.runner); engine.previewRoute();
    expect(new RouteRunDebugAdapter(() => engine.inspect()).getState()).toMatchObject({ boardSize: "5×5", engineVersion: "0.1.0" });
  });

  it("ships exactly fifteen non-production diagnostic scenarios", () => {
    expect(ROUTERUN_SCENARIOS).toHaveLength(15);
    expect(scenario("mobile-readable-5x5").board).toMatchObject({ width: 5, height: 5 });
  });
});
