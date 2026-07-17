import { describe, expect, it } from "vitest";
import {
  ManifestValidator,
  OutcomeValidator,
  SequenceRandomSource,
  ThemeRegistry,
  createFeatureContext,
} from "@hustle/core";
import { RouteRunEngine, SequenceRefillProvider } from "@hustle/routerun";
import {
  NIGHT_DROP_ASSET_MANIFEST,
  NIGHT_DROP_AUDIO_MANIFEST,
  NIGHT_DROP_FOUNDATION_THEME_MANIFEST,
  NIGHT_DROP_GAME_MANIFEST,
  NIGHT_DROP_MATH_MANIFEST,
  NIGHT_DROP_THEME_MANIFEST,
} from "../src/config/manifests.js";
import { NIGHT_DROP_ASSET_IDS, NIGHT_DROP_FEATURE_IDS } from "../src/config/ids.js";
import {
  NIGHT_DROP_CONTINUATION_REFILL,
  NIGHT_DROP_EXPANSION,
  NIGHT_DROP_SCENARIOS,
  getNightDropScenario,
} from "../src/board/night-drop-board.js";
import {
  ClampFeature,
  NIGHT_DROP_FEATURE_MANIFESTS,
  createNightDropFeaturePack,
  type NightDropFeatureState,
} from "../src/features/index.js";
import { NIGHT_DROP_OUTCOMES } from "../src/outcomes/night-drop-outcomes.js";
import { NightDropFoundationTheme, NightDropTheme, createNightDropThemeRuntime } from "../src/theme/night-drop-theme.js";

describe("Night Drop game-pack manifests", () => {
  const validator = new ManifestValidator();
  const manifests = [
    NIGHT_DROP_ASSET_MANIFEST,
    NIGHT_DROP_AUDIO_MANIFEST,
    NIGHT_DROP_FOUNDATION_THEME_MANIFEST,
    NIGHT_DROP_THEME_MANIFEST,
    NIGHT_DROP_MATH_MANIFEST,
    ...NIGHT_DROP_FEATURE_MANIFESTS,
    NIGHT_DROP_GAME_MANIFEST,
  ];

  it("validates every game-pack manifest", () => {
    manifests.forEach((manifest) => expect(validator.validate(manifest).errors).toEqual([]));
  });

  it("uses the required logical asset ids without filesystem paths", () => {
    expect(NIGHT_DROP_ASSET_MANIFEST.files.map(({ id }) => String(id))).toEqual(Object.values(NIGHT_DROP_ASSET_IDS));
    NIGHT_DROP_ASSET_MANIFEST.files.forEach((asset) => {
      expect(asset.path).toBe(String(asset.id));
      expect(asset.metadata.logicalOnly).toBe(true);
    });
  });

  it("keeps audio resources as placeholders", () => {
    const resources = [...NIGHT_DROP_AUDIO_MANIFEST.music, ...NIGHT_DROP_AUDIO_MANIFEST.soundEffects, ...NIGHT_DROP_AUDIO_MANIFEST.voicePacks];
    expect(resources.length).toBeGreaterThan(0);
    resources.forEach((resource) => expect(resource.metadata.placeholder).toBe(true));
  });
});

describe("NightDropTheme", () => {
  it("registers and resolves a token-driven game theme", () => {
    const { theme, runtime } = createNightDropThemeRuntime();
    expect(theme.appliedThemeIds).toEqual([NightDropFoundationTheme.id, NightDropTheme.id]);
    expect(runtime.resolveAlias("route.active")).toBe("#9b35ff");
    expect(runtime.resolveAssetAlias("character.runner")).toBe("character.dash");
  });

  it("is accepted by the shared Theme Registry", () => {
    const registry = new ThemeRegistry();
    expect(() => registry.registerMany([NightDropFoundationTheme, NightDropTheme])).not.toThrow();
  });
});

