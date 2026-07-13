import {
  ManifestRegistry,
  ManifestSerializer,
  ManifestSystemError,
  ManifestValidator,
  NIGHT_DROP_EXAMPLE_MANIFESTS,
  NIGHT_DROP_GAME_MANIFEST_EXAMPLE,
  conflictingFeatureExample,
  malformedManifestExample,
  missingDependencyExample,
  type CompatibilityReport,
  type HustleManifest,
  type ManifestValidationError,
  type ResolvedGameComposition,
} from "@hustle/core";

export interface ManifestDebugOptions {
  readonly onEvent?: (name: string, payload: unknown) => void;
}

export class ManifestDebugView {
  readonly registry = new ManifestRegistry();
  private readonly serializer = new ManifestSerializer();
  private readonly validator = new ManifestValidator();
  private readonly root: HTMLElement;
  private selectedId: string | null = null;
  private errors: readonly ManifestValidationError[] = [];
  private warnings: readonly string[] = [];
  private composition: ResolvedGameComposition | null = null;
  private compatibility: CompatibilityReport | null = null;
  private rawJson = "No manifest selected or exported.";
  private message = "Ready";

  constructor(mount: HTMLElement, private readonly options: ManifestDebugOptions = {}) {
    this.root = document.createElement("section");
    this.root.className = "manifest-debug";
    this.root.setAttribute("aria-labelledby", "manifest-debug-title");
    this.root.innerHTML = markup();
    mount.append(this.root);
    this.registry.events.subscribe("manifest:registered", (payload) => this.emit("manifest:registered", payload));
    this.registry.events.subscribe("manifest:removed", (payload) => this.emit("manifest:removed", payload));
    this.registry.events.subscribe("manifest:reloaded", (payload) => this.emit("manifest:reloaded", payload));
    this.registry.events.subscribe("manifest:validation-failed", (payload) => this.emit("manifest:validation-failed", payload));
    this.registry.events.subscribe("manifest:composition-resolved", (payload) => this.emit("manifest:composition-resolved", payload));
    this.registry.events.subscribe("manifest:composition-failed", (payload) => this.emit("manifest:composition-failed", payload));
    this.bind(); this.render();
  }

  private bind(): void {
    this.root.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-manifest-action]")?.dataset.manifestAction;
      if (action) this.perform(action);
      const row = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-manifest-id]");
      if (row?.dataset.manifestId) { this.selectedId = row.dataset.manifestId; this.rawJson = pretty(this.registry.get(this.selectedId)); this.render(); }
    });
  }

  private perform(action: string): void {
    try {
      if (action === "load-valid") this.loadValid();
      else if (action === "load-malformed") this.validateScenario([malformedManifestExample()], "Malformed example rejected");
      else if (action === "load-missing") this.validateScenario(missingDependencyExample(), "Missing dependency example rejected");
      else if (action === "load-conflict") this.validateScenario(conflictingFeatureExample(), "Conflicting feature example rejected");
      else if (action === "clear") this.clear();
      else if (action === "export") this.exportSnapshot();
      else if (action === "resolve") this.resolve();
    } catch (error) { this.capture(error); }
    this.render();
  }

  private loadValid(): void {
    this.registry.clear(); this.registry.registerMany(NIGHT_DROP_EXAMPLE_MANIFESTS);
    this.errors = []; this.warnings = []; this.composition = null; this.compatibility = null;
    this.selectedId = NIGHT_DROP_GAME_MANIFEST_EXAMPLE.id; this.rawJson = pretty(this.registry.get(this.selectedId));
    this.message = "Loaded valid illustrative Night Drop manifest set";
  }

  private validateScenario(inputs: readonly unknown[], message: string): void {
    const intrinsic = inputs.flatMap((input) => this.validator.validate(input).errors);
    if (intrinsic.length > 0) { this.errors = intrinsic; this.message = message; this.emit("manifest:validation-failed", { errors: intrinsic }); return; }
    const temporary = new ManifestRegistry();
    try { temporary.registerMany(inputs as readonly HustleManifest[]); this.errors = []; this.message = "Scenario unexpectedly validated"; }
    catch (error) { this.capture(error, message); }
  }

  private resolve(): void {
    const composition = this.registry.resolveGame(NIGHT_DROP_GAME_MANIFEST_EXAMPLE.id);
    this.composition = composition; this.compatibility = composition.compatibilityReport;
    this.warnings = composition.warnings; this.errors = []; this.rawJson = pretty(composition);
    this.message = "Illustrative Night Drop composition resolved";
  }

  private clear(): void {
    this.registry.clear(); this.selectedId = null; this.errors = []; this.warnings = [];
    this.composition = null; this.compatibility = null; this.rawJson = "Registry is empty"; this.message = "Registry cleared";
  }

  private exportSnapshot(): void {
    const json = this.serializer.serialize(this.registry.snapshot()); this.rawJson = json; this.message = "Registry snapshot exported";
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "hustle-manifest-registry.json"; link.hidden = true;
    document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 0);
  }

  private capture(error: unknown, message = "Manifest action failed"): void {
    this.errors = error instanceof ManifestSystemError ? error.errors : [];
    this.message = `${message}: ${error instanceof Error ? error.message : String(error)}`;
    if (this.errors.length > 0) this.emit("manifest:validation-failed", { errors: this.errors });
  }

  private render(): void {
    const list = requireNode(this.root, "[data-manifest-list]"); list.replaceChildren();
    for (const manifest of this.registry.list()) list.append(this.row(manifest));
    if (this.registry.list().length === 0) list.textContent = "No manifests registered.";
    setText(this.root, "status", this.message); setText(this.root, "errors", formatErrors(this.errors));
    setText(this.root, "warnings", this.warnings.length ? this.warnings.join("\n") : "No warnings");
    setText(this.root, "composition", this.composition ? formatComposition(this.composition) : "Not resolved");
    setText(this.root, "raw", this.rawJson);
  }

  private row(manifest: HustleManifest): HTMLButtonElement {
    const button = document.createElement("button"); button.className = "manifest-row";
    button.dataset.manifestId = manifest.id; button.setAttribute("aria-pressed", String(this.selectedId === manifest.id));
    const dependency = manifest.manifestType === "feature" ? manifest.dependencies.join(", ") || "None" : "None";
    const conflicts = manifest.manifestType === "feature" ? manifest.conflicts.join(", ") || "None" : "None";
    const compatibility = this.compatibility ? (this.compatibility.compatible ? "Composition: compatible" : "Composition: incompatible") : "Composition: not evaluated";
    button.innerHTML = `<span class="manifest-row-type">${escapeHtml(manifest.manifestType)}</span><strong>${escapeHtml(manifest.id)}</strong><small>v${escapeHtml(manifest.version)}</small><span class="manifest-badge">Validation: valid</span><span class="manifest-badge">${compatibility}</span><small>Dependencies: ${escapeHtml(dependency)}</small><small>Conflicts: ${escapeHtml(conflicts)}</small>`;
    return button;
  }

  private emit(name: string, payload: unknown): void { this.options.onEvent?.(name, payload); }
}

