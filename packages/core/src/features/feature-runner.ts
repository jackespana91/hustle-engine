import type { EventId, RoundId, RoundStatus } from "../contracts.js";
import type {
  EngineManifestId,
  FeatureManifestId,
  GameManifestId,
} from "../manifests/manifest-types.js";
import {
  createFeatureContext,
  type DeterministicRandomSource,
  type FeatureContext,
  type FeatureEventPublisher,
} from "./feature-context.js";
import { compareAscii } from "./feature-dependencies.js";
import {
  FeatureSdkError,
  type FeatureErrorCode,
  type FeatureErrorRecord,
} from "./feature-errors.js";
import type { FeatureRegistry } from "./feature-registry.js";
import {
  assertFeatureState,
  cloneFeatureState,
  mergeFeatureState,
} from "./feature-state.js";
import {
  createFeatureResult,
  type FeatureContinuation,
  type FeatureEmittedEvent,
  type FeatureFailureInformation,
  type FeatureFailurePolicy,
  type FeatureHookResult,
  type FeatureImplementation,
  type FeatureLifecycleOperation,
  type FeatureLifecycleStatus,
  type FeatureResult,
  type FeatureState,
  type FeatureTelemetry,
  type FeatureWarning,
  type RegisteredFeature,
} from "./feature-types.js";

export interface FeatureRunnerContextInput {
  readonly roundId: RoundId | string;
  readonly eventId: EventId | string;
  readonly engineId: EngineManifestId | string;
  readonly gameId: GameManifestId | string;
  readonly currentLifecycleState: RoundStatus;
  readonly roundData?: FeatureState;
  readonly sharedPresentationState?: FeatureState;
  readonly random: DeterministicRandomSource;
  readonly timestamp?: number;
  readonly logicalTick: number;
  readonly metadata?: FeatureState;
}

export interface FeatureRunnerRecord {
  readonly featureId: FeatureManifestId;
  readonly operation: FeatureLifecycleOperation;
  readonly executionOrder: number;
  readonly executionId: string;
  readonly result: FeatureResult;
}

/** One deterministic batch plus the explicit, controller-facing FeatureResult. */
export interface FeatureRunnerResult {
  readonly result: FeatureResult;
  readonly executionOrder: readonly FeatureManifestId[];
  readonly executedFeatureIds: readonly FeatureManifestId[];
  readonly triggeredFeatureIds: readonly FeatureManifestId[];
  readonly skippedFeatureIds: readonly FeatureManifestId[];
  readonly records: readonly FeatureRunnerRecord[];
  readonly failures: readonly FeatureErrorRecord[];
}

interface MutableRun {
  readonly executionOrder: readonly FeatureManifestId[];
  readonly executedFeatureIds: FeatureManifestId[];
  readonly triggeredFeatureIds: FeatureManifestId[];
  readonly skippedFeatureIds: FeatureManifestId[];
  readonly records: FeatureRunnerRecord[];
  readonly failures: FeatureErrorRecord[];
  readonly emittedEvents: FeatureEmittedEvent[];
  readonly animationCommands: FeatureResult["animationCommands"][number][];
  readonly featureStateUpdates: FeatureResult["featureStateUpdates"][number][];
  readonly sharedStateProposals: FeatureResult["sharedStateProposals"][number][];
  readonly warnings: FeatureWarning[];
  readonly telemetry: Record<string, FeatureTelemetry[string]>;
  readonly animationIds: Set<string>;
  continuation: FeatureContinuation;
  failure: FeatureFailureInformation | null;
}

interface InvocationSuccess {
  readonly kind: "success";
  readonly result: FeatureResult;
}

interface InvocationFailure {
  readonly kind: "failure";
  readonly error: FeatureSdkError;
}

interface InvocationInterrupted {
  readonly kind: "interrupted";
}

type InvocationOutcome = InvocationSuccess | InvocationFailure | InvocationInterrupted;

interface InvokeOptions {
  readonly registration: RegisteredFeature;
  readonly input: FeatureRunnerContextInput;
  readonly operation: FeatureLifecycleOperation;
  readonly generation: number;
  readonly reservedAnimationIds: ReadonlySet<string>;
  readonly hook: (implementation: FeatureImplementation, context: FeatureContext) => FeatureHookResult;
}

const ACTIVE_INITIALIZATION_STATUSES: readonly FeatureLifecycleStatus[] = [
  "initialized",
  "round-initializing",
  "ready",
  "evaluating",
  "triggered",
  "skipped",
  "updating",
  "interrupted",
  "recovering",
  "completed",
  "failed",
  "cleaning",
];

/**
 * Deterministic asynchronous lifecycle orchestration over FeatureRegistry.
 *
 * The runner never applies animation commands or shared-state proposals. It
 * returns those as data for the host controller. Feature-local updates are
 * committed only after a hook succeeds and its generation is still current.
 */
export class FeatureRunner {
  private generationValue = 0;
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly executionLedgerValue = new Set<string>();

  constructor(readonly registry: FeatureRegistry) {}

  get generation(): number { return this.generationValue; }

  get executionLedger(): readonly string[] {
    return [...this.executionLedgerValue].sort(compareAscii);
  }

