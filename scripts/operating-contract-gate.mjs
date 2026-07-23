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
  AI_ECONOMICS_LEDGER_SCHEMA,
  DECISION_EVIDENCE_SCHEMA,
  INTEROP_TRANSCRIPT_SCHEMA,
  MODEL_JUDGE_CALIBRATION_SCHEMA,
  REQUIREMENTS_CONTRACT_SCHEMA,
  RUNTIME_DRIVER_SCHEMA,
  TOOL_REGISTRY_SCHEMA,
  validateAiEconomicsLedgerDocument,
  validateDecisionEvidenceDocument,
  validateInteropTranscriptDocument,
  validateModelJudgeCalibrationDocument,
  validateRequirementsContractDocument,
  validateRuntimeDriverDocument,
  validateToolRegistryDocument,
} from "./operating-contracts-lib.mjs";
import {
  assertCanonicalRepoRelativePath,
  fileSha256,
  resolveArtifactPath,
} from "./proof-runner.mjs";

export function validateOperatingContract(filePath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  try {
    const document = readJson(filePath);
    let result;
    if (document.schema === REQUIREMENTS_CONTRACT_SCHEMA) {
      const readiness = readJson(
        resolveArtifactPath(repoRoot, "run/implementation-readiness.json", {
          mustExist: true,
        }),
      );
      const goal = readJson(
        resolveArtifactPath(repoRoot, "goal/goal.json", { mustExist: true }),
      );
      result = validateRequirementsContractDocument(document, {
        redBaselines: readiness.redBaselines,
        evalPlan: readiness.evalPlan,
        goal,
      });
    } else if (document.schema === TOOL_REGISTRY_SCHEMA)
      result = validateToolRegistryDocument(document);
    else if (document.schema === MODEL_JUDGE_CALIBRATION_SCHEMA)
      result = validateModelJudgeCalibrationDocument(document, {
        now: options.now,
      });
    else if (document.schema === AI_ECONOMICS_LEDGER_SCHEMA)
      result = validateAiEconomicsLedgerDocument(document);
    else if (document.schema === INTEROP_TRANSCRIPT_SCHEMA)
      result = validateInteropTranscriptDocument(document);
    else if (document.schema === RUNTIME_DRIVER_SCHEMA) {
      const goalSha256 = fileSha256(
        resolveArtifactPath(repoRoot, "goal/goal.json", { mustExist: true }),
      );
      result = validateRuntimeDriverDocument(document, {
        repoRoot,
        goalSha256,
      });
    } else if (document.schema === DECISION_EVIDENCE_SCHEMA)
      result = validateDecisionEvidenceDocument(document);
    else
      result = {
        valid: false,
        problems: [`unsupported operating-contract schema: ${document.schema}`],
      };
    return {
      checked: true,
      schema: document.schema || null,
      ...result,
    };
  } catch (error) {
    return {
      checked: true,
      valid: false,
      schema: null,
      problems: [`operating contract is invalid: ${error.message}`],
    };
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: "run/requirements-contract.json",
  });
  if (args.help) {
    console.log(
      "Usage: node scripts/operating-contract-gate.mjs --repo . --file <contract.json>",
    );
    return;
  }
  const repoRoot = path.resolve(args.repo);
  assertCanonicalRepoRelativePath(args.file, "operating contract path");
  const target = resolveArtifactPath(repoRoot, args.file, { mustExist: false });
  if (!existsSync(target))
    return gateResult(args.file, {
      checked: true,
      valid: false,
      schema: null,
      problems: [`operating contract missing: ${args.file}`],
    });
  gateResult(
    args.file,
    validateOperatingContract(target, {
      repoRoot,
      now: new Date().toISOString(),
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      JSON.stringify({ ok: false, problems: [error.message] }, null, 2),
    );
    process.exit(1);
  });
