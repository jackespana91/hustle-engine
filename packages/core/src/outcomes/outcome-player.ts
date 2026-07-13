import { animationId, eventId, money, roundId, type AnimationCommand, type RecoverySnapshot, type RoundOutcome } from "../contracts.js";
import type { AnimationExecutor } from "../animation-queue.js";
import { RoundController } from "../controller.js";
import { TypedEventBus } from "../event-bus.js";
import { FeatureSerializer, SequenceRandomSource, type DeterministicRandomSource, type FeatureRunner, type FeatureRunnerContextInput, type FeatureRunnerResult } from "../features/index.js";
import { OutcomeComparator } from "./outcome-comparator.js";
import { OutcomeSystemError, invalidOutcomeError } from "./outcome-errors.js";
import type { OutcomeEventMap } from "./outcome-events.js";
import { applyStateChanges, normalizeOutcome } from "./outcome-normalizer.js";
import { OutcomeRecorder } from "./outcome-recorder.js";
import {
  OUTCOME_RUNTIME_SNAPSHOT_VERSION,
  type OutcomeClock,
  type OutcomeComparisonResult,
  type OutcomeDefinition,
  type OutcomeEvent,
  type OutcomePlaybackResult,
  type OutcomePlaybackStatus,
  type OutcomePlayerState,
  type OutcomeReplayRecord,
  type OutcomeRuntimeSnapshot,
  type OutcomeState,
} from "./outcome-types.js";
import { OutcomeValidator } from "./outcome-validator.js";

export interface OutcomeEventPreparationResult {
  readonly warnings?: readonly string[];
}

export interface OutcomePlayerOptions {
  readonly executor: AnimationExecutor;
  readonly validator?: OutcomeValidator;
  readonly featureRunner?: FeatureRunner;
  readonly featureSerializer?: FeatureSerializer;
  readonly randomSourceFactory?: (outcome: OutcomeDefinition) => DeterministicRandomSource;
  readonly prepareEvent?: (event: OutcomeEvent, outcome: OutcomeDefinition) => void | OutcomeEventPreparationResult | Promise<void | OutcomeEventPreparationResult>;
  readonly clock?: OutcomeClock;
  readonly initialState?: OutcomeState;
}

export interface OutcomePlayOptions {
  readonly startEventIndex?: number;
  readonly initialState?: OutcomeState;
}

export class OutcomePlayer {
  readonly events = new TypedEventBus<OutcomeEventMap>();
  readonly controller: RoundController;
  readonly comparator = new OutcomeComparator();

  private readonly validator: OutcomeValidator;
  private readonly recorder: OutcomeRecorder;
  private readonly featureSerializer: FeatureSerializer;
  private statusValue: OutcomePlaybackStatus = "idle";
  private outcomeValue: OutcomeDefinition | null = null;
  private currentEventValue: OutcomeEvent | null = null;
  private actualStateValue: OutcomeState;
  private actualTotalValue = 0;
  private replayRecordValue: OutcomeReplayRecord | null = null;
  private comparisonValue: OutcomeComparisonResult | null = null;
  private snapshotValue: RecoverySnapshot | null = null;
  private random: DeterministicRandomSource | null = null;
  private lastControllerError: Error | null = null;

  constructor(private readonly options: OutcomePlayerOptions) {
    this.validator = options.validator ?? new OutcomeValidator();
    this.recorder = new OutcomeRecorder(options.clock);
    this.featureSerializer = options.featureSerializer ?? new FeatureSerializer();
    this.actualStateValue = structuredClone(options.initialState ?? {});
    this.controller = new RoundController(options.executor);
    this.wireController();
  }

