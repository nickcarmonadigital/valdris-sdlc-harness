#!/usr/bin/env node
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  resolveWithinRepo,
  sha256File,
} from "./control-gate-lib.mjs";
import { assertCanonicalRepoRelativePath } from "./proof-runner.mjs";

export const CONTEXT_MANIFEST_SCHEMA = "uash.context-manifest.v2";
export const CONTEXT_MANIFEST_SCHEMA_V1 = "uash.context-manifest.v1";
export const CONTEXT_QUALITY_SCHEMA = "uash.context-quality-eval.v1";
const PROFILES = new Set([
  "prototype",
  "production",
  "enterprise",
  "regulated",
]);
const CONTEXT_BASELINE_MODES = new Set(["no-context", "limited-context"]);
const METRIC_DIRECTIONS = new Set(["higher-is-better", "lower-is-better"]);
const CONTEXT_KINDS = new Set([
  "instructions",
  "knowledge",
  "memory",
  "examples",
  "tools",
  "guardrails",
]);
const LOAD_MODES = new Set(["static", "dynamic"]);

function isSecretLike(relativePath) {
  const segments = relativePath
    .replaceAll("\\", "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  return segments.some(
    (segment) =>
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment === ".npmrc" ||
      segment === ".pypirc" ||
      segment === "kubeconfig" ||
      /^(credentials?|secrets?|keys?|service[-_]?account)(\..+)?$/.test(
        segment,
      ) ||
      /\.(pem|p12|pfx|key|jks|keystore)$/.test(segment),
  );
}

function isRealPathWithinRepo(repoRoot, target) {
  const root = realpathSync(repoRoot);
  const realTarget = realpathSync(target);
  const relative = path.relative(root, realTarget);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function baseFailure(problems) {
  return {
    checked: true,
    valid: false,
    schema: null,
    loadedFileCount: 0,
    problems,
  };
}

function resolveContextFileReference(repoRoot, relativePath, label, problems) {
  const initialProblemCount = problems.length;
  try {
    assertCanonicalRepoRelativePath(relativePath, label);
  } catch (error) {
    problems.push(error.message);
    return null;
  }
  if (isSecretLike(relativePath))
    problems.push(
      `${label} is secret-like and must not be loaded: ${relativePath}`,
    );
  const target = resolveWithinRepo(repoRoot, relativePath);
  if (!target) {
    problems.push(`${label} must stay inside the repository`);
    return null;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    problems.push(
      `${label} must be a real non-symlink file inside the repository`,
    );
    return null;
  }

  const root = path.resolve(repoRoot);
  const targetRelative = path.relative(root, target);
  let cursor = root;
  for (const component of targetRelative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (lstatSync(cursor).isSymbolicLink()) {
      problems.push(
        `${label} contains a symbolic-link component and must be a real non-symlink file inside the repository`,
      );
      break;
    }
  }

  if (!isRealPathWithinRepo(repoRoot, target)) {
    problems.push(`${label} resolves outside the repository`);
    return null;
  }
  const canonicalRelativePath = path
    .relative(realpathSync(repoRoot), realpathSync(target))
    .split(path.sep)
    .join("/");
  if (
    isSecretLike(canonicalRelativePath) &&
    canonicalRelativePath !== relativePath.replaceAll("\\", "/")
  ) {
    problems.push(
      `${label} canonical target is secret-like and must not be loaded: ${canonicalRelativePath}`,
    );
  }
  return problems.length === initialProblemCount ? target : null;
}

function validateQualityArtifact(entry, label, repoRoot, problems) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    problems.push(`${label} must be an object`);
    return;
  }
  if (!nonEmpty(entry.id)) problems.push(`${label}.id is required`);
  if (!nonEmpty(entry.version)) problems.push(`${label}.version is required`);
  if (!Number.isInteger(entry.caseCount) || entry.caseCount <= 0)
    problems.push(`${label}.caseCount must be a positive integer`);
  const relativePath = nonEmpty(entry.path);
  if (!relativePath) {
    problems.push(`${label}.path is required`);
    return;
  }
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(entry.sha256)))
    problems.push(`${label}.sha256 must be a SHA-256 hex digest`);
  const target = resolveContextFileReference(
    repoRoot,
    relativePath,
    `${label}.path`,
    problems,
  );
  if (!target) return;
  if (
    /^[a-f0-9]{64}$/i.test(nonEmpty(entry.sha256)) &&
    sha256File(target) !== entry.sha256.toLowerCase()
  )
    problems.push(`${label}.sha256 does not match ${relativePath}`);
}

