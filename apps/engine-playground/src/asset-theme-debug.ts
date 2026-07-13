import {
  ASSET_EVENT_NAMES,
  HUSTLE_BASE_THEME_EXAMPLE,
  HIGH_CONTRAST_THEME_EXAMPLE,
  ManifestRegistry,
  NIGHT_DROP_EXAMPLE_MANIFESTS,
  NIGHT_DROP_GAME_MANIFEST_EXAMPLE,
  NIGHT_DROP_ILLUSTRATIVE_ASSET_ENTRIES,
  NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS,
  NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST,
  NIGHT_DROP_THEME_EXAMPLE,
  OPERATOR_OVERLAY_THEME_EXAMPLE,
  SEASONAL_OVERLAY_THEME_EXAMPLE,
  THEME_DEBUG_EVENT_NAMES,
  THEME_EXAMPLE_ENGINE_ID,
  THEME_EXAMPLE_GAME_ID,
  THEME_SYSTEM_EXAMPLES,
  AssetCache,
  AssetDebugAdapter,
  AssetLoader,
  AssetPreloader,
  AssetRegistry,
  AssetSystemError,
  ThemeDebugAdapter,
  ThemeLoader,
  ThemeRegistry,
  ThemeRuntime,
  ThemeSystemError,
  themeDefinitionFromManifest,
  themeId,
  type AssetDebugRegistration,
  type AssetDebugSnapshot,
  type AssetLoadAdapter,
  type AssetLoadAdapterRequest,
  type AssetLoadAdapterResult,
  type AssetPreloadGroupResult,
  type AssetRuntimeConditions,
  type DebugPanelAssetThemeIntegration,
  type DebugPanelAssetThemeSnapshot,
  type ResolvedGameComposition,
  type ThemeDebugSnapshot,
  type ThemeSelection,
} from "@hustle/core";

const DEFAULT_CONDITIONS: AssetRuntimeConditions = Object.freeze({
  platform: "web",
  viewportWidth: 390,
  viewportHeight: 844,
  devicePixelRatio: 1,
  orientation: "portrait",
  locale: "en",
  reducedMotion: false,
  qualityTier: "low",
  memoryTier: "standard",
});

type StatusTone = "neutral" | "success" | "warning" | "error";
type AdapterScenario = "normal" | "optional-failure" | "required-failure" | "timeout" | "fallback";

interface PlaygroundAssetResource {
  readonly logicalId: string;
  readonly source: string;
  readonly payload: string;
  readonly loadSequence: number;
}

export interface AssetThemeDebugViewOptions {
  readonly onEvent?: (name: string, payload: unknown) => void;
  /** Keep false when the host installs the shared Debug Panel before loading examples. */
  readonly loadExamplesOnMount?: boolean;
}

/**
 * Browser-only deterministic adapter used by the Playground. Core owns all
 * scheduling, fallback, timeout, cache and progress behavior around it.
 */
class PlaygroundAssetAdapter implements AssetLoadAdapter<PlaygroundAssetResource> {
  private scenario: AdapterScenario = "normal";
  private sequence = 0;

  arm(scenario: Exclude<AdapterScenario, "normal">): void { this.scenario = scenario; }
  reset(): void { this.scenario = "normal"; }

  async load(request: AssetLoadAdapterRequest): Promise<AssetLoadAdapterResult<PlaygroundAssetResource>> {
    const { asset, signal, onProgress } = request;
    const duration = this.scenario === "timeout" && asset.assetId === NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.safeFallback
      ? 600
      : 180;
    onProgress({ loadedEstimatedBytes: 0, totalEstimatedBytes: asset.estimatedBytes });
    await abortablePause(Math.max(20, Math.round(duration * 0.45)), signal);
    onProgress({
      loadedEstimatedBytes: Math.round(asset.estimatedBytes * 0.45),
      totalEstimatedBytes: asset.estimatedBytes,
    });
    await abortablePause(Math.max(20, Math.round(duration * 0.55)), signal);

    if (this.shouldFail(String(asset.assetId))) {
      throw new Error(`Illustrative adapter failure for ${asset.assetId}`);
    }

    onProgress({ loadedEstimatedBytes: asset.estimatedBytes, totalEstimatedBytes: asset.estimatedBytes });
    const resource: PlaygroundAssetResource = Object.freeze({
      logicalId: asset.assetId,
      source: asset.source,
      payload: `illustrative:${asset.source}`,
      loadSequence: this.sequence,
    });
    this.sequence += 1;
    return Object.freeze({
      resource,
      estimatedBytes: asset.estimatedBytes,
      ...(asset.checksum === null ? {} : { checksum: asset.checksum }),
      metadata: { adapter: "engine-playground", nonProduction: true },
      dispose: () => undefined,
    });
  }

