#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evidencePolicyForEffectiveTier,
  existingFileWithinRepo,
  PROFILE_EVIDENCE_MAX_AGE_HOURS,
} from "./control-gate-lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ENTERPRISE_GATE_TIMEOUT_MS = 120_000;
export const ENTERPRISE_GATE_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const TECHNICAL_TRUST_RANK = {
  "automated-local": 0,
  "ci-attested": 1,
  "provider-attested": 2,
};
const GATES = [
  ["intake", "intake-gate.mjs"],
  ["workload-classification", "workload-classification-gate.mjs"],
  ["route", "route-gate.mjs"],
  ["code-intelligence", "code-intelligence-gate-all.mjs"],
  ["skill-registry", "skill-registry-gate.mjs"],
  ["goal", "goal-gate.mjs"],
  ["context", "context-manifest-gate.mjs"],
  ["foundation", "foundation-gate.mjs"],
  ["production", "production-layer-gate.mjs"],
  ["ai-assurance", "ai-assurance-gate.mjs"],
  ["domain-assurance", "domain-assurance-gate.mjs"],
  ["eval", "eval-gate.mjs"],
  ["trajectory", "trajectory-gate.mjs"],
  ["smoke", "smoke-gate.mjs"],
  ["waivers", "waiver-gate.mjs"],
];

