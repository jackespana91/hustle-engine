import { RouteRunEngine, type Coordinate, type Direction } from "@hustle/routerun";
import { getNightDropScenario } from "../board/night-drop-board.js";
import { renderEnvironmentArtwork, renderMaraArtwork, renderNightDropLogo } from "../presentation/artwork.js";
import { NIGHT_DROP_PRODUCTION_ASSETS } from "../presentation/asset-catalog.js";
import { applyNightDropTheme, createNightDropThemeRuntime } from "../theme/night-drop-theme.js";
import "./visual-reset.css";

const root = requiredElement<HTMLElement>("#app", document, "Night Drop visual reset requires #app");

const { theme } = createNightDropThemeRuntime();
applyNightDropTheme(document.documentElement, theme);

const showcaseScenario = getNightDropScenario("long-route");
const showcaseEngine = new RouteRunEngine();
showcaseEngine.initialize(showcaseScenario.board, showcaseScenario.runner, "night-drop:visual-baseline");
showcaseEngine.previewRoute();
const showcaseInspection = showcaseEngine.inspect();
const inspectedBoard = showcaseInspection.board;
const route = showcaseInspection.preview?.steps.map(({ coordinate }) => coordinate) ?? [];
if (!inspectedBoard || route.length < 9) throw new Error("Night Drop visual reset requires the deterministic showcase route");
const board = inspectedBoard;

const SPLIT_INDEX = 4;
const PACKAGE_INDICES = new Set([1, 2, 3, 5]);
const PREMIUM_PACKAGE_INDEX = 5;
const timers: number[] = [];
let running = false;
let dashIndex = 0;
let collectedPackages = 0;

root.innerHTML = renderShell();
const stage = requiredElement<HTMLElement>(".vr-stage", root, "Night Drop visual reset failed to mount the stage");
const boardElement = requiredElement<HTMLElement>(".vr-board", root, "Night Drop visual reset failed to mount the board");
const dash = requiredElement<HTMLImageElement>(".vr-dash", root, "Night Drop visual reset failed to mount Dash");
const playButton = requiredElement<HTMLButtonElement>(".vr-play", root, "Night Drop visual reset failed to mount Play");

playButton.addEventListener("click", startDemonstration);
window.addEventListener("resize", () => placeDash(dashIndex, false));
requestAnimationFrame(() => placeDash(0, false));

function renderShell(): string {
  return `<main class="vr-stage" data-phase="idle" data-route-phase="hidden" aria-label="Night Drop visual reset design spike">
    <div class="vr-world" aria-hidden="true">
      ${renderEnvironmentArtwork("stage")}
      <div class="vr-world-grade"></div>
      <div class="vr-rail-light"></div>
      <div class="vr-rain">${Array.from({ length: 24 }, (_, index) => `<i style="--rain-i:${index}"></i>`).join("")}</div>
      <div class="vr-foreground vr-foreground-left"></div>
      <div class="vr-foreground vr-foreground-right"></div>
    </div>

    <header class="vr-top-hud">
      <div class="vr-logo">${renderNightDropLogo()}</div>
      <div class="vr-status vr-stars"><span>Five-Star</span><strong data-five-star>☆☆☆☆☆</strong></div>
      <div class="vr-status"><span>Priority</span><strong><b data-priority>0</b>/3</strong></div>
      <div class="vr-status vr-multiplier"><span>Route</span><strong data-multiplier>1.0×</strong></div>
    </header>

    <section class="vr-playfield">
      <aside class="vr-mara" aria-live="polite" aria-hidden="true">
        <span>${renderMaraArtwork("route-preview")}</span>
        <p>Route locked.</p>
      </aside>

      <section class="vr-board-shell" aria-label="5 by 5 miniature city">
        <div class="vr-board" role="grid">${board.cells.map((cell) => renderCell(cell.coordinate, cell.state)).join("")}</div>
        <img class="vr-dash" src="${NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.idle}" alt="Dash, the Night Drop courier" draggable="false">
        <span class="vr-dash-shadow" aria-hidden="true"></span>
        <div class="vr-board-glass" aria-hidden="true"></div>
      </section>
    </section>

    <footer class="vr-bottom-hud">
      <div class="vr-money"><span>Balance</span><strong data-balance>£100.00</strong></div>
      <div class="vr-money"><span>Bet</span><strong>£1.00</strong></div>
      <div class="vr-money vr-win"><span>Win</span><strong data-win>£0.00</strong></div>
      <div class="vr-controls">
        <button class="vr-small" type="button"><i>☰</i><span>Menu</span></button>
        <button class="vr-small" type="button" disabled><i>↻</i><span>Auto</span></button>
        <button class="vr-play" type="button"><i>▶</i><strong>PLAY</strong></button>
        <button class="vr-small" type="button"><i>⚡</i><span>Turbo</span></button>
      </div>
    </footer>
  </main>`;
}

