import { MANIFEST_SCHEMA_VERSION, engineManifestId, type EngineManifest } from "@hustle/core";
import { ROUTERUN_FEATURE_HOOKS } from "./features/routerun-feature-hooks.js";

export const ROUTERUN_ENGINE_ID = engineManifestId("engine.routerun");
export const ROUTERUN_ENGINE_VERSION = "0.1.0" as const;

export const ROUTERUN_MANIFEST: EngineManifest = {
  manifestType: "engine",
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: ROUTERUN_ENGINE_ID,
  name: "RouteRun",
  version: ROUTERUN_ENGINE_VERSION,
  description: "Deterministic reusable directional-route mechanic for Hustle Engine game packs.",
  engineType: "route",
  coreVersion: "^0.1.0",
  status: "development",
  supportedPlatforms: ["web", "mobile-web", "desktop-web"],
  supportedOrientations: ["portrait", "landscape", "responsive"],
  requiredCapabilities: ["deterministic-presentation", "animation-queue", "snapshot-recovery", "outcome-replay"],
  optionalCapabilities: ["feature-sdk", "asset-theme-system", "debug-panel"],
  supportedFeatureIds: [],
  incompatibleFeatureIds: [],
  performanceBudget: { maxInitialLoadMs: 3_000, maxFrameTimeMs: 34, maxMemoryMb: 192, maxAssetBytes: 20_000_000 },
  metadata: {
    commercialEngineNumber: 1,
    production: false,
    featureHooks: ROUTERUN_FEATURE_HOOKS,
    deterministic: true,
  },
};
