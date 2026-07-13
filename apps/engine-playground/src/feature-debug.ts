import {
  FEATURE_DEBUG_EVENT_NAMES,
  FEATURE_SDK_EXAMPLE_ENGINE_ID,
  FeatureDebugAdapter,
  FeatureRegistry,
  FeatureRunner,
  FeatureSdkError,
  FeatureSerializer,
  SequenceRandomSource,
  createCircularDependencyFeatureExample,
  createConflictingFeatureExample,
  createExampleFeatureRegistrations,
  createFailureFeatureExample,
  createMissingDependencyFeatureExample,
  type FeatureDebugSnapshot,
  type DebugPanelFeatureIntegration,
  type FeatureEmittedEvent,
  type FeatureEventMap,
  type FeatureEventName,
  type FeatureManifestId,
  type FeatureRegistrationInput,
  type FeatureRunnerContextInput,
  type FeatureRunnerResult,
  type FeatureRuntimeSnapshot,
} from "@hustle/core";

const PLAYGROUND_GAME_ID = "feature-sdk-playground-game";
const RANDOM_VALUES = Object.freeze([
  0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75,
  0.85, 0.95, 0.12, 0.32, 0.52, 0.72, 0.82, 0.92,
]);

export interface FeatureDebugViewOptions {
  readonly onEvent?: (name: string, payload: unknown) => void;
  /** Keep false when the host must install its Debug Panel with this view's adapter first. */
  readonly loadExamplesOnMount?: boolean;
}

interface LifecycleExecution {
  readonly initialized: FeatureRunnerResult;
  readonly executed: FeatureRunnerResult;
}

interface DeterminismComparison {
  readonly matches: boolean;
  readonly resultMatches: boolean;
  readonly stateMatches: boolean;
  readonly first: LifecycleExecution;
  readonly second: LifecycleExecution;
  readonly firstState: FeatureRuntimeSnapshot;
  readonly secondState: FeatureRuntimeSnapshot;
}

