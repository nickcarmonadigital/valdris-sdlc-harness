#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW_DATE = new Date();
const NOW = NOW_DATE.toISOString();
const COMMIT = "verify-enterprise-ai";
const ENVIRONMENT = "verification";
const PROFILE = "enterprise";
const IOS_IDENTITY = { buildId: "VALDRIS-BUILD-123", scheme: "ValdrisGame", bundleAndTeam: "com.example.valdris | TEAM123", commissioningSha256: "a".repeat(64) };

function relativeIso(hours) {
  return new Date(NOW_DATE.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(root, relative, value) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function runGate(root, script, extraArgs = []) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", script), "--repo", root, ...extraArgs], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function artifactEvidence(digest, subject) {
  return { type: "artifact", subject, runId: "VERIFY-001", trustTier: "ci-attested", producer: { name: "valdris-verifier", version: "0.7.0", kind: "ci" }, path: "proof/evidence.txt", sha256: digest, generatedAt: NOW, commit: COMMIT, environment: ENVIRONMENT };
}

function commandEvidence(subject) {
  return { type: "command", subject, runId: "VERIFY-001", trustTier: "ci-attested", producer: { name: "valdris-verifier", version: "0.7.0", kind: "ci" }, command: "npm test", exitCode: 0, completedAt: NOW, outputPath: "proof/command-output.txt", outputDigest: sha256("test output\n"), commit: COMMIT, environment: ENVIRONMENT };
}

function iosBuildEvidence() {
  return [
    { ...commandEvidence("IOS-BUILD-001"), command: "xcodebuild archive -scheme ValdrisGame", runnerOs: "macos", targetIdentifier: IOS_IDENTITY.buildId, ...IOS_IDENTITY },
    { type: "provider-report", subject: "IOS-BUILD-001", runId: "VERIFY-001", trustTier: "provider-attested", producer: { name: "GitHub Actions", version: "v1", kind: "provider" }, url: "https://github.com/example/valdris/actions/runs/123", status: "passed", checkedAt: NOW, digest: sha256("xcode build attestation\n"), provider: "GitHub Actions", reportId: "VERIFY-XCODE-BUILD-001", attestationPath: "proof/xcode-build-attestation.txt", targetIdentifier: IOS_IDENTITY.buildId, ...IOS_IDENTITY, commit: COMMIT, environment: ENVIRONMENT },
  ];
}

function iosQualityEvidence() {
  return [{ ...commandEvidence("IOS-QUALITY-001"), command: "xcodebuild test -scheme ValdrisGame -destination 'platform=iOS Simulator,name=iPhone 17'", runnerOs: "macos", deviceClass: "simulator", targetIdentifier: IOS_IDENTITY.buildId, ...IOS_IDENTITY }];
}

function iosDistributionEvidence() {
  return [
    { type: "provider-report", subject: "IOS-DISTRIBUTION-001", runId: "VERIFY-001", trustTier: "provider-attested", producer: { name: "App Store Connect", version: "v1", kind: "provider" }, url: "https://appstoreconnect.apple.com/apps/verification", status: "passed", checkedAt: NOW, digest: sha256("testflight attestation\n"), provider: "App Store Connect TestFlight", reportId: "VERIFY-TESTFLIGHT-001", attestationPath: "proof/testflight-attestation.txt", targetIdentifier: IOS_IDENTITY.buildId, ...IOS_IDENTITY, commit: COMMIT, environment: ENVIRONMENT },
    { type: "approval", subject: "IOS-DISTRIBUTION-001", runId: "VERIFY-001", trustTier: "human-approved", producer: { name: "release-owner", version: "v1", kind: "human" }, actorType: "human", actor: "release-owner", approvalId: "VERIFY-RELEASE-001", bridgeEventId: "VERIFY-BRIDGE-RELEASE-001", scope: "testflight-release", status: "granted", approvedAt: NOW, expiresAt: relativeIso(24), targetIdentifier: IOS_IDENTITY.buildId, ...IOS_IDENTITY, commit: COMMIT, environment: ENVIRONMENT },
  ];
}

const METRIC_CONTROLS = new Set(["FE-PERFORMANCE-001", "DEPLOY-HEALTH-001", "CLOUD-COST-001", "RATE-METERING-001", "SCALE-CAPACITY-001", "OBS-SLO-001", "DR-OBJECTIVES-001"]);
const COMMAND_CONTROLS = new Set(["FE-ACCESSIBILITY-001", "FE-BEHAVIOR-001", "API-CONTRACT-001", "API-FAILURE-001", "DATA-MIGRATION-001", "DATA-INTEGRITY-001", "DATA-RECOVERY-001", "AUTH-AUTHZ-001", "AUTH-TENANT-001", "AUTH-LIFECYCLE-001", "DEPLOY-ROLLBACK-001", "CI-GATES-001", "CI-SUPPLYCHAIN-001", "SEC-SECRETS-001", "SEC-VULNERABILITY-001", "RATE-FAILURE-001", "CACHE-KEY-001", "CACHE-INVALIDATION-001", "CACHE-ISOLATION-001", "SCALE-PROGRESSIVE-001", "SCALE-FAILOVER-001", "DR-RESTORE-001"]);

function metricEvidence(subject) {
  return { type: "metric", subject, runId: "VERIFY-001", trustTier: "ci-attested", producer: { name: "valdris-verifier", version: "0.7.0", kind: "ci" }, metric: `${subject}.verification`, value: 1, target: 1, operator: ">=", window: "verification-run", source: "synthetic-golden-path", observedAt: NOW, commit: COMMIT, environment: ENVIRONMENT };
}

function productionEvidence(digest, subject) {
  if (METRIC_CONTROLS.has(subject)) return metricEvidence(subject);
  if (COMMAND_CONTROLS.has(subject)) return commandEvidence(subject);
  return artifactEvidence(digest, subject);
}

function buildFixture(root) {
  cpSync(path.join(ROOT, "controls"), path.join(root, "controls"), { recursive: true });
  cpSync(path.join(ROOT, "skills"), path.join(root, "skills"), { recursive: true });
  mkdirSync(path.join(root, "proof"), { recursive: true });
  writeFileSync(path.join(root, "proof", "evidence.txt"), "verified enterprise and AI evidence\n");
  writeFileSync(path.join(root, "proof", "command-output.txt"), "test output\n");
  writeFileSync(path.join(root, "proof", "eval-results.jsonl"), "{\"case\":\"synthetic\",\"passed\":true}\n");
  writeFileSync(path.join(root, "proof", "trajectory.jsonl"), "{\"attempt\":\"attempt-1\",\"outcome\":\"succeeded\"}\n");
  writeFileSync(path.join(root, "proof", "testflight-attestation.txt"), "testflight attestation\n");
  writeFileSync(path.join(root, "proof", "xcode-build-attestation.txt"), "xcode build attestation\n");
  writeFileSync(path.join(root, "AGENTS.md"), "# Verification context\n");
  const digest = sha256(readFileSync(path.join(root, "proof", "evidence.txt")));
  const contextDigest = sha256(readFileSync(path.join(root, "AGENTS.md")));
  const productionCatalog = JSON.parse(readFileSync(path.join(root, "controls", "production-layers.v2.json"), "utf8"));
  const aiCatalog = JSON.parse(readFileSync(path.join(root, "controls", "genai-assurance.v1.json"), "utf8"));
  const registryPath = path.join(root, "skills", "registry.json");
  const requestText = "Run the enterprise AI verification harness against synthetic fixtures.";
  writeJson(root, "run/intake.json", {
    schema: "uash.intake.v1", runId: "VERIFY-001", receivedAt: NOW, profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, requestText, requestSha256: sha256(requestText),
    source: { actorType: "human", actor: "verification-owner" }, outcome: "Verify the enterprise and AI gate bundle",
    constraints: ["temporary synthetic data only"], exclusions: ["external mutation"], allowedActions: ["write temporary fixtures"], forbiddenActions: ["external mutation"],
    stoppingConditions: ["all positive gates pass", "all adversarial fixtures are rejected"]
  });
  const intakePath = path.join(root, "run", "intake.json");
  writeJson(root, "run/route.json", {
    schema: "uash.route.v1", runId: "VERIFY-001", generatedAt: NOW, profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, taskType: "docs-only",
    requestSignals: ["enterprise AI verification"], intakeSha256: sha256(readFileSync(intakePath)), registrySha256: sha256(readFileSync(registryPath)),
    catalogDigests: {
      production: sha256(readFileSync(path.join(root, "controls", "production-layers.v2.json"))),
      ai: sha256(readFileSync(path.join(root, "controls", "genai-assurance.v1.json"))),
      domainIndex: sha256(readFileSync(path.join(root, "controls", "domain-packs", "index.json"))), domainPacks: {}
    },
    skillPhases: [
      { phase: "intake-route", primary: "valdris-intake-route", supporting: ["valdris-genai-assurance"] },
      { phase: "delivery", primary: "valdris-genai-assurance", supporting: ["valdris-security-audit"] },
      { phase: "proof-handoff", primary: "valdris-proof-handoff", supporting: ["valdris-genai-assurance"] }
    ],
    productionLayers: productionCatalog.layers.map((layer) => ({ layer: layer.layer, initialApplicability: "required" })),
    ai: { workloadDetected: true, aiProfile: "AI-3", features: { rag: true, tools: true, memory: true, consequential: true, userFacing: true, sensitiveData: true, autonomous: true } }, domainPacks: [],
    gateApplicability: {
      "code-intelligence": { status: "not-applicable", reason: "Gate verifier fixture does not make codebase claims." },
      "production": { status: "required" }, "ai-assurance": { status: "required" },
      "domain-assurance": { status: "not-applicable", reason: "No product domain in the generic verifier." },
      "eval": { status: "required" }, "trajectory": { status: "required" },
      "smoke": { status: "not-applicable", reason: "No deployed runtime in the verifier fixture." }
    },
    redZone: [], rejectedAlternatives: [], authority: { allowedActions: ["write temporary fixtures"], forbiddenActions: ["external mutation"] }
  });

  const production = {
    schema: "uash.production-readiness.v2", generatedAt: NOW, runId: "VERIFY-001", status: "passed",
    summary: "Every catalog control is exercised by typed verification evidence.", profile: PROFILE, environment: ENVIRONMENT, commit: COMMIT,
    layers: productionCatalog.layers.map((layer) => ({
      layer: layer.layer, applicability: "required", status: "passed", owner: "verification-owner", dependencies: layer.dependencies,
      controls: layer.controls.map((control) => ({ id: control.id, status: "passed", evidence: [productionEvidence(digest, control.id)] })),
    })),
  };
  writeJson(root, "production/layer-assessment.json", production);

  const ai = {
    schema: "uash.ai-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
    environment: ENVIRONMENT, commit: COMMIT, workloadDetected: true, aiProfile: "AI-3", features: { rag: true, tools: true, memory: true, consequential: true, userFacing: true, sensitiveData: true, autonomous: true },
    controls: aiCatalog.controls.map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(digest, control.id)] })),
  };
  writeJson(root, "ai/assurance.json", ai);

  writeJson(root, "domain/assurance.json", {
    schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE,
    environment: ENVIRONMENT, commit: COMMIT, packs: [], skipReason: "The generic gate verification fixture does not commission a product domain pack."
  });

  const goal = {
    schema: "uash.goal.v1", goalId: "VERIFY-001", revision: 1, generatedAt: NOW, updatedAt: NOW, objective: requestText, requestSha256: sha256(requestText), initialRouteSha256: sha256(readFileSync(path.join(root, "run", "route.json"))), owner: "verification-owner", status: "completed", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT,
    budgets: { attempts: 3, toolCalls: 100, tokens: 100000, costUsd: 25, wallClockMinutes: 30 },
    stoppingConditions: [
      { id: "all-gates-pass", status: "passed", evidence: [artifactEvidence(digest, "all-gates-pass"), commandEvidence("all-gates-pass")] },
      { id: "negative-tests-reject", status: "passed", evidence: [artifactEvidence(digest, "negative-tests-reject")] },
    ],
    checkpoints: [{ id: "cp-1", status: "passed", recordedAt: NOW, summary: "Positive fixture ready and checked." }],
  };
  writeJson(root, "goal/goal.json", goal);

  writeJson(root, "evals/results.json", {
    schema: "uash.eval-results.v1", runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, generatedAt: NOW, status: "passed",
    suites: [{
      id: "adversarial-gates", kind: "ai",
      datasets: [{ id: "negative-fixtures", version: "v1", sha256: sha256("negative-fixtures-v1"), caseCount: 12 }],
      rubrics: [{ id: "invalid-evidence-must-fail", version: "v1", sha256: sha256("invalid evidence must fail") }],
      evaluator: { name: "valdris-verifier", version: "0.7.0" }, configDigest: sha256("verifier-config-v1"),
      model: { provider: "synthetic", name: "deterministic-fixture", version: "v1" }, promptVersion: "verification-v1", criticalFailures: 0,
      slices: [{ id: "adversarial", threshold: 1, value: 1, operator: ">=" }],
      resultPath: "proof/eval-results.jsonl", resultDigest: sha256("{\"case\":\"synthetic\",\"passed\":true}\n"),
      threshold: 1, value: 1, operator: ">=", startedAt: NOW, completedAt: NOW
    }],
  });
  writeJson(root, "trajectory/trajectory.json", {
    schema: "uash.trajectory.v1", goalId: "VERIFY-001", generatedAt: NOW, profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, finalStatus: "completed",
    budget: { limits: { attempts: 3, toolCalls: 100, tokens: 100000, costUsd: 25, wallClockMinutes: 30 }, used: { attempts: 1, toolCalls: 20, tokens: 5000, costUsd: 1, wallClockMinutes: 2 } },
    attempts: [{ id: "attempt-1", outcome: "succeeded", startedAt: NOW, completedAt: NOW, usage: { toolCalls: 20, tokens: 5000, costUsd: 1, wallClockMinutes: 2 }, actions: ["write-temporary-fixtures", "run-gates"] }],
    forbiddenActions: ["agent-self-approval", "fabricated-evidence"], violations: [],
    tracePath: "proof/trajectory.jsonl", traceDigest: sha256("{\"attempt\":\"attempt-1\",\"outcome\":\"succeeded\"}\n")
  });
  writeJson(root, "context/manifest.json", {
    schema: "uash.context-manifest.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT,
    loadedFiles: [{ path: "AGENTS.md", sha256: contextDigest, loadedAt: NOW }],
  });
  writeJson(root, "waivers/waivers.json", { schema: "uash.waiver-ledger.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, waivers: [] });
  return { production, ai, goal, digest };
}

function expectFailure(root, script, label, expectedProblem, extraArgs = []) {
  const result = runGate(root, script, extraArgs);
  assert(result.status !== 0, `${label} was incorrectly accepted`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectedProblem) assert(output.includes(expectedProblem), `${label} failed for the wrong reason; expected ${expectedProblem}:\n${output}`);
  return label;
}

function findControl(document, id) {
  return document.layers.flatMap((layer) => layer.controls || []).find((control) => control.id === id);
}

async function main() {
  const root = mkdtempSync(path.join(os.tmpdir(), "valdris-enterprise-ai-"));
  const negative = [];
  try {
    const baseline = buildFixture(root);
    const all = runGate(root, "enterprise-ai-gate-all.mjs");
    assert(all.status === 0, `positive enterprise/AI golden path failed:\n${all.stdout}\n${all.stderr}`);

    const nestedRoot = mkdtempSync(path.join(os.tmpdir(), "valdris-nested-target-"));
    try {
      buildFixture(nestedRoot);
      const nestedPack = path.join(nestedRoot, ".valdris-harness");
      mkdirSync(nestedPack, { recursive: true });
      cpSync(path.join(ROOT, "scripts"), path.join(nestedPack, "scripts"), { recursive: true });
      cpSync(path.join(nestedRoot, "controls"), path.join(nestedPack, "controls"), { recursive: true });
      cpSync(path.join(nestedRoot, "skills"), path.join(nestedPack, "skills"), { recursive: true });
      rmSync(path.join(nestedRoot, "controls"), { recursive: true, force: true });
      rmSync(path.join(nestedRoot, "skills"), { recursive: true, force: true });
      const nested = spawnSync(process.execPath, [path.join(nestedPack, "scripts", "enterprise-ai-gate-all.mjs"), "--repo", nestedRoot], { encoding: "utf8" });
      assert(nested.status === 0, `nested commissioned-pack portability failed:\n${nested.stdout}\n${nested.stderr}`);
    } finally {
      rmSync(nestedRoot, { recursive: true, force: true });
    }

    const intake = JSON.parse(readFileSync(path.join(root, "run", "intake.json"), "utf8"));
    const badIntake = structuredClone(intake);
    badIntake.requestSha256 = "0".repeat(64);
    writeJson(root, "run/intake.json", badIntake);
    negative.push(expectFailure(root, "intake-gate.mjs", "intake request digest mismatch", "does not match requestText"));
    writeJson(root, "run/intake.json", intake);

    const route = JSON.parse(readFileSync(path.join(root, "run", "route.json"), "utf8"));
    const badRoute = structuredClone(route);
    badRoute.registrySha256 = "0".repeat(64);
    writeJson(root, "run/route.json", badRoute);
    negative.push(expectFailure(root, "route-gate.mjs", "route registry digest mismatch", "registrySha256 does not match"));
    writeJson(root, "run/route.json", route);

    const productionDowngradeRoute = structuredClone(route);
    productionDowngradeRoute.gateApplicability.production = { status: "not-applicable", reason: "Agent attempted to downgrade required controls." };
    writeJson(root, "run/route.json", productionDowngradeRoute);
    negative.push(expectFailure(root, "route-gate.mjs", "required production gate downgrade", "required production layers must require production assurance"));
    writeJson(root, "run/route.json", route);

    const requiredCodeRoute = structuredClone(route);
    requiredCodeRoute.gateApplicability["code-intelligence"] = { status: "required" };
    writeJson(root, "run/route.json", requiredCodeRoute);
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "required code-intelligence artifact missing", "code-intelligence"));
    writeJson(root, "run/route.json", route);

    const requiredSmokeRoute = structuredClone(route);
    requiredSmokeRoute.gateApplicability.smoke = { status: "required" };
    writeJson(root, "run/route.json", requiredSmokeRoute);
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "required live smoke artifact missing", "smoke"));
    writeJson(root, "run/route.json", route);

    const downgradedIntake = structuredClone(intake);
    downgradedIntake.requestText = "Update documentation only.";
    downgradedIntake.requestSha256 = sha256(downgradedIntake.requestText);
    writeJson(root, "run/intake.json", downgradedIntake);
    const downgradedRoute = structuredClone(route);
    downgradedRoute.taskType = "docs-only";
    downgradedRoute.requestSignals = ["docs-only", "non-AI workload"];
    downgradedRoute.intakeSha256 = sha256(readFileSync(path.join(root, "run", "intake.json")));
    downgradedRoute.productionLayers = downgradedRoute.productionLayers.map(({ layer }) => ({ layer, initialApplicability: "not-applicable", reason: "Rewritten as docs-only." }));
    downgradedRoute.ai = { workloadDetected: false, aiProfile: "AI-0", features: { rag: false, tools: false, memory: false, consequential: false, userFacing: false, sensitiveData: false, autonomous: false } };
    downgradedRoute.domainPacks = [];
    downgradedRoute.catalogDigests.domainPacks = {};
    downgradedRoute.gateApplicability = {
      "code-intelligence": { status: "not-applicable", reason: "Rewritten docs-only scope." }, production: { status: "not-applicable", reason: "Rewritten docs-only scope." },
      "ai-assurance": { status: "not-applicable", reason: "No AI in rewritten scope." }, "domain-assurance": { status: "not-applicable", reason: "No domain in rewritten scope." },
      eval: { status: "not-applicable", reason: "No behavior in rewritten scope." }, trajectory: { status: "required" }, smoke: { status: "not-applicable", reason: "No runtime in rewritten scope." }
    };
    writeJson(root, "run/route.json", downgradedRoute);
    writeJson(root, "ai/assurance.json", { schema: "uash.ai-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE, environment: ENVIRONMENT, commit: COMMIT, workloadDetected: false, aiProfile: "AI-0", features: downgradedRoute.ai.features, controls: [], skipReason: "Rewritten intake claims no AI workload." });
    writeJson(root, "evals/results.json", { schema: "uash.eval-results.v1", runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, generatedAt: NOW, status: "skipped", suites: [], skipReason: "Rewritten docs-only scope." });
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "intake and route rewrite downgrade", "goal objective/requestSha256 must remain bound"));
    writeJson(root, "run/intake.json", intake);
    writeJson(root, "run/route.json", route);
    writeJson(root, "ai/assurance.json", baseline.ai);
    writeJson(root, "evals/results.json", { schema: "uash.eval-results.v1", runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, generatedAt: NOW, status: "passed", suites: [{ id: "adversarial-gates", kind: "ai", datasets: [{ id: "negative-fixtures", version: "v1", sha256: sha256("negative-fixtures-v1"), caseCount: 12 }], rubrics: [{ id: "invalid-evidence-must-fail", version: "v1", sha256: sha256("invalid evidence must fail") }], evaluator: { name: "valdris-verifier", version: "0.7.0" }, configDigest: sha256("verifier-config-v1"), model: { provider: "synthetic", name: "deterministic-fixture", version: "v1" }, promptVersion: "verification-v1", criticalFailures: 0, slices: [{ id: "adversarial", threshold: 1, value: 1, operator: ">=" }], resultPath: "proof/eval-results.jsonl", resultDigest: sha256("{\"case\":\"synthetic\",\"passed\":true}\n"), threshold: 1, value: 1, operator: ">=", startedAt: NOW, completedAt: NOW }] });

    writeJson(root, "smoke/smoke_proof.json", {
      schema: "uash.live-smoke.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, status: "passed",
      target: { kind: "testflight", identifier: IOS_IDENTITY.buildId, scheme: IOS_IDENTITY.scheme, bundleAndTeam: IOS_IDENTITY.bundleAndTeam, commissioningSha256: IOS_IDENTITY.commissioningSha256 },
      control: { id: "LIVE-SMOKE-001", status: "passed", evidence: [{ ...commandEvidence("LIVE-SMOKE-001"), command: "echo smoke", trustTier: "automated-local", producer: { name: "local-shell", version: "v1", kind: "tool" } }] }
    });
    negative.push(expectFailure(root, "smoke-gate.mjs", "generic local TestFlight smoke", "requires CI-command or provider-attested evidence"));
    writeJson(root, "smoke/smoke_proof.json", {
      schema: "uash.live-smoke.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, status: "passed",
      target: { kind: "testflight", identifier: IOS_IDENTITY.buildId, scheme: IOS_IDENTITY.scheme, bundleAndTeam: IOS_IDENTITY.bundleAndTeam, commissioningSha256: IOS_IDENTITY.commissioningSha256 },
      control: { id: "LIVE-SMOKE-001", status: "passed", evidence: [{ type: "provider-report", subject: "LIVE-SMOKE-001", runId: "VERIFY-001", trustTier: "provider-attested", producer: { name: "App Store Connect", version: "v1", kind: "provider" }, url: "https://appstoreconnect.apple.com/apps/verification", status: "passed", checkedAt: NOW, digest: sha256("testflight attestation\n"), provider: "App Store Connect TestFlight", reportId: "VERIFY-SMOKE-001", attestationPath: "proof/testflight-attestation.txt", targetIdentifier: IOS_IDENTITY.buildId, ...IOS_IDENTITY, commit: COMMIT, environment: ENVIRONMENT }] }
    });
    const validSmoke = runGate(root, "smoke-gate.mjs");
    assert(validSmoke.status === 0, `valid TestFlight smoke was rejected:\n${validSmoke.stdout}\n${validSmoke.stderr}`);

    let production = structuredClone(baseline.production);
    findControl(production, "API-TRACE-001").evidence[0].path = "proof/missing.txt";
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "missing artifact", "path must be a real non-symlink file"));

    production = structuredClone(baseline.production);
    findControl(production, "API-TRACE-001").evidence[0].sha256 = "0".repeat(64);
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "artifact hash mismatch", "sha256 does not match"));

    production = structuredClone(baseline.production);
    findControl(production, "FE-PERFORMANCE-001").evidence[0].value = 0;
    findControl(production, "FE-PERFORMANCE-001").evidence[0].target = 1;
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "failing metric", "does not meet its target"));

    production = structuredClone(baseline.production);
    production.layers[0] = { layer: production.layers[0].layer, applicability: "not-applicable", status: "skipped", owner: "verification-owner" };
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "unjustified skip", "skipped without reason"));
    writeJson(root, "production/layer-assessment.json", baseline.production);

    const ai = structuredClone(baseline.ai);
    ai.controls = ai.controls.filter((control) => control.id !== "AI-RAG-001");
    writeJson(root, "ai/assurance.json", ai);
    negative.push(expectFailure(root, "ai-assurance-gate.mjs", "missing conditional AI control", "missing control: AI-RAG-001"));

    ai.controls = structuredClone(baseline.ai.controls);
    ai.controls[0].evidence = [{ type: "approval", subject: ai.controls[0].id, runId: "VERIFY-001", trustTier: "human-approved", producer: { name: "codex", version: "0.7.0", kind: "human" }, commit: COMMIT, environment: ENVIRONMENT, actorType: "agent", actor: "codex", approvalId: "fake", scope: "production", status: "granted", approvedAt: NOW, expiresAt: relativeIso(24) }];
    writeJson(root, "ai/assurance.json", ai);
    negative.push(expectFailure(root, "ai-assurance-gate.mjs", "agent self-approval", "actorType must be human"));
    writeJson(root, "ai/assurance.json", baseline.ai);

    const iosCatalog = JSON.parse(readFileSync(path.join(root, "controls", "domain-packs", "mobile-ios.v1.json"), "utf8"));
    writeJson(root, "domain/assurance.json", {
      schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
      environment: ENVIRONMENT, commit: COMMIT,
      packs: [{ id: "mobile-ios", identity: IOS_IDENTITY, controls: iosCatalog.controls.slice(1).map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(baseline.digest, control.id)] })) }]
    });
    negative.push(expectFailure(root, "domain-assurance-gate.mjs", "missing iOS domain control", "missing control: IOS-SUPPORT-001"));

    writeJson(root, "domain/assurance.json", {
      schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
      environment: ENVIRONMENT, commit: COMMIT,
      packs: [{ id: "mobile-ios", identity: IOS_IDENTITY, features: { push: false }, controls: iosCatalog.controls.filter((control) => control.id !== "IOS-PUSH-001").map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(baseline.digest, control.id)] })) }]
    });
    negative.push(expectFailure(root, "domain-assurance-gate.mjs", "generic iOS release evidence", "requires xcodebuild archive command evidence"));

    writeJson(root, "domain/assurance.json", {
      schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
      environment: ENVIRONMENT, commit: COMMIT,
      packs: [{ id: "mobile-ios", identity: IOS_IDENTITY, features: { push: false }, controls: iosCatalog.controls.filter((control) => control.id !== "IOS-PUSH-001").map((control) => ({
        id: control.id,
        status: "passed",
        evidence: control.id === "IOS-QUALITY-001" ? iosQualityEvidence() : control.id === "IOS-BUILD-001" ? iosBuildEvidence() : control.id === "IOS-DISTRIBUTION-001" ? iosDistributionEvidence() : [artifactEvidence(baseline.digest, control.id)]
      })) }]
    });
    const validIos = runGate(root, "domain-assurance-gate.mjs");
    assert(validIos.status === 0, `valid native iOS evidence was rejected:\n${validIos.stdout}\n${validIos.stderr}`);
    const mismatchedIos = JSON.parse(readFileSync(path.join(root, "domain", "assurance.json"), "utf8"));
    mismatchedIos.packs[0].controls.find((control) => control.id === "IOS-DISTRIBUTION-001").evidence[0].targetIdentifier = "WRONG-BUILD";
    writeJson(root, "domain/assurance.json", mismatchedIos);
    negative.push(expectFailure(root, "domain-assurance-gate.mjs", "mismatched iOS build identity", "evidence must bind buildId"));
    writeJson(root, "domain/assurance.json", { schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE, environment: ENVIRONMENT, commit: COMMIT, packs: [], skipReason: "The generic gate verification fixture does not commission a product domain pack." });

    const goal = structuredClone(baseline.goal);
    goal.stoppingConditions[0].status = "pending";
    delete goal.stoppingConditions[0].evidence;
    writeJson(root, "goal/goal.json", goal);
    negative.push(expectFailure(root, "goal-gate.mjs", "incomplete completed goal", "completed goal requires every stopping condition"));
    writeJson(root, "goal/goal.json", baseline.goal);

    const failedGoal = structuredClone(baseline.goal);
    failedGoal.status = "failed";
    writeJson(root, "goal/goal.json", failedGoal);
    negative.push(expectFailure(root, "goal-gate.mjs", "failed goal accepted as active", "active-goal validation rejects terminal/blocking status", ["--allow-active"]));
    writeJson(root, "goal/goal.json", baseline.goal);

    const trajectory = JSON.parse(readFileSync(path.join(root, "trajectory", "trajectory.json"), "utf8"));
    trajectory.budget.used.attempts = trajectory.budget.limits.attempts + 1;
    writeJson(root, "trajectory/trajectory.json", trajectory);
    negative.push(expectFailure(root, "trajectory-gate.mjs", "exceeded retry budget", "budget exceeded: attempts"));

    const evals = JSON.parse(readFileSync(path.join(root, "evals", "results.json"), "utf8"));
    evals.suites[0].value = 0;
    writeJson(root, "evals/results.json", evals);
    negative.push(expectFailure(root, "eval-gate.mjs", "failed eval threshold", "does not meet its threshold"));

    writeFileSync(path.join(root, ".env"), "SECRET=value\n");
    const context = JSON.parse(readFileSync(path.join(root, "context", "manifest.json"), "utf8"));
    context.loadedFiles = [{ path: ".env", sha256: sha256("SECRET=value\n"), loadedAt: NOW }];
    writeJson(root, "context/manifest.json", context);
    negative.push(expectFailure(root, "context-manifest-gate.mjs", "secret context load", "secret-like"));

    const registry = JSON.parse(readFileSync(path.join(root, "skills", "registry.json"), "utf8"));
    registry.skills[0].path = "../outside/SKILL.md";
    writeJson(root, "skills/untrusted-registry.json", registry);
    negative.push(expectFailure(root, "skill-registry-gate.mjs", "skill path escape", "outside repo", ["--file", "skills/untrusted-registry.json"]));

    writeJson(root, "waivers/waivers.json", {
      schema: "uash.waiver-ledger.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT,
      waivers: [{ id: "expired-1", controlId: "SEC-VULNERABILITY-001", status: "active", reason: "Synthetic expired waiver", riskOwner: "owner", riskOwnerType: "human", approvedBy: "approver", approvedByType: "human", approvalEventId: "event-1", scope: "security", compensatingControls: ["isolation"], remediationIssue: "https://example.invalid/issues/1", issuedAt: relativeIso(-48), expiresAt: relativeIso(-24) }]
    });
    negative.push(expectFailure(root, "waiver-gate.mjs", "expired waiver", "is expired"));

    console.log(JSON.stringify({ ok: true, goldenPath: "enterprise + AI all-gates", nestedPackPortability: true, positiveGates: 11, catalogControls: { production: 39, ai: 10, domainPacks: 4 }, negativeTests: negative.length, rejected: negative }, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fixtureIndex = process.argv.indexOf("--write-fixture");
if (fixtureIndex >= 0) {
  const target = process.argv[fixtureIndex + 1];
  if (!target) {
    console.error("--write-fixture requires an output directory");
    process.exit(1);
  }
  const root = path.resolve(target);
  mkdirSync(root, { recursive: true });
  buildFixture(root);
  console.log(JSON.stringify({ ok: true, fixture: root, runId: "VERIFY-001" }, null, 2));
} else {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
