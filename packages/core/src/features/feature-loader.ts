import type { FeatureRegistrationInput } from "./feature-registry.js";
import { FeatureRegistry } from "./feature-registry.js";

export type FeatureSource =
  | FeatureRegistrationInput
  | (() => FeatureRegistrationInput | Promise<FeatureRegistrationInput>);

/** Resolves implementation/manifest pairs without making module loading order observable. */
export class FeatureLoader {
  async load(registry: FeatureRegistry, sources: readonly FeatureSource[]): Promise<readonly FeatureRegistrationInput[]> {
    const loaded: FeatureRegistrationInput[] = [];
    for (const source of sources) loaded.push(typeof source === "function" ? await source() : source);
    registry.registerMany(loaded);
    return loaded;
  }
}
