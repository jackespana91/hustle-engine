import { manifestError, type ManifestValidationError } from "./manifest-errors.js";
import type { CompatibilityReport, EngineManifest, FeatureManifest, GameManifest, MathManifest, ThemeManifest, AudioManifest } from "./manifest-types.js";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

export function isSemanticVersion(value: string): boolean { return VERSION.test(value); }

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left); const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    const delta = a[key] - b[key];
    if (delta !== 0) return delta;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]; const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart); const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function isValidVersionRange(range: string): boolean {
  if (range === "*") return true;
  if (range.trim() === "") return false;
  return range.trim().split(/\s+/).every((part) => {
    const value = part.replace(/^(\^|~|>=|<=|>|<|=)/, "");
    return isSemanticVersion(value);
  });
}

export function satisfiesVersionRange(version: string, range: string): boolean {
  if (!isSemanticVersion(version) || !isValidVersionRange(range)) return false;
  if (range === "*") return true;
  return range.trim().split(/\s+/).every((part) => satisfiesComparator(version, part));
}

export function checkGameCompatibility(
  game: GameManifest,
  engine: EngineManifest,
  features: readonly FeatureManifest[],
  theme: ThemeManifest,
  audio: AudioManifest,
  math: MathManifest,
): CompatibilityReport {
  const errors: ManifestValidationError[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];
  const error = (code: ManifestValidationError["code"], message: string, path: string, context?: Readonly<Record<string, unknown>>) =>
    errors.push(manifestError(code, message, "game", path, game.id, context));

  checks.push("engine reference", "engine version", "feature compatibility", "feature conflicts", "theme compatibility", "audio compatibility", "math compatibility");
  if (game.engineId !== engine.id) error("UNSUPPORTED_ENGINE", `Game engine ${game.engineId} does not match ${engine.id}`, "engineId");
  if (!satisfiesVersionRange(engine.version, game.engineVersionRange)) error("INCOMPATIBLE_VERSION", `Engine ${engine.version} does not satisfy ${game.engineVersionRange}`, "engineVersionRange");
  const selected = new Set(features.map(({ id }) => id));
  for (const feature of features) {
    if (!feature.supportedEngineIds.includes(engine.id)) error("UNSUPPORTED_ENGINE", `Feature ${feature.id} does not support engine ${engine.id}`, `featureIds.${feature.id}`);
    if (!engine.supportedFeatureIds.includes(feature.id)) error("UNSUPPORTED_FEATURE", `Engine ${engine.id} does not support feature ${feature.id}`, `featureIds.${feature.id}`);
    if (engine.incompatibleFeatureIds.includes(feature.id)) error("UNSUPPORTED_FEATURE", `Engine ${engine.id} marks feature ${feature.id} incompatible`, `featureIds.${feature.id}`);
    for (const dependency of feature.dependencies) if (!selected.has(dependency)) error("MISSING_DEPENDENCY", `Feature ${feature.id} requires ${dependency}`, `featureIds.${feature.id}.dependencies`, { dependency });
    for (const conflict of feature.conflicts) if (selected.has(conflict)) error("FEATURE_CONFLICT", `Feature ${feature.id} conflicts with ${conflict}`, `featureIds.${feature.id}.conflicts`, { conflict });
    if (!feature.deterministic) error("INVALID_VALUE", `Feature ${feature.id} must be deterministic`, `featureIds.${feature.id}.deterministic`);
  }
  if (!theme.supportedEngineIds.includes(engine.id)) error("UNSUPPORTED_ENGINE", `Theme ${theme.id} does not support engine ${engine.id}`, "themeId");
  if (!audio.supportedEngineIds.includes(engine.id)) error("UNSUPPORTED_ENGINE", `Audio ${audio.id} does not support engine ${engine.id}`, "audioManifestId");
  if (math.engineId !== engine.id) error("UNSUPPORTED_ENGINE", `Math profile ${math.id} targets engine ${math.engineId}`, "mathManifestId");
  if (math.metadata.illustrative === true || math.metadata.certified !== true) warnings.push(`Math profile ${math.id} is descriptive and uncertified.`);
  if (engine.status !== "production") warnings.push(`Engine ${engine.id} status is ${engine.status}.`);
  return { compatible: errors.length === 0, checks, errors, warnings };
}

function parseVersion(version: string): ParsedVersion {
  const match = VERSION.exec(version);
  return match
    ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4]?.split(".") ?? [] }
    : { major: 0, minor: 0, patch: 0, prerelease: [] };
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const operator = /^(\^|~|>=|<=|>|<|=)/.exec(comparator)?.[1] ?? "=";
  const target = comparator.replace(/^(\^|~|>=|<=|>|<|=)/, "");
  const comparison = compareVersions(version, target);
  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "^") {
    const targetVersion = parseVersion(target); const currentVersion = parseVersion(version);
    return comparison >= 0 && (targetVersion.major === 0
      ? currentVersion.major === 0 && currentVersion.minor === targetVersion.minor
      : currentVersion.major === targetVersion.major);
  }
  if (operator === "~") {
    const targetVersion = parseVersion(target); const currentVersion = parseVersion(version);
    return comparison >= 0 && currentVersion.major === targetVersion.major && currentVersion.minor === targetVersion.minor;
  }
  return comparison === 0;
}
