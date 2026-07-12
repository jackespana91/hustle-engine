import type {
  Feature,
  FeatureContext,
  FeatureEvent,
  FeatureId,
  FeatureLifecycle,
  FeatureState,
  RegisteredFeature,
} from "./contracts.js";
import { FeatureSdkError } from "./errors.js";

interface MutableRegistration {
  readonly feature: Feature;
  readonly registrationOrder: number;
  enabled: boolean;
  lifecycle: FeatureLifecycle;
}

export interface FeatureExecutionResult {
  readonly order: readonly FeatureId[];
  readonly triggered: readonly FeatureId[];
}

export class FeatureRegistry {
  private readonly registrations = new Map<FeatureId, MutableRegistration>();
  private readonly listeners = new Set<(event: FeatureEvent) => void>();
  private registrationSequence = 0;
  private eventSequence = 0;

  register(feature: Feature): void {
    validateMetadata(feature);
    const id = feature.metadata.id;
    if (this.registrations.has(id)) {
      throw new FeatureSdkError("DUPLICATE_FEATURE", `Feature already registered: ${id}`);
    }
    this.registrations.set(id, {
      feature,
      enabled: true,
      lifecycle: "registered",
      registrationOrder: this.registrationSequence,
    });
    this.registrationSequence += 1;
    this.emit(id, "feature:registered", "registered", {});
  }

  get(id: FeatureId): RegisteredFeature | undefined {
    const registration = this.registrations.get(id);
    return registration ? snapshotRegistration(registration) : undefined;
  }

  list(): readonly RegisteredFeature[] {
    return [...this.registrations.values()]
      .sort((left, right) => left.registrationOrder - right.registrationOrder)
      .map(snapshotRegistration);
  }

  discover(engineId?: string): readonly RegisteredFeature[] {
    return this.list().filter(({ feature }) => engineId === undefined ||
      feature.metadata.supportedEngines.includes("*") || feature.metadata.supportedEngines.includes(engineId));
  }

  setEnabled(id: FeatureId, enabled: boolean): void {
    const registration = this.require(id);
    registration.enabled = enabled;
    registration.lifecycle = enabled ? "registered" : "disabled";
    this.emit(id, enabled ? "feature:enabled" : "feature:disabled", registration.lifecycle, {});
  }

  isEnabled(id: FeatureId): boolean {
    return this.require(id).enabled;
  }

  validateDependencies(): void {
    for (const registration of this.registrations.values()) {
      for (const dependency of registration.feature.metadata.dependencies) {
        if (!this.registrations.has(dependency)) {
          throw new FeatureSdkError(
            "MISSING_DEPENDENCY",
            `Feature ${registration.feature.metadata.id} requires missing dependency ${dependency}`,
          );
        }
      }
    }
    this.executionOrder();
  }

  executionOrder(engineId?: string): readonly FeatureId[] {
    const candidates = [...this.registrations.values()].filter((registration) =>
      registration.enabled && (engineId === undefined || supportsEngine(registration.feature, engineId)));
    const candidateIds = new Set(candidates.map(({ feature }) => feature.metadata.id));
    for (const registration of candidates) {
      for (const dependency of registration.feature.metadata.dependencies) {
        const dependencyRegistration = this.registrations.get(dependency);
        if (!dependencyRegistration) {
          throw new FeatureSdkError("MISSING_DEPENDENCY", `Feature ${registration.feature.metadata.id} requires missing dependency ${dependency}`);
        }
        if (!dependencyRegistration.enabled || !candidateIds.has(dependency)) {
          throw new FeatureSdkError("MISSING_DEPENDENCY", `Enabled feature ${registration.feature.metadata.id} requires enabled compatible dependency ${dependency}`);
        }
      }
    }

    const resolved: FeatureId[] = [];
    const remaining = new Map(candidates.map((registration) => [registration.feature.metadata.id, registration]));
    while (remaining.size > 0) {
      const ready = [...remaining.values()]
        .filter(({ feature }) => feature.metadata.dependencies.every((dependency) => resolved.includes(dependency)))
        .sort(compareRegistrations);
      if (ready.length === 0) {
        throw new FeatureSdkError("DEPENDENCY_CYCLE", "Feature dependencies contain a cycle");
      }
      const registration = ready[0];
      if (!registration) throw new FeatureSdkError("DEPENDENCY_CYCLE", "Feature ordering could not select a ready feature");
      const id = registration.feature.metadata.id;
      resolved.push(id);
      remaining.delete(id);
    }
    return resolved;
  }

