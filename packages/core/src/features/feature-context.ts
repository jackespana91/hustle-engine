import {
  eventId as toEventId,
  roundId as toRoundId,
  type EventId,
  type RoundId,
  type RoundStatus,
} from "../contracts.js";
import {
  engineManifestId,
  featureManifestId,
  gameManifestId,
  type EngineManifestId,
  type FeatureManifestId,
  type GameManifestId,
} from "../manifests/manifest-types.js";
import { FeatureSdkError } from "./feature-errors.js";
import type {
  FeatureEmittedEvent,
  FeatureState,
} from "./feature-types.js";

export interface DeterministicRandomSource {
  /** Returns the next deterministic value in the half-open interval [0, 1). */
  next(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

/** A small deterministic source backed entirely by caller-supplied values. */
export class SequenceRandomSource implements DeterministicRandomSource {
  private cursor = 0;
  private readonly values: readonly number[];

  constructor(values: readonly number[]) {
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value >= 1)) {
      throw new FeatureSdkError(
        "INVALID_CONTEXT",
        "Deterministic random values must be finite numbers from 0 (inclusive) to 1 (exclusive)",
        { operation: "initialize" },
      );
    }
    this.values = [...values];
  }

  get remaining(): number { return this.values.length - this.cursor; }

  next(): number {
    const value = this.values[this.cursor];
    if (value === undefined) {
      throw new FeatureSdkError(
        "RANDOM_SOURCE_EXHAUSTED",
        "The deterministic random source has no values remaining",
        { operation: "trigger" },
      );
    }
    this.cursor += 1;
    return value;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new FeatureSdkError(
        "INVALID_CONTEXT",
        "Deterministic integer bounds must be safe integers with max greater than min",
        { operation: "trigger", context: { minInclusive, maxExclusive } },
      );
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  snapshot(): number { return this.cursor; }

  restore(snapshot: unknown): void {
    if (!Number.isSafeInteger(snapshot) || Number(snapshot) < 0 || Number(snapshot) > this.values.length) {
      throw new FeatureSdkError(
        "INVALID_SNAPSHOT",
        "Deterministic random cursor is outside the supplied sequence",
        { operation: "recover", context: { cursor: snapshot } },
      );
    }
    this.cursor = Number(snapshot);
  }

  clone(): SequenceRandomSource {
    const source = new SequenceRandomSource(this.values);
    source.restore(this.cursor);
    return source;
  }
}

export interface FeatureEventPublisher {
  publish(event: FeatureEmittedEvent): void;
}

export interface FeatureStateAccess<State extends FeatureState = FeatureState> {
  /** Returns a defensive immutable copy of the current feature's local state. */
  read(): State;
  /** Dependencies are readable but cannot be changed through the context. */
  readDependency(id: FeatureManifestId): FeatureState | undefined;
}

export interface FeatureContext<State extends FeatureState = FeatureState> {
  readonly featureId: FeatureManifestId;
  readonly roundId: RoundId;
  readonly eventId: EventId;
  readonly engineId: EngineManifestId;
  readonly gameId: GameManifestId;
  readonly currentLifecycleState: RoundStatus;
  readonly roundData: FeatureState;
  readonly sharedPresentationState: FeatureState;
  readonly featureState: FeatureStateAccess<State>;
  readonly random: DeterministicRandomSource;
  readonly events: FeatureEventPublisher;
  readonly timestamp: number | null;
  readonly logicalTick: number;
  readonly metadata: FeatureState;

  // Compatibility aliases for the earlier prototype context.
  readonly tick: number;
  readonly input: FeatureState;
  readonly emit: (name: string, payload?: FeatureState) => void;
  readonly getFeatureState: (id: FeatureManifestId) => FeatureState | undefined;
}

export interface FeatureContextOptions<State extends FeatureState = FeatureState> {
  readonly featureId: FeatureManifestId | string;
  readonly roundId: RoundId | string;
  readonly eventId: EventId | string;
  readonly engineId: EngineManifestId | string;
  readonly gameId: GameManifestId | string;
  readonly currentLifecycleState: RoundStatus;
  readonly roundData?: FeatureState;
  readonly sharedPresentationState?: FeatureState;
  readonly getLocalState?: () => State;
  readonly getDependencyState?: (id: FeatureManifestId) => FeatureState | undefined;
  readonly random: DeterministicRandomSource;
  readonly eventPublisher?: FeatureEventPublisher;
  readonly timestamp?: number;
  readonly logicalTick: number;
  readonly metadata?: FeatureState;