export function validateContextQualityContract(contract, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const problems = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract))
    return {
      valid: false,
      problems: [
        "context manifest contextQuality is required when loadedFiles are present",
      ],
    };
  if (contract.schema !== CONTEXT_QUALITY_SCHEMA)
    problems.push(
      `context manifest contextQuality.schema must be ${CONTEXT_QUALITY_SCHEMA}`,
    );
  if (!nonEmpty(contract.suiteId))
    problems.push("context manifest contextQuality.suiteId is required");
  if (!CONTEXT_BASELINE_MODES.has(contract.baselineMode))
    problems.push(
      "context manifest contextQuality.baselineMode must be no-context or limited-context",
    );
  validateQualityArtifact(
    contract.caseSet,
    "context manifest contextQuality.caseSet",
    repoRoot,
    problems,
  );
  validateQualityArtifact(
    contract.answerKey,
    "context manifest contextQuality.answerKey",
    repoRoot,
    problems,
  );
  if (
    contract.caseSet?.path &&
    contract.caseSet.path === contract.answerKey?.path
  )
    problems.push(
      "context manifest contextQuality caseSet and answerKey must use distinct paths",
    );
  if (
    Number.isInteger(contract.caseSet?.caseCount) &&
    Number.isInteger(contract.answerKey?.caseCount) &&
    contract.caseSet.caseCount !== contract.answerKey.caseCount
  )
    problems.push(
      "context manifest contextQuality answerKey.caseCount must match caseSet.caseCount",
    );
  if (
    !contract.metric ||
    typeof contract.metric !== "object" ||
    Array.isArray(contract.metric)
  )
    problems.push("context manifest contextQuality.metric must be an object");
  else {
    if (!nonEmpty(contract.metric.id))
      problems.push("context manifest contextQuality.metric.id is required");
    if (!METRIC_DIRECTIONS.has(contract.metric.direction))
      problems.push(
        "context manifest contextQuality.metric.direction must be higher-is-better or lower-is-better",
      );
    if (
      !Number.isFinite(contract.metric.minDelta) ||
      contract.metric.minDelta <= 0
    )
      problems.push(
        "context manifest contextQuality.metric.minDelta must be greater than 0",
      );
    if (!Number.isFinite(contract.metric.candidateThreshold))
      problems.push(
        "context manifest contextQuality.metric.candidateThreshold must be numeric",
      );
  }
  return {
    valid: problems.length === 0,
    schema: contract.schema,
    suiteId: contract.suiteId,
    problems,
  };
}