  restoreExecutionLedger(executionIds: readonly string[]): void {
    if (executionIds.some((id) => typeof id !== "string" || id.trim() === "")) {
      throw new FeatureSdkError("INVALID_SNAPSHOT", "Feature execution ledger contains an invalid token", {
        operation: "recover",
      });
    }
    this.executionLedgerValue.clear();
    [...new Set(executionIds)].sort(compareAscii).forEach((id) => this.executionLedgerValue.add(id));
  }

  clearExecutionLedger(): void {
    this.executionLedgerValue.clear();
  }

  createContext(
    featureId: FeatureManifestId | string,
    input: FeatureRunnerContextInput,
    eventPublisher?: FeatureEventPublisher,
  ): FeatureContext {
    const registration = this.registry.require(featureId);
    return createFeatureContext({
      featureId: registration.manifest.id,
      roundId: input.roundId,
      eventId: input.eventId,
      engineId: input.engineId,
      gameId: input.gameId,
      currentLifecycleState: input.currentLifecycleState,
      roundData: input.roundData ?? {},
      sharedPresentationState: input.sharedPresentationState ?? {},
      getLocalState: () => this.registry.getState(registration.manifest.id),
      getDependencyState: (id) => this.registry.has(id) ? this.registry.getState(id) : undefined,
      random: input.random,
      ...(eventPublisher === undefined ? {} : { eventPublisher }),
      ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
      logicalTick: input.logicalTick,
      metadata: input.metadata ?? {},
    });
  }

  /** Initializes each enabled implementation once per active registry lifetime. */
  async initialize(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    const order = this.registry.resolveExecutionOrder(input.engineId);
    const run = createMutableRun(order);
    const generation = this.generationValue;

    for (let index = 0; index < order.length; index += 1) {
      if (generation !== this.generationValue) break;
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      if (ACTIVE_INITIALIZATION_STATUSES.includes(registration.lifecycleStatus)) {
        recordSkipped(run, id);
        continue;
      }
      const token = executionToken(input, id, "initialize");
      if (this.isCompleted(id, token)) {
        this.publishSkipped(id, "already completed during a prior execution");
        recordSkipped(run, id);
        continue;
      }

      this.registry.setLifecycle(id, "initializing");
      const outcome = await this.invoke({
        registration,
        input,
        operation: "initialize",
        generation,
        reservedAnimationIds: run.animationIds,
        hook: (implementation, context) => implementation.initialize(context),
      });
      const shouldContinue = await this.finishInvocation(run, registration, outcome, index, token, "initialize", "initialized", false);
      if (!shouldContinue) break;
      if (outcome.kind === "success") {
        this.registry.events.publish("feature:initialized", reference(this.registry.require(id)));
      }
    }
    return finalizeRun(run);
  }

  /** Prepares per-round runtime status without re-running global initialize hooks. */
  async initializeRound(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    const initialized = await this.initialize(input);
    const order = this.registry.resolveExecutionOrder(input.engineId);
    const run = createMutableRun(order);
    mergeRunnerResult(run, initialized);

    for (let index = 0; index < order.length; index += 1) {
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      if (registration.lifecycleStatus === "failed" || registration.lifecycleStatus === "interrupted") {
        recordSkipped(run, id);
        continue;
      }
      const token = executionToken(input, id, "initialize-round");
      if (this.isCompleted(id, token)) {
        recordSkipped(run, id);
        continue;
      }
      // Constructing the context validates all caller-controlled round data.
      this.createContext(id, input);
      this.registry.setLifecycle(id, "round-initializing");
      this.registry.setLifecycle(id, "ready");
      this.markToken(id, token, index, false);
      run.executedFeatureIds.push(id);
      const result = createFeatureResult();
      run.records.push({ featureId: id, operation: "initialize-round", executionOrder: index, executionId: token, result });
      this.registry.events.publish("feature:initialized", reference(this.registry.require(id)));
    }
    return finalizeRun(run);
  }

  async canTrigger(featureId: FeatureManifestId | string, input: FeatureRunnerContextInput): Promise<boolean> {
    const registration = this.registry.require(featureId);
    if (!registration.enabled) {
      this.publishSkipped(registration.manifest.id, "feature is disabled");
      return false;
    }
    this.registry.setLifecycle(registration.manifest.id, "evaluating");
    const evaluation = await this.evaluateCanTrigger(registration, input, this.generationValue);
    if (evaluation.kind === "success") {
      this.registry.setLifecycle(registration.manifest.id, evaluation.eligible ? "ready" : "skipped");
      if (!evaluation.eligible) this.publishSkipped(registration.manifest.id, "canTrigger returned false");
      return evaluation.eligible;
    }
    if (evaluation.kind === "interrupted") return false;
    const error = this.recordFailure(registration, evaluation.error, "can-trigger");
    if (registration.implementation.failurePolicy === "blocking") throw error;
    return false;
  }

