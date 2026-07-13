import { ManifestSystemError, manifestError } from "../manifest-errors.js";
import { MANIFEST_SCHEMA_VERSION, type ManifestMigration } from "../manifest-types.js";

export class ManifestMigrationRunner {
  constructor(private readonly migrations: readonly ManifestMigration[] = []) {}
  migrate(manifest: Readonly<Record<string, unknown>>, targetVersion = MANIFEST_SCHEMA_VERSION): Readonly<Record<string, unknown>> {
    let current = structuredClone(manifest); let version = typeof current.schemaVersion === "string" ? current.schemaVersion : "";
    while (version !== targetVersion) {
      const migration = this.migrations.find(({ fromVersion }) => fromVersion === version);
      if (!migration) throw new ManifestSystemError([manifestError("UNSUPPORTED_SCHEMA_VERSION", `No migration from schema ${version} to ${targetVersion}`, "unknown", "schemaVersion")]);
      current = migration.migrate(current); version = migration.toVersion;
    }
    return current;
  }
}
