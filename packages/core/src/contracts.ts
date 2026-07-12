type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type RoundId = Brand<string, "RoundId">;
export type EventId = Brand<string, "EventId">;
export type AnimationId = Brand<string, "AnimationId">;
export type Money = Brand<number, "MoneyMicroUnits">;

export const roundId = (value: string): RoundId => value as RoundId;
export const eventId = (value: string): EventId => value as EventId;
export const animationId = (value: string): AnimationId => value as AnimationId;

export function money(value: number): Money {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Money must be a non-negative safe integer in micro-units");
  }
  return value as Money;
}

export type RoundStatus =
  | "idle"
  | "requesting"
  | "received"
  | "presenting"
  | "interrupted"
  | "recovering"
  | "completed"
  | "failed";

export interface GameEvent {
  readonly id: EventId;
  readonly type: string;
  readonly order: number;
  readonly value: Money;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RoundOutcome {
  readonly roundId: RoundId;
  readonly bet: Money;
  readonly totalWin: Money;
  readonly events: readonly GameEvent[];
  readonly completed: boolean;
}

export interface AnimationCommand {
  readonly id: AnimationId;
  readonly type: string;
  readonly durationMs: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly skippable: boolean;
  readonly blocking: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TransitionRecord {
  readonly from: RoundStatus;
  readonly to: RoundStatus;
  readonly sequence: number;
  readonly reason?: string;
}

export interface PresentationProgress {
  readonly totalWinPresented: Money;
  readonly lastEventOrder: number;
}

export interface RecoverySnapshot {
  readonly version: 1;
  readonly round: RoundOutcome | null;
  readonly lifecycleState: RoundStatus;
  readonly completedCommands: readonly AnimationCommand[];
  readonly pendingCommands: readonly AnimationCommand[];
  readonly currentCommand: AnimationCommand | null;
  readonly transitionHistory: readonly TransitionRecord[];
  readonly presentationProgress: PresentationProgress;
}

export interface EngineEventMap {
  "round:requesting": { readonly bet: Money };
  "round:received": { readonly outcome: RoundOutcome };
  "round:state": { readonly state: RoundStatus; readonly history: readonly TransitionRecord[] };
  "round:completed": { readonly outcome: RoundOutcome };
  "round:interrupted": { readonly snapshot: RecoverySnapshot };
  "round:recovered": { readonly snapshot: RecoverySnapshot };
  "round:failed": { readonly error: import("./errors.js").EngineError };
  "animation:started": { readonly command: AnimationCommand };
  "animation:completed": { readonly command: AnimationCommand };
  "animation:skipped": { readonly command: AnimationCommand };
}