  private shouldFail(id: string): boolean {
    if (this.scenario === "optional-failure") {
      return id === NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.optionalFailure;
    }
    if (this.scenario === "required-failure") {
      return id === NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.requiredFailure;
    }
    if (this.scenario === "fallback") {
      return id === NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.fallbackExample;
    }
    return false;
  }
}

/** Self-contained diagnostic workspace. It contains no game mechanics. */
export class AssetThemeDebugView {
  readonly element: HTMLElement;
  readonly debugPanelIntegration: DebugPanelAssetThemeIntegration;

  private readonly manifestRegistry = new ManifestRegistry();
  private readonly assetRegistry = new AssetRegistry();
  private readonly assetCache = new AssetCache<PlaygroundAssetResource>({
    maximumEstimatedBytes: 2 * 1_024 * 1_024,
    events: this.assetRegistry.events,
  });
  private readonly adapter = new PlaygroundAssetAdapter();
  private readonly assetLoader: AssetLoader<PlaygroundAssetResource>;
  private readonly assetPreloader: AssetPreloader<PlaygroundAssetResource>;
  private readonly assetDebug: AssetDebugAdapter<PlaygroundAssetResource>;
  private readonly themeRegistry = new ThemeRegistry();
  private readonly themeLoader = new ThemeLoader();
  private readonly themeRuntime = new ThemeRuntime(this.themeRegistry);
  private readonly themeDebug = new ThemeDebugAdapter(this.themeRegistry, this.themeRuntime, 40);
  private readonly unsubscribers: (() => void)[] = [];

  private conditions: AssetRuntimeConditions = structuredClone(DEFAULT_CONDITIONS);
  private composition: ResolvedGameComposition | null = null;
  private preloadController: AbortController | null = null;
  private lastPreload: AssetPreloadGroupResult | null = null;
  private operatorEnabled = false;
  private seasonalEnabled = false;
  private highContrastEnabled = false;
  private busy = false;
  private renderQueued = false;
  private search = "";
  private typeFilter = "all";
  private stateFilter = "all";
  private status = "Ready to inspect asset and theme infrastructure";
  private statusTone: StatusTone = "neutral";
  private scenarioResult = "No failure, timeout, fallback or atomic-swap scenario has run.";
  private warnings: string[] = [];
  private rawData = "Load the illustrative manifest set to inspect composition data.";

  constructor(
    mount: HTMLElement,
    private readonly options: AssetThemeDebugViewOptions = {},
  ) {
    this.assetLoader = new AssetLoader({
      registry: this.assetRegistry,
      cache: this.assetCache,
      adapter: this.adapter,
      conditions: () => this.conditions,
      concurrencyLimit: 2,
      defaultTimeoutMs: 2_000,
      optionalFailurePolicy: "return-failure",
    });
    this.assetPreloader = new AssetPreloader(this.assetRegistry, this.assetLoader);
    this.assetDebug = new AssetDebugAdapter({
      registry: this.assetRegistry,
      cache: this.assetCache,
      loader: this.assetLoader,
      preloader: this.assetPreloader,
      conditions: () => this.conditions,
      events: this.assetRegistry.events,
    });
    this.element = document.createElement("section");
    this.element.className = "asset-theme-workspace";
    this.element.dataset.assetThemeWorkspace = "true";
    this.element.setAttribute("aria-labelledby", "asset-theme-workspace-title");
    this.element.innerHTML = workspaceMarkup();
    mount.append(this.element);
    this.debugPanelIntegration = Object.freeze({ getState: () => this.debugSnapshot() });
    this.bind();
    this.subscribeToEvents();
    this.render();
    if (options.loadExamplesOnMount === true) void this.loadExamples();
  }

  loadExamples(): Promise<void> { return this.perform("load-examples"); }

  debugSnapshot(): DebugPanelAssetThemeSnapshot {
    return Object.freeze({
      assets: this.assetDebug.snapshot(this.conditions),
      theme: this.themeDebug.snapshot(),
    });
  }

  destroy(): void {
    this.preloadController?.abort("Asset and Theme workspace destroyed");
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.assetDebug.destroy();
    this.themeDebug.destroy();
    this.assetCache.clear({ force: true });
    this.element.remove();
  }

