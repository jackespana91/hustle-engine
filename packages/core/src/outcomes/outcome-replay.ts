import { TypedEventBus } from "../event-bus.js";
import { OutcomeComparator } from "./outcome-comparator.js";
import { OutcomeSystemError } from "./outcome-errors.js";
import type { OutcomeEventMap } from "./outcome-events.js";
import { OUTCOME_REPLAY_SCHEMA_VERSION, type OutcomePlaybackResult, type OutcomeReplayRecord } from "./outcome-types.js";
import type { OutcomePlayer } from "./outcome-player.js";

export class OutcomeReplay {
  readonly events = new TypedEventBus<OutcomeEventMap>();
  readonly comparator = new OutcomeComparator();

  constructor(private readonly createPlayer: () => OutcomePlayer) {}

  async replay(record: OutcomeReplayRecord): Promise<OutcomePlaybackResult> {
    this.assertVersion(record);
    this.events.publish("outcome:replay-started", { record });
    const actual = await this.createPlayer().play(record.outcome);
    this.publishResult(record, actual);
    return actual;
  }

  async replayFromEvent(record: OutcomeReplayRecord, eventIndex: number): Promise<OutcomePlaybackResult> {
    this.assertVersion(record);
    this.events.publish("outcome:replay-started", { record });
    const actual = await this.createPlayer().play(record.outcome, { startEventIndex: eventIndex });
    this.publishResult(record, actual);
    return actual;
  }

  async replayFromSnapshot(record: OutcomeReplayRecord, snapshotIndex = -1): Promise<OutcomePlaybackResult> {
    this.assertVersion(record);
    const snapshots = record.execution.snapshots;
    const index = snapshotIndex < 0 ? snapshots.length - 1 : snapshotIndex;
    const snapshot = snapshots[index];
    if (!snapshot) throw new OutcomeSystemError("INVALID_REPLAY", "Replay record does not contain the selected recovery snapshot");
    this.events.publish("outcome:replay-started", { record });
    const actual = await this.createPlayer().recoverFromSnapshot(record.outcome, snapshot);
    this.publishResult(record, actual);
    return actual;
  }

  private publishResult(source: OutcomeReplayRecord, actual: OutcomePlaybackResult): void {
    const comparison = this.comparator.compareReplays(source, actual.record);
    if (!comparison.equal) this.events.publish("outcome:replay-diverged", { source, actual: actual.record, comparison });
    else this.events.publish("outcome:replay-completed", { source, actual: actual.record });
    this.events.publish("outcome:comparison-completed", { comparison });
  }

  private assertVersion(record: OutcomeReplayRecord): void {
    if (record.schemaVersion !== OUTCOME_REPLAY_SCHEMA_VERSION) {
      throw new OutcomeSystemError("INVALID_REPLAY", `Unsupported replay version ${String(record.schemaVersion)}; expected ${OUTCOME_REPLAY_SCHEMA_VERSION}`);
    }
  }
}