/** Self-contained Feature SDK workspace; the host only supplies a mount and event sink. */
export class FeatureDebugView {
  readonly registry = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID });
  readonly runner = new FeatureRunner(this.registry);
  readonly serializer = new FeatureSerializer();
  readonly debugAdapter = new FeatureDebugAdapter(this.registry);
  readonly element: HTMLElement;
  readonly debugPanelIntegration: DebugPanelFeatureIntegration;

  private readonly unsubscribers: (() => void)[] = [];
  private search = "";
  private engineFilter = "all";
  private busy = false;
  private sequence = 0;
  private status = "Ready to inspect Feature SDK examples";
  private statusTone: "neutral" | "success" | "warning" | "error" = "neutral";
  private lastError: string | null = null;
  private scenarioErrors: string[] = [];
  private scenarioOutput = "No validation or failure scenario has run.";
  private serializedJson: string | null = null;
  private loadedJson: string | null = null;
  private latestExecution: LifecycleExecution | null = null;
  private latestEmittedEvents: readonly FeatureEmittedEvent[] = [];
  private comparison: DeterminismComparison | null = null;
  private snapshotContext: FeatureRunnerContextInput | null = null;

  constructor(
    mount: HTMLElement,
    private readonly options: FeatureDebugViewOptions = {},
  ) {
    this.element = document.createElement("section");
    this.element.className = "feature-debug feature-workspace";
    this.element.setAttribute("aria-labelledby", "feature-workspace-title");
    this.element.innerHTML = featureMarkup();
    mount.append(this.element);
    this.debugPanelIntegration = Object.freeze({
      getState: () => this.snapshot(),
      actions: Object.freeze({
        loadExamples: () => this.perform("load-examples"),
        setEnabled: (id: FeatureManifestId | string, enabled: boolean) => this.setFeatureEnabled(id, enabled),
        executeEligible: () => this.perform("execute"),
        compareDeterministicRuns: () => this.perform("compare"),
        serializeStates: () => this.perform("serialize"),
        clearRuntimeState: () => this.perform("clear-state"),
        restoreStates: () => this.perform("restore"),
        loadMissingDependency: () => this.perform("missing-dependency"),
        loadCircularDependency: () => this.perform("cycle"),
        loadConflict: () => this.perform("conflict"),
        simulateBlockingFailure: () => this.perform("blocking-failure"),
        simulateNonBlockingFailure: () => this.perform("non-blocking-failure"),
        clearRegistry: () => this.perform("clear-registry"),
      }),
    });
    this.bind();
    this.subscribeToEvents();
    if (options.loadExamplesOnMount === true) void this.loadExamples();
    else this.render();
  }

  /** Safe to call after the host Debug Panel has attached to debugAdapter. */
  loadExamples(): Promise<void> {
    return this.perform("load-examples");
  }

  snapshot(): FeatureDebugSnapshot {
    return this.debugAdapter.snapshot();
  }

  destroy(): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.debugAdapter.destroy();
    this.element.remove();
  }

  private bind(): void {
    this.element.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLButtonElement>("button[data-feature-action]")?.dataset.featureAction;
      if (action) {
        void this.perform(action);
        return;
      }
      const toggle = target.closest<HTMLButtonElement>("button[data-feature-toggle]");
      const id = toggle?.dataset.featureToggle;
      if (id) this.setFeatureEnabled(id, toggle.getAttribute("aria-pressed") !== "true");
    });

    this.element.querySelector<HTMLInputElement>("[data-feature-search]")?.addEventListener("input", (event) => {
      this.search = (event.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderCards();
    });
    this.element.querySelector<HTMLSelectElement>("[data-feature-engine-filter]")?.addEventListener("change", (event) => {
      this.engineFilter = (event.target as HTMLSelectElement).value;
      this.renderCards();
    });
  }

  private subscribeToEvents(): void {
    FEATURE_DEBUG_EVENT_NAMES.forEach((name) => this.subscribe(name));
  }

  private subscribe<Name extends FeatureEventName>(name: Name): void {
    this.unsubscribers.push(this.registry.events.subscribe(name, (payload) => {
      this.options.onEvent?.(name, payload);
    }));
  }

  private async perform(action: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.lastError = null;
    this.setBusy(true);
    try {
      if (action === "load-examples") this.loadExamplesInternal();
      else if (action === "execute") await this.executeEligible();
      else if (action === "compare") await this.compareDeterminism();
      else if (action === "serialize") this.serializeState();
      else if (action === "clear-state") await this.clearRuntimeState();
      else if (action === "restore") await this.restoreState();
      else if (action === "missing-dependency") this.runRegistrationScenario("Missing dependency", createMissingDependencyFeatureExample());
      else if (action === "cycle") this.runRegistrationScenario("Circular dependency", createCircularDependencyFeatureExample());
      else if (action === "conflict") this.runRegistrationScenario("Feature conflict", createConflictingFeatureExample());
      else if (action === "blocking-failure") await this.runFailureScenario("blocking");
      else if (action === "non-blocking-failure") await this.runFailureScenario("non-blocking");
      else if (action === "clear-registry") await this.clearRegistry();
      else if (action === "clear-events") {
        this.debugAdapter.actions.clearEventHistory();
        this.setStatus("Feature event history cleared", "neutral");
      }
      this.options.onEvent?.("feature:workspace-action", { action, status: this.status });
    } catch (error) {
      this.captureUnexpected(error, `Feature workspace action '${action}' failed`);
      this.options.onEvent?.("feature:workspace-error", { action, error: this.lastError });
    } finally {
      this.busy = false;
      this.setBusy(false);
      this.render();
    }
  }

  private loadExamplesInternal(): void {
    this.registry.clear();
    this.debugAdapter.actions.clearEventHistory();
    this.runner.clearExecutionLedger();
    this.registry.registerMany(createExampleFeatureRegistrations());
    this.sequence = 0;
    this.snapshotContext = null;
    this.serializedJson = null;
    this.loadedJson = null;
    this.latestExecution = null;
    this.latestEmittedEvents = [];
    this.comparison = null;
    this.scenarioErrors = [];
    this.scenarioOutput = "Valid placeholder implementations and matching manifests loaded.";
    this.setStatus("Loaded six non-production example features", "success");
  }

  private setFeatureEnabled(id: FeatureManifestId | string, enabled: boolean): void {
    if (this.busy) {
      throw new FeatureSdkError("LIFECYCLE_FAILURE", "Feature workspace is already running an action", {
        featureId: id as FeatureManifestId,
        operation: enabled ? "enable" : "disable",
        recoverable: true,
      });
    }
    this.lastError = null;
    try {
      this.debugAdapter.actions.setEnabled(id, enabled);
      this.setStatus(`${id} ${enabled ? "enabled" : "disabled"}`, "success");
      this.options.onEvent?.("feature:workspace-toggle", { featureId: id, enabled });
    } catch (error) {
      this.captureUnexpected(error, `Could not ${enabled ? "enable" : "disable"} ${id}`);
    }
    this.render(String(id));
  }

  private async executeEligible(): Promise<void> {
    this.requireFeatures();
    const input = this.nextContext("execute");
    const execution = await runLifecycle(this.runner, input);
    this.snapshotContext = input;
    this.latestExecution = execution;
    this.latestEmittedEvents = [
      ...execution.initialized.result.emittedEvents,
      ...execution.executed.result.emittedEvents,
    ];
    this.comparison = null;
    this.setStatus(`Executed ${execution.executed.executedFeatureIds.length} eligible features`, "success");
  }

  private async compareDeterminism(): Promise<void> {
    this.requireFeatures();
    const baselineContext = this.snapshotOptions(this.snapshotContext);
    const baseline = this.serializer.createSnapshot(this.registry, baselineContext);
    const sequence = this.nextSequence();

    const firstInput = createRunnerContext("determinism", sequence);
    const first = await runLifecycle(this.runner, firstInput);
    const firstState = this.serializer.createSnapshot(this.registry, this.snapshotOptions(firstInput));

    await this.serializer.restore(this.registry, baseline, {
      engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
      gameId: PLAYGROUND_GAME_ID,
    });
    this.runner.restoreExecutionLedger(baseline.executionLedger);

    const secondInput = createRunnerContext("determinism", sequence);
    const second = await runLifecycle(this.runner, secondInput);
    const secondState = this.serializer.createSnapshot(this.registry, this.snapshotOptions(secondInput));

    const resultMatches = canonical(first) === canonical(second);
    const stateMatches = this.serializer.serializeSnapshot(firstState) === this.serializer.serializeSnapshot(secondState);
    this.comparison = { matches: resultMatches && stateMatches, resultMatches, stateMatches, first, second, firstState, secondState };
    this.snapshotContext = secondInput;
    this.latestExecution = second;
    this.latestEmittedEvents = [
      ...second.initialized.result.emittedEvents,
      ...second.executed.result.emittedEvents,
    ];
    this.setStatus(
      this.comparison.matches ? "Deterministic comparison passed" : "Deterministic comparison failed",
      this.comparison.matches ? "success" : "error",
    );
  }

  private serializeState(): void {
    this.requireFeatures();
    this.serializedJson = this.serializer.serialize(this.registry, this.snapshotOptions(this.snapshotContext), true);
    this.setStatus("Feature runtime state serialized", "success");
  }

  private async clearRuntimeState(): Promise<void> {
    this.requireFeatures();
    await this.registry.resetRuntimeState();
    this.runner.clearExecutionLedger();
    this.latestExecution = null;
    this.latestEmittedEvents = [];
    this.comparison = null;
    this.snapshotContext = null;
    this.setStatus("Feature runtime state and execution ledger cleared", "success");
  }

  private async restoreState(): Promise<void> {
    if (this.serializedJson === null) {
      throw new FeatureSdkError("INVALID_SNAPSHOT", "Serialize feature state before restoring it", {
        operation: "recover",
      });
    }
    const snapshot = await this.serializer.restore(this.registry, this.serializedJson, {
      engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
      gameId: PLAYGROUND_GAME_ID,
    });
    this.runner.restoreExecutionLedger(snapshot.executionLedger);
    this.loadedJson = this.serializer.serializeSnapshot(snapshot, true);
    this.snapshotContext = contextFromSnapshot(snapshot);
    this.setStatus("Feature runtime state restored transactionally", "success");
  }

  private runRegistrationScenario(label: string, registrations: readonly FeatureRegistrationInput[]): void {
    const temporary = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID });
    const events: string[] = [];
    const unsubscribe = subscribeAll(temporary, (name, payload) => {
      events.push(`${name} ${summarize(payload)}`);
      this.options.onEvent?.(name, payload);
    });
    let rejection = "Scenario unexpectedly registered without an error.";
    try { temporary.registerMany(registrations); }
    catch (error) { rejection = describeError(error); }
    finally { unsubscribe(); }
    this.scenarioOutput = formatJson({
      scenario: label,
      liveRegistryPreserved: true,
      rejection,
      events,
    });
    this.scenarioErrors = [rejection];
    this.setStatus(`${label} example rejected; live registry preserved`, "warning");
  }

  private async runFailureScenario(policy: "blocking" | "non-blocking"): Promise<void> {
    const temporary = new FeatureRegistry({ engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID });
    const events: string[] = [];
    const unsubscribe = subscribeAll(temporary, (name, payload) => {
      events.push(`${name} ${summarize(payload)}`);
      this.options.onEvent?.(name, payload);
    });
    const followingFeature = createExampleFeatureRegistrations()[0];
    if (!followingFeature) throw new Error("Missing example feature for failure isolation scenario");
    temporary.registerMany([createFailureFeatureExample(policy), followingFeature]);
    const runner = new FeatureRunner(temporary);
    const input = createRunnerContext(`${policy}-failure`, this.nextSequence());
    let result: FeatureRunnerResult | null = null;
    let caught: string | null = null;
    try {
      await runner.initializeRound(input);
      result = await runner.execute(input);
    } catch (error) {
      caught = describeError(error);
    } finally {
      unsubscribe();
    }
    const states = temporary.list().map(({ manifest, lifecycleStatus, executionCount }) => ({
      featureId: manifest.id,
      lifecycleStatus,
      executionCount,
      state: temporary.getState(manifest.id),
    }));
    this.scenarioOutput = formatJson({
      scenario: `${policy} feature failure`,
      policy,
      expectedBehavior: policy === "blocking" ? "fail-fast" : "isolate-and-report",
      caught,
      result,
      states,
      events,
      liveRegistryPreserved: true,
    });
    this.scenarioErrors = [
      ...(caught === null ? [] : [caught]),
      ...(result?.failures.map(({ code, message }) => `[${code}] ${message}`) ?? []),
    ];
    const behavedAsExpected = policy === "blocking" ? caught !== null : caught === null && result?.failures.length === 1;
    this.setStatus(
      `${policy === "blocking" ? "Blocking" : "Non-blocking"} failure ${behavedAsExpected ? "behaved as expected" : "needs review"}`,
      behavedAsExpected ? "warning" : "error",
    );
  }

  private async clearRegistry(): Promise<void> {
    if (this.registry.list().length > 0) {
      try { await this.runner.cleanup(this.nextContext("clear-registry")); }
      finally { this.registry.clear(); }
    }
    this.runner.clearExecutionLedger();
    this.serializedJson = null;
    this.loadedJson = null;
    this.latestExecution = null;
    this.latestEmittedEvents = [];
    this.comparison = null;
    this.scenarioErrors = [];
    this.snapshotContext = null;
    this.setStatus("Feature registry cleared", "neutral");
  }

  private nextContext(label: string): FeatureRunnerContextInput {
    return createRunnerContext(label, this.nextSequence());
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private snapshotOptions(input: FeatureRunnerContextInput | null): {
    readonly engineId: typeof FEATURE_SDK_EXAMPLE_ENGINE_ID;
    readonly gameId: string;
    readonly roundId: FeatureRunnerContextInput["roundId"] | null;
    readonly eventId: FeatureRunnerContextInput["eventId"] | null;
    readonly logicalTick: number;
    readonly executionLedger: readonly string[];
  } {
    return {
      engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
      gameId: PLAYGROUND_GAME_ID,
      roundId: input?.roundId ?? null,
      eventId: input?.eventId ?? null,
      logicalTick: input?.logicalTick ?? 0,
      executionLedger: this.runner.executionLedger,
    };
  }

  private requireFeatures(): void {
    if (this.registry.list().length === 0) {
      throw new FeatureSdkError("UNKNOWN_FEATURE", "Load the example feature set first", {
        operation: "resolve-order",
      });
    }
  }

  private captureUnexpected(error: unknown, prefix: string): void {
    this.lastError = `${prefix}: ${describeError(error)}`;
    this.setStatus(prefix, "error");
  }

  private setStatus(message: string, tone: "neutral" | "success" | "warning" | "error"): void {
    this.status = message;
    this.statusTone = tone;
  }

  private setBusy(busy: boolean): void {
    this.element.setAttribute("aria-busy", String(busy));
    this.element.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")
      .forEach((control) => { control.disabled = busy; });
  }

  private render(focusFeatureId?: string): void {
    const snapshot = this.debugAdapter.snapshot();
    this.renderEngineFilter(snapshot);
    this.renderCards(snapshot);
    setText(this.element, "status", this.status);
    const status = requireElement(this.element, "[data-feature-value='status']");
    status.dataset.tone = this.statusTone;
    setText(this.element, "registered-count", String(snapshot.registeredFeatures.length));
    setText(this.element, "enabled-count", String(snapshot.registeredFeatures.filter(({ enabled }) => enabled).length));
    setText(this.element, "event-count", String(snapshot.latestEvents.length));
    setText(this.element, "issue-count", String(snapshot.latestErrors.length + snapshot.latestWarnings.length + this.scenarioErrors.length + (this.lastError ? 1 : 0)));
    setText(this.element, "order", formatOrder(snapshot));
    setText(this.element, "execution", this.latestExecution === null ? "No eligible feature execution yet." : formatJson(this.latestExecution));
    setText(this.element, "comparison", formatComparison(this.comparison));
    setText(this.element, "events", formatEvents(snapshot, this.latestEmittedEvents));
    setText(this.element, "warnings", formatWarnings(snapshot));
    setText(this.element, "errors", formatErrors(snapshot, this.lastError, this.scenarioErrors));
    setText(this.element, "scenario", this.scenarioOutput);
    setText(this.element, "serialized", this.serializedJson ?? formatNullable(snapshot.serializedState, "No serialized state."));
    setText(this.element, "loaded", this.loadedJson ?? formatNullable(snapshot.loadedState, "No restored state."));
    this.setBusy(this.busy);

    if (focusFeatureId) {
      queueMicrotask(() => {
        [...this.element.querySelectorAll<HTMLButtonElement>("button[data-feature-toggle]")]
          .find(({ dataset }) => dataset.featureToggle === focusFeatureId)?.focus();
      });
    }
  }

  private renderEngineFilter(snapshot: FeatureDebugSnapshot): void {
    const select = requireElement<HTMLSelectElement>(this.element, "[data-feature-engine-filter]");
    const engines = [...new Set(snapshot.registeredFeatures.flatMap(({ supportedEngineIds }) => supportedEngineIds))].sort(compareAscii);
    if (this.engineFilter !== "all" && !engines.includes(this.engineFilter)) this.engineFilter = "all";
    const values = ["all", ...engines];
    select.replaceChildren(...values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "all" ? "All compatible engines" : value;
      return option;
    }));
    select.value = this.engineFilter;
  }

  private renderCards(snapshot = this.debugAdapter.snapshot()): void {
    const list = requireElement(this.element, "[data-feature-list]");
    const visible = snapshot.registeredFeatures.filter((feature) => {
      const haystack = [
        feature.id, feature.name, feature.description, feature.implementationName,
        ...feature.supportedEngineIds, ...feature.dependencies, ...feature.optionalDependencies, ...feature.conflicts,
      ].join(" ").toLowerCase();
      return (!this.search || haystack.includes(this.search)) &&
        (this.engineFilter === "all" || feature.supportedEngineIds.includes(this.engineFilter));
    });
    list.innerHTML = visible.length === 0
      ? `<p class="feature-empty">${snapshot.registeredFeatures.length === 0 ? "No features registered. Load the example set to begin." : "No features match the current filters."}</p>`
      : visible.map(featureCard).join("");
  }
}