export function validateContextManifestDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!document || typeof document !== "object" || Array.isArray(document))
    return baseFailure(["context manifest must be a JSON object"]);
  const problems = [];
  if (
    ![CONTEXT_MANIFEST_SCHEMA_V1, CONTEXT_MANIFEST_SCHEMA].includes(
      document.schema,
    )
  )
    problems.push(
      `context manifest schema must be ${CONTEXT_MANIFEST_SCHEMA_V1} or ${CONTEXT_MANIFEST_SCHEMA}`,
    );
  if (!isIsoTimestamp(document.generatedAt))
    problems.push("context manifest generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId))
    problems.push("context manifest runId is required");
  if (!PROFILES.has(document.profile))
    problems.push("context manifest profile is invalid");
  if (!nonEmpty(document.environment))
    problems.push("context manifest environment is required");
  if (!nonEmpty(document.commit))
    problems.push("context manifest commit is required");

  const loadedFiles = Array.isArray(document.loadedFiles)
    ? document.loadedFiles
    : [];
  if (!Array.isArray(document.loadedFiles) || loadedFiles.length === 0)
    problems.push("context manifest loadedFiles must be a non-empty array");
  const seen = new Set();
  for (const [index, entry] of loadedFiles.entries()) {
    const label = `context manifest loadedFiles[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const relativePath = nonEmpty(entry.path);
    if (!relativePath) {
      problems.push(`${label}.path is required`);
      continue;
    }
    const normalized = relativePath.replaceAll("\\", "/");
    if (seen.has(normalized))
      problems.push(`context manifest loaded file duplicated: ${relativePath}`);
    else seen.add(normalized);
    if (!/^[a-f0-9]{64}$/i.test(nonEmpty(entry.sha256)))
      problems.push(`${label}.sha256 must be a SHA-256 hex digest`);
    if (!isIsoTimestamp(entry.loadedAt))
      problems.push(`${label}.loadedAt must be an ISO timestamp`);
    if (
      isIsoTimestamp(entry.loadedAt) &&
      isIsoTimestamp(document.generatedAt) &&
      Date.parse(entry.loadedAt) > Date.parse(document.generatedAt)
    ) {
      problems.push(`${label}.loadedAt must not be after generatedAt`);
    }

    const target = resolveContextFileReference(
      repoRoot,
      relativePath,
      `${label}.path`,
      problems,
    );
    if (!target) continue;
    if (
      /^[a-f0-9]{64}$/i.test(nonEmpty(entry.sha256)) &&
      sha256File(target) !== entry.sha256.toLowerCase()
    ) {
      problems.push(`${label}.sha256 does not match ${relativePath}`);
    }
    if (document.schema === CONTEXT_MANIFEST_SCHEMA) {
      if (!CONTEXT_KINDS.has(entry.kind))
        problems.push(`${label}.kind is invalid`);
      if (!LOAD_MODES.has(entry.loadMode))
        problems.push(`${label}.loadMode is invalid`);
      if (!nonEmpty(entry.purpose))
        problems.push(`${label}.purpose is required`);
      if (!nonEmpty(entry.owner)) problems.push(`${label}.owner is required`);
      if (!nonEmpty(entry.version))
        problems.push(`${label}.version is required`);
      if (!Number.isSafeInteger(entry.tokenEstimate) || entry.tokenEstimate < 1)
        problems.push(`${label}.tokenEstimate must be a positive integer`);
      if (entry.loadMode === "dynamic" && !nonEmpty(entry.trigger))
        problems.push(`${label}.trigger is required for dynamic context`);
      if (entry.loadMode === "static" && entry.trigger !== undefined)
        problems.push(`${label}.trigger is only allowed for dynamic context`);
    }
  }

  if (document.schema === CONTEXT_MANIFEST_SCHEMA) {
    const budget = document.budget;
    if (!budget || typeof budget !== "object" || Array.isArray(budget))
      problems.push("context manifest budget is required for v2");
    else {
      if (!Number.isSafeInteger(budget.maxTokens) || budget.maxTokens < 1)
        problems.push("context manifest budget.maxTokens must be positive");
      if (
        !Number.isSafeInteger(budget.staticMaxTokens) ||
        budget.staticMaxTokens < 1 ||
        budget.staticMaxTokens > budget.maxTokens
      )
        problems.push(
          "context manifest budget.staticMaxTokens must be positive and no greater than maxTokens",
        );
      const total = loadedFiles.reduce(
        (sum, entry) =>
          sum +
          (Number.isSafeInteger(entry?.tokenEstimate)
            ? entry.tokenEstimate
            : 0),
        0,
      );
      const staticTotal = loadedFiles
        .filter((entry) => entry?.loadMode === "static")
        .reduce(
          (sum, entry) =>
            sum +
            (Number.isSafeInteger(entry?.tokenEstimate)
              ? entry.tokenEstimate
              : 0),
          0,
        );
      if (Number.isSafeInteger(budget.maxTokens) && total > budget.maxTokens)
        problems.push(
          "context manifest loaded context exceeds budget.maxTokens",
        );
      if (
        Number.isSafeInteger(budget.staticMaxTokens) &&
        staticTotal > budget.staticMaxTokens
      )
        problems.push(
          "context manifest static context exceeds budget.staticMaxTokens",
        );
      if (budget.loadedTokens !== total)
        problems.push(
          "context manifest budget.loadedTokens must equal loadedFiles token estimates",
        );
    }
  }

  const contextQuality = validateContextQualityContract(
    document.contextQuality,
    { repoRoot },
  );
  problems.push(...contextQuality.problems);

  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    commit: document.commit,
    runId: document.runId,
    loadedFileCount: loadedFiles.length,
    contextQualitySuiteId: contextQuality.suiteId || null,
    problems,
  };
}

export function validateContextManifest(filePath, options = {}) {
  try {
    return validateContextManifestDocument(readJson(filePath), options);
  } catch (error) {
    return baseFailure([
      `context manifest must be valid JSON: ${error.message}`,
    ]);
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: "context/manifest.json",
  });
  if (args.help) {
    console.log(
      "Usage: node scripts/context-manifest-gate.mjs --repo . [--file context/manifest.json]",
    );
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target))
    return gateResult(
      args.file,
      baseFailure([`context manifest missing: ${args.file}`]),
    );
  gateResult(args.file, validateContextManifest(target, { repoRoot }));
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