  private bind(): void {
    this.element.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement)
        .closest<HTMLButtonElement>("button[data-asset-theme-action]")?.dataset.assetThemeAction;
      if (action) void this.perform(action);
    });
    this.element.querySelector<HTMLInputElement>("[data-asset-theme-search]")?.addEventListener("input", (event) => {
      this.search = (event.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderAssetRows();
    });
    this.element.querySelector<HTMLSelectElement>("[data-asset-theme-type-filter]")?.addEventListener("change", (event) => {
      this.typeFilter = (event.target as HTMLSelectElement).value;
      this.renderAssetRows();
    });
    this.element.querySelector<HTMLSelectElement>("[data-asset-theme-state-filter]")?.addEventListener("change", (event) => {
      this.stateFilter = (event.target as HTMLSelectElement).value;
      this.renderAssetRows();
    });
  }

  private subscribeToEvents(): void {
    ASSET_EVENT_NAMES.forEach((name) => {
      this.unsubscribers.push(this.assetRegistry.events.subscribe(name, (payload) => {
        this.options.onEvent?.(name, payload);
        this.queueRender();
      }));
    });
    THEME_DEBUG_EVENT_NAMES.forEach((name) => {
      this.unsubscribers.push(this.themeRegistry.events.subscribe(name, (payload) => {
        this.options.onEvent?.(name, payload);
        this.queueRender();
      }));
    });
  }

  private async perform(action: string): Promise<void> {
    if (action === "cancel-preload") {
      this.cancelPreload();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      if (action === "load-examples") await this.loadExampleData();
      else if (action === "preload-bootstrap") await this.preload("bootstrap");
      else if (action === "preload-base-game") await this.preload("base-game");
      else if (action === "quality-low") this.updateConditions({ qualityTier: "low" }, "Low quality tier selected");
      else if (action === "quality-high") this.updateConditions({ qualityTier: "high" }, "High quality tier selected");
      else if (action === "orientation-portrait") this.updateConditions({ orientation: "portrait", viewportWidth: 390, viewportHeight: 844 }, "Portrait conditions selected");
      else if (action === "orientation-landscape") this.updateConditions({ orientation: "landscape", viewportWidth: 844, viewportHeight: 390 }, "Landscape conditions selected");
      else if (action === "locale-en") this.updateConditions({ locale: "en" }, "English locale selected");
      else if (action === "locale-es") this.updateConditions({ locale: "es-ES" }, "Spanish locale selected");
      else if (action === "toggle-reduced-motion") this.updateConditions({ reducedMotion: !this.conditions.reducedMotion }, `Reduced motion ${this.conditions.reducedMotion ? "enabled" : "disabled"}`);
      else if (action === "toggle-high-contrast") this.toggleThemeLayer("accessibility");
      else if (action === "toggle-operator") this.toggleThemeLayer("operator");
      else if (action === "toggle-seasonal") this.toggleThemeLayer("seasonal");
      else if (action === "optional-failure") await this.simulateOptionalFailure();
      else if (action === "required-failure") await this.simulateRequiredFailure();
      else if (action === "timeout") await this.simulateTimeout();
      else if (action === "fallback") await this.testFallback();
      else if (action === "invalid-theme-swap") this.testInvalidThemeSwap();
      else if (action === "export-registry") this.exportSnapshot();
      else if (action === "clear-cache") this.clearCache();
      else if (action === "reset") this.resetWorkspace();
    } catch (error) {
      this.status = describeError(error);
      this.statusTone = "error";
      this.scenarioResult = `Unexpected action failure: ${describeError(error)}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async loadExampleData(): Promise<void> {
    this.resetWorkspace(false);
    this.manifestRegistry.registerMany([
      ...NIGHT_DROP_EXAMPLE_MANIFESTS,
      NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST,
    ]);
    this.composition = this.manifestRegistry.resolveGame(NIGHT_DROP_GAME_MANIFEST_EXAMPLE.id);
    this.assetRegistry.registerManifest(this.composition.assets);
    this.assetRegistry.registerManifest(NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST);
    this.assetRegistry.registerMany(NIGHT_DROP_ILLUSTRATIVE_ASSET_ENTRIES);
    await this.themeLoader.load(this.themeRegistry, [
      ...THEME_SYSTEM_EXAMPLES,
      themeDefinitionFromManifest(this.composition.theme, {
        layer: "game",
        parentId: HUSTLE_BASE_THEME_EXAMPLE.id,
        metadata: { illustrativeManifestBridge: true },
      }),
    ]);
    this.themeRuntime.activate(this.themeSelection());
    this.rawData = formatJson({
      resolvedGameComposition: this.composition,
      illustrativeAssetManifest: NIGHT_DROP_ILLUSTRATIVE_ASSET_MANIFEST,
      assetRegistry: this.assetRegistry.snapshot(),
      themeRegistry: this.themeRegistry.snapshot(),
      preloadPlan: ["bootstrap", "base-game"],
    });
    this.status = "Illustrative manifests resolved; asset and theme runtimes initialized";
    this.statusTone = "success";
  }

  private async preload(group: "bootstrap" | "base-game"): Promise<void> {
    this.requireExamples();
    const controller = new AbortController();
    this.preloadController = controller;
    this.status = `Preloading ${group}`;
    this.statusTone = "neutral";
    this.queueRender();
    try {
      this.lastPreload = await this.assetPreloader.preloadGroup(group, {
        signal: controller.signal,
        retain: false,
        onProgress: () => this.queueRender(),
      });
      const failures = this.lastPreload.failedRequiredAssets.length + this.lastPreload.failedOptionalAssets.length;
      this.warnings = [...this.lastPreload.warnings];
      this.status = `${group} complete · ${this.lastPreload.loadedCount}/${this.lastPreload.requestedCount} loaded`;
      this.statusTone = failures === 0 ? "success" : "warning";
    } finally {
      if (this.preloadController === controller) this.preloadController = null;
    }
  }

  private cancelPreload(): void {
    if (!this.preloadController) {
      this.status = "No preload is active";
      this.statusTone = "warning";
      this.render();
      return;
    }
    this.preloadController.abort("Cancelled from Assets & Themes workspace");
    this.status = "Preload cancellation requested";
    this.statusTone = "warning";
    this.render();
  }

  private updateConditions(
    patch: Partial<AssetRuntimeConditions>,
    message: string,
  ): void {
    this.conditions = Object.freeze({ ...this.conditions, ...patch });
    this.status = message;
    this.statusTone = "success";
  }

  private toggleThemeLayer(layer: "operator" | "seasonal" | "accessibility"): void {
    this.requireExamples();
    if (layer === "operator") this.operatorEnabled = !this.operatorEnabled;
    else if (layer === "seasonal") this.seasonalEnabled = !this.seasonalEnabled;
    else this.highContrastEnabled = !this.highContrastEnabled;
    this.themeRuntime.swap(this.themeSelection());
    this.status = `${capitalize(layer)} override ${this.isLayerEnabled(layer) ? "enabled" : "disabled"}`;
    this.statusTone = "success";
  }

  private themeSelection(): ThemeSelection {
    return {
      engineId: THEME_EXAMPLE_ENGINE_ID,
      gameId: THEME_EXAMPLE_GAME_ID,
      base: HUSTLE_BASE_THEME_EXAMPLE.id,
      game: NIGHT_DROP_THEME_EXAMPLE.id,
      ...(this.operatorEnabled ? { operator: OPERATOR_OVERLAY_THEME_EXAMPLE.id } : {}),
      ...(this.seasonalEnabled ? { seasonal: SEASONAL_OVERLAY_THEME_EXAMPLE.id } : {}),
      ...(this.highContrastEnabled ? { accessibility: HIGH_CONTRAST_THEME_EXAMPLE.id } : {}),
    };
  }

  private isLayerEnabled(layer: "operator" | "seasonal" | "accessibility"): boolean {
    return layer === "operator" ? this.operatorEnabled
      : layer === "seasonal" ? this.seasonalEnabled
        : this.highContrastEnabled;
  }

  private async simulateOptionalFailure(): Promise<void> {
    this.requireExamples();
    const id = NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.optionalFailure;
    this.assetLoader.dispose(id, this.conditions, true);
    this.adapter.arm("optional-failure");
    try {
      const result = await this.assetLoader.load(id, { conditions: this.conditions, retain: false });
      if (result.status !== "failed") throw new Error("Optional failure scenario unexpectedly loaded");
      this.scenarioResult = `[${result.error.code}] ${result.error.message}\nOptional failure returned a recoverable result without stopping the runtime.`;
      this.warnings = [`Optional asset ${id} failed as expected`];
      this.status = "Optional asset failure isolated and reported";
      this.statusTone = "warning";
    } finally { this.adapter.reset(); }
  }

  private async simulateRequiredFailure(): Promise<void> {
    this.requireExamples();
    const id = NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.requiredFailure;
    this.assetLoader.dispose(id, this.conditions, true);
    this.adapter.arm("required-failure");
    try {
      await this.assetLoader.load(id, { conditions: this.conditions, retain: false });
      throw new Error("Required failure scenario unexpectedly loaded");
    } catch (error) {
      if (!(error instanceof AssetSystemError)) throw error;
      this.scenarioResult = `[${error.code}] ${error.message}\nRequired failure rejected the request and preserved existing cached resources.`;
      this.status = "Required asset failure rejected as expected";
      this.statusTone = "warning";
    } finally { this.adapter.reset(); }
  }

  private async simulateTimeout(): Promise<void> {
    this.requireExamples();
    const id = NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.safeFallback;
    this.assetLoader.dispose(id, this.conditions, true);
    this.adapter.arm("timeout");
    try {
      await this.assetLoader.load(id, { conditions: this.conditions, timeoutMs: 35, retain: false });
      throw new Error("Timeout scenario unexpectedly loaded");
    } catch (error) {
      if (!(error instanceof AssetSystemError) || error.code !== "ASSET_TIMEOUT") throw error;
      this.scenarioResult = `[${error.code}] ${error.message}\nThe host adapter was aborted by Core's timeout boundary.`;
      this.status = "Timeout handled with a structured error";
      this.statusTone = "warning";
    } finally { this.adapter.reset(); }
  }

  private async testFallback(): Promise<void> {
    this.requireExamples();
    const primary = NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.fallbackExample;
    this.assetLoader.dispose(primary, this.conditions, true);
    this.assetLoader.dispose(NIGHT_DROP_ILLUSTRATIVE_ASSET_IDS.safeFallback, this.conditions, true);
    this.adapter.arm("fallback");
    try {
      const result = await this.assetLoader.load(primary, { conditions: this.conditions, retain: false });
      if (result.status !== "loaded" || !result.usedFallback) throw new Error("Fallback scenario did not use its fallback");
      this.scenarioResult = `${primary} → ${result.resolvedAsset.assetId}\n${result.warnings.join("\n")}`;
      this.status = "Deterministic fallback resolved successfully";
      this.statusTone = "success";
    } finally { this.adapter.reset(); }
  }

  private testInvalidThemeSwap(): void {
    this.requireExamples();
    const before = this.themeRuntime.active;
    try {
      this.themeRuntime.swap({ ...this.themeSelection(), game: themeId("missing-illustrative-theme") });
      throw new Error("Invalid theme swap unexpectedly succeeded");
    } catch (error) {
      if (!(error instanceof ThemeSystemError)) throw error;
      const after = this.themeRuntime.active;
      if (before?.hash !== after?.hash) throw new Error("Invalid theme swap changed the active theme");
      this.scenarioResult = `[${error.code}] ${error.message}\nActive hash preserved: ${after?.hash ?? "inactive"}`;
      this.status = "Invalid theme swap rejected; previous theme preserved";
      this.statusTone = "success";
    }
  }

  private exportSnapshot(): void {
    this.requireExamples();
    const json = formatJson({
      manifests: this.manifestRegistry.snapshot(),
      assets: this.assetRegistry.snapshot(),
      cacheMetadata: this.assetCache.snapshot(),
      themes: this.themeRegistry.snapshot(),
      activeTheme: this.themeRuntime.snapshot(),
      conditions: this.conditions,
    });
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hustle-asset-theme-registry.json";
    link.hidden = true;
    document.body.append(link);
    link.click();
    window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 0);
    this.status = "Registry and metadata snapshot exported";
    this.statusTone = "success";
  }

  private clearCache(): void {
    const removed = this.assetDebug.actions.clearCache(true);
    this.status = `Cleared ${removed} cached resource${removed === 1 ? "" : "s"}`;
    this.statusTone = "success";
  }

  private resetWorkspace(updateStatus = true): void {
    this.preloadController?.abort("Workspace reset");
    this.preloadController = null;
    this.adapter.reset();
    this.assetCache.clear({ force: true });
    this.assetRegistry.clear();
    this.themeRuntime.deactivate();
    this.themeRegistry.clear();
    this.manifestRegistry.clear();
    this.assetDebug.clearHistory();
    this.themeDebug.clear();
    this.conditions = structuredClone(DEFAULT_CONDITIONS);
    this.composition = null;
    this.lastPreload = null;
    this.operatorEnabled = false;
    this.seasonalEnabled = false;
    this.highContrastEnabled = false;
    this.scenarioResult = "No failure, timeout, fallback or atomic-swap scenario has run.";
    this.warnings = [];
    this.rawData = "Load the illustrative manifest set to inspect composition data.";
    if (updateStatus) {
      this.status = "Assets & Themes workspace reset";
      this.statusTone = "neutral";
    }
  }

  private requireExamples(): void {
    if (this.assetRegistry.list().length === 0 || this.themeRegistry.list().length === 0) {
      throw new Error("Load the illustrative manifest set first");
    }
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private render(): void {
    const assets = this.assetDebug.snapshot(this.conditions);
    const theme = this.themeDebug.snapshot();
    setText(this.element, "status", this.status);
    const status = requireElement(this.element, "[data-asset-theme-value='status']");
    status.dataset.tone = this.statusTone;
    setText(this.element, "registered-count", String(assets.registeredCount));
    setText(this.element, "loaded-count", String(assets.loadedCount));
    setText(this.element, "cache-bytes", formatBytes(assets.estimatedCacheBytes));
    setText(this.element, "token-count", String(Object.keys(theme.tokens).length));
    setText(this.element, "conditions", formatConditions(this.conditions));
    setText(this.element, "progress", formatProgress(assets, this.lastPreload));
    setText(this.element, "composition", formatComposition(theme));
    setText(this.element, "tokens", formatJson(theme.tokens));
    setText(this.element, "aliases", formatJson(theme.assetAliases));
    setText(this.element, "events", formatEvents(assets, theme));
    setText(this.element, "errors", formatErrors(assets, theme));
    setText(this.element, "warnings", this.warnings.length > 0 ? this.warnings.join("\n") : "No warnings");
    setText(this.element, "scenario", this.scenarioResult);
    setText(this.element, "raw", this.rawData);
    this.renderAssetRows(assets);
    this.renderThemeLayers(theme);
    this.renderControlStates();
    this.setBusyState();
  }

  private renderAssetRows(snapshot = this.assetDebug.snapshot(this.conditions)): void {
    const list = requireElement(this.element, "[data-asset-list]");
    const visible = snapshot.registrations.filter((registration) => this.matchesFilters(registration));
    list.innerHTML = visible.length === 0
      ? `<p class="asset-theme-empty">${snapshot.registeredCount === 0 ? "Load the illustrative manifest set to register assets." : "No assets match the current filters."}</p>`
      : visible.map(assetRow).join("");
  }

  private matchesFilters(registration: AssetDebugRegistration): boolean {
    const { entry, resolved, cached } = registration;
    const haystack = [entry.id, entry.type, entry.preloadGroup, entry.optionalGroup, ...entry.tags, resolved?.source]
      .filter((value) => value !== undefined && value !== null)
      .join(" ").toLowerCase();
    const typeMatches = this.typeFilter === "all" || entry.type === this.typeFilter;
    const stateMatches = this.stateFilter === "all"
      || (this.stateFilter === "cached" && cached)
      || (this.stateFilter === "unloaded" && !cached)
      || (this.stateFilter === "required" && entry.required)
      || (this.stateFilter === "optional" && !entry.required);
    return (!this.search || haystack.includes(this.search)) && typeMatches && stateMatches;
  }

  private renderThemeLayers(snapshot: ThemeDebugSnapshot): void {
    const list = requireElement(this.element, "[data-theme-layer-list]");
    const active = new Set(snapshot.appliedThemeIds.map(String));
    list.innerHTML = snapshot.registeredThemes.length === 0
      ? `<p class="asset-theme-empty">No themes registered.</p>`
      : snapshot.registeredThemes.map((theme) => `<article class="theme-layer-row" data-active="${active.has(String(theme.id))}">
          <span>${escapeHtml(theme.layer)}</span><strong>${escapeHtml(theme.name)}</strong><code>${escapeHtml(theme.id)}</code><small>v${escapeHtml(theme.version)}</small>
        </article>`).join("");
  }

  private renderControlStates(): void {
    setPressed(this.element, "quality-low", this.conditions.qualityTier === "low");
    setPressed(this.element, "quality-high", this.conditions.qualityTier === "high");
    setPressed(this.element, "orientation-portrait", this.conditions.orientation === "portrait");
    setPressed(this.element, "orientation-landscape", this.conditions.orientation === "landscape");
    setPressed(this.element, "locale-en", this.conditions.locale === "en");
    setPressed(this.element, "locale-es", this.conditions.locale.startsWith("es"));
    setPressed(this.element, "toggle-reduced-motion", this.conditions.reducedMotion);
    setPressed(this.element, "toggle-high-contrast", this.highContrastEnabled);
    setPressed(this.element, "toggle-operator", this.operatorEnabled);
    setPressed(this.element, "toggle-seasonal", this.seasonalEnabled);
  }

  private setBusyState(): void {
    this.element.setAttribute("aria-busy", String(this.busy));
    this.element.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")
      .forEach((control) => {
        if (control instanceof HTMLButtonElement && control.dataset.assetThemeAction === "cancel-preload") {
          control.disabled = this.preloadController === null;
        } else control.disabled = this.busy;
      });
  }
}