function renderCell(coordinate: Coordinate, state: string): string {
  const key = coordinateKey(coordinate);
  const routeIndex = route.findIndex((item) => coordinateKey(item) === key);
  const destination = routeIndex === route.length - 1;
  const sealed = state === "sealed";
  const kind = destination ? "destination" : sealed ? "sealed" : routeIndex >= 0 ? "street" : cityKind(coordinate);
  const packageType = PACKAGE_INDICES.has(routeIndex) ? (routeIndex === PREMIUM_PACKAGE_INDEX ? "premium" : "standard") : null;
  const initialDirections = traceDirections(routeIndex, "initial");
  const continuationDirections = traceDirections(routeIndex, "continuation");
  const roadDirections = [...new Set([...initialDirections, ...continuationDirections])];

  return `<article class="vr-cell" role="gridcell" data-key="${key}" data-kind="${kind}" data-route-index="${routeIndex}" data-sealed="${sealed}" style="--cell-i:${coordinate.row * 5 + coordinate.column};--route-i:${Math.max(0, routeIndex)}">
    <div class="vr-cell-depth"></div>
    <div class="vr-city-surface">
      ${kind === "street" ? `<div class="vr-street-material"><i class="vr-road-core"></i>${roadDirections.map((direction) => `<i class="vr-road-arm vr-road-${direction}"></i>`).join("")}<b class="vr-road-markings"></b></div>` : ""}
      ${kind === "roof" ? `<div class="vr-rooftop"><i></i><i></i><b></b></div>` : ""}
      ${kind === "alley" ? `<div class="vr-alley"><i></i><b></b><em></em></div>` : ""}
      ${kind === "shop" ? `<div class="vr-shop"><i></i><b></b><em></em></div>` : ""}
      ${kind === "fire-escape" ? `<div class="vr-building"><i></i><i></i><b></b><em></em></div>` : ""}
      ${kind === "sealed" ? `<div class="vr-sealed"><span class="vr-shutter"></span><i class="vr-padlock">⌑</i><b class="vr-caution"></b></div>` : ""}
      ${destination ? renderDestination() : ""}
    </div>
    ${routeIndex >= 0 ? `${renderTrace(initialDirections, "initial")}${renderTrace(continuationDirections, "continuation")}` : ""}
    ${routeIndex === 0 ? `<span class="vr-start-marker" aria-hidden="true"></span>` : ""}
    ${routeIndex === SPLIT_INDEX ? renderLegStop() : ""}
    ${packageType ? renderParcel(packageType, routeIndex) : ""}
    ${nextArrow(routeIndex)}
  </article>`;
}

function renderTrace(directions: readonly Direction[], leg: "initial" | "continuation"): string {
  if (directions.length === 0) return "";
  return `<div class="vr-trace" data-leg="${leg}" aria-hidden="true"><i class="vr-trace-core"></i>${directions.map((direction) => `<i class="vr-trace-${direction}"></i>`).join("")}<b></b></div>`;
}

function renderParcel(type: "standard" | "premium", routeIndex: number): string {
  return `<div class="vr-parcel" data-package-index="${routeIndex}" data-package-type="${type}" aria-label="${type === "premium" ? "Premium package" : "Package"}">
    <i class="vr-parcel-top"></i><i class="vr-parcel-front"></i><i class="vr-parcel-side"></i><b>${type === "premium" ? "★" : ""}</b>
  </div>`;
}

function renderDestination(): string {
  return `<div class="vr-destination" aria-label="Lit penthouse destination">
    <div class="vr-penthouse-roof">
      <div class="vr-penthouse-suite">${Array.from({ length: 6 }, () => "<i></i>").join("")}<b></b></div>
      <span class="vr-landing-pad">24</span>
      <em class="vr-beacon"></em>
    </div>
    <strong>FINAL ADDRESS</strong>
    <small>2401</small>
  </div>`;
}

