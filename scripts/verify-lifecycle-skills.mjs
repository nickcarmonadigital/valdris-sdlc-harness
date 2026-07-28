#!/usr/bin/env node
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateSkillRegistry } from "./skill-registry-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTER = path.join(ROOT, "scripts", "route-lifecycle-skill.mjs");
const SKILL_GATE = path.join(ROOT, "scripts", "skill-registry-gate.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, repo = ROOT, router = ROUTER) {
  return spawnSync(process.execPath, [router, "--repo", repo, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function writeCommissionedAdapter(repo, adapterRoot, overrides = {}) {
  const root = path.resolve(repo, adapterRoot);
  mkdirSync(path.join(root, "skills"), { recursive: true });
  copyFileSync(registryPath, path.join(root, "skills", "registry.json"));
  copyFileSync(
    path.join(ROOT, "skills", "codex-routing.yaml"),
    path.join(root, "skills", "codex-routing.yaml"),
  );
  const adapter = {
    schema: "uash.project-adapter.v2",
    skillRouter: {
      schema: registry.schema,
      registry: "skills/registry.json",
      codexRouting: "skills/codex-routing.yaml",
      implicitInvocation: true,
      workflowCatalogSize: registry.skills.length,
      lifecycleCatalogSize: registry.lifecycleSkills.length,
      lifecycleRouteCommand:
        adapterRoot === "."
          ? 'node scripts/route-lifecycle-skill.mjs --repo . --request "<request>"'
          : 'node .valdris-harness/scripts/route-lifecycle-skill.mjs --repo . --request "<request>"',
      ...overrides,
    },
  };
  writeFileSync(
    path.join(root, "project-adapter.json"),
    `${JSON.stringify(adapter, null, 2)}\n`,
  );
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
  ["Refresh commissioned pack and promote this run", "valdris-trust-improve"],
  ["$valdris-prove-govern, finish this", "valdris-prove-govern"],
  ["$valdris-trust-improve: promote now", "valdris-trust-improve"],
  [
    "Do not use $valdris-commission; use $valdris-trust-improve to promote this run",
    "valdris-trust-improve",
  ],
  ["Validate proof/proof.json", "valdris-prove-govern"],
  ["Check run/mode.json", "valdris-connect-runtime"],
  ["Inspect runtime-connectivity", "valdris-connect-runtime"],
  ["Validate runtime/driver.json", "valdris-connect-runtime"],
  ["Analyze upstream events", "valdris-route-goal"],
  ["Use a mainstream events API", "valdris-route-goal"],
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

const docsAssurance = decision(
  "$valdris-assure resolve assurance for this docs-only route",
).parsed;
assert(
  !docsAssurance.requiredGates.includes("foundation") &&
    !docsAssurance.requiredGates.includes("production") &&
    docsAssurance.conditionalGates.some((gate) =>
      gate.startsWith("foundation "),
    ) &&
    docsAssurance.conditionalGates.some((gate) =>
      gate.startsWith("production "),
    ),
  "route-dependent foundation and production gates must remain conditional",
);

const invalidTieBreak = structuredClone(registry);
invalidTieBreak.lifecycleSelection.tieBreakOrder = [];
const invalidTieBreakValidation = validateSkillRegistry(invalidTieBreak, ROOT);
assert(
  !invalidTieBreakValidation.valid &&
    invalidTieBreakValidation.problems.some((problem) =>
      problem.includes("lifecycleSelection.tieBreakOrder"),
    ),
  "the registry gate must reject lifecycle tie-break drift",
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
  assert(
    persisted.commissioned === false &&
      persisted.commissioningReason === "adapter-absent",
    "an absent adapter must remain uncommissioned",
  );
} finally {
  rmSync(outputRepo, { recursive: true, force: true });
}

const commissioningRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-commissioning-"),
);
try {
  const rootOnly = path.join(commissioningRoot, "root-only");
  mkdirSync(rootOnly);
  writeCommissionedAdapter(rootOnly, ".");
  const rootDecision = JSON.parse(
    run(["--request", "start a Valdris run"], rootOnly).stdout,
  );
  assert(
    rootDecision.commissioned === true &&
      rootDecision.commissionedAdapter === "project-adapter.json" &&
      rootDecision.commissioningReason === "adapter-current",
    "a current root-only adapter must be commissioned",
  );

  const nestedOnly = path.join(commissioningRoot, "nested-only");
  mkdirSync(nestedOnly);
  writeCommissionedAdapter(nestedOnly, ".valdris-harness");
  const nestedDecision = JSON.parse(
    run(["--request", "start a Valdris run"], nestedOnly).stdout,
  );
  assert(
    nestedDecision.commissioned === true &&
      nestedDecision.commissionedAdapter ===
        ".valdris-harness/project-adapter.json" &&
      nestedDecision.commissioningReason === "adapter-current",
    "a current nested-only adapter must be commissioned",
  );

  const stale = path.join(commissioningRoot, "stale");
  mkdirSync(stale);
  writeCommissionedAdapter(stale, ".", {
    lifecycleCatalogSize: registry.lifecycleSkills.length - 1,
  });
  const staleDecision = JSON.parse(
    run(["--request", "start a Valdris run"], stale).stdout,
  );
  assert(
    staleDecision.commissioned === false &&
      staleDecision.commissioningReason === "adapter-stale",
    "a stale adapter must remain uncommissioned",
  );
} finally {
  rmSync(commissioningRoot, { recursive: true, force: true });
}

const fallbackRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-fallback-"),
);
try {
  mkdirSync(path.join(fallbackRoot, "scripts"));
  mkdirSync(path.join(fallbackRoot, "skills"));
  const fallbackRouter = path.join(
    fallbackRoot,
    "scripts",
    "route-lifecycle-skill.mjs",
  );
  copyFileSync(ROUTER, fallbackRouter);
  const invalidRegistry = structuredClone(registry);
  invalidRegistry.lifecycleSelection.ambiguityFallback = "valdris-missing";
  writeFileSync(
    path.join(fallbackRoot, "skills", "registry.json"),
    `${JSON.stringify(invalidRegistry, null, 2)}\n`,
  );
  const fallbackResult = run(
    ["--request", "unmatched lifecycle operation"],
    fallbackRoot,
    fallbackRouter,
  );
  assert(
    fallbackResult.status !== 0 &&
      fallbackResult.stderr.includes(
        "lifecycle ambiguity fallback skill not found in registry: valdris-missing",
      ),
    "a missing ambiguity fallback must fail with a clear configuration error",
  );
} finally {
  rmSync(fallbackRoot, { recursive: true, force: true });
}

const writeBoundaryRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-write-boundary-"),
);
try {
  const boundedRepo = path.join(writeBoundaryRoot, "repo");
  const outsideSkills = path.join(writeBoundaryRoot, "outside", "skills");
  mkdirSync(path.join(boundedRepo, "skills"), { recursive: true });
  mkdirSync(outsideSkills, { recursive: true });
  copyFileSync(registryPath, path.join(outsideSkills, "registry.json"));
  const escapedRouting = path.join(outsideSkills, "codex-routing.yaml");
  const writeResult = spawnSync(
    process.execPath,
    [
      SKILL_GATE,
      "--repo",
      boundedRepo,
      "--file",
      "../outside/skills/registry.json",
      "--write-routing",
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 10_000 },
  );
  assert(
    writeResult.status !== 0 &&
      !existsSync(escapedRouting) &&
      `${writeResult.stdout}${writeResult.stderr}`.includes(
        "routing projection write requires",
      ),
    "skill registry generator must reject routing writes outside --repo",
  );
} finally {
  rmSync(writeBoundaryRoot, { recursive: true, force: true });
}

const projectionRepairRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-projection-repair-"),
);
try {
  cpSync(path.join(ROOT, "skills"), path.join(projectionRepairRoot, "skills"), {
    recursive: true,
  });
  mkdirSync(path.join(projectionRepairRoot, "scripts"));
  for (const script of ["skill-registry-gate.mjs", "control-gate-lib.mjs"])
    copyFileSync(
      path.join(ROOT, "scripts", script),
      path.join(projectionRepairRoot, "scripts", script),
    );
  rmSync(path.join(projectionRepairRoot, "skills", "codex-routing.yaml"));
  const repairResult = spawnSync(
    process.execPath,
    [
      path.join(projectionRepairRoot, "scripts", "skill-registry-gate.mjs"),
      "--repo",
      projectionRepairRoot,
      "--write-routing",
    ],
    { cwd: projectionRepairRoot, encoding: "utf8", timeout: 10_000 },
  );
  assert(
    repairResult.status === 0 &&
      existsSync(
        path.join(projectionRepairRoot, "skills", "codex-routing.yaml"),
      ),
    `the registry gate must regenerate a missing canonical routing projection: ${repairResult.stdout}${repairResult.stderr}`,
  );
} finally {
  rmSync(projectionRepairRoot, { recursive: true, force: true });
}

const missingRouteCommandRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-adapter-command-"),
);
try {
  writeCommissionedAdapter(missingRouteCommandRoot, ".", {
    lifecycleRouteCommand: undefined,
  });
  const missingRouteCommandValidation = validateSkillRegistry(
    registry,
    missingRouteCommandRoot,
  );
  assert(
    !missingRouteCommandValidation.valid &&
      missingRouteCommandValidation.problems.some((problem) =>
        problem.includes("lifecycleRouteCommand"),
      ),
    "the registry gate must reject an absent commissioned lifecycle router command",
  );
} finally {
  rmSync(missingRouteCommandRoot, { recursive: true, force: true });
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

const routeGoalMarkdown = readFileSync(
  path.join(ROOT, "skills", "valdris-route-goal", "SKILL.md"),
  "utf8",
);
assert(
  routeGoalMarkdown.includes(".valdris-harness/scripts/route-request.mjs") &&
    routeGoalMarkdown.includes("use `scripts/route-request.mjs`"),
  "route-goal must document both nested and direct-pack router discovery",
);

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
      commissioningCasesPassed: 4,
      fallbackConfigurationGuardPassed: true,
      tieBreakContractPassed: true,
      ownedSurfaceCasesPassed: 4,
      phraseBoundaryCasesPassed: 2,
      routeDependentAssurancePassed: true,
      directPackCommandDiscoveryPassed: true,
      projectionRepairPassed: true,
      commissionedRouteCommandGuardPassed: true,
      routingProjectionBoundaryPassed: true,
    },
    null,
    2,
  ),
);
