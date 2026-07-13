import { describe, expect, it, vi } from "vitest";
import {
  FIVE_STAR_FEATURE_MANIFEST_EXAMPLE,
  MANIFEST_SCHEMA_VERSION,
  ManifestLoader,
  ManifestRegistry,
  ManifestSerializer,
  ManifestSystemError,
  ManifestValidator,
  NIGHT_DROP_ASSET_MANIFEST_EXAMPLE,
  NIGHT_DROP_EXAMPLE_MANIFESTS,
  NIGHT_DROP_GAME_MANIFEST_EXAMPLE,
  NIGHT_DROP_MATH_MANIFEST_EXAMPLE,
  ROUTERUN_ENGINE_EXAMPLE,
  SHORTCUT_FEATURE_MANIFEST_EXAMPLE,
  conflictingFeatureExample,
  deterministicFeatureOrder,
  featureManifestId,
  malformedManifestExample,
  missingDependencyExample,
  satisfiesVersionRange,
  type FeatureManifest,
  type HustleManifest,
  type ManifestValidationError,
} from "../src/index.js";

const validator = new ManifestValidator();
const serializer = new ManifestSerializer();

function registryWithExamples(): ManifestRegistry {
  const registry = new ManifestRegistry();
  registry.registerMany(NIGHT_DROP_EXAMPLE_MANIFESTS);
  return registry;
}

function captureError(action: () => unknown): readonly ManifestValidationError[] {
  try { action(); throw new Error("Expected manifest action to fail"); }
  catch (error) {
    if (error instanceof ManifestSystemError) return error.errors;
    throw error;
  }
}

