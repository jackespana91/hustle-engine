import { BoardError } from "./board-errors.js";
import { coordinateKey, type BoardCell, type BoardDefinition, type Coordinate } from "./board-types.js";
import { assertValidBoard } from "./board-validator.js";

export class BoardModel {
  private readonly definition: BoardDefinition;
  private readonly cellsByCoordinate = new Map<string, BoardCell>();
  private readonly cellsById = new Map<string, BoardCell>();

  constructor(definition: BoardDefinition, validateConnections = true) {
    assertValidBoard(definition, { validateConnections });
    this.definition = structuredClone(definition);
    for (const cell of this.definition.cells) {
      this.cellsByCoordinate.set(coordinateKey(cell.coordinate), cell);
      this.cellsById.set(cell.id, cell);
    }
  }

  get id(): string { return this.definition.id; }
  get width(): number { return this.definition.width; }
  get height(): number { return this.definition.height; }
  get gravity(): BoardDefinition["gravity"] { return this.definition.gravity; }
  get maximumCascadeCount(): number { return this.definition.maximumCascadeCount; }
  get cells(): readonly BoardCell[] { return structuredClone(this.definition.cells); }
  get entryPositions(): readonly Coordinate[] { return structuredClone(this.definition.entryPositions); }
  get destinationPositions(): readonly Coordinate[] { return structuredClone(this.definition.destinationPositions); }
  get metadata(): BoardDefinition["metadata"] { return structuredClone(this.definition.metadata); }

  has(coordinate: Coordinate): boolean { return this.cellsByCoordinate.has(coordinateKey(coordinate)); }

  isInside(coordinate: Coordinate): boolean {
    return coordinate.row >= 0 && coordinate.column >= 0 &&
      coordinate.row < this.height && coordinate.column < this.width;
  }

  cellAt(coordinate: Coordinate): BoardCell | undefined {
    const cell = this.cellsByCoordinate.get(coordinateKey(coordinate));
    return cell ? structuredClone(cell) : undefined;
  }

  requireCell(coordinate: Coordinate): BoardCell {
    const cell = this.cellAt(coordinate);
    if (!cell) throw new BoardError("MISSING_CELL", `Board ${this.id} has no cell at ${coordinateKey(coordinate)}`);
    return cell;
  }

  cellById(id: string): BoardCell | undefined {
    const cell = this.cellsById.get(id);
    return cell ? structuredClone(cell) : undefined;
  }

  withCells(cells: readonly BoardCell[], options: { readonly validateConnections?: boolean } = {}): BoardModel {
    return new BoardModel({ ...this.toDefinition(), cells: structuredClone(cells) }, options.validateConnections ?? true);
  }

  withDefinition(definition: BoardDefinition, validateConnections = true): BoardModel {
    return new BoardModel(definition, validateConnections);
  }

  toDefinition(): BoardDefinition { return structuredClone(this.definition); }
}