export function mountAssetThemeDebug(
  mount: HTMLElement,
  options?: AssetThemeDebugViewOptions,
): AssetThemeDebugView {
  return new AssetThemeDebugView(mount, options);
}

function workspaceMarkup(): string {
  return `
    <header class="asset-theme-header">
      <div><span>HUSTLE CORE</span><h2 id="asset-theme-workspace-title">Assets &amp; Themes</h2><p>Logical resources · deterministic variants · composable presentation tokens</p></div>
      <div class="asset-theme-filters">
        <label><span>Search</span><input data-asset-theme-search type="search" placeholder="Logical ID, type, group or tag" autocomplete="off"></label>
        <label><span>Type</span><select data-asset-theme-type-filter><option value="all">All asset types</option>${["image", "spritesheet", "animation-data", "font-reference", "json", "shader-reference", "video-reference", "binary", "other"].map((type) => `<option value="${type}">${type}</option>`).join("")}</select></label>
        <label><span>State</span><select data-asset-theme-state-filter><option value="all">All states</option><option value="cached">Cached</option><option value="unloaded">Unloaded</option><option value="required">Required</option><option value="optional">Optional</option></select></label>
      </div>
      <p class="asset-theme-status" data-asset-theme-value="status" data-tone="neutral" aria-live="polite"></p>
    </header>
    <div class="asset-theme-action-groups">
      ${actionGroup("Workspace", [["load-examples", "Load example manifests", "primary"], ["export-registry", "Export registry snapshot"], ["clear-cache", "Clear cache"], ["reset", "Reset workspace", "danger"]])}
      ${actionGroup("Preload", [["preload-bootstrap", "Preload bootstrap"], ["preload-base-game", "Preload base-game"], ["cancel-preload", "Cancel preload", "warning"]])}
      ${actionGroup("Conditions", [["quality-low", "Low quality"], ["quality-high", "High quality"], ["orientation-portrait", "Portrait"], ["orientation-landscape", "Landscape"], ["locale-en", "Locale EN"], ["locale-es", "Locale ES"], ["toggle-reduced-motion", "Reduced motion"]])}
      ${actionGroup("Theme", [["toggle-operator", "Operator override"], ["toggle-seasonal", "Seasonal override"], ["toggle-high-contrast", "High contrast"]])}
      ${actionGroup("Scenarios", [["optional-failure", "Optional failure"], ["required-failure", "Required failure"], ["timeout", "Timeout"], ["fallback", "Fallback"], ["invalid-theme-swap", "Invalid atomic swap"]])}
    </div>
    <div class="asset-theme-metrics" aria-label="Asset and theme runtime summary">
      ${metric("Registered", "registered-count")}${metric("Loaded", "loaded-count")}${metric("Estimated cache", "cache-bytes")}${metric("Resolved tokens", "token-count")}
    </div>
    <div class="asset-theme-layout">
      <section class="asset-theme-assets" aria-labelledby="asset-list-title">
        <h3 id="asset-list-title">Registered logical assets</h3>
        <div class="asset-list" data-asset-list></div>
      </section>
      <div class="asset-theme-inspection">
        ${inspection("Runtime conditions", "conditions", "Externally supplied asset runtime conditions")}
        ${inspection("Loader progress", "progress", "Current loader progress")}
        <article><h3>Active theme composition</h3><div class="theme-layer-list" data-theme-layer-list></div><pre data-theme-value="composition" data-asset-theme-value="composition" tabindex="0" aria-label="Active theme composition"></pre></article>
        ${inspection("Resolved tokens", "tokens", "Resolved theme tokens", "theme-token-panel")}
        ${inspection("Asset aliases", "aliases", "Resolved theme asset aliases")}
        ${inspection("Latest asset and theme events", "events", "Latest asset and theme events")}
        ${inspection("Warnings", "warnings", "Asset and theme warnings")}
        ${inspection("Errors", "errors", "Asset and theme errors", "asset-theme-error-panel")}
        ${inspection("Scenario result", "scenario", "Latest infrastructure scenario result")}
        ${inspection("Raw manifest data", "raw", "Raw manifest and resolved composition data")}
      </div>
    </div>`;
}

