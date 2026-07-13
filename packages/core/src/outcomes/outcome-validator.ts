import { OUTCOME_SCHEMA_VERSION, type OutcomeDefinition, type OutcomeEvent, type OutcomeReferenceResolver, type OutcomeValidationCode, type OutcomeValidationIssue, type OutcomeValidationResult } from "./outcome-types.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface OutcomeValidatorOptions {
  readonly references?: OutcomeReferenceResolver;
  readonly existingOutcomeIds?: ReadonlySet<string>;
}

export class OutcomeValidator {
  constructor(private readonly options: OutcomeValidatorOptions = {}) {}

  validate(value: unknown): OutcomeValidationResult {
    const errors: OutcomeValidationIssue[] = [];
    const warnings: OutcomeValidationIssue[] = [];
    if (!isRecord(value)) {
      errors.push(issue("INVALID_REQUIRED_FIELD", "Outcome must be an object", "$"));
      return result(errors, warnings);
    }

    const id = typeof value.id === "string" ? value.id : undefined;
    if (value.schemaVersion !== OUTCOME_SCHEMA_VERSION) {
      errors.push(issue("UNSUPPORTED_SCHEMA_VERSION", `Supported outcome schema is ${OUTCOME_SCHEMA_VERSION}`, "schemaVersion", id));
    }
    if (!id || !ID.test(id)) errors.push(issue("INVALID_OUTCOME_ID", "Outcome id must be a stable non-empty identifier", "id", id));
    if (id && this.options.existingOutcomeIds?.has(id)) {
      errors.push(issue("DUPLICATE_OUTCOME_ID", `Outcome id is already registered: ${id}`, "id", id));
    }
    if (typeof value.roundId !== "string" || !ID.test(value.roundId)) {
      errors.push(issue("INVALID_ROUND_ID", "Round id must be a stable non-empty identifier", "roundId", id));
    }
    for (const field of ["name", "description", "engineId", "gameId"] as const) {
      if (typeof value[field] !== "string" || value[field].trim() === "") {
        errors.push(issue("INVALID_REQUIRED_FIELD", `${field} must be a non-empty string`, field, id));
      }
    }
    validateSource(value.deterministicSource, errors, id);
    validateMoney(value.betAmountMinor, "betAmountMinor", errors, id);
    validateMoney(value.totalWinMinor, "totalWinMinor", errors, id);
    validateStringArray(value.tags, "tags", errors, id);
    validateJsonRecord(value.metadata, "metadata", errors, id, "INVALID_REQUIRED_FIELD");
    validateJsonRecord(value.expectedFinalState, "expectedFinalState", errors, id, "INVALID_FINAL_STATE");

    if (!Array.isArray(value.events)) {
      errors.push(issue("INVALID_REQUIRED_FIELD", "events must be an array", "events", id));
    } else {
      this.validateEvents(value.events, value.sequencePolicy, errors, id);
    }

    this.validateReferences(value, errors, warnings, id);
    return result(errors, warnings);
  }

  assertValid(value: unknown): OutcomeDefinition {
    const validation = this.validate(value);
    if (!validation.valid) {
      const error = new Error(validation.errors[0]?.message ?? "Outcome validation failed");
      Object.assign(error, { validation });
      throw error;
    }
    return structuredClone(value) as OutcomeDefinition;
  }