describe("Night Drop Feature SDK plugins", () => {
  it("registers all five in deterministic dependency order", () => {
    const pack = createNightDropFeaturePack();
    expect(pack.registry.list()).toHaveLength(5);
    expect(pack.registry.executionOrder().map(String)).toEqual([
      NIGHT_DROP_FEATURE_IDS.shortcut,
      NIGHT_DROP_FEATURE_IDS.fiveStar,
      NIGHT_DROP_FEATURE_IDS.clamp,
      NIGHT_DROP_FEATURE_IDS.priorityJobs,
      NIGHT_DROP_FEATURE_IDS.penthouseDrop,
    ]);
  });

  it("supports the complete lifecycle and serializable state", async () => {
    const feature = new ClampFeature();
    const context = createFeatureContext<NightDropFeatureState>({
      featureId: feature.id,
      roundId: "night-drop.round.test",
      eventId: "night-drop.event.test",
      engineId: "engine.routerun",
      gameId: "game.night-drop",
      currentLifecycleState: "presenting",
      roundData: { activeFeatures: [String(feature.id)] },
      random: new SequenceRandomSource([]),
      logicalTick: 2,
      getLocalState: () => feature.serialize(),
    });
    feature.initialize(context);
    expect(await feature.canTrigger(context)).toBe(true);
    expect((await feature.trigger(context))?.triggered).toBe(true);
    const saved = feature.serialize();
    expect(saved.triggers).toBe(1);
    feature.deserialize({ ...saved, triggers: 7 });
    expect(feature.serialize().triggers).toBe(7);
    feature.cleanup(context);
    expect(feature.serialize().cleaned).toBe(true);
  });

  it("routes Clamp presentation through the RouteRun Feature SDK bridge", () => {
    const scenario = getNightDropScenario("perfect-route");
    const pack = createNightDropFeaturePack();
    const engine = new RouteRunEngine({ featureBridge: pack.bridge });
    engine.initialize(scenario.board, scenario.runner, scenario.id);
    engine.previewRoute();
    engine.playRoute({ maximumNewSteps: 1 });
    const commands = engine.inspect().featureApplications.flatMap(({ animationCommands }) => animationCommands);
    expect(commands.some(({ type }) => type === "night-drop.clamp.arrive")).toBe(true);
    expect(commands.every(({ metadata }) => metadata?.gamePack === "night-drop")).toBe(true);
  });
});

describe("Night Drop RouteRun configuration", () => {
  it("uses 5x5 boards with exactly one destination", () => {
    NIGHT_DROP_SCENARIOS.forEach(({ board }) => {
      expect([board.width, board.height]).toEqual([5, 5]);
      expect(board.destinationPositions).toHaveLength(1);
      expect(board.metadata.continuationLimit).toBe(1);
    });
  });

  it("configures one simple expansion", () => {
    expect(NIGHT_DROP_EXPANSION.activations).toHaveLength(2);
    expect(NIGHT_DROP_EXPANSION.metadata.simpleExpansion).toBe(true);
    expect(NIGHT_DROP_SCENARIOS.filter(({ flags }) => flags.expansion).length).toBeGreaterThan(0);
  });

  it("executes exactly one deterministic continuation", () => {
    const scenario = getNightDropScenario("cascade");
    const engine = new RouteRunEngine();
    engine.initialize(scenario.board, scenario.runner, scenario.id);
    engine.previewRoute();
    engine.playRoute();
    engine.clearRoute();
    engine.applyCascade(new SequenceRefillProvider(NIGHT_DROP_CONTINUATION_REFILL));
    expect(engine.checkContinuation().available).toBe(true);
    engine.playRoute();
    expect(engine.inspect().completedCascades).toHaveLength(1);
    expect(engine.inspect().terminalState?.reason).toBe("destination-reached");
  });
});

describe("Night Drop Outcome Studio pack", () => {
  it("contains the ten requested deterministic outcomes", () => {
    expect(NIGHT_DROP_OUTCOMES.map(({ name }) => name)).toEqual([
      "Tiny Route", "Shortcut", "Long Route", "Clamp", "Expansion", "Cascade",
      "Priority Jobs", "Dead End", "Perfect Route", "Interrupted Route",
    ]);
  });

  it("validates every outcome and keeps them non-production", () => {
    const validator = new OutcomeValidator();
    NIGHT_DROP_OUTCOMES.forEach((outcome) => {
      expect(validator.validate(outcome).errors).toEqual([]);
      expect(outcome.metadata.production).toBe(false);
      expect(outcome.deterministicSource.type).toBe("reference");
    });
  });
});
