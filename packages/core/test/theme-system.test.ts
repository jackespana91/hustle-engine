import { describe, expect, it, vi } from "vitest";
import { assetFileId, assetManifestId, engineManifestId, gameManifestId, type ThemeManifest } from "../src/manifests/index.js";
import {
  HIGH_CONTRAST_THEME_EXAMPLE,
  HUSTLE_BASE_THEME_EXAMPLE,
  NIGHT_DROP_THEME_EXAMPLE,
  OPERATOR_OVERLAY_THEME_EXAMPLE,
  SEASONAL_OVERLAY_THEME_EXAMPLE,
  THEME_DEBUG_EVENT_NAMES,
  THEME_SCHEMA_VERSION,
  THEME_SYSTEM_EXAMPLES,
  THEME_SYSTEM_EXAMPLE_SELECTION,
  ThemeDebugAdapter,
  ThemeLoader,
  ThemeRegistry,
  ThemeResolver,
  ThemeRuntime,
  ThemeSerializer,
  ThemeSystemError,
  resolveSelection,
  themeDefinitionFromManifest,
  themeId,
  validateThemeDefinition,
  type ThemeDefinition,
  type ThemeLayer,
  type ThemeSelection,
  type ThemeValidationError,
} from "../src/themes/index.js";

const ENGINE = engineManifestId("theme-test-engine");
const GAME = gameManifestId("theme-test-game");
const OTHER_GAME = gameManifestId("other-test-game");

function definition(
  id: string,
  layer: ThemeLayer = "base",
  overrides: Partial<ThemeDefinition> = {},
): ThemeDefinition {
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: themeId(id),
    name: id,
    version: "1.0.0",
    stateVersion: "1.0.0",
    description: `${id} test theme`,
    layer,
    supportedEngineIds: [ENGINE],
    supportedGameIds: [],
    incompatibleGameIds: [],
    incompatibleThemeIds: [],
    tokens: { palette: { background: "#101010", foreground: "#ffffff" }, spacing: { medium: 16 } },
    aliases: { "semantic.surface": "palette.background" },
    assetAliases: {},
    metadata: { test: true },
    ...overrides,
  };
}

function capture(action: () => unknown): readonly ThemeValidationError[] {
  try { action(); throw new Error("Expected theme action to fail"); }
  catch (error) {
    if (error instanceof ThemeSystemError) return error.errors;
    throw error;
  }
}

function selection(base: ThemeDefinition, extras: Partial<ThemeSelection> = {}): ThemeSelection {
  return { engineId: ENGINE, gameId: GAME, base: base.id, ...extras };
}

