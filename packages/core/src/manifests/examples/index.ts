import {
  MANIFEST_SCHEMA_VERSION,
  assetFileId,
  assetManifestId,
  audioManifestId,
  engineManifestId,
  featureManifestId,
  gameManifestId,
  mathManifestId,
  themeManifestId,
  type AssetManifest,
  type AudioManifest,
  type EngineManifest,
  type FeatureManifest,
  type GameManifest,
  type HustleManifest,
  type MathManifest,
  type ThemeManifest,
} from "../manifest-types.js";

const exampleMetadata = { example: true, production: false } as const;

export const HUSTLE_CORE_COMPATIBILITY_EXAMPLE = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  coreVersionRange: "^0.1.0",
  description: "Non-production compatibility marker for Hustle Core Task 003 examples.",
} as const;

export const ROUTERUN_ENGINE_EXAMPLE: EngineManifest = {
  manifestType: "engine", schemaVersion: MANIFEST_SCHEMA_VERSION, id: engineManifestId("routerun-engine-001"),
  name: "RouteRun Engine 001", version: "0.1.0", description: "Non-production commercial-engine composition example.",
  engineType: "directional-route", coreVersion: "^0.1.0", status: "experimental",
  supportedPlatforms: ["web", "mobile-web"], supportedOrientations: ["responsive"],
  requiredCapabilities: ["deterministic-presentation", "snapshot-recovery"], optionalCapabilities: ["feature-sdk"],
  supportedFeatureIds: [featureManifestId("shortcut-feature"), featureManifestId("five-star-feature")], incompatibleFeatureIds: [],
  performanceBudget: { maxInitialLoadMs: 4_000, maxFrameTimeMs: 34, maxMemoryMb: 256, maxAssetBytes: 25_000_000 }, metadata: exampleMetadata,
};

export const SHORTCUT_FEATURE_MANIFEST_EXAMPLE: FeatureManifest = {
  manifestType: "feature", schemaVersion: MANIFEST_SCHEMA_VERSION, id: featureManifestId("shortcut-feature"),
  name: "Shortcut Feature", version: "0.1.0", description: "Manifest only; no shortcut gameplay is implemented.",
  supportedEngineIds: [ROUTERUN_ENGINE_EXAMPLE.id], dependencies: [], optionalDependencies: [], conflicts: [], failurePolicy: "blocking", priority: 100,
  deterministic: true, stateVersion: "1.0.0", metadata: exampleMetadata,
};

export const FIVE_STAR_FEATURE_MANIFEST_EXAMPLE: FeatureManifest = {
  manifestType: "feature", schemaVersion: MANIFEST_SCHEMA_VERSION, id: featureManifestId("five-star-feature"),
  name: "Five-Star Feature", version: "0.1.0", description: "Manifest only; no Five-Star gameplay is implemented.",
  supportedEngineIds: [ROUTERUN_ENGINE_EXAMPLE.id], dependencies: [SHORTCUT_FEATURE_MANIFEST_EXAMPLE.id], optionalDependencies: [], conflicts: [], failurePolicy: "blocking", priority: 80,
  deterministic: true, stateVersion: "1.0.0", metadata: exampleMetadata,
};

export const NIGHT_DROP_ASSET_MANIFEST_EXAMPLE: AssetManifest = {
  manifestType: "asset", schemaVersion: MANIFEST_SCHEMA_VERSION, id: assetManifestId("night-drop-assets-example"),
  name: "Night Drop Asset Pack (Example)", version: "0.1.0",
  files: [
    { id: assetFileId("placeholder-background"), path: "assets/examples/night-drop-background.txt", type: "text", required: true, checksum: "sha256-example-background", tags: ["example", "background"], metadata: exampleMetadata },
    { id: assetFileId("placeholder-ui"), path: "assets/examples/night-drop-ui.txt", type: "text", required: false, checksum: "sha256-example-ui", tags: ["example", "ui"], metadata: exampleMetadata },
  ],
  preloadGroups: { boot: [assetFileId("placeholder-background")] }, optionalGroups: { interface: [assetFileId("placeholder-ui")] }, metadata: exampleMetadata,
};

export const NIGHT_DROP_THEME_MANIFEST_EXAMPLE: ThemeManifest = {
  manifestType: "theme", schemaVersion: MANIFEST_SCHEMA_VERSION, id: themeManifestId("night-drop-theme-example"),
  name: "Night Drop Theme (Example)", version: "0.1.0", description: "Illustrative design-token data; no final artwork.",
  assetManifestId: NIGHT_DROP_ASSET_MANIFEST_EXAMPLE.id, supportedEngineIds: [ROUTERUN_ENGINE_EXAMPLE.id],
  designTokens: { "color.background": "#0b0e14", "color.accent": "#54e6bd", "motion.scale": 1000 }, metadata: exampleMetadata,
};

