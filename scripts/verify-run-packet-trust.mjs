#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as signPayload } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeRequiredGates, routeRequiresRca } from "./run-packet-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function gateBindingValue(gateArtifacts) {
  return [...gateArtifacts]
    .map(({ gate, path: artifactPath, sha256: digest, required, runId, commit, environment }) => ({ gate, path: artifactPath, sha256: digest, required, runId, commit, environment }))
    .sort((left, right) => left.gate < right.gate ? -1 : left.gate > right.gate ? 1 : 0);
}

function evidenceBundleSha256(document) {
  const inputs = Object.fromEntries(["intake", "route", "classification", "goal"].map((name) => [name, {
    path: document.inputs[name].path,
    sha256: document.inputs[name].sha256,
  }]));
  const gateArtifacts = gateBindingValue(document.gateArtifacts.filter(({ gate }) => gate !== "independent-review"));
  return sha256(canonicalJson({
    schema: "valdris.review-evidence-bundle.v1",
    runId: document.runId,
    commit: document.commit,
    environment: document.environment,
    validationRuntimeSha256: document.validationRuntime.setSha256,
    inputs,
    requiredGates: [...document.requiredGates].sort(),
    gateArtifacts,
  }));
}

function packetBindings(document) {
  const intakeSha256 = document.inputs.intake.sha256;
  const classificationSha256 = document.inputs.classification.sha256;
  const routeSha256 = document.inputs.route.sha256;
  const goalSha256 = document.inputs.goal.sha256;
  const gateArtifactsSha256 = sha256(canonicalJson(gateBindingValue(document.gateArtifacts)));
  const runSha256 = sha256(document.runId);
  const commitSha256 = sha256(document.commit);
  const environmentSha256 = sha256(document.environment);
  const validationRuntimeSha256 = document.validationRuntime.setSha256;
  const reviewedEvidenceBundleSha256 = evidenceBundleSha256(document);
  const envelopeSha256 = sha256(canonicalJson({
    schema: document.schema,
    runSha256,
    commitSha256,
    environmentSha256,
    intakeSha256,
    classificationSha256,
    routeSha256,
    goalSha256,
    gateArtifactsSha256,
    validationRuntimeSha256,
    evidenceBundleSha256: reviewedEvidenceBundleSha256,
    requiredGates: [...document.requiredGates].sort(),
  }));
  return { runSha256, commitSha256, environmentSha256, intakeSha256, classificationSha256, routeSha256, goalSha256, gateArtifactsSha256, validationRuntimeSha256, evidenceBundleSha256: reviewedEvidenceBundleSha256, envelopeSha256 };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(runtimeRoot, script, args, cwd, env = process.env) {
  return spawnSync(process.execPath, [path.join(runtimeRoot, "scripts", script), ...args], {
    cwd,
    encoding: "utf8",
    env,
    shell: false,
  });
}

function runGit(repoRoot, args) {
  return spawnSync("git", ["-C", repoRoot, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}

function expectOk(result, label) {
  assert(result.status === 0, `${label} failed:\n${output(result)}`);
}

function expectFailure(result, label, expectedText) {
  const text = output(result);
  assert(result.status !== 0, `${label} was unexpectedly accepted`);
  if (expectedText) assert(text.includes(expectedText), `${label} failed for the wrong reason; expected ${JSON.stringify(expectedText)} in:\n${text}`);
}

function copyRuntime(runtimeRoot) {
  for (const directory of ["scripts", "controls", "skills"]) {
    cpSync(path.join(ROOT, directory), path.join(runtimeRoot, directory), { recursive: true });
  }
  const trajectoryGate = path.join(runtimeRoot, "scripts", "trajectory-gate.mjs");
  const trajectorySource = readFileSync(trajectoryGate, "utf8")
    .replace('import { existsSync } from "node:fs";', 'import { appendFileSync, existsSync } from "node:fs";');
  writeFileSync(trajectoryGate, `${trajectorySource}\n// Deterministic test-fixture hook: this exists only in the committed temporary runtime.\n{\n  const repoArg = process.argv.indexOf("--repo");\n  const fixtureRoot = repoArg >= 0 ? path.resolve(process.argv[repoArg + 1]) : process.cwd();\n  if (process.env.VALDRIS_TEST_MUTATE_GOAL === "1") {\n    appendFileSync(path.join(fixtureRoot, "goal", "goal.json"), "\\n ");\n  }\n}\n`, "utf8");
  return runtimeRoot;
}

function refreshPacketInputs(packet, repoRoot) {
  for (const input of Object.values(packet.inputs)) {
    input.sha256 = sha256(readFileSync(path.join(repoRoot, input.path)));
  }
  packet.bindings = packetBindings(packet);
}

function refreshPacketGate(packet, repoRoot, gate) {
  const artifact = packet.gateArtifacts.find((entry) => entry.gate === gate);
  assert(artifact, `packet is missing gate ${gate}`);
  artifact.sha256 = sha256(readFileSync(path.join(repoRoot, artifact.path)));
  packet.bindings = packetBindings(packet);
}

function approvalEvidence(goal, conditionId, approvedAt, expiresAt) {
  return {
    type: "approval",
    subject: conditionId,
    runId: goal.goalId,
    commit: goal.commit,
    environment: goal.environment,
    trustTier: "human-approved",
    producer: { name: "Synthetic Packet Owner", version: "1.0.0", kind: "human" },
    actorType: "human",
    actor: "Synthetic Packet Owner",
    approvalId: `APPROVAL-${conditionId.toUpperCase()}`,
    scope: conditionId,
    status: "granted",
    approvedAt,
    expiresAt,
  };
}

function createValidPacketFixture(root) {
  const repoRoot = path.join(root, "target");
  mkdirSync(repoRoot, { recursive: true });
  const runtimeRoot = copyRuntime(repoRoot);
  const keyId = "EXAMPLE-REVIEW-KEY-001";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(path.join(repoRoot, "README.md"), "# Synthetic packet trust fixture\n", "utf8");
  mkdirSync(path.join(repoRoot, "run"), { recursive: true });
  writeFileSync(path.join(repoRoot, "run", "app.js"), "export const productRuntime = true;\n", "utf8");
  writeJson(path.join(repoRoot, "controls", "review-trust.v1.json"), {
    schema: "valdris.review-trust.v1",
    keys: [{
      keyId,
      algorithm: "ed25519",
      status: "active",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      allowedActorIds: ["EXAMPLE-ACTOR-REVIEWER"],
      allowedActorTypes: ["agent"],
    }],
  });
  for (const [args, label] of [
    [["init"], "fixture git init"],
    [["config", "user.email", "fixture@example.com"], "fixture git email"],
    [["config", "user.name", "Synthetic Packet Owner"], "fixture git name"],
    [["add", "."], "fixture git add"],
    [["commit", "-m", "test: initialize packet trust fixture"], "fixture git commit"],
  ]) expectOk(runGit(repoRoot, args), label);
  const runId = "EXAMPLE-PACKET-TRUST-001";
  const environment = "synthetic-test";
  const routeRequest = run(runtimeRoot, "route-request.mjs", [
    "--repo", repoRoot,
    "--run-id", runId,
    "--profile", "prototype",
    "--environment", environment,
    "--actor", "Synthetic Packet Owner",
    "--request", "Copy edit the README wording only.",
  ], repoRoot);
  expectOk(routeRequest, "route-request fixture creation");
  assert(readJson(path.join(repoRoot, "run", "route.json")).taskType === "docs-only", "fixture request did not produce a docs-only route");

  const goalPath = path.join(repoRoot, "goal", "goal.json");
  const goal = readJson(goalPath);
  const completedAt = new Date().toISOString();
  const approvedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const expiresAt = new Date(Date.parse(completedAt) + 60 * 60 * 1000).toISOString();
  goal.revision += 1;
  goal.generatedAt = completedAt;
  goal.updatedAt = completedAt;
  goal.status = "completed";
  goal.stoppingConditions = goal.stoppingConditions.map((condition) => ({
    ...condition,
    status: "passed",
    evidence: [approvalEvidence(goal, condition.id, approvedAt, expiresAt)],
  }));
  goal.checkpoints = goal.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    status: "passed",
    summary: "Synthetic docs-only route completed with packet trust proof.",
  }));
  writeJson(goalPath, goal);

  const tracePath = path.join(repoRoot, "trajectory", "trace.jsonl");
  mkdirSync(path.dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, `${JSON.stringify({ runId, event: "synthetic-packet-complete" })}\n`, "utf8");
  writeJson(path.join(repoRoot, "trajectory", "trajectory.json"), {
    schema: "uash.trajectory.v1",
    goalId: runId,
    generatedAt: completedAt,
    profile: goal.profile,
    commit: goal.commit,
    environment,
    finalStatus: "completed",
    budget: {
      limits: goal.budgets,
      used: { attempts: 1, toolCalls: 1, tokens: 1, costUsd: 0, wallClockMinutes: 1 },
    },
    attempts: [{
      id: "ATTEMPT-001",
      outcome: "succeeded",
      usage: { toolCalls: 1, tokens: 1, costUsd: 0, wallClockMinutes: 1 },
      actions: ["copy edit documentation"],
      startedAt: approvedAt,
      completedAt,
    }],
    forbiddenActions: [],
    violations: [],
    tracePath: "trajectory/trace.jsonl",
    traceDigest: sha256(readFileSync(tracePath)),
  });

  const proof = run(runtimeRoot, "proof-runner.mjs", [
    "--repo", repoRoot,
    "--run-id", runId,
    "--commit", goal.commit,
    "--environment", environment,
    "--output", "proof/portable.json",
    "--",
    process.execPath,
    "-e",
    "process.stdout.write('packet-trust-ok')",
  ], repoRoot);
  expectOk(proof, "portable proof fixture creation");
  const proofPath = path.join(repoRoot, "proof", "portable.json");
  const proofDigest = sha256(readFileSync(proofPath));
  const runtimeBindingResult = run(runtimeRoot, "run-packet-gate.mjs", [
    "--repo", repoRoot,
    "--print-runtime-binding",
    "--commit", goal.commit,
  ], repoRoot);
  expectOk(runtimeBindingResult, "validation runtime binding creation");
  const runtimeBinding = JSON.parse(runtimeBindingResult.stdout);
  const evidenceBundleResult = run(runtimeRoot, "run-create.mjs", [
    "--repo", repoRoot,
    "--run-id", runId,
    "--commit", goal.commit,
    "--environment", environment,
    "--proof", "proof/portable.json",
    "--gate", "trajectory=trajectory/trajectory.json",
    "--print-evidence-bundle",
  ], repoRoot);
  expectOk(evidenceBundleResult, "review evidence bundle creation");
  const evidenceBundle = JSON.parse(evidenceBundleResult.stdout);
  const review = {
    schema: "valdris.review.v1",
    generatedAt: completedAt,
    runId,
    commit: goal.commit,
    environment,
    status: "passed",
    subject: { artifact: "proof/portable.json", sha256: proofDigest },
    validationRuntimeSha256: runtimeBinding.setSha256,
    evidenceBundleSha256: evidenceBundle.evidenceBundleSha256,
    implementationProvenance: {
      actorId: "EXAMPLE-ACTOR-IMPLEMENTER",
      actorType: "agent",
      sessionId: "EXAMPLE-SESSION-IMPLEMENT",
      executionId: "EXAMPLE-EXECUTION-IMPLEMENT",
      artifactSha256: proofDigest,
    },
    reviewProvenance: {
      actorId: "EXAMPLE-ACTOR-REVIEWER",
      actorType: "agent",
      sessionId: "EXAMPLE-SESSION-REVIEW",
      executionId: "EXAMPLE-EXECUTION-REVIEW",
      observedArtifactSha256: proofDigest,
    },
    decision: { status: "accepted", summary: "Synthetic packet proof satisfies the focused trust contract." },
    findings: [],
    blockers: [],
  };
  review.attestation = { scheme: "ed25519", keyId, signedAt: completedAt };
  const attestationPayload = {
    schema: review.schema,
    generatedAt: review.generatedAt,
    runId: review.runId,
    commit: review.commit,
    environment: review.environment,
    status: review.status,
    subject: review.subject,
    validationRuntimeSha256: review.validationRuntimeSha256,
    evidenceBundleSha256: review.evidenceBundleSha256,
    implementationProvenance: review.implementationProvenance,
    reviewProvenance: review.reviewProvenance,
    decision: review.decision,
    findings: review.findings,
    blockers: review.blockers,
    attestation: {
      scheme: review.attestation.scheme,
      keyId: review.attestation.keyId,
      signedAt: review.attestation.signedAt,
    },
  };
  const serializedAttestation = canonicalJson(attestationPayload);
  review.attestation.payloadSha256 = sha256(serializedAttestation);
  review.attestation.signature = signPayload(null, Buffer.from(serializedAttestation, "utf8"), privateKey).toString("base64");
  writeJson(path.join(repoRoot, "review", "review.json"), review);

  const trustStorePath = path.join(repoRoot, "controls", "review-trust.v1.json");
  const trustStoreSource = readFileSync(trustStorePath, "utf8");
  try {
    writeFileSync(trustStorePath, trustStoreSource.replace(/\r?\n/g, "\r\n"), "utf8");
    expectOk(
      run(runtimeRoot, "review-gate.mjs", ["--repo", repoRoot, "--file", "review/review.json"], repoRoot),
      "signed review with a Git-equivalent CRLF trust store",
    );
  } finally {
    writeFileSync(trustStorePath, trustStoreSource, "utf8");
  }

  const packet = run(runtimeRoot, "run-create.mjs", [
    "--repo", repoRoot,
    "--run-id", runId,
    "--commit", goal.commit,
    "--environment", environment,
    "--proof", "proof/portable.json",
    "--review", "review/review.json",
    "--gate", "trajectory=trajectory/trajectory.json",
    "--output", "run/packet.json",
  ], repoRoot);
  expectOk(packet, "valid packet fixture creation");
  expectOk(run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/packet.json"], repoRoot), "valid packet fixture validation");
  return { runtimeRoot, repoRoot };
}

function verifyNativeCorrectiveRoute(root) {
  const repoRoot = path.join(root, "corrective-route");
  mkdirSync(repoRoot, { recursive: true });
  const runtimeRoot = copyRuntime(repoRoot);
  writeFileSync(path.join(repoRoot, "README.md"), "# Corrective route fixture\n", "utf8");
  for (const [args, label] of [
    [["init"], "corrective fixture git init"],
    [["config", "user.email", "fixture@example.com"], "corrective fixture git email"],
    [["config", "user.name", "Synthetic Packet Owner"], "corrective fixture git name"],
    [["add", "."], "corrective fixture git add"],
    [["commit", "-m", "test: initialize corrective route fixture"], "corrective fixture git commit"],
  ]) expectOk(runGit(repoRoot, args), label);
  expectOk(run(runtimeRoot, "route-request.mjs", [
    "--repo", repoRoot,
    "--run-id", "EXAMPLE-CORRECTIVE-ROUTE-001",
    "--profile", "prototype",
    "--environment", "synthetic-test",
    "--actor", "Synthetic Packet Owner",
    "--request", "Perform corrective self-heal remediation for the failed harness run.",
  ], repoRoot), "native corrective route creation");
  const intake = readJson(path.join(repoRoot, "run", "intake.json"));
  const classification = readJson(path.join(repoRoot, "run", "workload-classification.json"));
  const route = readJson(path.join(repoRoot, "run", "route.json"));
  for (const [script, label] of [
    ["intake-gate.mjs", "corrective intake"],
    ["workload-classification-gate.mjs", "corrective classification"],
    ["route-gate.mjs", "corrective route"],
  ]) expectOk(run(runtimeRoot, script, ["--repo", repoRoot], repoRoot), label);
  assert(routeRequiresRca(route, intake, classification), "native-valid corrective self-heal route did not require RCA");
  assert(routeRequiredGates(route, intake, classification).includes("rca"), "native-valid corrective self-heal gate set omitted RCA");
}

function main() {
  const featureIntake = { requestText: "Build a self-healing capability for the workflow engine." };
  featureIntake.requestSha256 = sha256(featureIntake.requestText);
  assert(
    routeRequiresRca({ taskType: "feature", requestSignals: ["self-healing capability"] }, featureIntake, { taskType: "feature", requestSha256: featureIntake.requestSha256 }) === false,
    "feature request for a self-healing capability was incorrectly classified as corrective RCA work",
  );
  const correctiveIntake = { requestText: "Perform corrective self-heal remediation for the failed harness run." };
  correctiveIntake.requestSha256 = sha256(correctiveIntake.requestText);
  assert(
    routeRequiresRca({ taskType: "feature", requestSignals: ["corrective self-heal remediation"] }, correctiveIntake, { taskType: "feature", requestSha256: correctiveIntake.requestSha256 }) === true,
    "intake-bound corrective self-heal work did not require RCA",
  );
  const root = mkdtempSync(path.join(os.tmpdir(), "valdris-run-packet-trust-"));
  try {
    verifyNativeCorrectiveRoute(root);
    const { runtimeRoot, repoRoot } = createValidPacketFixture(root);
    const packet = readJson(path.join(repoRoot, "run", "packet.json"));
    const readmePath = path.join(repoRoot, "README.md");
    const originalReadme = readFileSync(readmePath, "utf8");
    try {
      writeFileSync(readmePath, `${originalReadme}\nPost-proof application mutation.\n`, "utf8");
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/packet.json"], repoRoot),
        "packet after application source mutation",
        "application source changed after portable proof",
      );
    } finally {
      writeFileSync(readmePath, originalReadme, "utf8");
    }
    const collidingSourcePath = path.join(repoRoot, "run", "app.js");
    const originalCollidingSource = readFileSync(collidingSourcePath, "utf8");
    try {
      writeFileSync(collidingSourcePath, "export const productRuntime = false;\n", "utf8");
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/packet.json"], repoRoot),
        "packet after tracked source mutation inside a harness-named directory",
        "application source changed after portable proof",
      );
    } finally {
      writeFileSync(collidingSourcePath, originalCollidingSource, "utf8");
    }
    mkdirSync(path.join(repoRoot, "run", "alternate"), { recursive: true });
    cpSync(path.join(repoRoot, "run", "intake.json"), path.join(repoRoot, "run", "alternate", "intake.json"));
    const noncanonicalInputPacket = structuredClone(packet);
    noncanonicalInputPacket.inputs.intake.path = "run/alternate/intake.json";
    writeJson(path.join(repoRoot, "run", "noncanonical-input-packet.json"), noncanonicalInputPacket);
    expectFailure(
      run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/noncanonical-input-packet.json"], repoRoot),
      "packet with noncanonical intake path",
      "input intake must use canonical path run/intake.json",
    );
    expectFailure(
      run(runtimeRoot, "run-create.mjs", [
        "--repo", repoRoot,
        "--run-id", packet.runId,
        "--commit", packet.commit,
        "--environment", packet.environment,
        "--intake", "run/alternate/intake.json",
        "--proof", "proof/portable.json",
        "--review", "review/review.json",
        "--gate", "trajectory=trajectory/trajectory.json",
        "--output", "run/noncanonical-create-packet.json",
      ], repoRoot),
      "run-create with noncanonical intake path",
      "input intake must use canonical path run/intake.json",
    );

    const classificationPath = path.join(repoRoot, "run", "workload-classification.json");
    const routePath = path.join(repoRoot, "run", "route.json");
    const goalPath = path.join(repoRoot, "goal", "goal.json");
    const intakePath = path.join(repoRoot, "run", "intake.json");
    const originals = {
      intake: readFileSync(intakePath, "utf8"),
      classification: readFileSync(classificationPath, "utf8"),
      route: readFileSync(routePath, "utf8"),
      goal: readFileSync(goalPath, "utf8"),
    };
    try {
      const changedRoute = readJson(routePath);
      changedRoute.generatedAt = new Date(Date.parse(changedRoute.generatedAt) + 1000).toISOString();
      writeJson(routePath, changedRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const postReviewRoutePacket = structuredClone(packet);
      refreshPacketInputs(postReviewRoutePacket, repoRoot);
      writeJson(path.join(repoRoot, "run", "post-review-route-packet.json"), postReviewRoutePacket);
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/post-review-route-packet.json"], repoRoot),
        "packet with semantically valid post-review route mutation",
        "independent review must be bound to every packet input and required evidence artifact",
      );
    } finally {
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    const trajectoryPath = path.join(repoRoot, "trajectory", "trajectory.json");
    const originalTrajectory = readFileSync(trajectoryPath, "utf8");
    try {
      const crossRunTrajectory = readJson(trajectoryPath);
      crossRunTrajectory.goalId = "EXAMPLE-OTHER-RUN-001";
      crossRunTrajectory.runId = packet.runId;
      crossRunTrajectory.commit = "EXAMPLE-OTHER-COMMIT";
      crossRunTrajectory.environment = "other-environment";
      crossRunTrajectory.run = { id: packet.runId, commit: packet.commit, environment: packet.environment };
      writeJson(trajectoryPath, crossRunTrajectory);
      const crossRunPacket = structuredClone(packet);
      refreshPacketGate(crossRunPacket, repoRoot, "trajectory");
      writeJson(path.join(repoRoot, "run", "cross-run-trajectory-packet.json"), crossRunPacket);
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/cross-run-trajectory-packet.json"], repoRoot),
        "packet reusing trajectory evidence from another run",
        "gate trajectory run identifier does not match the packet",
      );
    } finally {
      writeFileSync(trajectoryPath, originalTrajectory, "utf8");
    }
    try {
      const invalidClassification = readJson(classificationPath);
      invalidClassification.effectiveTier = "T9";
      writeJson(classificationPath, invalidClassification);
      const reboundRoute = readJson(routePath);
      reboundRoute.workloadClassificationSha256 = sha256(readFileSync(classificationPath));
      writeJson(routePath, reboundRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.workloadClassificationSha256 = sha256(readFileSync(classificationPath));
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const invalidClassificationPacket = structuredClone(packet);
      refreshPacketInputs(invalidClassificationPacket, repoRoot);
      writeJson(path.join(repoRoot, "run", "invalid-classification-packet.json"), invalidClassificationPacket);
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/invalid-classification-packet.json"], repoRoot),
        "packet with semantically invalid workload classification",
        "input classification failed native validator workload-classification-gate.mjs",
      );
    } finally {
      writeFileSync(classificationPath, originals.classification, "utf8");
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    try {
      const incidentIntake = readJson(intakePath);
      incidentIntake.requestText = "Investigate and repair a production incident affecting customers.";
      incidentIntake.requestSha256 = sha256(incidentIntake.requestText);
      writeJson(intakePath, incidentIntake);
      const forgedFeatureRoute = readJson(routePath);
      forgedFeatureRoute.taskType = "feature";
      forgedFeatureRoute.intakeSha256 = sha256(readFileSync(intakePath));
      writeJson(routePath, forgedFeatureRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.requestSha256 = incidentIntake.requestSha256;
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const forgedIncidentPacket = structuredClone(packet);
      refreshPacketInputs(forgedIncidentPacket, repoRoot);
      writeJson(path.join(repoRoot, "run", "forged-feature-incident-packet.json"), forgedIncidentPacket);
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/forged-feature-incident-packet.json"], repoRoot),
        "packet with forged feature route over incident intake",
        "requiredGates must exactly match route-derived gates",
      );
    } finally {
      writeFileSync(intakePath, originals.intake, "utf8");
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    try {
      const invalidRoute = readJson(routePath);
      invalidRoute.profile = "invalid-profile";
      writeJson(routePath, invalidRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const invalidRoutePacket = structuredClone(packet);
      refreshPacketInputs(invalidRoutePacket, repoRoot);
      writeJson(path.join(repoRoot, "run", "invalid-route-packet.json"), invalidRoutePacket);
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/invalid-route-packet.json"], repoRoot),
        "packet with semantically invalid route",
        "input route failed native validator route-gate.mjs",
      );
    } finally {
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    try {
      const incompleteGoal = readJson(goalPath);
      incompleteGoal.status = "in_progress";
      writeJson(goalPath, incompleteGoal);
      const incompleteGoalPacket = structuredClone(packet);
      refreshPacketInputs(incompleteGoalPacket, repoRoot);
      writeJson(path.join(repoRoot, "run", "incomplete-goal-packet.json"), incompleteGoalPacket);
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/incomplete-goal-packet.json"], repoRoot),
        "packet with incomplete finish-line goal",
        "input goal failed native validator goal-gate.mjs",
      );
    } finally {
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    rmSync(path.join(repoRoot, "run", "alternate"), { recursive: true, force: true });
    for (const file of [
      "noncanonical-input-packet.json",
      "invalid-classification-packet.json",
      "forged-feature-incident-packet.json",
      "invalid-route-packet.json",
      "incomplete-goal-packet.json",
      "post-review-route-packet.json",
      "cross-run-trajectory-packet.json",
    ]) rmSync(path.join(repoRoot, "run", file), { force: true });

    try {
      expectFailure(
        run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/packet.json"], repoRoot, { ...process.env, VALDRIS_TEST_MUTATE_GOAL: "1" }),
        "packet whose goal changes during native validation",
        "input goal changed during packet validation",
      );
    } finally {
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    writeFileSync(
      path.join(runtimeRoot, "scripts", "route-gate.mjs"),
      `${readFileSync(path.join(runtimeRoot, "scripts", "route-gate.mjs"), "utf8")}\n// synthetic validator drift\n`,
      "utf8",
    );
    expectFailure(
      run(runtimeRoot, "run-create.mjs", [
        "--repo", repoRoot,
        "--run-id", packet.runId,
        "--commit", packet.commit,
        "--environment", packet.environment,
        "--proof", "proof/portable.json",
        "--review", "review/review.json",
        "--gate", "trajectory=trajectory/trajectory.json",
        "--output", "run/dirty-runtime-create-packet.json",
      ], repoRoot),
      "packet creation under dirty validator runtime",
      "validation runtime files are dirty or untracked",
    );
    expectFailure(
      run(runtimeRoot, "run-packet-gate.mjs", ["--repo", repoRoot, "--file", "run/packet.json"], repoRoot),
      "packet after validator runtime drift",
      "validation runtime files are dirty or untracked",
    );
    console.log(JSON.stringify({ ok: true, positiveCases: 3, adversarialRejections: 13 }, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