  /** Evaluates and triggers all eligible features in deterministic order. */
  async trigger(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    const order = this.registry.resolveExecutionOrder(input.engineId);
    const run = createMutableRun(order);
    const generation = this.generationValue;
    const failedDependencies = new Set<FeatureManifestId>();

    for (let index = 0; index < order.length; index += 1) {
      if (generation !== this.generationValue) break;
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      const token = executionToken(input, id, "trigger");
      const failedDependency = registration.manifest.dependencies.find((dependency) => failedDependencies.has(dependency));
      if (failedDependency) {
        this.registry.setLifecycle(id, "skipped");
        this.markToken(id, token, index, false);
        this.publishSkipped(id, `required dependency ${failedDependency} failed`);
        recordSkipped(run, id);
        failedDependencies.add(id);
        continue;
      }
      if (this.isCompleted(id, token)) {
        this.publishSkipped(id, "already completed during a prior execution");
        recordSkipped(run, id);
        continue;
      }

      this.registry.setLifecycle(id, "evaluating");
      const beforeEvaluationRandom = input.random.snapshot();
      const evaluation = await this.evaluateCanTrigger(registration, input, generation);
      if (evaluation.kind === "interrupted") {
        this.registry.setLifecycle(id, "interrupted");
        recordSkipped(run, id);
        break;
      }
      if (evaluation.kind === "failure") {
        const error = this.recordFailure(registration, evaluation.error, "can-trigger");
        recordFailure(run, id, error);
        failedDependencies.add(id);
        const policy = error.failurePolicy ?? registration.implementation.failurePolicy;
        if (policy === "non-blocking") this.markToken(id, token, index, false);
        if (policy === "blocking") throw error;
        continue;
      }
      appendEvents(run, evaluation.emittedEvents);
      if (!evaluation.eligible) {
        this.registry.setLifecycle(id, "skipped");
        this.markToken(id, token, index, false);
        this.publishSkipped(id, "canTrigger returned false");
        recordSkipped(run, id);
        continue;
      }

      this.registry.setLifecycle(id, "triggered");
      const outcome = await this.invoke({
        registration,
        input,
        operation: "trigger",
        generation,
        reservedAnimationIds: run.animationIds,
        hook: (implementation, context) => implementation.trigger(context),
      });
      if (outcome.kind !== "success") input.random.restore(beforeEvaluationRandom);
      const shouldContinue = await this.finishInvocation(run, registration, outcome, index, token, "trigger", "completed", true);
      if (outcome.kind === "failure") failedDependencies.add(id);
      if (outcome.kind === "success") {
        const result = withTriggered(outcome.result);
        this.registry.setLifecycle(id, "triggered");
        this.registry.events.publish("feature:triggered", {
          ...reference(this.registry.require(id)),
          result,
          executionOrder: index,
        });
        this.registry.setLifecycle(id, "completed");
        this.registry.events.publish("feature:completed", {
          ...reference(this.registry.require(id)),
          result,
          executionOrder: index,
        });
      }
      if (!shouldContinue) {
        if (outcome.kind === "success" && outcome.result.continuation.action === "stop") {
          this.skipRemainder(run, order, index + 1, input, "continuation requested stop");
        }
        break;
      }
    }
    return finalizeRun(run);
  }

  /** Compatibility alias for hosts that describe a trigger batch as execution. */
  execute(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    return this.trigger(input);
  }

  async update(input: FeatureRunnerContextInput, deltaMs: number): Promise<FeatureRunnerResult> {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new FeatureSdkError("INVALID_CONTEXT", "Feature update delta must be a non-negative finite number", {
        operation: "update",
        context: { deltaMs },
      });
    }
    const order = this.registry.resolveExecutionOrder(input.engineId);
    const run = createMutableRun(order);
    const generation = this.generationValue;

