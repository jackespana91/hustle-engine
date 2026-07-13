import type { RecoverySnapshot } from "../contracts.js";
import type {
  OutcomeComparisonResult,
  OutcomeDefinition,
  OutcomeEvent,
  OutcomePlaybackResult,
  OutcomeReplayRecord,
  OutcomeValidationResult,
} from "./outcome-types.js";

export interface OutcomeEventMap {
  "outcome:registered": { readonly outcome: OutcomeDefinition };
  "outcome:removed": { readonly outcome: OutcomeDefinition };
  "outcome:validation-passed": { readonly outcome: OutcomeDefinition; readonly validation: OutcomeValidationResult };
  "outcome:validation-failed": { readonly outcome: unknown; readonly validation: OutcomeValidationResult };
  "outcome:playback-started": { readonly outcome: OutcomeDefinition };
  "outcome:event-started": { readonly outcome: OutcomeDefinition; readonly event: OutcomeEvent };
  "outcome:event-completed": { readonly outcome: OutcomeDefinition; readonly event: OutcomeEvent };
  "outcome:playback-paused": { readonly outcome: OutcomeDefinition };
  "outcome:playback-resumed": { readonly outcome: OutcomeDefinition };
  "outcome:playback-interrupted": { readonly outcome: OutcomeDefinition; readonly snapshot: RecoverySnapshot };
  "outcome:playback-recovered": { readonly outcome: OutcomeDefinition; readonly snapshot: RecoverySnapshot };
  "outcome:playback-completed": { readonly result: OutcomePlaybackResult };
  "outcome:playback-failed": { readonly outcome: OutcomeDefinition | null; readonly error: Error };
  "outcome:recording-started": { readonly outcome: OutcomeDefinition };
  "outcome:recording-completed": { readonly record: OutcomeReplayRecord };
  "outcome:replay-started": { readonly record: OutcomeReplayRecord };
  "outcome:replay-completed": { readonly source: OutcomeReplayRecord; readonly actual: OutcomeReplayRecord };
  "outcome:replay-diverged": { readonly source: OutcomeReplayRecord; readonly actual: OutcomeReplayRecord; readonly comparison: OutcomeComparisonResult };
  "outcome:comparison-completed": { readonly comparison: OutcomeComparisonResult };
}

export const OUTCOME_EVENT_NAMES: readonly (keyof OutcomeEventMap)[] = [
  "outcome:registered", "outcome:removed", "outcome:validation-passed", "outcome:validation-failed",
  "outcome:playback-started", "outcome:event-started", "outcome:event-completed", "outcome:playback-paused",
  "outcome:playback-resumed", "outcome:playback-interrupted", "outcome:playback-recovered",
  "outcome:playback-completed", "outcome:playback-failed", "outcome:recording-started",
  "outcome:recording-completed", "outcome:replay-started", "outcome:replay-completed",
  "outcome:replay-diverged", "outcome:comparison-completed",
];
