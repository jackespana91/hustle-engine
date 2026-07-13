export const ROUTERUN_FEATURE_HOOKS = [
  "before-board-created", "after-board-created", "before-route-solved", "after-route-solved",
  "before-runner-moves", "after-route-step", "after-overlay-collected", "before-clear", "after-clear",
  "before-cascade", "after-cascade", "before-expansion", "after-expansion", "before-terminal", "after-terminal",
] as const;

export type RouteRunFeatureHook = typeof ROUTERUN_FEATURE_HOOKS[number];
