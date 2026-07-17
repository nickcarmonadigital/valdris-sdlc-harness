#!/usr/bin/env node
import { existsSync, lstatSync, realpathSync } from "node:fs";
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
import { validateContextManifestDocument } from "./context-manifest-gate.mjs";
import { assertCanonicalRepoRelativePath } from "./proof-runner.mjs";

export const EVAL_RESULTS_SCHEMA = "uash.eval-results.v1";
export const CONTEXT_COMPARISON_SCHEMA = "uash.context-comparison.v1";
export const CONTEXT_ARM_RESULT_SCHEMA = "uash.context-arm-result.v1";

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

function exactFields(left, right, fields) {
  return fields.every((field) => left?.[field] === right?.[field]);
}

function qualityArtifactMatches(left, right) {
  return exactFields(left, right, ["id", "version", "path", "sha256", "caseCount"]);
}

function namedIdentityMatches(left, right) {
  return exactFields(left, right, ["name", "version"]);
}

function modelIdentityMatches(left, right) {
  return exactFields(left, right, ["provider", "name", "version"]);
}

function canonicalEvalArtifactTarget(repoRoot, value, label, problems) {
  const relativePath = nonEmpty(value);
  try {
    if (!relativePath || relativePath !== value) throw new Error("non-canonical path");
    assertCanonicalRepoRelativePath(relativePath, label);
  } catch {
    problems.push(`${label} must be a canonical repository-relative artifact path`);
    return null;
  }
  const root = realpathSync(path.resolve(repoRoot));
  let target = root;
  for (const component of relativePath.split("/")) {
    target = path.join(target, component);
    if (!existsSync(target)) {
      problems.push(`${label} must be a real non-symlink file inside the repository`);
      return null;
    }
    if (lstatSync(target).isSymbolicLink()) {
      problems.push(`${label} must not traverse symbolic links`);
      return null;
    }
  }
  if (!lstatSync(target).isFile()) {
    problems.push(`${label} must be a real non-symlink file inside the repository`);
    return null;
  }
  return target;
}

function validateContextArm(arm, label, repoRoot, problems) {
  if (!arm || typeof arm !== "object" || Array.isArray(arm)) {
    problems.push(`context comparison ${label} must be an object`);
    return null;
  }
  if (!Number.isFinite(arm.value)) problems.push(`context comparison ${label}.value must be numeric`);
  const resultTarget = canonicalEvalArtifactTarget(repoRoot, arm.resultPath, `context comparison ${label}.resultPath`, problems);
  if (resultTarget && (!/^[a-f0-9]{64}$/i.test(nonEmpty(arm.resultDigest)) || sha256File(resultTarget) !== arm.resultDigest.toLowerCase())) problems.push(`context comparison ${label}.resultDigest must match resultPath`);
  if (!nonEmpty(arm.promptVersion)) problems.push(`context comparison ${label}.promptVersion is required`);
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(arm.configDigest))) problems.push(`context comparison ${label}.configDigest must be a SHA-256 digest`);
  if (!nonEmpty(arm.evaluator?.name) || !nonEmpty(arm.evaluator?.version)) problems.push(`context comparison ${label}.evaluator name and version are required`);
  if (!nonEmpty(arm.model?.provider) || !nonEmpty(arm.model?.name) || !nonEmpty(arm.model?.version)) problems.push(`context comparison ${label}.model provider, name, and version are required`);
  return resultTarget;
}