    for (let index = 0; index < order.length; index += 1) {
      if (generation !== this.generationValue) break;
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      const token = executionToken(input, id, `update:${input.logicalTick}`);
      if (this.isCompleted(id, token)) {
        this.publishSkipped(id, "update already completed for this logical tick");
        recordSkipped(run, id);
        continue;
      }
      this.registry.setLifecycle(id, "updating");
      const outcome = await this.invoke({
        registration,
        input,
        operation: "update",
        generation,
        reservedAnimationIds: run.animationIds,
        hook: (implementation, context) => implementation.update(context, deltaMs),
      });
      const shouldContinue = await this.finishInvocation(run, registration, outcome, index, token, "update", "ready", false);
      if (!shouldContinue) break;
    }
    return finalizeRun(run);
  }

  /** Invalidates active generations before invoking feature-specific interrupts. */
  async interrupt(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    const generation = this.invalidateGeneration();
    await this.waitForInFlight();
    const order = [...this.registry.resolveExecutionOrder(input.engineId)].reverse();
    const run = createMutableRun(order);
    const blockingErrors: FeatureSdkError[] = [];

    for (let index = 0; index < order.length; index += 1) {
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      const token = executionToken(input, id, `interrupt:${input.logicalTick}`);
      if (this.isCompleted(id, token)) {
        recordSkipped(run, id);
        continue;
      }
      this.registry.setLifecycle(id, "interrupted");
      const hook = registration.implementation.interrupt;
      if (hook === undefined) {
        this.createContext(id, input);
        this.markToken(id, token, index, false);
        run.executedFeatureIds.push(id);
        run.records.push({ featureId: id, operation: "interrupt", executionOrder: index, executionId: token, result: createFeatureResult() });
        continue;
      }
      const outcome = await this.invoke({
        registration,
        input,
        operation: "interrupt",
        generation,
        reservedAnimationIds: run.animationIds,
        hook: (implementation, context) => implementation.interrupt?.(context),
      });
      const shouldContinue = await this.finishInvocation(run, registration, outcome, index, token, "interrupt", "interrupted", false, true);
      if (!shouldContinue && outcome.kind === "failure" && effectivePolicy(registration, outcome.error) === "blocking") {
        blockingErrors.push(this.normalizeFailure(registration, outcome.error, "interrupt"));
      }
    }
    const first = blockingErrors[0];
    if (first) throw first;
    return finalizeRun(run);
  }

  /** Re-establishes recovery-facing contexts after state deserialization succeeds. */
  async recover(
    input: FeatureRunnerContextInput,
    executionLedger?: readonly string[],
  ): Promise<FeatureRunnerResult> {
    this.invalidateGeneration();
    await this.waitForInFlight();
    if (executionLedger !== undefined) this.restoreExecutionLedger(executionLedger);
    const order = this.registry.resolveExecutionOrder(input.engineId);
    const run = createMutableRun(order);
    for (let index = 0; index < order.length; index += 1) {
      const id = requireOrderId(order, index);
      this.registry.setLifecycle(id, "recovering");
      this.createContext(id, input);
      this.registry.setLifecycle(id, "ready");
      run.executedFeatureIds.push(id);
      run.records.push({
        featureId: id,
        operation: "recover",
        executionOrder: index,
        executionId: executionToken(input, id, "recover"),
        result: createFeatureResult(),
      });
    }
    return finalizeRun(run);
  }

  async completeRound(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    const order = this.registry.resolveExecutionOrder(input.engineId);
    const run = createMutableRun(order);
    const generation = this.generationValue;
    for (let index = 0; index < order.length; index += 1) {
      if (generation !== this.generationValue) break;
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      const token = executionToken(input, id, "complete-round");
      if (this.isCompleted(id, token)) {
        recordSkipped(run, id);
        continue;
      }
      const hook = registration.implementation.completeRound;
      if (hook === undefined) {
        this.createContext(id, input);
        this.registry.setLifecycle(id, "completed");
        this.markToken(id, token, index, false);
        const result = createFeatureResult();
        run.executedFeatureIds.push(id);
        run.records.push({ featureId: id, operation: "complete-round", executionOrder: index, executionId: token, result });
        this.registry.events.publish("feature:completed", { ...reference(this.registry.require(id)), result, executionOrder: index });
        continue;
      }
      const outcome = await this.invoke({
        registration,
        input,
        operation: "complete-round",
        generation,
        reservedAnimationIds: run.animationIds,
        hook: (implementation, context) => implementation.completeRound?.(context),
      });
      const shouldContinue = await this.finishInvocation(run, registration, outcome, index, token, "complete-round", "completed", false);
      if (outcome.kind === "success") {
        this.registry.events.publish("feature:completed", {
          ...reference(this.registry.require(id)),
          result: outcome.result,
          executionOrder: index,
        });
      }
      if (!shouldContinue) break;
    }
    return finalizeRun(run);
  }

  /** Runs every cleanup attempt in reverse deterministic order before throwing. */
  async cleanup(input: FeatureRunnerContextInput): Promise<FeatureRunnerResult> {
    const generation = this.invalidateGeneration();
    await this.waitForInFlight();
    const order = this.cleanupOrder(input.engineId);
    const run = createMutableRun(order);
    const blockingErrors: FeatureSdkError[] = [];

    for (let index = 0; index < order.length; index += 1) {
      const id = requireOrderId(order, index);
      const registration = this.registry.require(id);
      const token = executionToken(input, id, "cleanup");
      if (this.isCompleted(id, token)) {
        recordSkipped(run, id);
        continue;
      }
      this.registry.setLifecycle(id, "cleaning");
      const outcome = await this.invoke({
        registration,
        input,
        operation: "cleanup",
        generation,
        reservedAnimationIds: run.animationIds,
        hook: (implementation, context) => implementation.cleanup(context),
      });
      await this.finishInvocation(run, registration, outcome, index, token, "cleanup", "cleaned", false, true);
      if (outcome.kind === "success") {
        this.registry.events.publish("feature:cleanup-completed", reference(this.registry.require(id)));
      } else if (outcome.kind === "failure" && effectivePolicy(registration, outcome.error) === "blocking") {
        blockingErrors.push(this.normalizeFailure(registration, outcome.error, "cleanup"));
      }
    }
    const first = blockingErrors[0];
    if (first) throw first;
    return finalizeRun(run);
  }

  private async evaluateCanTrigger(
    registration: RegisteredFeature,
    input: FeatureRunnerContextInput,
    generation: number,
  ): Promise<
    | { readonly kind: "success"; readonly eligible: boolean; readonly emittedEvents: readonly FeatureEmittedEvent[] }
    | InvocationFailure
    | InvocationInterrupted
  > {
    return this.track(this.performCanTriggerEvaluation(registration, input, generation));
  }

  private async performCanTriggerEvaluation(
    registration: RegisteredFeature,
    input: FeatureRunnerContextInput,
    generation: number,
  ): Promise<
    | { readonly kind: "success"; readonly eligible: boolean; readonly emittedEvents: readonly FeatureEmittedEvent[] }
    | InvocationFailure
    | InvocationInterrupted
  > {
    const id = registration.manifest.id;
    const beforeState = this.registry.getState(id);
    const beforeRandom = input.random.snapshot();
    const emittedEvents: FeatureEmittedEvent[] = [];
    const context = this.createContext(id, input, collector(emittedEvents));
    try {
      const eligible = await registration.implementation.canTrigger(context);
      if (generation !== this.generationValue) {
        await this.rollback(id, beforeState, input.random, beforeRandom);
        return { kind: "interrupted" };
      }
      if (typeof eligible !== "boolean") {
        throw new FeatureSdkError("INVALID_RESULT", `Feature ${id} canTrigger must return a boolean`, {
          featureId: id,
          operation: "can-trigger",
        });
      }
      if (canonical(this.registry.getState(id)) !== canonical(beforeState)) {
        await this.rollback(id, beforeState, input.random, beforeRandom);
        throw new FeatureSdkError("INVALID_RESULT", `Feature ${id} mutated state during canTrigger`, {
          featureId: id,
          operation: "can-trigger",
        });
      }
      return { kind: "success", eligible, emittedEvents: structuredClone(emittedEvents) };
    } catch (error) {
      try { await this.rollback(id, beforeState, input.random, beforeRandom); }
      catch (rollbackError) { return { kind: "failure", error: rollbackFailure(id, rollbackError, error) }; }
      return { kind: "failure", error: this.normalizeFailure(registration, error, "can-trigger") };
    }
  }

  private invoke(options: InvokeOptions): Promise<InvocationOutcome> {
    return this.track(this.performInvocation(options));
  }

  private async performInvocation(options: InvokeOptions): Promise<InvocationOutcome> {
    const id = options.registration.manifest.id;
    const beforeState = this.registry.getState(id);
    const beforeRandom = options.input.random.snapshot();
    const emittedEvents: FeatureEmittedEvent[] = [];
    const context = this.createContext(id, options.input, collector(emittedEvents));
    try {
      const hookResult = await options.hook(options.registration.implementation, context);
      if (options.generation !== this.generationValue) {
        await this.rollback(id, beforeState, options.input.random, beforeRandom);
        this.registry.setLifecycle(id, "interrupted");
        return { kind: "interrupted" };
      }
      const result = normalizeResult(hookResult, emittedEvents);
      if (result.failure !== null) {
        throw new FeatureSdkError(errorCodeFor(options.operation), result.failure.message, {
          featureId: id,
          operation: options.operation,
          failurePolicy: options.registration.implementation.failurePolicy,
          recoverable: result.failure.recoverable,
          ...(result.failure.details === undefined ? {} : { context: result.failure.details }),
        });
      }
      const duplicate = result.animationCommands.find((command) => options.reservedAnimationIds.has(command.id));
      if (duplicate) {
        throw new FeatureSdkError("INVALID_RESULT", `Feature ${id} produced duplicate animation ID ${duplicate.id}`, {
          featureId: id,
          operation: options.operation,
        });
      }
      await this.applyStateUpdates(id, result);
      if (options.generation !== this.generationValue) {
        await this.rollback(id, beforeState, options.input.random, beforeRandom);
        this.registry.setLifecycle(id, "interrupted");
        return { kind: "interrupted" };
      }
      result.warnings.forEach((warning) => this.registry.addWarning(id, warning));
      return { kind: "success", result };
    } catch (error) {
      try { await this.rollback(id, beforeState, options.input.random, beforeRandom); }
      catch (rollbackError) { return { kind: "failure", error: rollbackFailure(id, rollbackError, error) }; }
      return { kind: "failure", error: this.normalizeFailure(options.registration, error, options.operation) };
    }
  }

  private async applyStateUpdates(featureId: FeatureManifestId, result: FeatureResult): Promise<void> {
    if (result.featureStateUpdates.length === 0) return;
    let next = this.registry.getState(featureId);
    for (const update of result.featureStateUpdates) {
      assertFeatureState(update.state);
      next = mergeFeatureState(next, update.state, update.strategy);
    }
    await this.registry.replaceState(featureId, next);
  }

  private async finishInvocation(
    run: MutableRun,
    registration: RegisteredFeature,
    outcome: InvocationOutcome,
    executionOrder: number,
    executionId: string,
    operation: FeatureLifecycleOperation,
    successStatus: FeatureLifecycleStatus,
    countExecution: boolean,
    continueAfterBlockingFailure = false,
  ): Promise<boolean> {
    const id = registration.manifest.id;
    if (outcome.kind === "interrupted") {
      this.registry.setLifecycle(id, "interrupted");
      recordSkipped(run, id);
      return false;
    }
    if (outcome.kind === "failure") {
      const error = this.recordFailure(registration, outcome.error, operation);
      recordFailure(run, id, error);
      const policy = error.failurePolicy ?? registration.implementation.failurePolicy;
      if (policy === "non-blocking") this.markToken(id, executionId, executionOrder, false);
      if (policy === "blocking" && !continueAfterBlockingFailure) throw error;
      return policy === "non-blocking";
    }

    const result = countExecution ? withTriggered(outcome.result) : outcome.result;
    this.registry.setLifecycle(id, successStatus);
    this.markToken(id, executionId, executionOrder, countExecution);
    addSuccess(run, id, operation, executionOrder, executionId, result, countExecution);
    return result.continuation.action === "continue";
  }

  private recordFailure(
    registration: RegisteredFeature,
    error: unknown,
    operation: FeatureLifecycleOperation,
  ): FeatureSdkError {
    const normalized = this.normalizeFailure(registration, error, operation);
    const id = registration.manifest.id;
    this.registry.setLifecycle(id, "failed");
    const policy = normalized.failurePolicy ?? registration.implementation.failurePolicy;
    const information: FeatureFailureInformation = {
      code: normalized.code,
      message: normalized.message,
      recoverable: normalized.recoverable || policy === "non-blocking",
      ...(normalized.context === undefined ? {} : { details: cloneFeatureState(normalized.context) }),
    };
    this.registry.addRecoverableError(id, information);
    this.registry.events.publish("feature:failed", {
      ...reference(this.registry.require(id)),
      error: normalized.toRecord(),
      failurePolicy: policy,
    });
    return normalized;
  }

  private normalizeFailure(
    registration: RegisteredFeature,
    error: unknown,
    operation: FeatureLifecycleOperation,
  ): FeatureSdkError {
    const existing = error instanceof FeatureSdkError ? error : null;
    const policy = effectivePolicy(registration, existing);
    return new FeatureSdkError(
      existing?.code ?? errorCodeFor(operation),
      existing?.message ?? `Feature ${registration.manifest.id} failed during ${operation}`,
      {
        featureId: registration.manifest.id,
        operation,
        failurePolicy: policy,
        recoverable: existing?.recoverable === true || policy === "non-blocking",
        ...(existing?.context === undefined ? {} : { context: existing.context }),
        cause: error,
      },
    );
  }

  private markToken(
    featureId: FeatureManifestId,
    executionId: string,
    executionOrder: number,
    countExecution: boolean,
  ): void {
    this.executionLedgerValue.add(executionId);
    if (countExecution) {
      this.registry.markExecution(featureId, executionOrder, executionId);
      return;
    }
    const metadata = this.registry.runtimeMetadata(featureId);
    this.registry.applyRuntimeMetadata(featureId, {
      ...metadata,
      completedExecutionIds: [...new Set([...metadata.completedExecutionIds, executionId])].sort(compareAscii),
    });
  }

  private isCompleted(featureId: FeatureManifestId, executionId: string): boolean {
    return this.executionLedgerValue.has(executionId) || this.registry.hasCompletedExecution(featureId, executionId);
  }

  private async rollback(
    featureId: FeatureManifestId,
    state: FeatureState,
    random: DeterministicRandomSource,
    randomSnapshot: unknown,
  ): Promise<void> {
    await this.registry.replaceState(featureId, cloneFeatureState(state));
    random.restore(randomSnapshot);
  }

  private track<Value>(promise: Promise<Value>): Promise<Value> {
    this.inFlight.add(promise);
    void promise.then(
      () => this.inFlight.delete(promise),
      () => this.inFlight.delete(promise),
    );
    return promise;
  }

  private async waitForInFlight(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private invalidateGeneration(): number {
    this.generationValue += 1;
    return this.generationValue;
  }

  private cleanupOrder(engineId: EngineManifestId | string): readonly FeatureManifestId[] {
    const enabled = [...this.registry.resolveExecutionOrder(engineId)].reverse();
    const enabledIds = new Set(enabled);
    const disabled = this.registry.filterByEngineCompatibility(engineId)
      .filter(({ manifest }) => !enabledIds.has(manifest.id))
      .map(({ manifest }) => manifest.id)
      .sort(compareAscii)
      .reverse();
    return [...enabled, ...disabled];
  }

  private publishSkipped(featureId: FeatureManifestId, reason: string): void {
    this.registry.events.publish("feature:skipped", {
      ...reference(this.registry.require(featureId)),
      reason,
    });
  }

  private skipRemainder(
    run: MutableRun,
    order: readonly FeatureManifestId[],
    start: number,
    input: FeatureRunnerContextInput,
    reason: string,
  ): void {
    for (let index = start; index < order.length; index += 1) {
      const id = requireOrderId(order, index);
      const token = executionToken(input, id, "trigger");
      if (!this.isCompleted(id, token)) this.markToken(id, token, index, false);
      this.registry.setLifecycle(id, "skipped");
      this.publishSkipped(id, reason);
      recordSkipped(run, id);
    }
  }
}