describe("Hustle theme registry and validation", () => {
  it("registers valid themes in exact layer order and emits typed events", () => {
    const registry = new ThemeRegistry(); const listener = vi.fn();
    registry.events.subscribe("theme:registered", listener);
    registry.registerMany(THEME_SYSTEM_EXAMPLES);
    expect(registry.list().map(({ layer }) => layer)).toEqual(["base", "game", "operator", "seasonal", "accessibility"]);
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("rejects duplicate registration without mutating the registry", () => {
    const registry = new ThemeRegistry(); const base = definition("base-theme"); registry.register(base);
    const before = registry.snapshot();
    expect(capture(() => registry.register(base))[0]?.code).toBe("DUPLICATE_THEME");
    expect(registry.snapshot()).toEqual(before);
  });

  it("validates batches atomically", () => {
    const registry = new ThemeRegistry(); const valid = definition("valid-theme");
    const invalid = definition("invalid-child", "game", { parentId: themeId("missing-theme") });
    expect(capture(() => registry.registerMany([valid, invalid])).some(({ code }) => code === "MISSING_PARENT")).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it("returns frozen defensive definitions and snapshots", () => {
    const registry = new ThemeRegistry(); registry.register(definition("base-theme"));
    const read = registry.require("base-theme");
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.tokens.palette)).toBe(true);
    expect(Object.isFrozen(registry.snapshot())).toBe(true);
  });

  it("reports structured token errors for invalid keys, values and non-finite numbers", () => {
    const result = validateThemeDefinition({
      ...definition("bad-tokens"),
      tokens: { "Bad Key": "x", unsafe: Symbol("x"), size: Number.POSITIVE_INFINITY },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.filter(({ code }) => code === "INVALID_TOKEN")).toHaveLength(3);
    expect(result.errors.every(({ path }) => path.startsWith("tokens."))).toBe(true);
  });

  it("blocks prototype-pollution paths in nested tokens, aliases and manifest tokens", () => {
    const malicious = JSON.parse(JSON.stringify(definition("malicious-theme"))) as Record<string, unknown>;
    malicious.tokens = JSON.parse('{"palette":{"__proto__":{"polluted":true}}}');
    expect(capture(() => new ThemeRegistry().register(malicious as unknown as ThemeDefinition))[0]?.code).toBe("PROTOTYPE_POLLUTION");

    const badAlias = { ...definition("bad-alias"), aliases: { safe: "constructor.prototype" } };
    expect(capture(() => new ThemeRegistry().register(badAlias))[0]?.code).toBe("PROTOTYPE_POLLUTION");
    const badAssetAlias = { ...definition("bad-asset-alias"), assetAliases: JSON.parse('{"__proto__":"asset://bad"}') };
    expect(capture(() => new ThemeRegistry().register(badAssetAlias))[0]?.code).toBe("PROTOTYPE_POLLUTION");

    const manifest = manifestTheme({ "__proto__.polluted": "yes" });
    expect(capture(() => themeDefinitionFromManifest(manifest, { layer: "base" }))[0]?.code).toBe("PROTOTYPE_POLLUTION");
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  it("rejects missing parents and circular parent chains", () => {
    const missing = definition("child-theme", "game", { parentId: themeId("absent-theme") });
    expect(capture(() => new ThemeRegistry().register(missing))[0]?.code).toBe("MISSING_PARENT");

    const first = definition("first-theme", "base", { parentId: themeId("second-theme") });
    const second = definition("second-theme", "base", { parentId: first.id });
    expect(capture(() => new ThemeRegistry().registerMany([first, second])).some(({ code }) => code === "PARENT_CYCLE")).toBe(true);
  });

  it("rejects parents from later layers and parents with no shared engine", () => {
    const late = definition("late-theme", "operator");
    const child = definition("early-child", "game", { parentId: late.id });
    expect(capture(() => new ThemeRegistry().registerMany([late, child])).some(({ code }) => code === "INVALID_LAYER_ORDER")).toBe(true);

    const foreign = definition("foreign-base", "base", { supportedEngineIds: [engineManifestId("other-engine")] });
    const game = definition("game-theme", "game", { parentId: foreign.id });
    expect(capture(() => new ThemeRegistry().registerMany([foreign, game])).some(({ code }) => code === "INCOMPATIBLE_ENGINE")).toBe(true);
  });

  it("prevents removing a theme while registered children still depend on it", () => {
    const registry = new ThemeRegistry(); const base = definition("base-theme");
    registry.registerMany([base, definition("game-theme", "game", { parentId: base.id })]);
    expect(capture(() => registry.unregister(base.id))[0]?.code).toBe("MISSING_PARENT");
    expect(registry.has(base.id)).toBe(true);
  });

  it("validates game compatibility and exposes game discovery", () => {
    const base = definition("base-theme", "base", { supportedGameIds: [GAME], incompatibleGameIds: [OTHER_GAME] });
    const registry = new ThemeRegistry(); registry.register(base);
    expect(registry.filterByGame(GAME)).toEqual([registry.require(base.id)]);
    expect(registry.filterByGame(OTHER_GAME)).toEqual([]);
    expect(capture(() => resolveSelection(registry, { engineId: ENGINE, base: base.id }))[0]?.code).toBe("INCOMPATIBLE_GAME");
    expect(capture(() => resolveSelection(registry, selection(base, { gameId: OTHER_GAME })))[0]?.code).toBe("INCOMPATIBLE_GAME");
    const invalid = definition("invalid-game-theme", "base", { supportedGameIds: [GAME], incompatibleGameIds: [GAME] });
    expect(capture(() => new ThemeRegistry().register(invalid))[0]?.code).toBe("INCOMPATIBLE_GAME");
  });

  it("validates and discovers deterministic fallback chains", () => {
    const fallback = definition("fallback-theme");
    const primary = definition("primary-theme", "base", { fallbackThemeId: fallback.id });
    const registry = new ThemeRegistry(); registry.registerMany([primary, fallback]);
    expect(registry.fallbackFor(primary.id)?.id).toBe(fallback.id);
    expect(registry.fallbackChain(primary.id).map(({ id }) => id)).toEqual([fallback.id]);
    const first = definition("fallback-one", "base", { fallbackThemeId: themeId("fallback-two") });
    const second = definition("fallback-two", "base", { fallbackThemeId: first.id });
    expect(capture(() => new ThemeRegistry().registerMany([first, second])).some(({ code }) => code === "FALLBACK_CYCLE")).toBe(true);
    expect(capture(() => new ThemeRegistry().register(definition("missing-fallback", "base", { fallbackThemeId: themeId("absent-fallback") })))[0]?.code).toBe("MISSING_FALLBACK");
  });

  it("adapts a logical ThemeManifest without coupling resolution to manifest internals", () => {
    const converted = themeDefinitionFromManifest(manifestTheme({
      "colors.background": "#000000",
      "animation.duration.fast": 120,
      "animation.reduced": false,
    }), { layer: "base", aliases: { "semantic.surface": "colors.background" }, supportedGameIds: [GAME], assetAliases: { "game.background": "asset://game/background" } });
    expect(converted.tokens).toEqual({
      animation: { duration: { fast: 120 }, reduced: false },
      colors: { background: "#000000" },
    });
    expect(converted.metadata).toMatchObject({ sourceManifest: true });
    expect(converted.supportedGameIds).toEqual([GAME]);
    expect(converted.assetAliases).toEqual({ "game.background": "asset://game/background" });
  });

  it("consumes rich ThemeManifest fields by default while preserving flat design tokens", () => {
    const manifest: ThemeManifest = {
      ...manifestTheme({ "colors.background": "#111111", "spacing.small": 4 }),
      layer: "game",
      parentThemeId: themeId("manifest-parent"),
      fallbackThemeId: themeId("manifest-fallback"),
      supportedGameIds: [GAME],
      componentTokens: { button: { radius: 12 } },
      typographyReferences: { family: "Inter" },
      spacingScale: { small: 8, large: 24 },
      sizingScale: { control: 44 },
      effectsTokens: { glow: "soft" },
      animationTokens: { duration: { fast: 100 } },
      assetAliases: { "game.background": assetFileId("game-background") },
    };
    const converted = themeDefinitionFromManifest(manifest);
    expect(converted).toMatchObject({
      layer: "game", parentId: "manifest-parent", fallbackThemeId: "manifest-fallback",
      supportedGameIds: [GAME], assetAliases: { "game.background": "game-background" },
    });
    expect(converted.tokens).toMatchObject({
      colors: { background: "#111111" }, components: { button: { radius: 12 } }, typography: { family: "Inter" },
      spacing: { small: 8, large: 24 }, sizing: { control: 44 }, effects: { glow: "soft" },
      animation: { duration: { fast: 100 } },
    });
  });
});

describe("Hustle deterministic theme resolution", () => {
  it("merges base to accessibility in the exact declared precedence", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES);
    const resolved = new ThemeResolver(registry).resolve(THEME_SYSTEM_EXAMPLE_SELECTION);
    expect(resolved.appliedLayers).toEqual(["base", "game", "operator", "seasonal", "accessibility"]);
    expect(resolved.flatTokens).toMatchObject({
      "colors.background": "#000000",
      "colors.foreground": "#ffffff",
      "colors.accent": "#ffff00",
      "spacing.medium": 16,
      "seasonal.label": "example-season",
      "animation.reduced": true,
    });
  });

  it("keeps operator, seasonal and accessibility overlays independently selectable", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES);
    const seasonalOnly = resolveSelection(registry, {
      engineId: THEME_SYSTEM_EXAMPLE_SELECTION.engineId,
      gameId: THEME_SYSTEM_EXAMPLE_SELECTION.gameId!,
      base: HUSTLE_BASE_THEME_EXAMPLE.id,
      game: NIGHT_DROP_THEME_EXAMPLE.id,
      seasonal: SEASONAL_OVERLAY_THEME_EXAMPLE.id,
    });
    expect(seasonalOnly.appliedThemeIds).toEqual([
      HUSTLE_BASE_THEME_EXAMPLE.id, NIGHT_DROP_THEME_EXAMPLE.id, SEASONAL_OVERLAY_THEME_EXAMPLE.id,
    ]);
    expect(seasonalOnly.appliedThemeIds).not.toContain(OPERATOR_OVERLAY_THEME_EXAMPLE.id);
  });

  it("preserves nested siblings while later leaves override earlier leaves", () => {
    const base = definition("base-theme", "base", { tokens: { group: { one: 1, two: 2 }, stable: { value: true } }, aliases: {} });
    const game = definition("game-theme", "game", { parentId: base.id, tokens: { group: { two: 20, three: 3 } }, aliases: {} });
    const registry = new ThemeRegistry(); registry.registerMany([game, base]);
    const resolved = resolveSelection(registry, selection(base, { game: game.id }));
    expect(resolved.tokens).toEqual({ group: { one: 1, three: 3, two: 20 }, stable: { value: true } });
    expect(resolved.conflicts).toEqual([expect.objectContaining({ kind: "token-override", path: "group.two", previousThemeId: base.id, replacingThemeId: game.id })]);
  });

  it("resolves aliases through alias chains and records alias overrides", () => {
    const base = definition("base-theme", "base", { aliases: { "semantic.surface": "palette.background", "component.panel": "semantic.surface" } });
    const game = definition("game-theme", "game", {
      parentId: base.id,
      tokens: { palette: { foreground: "#eeeeee", background: "#222222" } },
      aliases: { "semantic.surface": "palette.foreground", "component.panel": "semantic.surface" },
    });
    const registry = new ThemeRegistry(); registry.registerMany([base, game]);
    const resolved = resolveSelection(registry, selection(base, { game: game.id }));
    expect(resolved.resolvedAliases["component.panel"]).toBe("#eeeeee");
    expect(resolved.conflicts.filter(({ kind }) => kind === "alias-override")).toHaveLength(2);
  });

  it("fails on missing alias targets and alias cycles", () => {
    const missing = definition("missing-alias", "base", { aliases: { "semantic.surface": "palette.missing" } });
    const missingRegistry = new ThemeRegistry(); missingRegistry.register(missing);
    expect(capture(() => resolveSelection(missingRegistry, selection(missing)))[0]?.code).toBe("INVALID_ALIAS");

    const cycle = definition("alias-cycle", "base", { aliases: { "semantic.one": "semantic.two", "semantic.two": "semantic.one" } });
    const cycleRegistry = new ThemeRegistry(); cycleRegistry.register(cycle);
    expect(capture(() => resolveSelection(cycleRegistry, selection(cycle)))[0]?.message).toMatch(/cycle/i);
  });

  it("rejects wrong layer slots, unsupported engines and incompatible selections", () => {
    const base = definition("base-theme"); const operator = definition("operator-theme", "operator", { parentId: base.id });
    const seasonal = definition("seasonal-theme", "seasonal", { parentId: base.id, incompatibleThemeIds: [operator.id] });
    const registry = new ThemeRegistry(); registry.registerMany([base, operator, seasonal]);
    expect(capture(() => resolveSelection(registry, selection(base, { game: operator.id })))[0]?.code).toBe("INVALID_SELECTION");
    expect(capture(() => resolveSelection(registry, { engineId: engineManifestId("foreign-engine"), base: base.id }))[0]?.code).toBe("INCOMPATIBLE_ENGINE");
    expect(capture(() => resolveSelection(registry, selection(base, { operator: operator.id, seasonal: seasonal.id })))[0]?.code).toBe("INCOMPATIBLE_THEME");
  });

  it("rejects unrelated themes pulled into the same layer", () => {
    const base = definition("base-theme");
    const otherBase = definition("other-base");
    const game = definition("game-theme", "game", { parentId: otherBase.id });
    const registry = new ThemeRegistry(); registry.registerMany([base, otherBase, game]);
    const errors = capture(() => resolveSelection(registry, selection(base, { game: game.id })));
    expect(errors[0]?.code).toBe("INVALID_SELECTION");
  });

  it("produces byte-stable output and hashes regardless of registration order", () => {
    const base = definition("base-theme"); const game = definition("game-theme", "game", { parentId: base.id, tokens: { palette: { accent: "#abc" } } });
    const first = new ThemeRegistry(); first.registerMany([base, game]);
    const second = new ThemeRegistry(); second.registerMany([game, base]);
    const firstResolved = resolveSelection(first, selection(base, { game: game.id }));
    const secondResolved = resolveSelection(second, selection(base, { game: game.id }));
    expect(secondResolved).toEqual(firstResolved);
    expect(secondResolved.hash).toBe(firstResolved.hash);
  });

  it("returns deeply immutable resolved state and conflict diagnostics", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES);
    const resolved = resolveSelection(registry, THEME_SYSTEM_EXAMPLE_SELECTION);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.tokens.palette)).toBe(true);
    expect(Object.isFrozen(resolved.conflicts)).toBe(true);
    expect(resolved.conflicts.some(({ path }) => path === "colors.accent")).toBe(true);
    expect(resolved.assetAliases["shared.logo"]).toBe("asset://operator/logo");
    expect(resolved.conflicts.some(({ kind }) => kind === "asset-alias-override")).toBe(true);
  });
});