export function mountFeatureDebug(
  mount: HTMLElement,
  options?: FeatureDebugViewOptions,
): FeatureDebugView {
  return new FeatureDebugView(mount, options);
}

function featureMarkup(): string {
  return `
    <header class="feature-debug-header feature-workspace-header">
      <div><span>HUSTLE CORE</span><h2 id="feature-workspace-title">Feature SDK</h2><p>Deterministic, manifest-backed plugin inspection · non-production examples</p></div>
      <div class="feature-debug-controls">
        <label><span>Search</span><input data-feature-search type="search" placeholder="ID, implementation or dependency" autocomplete="off"></label>
        <label><span>Engine</span><select data-feature-engine-filter></select></label>
      </div>
      <p class="feature-workspace-status" data-feature-value="status" data-tone="neutral" aria-live="polite"></p>
    </header>
    <div class="feature-action-groups">
      ${actionGroup("Runtime", [
        ["load-examples", "Load example feature set", "primary"], ["execute", "Execute eligible features"],
        ["compare", "Run twice and compare"], ["serialize", "Serialize states"],
        ["clear-state", "Clear runtime state"], ["restore", "Restore states"], ["clear-registry", "Clear feature registry", "danger"],
      ])}
      ${actionGroup("Validation", [
        ["missing-dependency", "Missing dependency"], ["cycle", "Circular dependency"], ["conflict", "Conflict example"],
      ])}
      ${actionGroup("Failure policy", [
        ["blocking-failure", "Blocking failure"], ["non-blocking-failure", "Non-blocking failure"],
      ])}
    </div>
    <div class="feature-workspace-metrics" aria-label="Feature runtime summary">
      ${metric("Registered", "registered-count")}${metric("Enabled", "enabled-count")}${metric("Recent events", "event-count")}${metric("Issues", "issue-count")}
    </div>
    <div class="feature-debug-layout feature-workspace-layout">
      <section aria-labelledby="registered-features-title"><h3 id="registered-features-title">Registered implementations and manifests</h3><div data-feature-list class="feature-list"></div></section>
      <div class="feature-inspection feature-workspace-inspection">
        ${inspection("Execution order", "order", "Resolved deterministic feature order")}
        ${inspection("Latest execution", "execution", "Latest feature execution result")}
        ${inspection("Determinism comparison", "comparison", "Repeated deterministic execution comparison")}
        <article><div class="feature-inspection-heading"><h3>Latest events</h3><button data-feature-action="clear-events">Clear event history</button></div><pre data-feature-value="events" tabindex="0" aria-label="Latest feature events"></pre></article>
        ${inspection("Warnings", "warnings", "Latest feature warnings")}
        ${inspection("Errors", "errors", "Latest feature errors", "feature-error-panel")}
        ${inspection("Scenario result", "scenario", "Latest validation or failure scenario")}
        ${inspection("Serialized state", "serialized", "Serialized feature runtime state")}
        ${inspection("Loaded state", "loaded", "Restored feature runtime state")}
      </div>
    </div>`;
}

