export const MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

type Brand<Value, Name extends string> = Value & { readonly __manifestBrand: Name };
export type EngineManifestId = Brand<string, "EngineManifestId">;
export type GameManifestId = Brand<string, "GameManifestId">;
export type FeatureManifestId = Brand<string, "FeatureManifestId">;
export type ThemeManifestId = Brand<string, "ThemeManifestId">;
export type AudioManifestId = Brand<string, "AudioManifestId">;
export type MathManifestId = Brand<string, "MathManifestId">;
export type AssetManifestId = Brand<string, "AssetManifestId">;
export type AssetFileId = Brand<string, "AssetFileId">;
export type ManifestId = EngineManifestId | GameManifestId | FeatureManifestId | ThemeManifestId |
  AudioManifestId | MathManifestId | AssetManifestId;

export type ManifestType = "engine" | "game" | "feature" | "theme" | "audio" | "math" | "asset";
export type ManifestMetadata = Readonly<Record<string, unknown>>;

export const engineManifestId = (value: string): EngineManifestId => value as EngineManifestId;
export const gameManifestId = (value: string): GameManifestId => value as GameManifestId;
export const featureManifestId = (value: string): FeatureManifestId => value as FeatureManifestId;
export const themeManifestId = (value: string): ThemeManifestId => value as ThemeManifestId;
export const audioManifestId = (value: string): AudioManifestId => value as AudioManifestId;
export const mathManifestId = (value: string): MathManifestId => value as MathManifestId;
export const assetManifestId = (value: string): AssetManifestId => value as AssetManifestId;
export const assetFileId = (value: string): AssetFileId => value as AssetFileId;

interface ManifestBase<Type extends ManifestType, Id extends ManifestId> {
  readonly manifestType: Type;
  readonly schemaVersion: string;
  readonly id: Id;
  readonly name: string;
  readonly version: string;
  readonly metadata: ManifestMetadata;
}

export interface PerformanceBudget {
  readonly maxInitialLoadMs: number;
  readonly maxFrameTimeMs: number;
  readonly maxMemoryMb: number;
  readonly maxAssetBytes: number;
}

export interface EngineManifest extends ManifestBase<"engine", EngineManifestId> {
  readonly description: string;
  readonly engineType: string;
  readonly coreVersion: string;
  readonly status: "experimental" | "development" | "production" | "deprecated";
  readonly supportedPlatforms: readonly ("web" | "mobile-web" | "desktop-web")[];
  readonly supportedOrientations: readonly ("portrait" | "landscape" | "responsive")[];
  readonly requiredCapabilities: readonly string[];
  readonly optionalCapabilities: readonly string[];
  readonly supportedFeatureIds: readonly FeatureManifestId[];
  readonly incompatibleFeatureIds: readonly FeatureManifestId[];
  readonly performanceBudget: PerformanceBudget;
}

export interface GameManifest extends ManifestBase<"game", GameManifestId> {
  readonly engineId: EngineManifestId;
  readonly engineVersionRange: string;
  readonly themeId: ThemeManifestId;
  readonly featureIds: readonly FeatureManifestId[];
  readonly audioManifestId: AudioManifestId;
  readonly mathManifestId: MathManifestId;
  readonly assetManifestId: AssetManifestId;
  readonly supportedLocales: readonly string[];
  readonly defaultLocale: string;
  readonly buildNumber: number;
}

export interface FeatureManifest extends ManifestBase<"feature", FeatureManifestId> {
  readonly description: string;
  readonly supportedEngineIds: readonly EngineManifestId[];
  readonly dependencies: readonly FeatureManifestId[];
  /** Optional for schema 1.0.0 compatibility; runtimes normalize an omitted value to an empty list. */
  readonly optionalDependencies?: readonly FeatureManifestId[];
  readonly conflicts: readonly FeatureManifestId[];
  /** Optional for schema 1.0.0 compatibility; runtimes default to blocking. */
  readonly failurePolicy?: "blocking" | "non-blocking";
  readonly priority: number;
  readonly deterministic: boolean;
  readonly stateVersion: string;
}

