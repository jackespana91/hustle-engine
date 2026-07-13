import { BoardError } from "../board/board-errors.js";
import { createTile } from "./tile-rotation.js";
import type { RouteTile, TileRotation, TileTemplate } from "./tile-types.js";

export class TileRegistry {
  private readonly templates = new Map<string, TileTemplate>();

  register(template: TileTemplate): void {
    if (this.templates.has(template.id)) throw new BoardError("INVALID_CELL", `Duplicate tile template ${template.id}`);
    this.templates.set(template.id, structuredClone(template));
  }

  create(templateId: string, instanceId: string, rotation: TileRotation = 0): RouteTile {
    const template = this.templates.get(templateId);
    if (!template) throw new BoardError("INVALID_CELL", `Unknown tile template ${templateId}`);
    return createTile(template, rotation, instanceId);
  }

  list(): readonly TileTemplate[] {
    return [...this.templates.values()].map((template) => structuredClone(template));
  }
}

export const DIAGNOSTIC_TILE_TEMPLATES: readonly TileTemplate[] = [
  { id: "straight", family: "straight", baseConnections: ["north", "south"] },
  { id: "bend", family: "bend", baseConnections: ["north", "east"] },
  { id: "t-junction", family: "t-junction", baseConnections: ["north", "east", "west"] },
  { id: "cross-junction", family: "cross-junction", baseConnections: ["north", "east", "south", "west"] },
  { id: "one-way", family: "one-way", baseConnections: ["north", "south"], oneWay: { allowedEntrances: ["south"], allowedExits: ["north"] } },
  { id: "destination", family: "destination", baseConnections: ["south"], persistent: true, movable: false },
  { id: "entry", family: "entry", baseConnections: ["north"], persistent: true, movable: false },
  { id: "blocker", family: "blocker", baseConnections: [], persistent: true, movable: false },
  { id: "empty", family: "empty", baseConnections: [] },
];

export function createDiagnosticTileRegistry(): TileRegistry {
  const registry = new TileRegistry();
  DIAGNOSTIC_TILE_TEMPLATES.forEach((template) => registry.register(template));
  return registry;
}