function createMutableRun(executionOrder: readonly FeatureManifestId[]): MutableRun {
  return {
    executionOrder: [...executionOrder],
    executedFeatureIds: [],
    triggeredFeatureIds: [],
    skippedFeatureIds: [],
    records: [],
    failures: [],
    emittedEvents: [],
    animationCommands: [],
    featureStateUpdates: [],
    sharedStateProposals: [],
    warnings: [],
    telemetry: {},
    animationIds: new Set(),
    continuation: { action: "continue" },
    failure: null,
  };
}

function finalizeRun(run: MutableRun): FeatureRunnerResult {
  return {
    result: createFeatureResult({
      triggered: run.triggeredFeatureIds.length > 0,
      emittedEvents: structuredClone(run.emittedEvents),
      animationCommands: structuredClone(run.animationCommands),
      featureStateUpdates: structuredClone(run.featureStateUpdates),
      sharedStateProposals: structuredClone(run.sharedStateProposals),
      warnings: structuredClone(run.warnings),
      telemetry: structuredClone(run.telemetry),
      continuation: structuredClone(run.continuation),
      failure: run.failure === null ? null : structuredClone(run.failure),
    }),
    executionOrder: [...run.executionOrder],
    executedFeatureIds: [...new Set(run.executedFeatureIds)],
    triggeredFeatureIds: [...new Set(run.triggeredFeatureIds)],
    skippedFeatureIds: [...new Set(run.skippedFeatureIds)],
    records: structuredClone(run.records),
    failures: structuredClone(run.failures),
  };
}

