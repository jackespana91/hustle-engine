import {
  OUTCOME_EVENT_NAMES,
  FeatureRegistry,
  FeatureRunner,
  OutcomeBuilder,
  OutcomeComparator,
  OutcomeDebugAdapter,
  OutcomePlayer,
  OutcomeScenarioLibrary,
  OutcomeValidator,
  createExampleFeatureRegistrations,
  createOutcomeEvent,
  engineManifestId,
  featureManifestId,
  gameManifestId,
  outcomeEventId,
  outcomeId,
  parseOutcome,
  roundId,
  serializeOutcome,
  type AnimationCommand,
  type AnimationExecutionContext,
  type AnimationExecutor,
  type OutcomeComparisonResult,
  type OutcomeDebugPanelIntegration,
  type OutcomeDefinition,
  type OutcomeEvent,
  type OutcomePlaybackResult,
  type OutcomeReplayRecord,
  type OutcomeScenario,
  type OutcomeValidationResult,
  type RecoverySnapshot,
} from "@hustle/core";
import "./style.css";

export interface OutcomeStudioOptions {
  readonly onEvent?: (name: string, payload: unknown) => void;
}

type Tone = "neutral" | "success" | "warning" | "error";

const EMPTY_DEBUG = {
  activeOutcome: null, eventCount: 0, currentEvent: null, validationStatus: "Not validated",
  playbackStatus: "idle" as const, expectedTotalMinor: 0, actualTotalMinor: 0,
  latestWarningOrError: null, recordingStatus: "idle" as const, replayVersion: 1,
  commandCount: 0, transitionCount: 0, recoveryCount: 0,
  divergenceStatus: "not-compared" as const, firstDivergence: null,
};

class StudioExecutor implements AnimationExecutor {
  async execute(command: AnimationCommand, context: AnimationExecutionContext): Promise<void> {
    if (command.metadata?.simulateAnimationFailure === true) throw new Error("Deliberate Outcome Studio animation failure");
    await abortableDelay(Math.min(500, Math.max(250, command.durationMs)), context.signal);
  }
}

export class OutcomeStudioView {
  readonly element: HTMLElement;
  readonly debugPanelIntegration: OutcomeDebugPanelIntegration;

  private readonly library = new OutcomeScenarioLibrary();
  private readonly validator = new OutcomeValidator();
  private readonly comparator = new OutcomeComparator();
  private player: OutcomePlayer | null = null;
  private debug: OutcomeDebugAdapter | null = null;
  private playerUnsubscribers: (() => void)[] = [];
  private activeOutcome: OutcomeDefinition;
  private selectedEventId: string | null = null;
  private activeScenarioId = "tiny-success";
  private validation: OutcomeValidationResult;
  private lastRecord: OutcomeReplayRecord | null = null;
  private lastResult: OutcomePlaybackResult | null = null;
  private comparison: OutcomeComparisonResult | null = null;
  private snapshot: RecoverySnapshot | null = null;
  private logs: string[] = [];
  private search = "";
  private engineFilter = "all";
  private gameFilter = "all";
  private tagFilter = "all";
  private rawJson = "";
  private status = "Select a scenario, edit its timeline, then validate and play.";
  private tone: Tone = "neutral";
  private eventCopySequence = 1;

  constructor(mount: HTMLElement, private readonly options: OutcomeStudioOptions = {}) {
    this.activeOutcome = this.requireDefinition(this.library.require(this.activeScenarioId));
    this.selectedEventId = this.activeOutcome.events[0]?.id ?? null;
    this.validation = this.validator.validate(this.activeOutcome);
    this.rawJson = serializeOutcome(this.activeOutcome, true);
    this.element = document.createElement("section");
    this.element.className = "outcome-studio";
    this.element.dataset.outcomeStudio = "true";
    this.element.setAttribute("aria-labelledby", "outcome-studio-title");
    this.element.innerHTML = markup();
    mount.append(this.element);
    this.debugPanelIntegration = Object.freeze({
      getState: () => {
        const snapshot = this.debug?.snapshot() ?? EMPTY_DEBUG;
        if (!this.comparison || this.comparison.equal) return snapshot;
        return {
          ...snapshot,
          divergenceStatus: "diverged" as const,
          firstDivergence: this.comparison.firstDivergence
            ? `${this.comparison.firstDivergence.category} · ${this.comparison.firstDivergence.path}`
            : "Divergence detected",
        };
      },
    });
    this.bind();
    this.renderFilters();
    this.render();
  }

  destroy(): void {
    this.clearPlayer();
    this.element.remove();
  }

