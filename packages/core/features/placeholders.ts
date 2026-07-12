import {
  featureId,
  type Feature,
  type FeatureContext,
  type FeatureId,
  type FeatureMetadata,
  type FeatureState,
} from "./contracts.js";

interface PlaceholderState extends FeatureState {
  readonly initialized: boolean;
  readonly triggerCount: number;
  readonly updateCount: number;
  readonly cleaned: boolean;
}

abstract class PlaceholderFeature implements Feature<PlaceholderState> {
  abstract readonly metadata: FeatureMetadata;
  protected state: PlaceholderState = { initialized: false, triggerCount: 0, updateCount: 0, cleaned: false };

  initialize(context: FeatureContext): void {
    this.state = { ...this.state, initialized: true, cleaned: false };
    context.emit("placeholder:initialized", { placeholder: true });
  }

  canTrigger(): boolean { return true; }

  trigger(context: FeatureContext): void {
    this.state = { ...this.state, triggerCount: this.state.triggerCount + 1 };
    context.emit("placeholder:triggered", { placeholder: true, triggerCount: this.state.triggerCount });
  }

  update(_context: FeatureContext, _deltaMs: number): void {
    this.state = { ...this.state, updateCount: this.state.updateCount + 1 };
  }

  serialize(): PlaceholderState { return { ...this.state }; }

  deserialize(state: PlaceholderState): void { this.state = { ...state }; }

  cleanup(context: FeatureContext): void {
    this.state = { ...this.state, cleaned: true };
    context.emit("placeholder:cleaned", { placeholder: true });
  }
}

function metadata(
  id: string,
  name: string,
  description: string,
  priority: number,
  engines: readonly string[],
  dependencies: readonly FeatureId[] = [],
): FeatureMetadata {
  return { id: featureId(id), name, version: "0.1.0-placeholder", description, supportedEngines: engines, dependencies, priority };
}

export class ShortcutFeature extends PlaceholderFeature {
  readonly metadata = metadata("shortcut", "Shortcut Feature", "Placeholder for reusable shortcut presentation hooks.", 90, ["routerun", "playground"]);
}
export class ClampFeature extends PlaceholderFeature {
  readonly metadata = metadata("clamp", "Clamp Feature", "Placeholder for reusable clamp presentation hooks.", 80, ["routerun", "playground"]);
}
export class FiveStarFeature extends PlaceholderFeature {
  readonly metadata = metadata("five-star", "Five Star Feature", "Placeholder for a reusable five-star feature contract.", 70, ["routerun", "playground"], [featureId("shortcut")]);
}
export class StickyWildFeature extends PlaceholderFeature {
  readonly metadata = metadata("sticky-wild", "Sticky Wild Feature", "Placeholder for persistent presentation-state hooks.", 60, ["routerun", "playground"]);
}
export class CollectorFeature extends PlaceholderFeature {
  readonly metadata = metadata("collector", "Collector Feature", "Placeholder for reusable collection-state hooks.", 50, ["routerun", "playground", "instant"]);
}
export class HoldAndWinFeature extends PlaceholderFeature {
  readonly metadata = metadata("hold-and-win", "Hold And Win Feature", "Placeholder for a reusable hold-and-win lifecycle contract.", 40, ["playground", "instant"], [featureId("collector")]);
}

export function createPlaceholderFeatures(): readonly Feature[] {
  return [
    new ShortcutFeature(), new ClampFeature(), new FiveStarFeature(),
    new StickyWildFeature(), new CollectorFeature(), new HoldAndWinFeature(),
  ];
}
