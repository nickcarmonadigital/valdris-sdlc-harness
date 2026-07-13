#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const node = process.execPath;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || root, env: { ...process.env, ...(options.env || {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function waitForHealth(port, timeoutMs = 8000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("bridge health check timed out");
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function postJson(url, body, expectedStatus = 200, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (response.status !== expectedStatus) {
    throw new Error(`expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return parsed;
}

async function postRun(port, run, expectedStatus = 200) {
  return postJson(`http://127.0.0.1:${port}/runs`, run, expectedStatus);
}

async function postEvent(port, runId, event, expectedStatus = 200, headers = {}) {
  return postJson(`http://127.0.0.1:${port}/runs/${encodeURIComponent(runId)}/events`, event, expectedStatus, headers);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertProblem(body, text, label) {
  assert((body.problems || []).some((problem) => String(problem).includes(text)), `${label}: expected problem containing ${text}, got ${JSON.stringify(body.problems)}`);
}

function baseEvent(type, nodeId, message, overrides = {}) {
  return {
    type,
    nodeId,
    status: overrides.status || "ok",
    actor: overrides.actor || "harness",
    message,
    runMode: overrides.runMode || "live",
    eventSource: overrides.eventSource || "bridge",
    ...overrides,
  };
}

async function writeArtifact(rootDir, relativePath, content = "{}\n") {
  const fullPath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function proofJson(runId = "VERIFY-PROOF") {
  const now = new Date().toISOString();
  return JSON.stringify({
    schema: "uash.proof.v1",
    generatedAt: now,
    runId,
    status: "passed",
    summary: "Harness verifier command evidence passed.",
    commands: [
      {
        command: "npm run verify:harness",
        exitCode: 0,
        startedAt: now,
        completedAt: now,
        outputDigest: "sha256:verify-harness-fixture",
        stdoutTail: "Valdris SDLC Harness verification passed",
      },
    ],
  });
}

function failedProofJson(runId = "VERIFY-FAILED-PROOF") {
  const now = new Date().toISOString();
  return JSON.stringify({
    schema: "uash.proof.v1",
    generatedAt: now,
    runId,
    status: "failed",
    summary: "Harness verifier deliberately failed command evidence.",
    commands: [
      {
        command: "false",
        exitCode: 1,
        completedAt: now,
        stderrTail: "failed",
      },
    ],
  });
}

const PRODUCTION_LAYERS = [
  "frontend",
  "backend-api-logic",
  "database-storage",
  "auth-permissions-rls",
  "hosting-deployment",
  "cloud-compute",
  "cicd-version-control",
  "security",
  "rate-limiting",
  "caching-cdn",
  "load-balancing-scaling",
  "error-tracking-logs-observability",
  "availability-recovery-dr",
];

function productionLayerAssessmentJson(runId = "VERIFY-PRODUCTION-LAYERS") {
  const now = new Date().toISOString();
  return JSON.stringify({
    schema: "uash.production-readiness.v1",
    generatedAt: now,
    runId,
    status: "passed",
    summary: "All 13 production-readiness layers were classified for this verification run.",
    layers: PRODUCTION_LAYERS.map((layer) => ({
      layer,
      status: "skipped",
      reason: `Verification run does not touch ${layer}.`,
    })),
  });
}

async function satisfyCoreArtifacts(port, runId, artifactRoot, options = {}) {
  await writeArtifact(artifactRoot, "run/intake.json", JSON.stringify({ ok: true }));
  await postEvent(port, runId, baseEvent("artifact.written", "intake", "intake artifact", { artifact: "run/intake.json", actor: "codex" }));
  await writeArtifact(artifactRoot, "run/route.json", JSON.stringify({ lane: "verification" }));
  await postEvent(port, runId, baseEvent("artifact.written", "route", "route artifact", { artifact: "run/route.json", actor: "codex" }));
  await writeArtifact(artifactRoot, "graph/graph.json", JSON.stringify({ schema: "uash.code-intelligence.graph.v0.1", nodes: [{ path: "package.json" }], edges: [], codeIntelligenceCompatible: true }));
  await postEvent(port, runId, baseEvent("artifact.written", "code-intelligence", "code-intelligence/code graph artifact", { artifact: "graph/graph.json", actor: "codex" }));
  await writeArtifact(artifactRoot, "graph/freshness.json", JSON.stringify({ schema: "uash.graph-freshness.v0.1", graphPath: "graph/graph.json" }));
  await writeArtifact(artifactRoot, "design/anchors.json", JSON.stringify({ schema: "uash.design-anchors.v0.1", anchors: [{ path: "run/route.json", reason: "verification anchor" }] }));
  await postEvent(port, runId, baseEvent("artifact.written", "design-anchors", "design anchors artifact", { artifact: "design/anchors.json", actor: "codex" }));
  await postEvent(port, runId, baseEvent("node.skipped", "system-design", "system design skipped", { status: "skipped", skipReason: "No architecture/API/data-model decision in this verification run" }));
  await writeArtifact(artifactRoot, "production/layer-assessment.json", productionLayerAssessmentJson(runId));
  await postEvent(port, runId, baseEvent("artifact.written", "production-readiness", "production layer artifact", { artifact: "production/layer-assessment.json", actor: "codex" }));
  await postEvent(port, runId, baseEvent("node.skipped", "cloud-platform", "cloud skipped", { status: "skipped", artifact: "cloud/skip.json", skipReason: "No cloud/IAM/deploy/provider change in this verification run" }));
  await writeArtifact(artifactRoot, "session/events.jsonl", "{\"event\":\"implementation-proof\"}\n");
  await postEvent(port, runId, baseEvent("artifact.written", "implement", "implementation event ledger", { artifact: "session/events.jsonl", actor: "codex" }));
  if (!options.leaveRedzoneOpen) {
    await postEvent(port, runId, baseEvent("node.skipped", "redzone", "red zone skipped", { status: "skipped", artifact: "approvals/redzone.json", skipReason: "No production/secrets/billing/auth/data/destructive action" }));
  }
  await postEvent(port, runId, baseEvent("node.skipped", "qa-break-it", "break-it QA skipped", { status: "skipped", artifact: "qa/break-it-results.md", skipReason: "Verification checks connector contract only; no product behavior changed" }));
  await writeArtifact(artifactRoot, "proof/proof.json", proofJson(runId));
  await postEvent(port, runId, baseEvent("artifact.written", "prove", "proof artifact", { artifact: "proof/proof.json" }));
  await postEvent(port, runId, baseEvent("node.skipped", "live-smoke", "live smoke skipped", { status: "skipped", artifact: "smoke/skip.json", skipReason: "No deployed/provider/runtime behavior changed" }));
  if (!options.leaveSelfHealOpen) {
    await postEvent(port, runId, baseEvent("node.skipped", "self-heal", "self-heal skipped", { status: "skipped", artifact: "self_heal/self_heal_report.md", skipReason: "No harness gap detected by this verification run" }));
  }
  await writeArtifact(artifactRoot, "handoff/final.md", "# Final handoff\n\nVerification complete.\n");
  await postEvent(port, runId, baseEvent("artifact.written", "handoff", "handoff artifact", { artifact: "handoff/final.md" }));
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "valdris-harness-verify-"));
const generatedOut = path.join(tempRoot, "commissioned");
const pyTarget = path.join(tempRoot, "pyproject-only");
const pyPack = path.join(tempRoot, "py-pack");
const iosTarget = path.join(tempRoot, "ios-target");
const iosPack = path.join(iosTarget, ".valdris-harness");
const nonAiIosTarget = path.join(tempRoot, "non-ai-ios-target");
const overwriteTarget = path.join(tempRoot, "overwrite-target");
const dataDir = path.join(tempRoot, "runs");
const port = 18000 + Math.floor(Math.random() * 20000);
let bridge;

try {
  const knowledgeIndex = await readFile(path.join(root, "knowledge", "index.md"), "utf8");
  assert(knowledgeIndex.includes("Systems") && knowledgeIndex.includes("Playbooks") && knowledgeIndex.includes("Sources"), "knowledge root index missing progressive-disclosure sections");
  await run(node, ["scripts/okf-vault-gate.mjs", "--repo", "."]);

  const questions = await run(node, ["scripts/commission-harness.mjs", "--print-questions"]);
  const questionGroups = JSON.parse(questions.stdout);
  assert(questionGroups.length === 31, `expected 31 commissioning groups, got ${questionGroups.length}`);

  await run(node, ["scripts/commission-harness.mjs", "--repo", ".", "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes"]);
  let nonEmptyOutputBlocked = false;
  try {
    await run(node, ["scripts/commission-harness.mjs", "--repo", ".", "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes"]);
  } catch (error) {
    nonEmptyOutputBlocked = error.message.includes("Output directory is not empty");
  }
  assert(nonEmptyOutputBlocked, "commissioning did not protect a non-empty output directory");
  await run(node, ["scripts/commission-harness.mjs", "--repo", ".", "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes", "--force"]);
  await mkdir(overwriteTarget, { recursive: true });
  await writeFile(path.join(overwriteTarget, "package.json"), '{"name":"must-survive"}\n', "utf8");
  let directRepoOverwriteBlocked = false;
  try {
    await run(node, ["scripts/commission-harness.mjs", "--repo", overwriteTarget, "--project-name", "Unsafe", "--out", overwriteTarget, "--yes"]);
  } catch (error) {
    directRepoOverwriteBlocked = error.message.includes("Refusing to commission directly over the target repository");
  }
  assert(directRepoOverwriteBlocked, "commissioning did not refuse --out equal to --repo");
  assert((await readFile(path.join(overwriteTarget, "package.json"), "utf8")).includes("must-survive"), "commissioning overwrote the target package manifest");

  const adapter = JSON.parse(await readFile(path.join(generatedOut, "project-adapter.json"), "utf8"));
  assert(adapter.schema === "uash.project-adapter.v2", "adapter schema mismatch");
  assert(adapter.generatorVersion === packageJson.version, "generator version mismatch");
  assert(adapter.commissioning?.questionGroups === 31, "commissioning group count mismatch");
  assert(adapter.commissioning?.questionCount === 158, "commissioning question count mismatch");
  assert(adapter.codeGraph?.requiredArtifacts?.includes("graph/graph.json"), "code graph adapter missing stable graph artifact");
  assert(adapter.codeGraph?.primaryProvider === "GitNexus", "GitNexus primary code-intelligence provider missing");
  assert(adapter.codeGraph?.preferredArtifacts?.includes("graph/gitnexus.json"), "GitNexus evidence artifact missing from adapter");
  assert(adapter.codeGraph?.scanCommand?.includes("code-intelligence-scan.mjs"), "code-intelligence scan command missing");
  assert(adapter.codeGraph?.gateCommand?.includes("code-intelligence-gate-all.mjs"), "cross-platform code-intelligence gate command missing");
  assert(adapter.codeGraph?.license === "PolyForm-Noncommercial-1.0.0", "GitNexus license boundary missing");
  assert(adapter.productionReadiness.layers.length === 13, "production readiness layer count mismatch");
  assert(adapter.productionReadiness.schema === "uash.production-readiness.v2", "production readiness v2 schema missing");
  assert(adapter.productionReadiness.catalog === "controls/production-layers.v2.json", "production control catalog missing");
  assert(adapter.productionReadiness.gateCommand?.includes("production-layer-gate.mjs"), "production layer gate command missing");
  assert(adapter.generativeAiAssurance?.schema === "uash.ai-assurance.v1", "AI assurance commissioning missing");
  assert(adapter.domainAssurance?.availablePacks?.includes("mobile-ios"), "iOS domain pack commissioning missing");
  assert(adapter.goalLoop?.schema === "uash.goal.v1", "goal loop commissioning missing");
  assert(adapter.skillRouter?.catalogSize === 8, "eight-skill router commissioning missing");
  assert(adapter.knowledgeVault?.format === "OKF v0.1", "knowledge vault format missing");
  assert(adapter.knowledgeVault?.root === "knowledge/", "knowledge vault root missing");
  assert(adapter.knowledgeVault?.gateCommand?.includes("okf-vault-gate.mjs"), "knowledge vault gate command missing");
  assert(adapter.telemetryModes.modes.includes("live"), "live telemetry mode missing");
  assert(adapter.nodeStateContract.skippedRequiresReason, "skip-reason rule missing");
  assert(adapter.nodeStateContract.failedRequiresRecoveryPath, "failure recovery rule missing");
  assert(adapter.foundationBlueprint?.badFoundationSignals?.length > 0, "foundation blueprint missing");
  assert(adapter.codeQualityGuardrails?.antiSpaghettiRules?.length > 0, "code quality guardrails missing");
  assert(adapter.enterpriseProofBank?.domainPack, "enterprise proof bank missing");
  assert(adapter.operatingIntelligence?.evalGate?.artifacts?.includes("evals/results.json"), "eval gate commissioning missing");
  assert(adapter.operatingIntelligence?.trajectoryGate?.artifacts?.includes("trajectory/trajectory.json"), "trajectory gate commissioning missing");
  assert(adapter.operatingIntelligence?.contextManifest?.artifacts?.includes("context/manifest.json"), "context manifest commissioning missing");
  assert(adapter.operatingIntelligence?.skillRegistry?.artifacts?.some((artifact) => artifact.includes("skills/registry.json")), "skill registry commissioning missing");
  assert(adapter.operatingIntelligence?.modelRouting?.qualityGate, "model routing commissioning missing");
  assert(adapter.operatingIntelligence?.aiEconomics?.costHandoff, "AI economics commissioning missing");
  assert(adapter.operatingIntelligence?.interop?.mcpTools?.includes("uash.start_run"), "MCP commissioning missing");
  assert(adapter.teamHarnessRegistry?.harnessOwner, "team harness registry missing");
  assert(adapter.humanAgentProtocol?.approvalContract, "human-agent protocol missing");
  assert(adapter.runtime?.connectorContractVersion === "uash.connector-events.v0.5", "adapter runtime contract version missing");
  assert(adapter.runtime?.requiredNodes?.includes("prove"), "adapter runtime required nodes missing prove");
  assert(adapter.proofSchema?.schema === "uash.proof.v1", "proof schema missing from adapter");
  assert(adapter.humanApproval?.tokenRequiredForGrant, "human approval token contract missing from adapter");
  assert(adapter.ciEnforcement?.workflowTemplate === ".github/workflows/valdris-assurance.yml", "CI workflow template missing from adapter");
  await readFile(path.join(generatedOut, "AGENTS.md"), "utf8");
  await readFile(path.join(generatedOut, "CLAUDE.md"), "utf8");
  await readFile(path.join(generatedOut, ".claude", "commands", "valdris-sdlc-harness.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Codex Runtime Prompt.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Code Intelligence Graph.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "GitNexus Code Intelligence.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Good Looks Like Foundation.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Code Quality Guardrails.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Enterprise Proof Bank.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Operating Intelligence Layer.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Team Harness Registry.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Human Agent Protocol.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Agent Knowledge Vault.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "ENTERPRISE_CONTROL_MODEL_V2.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "GENERATIVE_AI_ASSURANCE_PACK.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "GOAL_LOOP_AND_SKILL_ROUTER.md"), "utf8");
  await readFile(path.join(generatedOut, "knowledge", "index.md"), "utf8");
  await readFile(path.join(generatedOut, "knowledge", "playbooks", "engineering-task-routing.md"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "uash-emit-event.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "uash-write-proof.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "code-intelligence-scan.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "code-intelligence-local-scan.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "code-intelligence-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "code-intelligence-gate-all.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "anchor-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "production-layer-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "enterprise-ai-gate-all.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "route-request.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "goal-transition.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "domain-assurance-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "controls", "production-layers.v2.json"), "utf8");
  await readFile(path.join(generatedOut, "controls", "domain-packs", "mobile-ios.v1.json"), "utf8");
  await readFile(path.join(generatedOut, "skills", "registry.json"), "utf8");
  await readFile(path.join(generatedOut, ".agents", "skills", "registry.json"), "utf8");
  await readFile(path.join(generatedOut, ".claude", "skills", "registry.json"), "utf8");
  await readFile(path.join(generatedOut, ".github", "workflows", "valdris-assurance.yml"), "utf8");
  const generatedPackage = JSON.parse(await readFile(path.join(generatedOut, "package.json"), "utf8"));
  assert(generatedPackage.scripts?.["route:request"] && generatedPackage.scripts?.["goal:transition"] && generatedPackage.scripts?.["enterprise-ai:gate"], "generated package scripts missing v0.7 router/loop/gate commands");
  await readFile(path.join(generatedOut, "scripts", "okf-vault-gate.mjs"), "utf8");

  const rootEnterpriseProofBank = await readFile(path.join(root, "docs", "ENTERPRISE_PROOF_BANK.md"), "utf8");
  const rootOperatingIntelligence = await readFile(path.join(root, "docs", "OPERATING_INTELLIGENCE_LAYER.md"), "utf8");
  const rootTestDayGates = await readFile(path.join(root, "docs", "TEST_DAY_ACCEPTANCE_GATES.md"), "utf8");
  assert(rootEnterpriseProofBank.includes("Scale / concurrency") && rootEnterpriseProofBank.includes("Domain packs"), "enterprise proof bank root doc missing core sections");
  assert(rootOperatingIntelligence.includes("Trajectory evaluation") && rootOperatingIntelligence.includes("AI economics"), "operating intelligence root doc missing paper-gap patterns");
  assert(rootTestDayGates.includes("31 groups / 158 questions") && rootTestDayGates.includes("main updated"), "test-day acceptance gates doc missing update criteria");

  const claudeTemplate = await readFile(path.join(root, "templates", "claude-code", "commands", "valdris-sdlc-harness.md"), "utf8");
  const codexTemplate = await readFile(path.join(root, "templates", "codex", "valdris-sdlc-harness.md"), "utf8");
  assert(claudeTemplate.includes("code-intelligence-scan.mjs") && claudeTemplate.includes("GitNexus/code-intelligence"), "Claude template missing GitNexus/code-intelligence flow");
  assert(codexTemplate.includes("code-intelligence-scan.mjs") && codexTemplate.includes("Good Looks Like Foundation"), "Codex template missing GitNexus/foundation flow");
  assert(claudeTemplate.includes("skills/registry.json") && codexTemplate.includes("goal/goal.json"), "runtime templates missing v0.7 goal/skill routing");

  const claudeConnectorDoc = await readFile(path.join(root, "docs", "CLAUDE_CODE_CONNECTOR.md"), "utf8");
  const codexConnectorDoc = await readFile(path.join(root, "docs", "CODEX_CONNECTOR.md"), "utf8");
  assert(claudeConnectorDoc.startsWith("# Claude Code Connector v0.5"), "Claude connector doc version drift");
  assert(codexConnectorDoc.startsWith("# Codex Connector v0.5"), "Codex connector doc version drift");
  await run(node, ["scripts/code-intelligence-scan.mjs", "--repo", ".", "--provider", "local"], { cwd: generatedOut });
  await run(node, ["scripts/code-intelligence-gate-all.mjs", "--repo", ".", "--allow-stale"], { cwd: generatedOut });
  await run(node, ["scripts/okf-vault-gate.mjs", "--repo", "."], { cwd: generatedOut });
  await run(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut });

  await mkdir(pyTarget, { recursive: true });
  await writeFile(path.join(pyTarget, "pyproject.toml"), "[project]\nname = \"sample\"\nversion = \"0.0.1\"\n", "utf8");
  await run(node, ["scripts/commission-harness.mjs", "--repo", pyTarget, "--project-name", "PyProject Only", "--out", pyPack, "--yes"]);
  const pyAdapter = JSON.parse(await readFile(path.join(pyPack, "project-adapter.json"), "utf8"));
  assert(!String(pyAdapter.validation.install).includes("requirements.txt"), "pyproject-only install command should not reference requirements.txt");

  await mkdir(path.join(iosTarget, "apps", "mobile", "clients", "apple", "ios", "ValdrisGame.xcodeproj"), { recursive: true });
  await writeFile(path.join(iosTarget, "Package.swift"), "// swift-tools-version: 6.0\n", "utf8");
  await run(node, ["scripts/commission-harness.mjs", "--repo", iosTarget, "--project-name", "Valdris iOS Game", "--out", iosPack, "--yes"]);
  const iosAdapter = JSON.parse(await readFile(path.join(iosPack, "project-adapter.json"), "utf8"));
  assert(iosAdapter.detected.frameworks.includes("Xcode/iOS") && iosAdapter.mobileIos?.detected === true, "iOS/Xcode repo detection missing");
  assert(iosAdapter.codeGraph.scanCommand.includes(".valdris-harness/scripts") && iosAdapter.finishLineAssurance.gateCommand.includes(".valdris-harness/scripts"), "nested adapter commands do not point at the installed pack");
  assert(iosAdapter.validation.knowledge.includes(".valdris-harness/scripts") && iosAdapter.validation.finishLine.includes(".valdris-harness/scripts"), "nested adapter validation commands are not target-root-relative");
  assert(String(iosAdapter.validation.build).includes("xcodebuild archive") && String(iosAdapter.validation.test).includes("xcodebuild test"), "iOS macOS-runner validation commands missing");
  const iosRequest = "Build a multiplayer iOS game with an AI dungeon master, accounts, purchases, cloud saves, matchmaking, minors, and ship it to TestFlight.";
  await run(node, ["scripts/route-request.mjs", "--repo", iosTarget, "--run-id", "IOS-ROUTE-VERIFY", "--profile", "enterprise", "--environment", "verification", "--actor", "verification-owner", "--request", iosRequest]);
  await run(node, ["scripts/intake-gate.mjs", "--repo", iosTarget]);
  await run(node, ["scripts/route-gate.mjs", "--repo", iosTarget]);
  await run(node, [path.join(iosPack, "scripts", "route-gate.mjs"), "--repo", iosTarget], { cwd: iosTarget });
  await run(node, ["scripts/goal-gate.mjs", "--repo", iosTarget, "--allow-active"]);
  await run(node, ["scripts/goal-transition.mjs", "--repo", iosTarget, "--expected-revision", "1", "--checkpoint", "intake-route", "--checkpoint-status", "passed", "--summary", "Commissioning route reviewed and accepted for verification."]);
  let revisionConflictBlocked = false;
  try {
    await run(node, ["scripts/goal-transition.mjs", "--repo", iosTarget, "--expected-revision", "1", "--goal-status", "in_progress"]);
  } catch (error) {
    revisionConflictBlocked = error.message.includes("goal revision conflict");
  }
  assert(revisionConflictBlocked, "goal optimistic-concurrency revision conflict was not blocked");
  const iosRoute = JSON.parse(await readFile(path.join(iosTarget, "run", "route.json"), "utf8"));
  assert(iosRoute.ai.aiProfile === "AI-3" && ["mobile-ios", "multiplayer-realtime", "digital-commerce", "youth-ai-safety"].every((pack) => iosRoute.domainPacks.includes(pack)), "iOS AI request router missed required assurance packs");
  assert(iosRoute.skillPhases.every((phase) => phase.supporting.includes("valdris-security-audit") && phase.supporting.includes("valdris-platform-release")), "iOS accounts/purchases route missed security or platform support skills");
  const iosGeneratedPackage = JSON.parse(await readFile(path.join(iosPack, "package.json"), "utf8"));
  assert(iosGeneratedPackage.scripts["route:gate"].includes('repo ".."') && iosGeneratedPackage.scripts["goal:gate:active"], "nested package scripts do not target the application repo or support active goals");
  const iosWorkflow = await readFile(path.join(iosPack, ".github", "workflows", "valdris-assurance.yml"), "utf8");
  assert(iosWorkflow.includes(".valdris-harness/scripts") && iosWorkflow.includes("goal-gate.mjs --repo . --allow-active") && iosWorkflow.includes("steps.goal.outputs.complete"), "nested CI template paths or active-goal handling are invalid");
  const iosValidationDoc = await readFile(path.join(iosPack, "docs", "Validation Commands.md"), "utf8");
  assert(iosValidationDoc.includes(".valdris-harness/scripts") && iosValidationDoc.includes("--repo .valdris-harness"), "generated validation document uses pack-root commands in a nested install");
  await run(node, [path.join(iosPack, "scripts", "okf-vault-gate.mjs"), "--repo", iosPack], { cwd: iosTarget });
  await run(node, [path.join(iosPack, "scripts", "skill-registry-gate.mjs"), "--repo", iosPack], { cwd: iosTarget });
  await mkdir(nonAiIosTarget, { recursive: true });
  await run(node, ["scripts/route-request.mjs", "--repo", nonAiIosTarget, "--run-id", "IOS-NONAI-VERIFY", "--profile", "enterprise", "--environment", "verification", "--actor", "verification-owner", "--request", "Build a full-stack iOS game with accounts and ship it to TestFlight."]);
  await run(node, ["scripts/route-gate.mjs", "--repo", nonAiIosTarget]);
  const nonAiRoute = JSON.parse(await readFile(path.join(nonAiIosTarget, "run", "route.json"), "utf8"));
  assert(nonAiRoute.ai.workloadDetected === false && nonAiRoute.ai.aiProfile === "AI-0", "non-AI iOS route was misclassified or rejected");

  bridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, UASH_BRIDGE_PORT: String(port), UASH_DATA_DIR: dataDir, UASH_HUMAN_APPROVAL_TOKEN: "verify-human-token" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bridgeLog = "";
  bridge.stdout.on("data", (chunk) => (bridgeLog += chunk));
  bridge.stderr.on("data", (chunk) => (bridgeLog += chunk));

  const health = await waitForHealth(port);
  assert(health.ok, "bridge health did not return ok");
  assert(health.contractVersion === "uash.connector-events.v0.5", "bridge contract version mismatch");
  assert(health.proofSchema === "uash.proof.v1" && health.adapterAware && health.humanApprovalTokenConfigured, "bridge hardening metadata missing");
  assert(health.nodeIds.includes("code-intelligence") && health.nodeIds.includes("design-anchors"), "Code Intelligence/design anchor nodes missing from bridge health");

  const appleApprovalRoot = path.join(tempRoot, "apple-approval-root");
  await writeArtifact(appleApprovalRoot, "domain/assurance.json", '{"buildId":"BUILD-A"}\n');
  await postRun(port, { id: "VERIFY-APPLE-APPROVAL-DIGEST", artifactRoot: appleApprovalRoot });
  await postEvent(port, "VERIFY-APPLE-APPROVAL-DIGEST", baseEvent("approval.requested", "redzone", "TestFlight release approval requested", { artifact: "domain/assurance.json", status: "needs_approval", approvalOwner: "release-owner", approvalScope: "testflight-release" }));
  const appleGrant = await postEvent(port, "VERIFY-APPLE-APPROVAL-DIGEST", baseEvent("approval.granted", "redzone", "TestFlight release approved for bound domain packet", { id: "VERIFY-APPLE-GRANT-001", artifact: "domain/assurance.json", actor: "human", approvalOwner: "release-owner", approvalScope: "testflight-release" }), 200, { "x-uash-human-token": "verify-human-token" });
  const boundAppleApproval = appleGrant.run.approvals.find((approval) => approval.eventId === "VERIFY-APPLE-GRANT-001");
  assert(boundAppleApproval?.artifact === "domain/assurance.json" && /^[a-f0-9]{64}$/.test(boundAppleApproval.artifactDigest || ""), "Apple approval did not bind the domain packet digest");
  await writeArtifact(appleApprovalRoot, "domain/assurance.json", '{"buildId":"BUILD-B"}\n');
  const buildBDigest = createHash("sha256").update('{"buildId":"BUILD-B"}\n').digest("hex");
  assert(boundAppleApproval.artifactDigest !== buildBDigest, "Apple release approval digest changed after the approved domain packet was rewritten");

  const nestedEmitter = await run(node, [
    path.join(iosPack, "scripts", "uash-emit-event.mjs"),
    "IOS-ROUTE-VERIFY", "node.entered", "intake", "nested commissioned emitter",
    "--artifact", "run/intake.json", "--status", "ok", "--actor", "codex",
    "--artifact-root", iosTarget, "--adapter-path", ".valdris-harness/project-adapter.json"
  ], { cwd: iosTarget, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}` } });
  assert(nestedEmitter.stdout.includes('"enterpriseFinishLineRequired": true'), "nested emitter did not load the v0.7 adapter policy");
  const implicitNestedEmitter = await run(node, [
    path.join(iosPack, "scripts", "uash-emit-event.mjs"),
    "IOS-IMPLICIT-ADAPTER-VERIFY", "node.entered", "intake", "implicit nested adapter discovery",
    "--artifact", "run/intake.json", "--status", "ok", "--actor", "codex", "--artifact-root", iosTarget
  ], { cwd: iosTarget, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}` } });
  assert(implicitNestedEmitter.stdout.includes('"enterpriseFinishLineRequired": true'), "nested adapter omission bypassed v0.7 finish-line policy");
  await postRun(port, { id: "IOS-PRECREATED-IMPLICIT-ADAPTER" });
  const precreatedImplicitEmitter = await run(node, [
    path.join(iosPack, "scripts", "uash-emit-event.mjs"),
    "IOS-PRECREATED-IMPLICIT-ADAPTER", "node.entered", "intake", "pre-created run implicit nested adapter discovery",
    "--artifact", "run/intake.json", "--status", "ok", "--actor", "codex", "--artifact-root", iosTarget
  ], { cwd: iosTarget, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}` } });
  assert(precreatedImplicitEmitter.stdout.includes('"enterpriseFinishLineRequired": true'), "pre-created run bypassed implicit nested adapter loading");

  await run(node, [
    "scripts/uash-emit-event.mjs",
    "VERIFY-GENERATED-EMITTER",
    "node.entered",
    "intake",
    "generated emitter smoke",
    "--artifact",
    "run/intake.json",
    "--status",
    "ok",
    "--actor",
    "codex",
    "--artifact-root",
    generatedOut,
  ], { cwd: generatedOut, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}` } });

  const missingFields = await postEvent(port, "VERIFY-MISSING-FIELDS", { type: "node.entered", nodeId: "intake" }, 400);
  assert(missingFields.error === "event_contract_violation", "missing fields did not return event_contract_violation");
  assertProblem(missingFields, "event.actor is required", "missing fields");

  const missingMessage = await postEvent(port, "VERIFY-MISSING-MESSAGE", baseEvent("node.entered", "intake", undefined, { message: undefined }), 400);
  assertProblem(missingMessage, "event.message is required", "missing message");

  const unknownEvent = await postEvent(port, "VERIFY-UNKNOWN-EVENT", { type: "made.up", nodeId: "intake", status: "ok", actor: "alien", runMode: "pretend", eventSource: "bogus", message: "bad" }, 400);
  assert(unknownEvent.error === "event_contract_violation", "unknown event did not return event_contract_violation");
  assertProblem(unknownEvent, "unknown event.type", "unknown event");

  const badSkip = await postEvent(port, "VERIFY-BAD-SKIP", baseEvent("node.skipped", "cloud-platform", "bad skip missing reason", { status: "skipped" }), 400);
  assertProblem(badSkip, "node.skipped events must include skipReason", "bad skip");

  const directComplete = await postRun(port, { id: "VERIFY-INJECTED-COMPLETE", status: "complete" }, 409);
  assert(directComplete.error === "run_creation_cannot_complete", "direct complete was not rejected");

  const maliciousComplete = await postRun(port, { id: "VERIFY-MALICIOUS-COMPLETE", status: "complete", artifacts: [{ path: "proof/proof.json", required: false, present: true }] }, 409);
  assert(maliciousComplete.error === "run_creation_cannot_complete", "malicious complete was not rejected");

  const earlyBlocked = await postEvent(port, "VERIFY-EARLY-COMPLETE", baseEvent("run.completed", "handoff", "try to finish too early", { artifact: "handoff/final.md" }), 409);
  assert(earlyBlocked.error === "finish_line_blocked", "event-level early completion was not blocked");
  assertProblem(earlyBlocked, "proof/proof.json", "early completion");

  await postRun(port, { id: "VERIFY-NO-ARTIFACT-ROOT" });
  const noRootArtifact = await postEvent(port, "VERIFY-NO-ARTIFACT-ROOT", baseEvent("artifact.written", "prove", "proof claim without artifactRoot", { artifact: "proof/proof.json" }), 400);
  assert(noRootArtifact.error === "artifact_verification_failed", "artifact write without artifactRoot was not rejected");
  assertProblem(noRootArtifact, "artifactRoot", "no artifactRoot");

  const missingArtifactRoot = path.join(tempRoot, "missing-artifact-root");
  await mkdir(missingArtifactRoot, { recursive: true });
  await postRun(port, { id: "VERIFY-MISSING-FILE", artifactRoot: missingArtifactRoot });
  const missingFile = await postEvent(port, "VERIFY-MISSING-FILE", baseEvent("artifact.written", "prove", "proof claim without file", { artifact: "proof/proof.json" }), 400);
  assert(missingFile.error === "artifact_verification_failed", "missing artifact file was not rejected");

  const symlinkRoot = path.join(tempRoot, "symlink-root");
  await mkdir(path.join(symlinkRoot, "proof"), { recursive: true });
  let symlinkEscapeChecked = false;
  try {
    await symlink("/etc/passwd", path.join(symlinkRoot, "proof", "proof.json"));
    await postRun(port, { id: "VERIFY-SYMLINK-ESCAPE", artifactRoot: symlinkRoot });
    const symlinkBlocked = await postEvent(port, "VERIFY-SYMLINK-ESCAPE", baseEvent("artifact.written", "prove", "symlink proof", { artifact: "proof/proof.json" }), 400);
    assertProblem(symlinkBlocked, "symlink", "symlink escape");
    symlinkEscapeChecked = true;
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "ENOENT") throw error;
  }

  const invalidProductionRoot = path.join(tempRoot, "invalid-production-root");
  await writeArtifact(invalidProductionRoot, "production/layer-assessment.json", JSON.stringify({ layers: 13 }));
  await postRun(port, { id: "VERIFY-BAD-PRODUCTION-LAYERS", artifactRoot: invalidProductionRoot });
  const invalidProduction = await postEvent(port, "VERIFY-BAD-PRODUCTION-LAYERS", baseEvent("artifact.written", "production-readiness", "invalid production assessment", { artifact: "production/layer-assessment.json" }), 400);
  assertProblem(invalidProduction, "production layer", "invalid production assessment");


  const badProofRoot = path.join(tempRoot, "bad-proof-root");
  await writeArtifact(badProofRoot, "proof/proof.json", JSON.stringify({ exitCode: 0 }));
  await postRun(port, { id: "VERIFY-BAD-PROOF", artifactRoot: badProofRoot });
  const badProof = await postEvent(port, "VERIFY-BAD-PROOF", baseEvent("artifact.written", "prove", "legacy fake proof", { artifact: "proof/proof.json" }), 400);
  assertProblem(badProof, "uash.proof.v1", "bad proof schema");

  const failedProofRoot = path.join(tempRoot, "failed-proof-root");
  await writeArtifact(failedProofRoot, "proof/proof.json", failedProofJson("VERIFY-FAILED-PROOF"));
  await postRun(port, { id: "VERIFY-FAILED-PROOF", artifactRoot: failedProofRoot });
  const failedProof = await postEvent(port, "VERIFY-FAILED-PROOF", baseEvent("artifact.written", "prove", "failed proof must not pass", { artifact: "proof/proof.json" }), 400);
  assertProblem(failedProof, "proof.status must be passed", "failed proof status");

  const clientTokenRejected = await postRun(port, { id: "VERIFY-CLIENT-TOKEN-REJECTED", artifactRoot: path.join(tempRoot, "client-token-root"), humanApprovalToken: "agent-chosen-token" }, 400);
  assert(clientTokenRejected.error === "client_supplied_human_token_rejected", "client-supplied human token was not rejected");

  const adapterMissingProofRoot = path.join(tempRoot, "adapter-missing-proof-root");
  await writeArtifact(adapterMissingProofRoot, "project-adapter.json", JSON.stringify({ schema: "uash.project-adapter.v2", runtime: { requiredNodes: ["handoff"], artifactByNode: { handoff: "handoff/final.md" } } }));
  const adapterMissingProof = await postRun(port, { id: "VERIFY-ADAPTER-MISSING-PROOF", artifactRoot: adapterMissingProofRoot, adapterPath: "project-adapter.json" }, 400);
  assertProblem(adapterMissingProof, "cannot remove finish-line", "adapter missing proof invariant");

  const invariantSkipRoot = path.join(tempRoot, "invariant-skip-root");
  await writeArtifact(invariantSkipRoot, "project-adapter.json", JSON.stringify({
    schema: "uash.project-adapter.v2",
    runtime: { requiredNodes: ["prove", "handoff"], artifactByNode: { prove: "proof/proof.json", handoff: "handoff/final.md" } },
    proofSchema: { schema: "uash.proof.v1" },
    humanApproval: { tokenRequiredForGrant: true }
  }));
  await postRun(port, { id: "VERIFY-INVARIANT-SKIP", artifactRoot: invariantSkipRoot, adapterPath: "project-adapter.json" });
  await postEvent(port, "VERIFY-INVARIANT-SKIP", baseEvent("node.skipped", "prove", "attempt to skip proof", { status: "skipped", artifact: "proof/proof.json", skipReason: "agent supplied reason" }));
  await postEvent(port, "VERIFY-INVARIANT-SKIP", baseEvent("node.skipped", "handoff", "attempt to skip handoff", { status: "skipped", artifact: "handoff/final.md", skipReason: "agent supplied reason" }));
  const invariantSkipBlocked = await postEvent(port, "VERIFY-INVARIANT-SKIP", baseEvent("run.completed", "handoff", "must reject skipped invariants", { artifact: "handoff/final.md" }), 409);
  assertProblem(invariantSkipBlocked, "non-skippable finish-line invariant", "skipped proof/handoff invariants");

  const customProofRoot = path.join(tempRoot, "custom-proof-root");
  await writeArtifact(customProofRoot, "project-adapter.json", JSON.stringify({
    schema: "uash.project-adapter.v2",
    runtime: {
      connectorContractVersion: "uash.connector-events.v0.5",
      requiredNodes: ["prove", "handoff"],
      artifactByNode: { prove: "custom/proof.json", handoff: "handoff/final.md" }
    },
    proofSchema: { schema: "uash.proof.v1" },
    humanApproval: { tokenRequiredForGrant: true }
  }));
  await writeArtifact(customProofRoot, "custom/proof.json", JSON.stringify({ exitCode: 0 }));
  await postRun(port, { id: "VERIFY-CUSTOM-PROOF-PATH", artifactRoot: customProofRoot, adapterPath: "project-adapter.json" });
  const proofPathMismatch = await postEvent(port, "VERIFY-CUSTOM-PROOF-PATH", baseEvent("artifact.written", "handoff", "handoff cannot claim custom proof path", { artifact: "custom/proof.json" }), 400);
  assertProblem(proofPathMismatch, "configured artifact path", "custom proof path mismatch");
  const invalidCustomProof = await postEvent(port, "VERIFY-CUSTOM-PROOF-PATH", baseEvent("artifact.written", "prove", "invalid custom proof", { artifact: "custom/proof.json" }), 400);
  assertProblem(invalidCustomProof, "uash.proof.v1", "custom proof validation");
  await writeArtifact(customProofRoot, "custom/proof.json", proofJson("VERIFY-CUSTOM-PROOF-PATH"));
  await postEvent(port, "VERIFY-CUSTOM-PROOF-PATH", baseEvent("artifact.written", "prove", "valid custom proof", { artifact: "custom/proof.json" }), 200);
  await writeArtifact(customProofRoot, "handoff/final.md", "# Custom proof handoff\n\nComplete.\n");
  await postEvent(port, "VERIFY-CUSTOM-PROOF-PATH", baseEvent("artifact.written", "handoff", "custom proof handoff", { artifact: "handoff/final.md" }), 200);
  const customProofComplete = await postEvent(port, "VERIFY-CUSTOM-PROOF-PATH", baseEvent("run.completed", "handoff", "custom proof path completion", { artifact: "handoff/final.md" }), 200);
  assert(customProofComplete.run.status === "complete", "valid adapter custom proof path did not complete");

  const unsafeAdapterPath = path.join(tempRoot, "outside-project-adapter.json");
  await writeFile(unsafeAdapterPath, JSON.stringify({ schema: "uash.project-adapter.v2", runtime: { requiredNodes: ["intake", "prove", "handoff"] } }), "utf8");
  const adapterEscapeRoot = path.join(tempRoot, "adapter-escape-root");
  await mkdir(adapterEscapeRoot, { recursive: true });
  const adapterEscape = await postRun(port, { id: "VERIFY-ADAPTER-ESCAPE", artifactRoot: adapterEscapeRoot, adapterPath: unsafeAdapterPath }, 400);
  assert(adapterEscape.error === "adapter_policy_violation", "unsafe adapter path was not rejected");

  const adapterAwareRunId = "VERIFY-ADAPTER-AWARE";
  const adapterAwareRoot = path.join(tempRoot, adapterAwareRunId);
  await writeArtifact(adapterAwareRoot, "project-adapter.json", JSON.stringify({
    schema: "uash.project-adapter.v2",
    generatorVersion: packageJson.version,
    runtime: {
      connectorContractVersion: "uash.connector-events.v0.5",
      requiredNodes: ["intake", "prove", "handoff"],
      artifactByNode: {
        intake: "run/intake.json",
        prove: "proof/proof.json",
        handoff: "handoff/final.md"
      }
    },
    proofSchema: { schema: "uash.proof.v1" },
    humanApproval: { tokenRequiredForGrant: true }
  }));
  const adapterAwareCreated = await postRun(port, { id: adapterAwareRunId, artifactRoot: adapterAwareRoot, adapterPath: "project-adapter.json" });
  assert(adapterAwareCreated.adapterPolicy?.requiredNodes?.length === 3, "adapter-aware required node policy was not loaded");
  await writeArtifact(adapterAwareRoot, "run/intake.json", JSON.stringify({ ok: true }));
  await postEvent(port, adapterAwareRunId, baseEvent("artifact.written", "intake", "adapter-aware intake", { artifact: "run/intake.json", actor: "codex" }));
  await writeArtifact(adapterAwareRoot, "proof/proof.json", proofJson(adapterAwareRunId));
  await postEvent(port, adapterAwareRunId, baseEvent("artifact.written", "prove", "adapter-aware proof", { artifact: "proof/proof.json", actor: "harness" }));
  await writeArtifact(adapterAwareRoot, "handoff/final.md", "# Adapter-aware handoff\n\nComplete.\n");
  await postEvent(port, adapterAwareRunId, baseEvent("artifact.written", "handoff", "adapter-aware handoff", { artifact: "handoff/final.md", actor: "harness" }));
  const adapterAwareComplete = await postEvent(port, adapterAwareRunId, baseEvent("run.completed", "handoff", "adapter-aware completion", { artifact: "handoff/final.md", actor: "harness" }), 200);
  assert(adapterAwareComplete.run.status === "complete", "adapter-aware reduced required-node completion failed");
  assert(adapterAwareComplete.run.artifacts.find((artifact) => artifact.nodeId === "route")?.required === false, "adapter policy did not make route optional");

  const v07MissingRunId = "VERIFY-V07-MISSING-ASSURANCE";
  const v07MissingRoot = path.join(tempRoot, v07MissingRunId);
  await writeArtifact(v07MissingRoot, "project-adapter.json", JSON.stringify({
    schema: "uash.project-adapter.v2",
    generatorVersion: "0.7.0",
    runtime: { requiredNodes: ["prove", "handoff"], artifactByNode: { prove: "proof/proof.json", handoff: "handoff/final.md" } },
    proofSchema: { schema: "uash.proof.v1" },
    productionReadiness: { schema: "uash.production-readiness.v2" },
    finishLineAssurance: { required: true },
    humanApproval: { tokenRequiredForGrant: true }
  }));
  await postRun(port, { id: v07MissingRunId, artifactRoot: v07MissingRoot, adapterPath: "project-adapter.json" });
  await writeArtifact(v07MissingRoot, "proof/proof.json", proofJson(v07MissingRunId));
  await postEvent(port, v07MissingRunId, baseEvent("artifact.written", "prove", "v0.7 proof", { artifact: "proof/proof.json", actor: "harness" }));
  await writeArtifact(v07MissingRoot, "handoff/final.md", "# v0.7 missing assurance handoff\n");
  await postEvent(port, v07MissingRunId, baseEvent("artifact.written", "handoff", "v0.7 handoff", { artifact: "handoff/final.md", actor: "harness" }));
  const v07MissingBlocked = await postEvent(port, v07MissingRunId, baseEvent("run.completed", "handoff", "must reject missing v0.7 assurance", { artifact: "handoff/final.md", actor: "harness" }), 409);
  assertProblem(v07MissingBlocked, "v0.7 enterprise/AI finish line failed", "v0.7 bridge finish-line enforcement");

  const v07PassRunId = "VERIFY-001";
  const v07PassRoot = path.join(tempRoot, "v07-pass-root");
  await run(node, ["scripts/verify-enterprise-ai.mjs", "--write-fixture", v07PassRoot]);
  await writeArtifact(v07PassRoot, "project-adapter.json", JSON.stringify({
    schema: "uash.project-adapter.v2",
    generatorVersion: "0.7.0",
    runtime: { requiredNodes: ["prove", "handoff"], artifactByNode: { prove: "proof/proof.json", handoff: "handoff/final.md" } },
    proofSchema: { schema: "uash.proof.v1" },
    productionReadiness: { schema: "uash.production-readiness.v2" },
    finishLineAssurance: { required: true },
    humanApproval: { tokenRequiredForGrant: true }
  }));
  await postRun(port, { id: v07PassRunId, artifactRoot: v07PassRoot, adapterPath: "project-adapter.json" });
  await postEvent(port, v07PassRunId, baseEvent("approval.requested", "route", "human route review required", { status: "needs_approval", artifact: "run/route.json", approvalOwner: "verification-owner", approvalScope: "route" }));
  await postEvent(port, v07PassRunId, baseEvent("approval.granted", "route", "human approved the bound route", { actor: "human", artifact: "run/route.json", approvalOwner: "verification-owner", approvalScope: "route" }), 200, { "x-uash-human-token": "verify-human-token" });
  await writeArtifact(v07PassRoot, "proof/proof.json", proofJson(v07PassRunId));
  await postEvent(port, v07PassRunId, baseEvent("artifact.written", "prove", "v0.7 passing proof", { artifact: "proof/proof.json", actor: "harness" }));
  await writeArtifact(v07PassRoot, "handoff/final.md", "# v0.7 passing handoff\n");
  await postEvent(port, v07PassRunId, baseEvent("artifact.written", "handoff", "v0.7 passing handoff", { artifact: "handoff/final.md", actor: "harness" }));
  const v07PassComplete = await postEvent(port, v07PassRunId, baseEvent("run.completed", "handoff", "v0.7 aggregate finish line passed", { artifact: "handoff/final.md", actor: "harness" }), 200);
  assert(v07PassComplete.run.status === "complete", "v0.7 aggregate bridge finish line did not complete");

  const redzoneRunId = "VERIFY-REDZONE-NO-GRANT";
  const redzoneRoot = path.join(tempRoot, redzoneRunId);
  const redzoneCreated = await postRun(port, { id: redzoneRunId, artifactRoot: redzoneRoot });
  await satisfyCoreArtifacts(port, redzoneRunId, redzoneRoot, { leaveRedzoneOpen: true });
  await postEvent(port, redzoneRunId, baseEvent("approval.requested", "redzone", "red zone approval requested", { status: "needs_approval", approvalOwner: "Nick", approvalScope: "redzone" }));
  const agentGrant = await postEvent(port, redzoneRunId, baseEvent("approval.granted", "redzone", "agent tried to grant red zone", { actor: "codex", approvalOwner: "Nick", approvalScope: "redzone" }), 400);
  assertProblem(agentGrant, "actor human", "agent grant");
  const humanGrantNoToken = await postEvent(port, redzoneRunId, baseEvent("approval.granted", "redzone", "human grant missing token", { actor: "human", approvalOwner: "Nick", approvalScope: "redzone" }), 409);
  assertProblem(humanGrantNoToken, "human approval token", "human grant no token");
  const redzoneBlocked = await postEvent(port, redzoneRunId, baseEvent("run.completed", "handoff", "try completion without approval", { artifact: "handoff/final.md" }), 409);
  assertProblem(redzoneBlocked, "approval pending", "redzone completion");

  const grantNoPending = await postEvent(port, "VERIFY-GRANT-NO-PENDING", baseEvent("approval.granted", "redzone", "human grant without request", { actor: "human", approvalOwner: "Nick", approvalScope: "redzone" }), 409, { "x-uash-human-token": "verify-human-token" });
  assert(grantNoPending.error === "event_state_violation", "grant without pending approval did not return state violation");


  const tokenRunId = "VERIFY-HUMAN-TOKEN-GRANT";
  const tokenRoot = path.join(tempRoot, tokenRunId);
  const tokenCreated = await postRun(port, { id: tokenRunId, artifactRoot: tokenRoot });
  assert(!Object.prototype.hasOwnProperty.call(tokenCreated, "humanApprovalToken"), "POST /runs leaked a raw human approval token");
  assert(!Object.prototype.hasOwnProperty.call(tokenCreated, "auth"), "POST /runs leaked human approval auth metadata");
  await postEvent(port, tokenRunId, baseEvent("approval.requested", "redzone", "token-gated approval requested", { status: "needs_approval", approvalOwner: "Nick", approvalScope: "redzone" }));
  await postEvent(port, tokenRunId, baseEvent("approval.granted", "redzone", "token-gated human grant", { actor: "human", approvalOwner: "Nick", approvalScope: "redzone" }), 200, { "x-uash-human-token": "verify-human-token" });
  const tokenRunFromHttp = await (await fetch(`http://127.0.0.1:${port}/runs/${encodeURIComponent(tokenRunId)}`)).json();
  assert(!Object.prototype.hasOwnProperty.call(tokenRunFromHttp, "auth"), "GET /runs/:id leaked human approval auth metadata");
  const tokenEventsJsonl = await readFile(path.join(dataDir, tokenRunId, "events.jsonl"), "utf8");
  const tokenRunJson = await readFile(path.join(dataDir, tokenRunId, "run.json"), "utf8");
  assert(!tokenEventsJsonl.includes("verify-human-token"), "human token leaked to events.jsonl");
  assert(!tokenRunJson.includes("verify-human-token"), "human token leaked to run.json");

  const selfHealRunId = "VERIFY-SELF-HEAL-NO-PR";
  const selfHealRoot = path.join(tempRoot, selfHealRunId);
  await postRun(port, { id: selfHealRunId, artifactRoot: selfHealRoot });
  await satisfyCoreArtifacts(port, selfHealRunId, selfHealRoot, { leaveSelfHealOpen: true });
  await writeArtifact(selfHealRoot, "self_heal/self_heal_report.md", "# Gap\n\nDetected.\n");
  await postEvent(port, selfHealRunId, baseEvent("artifact.written", "self-heal", "self-heal report", { artifact: "self_heal/self_heal_report.md" }));
  await postEvent(port, selfHealRunId, baseEvent("self_heal.detected", "self-heal", "harness gap detected"));
  await postEvent(port, selfHealRunId, baseEvent("node.skipped", "self-heal", "self-heal skip after detection should not resolve", { status: "skipped", artifact: "self_heal/self_heal_report.md", skipReason: "PR not opened" }));
  const selfHealBlocked = await postEvent(port, selfHealRunId, baseEvent("run.completed", "handoff", "try completion without self-heal PR", { artifact: "handoff/final.md" }), 409);
  assertProblem(selfHealBlocked, "self-heal detected", "self-heal completion");

  const fakeSelfHealRunId = "VERIFY-SELF-HEAL-FAKE-PR";
  const fakeSelfHealRoot = path.join(tempRoot, fakeSelfHealRunId);
  await postRun(port, { id: fakeSelfHealRunId, artifactRoot: fakeSelfHealRoot });
  await satisfyCoreArtifacts(port, fakeSelfHealRunId, fakeSelfHealRoot, { leaveSelfHealOpen: true });
  await writeArtifact(fakeSelfHealRoot, "self_heal/self_heal_report.md", "# Gap\n\nDetected.\n");
  await postEvent(port, fakeSelfHealRunId, baseEvent("artifact.written", "self-heal", "self-heal report", { artifact: "self_heal/self_heal_report.md" }));
  await postEvent(port, fakeSelfHealRunId, baseEvent("self_heal.detected", "self-heal", "harness gap detected"));
  const fakeSelfHealPr = await postEvent(port, fakeSelfHealRunId, baseEvent("self_heal.pr_proposed", "self-heal", "fake self-heal proposal", { selfHealPrUrl: "file://missing-self-heal-pr.json" }), 409);
  assertProblem(fakeSelfHealPr, "self-heal", "fake self-heal proposal");

  const artifactRootPoisonRunId = "VERIFY-ARTIFACT-ROOT-POISON";
  const artifactRootOne = path.join(tempRoot, "artifact-root-one");
  const artifactRootTwo = path.join(tempRoot, "artifact-root-two");
  await postRun(port, { id: artifactRootPoisonRunId, artifactRoot: artifactRootOne });
  const rootPoison = await postEvent(port, artifactRootPoisonRunId, baseEvent("node.entered", "route", "attempt to replace artifact root", { artifactRoot: artifactRootTwo }), 409);
  assertProblem(rootPoison, "artifactRoot", "artifact root poison");

  const runId = `VERIFY-PASS-${Date.now()}`;
  const artifactRoot = path.join(tempRoot, runId);
  await postRun(port, { id: runId, artifactRoot, title: "Verification pass", task: "Verify hardened harness contract" });
  await satisfyCoreArtifacts(port, runId, artifactRoot);
  const finalBody = await postEvent(port, runId, baseEvent("run.completed", "handoff", "finish line passed with verified artifacts and skip reasons", { artifact: "handoff/final.md" }), 200);
  assert(finalBody.run.status === "complete", "verified run did not complete");
  assert(finalBody.run.events.some((event) => event.actor === "codex"), "Codex actor event missing from verified run");
  const proofArtifact = finalBody.run.artifacts.find((artifact) => artifact.path === "proof/proof.json");
  assert(proofArtifact?.verification?.checked && proofArtifact.verification.exists && proofArtifact.verification.proof?.valid === true, "proof artifact was not file-verified and passing");

  const eventsJsonl = await readFile(path.join(dataDir, runId, "events.jsonl"), "utf8");
  assert(eventsJsonl.includes("run.completed"), "events.jsonl missing run.completed");

  console.log("Valdris SDLC Harness verification passed");
  console.log(
    JSON.stringify(
      {
        commissioningQuestionGroups: questionGroups.length,
        commissioningQuestions: questionGroups.reduce((count, group) => count + group.questions.length, 0),
        generatedFrontDoors: ["AGENTS.md", "CLAUDE.md", ".agents/skills", ".claude/skills", ".claude/commands/valdris-sdlc-harness.md", "docs/Codex Runtime Prompt.md", "knowledge/index.md", "controls/", "scripts/enterprise-ai-gate-all.mjs", ".github/workflows/valdris-assurance.yml"],
        adapterSchema: adapter.schema,
        generatorVersion: adapter.generatorVersion,
        foundationBlueprint: true,
        codeQualityGuardrails: true,
        enterpriseProofBank: true,
        operatingIntelligence: true,
        iosRepositoryDetection: true,
        iosAiRequestRouting: true,
        goalRevisionConflictBlocked: true,
        productionLayers: adapter.productionReadiness.layers.length,
        productionLayerGate: true,
        knowledgeVault: true,
        okfVaultGate: true,
        bridgeHealth: health.service,
        bridgeContractVersion: health.contractVersion,
        codeIntelligenceFlowNode: true,
        gitnexusPrimaryProvider: true,
        codeIntelligenceScanScript: true,
        codeIntelligenceGeneratedScripts: true,
        codeIntelligenceGateSmoke: true,
        generatedEmitterSmoke: true,
        proofSchemaValidation: true,
        failedProofBlocked: true,
        adapterInvariantProofRequired: true,
        adapterCustomProofPathValidated: true,
        adapterAwareBridge: true,
        v07EnterpriseFinishLineBlockedMissingAssurance: true,
        v07EnterpriseFinishLinePassedCompletePacket: true,
        humanApprovalTokenGate: true,
        humanApprovalTokenNotReturnedByHttp: true,
        clientSuppliedHumanTokenRejected: true,
        ciWorkflow: true,
        strictEventValidation: true,
        artifactRootRequired: true,
        artifactFileVerification: true,
        symlinkEscapeBlocked: symlinkEscapeChecked,
        symlinkEscapeSkippedByPlatform: !symlinkEscapeChecked,
        productionLayerAssessmentValidation: true,
        redZoneCompletionBlocked: true,
        agentApprovalGrantBlocked: true,
        selfHealCompletionBlocked: true,
        fakeSelfHealPrBlocked: true,
        artifactRootMutationBlocked: true,
        selfHealSkipAfterDetectionBlocked: true,
        directCompletionInjectionBlocked: true,
        earlyCompletionBlocked: true,
        verifiedRun: runId,
        eventCount: finalBody.run.events.length,
      },
      null,
      2,
    ),
  );
} finally {
  await stopProcess(bridge);
  await rm(tempRoot, { recursive: true, force: true });
}