function parseArgs(argv) {
  const args = { repo: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

export function hasTokenCorrelatedUnknownApproval(
  condition,
  unknown,
  classification,
  classificationSha256,
) {
  const scope = `classification-unknown:${unknown.id}`;
  return (condition?.evidence || []).some(
    (evidence) =>
      evidence.type === "approval" &&
      evidence.actorType === "human" &&
      evidence.status === "granted" &&
      evidence.trustTier === "human-approved" &&
      evidence.producer?.kind === "human" &&
      nonEmptyForBinding(evidence.bridgeEventId) &&
      evidence.scope === scope &&
      evidence.runId === classification.runId &&
      evidence.workloadClassificationSha256 === classificationSha256 &&
      evidence.unknownId === unknown.id &&
      evidence.tokenCorrelation?.runId === classification.runId &&
      evidence.tokenCorrelation?.workloadClassificationSha256 ===
        classificationSha256 &&
      evidence.tokenCorrelation?.unknownId === unknown.id,
  );
}

export function runEnterpriseValidator(scriptPath, repoRoot, options = {}) {
  return spawnSync(
    process.execPath,
    [scriptPath, "--repo", path.resolve(repoRoot)],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? ENTERPRISE_GATE_TIMEOUT_MS,
      killSignal: "SIGTERM",
      maxBuffer: options.maxBufferBytes ?? ENTERPRISE_GATE_MAX_BUFFER_BYTES,
    },
  );
}

function crossArtifactProblems(repoRoot) {
  const load = (relative) => {
    const target = path.join(repoRoot, relative);
    if (!existingFileWithinRepo(repoRoot, target))
      throw new Error(
        `${relative} must be a real non-symlink file inside the repository`,
      );
    return JSON.parse(readFileSync(target, "utf8"));
  };
  const goal = load("goal/goal.json");
  const routeDocument = load("run/route.json");
  const foundationRequired =
    routeDocument.gateApplicability?.foundation?.status === "required";
  const productionRequired =
    routeDocument.gateApplicability?.production?.status === "required";
  const smokeRequired =
    routeDocument.gateApplicability?.smoke?.status === "required";
  const artifacts = [
    ["intake", load("run/intake.json"), "runId"],
    ["classification", load("run/workload-classification.json"), "runId"],
    ["route", routeDocument, "runId"],
    ["context", load("context/manifest.json"), "runId"],
    ["AI", load("ai/assurance.json"), "runId"],
    ["domain", load("domain/assurance.json"), "runId"],
    ["eval", load("evals/results.json"), "runId"],
    ["trajectory", load("trajectory/trajectory.json"), "goalId"],
    ["waivers", load("waivers/waivers.json"), "runId"],
  ];
  if (foundationRequired)
    artifacts.push(["foundation", load("foundation/assessment.json"), "runId"]);
  if (productionRequired)
    artifacts.push([
      "production",
      load("production/layer-assessment.json"),
      "runId",
    ]);
  if (smokeRequired)
    artifacts.push(["smoke", load("smoke/smoke_proof.json"), "runId"]);
  const problems = [];
  const classification = artifacts.find(
    ([name]) => name === "classification",
  )[1];
  const evidencePolicy = evidencePolicyForEffectiveTier(
    classification.effectiveTier,
  );
  if (!evidencePolicy)
    problems.push(
      `workload classification effective tier has no evidence policy: ${classification.effectiveTier || "missing"}`,
    );
  for (const [name, artifact, idField] of artifacts) {
    if (artifact[idField] !== goal.goalId)
      problems.push(`${name}.${idField} must match goal.goalId`);
    if (artifact.profile !== goal.profile)
      problems.push(`${name}.profile must match goal.profile`);
    if (artifact.commit !== goal.commit)
      problems.push(`${name}.commit must match goal.commit`);
    if (artifact.environment !== goal.environment)
      problems.push(`${name}.environment must match goal.environment`);
    const timestamp = artifact.generatedAt || artifact.receivedAt;
    if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
      const ageMs = Date.now() - Date.parse(timestamp);
      if (ageMs < -5 * 60 * 1000)
        problems.push(`${name} timestamp is in the future`);
      const evidenceProfile = evidencePolicy?.profile || "production";
      if (
        ageMs >
        (PROFILE_EVIDENCE_MAX_AGE_HOURS[evidenceProfile] || 168) *
          60 *
          60 *
          1000
      )
        problems.push(
          `${name} is outside the current ${evidenceProfile} freshness window for ${classification.effectiveTier}`,
        );
    }
  }
  const route = artifacts.find(([name]) => name === "route")[1];
  const intake = artifacts.find(([name]) => name === "intake")[1];
  const ai = artifacts.find(([name]) => name === "AI")[1];
  const domain = artifacts.find(([name]) => name === "domain")[1];
  if (
    route.ai?.workloadDetected !== ai.workloadDetected ||
    route.ai?.aiProfile !== ai.aiProfile
  )
    problems.push("route AI classification must match AI assurance");
  for (const feature of [
    "rag",
    "tools",
    "memory",
    "consequential",
    "userFacing",
    "sensitiveData",
    "autonomous",
  ]) {
    if (route.ai?.features?.[feature] !== ai.features?.[feature])
      problems.push(`route AI feature ${feature} must match AI assurance`);
  }
  if (intake.runId !== route.runId)
    problems.push("intake.runId must match route.runId");
  if (classification.requestSha256 !== intake.requestSha256)
    problems.push(
      "workload classification requestSha256 must match intake.requestSha256",
    );
  if (
    classification.profile !== route.profile ||
    classification.effectiveTier !== route.assuranceTier?.effective
  )
    problems.push(
      "route maturity profile and assurance tier must match workload classification",
    );
  const classificationSha256 = sha256JsonFile(
    path.join(repoRoot, "run", "workload-classification.json"),
  );
  if (route.workloadClassificationSha256 !== classificationSha256)
    problems.push(
      "route must remain bound to the current workload classification",
    );
  if (goal.effectiveTier !== classification.effectiveTier)
    problems.push("goal effectiveTier must match workload classification");
  if (goal.workloadClassificationSha256 !== classificationSha256)
    problems.push(
      "goal must remain bound to the current workload classification",
    );
  for (const [name, artifact] of artifacts.filter(([name]) =>
    ["foundation", "production", "AI", "domain"].includes(name),
  )) {
    if (artifact.effectiveTier !== classification.effectiveTier)
      problems.push(`${name}.effectiveTier must match workload classification`);
    if (artifact.workloadClassificationSha256 !== classificationSha256)
      problems.push(
        `${name} must remain bound to the current workload classification`,
      );
  }
  if (
    goal.objective !== intake.requestText ||
    goal.requestSha256 !== intake.requestSha256
  )
    problems.push(
      "goal objective/requestSha256 must remain bound to the authorized intake request",
    );
  for (const unknown of classification.materialUnknowns || []) {
    const condition = (goal.stoppingConditions || []).find(
      (item) => item.id === `classification-unknown:${unknown.id}`,
    );
    if (!condition || condition.status !== "passed")
      problems.push(
        `material classification unknown requires a passed human-evidenced stopping condition: ${unknown.id}`,
      );
    else {
      if (
        !hasTokenCorrelatedUnknownApproval(
          condition,
          unknown,
          classification,
          classificationSha256,
        )
      )
        problems.push(
          `material classification unknown requires token-correlated human approval bound to run, classification digest, and unknown ID: ${unknown.id}`,
        );
    }
  }
  if (
    goal.initialRouteSha256 !==
    sha256JsonFile(path.join(repoRoot, "run", "route.json"))
  )
    problems.push(
      "current route must match goal.initialRouteSha256; start a reviewed new run to change the initial route",
    );
  const taxonomy = JSON.parse(
    readFileSync(
      path.resolve(SCRIPT_DIR, "..", "controls", "workload-taxonomy.v1.json"),
      "utf8",
    ),
  );
  const tier = (taxonomy.assuranceTiers || []).find(
    (candidate) => candidate.id === classification.effectiveTier,
  );
  if (
    tier &&
    evidencePolicy &&
    (tier.minimumTechnicalTrust !== evidencePolicy.minimumTechnicalTrust ||
      tier.externalAttestationRequired !==
        evidencePolicy.externalAttestationRequired)
  )
    problems.push(
      `workload taxonomy evidence policy disagrees with the enforced ${classification.effectiveTier} policy`,
    );
  const evidenceGroups = [];
  const foundation = artifacts.find(([name]) => name === "foundation")?.[1];
  if (foundation)
    evidenceGroups.push(
      ...(foundation.capabilities || []).flatMap(
        (capability) => capability.controls || [],
      ),
    );
  const productionArtifact = artifacts.find(
    ([name]) => name === "production",
  )?.[1];
  if (productionArtifact)
    evidenceGroups.push(
      ...(productionArtifact.layers || []).flatMap(
        (layer) => layer.controls || [],
      ),
    );
  evidenceGroups.push(...(ai.controls || []));
  evidenceGroups.push(
    ...(domain.packs || []).flatMap((pack) => pack.controls || []),
  );
  const technicalEvidence = evidenceGroups.flatMap((control) =>
    (control.evidence || []).filter(
      (evidence) => evidence?.type !== "approval",
    ),
  );
  const minimumTrust =
    TECHNICAL_TRUST_RANK[evidencePolicy?.minimumTechnicalTrust];
  if (Number.isInteger(minimumTrust)) {
    for (const evidence of technicalEvidence)
      if ((TECHNICAL_TRUST_RANK[evidence.trustTier] ?? -1) < minimumTrust)
        problems.push(
          `assurance tier ${classification.effectiveTier} rejects ${evidence.subject || "unbound"} technical evidence with trust ${evidence.trustTier || "missing"}`,
        );
  }
  if (
    evidencePolicy?.externalAttestationRequired &&
    technicalEvidence.length > 0 &&
    !technicalEvidence.some(
      (evidence) =>
        evidence.type === "provider-report" &&
        evidence.trustTier === "provider-attested" &&
        evidence.producer?.kind === "provider",
    )
  )
    problems.push(
      `assurance tier ${classification.effectiveTier} requires a provider-attested provider report when technical controls apply`,
    );
  const routedPacks = [...(route.domainPacks || [])].sort();
  const activePacks = [...(domain.packs || [])].map((pack) => pack.id).sort();
  if (JSON.stringify(routedPacks) !== JSON.stringify(activePacks))
    problems.push("route domainPacks must match domain assurance packs");
  const mobilePack = (domain.packs || []).find(
    (pack) => pack.id === "mobile-ios",
  );
  if (mobilePack) {
    if (
      JSON.stringify(mobilePack.features || {}) !==
      JSON.stringify(route.domainFeatures?.["mobile-ios"] || {})
    )
      problems.push(
        "mobile-ios domain features must match the routed workload classification",
      );
    if (route.mobileIos?.status !== "commissioned")
      problems.push(
        "mobile-ios completion requires commissioned Apple identity in the route",
      );
    for (const field of ["scheme", "bundleAndTeam", "commissioningSha256"])
      if (mobilePack.identity?.[field] !== route.mobileIos?.[field])
        problems.push(
          `mobile-ios domain identity.${field} must match the commissioned route`,
        );
    if (route.gateApplicability?.smoke?.status === "required") {
      const smoke = artifacts.find(([name]) => name === "smoke")?.[1];
      if (["testflight", "app-store"].includes(smoke?.target?.kind)) {
        if (smoke.target.identifier !== mobilePack.identity?.buildId)
          problems.push(
            "Apple smoke target.identifier must match mobile-ios identity.buildId",
          );
        for (const field of ["scheme", "bundleAndTeam", "commissioningSha256"])
          if (smoke.target?.[field] !== mobilePack.identity?.[field])
            problems.push(
              `Apple smoke target.${field} must match mobile-ios domain identity`,
            );
      }
    }
  }
  const evals = artifacts.find(([name]) => name === "eval")[1];
  const context = artifacts.find(([name]) => name === "context")[1];
  const trajectory = artifacts.find(([name]) => name === "trajectory")[1];
  for (const field of [
    "attempts",
    "toolCalls",
    "tokens",
    "costUsd",
    "wallClockMinutes",
  ])
    if (goal.budgets?.[field] !== trajectory.budget?.limits?.[field])
      problems.push(
        `trajectory budget.limits.${field} must match goal.budgets.${field}`,
      );
  const contextQualitySuite = (evals.suites || []).find(
    (suite) => suite.id === context.contextQuality?.suiteId,
  );
  const currentContextDigest = sha256JsonFile(
    path.join(repoRoot, "context", "manifest.json"),
  );
  if (!contextQualitySuite?.contextComparison)
    problems.push(
      "enterprise finish line requires the commissioned context quality comparison",
    );
  else if (
    contextQualitySuite.contextComparison.contextManifestSha256 !==
    currentContextDigest
  )
    problems.push(
      "enterprise finish line context comparison must bind the current context/manifest.json",
    );
  if (
    route.gateApplicability?.eval?.status === "required" &&
    evals.status !== "passed"
  )
    problems.push("route-required eval cannot be skipped");
  const nonContextSuites = (evals.suites || []).filter(
    (suite) => suite.id !== context.contextQuality?.suiteId,
  );
  if (
    route.gateApplicability?.eval?.status === "not-applicable" &&
    nonContextSuites.length > 0
  )
    problems.push(
      "route must mark eval required when non-context eval suites are supplied",
    );
  if (productionRequired) {
    const production = artifacts.find(([name]) => name === "production")[1];
    const routedLayers = new Map(
      (route.productionLayers || []).map((layer) => [layer.layer, layer]),
    );
    for (const layer of production.layers || [])
      if (
        routedLayers.get(layer.layer)?.initialApplicability === "required" &&
        layer.applicability !== "required"
      )
        problems.push(
          `route-required production layer changed to not-applicable: ${layer.layer}`,
        );
  }
  const gitHead = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    killSignal: "SIGTERM",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (
    gitHead.status === 0 &&
    nonEmptyForBinding(gitHead.stdout) !== goal.commit
  )
    problems.push("goal.commit must match current Git HEAD");
  return problems;
}

