import { OutcomeSystemError, invalidOutcomeError } from "./outcome-errors.js";
import { canonicalize, normalizeOutcome } from "./outcome-normalizer.js";
import { OUTCOME_REPLAY_SCHEMA_VERSION, type OutcomeDefinition, type OutcomeReplayRecord, type OutcomeValidationIssue } from "./outcome-types.js";
import { OutcomeValidator } from "./outcome-validator.js";

export interface SafeParseResult<Value> {
  readonly ok: boolean;
  readonly value?: Value;
  readonly errors: readonly OutcomeValidationIssue[];
  readonly error?: OutcomeSystemError;
}

export function stableSerialize(value: unknown, pretty = false): string {
  try {
    const serialized = JSON.stringify(canonicalize(value), null, pretty ? 2 : undefined);
    if (serialized === undefined) throw new TypeError("Value cannot be serialized");
    return serialized;
  } catch (error) {
    throw new OutcomeSystemError("SERIALIZATION_FAILED", error instanceof Error ? error.message : "Value cannot be serialized", [], error);
  }
}

export function serializeOutcome(outcome: OutcomeDefinition, pretty = false): string { return stableSerialize(normalizeOutcome(outcome), pretty); }

export function parseOutcome(json: string, validator = new OutcomeValidator()): OutcomeDefinition {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new OutcomeSystemError("SERIALIZATION_FAILED", "Outcome JSON is malformed", [], error); }
  const validation = validator.validate(value);
  if (!validation.valid) throw invalidOutcomeError(validation.errors);
  return normalizeOutcome(value as OutcomeDefinition);
}

export function safeParseOutcome(json: string, validator = new OutcomeValidator()): SafeParseResult<OutcomeDefinition> {
  try { return { ok: true, value: parseOutcome(json, validator), errors: [] }; }
  catch (error) {
    const outcomeError = error instanceof OutcomeSystemError ? error : new OutcomeSystemError("SERIALIZATION_FAILED", error instanceof Error ? error.message : "Outcome parsing failed", [], error);
    return { ok: false, errors: outcomeError.issues, error: outcomeError };
  }
}

export function serializeReplay(record: OutcomeReplayRecord, pretty = false): string { return stableSerialize(record, pretty); }

export function parseReplay(json: string): OutcomeReplayRecord {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new OutcomeSystemError("INVALID_REPLAY", "Replay JSON is malformed", [], error); }
  if (!isRecord(value) || value.schemaVersion !== OUTCOME_REPLAY_SCHEMA_VERSION || !isRecord(value.outcome) || !isRecord(value.execution)) {
    throw new OutcomeSystemError("INVALID_REPLAY", `Replay must use schema version ${OUTCOME_REPLAY_SCHEMA_VERSION}`);
  }
  parseOutcome(JSON.stringify(value.outcome));
  return canonicalize(value) as unknown as OutcomeReplayRecord;
}

export function safeParseReplay(json: string): SafeParseResult<OutcomeReplayRecord> {
  try { return { ok: true, value: parseReplay(json), errors: [] }; }
  catch (error) {
    const outcomeError = error instanceof OutcomeSystemError ? error : new OutcomeSystemError("INVALID_REPLAY", error instanceof Error ? error.message : "Replay parsing failed", [], error);
    return { ok: false, errors: outcomeError.issues, error: outcomeError };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
