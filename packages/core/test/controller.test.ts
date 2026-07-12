import { describe, expect, it } from "vitest";
import {
  RoundController,
  eventId,
  money,
  roundId,
  serializeSnapshot,
  type AnimationCommand,
  type AnimationExecutionContext,
  type AnimationExecutor,
  type RoundOutcome,
} from "../src/index.js";

const outcome: RoundOutcome = {
  roundId: roundId("round-controller"), bet: money(100), totalWin: money(50), completed: true,
  events: [{ id: eventId("event"), type: "generic", order: 0, value: money(50), payload: {} }],
};

class ImmediateExecutor implements AnimationExecutor {
  readonly ids: string[] = [];
  constructor(private readonly failType?: string) {}
  async execute(command: AnimationCommand): Promise<void> {
    this.ids.push(command.id);
    if (command.type === this.failType) throw new Error("deliberate failure");
  }
}

class InterruptibleExecutor implements AnimationExecutor {
  readonly ids: string[] = [];
  private releaseValue: (() => void) | null = null;
  execute(command: AnimationCommand, context: AnimationExecutionContext): Promise<void> {
    this.ids.push(command.id);
    return new Promise((resolve, reject) => {
      this.releaseValue = resolve;
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }
  release(): void { this.releaseValue?.(); this.releaseValue = null; }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RoundController", () => {
  it("completes a successful round", async () => {
    const controller = new RoundController(new ImmediateExecutor());
    controller.startRequest(outcome.bet); await controller.receiveOutcome(outcome);
    expect(controller.state).toBe("completed");
    expect(controller.progress.totalWinPresented).toBe(50);
  });

  it("moves to failed when animation execution fails", async () => {
    const controller = new RoundController(new ImmediateExecutor("reveal-event"));
    controller.startRequest(outcome.bet); await controller.receiveOutcome(outcome);
    expect(controller.state).toBe("failed");
  });

  it("restores without replaying completed commands", async () => {
    const firstExecutor = new InterruptibleExecutor();
    const first = new RoundController(firstExecutor);
    first.startRequest(outcome.bet);
    const run = first.receiveOutcome(outcome);
    await tick(); firstExecutor.release(); await tick();
    firstExecutor.release(); await tick();
    const snapshot = first.interrupt(); await run;
    expect(snapshot.completedCommands.length).toBe(2);

    const recoveryExecutor = new ImmediateExecutor();
    const recovered = new RoundController(recoveryExecutor);
    await recovered.restore(serializeSnapshot(snapshot));
    expect(recovered.state).toBe("completed");
    expect(recoveryExecutor.ids).not.toContain(snapshot.completedCommands[0]?.id);
    expect(recoveryExecutor.ids).not.toContain(snapshot.completedCommands[1]?.id);
  });

  it("resets an active presentation through legal transitions", async () => {
    const executor = new InterruptibleExecutor();
    const controller = new RoundController(executor);
    controller.startRequest(outcome.bet);
    const running = controller.receiveOutcome(outcome);
    await tick();
    controller.reset();
    await running;
    expect(controller.state).toBe("idle");
    expect(controller.transitionHistory.slice(-2).map(({ to }) => to)).toEqual(["interrupted", "idle"]);
  });
});
