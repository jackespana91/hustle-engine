import type { OutcomeEventMap } from "./outcome-events.js";
import type { OutcomeDebugPanelIntegration, OutcomeDebugSnapshot } from "./outcome-types.js";
import type { OutcomePlayer } from "./outcome-player.js";

export class OutcomeDebugAdapter {
  readonly debugPanelIntegration: OutcomeDebugPanelIntegration;
  private validationStatus = "Not validated";
  private latestWarningOrError: string | null = null;
  private recordingStatus: OutcomeDebugSnapshot["recordingStatus"] = "idle";
  private readonly unsubscribers: (() => void)[] = [];

  constructor(readonly player: OutcomePlayer) {
    this.debugPanelIntegration = Object.freeze({ getState: () => this.snapshot() });
    this.subscribe();
  }

  snapshot(): OutcomeDebugSnapshot {
    const state = this.player.state;
    const record = state.replayRecord;
    const comparison = state.comparison;
    return {
      activeOutcome: state.activeOutcome?.id ?? null,
      eventCount: state.activeOutcome?.events.length ?? 0,
      currentEvent: state.currentEvent ? `${state.currentEvent.sequence} · ${state.currentEvent.type}` : null,
      validationStatus: this.validationStatus,
      playbackStatus: state.status,
      expectedTotalMinor: state.activeOutcome?.totalWinMinor ?? 0,
      actualTotalMinor: state.actualTotalMinor,
      latestWarningOrError: this.latestWarningOrError ?? record?.execution.warnings.at(-1)?.message ?? record?.execution.errors.at(-1)?.message ?? null,
      recordingStatus: this.recordingStatus,
      replayVersion: record?.schemaVersion ?? 1,
      commandCount: record?.execution.animationCommands.length ?? 0,
      transitionCount: record?.execution.stateTransitions.length ?? (state.lifecycleState === "idle" ? 0 : this.player.controller.transitionHistory.length),
      recoveryCount: record?.execution.recoveries.length ?? 0,
      divergenceStatus: comparison === null ? "not-compared" : comparison.equal ? "matching" : "diverged",
      firstDivergence: comparison?.firstDivergence?.message ?? null,
    };
  }

  destroy(): void { this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe()); }

  private subscribe(): void {
    const listen = <Key extends keyof OutcomeEventMap>(name: Key, handler: (payload: OutcomeEventMap[Key]) => void): void => {
      this.unsubscribers.push(this.player.events.subscribe(name, handler));
    };
    listen("outcome:validation-passed", ({ validation }) => { this.validationStatus = validation.warnings.length ? `Valid · ${validation.warnings.length} warning(s)` : "Valid"; });
    listen("outcome:validation-failed", ({ validation }) => { this.validationStatus = `Invalid · ${validation.errors.length} error(s)`; this.latestWarningOrError = validation.errors[0]?.message ?? null; });
    listen("outcome:recording-started", () => { this.recordingStatus = "recording"; });
    listen("outcome:recording-completed", () => { this.recordingStatus = "completed"; });
    listen("outcome:playback-failed", ({ error }) => { this.recordingStatus = "failed"; this.latestWarningOrError = error.message; });
  }
}
