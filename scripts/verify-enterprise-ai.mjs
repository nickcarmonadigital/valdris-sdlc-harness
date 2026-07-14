#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRODUCTION_LAYERS } from "./production-layer-gate.mjs";
import { hasTokenCorrelatedUnknownApproval } from "./enterprise-ai-gate-all.mjs";
import { classifyWorkload, deliveryPrimaryForTask, executionBudgetForClassification, MANDATORY_FORBIDDEN_ACTIONS, MANDATORY_RED_ZONE, supportingSkillsForClassification } from "./workload-classifier-lib.mjs";

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

function classificationBinding(root, classification) {
  return {
    effectiveTier: classification.effectiveTier,
    workloadClassificationSha256: sha256(readFileSync(path.join(root, "run", "workload-classification.json"))),
  };
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
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "verification-fixture.js"), "export function verifiedFixture() { return 'verified'; }\n");
  const digest = sha256(readFileSync(path.join(root, "proof", "evidence.txt")));
  const contextDigest = sha256(readFileSync(path.join(root, "AGENTS.md")));
  const productionCatalog = JSON.parse(readFileSync(path.join(root, "controls", "production-layers.v2.json"), "utf8"));
  const foundationCatalog = JSON.parse(readFileSync(path.join(root, "controls", "foundation-layer.v1.json"), "utf8"));
  const workloadTaxonomy = JSON.parse(readFileSync(path.join(root, "controls", "workload-taxonomy.v1.json"), "utf8"));
  const aiCatalog = JSON.parse(readFileSync(path.join(root, "controls", "genai-assurance.v1.json"), "utf8"));
  const domainIndex = JSON.parse(readFileSync(path.join(root, "controls", "domain-packs", "index.json"), "utf8"));
  const registryPath = path.join(root, "skills", "registry.json");
  const requestText = "Evaluate an enterprise AI agent harness with RAG, tools, memory, async workflow orchestration, and typed controls.";
  const catalogDigests = {
    taxonomy: sha256(readFileSync(path.join(root, "controls", "workload-taxonomy.v1.json"))),
    foundation: sha256(readFileSync(path.join(root, "controls", "foundation-layer.v1.json"))),
    production: sha256(readFileSync(path.join(root, "controls", "production-layers.v2.json"))),
    ai: sha256(readFileSync(path.join(root, "controls", "genai-assurance.v1.json"))),
    domainIndex: sha256(readFileSync(path.join(root, "controls", "domain-packs", "index.json"))),
  };
  const classification = classifyWorkload({
    runId: "VERIFY-001", generatedAt: NOW, requestText, requestSha256: sha256(requestText), requestedProfile: PROFILE,
    environment: ENVIRONMENT, commit: COMMIT, taxonomy: workloadTaxonomy, domainIndex, productionLayers: PRODUCTION_LAYERS,
    productionCatalog, catalogDigests,
  });
  const executionBudget = executionBudgetForClassification(classification);
  const deliveryPrimary = deliveryPrimaryForTask(classification.taskType);
  const supportingSkills = supportingSkillsForClassification(classification, deliveryPrimary);
  writeJson(root, "run/intake.json", {
    schema: "uash.intake.v1", runId: "VERIFY-001", receivedAt: NOW, profile: PROFILE, requestedProfile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, requestText, requestSha256: sha256(requestText),
    source: { actorType: "human", actor: "verification-owner" }, outcome: "Verify the enterprise and AI gate bundle",
    constraints: ["temporary synthetic data only"], exclusions: ["external mutation"], allowedActions: ["write temporary fixtures"], forbiddenActions: [...MANDATORY_FORBIDDEN_ACTIONS],
    stoppingConditions: ["all positive gates pass", "all adversarial fixtures are rejected"], executionBudget
  });
  const intakePath = path.join(root, "run", "intake.json");
  writeJson(root, "run/workload-classification.json", classification);
  const classificationPath = path.join(root, "run", "workload-classification.json");
  const binding = classificationBinding(root, classification);
  writeJson(root, "run/route.json", {
    schema: "uash.route.v2", runId: "VERIFY-001", generatedAt: NOW, profile: PROFILE, requestedProfile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, taskType: classification.taskType, controlledDocumentation: classification.controlledDocumentation, executionBudget,
    requestSignals: classification.matchedSignals, intakeSha256: sha256(readFileSync(intakePath)), workloadClassificationSha256: sha256(readFileSync(classificationPath)), registrySha256: sha256(readFileSync(registryPath)),
    catalogDigests: {
      ...catalogDigests, domainPacks: {}
    },
    skillPhases: [
      { phase: "intake-route", primary: "valdris-intake-route", supporting: supportingSkills },
      { phase: "delivery", primary: deliveryPrimary, supporting: supportingSkills },
      { phase: "proof-handoff", primary: "valdris-proof-handoff", supporting: supportingSkills.slice(0, 3) }
    ],
    assuranceTier: { profileFloor: classification.profileTierFloor, effective: classification.effectiveTier },
    workloadProfiles: classification.workloadProfiles, crossCuttingConcerns: classification.crossCuttingConcerns, domainFeatures: classification.domainFeatures, materialUnknowns: classification.materialUnknowns, foundation: classification.foundation,
    productionLayers: classification.productionLayers,
    ai: classification.ai, domainPacks: classification.domainPacks,
    gateApplicability: {
      "code-intelligence": { status: "required" }, foundation: { status: "required" },
      production: { status: "required" }, "ai-assurance": { status: "required" },
      "domain-assurance": { status: "not-applicable", reason: "No product domain in the generic verifier." },
      "eval": { status: "required" }, "trajectory": { status: "required" },
      "smoke": { status: "not-applicable", reason: "No deployed runtime in the verifier fixture." }
    },
    redZone: [...MANDATORY_RED_ZONE], rejectedAlternatives: [], authority: { allowedActions: ["write temporary fixtures"], forbiddenActions: [...MANDATORY_FORBIDDEN_ACTIONS] }
  });

  const production = {
    schema: "uash.production-readiness.v2", generatedAt: NOW, runId: "VERIFY-001", status: "passed",
    summary: "Every catalog control is exercised by typed verification evidence.", profile: PROFILE, ...binding, environment: ENVIRONMENT, commit: COMMIT,
    layers: productionCatalog.layers.map((layer) => classification.productionLayers.find((item) => item.layer === layer.layer)?.initialApplicability === "required"
      ? { layer: layer.layer, applicability: "required", status: "passed", owner: "verification-owner", dependencies: layer.dependencies, controls: layer.controls.map((control) => ({ id: control.id, status: "passed", evidence: [productionEvidence(digest, control.id)] })) }
      : { layer: layer.layer, applicability: "not-applicable", status: "skipped", owner: "verification-owner", reason: "The deterministic verifier classification did not require this production domain." }),
  };
  writeJson(root, "production/layer-assessment.json", production);

  const foundation = {
    schema: "uash.foundation-assessment.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed",
    summary: "Layer 0 product, requirements, architecture, strategy, ownership, and risk controls are evidence-backed.",
    profile: PROFILE, effectiveTier: classification.effectiveTier, environment: ENVIRONMENT, commit: COMMIT, owner: "verification-owner",
    catalogSha256: catalogDigests.foundation,
    workloadClassificationSha256: sha256(readFileSync(classificationPath)),
    capabilities: foundationCatalog.capabilities.map((capability) => ({
      id: capability.id, applicability: "required", status: "passed", owner: "verification-owner",
      controls: capability.controls.map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(digest, control.id)] })),
    })),
  };
  writeJson(root, "foundation/assessment.json", foundation);

  const ai = {
    schema: "uash.ai-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
    ...binding, environment: ENVIRONMENT, commit: COMMIT, workloadDetected: classification.ai.workloadDetected, aiProfile: classification.ai.aiProfile, features: classification.ai.features,
    controls: aiCatalog.controls.map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(digest, control.id)] })),
  };
  writeJson(root, "ai/assurance.json", ai);

  writeJson(root, "domain/assurance.json", {
    schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE,
    ...binding, environment: ENVIRONMENT, commit: COMMIT, packs: [], skipReason: "The generic gate verification fixture does not commission a product domain pack."
  });

  const goal = {
    schema: "uash.goal.v1", goalId: "VERIFY-001", revision: 1, generatedAt: NOW, updatedAt: NOW, objective: requestText, requestSha256: sha256(requestText), initialRouteSha256: sha256(readFileSync(path.join(root, "run", "route.json"))), owner: "verification-owner", status: "completed", profile: PROFILE, ...binding, commit: COMMIT, environment: ENVIRONMENT,
    budgets: executionBudget,
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
    budget: { limits: executionBudget, used: { attempts: 1, toolCalls: 20, tokens: 5000, costUsd: 1, wallClockMinutes: 2 } },
    attempts: [{ id: "attempt-1", outcome: "succeeded", startedAt: NOW, completedAt: NOW, usage: { toolCalls: 20, tokens: 5000, costUsd: 1, wallClockMinutes: 2 }, actions: ["write-temporary-fixtures", "run-gates"] }],
    forbiddenActions: ["agent-self-approval", "fabricated-evidence"], violations: [],
    tracePath: "proof/trajectory.jsonl", traceDigest: sha256("{\"attempt\":\"attempt-1\",\"outcome\":\"succeeded\"}\n")
  });
  writeJson(root, "context/manifest.json", {
    schema: "uash.context-manifest.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT,
    loadedFiles: [{ path: "AGENTS.md", sha256: contextDigest, loadedAt: NOW }],
  });
  writeJson(root, "waivers/waivers.json", { schema: "uash.waiver-ledger.v1", generatedAt: NOW, runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, waivers: [] });
  const graph = spawnSync(process.execPath, [path.join(ROOT, "scripts", "code-intelligence-scan.mjs"), "--repo", root, "--provider", "local"], { encoding: "utf8" });
  assert(graph.status === 0, `verification fixture code-intelligence scan failed:\n${graph.stdout}\n${graph.stderr}`);
  return { production, foundation, classification, binding, ai, goal, digest };
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
    const baselineEval = JSON.parse(readFileSync(path.join(root, "evals", "results.json"), "utf8"));
    const unknown = { id: "regulatory-applicability" };
    const classificationDigest = baseline.binding.workloadClassificationSha256;
    const localOnlyApproval = { type: "approval", actorType: "human", status: "granted", trustTier: "human-approved", producer: { kind: "human" }, scope: `classification-unknown:${unknown.id}`, runId: baseline.classification.runId, workloadClassificationSha256: classificationDigest, unknownId: unknown.id };
    assert(!hasTokenCorrelatedUnknownApproval({ evidence: [localOnlyApproval] }, unknown, baseline.classification, classificationDigest), "local-only material-unknown approval was incorrectly accepted");
    const correlatedApproval = { ...localOnlyApproval, bridgeEventId: "VERIFY-MATERIAL-UNKNOWN-001", tokenCorrelation: { runId: baseline.classification.runId, workloadClassificationSha256: classificationDigest, unknownId: unknown.id } };
    assert(hasTokenCorrelatedUnknownApproval({ evidence: [correlatedApproval] }, unknown, baseline.classification, classificationDigest), "token-correlated material-unknown approval was rejected");
    negative.push("local-only material-unknown approval");
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

    rmSync(path.join(root, "graph"), { recursive: true, force: true });
    rmSync(path.join(root, "design"), { recursive: true, force: true });
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "required code-intelligence artifact missing", "code-intelligence"));
    const restoredGraph = spawnSync(process.execPath, [path.join(ROOT, "scripts", "code-intelligence-scan.mjs"), "--repo", root, "--provider", "local"], { encoding: "utf8" });
    assert(restoredGraph.status === 0, `failed to restore verifier code-intelligence artifacts:\n${restoredGraph.stdout}\n${restoredGraph.stderr}`);

    const requiredSmokeRoute = structuredClone(route);
    requiredSmokeRoute.gateApplicability.smoke = { status: "required" };
    writeJson(root, "run/route.json", requiredSmokeRoute);
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "required live smoke artifact missing", "smoke"));
    writeJson(root, "run/route.json", route);

    const downgradedIntake = structuredClone(intake);
    downgradedIntake.requestText = "Update documentation only.";
    downgradedIntake.requestSha256 = sha256(downgradedIntake.requestText);
    writeJson(root, "run/intake.json", downgradedIntake);
    const downgradedClassification = classifyWorkload({
      runId: "VERIFY-001", generatedAt: NOW, requestText: downgradedIntake.requestText, requestSha256: downgradedIntake.requestSha256, requestedProfile: PROFILE,
      environment: ENVIRONMENT, commit: COMMIT,
      taxonomy: JSON.parse(readFileSync(path.join(root, "controls", "workload-taxonomy.v1.json"), "utf8")),
      domainIndex: JSON.parse(readFileSync(path.join(root, "controls", "domain-packs", "index.json"), "utf8")),
      productionLayers: PRODUCTION_LAYERS,
      productionCatalog: JSON.parse(readFileSync(path.join(root, "controls", "production-layers.v2.json"), "utf8")),
      catalogDigests: Object.fromEntries(["taxonomy", "foundation", "production", "ai", "domainIndex"].map((key) => [key, route.catalogDigests[key]])),
    });
    const downgradedExecutionBudget = executionBudgetForClassification(downgradedClassification);
    downgradedIntake.executionBudget = downgradedExecutionBudget;
    writeJson(root, "run/intake.json", downgradedIntake);
    writeJson(root, "run/workload-classification.json", downgradedClassification);
    const downgradedRoute = structuredClone(route);
    downgradedRoute.taskType = downgradedClassification.taskType;
    downgradedRoute.controlledDocumentation = downgradedClassification.controlledDocumentation;
    downgradedRoute.executionBudget = downgradedExecutionBudget;
    downgradedRoute.requestSignals = downgradedClassification.matchedSignals;
    downgradedRoute.intakeSha256 = sha256(readFileSync(path.join(root, "run", "intake.json")));
    downgradedRoute.workloadClassificationSha256 = sha256(readFileSync(path.join(root, "run", "workload-classification.json")));
    downgradedRoute.assuranceTier = { profileFloor: downgradedClassification.profileTierFloor, effective: downgradedClassification.effectiveTier };
    downgradedRoute.workloadProfiles = downgradedClassification.workloadProfiles;
    downgradedRoute.crossCuttingConcerns = downgradedClassification.crossCuttingConcerns;
    downgradedRoute.domainFeatures = downgradedClassification.domainFeatures;
    downgradedRoute.materialUnknowns = downgradedClassification.materialUnknowns;
    downgradedRoute.foundation = downgradedClassification.foundation;
    downgradedRoute.productionLayers = downgradedClassification.productionLayers;
    downgradedRoute.ai = downgradedClassification.ai;
    downgradedRoute.domainPacks = downgradedClassification.domainPacks;
    const downgradedPrimary = deliveryPrimaryForTask(downgradedClassification.taskType);
    const downgradedSupporting = supportingSkillsForClassification(downgradedClassification, downgradedPrimary);
    downgradedRoute.skillPhases = [
      { phase: "intake-route", primary: "valdris-intake-route", supporting: downgradedSupporting },
      { phase: "delivery", primary: downgradedPrimary, supporting: downgradedSupporting },
      { phase: "proof-handoff", primary: "valdris-proof-handoff", supporting: downgradedSupporting.slice(0, 3) },
    ];
    downgradedRoute.catalogDigests.domainPacks = {};
    downgradedRoute.gateApplicability = {
      "code-intelligence": { status: "not-applicable", reason: "Rewritten docs-only scope." }, foundation: { status: "not-applicable", reason: "Rewritten docs-only scope." }, production: { status: "not-applicable", reason: "Rewritten docs-only scope." },
      "ai-assurance": { status: "not-applicable", reason: "No AI in rewritten scope." }, "domain-assurance": { status: "not-applicable", reason: "No domain in rewritten scope." },
      eval: { status: "not-applicable", reason: "No behavior in rewritten scope." }, trajectory: { status: "required" }, smoke: { status: "not-applicable", reason: "No runtime in rewritten scope." }
    };
    writeJson(root, "run/route.json", downgradedRoute);
    const downgradedBinding = classificationBinding(root, downgradedClassification);
    const downgradedGoal = structuredClone(baseline.goal);
    Object.assign(downgradedGoal, downgradedBinding, { budgets: downgradedExecutionBudget });
    writeJson(root, "goal/goal.json", downgradedGoal);
    writeJson(root, "ai/assurance.json", { schema: "uash.ai-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE, ...downgradedBinding, environment: ENVIRONMENT, commit: COMMIT, workloadDetected: false, aiProfile: "AI-0", features: downgradedRoute.ai.features, controls: [], skipReason: "Rewritten intake claims no AI workload." });
    writeJson(root, "domain/assurance.json", { schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE, ...downgradedBinding, environment: ENVIRONMENT, commit: COMMIT, packs: [], skipReason: "Rewritten intake has no product domain pack." });
    writeJson(root, "evals/results.json", { schema: "uash.eval-results.v1", runId: "VERIFY-001", profile: PROFILE, commit: COMMIT, environment: ENVIRONMENT, generatedAt: NOW, status: "skipped", suites: [], skipReason: "Rewritten docs-only scope." });
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "intake and route rewrite downgrade", "goal objective/requestSha256 must remain bound"));
    writeJson(root, "run/intake.json", intake);
    writeJson(root, "run/workload-classification.json", baseline.classification);
    writeJson(root, "run/route.json", route);
    writeJson(root, "goal/goal.json", baseline.goal);
    writeJson(root, "ai/assurance.json", baseline.ai);
    writeJson(root, "domain/assurance.json", { schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE, ...baseline.binding, environment: ENVIRONMENT, commit: COMMIT, packs: [], skipReason: "The generic gate verification fixture does not commission a product domain pack." });
    writeJson(root, "evals/results.json", baselineEval);

    const classification = structuredClone(baseline.classification);
    classification.crossCuttingConcerns = classification.crossCuttingConcerns.filter((id) => id !== "async-workflow-orchestration");
    writeJson(root, "run/workload-classification.json", classification);
    negative.push(expectFailure(root, "workload-classification-gate.mjs", "dropped async orchestration concern", "crossCuttingConcerns does not match deterministic classification"));
    writeJson(root, "run/workload-classification.json", baseline.classification);

    classification.effectiveTier = "T0";
    writeJson(root, "run/workload-classification.json", classification);
    negative.push(expectFailure(root, "workload-classification-gate.mjs", "assurance tier downgrade", "cannot downgrade the requested maturity profile"));
    writeJson(root, "run/workload-classification.json", baseline.classification);

    let foundation = structuredClone(baseline.foundation);
    foundation.capabilities[0].controls = foundation.capabilities[0].controls.slice(1);
    writeJson(root, "foundation/assessment.json", foundation);
    negative.push(expectFailure(root, "foundation-gate.mjs", "missing Layer 0 control", "missing control: FND-PRODUCT-001"));
    writeJson(root, "foundation/assessment.json", baseline.foundation);

    foundation = structuredClone(baseline.foundation);
    foundation.workloadClassificationSha256 = "0".repeat(64);
    writeJson(root, "foundation/assessment.json", foundation);
    negative.push(expectFailure(root, "foundation-gate.mjs", "stale Layer 0 classification binding", "workloadClassificationSha256 does not match"));
    writeJson(root, "foundation/assessment.json", baseline.foundation);

    const controlledClassification = structuredClone(baseline.classification);
    controlledClassification.controlledDocumentation = true;
    writeJson(root, "run/workload-classification.json", controlledClassification);
    const controlledFoundation = structuredClone(baseline.foundation);
    Object.assign(controlledFoundation, classificationBinding(root, controlledClassification));
    const controlledRequired = new Set(["product-domain", "requirements-acceptance", "decisions-ownership-risk"]);
    controlledFoundation.capabilities = controlledFoundation.capabilities.map((capability) => controlledRequired.has(capability.id)
      ? capability
      : { id: capability.id, applicability: "not-applicable", status: "skipped", owner: capability.owner, reason: "Controlled documentation does not change this foundation capability." });
    writeJson(root, "foundation/assessment.json", controlledFoundation);
    const controlledFoundationGate = runGate(root, "foundation-gate.mjs");
    assert(controlledFoundationGate.status === 0, `controlled-documentation foundation subset was rejected:\n${controlledFoundationGate.stdout}\n${controlledFoundationGate.stderr}`);
    const overbroadControlledFoundation = structuredClone(controlledFoundation);
    overbroadControlledFoundation.capabilities[2] = structuredClone(baseline.foundation.capabilities[2]);
    writeJson(root, "foundation/assessment.json", overbroadControlledFoundation);
    negative.push(expectFailure(root, "foundation-gate.mjs", "overbroad controlled-documentation foundation", "must be not-applicable"));
    writeJson(root, "run/workload-classification.json", baseline.classification);
    writeJson(root, "foundation/assessment.json", baseline.foundation);

    foundation = structuredClone(baseline.foundation);
    foundation.capabilities[0].controls[0].evidence[0].trustTier = "automated-local";
    foundation.capabilities[0].controls[0].evidence[0].producer = { name: "local-shell", version: "v1", kind: "tool" };
    writeJson(root, "foundation/assessment.json", foundation);
    negative.push(expectFailure(root, "enterprise-ai-gate-all.mjs", "insufficient T2 technical trust", "requires ci-attested or stronger technical evidence"));
    writeJson(root, "foundation/assessment.json", baseline.foundation);
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
    findControl(production, "RATE-METERING-001").evidence[0].value = 0;
    findControl(production, "RATE-METERING-001").evidence[0].target = 1;
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "failing metric", "does not meet its target"));

    production = structuredClone(baseline.production);
    production.layers[0] = { layer: production.layers[0].layer, applicability: "not-applicable", status: "skipped", owner: "verification-owner" };
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "unjustified skip", "skipped without reason"));
    writeJson(root, "production/layer-assessment.json", baseline.production);

    production = structuredClone(baseline.production);
    production.effectiveTier = "T1";
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "production effective-tier downgrade", "effectiveTier must match workload classification"));

    const t3Classification = structuredClone(baseline.classification);
    t3Classification.effectiveTier = "T3";
    writeJson(root, "run/workload-classification.json", t3Classification);
    production = structuredClone(baseline.production);
    Object.assign(production, classificationBinding(root, t3Classification));
    findControl(production, "API-TRACE-001").evidence[0].generatedAt = relativeIso(-25);
    writeJson(root, "production/layer-assessment.json", production);
    negative.push(expectFailure(root, "production-layer-gate.mjs", "T3 freshness overrides maturity profile", "24-hour regulated evidence window"));
    writeJson(root, "run/workload-classification.json", baseline.classification);
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
    const mobileClassification = structuredClone(baseline.classification);
    mobileClassification.domainPacks = ["mobile-ios"];
    mobileClassification.domainFeatures = { "mobile-ios": { push: false, distribution: true } };
    writeJson(root, "run/workload-classification.json", mobileClassification);
    const mobileBinding = classificationBinding(root, mobileClassification);
    writeJson(root, "domain/assurance.json", {
      schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
      ...mobileBinding, environment: ENVIRONMENT, commit: COMMIT,
      packs: [{ id: "mobile-ios", identity: IOS_IDENTITY, controls: iosCatalog.controls.slice(1).map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(baseline.digest, control.id)] })) }]
    });
    negative.push(expectFailure(root, "domain-assurance-gate.mjs", "missing iOS domain control", "missing control: IOS-SUPPORT-001"));

    writeJson(root, "domain/assurance.json", {
      schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
      ...mobileBinding, environment: ENVIRONMENT, commit: COMMIT,
      packs: [{ id: "mobile-ios", identity: IOS_IDENTITY, features: { push: false, distribution: true }, controls: iosCatalog.controls.filter((control) => control.id !== "IOS-PUSH-001").map((control) => ({ id: control.id, status: "passed", evidence: [artifactEvidence(baseline.digest, control.id)] })) }]
    });
    negative.push(expectFailure(root, "domain-assurance-gate.mjs", "generic iOS release evidence", "requires xcodebuild archive command evidence"));

    writeJson(root, "domain/assurance.json", {
      schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "passed", profile: PROFILE,
      ...mobileBinding, environment: ENVIRONMENT, commit: COMMIT,
      packs: [{ id: "mobile-ios", identity: IOS_IDENTITY, features: { push: false, distribution: true }, controls: iosCatalog.controls.filter((control) => control.id !== "IOS-PUSH-001").map((control) => ({
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
    writeJson(root, "run/workload-classification.json", baseline.classification);
    writeJson(root, "domain/assurance.json", { schema: "uash.domain-assurance.v1", generatedAt: NOW, runId: "VERIFY-001", status: "skipped", profile: PROFILE, ...baseline.binding, environment: ENVIRONMENT, commit: COMMIT, packs: [], skipReason: "The generic gate verification fixture does not commission a product domain pack." });

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

    const budgetDowngradeGoal = structuredClone(baseline.goal);
    budgetDowngradeGoal.budgets.toolCalls -= 1;
    writeJson(root, "goal/goal.json", budgetDowngradeGoal);
    negative.push(expectFailure(root, "goal-gate.mjs", "goal execution-budget drift", "must match route.executionBudget.toolCalls"));
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

    console.log(JSON.stringify({ ok: true, goldenPath: "Layer 0 + enterprise + AI all-gates", nestedPackPortability: true, positiveGates: 14, catalogControls: { foundation: 14, production: 39, productionCapabilities: 38, ai: 10, domainPacks: 5 }, negativeTests: negative.length, rejected: negative }, null, 2));
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
