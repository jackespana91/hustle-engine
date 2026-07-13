import { ManifestSystemError, manifestError } from "./manifest-errors.js";
import { ManifestRegistry, type ManifestRegisterOptions } from "./manifest-registry.js";
import type { HustleManifest } from "./manifest-types.js";
import { ManifestValidator } from "./manifest-validator.js";

export class ManifestLoader {
  constructor(private readonly validator = new ManifestValidator()) {}

  parse(json: string): HustleManifest {
    try { return this.validator.assertValid(JSON.parse(json) as unknown); }
    catch (error) {
      if (error instanceof ManifestSystemError) throw error;
      throw new ManifestSystemError([manifestError("INVALID_JSON", error instanceof Error ? error.message : "Invalid JSON", "unknown", "$")]);
    }
  }

  load(registry: ManifestRegistry, manifest: HustleManifest, options?: ManifestRegisterOptions): void { registry.register(manifest, options); }
  loadMany(registry: ManifestRegistry, manifests: readonly HustleManifest[], options?: ManifestRegisterOptions): void { registry.registerMany(manifests, options); }
  loadJson(registry: ManifestRegistry, json: string, options?: ManifestRegisterOptions): void { this.load(registry, this.parse(json), options); }
}
