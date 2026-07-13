import type { RouteOverlay } from "./overlay-types.js";

export class OverlayRegistry {
  private readonly overlays = new Map<string, RouteOverlay>();

  register(overlay: RouteOverlay): void {
    if (this.overlays.has(overlay.id)) throw new Error(`Duplicate overlay ${overlay.id}`);
    this.overlays.set(overlay.id, structuredClone(overlay));
  }

  get(id: string): RouteOverlay | undefined {
    const overlay = this.overlays.get(id);
    return overlay ? structuredClone(overlay) : undefined;
  }

  list(): readonly RouteOverlay[] {
    return [...this.overlays.values()].map((overlay) => structuredClone(overlay));
  }
}