function mergeRunnerResult(run: MutableRun, value: FeatureRunnerResult): void {
  value.executedFeatureIds.forEach((id) => run.executedFeatureIds.push(id));
  value.triggeredFeatureIds.forEach((id) => run.triggeredFeatureIds.push(id));
  value.skippedFeatureIds.forEach((id) => run.skippedFeatureIds.push(id));
  value.records.forEach((record) => run.records.push(structuredClone(record)));
  value.failures.forEach((failure) => run.failures.push(structuredClone(failure)));
  appendEvents(run, value.result.emittedEvents);
  value.result.animationCommands.forEach((command) => {
    if (!run.animationIds.has(command.id)) {
      run.animationIds.add(command.id);
      run.animationCommands.push(structuredClone(command));
    }
  });
  value.result.featureStateUpdates.forEach((update) => run.featureStateUpdates.push(structuredClone(update)));
  value.result.sharedStateProposals.forEach((proposal) => run.sharedStateProposals.push(structuredClone(proposal)));
  value.result.warnings.forEach((warning) => run.warnings.push(structuredClone(warning)));
  Object.assign(run.telemetry, value.result.telemetry);
  if (run.continuation.action === "continue") run.continuation = structuredClone(value.result.continuation);
  if (run.failure === null && value.result.failure !== null) run.failure = structuredClone(value.result.failure);
}