  private validateEvents(
    values: readonly unknown[],
    sequencePolicy: unknown,
    errors: OutcomeValidationIssue[],
    outcomeId: string | undefined,
  ): void {
    const events: OutcomeEvent[] = [];
    const ids = new Set<string>();
    const sequences = new Set<number>();
    values.forEach((value, index) => {
      const path = `events.${index}`;
      if (!isRecord(value)) {
        errors.push(issue("INVALID_EVENT", "Event must be an object", path, outcomeId));
        return;
      }
      const eventId = typeof value.id === "string" ? value.id : undefined;
      if (!eventId || !ID.test(eventId)) errors.push(issue("INVALID_EVENT", "Event id must be a stable identifier", `${path}.id`, outcomeId, eventId));
      else if (ids.has(eventId)) errors.push(issue("DUPLICATE_EVENT_ID", `Duplicate event id: ${eventId}`, `${path}.id`, outcomeId, eventId));
      else ids.add(eventId);
      if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 || sequences.has(Number(value.sequence))) {
        errors.push(issue("INVALID_SEQUENCE", "Event sequence must be a unique non-negative safe integer", `${path}.sequence`, outcomeId, eventId));
      } else sequences.add(Number(value.sequence));
      if (!Number.isSafeInteger(value.logicalTick) || Number(value.logicalTick) < 0) {
        errors.push(issue("INVALID_LOGICAL_TICK", "Logical tick must be a non-negative safe integer", `${path}.logicalTick`, outcomeId, eventId));
      }
      if (typeof value.type !== "string" || value.type.trim() === "") errors.push(issue("INVALID_EVENT", "Event type must be non-empty", `${path}.type`, outcomeId, eventId));
      if (typeof value.blocking !== "boolean" || typeof value.skippable !== "boolean") {
        errors.push(issue("INVALID_EVENT", "Event blocking and skippable flags must be boolean", path, outcomeId, eventId));
      }
      validateJsonRecord(value.payload, `${path}.payload`, errors, outcomeId, "INVALID_EVENT", eventId);
      validateJsonRecord(value.expectedStateChanges, `${path}.expectedStateChanges`, errors, outcomeId, "INVALID_EVENT", eventId);
      validateJsonRecord(value.metadata, `${path}.metadata`, errors, outcomeId, "INVALID_EVENT", eventId);
      validateStringArray(value.dependsOn, `${path}.dependsOn`, errors, outcomeId, eventId);
      validateStringArray(value.assetIds, `${path}.assetIds`, errors, outcomeId, eventId);
      validateStringArray(value.themeIds, `${path}.themeIds`, errors, outcomeId, eventId);
      if (value.featureId !== undefined && (typeof value.featureId !== "string" || value.featureId.trim() === "")) {
        errors.push(issue("INVALID_EVENT", "featureId must be a non-empty string when supplied", `${path}.featureId`, outcomeId, eventId));
      }
      if (value.winAmountMinor !== undefined) validateMoney(value.winAmountMinor, `${path}.winAmountMinor`, errors, outcomeId, eventId);
      if (!Array.isArray(value.animationHints)) errors.push(issue("INVALID_EVENT", "animationHints must be an array", `${path}.animationHints`, outcomeId, eventId));
      else value.animationHints.forEach((hint, hintIndex) => validateAnimationHint(hint, `${path}.animationHints.${hintIndex}`, errors, outcomeId, eventId));
      events.push(value as unknown as OutcomeEvent);
    });

    const eventById = new Map(events.map((event) => [String(event.id), event]));
    const ordered = [...events].sort(compareEvents);
    events.forEach((event, index) => {
      if (ordered[index]?.id !== event.id) {
        errors.push(issue("NON_DETERMINISTIC_ORDER", "Events must already be stored in deterministic sequence order", `events.${index}`, outcomeId, String(event.id)));
      }
      if (sequencePolicy !== "explicit" && event.sequence !== index) {
        errors.push(issue("INVALID_SEQUENCE", `Contiguous sequence expected ${index}, received ${event.sequence}`, `events.${index}.sequence`, outcomeId, String(event.id)));
      }
      const previous = events[index - 1];
      if (previous && event.logicalTick < previous.logicalTick) {
        errors.push(issue("INVALID_LOGICAL_TICK", "Logical ticks must not move backwards", `events.${index}.logicalTick`, outcomeId, String(event.id)));
      }
      event.dependsOn?.forEach((dependency) => {
        const target = eventById.get(String(dependency));
        if (!target) errors.push(issue("MISSING_EVENT_DEPENDENCY", `Unknown event dependency: ${dependency}`, `events.${index}.dependsOn`, outcomeId, String(event.id)));
        else if (target.sequence >= event.sequence) errors.push(issue("LATE_EVENT_DEPENDENCY", `Event dependency must resolve earlier: ${dependency}`, `events.${index}.dependsOn`, outcomeId, String(event.id)));
      });
    });
    detectCycles(events).forEach((cycle) => errors.push(issue(
      "CIRCULAR_EVENT_DEPENDENCY",
      `Circular event dependency: ${cycle.join(" -> ")}`,
      "events",
      outcomeId,
      cycle[0],
      { cycle },
    )));

