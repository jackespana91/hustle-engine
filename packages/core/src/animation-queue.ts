import type { AnimationCommand } from "./contracts.js";
import { AnimationExecutionError, CorruptedSnapshotError } from "./errors.js";

export interface AnimationExecutionContext {
  readonly signal: AbortSignal;
  readonly skipped: () => boolean;
}

export interface AnimationExecutor {
  execute(command: AnimationCommand, context: AnimationExecutionContext): Promise<void>;
}

export interface AnimationQueueSnapshot {
  readonly completed: readonly AnimationCommand[];
  readonly pending: readonly AnimationCommand[];
  readonly current: AnimationCommand | null;
}

export interface AnimationQueueHooks {
  readonly onStarted?: (command: AnimationCommand) => void;
  readonly onCompleted?: (command: AnimationCommand) => void;
  readonly onSkipped?: (command: AnimationCommand) => void;
}

type QueueState = "idle" | "playing" | "paused" | "interrupted";

export class AnimationQueue {
  private pendingValue: AnimationCommand[] = [];
  private completedValue: AnimationCommand[] = [];
  private currentValue: AnimationCommand | null = null;
  private stateValue: QueueState = "idle";
  private controller: AbortController | null = null;
  private skipRequested = false;
  private playPromise: Promise<void> | null = null;
  private resumeWaiter: (() => void) | null = null;

  constructor(
    private readonly executor: AnimationExecutor,
    private readonly hooks: AnimationQueueHooks = {},
  ) {}

  get state(): QueueState { return this.stateValue; }
  get pending(): readonly AnimationCommand[] { return [...this.pendingValue]; }
  get completed(): readonly AnimationCommand[] { return [...this.completedValue]; }
  get current(): AnimationCommand | null { return this.currentValue; }

  enqueue(command: AnimationCommand): void {
    this.assertCommand(command);
    this.assertUnique(command.id);
    this.pendingValue.push(command);
  }

  enqueueMany(commands: readonly AnimationCommand[]): void {
    for (const command of commands) this.enqueue(command);
  }

  play(): Promise<void> {
    if (this.playPromise !== null) return this.playPromise;
    this.stateValue = "playing";
    this.playPromise = this.drain().finally(() => {
      this.playPromise = null;
      if (this.stateValue === "playing") this.stateValue = "idle";
    });
    return this.playPromise;
  }

  pause(): void {
    if (this.stateValue === "playing") this.stateValue = "paused";
  }

  resume(): void {
    if (this.stateValue !== "paused") return;
    this.stateValue = "playing";
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  skipCurrent(): void {
    if (this.currentValue === null || !this.currentValue.skippable) return;
    this.skipRequested = true;
    this.controller?.abort("skip");
  }

  skipAll(): void {
    const skipped = this.pendingValue.filter((command) => command.skippable);
    const retained = this.pendingValue.filter((command) => !command.skippable);
    this.pendingValue = retained;
    for (const command of skipped) {
      this.completedValue.push(command);
      this.hooks.onSkipped?.(command);
    }
    this.skipCurrent();
  }

  interrupt(): void {
    this.stateValue = "interrupted";
    this.controller?.abort("interrupt");
    this.resumeWaiter?.();
    this.resumeWaiter = null;
  }

  restore(snapshot: AnimationQueueSnapshot): void {
    if (this.playPromise !== null) throw new CorruptedSnapshotError("Cannot restore while the queue is active");
    this.clear();
    const all = [...snapshot.completed, ...snapshot.pending, ...(snapshot.current ? [snapshot.current] : [])];
    const ids = new Set(all.map((command) => command.id));
    if (ids.size !== all.length) throw new CorruptedSnapshotError("Snapshot contains duplicate animation ids");
    all.forEach((command) => this.assertCommand(command));
    this.completedValue = [...snapshot.completed];
    this.pendingValue = [...(snapshot.current ? [snapshot.current] : []), ...snapshot.pending];
  }

  clear(): void {
    this.controller?.abort("clear");
    this.pendingValue = [];
    this.completedValue = [];
    this.currentValue = null;
    this.stateValue = "idle";
    this.skipRequested = false;
  }

  snapshot(): AnimationQueueSnapshot {
    return { completed: this.completed, pending: this.pending, current: this.current };
  }

  private async drain(): Promise<void> {
    while (this.pendingValue.length > 0 && !this.isInterrupted()) {
      await this.waitWhilePaused();
      if (this.isInterrupted()) break;
      const command = this.pendingValue.shift();
      if (command === undefined) break;
      this.currentValue = command;
      this.skipRequested = false;
      this.controller = new AbortController();
      this.hooks.onStarted?.(command);
      try {
        await this.executor.execute(command, {
          signal: this.controller.signal,
          skipped: () => this.skipRequested,
        });
        if (this.isInterrupted()) {
          this.pendingValue.unshift(command);
          break;
        }
        this.completedValue.push(command);
        if (this.skipRequested) this.hooks.onSkipped?.(command);
        else this.hooks.onCompleted?.(command);
      } catch (error) {
        if (this.isInterrupted()) {
          this.pendingValue.unshift(command);
          break;
        }
        if (this.skipRequested) {
          this.completedValue.push(command);
          this.hooks.onSkipped?.(command);
        } else {
          throw new AnimationExecutionError(command.id, error);
        }
      } finally {
        this.currentValue = null;
        this.controller = null;
      }
    }
  }

  private waitWhilePaused(): Promise<void> {
    if (this.stateValue !== "paused") return Promise.resolve();
    return new Promise((resolve) => { this.resumeWaiter = resolve; });
  }

  private isInterrupted(): boolean {
    return this.stateValue === "interrupted";
  }

  private assertUnique(id: string): void {
    if ([...this.pendingValue, ...this.completedValue, ...(this.currentValue ? [this.currentValue] : [])]
      .some((command) => command.id === id)) {
      throw new CorruptedSnapshotError(`Duplicate animation id: ${id}`);
    }
  }

  private assertCommand(command: AnimationCommand): void {
    if (!command.id || !command.type || !Number.isSafeInteger(command.durationMs) || command.durationMs < 0) {
      throw new CorruptedSnapshotError("Invalid animation command");
    }
  }
}