function actionGroup(
  label: string,
  actions: readonly (readonly [string, string, string?])[],
): string {
  return `<div class="asset-theme-action-group" role="group" aria-label="${escapeHtml(label)} controls"><span>${escapeHtml(label)}</span><div>${actions.map(([action, text, tone]) => `<button data-asset-theme-action="${action}" class="${tone ? `asset-theme-action-${tone}` : ""}">${escapeHtml(text)}</button>`).join("")}</div></div>`;
}

function metric(label: string, key: string): string {
  return `<div><span>${label}</span><strong data-asset-theme-value="${key}">0</strong></div>`;
}

function inspection(title: string, key: string, label: string, className = ""): string {
  return `<article class="${className}"><h3>${title}</h3><pre data-asset-theme-value="${key}" tabindex="0" aria-label="${label}"></pre></article>`;
}

function assetRow(registration: AssetDebugRegistration): string {
  const { entry, resolved } = registration;
  const group = entry.preloadGroup ?? entry.optionalGroup ?? "on-demand";
  const variant = resolved?.variantId ?? "base";
  const source = resolved?.source ?? "Unresolved for current conditions";
  const bytes = resolved?.estimatedBytes ?? entry.estimatedBytes ?? 0;
  return `<article class="asset-runtime-row" data-asset-id="${escapeHtml(entry.id)}" data-cached="${registration.cached}">
    <div class="asset-runtime-heading"><div><span>${escapeHtml(entry.type)}</span><strong>${escapeHtml(entry.id)}</strong></div><b data-tone="${entry.required ? "required" : "optional"}">${entry.required ? "Required" : "Optional"}</b></div>
    <dl>
      ${definition("Resolved variant", String(variant), "resolved-source")}
      ${definition("Physical source", source, "physical-source")}
      ${definition("Preload group", group)}
      ${definition("Cache state", registration.cached ? "Cached" : "Not loaded", "cache-state")}
      ${definition("Estimated bytes", formatBytes(bytes))}
      ${definition("Reference count", String(registration.referenceCount), "ref-count")}
      ${definition("Last accessed", registration.lastAccess === null ? "Never" : `Sequence ${registration.lastAccess}`)}
    </dl>
    <div class="asset-tag-list">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
  </article>`;
}

