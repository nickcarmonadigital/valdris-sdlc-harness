#!/usr/bin/env node
import { spawn } from "node:child_process";
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

async function postJson(url, body, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

async function postEvent(port, runId, event, expectedStatus = 200) {
  return postJson(`http://127.0.0.1:${port}/runs/${encodeURIComponent(runId)}/events`, event, expectedStatus);
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

async function satisfyCoreArtifacts(port, runId, artifactRoot, options = {}) {
  await writeArtifact(artifactRoot, "run/intake.json", JSON.stringify({ ok: true }));
  await postEvent(port, runId, baseEvent("artifact.written", "intake", "intake artifact", { artifact: "run/intake.json", actor: "codex" }));
  await writeArtifact(artifactRoot, "run/route.json", JSON.stringify({ lane: "verification" }));
  await postEvent(port, runId, baseEvent("artifact.written", "route", "route artifact", { artifact: "run/route.json", actor: "codex" }));
  await writeArtifact(artifactRoot, "graph/graph.json", JSON.stringify({ schema: "uash.graphify.compat.v0.1", nodes: [{ path: "package.json" }], edges: [], graphifyCompatible: true }));
  await postEvent(port, runId, baseEvent("artifact.written", "graphify", "graphify/code graph artifact", { artifact: "graph/graph.json", actor: "codex" }));
  await writeArtifact(artifactRoot, "graph/freshness.json", JSON.stringify({ schema: "uash.graph-freshness.v0.1", graphPath: "graph/graph.json" }));
  await writeArtifact(artifactRoot, "design/anchors.json", JSON.stringify({ schema: "uash.design-anchors.v0.1", anchors: [{ path: "run/route.json", reason: "verification anchor" }] }));
  await postEvent(port, runId, baseEvent("artifact.written", "design-anchors", "design anchors artifact", { artifact: "design/anchors.json", actor: "codex" }));
  await postEvent(port, runId, baseEvent("node.skipped", "system-design", "system design skipped", { status: "skipped", skipReason: "No architecture/API/data-model decision in this verification run" }));
  await writeArtifact(artifactRoot, "production/layer-assessment.json", JSON.stringify({ layers: 13 }));
  await postEvent(port, runId, baseEvent("artifact.written", "production-readiness", "production layer artifact", { artifact: "production/layer-assessment.json", actor: "codex" }));
  await postEvent(port, runId, baseEvent("node.skipped", "cloud-platform", "cloud skipped", { status: "skipped", artifact: "cloud/skip.json", skipReason: "No cloud/IAM/deploy/provider change in this verification run" }));
  await writeArtifact(artifactRoot, "session/events.jsonl", "{\"event\":\"implementation-proof\"}\n");
  await postEvent(port, runId, baseEvent("artifact.written", "implement", "implementation event ledger", { artifact: "session/events.jsonl", actor: "codex" }));
  if (!options.leaveRedzoneOpen) {
    await postEvent(port, runId, baseEvent("node.skipped", "redzone", "red zone skipped", { status: "skipped", artifact: "approvals/redzone.json", skipReason: "No production/secrets/billing/auth/data/destructive action" }));
  }
  await postEvent(port, runId, baseEvent("node.skipped", "qa-break-it", "break-it QA skipped", { status: "skipped", artifact: "qa/break-it-results.md", skipReason: "Verification checks connector contract only; no product behavior changed" }));
  await writeArtifact(artifactRoot, "proof/proof.json", JSON.stringify({ commands: ["verify:harness"], exitCode: 0 }));
  await postEvent(port, runId, baseEvent("artifact.written", "prove", "proof artifact", { artifact: "proof/proof.json" }));
  await postEvent(port, runId, baseEvent("node.skipped", "live-smoke", "live smoke skipped", { status: "skipped", artifact: "smoke/skip.json", skipReason: "No deployed/provider/runtime behavior changed" }));
  if (!options.leaveSelfHealOpen) {
    await postEvent(port, runId, baseEvent("node.skipped", "self-heal", "self-heal skipped", { status: "skipped", artifact: "self_heal/self_heal_report.md", skipReason: "No harness gap detected by this verification run" }));
  }
  await writeArtifact(artifactRoot, "handoff/final.md", "# Final handoff\n\nVerification complete.\n");
  await postEvent(port, runId, baseEvent("artifact.written", "handoff", "handoff artifact", { artifact: "handoff/final.md" }));
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "valdris-harness-verify-"));
const generatedOut = path.join(tempRoot, "commissioned");
const pyTarget = path.join(tempRoot, "pyproject-only");
const pyPack = path.join(tempRoot, "py-pack");
const dataDir = path.join(tempRoot, "runs");
const port = 18000 + Math.floor(Math.random() * 20000);
let bridge;

try {
  const questions = await run(node, ["scripts/commission-harness.mjs", "--print-questions"]);
  const questionGroups = JSON.parse(questions.stdout);
  assert(questionGroups.length >= 30, `expected at least 30 commissioning groups, got ${questionGroups.length}`);

  await run(node, ["scripts/commission-harness.mjs", "--repo", ".", "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes"]);

  const adapter = JSON.parse(await readFile(path.join(generatedOut, "project-adapter.json"), "utf8"));
  assert(adapter.schema === "uash.project-adapter.v2", "adapter schema mismatch");
  assert(adapter.generatorVersion === "0.5.1", "generator version mismatch");
  assert(adapter.commissioning?.questionGroups >= 30, "expanded commissioning group count missing");
  assert(adapter.commissioning?.questionCount >= 150, "expanded commissioning question count missing");
  assert(adapter.codeGraph?.requiredArtifacts?.includes("graph/graph.json"), "code graph adapter missing stable graph artifact");
  assert(adapter.codeGraph?.primaryProvider === "GitNexus", "GitNexus primary code-intelligence provider missing");
  assert(adapter.codeGraph?.preferredArtifacts?.includes("graph/gitnexus.json"), "GitNexus evidence artifact missing from adapter");
  assert(adapter.codeGraph?.scanCommand?.includes("code-intelligence-scan.mjs"), "code-intelligence scan command missing");
  assert(adapter.codeGraph?.license === "PolyForm-Noncommercial-1.0.0", "GitNexus license boundary missing");
  assert(adapter.productionReadiness.layers.length === 13, "production readiness layer count mismatch");
  assert(adapter.telemetryModes.modes.includes("live"), "live telemetry mode missing");
  assert(adapter.nodeStateContract.skippedRequiresReason, "skip-reason rule missing");
  assert(adapter.nodeStateContract.failedRequiresRecoveryPath, "failure recovery rule missing");
  assert(adapter.foundationBlueprint?.badFoundationSignals?.length > 0, "foundation blueprint missing");
  assert(adapter.codeQualityGuardrails?.antiSpaghettiRules?.length > 0, "code quality guardrails missing");
  assert(adapter.enterpriseProofBank?.domainPack, "enterprise proof bank missing");
  assert(adapter.operatingIntelligence?.evalGate?.artifacts?.includes("evals/eval-plan.json"), "eval gate commissioning missing");
  assert(adapter.operatingIntelligence?.trajectoryGate?.artifacts?.includes("trajectory/trace.jsonl"), "trajectory gate commissioning missing");
  assert(adapter.operatingIntelligence?.contextManifest?.artifacts?.includes("context/manifest.yaml"), "context manifest commissioning missing");
  assert(adapter.operatingIntelligence?.skillRegistry?.artifacts?.some((artifact) => artifact.includes("skills/registry.yaml")), "skill registry commissioning missing");
  assert(adapter.operatingIntelligence?.modelRouting?.qualityGate, "model routing commissioning missing");
  assert(adapter.operatingIntelligence?.aiEconomics?.costHandoff, "AI economics commissioning missing");
  assert(adapter.operatingIntelligence?.interop?.mcpTools?.includes("uash.start_run"), "MCP commissioning missing");
  assert(adapter.teamHarnessRegistry?.harnessOwner, "team harness registry missing");
  assert(adapter.humanAgentProtocol?.approvalContract, "human-agent protocol missing");
  await readFile(path.join(generatedOut, "AGENTS.md"), "utf8");
  await readFile(path.join(generatedOut, "CLAUDE.md"), "utf8");
  await readFile(path.join(generatedOut, ".claude", "commands", "valdris-sdlc-harness.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Codex Runtime Prompt.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Graphify Code Graph.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "GitNexus Code Intelligence.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Good Looks Like Foundation.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Code Quality Guardrails.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Enterprise Proof Bank.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Operating Intelligence Layer.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Team Harness Registry.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Human Agent Protocol.md"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "uash-emit-event.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "code-intelligence-scan.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "graphify-scan.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "graphify-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "anchor-gate.mjs"), "utf8");

  const rootEnterpriseProofBank = await readFile(path.join(root, "docs", "ENTERPRISE_PROOF_BANK.md"), "utf8");
  const rootOperatingIntelligence = await readFile(path.join(root, "docs", "OPERATING_INTELLIGENCE_LAYER.md"), "utf8");
  const rootTestDayGates = await readFile(path.join(root, "docs", "TEST_DAY_ACCEPTANCE_GATES.md"), "utf8");
  assert(rootEnterpriseProofBank.includes("Scale / concurrency") && rootEnterpriseProofBank.includes("Domain packs"), "enterprise proof bank root doc missing core sections");
  assert(rootOperatingIntelligence.includes("Trajectory evaluation") && rootOperatingIntelligence.includes("AI economics"), "operating intelligence root doc missing paper-gap patterns");
  assert(rootTestDayGates.includes("30 groups / 150 questions") && rootTestDayGates.includes("main updated"), "test-day acceptance gates doc missing update criteria");

  const claudeTemplate = await readFile(path.join(root, "templates", "claude-code", "commands", "valdris-sdlc-harness.md"), "utf8");
  const codexTemplate = await readFile(path.join(root, "templates", "codex", "valdris-sdlc-harness.md"), "utf8");
  assert(claudeTemplate.includes("code-intelligence-scan.mjs") && claudeTemplate.includes("GitNexus/code-intelligence"), "Claude template missing GitNexus/code-intelligence flow");
  assert(codexTemplate.includes("code-intelligence-scan.mjs") && codexTemplate.includes("Good Looks Like Foundation"), "Codex template missing GitNexus/foundation flow");

  const claudeConnectorDoc = await readFile(path.join(root, "docs", "CLAUDE_CODE_CONNECTOR.md"), "utf8");
  const codexConnectorDoc = await readFile(path.join(root, "docs", "CODEX_CONNECTOR.md"), "utf8");
  assert(claudeConnectorDoc.startsWith("# Claude Code Connector v0.4"), "Claude connector doc version drift");
  assert(codexConnectorDoc.startsWith("# Codex Connector v0.4"), "Codex connector doc version drift");
  await run(node, ["scripts/code-intelligence-scan.mjs", "--repo", ".", "--provider", "local"], { cwd: generatedOut });
  await run(node, ["scripts/graphify-gate.mjs", "--repo", ".", "--allow-stale"], { cwd: generatedOut });
  await run(node, ["scripts/anchor-gate.mjs", "--repo", "."], { cwd: generatedOut });

  await mkdir(pyTarget, { recursive: true });
  await writeFile(path.join(pyTarget, "pyproject.toml"), "[project]\nname = \"sample\"\nversion = \"0.0.1\"\n", "utf8");
  await run(node, ["scripts/commission-harness.mjs", "--repo", pyTarget, "--project-name", "PyProject Only", "--out", pyPack, "--yes"]);
  const pyAdapter = JSON.parse(await readFile(path.join(pyPack, "project-adapter.json"), "utf8"));
  assert(!String(pyAdapter.validation.install).includes("requirements.txt"), "pyproject-only install command should not reference requirements.txt");

  bridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, UASH_BRIDGE_PORT: String(port), UASH_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bridgeLog = "";
  bridge.stdout.on("data", (chunk) => (bridgeLog += chunk));
  bridge.stderr.on("data", (chunk) => (bridgeLog += chunk));

  const health = await waitForHealth(port);
  assert(health.ok, "bridge health did not return ok");
  assert(health.contractVersion === "uash.connector-events.v0.4", "bridge contract version mismatch");
  assert(health.nodeIds.includes("graphify") && health.nodeIds.includes("design-anchors"), "Graphify/design anchor nodes missing from bridge health");

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
  await symlink("/etc/passwd", path.join(symlinkRoot, "proof", "proof.json"));
  await postRun(port, { id: "VERIFY-SYMLINK-ESCAPE", artifactRoot: symlinkRoot });
  const symlinkBlocked = await postEvent(port, "VERIFY-SYMLINK-ESCAPE", baseEvent("artifact.written", "prove", "symlink proof", { artifact: "proof/proof.json" }), 400);
  assertProblem(symlinkBlocked, "symlink", "symlink escape");

  const redzoneRunId = "VERIFY-REDZONE-NO-GRANT";
  const redzoneRoot = path.join(tempRoot, redzoneRunId);
  await postRun(port, { id: redzoneRunId, artifactRoot: redzoneRoot });
  await satisfyCoreArtifacts(port, redzoneRunId, redzoneRoot, { leaveRedzoneOpen: true });
  await postEvent(port, redzoneRunId, baseEvent("approval.requested", "redzone", "red zone approval requested", { status: "needs_approval", approvalOwner: "Nick", approvalScope: "redzone" }));
  const agentGrant = await postEvent(port, redzoneRunId, baseEvent("approval.granted", "redzone", "agent tried to grant red zone", { actor: "codex", approvalOwner: "Nick", approvalScope: "redzone" }), 400);
  assertProblem(agentGrant, "actor human", "agent grant");
  const redzoneBlocked = await postEvent(port, redzoneRunId, baseEvent("run.completed", "handoff", "try completion without approval", { artifact: "handoff/final.md" }), 409);
  assertProblem(redzoneBlocked, "approval pending", "redzone completion");

  const grantNoPending = await postEvent(port, "VERIFY-GRANT-NO-PENDING", baseEvent("approval.granted", "redzone", "human grant without request", { actor: "human", approvalOwner: "Nick", approvalScope: "redzone" }), 409);
  assert(grantNoPending.error === "event_state_violation", "grant without pending approval did not return state violation");

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

  const runId = `VERIFY-PASS-${Date.now()}`;
  const artifactRoot = path.join(tempRoot, runId);
  await postRun(port, { id: runId, artifactRoot, title: "Verification pass", task: "Verify hardened harness contract" });
  await satisfyCoreArtifacts(port, runId, artifactRoot);
  const finalBody = await postEvent(port, runId, baseEvent("run.completed", "handoff", "finish line passed with verified artifacts and skip reasons", { artifact: "handoff/final.md" }), 200);
  assert(finalBody.run.status === "complete", "verified run did not complete");
  assert(finalBody.run.events.some((event) => event.actor === "codex"), "Codex actor event missing from verified run");
  const proofArtifact = finalBody.run.artifacts.find((artifact) => artifact.path === "proof/proof.json");
  assert(proofArtifact?.verification?.checked && proofArtifact.verification.exists, "proof artifact was not file-verified");

  const eventsJsonl = await readFile(path.join(dataDir, runId, "events.jsonl"), "utf8");
  assert(eventsJsonl.includes("run.completed"), "events.jsonl missing run.completed");

  console.log("Valdris SDLC Harness verification passed");
  console.log(
    JSON.stringify(
      {
        commissioningQuestionGroups: questionGroups.length,
        commissioningQuestions: questionGroups.reduce((count, group) => count + group.questions.length, 0),
        generatedFrontDoors: ["AGENTS.md", "CLAUDE.md", ".claude/commands/valdris-sdlc-harness.md", "docs/Codex Runtime Prompt.md", "docs/Graphify Code Graph.md", "docs/GitNexus Code Intelligence.md", "docs/Good Looks Like Foundation.md", "docs/Code Quality Guardrails.md", "docs/Enterprise Proof Bank.md", "docs/Operating Intelligence Layer.md", "docs/Team Harness Registry.md", "docs/Human Agent Protocol.md", "scripts/uash-emit-event.mjs", "scripts/code-intelligence-scan.mjs", "scripts/graphify-scan.mjs"],
        adapterSchema: adapter.schema,
        generatorVersion: adapter.generatorVersion,
        foundationBlueprint: true,
        codeQualityGuardrails: true,
        enterpriseProofBank: true,
        operatingIntelligence: true,
        productionLayers: adapter.productionReadiness.layers.length,
        bridgeHealth: health.service,
        bridgeContractVersion: health.contractVersion,
        graphifyFlowNode: true,
        gitnexusPrimaryProvider: true,
        codeIntelligenceScanScript: true,
        graphifyGeneratedScripts: true,
        graphifyGateSmoke: true,
        generatedEmitterSmoke: true,
        strictEventValidation: true,
        artifactRootRequired: true,
        artifactFileVerification: true,
        symlinkEscapeBlocked: true,
        redZoneCompletionBlocked: true,
        agentApprovalGrantBlocked: true,
        selfHealCompletionBlocked: true,
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
