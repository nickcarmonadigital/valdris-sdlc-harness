#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateSkillRegistry } from "./skill-registry-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTER = path.join(ROOT, "scripts", "route-lifecycle-skill.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, repo = ROOT) {
  return spawnSync(process.execPath, [ROUTER, "--repo", repo, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function decision(request) {
  const result = run(["--request", request]);
  assert(
    result.status === 0,
    `lifecycle router failed for "${request}": ${result.stderr}`,
  );
  return { raw: result.stdout, parsed: JSON.parse(result.stdout) };
}

const registryPath = path.join(ROOT, "skills", "registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const validation = validateSkillRegistry(registry, ROOT);
assert(validation.valid, validation.problems.join("; "));
assert(validation.skillCount === 8, "workflow skill count must remain 8");
assert(validation.lifecycleSkillCount === 7, "lifecycle skill count must be 7");
assert(validation.totalSkillCount === 15, "combined skill count must be 15");

const cases = [
  ["Commission Valdris into this repository", "valdris-commission"],
  ["Create the durable goal for this request", "valdris-route-goal"],
  ["Resolve Layer 0 and check all 13 domains", "valdris-assure"],
  ["Connect Codex and start Live Run", "valdris-connect-runtime"],
  [
    "Continue the goal loop with the next bounded slice",
    "valdris-execute-workflow",
  ],
  [
    "Assemble the run packet and request independent review",
    "valdris-prove-govern",
  ],
  [
    "Make the final trust decision and capture lessons learned",
    "valdris-trust-improve",
  ],
];

for (const [request, expected] of cases) {
  const first = decision(request);
  const second = decision(request);
  assert(
    first.parsed.selectedSkill === expected,
    `${request} selected ${first.parsed.selectedSkill}, expected ${expected}`,
  );
  assert(
    first.raw === second.raw,
    `lifecycle routing must be deterministic for ${expected}`,
  );
}

const ambiguous = decision("Do something with the harness").parsed;
assert(
  ambiguous.selectedSkill === "valdris-route-goal" &&
    ambiguous.reason === "lifecycle ambiguity fallback",
  "ambiguous lifecycle intent must fall back to valdris-route-goal",
);

for (let sequence = 1; sequence <= 7; sequence += 1) {
  const result = run(["--stage", String(sequence)]);
  assert(result.status === 0, `explicit lifecycle stage ${sequence} failed`);
  const selected = JSON.parse(result.stdout);
  assert(
    selected.sequence === sequence,
    `explicit lifecycle stage ${sequence} selected the wrong skill`,
  );
}

const traversal = run([
  "--request",
  "start a Valdris run",
  "--output",
  "../escaped-lifecycle.json",
]);
assert(
  traversal.status !== 0 &&
    traversal.stderr.includes(
      "--output must be run/lifecycle-skill-decision.json under --repo",
    ),
  "lifecycle router must reject output traversal",
);

const outputRepo = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-router-"),
);
try {
  mkdirSync(path.join(outputRepo, "run"));
  const outputResult = run(
    [
      "--request",
      "start a Valdris run",
      "--output",
      "run/lifecycle-skill-decision.json",
    ],
    outputRepo,
  );
  assert(
    outputResult.status === 0,
    `lifecycle decision output failed: ${outputResult.stderr}`,
  );
  const persisted = JSON.parse(
    readFileSync(
      path.join(outputRepo, "run", "lifecycle-skill-decision.json"),
      "utf8",
    ),
  );
  assert(
    persisted.selectedSkill === "valdris-route-goal",
    "persisted lifecycle decision must match stdout routing",
  );
} finally {
  rmSync(outputRepo, { recursive: true, force: true });
}

const workflowNames = new Set(registry.skills.map((skill) => skill.name));
for (const skill of registry.lifecycleSkills) {
  assert(
    !workflowNames.has(skill.name),
    `lifecycle skill duplicates work skill ${skill.name}`,
  );
  const markdown = readFileSync(path.resolve(ROOT, skill.path), "utf8");
  assert(
    markdown.includes("## Deterministic flow"),
    `${skill.name} must declare its deterministic flow`,
  );
  assert(
    markdown.includes("## Completion criterion"),
    `${skill.name} must declare an exhaustive completion criterion`,
  );
  if (skill.next)
    assert(
      markdown.includes(`$${skill.next}`),
      `${skill.name} must hand off to ${skill.next}`,
    );
}

const routing = readFileSync(
  path.join(ROOT, "skills", "codex-routing.yaml"),
  "utf8",
);
assert(
  routing.includes("lifecycle_skills:") &&
    registry.lifecycleSkills.every((skill) =>
      routing.includes(`name: "${skill.name}"`),
    ),
  "Codex YAML routing must expose all seven lifecycle skills",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      workflowSkills: validation.skillCount,
      lifecycleSkills: validation.lifecycleSkillCount,
      totalSkills: validation.totalSkillCount,
      deterministicCases: cases.length,
      ambiguityFallback: ambiguous.selectedSkill,
      traversalRejected: true,
      boundedDecisionOutputPassed: true,
    },
    null,
    2,
  ),
);
