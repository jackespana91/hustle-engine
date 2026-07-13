import { ManifestSystemError, manifestError } from "./manifest-errors.js";
import { MANIFEST_SCHEMA_VERSION, type ManifestRegistrySnapshot } from "./manifest-types.js";
import { ManifestValidator } from "./manifest-validator.js";

export class ManifestSerializer {
  constructor(private readonly validator = new ManifestValidator()) {}

  serialize(snapshot: ManifestRegistrySnapshot, pretty = true): string {
    const stable = stableValue({
      ...snapshot,
      manifests: [...snapshot.manifests].sort((left, right) =>
        compareAscii(left.manifestType, right.manifestType) || compareAscii(left.id, right.id)),
    });
    return JSON.stringify(stable, null, pretty ? 2 : undefined);
  }

  deserialize(json: string): ManifestRegistrySnapshot {
    let value: unknown;
    try { value = JSON.parse(json); }
    catch (error) { throw new ManifestSystemError([manifestError("INVALID_JSON", error instanceof Error ? error.message : "Invalid JSON", "unknown", "$")]); }
    if (!isRecord(value) || value.schemaVersion !== MANIFEST_SCHEMA_VERSION || !Array.isArray(value.manifests)) {
      throw new ManifestSystemError([manifestError(value && isRecord(value) && typeof value.schemaVersion === "string" ? "UNSUPPORTED_SCHEMA_VERSION" : "INVALID_TYPE", "Invalid registry snapshot", "unknown", "$")]);
    }
    const manifests = this.validator.assertValidSet(value.manifests);
    return { schemaVersion: MANIFEST_SCHEMA_VERSION, manifests };
  }
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