function renderLegStop(): string {
  return `<div class="vr-leg-stop" aria-label="Current route ends at next drop">
    <span class="vr-arrival-ring" aria-hidden="true"></span>
    <em class="vr-delivery-marker" aria-hidden="true"><i></i></em>
    <b>NEXT DROP</b>
  </div>`;
}

function traceDirections(index: number, leg: "initial" | "continuation"): readonly Direction[] {
  if (index < 0) return [];
  const directions: Direction[] = [];
  const previous = route[index - 1];
  const current = route[index];
  const next = route[index + 1];
  if (!current) return directions;
  if (previous && ((leg === "initial" && index <= SPLIT_INDEX) || (leg === "continuation" && index > SPLIT_INDEX))) {
    directions.push(directionBetween(current, previous));
  }
  if (next && ((leg === "initial" && index < SPLIT_INDEX) || (leg === "continuation" && index >= SPLIT_INDEX))) {
    directions.push(directionBetween(current, next));
  }
  return directions;
}

function nextArrow(index: number): string {
  const current = route[index];
  const next = route[index + 1];
  if (!current || !next) return "";
  const leg = index < SPLIT_INDEX ? "initial" : "continuation";
  return `<span class="vr-route-arrow" data-leg="${leg}" data-direction="${directionBetween(current, next)}" aria-hidden="true">➜</span>`;
}

function startDemonstration(): void {
  if (running) return;
  clearTimers();
  resetDemonstration();
  running = true;
  playButton.disabled = true;
  stage.dataset.phase = "settling";
  setText("[data-balance]", "£99.00");

  schedule(200, () => stage.dataset.phase = "tiles-arriving");
  schedule(700, () => stage.dataset.phase = "package-react");
  schedule(1_000, () => {
    stage.dataset.phase = "route-preview";
    stage.dataset.routePhase = "initial";
    showMara("Route locked.");
  });
  schedule(1_700, () => {
    stage.dataset.phase = "dash-anticipation";
    dash.classList.add("is-anticipating");
  });

  [1, 2, 3, 4].forEach((index, step) => schedule(2_000 + step * 900, () => moveDash(index)));
  schedule(5_600, clearTravelledStreets);
  schedule(6_200, () => stage.dataset.phase = "compacting");
  schedule(6_800, refillStreets);
  schedule(7_500, () => {
    stage.dataset.phase = "continuation-preview";
    stage.dataset.routePhase = "continuation";
  });
  [5, 6, 7, 8].forEach((index, step) => schedule(8_000 + step * 1_000, () => moveDash(index)));
  schedule(11_200, () => {
    stage.dataset.phase = "destination-lit";
    stage.classList.add("destination-active");
    showMara("Address confirmed.");
  });
  schedule(12_000, resolveDelivery);
  schedule(13_000, () => {
    stage.dataset.phase = "resolved";
    hideMara();
    running = false;
    playButton.disabled = false;
    dash.classList.remove("is-moving", "is-anticipating");
    dash.src = NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.idle;
  });
}

function resetDemonstration(): void {
  stage.dataset.phase = "idle";
  stage.dataset.routePhase = "hidden";
  stage.classList.remove("destination-active");
  boardElement.querySelectorAll<HTMLElement>(".vr-cell").forEach((cell) => {
    delete cell.dataset.visited;
    delete cell.dataset.cleared;
    delete cell.dataset.refilled;
    delete cell.dataset.next;
  });
  boardElement.querySelectorAll<HTMLElement>(".vr-parcel").forEach((parcel) => delete parcel.dataset.collected);
  dash.src = NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.idle;
  dash.classList.remove("is-moving", "is-anticipating");
  collectedPackages = 0;
  dashIndex = 0;
  placeDash(0, false);
  hideMara();
  setText("[data-win]", "£0.00");
  setText("[data-five-star]", "☆☆☆☆☆");
  setText("[data-priority]", "0");
  setText("[data-multiplier]", "1.0×");
}

