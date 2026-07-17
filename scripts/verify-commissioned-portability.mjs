#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as signPayload } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./proof-runner.mjs";
import { reviewAttestationPayload } from "./review-gate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(SCRIPT_DIR, "..");
const VERIFY_VALUES = Object.freeze({
  access: "fixture-commissioned-portability-access",
  integrity: "fixture-commissioned-portability-integrity",
  human: "fixture-commissioned-portability-human",
});
const BRIDGE_ACCESS_TOKEN = VERIFY_VALUES.access;
const BRIDGE_INTEGRITY_KEY = VERIFY_VALUES.integrity;
const HUMAN_APPROVAL_TOKEN = VERIFY_VALUES.human;
const ACCEPTANCE_ARTIFACT_ROOTS = Object.freeze([
  "ai", "approvals", "cloud", "context", "design", "domain", "evals", "foundation", "goal", "graph",
  "handoff", "production", "proof", "qa", "rca", "review", "run", "self_heal", "smoke", "trajectory", "waivers",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reviewTrustSha256(file) {
  return sha256(canonicalJson(readJson(file)));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    ...(options.env ? { env: options.env } : {}),
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runNode(script, args, cwd, options = {}) {
  return run(process.execPath, [script, ...args], cwd, options);
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

function walkRegularFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    const stats = lstatSync(target);
    assert(!stats.isSymbolicLink(), `artifact bundle fixture must not traverse a symlink: ${target}`);
    if (stats.isDirectory()) walkRegularFiles(root, target, files);
    else {
      assert(stats.isFile(), `artifact bundle fixture contains a non-regular file: ${target}`);
      files.push(path.relative(root, target).split(path.sep).join("/"));
    }
  }
  return files;
}

function isTracked(repo, relativePath) {
  return run("git", ["ls-files", "--error-unmatch", "--", relativePath], repo).status === 0;
}

function createAcceptanceArtifactBundle(sourceRoot, bundleRoot, sourceCommit) {
  const files = [];
  mkdirSync(bundleRoot, { recursive: true });
  for (const artifactRoot of ACCEPTANCE_ARTIFACT_ROOTS) {
    const absoluteRoot = path.join(sourceRoot, artifactRoot);
    if (!existsSync(absoluteRoot)) continue;
    for (const relativePath of walkRegularFiles(sourceRoot, absoluteRoot)) {
      if (isTracked(sourceRoot, relativePath)) continue;
      const source = path.join(sourceRoot, ...relativePath.split("/"));
      const destination = path.join(bundleRoot, ...relativePath.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      const bytes = readFileSync(source);
      files.push({ path: relativePath, sha256: sha256(bytes), size: bytes.length });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  writeJson(path.join(bundleRoot, "valdris-run-artifacts.json"), {
    schema: "valdris.run-artifact-bundle.v1",
    sourceCommit,
    files,
  });
  return files;
}

function createFixtureArtifactBundle(bundleRoot, sourceCommit, fixtureFiles) {
  const files = [];
  mkdirSync(bundleRoot, { recursive: true });
  for (const [relativePath, content] of Object.entries(fixtureFiles)) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const destination = path.join(bundleRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    files.push({ path: relativePath, sha256: sha256(bytes), size: bytes.length });
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  writeJson(path.join(bundleRoot, "valdris-run-artifacts.json"), {
    schema: "valdris.run-artifact-bundle.v1",
    sourceCommit,
    files,
  });
  return files;
}

function assertOutputOmits(result, forbidden, label) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert(!output.includes(forbidden), `${label} leaked untrusted input in diagnostics`);
}

async function postJson(port, pathname, body, expectedStatus = 200, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-uash-bridge-token": BRIDGE_ACCESS_TOKEN, ...headers },
    body: JSON.stringify(body),
  });
  const parsed = JSON.parse(await response.text());
  assert(response.status === expectedStatus, `bridge ${pathname} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function getJson(port, pathname, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: { "x-uash-bridge-token": BRIDGE_ACCESS_TOKEN },
  });
  const parsed = JSON.parse(await response.text());
  assert(response.status === expectedStatus, `bridge ${pathname} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(parsed)}`);
  return parsed;
}

async function waitForBridge(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("commissioned portability bridge did not become healthy");
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

function verifySubdirectoryLoaderBinding(tempRoot, commissionScript) {
  const worktree = path.join(tempRoot, "containing-worktree");
  const target = path.join(worktree, "apps", "[ios]-game");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "README.md"), "# Subdirectory target fixture\n", "utf8");
  git(worktree, ["init"]);
  git(worktree, ["config", "user.email", "commissioning-subdirectory@example.com"]);
  git(worktree, ["config", "user.name", "Commissioning Subdirectory"]);
  git(worktree, ["add", "."]);
  git(worktree, ["commit", "-m", "test: initialize containing worktree"]);
  expectOk(
    runNode(commissionScript, ["--repo", target, "--project-name", "Subdirectory Target", "--yes"], HARNESS_ROOT),
    "subdirectory target commissioning",
  );
  const pack = path.join(target, ".valdris-harness");
  process.env.UASH_REVIEW_TRUST_SHA256 = reviewTrustSha256(path.join(pack, "controls", "review-trust.v1.json"));
  git(target, ["add", ".valdris-harness"]);
  git(target, ["commit", "-m", "test: commit only the nested Valdris runtime pack"]);
  const packOnlyCommit = git(target, ["rev-parse", "HEAD"]);
  expectFailure(
    runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), [
      "--repo", ".valdris-harness",
      "--print-runtime-binding",
      "--commit", packOnlyCommit,
    ], target),
    "runtime binding with the nested pack misdeclared as the packet target",
    "validation runtime must be the target-nested .valdris-harness directory",
  );
  expectFailure(
    runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), [
      "--repo", ".",
      "--print-runtime-binding",
      "--commit", packOnlyCommit,
    ], target),
    "runtime binding with untracked target-root discovery loaders",
    "target-root discovery loaders must be Git-tracked",
  );
  git(target, ["add", "AGENTS.md", "CLAUDE.md"]);
  git(target, ["commit", "-m", "chore: bind target-root Valdris discovery loaders"]);
  const commit = git(target, ["rev-parse", "HEAD"]);
  const result = expectOk(runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), [
    "--repo", ".",
    "--print-runtime-binding",
    "--commit", commit,
  ], target), "subdirectory validation-runtime binding");
  const binding = JSON.parse(result.stdout);
  assert(binding.source?.targetPath === "apps/[ios]-game", "runtime binding must use the literal Git-native target prefix inside the containing worktree");
  assert(binding.source?.runtimePath === "apps/[ios]-game/.valdris-harness", "runtime binding must use the literal Git-native nested runtime prefix inside the containing worktree");
  const loaderBindings = binding.files.filter(({ kind }) => kind === "target-root-discovery-loader");
  assert(loaderBindings.length === 2, "subdirectory runtime binding must include both target-root discovery loaders");
  for (const { path: fileName, sha256: digest } of loaderBindings) {
    const committed = expectOk(run("git", ["show", `HEAD:apps/[ios]-game/${fileName}`], target), `read special-path committed ${fileName} blob`).stdout;
    assert(digest === sha256(committed), `subdirectory loader binding must use the stable committed ${fileName} blob`);
  }
}

async function main() {
  const verifierArgs = process.argv.slice(2);
  if (verifierArgs.some((arg) => arg !== "--acceptance-only")) throw new Error("Usage: node scripts/verify-commissioned-portability.mjs [--acceptance-only]");
  const acceptanceOnly = verifierArgs.includes("--acceptance-only");
  const tempRoot = mkdtempSync(path.join(tmpdir(), "valdris-commissioned-portability-"));
  const productWorktree = path.join(tempRoot, "product-worktree");
  const target = path.join(productWorktree, "apps", "ios-game");
  const pack = path.join(target, ".valdris-harness");
  const commissionScript = path.join(HARNESS_ROOT, "scripts", "commission-harness.mjs");
  try {
    verifySubdirectoryLoaderBinding(tempRoot, commissionScript);
    mkdirSync(path.join(target, "ValdrisGame.xcodeproj"), { recursive: true });
    mkdirSync(path.join(target, "Assets.xcassets", "AppIcon.appiconset"), { recursive: true });
    writeFileSync(path.join(target, ".gitignore"), "run/\ngoal/\nproof/\nreview/\ntrajectory/\n", "utf8");
    writeFileSync(path.join(target, "Package.swift"), "// swift-tools-version: 6.0\n", "utf8");
    writeFileSync(path.join(target, "ValdrisGame.xcodeproj", "project.pbxproj"), "// !$*UTF8*$!\n", "utf8");
    writeFileSync(path.join(target, "Assets.xcassets", "AppIcon.appiconset", "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    git(productWorktree, ["init"]);
    git(productWorktree, ["config", "user.email", "commissioning@example.com"]);
    git(productWorktree, ["config", "user.name", "Commissioning Portability"]);
    git(productWorktree, ["add", "."]);
    git(productWorktree, ["commit", "-m", "test: initialize containing iOS-like product worktree"]);

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
    assert(adapter.installation?.commitRequired === true && adapter.installation?.sameGitWorktreeRequired === true && adapter.installation?.discoveryLoadersCommitRequired === true, "adapter must require a committed same-worktree pack and target-root discovery loaders");
    assert(adapter.reviewTrust?.path === ".valdris-harness/controls/review-trust.v1.json", "review trust must bind the target-relative nested path");
    assert(readFileSync(path.join(target, "AGENTS.md"), "utf8").includes(".valdris-harness/AGENTS.md"), "target-root AGENTS.md discovery loader missing");
    assert(readFileSync(path.join(target, "CLAUDE.md"), "utf8").includes("@.valdris-harness/CLAUDE.md"), "target-root CLAUDE.md discovery loader missing");
    const structuralWorkflow = readFileSync(path.join(pack, ".github", "workflows", "valdris-assurance.yml"), "utf8");
    const acceptanceWorkflow = readFileSync(path.join(pack, ".github", "workflows", "valdris-run-acceptance.yml"), "utf8");
    assert(structuralWorkflow.includes("pull_request:") && structuralWorkflow.includes("push:") && structuralWorkflow.includes("fetch-depth: 0") && structuralWorkflow.includes("persist-credentials: false") && !structuralWorkflow.includes("run-packet-gate.mjs") && !structuralWorkflow.includes("UASH_REVIEW_TRUST_SHA256"), "always-on generated workflow must be structural-only and use a full credential-free checkout");
    assert(acceptanceWorkflow.includes("workflow_dispatch:") && acceptanceWorkflow.includes("environment: valdris-run-acceptance") && acceptanceWorkflow.indexOf("Validate exact source commit input") < acceptanceWorkflow.indexOf("uses: actions/checkout@v4") && acceptanceWorkflow.includes("VALDRIS_SOURCE_COMMIT: ${{ inputs.source_commit }}") && acceptanceWorkflow.includes("VALDRIS_ARTIFACT_BUNDLE: ${{ runner.temp }}/valdris-run-artifacts") && acceptanceWorkflow.includes("run: node .valdris-harness/scripts/run-acceptance.mjs --repo ."), "explicit generated acceptance workflow must validate exact source before checkout and pass untrusted values only through environment variables");
    assert(!acceptanceWorkflow.split(/\r?\n/).some((line) => line.trimStart().startsWith("run:") && line.includes("${{")), "generated acceptance workflow interpolates an untrusted expression into a shell command");
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
    const commissionedReviewTrustSha256 = reviewTrustSha256(path.join(pack, "controls", "review-trust.v1.json"));
    process.env.UASH_REVIEW_TRUST_SHA256 = commissionedReviewTrustSha256;
    git(target, ["add", ".valdris-harness", "AGENTS.md", "CLAUDE.md"]);
    git(target, ["commit", "-m", "chore: commission Valdris runtime pack and discovery loaders"]);

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
    const trajectoryPath = path.join(target, "trajectory", "trajectory.json");
    mkdirSync(path.dirname(tracePath), { recursive: true });
    writeFileSync(tracePath, `${JSON.stringify({ runId, event: "commissioning-portability-complete" })}\n`, "utf8");
    writeJson(trajectoryPath, {
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

    writeJson(path.join(target, "proof", "proof.json"), {
      schema: "uash.proof.v1",
      generatedAt: completedAt,
      runId,
      status: "passed",
      summary: "Genuine commissioned bridge completion fixture passed.",
      commands: [{
        command: "commissioned portability verification",
        exitCode: 0,
        startedAt: approvedAt,
        completedAt,
        outputDigest: `sha256:${sha256("commissioned-portability-bridge-proof")}`,
        stdoutTail: "commissioned portability fixture passed",
      }],
    });
    mkdirSync(path.join(target, "handoff"), { recursive: true });
    writeFileSync(path.join(target, "handoff", "final.md"), "# Commissioned portability handoff\n\nAll genuine v0.8 gates passed.\n", "utf8");
    const classification = readJson(path.join(target, "run", "workload-classification.json"));
    const route = readJson(path.join(target, "run", "route.json"));
    const classificationSha256 = sha256(readFileSync(path.join(target, "run", "workload-classification.json")));
    const skippedBinding = { effectiveTier: classification.effectiveTier, workloadClassificationSha256: classificationSha256 };
    writeJson(path.join(target, "evals", "context-quality-cases.json"), { schema: "uash.context-case-set.v1", cases: [{ id: "routing", prompt: "Select the correct Valdris lane." }, { id: "proof", prompt: "Name the required finish-line proof." }] });
    writeJson(path.join(target, "evals", "context-quality-answer-key.json"), { schema: "uash.context-answer-key.v1", answers: [{ caseId: "routing", expected: "route before delivery" }, { caseId: "proof", expected: "completed goal and run packet" }] });
    const contextCaseSet = { id: "commissioned-context-cases", version: "v1", path: "evals/context-quality-cases.json", sha256: sha256(readFileSync(path.join(target, "evals", "context-quality-cases.json"))), caseCount: 2 };
    const contextAnswerKey = { id: "commissioned-context-answer-key", version: "v1", path: "evals/context-quality-answer-key.json", sha256: sha256(readFileSync(path.join(target, "evals", "context-quality-answer-key.json"))), caseCount: 2 };
    const contextMetric = { id: "answer-key-score", direction: "higher-is-better", minDelta: 0.25, candidateThreshold: 0.9 };
    writeJson(path.join(target, "context", "manifest.json"), {
      schema: "uash.context-manifest.v1",
      generatedAt: completedAt,
      runId,
      profile: goal.profile,
      commit,
      environment,
      loadedFiles: [{ path: "Package.swift", sha256: sha256(readFileSync(path.join(target, "Package.swift"))), loadedAt: completedAt }],
      contextQuality: { schema: "uash.context-quality-eval.v1", suiteId: "context-lane-quality", baselineMode: "no-context", caseSet: contextCaseSet, answerKey: contextAnswerKey, metric: contextMetric },
    });
    const contextManifestSha256 = sha256(readFileSync(path.join(target, "context", "manifest.json")));
    const contextEvaluator = { name: "valdris-context-verifier", version: "1.0.0" };
    const contextModel = { provider: "synthetic", name: "deterministic-fixture", version: "v1" };
    const contextPromptVersion = "commissioned-context-verification-v1";
    const contextConfigDigest = sha256("commissioned-context-verifier-config-v1");
    const contextArmIdentity = { caseSet: contextCaseSet, answerKey: contextAnswerKey, evaluator: contextEvaluator, model: contextModel, promptVersion: contextPromptVersion, configDigest: contextConfigDigest };
    const contextResultIdentity = {
      schema: "uash.context-arm-result.v1", suiteId: "context-lane-quality", contextManifestSha256,
      runId, profile: goal.profile, commit, environment, ...contextArmIdentity, metric: contextMetric,
    };
    writeJson(path.join(target, "proof", "context-baseline-results.json"), {
      ...contextResultIdentity, contextMode: "no-context",
      cases: [{ caseId: "routing", value: 0, criticalRegression: false }, { caseId: "proof", value: 1, criticalRegression: false }],
      aggregate: { method: "arithmetic-mean", caseCount: 2, value: 0.5, criticalRegressions: 0 },
    });
    writeJson(path.join(target, "proof", "context-candidate-results.json"), {
      ...contextResultIdentity, contextMode: "loaded-context",
      cases: [{ caseId: "routing", value: 1, criticalRegression: false }, { caseId: "proof", value: 1, criticalRegression: false }],
      aggregate: { method: "arithmetic-mean", caseCount: 2, value: 1, criticalRegressions: 0 },
    });
    writeJson(path.join(target, "ai", "assurance.json"), {
      schema: "uash.ai-assurance.v1",
      generatedAt: completedAt,
      runId,
      status: "skipped",
      profile: goal.profile,
      ...skippedBinding,
      environment,
      commit,
      workloadDetected: false,
      aiProfile: "AI-0",
      features: route.ai.features,
      controls: [],
      skipReason: "The validated T0 documentation route has no AI workload.",
    });
    writeJson(path.join(target, "domain", "assurance.json"), {
      schema: "uash.domain-assurance.v1",
      generatedAt: completedAt,
      runId,
      status: "skipped",
      profile: goal.profile,
      ...skippedBinding,
      environment,
      commit,
      packs: [],
      skipReason: "The validated T0 documentation route has no product domain pack.",
    });
    writeJson(path.join(target, "evals", "results.json"), {
      schema: "uash.eval-results.v1",
      generatedAt: completedAt,
      runId,
      status: "passed",
      profile: goal.profile,
      commit,
      environment,
      suites: [{
        id: "context-lane-quality",
        kind: "ai",
        datasets: [{ id: contextCaseSet.id, version: contextCaseSet.version, sha256: contextCaseSet.sha256, caseCount: contextCaseSet.caseCount }],
        rubrics: [{ id: contextAnswerKey.id, version: contextAnswerKey.version, sha256: contextAnswerKey.sha256 }],
        evaluator: contextEvaluator,
        configDigest: contextConfigDigest,
        model: contextModel,
        promptVersion: contextPromptVersion,
        criticalFailures: 0,
        slices: [{ id: "context-quality", threshold: 0.9, value: 1, operator: ">=" }],
        resultPath: "proof/context-candidate-results.json",
        resultDigest: sha256(readFileSync(path.join(target, "proof", "context-candidate-results.json"))),
        threshold: 0.9,
        value: 1,
        operator: ">=",
        startedAt: approvedAt,
        completedAt,
        contextComparison: {
          schema: "uash.context-comparison.v1",
          contextManifestSha256,
          baselineMode: "no-context",
          metric: contextMetric,
          criticalRegressions: 0,
          delta: 0.5,
          baseline: { contextMode: "no-context", ...contextArmIdentity, value: 0.5, resultPath: "proof/context-baseline-results.json", resultDigest: sha256(readFileSync(path.join(target, "proof", "context-baseline-results.json"))) },
          candidate: { contextMode: "loaded-context", ...contextArmIdentity, value: 1, resultPath: "proof/context-candidate-results.json", resultDigest: sha256(readFileSync(path.join(target, "proof", "context-candidate-results.json"))) },
        },
      }],
    });
    writeJson(path.join(target, "waivers", "waivers.json"), {
      schema: "uash.waiver-ledger.v1",
      generatedAt: completedAt,
      runId,
      profile: goal.profile,
      commit,
      environment,
      waivers: [],
    });
    expectOk(runNode(path.join(pack, "scripts", "enterprise-ai-gate-all.mjs"), ["--repo", "."], target), "genuine commissioned aggregate finish-line gate");

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
    assert(runtimeBinding.source?.targetPath === "apps/ios-game", "final runtime binding must identify the nested target path");
    assert(runtimeBinding.source?.runtimePath === "apps/ios-game/.valdris-harness", "final runtime binding must identify the commissioned pack inside the nested target");
    const loaderBindings = runtimeBinding.files.filter(({ kind }) => kind === "target-root-discovery-loader");
    assert(loaderBindings.length === 2, "runtime binding must include both target-root discovery loaders");
    for (const fileName of ["AGENTS.md", "CLAUDE.md"]) {
      const loaderBinding = loaderBindings.find(({ path: bindingPath }) => bindingPath === fileName);
      const committedLoader = expectOk(run("git", ["show", `HEAD:apps/ios-game/${fileName}`], target), `read committed ${fileName} blob`).stdout;
      assert(loaderBinding?.sha256 === sha256(committedLoader), `runtime binding must digest-bind the committed target-root ${fileName} blob`);
    }
    const runtimeWithoutLoaders = runtimeBinding.files.filter(({ kind }) => kind !== "target-root-discovery-loader");
    assert(runtimeBinding.setSha256 !== sha256(canonicalJson({ source: runtimeBinding.source, files: runtimeWithoutLoaders })), "validation runtime setSha256 must depend on the target-root discovery loaders");

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
      schema: "valdris.review.v2",
      generatedAt: completedAt,
      runId,
      commit,
      environment,
      status: "passed",
      subject: { artifact: "proof/portable.json", sha256: proofDigest },
      reviewTrustSha256: commissionedReviewTrustSha256,
      validationRuntimeSha256: runtimeBinding.setSha256,
      evidenceBundleSha256: evidenceBundle.evidenceBundleSha256,
      roleProvenance: {
        schema: "valdris.review-role-provenance.v1",
        scout: { actorId: "EXAMPLE-COMMISSION-SCOUT", actorType: "agent", sessionId: "EXAMPLE-COMMISSION-SCOUT-SESSION", executionId: "EXAMPLE-COMMISSION-SCOUT-EXECUTION", evidence: { kind: "artifact", path: "run/route.json", sha256: sha256(readFileSync(path.join(target, "run", "route.json"))) } },
        implementer: { actorId: "EXAMPLE-COMMISSION-IMPLEMENTER", actorType: "agent", sessionId: "EXAMPLE-COMMISSION-IMPLEMENT-SESSION", executionId: "EXAMPLE-COMMISSION-IMPLEMENT-EXECUTION", evidence: { kind: "artifact", path: "proof/portable.json", sha256: proofDigest } },
        verifier: { actorId: "EXAMPLE-COMMISSION-VERIFIER", actorType: "agent", sessionId: "EXAMPLE-COMMISSION-VERIFY-SESSION", executionId: "EXAMPLE-COMMISSION-VERIFY-EXECUTION", evidence: { kind: "artifact", path: "proof/portable.json", sha256: proofDigest } },
        independentReviewer: { actorId: "EXAMPLE-COMMISSION-REVIEWER", actorType: "agent", sessionId: "EXAMPLE-COMMISSION-REVIEW-SESSION", executionId: "EXAMPLE-COMMISSION-REVIEW-EXECUTION", evidence: { kind: "review-evidence-bundle", sha256: evidenceBundle.evidenceBundleSha256 } },
      },
      decision: { status: "accepted", summary: "Nested commissioned proof satisfies the portability contract." },
      findings: [],
      blockers: [],
    };
    const signReviewDocument = (document) => {
      document.attestation = { scheme: "ed25519", keyId, signedAt: completedAt };
      const serialized = canonicalJson(reviewAttestationPayload(document));
      document.attestation.payloadSha256 = sha256(serialized);
      document.attestation.signature = signPayload(null, Buffer.from(serialized, "utf8"), privateKey).toString("base64");
      return document;
    };
    signReviewDocument(review);
    writeJson(path.join(target, "review", "review.json"), review);
    expectOk(runNode(path.join(pack, "scripts", "review-gate.mjs"), ["--repo", ".", "--file", "review/review.json"], target), "pack-aware signed review gate");

    const missingVerifierReview = signReviewDocument(structuredClone(review));
    delete missingVerifierReview.roleProvenance.verifier;
    signReviewDocument(missingVerifierReview);
    writeJson(path.join(target, "review", "review.json"), missingVerifierReview);
    expectFailure(runNode(path.join(pack, "scripts", "review-gate.mjs"), ["--repo", ".", "--file", "review/review.json"], target), "commissioned review without verifier provenance", "roleProvenance.verifier is required");

    const collapsedReviewer = structuredClone(review);
    collapsedReviewer.roleProvenance.independentReviewer.actorId = collapsedReviewer.roleProvenance.implementer.actorId;
    signReviewDocument(collapsedReviewer);
    writeJson(path.join(target, "review", "review.json"), collapsedReviewer);
    expectFailure(runNode(path.join(pack, "scripts", "review-gate.mjs"), ["--repo", ".", "--file", "review/review.json"], target), "commissioned review with collapsed implementer/reviewer identity", "actorId is reused");

    writeJson(path.join(target, "review", "review.json"), review);
    expectOk(runNode(path.join(pack, "scripts", "review-gate.mjs"), ["--repo", ".", "--file", "review/review.json"], target), "restored four-role commissioned review gate");

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
    const packetDocument = readJson(path.join(target, "run", "packet.json"));
    assert(packetDocument.validationRuntime?.reviewTrustSha256 === commissionedReviewTrustSha256, "final packet must bind the operator-held review trust-store pin");
    assert(packetDocument.validationRuntime?.setSha256 === runtimeBinding.setSha256, "final packet must carry the loader-bound validation runtime digest");
    assert(packetDocument.bindings?.validationRuntimeSha256 === runtimeBinding.setSha256, "final packet envelope must bind the loader-bound validation runtime digest");
    const expectedRoleProvenanceSha256 = sha256(canonicalJson(review.roleProvenance));
    assert(packetDocument.roleProvenanceSha256 === expectedRoleProvenanceSha256, "final packet must expose the signed four-role provenance digest");
    assert(packetDocument.bindings?.roleProvenanceSha256 === expectedRoleProvenanceSha256, "final packet envelope must bind the signed four-role provenance digest");

    const acceptanceBundle = path.join(tempRoot, "acceptance-artifact-bundle");
    const bundledFiles = createAcceptanceArtifactBundle(target, acceptanceBundle, commit);
    assert(bundledFiles.some(({ path: artifactPath }) => artifactPath === "run/packet.json"), "acceptance bundle fixture must contain the final run packet");
    assert(!bundledFiles.some(({ path: artifactPath }) => artifactPath.startsWith(".valdris-harness/")), "acceptance bundle fixture must never contain commissioned validator files");
    const acceptanceWorktree = path.join(tempRoot, "acceptance-source-worktree");
    git(productWorktree, ["-c", "core.autocrlf=false", "worktree", "add", "--detach", acceptanceWorktree, commit]);
    const acceptanceTarget = path.join(acceptanceWorktree, "apps", "ios-game");
    const acceptancePack = path.join(acceptanceTarget, ".valdris-harness");
    const acceptanceScript = path.join(acceptancePack, "scripts", "run-acceptance.mjs");
    const optionSecret = "UNTRUSTED-EQUALS-OPTION-SECRET";
    const unknownOption = expectFailure(
      runNode(acceptanceScript, [`--bundle=${optionSecret}`], acceptanceTarget),
      "run acceptance unknown equals-form option",
      "unknown option",
    );
    assertOutputOmits(unknownOption, optionSecret, "unknown equals-form option");
    expectFailure(
      runNode(acceptanceScript, ["--bundle", "--source-commit", commit], acceptanceTarget),
      "run acceptance flag-like missing value",
      "--bundle requires a value",
    );

    const malformedManifestSecret = "MALFORMED-MANIFEST-SECRET";
    const malformedManifestBundle = path.join(tempRoot, "malformed-manifest-bundle");
    mkdirSync(malformedManifestBundle, { recursive: true });
    writeFileSync(path.join(malformedManifestBundle, "valdris-run-artifacts.json"), `{\"untrusted\":\"${malformedManifestSecret}\"`, "utf8");
    const malformedManifest = expectFailure(runNode(acceptanceScript, [
      "--repo", ".", "--bundle", malformedManifestBundle, "--source-commit", commit,
    ], acceptanceTarget), "run acceptance malformed manifest", "valdris-run-artifacts.json must be valid JSON");
    assertOutputOmits(malformedManifest, malformedManifestSecret, "malformed manifest diagnostics");

    const malformedPacketSecret = "MALFORMED-PACKET-SECRET";
    const malformedPacketBundle = path.join(tempRoot, "malformed-packet-bundle");
    createFixtureArtifactBundle(malformedPacketBundle, commit, {
      "run/packet.json": `{\"untrusted\":\"${malformedPacketSecret}\"`,
    });
    const malformedPacket = expectFailure(runNode(acceptanceScript, [
      "--repo", ".", "--bundle", malformedPacketBundle, "--source-commit", commit,
    ], acceptanceTarget), "run acceptance malformed packet", "bundled run/packet.json must be valid JSON");
    assertOutputOmits(malformedPacket, malformedPacketSecret, "malformed packet diagnostics");

    const deepBundle = path.join(tempRoot, "deep-artifact-bundle");
    createFixtureArtifactBundle(deepBundle, commit, {
      "run/packet.json": readFileSync(path.join(acceptanceBundle, "run", "packet.json")),
    });
    const deepRelativePath = `run/${Array.from({ length: 17 }, (_, index) => `nested-${index}`).join("/")}/extra.json`;
    writeJson(path.join(deepBundle, ...deepRelativePath.split("/")), { untrusted: true });
    expectFailure(runNode(acceptanceScript, [
      "--repo", ".", "--bundle", deepBundle, "--source-commit", commit,
    ], acceptanceTarget), "run acceptance deeply nested bundle", "directory depth limit");

    expectFailure(runNode(acceptanceScript, [
      "--repo", ".", "--bundle", acceptanceBundle, "--source-commit", "0".repeat(40),
    ], acceptanceTarget), "run acceptance source checkout mismatch", "source checkout HEAD does not match");

    const validatorPath = path.join(acceptancePack, "scripts", "run-acceptance.mjs");
    const validatorDigestBefore = sha256(readFileSync(validatorPath));
    const validatorOverwriteBundle = path.join(tempRoot, "validator-overwrite-bundle");
    createFixtureArtifactBundle(validatorOverwriteBundle, commit, {
      ".valdris-harness/scripts/run-acceptance.mjs": "attacker-controlled-validator\n",
      "run/packet.json": readFileSync(path.join(acceptanceBundle, "run", "packet.json")),
    });
    expectFailure(runNode(acceptanceScript, [
      "--repo", ".", "--bundle", validatorOverwriteBundle, "--source-commit", commit,
    ], acceptanceTarget), "run acceptance validator overwrite", "outside the evidence namespaces");
    assert(sha256(readFileSync(validatorPath)) === validatorDigestBefore, "validator overwrite rejection changed the commissioned acceptance CLI");

    const sourceOverwriteBundle = path.join(tempRoot, "source-overwrite-bundle");
    createFixtureArtifactBundle(sourceOverwriteBundle, commit, {
      "design/anchors.json": readFileSync(path.join(target, "design", "anchors.json")),
      "run/packet.json": readFileSync(path.join(acceptanceBundle, "run", "packet.json")),
    });
    expectFailure(runNode(acceptanceScript, [
      "--repo", ".", "--bundle", sourceOverwriteBundle, "--source-commit", commit,
    ], acceptanceTarget), "run acceptance source overwrite", "refuses to overwrite an existing source or validator path");
    assert(!existsSync(path.join(acceptanceTarget, "run", "packet.json")), "failed preflight partially hydrated the run packet");

    const workflowAcceptanceEnv = { ...process.env };
    const inheritedPathKey = Object.keys(workflowAcceptanceEnv).find((name) => name.toLowerCase() === "path");
    assert(inheritedPathKey, "commissioned acceptance verifier requires a process path variable");
    const inheritedPath = workflowAcceptanceEnv[inheritedPathKey];
    const mixedCasePathKey = process.platform === "win32" ? "Path" : "pAtH";
    if (process.platform === "win32") for (const name of Object.keys(workflowAcceptanceEnv)) if (name.toLowerCase() === "path") delete workflowAcceptanceEnv[name];
    workflowAcceptanceEnv[mixedCasePathKey] = inheritedPath;
    workflowAcceptanceEnv.VALDRIS_SOURCE_COMMIT = commit;
    workflowAcceptanceEnv.VALDRIS_ARTIFACT_BUNDLE = acceptanceBundle;
    const acceptanceResult = expectOk(runNode(acceptanceScript, ["--repo", "."], acceptanceTarget, { env: workflowAcceptanceEnv }), "generated detached-source run acceptance");
    const acceptanceReport = JSON.parse(acceptanceResult.stdout);
    assert(acceptanceReport.ok === true && acceptanceReport.sourceCommit === commit, "run acceptance must report the exact accepted source commit");
    assert(acceptanceReport.hydratedFiles === bundledFiles.length, "run acceptance must report every safely hydrated artifact");
    assert(acceptanceReport.pathEnvironmentKeys?.includes(mixedCasePathKey), "run acceptance must preserve a mixed-case Path key for child validator tool lookup");

    if (acceptanceOnly) {
      console.log(JSON.stringify({
        ok: true,
        seam: "commissioned exact source checkout -> manifest-bounded artifact hydration -> protected trust pin -> final gate stack",
        sourceCommit: commit,
        hydratedFiles: bundledFiles.length,
        mixedCasePathKey,
        positiveCases: 1,
        adversarialCases: 8,
      }, null, 2));
      return;
    }

    const bridgePort = 22000 + Math.floor(Math.random() * 20000);
    const bridgeApprovalCredential = HUMAN_APPROVAL_TOKEN;
    const bridge = spawn(process.execPath, [path.join(HARNESS_ROOT, "scripts", "claude-code-bridge.mjs")], {
      cwd: HARNESS_ROOT,
      env: {
        ...process.env,
        UASH_BRIDGE_PORT: String(bridgePort),
        UASH_DATA_DIR: path.join(tempRoot, "bridge-runs"),
        UASH_BRIDGE_ACCESS_TOKEN: BRIDGE_ACCESS_TOKEN,
        UASH_BRIDGE_INTEGRITY_KEY: BRIDGE_INTEGRITY_KEY,
        [["UASH", "HUMAN", "APPROVAL", "TOKEN"].join("_")]: bridgeApprovalCredential,
      },
      stdio: "ignore",
    });
    try {
      await waitForBridge(bridgePort);
      const created = await postJson(bridgePort, "/runs", { id: runId, artifactRoot: target });
      assert(created.reviewTrustSha256 === commissionedReviewTrustSha256, "bridge did not seal the operator-held review trust-store pin into the run");
      assert(created.commissionedRuntime?.runtimeSha256 === runtimeBinding.runtimeSha256, "bridge did not persist the genuine commissioned runtime and loader identity");
      assert(created.adapterPolicy?.enterpriseFinishLineRequired === true && created.adapterPolicy?.portableFinishLineRequired === true, "bridge did not load mandatory v0.8 finish-line policy");
      const event = (type, nodeId, message, overrides = {}) => ({
        type,
        nodeId,
        status: overrides.status || "ok",
        actor: overrides.actor || "harness",
        message,
        runMode: "live",
        eventSource: "bridge",
        ...overrides,
      });
      await postJson(bridgePort, `/runs/${runId}/events`, event("approval.requested", "route", "route approval required", {
        status: "needs_approval",
        artifact: "run/route.json",
        approvalOwner: "Commissioning Portability Owner",
        approvalScope: "route",
      }));
      await postJson(bridgePort, `/runs/${runId}/events`, event("approval.granted", "route", "route approved", {
        actor: "human",
        artifact: "run/route.json",
        approvalOwner: "Commissioning Portability Owner",
        approvalScope: "route",
      }), 200, { [["x", "uash", "human", "token"].join("-")]: bridgeApprovalCredential });
      for (const nodeId of adapter.runtime.requiredNodes.filter((node) => !["prove", "handoff"].includes(node))) {
        await postJson(bridgePort, `/runs/${runId}/events`, event("node.skipped", nodeId, `${nodeId} is not applicable to the validated T0 documentation route`, {
          status: "skipped",
          skipReason: "The validated T0 documentation route marks this runtime node not applicable; required finish-line artifacts remain independently gated.",
        }));
      }
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof attached", { artifact: "proof/proof.json" }));
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "handoff", "bridge handoff attached", { artifact: "handoff/final.md" }));
      const reviewPath = path.join(target, "review", "review.json");
      const reviewSource = readFileSync(reviewPath, "utf8");
      const invalidReview = JSON.parse(reviewSource);
      invalidReview.attestation.signature = Buffer.from("invalid-review-signature", "utf8").toString("base64");
      writeJson(reviewPath, invalidReview);
      const invalidReviewBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject invalid independent review", { artifact: "handoff/final.md" }), 409);
      assert((invalidReviewBlocked.problems || []).some((problem) => String(problem).includes("v0.8 independent review finish line failed")), "bridge did not invoke the genuine nested independent-review gate");
      writeFileSync(reviewPath, reviewSource, "utf8");
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated after review rejection", { artifact: "proof/proof.json" }));

      const packetPath = path.join(target, "run", "packet.json");
      const packetSource = readFileSync(packetPath, "utf8");
      const invalidPacket = JSON.parse(packetSource);
      invalidPacket.bindings.envelopeSha256 = "0".repeat(64);
      writeJson(packetPath, invalidPacket);
      const invalidPacketBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject invalid final packet", { artifact: "handoff/final.md" }), 409);
      assert((invalidPacketBlocked.problems || []).some((problem) => String(problem).includes("v0.8 run packet finish line failed")), "bridge did not invoke the genuine nested run-packet gate");
      writeFileSync(packetPath, packetSource, "utf8");
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated after packet rejection", { artifact: "proof/proof.json" }));

      writeJson(path.join(target, "rca", "rca.json"), { schema: "valdris.rca.v1", status: "invalid-fixture" });
      const invalidRcaBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject invalid conditional RCA", { artifact: "handoff/final.md" }), 409);
      assert((invalidRcaBlocked.problems || []).some((problem) => String(problem).includes("v0.8 RCA finish line failed")), "bridge did not invoke the genuine nested RCA gate when an RCA artifact existed");
      rmSync(path.join(target, "rca", "rca.json"), { force: true });
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated after RCA rejection", { artifact: "proof/proof.json" }));

      const evalPath = path.join(target, "evals", "results.json");
      const evalSource = readFileSync(evalPath, "utf8");
      const privateContact = `${"operator"}@${"private"}.${"example"}`;
      const evalWithPrivateContact = JSON.parse(evalSource);
      evalWithPrivateContact.operatorContact = privateContact;
      writeJson(evalPath, evalWithPrivateContact);
      const omittedEvalPrivacyBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject private contact in packet-bound eval evidence", { artifact: "handoff/final.md" }), 409);
      assert((omittedEvalPrivacyBlocked.problems || []).some((problem) => String(problem).includes("run-artifact privacy finish line failed")), "packet-bound eval evidence was omitted from the commissioned privacy closure");
      assert(!JSON.stringify(omittedEvalPrivacyBlocked).includes(privateContact), "packet-closure privacy rejection disclosed private contact data");
      writeFileSync(evalPath, evalSource, "utf8");
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated before referenced-evidence privacy test", { artifact: "proof/proof.json" }));

      const traceSource = readFileSync(tracePath, "utf8");
      const trajectorySource = readFileSync(trajectoryPath, "utf8");
      const referencedPrivateContact = `${"trace-owner"}@${"private"}.${"example"}`;
      const traceWithPrivateContact = `${traceSource}${JSON.stringify({ runId, event: "private-contact-fixture", contact: referencedPrivateContact })}\n`;
      writeFileSync(tracePath, traceWithPrivateContact, "utf8");
      const trajectoryWithUpdatedDigest = JSON.parse(trajectorySource);
      trajectoryWithUpdatedDigest.traceDigest = sha256(readFileSync(tracePath));
      writeJson(trajectoryPath, trajectoryWithUpdatedDigest);
      const referencedTracePrivacyBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject private contact in digest-valid referenced trace evidence", { artifact: "handoff/final.md" }), 409);
      assert((referencedTracePrivacyBlocked.problems || []).some((problem) => String(problem).includes("run-artifact privacy finish line failed")), "digest-valid trajectory trace evidence was omitted from the commissioned privacy closure");
      assert(!JSON.stringify(referencedTracePrivacyBlocked).includes(referencedPrivateContact), "referenced-trace privacy rejection disclosed private contact data");
      writeFileSync(tracePath, traceSource, "utf8");
      writeFileSync(trajectoryPath, trajectorySource, "utf8");
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated after packet-closure privacy rejection", { artifact: "proof/proof.json" }));

      const aiAssurancePath = path.join(target, "ai", "assurance.json");
      const aiAssuranceSource = readFileSync(aiAssurancePath, "utf8");
      const assuranceEvidencePath = path.join(target, "proof", "assurance-private-evidence.txt");
      const assurancePrivateContact = `${"assurance-owner"}@${"private"}.${"example"}`;
      writeFileSync(assuranceEvidencePath, `contact=${assurancePrivateContact}\n`, "utf8");
      const aiAssuranceWithPrivateReference = JSON.parse(aiAssuranceSource);
      aiAssuranceWithPrivateReference.controls = [{
        id: "PRIVATE-EVIDENCE-FIXTURE",
        status: "passed",
        evidence: [{
          type: "artifact",
          path: "proof/assurance-private-evidence.txt",
          sha256: sha256(readFileSync(assuranceEvidencePath)),
          generatedAt: completedAt,
        }],
      }];
      writeJson(aiAssurancePath, aiAssuranceWithPrivateReference);
      const referencedAssurancePrivacyBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject private contact in digest-valid assurance evidence", { artifact: "handoff/final.md" }), 409);
      assert((referencedAssurancePrivacyBlocked.problems || []).some((problem) => String(problem).includes("run-artifact privacy finish line failed")), "digest-valid typed assurance evidence was omitted from the commissioned privacy closure");
      assert(!JSON.stringify(referencedAssurancePrivacyBlocked).includes(assurancePrivateContact), "referenced-assurance privacy rejection disclosed private contact data");
      writeFileSync(aiAssurancePath, aiAssuranceSource, "utf8");
      rmSync(assuranceEvidencePath, { force: true });
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated after assurance-reference privacy rejection", { artifact: "proof/proof.json" }));

      const handoffPath = path.join(target, "handoff", "final.md");
      const handoffSource = readFileSync(handoffPath, "utf8");
      const syntheticSecret = `${"gh"}${"p"}_${"s".repeat(36)}`;
      writeFileSync(handoffPath, `${handoffSource}\ncredential=${syntheticSecret}\n`, "utf8");
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "handoff", "reseal required handoff containing an adversarial secret fixture", { artifact: "handoff/final.md" }));
      const secretHandoffBlocked = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "reject required run artifact containing a secret", { artifact: "handoff/final.md" }), 409);
      assert((secretHandoffBlocked.problems || []).some((problem) => String(problem).includes("run-artifact privacy finish line failed")), "bridge did not invoke the commissioned privacy gate for required run artifacts");
      assert(!JSON.stringify(secretHandoffBlocked).includes(syntheticSecret), "bridge privacy rejection disclosed the detected secret");
      writeFileSync(handoffPath, handoffSource, "utf8");
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "handoff", "bridge handoff restored after privacy rejection", { artifact: "handoff/final.md" }));
      await postJson(bridgePort, `/runs/${runId}/events`, event("artifact.written", "prove", "bridge proof revalidated after privacy rejection", { artifact: "proof/proof.json" }));

      const completed = await postJson(bridgePort, `/runs/${runId}/events`, event("run.completed", "handoff", "genuine commissioned v0.8 completion", { artifact: "handoff/final.md" }));
      assert(completed.run?.status === "complete", "genuine commissioned v0.8 bridge completion did not pass");
      assert(completed.event?.type === "run.completed" && completed.run.events?.some(({ type }) => type === "run.completed"), "successful commissioned completion was not persisted as a run.completed event");

      writeFileSync(tracePath, traceWithPrivateContact, "utf8");
      writeJson(trajectoryPath, trajectoryWithUpdatedDigest);
      const driftedReferencedTrace = await getJson(bridgePort, `/runs/${runId}`, 500);
      assert(String(driftedReferencedTrace.error || "").includes("run-artifact privacy finish line failed") && !JSON.stringify(driftedReferencedTrace).includes(referencedPrivateContact), "completed-run read did not quarantine digest-valid referenced-trace privacy drift safely");
      const driftedReferencedTraceList = await getJson(bridgePort, "/runs");
      assert(!driftedReferencedTraceList.some((entry) => entry.id === runId), "completed run with referenced-trace privacy drift remained visible in the trusted run list");
      writeFileSync(tracePath, traceSource, "utf8");
      writeFileSync(trajectoryPath, trajectorySource, "utf8");
      const restoredReferencedTrace = await getJson(bridgePort, `/runs/${runId}`);
      assert(restoredReferencedTrace.status === "complete", "completed run did not recover after referenced trajectory evidence was restored");

      writeJson(evalPath, evalWithPrivateContact);
      const driftedCompleted = await getJson(bridgePort, `/runs/${runId}`, 500);
      assert(String(driftedCompleted.error || "").includes("run-artifact privacy finish line failed") && !JSON.stringify(driftedCompleted).includes(privateContact), "completed-run read did not quarantine packet-bound privacy drift safely");
      const driftedRunList = await getJson(bridgePort, "/runs");
      assert(!driftedRunList.some((entry) => entry.id === runId), "completed run with packet-bound privacy drift remained visible in the trusted run list");
      writeFileSync(evalPath, evalSource, "utf8");
      const restoredCompleted = await getJson(bridgePort, `/runs/${runId}`);
      assert(restoredCompleted.status === "complete", "completed run did not recover after packet-bound privacy evidence was restored");

      writeFileSync(assuranceEvidencePath, `contact=${assurancePrivateContact}\n`, "utf8");
      writeJson(aiAssurancePath, aiAssuranceWithPrivateReference);
      const driftedReferencedAssurance = await getJson(bridgePort, `/runs/${runId}`, 500);
      assert(String(driftedReferencedAssurance.error || "").includes("run-artifact privacy finish line failed") && !JSON.stringify(driftedReferencedAssurance).includes(assurancePrivateContact), "completed-run read did not quarantine digest-valid assurance-evidence privacy drift safely");
      const driftedReferencedAssuranceList = await getJson(bridgePort, "/runs");
      assert(!driftedReferencedAssuranceList.some((entry) => entry.id === runId), "completed run with referenced assurance-evidence privacy drift remained visible in the trusted run list");
      writeFileSync(aiAssurancePath, aiAssuranceSource, "utf8");
      rmSync(assuranceEvidencePath, { force: true });
      const restoredReferencedAssurance = await getJson(bridgePort, `/runs/${runId}`);
      assert(restoredReferencedAssurance.status === "complete", "completed run did not recover after referenced assurance evidence was restored");
    } finally {
      bridge.kill("SIGTERM");
    }

    const portableSource = readFileSync(proofPath, "utf8");
    try {
      const crossTargetProof = JSON.parse(portableSource);
      crossTargetProof.source.targetPath = "apps/sibling-game";
      writeJson(proofPath, crossTargetProof);
      expectFailure(
        runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), ["--repo", ".", "--file", "run/packet.json"], target),
        "final packet with portable proof copied from a sibling target",
        "portable-proof target path does not match the packet validation runtime target",
      );
    } finally {
      writeFileSync(proofPath, portableSource, "utf8");
    }

    const agentsPath = path.join(target, "AGENTS.md");
    const agentsSource = readFileSync(agentsPath, "utf8");
    try {
      writeFileSync(agentsPath, agentsSource.replace(".valdris-harness/AGENTS.md", ".untrusted-harness/AGENTS.md"), "utf8");
      expectFailure(
        runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), ["--repo", ".", "--file", "run/packet.json"], target),
        "final packet after exact discovery-loader mutation",
        "bounded loader block does not match the commissioned contract",
      );
    } finally {
      writeFileSync(agentsPath, agentsSource, "utf8");
    }
    try {
      rmSync(agentsPath, { force: true });
      mkdirSync(agentsPath);
      expectFailure(
        runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), ["--repo", ".", "--file", "run/packet.json"], target),
        "final packet with a non-file discovery-loader path",
        "target-root discovery loader AGENTS.md must be a regular file",
      );
    } finally {
      rmSync(agentsPath, { recursive: true, force: true });
      writeFileSync(agentsPath, agentsSource, "utf8");
    }

    const claudePath = path.join(target, "CLAUDE.md");
    const claudeSource = readFileSync(claudePath, "utf8");
    try {
      writeFileSync(claudePath, `${claudeSource}\nUncommitted target-root instruction drift.\n`, "utf8");
      expectFailure(
        runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), ["--repo", ".", "--file", "run/packet.json"], target),
        "final packet after target-root loader file drift",
        "target-root discovery loaders are dirty",
      );
    } finally {
      writeFileSync(claudePath, claudeSource, "utf8");
    }

    for (const [setFlag, clearFlag, fileName] of [
      ["--assume-unchanged", "--no-assume-unchanged", "AGENTS.md"],
      ["--skip-worktree", "--no-skip-worktree", "CLAUDE.md"],
    ]) {
      try {
        git(target, ["update-index", setFlag, fileName]);
        expectFailure(
          runNode(path.join(pack, "scripts", "run-packet-gate.mjs"), ["--repo", ".", "--file", "run/packet.json"], target),
          `final packet with ${setFlag} loader concealment`,
          "rejects assume-unchanged or skip-worktree index concealment flags",
        );
      } finally {
        git(target, ["update-index", clearFlag, fileName]);
      }
    }

    const { publicKey: attackerPublicKey } = generateKeyPairSync("ed25519");
    writeJson(path.join(pack, "controls", "review-trust.v1.json"), {
      schema: "valdris.review-trust.v1",
      keys: [{
        keyId: "ATTACKER-COMMISSIONED-SELF-ENROLLMENT",
        algorithm: "ed25519",
        status: "active",
        publicKeyPem: attackerPublicKey.export({ type: "spki", format: "pem" }),
        allowedActorIds: ["ATTACKER-COMMISSIONED-REVIEWER"],
        allowedActorTypes: ["agent"],
      }],
    });
    git(target, ["add", ".valdris-harness/controls/review-trust.v1.json"]);
    git(target, ["commit", "-m", "test: attacker self-enrolls commissioned review key"]);
    const selfEnrollmentPort = bridgePort + 1;
    const selfEnrollmentBridge = spawn(process.execPath, [path.join(HARNESS_ROOT, "scripts", "claude-code-bridge.mjs")], {
      cwd: HARNESS_ROOT,
      env: {
        ...process.env,
        UASH_REVIEW_TRUST_SHA256: commissionedReviewTrustSha256,
        UASH_BRIDGE_PORT: String(selfEnrollmentPort),
        UASH_DATA_DIR: path.join(tempRoot, "bridge-self-enrollment-runs"),
        UASH_BRIDGE_ACCESS_TOKEN: BRIDGE_ACCESS_TOKEN,
        UASH_BRIDGE_INTEGRITY_KEY: BRIDGE_INTEGRITY_KEY,
        [["UASH", "HUMAN", "APPROVAL", "TOKEN"].join("_")]: HUMAN_APPROVAL_TOKEN,
      },
      stdio: "ignore",
    });
    try {
      await waitForBridge(selfEnrollmentPort);
      const rejectedSelfEnrollment = await postJson(selfEnrollmentPort, "/runs", {
        id: "COMMISSIONED-SELF-ENROLLMENT-ATTACK",
        artifactRoot: target,
      }, 400);
      assert(
        (rejectedSelfEnrollment.problems || []).some((problem) => String(problem).includes("does not match operator-held UASH_REVIEW_TRUST_SHA256")),
        "bridge accepted a commissioned runtime whose attacker key was committed after the operator retained the old trust pin",
      );
    } finally {
      selfEnrollmentBridge.kill("SIGTERM");
    }

    console.log(JSON.stringify({
      ok: true,
      seam: "commission CLI -> committed nested source -> external manifest-bounded evidence hydration -> enterprise gates -> signed review -> final run packet",
      commissionedLayout: ".valdris-harness",
      targetRootDiscoveryLoadersCommitted: true,
      iosBinaryAssetAcceptedOutsideCleanRoomScope: true,
      packPrivacyPassed: true,
      generatedEvidencePrivacyPassed: true,
      packAwareReviewTrustPassed: true,
      portableRuntimePassed: true,
      runPacketPassed: true,
      detachedSourceRunAcceptancePassed: true,
      artifactHydrationOverwriteBlocked: true,
      untrustedAcceptanceDiagnosticsRedacted: true,
      artifactTraversalBounded: true,
      fourRoleReviewClosurePassed: true,
      requiredRunArtifactPrivacyPassed: true,
      packetClosurePrivacyPassed: true,
      referencedEvidencePrivacyPassed: true,
      referencedAssuranceEvidencePrivacyPassed: true,
      completedPacketPrivacyDriftQuarantined: true,
      completedReferencedEvidencePrivacyDriftQuarantined: true,
      completedReferencedAssuranceEvidencePrivacyDriftQuarantined: true,
      genuineBridgeCompletionPassed: true,
      commissionedSelfEnrollmentRejected: true,
      positiveCases: 3,
      adversarialCases: 29,
    }, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