export type DesignTokenValue = string | number | boolean;
export interface ThemeManifest extends ManifestBase<"theme", ThemeManifestId> {
  readonly description: string;
  readonly assetManifestId: AssetManifestId;
  readonly supportedEngineIds: readonly EngineManifestId[];
  readonly designTokens: Readonly<Record<string, DesignTokenValue>>;
}

export interface AudioResource {
  readonly id: string;
  readonly path: string;
  readonly metadata: ManifestMetadata;
}

export interface AudioManifest extends ManifestBase<"audio", AudioManifestId> {
  readonly supportedEngineIds: readonly EngineManifestId[];
  readonly music: readonly AudioResource[];
  readonly soundEffects: readonly AudioResource[];
  readonly voicePacks: readonly AudioResource[];
}

/** Descriptive configuration only. Values are illustrative until separately simulated and certified. */
export interface MathManifest extends ManifestBase<"math", MathManifestId> {
  readonly engineId: EngineManifestId;
  readonly modelVersion: string;
  readonly volatilityLabel: string;
  readonly targetRtpBasisPoints: number;
  /** Multiplier scaled by 10,000: 10,000 = 1x. */
  readonly maxWinMultiplierBasisPoints: number;
  readonly currencyNeutral: boolean;
  readonly configurationReference: string;
}

export type AssetFileType = "image" | "audio" | "font" | "json" | "text" | "binary";
export interface AssetFile {
  readonly id: AssetFileId;
  readonly path: string;
  readonly type: AssetFileType;
  readonly required: boolean;
  readonly checksum: string;
  readonly tags: readonly string[];
  readonly metadata: ManifestMetadata;
}

export interface AssetManifest extends ManifestBase<"asset", AssetManifestId> {
  readonly files: readonly AssetFile[];
  readonly preloadGroups: Readonly<Record<string, readonly AssetFileId[]>>;
  readonly optionalGroups: Readonly<Record<string, readonly AssetFileId[]>>;
}

export type HustleManifest = EngineManifest | GameManifest | FeatureManifest | ThemeManifest |
  AudioManifest | MathManifest | AssetManifest;

export interface CompatibilityReport {
  readonly compatible: boolean;
  readonly checks: readonly string[];
  readonly errors: readonly import("./manifest-errors.js").ManifestValidationError[];
  readonly warnings: readonly string[];
}

export interface ResolvedGameComposition {
  readonly game: GameManifest;
  readonly engine: EngineManifest;
  readonly features: readonly FeatureManifest[];
  readonly theme: ThemeManifest;
  readonly audio: AudioManifest;
  readonly mathProfile: MathManifest;
  readonly assets: AssetManifest;
  readonly compatibilityReport: CompatibilityReport;
  readonly warnings: readonly string[];
}

export interface ManifestRegistrySnapshot {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly manifests: readonly HustleManifest[];
}

export interface ManifestMigration {
  readonly fromVersion: string;
  readonly toVersion: string;
  migrate(manifest: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
}

export interface ManifestChangeEvent {
  readonly type: "registered" | "removed" | "reloaded";
  readonly manifest: HustleManifest;
  readonly previous?: HustleManifest;
}

export interface ManifestEventMap {
  "manifest:registered": { readonly manifest: HustleManifest };
  "manifest:removed": { readonly manifest: HustleManifest };
  "manifest:reloaded": { readonly manifest: HustleManifest; readonly previous: HustleManifest };
  "manifest:validation-failed": { readonly errors: readonly import("./manifest-errors.js").ManifestValidationError[] };
  "manifest:composition-resolved": { readonly composition: ResolvedGameComposition };
  "manifest:composition-failed": { readonly gameId: string; readonly errors: readonly import("./manifest-errors.js").ManifestValidationError[] };
}
