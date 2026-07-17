#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as signPayload } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./proof-runner.mjs";
import { reviewAttestationPayload } from "./review-gate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(SCRIPT_DIR, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runNode(script, args, cwd) {
  return run(process.execPath, [script, ...args], cwd);
}

function expectOk(result, label) {
  assert(result.status === 0, `${label} failed:\n${result.stdout || ""}\n${result.stderr || ""}`);
  return result;
}

function expectFailure(result, label, expectedText) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert(result.status !== 0, `${label} was unexpectedly accepted`);
  if (expectedText) assert(output.includes(expectedText), `${label} failed for the wrong reason; expected ${JSON.stringify(expectedText)} in:\n${output}`);
  return result;
}

function git(repo, args) {
  return expectOk(run("git", args, repo), `git ${args.join(" ")}`).stdout.trim();
}

function approvalEvidence(goal, conditionId, approvedAt, expiresAt) {
  return {
    type: "approval",
    subject: conditionId,
    runId: goal.goalId,
    commit: goal.commit,
    environment: goal.environment,
    trustTier: "human-approved",
    producer: { name: "Commissioning Portability Owner", version: "1.0.0", kind: "human" },
    actorType: "human",
    actor: "Commissioning Portability Owner",
    approvalId: `APPROVAL-${conditionId.toUpperCase()}`,
    scope: conditionId,
    status: "granted",
    approvedAt,
    expiresAt,
  };
}

