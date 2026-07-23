#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evidencePolicyForEffectiveTier,
  existingFileWithinRepo,
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  sha256File,
  validateTypedEvidence,
} from "./control-gate-lib.mjs";

export const GOAL_SCHEMA = "uash.goal.v1";

const GOAL_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);
const CONDITION_STATUSES = new Set(["pending", "passed", "failed", "blocked"]);
const CHECKPOINT_STATUSES = new Set([
  "started",
  "progress",
  "passed",
  "failed",
  "blocked",
]);
const PROFILES = new Set([
  "prototype",
  "production",
  "enterprise",
  "regulated",
]);
const BUDGET_FIELDS = [
  "attempts",
  "toolCalls",
  "tokens",
  "costUsd",
  "wallClockMinutes",
];
const INTEGER_BUDGET_FIELDS = new Set(["attempts", "toolCalls", "tokens"]);

function validateBudgets(budgets, problems) {
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
    problems.push("goal budgets must be an object");
    return;
  }
  for (const field of BUDGET_FIELDS) {
    const value = budgets[field];
    if (!Number.isFinite(value) || value < 0)
      problems.push(
        `goal budgets.${field} must be a finite nonnegative number`,
      );
    else if (INTEGER_BUDGET_FIELDS.has(field) && !Number.isInteger(value))
      problems.push(`goal budgets.${field} must be an integer`);
  }
}

function baseFailure(problems) {
  return {
    checked: true,
    valid: false,
    schema: null,
    status: null,
    stoppingConditionCount: 0,
    checkpointCount: 0,
    problems,
  };
}

export function validateGoalDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!document || typeof document !== "object" || Array.isArray(document))
    return baseFailure(["goal must be a JSON object"]);

  const problems = [];
  if (document.schema !== GOAL_SCHEMA)
    problems.push(`goal schema must be ${GOAL_SCHEMA}`);
  if (!nonEmpty(document.goalId)) problems.push("goal goalId is required");
  if (!Number.isInteger(document.revision) || document.revision < 1)
    problems.push("goal revision must be a positive integer");
  if (!isIsoTimestamp(document.generatedAt))
    problems.push("goal generatedAt must be an ISO timestamp");
  if (!isIsoTimestamp(document.updatedAt))
    problems.push("goal updatedAt must be an ISO timestamp");
  if (!PROFILES.has(document.profile)) problems.push("goal profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("goal commit is required");
  if (!nonEmpty(document.environment))
    problems.push("goal environment is required");
  const evidencePolicy = evidencePolicyForEffectiveTier(document.effectiveTier);
  if (!evidencePolicy) problems.push("goal effectiveTier is invalid");
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.workloadClassificationSha256)))
    problems.push("goal workloadClassificationSha256 must be a SHA-256 digest");
  if (options.classification) {
    if (document.goalId !== options.classification.runId)
      problems.push("goal goalId must match workload classification runId");
    if (document.profile !== options.classification.requestedProfile)
      problems.push("goal profile must match workload classification");
    if (document.effectiveTier !== options.classification.effectiveTier)
      problems.push("goal effectiveTier must match workload classification");
    if (document.commit !== options.classification.commit)
      problems.push("goal commit must match workload classification");
    if (document.environment !== options.classification.environment)
      problems.push("goal environment must match workload classification");
    if (document.workloadClassificationSha256 !== options.classificationSha256)
      problems.push(
        "goal workloadClassificationSha256 does not match run/workload-classification.json",
      );
  }
  if (!nonEmpty(document.objective))
    problems.push("goal objective is required");
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.requestSha256)))
    problems.push("goal requestSha256 must be a SHA-256 digest");
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.initialRouteSha256)))
    problems.push("goal initialRouteSha256 must be a SHA-256 digest");
  if (!nonEmpty(document.owner)) problems.push("goal owner is required");
  if (!GOAL_STATUSES.has(document.status))
    problems.push("goal status is invalid");
  if (options.requireComplete && document.status !== "completed")
    problems.push("finish-line goal status must be completed");
  if (
    options.allowActive &&
    !new Set(["pending", "in_progress", "completed"]).has(document.status)
  )
    problems.push(
      `active-goal validation rejects terminal/blocking status: ${document.status}`,
    );
  validateBudgets(document.budgets, problems);
  if (options.route?.executionBudget) {
    for (const field of BUDGET_FIELDS)
      if (document.budgets?.[field] !== options.route.executionBudget[field])
        problems.push(
          `goal budgets.${field} must match route.executionBudget.${field}`,
        );
  }

  const conditions = Array.isArray(document.stoppingConditions)
    ? document.stoppingConditions
    : [];
  if (!Array.isArray(document.stoppingConditions) || conditions.length === 0)
    problems.push("goal stoppingConditions must be a non-empty array");
  const conditionIds = new Set();
  for (const [index, condition] of conditions.entries()) {
    const label = `goal stoppingConditions[${index}]`;
    if (
      !condition ||
      typeof condition !== "object" ||
      Array.isArray(condition)
    ) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const id = nonEmpty(condition.id);
    if (!id) problems.push(`${label}.id is required`);
    else if (conditionIds.has(id))
      problems.push(`goal stopping condition duplicated: ${id}`);
    else conditionIds.add(id);
    if (!CONDITION_STATUSES.has(condition.status))
      problems.push(`${label}.status is invalid`);
    if (condition.status === "passed") {
      if (!Array.isArray(condition.evidence) || condition.evidence.length === 0)
        problems.push(`${label} passed without typed evidence`);
      else
        condition.evidence.forEach((evidence, evidenceIndex) => {
          problems.push(
            ...validateTypedEvidence(evidence, {
              repoRoot,
              profile: evidencePolicy?.profile || "production",
              minimumTechnicalTrust: evidencePolicy?.minimumTechnicalTrust,
              label: `${label}.evidence[${evidenceIndex}]`,
              subject: id,
              asOf: document.generatedAt,
              runId: document.goalId,
              commit: document.commit,
              environment: document.environment,
            }),
          );
        });
    }
  }

  const checkpoints = Array.isArray(document.checkpoints)
    ? document.checkpoints
    : [];
  if (!Array.isArray(document.checkpoints) || checkpoints.length === 0)
    problems.push("goal checkpoints must be a non-empty array");
  const checkpointIds = new Set();
  let previousCheckpoint = null;
  for (const [index, checkpoint] of checkpoints.entries()) {
    const label = `goal checkpoints[${index}]`;
    if (
      !checkpoint ||
      typeof checkpoint !== "object" ||
      Array.isArray(checkpoint)
    ) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const id = nonEmpty(checkpoint.id);
    if (!id) problems.push(`${label}.id is required`);
    else if (checkpointIds.has(id))
      problems.push(`goal checkpoint duplicated: ${id}`);
    else checkpointIds.add(id);
    if (!CHECKPOINT_STATUSES.has(checkpoint.status))
      problems.push(`${label}.status is invalid`);
    if (!isIsoTimestamp(checkpoint.recordedAt))
      problems.push(`${label}.recordedAt must be an ISO timestamp`);
    if (!nonEmpty(checkpoint.summary))
      problems.push(`${label}.summary is required`);
    if (isIsoTimestamp(checkpoint.recordedAt)) {
      const recordedAt = Date.parse(checkpoint.recordedAt);
      if (
        isIsoTimestamp(document.generatedAt) &&
        recordedAt > Date.parse(document.generatedAt)
      )
        problems.push(`${label}.recordedAt must not be after generatedAt`);
      if (previousCheckpoint !== null && recordedAt < previousCheckpoint)
        problems.push(`${label}.recordedAt is not chronological`);
      previousCheckpoint = recordedAt;
    }
  }

  if (
    document.status === "completed" &&
    (conditions.length === 0 ||
      conditions.some((condition) => condition?.status !== "passed"))
  ) {
    problems.push(
      "completed goal requires every stopping condition to be passed",
    );
  }
  if (
    document.status === "completed" &&
    (checkpoints.length === 0 ||
      checkpoints.some((checkpoint) => checkpoint?.status !== "passed"))
  )
    problems.push(
      "completed goal requires every checkpoint to be passed; failed attempts belong in trajectory history",
    );

  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    status: document.status,
    stoppingConditionCount: conditions.length,
    passedStoppingConditions: conditions.filter(
      (condition) => condition?.status === "passed",
    ).length,
    checkpointCount: checkpoints.length,
    problems,
  };
}

