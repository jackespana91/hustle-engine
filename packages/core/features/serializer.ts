import type { FeatureSnapshot, FeatureState } from "./contracts.js";
import { FeatureSdkError } from "./errors.js";
import { FeatureRegistry } from "./registry.js";

export class FeatureSerializer {
  serialize(registry: FeatureRegistry, engineId: string): FeatureSnapshot {
    registry.validateDependencies();
    return {
      schemaVersion: 1,
      engineId,
      features: registry.list().map(({ feature, enabled }) => ({
        id: feature.metadata.id,
        version: feature.metadata.version,
        enabled,
        state: structuredClone(feature.serialize()),
      })),
    };
  }

  stringify(registry: FeatureRegistry, engineId: string): string {
    return JSON.stringify(this.serialize(registry, engineId));
  }

  deserialize(registry: FeatureRegistry, snapshotOrJson: FeatureSnapshot | string): FeatureSnapshot {
    const snapshot = typeof snapshotOrJson === "string" ? this.parse(snapshotOrJson) : snapshotOrJson;
    validateSnapshot(snapshot);
    for (const serialized of snapshot.features) {
      const registration = registry.get(serialized.id);
      if (!registration) throw new FeatureSdkError("UNKNOWN_FEATURE", `Snapshot references unknown feature ${serialized.id}`);
      if (registration.feature.metadata.version !== serialized.version) {
        throw new FeatureSdkError("VERSION_MISMATCH", `Feature ${serialized.id} requires version ${registration.feature.metadata.version}, received ${serialized.version}`);
      }
      registration.feature.deserialize(structuredClone(serialized.state) as FeatureState);
      registry.setEnabled(serialized.id, serialized.enabled);
    }
    registry.validateDependencies();
    return snapshot;
  }

  private parse(json: string): FeatureSnapshot {
    try {
      return JSON.parse(json) as FeatureSnapshot;
    } catch (error) {
      throw new FeatureSdkError("INVALID_SNAPSHOT", error instanceof Error ? error.message : "Feature snapshot is not valid JSON");
    }
  }
}

function validateSnapshot(snapshot: FeatureSnapshot): void {
  if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.engineId !== "string" || !Array.isArray(snapshot.features)) {
    throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature snapshot is missing required version, engine, or feature data");
  }
  const ids = new Set(snapshot.features.map(({ id }) => id));
  if (ids.size !== snapshot.features.length) throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature snapshot contains duplicate ids");
}