    const declaredTotal = events.reduce((sum, event) => sum + (event.winAmountMinor ?? 0), 0);
    if (!Number.isSafeInteger(declaredTotal)) {
      errors.push(issue("INVALID_MONEY", "Declared event win total exceeds safe integer range", "events", outcomeId));
    }
  }

  private validateReferences(
    value: Record<string, unknown>,
    errors: OutcomeValidationIssue[],
    warnings: OutcomeValidationIssue[],
    id: string | undefined,
  ): void {
    const events = Array.isArray(value.events) ? value.events.filter(isRecord) : [];
    const declaredTotal = events.reduce((sum, event) => sum + (typeof event.winAmountMinor === "number" ? event.winAmountMinor : 0), 0);
    if (events.some((event) => event.winAmountMinor !== undefined) && declaredTotal !== value.totalWinMinor) {
      errors.push(issue("TOTAL_WIN_MISMATCH", `Declared event wins total ${declaredTotal}; outcome declares ${String(value.totalWinMinor)}`, "totalWinMinor", id));
    }

    const references = this.options.references;
    if (!references) {
      warnings.push(issue("REFERENCE_VALIDATION_SKIPPED", "No reference resolver supplied; identifiers were syntax-checked only", "$", id, undefined, undefined, "warning"));
      return;
    }
    if (typeof value.engineId === "string" && !references.hasEngine(value.engineId)) {
      errors.push(issue("INVALID_ENGINE_REFERENCE", `Unknown engine: ${value.engineId}`, "engineId", id));
    }
    if (typeof value.gameId === "string" && !references.hasGame(value.gameId)) {
      errors.push(issue("INVALID_GAME_REFERENCE", `Unknown game: ${value.gameId}`, "gameId", id));
    }
    events.forEach((event, index) => {
      const eventId = typeof event.id === "string" ? event.id : undefined;
      if (typeof event.featureId === "string" && !references.hasFeature(event.featureId)) {
        errors.push(issue("INVALID_FEATURE_REFERENCE", `Unknown feature: ${event.featureId}`, `events.${index}.featureId`, id, eventId));
      }
      if (Array.isArray(event.assetIds)) event.assetIds.forEach((asset) => {
        if (typeof asset === "string" && !references.hasAsset(asset)) errors.push(issue("INVALID_ASSET_REFERENCE", `Unknown asset: ${asset}`, `events.${index}.assetIds`, id, eventId));
      });
      if (Array.isArray(event.themeIds)) event.themeIds.forEach((theme) => {
        if (typeof theme === "string" && !references.hasTheme(theme)) errors.push(issue("INVALID_THEME_REFERENCE", `Unknown theme: ${theme}`, `events.${index}.themeIds`, id, eventId));
      });
    });
  }
}

export function createSetReferenceResolver(values: {
  readonly engines?: readonly string[];
  readonly games?: readonly string[];
  readonly features?: readonly string[];
  readonly assets?: readonly string[];
  readonly themes?: readonly string[];
}): OutcomeReferenceResolver {
  const sets = {
    engines: new Set(values.engines ?? []), games: new Set(values.games ?? []),
    features: new Set(values.features ?? []), assets: new Set(values.assets ?? []), themes: new Set(values.themes ?? []),
  };
  return {
    hasEngine: (id) => sets.engines.has(id), hasGame: (id) => sets.games.has(id),
    hasFeature: (id) => sets.features.has(id), hasAsset: (id) => sets.assets.has(id), hasTheme: (id) => sets.themes.has(id),
  };
}

