import { coordinateKey, moveCoordinate, oppositeDirection, type Coordinate, type Direction } from "../board/board-types.js";
import type { BoardModel } from "../board/board-model.js";
import { acceptsEntry, hasReciprocalConnection, legalExits } from "../tiles/tile-connections.js";
import { resolveJunction } from "./junction-resolver.js";
import { RouteError } from "./route-errors.js";
import type { RouteDecision, RouteResolution, RouteSolverOptions, RouteStep, RouteTerminalReason } from "./route-types.js";
import type { RunnerState } from "../runner/runner-types.js";

export class RouteSolver {
  constructor(private readonly board: BoardModel) {}

  resolve(runner: RunnerState, options: RouteSolverOptions = {}): RouteResolution {
    if (!this.board.isInside(runner.currentCoordinate)) throw new RouteError("INVALID_RUNNER", "Runner is outside the board");
    const maximumSteps = options.maximumSteps ?? 256;
    if (!Number.isSafeInteger(maximumSteps) || maximumSteps <= 0) throw new RouteError("INVALID_ROUTE", "Maximum route steps must be a positive safe integer");
    const steps: RouteStep[] = [];
    const decisions: RouteDecision[] = [];
    const visitedCells = new Set(runner.visitedCellIds);
    let coordinate: Coordinate = structuredClone(runner.currentCoordinate);
    let enteredFrom: Direction | null = runner.entryDirection;
    let cumulative = runner.accumulatedPresentationValue;
    let terminal: RouteTerminalReason = "failed";
    let terminalCoordinate = structuredClone(coordinate);

    while (true) {
      const cell = this.board.cellAt(coordinate);
      terminalCoordinate = structuredClone(coordinate);
      if (!cell) { terminal = "board-exit"; break; }
      if (cell.state === "sealed") { terminal = "sealed-boundary"; break; }
      if (cell.state === "blocked" || cell.tile?.family === "blocker") { terminal = "blocker"; break; }
      if (visitedCells.has(cell.id)) { terminal = "loop-detected"; break; }
      const tile = cell.tile;
      if (!tile || tile.family === "empty" || cell.state === "empty") { terminal = "dead-end"; break; }
      if (enteredFrom && !acceptsEntry(tile, enteredFrom)) { terminal = "invalid-connection"; break; }
      visitedCells.add(cell.id);
      cumulative += cell.overlays.filter((overlay) => overlay.collectable && !runner.collectedOverlayIds.includes(overlay.id)).reduce((sum, overlay) => sum + (overlay.valueMinor ?? 0), 0);

      const destinationReached = tile.family === "destination" || cell.destination !== undefined ||
        this.board.destinationPositions.some((destination) => coordinateKey(destination) === coordinateKey(coordinate));
      if (destinationReached) {
        steps.push(createStep(steps.length, cell, enteredFrom, null, cumulative, options.startingLogicalTick ?? 0));
        terminal = "destination-reached";
        break;
      }

      const exits = legalExits(tile, enteredFrom);
      if (exits.length === 0) {
        steps.push(createStep(steps.length, cell, enteredFrom, null, cumulative, options.startingLogicalTick ?? 0));
        terminal = "dead-end";
        break;
      }
      const decision = resolveJunction({
        coordinate,
        legalExits: exits,
        ...(options.junctionInstructions ? { instructions: options.junctionInstructions } : {}),
        ...(options.fallbackPriority ? { fallbackPriority: options.fallbackPriority } : {}),
        ...(options.allowFallback === undefined ? {} : { allowFallback: options.allowFallback }),
      });
      if (exits.length > 1 || decision.reason === "explicit") decisions.push(decision);
      const direction = decision.chosen;
      steps.push(createStep(steps.length, cell, enteredFrom, direction, cumulative, options.startingLogicalTick ?? 0));
      if (steps.length >= maximumSteps) { terminal = "maximum-step-limit"; break; }

      const nextCoordinate = moveCoordinate(coordinate, direction);
      if (!this.board.isInside(nextCoordinate)) { terminal = "board-exit"; break; }
      const next = this.board.cellAt(nextCoordinate);
      if (!next) { terminal = "board-exit"; break; }
      if (next.state === "sealed") { terminal = "sealed-boundary"; terminalCoordinate = nextCoordinate; break; }
      if (next.state === "blocked" || next.tile?.family === "blocker") { terminal = "blocker"; terminalCoordinate = nextCoordinate; break; }
      if (!next.tile || next.state === "empty" || !hasReciprocalConnection(tile, direction, next.tile)) {
        terminal = "invalid-connection"; terminalCoordinate = nextCoordinate; break;
      }
      if (visitedCells.has(next.id)) { terminal = "loop-detected"; terminalCoordinate = nextCoordinate; break; }
      coordinate = nextCoordinate;
      enteredFrom = oppositeDirection(direction);
    }
    const logicalTick = (options.startingLogicalTick ?? 0) + steps.length;
    return {
      runnerId: runner.id,
      steps,
      decisions,
      terminalReason: terminal,
      terminalCoordinate,
      deterministicSignature: routeSignature(steps, decisions, terminal),
      logicalTick,
      warnings: [],
    };
  }
}

function createStep(
  sequence: number,
  cell: ReturnType<BoardModel["requireCell"]>,
  enteredFrom: Direction | null,
  exitedTo: Direction | null,
  cumulativePresentationValue: number,
  startingLogicalTick: number,
): RouteStep {
  return {
    sequence,
    coordinate: structuredClone(cell.coordinate),
    cellId: cell.id,
    tileId: cell.tile?.id ?? cell.id,
    enteredFrom,
    exitedTo,
    collectedOverlayIds: cell.overlays.filter(({ collectable }) => collectable).map(({ id }) => id),
    destinationReached: cell.tile?.family === "destination" || cell.destination !== undefined,
    cumulativePresentationValue,
    logicalTick: startingLogicalTick + sequence + 1,
    metadata: {},
  };
}

function routeSignature(steps: readonly RouteStep[], decisions: readonly RouteDecision[], terminal: RouteTerminalReason): string {
  return JSON.stringify({
    steps: steps.map((step) => [coordinateKey(step.coordinate), step.enteredFrom, step.exitedTo, step.tileId]),
    decisions: decisions.map((decision) => [coordinateKey(decision.coordinate), decision.chosen, decision.reason]),
    terminal,
  });
}
