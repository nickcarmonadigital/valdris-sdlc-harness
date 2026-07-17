#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checks = [];

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
}

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function runNode(relativePath, args = [], cwd = ROOT) {
  return spawnSync(process.execPath, [path.join(ROOT, relativePath), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
}

function includesEvery(text, values) {
  return values.every((value) => text.includes(value));
}

const requiredScripts = [
  "provenance-gate.mjs",
  "neutrality-gate.mjs",
  "privacy-gate.mjs",
  "schema-compat-gate.mjs",
  "proof-runner.mjs",
  "rca-gate.mjs",
  "review-gate.mjs",
  "run-create.mjs",
  "run-packet-gate.mjs",
];
const requiredControls = [
  "controls/provenance/thirteen-layers.upstream.v1.json",
  "controls/crosswalks/thirteen-layers-to-uash.v1.json",
  "controls/assurance-execution-policy.v1.json",
  "controls/capability-packs/async-workflows.v1.json",
];
const focusedVerifiers = [
  "scripts/verify-import-boundaries.mjs",
  "scripts/verify-assurance-overlay.mjs",
  "scripts/verify-portable-execution.mjs",
  "scripts/verify-proof-runner-security.mjs",
  "scripts/verify-run-packet-trust.mjs",
  "scripts/verify-commissioned-portability.mjs",
];
const requiredRuntimeFiles = ["controls/review-trust.v1.json"];

for (const relativePath of [...requiredScripts.map((name) => `scripts/${name}`), ...requiredControls, ...requiredRuntimeFiles, ...focusedVerifiers]) {
  record(`required file ${relativePath}`, existsSync(path.join(ROOT, relativePath)), "missing clean-room import artifact");
}

for (const verifier of focusedVerifiers) {
  if (!existsSync(path.join(ROOT, verifier))) continue;
  const result = runNode(verifier);
  record(
    `focused verifier ${verifier}`,
    result.status === 0,
    `${result.stdout || ""}${result.stderr || ""}`.trim().slice(-1200),
  );
}

const packageJson = readJson("package.json");
record("release version is 0.8.0", packageJson.version === "0.8.0", `got ${packageJson.version}`);
const requiredPackageScripts = [
  "provenance:gate",
  "neutrality:gate",
  "privacy:gate",
  "schema:compat:gate",
  "run:packet:gate",
  "proof:run",
  "rca:gate",
  "review:gate",
  "verify:proof-security",
  "verify:run-packet-trust",
  "verify:commissioned-portability",
  "verify:work-harness-import",
];
for (const name of requiredPackageScripts) record(`package script ${name}`, Boolean(packageJson.scripts?.[name]), "missing package script");

const workflow = read(".github/workflows/ci.yml");
record("CI remains dual-platform", includesEvery(workflow, ["ubuntu-latest", "windows-latest"]), "missing Linux/Windows matrix");
record(
  "CI runs clean-room gates",
  includesEvery(workflow, ["provenance:gate", "neutrality:gate", "privacy:gate", "schema:compat:gate", "verify:proof-security", "verify:run-packet-trust", "verify:commissioned-portability", "verify:work-harness-import"]),
  "one or more clean-room gates are absent from CI",
);
record("CI scans secrets", /gitleaks\/gitleaks-action@/.test(workflow), "gitleaks action is not configured");

const catalogGate = read("scripts/catalog-integrity-gate.mjs");
for (const relativePath of requiredControls) {
  record(`catalog integrity covers ${relativePath}`, catalogGate.includes(relativePath), "new canonical catalog is not integrity locked");
}

const registry = readJson("skills/registry.json");
for (const gate of ["provenance", "neutrality", "privacy", "schema-compat", "run-packet", "review"]) {
  record(`skill registry gate policy ${gate}`, JSON.stringify(registry.gatePolicy ?? {}).includes(gate), "gate is not routed by the skill registry");
}
const proofSkill = read("skills/valdris-proof-handoff/SKILL.md");
record(
  "proof handoff owns packet and independent review",
  includesEvery(proofSkill, ["run-packet-gate", "review-gate", "rca-gate"]),
  "proof-handoff skill does not name the new executable gates",
);

const knowledgeIndex = read("knowledge/index.md");
record(
  "knowledge vault routes clean-room assurance",
  knowledgeIndex.includes("clean-room-assurance-import"),
  "knowledge index has no clean-room assurance playbook",
);

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "valdris-clean-room-import-"));
const generated = path.join(tempRoot, ".valdris-harness");
try {
  const commission = runNode("scripts/commission-harness.mjs", [
    "--repo", tempRoot,
    "--project-name", "Neutral Example",
    "--out", generated,
    "--yes",
  ]);
  record(
    "neutral commissioning succeeds",
    commission.status === 0,
    `${commission.stdout || ""}${commission.stderr || ""}`.trim().slice(-1200),
  );
  if (commission.status === 0) {
    for (const scriptName of requiredScripts) {
      record(`commissioned script ${scriptName}`, existsSync(path.join(generated, "scripts", scriptName)), "script not copied into commissioned pack");
    }
    for (const relativePath of requiredControls) {
      record(`commissioned control ${relativePath}`, existsSync(path.join(generated, relativePath)), "control not copied into commissioned pack");
    }
    const generatedPackage = JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8"));
    for (const name of ["provenance:gate", "neutrality:gate", "privacy:gate", "schema:compat:gate", "run:packet:gate"]) {
      record(`commissioned package script ${name}`, Boolean(generatedPackage.scripts?.[name]), "generated pack omits gate script");
    }
    const generatedWorkflow = readFileSync(path.join(generated, ".github", "workflows", "valdris-assurance.yml"), "utf8");
    record(
      "commissioned workflow runs clean-room gates",
      includesEvery(generatedWorkflow, ["provenance-gate.mjs", "neutrality-gate.mjs", "privacy-gate.mjs", "schema-compat-gate.mjs"]),
      "generated CI omits clean-room gates",
    );
    for (const gate of ["provenance-gate.mjs", "neutrality-gate.mjs", "privacy-gate.mjs", "schema-compat-gate.mjs"]) {
      const result = spawnSync(process.execPath, [path.join(generated, "scripts", gate), "--repo", generated], {
        cwd: generated,
        encoding: "utf8",
      });
      record(
        `commissioned ${gate} passes`,
        result.status === 0,
        `${result.stdout || ""}${result.stderr || ""}`.trim().slice(-1200),
      );
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const result = {
  ok: failures.length === 0,
  schema: "uash.clean-room-import-verification.v1",
  checked: checks.length,
  passed: checks.filter((entry) => entry.ok).length,
  failed: failures.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