export const NIGHT_DROP_AUDIO_MANIFEST_EXAMPLE: AudioManifest = {
  manifestType: "audio", schemaVersion: MANIFEST_SCHEMA_VERSION, id: audioManifestId("night-drop-audio-example"),
  name: "Night Drop Audio Pack (Example)", version: "0.1.0", supportedEngineIds: [ROUTERUN_ENGINE_EXAMPLE.id],
  music: [{ id: "placeholder-music", path: "audio/examples/night-drop-music.txt", metadata: exampleMetadata }],
  soundEffects: [{ id: "placeholder-event", path: "audio/examples/night-drop-event.txt", metadata: exampleMetadata }],
  voicePacks: [], metadata: exampleMetadata,
};

export const NIGHT_DROP_MATH_MANIFEST_EXAMPLE: MathManifest = {
  manifestType: "math", schemaVersion: MANIFEST_SCHEMA_VERSION, id: mathManifestId("night-drop-math-illustrative"),
  name: "Night Drop Illustrative Math Profile", version: "0.1.0", engineId: ROUTERUN_ENGINE_EXAMPLE.id,
  modelVersion: "illustrative-0.1.0", volatilityLabel: "illustrative-high", targetRtpBasisPoints: 9_600,
  maxWinMultiplierBasisPoints: 100_000_000, currencyNeutral: true,
  configurationReference: "examples/night-drop-math-illustrative.json",
  metadata: { ...exampleMetadata, illustrative: true, certified: false, warning: "Descriptive configuration only; not simulated or certified mathematics." },
};

export const NIGHT_DROP_GAME_MANIFEST_EXAMPLE: GameManifest = {
  manifestType: "game", schemaVersion: MANIFEST_SCHEMA_VERSION, id: gameManifestId("night-drop-game-pack-001"),
  name: "Night Drop Game Pack 001", version: "0.1.0", engineId: ROUTERUN_ENGINE_EXAMPLE.id,
  engineVersionRange: "^0.1.0", themeId: NIGHT_DROP_THEME_MANIFEST_EXAMPLE.id,
  featureIds: [SHORTCUT_FEATURE_MANIFEST_EXAMPLE.id, FIVE_STAR_FEATURE_MANIFEST_EXAMPLE.id],
  audioManifestId: NIGHT_DROP_AUDIO_MANIFEST_EXAMPLE.id, mathManifestId: NIGHT_DROP_MATH_MANIFEST_EXAMPLE.id,
  assetManifestId: NIGHT_DROP_ASSET_MANIFEST_EXAMPLE.id, supportedLocales: ["en", "es"], defaultLocale: "en",
  buildNumber: 1, metadata: { ...exampleMetadata, label: "Illustrative composition only" },
};

export const NIGHT_DROP_EXAMPLE_MANIFESTS: readonly HustleManifest[] = [
  ROUTERUN_ENGINE_EXAMPLE, SHORTCUT_FEATURE_MANIFEST_EXAMPLE, FIVE_STAR_FEATURE_MANIFEST_EXAMPLE,
  NIGHT_DROP_ASSET_MANIFEST_EXAMPLE, NIGHT_DROP_THEME_MANIFEST_EXAMPLE, NIGHT_DROP_AUDIO_MANIFEST_EXAMPLE,
  NIGHT_DROP_MATH_MANIFEST_EXAMPLE, NIGHT_DROP_GAME_MANIFEST_EXAMPLE,
];

export function malformedManifestExample(): unknown {
  return { ...NIGHT_DROP_GAME_MANIFEST_EXAMPLE, id: "Night Drop", version: "latest" };
}

export function missingDependencyExample(): readonly HustleManifest[] {
  return [
    { ...SHORTCUT_FEATURE_MANIFEST_EXAMPLE, id: featureManifestId("missing-dependency-feature"), dependencies: [featureManifestId("absent-feature")] },
  ];
}

export function conflictingFeatureExample(): readonly HustleManifest[] {
  const conflict: FeatureManifest = {
    ...FIVE_STAR_FEATURE_MANIFEST_EXAMPLE,
    conflicts: [SHORTCUT_FEATURE_MANIFEST_EXAMPLE.id],
  };
  return NIGHT_DROP_EXAMPLE_MANIFESTS.map((manifest) => manifest.id === conflict.id ? conflict : manifest);
}