  // Compatibility inputs for callers migrating from the prototype context.
  readonly input?: FeatureState;
  readonly onEvent?: (event: FeatureEmittedEvent) => void;
  readonly getFeatureState?: (id: FeatureManifestId) => FeatureState | undefined;
}

export function createFeatureContext<State extends FeatureState = FeatureState>(
  options: FeatureContextOptions<State>,
): FeatureContext<State> {
  validateClock(options.logicalTick, options.timestamp);
  const scopedFeatureId = typeof options.featureId === "string" ? featureManifestId(options.featureId) : options.featureId;
  const currentState = options.getLocalState ?? (() => ({} as State));
  const dependencyReader = options.getDependencyState ?? options.getFeatureState ?? (() => undefined);
  const roundData = immutableRecord(options.roundData ?? options.input ?? {});
  const sharedPresentationState = immutableRecord(options.sharedPresentationState ?? {});
  const metadata = immutableRecord(options.metadata ?? {});

  const publish = (name: string, payload: FeatureState = {}): void => {
    if (name.trim() === "") {
      throw new FeatureSdkError("INVALID_CONTEXT", "Feature event name cannot be empty", {
        featureId: scopedFeatureId,
        operation: "trigger",
      });
    }
    const event = Object.freeze({ name, payload: immutableRecord(payload) });
    options.eventPublisher?.publish(event);
    options.onEvent?.(event);
  };

  const readLocal = (): State => immutableRecord(currentState()) as State;
  const readDependency = (id: FeatureManifestId): FeatureState | undefined => {
    if (id === scopedFeatureId) return readLocal();
    const state = dependencyReader(id);
    return state === undefined ? undefined : immutableRecord(state);
  };
  const stateAccess = Object.freeze({ read: readLocal, readDependency });
  const events = Object.freeze({ publish: (event: FeatureEmittedEvent) => publish(event.name, event.payload) });

  return Object.freeze({
    featureId: scopedFeatureId,
    roundId: typeof options.roundId === "string" ? toRoundId(options.roundId) : options.roundId,
    eventId: typeof options.eventId === "string" ? toEventId(options.eventId) : options.eventId,
    engineId: typeof options.engineId === "string" ? engineManifestId(options.engineId) : options.engineId,
    gameId: typeof options.gameId === "string" ? gameManifestId(options.gameId) : options.gameId,
    currentLifecycleState: options.currentLifecycleState,
    roundData,
    sharedPresentationState,
    featureState: stateAccess,
    random: options.random,
    events,
    timestamp: options.timestamp ?? null,
    logicalTick: options.logicalTick,
    metadata,
    tick: options.logicalTick,
    input: roundData,
    emit: publish,
    getFeatureState: readDependency,
  });
}

function validateClock(logicalTick: number, timestamp: number | undefined): void {
  if (!Number.isSafeInteger(logicalTick) || logicalTick < 0) {
    throw new FeatureSdkError("INVALID_CONTEXT", "Feature logical tick must be a non-negative safe integer", {
      operation: "initialize",
      context: { logicalTick },
    });
  }
  if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) {
    throw new FeatureSdkError("INVALID_CONTEXT", "Feature timestamp must be a non-negative finite number", {
      operation: "initialize",
      context: { timestamp },
    });
  }
}

function immutableRecord<Value extends FeatureState>(value: Value): Value {
  assertJsonSafe(value, "$", new WeakSet<object>());
  return deepFreeze(structuredClone(value));
}

function assertJsonSafe(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw invalidContextValue(path, "numbers must be finite");
  }
  if (typeof value !== "object") throw invalidContextValue(path, `unsupported ${typeof value} value`);
  if (seen.has(value)) throw invalidContextValue(path, "cyclic values are not supported");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonSafe(entry, `${path}.${index}`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) throw invalidContextValue(path, "only plain objects are supported");
    Object.entries(value).forEach(([key, entry]) => assertJsonSafe(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
}

function invalidContextValue(path: string, reason: string): FeatureSdkError {
  return new FeatureSdkError("INVALID_CONTEXT", `Feature context ${path} is not JSON-safe: ${reason}`, {
    operation: "initialize",
    context: { path, reason },
  });
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) value.forEach((entry) => deepFreeze(entry));
  else Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}