describe("Hustle theme loading, runtime and persistence", () => {
  it("loads factories and JSON through atomic validated batches", async () => {
    const loader = new ThemeLoader(); const registry = new ThemeRegistry(); const loaded = vi.fn();
    registry.events.subscribe("theme:loaded", loaded);
    const base = definition("base-theme"); const game = definition("game-theme", "game", { parentId: base.id });
    expect(await loader.load(registry, [() => Promise.resolve(base), () => game])).toHaveLength(2);
    expect(loaded).toHaveBeenCalledOnce();
    await expect(loader.load(new ThemeRegistry(), [() => { throw new Error("offline"); }])).rejects.toMatchObject({ code: "LOAD_FAILED" });
    const second = new ThemeRegistry(); expect(loader.loadJson(second, JSON.stringify([base, game]))).toHaveLength(2);
    expect(capture(() => loader.loadJson(second, "{broken"))[0]?.code).toBe("INVALID_JSON");
  });

  it("activates, resolves tokens and aliases, and publishes runtime events", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES); const runtime = new ThemeRuntime(registry);
    const activated = vi.fn(); const token = vi.fn(); const alias = vi.fn();
    registry.events.subscribe("theme:activated", activated);
    registry.events.subscribe("theme:token-resolved", token);
    registry.events.subscribe("theme:alias-resolved", alias);
    runtime.activate(THEME_SYSTEM_EXAMPLE_SELECTION);
    expect(runtime.resolveToken("colors.background")).toBe("#000000");
    expect(runtime.resolveAlias("semantic.surface")).toBe("#000000");
    expect(runtime.resolveAssetAlias("shared.logo")).toBe("asset://operator/logo");
    expect(activated).toHaveBeenCalledOnce(); expect(token).toHaveBeenCalledOnce(); expect(alias).toHaveBeenCalledOnce();
  });

  it("swaps atomically and preserves the active theme after a failed swap", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES); const runtime = new ThemeRuntime(registry);
    const failed = vi.fn(); registry.events.subscribe("theme:swap-failed", failed);
    runtime.activate({ engineId: THEME_SYSTEM_EXAMPLE_SELECTION.engineId, base: HUSTLE_BASE_THEME_EXAMPLE.id });
    runtime.swap({ engineId: THEME_SYSTEM_EXAMPLE_SELECTION.engineId, gameId: THEME_SYSTEM_EXAMPLE_SELECTION.gameId!, base: HUSTLE_BASE_THEME_EXAMPLE.id, game: NIGHT_DROP_THEME_EXAMPLE.id });
    const before = runtime.active;
    const errors = capture(() => runtime.swap({ ...THEME_SYSTEM_EXAMPLE_SELECTION, base: themeId("unknown-theme") }));
    expect(errors[0]?.code).toBe("SWAP_FAILED");
    expect(errors.some(({ code }) => code === "UNKNOWN_THEME")).toBe(true);
    expect(runtime.active).toEqual(before);
    expect(failed).toHaveBeenCalledOnce();
  });

  it("deactivates explicitly and treats repeated deactivation as a no-op", () => {
    const registry = new ThemeRegistry(); registry.register(HUSTLE_BASE_THEME_EXAMPLE); const runtime = new ThemeRuntime(registry); const listener = vi.fn();
    registry.events.subscribe("theme:deactivated", listener);
    runtime.activate({ engineId: THEME_SYSTEM_EXAMPLE_SELECTION.engineId, base: HUSTLE_BASE_THEME_EXAMPLE.id });
    expect(runtime.deactivate()?.appliedThemeIds).toEqual([HUSTLE_BASE_THEME_EXAMPLE.id]);
    expect(runtime.deactivate()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("serializes stable versioned runtime state and restores it transactionally", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES); const original = new ThemeRuntime(registry);
    original.activate(THEME_SYSTEM_EXAMPLE_SELECTION);
    const json = original.serialize(); const restored = new ThemeRuntime(registry); restored.restore(json);
    expect(restored.serialize()).toBe(json);
    expect(restored.active?.hash).toBe(original.active?.hash);
    const snapshot = restored.snapshot();
    expect(snapshot.activeThemeVersions).toHaveLength(5);
    expect(snapshot.compositionOrder).toEqual(snapshot.activeThemeIds);
    expect(snapshot.compositionLayers).toEqual(["base", "game", "operator", "seasonal", "accessibility"]);
    expect(snapshot.aliases["semantic.surface"]).toBe("colors.background");
    expect(snapshot.assetAliases["shared.logo"]).toBe("asset://operator/logo");
  });

  it("rejects state-version and hash mismatches while preserving active state", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES); const runtime = new ThemeRuntime(registry);
    runtime.activate({ engineId: THEME_SYSTEM_EXAMPLE_SELECTION.engineId, base: HUSTLE_BASE_THEME_EXAMPLE.id }); const before = runtime.active;
    const snapshot = runtime.snapshot();
    expect(capture(() => runtime.restore({ ...snapshot, stateVersion: "2.0.0" } as unknown as typeof snapshot))[0]?.code).toBe("STATE_VERSION_MISMATCH");
    expect(runtime.active).toEqual(before);
    expect(capture(() => runtime.restore({ ...snapshot, activeHash: "tampered" }))[0]?.code).toBe("HASH_MISMATCH");
    expect(runtime.active).toEqual(before);
    const [firstVersion, ...otherVersions] = snapshot.activeThemeVersions;
    expect(firstVersion).toBeDefined();
    expect(capture(() => runtime.restore({
      ...snapshot,
      activeThemeVersions: [{ ...firstVersion!, version: "9.9.9" }, ...otherVersions],
    }))[0]?.code).toBe("STATE_VERSION_MISMATCH");
    expect(runtime.active).toEqual(before);
  });

  it("restores a valid inactive snapshot", () => {
    const registry = new ThemeRegistry(); registry.register(HUSTLE_BASE_THEME_EXAMPLE); const runtime = new ThemeRuntime(registry);
    runtime.activate({ engineId: THEME_SYSTEM_EXAMPLE_SELECTION.engineId, base: HUSTLE_BASE_THEME_EXAMPLE.id });
    runtime.restore({
      schemaVersion: 1, stateVersion: "1.0.0", activeSelection: null, activeHash: null, activeThemeIds: [],
      activeThemeVersions: [], compositionOrder: [], compositionLayers: [], aliases: {}, resolvedAliases: {}, assetAliases: {},
    });
    expect(runtime.active).toBeNull();
  });

  it("round-trips a deterministic registry snapshot through ThemeSerializer", () => {
    const registry = new ThemeRegistry(); registry.registerMany(THEME_SYSTEM_EXAMPLES); const serializer = new ThemeSerializer();
    const json = serializer.serializeRegistry(registry); const snapshot = serializer.deserializeRegistry(json);
    const restored = new ThemeRegistry(); serializer.restoreRegistry(restored, json);
    expect(serializer.serializeRegistry(snapshot)).toBe(json);
    expect(restored.list()).toEqual(registry.list());
  });
});

