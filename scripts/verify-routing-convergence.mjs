#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function run(script, args) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", script), ...args],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

function routeCase(
  tempRoot,
  [id, request, expectedType, expectedPrimary, inspect = () => true],
) {
  const repo = path.join(tempRoot, `route-${id}`);
  mkdirSync(repo, { recursive: true });
  const result = run("route-request.mjs", [
    "--repo",
    repo,
    "--run-id",
    `CONVERGENCE-${id}`,
    "--profile",
    "production",
    "--request",
    request,
  ]);
  assert(
    result.status === 0,
    `${id} route creation failed: ${output(result).slice(-1000)}`,
  );
  const classification = JSON.parse(
    readFileSync(
      path.join(repo, "run", "workload-classification.json"),
      "utf8",
    ),
  );
  const route = JSON.parse(
    readFileSync(path.join(repo, "run", "route.json"), "utf8"),
  );
  const intake = JSON.parse(
    readFileSync(path.join(repo, "run", "intake.json"), "utf8"),
  );
  assert(
    classification.taskType === expectedType,
    `${id} classified as ${classification.taskType}`,
  );
  assert(
    route.skillPhases[1].primary === expectedPrimary,
    `${id} routed to ${route.skillPhases[1].primary}`,
  );
  assert(
    inspect(route, classification, intake),
    `${id} route-specific assurance failed`,
  );
  for (const gate of [
    "intake-gate.mjs",
    "workload-classification-gate.mjs",
    "route-gate.mjs",
  ]) {
    const gateResult = run(gate, ["--repo", repo]);
    assert(
      gateResult.status === 0,
      `${id} failed ${gate}: ${output(gateResult).slice(-1000)}`,
    );
  }
}

export const ROUTING_CONVERGENCE_CASE_IDS = Object.freeze([
  "ambiguous-intake",
  "audit",
  "feature",
  "bug-rca",
  "architecture",
  "security",
  "platform-release",
  "genai",
  "proof-handoff",
  "manual-provider-change",
  "manual-data-change",
  "documentation-only",
  "mixed-intent",
  "manual-bug-precedence",
]);

const routeCases = [
  [
    "ambiguous-intake",
    "Fix it",
    "ambiguous",
    "valdris-intake-route",
    (_route, classification, intake) =>
      classification.materialUnknowns.some(
        ({ id }) => id === "scope-definition",
      ) && !intake.allowedActions.includes("create scoped branch changes"),
  ],
  [
    "audit",
    "Audit this repository end to end",
    "audit",
    "valdris-intake-route",
  ],
  [
    "feature",
    "Build a full-stack customer portal",
    "feature",
    "valdris-feature-delivery",
  ],
  ["bug-rca", "Fix the duplicate retry bug", "bug", "valdris-bug-rca"],
  [
    "architecture",
    "Refactor the service module boundaries",
    "architecture-refactor",
    "valdris-architecture-refactor",
  ],
  [
    "security",
    "Audit authorization and tenant isolation",
    "security",
    "valdris-security-audit",
  ],
  [
    "platform-release",
    "Ship the current build to TestFlight",
    "platform-release",
    "valdris-platform-release",
  ],
  ["genai", "Audit our RAG model quality", "genai", "valdris-genai-assurance"],
  [
    "proof-handoff",
    "Verify this is ready to merge",
    "proof-handoff",
    "valdris-proof-handoff",
  ],
  [
    "manual-provider-change",
    "Manually change production provider configuration",
    "platform-release",
    "valdris-platform-release",
    (route) => route.gateApplicability.smoke.status === "required",
  ],
  [
    "manual-data-change",
    "Manually change production customer data",
    "platform-release",
    "valdris-platform-release",
    (route) => route.gateApplicability.smoke.status === "required",
  ],
  [
    "documentation-only",
    "Write a README",
    "docs-only",
    "valdris-intake-route",
    (route) => route.gateApplicability.foundation.status === "not-applicable",
  ],
  [
    "mixed-intent",
    "Fix the retry bug and deploy the repair",
    "bug",
    "valdris-bug-rca",
    (route) =>
      route.skillPhases[1].supporting.includes("valdris-platform-release") &&
      route.gateApplicability.smoke.status === "required",
  ],
  [
    "manual-bug-precedence",
    "Fix the duplicate retry bug by manually changing customer data in production",
    "bug",
    "valdris-bug-rca",
    (route) =>
      route.skillPhases[1].supporting.includes("valdris-platform-release") &&
      route.gateApplicability.smoke.status === "required",
  ],
];

function main() {
  assert(
    JSON.stringify(routeCases.map(([id]) => id)) ===
      JSON.stringify(ROUTING_CONVERGENCE_CASE_IDS),
    "routing case registry drifted",
  );
  const tempRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "valdris-routing-convergence-")),
  );
  try {
    for (const route of routeCases) routeCase(tempRoot, route);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        gate: "routing-convergence",
        cases: ROUTING_CONVERGENCE_CASE_IDS,
      },
      null,
      2,
    ),
  );
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url))
  main();
