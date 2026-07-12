import type { Feature } from "./contracts.js";
import { FeatureRegistry } from "./registry.js";

export type FeatureSource = Feature | (() => Feature | Promise<Feature>);

export class FeatureLoader {
  async load(registry: FeatureRegistry, sources: readonly FeatureSource[]): Promise<readonly Feature[]> {
    const loaded: Feature[] = [];
    for (const source of sources) {
      const feature = typeof source === "function" ? await source() : source;
      registry.register(feature);
      loaded.push(feature);
    }
    registry.validateDependencies();
    return loaded;
  }
}
