import type { RouteResolution, RoutePreview } from "./route-types.js";

export function createRoutePreview(resolution: RouteResolution): RoutePreview {
  return { ...structuredClone(resolution), preview: true };
}