function contextCaseContract(contract, repoRoot, problems) {
  const load = (entry, label) => {
    const target = canonicalEvalArtifactTarget(repoRoot, entry?.path, `${label}.path`, problems);
    if (!target) return null;
    try { return readJson(target); }
    catch (error) {
      problems.push(`${label} must be valid JSON: ${error.message}`);
      return null;
    }
  };
  const caseSet = load(contract.caseSet, "context quality case set");
  const answerKey = load(contract.answerKey, "context quality answer key");
  const caseIds = [];
  if (caseSet) {
    if (caseSet.schema !== "uash.context-case-set.v1") problems.push("context quality case set schema must be uash.context-case-set.v1");
    if (!Array.isArray(caseSet.cases) || caseSet.cases.length === 0) problems.push("context quality case set cases must be a non-empty array");
    const seen = new Set();
    for (const [index, entry] of (caseSet.cases || []).entries()) {
      const id = nonEmpty(entry?.id);
      if (!id || entry.id !== id) problems.push(`context quality case set cases[${index}].id must be a canonical non-empty string`);
      else if (seen.has(id)) problems.push(`context quality case set case ID is duplicated: ${id}`);
      else { seen.add(id); caseIds.push(id); }
    }
    if (caseSet.cases?.length !== contract.caseSet?.caseCount) problems.push("context quality case set caseCount does not match the case-set document");
  }
  const answerIds = [];
  if (answerKey) {
    if (answerKey.schema !== "uash.context-answer-key.v1") problems.push("context quality answer key schema must be uash.context-answer-key.v1");
    if (!Array.isArray(answerKey.answers) || answerKey.answers.length === 0) problems.push("context quality answer key answers must be a non-empty array");
    const seen = new Set();
    for (const [index, entry] of (answerKey.answers || []).entries()) {
      const id = nonEmpty(entry?.caseId);
      if (!id || entry.caseId !== id) problems.push(`context quality answer key answers[${index}].caseId must be a canonical non-empty string`);
      else if (seen.has(id)) problems.push(`context quality answer key case ID is duplicated: ${id}`);
      else { seen.add(id); answerIds.push(id); }
    }
    if (answerKey.answers?.length !== contract.answerKey?.caseCount) problems.push("context quality answer key caseCount does not match the answer-key document");
  }
  if (caseSet && answerKey && JSON.stringify(answerIds) !== JSON.stringify(caseIds)) problems.push("context quality answer key case IDs and order must match the case set");
  return { caseIds };
}