  get state(): OutcomePlayerState {
    return {
      status: this.statusValue,
      activeOutcome: this.outcomeValue ? structuredClone(this.outcomeValue) : null,
      currentEvent: this.currentEventValue ? structuredClone(this.currentEventValue) : null,
      actualState: structuredClone(this.actualStateValue),
      actualTotalMinor: this.actualTotalValue,
      replayRecord: this.replayRecordValue ? structuredClone(this.replayRecordValue) : null,
      comparison: this.comparisonValue ? structuredClone(this.comparisonValue) : null,
      snapshot: this.snapshotValue ? structuredClone(this.snapshotValue) : null,
      lifecycleState: this.controller.state,
    };
  }

  async play(outcome: OutcomeDefinition, playOptions: OutcomePlayOptions = {}): Promise<OutcomePlaybackResult> {
    if (["playing", "paused", "recovering"].includes(this.statusValue)) {
      throw new OutcomeSystemError("PLAYBACK_NOT_ACTIVE", "Another outcome playback is already active");
    }
    this.resetRuntime();
    this.statusValue = "validating";
    const validation = this.validator.validate(outcome);
    if (!validation.valid) {
      this.events.publish("outcome:validation-failed", { outcome, validation });
      this.statusValue = "failed";
      throw invalidOutcomeError(validation.errors);
    }
    const normalized = normalizeOutcome(outcome);
    this.events.publish("outcome:validation-passed", { outcome: normalized, validation });
    this.outcomeValue = normalized;
    this.random = this.createRandom(normalized);
    const startIndex = playOptions.startEventIndex ?? 0;
    if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > normalized.events.length) {
      throw new OutcomeSystemError("INVALID_OUTCOME", "Replay event boundary is outside the outcome timeline");
    }
    this.actualStateValue = this.stateBeforeIndex(normalized, startIndex, playOptions.initialState ?? this.options.initialState ?? {});
    this.actualTotalValue = normalized.events.slice(0, startIndex).reduce((sum, event) => sum + (event.winAmountMinor ?? 0), 0);
    this.recorder.start(normalized, normalized.events);
    this.events.publish("outcome:recording-started", { outcome: normalized });
    this.events.publish("outcome:playback-started", { outcome: normalized });
    this.statusValue = "ready";

