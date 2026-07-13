import type { RouteOverlay } from "../overlays/overlay-types.js";
import type { RouteTile } from "../tiles/tile-types.js";
import type { BoardCell, BoardDefinition, CellState, Coordinate, DestinationData, GravityDirection, RouteRunMetadata } from "./board-types.js";
import { coordinateKey } from "./board-types.js";
import { assertValidBoard } from "./board-validator.js";

export interface BoardBuilderOptions {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly gravity?: GravityDirection;
  readonly maximumCascadeCount?: number;
  readonly metadata?: RouteRunMetadata;
  readonly defaultCellState?: CellState;
}

export class BoardBuilder {
  private readonly cells = new Map<string, BoardCell>();
  private readonly entries: Coordinate[] = [];
  private readonly destinations: Coordinate[] = [];

  constructor(private readonly options: BoardBuilderOptions) {
    for (let row = 0; row < options.height; row += 1) {
      for (let column = 0; column < options.width; column += 1) {
        const coordinate = { row, column };
        this.cells.set(coordinateKey(coordinate), {
          id: `cell-${row}-${column}`,
          coordinate,
          state: options.defaultCellState ?? "empty",
          overlays: [],
          metadata: {},
        });
      }
    }
  }

  setCell(
    coordinate: Coordinate,
    values: Partial<Omit<BoardCell, "coordinate">> & {
      readonly tile?: RouteTile;
      readonly overlays?: readonly RouteOverlay[];
      readonly destination?: DestinationData;
    },
  ): this {
    const previous = this.cells.get(coordinateKey(coordinate));
    const cell: BoardCell = {
      id: values.id ?? previous?.id ?? `cell-${coordinate.row}-${coordinate.column}`,
      coordinate: structuredClone(coordinate),
      state: values.state ?? (values.tile ? "active" : previous?.state ?? "empty"),
      ...(values.tile === undefined ? (previous?.tile ? { tile: previous.tile } : {}) : { tile: structuredClone(values.tile) }),
      overlays: structuredClone(values.overlays ?? previous?.overlays ?? []),
      ...(values.destination === undefined ? (previous?.destination ? { destination: previous.destination } : {}) : { destination: structuredClone(values.destination) }),
      metadata: structuredClone(values.metadata ?? previous?.metadata ?? {}),
    };
    this.cells.set(coordinateKey(coordinate), cell);
    return this;
  }

  setState(coordinate: Coordinate, state: CellState): this { return this.setCell(coordinate, { state }); }
  setTile(coordinate: Coordinate, tile: RouteTile, overlays: readonly RouteOverlay[] = []): this {
    return this.setCell(coordinate, { state: "active", tile, overlays });
  }

  addEntry(coordinate: Coordinate): this {
    this.entries.push(structuredClone(coordinate));
    return this;
  }

  addDestination(coordinate: Coordinate, destination?: DestinationData): this {
    this.destinations.push(structuredClone(coordinate));
    if (destination) this.setCell(coordinate, { destination });
    return this;
  }

  build(validateConnections = true): BoardDefinition {
    const definition: BoardDefinition = {
      id: this.options.id,
      width: this.options.width,
      height: this.options.height,
      cells: [...this.cells.values()].sort((left, right) => left.coordinate.row - right.coordinate.row || left.coordinate.column - right.coordinate.column),
      entryPositions: structuredClone(this.entries),
      destinationPositions: structuredClone(this.destinations),
      gravity: this.options.gravity ?? "down",
      maximumCascadeCount: this.options.maximumCascadeCount ?? 8,
      metadata: structuredClone(this.options.metadata ?? {}),
    };
    assertValidBoard(definition, { validateConnections });
    return definition;
  }
}