function definition(label: string, value: string, key?: string): string {
  return `<div><dt>${label}</dt><dd${key ? ` data-asset-value="${key}"` : ""}>${escapeHtml(value)}</dd></div>`;
}

function formatConditions(conditions: AssetRuntimeConditions): string {
  return [
    `Platform: ${conditions.platform}`,
    `Viewport: ${conditions.viewportWidth} × ${conditions.viewportHeight}`,
    `Density: ${conditions.devicePixelRatio}x`,
    `Orientation: ${conditions.orientation}`,
    `Locale: ${conditions.locale}`,
    `Quality: ${conditions.qualityTier}`,
    `Memory: ${conditions.memoryTier}`,
    `Reduced motion: ${conditions.reducedMotion}`,
  ].join("\n");
}

function formatProgress(snapshot: AssetDebugSnapshot, last: AssetPreloadGroupResult | null): string {
  if (snapshot.progress) {
    const progress = snapshot.progress;
    return [
      `Group: ${progress.group}`,
      `Progress: ${progress.completedCount}/${progress.requestedCount} (${Math.round(progress.fraction * 100)}%)`,
      `Loaded: ${progress.loadedCount}`,
      `Required failures: ${progress.failedRequiredCount}`,
      `Optional failures: ${progress.failedOptionalCount}`,
      `Skipped: ${progress.skippedCount}`,
      `Current: ${progress.currentAssetId ?? "—"}`,
    ].join("\n");
  }
  if (last) {
    return [
      `Last group: ${last.group}`,
      `Loaded: ${last.loadedCount}/${last.requestedCount}`,
      `Required failures: ${last.failedRequiredAssets.length}`,
      `Optional failures: ${last.failedOptionalAssets.length}`,
      `Skipped: ${last.skippedAssetIds.length}`,
      `Duration: ${Math.round(last.durationMs)} ms`,
      `Estimated bytes loaded: ${formatBytes(last.estimatedBytesLoaded)}`,
    ].join("\n");
  }
  return "No preload has run.";
}

