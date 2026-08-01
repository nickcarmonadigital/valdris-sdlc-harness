#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateResult,
  parseRepoFileArgs,
  readJson,
} from "./control-gate-lib.mjs";
import {
  validateClassificationRecord,
  validateTerminologyPolicy,
} from "./terminology-policy-lib.mjs";

export function validateTerminologyFiles(recordPath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const policyPath = path.resolve(
    repoRoot,
    options.policyFile || "controls/terminology-policy.v1.json",
  );
  const problems = [];
  if (!existsSync(policyPath))
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: [
        `terminology policy missing: ${path.relative(repoRoot, policyPath)}`,
      ],
    };
  if (!existsSync(recordPath))
    return {
      checked: true,
      valid: false,
      structuralOnly: true,
      problems: [
        `ontology classification record missing: ${path.relative(repoRoot, recordPath)}`,
      ],
    };
  try {
    const policy = readJson(policyPath);
    const record = readJson(recordPath);
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
      disclaimer: policy.structural_gate_disclaimer,
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
    catalog: "controls/terminology-policy.v1.json",
  });
  if (args.help)
    return console.log(
      "Usage: node scripts/terminology-gate.mjs --repo . [--file classification/classification.json] [--catalog controls/terminology-policy.v1.json]",
    );
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  gateResult(
    args.file,
    validateTerminologyFiles(target, {
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
