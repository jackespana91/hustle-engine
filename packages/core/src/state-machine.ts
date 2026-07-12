import type { RoundStatus, TransitionRecord } from "./contracts.js";
import { IllegalStateTransitionError } from "./errors.js";

const LEGAL_TRANSITIONS: Readonly<Record<RoundStatus, readonly RoundStatus[]>> = {
  idle: ["requesting", "recovering"],
  requesting: ["received", "failed"],
  received: ["presenting", "failed"],
  presenting: ["interrupted", "completed", "failed"],
  interrupted: ["recovering", "idle", "failed"],
  recovering: ["presenting", "completed", "failed"],
  completed: ["idle", "requesting", "recovering"],
  failed: ["idle", "requesting", "recovering"],
};

export class RoundStateMachine {
  private stateValue: RoundStatus;
  private historyValue: TransitionRecord[];

  constructor(state: RoundStatus = "idle", history: readonly TransitionRecord[] = []) {
    this.stateValue = state;
    this.historyValue = [...history];
  }

  get state(): RoundStatus {
    return this.stateValue;
  }

  get history(): readonly TransitionRecord[] {
    return [...this.historyValue];
  }

  canTransition(to: RoundStatus): boolean {
    return LEGAL_TRANSITIONS[this.stateValue].includes(to);
  }

  transition(to: RoundStatus, reason?: string): TransitionRecord {
    if (!this.canTransition(to)) throw new IllegalStateTransitionError(this.stateValue, to);
    const record: TransitionRecord = {
      from: this.stateValue,
      to,
      sequence: this.historyValue.length,
      ...(reason === undefined ? {} : { reason }),
    };
    this.stateValue = to;
    this.historyValue.push(record);
    return record;
  }

  restore(state: RoundStatus, history: readonly TransitionRecord[]): void {
    this.stateValue = state;
    this.historyValue = [...history];
  }
}

export { LEGAL_TRANSITIONS };