function formatComposition(snapshot: ThemeDebugSnapshot): string {
  if (!snapshot.activeSelection) return "No active theme composition.";
  return [
    `Order: ${snapshot.appliedThemeIds.join(" → ")}`,
    `Hash: ${snapshot.activeHash}`,
    `Base: ${snapshot.activeSelection.base}`,
    `Game: ${snapshot.activeSelection.game ?? "—"}`,
    `Operator: ${snapshot.activeSelection.operator ?? "—"}`,
    `Seasonal: ${snapshot.activeSelection.seasonal ?? "—"}`,
    `Accessibility: ${snapshot.activeSelection.accessibility ?? "—"}`,
    `Conflicts reported: ${snapshot.conflicts.length}`,
  ].join("\n");
}

function formatEvents(assets: AssetDebugSnapshot, theme: ThemeDebugSnapshot): string {
  const assetLines = assets.latestEvents.slice(0, 12).map((event) => `A${event.sequence}  ${event.type}`);
  const themeLines = theme.latestEvents.slice(-12).reverse().map((event) => `T${event.sequence}  ${event.type}`);
  const lines = [...assetLines, ...themeLines];
  return lines.length > 0 ? lines.join("\n") : "No asset or theme events.";
}

function formatErrors(assets: AssetDebugSnapshot, theme: ThemeDebugSnapshot): string {
  const assetErrors = assets.latestErrors.map((error) => `[${error.code}] ${error.message}`);
  const themeErrors = theme.latestErrors.map((error) => `[${error.code}] ${error.path}: ${error.message}`);
  const errors = [...assetErrors, ...themeErrors];
  return errors.length > 0 ? errors.join("\n") : "No errors";
}

function setPressed(root: HTMLElement, action: string, value: boolean): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-asset-theme-action='${action}']`);
  button?.setAttribute("aria-pressed", String(value));
}

function setText(root: HTMLElement, key: string, value: string): void {
  const element = root.querySelector<HTMLElement>(`[data-asset-theme-value='${key}']`);
  if (element && element.textContent !== value) element.textContent = value;
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing Assets & Themes element ${selector}`);
  return element;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B est.`;
  if (value < 1_024 * 1_024) return `${Math.round(value / 102.4) / 10} KiB est.`;
  return `${Math.round(value / 104_857.6) / 10} MiB est.`;
}

function formatJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); }
  catch { return "[unserializable diagnostic data]"; }
}

function describeError(error: unknown): string {
  if (error instanceof AssetSystemError) return `[${error.code}] ${error.message}`;
  if (error instanceof ThemeSystemError) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function capitalize(value: string): string { return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`; }

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function abortablePause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new DOMException("Aborted", "AbortError")); return; }
    const timeout = window.setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = (): void => {
      window.clearTimeout(timeout);
      cleanup();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
  });
}
