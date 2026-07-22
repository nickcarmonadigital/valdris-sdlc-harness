#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 720_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function includesEvery(text, values) {
  return values.every((value) => text.includes(value));
}

function yamlScalar(value) {
  const scalar = value.replace(/\s+#.*$/u, "").trim();
  if (
    scalar.length >= 2 &&
    ((scalar.startsWith('"') && scalar.endsWith('"')) ||
      (scalar.startsWith("'") && scalar.endsWith("'")))
  )
    return scalar.slice(1, -1);
  return scalar;
}

function staticallyDisabled(value) {
  const normalized = yamlScalar(value).toLowerCase().replace(/\s+/gu, "");
  return normalized === "false" || normalized === "${{false}}";
}

function workflowJobRunSteps(source, jobName) {
  const lines = source.split(/\r?\n/u);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/u.test(line));
  if (jobsIndex < 0) return [];
  const jobPattern = new RegExp(
    `^ {2}${jobName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:\\s*(?:#.*)?$`,
    "u",
  );
  const jobIndex = lines.findIndex(
    (line, index) => index > jobsIndex && jobPattern.test(line),
  );
  if (jobIndex < 0) return [];
  const steps = [];
  let jobCondition = "";
  let inSteps = false;
  let currentStep = null;
  const finishStep = () => {
    if (currentStep) steps.push(currentStep);
    currentStep = null;
  };
  for (let index = jobIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^ {2}\S/u.test(line)) break;
    if (!inSteps) {
      const jobIf = line.match(/^ {4}if:\s*(.*?)\s*$/u);
      if (jobIf) jobCondition = jobIf[1];
    }
    if (/^ {4}steps:\s*(?:#.*)?$/u.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    if (/^ {4}\S/u.test(line)) {
      finishStep();
      break;
    }
    const stepStart = line.match(/^ {6}-\s*(.*?)\s*$/u);
    if (stepStart) {
      finishStep();
      currentStep = {};
      const inline = stepStart[1].match(/^(run|if):\s*(.*?)\s*$/u);
      if (inline) currentStep[inline[1]] = inline[2];
      continue;
    }
    if (!currentStep) continue;
    const property = line.match(/^ {8}(run|if):\s*(.*?)\s*$/u);
    if (property) currentStep[property[1]] = property[2];
  }
  finishStep();
  if (staticallyDisabled(jobCondition)) return [];
  return steps
    .filter((step) => step.run && !staticallyDisabled(step.if || ""))
    .map((step) => yamlScalar(step.run));
}

function markdownBashCommands(source) {
  return [...source.matchAll(/```bash\s*\r?\n([\s\S]*?)```/gu)].flatMap(
    (match) =>
      match[1]
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
  );
}

const requiredScripts = [
  "provenance-gate.mjs",
  "neutrality-gate.mjs",
  "privacy-gate.mjs",
  "restricted-residue-gate.mjs",
  "retire-local-skills.mjs",
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
  "controls/clean-room-behaviors.v1.json",
];
const focusedVerifiers = [
  "scripts/verify-import-boundaries.mjs",
  "scripts/verify-assurance-overlay.mjs",
  "scripts/verify-portable-execution.mjs",
  "scripts/verify-proof-runner-security.mjs",
  "scripts/verify-run-packet-trust.mjs",
  "scripts/verify-commissioned-portability.mjs",
  "scripts/verify-release-artifact-privacy.mjs",
  "scripts/verify-clean-room-convergence.mjs",
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
  "dependency:audit",
  "provenance:gate",
  "neutrality:gate",
  "privacy:gate",
  "privacy:release",
  "restricted-residue:gate",
  "skills:retire-local",
  "schema:compat:gate",
  "run:packet:gate",
  "proof:run",
  "rca:gate",
  "review:gate",
  "verify:proof-security",
  "verify:run-packet-trust",
  "verify:commissioned-portability",
  "verify:release-privacy",
  "verify:work-harness-import",
  "verify:clean-room-convergence",
];
for (const name of requiredPackageScripts) record(`package script ${name}`, Boolean(packageJson.scripts?.[name]), "missing package script");
record(
  "dependency audit package script is pinned",
  packageJson.scripts?.["dependency:audit"] === "npm audit --audit-level=high",
  "dependency audit package script does not run the commissioned audit command",
);

const workflow = read(".github/workflows/ci.yml");
record("CI covers Linux, Windows, and macOS portability", includesEvery(workflow, ["ubuntu-latest", "windows-latest", "macos-latest"]), "missing Linux/Windows/macOS coverage");
record(
  "CI runs clean-room gates",
  includesEvery(workflow, ["provenance:gate", "neutrality:gate", "privacy:gate", "privacy:release", "verify:release-privacy", "schema:compat:gate", "verify:proof-security", "verify:run-packet-trust", "verify:commissioned-portability", "verify:work-harness-import", "verify:clean-room-convergence"]),
  "one or more clean-room gates are absent from CI",
);
record("CI scans secrets", /gitleaks\/gitleaks-action@/.test(workflow), "gitleaks action is not configured");
record(
  "CI rejects high-severity dependency advisories",
  workflowJobRunSteps(workflow, "dependency-audit").includes(
    "npm run dependency:audit",
  ),
  "dependency audit gate is not configured",
);
record(
  "dependency audit CI assertion is job-scoped",
  !workflowJobRunSteps(
    "jobs:\n  unrelated:\n    steps:\n      - run: npm run dependency:audit\n",
    "dependency-audit",
  ).includes("npm run dependency:audit"),
  "dependency audit assertion accepted an unrelated workflow step",
);
record(
  "dependency audit CI assertion rejects a disabled job",
  !workflowJobRunSteps(
    "jobs:\n  dependency-audit:\n    if: false\n    steps:\n      - run: npm run dependency:audit\n",
    "dependency-audit",
  ).includes("npm run dependency:audit"),
  "dependency audit assertion accepted a disabled workflow job",
);
record(
  "dependency audit CI assertion rejects a disabled step",
  !workflowJobRunSteps(
    "jobs:\n  dependency-audit:\n    steps:\n      - if: ${{ false }}\n        run: npm run dependency:audit\n",
    "dependency-audit",
  ).includes("npm run dependency:audit"),
  "dependency audit assertion accepted a disabled workflow step",
);
record(
  "Claude proof stack includes dependency audit",
  markdownBashCommands(read("CLAUDE.md")).includes("npm run dependency:audit"),
  "Claude proof instructions omit the dependency audit command",
);

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

const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "valdris-clean-room-import-")));
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
    for (const name of ["provenance:gate", "neutrality:gate", "privacy:gate", "restricted-residue:gate", "skills:retire-local", "schema:compat:gate", "run:packet:gate"]) {
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
