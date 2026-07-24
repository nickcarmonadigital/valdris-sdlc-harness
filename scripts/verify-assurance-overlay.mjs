#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(ROOT, "scripts", "schema-compat-gate.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runGate(repoRoot) {
  return spawnSync(process.execPath, [GATE, "--repo", repoRoot], {
    encoding: "utf8",
  });
}

function mutateJson(root, relativePath, mutate) {
  const target = path.join(root, relativePath);
  const document = JSON.parse(readFileSync(target, "utf8"));
  mutate(document);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
}

function expectFailure(label, relativePath, mutate, expectedDiagnostic) {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "valdris-assurance-overlay-"),
  );
  try {
    cpSync(path.join(ROOT, "controls"), path.join(root, "controls"), {
      recursive: true,
    });
    mutateJson(root, relativePath, mutate);
    const result = runGate(root);
    const output = `${result.stdout}\n${result.stderr}`;
    assert(result.status !== 0, `${label} was accepted`);
    assert(
      output.includes(expectedDiagnostic),
      `${label} did not report ${expectedDiagnostic}:\n${output}`,
    );
    return label;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const result = runGate(ROOT);
  assert(
    result.status === 0,
    `valid assurance overlay was rejected:\n${result.stdout}\n${result.stderr}`,
  );
  const output = JSON.parse(result.stdout);
  assert(output.ok === true, "valid assurance overlay did not report ok");
  assert(
    output.sourceControls === 61,
    `expected 61 source controls, received ${output.sourceControls}`,
  );
  assert(
    output.policyControls === 39,
    `expected 39 policy controls, received ${output.policyControls}`,
  );
  assert(
    output.capabilityControls === 5,
    `expected 5 async capability controls, received ${output.capabilityControls}`,
  );
  assert(
    output.executionPolicyConsumed === true,
    "schema validation did not consume execution-policy metadata",
  );
  assert(
    output.routedConcern === "async-workflow-orchestration",
    "async pack is not bound to the workload router concern",
  );
  const crosswalk = "controls/crosswalks/thirteen-layers-to-uash.v1.json";
  const policy = "controls/assurance-execution-policy.v1.json";
  const asyncPack = "controls/capability-packs/async-workflows.v1.json";
  const rejected = [
    expectFailure(
      "duplicate source control",
      crosswalk,
      (document) => {
        document.mappings.push(structuredClone(document.mappings[0]));
      },
      "duplicate source control mapping",
    ),
    expectFailure(
      "unmapped source control",
      crosswalk,
      (document) => {
        document.mappings = document.mappings.filter(
          (mapping) => mapping.sourceControlId !== "L01.FRONTEND.STATES.001",
        );
      },
      "unmapped source control",
    ),
    expectFailure(
      "unknown local target",
      crosswalk,
      (document) => {
        document.mappings[0].targetControlIds = ["UNKNOWN-CONTROL-001"];
      },
      "references unknown target control",
    ),
    expectFailure(
      "incomplete state mapping",
      crosswalk,
      (document) => {
        document.stateMapping.sourceToUash =
          document.stateMapping.sourceToUash.filter(
            (mapping) => mapping.source !== "WAIVED",
          );
      },
      "source-to-UASH state mappings must contain exactly",
    ),
    expectFailure(
      "WAIVED converted to pass",
      crosswalk,
      (document) => {
        const waived = document.stateMapping.sourceToUash.find(
          (mapping) => mapping.source === "WAIVED",
        );
        waived.controlStatus = "passed";
        waived.countsAsPass = true;
      },
      "WAIVED must remain a separate human-approved waiver-ledger state and must never be passed",
    ),
    expectFailure(
      "unknown effective tier",
      policy,
      (document) => {
        document.controls[0].minimumEffectiveTier = "T4";
      },
      "minimumEffectiveTier is not in the T0-T3 catalog vocabulary",
    ),
    expectFailure(
      "unsafe applicability path",
      policy,
      (document) => {
        document.controls[0].applicability.anyChangedPath = ["../private/**"];
      },
      "contains unsafe or invalid path",
    ),
    expectFailure(
      "Layer 14 async reference",
      asyncPack,
      (document) => {
        document.controls[0].mappedProductionLayers.push("layer-14");
      },
      "references unknown production layer: layer-14",
    ),
    expectFailure(
      "semantic target swap",
      crosswalk,
      (document) => {
        const accessibility = document.mappings.find(
          (mapping) =>
            mapping.sourceControlId === "L01.ACCESSIBILITY.BASELINE.001",
        );
        const apiContract = document.mappings.find(
          (mapping) => mapping.sourceControlId === "L02.API.CONTRACT.001",
        );
        [accessibility.targetControlIds, apiContract.targetControlIds] = [
          apiContract.targetControlIds,
          accessibility.targetControlIds,
        ];
      },
      "crosswalk semantic integrity mismatch",
    ),
    expectFailure(
      "source-file membership swap",
      crosswalk,
      (document) => {
        const frontend = document.source.files.find((file) =>
          file.path.includes("L01-frontend"),
        );
        const backend = document.source.files.find((file) =>
          file.path.includes("L02-apis"),
        );
        [frontend.controlIds[0], backend.controlIds[0]] = [
          backend.controlIds[0],
          frontend.controlIds[0],
        ];
      },
      "crosswalk semantic integrity mismatch",
    ),
    expectFailure(
      "execution-policy semantic downgrade",
      policy,
      (document) => {
        const performance = document.controls.find(
          (control) => control.controlId === "FE-PERFORMANCE-001",
        );
        performance.minimumEffectiveTier = "T0";
        performance.lifecycleStages = ["specify"];
        performance.applicability.anyChangedPath = ["**/docs/**"];
        performance.requiredEvidence = { runtime: ["docs-only-review"] };
      },
      "execution policy semantic integrity mismatch",
    ),
    expectFailure(
      "alert tier regression",
      policy,
      (document) => {
        document.controls.find(
          (control) => control.controlId === "OBS-SLO-001",
        ).minimumEffectiveTier = "T2";
      },
      "execution policy semantic integrity mismatch",
    ),
    expectFailure(
      "T1 backup coverage regression",
      crosswalk,
      (document) => {
        const backup = document.mappings.find(
          (mapping) => mapping.sourceControlId === "L13.RECOVERY.BACKUP.001",
        );
        backup.targetControlIds = backup.targetControlIds.filter(
          (id) => id !== "DR-OBJECTIVES-001",
        );
      },
      "crosswalk semantic integrity mismatch",
    ),
    expectFailure(
      "overstated equivalence regression",
      crosswalk,
      (document) => {
        const processInventory = document.mappings.find(
          (mapping) => mapping.sourceControlId === "L06.COMPUTE.PROCESS.001",
        );
        processInventory.relationship = "equivalent";
        delete processInventory.targetExtension;
      },
      "crosswalk semantic integrity mismatch",
    ),
  ];
  console.log(
    JSON.stringify(
      {
        ok: true,
        seam: "schema-compat-gate CLI",
        positiveTests: 1,
        negativeTests: rejected.length,
        rejected,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