describe("Hustle theme diagnostics and examples", () => {
  it("projects runtime state and bounded errors through a DOM-free adapter", () => {
    const registry = new ThemeRegistry(); const runtime = new ThemeRuntime(registry); const adapter = new ThemeDebugAdapter(registry, runtime, 3);
    registry.registerMany(THEME_SYSTEM_EXAMPLES);
    runtime.activate(THEME_SYSTEM_EXAMPLE_SELECTION);
    runtime.resolveToken("colors.background");
    capture(() => runtime.swap({ ...THEME_SYSTEM_EXAMPLE_SELECTION, base: themeId("missing-theme") }));
    const snapshot = adapter.snapshot();
    expect(snapshot.registeredThemes).toHaveLength(5);
    expect(snapshot.activeHash).toBe(runtime.active?.hash);
    expect(snapshot.tokens["colors.background"]).toBe("#000000");
    expect(snapshot.latestEvents.length).toBeLessThanOrEqual(3);
    expect(snapshot.latestErrors.some(({ code }) => code === "SWAP_FAILED")).toBe(true);
    adapter.clear(); expect(adapter.snapshot().latestEvents).toEqual([]);
    adapter.destroy(); registry.clear(); expect(adapter.snapshot().latestEvents).toEqual([]);
  });

  it("exposes every typed theme event exactly once", () => {
    expect(THEME_DEBUG_EVENT_NAMES).toHaveLength(16);
    expect(new Set(THEME_DEBUG_EVENT_NAMES).size).toBe(THEME_DEBUG_EVENT_NAMES.length);
  });

  it("ships five presentation-only, explicitly non-production examples", () => {
    expect(THEME_SYSTEM_EXAMPLES).toEqual([
      HUSTLE_BASE_THEME_EXAMPLE,
      NIGHT_DROP_THEME_EXAMPLE,
      OPERATOR_OVERLAY_THEME_EXAMPLE,
      SEASONAL_OVERLAY_THEME_EXAMPLE,
      HIGH_CONTRAST_THEME_EXAMPLE,
    ]);
    for (const example of THEME_SYSTEM_EXAMPLES) {
      expect(example.metadata).toMatchObject({ example: true, production: false, gameplayImplemented: false });
    }
    expect(HUSTLE_BASE_THEME_EXAMPLE.tokens).toMatchObject({
      typography: expect.any(Object), spacing: expect.any(Object), sizing: expect.any(Object),
      effects: expect.any(Object), animation: expect.any(Object), components: expect.any(Object),
    });
  });
});

function manifestTheme(designTokens: ThemeManifest["designTokens"]): ThemeManifest {
  return {
    manifestType: "theme",
    schemaVersion: "1.0.0",
    id: themeId("manifest-theme"),
    name: "Manifest Theme",
    version: "1.0.0",
    metadata: { test: true },
    description: "Logical manifest adapter test.",
    assetManifestId: assetManifestId("theme-assets"),
    supportedEngineIds: [ENGINE],
    designTokens,
  };
}