function addSuccess(
  run: MutableRun,
  featureId: FeatureManifestId,
  operation: FeatureLifecycleOperation,
  executionOrder: number,
  executionId: string,
  result: FeatureResult,
  triggered: boolean,
): void {
  run.executedFeatureIds.push(featureId);
  if (triggered) run.triggeredFeatureIds.push(featureId);
  appendEvents(run, result.emittedEvents);
  result.animationCommands.forEach((command) => {
    run.animationIds.add(command.id);
    run.animationCommands.push(structuredClone(command));
  });
  result.featureStateUpdates.forEach((update) => run.featureStateUpdates.push(structuredClone(update)));
  result.sharedStateProposals.forEach((proposal) => run.sharedStateProposals.push(structuredClone(proposal)));
  result.warnings.forEach((warning) => run.warnings.push(structuredClone(warning)));
  for (const [key, value] of Object.entries(result.telemetry)) run.telemetry[`${featureId}.${key}`] = value;
  if (run.continuation.action === "continue" && result.continuation.action !== "continue") {
    run.continuation = structuredClone(result.continuation);
  }
  run.records.push({ featureId, operation, executionOrder, executionId, result: structuredClone(result) });
}

function recordSkipped(run: MutableRun, featureId: FeatureManifestId): void {
  run.skippedFeatureIds.push(featureId);
}

function recordFailure(run: MutableRun, featureId: FeatureManifestId, error: FeatureSdkError): void {
  run.failures.push(error.toRecord());
  run.skippedFeatureIds.push(featureId);
  const information: FeatureFailureInformation = {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    ...(error.context === undefined ? {} : { details: cloneFeatureState(error.context) }),
  };
  if (run.failure === null) run.failure = information;
}

function normalizeResult(
  hookResult: Awaited<FeatureHookResult>,
  contextEvents: readonly FeatureEmittedEvent[],
): FeatureResult {
  const result = hookResult === undefined ? createFeatureResult() : createFeatureResult(hookResult);
  assertResult(result);
  return structuredClone({
    ...result,
    emittedEvents: [...contextEvents, ...result.emittedEvents],
  });
}

