import type {
  SpatialRouteDefinition,
  SpatialRouteValidationIssue,
  SpatialRouteValidationResult,
} from "./spatial-route-types.js";

const ID_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;

export function validateSpatialRouteDefinition(definition: SpatialRouteDefinition): SpatialRouteValidationResult {
  const errors: SpatialRouteValidationIssue[] = [];
  const warnings: SpatialRouteValidationIssue[] = [];
  if (!ID_PATTERN.test(definition.id)) errors.push(issue("INVALID_ID", "id", "Route id must be a stable lowercase identifier"));
  if (!definition.name.trim()) errors.push(issue("REQUIRED", "name", "Route name is required"));
  if (!definition.description.trim()) errors.push(issue("REQUIRED", "description", "Route description is required"));
  if (!isPoint(definition.start.position)) errors.push(issue("INVALID_POINT", "start.position", "Route start must contain finite x, y and z values"));
  if (!Number.isFinite(definition.start.headingDegrees)) errors.push(issue("INVALID_NUMBER", "start.headingDegrees", "Start heading must be finite"));
  if (definition.segments.length === 0) errors.push(issue("REQUIRED", "segments", "A spatial route requires at least one segment"));

  const segmentIds = new Set<string>();
  definition.segments.forEach((segment, index) => {
    const path = `segments[${index}]`;
    if (!ID_PATTERN.test(segment.id)) errors.push(issue("INVALID_ID", `${path}.id`, "Segment id must be a stable lowercase identifier"));
    if (segmentIds.has(segment.id)) errors.push(issue("DUPLICATE_ID", `${path}.id`, `Duplicate segment id ${segment.id}`));
    segmentIds.add(segment.id);
    if (!Number.isFinite(segment.length) || segment.length <= 0) errors.push(issue("INVALID_LENGTH", `${path}.length`, "Segment length must be greater than zero"));
    if (segment.length > 10_000) errors.push(issue("INVALID_LENGTH", `${path}.length`, "Segment length exceeds the supported presentation limit"));
    const turn = segment.turnDegrees ?? 0;
    if (!Number.isFinite(turn) || Math.abs(turn) > 180) errors.push(issue("INVALID_TURN", `${path}.turnDegrees`, "Segment turn must be between -180 and 180 degrees"));
    const elevation = segment.elevation ?? 0;
    if (!Number.isFinite(elevation) || Math.abs(elevation) > segment.length) errors.push(issue("INVALID_ELEVATION", `${path}.elevation`, "Elevation must be finite and cannot exceed segment length"));
    if (segment.width !== undefined && (!Number.isFinite(segment.width) || segment.width <= 0)) errors.push(issue("INVALID_WIDTH", `${path}.width`, "Segment width must be greater than zero"));
    if (segment.sampleSpacing !== undefined && (!Number.isFinite(segment.sampleSpacing) || segment.sampleSpacing <= 0)) errors.push(issue("INVALID_SPACING", `${path}.sampleSpacing`, "Sample spacing must be greater than zero"));
  });

  const cueIds = new Set<string>();
  for (const [index, cue] of (definition.cues ?? []).entries()) {
    const path = `cues[${index}]`;
    if (!ID_PATTERN.test(cue.id)) errors.push(issue("INVALID_ID", `${path}.id`, "Cue id must be a stable lowercase identifier"));
    if (cueIds.has(cue.id)) errors.push(issue("DUPLICATE_ID", `${path}.id`, `Duplicate cue id ${cue.id}`));
    cueIds.add(cue.id);
    if (!segmentIds.has(cue.segmentId)) errors.push(issue("UNKNOWN_SEGMENT", `${path}.segmentId`, `Cue references unknown segment ${cue.segmentId}`));
    const offset = cue.offset ?? .5;
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) errors.push(issue("INVALID_OFFSET", `${path}.offset`, "Cue offset must be between zero and one"));
    if (cue.laneOffset !== undefined && !Number.isFinite(cue.laneOffset)) errors.push(issue("INVALID_NUMBER", `${path}.laneOffset`, "Cue lane offset must be finite"));
  }

  const destinationCount = (definition.cues ?? []).filter(({ kind }) => kind === "destination").length;
  if (destinationCount === 0) warnings.push(issue("MISSING_DESTINATION", "cues", "Route has no destination cue"));
  if (destinationCount > 1) warnings.push(issue("MULTIPLE_DESTINATIONS", "cues", "Route contains more than one destination cue"));

  const obstacleIds = new Set<string>();
  for (const [index, obstacle] of (definition.obstacles ?? []).entries()) {
    const path = `obstacles[${index}]`;
    if (!ID_PATTERN.test(obstacle.id)) errors.push(issue("INVALID_ID", `${path}.id`, "Obstacle id must be a stable lowercase identifier"));
    if (obstacleIds.has(obstacle.id)) errors.push(issue("DUPLICATE_ID", `${path}.id`, `Duplicate obstacle id ${obstacle.id}`));
    obstacleIds.add(obstacle.id);
    if (!segmentIds.has(obstacle.segmentId)) errors.push(issue("UNKNOWN_SEGMENT", `${path}.segmentId`, `Obstacle references unknown segment ${obstacle.segmentId}`));
    validateOffset(obstacle.offset ?? .5, `${path}.offset`, errors);
    if (obstacle.lane !== undefined && (!Number.isSafeInteger(obstacle.lane) || Math.abs(obstacle.lane) > 1)) {
      errors.push(issue("INVALID_LANE", `${path}.lane`, "Obstacle lane must be -1, 0 or 1"));
    }
    if ((obstacle.requiredAction === "change-lane" || obstacle.requiredAction === undefined && (obstacle.kind === "traffic" || obstacle.kind === "route-blocker")) && obstacle.lane === undefined) {
      errors.push(issue("REQUIRED", `${path}.lane`, "Lane-change obstacles must identify the blocked lane"));
    }
    if (obstacle.reactionLeadDistance !== undefined && (!Number.isFinite(obstacle.reactionLeadDistance) || obstacle.reactionLeadDistance <= 0)) {
      errors.push(issue("INVALID_DISTANCE", `${path}.reactionLeadDistance`, "Obstacle reaction lead distance must be greater than zero"));
    }
  }

  const branchIds = new Set<string>();
  for (const [index, branch] of (definition.branches ?? []).entries()) {
    const path = `branches[${index}]`;
    if (!ID_PATTERN.test(branch.id)) errors.push(issue("INVALID_ID", `${path}.id`, "Branch id must be a stable lowercase identifier"));
    if (branchIds.has(branch.id)) errors.push(issue("DUPLICATE_ID", `${path}.id`, `Duplicate branch id ${branch.id}`));
    branchIds.add(branch.id);
    if (!segmentIds.has(branch.entry.segmentId)) errors.push(issue("UNKNOWN_SEGMENT", `${path}.entry.segmentId`, `Branch entry references unknown segment ${branch.entry.segmentId}`));
    if (!segmentIds.has(branch.rejoin.segmentId)) errors.push(issue("UNKNOWN_SEGMENT", `${path}.rejoin.segmentId`, `Branch rejoin references unknown segment ${branch.rejoin.segmentId}`));
    validateOffset(branch.entry.offset ?? 0, `${path}.entry.offset`, errors);
    validateOffset(branch.rejoin.offset ?? 1, `${path}.rejoin.offset`, errors);
    if (branch.decisionLeadDistance !== undefined && (!Number.isFinite(branch.decisionLeadDistance) || branch.decisionLeadDistance <= 0)) {
      errors.push(issue("INVALID_DISTANCE", `${path}.decisionLeadDistance`, "Decision lead distance must be greater than zero"));
    }
    if (branch.decisionTailDistance !== undefined && (!Number.isFinite(branch.decisionTailDistance) || branch.decisionTailDistance < 0)) {
      errors.push(issue("INVALID_DISTANCE", `${path}.decisionTailDistance`, "Decision tail distance cannot be negative"));
    }
    if (branch.alternatives.length < 2) errors.push(issue("INSUFFICIENT_ALTERNATIVES", `${path}.alternatives`, "A branch requires at least two presentation alternatives"));
    const alternativeIds = new Set<string>();
    const directions = new Set<string>();
    branch.alternatives.forEach((alternative, alternativeIndex) => {
      const alternativePath = `${path}.alternatives[${alternativeIndex}]`;
      if (!ID_PATTERN.test(alternative.id)) errors.push(issue("INVALID_ID", `${alternativePath}.id`, "Alternative id must be a stable lowercase identifier"));
      if (alternativeIds.has(alternative.id)) errors.push(issue("DUPLICATE_ID", `${alternativePath}.id`, `Duplicate branch alternative ${alternative.id}`));
      alternativeIds.add(alternative.id);
      if (alternative.direction) directions.add(alternative.direction);
      if (!Number.isFinite(alternative.lateralOffset)) errors.push(issue("INVALID_NUMBER", `${alternativePath}.lateralOffset`, "Lateral offset must be finite"));
      if (alternative.elevationOffset !== undefined && !Number.isFinite(alternative.elevationOffset)) errors.push(issue("INVALID_NUMBER", `${alternativePath}.elevationOffset`, "Elevation offset must be finite"));
      if (alternative.headingOffsetDegrees !== undefined && (!Number.isFinite(alternative.headingOffsetDegrees) || Math.abs(alternative.headingOffsetDegrees) > 120)) {
        errors.push(issue("INVALID_TURN", `${alternativePath}.headingOffsetDegrees`, "Branch heading offset must be between -120 and 120 degrees"));
      }
      const divergeFraction = alternative.divergeFraction ?? .22;
      const rejoinFraction = alternative.rejoinFraction ?? .72;
      if (!Number.isFinite(divergeFraction) || divergeFraction <= 0 || divergeFraction >= 1) {
        errors.push(issue("INVALID_BRANCH_PROFILE", `${alternativePath}.divergeFraction`, "Branch divergence must be between zero and one"));
      }
      if (!Number.isFinite(rejoinFraction) || rejoinFraction <= 0 || rejoinFraction >= 1) {
        errors.push(issue("INVALID_BRANCH_PROFILE", `${alternativePath}.rejoinFraction`, "Branch rejoin must be between zero and one"));
      }
      if (Number.isFinite(divergeFraction) && Number.isFinite(rejoinFraction) && divergeFraction >= rejoinFraction) {
        errors.push(issue("INVALID_BRANCH_PROFILE", `${alternativePath}.rejoinFraction`, "Branch rejoin must begin after divergence finishes"));
      }
    });
    if (!alternativeIds.has(branch.defaultAlternativeId)) errors.push(issue("UNKNOWN_ALTERNATIVE", `${path}.defaultAlternativeId`, "Default branch alternative must exist"));
    if (branch.junctionKind === "t-junction" && (!directions.has("left") || !directions.has("right") || directions.has("straight"))) {
      errors.push(issue("INVALID_JUNCTION", `${path}.alternatives`, "A T-junction requires left and right alternatives with no straight option"));
    }
    if (branch.junctionKind === "crossroads" && (!directions.has("left") || !directions.has("straight") || !directions.has("right"))) {
      errors.push(issue("INVALID_JUNCTION", `${path}.alternatives`, "Crossroads require left, straight and right alternatives"));
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function issue(code: string, path: string, message: string): SpatialRouteValidationIssue {
  return { code, path, message };
}

function isPoint(value: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function validateOffset(value: number, path: string, errors: SpatialRouteValidationIssue[]): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(issue("INVALID_OFFSET", path, "Branch offset must be between zero and one"));
}