  async initialize(context: FeatureContext): Promise<readonly FeatureId[]> {
    const order = this.executionOrder(context.engineId);
    for (const id of order) {
      const registration = this.require(id);
      await registration.feature.initialize(this.scopedContext(context, id));
      registration.lifecycle = "initialized";
      this.emit(id, "feature:initialized", "initialized", {});
    }
    return order;
  }

  async trigger(context: FeatureContext): Promise<FeatureExecutionResult> {
    const order = this.executionOrder(context.engineId);
    const triggered: FeatureId[] = [];
    for (const id of order) {
      const registration = this.require(id);
      const scoped = this.scopedContext(context, id);
      if (!registration.feature.canTrigger(scoped)) continue;
      await registration.feature.trigger(scoped);
      registration.lifecycle = "triggered";
      triggered.push(id);
      this.emit(id, "feature:triggered", "triggered", {});
    }
    return { order, triggered };
  }

  async update(context: FeatureContext, deltaMs: number): Promise<readonly FeatureId[]> {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new TypeError("Feature update delta must be non-negative");
    const order = this.executionOrder(context.engineId);
    for (const id of order) {
      const registration = this.require(id);
      await registration.feature.update(this.scopedContext(context, id), deltaMs);
      registration.lifecycle = "updating";
      this.emit(id, "feature:updated", "updating", { deltaMs });
    }
    return order;
  }

  async cleanup(context: FeatureContext): Promise<readonly FeatureId[]> {
    const order = [...this.executionOrder(context.engineId)].reverse();
    for (const id of order) {
      const registration = this.require(id);
      await registration.feature.cleanup(this.scopedContext(context, id));
      registration.lifecycle = "cleaned";
      this.emit(id, "feature:cleaned", "cleaned", {});
    }
    return order;
  }

  subscribe(listener: (event: FeatureEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scopedContext(context: FeatureContext, feature: FeatureId): FeatureContext {
    return {
      ...context,
      emit: (type, payload = {}) => {
        context.emit(type, payload);
        this.emit(feature, type, this.require(feature).lifecycle, payload);
      },
      getFeatureState: (id) => this.registrations.get(id)?.feature.serialize(),
    };
  }

  private emit(featureId: FeatureId, type: string, lifecycle: FeatureLifecycle, payload: FeatureState): void {
    const event: FeatureEvent = { sequence: this.eventSequence, featureId, type, lifecycle, payload };
    this.eventSequence += 1;
    for (const listener of [...this.listeners]) listener(event);
  }

  private require(id: FeatureId): MutableRegistration {
    const registration = this.registrations.get(id);
    if (!registration) throw new FeatureSdkError("UNKNOWN_FEATURE", `Unknown feature: ${id}`);
    return registration;
  }
}

function validateMetadata(feature: Feature): void {
  const metadata = feature.metadata;
  if (!metadata.id || !metadata.name || !metadata.version || !metadata.description ||
      !Number.isSafeInteger(metadata.priority) || metadata.supportedEngines.length === 0 ||
      new Set(metadata.dependencies).size !== metadata.dependencies.length) {
    throw new TypeError("Feature metadata is incomplete or invalid");
  }
  if (metadata.dependencies.includes(metadata.id)) {
    throw new FeatureSdkError("DEPENDENCY_CYCLE", `Feature ${metadata.id} cannot depend on itself`);
  }
}

function supportsEngine(feature: Feature, engineId: string): boolean {
  return feature.metadata.supportedEngines.includes("*") || feature.metadata.supportedEngines.includes(engineId);
}

function compareRegistrations(left: MutableRegistration, right: MutableRegistration): number {
  return right.feature.metadata.priority - left.feature.metadata.priority ||
    left.registrationOrder - right.registrationOrder ||
    left.feature.metadata.id.localeCompare(right.feature.metadata.id);
}

function snapshotRegistration(registration: MutableRegistration): RegisteredFeature {
  return { ...registration };
}