describe("Engine Manifest System", () => {
  it("registers valid manifests and publishes typed events", () => {
    const registry = new ManifestRegistry(); const listener = vi.fn();
    registry.events.subscribe("manifest:registered", listener);
    registry.registerMany(NIGHT_DROP_EXAMPLE_MANIFESTS);
    expect(registry.list()).toHaveLength(8);
    expect(registry.require(ROUTERUN_ENGINE_EXAMPLE.id)).toEqual(ROUTERUN_ENGINE_EXAMPLE);
    expect(listener).toHaveBeenCalledTimes(8);
  });

  it("rejects duplicate registration without mutating the registry", () => {
    const registry = registryWithExamples(); const before = serializer.serialize(registry.snapshot());
    const errors = captureError(() => registry.register(ROUTERUN_ENGINE_EXAMPLE));
    expect(errors[0]?.code).toBe("DUPLICATE_ID");
    expect(serializer.serialize(registry.snapshot())).toBe(before);
  });

  it("rejects malformed ids and versions with structured paths", () => {
    const result = validator.validate(malformedManifestExample());
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MALFORMED_ID", manifestType: "game", fieldPath: "id", severity: "error" }),
      expect.objectContaining({ code: "INVALID_VERSION", manifestType: "game", fieldPath: "version", severity: "error" }),
    ]));
  });

  it("rejects unsupported schema versions specifically", () => {
    const result = validator.validate({ ...ROUTERUN_ENGINE_EXAMPLE, schemaVersion: "2.0.0" });
    expect(result.errors.some(({ code }) => code === "UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
  });

  it("rejects invalid version ranges and evaluates supported ranges", () => {
    const invalid = validator.validate({ ...NIGHT_DROP_GAME_MANIFEST_EXAMPLE, engineVersionRange: "latest" });
    expect(invalid.errors.some(({ code }) => code === "INVALID_VERSION_RANGE")).toBe(true);
    expect(satisfiesVersionRange("1.2.0", "^1.0.0")).toBe(true);
    expect(satisfiesVersionRange("1.2.0", "^2.0.0")).toBe(false);
  });

  it("detects missing and circular feature dependencies", () => {
    const missing = captureError(() => new ManifestRegistry().registerMany(missingDependencyExample()));
    expect(missing.some(({ code }) => code === "MISSING_DEPENDENCY")).toBe(true);
    const one: FeatureManifest = { ...SHORTCUT_FEATURE_MANIFEST_EXAMPLE, id: featureManifestId("cycle-one"), dependencies: [featureManifestId("cycle-two")] };
    const two: FeatureManifest = { ...FIVE_STAR_FEATURE_MANIFEST_EXAMPLE, id: featureManifestId("cycle-two"), dependencies: [one.id] };
    const cycle = captureError(() => new ManifestRegistry().registerMany([one, two]));
    expect(cycle).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CIRCULAR_DEPENDENCY", context: expect.objectContaining({ cycle: expect.any(Array) }) })]));
  });

  it("rejects one-sided feature conflicts in a selected composition", () => {
    const errors = captureError(() => new ManifestRegistry().registerMany(conflictingFeatureExample()));
    expect(errors.some(({ code }) => code === "FEATURE_CONFLICT")).toBe(true);
  });

  it("rejects unsupported engine-feature combinations", () => {
    const unsupported = { ...FIVE_STAR_FEATURE_MANIFEST_EXAMPLE, supportedEngineIds: [] };
    const manifests = NIGHT_DROP_EXAMPLE_MANIFESTS.map((manifest) => manifest.id === unsupported.id ? unsupported : manifest);
    const errors = captureError(() => new ManifestRegistry().registerMany(manifests));
    expect(errors.some(({ code }) => code === "UNSUPPORTED_ENGINE")).toBe(true);
  });

  it("orders features deterministically by dependencies, priority, then ASCII id", () => {
    const alpha: FeatureManifest = { ...SHORTCUT_FEATURE_MANIFEST_EXAMPLE, id: featureManifestId("alpha"), priority: 50 };
    const beta: FeatureManifest = { ...SHORTCUT_FEATURE_MANIFEST_EXAMPLE, id: featureManifestId("beta"), priority: 50 };
    const dependent: FeatureManifest = { ...FIVE_STAR_FEATURE_MANIFEST_EXAMPLE, id: featureManifestId("dependent"), dependencies: [beta.id], priority: 100 };
    expect(deterministicFeatureOrder([dependent, beta, alpha]).map(({ id }) => id)).toEqual(["alpha", "beta", "dependent"]);
  });

  it("discovers transitive feature dependencies during composition", () => {
    const game = { ...NIGHT_DROP_GAME_MANIFEST_EXAMPLE, featureIds: [FIVE_STAR_FEATURE_MANIFEST_EXAMPLE.id] };
    const manifests = NIGHT_DROP_EXAMPLE_MANIFESTS.map((manifest) => manifest.id === game.id ? game : manifest);
    const registry = new ManifestRegistry(); registry.registerMany(manifests);
    expect(registry.resolveGame(game.id).features.map(({ id }) => id)).toEqual(["shortcut-feature", "five-star-feature"]);
  });

  it("resolves the complete illustrative Night Drop composition", () => {
    const registry = registryWithExamples(); const resolved = vi.fn();
    registry.events.subscribe("manifest:composition-resolved", resolved);
    const composition = registry.resolveGame(NIGHT_DROP_GAME_MANIFEST_EXAMPLE.id);
    expect(composition.game.id).toBe("night-drop-game-pack-001");
    expect(composition.engine.id).toBe("routerun-engine-001");
    expect(composition.features.map(({ id }) => id)).toEqual(["shortcut-feature", "five-star-feature"]);
    expect(composition.theme.id).toBe("night-drop-theme-example");
    expect(composition.audio.id).toBe("night-drop-audio-example");
    expect(composition.mathProfile.id).toBe("night-drop-math-illustrative");
    expect(composition.assets.id).toBe("night-drop-assets-example");
    expect(composition.compatibilityReport.compatible).toBe(true);
    expect(composition.warnings.join(" ")).toMatch(/uncertified/i);
    expect(NIGHT_DROP_MATH_MANIFEST_EXAMPLE.metadata).toMatchObject({ illustrative: true, certified: false });
    expect(resolved).toHaveBeenCalledOnce();
  });

  it("fails clearly when a referenced manifest is missing", () => {
    const manifests = NIGHT_DROP_EXAMPLE_MANIFESTS.filter(({ id }) => id !== NIGHT_DROP_ASSET_MANIFEST_EXAMPLE.id);
    const errors = captureError(() => new ManifestRegistry().registerMany(manifests));
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_REFERENCE", fieldPath: expect.stringMatching(/assetManifestId/) })]));
  });

  it("rejects dangling declared compatibility and asset-group references", () => {
    const engine = { ...ROUTERUN_ENGINE_EXAMPLE, supportedFeatureIds: [...ROUTERUN_ENGINE_EXAMPLE.supportedFeatureIds, featureManifestId("absent-feature")] };
    const manifests = NIGHT_DROP_EXAMPLE_MANIFESTS.map((manifest) => manifest.id === engine.id ? engine : manifest);
    expect(captureError(() => new ManifestRegistry().registerMany(manifests))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_REFERENCE", fieldPath: expect.stringMatching(/supportedFeatureIds/) }),
    ]));
    expect(validator.validate({ ...NIGHT_DROP_ASSET_MANIFEST_EXAMPLE, preloadGroups: { boot: [featureManifestId("absent-file")] } }).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_REFERENCE", fieldPath: "preloadGroups.boot.0" }),
    ]));
  });

  it("parses JSON and wraps syntax failures in structured errors", () => {
    const loader = new ManifestLoader();
    expect(loader.parse(JSON.stringify(ROUTERUN_ENGINE_EXAMPLE))).toEqual(ROUTERUN_ENGINE_EXAMPLE);
    const errors = captureError(() => loader.parse("{not-json"));
    expect(errors[0]).toMatchObject({ code: "INVALID_JSON", fieldPath: "$", severity: "error" });
  });

  it("serializes byte-stably regardless of manifest and metadata key order", () => {
    const reversedMetadata = { ...ROUTERUN_ENGINE_EXAMPLE, metadata: { z: 1, a: 2 } };
    const forwardMetadata = { ...ROUTERUN_ENGINE_EXAMPLE, metadata: { a: 2, z: 1 } };
    const first = serializer.serialize({ schemaVersion: MANIFEST_SCHEMA_VERSION, manifests: [reversedMetadata, SHORTCUT_FEATURE_MANIFEST_EXAMPLE] });
    const second = serializer.serialize({ schemaVersion: MANIFEST_SCHEMA_VERSION, manifests: [SHORTCUT_FEATURE_MANIFEST_EXAMPLE, forwardMetadata].sort((a, b) => a.manifestType < b.manifestType ? -1 : 1) });
    expect(first).toBe(second);
  });

  it("round-trips registry serialization and produces defensive snapshots", () => {
    const registry = registryWithExamples(); const snapshot = registry.snapshot();
    const json = serializer.serialize(snapshot); const restored = serializer.deserialize(json);
    expect(serializer.serialize(restored)).toBe(json);
    const mutable = snapshot.manifests[0] as unknown as { name: string }; mutable.name = "changed outside";
    expect(registry.list()[0]?.name).not.toBe("changed outside");
  });

  it("reloads valid replacements atomically and publishes a change event", () => {
    const registry = registryWithExamples(); const listener = vi.fn();
    registry.events.subscribe("manifest:reloaded", listener);
    registry.reload({ ...ROUTERUN_ENGINE_EXAMPLE, description: "Safely reloaded example." });
    expect((registry.require(ROUTERUN_ENGINE_EXAMPLE.id) as typeof ROUTERUN_ENGINE_EXAMPLE).description).toBe("Safely reloaded example.");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rejects invalid reload atomically and preserves the prior registry", () => {
    const registry = registryWithExamples(); const failed = vi.fn(); const reloaded = vi.fn();
    registry.events.subscribe("manifest:validation-failed", failed); registry.events.subscribe("manifest:reloaded", reloaded);
    const before = serializer.serialize(registry.snapshot());
    const errors = captureError(() => registry.reload({ ...ROUTERUN_ENGINE_EXAMPLE, version: "2.0.0" }));
    expect(errors.some(({ code }) => code === "INCOMPATIBLE_VERSION")).toBe(true);
    expect(serializer.serialize(registry.snapshot())).toBe(before);
    expect(reloaded).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce();
  });

  it("publishes removed, validation-failed and composition-failed events", () => {
    const registry = registryWithExamples(); const removed = vi.fn(); const validation = vi.fn(); const composition = vi.fn();
    registry.events.subscribe("manifest:removed", removed); registry.events.subscribe("manifest:validation-failed", validation); registry.events.subscribe("manifest:composition-failed", composition);
    registry.unregister(NIGHT_DROP_GAME_MANIFEST_EXAMPLE.id);
    expect(() => registry.register(malformedManifestExample() as HustleManifest)).toThrow(ManifestSystemError);
    expect(() => registry.resolveGame("missing-game")).toThrow(ManifestSystemError);
    expect(removed).toHaveBeenCalledOnce(); expect(validation).toHaveBeenCalledOnce(); expect(composition).toHaveBeenCalledOnce();
  });

  it("validates asset paths, asset ids, performance limits and basis points", () => {
    expect(validator.validate({ ...NIGHT_DROP_ASSET_MANIFEST_EXAMPLE, files: [
      { ...NIGHT_DROP_ASSET_MANIFEST_EXAMPLE.files[0]!, path: "../escape.png" },
      { ...NIGHT_DROP_ASSET_MANIFEST_EXAMPLE.files[0]! },
    ] }).errors.map(({ code }) => code)).toEqual(expect.arrayContaining(["INVALID_ASSET_PATH", "DUPLICATE_ASSET_ID"]));
    expect(validator.validate({ ...ROUTERUN_ENGINE_EXAMPLE, performanceBudget: { ...ROUTERUN_ENGINE_EXAMPLE.performanceBudget, maxMemoryMb: -1 } }).errors.some(({ code }) => code === "NEGATIVE_PERFORMANCE_LIMIT")).toBe(true);
    expect(validator.validate({ ...NIGHT_DROP_MATH_MANIFEST_EXAMPLE, targetRtpBasisPoints: 10_001 }).errors.some(({ code }) => code === "INVALID_BASIS_POINTS")).toBe(true);
  });

  it("handles semantic-version prereleases and build metadata", () => {
    expect(satisfiesVersionRange("1.0.0+build.7", "^1.0.0")).toBe(true);
    expect(satisfiesVersionRange("1.0.0-alpha.2", "<1.0.0")).toBe(true);
    expect(validator.validate({ ...ROUTERUN_ENGINE_EXAMPLE, version: "01.0.0" }).errors.some(({ code }) => code === "INVALID_VERSION")).toBe(true);
  });
});