export function validateGoal(filePath, options = {}) {
  try {
    const repoRoot = path.resolve(
      options.repoRoot || path.dirname(path.dirname(filePath)),
    );
    const classificationPath = path.resolve(
      options.classificationPath ||
        path.join(repoRoot, "run", "workload-classification.json"),
    );
    if (!existingFileWithinRepo(repoRoot, classificationPath))
      return baseFailure([
        "goal requires a real non-symlink run/workload-classification.json inside the repository",
      ]);
    const routePath = path.resolve(
      options.routePath || path.join(repoRoot, "run", "route.json"),
    );
    if (!existingFileWithinRepo(repoRoot, routePath))
      return baseFailure([
        "goal requires a real non-symlink run/route.json inside the repository",
      ]);
    return validateGoalDocument(readJson(filePath), {
      ...options,
      repoRoot,
      classification: readJson(classificationPath),
      classificationSha256: sha256File(classificationPath),
      route: readJson(routePath),
    });
  } catch (error) {
    return baseFailure([`goal must be valid JSON: ${error.message}`]);
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: "goal/goal.json",
  });
  if (args.help) {
    console.log(
      "Usage: node scripts/goal-gate.mjs --repo . [--file goal/goal.json] [--allow-active]",
    );
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target))
    return gateResult(args.file, baseFailure([`goal missing: ${args.file}`]));
  gateResult(
    args.file,
    validateGoal(target, {
      repoRoot,
      requireComplete: !args.allowActive,
      allowActive: Boolean(args.allowActive),
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ ok: false, problems: [error.message] }, null, 2),
    );
    process.exit(1);
  });
}
