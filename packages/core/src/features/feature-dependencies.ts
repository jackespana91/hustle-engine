import type { FeatureManifest, FeatureManifestId } from "../manifests/manifest-types.js";
import { FeatureSdkError } from "./feature-errors.js";

export interface FeatureDependencyNode {
  readonly manifest: FeatureManifest;
  readonly enabled?: boolean;
}

export type FeatureDependencyInput = FeatureManifest | FeatureDependencyNode;

export interface FeatureDependencyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly FeatureSdkError[];
}

/** Validates required dependencies and cycles among enabled features. */
export function validateFeatureDependencies(
  inputs: readonly FeatureDependencyInput[],
): FeatureDependencyValidationResult {
  const nodes = inputs.map(toNode);
  const errors = duplicateErrors(nodes);
  const byId = new Map<FeatureManifestId, FeatureDependencyNode>();
  nodes.forEach((node) => { if (!byId.has(node.manifest.id)) byId.set(node.manifest.id, node); });

  for (const node of activeNodes(nodes)) {
    const id = node.manifest.id;
    for (const dependencyId of node.manifest.dependencies) {
      const dependency = byId.get(dependencyId);
      if (!dependency || dependency.enabled === false) {
        errors.push(new FeatureSdkError(
          "MISSING_DEPENDENCY",
          `Feature ${id} requires enabled dependency ${dependencyId}`,
          {
            featureId: id,
            operation: "validate-dependencies",
            recoverable: true,
            context: { dependencyId, registered: dependency !== undefined, enabled: dependency?.enabled ?? false },
          },
        ));
      }
    }
  }

  errors.push(...cycleErrors(nodes, byId));
  return { valid: errors.length === 0, errors };
}

