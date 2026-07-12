import { describe, expect, it } from "vitest";
import {
  AnimationQueue,
  animationId,
  type AnimationCommand,
  type AnimationExecutionContext,
  type AnimationExecutor,
} from "../src/index.js";

const makeCommand = (id: string, skippable = true): AnimationCommand => ({
  id: animationId(id), type: id, durationMs: 1, payload: {}, skippable, blocking: true,
});

class ControlledExecutor implements AnimationExecutor {
  readonly started: string[] = [];
  readonly finished: string[] = [];
  private releases: (() => void)[] = [];

  execute(command: AnimationCommand, context: AnimationExecutionContext): Promise<void> {
    this.started.push(command.id);
    return new Promise((resolve, reject) => {
      const release = () => {
        context.signal.removeEventListener("abort", abort);
        this.finished.push(command.id);
        resolve();
      };
      const abort = () => {
        this.releases = this.releases.filter((candidate) => candidate !== release);
        reject(new Error("aborted"));
      };
      context.signal.addEventListener("abort", abort, { once: true });
      this.releases.push(release);
    });
  }

  release(): void { this.releases.shift()?.(); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AnimationQueue", () => {
  it("plays commands in deterministic insertion order", async () => {
    const executor = new ControlledExecutor();
    const queue = new AnimationQueue(executor);
    queue.enqueueMany([makeCommand("a"), makeCommand("b"), makeCommand("c")]);
    const playing = queue.play();
    for (let index = 0; index < 3; index += 1) { await tick(); executor.release(); }
    await playing;
    expect(executor.started).toEqual(["a", "b", "c"]);
    expect(queue.completed.map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("pauses before the next command and resumes", async () => {
    const executor = new ControlledExecutor(); const queue = new AnimationQueue(executor);
    queue.enqueueMany([makeCommand("a"), makeCommand("b")]);
    const playing = queue.play(); await tick(); queue.pause(); executor.release(); await tick();
    expect(executor.started).toEqual(["a"]);
    queue.resume(); await tick(); executor.release(); await playing;
    expect(executor.started).toEqual(["a", "b"]);
  });

  it("skips the current skippable command", async () => {
    const executor = new ControlledExecutor(); const skipped: string[] = [];
    const queue = new AnimationQueue(executor, { onSkipped: ({ id }) => skipped.push(id) });
    queue.enqueueMany([makeCommand("a"), makeCommand("b")]);
    const playing = queue.play(); await tick(); queue.skipCurrent(); await tick(); executor.release(); await playing;
    expect(skipped).toEqual(["a"]);
    expect(queue.completed.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("skips all skippable commands while retaining non-skippable work", async () => {
    const executor = new ControlledExecutor(); const queue = new AnimationQueue(executor);
    queue.enqueueMany([makeCommand("a"), makeCommand("b"), makeCommand("required", false)]);
    const playing = queue.play(); await tick(); queue.skipAll(); await tick(); executor.release(); await playing;
    expect(executor.started).toEqual(["a", "required"]);
    expect(queue.completed.map(({ id }) => id)).toEqual(["b", "a", "required"]);
  });

  it("interrupts and keeps the current command pending for recovery", async () => {
    const executor = new ControlledExecutor(); const queue = new AnimationQueue(executor);
    queue.enqueueMany([makeCommand("a"), makeCommand("b")]);
    const playing = queue.play(); await tick(); queue.interrupt(); await playing;
    expect(queue.state).toBe("interrupted");
    expect(queue.pending.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(queue.completed).toHaveLength(0);
  });
});
