import type { FeatureContext, FeatureEvent, FeatureId, FeatureState } from "./contracts.js";

export type { FeatureContext } from "./contracts.js";

export interface FeatureContextOptions {
  readonly engineId: string;
  readonly tick?: number;
  readonly input?: FeatureState;
  readonly onEvent?: (event: Omit<FeatureEvent, "sequence" | "featureId" | "lifecycle">) => void;
  readonly getFeatureState?: (id: FeatureId) => FeatureState | undefined;
}

export function createFeatureContext(options: FeatureContextOptions): FeatureContext {
  return {
    engineId: options.engineId,
    tick: options.tick ?? 0,
    input: options.input ?? {},
    emit: (type, payload = {}) => options.onEvent?.({ type, payload }),
    getFeatureState: options.getFeatureState ?? (() => undefined),
  };
}