export function mountManifestDebug(mount: HTMLElement, options?: ManifestDebugOptions): ManifestDebugView {
  return new ManifestDebugView(mount, options);
}

function markup(): string {
  const button = (action: string, label: string) => `<button data-manifest-action="${action}">${label}</button>`;
  return `<header class="manifest-debug-header"><div><span>HUSTLE CORE</span><h2 id="manifest-debug-title">Manifest System</h2><p>Validated, versioned composition data · non-production examples</p></div><p data-manifest-value="status" aria-live="polite"></p></header>
    <div class="manifest-debug-actions">${button("load-valid", "Load valid Night Drop example")}${button("load-malformed", "Load malformed manifest")}${button("load-missing", "Load missing dependency example")}${button("load-conflict", "Load conflicting feature example")}${button("clear", "Clear registry")}${button("export", "Export registry snapshot")}${button("resolve", "Resolve game composition")}</div>
    <div class="manifest-debug-layout"><div><h3>Registered manifests</h3><div data-manifest-list class="manifest-list"></div></div>
    <div class="manifest-detail"><article><h3>Resolved composition</h3><pre data-manifest-value="composition" tabindex="0" aria-label="Resolved game composition"></pre></article><article><h3>Warnings</h3><pre data-manifest-value="warnings" tabindex="0"></pre></article><article class="manifest-errors"><h3>Errors</h3><pre data-manifest-value="errors" tabindex="0" role="alert"></pre></article><article><h3>Raw JSON</h3><pre data-manifest-value="raw" tabindex="0" aria-label="Raw manifest JSON"></pre></article></div></div>`;
}

function formatComposition(composition: ResolvedGameComposition): string {
  return [`Game: ${composition.game.id}`, `Engine: ${composition.engine.id}`, `Features: ${composition.features.map(({ id }) => id).join(" → ")}`, `Theme: ${composition.theme.id}`, `Audio: ${composition.audio.id}`, `Math: ${composition.mathProfile.id}`, `Assets: ${composition.assets.id}`, `Compatible: ${composition.compatibilityReport.compatible}`].join("\n");
}
function formatErrors(errors: readonly ManifestValidationError[]): string { return errors.length ? errors.map((error) => `[${error.code}] ${error.fieldPath}: ${error.message}`).join("\n") : "No errors"; }
function pretty(value: unknown): string { return value === undefined ? "Not found" : JSON.stringify(value, null, 2); }
function setText(root: HTMLElement, key: string, value: string): void { const node = root.querySelector<HTMLElement>(`[data-manifest-value='${key}']`); if (node) node.textContent = value; }
function requireNode(root: HTMLElement, selector: string): HTMLElement { const node = root.querySelector<HTMLElement>(selector); if (!node) throw new Error(`Missing manifest debug node ${selector}`); return node; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
