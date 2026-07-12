import { AnimationQueue, type AnimationExecutor } from "./animation-queue.js";
import { createAnimationCommands, type AnimationSettings } from "./commands.js";
import {
  money,
  type AnimationCommand,
  type EngineEventMap,
  type Money,
  type PresentationProgress,
  type RecoverySnapshot,
  type RoundOutcome,
  type RoundStatus,
} from "./contracts.js";
import { EngineError, InvalidOutcomeError } from "./errors.js";
import { TypedEventBus } from "./event-bus.js";
import { parseSnapshot } from "./snapshot.js";
import { RoundStateMachine } from "./state-machine.js";

export class RoundController {
  readonly events = new TypedEventBus<EngineEventMap>();
  readonly queue: AnimationQueue;
  private readonly machine = new RoundStateMachine();
  private outcomeValue: RoundOutcome | null = null;
  private progressValue: PresentationProgress = { totalWinPresented: money(0), lastEventOrder: -1 };

  constructor(executor: AnimationExecutor, private readonly settings?: AnimationSettings) {
    this.queue = new AnimationQueue(executor, {
      onStarted: (command) => this.events.publish("animation:started", { command }),
      onCompleted: (command) => this.onCommandCompleted(command, false),
      onSkipped: (command) => this.onCommandCompleted(command, true),
    });
  }

  get state(): RoundStatus { return this.machine.state; }
  get transitionHistory() { return this.machine.history; }
  get outcome(): RoundOutcome | null { return this.outcomeValue; }
  get progress(): PresentationProgress { return this.progressValue; }

  startRequest(bet: Money): void {
    if (["completed", "failed"].includes(this.state)) this.transition("idle", "new round");
    this.transition("requesting");
    this.events.publish("round:requesting", { bet });
  }

  async receiveOutcome(outcome: RoundOutcome): Promise<void> {
    try {
      this.validateOutcome(outcome);
      this.outcomeValue = outcome;
      this.transition("received");
      this.events.publish("round:received", { outcome });
      this.queue.clear();
      this.queue.enqueueMany(createAnimationCommands(outcome, this.settings));
      this.transition("presenting");
      await this.queue.play();
      if (this.state === "presenting") {
        this.transition("completed");
        this.events.publish("round:completed", { outcome });
      }
    } catch (error) {
      if (this.state !== "interrupted") this.fail(error);
    }
  }

  interrupt(): RecoverySnapshot {
    if (this.state !== "presenting") throw new InvalidOutcomeError("Only a presenting round can be interrupted");
    this.queue.interrupt();
    this.transition("interrupted");
    const snapshot = this.createSnapshot();
    this.events.publish("round:interrupted", { snapshot });
    return snapshot;
  }

  async restore(snapshotOrJson: RecoverySnapshot | string): Promise<void> {
    try {
      const snapshot = typeof snapshotOrJson === "string" ? parseSnapshot(snapshotOrJson) : snapshotOrJson;
      this.validateSnapshot(snapshot);
      if (!["idle", "interrupted", "completed", "failed"].includes(this.state)) {
        throw new InvalidOutcomeError(`Cannot recover from ${this.state}`);
      }
      this.transition("recovering");
      this.outcomeValue = snapshot.round;
      this.progressValue = snapshot.presentationProgress;
      this.queue.restore({
        completed: snapshot.completedCommands,
        pending: snapshot.pendingCommands,
        current: snapshot.currentCommand,
      });
      this.events.publish("round:recovered", { snapshot });
      if (this.queue.pending.length === 0) {
        this.transition("completed");
      } else {
        this.transition("presenting");
        await this.queue.play();
        if (this.state === "presenting") this.transition("completed");
      }
      if (this.state === "completed" && this.outcomeValue) {
        this.events.publish("round:completed", { outcome: this.outcomeValue });
      }
    } catch (error) {
      this.fail(error);
    }
  }

  createSnapshot(): RecoverySnapshot {
    const queue = this.queue.snapshot();
    return {
      version: 1,
      round: this.outcomeValue,
      lifecycleState: this.state,
      completedCommands: queue.completed,
      pendingCommands: queue.pending,
      currentCommand: queue.current,
      transitionHistory: this.machine.history,
      presentationProgress: this.progressValue,
    };
  }

  reset(): void {
    this.queue.clear();
    if (this.state !== "idle") this.transition("idle", "reset");
    this.outcomeValue = null;
    this.progressValue = { totalWinPresented: money(0), lastEventOrder: -1 };
  }

  private transition(to: RoundStatus, reason?: string): void {
    this.machine.transition(to, reason);
    this.events.publish("round:state", { state: this.state, history: this.machine.history });
  }

  private validateOutcome(outcome: RoundOutcome): void {
    if (!outcome.roundId || !outcome.completed || !Number.isSafeInteger(outcome.bet) || outcome.bet < 0 ||
        !Number.isSafeInteger(outcome.totalWin) || outcome.totalWin < 0) {
      throw new InvalidOutcomeError("Round outcome contains invalid required fields");
    }
    const ids = new Set(outcome.events.map((event) => event.id));
    if (ids.size !== outcome.events.length) throw new InvalidOutcomeError("Round outcome has duplicate event ids");
    outcome.events.forEach((event, index) => {
      if (event.order !== index || !Number.isSafeInteger(event.value) || event.value < 0) {
        throw new InvalidOutcomeError("Round outcome events must be ordered and use valid integer values");
      }
    });
    const eventTotal = outcome.events.reduce((sum, event) => sum + event.value, 0);
    if (eventTotal !== outcome.totalWin) throw new InvalidOutcomeError("Round total win does not equal event values");
  }

  private validateSnapshot(snapshot: RecoverySnapshot): void {
    if (snapshot.version !== 1) throw new InvalidOutcomeError("Snapshot object must use version 1");
    if (snapshot.round === null) throw new InvalidOutcomeError("Snapshot has no current round");
    this.validateOutcome(snapshot.round);
  }

  private onCommandCompleted(command: AnimationCommand, skipped: boolean): void {
    if (command.type === "reveal-event") {
      const event = command.payload.event;
      if (typeof event === "object" && event !== null && "order" in event && typeof event.order === "number") {
        this.progressValue = { ...this.progressValue, lastEventOrder: event.order };
      }
    }
    if (command.type === "increment-win" && typeof command.payload.amount === "number") {
      this.progressValue = {
        ...this.progressValue,
        totalWinPresented: money(this.progressValue.totalWinPresented + command.payload.amount),
      };
    }
    this.events.publish(skipped ? "animation:skipped" : "animation:completed", { command });
  }

  fail(error: unknown): void {
    const engineError = error instanceof EngineError
      ? error
      : new EngineError("INVALID_OUTCOME", error instanceof Error ? error.message : "Unknown engine failure");
    if (this.state !== "failed") {
      try { this.transition("failed", engineError.code); } catch { /* preserve original failure */ }
    }
    this.events.publish("round:failed", { error: engineError });
  }
}