export function compareEvents(left: OutcomeEvent, right: OutcomeEvent): number {
  return left.sequence - right.sequence || left.logicalTick - right.logicalTick || compareAscii(left.id, right.id);
}

function validateSource(value: unknown, errors: OutcomeValidationIssue[], id?: string): void {
  if (!isRecord(value) || (value.type !== "seed" && value.type !== "reference") || typeof value.value !== "string" || value.value.trim() === "") {
    errors.push(issue("INVALID_REQUIRED_FIELD", "deterministicSource must contain a non-empty seed or reference", "deterministicSource", id));
  }
}

function validateAnimationHint(value: unknown, path: string, errors: OutcomeValidationIssue[], outcomeId?: string, eventId?: string): void {
  if (!isRecord(value) || typeof value.type !== "string" || value.type.trim() === "" || !Number.isSafeInteger(value.durationMs) || Number(value.durationMs) < 0) {
    errors.push(issue("INVALID_EVENT", "Animation hint requires type and non-negative integer durationMs", path, outcomeId, eventId));
    return;
  }
  validateJsonRecord(value.payload, `${path}.payload`, errors, outcomeId, "INVALID_EVENT", eventId);
  if (value.metadata !== undefined) validateJsonRecord(value.metadata, `${path}.metadata`, errors, outcomeId, "INVALID_EVENT", eventId);
}

function validateMoney(value: unknown, path: string, errors: OutcomeValidationIssue[], outcomeId?: string, eventId?: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) errors.push(issue("INVALID_MONEY", `${path} must be a non-negative safe integer`, path, outcomeId, eventId));
}

function validateStringArray(value: unknown, path: string, errors: OutcomeValidationIssue[], outcomeId?: string, eventId?: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    errors.push(issue("INVALID_REQUIRED_FIELD", `${path} must be an array of non-empty strings`, path, outcomeId, eventId));
  }
}

function validateJsonRecord(value: unknown, path: string, errors: OutcomeValidationIssue[], outcomeId: string | undefined, code: OutcomeValidationCode, eventId?: string): void {
  if (!isRecord(value)) {
    errors.push(issue(code, `${path} must be a JSON object`, path, outcomeId, eventId));
    return;
  }
  try { assertJsonSafe(value, path, new WeakSet()); }
  catch (error) { errors.push(issue(code, error instanceof Error ? error.message : `${path} is not JSON-safe`, path, outcomeId, eventId)); }
}

function assertJsonSafe(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`${path} contains a non-finite number`);
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains unsupported ${typeof value}`);
  if (seen.has(value)) throw new TypeError(`${path} contains a circular value`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => assertJsonSafe(entry, `${path}.${index}`, seen));
  else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} contains a non-plain object`);
    Object.entries(value).forEach(([key, entry]) => assertJsonSafe(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
}

function detectCycles(events: readonly OutcomeEvent[]): readonly string[][] {
  const byId = new Map(events.map((event) => [String(event.id), event]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      cycles.push([...path.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const event = byId.get(id);
    event?.dependsOn.forEach((dependency) => { if (byId.has(String(dependency))) visit(String(dependency), [...path, id]); });
    visiting.delete(id); visited.add(id);
  };
  [...byId.keys()].sort(compareAscii).forEach((id) => visit(id, []));
  return cycles;
}

function issue(code: OutcomeValidationCode, message: string, path: string, outcomeId?: string, eventId?: string, details?: Readonly<Record<string, unknown>>, severity: "error" | "warning" = "error"): OutcomeValidationIssue {
  return { code, severity, message, path, ...(outcomeId === undefined ? {} : { outcomeId }), ...(eventId === undefined ? {} : { eventId }), ...(details === undefined ? {} : { details }) };
}
function result(errors: OutcomeValidationIssue[], warnings: OutcomeValidationIssue[]): OutcomeValidationResult { return { valid: errors.length === 0, errors, warnings }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
