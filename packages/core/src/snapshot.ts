import type { RecoverySnapshot, RoundStatus } from "./contracts.js";
import { CorruptedSnapshotError, UnsupportedSnapshotVersionError } from "./errors.js";

const STATUSES: readonly RoundStatus[] = [
  "idle", "requesting", "received", "presenting", "interrupted", "recovering", "completed", "failed",
];

export function serializeSnapshot(snapshot: RecoverySnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseSnapshot(serialized: string): RecoverySnapshot {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new CorruptedSnapshotError(error instanceof Error ? error.message : "Snapshot is not valid JSON");
  }
  if (!isRecord(value)) throw new CorruptedSnapshotError("Snapshot must be an object");
  if (value.version !== 1) throw new UnsupportedSnapshotVersionError(value.version);
  if (!STATUSES.includes(value.lifecycleState as RoundStatus)) {
    throw new CorruptedSnapshotError("Snapshot has an invalid lifecycle state");
  }
  if (!Array.isArray(value.completedCommands) || !Array.isArray(value.pendingCommands) ||
      !Array.isArray(value.transitionHistory) || !isRecord(value.presentationProgress)) {
    throw new CorruptedSnapshotError("Snapshot is missing required queue or history data");
  }
  if (value.featureRuntime !== undefined && (!isRecord(value.featureRuntime) ||
      value.featureRuntime.schemaVersion !== 1 || !Array.isArray(value.featureRuntime.features))) {
    throw new CorruptedSnapshotError("Snapshot contains invalid Feature SDK recovery data");
  }
  if (value.resourceRuntime !== undefined) {
    if (!isRecord(value.resourceRuntime)) throw new CorruptedSnapshotError("Snapshot contains invalid resource recovery data");
    const assets = value.resourceRuntime.assets;
    const theme = value.resourceRuntime.theme;
    if (assets !== undefined && (!isRecord(assets) || assets.schemaVersion !== 1 ||
        !Array.isArray(assets.resolvedAssets) || !isRecord(assets.cache))) {
      throw new CorruptedSnapshotError("Snapshot contains invalid asset recovery data");
    }
    if (theme !== undefined && (!isRecord(theme) || theme.schemaVersion !== 1 ||
        !Array.isArray(theme.activeThemeIds))) {
      throw new CorruptedSnapshotError("Snapshot contains invalid theme recovery data");
    }
  }
  return value as unknown as RecoverySnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