function moveDash(index: number): void {
  dashIndex = index;
  stage.dataset.phase = index <= SPLIT_INDEX ? "initial-run" : "continuation-run";
  dash.classList.remove("is-anticipating");
  dash.classList.add("is-moving");
  dash.src = NIGHT_DROP_PRODUCTION_ASSETS.characters.dash.run;
  placeDash(index, true);

  boardElement.querySelectorAll<HTMLElement>(".vr-cell").forEach((cell) => delete cell.dataset.next);
  const current = boardElement.querySelector<HTMLElement>(`[data-key="${coordinateKey(route[index]!)}"]`);
  const next = route[index + 1] ? boardElement.querySelector<HTMLElement>(`[data-key="${coordinateKey(route[index + 1]!)}"]`) : null;
  if (current) current.dataset.visited = "true";
  if (next) next.dataset.next = "true";

  const parcel = current?.querySelector<HTMLElement>(".vr-parcel");
  if (parcel && parcel.dataset.collected !== "true") {
    parcel.dataset.collected = "true";
    collectedPackages += 1;
    updateProgress(parcel.dataset.packageType === "premium");
  }
}

function placeDash(index: number, animate: boolean): void {
  const coordinate = route[index];
  if (!coordinate) return;
  const target = boardElement.querySelector<HTMLElement>(`[data-key="${coordinateKey(coordinate)}"]`);
  if (!target) return;
  const boardRect = boardElement.getBoundingClientRect();
  const cellRect = target.getBoundingClientRect();
  dash.style.setProperty("--dash-x", `${cellRect.left - boardRect.left + cellRect.width / 2}px`);
  dash.style.setProperty("--dash-y", `${cellRect.top - boardRect.top + cellRect.height * .82}px`);
  dash.dataset.animate = String(animate);
  const next = route[index + 1];
  dash.dataset.direction = next ? directionBetween(coordinate, next) : dash.dataset.direction ?? "north";

  const shadow = root.querySelector<HTMLElement>(".vr-dash-shadow");
  shadow?.style.setProperty("--dash-x", dash.style.getPropertyValue("--dash-x"));
  shadow?.style.setProperty("--dash-y", dash.style.getPropertyValue("--dash-y"));
}

function clearTravelledStreets(): void {
  stage.dataset.phase = "clearing";
  boardElement.querySelectorAll<HTMLElement>(".vr-cell[data-visited='true']").forEach((cell) => cell.dataset.cleared = "true");
}

function refillStreets(): void {
  stage.dataset.phase = "refilling";
  boardElement.querySelectorAll<HTMLElement>(".vr-cell[data-cleared='true']").forEach((cell) => {
    cell.dataset.refilled = "true";
    delete cell.dataset.cleared;
  });
}

function resolveDelivery(): void {
  stage.dataset.phase = "delivery-resolved";
  setText("[data-win]", "£24.00");
  setText("[data-multiplier]", "24.0×");
}

function updateProgress(premium: boolean): void {
  const lit = Math.min(5, collectedPackages);
  setText("[data-five-star]", `${"★".repeat(lit)}${"☆".repeat(5 - lit)}`);
  setText("[data-multiplier]", `${[1, 2, 5, 12, 24][lit] ?? 24}.0×`);
  if (premium) setText("[data-priority]", "1");
}

function showMara(message: string): void {
  const card = root.querySelector<HTMLElement>(".vr-mara");
  const text = card?.querySelector("p");
  if (text) text.textContent = message;
  card?.setAttribute("aria-hidden", "false");
  schedule(1_800, hideMara);
}

function hideMara(): void {
  root.querySelector<HTMLElement>(".vr-mara")?.setAttribute("aria-hidden", "true");
}

function schedule(delay: number, action: () => void): void {
  timers.push(window.setTimeout(action, delay));
}

function clearTimers(): void {
  timers.splice(0).forEach((timer) => window.clearTimeout(timer));
}

function setText(selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function cityKind(coordinate: Coordinate): "roof" | "alley" | "shop" | "fire-escape" {
  const kinds = ["roof", "alley", "shop", "fire-escape"] as const;
  return kinds[(coordinate.row * 3 + coordinate.column * 5) % kinds.length]!;
}

function directionBetween(from: Coordinate, to: Coordinate): Direction {
  if (to.row < from.row) return "north";
  if (to.row > from.row) return "south";
  if (to.column < from.column) return "west";
  return "east";
}

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row}:${coordinate.column}`;
}

function requiredElement<T extends Element>(selector: string, parent: ParentNode, message: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(message);
  return element;
}
