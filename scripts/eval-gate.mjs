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

export const EVAL_RESULTS_SCHEMA = "uash.eval-results.v1";

const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const OPERATORS = new Set(["<", "<=", "=", ">=", ">"]);

function metricPasses(value, operator, threshold) {
  if (operator === "<") return value < threshold;
  if (operator === "<=") return value <= threshold;
  if (operator === "=") return value === threshold;
  if (operator === ">=") return value >= threshold;
  if (operator === ">") return value > threshold;
  return false;
}

function validateNamedEntries(entries, label, problems, kind) {
  if (!Array.isArray(entries) || entries.length === 0) {
    problems.push(`${label} must be a non-empty array`);
    return;
  }
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const id = nonEmpty(entry?.id);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) problems.push(`${label}[${index}] must be a versioned object`);
    if (!id) problems.push(`${label}[${index}].id is required`);
    else if (seen.has(id)) problems.push(`${label} entry duplicated: ${id}`);
    else seen.add(id);
    if (!nonEmpty(entry?.version)) problems.push(`${label}[${index}].version is required`);
    if (!/^[a-f0-9]{64}$/i.test(nonEmpty(entry?.sha256))) problems.push(`${label}[${index}].sha256 must be a SHA-256 digest`);
    if (kind === "dataset" && (!Number.isInteger(entry?.caseCount) || entry.caseCount <= 0)) problems.push(`${label}[${index}].caseCount must be a positive integer`);
  }
}

function baseFailure(problems) {
  return { checked: true, valid: false, schema: null, suiteCount: 0, passedSuites: 0, problems };
}