    try {
      const commands = await this.buildCommandPlan(normalized, startIndex);
      this.recorder.recordCommands(commands);
      this.statusValue = "playing";
      this.controller.startRequest(money(normalized.betAmountMinor));
      await this.controller.receiveOutcomeWithCommands(toRoundOutcome(normalized), commands);
      if (this.controller.state === "failed") throw this.lastControllerError ?? new Error("Round controller failed");
      if (this.controller.state === "interrupted") return this.interruptedResult();
      await this.completeFeatures(normalized.events.at(-1) ?? null);
      return this.completedResult();
    } catch (error) {
      return this.failedResult(error);
    }
  }

  pause(): void {
    if (this.statusValue !== "playing" || !this.outcomeValue) return;
    this.controller.queue.pause(); this.statusValue = "paused";
    this.events.publish("outcome:playback-paused", { outcome: this.outcomeValue });
  }

  resume(): void {
    if (this.statusValue !== "paused" || !this.outcomeValue) return;
    this.controller.queue.resume(); this.statusValue = "playing";
    this.events.publish("outcome:playback-resumed", { outcome: this.outcomeValue });
  }

  skipCurrent(): void { this.controller.queue.skipCurrent(); }
  skipAll(): void { this.controller.queue.skipAll(); }

  async interrupt(): Promise<RecoverySnapshot> {
    const outcome = this.requireActive();
    if (this.controller.state !== "presenting") throw new OutcomeSystemError("PLAYBACK_NOT_ACTIVE", "Only active presentation can be interrupted");
    const current = this.currentEventValue ?? outcome.events[0] ?? null;
    if (this.options.featureRunner && current) await this.options.featureRunner.interrupt(this.featureInput(outcome, current, "presenting"));
    const featureRuntime = this.options.featureRunner ? this.featureSerializer.createSnapshot(this.options.featureRunner.registry, {
      engineId: outcome.engineId, gameId: outcome.gameId, roundId: outcome.roundId,
      eventId: current?.id ?? null, logicalTick: current?.logicalTick ?? 0,
      executionLedger: this.options.featureRunner.executionLedger,
    }) : undefined;
    const base = this.controller.interrupt(featureRuntime);
    const snapshot: RecoverySnapshot = { ...base, outcomeRuntime: this.runtimeSnapshot() };
    this.snapshotValue = snapshot;
    this.statusValue = "interrupted";
    this.recorder.recordSnapshot(snapshot);
    this.recorder.recordInterruption(current?.logicalTick ?? 0);
    this.events.publish("outcome:playback-interrupted", { outcome, snapshot });
    return structuredClone(snapshot);
  }

  async recover(snapshot: RecoverySnapshot = this.requireSnapshot()): Promise<OutcomePlaybackResult> {
    const outcome = this.requireActive();
    assertSnapshotMatches(outcome, snapshot);
    this.statusValue = "recovering";
    const current = this.eventFromRuntime(snapshot.outcomeRuntime?.activeEventId ?? null) ?? outcome.events[0] ?? null;
    if (this.options.featureRunner && snapshot.featureRuntime) {
      await this.featureSerializer.restore(this.options.featureRunner.registry, snapshot.featureRuntime, {
        engineId: outcome.engineId, gameId: outcome.gameId, roundId: outcome.roundId,
      });
      if (current) await this.options.featureRunner.recover(this.featureInput(outcome, current, "recovering"), snapshot.featureRuntime.executionLedger);
    }
    this.recorder.recordRecovery(snapshot.outcomeRuntime?.logicalTick ?? current?.logicalTick ?? 0);
    await this.controller.restore(snapshot);
    if (this.controller.state === "failed") return this.failedResult(this.lastControllerError ?? new Error("Recovery failed"));
    this.statusValue = "playing";
    this.events.publish("outcome:playback-recovered", { outcome, snapshot });
    await this.completeFeatures(outcome.events.at(-1) ?? null);
    return this.completedResult();
  }

  async recoverFromSnapshot(outcome: OutcomeDefinition, snapshot: RecoverySnapshot): Promise<OutcomePlaybackResult> {
    const validation = this.validator.validate(outcome);
    if (!validation.valid) throw invalidOutcomeError(validation.errors);
    this.resetRuntime();
    const normalized = normalizeOutcome(outcome);
    assertSnapshotMatches(normalized, snapshot);
    this.outcomeValue = normalized;
    this.random = this.createRandom(normalized);
    const completed = new Set(snapshot.outcomeRuntime?.completedEventIds.map(String) ?? []);
    this.actualStateValue = normalized.events.filter((event) => completed.has(String(event.id)))
      .reduce((state, event) => applyStateChanges(state, event.expectedStateChanges), structuredClone(this.options.initialState ?? {}));
    this.actualTotalValue = normalized.events.filter((event) => completed.has(String(event.id))).reduce((sum, event) => sum + (event.winAmountMinor ?? 0), 0);
    this.recorder.start(normalized, normalized.events);
    const commands = [...snapshot.completedCommands, ...(snapshot.currentCommand ? [snapshot.currentCommand] : []), ...snapshot.pendingCommands];
    this.recorder.recordCommands(commands);
    snapshot.completedCommands.forEach((command) => this.recorder.recordCommandCompleted(command));
    this.snapshotValue = structuredClone(snapshot);
    this.events.publish("outcome:recording-started", { outcome: normalized });
    this.events.publish("outcome:playback-started", { outcome: normalized });
    return this.recover(snapshot);
  }

  reset(): void { this.controller.reset(); this.resetRuntime(); }

  private async buildCommandPlan(outcome: OutcomeDefinition, startIndex: number): Promise<readonly AnimationCommand[]> {
    const commands: AnimationCommand[] = [baseCommand(`${outcome.roundId}:outcome:start`, "outcome-round-start", 1, { outcomeId: outcome.id }, false)];
    const selected = outcome.events.slice(startIndex);
    for (let index = 0; index < selected.length; index += 1) {
      const event = selected[index];
      if (!event) continue;
      await this.prepareEvent(outcome, event);
      const featureCommands = await this.runFeatures(outcome, event, index === 0);
      const hintCommands = event.animationHints.length > 0
        ? event.animationHints.map((hint, hintIndex) => ({
          id: animationId(`${outcome.roundId}:${event.id}:hint:${hintIndex}`), type: hint.type, durationMs: hint.durationMs,
          payload: structuredClone(hint.payload), skippable: hint.skippable ?? event.skippable,
          blocking: hint.blocking ?? event.blocking, metadata: structuredClone(hint.metadata ?? {}),
        }))
        : [baseCommand(`${outcome.roundId}:${event.id}:present`, `outcome:${event.type}`, 30, { event }, event.skippable, event.blocking)];
      const eventCommands = [...hintCommands, ...featureCommands].map((command, commandIndex, all) => ({
        ...command,
        metadata: {
          ...(command.metadata ?? {}), outcomeEventId: event.id, outcomeEventSequence: event.sequence,
          outcomeEventStart: commandIndex === 0, outcomeEventEnd: commandIndex === all.length - 1,
        },
      }));
      commands.push(...eventCommands);
    }
    commands.push(baseCommand(`${outcome.roundId}:outcome:complete`, "outcome-round-complete", 1, { totalWinMinor: outcome.totalWinMinor }, false));
    return commands;
  }

  private async prepareEvent(outcome: OutcomeDefinition, event: OutcomeEvent): Promise<void> {
    if (!this.options.prepareEvent) return;
    try {
      const result = await this.options.prepareEvent(event, outcome);
      result?.warnings?.forEach((warning) => this.recorder.recordWarning("EVENT_PREPARATION_WARNING", warning, event));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (event.metadata.assetRequirement === "optional") {
        this.recorder.recordWarning("OPTIONAL_ASSET_FAILURE", message, event);
        return;
      }
      throw new OutcomeSystemError("PLAYBACK_FAILED", `Required event preparation failed: ${message}`, [], error);
    }
  }

  private async runFeatures(outcome: OutcomeDefinition, event: OutcomeEvent, initialize: boolean): Promise<readonly AnimationCommand[]> {
    const runner = this.options.featureRunner;
    if (!runner) return [];
    const input = this.featureInput(outcome, event, "presenting");
    const results: FeatureRunnerResult[] = [];
    if (initialize) results.push(await runner.initializeRound(input));
    results.push(await runner.trigger(input));
    const commands: AnimationCommand[] = [];
    results.forEach((result) => {
      this.recorder.recordFeature(event, result.records);
      commands.push(...result.result.animationCommands);
      result.result.warnings.forEach((warning) => this.recorder.recordWarning(warning.code, warning.message, event));
      result.failures.forEach((failure) => this.recorder.recordError(failure.code, failure.message, event));
    });
    return commands;
  }

  private async completeFeatures(event: OutcomeEvent | null): Promise<void> {
    if (!this.options.featureRunner || !this.outcomeValue || !event) return;
    const result = await this.options.featureRunner.completeRound(this.featureInput(this.outcomeValue, event, "completed"));
    this.recorder.recordFeature(event, result.records);
  }

  private featureInput(outcome: OutcomeDefinition, event: OutcomeEvent, state: FeatureRunnerContextInput["currentLifecycleState"]): FeatureRunnerContextInput {
    if (!this.random) this.random = this.createRandom(outcome);
    return {
      roundId: outcome.roundId, eventId: eventId(String(event.id)), engineId: outcome.engineId, gameId: outcome.gameId,
      currentLifecycleState: state,
      roundData: { outcomeId: outcome.id, eventType: event.type, payload: event.payload },
      sharedPresentationState: this.actualStateValue,
      random: this.random, logicalTick: event.logicalTick,
      metadata: { outcomeEventSequence: event.sequence },
    };
  }

  private completedResult(): OutcomePlaybackResult {
    const outcome = this.requireActive();
    this.statusValue = "completed"; this.currentEventValue = null;
    this.recorder.setFinalState(this.actualStateValue);
    const record = this.recorder.complete("completed");
    const comparison = this.comparator.compareOutcomeToReplay(outcome, record);
    this.replayRecordValue = record; this.comparisonValue = comparison;
    const result = { status: "completed" as const, record, comparison, snapshot: this.snapshotValue };
    this.events.publish("outcome:comparison-completed", { comparison });
    this.events.publish("outcome:recording-completed", { record });
    this.events.publish("outcome:playback-completed", { result });
    return structuredClone(result);
  }

  private interruptedResult(): OutcomePlaybackResult {
    const outcome = this.requireActive();
    this.statusValue = "interrupted";
    this.recorder.setFinalState(this.actualStateValue);
    const record = this.recorder.draft("interrupted");
    const comparison = this.comparator.compareOutcomeToReplay(outcome, record);
    this.replayRecordValue = record; this.comparisonValue = comparison;
    return { status: "interrupted", record, comparison, snapshot: this.snapshotValue };
  }

  private failedResult(error: unknown): OutcomePlaybackResult {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (this.controller.state !== "failed" && this.controller.state !== "interrupted") this.controller.fail(normalized);
    this.statusValue = "failed";
    this.recorder.recordError("PLAYBACK_FAILED", normalized.message, this.currentEventValue);
    this.recorder.setFinalState(this.actualStateValue);
    const record = this.recorder.complete("failed");
    const comparison = this.outcomeValue ? this.comparator.compareOutcomeToReplay(this.outcomeValue, record) : { equal: false, divergences: [], firstDivergence: null };
    this.replayRecordValue = record; this.comparisonValue = comparison;
    this.events.publish("outcome:playback-failed", { outcome: this.outcomeValue, error: normalized });
    return { status: "failed", record, comparison, snapshot: this.snapshotValue };
  }

  private wireController(): void {
    this.controller.events.subscribe("round:state", ({ history }) => this.recorder.recordTransition(history));
    this.controller.events.subscribe("round:failed", ({ error }) => { this.lastControllerError = error; });
    this.controller.events.subscribe("animation:started", ({ command }) => {
      const event = this.eventFromCommand(command);
      if (event && command.metadata?.outcomeEventStart === true && this.outcomeValue) {
        this.currentEventValue = event;
        this.recorder.recordPublication("outcome:event-started", event, event.logicalTick);
        this.events.publish("outcome:event-started", { outcome: this.outcomeValue, event });
      }
    });
    const completed = ({ command }: { readonly command: AnimationCommand }): void => {
      this.recorder.recordCommandCompleted(command);
      const event = this.eventFromCommand(command);
      if (event && command.metadata?.outcomeEventEnd === true && this.outcomeValue) {
        this.actualStateValue = applyStateChanges(this.actualStateValue, event.expectedStateChanges);
        this.actualTotalValue += event.winAmountMinor ?? 0;
        this.recorder.recordPublication("outcome:event-completed", event, event.logicalTick);
        this.events.publish("outcome:event-completed", { outcome: this.outcomeValue, event });
      }
    };
    this.controller.events.subscribe("animation:completed", completed);
    this.controller.events.subscribe("animation:skipped", completed);
  }

  private runtimeSnapshot(): OutcomeRuntimeSnapshot {
    const outcome = this.requireActive();
    const completedIds = outcome.events.filter((event) => this.controller.queue.completed.some((command) => command.metadata?.outcomeEventId === event.id && command.metadata?.outcomeEventEnd === true)).map(({ id }) => id);
    const completed = new Set(completedIds.map(String));
    const pendingEventIds = outcome.events.filter((event) => !completed.has(String(event.id))).map(({ id }) => id);
    const activeEventId = this.currentEventValue?.id ?? null;
    return {
      schemaVersion: OUTCOME_RUNTIME_SNAPSHOT_VERSION, outcomeId: outcome.id, outcomeSchemaVersion: outcome.schemaVersion,
      currentEventIndex: activeEventId ? outcome.events.findIndex((event) => event.id === activeEventId) : completedIds.length,
      completedEventIds: completedIds, pendingEventIds, activeEventId,
      replayRecordId: this.replayRecordValue?.id ?? null,
      logicalTick: this.currentEventValue?.logicalTick ?? completedIds.length,
      comparatorState: this.comparisonValue,
    };
  }

  private eventFromCommand(command: AnimationCommand): OutcomeEvent | null {
    const id = command.metadata?.outcomeEventId;
    return typeof id === "string" ? this.eventFromRuntime(id) : null;
  }
  private eventFromRuntime(id: string | null): OutcomeEvent | null { return id ? this.outcomeValue?.events.find((event) => String(event.id) === id) ?? null : null; }
  private stateBeforeIndex(outcome: OutcomeDefinition, index: number, initial: OutcomeState): OutcomeState { return outcome.events.slice(0, index).reduce((state, event) => applyStateChanges(state, event.expectedStateChanges), structuredClone(initial)); }
  private createRandom(outcome: OutcomeDefinition): DeterministicRandomSource { return this.options.randomSourceFactory?.(outcome) ?? new SequenceRandomSource(Array.from({ length: 512 }, (_, index) => ((index * 37 + 17) % 100) / 100)); }
  private requireActive(): OutcomeDefinition { if (!this.outcomeValue) throw new OutcomeSystemError("PLAYBACK_NOT_ACTIVE", "No outcome is active"); return this.outcomeValue; }
  private requireSnapshot(): RecoverySnapshot { if (!this.snapshotValue) throw new OutcomeSystemError("RECOVERY_FAILED", "No outcome snapshot is available"); return this.snapshotValue; }
  private resetRuntime(): void {
    if (this.controller.state !== "idle") this.controller.reset();
    this.statusValue = "idle"; this.outcomeValue = null; this.currentEventValue = null;
    this.actualStateValue = structuredClone(this.options.initialState ?? {}); this.actualTotalValue = 0;
    this.replayRecordValue = null; this.comparisonValue = null; this.snapshotValue = null; this.random = null; this.lastControllerError = null;
  }
}

