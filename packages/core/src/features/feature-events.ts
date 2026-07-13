import type { FeatureManifest, FeatureManifestId } from "../manifests/manifest-types.js";
import type { FeatureErrorRecord } from "./feature-errors.js";
import type {
  FeatureFailurePolicy,
  FeatureLifecycleStatus,
  FeatureResult,
  FeatureRuntimeSnapshot,
  SerializedFeatureState,
} from "./feature-types.js";

export interface FeatureEventReference {
  readonly featureId: FeatureManifestId;
  readonly lifecycleStatus: FeatureLifecycleStatus;
}

/** Exact event contract published through Hustle Core's TypedEventBus. */
export interface FeatureEventMap {
  "feature:registered": {
    readonly manifest: FeatureManifest;
  };
  "feature:removed": {
    readonly manifest: FeatureManifest;
  };
  "feature:enabled": FeatureEventReference;
  "feature:disabled": FeatureEventReference;
  "feature:initialized": FeatureEventReference;
  "feature:triggered": FeatureEventReference & {
    readonly result: FeatureResult;
    readonly executionOrder: number;
  };
  "feature:completed": FeatureEventReference & {
    readonly result: FeatureResult;
    readonly executionOrder: number;
  };
  "feature:skipped": FeatureEventReference & {
    readonly reason: string;
  };
  "feature:failed": FeatureEventReference & {
    readonly error: FeatureErrorRecord;
    readonly failurePolicy: FeatureFailurePolicy;
  };
  "feature:state-serialized": {
    readonly state: SerializedFeatureState;
    readonly snapshot: FeatureRuntimeSnapshot;
  };
  "feature:state-restored": {
    readonly state: SerializedFeatureState;
    readonly snapshot: FeatureRuntimeSnapshot;
  };
  "feature:cleanup-completed": FeatureEventReference;
  "feature:dependency-validation-failed": {
    readonly errors: readonly FeatureErrorRecord[];
  };
  "feature:conflict-detected": {
    readonly featureIds: readonly FeatureManifestId[];
    readonly error: FeatureErrorRecord;
  };
}

export type FeatureEventName = keyof FeatureEventMap;

export type FeatureEvent = {
  readonly [Name in FeatureEventName]: {
    readonly type: Name;
    readonly payload: FeatureEventMap[Name];
  }
}[FeatureEventName];