function validateContextArmResult(resultTarget, arm, label, suite, binding, evalDocument, caseContract, problems) {
  if (!resultTarget) return null;
  let result;
  try { result = readJson(resultTarget); }
  catch (error) {
    problems.push(`context comparison ${label} result document must be valid JSON: ${error.message}`);
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    problems.push(`context comparison ${label} result document must be an object`);
    return null;
  }
  const contract = binding.contract;
  const resultLabel = `context comparison ${label} result document`;
  if (result.schema !== CONTEXT_ARM_RESULT_SCHEMA) problems.push(`${resultLabel}.schema must be ${CONTEXT_ARM_RESULT_SCHEMA}`);
  if (result.suiteId !== contract.suiteId) problems.push(`${resultLabel}.suiteId must match the commissioned suite`);
  if (result.contextManifestSha256 !== binding.sha256) problems.push(`${resultLabel}.contextManifestSha256 must match context/manifest.json`);
  if (result.runId !== evalDocument.runId || result.profile !== evalDocument.profile || result.commit !== evalDocument.commit || result.environment !== evalDocument.environment) problems.push(`${resultLabel} run/profile/commit/environment must match evals/results.json`);
  if (result.contextMode !== arm.contextMode) problems.push(`${resultLabel}.contextMode must match the declared arm`);
  if (!qualityArtifactMatches(result.caseSet, contract.caseSet) || !qualityArtifactMatches(result.caseSet, arm.caseSet)) problems.push(`${resultLabel}.caseSet must match the arm and context manifest contract`);
  if (!qualityArtifactMatches(result.answerKey, contract.answerKey) || !qualityArtifactMatches(result.answerKey, arm.answerKey)) problems.push(`${resultLabel}.answerKey must match the arm and context manifest contract`);
  if (!namedIdentityMatches(result.evaluator, arm.evaluator) || !namedIdentityMatches(result.evaluator, suite.evaluator)) problems.push(`${resultLabel}.evaluator must match the arm and suite`);
  if (!modelIdentityMatches(result.model, arm.model) || !modelIdentityMatches(result.model, suite.model)) problems.push(`${resultLabel}.model must match the arm and suite`);
  if (result.promptVersion !== arm.promptVersion || result.promptVersion !== suite.promptVersion) problems.push(`${resultLabel}.promptVersion must match the arm and suite`);
  if (result.configDigest !== arm.configDigest || result.configDigest !== suite.configDigest) problems.push(`${resultLabel}.configDigest must match the arm and suite`);
  if (!exactFields(result.metric, contract.metric, ["id", "direction", "minDelta", "candidateThreshold"])) problems.push(`${resultLabel}.metric must match the context manifest contract`);

  const cases = Array.isArray(result.cases) ? result.cases : [];
  if (!Array.isArray(result.cases) || cases.length === 0) problems.push(`${resultLabel}.cases must be a non-empty array`);
  if (cases.length !== caseContract.caseIds.length) problems.push(`${resultLabel}.cases count must match the commissioned case set`);
  const seen = new Set();
  let scoreTotal = 0;
  let scoreCount = 0;
  let criticalRegressions = 0;
  for (const [index, entry] of cases.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${resultLabel}.cases[${index}] must be an object`);
      continue;
    }
    const caseId = nonEmpty(entry.caseId);
    if (!caseId || entry.caseId !== caseId) problems.push(`${resultLabel}.cases[${index}].caseId must be a canonical non-empty string`);
    else if (seen.has(caseId)) problems.push(`${resultLabel} case ID is duplicated: ${caseId}`);
    else seen.add(caseId);
    if (caseId !== caseContract.caseIds[index]) problems.push(`${resultLabel}.cases[${index}].caseId must match the commissioned case order`);
    if (!Number.isFinite(entry.value)) problems.push(`${resultLabel}.cases[${index}].value must be numeric`);
    else { scoreTotal += entry.value; scoreCount += 1; }
    if (typeof entry.criticalRegression !== "boolean") problems.push(`${resultLabel}.cases[${index}].criticalRegression must be boolean`);
    else if (entry.criticalRegression) criticalRegressions += 1;
  }
  const aggregate = result.aggregate;
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
    problems.push(`${resultLabel}.aggregate is required`);
    return null;
  }
  if (aggregate.method !== "arithmetic-mean") problems.push(`${resultLabel}.aggregate.method must be arithmetic-mean`);
  if (!Number.isInteger(aggregate.caseCount) || aggregate.caseCount !== cases.length || aggregate.caseCount !== caseContract.caseIds.length) problems.push(`${resultLabel}.aggregate.caseCount must match the evaluated cases`);
  const derivedValue = scoreCount === cases.length && scoreCount > 0 ? scoreTotal / scoreCount : null;
  if (!Number.isFinite(aggregate.value) || !Number.isFinite(derivedValue) || Math.abs(aggregate.value - derivedValue) > 1e-12) problems.push(`${resultLabel}.aggregate.value must equal the arithmetic mean of per-case values`);
  if (!Number.isInteger(aggregate.criticalRegressions) || aggregate.criticalRegressions !== criticalRegressions) problems.push(`${resultLabel}.aggregate.criticalRegressions must equal the per-case critical-regression count`);
  if (!Number.isFinite(arm.value) || !Number.isFinite(aggregate.value) || arm.value !== aggregate.value) problems.push(`context comparison ${label}.value must match the result document aggregate`);
  return { value: aggregate.value, criticalRegressions: aggregate.criticalRegressions };
}

function loadContextBinding(repoRoot, problems) {
  const manifestPath = resolveWithinRepo(repoRoot, "context/manifest.json");
  if (!manifestPath || !existingFileWithinRepo(repoRoot, manifestPath)) {
    problems.push("eval results require context/manifest.json as a real non-symlink file inside the repository");
    return null;
  }
  let manifest;
  try { manifest = readJson(manifestPath); }
  catch (error) {
    problems.push(`eval results context/manifest.json must be valid JSON: ${error.message}`);
    return null;
  }
  const validation = validateContextManifestDocument(manifest, { repoRoot });
  if (!validation.valid) {
    for (const problem of validation.problems) problems.push(`eval results context manifest invalid: ${problem}`);
    return null;
  }
  return { manifest, contract: manifest.contextQuality, sha256: sha256File(manifestPath) };
}

function validateContextComparison(suite, binding, evalDocument, repoRoot, problems) {
  const contract = binding.contract;
  const label = `eval suite ${contract.suiteId}`;
  const comparison = suite?.contextComparison;
  if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
    problems.push(`context quality comparison is required for suite ${contract.suiteId}`);
    return;
  }
  if (comparison.schema !== CONTEXT_COMPARISON_SCHEMA) problems.push(`${label} contextComparison.schema must be ${CONTEXT_COMPARISON_SCHEMA}`);
  if (comparison.contextManifestSha256 !== binding.sha256) problems.push(`${label} contextManifestSha256 must match context/manifest.json`);
  if (comparison.baselineMode !== contract.baselineMode) problems.push(`${label} baselineMode must match the context manifest contract`);
  if (!exactFields(comparison.metric, contract.metric, ["id", "direction", "minDelta", "candidateThreshold"])) problems.push(`${label} metric must match the context manifest contract`);
  if (!Number.isInteger(comparison.criticalRegressions) || comparison.criticalRegressions !== 0) problems.push(`${label} criticalRegressions must be 0`);
  const baseline = comparison.baseline || {};
  const candidate = comparison.candidate || {};
  const baselineResultTarget = validateContextArm(comparison.baseline, "baseline", repoRoot, problems);
  const candidateResultTarget = validateContextArm(comparison.candidate, "candidate", repoRoot, problems);
  if (baseline.contextMode !== contract.baselineMode) problems.push(`${label} baseline.contextMode must match the commissioned baselineMode`);
  if (candidate.contextMode !== "loaded-context") problems.push(`${label} candidate.contextMode must be loaded-context`);
  if (!qualityArtifactMatches(baseline.caseSet, contract.caseSet)) problems.push(`${label} baseline caseSet must match the context manifest contract`);
  if (!qualityArtifactMatches(candidate.caseSet, baseline.caseSet) || !qualityArtifactMatches(candidate.caseSet, contract.caseSet)) problems.push(`${label} candidate caseSet must match baseline and the context manifest contract`);
  if (!qualityArtifactMatches(baseline.answerKey, contract.answerKey)) problems.push(`${label} baseline answerKey must match the context manifest contract`);
  if (!qualityArtifactMatches(candidate.answerKey, baseline.answerKey) || !qualityArtifactMatches(candidate.answerKey, contract.answerKey)) problems.push(`${label} candidate answerKey must match baseline and the context manifest contract`);
  if (!namedIdentityMatches(baseline.evaluator, suite.evaluator)) problems.push(`${label} baseline evaluator must match suite evaluator`);
  if (!namedIdentityMatches(candidate.evaluator, baseline.evaluator) || !namedIdentityMatches(candidate.evaluator, suite.evaluator)) problems.push(`${label} candidate evaluator must match baseline and suite evaluator`);
  if (!modelIdentityMatches(baseline.model, suite.model)) problems.push(`${label} baseline model must match suite model`);
  if (!modelIdentityMatches(candidate.model, baseline.model) || !modelIdentityMatches(candidate.model, suite.model)) problems.push(`${label} candidate model must match baseline and suite model`);
  if (baseline.promptVersion !== suite.promptVersion) problems.push(`${label} baseline promptVersion must match suite promptVersion`);
  if (candidate.promptVersion !== baseline.promptVersion || candidate.promptVersion !== suite.promptVersion) problems.push(`${label} candidate promptVersion must match baseline and suite promptVersion`);
  if (baseline.configDigest !== suite.configDigest) problems.push(`${label} baseline configDigest must match suite configDigest`);
  if (candidate.configDigest !== baseline.configDigest || candidate.configDigest !== suite.configDigest) problems.push(`${label} candidate configDigest must match baseline and suite configDigest`);
  const dataset = (suite.datasets || []).find((entry) => entry?.id === contract.caseSet.id);
  if (!exactFields(dataset, contract.caseSet, ["id", "version", "sha256", "caseCount"])) problems.push(`${label} datasets must include the commissioned case set identity`);
  const rubric = (suite.rubrics || []).find((entry) => entry?.id === contract.answerKey.id);
  if (!exactFields(rubric, contract.answerKey, ["id", "version", "sha256"])) problems.push(`${label} rubrics must include the commissioned answer-key identity`);
  if (suite.resultPath !== candidate.resultPath || suite.resultDigest !== candidate.resultDigest || suite.value !== candidate.value) problems.push(`${label} suite result must be the loaded-context candidate result`);
  if (baseline.resultPath && candidate.resultPath && baseline.resultPath === candidate.resultPath) problems.push(`${label} baseline and candidate result paths must be distinct`);
  if (baseline.resultDigest && candidate.resultDigest && baseline.resultDigest === candidate.resultDigest) problems.push(`${label} baseline and candidate result digests must be distinct`);
  const cases = contextCaseContract(contract, repoRoot, problems);
  const baselineResult = validateContextArmResult(baselineResultTarget, baseline, "baseline", suite, binding, evalDocument, cases, problems);
  const candidateResult = validateContextArmResult(candidateResultTarget, candidate, "candidate", suite, binding, evalDocument, cases, problems);
  if (baselineResult && baselineResult.criticalRegressions !== 0) problems.push(`${label} baseline result must have zero critical regressions`);
  if (candidateResult && comparison.criticalRegressions !== candidateResult.criticalRegressions) problems.push(`${label} criticalRegressions must match the candidate result document`);
  if (candidateResult && suite.criticalFailures !== candidateResult.criticalRegressions) problems.push(`${label} suite criticalFailures must match the candidate result document`);
  const metric = contract.metric || {};
  const improvement = metric.direction === "lower-is-better" ? baseline.value - candidate.value : candidate.value - baseline.value;
  if (!Number.isFinite(comparison.delta) || !Number.isFinite(improvement) || Math.abs(comparison.delta - improvement) > 1e-12) problems.push(`${label} delta must equal the direction-aware candidate improvement`);
  if (!Number.isFinite(improvement) || improvement < metric.minDelta) problems.push(`${label} context candidate improvement does not meet minDelta`);
  const thresholdPassed = metric.direction === "lower-is-better" ? candidate.value <= metric.candidateThreshold : candidate.value >= metric.candidateThreshold;
  if (!thresholdPassed) problems.push(`${label} context candidate does not meet candidateThreshold`);
  const expectedOperator = metric.direction === "lower-is-better" ? "<=" : ">=";
  if (suite.operator !== expectedOperator || suite.threshold !== metric.candidateThreshold) problems.push(`${label} suite threshold/operator must match the direction-aware context metric`);
}

export function validateEvalResultsDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!document || typeof document !== "object" || Array.isArray(document)) return baseFailure(["eval results must be a JSON object"]);
  const problems = [];
  const contextBinding = loadContextBinding(repoRoot, problems);
  if (document.schema !== EVAL_RESULTS_SCHEMA) problems.push(`eval results schema must be ${EVAL_RESULTS_SCHEMA}`);
  if (!nonEmpty(document.runId)) problems.push("eval results runId is required");
  if (!PROFILES.has(document.profile)) problems.push("eval results profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("eval results commit is required");
  if (!nonEmpty(document.environment)) problems.push("eval results environment is required");
  if (!isIsoTimestamp(document.generatedAt)) problems.push("eval results generatedAt must be an ISO timestamp");

  if (document.status === "skipped") {
    if (!nonEmpty(document.skipReason)) problems.push("eval results skipped without skipReason");
    if (Array.isArray(document.suites) && document.suites.length > 0) problems.push("skipped eval results must not contain suites");
    if (contextBinding) problems.push(`context quality comparison is required for suite ${contextBinding.contract.suiteId}`);
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
    const resultTarget = canonicalEvalArtifactTarget(repoRoot, suite.resultPath, `${label}.resultPath`, problems);
    if (resultTarget && (!/^[a-f0-9]{64}$/i.test(nonEmpty(suite.resultDigest)) || sha256File(resultTarget) !== suite.resultDigest.toLowerCase())) problems.push(`${label}.resultDigest must match resultPath`);
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
  if (contextBinding) {
    const contextSuites = suites.filter((suite) => suite?.id === contextBinding.contract.suiteId);
    if (contextSuites.length !== 1) problems.push(`eval results must contain exactly one context quality suite: ${contextBinding.contract.suiteId}`);
    else validateContextComparison(contextSuites[0], contextBinding, document, repoRoot, problems);
    for (const suite of suites) if (suite?.id !== contextBinding.contract.suiteId && suite?.contextComparison) problems.push(`eval suite ${suite.id || "unknown"} has an uncommissioned contextComparison`);
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