function actionGroup(
  label: string,
  actions: readonly (readonly [string, string, string?])[],
): string {
  return `<div class="feature-action-group" role="group" aria-label="${escapeHtml(label)} controls"><span>${escapeHtml(label)}</span><div>${actions.map(([action, text, tone]) => `<button data-feature-action="${action}" class="${tone ? `feature-action-${tone}` : ""}">${escapeHtml(text)}</button>`).join("")}</div></div>`;
}

function metric(label: string, key: string): string {
  return `<div><span>${label}</span><strong data-feature-value="${key}">0</strong></div>`;
}

function inspection(title: string, key: string, label: string, className = ""): string {
  return `<article class="${className}"><h3>${title}</h3><pre data-feature-value="${key}" tabindex="0" aria-label="${label}"></pre></article>`;
}

function featureCard(feature: FeatureDebugSnapshot["registeredFeatures"][number]): string {
  const enabled = feature.enabled;
  const state = formatJson(feature.currentState);
  const manifest = formatJson(feature.manifest);
  return `<article class="feature-card feature-runtime-card" data-enabled="${enabled}">
    <div class="feature-card-heading"><div><span>${escapeHtml(feature.id)}</span><h4>${escapeHtml(feature.name)}</h4><small>${escapeHtml(feature.implementationName)}</small></div>
      <button class="feature-enable-button" data-feature-toggle="${escapeHtml(feature.id)}" aria-pressed="${enabled}" aria-label="${enabled ? "Disable" : "Enable"} ${escapeHtml(feature.name)}">${enabled ? "Enabled" : "Disabled"}</button></div>
    <p>${escapeHtml(feature.description)}</p>
    <div class="feature-badges"><span data-tone="${feature.deterministic ? "success" : "error"}">${feature.deterministic ? "Deterministic" : "Non-deterministic"}</span><span>${escapeHtml(feature.failurePolicy)}</span><span data-tone="${feature.engineCompatible ? "success" : "error"}">${feature.engineCompatible ? "Engine compatible" : "Engine incompatible"}</span></div>
    <dl>
      ${definition("Lifecycle", feature.lifecycleStatus)}${definition("Priority", String(feature.priority))}
      ${definition("Manifest / implementation", `${feature.manifestVersion} / ${feature.implementationVersion}`)}
      ${definition("State versions", `${feature.manifestStateVersion} / ${feature.implementationStateVersion}`)}
      ${definition("Execution count", String(feature.executionCount))}${definition("Last order", feature.lastExecutionOrder === null ? "Never" : String(feature.lastExecutionOrder + 1))}
      ${definition("Engines", joinOrNone(feature.supportedEngineIds))}${definition("Dependencies", joinOrNone(feature.dependencies))}
      ${definition("Optional", joinOrNone(feature.optionalDependencies))}${definition("Conflicts", joinOrNone(feature.conflicts))}
    </dl>
    <details><summary>Manifest and current state</summary><div class="feature-card-json"><div><strong>Manifest</strong><pre tabindex="0" aria-label="${escapeHtml(feature.name)} manifest">${escapeHtml(manifest)}</pre></div><div><strong>State</strong><pre tabindex="0" aria-label="${escapeHtml(feature.name)} current state">${escapeHtml(state)}</pre></div></div></details>
  </article>`;
}

