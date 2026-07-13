import { FeatureRegistry, createFeatureResult, type FeatureResult } from "@hustle/core";
import type { RouteRunFeatureBridge, RouteRunFeatureContext, RouteRunFeatureHook } from "@hustle/routerun";
import { NIGHT_DROP_ENGINE_ID } from "../config/ids.js";
import {
  NIGHT_DROP_FEATURE_MANIFESTS,
  createNightDropFeatures,
  type NightDropRouteFeature,
} from "./night-drop-features.js";

export interface NightDropFeaturePack {
  readonly registry: FeatureRegistry;
  readonly bridge: RouteRunFeatureBridge;
  readonly features: readonly NightDropRouteFeature[];
}

export function createNightDropFeaturePack(): NightDropFeaturePack {
  const implementations = createNightDropFeatures();
  const registry = new FeatureRegistry({ engineId: NIGHT_DROP_ENGINE_ID });
  registry.registerMany(implementations.map((implementation, index) => ({
    implementation,
    manifest: NIGHT_DROP_FEATURE_MANIFESTS[index]!,
  })));
  const byId = new Map(implementations.map((feature) => [String(feature.id), feature]));
  const order = registry.executionOrder(NIGHT_DROP_ENGINE_ID);
  const bridge: RouteRunFeatureBridge = {
    execute(hook: RouteRunFeatureHook, context: RouteRunFeatureContext): FeatureResult {
      const results = order
        .map((id) => byId.get(String(id)))
        .filter((feature): feature is typeof implementations[number] => feature !== undefined && registry.isEnabled(feature.id))
        .map((feature) => feature.projectRouteHook(hook, context));
      return createFeatureResult({
        triggered: results.some((result) => result.triggered),
        emittedEvents: results.flatMap((result) => result.emittedEvents),
        animationCommands: results.flatMap((result) => result.animationCommands),
        featureStateUpdates: results.flatMap((result) => result.featureStateUpdates),
        sharedStateProposals: results.flatMap((result) => result.sharedStateProposals),
        warnings: results.flatMap((result) => result.warnings),
        telemetry: Object.assign({}, ...results.map((result) => result.telemetry)),
      });
    },
  };
  return { registry, bridge, features: implementations };
}