function main() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "valdris-commissioned-portability-"));
  const target = path.join(tempRoot, "ios-game");
  const pack = path.join(target, ".valdris-harness");
  const commissionScript = path.join(HARNESS_ROOT, "scripts", "commission-harness.mjs");
  try {
    mkdirSync(path.join(target, "ValdrisGame.xcodeproj"), { recursive: true });
    mkdirSync(path.join(target, "Assets.xcassets", "AppIcon.appiconset"), { recursive: true });
    writeFileSync(path.join(target, ".gitignore"), "run/\ngoal/\nproof/\nreview/\ntrajectory/\n", "utf8");
    writeFileSync(path.join(target, "Package.swift"), "// swift-tools-version: 6.0\n", "utf8");
    writeFileSync(path.join(target, "ValdrisGame.xcodeproj", "project.pbxproj"), "// !$*UTF8*$!\n", "utf8");
    writeFileSync(path.join(target, "Assets.xcassets", "AppIcon.appiconset", "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    git(target, ["init"]);
    git(target, ["config", "user.email", "commissioning@example.com"]);
    git(target, ["config", "user.name", "Commissioning Portability"]);
    git(target, ["add", "."]);
    git(target, ["commit", "-m", "test: initialize iOS-like product repository"]);

    expectFailure(
      runNode(commissionScript, ["--repo", target, "--project-name", "Valdris iOS Game", "--out", path.join(tempRoot, "external-pack"), "--yes"], HARNESS_ROOT),
      "commissioning outside the target",
      ".valdris-harness",
    );
    expectOk(
      runNode(commissionScript, ["--repo", target, "--project-name", "Valdris iOS Game", "--yes"], HARNESS_ROOT),
      "nested pack commissioning",
    );

    const adapterPath = path.join(pack, "project-adapter.json");
    const adapter = readJson(adapterPath);
    assert(adapter.installation?.targetRoot === ".", "adapter must define target-root-relative command semantics");
    assert(adapter.installation?.packRoot === ".valdris-harness", "adapter must bind the canonical nested pack path");
    assert(adapter.installation?.commitRequired === true && adapter.installation?.sameGitWorktreeRequired === true, "adapter must require a committed same-worktree pack");
    assert(adapter.reviewTrust?.path === ".valdris-harness/controls/review-trust.v1.json", "review trust must bind the target-relative nested path");
    for (const relativePath of ["AGENTS.md", "CLAUDE.md", "docs/Codex Runtime Prompt.md", "docs/Validation Commands.md"]) {
      const text = readFileSync(path.join(pack, relativePath), "utf8");
      assert(!text.includes("node scripts/"), `${relativePath} contains an unsupported root-runtime command`);
      assert(text.includes(".valdris-harness"), `${relativePath} does not identify the canonical nested runtime`);
    }

    const keyId = "EXAMPLE-COMMISSION-REVIEW-KEY-001";
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    writeJson(path.join(pack, "controls", "review-trust.v1.json"), {
      schema: "valdris.review-trust.v1",
      keys: [{
        keyId,
        algorithm: "ed25519",
        status: "active",
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        allowedActorIds: ["EXAMPLE-COMMISSION-REVIEWER"],
        allowedActorTypes: ["agent"],
      }],
    });
    git(target, ["add", ".valdris-harness"]);
    git(target, ["commit", "-m", "chore: commission Valdris runtime pack"]);

    const privacyScript = path.join(pack, "scripts", "privacy-gate.mjs");
    expectOk(runNode(privacyScript, ["--repo", ".valdris-harness"], target), "pack-scoped clean-room privacy gate");
    expectFailure(runNode(privacyScript, ["--repo", "."], target), "arbitrary full product privacy scan", "unapproved-binary");

    const graphScan = path.join(pack, "scripts", "code-intelligence-scan.mjs");
    expectOk(runNode(graphScan, ["--repo", ".", "--provider", "local"], target), "generated code-intelligence scan");
    const evidencePrivacy = expectOk(
      runNode(privacyScript, ["--repo", ".", "--include", "graph", "--include", "design/anchors.json"], target),
      "generated-evidence privacy gate",
    );
    const evidencePrivacyReport = JSON.parse(evidencePrivacy.stdout);
    assert(evidencePrivacyReport.scope?.mode === "include" && evidencePrivacyReport.scope.paths.includes("graph"), "evidence privacy report must disclose its bounded scope");
    git(target, ["add", "graph", "design"]);
    git(target, ["commit", "-m", "chore: bind generated code-intelligence evidence"]);
    const commit = git(target, ["rev-parse", "HEAD"]);

    const runId = "EXAMPLE-COMMISSION-E2E-001";
    const environment = "commissioning-test";
    const routeRequest = path.join(pack, "scripts", "route-request.mjs");
    expectOk(runNode(routeRequest, [
      "--repo", ".",
      "--run-id", runId,
      "--profile", "prototype",
      "--environment", environment,
      "--actor", "Commissioning Portability Owner",
      "--request", "Copy edit the iOS game README wording only.",
    ], target), "generated route request");
    for (const gate of ["intake-gate.mjs", "workload-classification-gate.mjs", "route-gate.mjs"]) {
      expectOk(runNode(path.join(pack, "scripts", gate), ["--repo", "."], target), `generated ${gate}`);
    }

    const goalPath = path.join(target, "goal", "goal.json");
    const goal = readJson(goalPath);
    assert(goal.commit === commit, "generated goal must bind the current target commit");
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
      summary: "Nested commissioned runtime completed the focused portability route.",
    }));
    writeJson(goalPath, goal);

    const tracePath = path.join(target, "trajectory", "trace.jsonl");
    mkdirSync(path.dirname(tracePath), { recursive: true });
    writeFileSync(tracePath, `${JSON.stringify({ runId, event: "commissioning-portability-complete" })}\n`, "utf8");
    writeJson(path.join(target, "trajectory", "trajectory.json"), {
      schema: "uash.trajectory.v1",
      goalId: runId,
      generatedAt: completedAt,
      profile: goal.profile,
      commit,
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
    expectOk(runNode(path.join(pack, "scripts", "goal-gate.mjs"), ["--repo", "."], target), "generated completed-goal gate");
    expectOk(runNode(path.join(pack, "scripts", "trajectory-gate.mjs"), ["--repo", "."], target), "generated trajectory gate");

    const proofPath = path.join(target, "proof", "portable.json");
    expectOk(runNode(path.join(pack, "scripts", "proof-runner.mjs"), [
      "--repo", ".",
      "--run-id", runId,
      "--commit", commit,
      "--environment", environment,
      "--output", "proof/portable.json",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('nested-commissioned-runtime-ok')",
    ], target), "generated portable proof runner");

    const runtimeBindingResult = expectOk(runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), [
      "--repo", ".",
      "--print-runtime-binding",
      "--commit", commit,
    ], target), "nested validation-runtime binding");
    const runtimeBinding = JSON.parse(runtimeBindingResult.stdout);
    assert(runtimeBinding.source?.runtimePath === ".valdris-harness", "runtime binding must identify the committed nested pack");

    const evidenceBundleResult = expectOk(runNode(path.join(pack, "scripts", "run-create.mjs"), [
      "--repo", ".",
      "--run-id", runId,
      "--commit", commit,
      "--environment", environment,
      "--proof", "proof/portable.json",
      "--gate", "trajectory=trajectory/trajectory.json",
      "--print-evidence-bundle",
    ], target), "generated review evidence-bundle projection");
    const evidenceBundle = JSON.parse(evidenceBundleResult.stdout);
    assert(/^[a-f0-9]{64}$/.test(evidenceBundle.evidenceBundleSha256 || ""), "review evidence bundle must have a SHA-256 binding");

    const proofDigest = sha256(readFileSync(proofPath));
    const review = {
      schema: "valdris.review.v1",
      generatedAt: completedAt,
      runId,
      commit,
      environment,
      status: "passed",
      subject: { artifact: "proof/portable.json", sha256: proofDigest },
      validationRuntimeSha256: runtimeBinding.setSha256,
      evidenceBundleSha256: evidenceBundle.evidenceBundleSha256,
      implementationProvenance: {
        actorId: "EXAMPLE-COMMISSION-IMPLEMENTER",
        actorType: "agent",
        sessionId: "EXAMPLE-COMMISSION-IMPLEMENT-SESSION",
        executionId: "EXAMPLE-COMMISSION-IMPLEMENT-EXECUTION",
        artifactSha256: proofDigest,
      },
      reviewProvenance: {
        actorId: "EXAMPLE-COMMISSION-REVIEWER",
        actorType: "agent",
        sessionId: "EXAMPLE-COMMISSION-REVIEW-SESSION",
        executionId: "EXAMPLE-COMMISSION-REVIEW-EXECUTION",
        observedArtifactSha256: proofDigest,
      },
      decision: { status: "accepted", summary: "Nested commissioned proof satisfies the portability contract." },
      findings: [],
      blockers: [],
    };
    review.attestation = { scheme: "ed25519", keyId, signedAt: completedAt };
    const serializedReview = canonicalJson(reviewAttestationPayload(review));
    review.attestation.payloadSha256 = sha256(serializedReview);
    review.attestation.signature = signPayload(null, Buffer.from(serializedReview, "utf8"), privateKey).toString("base64");
    writeJson(path.join(target, "review", "review.json"), review);
    expectOk(runNode(path.join(pack, "scripts", "review-gate.mjs"), ["--repo", ".", "--file", "review/review.json"], target), "pack-aware signed review gate");

    expectOk(runNode(path.join(pack, "scripts", "run-create.mjs"), [
      "--repo", ".",
      "--run-id", runId,
      "--commit", commit,
      "--environment", environment,
      "--proof", "proof/portable.json",
      "--review", "review/review.json",
      "--gate", "trajectory=trajectory/trajectory.json",
      "--output", "run/packet.json",
    ], target), "generated run-packet creation");
    expectOk(runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), ["--repo", ".", "--file", "run/packet.json"], target), "generated run-packet validation");

    console.log(JSON.stringify({
      ok: true,
      seam: "commission CLI -> committed nested pack -> scoped privacy -> graph evidence -> route -> proof -> signed review -> run packet",
      commissionedLayout: ".valdris-harness",
      iosBinaryAssetAcceptedOutsideCleanRoomScope: true,
      packPrivacyPassed: true,
      generatedEvidencePrivacyPassed: true,
      packAwareReviewTrustPassed: true,
      portableRuntimePassed: true,
      runPacketPassed: true,
      positiveCases: 1,
      adversarialCases: 2,
    }, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
