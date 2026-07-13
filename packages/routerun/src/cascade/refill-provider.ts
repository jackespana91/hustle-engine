import { BoardError } from "../board/board-errors.js";
import type { RefillContent, RefillProvider, RefillRequest } from "./cascade-types.js";

export class SequenceRefillProvider implements RefillProvider {
  private cursor = 0;

  constructor(private readonly values: readonly (RefillContent | null)[]) {}

  next(_request: RefillRequest): RefillContent | null {
    if (this.cursor >= this.values.length) throw new BoardError("INVALID_CELL", "Deterministic refill data was exhausted", { cursor: this.cursor });
    const value = this.values[this.cursor] ?? null;
    this.cursor += 1;
    return value ? structuredClone(value) : null;
  }

  snapshot(): number { return this.cursor; }
}