  /** Loads an engine adapter outcome without moving RouteRun logic into Core. */
  async loadExternalOutcome(outcome: OutcomeDefinition, autoplay = false): Promise<void> {
    this.clearPlayer();
    this.activeScenarioId = "external-engine-outcome";
    if (!isDefinition(outcome)) throw new Error("External engine outcome is malformed");
    this.activeOutcome = structuredClone(outcome);
    this.selectedEventId = this.activeOutcome.events[0]?.id ?? null;
    this.validation = this.validator.validate(this.activeOutcome);
    this.rawJson = serializeOutcome(this.activeOutcome, true);
    this.lastRecord = null;
    this.lastResult = null;
    this.comparison = null;
    this.snapshot = null;
    this.status = `Loaded external ${this.activeOutcome.engineId} outcome with ${this.activeOutcome.events.length} event(s).`;
    this.tone = this.validation.valid ? "success" : "error";
    this.log(`external · ${this.activeOutcome.id}`);
    this.render();
    if (autoplay && this.validation.valid) await this.play();
  }

  private bind(): void {
    this.element.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-outcome-action]");
      if (!target) return;
      const action = target.dataset.outcomeAction;
      if (action) void this.perform(action, target.dataset.eventId, target.dataset.scenarioId);
    });
    this.element.querySelector<HTMLInputElement>("[data-outcome-search]")?.addEventListener("input", (event) => {
      this.search = (event.target as HTMLInputElement).value.trim().toLowerCase(); this.renderScenarios();
    });
    this.bindSelect("engine", (value) => { this.engineFilter = value; this.renderScenarios(); });
    this.bindSelect("game", (value) => { this.gameFilter = value; this.renderScenarios(); });
    this.bindSelect("tag", (value) => { this.tagFilter = value; this.renderScenarios(); });
    this.element.querySelector<HTMLTextAreaElement>("[data-outcome-raw]")?.addEventListener("input", (event) => {
      this.rawJson = (event.target as HTMLTextAreaElement).value;
    });
  }

  private bindSelect(key: string, handler: (value: string) => void): void {
    this.element.querySelector<HTMLSelectElement>(`[data-outcome-filter='${key}']`)?.addEventListener("change", (event) => handler((event.target as HTMLSelectElement).value));
  }

  private async perform(action: string, eventIdValue?: string, scenarioId?: string): Promise<void> {
    try {
      if (action === "load-scenario" && scenarioId) this.loadScenario(scenarioId);
      else if (action === "create-blank") this.createBlank();
      else if (action === "duplicate") this.duplicateActive();
      else if (action === "import-json") this.importJson();
      else if (action === "export-json") await this.exportJson();
      else if (action === "apply-metadata") this.applyMetadata();
      else if (action === "select-event" && eventIdValue) this.selectedEventId = eventIdValue;
      else if (action === "add-event") this.addEvent();
      else if (action === "edit-event") this.editEvent();
      else if (action === "remove-event") this.removeEvent(eventIdValue ?? this.selectedEventId);
      else if (action === "clone-event") this.cloneEvent(eventIdValue ?? this.selectedEventId);
      else if (action === "move-up") this.moveEvent(eventIdValue ?? this.selectedEventId, -1);
      else if (action === "move-down") this.moveEvent(eventIdValue ?? this.selectedEventId, 1);
      else if (action === "validate") this.validateActive(true);
      else if (action === "play") await this.play();
      else if (action === "pause") this.player?.pause();
      else if (action === "resume") this.player?.resume();
      else if (action === "skip-current") this.player?.skipCurrent();
      else if (action === "skip-all") this.player?.skipAll();
      else if (action === "interrupt") await this.interrupt();
      else if (action === "recover") await this.recover();
      else if (action === "replay") await this.replay();
      else if (action === "replay-selected") await this.replaySelected();
      else if (action === "replay-snapshot") await this.replaySnapshot();
      else if (action === "reset") this.resetPlayback();
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error);
      this.tone = "error";
      this.log(`error · ${this.status}`);
    }
    this.render();
  }

  private loadScenario(id: string): void {
    const scenario = this.library.require(id);
    this.activeScenarioId = id;
    if (isDefinition(scenario.outcome)) {
      this.activeOutcome = structuredClone(scenario.outcome);
      this.selectedEventId = this.activeOutcome.events[0]?.id ?? null;
      this.rawJson = serializeOutcome(this.activeOutcome, true);
      this.validation = this.validator.validate(this.activeOutcome);
      this.status = `${scenario.name} loaded`;
      this.tone = this.validation.valid ? "success" : "warning";
    } else {
      this.rawJson = JSON.stringify(scenario.outcome, null, 2);
      this.validation = this.validator.validate(scenario.outcome);
      this.status = `${scenario.name} loaded as an intentionally invalid document`;
      this.tone = "warning";
    }
    this.resetPlayback(false);
  }

  private createBlank(): void {
    const id = `outcome-draft-${String(Date.now()).slice(-6)}`;
    this.activeOutcome = OutcomeBuilder.create({ id, roundId: `${id}-round`, name: "Blank deterministic outcome" }).finalize();
    this.activeScenarioId = ""; this.selectedEventId = null; this.refreshDocument("Blank outcome created", "success");
  }

  private duplicateActive(): void {
    const suffix = String(Date.now()).slice(-5);
    this.activeOutcome = OutcomeBuilder.from(this.activeOutcome).clone(`${this.activeOutcome.id}-copy-${suffix}`, `${this.activeOutcome.roundId}-copy-${suffix}`).finalize();
    this.activeScenarioId = ""; this.refreshDocument("Outcome duplicated", "success");
  }

  private importJson(): void {
    this.activeOutcome = parseOutcome(this.rawJson);
    this.activeScenarioId = "";
    this.selectedEventId = this.activeOutcome.events[0]?.id ?? null;
    this.refreshDocument("Outcome JSON imported and validated", "success");
  }

  private async exportJson(): Promise<void> {
    this.rawJson = serializeOutcome(this.activeOutcome, true);
    await navigator.clipboard?.writeText(this.rawJson).catch(() => undefined);
    this.status = "Stable JSON exported to the inspector and copied when browser permission allowed";
    this.tone = "success";
  }

  private applyMetadata(): void {
    const id = this.input("metadata-id");
    const round = this.input("metadata-round");
    const name = this.input("metadata-name");
    const description = this.input("metadata-description");
    const engine = this.input("metadata-engine");
    const game = this.input("metadata-game");
    const seed = this.input("metadata-seed");
    const bet = integer(this.input("metadata-bet"), "Bet amount");
    const total = integer(this.input("metadata-total"), "Total win");
    const tags = this.input("metadata-tags").split(",").map((value) => value.trim()).filter(Boolean);
    this.activeOutcome = {
      ...this.activeOutcome, id: outcomeId(id), roundId: roundId(round), name, description,
      engineId: engineManifestId(engine), gameId: gameManifestId(game), deterministicSource: { type: "seed", value: seed },
      betAmountMinor: bet, totalWinMinor: total, tags,
    };
    this.refreshDocument("Outcome metadata updated", this.validator.validate(this.activeOutcome).valid ? "success" : "warning");
  }

  private addEvent(): void {
    const type = this.input("event-type") || "presentation-step";
    const logicalTick = integer(this.input("event-tick") || `${this.activeOutcome.events.length * 10}`, "Logical tick");
    const winAmountMinor = integer(this.input("event-win") || "0", "Event win");
    const feature = this.input("event-feature");
    const id = outcomeEventId(`${this.activeOutcome.id}-event-${this.activeOutcome.events.length}`);
    const event = createOutcomeEvent({
      id, type, sequence: this.activeOutcome.events.length, logicalTick,
      payload: { label: this.input("event-label") || type },
      blocking: this.checked("event-blocking"), skippable: this.checked("event-skippable"),
      ...(feature ? { featureId: featureManifestId(feature) } : {}),
      dependsOn: [], expectedStateChanges: { completedEvents: this.activeOutcome.events.length + 1, lastEventType: type },
      animationHints: [{ type: "outcome-presentation-step", durationMs: 80, payload: { type } }],
      assetIds: [], themeIds: [], winAmountMinor, metadata: { createdInStudio: true },
    });
    const builder = OutcomeBuilder.from(this.activeOutcome).addEvent(event).setExpectedFinalState(event.expectedStateChanges);
    this.activeOutcome = builder.finalize(); this.selectedEventId = id; this.refreshDocument("Event added", "success");
  }

  private editEvent(): void {
    const id = this.selectedEventId;
    if (!id) throw new Error("Select an event to edit");
    const type = this.input("event-type") || "presentation-step";
    const logicalTick = integer(this.input("event-tick"), "Logical tick");
    const winAmountMinor = integer(this.input("event-win"), "Event win");
    const feature = this.input("event-feature");
    const builder = OutcomeBuilder.from(this.activeOutcome).updateEvent(id, (current) => {
      const updated = {
        ...current, type, logicalTick, winAmountMinor,
        payload: { ...current.payload, label: this.input("event-label") || type },
        blocking: this.checked("event-blocking"), skippable: this.checked("event-skippable"),
        expectedStateChanges: { ...current.expectedStateChanges, lastEventType: type },
      };
      if (feature) return { ...updated, featureId: featureManifestId(feature) };
      const { featureId: _featureId, ...withoutFeature } = updated;
      return withoutFeature;
    });
    const draft = builder.snapshot();
    if (draft.events.at(-1)?.id === id) builder.setExpectedFinalState(draft.events.at(-1)?.expectedStateChanges ?? {});
    this.activeOutcome = builder.finalize(); this.refreshDocument("Selected event updated", "success");
  }

  private removeEvent(id: string | null): void {
    if (!id) throw new Error("Select an event to remove");
    const builder = OutcomeBuilder.from(this.activeOutcome).removeEvent(id);
    const last = builder.snapshot().events.at(-1);
    builder.setExpectedFinalState(last?.expectedStateChanges ?? {});
    this.activeOutcome = builder.finalize();
    this.selectedEventId = this.activeOutcome.events[0]?.id ?? null;
    this.refreshDocument("Event removed", "success");
  }

  private cloneEvent(id: string | null): void {
    if (!id) throw new Error("Select an event to clone");
    const source = this.activeOutcome.events.find((event) => event.id === id);
    if (!source) throw new Error("Selected event no longer exists");
    const newId = outcomeEventId(`${source.id}-copy-${this.eventCopySequence}`); this.eventCopySequence += 1;
    const index = this.activeOutcome.events.findIndex((event) => event.id === id);
    const clone = { ...structuredClone(source), id: newId, dependsOn: [], logicalTick: source.logicalTick };
    const builder = OutcomeBuilder.from(this.activeOutcome).insertEvent(index + 1, clone);
    const last = builder.snapshot().events.at(-1); builder.setExpectedFinalState(last?.expectedStateChanges ?? {});
    this.activeOutcome = builder.finalize(); this.selectedEventId = newId; this.refreshDocument("Event cloned", "success");
  }

  private moveEvent(id: string | null, delta: number): void {
    if (!id) throw new Error("Select an event to move");
    const index = this.activeOutcome.events.findIndex((event) => event.id === id);
    const target = Math.max(0, Math.min(this.activeOutcome.events.length - 1, index + delta));
    this.activeOutcome = OutcomeBuilder.from(this.activeOutcome).reorderEvent(id, target).finalize();
    this.refreshDocument(`Event moved ${delta < 0 ? "up" : "down"}`, "success");
  }

  private validateActive(announce: boolean): OutcomeValidationResult {
    this.validation = this.validator.validate(this.activeOutcome);
    if (announce) {
      this.status = this.validation.valid ? `Validation passed${this.validation.warnings.length ? ` with ${this.validation.warnings.length} warning(s)` : ""}` : `Validation failed with ${this.validation.errors.length} error(s)`;
      this.tone = this.validation.valid ? (this.validation.warnings.length ? "warning" : "success") : "error";
      this.log(`validation · ${this.status}`);
    }
    return this.validation;
  }

  private async play(): Promise<void> {
    if (!this.validateActive(true).valid) throw new Error("Resolve validation errors before playback");
    const player = this.replacePlayer();
    this.status = `Playing ${this.activeOutcome.name}`; this.tone = "neutral";
    const result = await player.play(this.activeOutcome);
    this.captureResult(result);
  }

  private async interrupt(): Promise<void> {
    if (!this.player) throw new Error("Start playback before interrupting");
    this.snapshot = await this.player.interrupt();
    this.status = "Playback interrupted; recovery snapshot captured"; this.tone = "warning";
  }

  private async recover(): Promise<void> {
    if (!this.player || !this.snapshot) throw new Error("Interrupt a playback before recovering");
    this.captureResult(await this.player.recover(this.snapshot));
  }

  private async replay(): Promise<void> {
    const source = this.requireRecord();
    const player = this.replacePlayer();
    const actual = await player.play(source.outcome);
    this.comparison = this.comparator.compareReplays(source, actual.record);
    this.captureResult(actual, false);
    this.status = this.comparison.equal ? "Replay matched the source record" : "Replay divergence detected";
    this.tone = this.comparison.equal ? "success" : "error";
  }

  private async replaySelected(): Promise<void> {
    const source = this.requireRecord();
    if (!this.selectedEventId) throw new Error("Select an event boundary first");
    const index = source.outcome.events.findIndex((event) => event.id === this.selectedEventId);
    if (index < 0) throw new Error("Selected event is not in the recorded outcome");
    const player = this.replacePlayer();
    const actual = await player.play(source.outcome, { startEventIndex: index });
    this.comparison = this.comparator.compareReplays(source, actual.record);
    this.captureResult(actual, false);
    this.status = `Replay completed from event ${index}; omitted prefix is shown as a structured difference`;
    this.tone = "warning";
  }

  private async replaySnapshot(): Promise<void> {
    const source = this.requireRecord();
    const snapshot = source.execution.snapshots.at(-1);
    if (!snapshot) throw new Error("The latest record has no recovery snapshot");
    const player = this.replacePlayer();
    const actual = await player.recoverFromSnapshot(source.outcome, snapshot);
    this.comparison = this.comparator.compareReplays(source, actual.record);
    this.captureResult(actual, false);
    this.status = "Replay completed from the latest recovery snapshot"; this.tone = actual.status === "completed" ? "success" : "error";
  }

  private captureResult(result: OutcomePlaybackResult, replaceComparison = true): void {
    this.lastResult = result; this.lastRecord = result.record; this.snapshot = result.snapshot;
    if (replaceComparison) {
      this.comparison = result.comparison;
      if (result.status === "completed" && this.activeOutcome.metadata.simulateReplayDivergence === true) {
        const divergentRecord: OutcomeReplayRecord = {
          ...result.record,
          execution: {
            ...result.record.execution,
            finalState: { ...result.record.execution.finalState, deliberateReplayDivergence: true },
          },
        };
        this.comparison = this.comparator.compareReplays(result.record, divergentRecord);
      }
    }
    this.status = result.status === "completed" ? "Playback completed" : result.status === "interrupted" ? "Playback interrupted" : "Playback failed";
    this.tone = result.status === "completed" ? "success" : result.status === "interrupted" ? "warning" : "error";
    if (this.comparison && !this.comparison.equal) {
      this.status = "Playback completed; deliberate replay divergence detected";
      this.tone = "error";
    }
    this.rawJson = serializeOutcome(result.record.outcome, true);
  }

  private replacePlayer(): OutcomePlayer {
    this.clearPlayer();
    const hasFeatureEvents = this.activeOutcome.events.some(({ featureId }) => featureId !== undefined);
    const registry = new FeatureRegistry();
    if (hasFeatureEvents) registry.registerMany(createExampleFeatureRegistrations());
    const featureRunner = hasFeatureEvents ? new FeatureRunner(registry) : undefined;
    const player = new OutcomePlayer({
      executor: new StudioExecutor(),
      ...(featureRunner ? { featureRunner } : {}),
      prepareEvent: (event) => {
        if (event.metadata.simulateAssetFailure === true) throw new Error(`Simulated ${String(event.metadata.assetRequirement)} asset failure`);
        return { warnings: event.assetIds.length > 0 ? [`Resolved ${event.assetIds.length} illustrative asset reference(s)`] : [] };
      },
    });
    this.player = player; this.debug = new OutcomeDebugAdapter(player);
    OUTCOME_EVENT_NAMES.forEach((name) => {
      this.playerUnsubscribers.push(player.events.subscribe(name, (payload) => {
        this.options.onEvent?.(name, payload);
        this.log(`${name} · ${summary(payload)}`);
        this.renderPlayback(); this.renderInspector();
      }));
    });
    return player;
  }

  private clearPlayer(): void {
    this.playerUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.debug?.destroy(); this.debug = null;
    this.player?.reset(); this.player = null;
  }

  private resetPlayback(render = true): void {
    this.clearPlayer(); this.lastRecord = null; this.lastResult = null; this.comparison = null; this.snapshot = null;
    this.logs = []; if (render) { this.status = "Playback reset"; this.tone = "neutral"; }
  }

  private refreshDocument(status: string, tone: Tone): void {
    this.validation = this.validator.validate(this.activeOutcome);
    this.rawJson = serializeOutcome(this.activeOutcome, true);
    this.status = status; this.tone = tone; this.resetPlayback(false);
  }

  private render(): void {
    this.renderScenarios(); this.renderTimeline(); this.renderInspector(); this.renderPlayback();
    const status = this.element.querySelector<HTMLElement>("[data-outcome-status]");
    if (status) { status.textContent = this.status; status.dataset.tone = this.tone; }
  }

  private renderScenarios(): void {
    const list = this.element.querySelector<HTMLElement>("[data-outcome-scenarios]"); if (!list) return;
    const scenarios = this.filteredScenarios();
    list.innerHTML = scenarios.map((scenario) => `<button class="outcome-scenario" data-outcome-action="load-scenario" data-scenario-id="${escapeHtml(scenario.id)}" aria-pressed="${scenario.id === this.activeScenarioId}"><span>${escapeHtml(scenario.name)}</span><small>${escapeHtml(scenario.tags.join(" · "))}</small><b>${isDefinition(scenario.outcome) ? (scenario.outcome as OutcomeDefinition).events.length : "!"} events</b></button>`).join("") || `<p class="outcome-empty">No scenarios match these filters.</p>`;
  }

  private renderTimeline(): void {
    const timeline = this.element.querySelector<HTMLElement>("[data-outcome-timeline]"); if (!timeline) return;
    timeline.innerHTML = this.activeOutcome.events.map((event, index) => {
      const issues = [...this.validation.errors, ...this.validation.warnings].filter((issue) => issue.eventId === event.id || issue.path.startsWith(`events.${index}`));
      return `<article class="outcome-event-card" data-selected="${event.id === this.selectedEventId}" data-valid="${issues.every(({ severity }) => severity !== "error")}">
        <button class="outcome-event-select" data-outcome-action="select-event" data-event-id="${escapeHtml(event.id)}">
          <span class="outcome-sequence">${event.sequence}</span><div><strong>${escapeHtml(event.type)}</strong><small>${escapeHtml(event.id)}</small></div><b>tick ${event.logicalTick}</b>
        </button>
        <dl><div><dt>Feature</dt><dd>${escapeHtml(event.featureId ?? "—")}</dd></div><div><dt>Flow</dt><dd>${event.blocking ? "blocking" : "non-blocking"} · ${event.skippable ? "skippable" : "locked"}</dd></div><div><dt>State</dt><dd>${escapeHtml(summary(event.expectedStateChanges))}</dd></div><div><dt>Animation</dt><dd>${escapeHtml(event.animationHints.map(({ type }) => type).join(", ") || "default")}</dd></div></dl>
        <div class="outcome-card-actions"><button data-outcome-action="move-up" data-event-id="${escapeHtml(event.id)}" aria-label="Move ${escapeHtml(event.type)} up">↑</button><button data-outcome-action="move-down" data-event-id="${escapeHtml(event.id)}" aria-label="Move ${escapeHtml(event.type)} down">↓</button><button data-outcome-action="clone-event" data-event-id="${escapeHtml(event.id)}">Clone</button><button data-outcome-action="remove-event" data-event-id="${escapeHtml(event.id)}">Remove</button></div>
      </article>`;
    }).join("") || `<div class="outcome-empty outcome-empty-timeline"><strong>Blank timeline</strong><span>Add an event with the form in the inspector.</span></div>`;
  }

  private renderInspector(): void {
    this.setInput("metadata-id", this.activeOutcome.id); this.setInput("metadata-round", this.activeOutcome.roundId);
    this.setInput("metadata-name", this.activeOutcome.name); this.setInput("metadata-description", this.activeOutcome.description);
    this.setInput("metadata-engine", this.activeOutcome.engineId); this.setInput("metadata-game", this.activeOutcome.gameId);
    this.setInput("metadata-seed", this.activeOutcome.deterministicSource.value); this.setInput("metadata-bet", `${this.activeOutcome.betAmountMinor}`);
    this.setInput("metadata-total", `${this.activeOutcome.totalWinMinor}`); this.setInput("metadata-tags", this.activeOutcome.tags.join(", "));
    const selected = this.activeOutcome.events.find((event) => event.id === this.selectedEventId) ?? null;
    if (selected) {
      this.setInput("event-type", selected.type); this.setInput("event-tick", `${selected.logicalTick}`);
      this.setInput("event-win", `${selected.winAmountMinor ?? 0}`); this.setInput("event-feature", selected.featureId ?? "");
      this.setInput("event-label", typeof selected.payload.label === "string" ? selected.payload.label : "");
      this.setChecked("event-blocking", selected.blocking); this.setChecked("event-skippable", selected.skippable);
    }
    const raw = this.element.querySelector<HTMLTextAreaElement>("[data-outcome-raw]"); if (raw && document.activeElement !== raw) raw.value = this.rawJson;
    this.setText("validation-errors", formatIssues(this.validation));
    this.setText("expected-state", JSON.stringify(this.activeOutcome.expectedFinalState, null, 2));
    this.setText("actual-state", JSON.stringify(this.player?.state.actualState ?? {}, null, 2));
    this.setText("feature-executions", formatFeatureExecutions(this.lastRecord));
    this.setText("animation-commands", formatCommands(this.lastRecord));
    this.setText("transition-history", formatTransitions(this.lastRecord));
    this.setText("comparison", this.comparison ? JSON.stringify(this.comparison, null, 2) : "No comparison has run.");
    this.setText("first-divergence", this.comparison?.firstDivergence ? `${this.comparison.firstDivergence.category} · ${this.comparison.firstDivergence.path}\n${this.comparison.firstDivergence.message}` : "None");
  }

  private renderPlayback(): void {
    const state = this.player?.state;
    const current = state?.currentEvent;
    const command = this.player?.controller.queue.current;
    this.setText("console-lifecycle", state?.lifecycleState ?? "idle");
    this.setText("console-event", current ? `${current.sequence} · ${current.type}` : "—");
    this.setText("console-animation", command ? `${command.type} · ${command.id}` : "—");
    this.setText("console-queue", this.player ? `${this.player.controller.queue.state} · ${this.player.controller.queue.pending.length} pending` : "idle · 0 pending");
    this.setText("console-tick", `${current?.logicalTick ?? 0}`);
    const completed = this.lastRecord?.execution.eventPublications.filter(({ name }) => name === "outcome:event-completed").length ?? state?.activeOutcome?.events.findIndex((event) => event.id === current?.id) ?? 0;
    this.setText("console-progress", `${Math.max(0, completed)} / ${this.activeOutcome.events.length}`);
    this.setText("console-log", this.logs.join("\n") || "No playback events yet.");
    const issues = [...(this.lastRecord?.execution.warnings ?? []), ...(this.lastRecord?.execution.errors ?? [])];
    this.setText("console-errors", issues.length ? issues.map(({ code, message }) => `[${code}] ${message}`).join("\n") : "No playback warnings or errors.");
  }

  private renderFilters(): void {
    const scenarios = this.library.list();
    this.fillSelect("engine", unique(scenarios.map(({ engineId }) => engineId)), "All engines");
    this.fillSelect("game", unique(scenarios.map(({ gameId }) => gameId)), "All games");
    this.fillSelect("tag", unique(scenarios.flatMap(({ tags }) => tags)), "All tags");
  }

  private filteredScenarios(): readonly OutcomeScenario[] {
    return this.library.list().filter((scenario) => {
      const search = `${scenario.name} ${scenario.description} ${scenario.tags.join(" ")}`.toLowerCase();
      return (!this.search || search.includes(this.search)) && (this.engineFilter === "all" || scenario.engineId === this.engineFilter) &&
        (this.gameFilter === "all" || scenario.gameId === this.gameFilter) && (this.tagFilter === "all" || scenario.tags.includes(this.tagFilter));
    });
  }

  private fillSelect(key: string, values: readonly string[], allLabel: string): void {
    const select = this.element.querySelector<HTMLSelectElement>(`[data-outcome-filter='${key}']`); if (!select) return;
    select.innerHTML = `<option value="all">${allLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  }

  private requireRecord(): OutcomeReplayRecord { if (!this.lastRecord) throw new Error("Play an outcome before replaying it"); return structuredClone(this.lastRecord); }
  private requireDefinition(scenario: OutcomeScenario): OutcomeDefinition { if (!isDefinition(scenario.outcome)) throw new Error(`${scenario.name} is intentionally malformed`); return structuredClone(scenario.outcome); }
  private input(key: string): string { return this.element.querySelector<HTMLInputElement>(`[data-outcome-input='${key}']`)?.value.trim() ?? ""; }
  private checked(key: string): boolean { return this.element.querySelector<HTMLInputElement>(`[data-outcome-input='${key}']`)?.checked ?? false; }
  private setInput(key: string, value: string): void { const node = this.element.querySelector<HTMLInputElement>(`[data-outcome-input='${key}']`); if (node && document.activeElement !== node) node.value = value; }
  private setChecked(key: string, value: boolean): void { const node = this.element.querySelector<HTMLInputElement>(`[data-outcome-input='${key}']`); if (node && document.activeElement !== node) node.checked = value; }
  private setText(key: string, value: string): void { const node = this.element.querySelector<HTMLElement>(`[data-outcome-value='${key}']`); if (node) node.textContent = value; }
  private log(message: string): void { this.logs.unshift(message); this.logs.splice(120); }
}

export function mountOutcomeStudio(mount: HTMLElement, options?: OutcomeStudioOptions): OutcomeStudioView {
  return new OutcomeStudioView(mount, options);
}

function markup(): string {
  const action = (id: string, label: string, primary = false) => `<button class="${primary ? "primary" : ""}" data-outcome-action="${id}">${label}</button>`;
  return `<header class="outcome-studio-header"><div><span>HUSTLE CORE · TASK 005</span><h2 id="outcome-studio-title">Outcome Studio</h2><p>Build, validate, replay and inspect deterministic outcome data.</p></div><div class="outcome-studio-header-actions">${action("create-blank", "Create blank outcome")}${action("duplicate", "Duplicate")}${action("validate", "Validate", true)}${action("play", "Play", true)}</div></header>
  <p class="outcome-status" data-outcome-status data-tone="neutral" aria-live="polite"></p>
  <div class="outcome-studio-layout">
    <aside class="outcome-library"><div class="outcome-pane-heading"><span>LEFT PANEL</span><h3>Scenario Library</h3></div><input data-outcome-search type="search" placeholder="Search scenarios" aria-label="Search scenarios"><div class="outcome-filter-grid"><select data-outcome-filter="engine" aria-label="Filter by engine"></select><select data-outcome-filter="game" aria-label="Filter by game"></select><select data-outcome-filter="tag" aria-label="Filter by tag"></select></div><div class="outcome-scenario-list" data-outcome-scenarios></div><div class="outcome-library-actions">${action("duplicate", "Duplicate scenario")}${action("create-blank", "Blank outcome")}${action("import-json", "Import JSON")}${action("export-json", "Export JSON")}</div></aside>
    <section class="outcome-timeline-pane"><div class="outcome-pane-heading"><span>CENTRE</span><h3>Outcome Timeline</h3><p>Ordered event cards · deterministic logical time</p></div><div class="outcome-playback-actions">${action("add-event", "Add event")}${action("edit-event", "Edit event")}${action("remove-event", "Remove")}${action("move-up", "Move up")}${action("move-down", "Move down")}${action("clone-event", "Clone")}${action("validate", "Validate")}${action("play", "Play", true)}${action("pause", "Pause")}${action("resume", "Resume")}${action("skip-current", "Skip current")}${action("skip-all", "Skip all")}${action("interrupt", "Interrupt")}${action("recover", "Recover")}${action("replay", "Replay")}${action("replay-selected", "Replay selected")}${action("replay-snapshot", "Replay snapshot")}${action("reset", "Reset")}</div><div class="outcome-timeline" data-outcome-timeline></div></section>
    <aside class="outcome-inspector"><div class="outcome-pane-heading"><span>RIGHT PANEL</span><h3>Inspector</h3></div>
      <details open><summary>Outcome metadata</summary><div class="outcome-form-grid"><label>ID<input data-outcome-input="metadata-id"></label><label>Round ID<input data-outcome-input="metadata-round"></label><label>Name<input data-outcome-input="metadata-name"></label><label>Description<input data-outcome-input="metadata-description"></label><label>Engine<input data-outcome-input="metadata-engine"></label><label>Game<input data-outcome-input="metadata-game"></label><label>Seed / source<input data-outcome-input="metadata-seed"></label><label>Bet minor<input data-outcome-input="metadata-bet" inputmode="numeric"></label><label>Total win minor<input data-outcome-input="metadata-total" inputmode="numeric"></label><label>Tags<input data-outcome-input="metadata-tags"></label></div>${action("apply-metadata", "Apply metadata")}</details>
      <details open><summary>Selected event</summary><div class="outcome-form-grid"><label>Type<input data-outcome-input="event-type"></label><label>Label<input data-outcome-input="event-label"></label><label>Logical tick<input data-outcome-input="event-tick" inputmode="numeric"></label><label>Win minor<input data-outcome-input="event-win" inputmode="numeric"></label><label>Feature ID<input data-outcome-input="event-feature" placeholder="optional"></label><label class="outcome-check"><input data-outcome-input="event-blocking" type="checkbox" checked>Blocking</label><label class="outcome-check"><input data-outcome-input="event-skippable" type="checkbox" checked>Skippable</label></div><div class="outcome-inline-actions">${action("add-event", "Add")}${action("edit-event", "Update")}${action("clone-event", "Clone")}${action("remove-event", "Remove")}</div></details>
      <details open><summary>Raw JSON · import/export</summary><textarea data-outcome-raw spellcheck="false" aria-label="Outcome raw JSON"></textarea><div class="outcome-inline-actions">${action("import-json", "Import JSON")}${action("export-json", "Export JSON")}</div></details>
      ${inspectorBlock("Validation errors", "validation-errors")}${inspectorBlock("Expected state", "expected-state")}${inspectorBlock("Actual state", "actual-state")}${inspectorBlock("Feature executions", "feature-executions")}${inspectorBlock("Animation commands", "animation-commands")}${inspectorBlock("Transition history", "transition-history")}${inspectorBlock("Comparison result", "comparison")}${inspectorBlock("First divergence", "first-divergence")}
    </aside>
  </div>
  <section class="outcome-console"><div class="outcome-pane-heading"><span>BOTTOM</span><h3>Playback Console</h3></div><div class="outcome-console-metrics"><div><span>Lifecycle</span><strong data-outcome-value="console-lifecycle">idle</strong></div><div><span>Current event</span><strong data-outcome-value="console-event">—</strong></div><div><span>Current animation</span><strong data-outcome-value="console-animation">—</strong></div><div><span>Queue</span><strong data-outcome-value="console-queue">idle</strong></div><div><span>Logical tick</span><strong data-outcome-value="console-tick">0</strong></div><div><span>Progress</span><strong data-outcome-value="console-progress">0 / 0</strong></div></div><div class="outcome-console-grid"><article><h4>Event log</h4><pre data-outcome-value="console-log"></pre></article><article><h4>Errors and warnings</h4><pre data-outcome-value="console-errors"></pre></article></div></section>`;
}

function inspectorBlock(title: string, key: string): string { return `<details><summary>${title}</summary><pre data-outcome-value="${key}"></pre></details>`; }
function isDefinition(value: unknown): value is OutcomeDefinition { return typeof value === "object" && value !== null && "events" in value && Array.isArray((value as { events?: unknown }).events) && (value as { schemaVersion?: unknown }).schemaVersion === "1.0.0"; }
function integer(value: string, label: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative whole number`); return parsed; }
function unique(values: readonly string[]): readonly string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en")); }
function formatIssues(validation: OutcomeValidationResult): string { const issues = [...validation.errors, ...validation.warnings]; return issues.length ? issues.map((issue) => `[${issue.severity.toUpperCase()} · ${issue.code}] ${issue.path}\n${issue.message}`).join("\n\n") : "No validation errors or warnings."; }
function formatFeatureExecutions(record: OutcomeReplayRecord | null): string { return record?.execution.featureExecutions.map((item) => `${item.executionOrder} · ${item.featureId}\n${item.operation} · ${item.eventId}`).join("\n\n") || "No feature executions recorded."; }
function formatCommands(record: OutcomeReplayRecord | null): string { return record?.execution.animationCommands.map((item, index) => `${index} · ${item.type}\n${item.id}`).join("\n\n") || "No animation commands recorded."; }
function formatTransitions(record: OutcomeReplayRecord | null): string { return record?.execution.stateTransitions.map((item) => `${item.sequence} · ${item.from} → ${item.to}`).join("\n") || "No state transitions recorded."; }
function summary(value: unknown): string {
  try {
    if (typeof value === "object" && value !== null && "event" in value) {
      const event = (value as { event?: unknown }).event;
      if (typeof event === "object" && event !== null && "id" in event) {
        const projection = event as { id: unknown; type?: unknown; sequence?: unknown; logicalTick?: unknown };
        return `${String(projection.id)} · ${String(projection.type ?? "event")} · sequence ${String(projection.sequence ?? "—")} · tick ${String(projection.logicalTick ?? "—")}`;
      }
    }
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  } catch { return "[unserializable]"; }
}
function escapeHtml(value: string): string { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal.aborted) { reject(new Error("aborted")); return; } const timer = window.setTimeout(resolve, ms); signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new Error("aborted")); }, { once: true }); }); }
