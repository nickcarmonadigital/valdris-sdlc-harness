#!/usr/bin/env node
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