function definition(term: string, value: string): string {
  return `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function createRunnerContext(label: string, sequence: number): FeatureRunnerContextInput {
  const suffix = String(sequence).padStart(4, "0");
  return {
    roundId: `feature-${label}-round-${suffix}`,
    eventId: `feature-${label}-event-${suffix}`,
    engineId: FEATURE_SDK_EXAMPLE_ENGINE_ID,
    gameId: PLAYGROUND_GAME_ID,
    currentLifecycleState: "presenting",
    roundData: { example: true, label, sequence },
    sharedPresentationState: { example: true },
    random: new SequenceRandomSource(RANDOM_VALUES),
    logicalTick: sequence,
    metadata: { source: "engine-playground", production: false },
  };
}

function contextFromSnapshot(snapshot: FeatureRuntimeSnapshot): FeatureRunnerContextInput {
  return {
    roundId: snapshot.roundId ?? "feature-restored-round",
    eventId: snapshot.eventId ?? "feature-restored-event",
    engineId: snapshot.engineId,
    gameId: snapshot.gameId,
    currentLifecycleState: "recovering",
    roundData: { restored: true },
    sharedPresentationState: {},
    random: new SequenceRandomSource(RANDOM_VALUES),
    logicalTick: snapshot.logicalTick,
    metadata: { source: "engine-playground", production: false },
  };
}

async function runLifecycle(runner: FeatureRunner, input: FeatureRunnerContextInput): Promise<LifecycleExecution> {
  return {
    initialized: await runner.initializeRound(input),
    executed: await runner.execute(input),
  };
}

function subscribeAll(
  registry: FeatureRegistry,
  listener: (name: FeatureEventName, payload: unknown) => void,
): () => void {
  const unsubscribers = FEATURE_DEBUG_EVENT_NAMES.map((name) => subscribeEvent(registry, name, listener));
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

function subscribeEvent<Name extends FeatureEventName>(
  registry: FeatureRegistry,
  name: Name,
  listener: (name: FeatureEventName, payload: unknown) => void,
): () => void {
  return registry.events.subscribe(name, (payload: FeatureEventMap[Name]) => listener(name, payload));
}

function formatOrder(snapshot: FeatureDebugSnapshot): string {
  return snapshot.executionOrder.length === 0
    ? "No enabled compatible features."
    : snapshot.executionOrder.map((id, index) => `${index + 1}. ${id}`).join("\n");
}

function formatComparison(comparison: DeterminismComparison | null): string {
  if (comparison === null) return "Run the same controlled context twice to compare output and state.";
  return [
    comparison.matches ? "PASS · deterministic output and state match" : "FAIL · repeated runs diverged",
    `Results: ${comparison.resultMatches ? "match" : "different"}`,
    `State: ${comparison.stateMatches ? "match" : "different"}`,
    "",
    formatJson({
      first: { executed: comparison.first.executed.executedFeatureIds, telemetry: comparison.first.executed.result.telemetry },
      second: { executed: comparison.second.executed.executedFeatureIds, telemetry: comparison.second.executed.result.telemetry },
    }),
  ].join("\n");
}

function formatEvents(snapshot: FeatureDebugSnapshot, emitted: readonly FeatureEmittedEvent[]): string {
  const featureEvents = emitted.length === 0
    ? "No feature-emitted events."
    : emitted.map(({ name, payload }) => `${name} ${summarize(payload)}`).join("\n");
  const sdkEvents = snapshot.latestEvents.length === 0
    ? "No typed SDK events."
    : snapshot.latestEvents.map(({ sequence, type, payload }) => `${sequence}  ${type}  ${summarize(payload)}`).join("\n");
  return `FEATURE-EMITTED\n${featureEvents}\n\nTYPED SDK EVENTS · LATEST 14\n${sdkEvents}`;
}

function formatWarnings(snapshot: FeatureDebugSnapshot): string {
  const current = snapshot.registeredFeatures.flatMap(({ id, warnings }) => warnings.map((warning) => ({ id, warning })));
  const latest = snapshot.latestWarnings.map(({ featureId: id, warning }) => ({ id, warning }));
  const warnings = deduplicate([...latest, ...current], ({ id, warning }) => `${id}:${warning.code}:${warning.message}`);
  return warnings.length === 0 ? "No feature warnings." : warnings.map(({ id, warning }) => `[${warning.code}] ${id}: ${warning.message}`).join("\n");
}

function formatErrors(
  snapshot: FeatureDebugSnapshot,
  lastError: string | null,
  scenarioErrors: readonly string[],
): string {
  const current = snapshot.registeredFeatures.flatMap(({ id, recoverableErrors }) => recoverableErrors.map((error) => `[${error.code}] ${id}: ${error.message}`));
  const latest = snapshot.latestErrors.map(({ error }) => `[${error.code}] ${error.featureId ?? "runtime"}: ${error.message}`);
  const errors = [...(lastError === null ? [] : [lastError]), ...scenarioErrors, ...latest, ...current];
  return errors.length === 0 ? "No feature errors." : [...new Set(errors)].join("\n");
}

function formatNullable(value: unknown, empty: string): string {
  return value === null ? empty : formatJson(value);
}

function formatJson(value: unknown): string {
  try { return JSON.stringify(stableValue(value), null, 2); }
  catch { return "[unserializable debug value]"; }
}

function canonical(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function summarize(value: unknown): string {
  const summary = canonical(value);
  return summary.length > 260 ? `${summary.slice(0, 257)}…` : summary;
}

function describeError(error: unknown): string {
  if (error instanceof FeatureSdkError) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function joinOrNone(values: readonly { toString(): string }[]): string {
  return values.length === 0 ? "None" : values.map(String).join(", ");
}

function deduplicate<Value>(values: readonly Value[], key: (value: Value) => string): Value[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const signature = key(value);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function setText(root: HTMLElement, key: string, value: string): void {
  const element = root.querySelector<HTMLElement>(`[data-feature-value='${key}']`);
  if (element && element.textContent !== value) element.textContent = value;
}

function requireElement<ElementType extends HTMLElement = HTMLElement>(
  root: HTMLElement,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Feature workspace element missing: ${selector}`);
  return element;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}