function nonEmptyForBinding(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256JsonFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/enterprise-ai-gate-all.mjs --repo .",
    );
  let gates = GATES;
  try {
    const route = JSON.parse(
      readFileSync(
        path.join(path.resolve(args.repo), "run", "route.json"),
        "utf8",
      ),
    );
    if (route.gateApplicability?.foundation?.status !== "required")
      gates = gates.filter(([name]) => name !== "foundation");
    if (route.gateApplicability?.production?.status !== "required")
      gates = gates.filter(([name]) => name !== "production");
    if (route.gateApplicability?.["code-intelligence"]?.status !== "required")
      gates = gates.filter(([name]) => name !== "code-intelligence");
    if (route.gateApplicability?.smoke?.status !== "required")
      gates = gates.filter(([name]) => name !== "smoke");
  } catch {}
  if (
    existsSync(
      path.join(path.resolve(args.repo), "assurance", "authoritative.json"),
    )
  )
    gates = [
      ...gates,
      ["authoritative-assurance", "authoritative-assurance-gate.mjs"],
    ];
  const results = [];
  for (const [name, script] of gates) {
    const result = runEnterpriseValidator(
      path.join(SCRIPT_DIR, script),
      args.repo,
    );
    const timedOut = result.error?.code === "ETIMEDOUT";
    const output = `${result.stdout || ""}\n${result.stderr || ""}`
      .trim()
      .slice(-4000);
    results.push({
      name,
      ok: result.status === 0,
      exitCode: result.status,
      timedOut,
      output,
    });
  }
  let consistencyProblems = [];
  if (results.every((result) => result.ok)) {
    try {
      consistencyProblems = crossArtifactProblems(path.resolve(args.repo));
    } catch (error) {
      consistencyProblems = [`cross-artifact binding failed: ${error.message}`];
    }
  }
  const ok =
    results.every((result) => result.ok) && consistencyProblems.length === 0;
  const summary = {
    ok,
    gateCount: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).map((result) => result.name),
    consistencyProblems,
    results,
  };
  (ok ? console.log : console.error)(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
