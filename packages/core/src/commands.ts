import { animationId, type AnimationCommand, type RoundOutcome } from "./contracts.js";

export interface AnimationSettings {
  readonly roundStartMs: number;
  readonly balanceDebitMs: number;
  readonly revealEventMs: number;
  readonly incrementWinMs: number;
  readonly roundCompleteMs: number;
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  roundStartMs: 180,
  balanceDebitMs: 220,
  revealEventMs: 320,
  incrementWinMs: 260,
  roundCompleteMs: 180,
};

export function createAnimationCommands(
  outcome: RoundOutcome,
  settings: AnimationSettings = DEFAULT_ANIMATION_SETTINGS,
): readonly AnimationCommand[] {
  const prefix = outcome.roundId;
  const commands: AnimationCommand[] = [
    command(`${prefix}:round-start`, "round-start", settings.roundStartMs, { roundId: outcome.roundId }),
    command(`${prefix}:balance-debit`, "balance-debit", settings.balanceDebitMs, { amount: outcome.bet }),
  ];
  for (const event of [...outcome.events].sort((left, right) => left.order - right.order)) {
    commands.push(command(
      `${prefix}:event:${event.order}`,
      "reveal-event",
      settings.revealEventMs,
      { event },
    ));
    if (event.value > 0) {
      commands.push(command(
        `${prefix}:win:${event.order}`,
        "increment-win",
        settings.incrementWinMs,
        { amount: event.value, eventId: event.id },
      ));
    }
  }
  commands.push(command(
    `${prefix}:round-complete`,
    "round-complete",
    settings.roundCompleteMs,
    { totalWin: outcome.totalWin },
    false,
  ));
  return commands;
}

function command(
  id: string,
  type: string,
  durationMs: number,
  payload: Readonly<Record<string, unknown>>,
  skippable = true,
): AnimationCommand {
  return { id: animationId(id), type, durationMs, payload, skippable, blocking: true };
}
