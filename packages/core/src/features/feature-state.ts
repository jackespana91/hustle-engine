import type { FeatureManifestId } from "../manifests/manifest-types.js";
import { FeatureSdkError } from "./feature-errors.js";
import type { FeatureState } from "./feature-types.js";

export interface FeatureStateMigration {
  readonly featureId: FeatureManifestId;
  readonly fromStateVersion: string;
  readonly toStateVersion: string;
  migrate(state: FeatureState): FeatureState;
}

/** Deterministic, explicit migration graph for future serialized feature state. */
export class FeatureStateMigrationRegistry {
  private readonly migrations = new Map<string, FeatureStateMigration>();

  register(migration: FeatureStateMigration): void {
    const key = migrationKey(migration.featureId, migration.fromStateVersion);
    if (this.migrations.has(key)) {
      throw new FeatureSdkError("DUPLICATE_FEATURE", `State migration already registered for ${migration.featureId} ${migration.fromStateVersion}`, {
        featureId: migration.featureId,
        operation: "deserialize",
      });
    }
    this.migrations.set(key, migration);
  }

  migrate(featureId: FeatureManifestId, state: FeatureState, fromVersion: string, toVersion: string): FeatureState {
    let currentVersion = fromVersion;
    let currentState = cloneFeatureState(state);
    const visited = new Set<string>();
    while (currentVersion !== toVersion) {
      const signature = `${featureId}:${currentVersion}`;
      if (visited.has(signature)) {
        throw new FeatureSdkError("MIGRATION_NOT_FOUND", `Feature state migration cycle for ${featureId} at ${currentVersion}`, {
          featureId,
          operation: "recover",
        });
      }
      visited.add(signature);
      const migration = this.migrations.get(migrationKey(featureId, currentVersion));
      if (!migration) {
        throw new FeatureSdkError("MIGRATION_NOT_FOUND", `No feature state migration for ${featureId} from ${currentVersion} to ${toVersion}`, {
          featureId,
          operation: "recover",
          context: { fromVersion: currentVersion, toVersion },
        });
      }
      currentState = cloneFeatureState(migration.migrate(currentState));
      currentVersion = migration.toStateVersion;
    }
    return currentState;
  }
}

export function cloneFeatureState<State extends FeatureState>(state: State): State {
  assertFeatureState(state);
  return structuredClone(state);
}

export function assertFeatureState(value: unknown, path = "$"): asserts value is FeatureState {
  assertJsonValue(value, path, new WeakSet<object>());
  if (!isRecord(value)) {
    throw invalidState(path, "feature state must be a plain object");
  }
}

export function mergeFeatureState(current: FeatureState, update: FeatureState, strategy: "replace" | "merge"): FeatureState {
  return strategy === "replace" ? cloneFeatureState(update) : cloneFeatureState({ ...current, ...update });
}

function assertJsonValue(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw invalidState(path, "numbers must be finite");
  }
  if (typeof value !== "object") throw invalidState(path, `unsupported ${typeof value} value`);
  if (seen.has(value)) throw invalidState(path, "cyclic values are not supported");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}.${index}`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) throw invalidState(path, "only plain objects are supported");
    Object.entries(value).forEach(([key, entry]) => assertJsonValue(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
}

function invalidState(path: string, reason: string): FeatureSdkError {
  return new FeatureSdkError("INVALID_STATE", `Feature state ${path} is invalid: ${reason}`, {
    operation: "serialize",
    context: { path, reason },
  });
}

function migrationKey(featureId: FeatureManifestId, fromVersion: string): string {
  return `${featureId}:${fromVersion}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
