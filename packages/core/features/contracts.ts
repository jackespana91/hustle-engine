export type FeatureId = string & { readonly __brand: "FeatureId" };

export const featureId = (value: string): FeatureId => value as FeatureId;

export type FeatureLifecycle =
  | "registered"
  | "initialized"
  | "triggered"
  | "updating"
  | "disabled"
  | "cleaned";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type FeatureState = Readonly<Record<string, unknown>>;

export interface FeatureMetadata {
  readonly id: FeatureId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly supportedEngines: readonly string[];
  readonly dependencies: readonly FeatureId[];
  readonly priority: number;
}

export interface FeatureEvent {
  readonly sequence: number;
  readonly featureId: FeatureId;
  readonly type: string;
  readonly lifecycle: FeatureLifecycle;
  readonly payload: FeatureState;
}

export interface FeatureContext {
  readonly engineId: string;
  readonly tick: number;
  readonly input: FeatureState;
  readonly emit: (type: string, payload?: FeatureState) => void;
  readonly getFeatureState: (id: FeatureId) => FeatureState | undefined;
}

export interface Feature<State extends FeatureState = FeatureState> {
  readonly metadata: FeatureMetadata;
  initialize(context: FeatureContext): void | Promise<void>;
  canTrigger(context: FeatureContext): boolean;
  trigger(context: FeatureContext): void | Promise<void>;
  update(context: FeatureContext, deltaMs: number): void | Promise<void>;
  serialize(): State;
  deserialize(state: State): void;
  cleanup(context: FeatureContext): void | Promise<void>;
}

export interface RegisteredFeature {
  readonly feature: Feature;
  readonly enabled: boolean;
  readonly lifecycle: FeatureLifecycle;
  readonly registrationOrder: number;
}

export interface SerializedFeature {
  readonly id: FeatureId;
  readonly version: string;
  readonly enabled: boolean;
  readonly state: FeatureState;
}

export interface FeatureSnapshot {
  readonly schemaVersion: 1;
  readonly engineId: string;
  readonly features: readonly SerializedFeature[];
}
