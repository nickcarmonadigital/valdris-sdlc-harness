#!/usr/bin/env node
import {
  cpSync,
  copyFileSync,
  existsSync,
  linkSync,
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

function initializeCommissioningFixture(repo, { commit = true } = {}) {
  writeFileSync(path.join(repo, "AGENTS.md"), "# Fixture agents\n");
  writeFileSync(path.join(repo, "CLAUDE.md"), "# Fixture Claude\n");
  for (const args of [
    ["init"],
    ["config", "user.name", "Valdris Fixture"],
    ["config", "user.email", "fixture@example.com"],
    ["add", "--all"],
  ]) {
    const result = spawnSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert(
      result.status === 0,
      `fixture git ${args[0]} failed: ${result.stderr}`,
    );
  }
  if (commit) {
    const result = spawnSync(
      "git",
      ["-C", repo, "commit", "-m", "fixture: commission harness"],
      { encoding: "utf8", windowsHide: true },
    );
    assert(result.status === 0, `fixture git commit failed: ${result.stderr}`);
  }
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
  ["Connect Codex/Claude to this run", "valdris-connect-runtime"],
  ["Please set-up the harness", "valdris-commission"],
  [
    "Do not use $valdris-trust-improve; use $valdris-commission to refresh the pack",
    "valdris-commission",
  ],
  ["Use $valdris-commission, not $valdris-trust-improve", "valdris-commission"],
  [
    "Use $valdris-trust-improve, not $valdris-commission",
    "valdris-trust-improve",
  ],
  [
    "Inspect valdris-commissioning metadata and promote this run",
    "valdris-trust-improve",
  ],
  [
    "Inspect notvaldris-prove-govern and promote this run",
    "valdris-trust-improve",
  ],
  [
    "avoid $valdris-trust-improve and use $valdris-commission",
    "valdris-commission",
  ],
  [
    "use $valdris-commission rather than $valdris-trust-improve",
    "valdris-commission",
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
  const replacementResult = run(
    [
      "--request",
      "prove this run",
      "--output",
      "run/lifecycle-skill-decision.json",
    ],
    outputRepo,
  );
  assert(
    replacementResult.status === 0 &&
      JSON.parse(
        readFileSync(
          path.join(outputRepo, "run", "lifecycle-skill-decision.json"),
          "utf8",
        ),
      ).selectedSkill === "valdris-prove-govern",
    `lifecycle decision replacement must be atomic and portable: ${replacementResult.stderr}`,
  );
} finally {
  rmSync(outputRepo, { recursive: true, force: true });
}

const hardLinkRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-hard-link-"),
);
try {
  const hardLinkRepo = path.join(hardLinkRoot, "repo");
  const hardLinkOutput = path.join(
    hardLinkRepo,
    "run",
    "lifecycle-skill-decision.json",
  );
  const outside = path.join(hardLinkRoot, "outside.json");
  mkdirSync(path.dirname(hardLinkOutput), { recursive: true });
  writeFileSync(outside, "outside-must-not-change\n");
  linkSync(outside, hardLinkOutput);
  const hardLinkResult = run(
    [
      "--request",
      "start a Valdris run",
      "--output",
      "run/lifecycle-skill-decision.json",
    ],
    hardLinkRepo,
  );
  assert(
    hardLinkResult.status !== 0 &&
      hardLinkResult.stderr.includes("--output must not be a hard link") &&
      readFileSync(outside, "utf8") === "outside-must-not-change\n",
    "lifecycle decision output must not follow a hard link outside --repo",
  );
} finally {
  rmSync(hardLinkRoot, { recursive: true, force: true });
}

const commissioningRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-commissioning-"),
);
try {
  const rootOnly = path.join(commissioningRoot, "root-only");
  mkdirSync(rootOnly);
  writeCommissionedAdapter(rootOnly, ".");
  initializeCommissioningFixture(rootOnly);
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
  initializeCommissioningFixture(nestedOnly);
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
  const directPackRoot = path.join(nestedOnly, ".valdris-harness");
  const directPackDecision = JSON.parse(
    run(["--request", "start a Valdris run"], directPackRoot).stdout,
  );
  assert(
    directPackDecision.commissioned === true &&
      directPackDecision.commissionedAdapter === "project-adapter.json" &&
      directPackDecision.commissioningReason === "adapter-current",
    "a generated nested pack opened at its own root must remain commissioned",
  );

  const stale = path.join(commissioningRoot, "stale");
  mkdirSync(stale);
  writeCommissionedAdapter(stale, ".", {
    lifecycleCatalogSize: registry.lifecycleSkills.length - 1,
  });
  initializeCommissioningFixture(stale);
  const staleDecision = JSON.parse(
    run(["--request", "start a Valdris run"], stale).stdout,
  );
  assert(
    staleDecision.commissioned === false &&
      staleDecision.commissioningReason === "adapter-stale",
    "a stale adapter must remain uncommissioned",
  );

  const uncommitted = path.join(commissioningRoot, "uncommitted");
  mkdirSync(uncommitted);
  writeCommissionedAdapter(uncommitted, ".valdris-harness");
  initializeCommissioningFixture(uncommitted, { commit: false });
  const uncommittedDecision = JSON.parse(
    run(["--request", "start a Valdris run"], uncommitted).stdout,
  );
  assert(
    uncommittedDecision.commissioned === false &&
      uncommittedDecision.commissioningReason === "adapter-uncommitted",
    "an uncommitted generated pack must not be commissioned",
  );

  const dirty = path.join(commissioningRoot, "dirty");
  mkdirSync(dirty);
  writeCommissionedAdapter(dirty, ".valdris-harness");
  initializeCommissioningFixture(dirty);
  writeFileSync(path.join(dirty, "CLAUDE.md"), "# Dirty fixture\n");
  const dirtyDecision = JSON.parse(
    run(["--request", "start a Valdris run"], dirty).stdout,
  );
  assert(
    dirtyDecision.commissioned === false &&
      dirtyDecision.commissioningReason === "adapter-uncommitted",
    "a dirty target-root loader must invalidate commissioning",
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
    `the registry gate must regenerate a missing canonical routing projection (status=${repairResult.status}, signal=${repairResult.signal}, error=${repairResult.error?.message || "none"}): ${repairResult.stdout}${repairResult.stderr}`,
  );
  const repairedRoutingPath = path.join(
    projectionRepairRoot,
    "skills",
    "codex-routing.yaml",
  );
  const repairedRouting = readFileSync(repairedRoutingPath, "utf8");
  const outsideRouting = path.join(
    projectionRepairRoot,
    "outside-routing.yaml",
  );
  rmSync(repairedRoutingPath);
  writeFileSync(outsideRouting, "outside-routing-must-not-change\n");
  linkSync(outsideRouting, repairedRoutingPath);
  const hardLinkedProjectionResult = spawnSync(
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
    hardLinkedProjectionResult.status !== 0 &&
      readFileSync(outsideRouting, "utf8") ===
        "outside-routing-must-not-change\n",
    "routing projection writes must reject a multiply linked destination",
  );
  rmSync(repairedRoutingPath);
  writeFileSync(repairedRoutingPath, repairedRouting);
  const invalidProjectionRegistry = structuredClone(registry);
  invalidProjectionRegistry.lifecycleSelection.tieBreakOrder = [];
  writeFileSync(
    path.join(projectionRepairRoot, "skills", "registry.json"),
    `${JSON.stringify(invalidProjectionRegistry, null, 2)}\n`,
  );
  const invalidProjectionResult = spawnSync(
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
    invalidProjectionResult.status !== 0 &&
      readFileSync(repairedRoutingPath, "utf8") === repairedRouting,
    "an invalid registry must not rewrite the last valid routing projection",
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

const mismatchedNestedCommandRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-lifecycle-nested-command-"),
);
try {
  writeCommissionedAdapter(mismatchedNestedCommandRoot, ".valdris-harness", {
    lifecycleRouteCommand:
      'node scripts/route-lifecycle-skill.mjs --repo . --request "<request>"',
  });
  const nestedPack = path.join(mismatchedNestedCommandRoot, ".valdris-harness");
  const mismatchedNestedValidation = validateSkillRegistry(
    registry,
    nestedPack,
  );
  assert(
    !mismatchedNestedValidation.valid &&
      mismatchedNestedValidation.problems.some((problem) =>
        problem.includes("physical pack location"),
      ),
    "the registry gate must reject a root command in a nested commissioned pack",
  );
} finally {
  rmSync(mismatchedNestedCommandRoot, { recursive: true, force: true });
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

const commissionMarkdown = readFileSync(
  path.join(ROOT, "skills", "valdris-commission", "SKILL.md"),
  "utf8",
);
assert(
  commissionMarkdown.includes("--yes --force") &&
    commissionMarkdown.includes(
      "Never use `--force` on an unrecognized directory",
    ),
  "commissioning refresh must require an explicit, guarded --force command",
);

const assureMarkdown = readFileSync(
  path.join(ROOT, "skills", "valdris-assure", "SKILL.md"),
  "utf8",
);
assert(
  assureMarkdown.includes("classification.requiredGates.foundation") &&
    assureMarkdown.includes("including for controlled docs routes"),
  "foundation assurance must follow the route gate instead of the docs-only label",
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
      atomicDecisionReplacementPassed: true,
      hardLinkOutputRejected: true,
      commissioningCasesPassed: 7,
      fallbackConfigurationGuardPassed: true,
      tieBreakContractPassed: true,
      ownedSurfaceCasesPassed: 4,
      phraseBoundaryCasesPassed: 4,
      negatedInvocationCasesPassed: 6,
      routeDependentAssurancePassed: true,
      directPackCommandDiscoveryPassed: true,
      projectionRepairPassed: true,
      hardLinkProjectionRejected: true,
      invalidRegistryProjectionPreserved: true,
      commissionedRouteCommandGuardPassed: true,
      physicalRouteCommandAlignmentPassed: true,
      routingProjectionBoundaryPassed: true,
    },
    null,
    2,
  ),
);