export function validateEvalResultsDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!document || typeof document !== "object" || Array.isArray(document)) return baseFailure(["eval results must be a JSON object"]);
  const problems = [];
  if (document.schema !== EVAL_RESULTS_SCHEMA) problems.push(`eval results schema must be ${EVAL_RESULTS_SCHEMA}`);
  if (!nonEmpty(document.runId)) problems.push("eval results runId is required");
  if (!PROFILES.has(document.profile)) problems.push("eval results profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("eval results commit is required");
  if (!nonEmpty(document.environment)) problems.push("eval results environment is required");
  if (!isIsoTimestamp(document.generatedAt)) problems.push("eval results generatedAt must be an ISO timestamp");

  if (document.status === "skipped") {
    if (!nonEmpty(document.skipReason)) problems.push("eval results skipped without skipReason");
    if (Array.isArray(document.suites) && document.suites.length > 0) problems.push("skipped eval results must not contain suites");
    return { checked: true, valid: problems.length === 0, schema: document.schema, runId: document.runId, profile: document.profile, status: document.status, suiteCount: 0, passedSuites: 0, problems };
  }
  if (document.status !== "passed") problems.push("eval results status must be passed or skipped");

  const suites = Array.isArray(document.suites) ? document.suites : [];
  if (!Array.isArray(document.suites) || suites.length === 0) problems.push("eval results suites must be a non-empty array");
  const suiteIds = new Set();
  for (const [index, suite] of suites.entries()) {
    const label = `eval suite[${index}]`;
    if (!suite || typeof suite !== "object" || Array.isArray(suite)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const id = nonEmpty(suite.id);
    if (!id) problems.push(`${label}.id is required`);
    else if (suiteIds.has(id)) problems.push(`eval suite duplicated: ${id}`);
    else suiteIds.add(id);
    if (!new Set(["deterministic", "ai"]).has(suite.kind)) problems.push(`${label}.kind must be deterministic or ai`);
    validateNamedEntries(suite.datasets, `${label}.datasets`, problems, "dataset");
    validateNamedEntries(suite.rubrics, `${label}.rubrics`, problems, "rubric");
    if (!nonEmpty(suite.evaluator?.name) || !nonEmpty(suite.evaluator?.version)) problems.push(`${label}.evaluator name and version are required`);
    if (!/^[a-f0-9]{64}$/i.test(nonEmpty(suite.configDigest))) problems.push(`${label}.configDigest must be a SHA-256 digest`);
    if (suite.kind === "ai") {
      if (!nonEmpty(suite.model?.provider) || !nonEmpty(suite.model?.name) || !nonEmpty(suite.model?.version)) problems.push(`${label}.model provider, name, and version are required for AI evals`);
      if (!nonEmpty(suite.promptVersion)) problems.push(`${label}.promptVersion is required for AI evals`);
      if (!Number.isInteger(suite.criticalFailures) || suite.criticalFailures !== 0) problems.push(`${label}.criticalFailures must be 0`);
      if (!Array.isArray(suite.slices) || suite.slices.length === 0) problems.push(`${label}.slices must be non-empty for AI evals`);
      for (const [sliceIndex, slice] of (suite.slices || []).entries()) {
        if (!nonEmpty(slice.id) || !Number.isFinite(slice.value) || !Number.isFinite(slice.threshold) || !OPERATORS.has(slice.operator)) problems.push(`${label}.slices[${sliceIndex}] is invalid`);
        else if (!metricPasses(slice.value, slice.operator, slice.threshold)) problems.push(`${label}.slices[${sliceIndex}] does not meet its threshold`);
      }
    }
    const resultTarget = resolveWithinRepo(repoRoot, nonEmpty(suite.resultPath));
    if (!resultTarget || !existingFileWithinRepo(repoRoot, resultTarget)) problems.push(`${label}.resultPath must be a real non-symlink file inside the repository`);
    else if (!/^[a-f0-9]{64}$/i.test(nonEmpty(suite.resultDigest)) || sha256File(resultTarget) !== suite.resultDigest.toLowerCase()) problems.push(`${label}.resultDigest must match resultPath`);
    if (!Number.isFinite(suite.threshold)) problems.push(`${label}.threshold must be numeric`);
    if (!Number.isFinite(suite.value)) problems.push(`${label}.value must be numeric`);
    if (!OPERATORS.has(suite.operator)) problems.push(`${label}.operator is invalid`);
    if (!isIsoTimestamp(suite.startedAt)) problems.push(`${label}.startedAt must be an ISO timestamp`);
    if (!isIsoTimestamp(suite.completedAt)) problems.push(`${label}.completedAt must be an ISO timestamp`);
    if (isIsoTimestamp(suite.startedAt) && isIsoTimestamp(suite.completedAt) && Date.parse(suite.completedAt) < Date.parse(suite.startedAt)) {
      problems.push(`${label}.completedAt must not precede startedAt`);
    }
    if (Number.isFinite(suite.value) && Number.isFinite(suite.threshold) && OPERATORS.has(suite.operator)
      && !metricPasses(suite.value, suite.operator, suite.threshold)) {
      problems.push(`${label} does not meet its threshold`);
    }
  }

  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    runId: document.runId,
    profile: document.profile,
    status: document.status,
    suiteCount: suites.length,
    passedSuites: suites.filter((suite) => Number.isFinite(suite?.value) && Number.isFinite(suite?.threshold)
      && OPERATORS.has(suite?.operator) && metricPasses(suite.value, suite.operator, suite.threshold)).length,
    problems,
  };
}

export function validateEvalResults(filePath, options = {}) {
  try {
    return validateEvalResultsDocument(readJson(filePath), options);
  } catch (error) {
    return baseFailure([`eval results must be valid JSON: ${error.message}`]);
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "evals/results.json" });
  if (args.help) {
    console.log("Usage: node scripts/eval-gate.mjs --repo . [--file evals/results.json]");
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) return gateResult(args.file, baseFailure([`eval results missing: ${args.file}`]));
  gateResult(args.file, validateEvalResults(target, { repoRoot }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, problems: [error.message] }, null, 2));
    process.exit(1);
  });
}
