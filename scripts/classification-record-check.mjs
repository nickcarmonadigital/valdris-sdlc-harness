#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  existingFileWithinRepo,
  gateResult,
  parseRepoFileArgs,
  readJson,
  resolveWithinRepo,
} from "./control-gate-lib.mjs";
import {
  validateClassificationRecord,
  validateTerminologyPolicy,
} from "./terminology-policy-lib.mjs";

const GIT_REPOSITORY_ENVIRONMENT = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIFF_OPTS",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_QUARANTINE_PATH",
  "GIT_REPLACE_REF_BASE",
  "GIT_WORK_TREE",
];

function isolatedGitEnvironment() {
  const environment = { ...process.env };
  for (const key of GIT_REPOSITORY_ENVIRONMENT) delete environment[key];
  for (const key of Object.keys(environment))
    if (key.startsWith("GIT_CONFIG_")) delete environment[key];
  environment.GIT_NO_LAZY_FETCH = "1";
  return environment;
}

function gitRegularBlobBytes(repoRoot, revision, repositoryPath) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision)) return null;
  const options = {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    killSignal: "SIGTERM",
    env: isolatedGitEnvironment(),
  };
  const type = spawnSync(
    "git",
    ["--no-replace-objects", "-C", repoRoot, "cat-file", "-t", revision],
    options,
  );
  if (type.status !== 0 || type.stdout.trim() !== "commit") return null;
  const result = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "-C",
      repoRoot,
      "--literal-pathspecs",
      "ls-tree",
      "-z",
      revision,
      "--",
      repositoryPath,
    ],
    options,
  );
  if (
    result.status !== 0 ||
    !/^(?:100644|100755) blob [0-9a-f]+\t[^\0]+\0$/i.test(result.stdout)
  )
    return null;
  const bytes = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "-C",
      repoRoot,
      "show",
      `${revision}:${repositoryPath}`,
    ],
    {
      ...options,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return bytes.status === 0 ? bytes.stdout : null;
}

function currentFileMatchesDigest(filePath, revision) {
  const match = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(revision);
  if (!match) return false;
  const digest = createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
  return digest === match[1].toLowerCase();
}

export function declaredLocalEvidenceBytes(repoRoot, evidence) {
  if (evidence?.origin !== "local") return null;
  const repositoryPath = evidence.repositoryPath;
  const revision = evidence.revision;
  if (typeof repositoryPath !== "string" || typeof revision !== "string")
    return null;
  const committedBytes = gitRegularBlobBytes(
    repoRoot,
    revision,
    repositoryPath,
  );
  if (committedBytes) return committedBytes;
  const resolvedPath = resolveWithinRepo(repoRoot, repositoryPath);
  if (
    resolvedPath &&
    existingFileWithinRepo(repoRoot, resolvedPath) &&
    currentFileMatchesDigest(resolvedPath, revision)
  )
    return readFileSync(resolvedPath);
  return null;
}

function validateLocalEvidenceBindings(record, repoRoot) {
  const problems = [];
  for (const evidence of record.evidence || []) {
    if (evidence?.origin !== "local") continue;
    const evidenceId = evidence.id || "missing";
    if (!declaredLocalEvidenceBytes(repoRoot, evidence))
      problems.push(
        `local evidence ${evidenceId} repositoryPath is not bound to the declared Git revision or SHA-256 digest`,
      );
  }
  return problems;
}

export function validateClassificationRecordFiles(recordPath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const policyPath = resolveWithinRepo(
    repoRoot,
    options.policyFile || "policies/technical-communication.v1.json",
  );
  const resolvedRecordPath =
    typeof recordPath === "string"
      ? resolveWithinRepo(repoRoot, recordPath)
      : null;
  const problems = [];
  if (!policyPath)
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: ["terminology policy path must stay within the repository"],
    };
  if (!resolvedRecordPath)
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: [
        "ontology classification record path must stay within the repository",
      ],
    };
  if (!existingFileWithinRepo(repoRoot, policyPath))
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: [
        `terminology policy missing or unsafe: ${path.relative(repoRoot, policyPath)}`,
      ],
    };
  if (!existingFileWithinRepo(repoRoot, resolvedRecordPath))
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: [
        `ontology classification record missing or unsafe: ${path.relative(repoRoot, resolvedRecordPath)}`,
      ],
    };
  try {
    const policy = readJson(policyPath);
    const record = readJson(resolvedRecordPath);
    problems.push(...validateTerminologyPolicy(policy));
    if (problems.length === 0)
      problems.push(...validateClassificationRecord(record, policy));
    if (problems.length === 0)
      problems.push(...validateLocalEvidenceBindings(record, repoRoot));
    return {
      checked: true,
      valid: problems.length === 0,
      structuralOnly: true,
      schema: record.schema,
      subject: record.subject?.name,
      selectedTerm: record.selectedTerm,
      termStatus: record.termStatus,
      classificationStatus: record.classificationStatus,
      webVerification: record.webVerification?.status,
      disclaimer: policy.record_check_disclaimer,
      problems,
    };
  } catch (error) {
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: [
        `terminology policy and classification record must be valid JSON: ${error.message}`,
      ],
    };
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: "classification/classification.json",
    catalog: "policies/technical-communication.v1.json",
  });
  if (args.help)
    return console.log(
      "Usage: node scripts/classification-record-check.mjs --repo . [--file classification/classification.json] [--catalog policies/technical-communication.v1.json]",
    );
  const repoRoot = path.resolve(args.repo);
  const target = resolveWithinRepo(repoRoot, args.file);
  gateResult(
    args.file,
    validateClassificationRecordFiles(target, {
      repoRoot,
      policyFile: args.catalog,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
