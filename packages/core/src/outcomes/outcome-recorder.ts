import type { AnimationCommand, RecoverySnapshot, TransitionRecord } from "../contracts.js";
import type { FeatureRunnerRecord } from "../features/index.js";
import { canonicalize } from "./outcome-normalizer.js";
import {
  OUTCOME_REPLAY_SCHEMA_VERSION,
  replayRecordId,
  type OutcomeClock,
  type OutcomeDefinition,
  type OutcomeEvent,
  type OutcomeEventPublication,
  type OutcomeExecutionError,
  type OutcomeExecutionWarning,
  type OutcomeFeatureExecution,
  type OutcomeReplayRecord,
  type OutcomeState,
  type OutcomeTimingRecord,
} from "./outcome-types.js";

export class OutcomeRecorder {
  private outcome: OutcomeDefinition | null = null;
  private normalizedEvents: OutcomeEvent[] = [];
  private featureExecutions: OutcomeFeatureExecution[] = [];
  private eventPublications: OutcomeEventPublication[] = [];
  private animationCommands: AnimationCommand[] = [];
  private completedAnimationCommandIds: string[] = [];
  private stateTransitions: TransitionRecord[] = [];
  private snapshots: RecoverySnapshot[] = [];
  private interruptions: OutcomeTimingRecord[] = [];
  private recoveries: OutcomeTimingRecord[] = [];
  private warnings: OutcomeExecutionWarning[] = [];
  private errors: OutcomeExecutionError[] = [];
  private timings: OutcomeTimingRecord[] = [];
  private finalState: OutcomeState = {};
  private startedAt: number | null = null;
  private completedAt: number | null = null;

  constructor(private readonly clock?: OutcomeClock) {}

  start(outcome: OutcomeDefinition, normalizedEvents: readonly OutcomeEvent[]): void {
    this.reset();
    this.outcome = structuredClone(outcome);
    this.normalizedEvents = structuredClone(normalizedEvents) as OutcomeEvent[];
    this.startedAt = this.time();
    this.timing("recording-started", 0);
  }

  recordPublication(name: string, event: OutcomeEvent | null, logicalTick: number): void {
    this.eventPublications.push({ sequence: this.eventPublications.length, name, eventId: event?.id ?? null, logicalTick });
  }

  recordFeature(event: OutcomeEvent, records: readonly FeatureRunnerRecord[]): void {
    records.forEach((record) => this.featureExecutions.push({
      eventId: event.id, featureId: record.featureId, operation: record.operation,
      executionOrder: record.executionOrder, executionId: record.executionId,
    }));
  }

  recordCommands(commands: readonly AnimationCommand[]): void { this.animationCommands.push(...structuredClone(commands)); }
  recordCommandCompleted(command: AnimationCommand): void { if (!this.completedAnimationCommandIds.includes(command.id)) this.completedAnimationCommandIds.push(command.id); }
  recordTransition(history: readonly TransitionRecord[]): void { this.stateTransitions = structuredClone(history) as TransitionRecord[]; }
  recordSnapshot(snapshot: RecoverySnapshot): void { this.snapshots.push(structuredClone(snapshot)); }
  recordInterruption(logicalTick: number): void { const item = this.timing("interrupted", logicalTick); this.interruptions.push(item); }
  recordRecovery(logicalTick: number): void { const item = this.timing("recovered", logicalTick); this.recoveries.push(item); }
  recordWarning(code: string, message: string, event: OutcomeEvent | null): void { this.warnings.push({ code, message, eventId: event?.id ?? null }); }
  recordError(code: string, message: string, event: OutcomeEvent | null): void { this.errors.push({ code, message, eventId: event?.id ?? null }); }
  setFinalState(state: OutcomeState): void { this.finalState = structuredClone(state); }

  complete(status: OutcomeReplayRecord["status"]): OutcomeReplayRecord {
    if (!this.outcome) throw new Error("Outcome recorder has not started");
    this.completedAt = this.time();
    this.timing(`recording-${status}`, this.normalizedEvents.at(-1)?.logicalTick ?? 0);
    return this.createRecord(status);
  }

  draft(status: OutcomeReplayRecord["status"] = "interrupted"): OutcomeReplayRecord {
    if (!this.outcome) throw new Error("Outcome recorder has not started");
    return this.createRecord(status);
  }

  private createRecord(status: OutcomeReplayRecord["status"]): OutcomeReplayRecord {
    const outcome = this.outcome;
    if (!outcome) throw new Error("Outcome recorder has not started");
    return canonicalize({
      schemaVersion: OUTCOME_REPLAY_SCHEMA_VERSION,
      id: replayRecordId(`${outcome.id}:replay-v${OUTCOME_REPLAY_SCHEMA_VERSION}`),
      outcomeId: outcome.id,
      outcomeSchemaVersion: outcome.schemaVersion,
      outcome: structuredClone(outcome),
      status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      execution: {
        normalizedEvents: structuredClone(this.normalizedEvents),
        featureExecutions: structuredClone(this.featureExecutions),
        eventPublications: structuredClone(this.eventPublications),
        animationCommands: structuredClone(this.animationCommands),
        completedAnimationCommandIds: [...this.completedAnimationCommandIds],
        stateTransitions: structuredClone(this.stateTransitions),
        snapshots: structuredClone(this.snapshots),
        interruptions: structuredClone(this.interruptions),
        recoveries: structuredClone(this.recoveries),
        warnings: structuredClone(this.warnings),
        errors: structuredClone(this.errors),
        finalState: structuredClone(this.finalState),
        timings: structuredClone(this.timings),
      },
      metadata: { deterministic: true, networkRequired: false },
    }) as OutcomeReplayRecord;
  }

  private timing(name: string, logicalTick: number): OutcomeTimingRecord {
    const item = { name, logicalTick, externalTime: this.time() };
    this.timings.push(item);
    return item;
  }

  private time(): number | null { return this.clock?.now() ?? null; }

  private reset(): void {
    this.outcome = null; this.normalizedEvents = []; this.featureExecutions = []; this.eventPublications = [];
    this.animationCommands = []; this.completedAnimationCommandIds = []; this.stateTransitions = []; this.snapshots = [];
    this.interruptions = []; this.recoveries = []; this.warnings = []; this.errors = []; this.timings = [];
    this.finalState = {}; this.startedAt = null; this.completedAt = null;
  }
}