/** Detects active conflicts, including one-sided conflict declarations. */
export function validateFeatureConflicts(
  inputs: readonly FeatureDependencyInput[],
): FeatureDependencyValidationResult {
  const nodes = activeNodes(inputs.map(toNode));
  const activeIds = new Set(nodes.map(({ manifest }) => manifest.id));
  const reported = new Set<string>();
  const errors: FeatureSdkError[] = [];

  for (const node of nodes) {
    for (const conflictId of node.manifest.conflicts) {
      if (!activeIds.has(conflictId)) continue;
      const pair = [String(node.manifest.id), String(conflictId)].sort(compareAscii).join("|");
      if (reported.has(pair)) continue;
      reported.add(pair);
      errors.push(new FeatureSdkError(
        "FEATURE_CONFLICT",
        `Feature ${node.manifest.id} conflicts with active feature ${conflictId}`,
        {
          featureId: node.manifest.id,
          operation: "validate-conflicts",
          recoverable: true,
          context: { conflictingFeatureId: conflictId },
        },
      ));
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateFeatureGraph(
  inputs: readonly FeatureDependencyInput[],
): FeatureDependencyValidationResult {
  const dependencies = validateFeatureDependencies(inputs);
  const conflicts = validateFeatureConflicts(inputs);
  const errors = [...dependencies.errors, ...conflicts.errors];
  return { valid: errors.length === 0, errors };
}

export function assertValidFeatureGraph(inputs: readonly FeatureDependencyInput[]): void {
  const result = validateFeatureGraph(inputs);
  const first = result.errors[0];
  if (first) throw first;
}

/**
 * Produces one deterministic topological order. Dependencies always precede
 * dependants; among currently ready nodes, lower priority runs first and ASCII
 * feature ID is the only tie-breaker.
 */
export function resolveFeatureExecutionOrder(
  inputs: readonly FeatureDependencyInput[],
): readonly FeatureManifestId[] {
  assertValidFeatureGraph(inputs);
  const nodes = activeNodes(inputs.map(toNode));
  const remaining = new Map(nodes.map((node) => [node.manifest.id, node]));
  const activeById = new Map(remaining);
  const resolved: FeatureManifestId[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => dependencyIds(node.manifest, activeById).every((dependency) => resolved.includes(dependency)))
      .sort((left, right) =>
        left.manifest.priority - right.manifest.priority || compareAscii(left.manifest.id, right.manifest.id));
    const next = ready[0];
    if (!next) {
      throw new FeatureSdkError("CIRCULAR_DEPENDENCY", "Feature dependencies contain a cycle", {
        operation: "resolve-order",
        context: { remaining: [...remaining.keys()].sort(compareAscii) },
      });
    }
    resolved.push(next.manifest.id);
    remaining.delete(next.manifest.id);
  }
  return resolved;
}

// Concise aliases retained for callers migrating from the prototype SDK.
export const validateDependencies = validateFeatureDependencies;
export const validateConflicts = validateFeatureConflicts;
export const resolveDeterministicFeatureOrder = resolveFeatureExecutionOrder;

export function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toNode(input: FeatureDependencyInput): FeatureDependencyNode {
  return "manifestType" in input
    ? { manifest: input, enabled: true }
    : { manifest: input.manifest, enabled: input.enabled ?? true };
}

function activeNodes(nodes: readonly FeatureDependencyNode[]): FeatureDependencyNode[] {
  return nodes
    .filter(({ enabled }) => enabled !== false)
    .sort((left, right) => compareAscii(left.manifest.id, right.manifest.id));
}

function duplicateErrors(nodes: readonly FeatureDependencyNode[]): FeatureSdkError[] {
  const seen = new Set<FeatureManifestId>();
  const errors: FeatureSdkError[] = [];
  for (const node of nodes) {
    if (seen.has(node.manifest.id)) {
      errors.push(new FeatureSdkError("DUPLICATE_FEATURE", `Feature ${node.manifest.id} appears more than once`, {
        featureId: node.manifest.id,
        operation: "validate-dependencies",
      }));
    }
    seen.add(node.manifest.id);
  }
  return errors;
}

function cycleErrors(
  nodes: readonly FeatureDependencyNode[],
  byId: ReadonlyMap<FeatureManifestId, FeatureDependencyNode>,
): FeatureSdkError[] {
  const state = new Map<FeatureManifestId, "visiting" | "visited">();
  const stack: FeatureManifestId[] = [];
  const signatures = new Set<string>();
  const errors: FeatureSdkError[] = [];

  const visit = (node: FeatureDependencyNode): void => {
    const id = node.manifest.id;
    if (state.get(id) === "visited") return;
    if (state.get(id) === "visiting") {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const signature = [...new Set(cycle.map(String))].sort(compareAscii).join("|");
      if (!signatures.has(signature)) {
        signatures.add(signature);
        errors.push(new FeatureSdkError(
          "CIRCULAR_DEPENDENCY",
          `Feature dependency cycle: ${cycle.join(" -> ")}`,
          {
            featureId: id,
            operation: "validate-dependencies",
            context: { cycle },
          },
        ));
      }
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dependencyId of dependencyIds(node.manifest, byId)) {
      const dependency = byId.get(dependencyId);
      if (dependency && dependency.enabled !== false) visit(dependency);
    }
    stack.pop();
    state.set(id, "visited");
  };

  activeNodes(nodes).forEach(visit);
  return errors;
}

function dependencyIds(
  manifest: FeatureManifest,
  byId: ReadonlyMap<FeatureManifestId, FeatureDependencyNode>,
): readonly FeatureManifestId[] {
  const required = manifest.dependencies.filter((id) => byId.get(id)?.enabled !== false && byId.has(id));
  const optional = optionalDependencies(manifest).filter((id) => byId.get(id)?.enabled !== false && byId.has(id));
  return [...new Set([...required, ...optional])].sort(compareAscii);
}

function optionalDependencies(manifest: FeatureManifest): readonly FeatureManifestId[] {
  return (manifest as FeatureManifest & {
    readonly optionalDependencies?: readonly FeatureManifestId[];
  }).optionalDependencies ?? [];
}