function assertResult(result: FeatureResult): void {
  if (typeof result.triggered !== "boolean" || !Array.isArray(result.emittedEvents) ||
      !Array.isArray(result.animationCommands) || !Array.isArray(result.featureStateUpdates) ||
      !Array.isArray(result.sharedStateProposals) || !Array.isArray(result.warnings) ||
      !isRecord(result.telemetry) || !isRecord(result.continuation) ||
      !["continue", "stop", "yield"].includes(String(result.continuation.action)) ||
      (result.failure !== null && !isRecord(result.failure))) {
    throw new FeatureSdkError("INVALID_RESULT", "Feature hook returned an invalid FeatureResult", {
      operation: "trigger",
    });
  }
  const ids = new Set<string>();
  for (const event of result.emittedEvents) {
    if (!event || typeof event.name !== "string" || event.name.trim() === "") invalidResult("Feature event names cannot be empty");
    assertFeatureState(event.payload);
  }
  for (const command of result.animationCommands) {
    if (!command.id || !command.type || !Number.isSafeInteger(command.durationMs) || command.durationMs < 0) {
      invalidResult("Feature animation commands must have valid deterministic IDs, types, and durations");
    }
    if (ids.has(command.id)) invalidResult(`Feature result contains duplicate animation ID ${command.id}`);
    ids.add(command.id);
    assertFeatureState(command.payload);
    if (command.metadata !== undefined) assertFeatureState(command.metadata);
  }
  result.featureStateUpdates.forEach((update) => {
    if (!update || !["replace", "merge"].includes(update.strategy)) invalidResult("Feature state update strategy is invalid");
    assertFeatureState(update.state);
  });
  result.warnings.forEach((warning) => {
    if (!warning || typeof warning.code !== "string" || typeof warning.message !== "string") invalidResult("Feature warning is invalid");
    if (warning.details !== undefined) assertFeatureState(warning.details);
  });
  Object.values(result.telemetry).forEach((value) => {
    if (typeof value === "number" && !Number.isFinite(value)) invalidResult("Feature telemetry numbers must be finite");
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) invalidResult("Feature telemetry values must be scalar");
  });
  result.sharedStateProposals.forEach((proposal) => {
    if (!proposal || typeof proposal.key !== "string" || proposal.key.trim() === "" ||
        !["replace", "merge", "remove"].includes(proposal.strategy)) {
      invalidResult("Feature shared-state proposal is invalid");
    }
  });
  assertJsonSafe(result.sharedStateProposals);
  if (result.failure?.details !== undefined) assertFeatureState(result.failure.details);
}

function appendEvents(run: MutableRun, events: readonly FeatureEmittedEvent[]): void {
  events.forEach((event) => run.emittedEvents.push(structuredClone(event)));
}

function withTriggered(result: FeatureResult): FeatureResult {
  return result.triggered ? result : { ...result, triggered: true };
}

function collector(events: FeatureEmittedEvent[]): FeatureEventPublisher {
  return {
    publish(event): void {
      events.push(structuredClone(event));
    },
  };
}

function executionToken(
  input: FeatureRunnerContextInput,
  featureId: FeatureManifestId,
  phase: string,
): string {
  return `${input.roundId}:${input.eventId}:${featureId}:${phase}`;
}

function reference(registration: RegisteredFeature): {
  readonly featureId: FeatureManifestId;
  readonly lifecycleStatus: FeatureLifecycleStatus;
} {
  return { featureId: registration.manifest.id, lifecycleStatus: registration.lifecycleStatus };
}

function errorCodeFor(operation: FeatureLifecycleOperation): FeatureErrorCode {
  if (operation === "trigger" || operation === "can-trigger") return "TRIGGER_FAILURE";
  if (operation === "update") return "UPDATE_FAILURE";
  if (operation === "cleanup") return "CLEANUP_FAILURE";
  return "LIFECYCLE_FAILURE";
}

function effectivePolicy(
  registration: RegisteredFeature,
  error: FeatureSdkError | null,
): FeatureFailurePolicy {
  return error?.code === "RECOVERY_FAILED" ? "blocking" : registration.implementation.failurePolicy;
}

function rollbackFailure(featureId: FeatureManifestId, rollbackError: unknown, originalError: unknown): FeatureSdkError {
  return new FeatureSdkError("RECOVERY_FAILED", `Feature ${featureId} failed and its prior state could not be restored`, {
    featureId,
    operation: "recover",
    failurePolicy: "blocking",
    context: { originalError: errorMessage(originalError), rollbackError: errorMessage(rollbackError) },
    cause: rollbackError,
  });
}

function invalidResult(message: string): never {
  throw new FeatureSdkError("INVALID_RESULT", message, { operation: "trigger" });
}

function requireOrderId(order: readonly FeatureManifestId[], index: number): FeatureManifestId {
  const id = order[index];
  if (id === undefined) throw new FeatureSdkError("LIFECYCLE_FAILURE", "Feature execution order changed unexpectedly", {
    operation: "resolve-order",
  });
  return id;
}

function assertJsonSafe(value: unknown): void {
  try {
    const cloned = structuredClone(value);
    if (JSON.stringify(cloned) === undefined) invalidResult("Feature result contains a non-serializable value");
  } catch (error) {
    if (error instanceof FeatureSdkError) throw error;
    invalidResult("Feature result contains a non-serializable value");
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
