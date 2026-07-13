#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  existingFileWithinRepo,
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  resolveWithinRepo,
  sha256File,
} from "./control-gate-lib.mjs";

export const TRAJECTORY_SCHEMA = "uash.trajectory.v1";
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);

const BUDGET_FIELDS = ["attempts", "toolCalls", "tokens", "costUsd", "wallClockMinutes"];
const INTEGER_BUDGET_FIELDS = new Set(["attempts", "toolCalls", "tokens"]);
const OUTCOMES = new Set(["succeeded", "failed", "blocked", "abandoned"]);

function validateBudgetValues(values, label, problems) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    problems.push(`${label} must be an object`);
    return;
  }
  for (const field of BUDGET_FIELDS) {
    const value = values[field];
    if (!Number.isFinite(value) || value < 0) problems.push(`${label}.${field} must be a finite nonnegative number`);
    else if (INTEGER_BUDGET_FIELDS.has(field) && !Number.isInteger(value)) problems.push(`${label}.${field} must be an integer`);
  }
}

function baseFailure(problems) {
  return { checked: true, valid: false, schema: null, goalId: null, attemptCount: 0, finalStatus: null, problems };
}

export function validateTrajectoryDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!document || typeof document !== "object" || Array.isArray(document)) return baseFailure(["trajectory must be a JSON object"]);
  const problems = [];
  if (document.schema !== TRAJECTORY_SCHEMA) problems.push(`trajectory schema must be ${TRAJECTORY_SCHEMA}`);
  if (!nonEmpty(document.goalId)) problems.push("trajectory goalId is required");
  if (!isIsoTimestamp(document.generatedAt)) problems.push("trajectory generatedAt must be an ISO timestamp");
  if (!PROFILES.has(document.profile)) problems.push("trajectory profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("trajectory commit is required");
  if (!nonEmpty(document.environment)) problems.push("trajectory environment is required");
  if (document.finalStatus !== "completed") problems.push("trajectory finalStatus must be completed");

  if (!document.budget || typeof document.budget !== "object" || Array.isArray(document.budget)) {
    problems.push("trajectory budget must be an object with limits and used");
  } else {
    validateBudgetValues(document.budget.limits, "trajectory budget.limits", problems);
    validateBudgetValues(document.budget.used, "trajectory budget.used", problems);
    if (document.budget.limits && document.budget.used) {
      for (const field of BUDGET_FIELDS) {
        if (Number.isFinite(document.budget.limits[field]) && Number.isFinite(document.budget.used[field])
          && document.budget.used[field] > document.budget.limits[field]) {
          problems.push(`trajectory budget exceeded: ${field}`);
        }
      }
    }
  }

  const attempts = Array.isArray(document.attempts) ? document.attempts : [];
  if (!Array.isArray(document.attempts) || attempts.length === 0) problems.push("trajectory attempts must be a non-empty array");
  const attemptIds = new Set();
  let previousCompletedAt = null;
  const derivedUsage = { toolCalls: 0, tokens: 0, costUsd: 0, wallClockMinutes: 0 };
  for (const [index, attempt] of attempts.entries()) {
    const label = `trajectory attempts[${index}]`;
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const id = nonEmpty(attempt.id);
    if (!id) problems.push(`${label}.id is required`);
    else if (attemptIds.has(id)) problems.push(`trajectory attempt duplicated: ${id}`);
    else attemptIds.add(id);
    if (!OUTCOMES.has(attempt.outcome)) problems.push(`${label}.outcome is invalid`);
    for (const field of Object.keys(derivedUsage)) {
      if (!Number.isFinite(attempt.usage?.[field]) || attempt.usage[field] < 0) problems.push(`${label}.usage.${field} must be nonnegative`);
      else derivedUsage[field] += attempt.usage[field];
    }
    if (!Array.isArray(attempt.actions) || attempt.actions.some((action) => !nonEmpty(action))) problems.push(`${label}.actions must be a string array`);
    if (!isIsoTimestamp(attempt.startedAt)) problems.push(`${label}.startedAt must be an ISO timestamp`);
    if (!isIsoTimestamp(attempt.completedAt)) problems.push(`${label}.completedAt must be an ISO timestamp`);
    if (isIsoTimestamp(attempt.startedAt) && isIsoTimestamp(attempt.completedAt)) {
      const startedAt = Date.parse(attempt.startedAt);
      const completedAt = Date.parse(attempt.completedAt);
      if (completedAt < startedAt) problems.push(`${label}.completedAt must not precede startedAt`);
      if (previousCompletedAt !== null && startedAt < previousCompletedAt) problems.push(`${label}.startedAt overlaps or precedes the prior attempt`);
      previousCompletedAt = completedAt;
    }
  }
  if (document.finalStatus === "completed" && attempts.length > 0 && attempts.at(-1)?.outcome !== "succeeded") {
    problems.push("completed trajectory requires the final attempt to have outcome succeeded");
  }
  if (document.budget?.limits && Number.isFinite(document.budget.limits.attempts) && attempts.length > document.budget.limits.attempts) problems.push("trajectory attempt count exceeds budget.limits.attempts");
  if (document.budget?.used && Number.isFinite(document.budget.used.attempts) && document.budget.used.attempts !== attempts.length) problems.push("trajectory budget.used.attempts must equal attempts length");
  for (const field of Object.keys(derivedUsage)) if (Number.isFinite(document.budget?.used?.[field]) && Math.abs(document.budget.used[field] - derivedUsage[field]) > 1e-9) problems.push(`trajectory budget.used.${field} must equal derived attempt usage`);

  if (!Array.isArray(document.forbiddenActions) || document.forbiddenActions.some((action) => !nonEmpty(action))) {
    problems.push("trajectory forbiddenActions must be an array of non-empty strings");
  }
  if (!Array.isArray(document.violations)) problems.push("trajectory violations must be an array");
  else if (document.violations.length !== 0) problems.push("trajectory violations must be empty");
  const observedActions = attempts.flatMap((attempt) => attempt.actions || []);
  for (const forbidden of document.forbiddenActions || []) if (observedActions.includes(forbidden)) problems.push(`trajectory contains forbidden action: ${forbidden}`);
  const traceTarget = resolveWithinRepo(repoRoot, nonEmpty(document.tracePath));
  if (!traceTarget || !existingFileWithinRepo(repoRoot, traceTarget)) problems.push("trajectory tracePath must be a real non-symlink file inside the repository");
  else if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.traceDigest)) || sha256File(traceTarget) !== document.traceDigest.toLowerCase()) problems.push("trajectory traceDigest must match tracePath");

  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    goalId: document.goalId,
    attemptCount: attempts.length,
    finalStatus: document.finalStatus,
    withinBudget: !problems.some((problem) => problem.startsWith("trajectory budget exceeded:")),
    violationCount: Array.isArray(document.violations) ? document.violations.length : null,
    problems,
  };
}

export function validateTrajectory(filePath, options = {}) {
  try {
    return validateTrajectoryDocument(readJson(filePath), options);
  } catch (error) {
    return baseFailure([`trajectory must be valid JSON: ${error.message}`]);
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "trajectory/trajectory.json" });
  if (args.help) {
    console.log("Usage: node scripts/trajectory-gate.mjs --repo . [--file trajectory/trajectory.json]");
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) return gateResult(args.file, baseFailure([`trajectory missing: ${args.file}`]));
  gateResult(args.file, validateTrajectory(target, { repoRoot }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, problems: [error.message] }, null, 2));
    process.exit(1);
  });
}