function baseCommand(id: string, type: string, durationMs: number, payload: Readonly<Record<string, unknown>>, skippable = true, blocking = true): AnimationCommand {
  return { id: animationId(id), type, durationMs, payload, skippable, blocking };
}

function toRoundOutcome(outcome: OutcomeDefinition): RoundOutcome {
  const hasDeclared = outcome.events.some((event) => event.winAmountMinor !== undefined);
  return {
    roundId: roundId(String(outcome.roundId)), bet: money(outcome.betAmountMinor), totalWin: money(outcome.totalWinMinor), completed: true,
    events: outcome.events.map((event, order) => ({
      id: eventId(String(event.id)), type: event.type, order,
      value: money(event.winAmountMinor ?? (!hasDeclared && order === outcome.events.length - 1 ? outcome.totalWinMinor : 0)),
      payload: structuredClone(event.payload),
    })),
  };
}

function assertSnapshotMatches(outcome: OutcomeDefinition, snapshot: RecoverySnapshot): void {
  if (!snapshot.outcomeRuntime || snapshot.outcomeRuntime.outcomeId !== outcome.id || snapshot.outcomeRuntime.outcomeSchemaVersion !== outcome.schemaVersion) {
    throw new OutcomeSystemError("RECOVERY_FAILED", "Recovery snapshot does not match the active outcome and version");
  }
}
