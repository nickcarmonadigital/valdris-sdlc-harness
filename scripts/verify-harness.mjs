#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finishLineChildEnv } from "./bridge-security.mjs";
import { installRootDiscoveryLoaders, planRootDiscoveryLoader } from "./commission-harness.mjs";
import { reviewTrustStoreSha256 } from "./review-gate.mjs";

const root = process.cwd();
const node = process.execPath;
const VERIFY_BRIDGE_ACCESS_TOKEN = "verify-bridge-access-token-32-bytes-minimum";
const VERIFY_BRIDGE_INTEGRITY_KEY = "verify-bridge-integrity-key-32-bytes-minimum";
const VERIFY_HUMAN_APPROVAL_TOKEN = "verify-human-approval-token-32-bytes-minimum";
const VERIFY_REVIEW_TRUST_SHA256 = reviewTrustStoreSha256(JSON.parse(readFileSync(path.join(root, "controls", "review-trust.v1.json"), "utf8")));
process.env.UASH_REVIEW_TRUST_SHA256 = VERIFY_REVIEW_TRUST_SHA256;
const SAFE_VERIFIER_ENV_NAMES = new Set([
  "APPDATA", "ComSpec", "HOME", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL", "LOCALAPPDATA", "PATH", "PATHEXT",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SHELL", "SystemDrive", "SystemRoot", "TEMP", "TERM",
  "TMP", "TMPDIR", "USERPROFILE", "WINDIR",
].map((name) => name.toLowerCase()));

function cleanVerifierEnv(overrides = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (SAFE_VERIFIER_ENV_NAMES.has(name.toLowerCase()) && typeof value === "string") env[name] = value;
  }
  return { ...env, ...overrides };
}

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
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitForExit(child, timeoutMs = 4000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exited: true, code: child.exitCode };
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ exited: false, code: null }), timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code });
    });
  });
}

async function postJson(url, body, expectedStatus = 200, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-uash-bridge-token": VERIFY_BRIDGE_ACCESS_TOKEN, ...headers },
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

function bridgeFetch(port, pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: { "x-uash-bridge-token": VERIFY_BRIDGE_ACCESS_TOKEN, ...(options.headers || {}) },
  });
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

function assertNoHumanApprovalSecretArgv(label, source) {
  assert(!source.includes("--human-token"), `${label} still exposes the human approval credential through process argv`);
  const commandLines = String(source).replace(/\\n/g, "\n").split(/\r?\n/);
  for (let index = 0; index < commandLines.length; index += 1) {
    if (!commandLines[index].includes("uash-emit-event.mjs")) continue;
    const command = [commandLines[index]];
    while (index + 1 < commandLines.length && (command.at(-1).trimEnd().endsWith("\\") || /^\s+--/.test(commandLines[index + 1]))) {
      command.push(commandLines[++index]);
    }
    assert(
      !/(?:\$UASH_HUMAN_APPROVAL_TOKEN|\$env:UASH_HUMAN_APPROVAL_TOKEN)/i.test(command.join("\n")),
      `${label} still expands the human approval credential into an emitter command`,
    );
  }
}

function workflowStepBlock(workflow, stepName) {
  const normalized = String(workflow).replace(/\r\n/g, "\n");
  const marker = `      - name: ${stepName}\n`;
  const start = normalized.indexOf(marker);
  assert(start >= 0, `generated CI step missing: ${stepName}`);
  const next = normalized.indexOf("\n      - name:", start + marker.length);
  return normalized.slice(start, next === -1 ? normalized.length : next);
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

function bridgeRunDir(dataDir, runId) {
  return path.join(dataDir, `run-${createHash("sha256").update(runId, "utf8").digest("hex")}`);
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

async function expectCommandFailure(command, args, options, expectedText, label) {
  try {
    await run(command, args, options);
  } catch (error) {
    assert(String(error.message).includes(expectedText), `${label}: expected failure containing ${expectedText}, got ${error.message}`);
    return;
  }
  throw new Error(`${label}: command unexpectedly passed`);
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
const generatedTarget = path.join(tempRoot, "commissioned-target");
const generatedOut = path.join(generatedTarget, ".valdris-harness");
const pyTarget = path.join(tempRoot, "pyproject-only");
const pyPack = path.join(pyTarget, ".valdris-harness");
const iosTarget = path.join(tempRoot, "ios-target");
const iosPack = path.join(iosTarget, ".valdris-harness");
const nonAiIosTarget = path.join(tempRoot, "non-ai-ios-target");
const overwriteTarget = path.join(tempRoot, "overwrite-target");
const loaderConflictTarget = path.join(tempRoot, "loader-conflict-target");
const malformedLoaderTarget = path.join(tempRoot, "malformed-loader-target");
const atomicLoaderTarget = path.join(tempRoot, "atomic-loader-target");
const dataDir = path.join(tempRoot, "runs");
const port = 18000 + Math.floor(Math.random() * 20000);
let bridge;

try {
  const shippedApprovalBoundarySources = [
    ["root event emitter", await readFile(path.join(root, "scripts", "uash-emit-event.mjs"), "utf8")],
    ["bridge", await readFile(path.join(root, "scripts", "claude-code-bridge.mjs"), "utf8")],
    ["commissioning generator", await readFile(path.join(root, "scripts", "commission-harness.mjs"), "utf8")],
    ["Claude runtime template", await readFile(path.join(root, "templates", "claude-code", "commands", "valdris-sdlc-harness.md"), "utf8")],
    ["Codex runtime template", await readFile(path.join(root, "templates", "codex", "valdris-sdlc-harness.md"), "utf8")],
    ["Claude connector guide", await readFile(path.join(root, "docs", "CLAUDE_CODE_CONNECTOR.md"), "utf8")],
    ["Codex connector guide", await readFile(path.join(root, "docs", "CODEX_CONNECTOR.md"), "utf8")],
    ["connector event contract", await readFile(path.join(root, "docs", "CONNECTOR_EVENT_CONTRACT.md"), "utf8")],
  ];
  for (const [label, source] of shippedApprovalBoundarySources) assertNoHumanApprovalSecretArgv(label, source);
  const bridgeHumanTokenExtractor = shippedApprovalBoundarySources[1][1].match(/function extractHumanToken\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert(
    bridgeHumanTokenExtractor.includes('req.headers["x-uash-human-token"]')
      && !/\bbody\b|humanApprovalToken/.test(bridgeHumanTokenExtractor),
    "bridge still accepts a human approval credential from an event request body",
  );

  const knowledgeIndex = await readFile(path.join(root, "knowledge", "index.md"), "utf8");
  assert(knowledgeIndex.includes("Systems") && knowledgeIndex.includes("Playbooks") && knowledgeIndex.includes("Sources"), "knowledge root index missing progressive-disclosure sections");
  await run(node, ["scripts/okf-vault-gate.mjs", "--repo", "."]);

  const questions = await run(node, ["scripts/commission-harness.mjs", "--print-questions"]);
  const questionGroups = JSON.parse(questions.stdout);
  assert(questionGroups.length === 31, `expected 31 commissioning groups, got ${questionGroups.length}`);

  await mkdir(generatedTarget, { recursive: true });
  await writeFile(path.join(generatedTarget, "package.json"), '{"name":"commissioned-verifier","private":true}\n', "utf8");
  await run(node, ["scripts/commission-harness.mjs", "--repo", generatedTarget, "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes"]);
  let nonEmptyOutputBlocked = false;
  try {
    await run(node, ["scripts/commission-harness.mjs", "--repo", generatedTarget, "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes"]);
  } catch (error) {
    nonEmptyOutputBlocked = error.message.includes("Output directory is not empty");
  }
  assert(nonEmptyOutputBlocked, "commissioning did not protect a non-empty output directory");
  await run(node, ["scripts/commission-harness.mjs", "--repo", generatedTarget, "--project-name", "Valdris SDLC Harness", "--out", generatedOut, "--yes", "--force"]);
  await mkdir(overwriteTarget, { recursive: true });
  await writeFile(path.join(overwriteTarget, "package.json"), '{"name":"must-survive"}\n', "utf8");
  let directRepoOverwriteBlocked = false;
  try {
    await run(node, ["scripts/commission-harness.mjs", "--repo", overwriteTarget, "--project-name", "Unsafe", "--out", overwriteTarget, "--yes"]);
  } catch (error) {
    directRepoOverwriteBlocked = error.message.includes("requires the committed target-nested pack");
  }
  assert(directRepoOverwriteBlocked, "commissioning did not refuse --out equal to --repo");
  assert((await readFile(path.join(overwriteTarget, "package.json"), "utf8")).includes("must-survive"), "commissioning overwrote the target package manifest");

  const adapter = JSON.parse(await readFile(path.join(generatedOut, "project-adapter.json"), "utf8"));
  const generatedReviewTrust = JSON.parse(await readFile(path.join(generatedOut, "controls", "review-trust.v1.json"), "utf8"));
  const generatedReviewTrustSha256 = reviewTrustStoreSha256(generatedReviewTrust);
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
  assert(adapter.workloadTaxonomy?.schema === "uash.workload-classification.v1", "workload classification schema missing from adapter");
  assert(adapter.workloadTaxonomy?.catalogSchema === "uash.workload-taxonomy-catalog.v1", "workload taxonomy catalog schema missing from adapter");
  assert(adapter.workloadTaxonomy?.catalog === "controls/workload-taxonomy.v1.json", "workload taxonomy catalog path missing from adapter");
  assert(adapter.workloadTaxonomy?.artifact === "run/workload-classification.json", "workload classification artifact path missing from adapter");
  assert(adapter.workloadTaxonomy?.routeSchema === "uash.route.v2" && adapter.workloadTaxonomy?.stableNodeId === "route", "route v2 workload classification must preserve the stable route node");
  assert(adapter.workloadTaxonomy?.gateCommand?.includes("workload-classification-gate.mjs") && adapter.workloadTaxonomy?.enforcement === "gate", "workload classification gate enforcement missing from adapter");
  assert(adapter.foundationAssurance?.schema === "uash.foundation-assessment.v1", "foundation assessment schema missing from adapter");
  assert(adapter.foundationAssurance?.catalogSchema === "uash.foundation-control-catalog.v1", "foundation catalog schema missing from adapter");
  assert(adapter.foundationAssurance?.catalog === "controls/foundation-layer.v1.json", "foundation catalog path missing from adapter");
  assert(adapter.foundationAssurance?.artifact === "foundation/assessment.json", "foundation assessment artifact path missing from adapter");
  assert(["catalogSha256", "workloadClassificationSha256", "runId", "profile", "effectiveTier", "commit", "environment"].every((binding) => adapter.foundationAssurance?.requiredBindings?.includes(binding)), "foundation assessment bindings missing from adapter");
  assert(adapter.foundationAssurance?.layer?.number === 0 && adapter.foundationAssurance?.enforcement === "gate", "Layer 0 foundation gate enforcement missing from adapter");
  assert(adapter.foundationAssurance?.gateCommand?.includes("foundation-gate.mjs"), "foundation gate command missing from adapter");
  assert(adapter.productionReadiness.layers.length === 13, "production readiness layer count mismatch");
  assert(adapter.productionReadiness.schema === "uash.production-readiness.v2", "production readiness v2 schema missing");
  assert(adapter.productionReadiness.catalog === "controls/production-layers.v2.json", "production control catalog missing");
  assert(adapter.productionReadiness.gateCommand?.includes("production-layer-gate.mjs"), "production layer gate command missing");
  assert(adapter.generativeAiAssurance?.schema === "uash.ai-assurance.v1", "AI assurance commissioning missing");
  assert(adapter.domainAssurance?.availablePacks?.includes("mobile-ios"), "iOS domain pack commissioning missing");
  assert(adapter.domainAssurance?.availablePacks?.includes("saas"), "SaaS domain pack commissioning missing");
  assert(adapter.goalLoop?.schema === "uash.goal.v1", "goal loop commissioning missing");
  assert(adapter.skillRouter?.catalogSize === 8, "eight-skill router commissioning missing");
  assert(adapter.skillRouter?.codexRouting === "skills/codex-routing.yaml" && adapter.skillRouter?.implicitInvocation === true, "Codex YAML skill routing commissioning missing");
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
  assert(adapter.operatingIntelligence?.evalGate?.contextQualityComparisonRequired === true, "eval gate must commission paired context-quality comparisons");
  assert(adapter.operatingIntelligence?.evalGate?.contextArmResultSchema === "uash.context-arm-result.v1", "eval gate must commission deterministic typed context-arm result documents");
  assert(adapter.operatingIntelligence?.trajectoryGate?.artifacts?.includes("trajectory/trajectory.json"), "trajectory gate commissioning missing");
  assert(adapter.operatingIntelligence?.contextManifest?.artifacts?.includes("context/manifest.json"), "context manifest commissioning missing");
  assert(adapter.operatingIntelligence?.contextManifest?.contextQuality?.schema === "uash.context-quality-eval.v1" && adapter.operatingIntelligence?.contextManifest?.contextQuality?.requiredWhenContextLoaded === true && adapter.operatingIntelligence?.contextManifest?.contextQuality?.resultsArtifact === "evals/results.json" && adapter.operatingIntelligence?.contextManifest?.contextQuality?.armResultSchema === "uash.context-arm-result.v1", "portable context-quality contract commissioning missing");
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
  assert(adapter.humanApproval?.operatorEnvironment === "UASH_HUMAN_APPROVAL_TOKEN"
    && adapter.humanApproval?.preferredHeader === "x-uash-human-token"
    && adapter.humanApproval?.processArgvAccepted === false
    && adapter.humanApproval?.requestBodyAccepted === false,
  "generated adapter must require operator-environment approval credentials and reject argv/body transport");
  assert(adapter.ciEnforcement?.workflowTemplate === ".github/workflows/valdris-assurance.yml"
    && adapter.ciEnforcement?.structuralWorkflowTemplate === ".github/workflows/valdris-assurance.yml"
    && adapter.ciEnforcement?.acceptanceWorkflowTemplate === ".github/workflows/valdris-run-acceptance.yml",
  "structural and explicit acceptance CI workflow templates are missing from the adapter");
  assert(adapter.ciEnforcement?.alwaysOnCommands?.some((command) => command.includes("catalog-integrity-gate.mjs"))
    && adapter.ciEnforcement.alwaysOnCommands.every((command) => !command.includes("run/packet.json") && !command.includes("route-gate.mjs")),
  "always-on CI policy must contain only structural commissioning gates");
  assert(adapter.ciEnforcement?.acceptanceCommand?.includes("run-acceptance.mjs")
    && adapter.ciEnforcement.acceptanceCommand.includes("--source-commit <full-git-sha>"),
  "explicit hydrated run acceptance command is missing from generated CI policy");
  assert(adapter.finishLineAssurance?.requiredArtifacts?.includes("run/workload-classification.json"), "workload classification missing from finish-line artifacts");
  assert(adapter.finishLineAssurance?.requiredArtifacts?.some((artifact) => artifact.includes("foundation/assessment.json")), "foundation assessment missing from finish-line artifacts");
  assert(adapter.finishLineAssurance?.requiredArtifacts?.some((artifact) => artifact.includes("uash.context-arm-result.v1")), "typed context-arm result files missing from finish-line artifacts");
  assert(adapter.finishLineAssurance?.packetRequired && adapter.finishLineAssurance?.independentReviewRequired, "v0.8 run-packet or independent-review finish-line policy missing");
  assert(adapter.portableExecution?.roleSeparation?.reviewSchema === "valdris.review.v2" && adapter.portableExecution?.roleSeparation?.runPacketSchema === "valdris.run-packet.v2" && adapter.portableExecution?.roleSeparation?.requiredRoles?.length === 4 && adapter.portableExecution?.roleSeparation?.pairwiseDistinctIdentityFields?.join(",") === "actorId,sessionId,executionId", "generated pack must commission the four-role portable closure and pairwise identity separation");
  assert(adapter.finishLineAssurance?.requiredArtifacts?.includes("run/packet.json") && adapter.finishLineAssurance?.requiredArtifacts?.includes("review/review.json"), "v0.8 finish-line artifacts missing run packet or independent review");
  assert(adapter.reviewTrust?.schema === "valdris.review-trust.v1" && adapter.reviewTrust?.algorithm === "ed25519" && adapter.reviewTrust?.commissioned === false, "generated pack must expose an uncommissioned Ed25519 review trust boundary");
  assert(adapter.reviewTrust?.pinEnvironment === "UASH_REVIEW_TRUST_SHA256"
    && adapter.reviewTrust?.pinDigestScheme === "sha256-canonical-json"
    && adapter.reviewTrust?.generatedDigest === generatedReviewTrustSha256
    && adapter.reviewTrust?.generatedDigestAuthority?.includes("outside the repository")
    && adapter.reviewTrust?.rotationPolicy?.includes("never auto-enroll"),
  "generated pack must hand off an informational canonical review trust digest while preserving external operator authority");
  assert(adapter.installation?.targetRoot === "." && adapter.installation?.packRoot === ".valdris-harness" && adapter.installation?.commitRequired === true && adapter.installation?.sameGitWorktreeRequired === true, "generated pack must bind the committed target-nested installation model");
  assert(adapter.reviewTrust?.path === ".valdris-harness/controls/review-trust.v1.json", "generated review trust path must be target-root-relative and pack-aware");
  assert(adapter.cleanRoomAssurance?.privacyScope?.pack === ".valdris-harness" && adapter.cleanRoomAssurance?.privacyScope?.generatedEvidenceCommand?.includes("--include graph --include design/anchors.json"), "generated privacy policy must separate clean-room pack and generated evidence scopes");
  assert(adapter.finishLineAssurance?.requiredArtifacts?.some((artifact) => artifact.includes("controls/review-trust.v1.json")), "generated finish line must require the project review trust store");
  assert(adapter.validation?.completedGoal?.includes("goal-gate.mjs --repo .") && !adapter.validation.completedGoal.includes("--allow-active"), "generated adapter must expose the completed-goal closure command");
  assert(adapter.validation?.enterpriseAi?.includes("enterprise-ai-gate-all.mjs --repo ."), "generated adapter must expose the enterprise/AI closure command");
  assert(adapter.validation?.rcaWhenApplicable?.includes("rca-gate.mjs --repo ."), "generated adapter must expose the route-applicable RCA closure command");
  assert(adapter.validation?.preReviewEvidenceBundle?.includes("run-create.mjs") && adapter.validation.preReviewEvidenceBundle.includes("--print-evidence-bundle"), "generated adapter must expose pre-review evidence-bundle creation");
  assert(adapter.validation?.review?.includes("review-gate.mjs --repo ."), "generated adapter must expose the independent-review closure command");
  assert(adapter.validation?.runPacketCreate?.includes("run-create.mjs") && adapter.validation.runPacketCreate.includes("--review review/review.json") && adapter.validation.runPacketCreate.includes("--output run/packet.json"), "generated adapter must expose final run-packet creation");
  assert(adapter.validation?.runPacket?.includes("run-packet-gate.mjs --repo ."), "generated adapter must expose the final run-packet gate");
  assert(adapter.validation?.runAcceptance?.includes("run-acceptance.mjs --repo .") && adapter.validation.runAcceptance.includes("--source-commit <full-git-sha>"), "generated adapter must expose explicit hydrated run acceptance");
  assert(adapter.validation?.orderedClosure?.join(",") === "completedGoal,enterpriseAi,rcaWhenApplicable,preReviewEvidenceBundle,review,runPacketCreate,runPacket", "generated adapter must preserve the ordered v0.8 closure");
  assert(adapter.detected?.repoPath === ".", "generated adapter must not persist an absolute local repository path");
  assert(adapter.installation?.discoveryLoaders?.["AGENTS.md"]?.loads === ".valdris-harness/AGENTS.md" && adapter.installation?.discoveryLoaders?.["CLAUDE.md"]?.loads === ".valdris-harness/CLAUDE.md" && adapter.installation?.discoveryLoadersCommitRequired === true, "generated adapter missing target-root discovery-loader contract");
  const targetRootAgents = await readFile(path.join(generatedTarget, "AGENTS.md"), "utf8");
  const targetRootClaude = await readFile(path.join(generatedTarget, "CLAUDE.md"), "utf8");
  assert(targetRootAgents.includes(".valdris-harness/AGENTS.md") && targetRootClaude.includes("@.valdris-harness/CLAUDE.md"), "target-root discovery loaders do not load the nested Valdris front doors");
  assert(targetRootAgents.split("<!-- valdris-sdlc-harness-loader:start -->").length === 2 && targetRootClaude.split("<!-- valdris-sdlc-harness-loader:start -->").length === 2, "forced recommissioning duplicated target-root loader blocks");
  const generatedAgents = await readFile(path.join(generatedOut, "AGENTS.md"), "utf8");
  const generatedClaude = await readFile(path.join(generatedOut, "CLAUDE.md"), "utf8");
  assert(generatedAgents.includes("Layer 0 workload and foundation assurance") && generatedAgents.includes("Async and multi-agent orchestration are cross-cutting"), "generated AGENTS front door missing Layer 0 or orchestration contract");
  assert(generatedAgents.includes("git add .valdris-harness AGENTS.md CLAUDE.md") && generatedAgents.includes("bounded target-root `AGENTS.md` and `CLAUDE.md` discovery loaders"), "generated front door does not require committing target-root discovery loaders with the pack");
  assert(!generatedAgents.includes("node scripts/") && !generatedClaude.includes("node scripts/") && generatedAgents.includes(".valdris-harness/scripts/"), "generated front doors contain unsupported root-runtime command paths");
  assert(generatedClaude.includes("run/workload-classification.json") && generatedClaude.includes("foundation/assessment.json"), "generated Claude front door missing Layer 0 artifacts");
  const generatedClaudeCommand = await readFile(path.join(generatedOut, ".claude", "commands", "valdris-sdlc-harness.md"), "utf8");
  const generatedCodexPrompt = await readFile(path.join(generatedOut, "docs", "Codex Runtime Prompt.md"), "utf8");
  const generatedEventEmitter = await readFile(path.join(generatedOut, "scripts", "uash-emit-event.mjs"), "utf8");
  for (const [label, content] of [["generated Claude runtime prompt", generatedClaudeCommand], ["generated Codex runtime prompt", generatedCodexPrompt], ["generated event emitter", generatedEventEmitter]]) {
    assertNoHumanApprovalSecretArgv(label, content);
  }
  for (const [label, content] of [["Claude", generatedClaudeCommand], ["Codex", generatedCodexPrompt]]) {
    assert(content.includes("Bridge credential boundary")
      && content.includes("with only `UASH_BRIDGE_ACCESS_TOKEN`")
      && content.includes("separate shell")
      && content.includes("never accepts the human token through process arguments or request bodies")
      && content.includes("Possession of the access token alone cannot self-approve"),
    `generated ${label} runtime prompt missing the three-credential least-privilege boundary`);
  }
  assert(generatedClaudeCommand.includes("run event commands from the target repository root")
    && generatedClaudeCommand.includes(".valdris-harness/scripts/uash-emit-event.mjs")
    && !generatedClaudeCommand.includes("run event commands from the generated pack root"),
  "generated Claude runtime prompt instructs operators to run from the wrong root");
  await readFile(path.join(generatedOut, "docs", "Code Intelligence Graph.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "GitNexus Code Intelligence.md"), "utf8");
  const generatedFoundationDoc = await readFile(path.join(generatedOut, "docs", "Good Looks Like Foundation.md"), "utf8");
  const generatedValidationDoc = await readFile(path.join(generatedOut, "docs", "Validation Commands.md"), "utf8");
  const generatedProofSchemaDoc = await readFile(path.join(generatedOut, "docs", "Proof Schema.md"), "utf8");
  const generatedCommissioningReview = await readFile(path.join(generatedOut, "commissioning-review.md"), "utf8");
  const generatedRunTemplate = await readFile(path.join(generatedOut, "runs", "_run-template", "README.md"), "utf8");
  const rootThirdPartyNotices = await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  const generatedThirdPartyNotices = await readFile(path.join(generatedOut, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert(generatedThirdPartyNotices === rootThirdPartyNotices, "generated pack must preserve THIRD_PARTY_NOTICES.md exactly");
  assert(generatedFoundationDoc.includes("Foundation / Good Looks Like layer is numbered 0"), "generated foundation doc missing executable Layer 0 contract");
  assert(generatedValidationDoc.includes("catalog-integrity-gate.mjs") && generatedValidationDoc.includes("workload-classification-gate.mjs") && generatedValidationDoc.includes("route-gate.mjs") && generatedValidationDoc.includes("foundation-gate.mjs") && generatedValidationDoc.includes("valdris-run-acceptance.yml") && generatedValidationDoc.includes("valdris.run-artifact-bundle.v1") && generatedValidationDoc.includes("run-acceptance.mjs --repo ."), "generated validation doc missing ordered gates or the structural/hydrated CI acceptance contract");
  const validationClosureMarkers = ["1. Completed goal", "2. Enterprise and AI assurance", "3. RCA when applicable", "4. Freeze the pre-review evidence bundle", "5. Four-role signed review", "6. Create and validate the final run packet"];
  assert(validationClosureMarkers.every((marker) => generatedValidationDoc.includes(marker)) && validationClosureMarkers.every((marker, index) => index === 0 || generatedValidationDoc.indexOf(marker) > generatedValidationDoc.indexOf(validationClosureMarkers[index - 1])), "generated validation doc must document the ordered v0.8 closure");
  assert(generatedValidationDoc.includes("--print-evidence-bundle") && generatedValidationDoc.includes("valdris.review.v2") && generatedValidationDoc.includes("scout") && generatedValidationDoc.includes("implementer") && generatedValidationDoc.includes("verifier") && generatedValidationDoc.includes("independentReviewer") && generatedValidationDoc.includes("pairwise distinct") && generatedValidationDoc.includes("valdris.run-packet.v2"), "generated validation doc missing pre-review, exact four-role, or final-packet closure rules");
  assert(generatedProofSchemaDoc.includes("proof/proof.json is necessary but not sufficient") && generatedProofSchemaDoc.includes("--print-evidence-bundle") && generatedProofSchemaDoc.includes("valdris.review.v2") && generatedProofSchemaDoc.includes("actorId") && generatedProofSchemaDoc.includes("sessionId") && generatedProofSchemaDoc.includes("executionId") && generatedProofSchemaDoc.includes("Ed25519") && generatedProofSchemaDoc.includes("valdris.run-packet.v2") && generatedProofSchemaDoc.includes("UASH_REVIEW_TRUST_SHA256") && generatedProofSchemaDoc.includes("canonical-JSON SHA-256"), "generated proof schema doc missing the v0.8 signed completion or external trust-pin closure");
  assert(generatedCommissioningReview.includes(generatedReviewTrustSha256)
    && generatedCommissioningReview.includes("informational, not its own authority")
    && generatedCommissioningReview.includes("protected `UASH_REVIEW_TRUST_SHA256`")
    && generatedCommissioningReview.includes("governed rotation"),
  "commissioning review must print the candidate trust digest without making the generated repository its authority");
  assert(generatedRunTemplate.includes("run/workload-classification.json") && generatedRunTemplate.includes("foundation/assessment.json"), "generated run template missing Layer 0 artifacts");
  for (const requiredArtifact of ["goal/goal.json", "context/manifest.json", "ai/assurance.json", "domain/assurance.json", "evals/results.json", "uash.context-arm-result.v1", "trajectory/trajectory.json", "waivers/waivers.json", "proof/portable.json", "review/review.json", "run/packet.json", "production/layer-assessment.json when production applies", "smoke/smoke_proof.json when smoke applies", "rca/rca.json when RCA applies"]) {
    assert(generatedRunTemplate.includes(requiredArtifact), `generated run template missing finish-line artifact contract: ${requiredArtifact}`);
  }
  await readFile(path.join(generatedOut, "docs", "Code Quality Guardrails.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Enterprise Proof Bank.md"), "utf8");
  const generatedOperatingIntelligence = await readFile(path.join(generatedOut, "docs", "Operating Intelligence Layer.md"), "utf8");
  assert(generatedOperatingIntelligence.includes("uash.context-quality-eval.v1") && generatedOperatingIntelligence.includes("paired no-context or limited-context baseline"), "generated operating-intelligence doc missing portable context-quality contract");
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
  await readFile(path.join(generatedOut, "scripts", "workload-classifier-lib.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "workload-classification-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "foundation-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "production-layer-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "enterprise-ai-gate-all.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "route-request.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "goal-transition.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "domain-assurance-gate.mjs"), "utf8");
  await readFile(path.join(generatedOut, "controls", "workload-taxonomy.v1.json"), "utf8");
  await readFile(path.join(generatedOut, "controls", "foundation-layer.v1.json"), "utf8");
  await readFile(path.join(generatedOut, "controls", "production-layers.v2.json"), "utf8");
  await readFile(path.join(generatedOut, "controls", "domain-packs", "mobile-ios.v1.json"), "utf8");
  await readFile(path.join(generatedOut, "controls", "domain-packs", "saas.v1.json"), "utf8");
  await readFile(path.join(generatedOut, "skills", "registry.json"), "utf8");
  await readFile(path.join(generatedOut, ".agents", "skills", "registry.json"), "utf8");
  await readFile(path.join(generatedOut, ".claude", "skills", "registry.json"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "run-acceptance.mjs"), "utf8");
  const generatedWorkflow = await readFile(path.join(generatedOut, ".github", "workflows", "valdris-assurance.yml"), "utf8");
  const generatedAcceptanceWorkflow = await readFile(path.join(generatedOut, ".github", "workflows", "valdris-run-acceptance.yml"), "utf8");
  assert(generatedWorkflow.includes("name: Valdris Structural Assurance")
    && generatedWorkflow.includes("pull_request:")
    && generatedWorkflow.includes("push:")
    && generatedWorkflow.includes("fetch-depth: 0")
    && generatedWorkflow.includes("persist-credentials: false")
    && generatedWorkflow.includes("os: [ubuntu-latest, windows-latest]"),
  "always-on structural CI must run on push/PR across Linux and Windows with a full credential-free checkout");
  for (const structuralGate of ["okf-vault-gate.mjs", "skill-registry-gate.mjs", "catalog-integrity-gate.mjs", "provenance-gate.mjs", "neutrality-gate.mjs", "privacy-gate.mjs --repo .valdris-harness", "schema-compat-gate.mjs"]) {
    assert(generatedWorkflow.includes(structuralGate), `always-on structural CI is missing ${structuralGate}`);
  }
  for (const hydratedOnlyMarker of ["UASH_REVIEW_TRUST_SHA256", "intake-gate.mjs", "route-gate.mjs", "goal-gate.mjs", "enterprise-ai-gate-all.mjs", "review-gate.mjs", "run-packet-gate.mjs", "run/packet.json"]) {
    assert(!generatedWorkflow.includes(hydratedOnlyMarker), `always-on structural CI must not require hydrated run state: ${hydratedOnlyMarker}`);
  }
  assert(generatedAcceptanceWorkflow.includes("workflow_dispatch:")
    && !generatedAcceptanceWorkflow.includes("pull_request:")
    && !generatedAcceptanceWorkflow.includes("\n  push:")
    && generatedAcceptanceWorkflow.includes("environment: valdris-run-acceptance")
    && generatedAcceptanceWorkflow.includes("UASH_REVIEW_TRUST_SHA256: ${{ vars.UASH_REVIEW_TRUST_SHA256 }}")
    && generatedAcceptanceWorkflow.includes("Require operator-held review trust pin"),
  "run acceptance must be explicit and protected by the operator-held environment trust pin");
  const sourceInputCheckIndex = generatedAcceptanceWorkflow.indexOf("Validate exact source commit input");
  const sourceCheckoutIndex = generatedAcceptanceWorkflow.indexOf("uses: actions/checkout@v4");
  assert(sourceInputCheckIndex >= 0 && sourceInputCheckIndex < sourceCheckoutIndex
    && generatedAcceptanceWorkflow.includes("VALDRIS_SOURCE_COMMIT: ${{ inputs.source_commit }}")
    && generatedAcceptanceWorkflow.includes("source_commit must be a lowercase full Git object ID"),
  "run acceptance must validate the exact lowercase full source SHA through an environment variable before checkout");
  assert(generatedAcceptanceWorkflow.includes("ref: ${{ inputs.source_commit }}")
    && generatedAcceptanceWorkflow.includes("fetch-depth: 0")
    && generatedAcceptanceWorkflow.includes("persist-credentials: false")
    && generatedAcceptanceWorkflow.includes("git config core.autocrlf false")
    && generatedAcceptanceWorkflow.includes("git checkout-index --force --all"),
  "run acceptance must materialize the exact full-history source commit with portable Git bytes and no persisted credentials");
  assert(generatedAcceptanceWorkflow.includes("actions/download-artifact@v4")
    && generatedAcceptanceWorkflow.includes("run-id: ${{ inputs.artifact_run_id }}")
    && generatedAcceptanceWorkflow.includes("path: ${{ runner.temp }}/valdris-run-artifacts")
    && generatedAcceptanceWorkflow.includes("VALDRIS_ARTIFACT_BUNDLE: ${{ runner.temp }}/valdris-run-artifacts")
    && generatedAcceptanceWorkflow.includes("run: node .valdris-harness/scripts/run-acceptance.mjs --repo ."),
  "run acceptance must hydrate the selected artifact outside the checkout and execute the commissioned acceptance CLI");
  assert(!generatedAcceptanceWorkflow.split(/\r?\n/).some((line) => line.trimStart().startsWith("run:") && (line.includes("${{ inputs.") || line.includes("${{ runner.temp }}"))), "workflow-dispatch values and runner paths must never be interpolated into acceptance shell commands");
  const generatedPackage = JSON.parse(await readFile(path.join(generatedOut, "package.json"), "utf8"));
  assert(generatedPackage.scripts?.["catalog:gate"] && generatedPackage.scripts?.["provenance:gate"] && generatedPackage.scripts?.["neutrality:gate"] && generatedPackage.scripts?.["privacy:gate"] && generatedPackage.scripts?.["evidence:privacy:gate"] && generatedPackage.scripts?.["schema:compat:gate"] && generatedPackage.scripts?.["intake:gate"] && generatedPackage.scripts?.["classification:gate"] && generatedPackage.scripts?.["foundation:gate"] && generatedPackage.scripts?.["route:request"] && generatedPackage.scripts?.["goal:transition"] && generatedPackage.scripts?.["enterprise-ai:gate"] && generatedPackage.scripts?.["review:gate"] && generatedPackage.scripts?.["run:packet:gate"] && generatedPackage.scripts?.["run:accept"] && generatedPackage.scripts?.["skills:install:codex"] && generatedPackage.scripts?.["skills:check:codex"], "generated package scripts missing clean-room, scoped-evidence, active-start, Layer 0, hydrated acceptance, or v0.8 proof commands");
  await readFile(path.join(generatedOut, "scripts", "catalog-integrity-gate.mjs"), "utf8");
  await run(node, ["scripts/catalog-integrity-gate.mjs", "--repo", "."], { cwd: generatedOut });
  const generatedProductionCatalog = path.join(generatedOut, "controls", "production-layers.v2.json");
  const originalGeneratedProductionCatalog = await readFile(generatedProductionCatalog, "utf8");
  const weakenedGeneratedProductionCatalog = JSON.parse(originalGeneratedProductionCatalog);
  weakenedGeneratedProductionCatalog.layers[0].controls[0].requirement = "Any frontend evidence passes.";
  await writeFile(generatedProductionCatalog, `${JSON.stringify(weakenedGeneratedProductionCatalog, null, 2)}\n`, "utf8");
  await expectCommandFailure(node, ["scripts/catalog-integrity-gate.mjs", "--repo", "."], { cwd: generatedOut }, "canonical catalog integrity mismatch", "unconditional catalog policy downgrade");
  await writeFile(generatedProductionCatalog, originalGeneratedProductionCatalog, "utf8");
  await readFile(path.join(generatedOut, "scripts", "install-codex-skills.mjs"), "utf8");
  await readFile(path.join(generatedOut, "scripts", "okf-vault-gate.mjs"), "utf8");
  const generatedKnowledgeIndex = await readFile(path.join(generatedOut, "knowledge", "index.md"), "utf8");
  const generatedLayerZeroPlaybook = await readFile(path.join(generatedOut, "knowledge", "playbooks", "layer-zero-assurance.md"), "utf8");
  assert(generatedKnowledgeIndex.includes("Layer Zero Assurance") && generatedKnowledgeIndex.includes("Production Assurance: 13 Domains") && generatedLayerZeroPlaybook.includes("not a fourteenth production domain"), "generated knowledge vault missing Layer 0 or assurance-domain taxonomy");

  const rootEnterpriseProofBank = await readFile(path.join(root, "docs", "ENTERPRISE_PROOF_BANK.md"), "utf8");
  const rootOperatingIntelligence = await readFile(path.join(root, "docs", "OPERATING_INTELLIGENCE_LAYER.md"), "utf8");
  const rootTestDayGates = await readFile(path.join(root, "docs", "TEST_DAY_ACCEPTANCE_GATES.md"), "utf8");
  assert(rootEnterpriseProofBank.includes("Scale / concurrency") && rootEnterpriseProofBank.includes("Domain packs"), "enterprise proof bank root doc missing core sections");
  assert(rootOperatingIntelligence.includes("Trajectory evaluation") && rootOperatingIntelligence.includes("AI economics") && rootOperatingIntelligence.includes("Portable context-quality A/B contract") && rootOperatingIntelligence.includes("uash.context-comparison.v1"), "operating intelligence root doc missing paper-gap patterns or executable context-quality contract");
  assert(rootTestDayGates.includes("31 groups / 158 questions") && rootTestDayGates.includes("main updated"), "test-day acceptance gates doc missing update criteria");

  const claudeTemplate = await readFile(path.join(root, "templates", "claude-code", "commands", "valdris-sdlc-harness.md"), "utf8");
  const codexTemplate = await readFile(path.join(root, "templates", "codex", "valdris-sdlc-harness.md"), "utf8");
  const connectorEventContract = await readFile(path.join(root, "docs", "CONNECTOR_EVENT_CONTRACT.md"), "utf8");
  const rootSkillRegistry = JSON.parse(await readFile(path.join(root, "skills", "registry.json"), "utf8"));
  assert(claudeTemplate.includes("code-intelligence-scan.mjs") && claudeTemplate.includes("GitNexus/code-intelligence"), "Claude template missing GitNexus/code-intelligence flow");
  assert(codexTemplate.includes("code-intelligence-scan.mjs") && codexTemplate.includes("Good Looks Like Foundation"), "Codex template missing GitNexus/foundation flow");
  assert(claudeTemplate.includes("skills/codex-routing.yaml") && claudeTemplate.includes("skills/registry.json") && codexTemplate.includes("skills/codex-routing.yaml") && codexTemplate.includes("goal/goal.json"), "runtime templates missing v0.7 Codex YAML goal/skill routing");
  for (const [label, runtimeTemplate] of [["Claude", claudeTemplate], ["Codex", codexTemplate]]) {
    assert(runtimeTemplate.includes("--print-evidence-bundle") && runtimeTemplate.includes("valdris.review.v2") && runtimeTemplate.includes("scout") && runtimeTemplate.includes("implementer") && runtimeTemplate.includes("verifier") && runtimeTemplate.includes("independentReviewer") && runtimeTemplate.includes("pairwise distinct") && runtimeTemplate.includes("valdris.run-packet.v2"), `${label} runtime template missing the ordered four-role v0.8 completion closure`);
  }
  assert(connectorEventContract.includes("scout") && connectorEventContract.includes("implementer") && connectorEventContract.includes("verifier") && connectorEventContract.includes("independentReviewer") && connectorEventContract.includes("actorId") && connectorEventContract.includes("sessionId") && connectorEventContract.includes("executionId"), "connector event contract missing exact four-role provenance wording");
  assert(["scout", "implementer", "verifier", "independentReviewer", "actorId", "sessionId", "executionId", "valdris.review.v2", "valdris.run-packet.v2"].every((term) => rootSkillRegistry.gatePolicy?.review?.includes(term) || rootSkillRegistry.gatePolicy?.["run-packet"]?.includes(term)), "skill registry missing exact four-role review and run-packet wording");
  await readFile(path.join(generatedOut, "skills", "codex-routing.yaml"), "utf8");
  await readFile(path.join(generatedOut, ".agents", "skills", "codex-routing.yaml"), "utf8");
  await readFile(path.join(generatedOut, ".claude", "skills", "codex-routing.yaml"), "utf8");

  const claudeConnectorDoc = await readFile(path.join(root, "docs", "CLAUDE_CODE_CONNECTOR.md"), "utf8");
  const codexConnectorDoc = await readFile(path.join(root, "docs", "CODEX_CONNECTOR.md"), "utf8");
  assert(claudeConnectorDoc.startsWith("# Claude Code Connector v0.5"), "Claude connector doc version drift");
  assert(codexConnectorDoc.startsWith("# Codex Connector v0.5"), "Codex connector doc version drift");
  await run(node, ["scripts/code-intelligence-scan.mjs", "--repo", ".", "--provider", "local"], { cwd: generatedOut });
  await run(node, ["scripts/code-intelligence-gate-all.mjs", "--repo", ".", "--allow-stale"], { cwd: generatedOut });
  await run(node, ["scripts/okf-vault-gate.mjs", "--repo", "."], { cwd: generatedOut });
  await run(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut });
  const generatedRegistryPath = path.join(generatedOut, "skills", "registry.json");
  const generatedRegistryText = await readFile(generatedRegistryPath, "utf8");
  await writeFile(generatedRegistryPath, generatedRegistryText.replace("Every completion requires an Ed25519-attested independent review artifact", "Consequential completion requires an Ed25519-attested independent review artifact"), "utf8");
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "review policy must require independent review for every completion", "independent-review applicability downgrade");
  await writeFile(generatedRegistryPath, generatedRegistryText, "utf8");
  const generatedCanonicalOpenAi = path.join(generatedOut, "skills", "valdris-feature-delivery", "agents", "openai.yaml");
  const canonicalOpenAi = await readFile(generatedCanonicalOpenAi, "utf8");
  await writeFile(generatedCanonicalOpenAi, canonicalOpenAi.replace("allow_implicit_invocation: true", "allow_implicit_invocation: false"), "utf8");
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "must allow implicit invocation", "implicit skill invocation downgrade");
  await writeFile(generatedCanonicalOpenAi, canonicalOpenAi, "utf8");

  const generatedAgentMirror = path.join(generatedOut, ".agents", "skills", "valdris-feature-delivery", "agents", "openai.yaml");
  const agentMirrorOpenAi = await readFile(generatedAgentMirror, "utf8");
  await writeFile(generatedAgentMirror, agentMirrorOpenAi.replace("Deliver vertical slices", "Drifted vertical slices"), "utf8");
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "differs from canonical skill", "Codex skill mirror drift");
  await writeFile(generatedAgentMirror, agentMirrorOpenAi, "utf8");

  const obsoleteSkill = path.join(generatedOut, ".agents", "skills", "valdris-obsolete");
  await mkdir(obsoleteSkill, { recursive: true });
  await writeFile(path.join(obsoleteSkill, "SKILL.md"), "---\nname: valdris-obsolete\ndescription: stale\n---\n", "utf8");
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "unregistered Valdris skill", "stale auto-discoverable skill");
  await rm(obsoleteSkill, { recursive: true, force: true });
  await run(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut });

  const generatedAdapterPath = path.join(generatedOut, "project-adapter.json");
  const generatedAdapterText = await readFile(generatedAdapterPath, "utf8");
  const driftedAdapter = JSON.parse(generatedAdapterText);
  delete driftedAdapter.skillRouter.codexRouting;
  await writeFile(generatedAdapterPath, `${JSON.stringify(driftedAdapter, null, 2)}\n`, "utf8");
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "skillRouter.codexRouting", "adapter skill routing downgrade");
  await writeFile(generatedAdapterPath, generatedAdapterText, "utf8");
  await rm(generatedAdapterPath, { force: true });
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "project-adapter.json is required", "missing adapter mirror bypass");
  await writeFile(generatedAdapterPath, generatedAdapterText, "utf8");
  await rm(path.join(generatedOut, ".agents", "skills"), { recursive: true, force: true });
  await rm(path.join(generatedOut, ".claude", "skills"), { recursive: true, force: true });
  await expectCommandFailure(node, ["scripts/skill-registry-gate.mjs", "--repo", "."], { cwd: generatedOut }, "skill mirror is missing", "deleted discovery mirrors bypass");
  await cp(path.join(generatedOut, "skills"), path.join(generatedOut, ".agents", "skills"), { recursive: true });
  await cp(path.join(generatedOut, "skills"), path.join(generatedOut, ".claude", "skills"), { recursive: true });

  const codexInstallTarget = path.join(tempRoot, "codex-skills");
  await run(node, ["scripts/install-codex-skills.mjs", "--target", codexInstallTarget]);
  await mkdir(path.join(codexInstallTarget, "valdris-obsolete"), { recursive: true });
  await expectCommandFailure(node, ["scripts/install-codex-skills.mjs", "--target", codexInstallTarget, "--check"], { cwd: root }, "unregistered installed Valdris skill", "obsolete global Codex skill");
  await run(node, ["scripts/install-codex-skills.mjs", "--target", codexInstallTarget]);
  await run(node, ["scripts/install-codex-skills.mjs", "--target", codexInstallTarget, "--check"]);

  const generatedInstallTarget = path.join(tempRoot, "generated-codex-skills");
  await mkdir(path.join(generatedInstallTarget, "valdris-sdlc-harness"), { recursive: true });
  await writeFile(path.join(generatedInstallTarget, "valdris-sdlc-harness", "preserved.txt"), "preserve global meta skill\n", "utf8");
  await run(node, [path.join(generatedOut, "scripts", "install-codex-skills.mjs"), "--target", generatedInstallTarget], { cwd: generatedOut });
  assert((await readFile(path.join(generatedInstallTarget, "valdris-sdlc-harness", "preserved.txt"), "utf8")).includes("preserve"), "generated pack installer pruned the global harness meta skill");

  const routingCases = [
    ["ambiguous", "Make it better", "valdris-intake-route"],
    ["bug", "Why are checkout requests double charging after retries?", "valdris-bug-rca"],
    ["feature", "Build a full-stack customer portal", "valdris-feature-delivery"],
    ["architecture", "Refactor the service module boundaries", "valdris-architecture-refactor"],
    ["audit", "Audit this repo end-to-end; I am not sure what is missing.", "valdris-intake-route"],
    ["security", "Review our RLS and tenant isolation.", "valdris-security-audit"],
    ["release", "Ship the current build to TestFlight.", "valdris-platform-release"],
    ["proof", "Verify this is ready to merge.", "valdris-proof-handoff"],
    ["ai-review", "Review our AI model safety.", "valdris-genai-assurance"],
    ["prompt-injection", "Audit prompt-injection defenses.", "valdris-security-audit"],
  ];
  for (const [id, request, expectedPrimary] of routingCases) {
    const routeRoot = path.join(tempRoot, `route-${id}`);
    await mkdir(routeRoot, { recursive: true });
    await run(node, ["scripts/route-request.mjs", "--repo", routeRoot, "--run-id", `ROUTE-${id}`, "--request", request]);
    const route = JSON.parse(await readFile(path.join(routeRoot, "run", "route.json"), "utf8"));
    const classification = JSON.parse(await readFile(path.join(routeRoot, "run", "workload-classification.json"), "utf8"));
    assert(route.schema === "uash.route.v2", `${id} request did not generate route v2`);
    assert(classification.schema === "uash.workload-classification.v1", `${id} request did not generate a workload classification`);
    await run(node, ["scripts/workload-classification-gate.mjs", "--repo", routeRoot]);
    await run(node, ["scripts/route-gate.mjs", "--repo", routeRoot]);
    if (id === "bug") {
      const routePath = path.join(routeRoot, "run", "route.json");
      const originalRoute = await readFile(routePath, "utf8");
      route.gateApplicability.foundation = { status: "not-applicable", reason: "Attempted Layer 0 downgrade." };
      await writeFile(routePath, `${JSON.stringify(route, null, 2)}\n`, "utf8");
      await expectCommandFailure(node, ["scripts/route-gate.mjs", "--repo", routeRoot], {}, "foundation", "route-required Layer 0 foundation downgrade");
      await writeFile(routePath, originalRoute, "utf8");
    }
    assert(route.skillPhases[1].primary === expectedPrimary, `${id} request routed to ${route.skillPhases[1].primary} instead of ${expectedPrimary}`);
    if (id === "ambiguous") assert(classification.materialUnknowns.some(({ id: unknownId }) => unknownId === "scope-definition"), "ambiguous intake omitted its scope-definition stopping condition");
  }

  const routingRegressions = [
    {
      id: "controlled-hipaa-docs", request: "Document our HIPAA patient data retention policy only", profile: "production",
      check: (route, classification, intake) => classification.taskType === "docs-only" && classification.controlledDocumentation === true && classification.effectiveTier === "T3" && classification.crossCuttingConcerns.includes("privacy-data-governance") && route.gateApplicability.foundation.status === "required" && route.gateApplicability.production.status === "not-applicable" && intake.allowedActions.includes("create scoped branch changes"),
    },
    {
      id: "ordinary-readme", request: "Write a README", profile: "production",
      check: (route, classification, intake) => classification.taskType === "docs-only" && classification.controlledDocumentation === false && classification.workloadProfiles.length === 0 && classification.crossCuttingConcerns.length === 0 && route.gateApplicability.foundation.status === "not-applicable" && intake.allowedActions.includes("create scoped branch changes"),
    },
    {
      id: "context-provider", request: "Refactor React context provider", profile: "production",
      check: (route) => route.gateApplicability.smoke.status === "not-applicable",
    },
    {
      id: "provider-integration", request: "Integrate an external provider and deploy it", profile: "production",
      check: (route) => route.gateApplicability.smoke.status === "required",
    },
    {
      id: "manual-provider-change", request: "Manually change production provider configuration", profile: "production",
      check: (route, classification) => classification.taskType === "platform-release" && route.skillPhases[1].primary === "valdris-platform-release" && route.gateApplicability.smoke.status === "required",
    },
    {
      id: "manual-data-change", request: "Manually change production customer data", profile: "production",
      check: (route, classification) => classification.taskType === "platform-release" && route.skillPhases[1].primary === "valdris-platform-release" && route.gateApplicability.smoke.status === "required",
    },
    {
      id: "mixed-bug-release", request: "Fix the retry bug and deploy the repair", profile: "production",
      check: (route, classification) => classification.taskType === "bug" && route.skillPhases[1].primary === "valdris-bug-rca" && route.skillPhases[1].supporting.includes("valdris-platform-release") && route.gateApplicability.smoke.status === "required",
    },
    {
      id: "api-client-library", request: "Update API client library", profile: "production",
      check: (route, classification) => classification.primaryArchetype === "library-cli" && route.productionLayers.filter((layer) => layer.initialApplicability === "required").length < 13,
    },
    {
      id: "web-api-full-stack", request: "Build web app with API backend", profile: "production",
      check: (route) => route.productionLayers.every((layer) => layer.initialApplicability === "required"),
    },
    {
      id: "static-landing", request: "Update the static landing page", profile: "production",
      check: (route) => route.productionLayers.find((layer) => layer.layer === "frontend")?.initialApplicability === "required" && route.productionLayers.find((layer) => layer.layer === "backend-api-logic")?.initialApplicability !== "required" && route.productionLayers.find((layer) => layer.layer === "auth-permissions-rls")?.initialApplicability !== "required",
    },
    {
      id: "temporal-workflow", request: "Add a Temporal workflow", profile: "production",
      check: (route, classification) => classification.crossCuttingConcerns.includes("async-workflow-orchestration") && route.skillPhases[1].supporting.includes("valdris-architecture-refactor") && route.skillPhases[1].supporting.includes("valdris-platform-release"),
    },
    {
      id: "rbac", request: "Add RBAC", profile: "production",
      check: (route, classification) => classification.crossCuttingConcerns.includes("identity-access-governance") && route.skillPhases[1].supporting.includes("valdris-security-audit") && !classification.workloadProfiles.includes("saas"),
    },
    {
      id: "loan-decision", request: "Build a loan application decision system", profile: "production",
      check: (route, classification) => classification.effectiveTier === "T3" && classification.crossCuttingConcerns.includes("regulated-decision-governance") && route.skillPhases[1].supporting.includes("valdris-security-audit"),
    },
  ];
  for (const regression of routingRegressions) {
    const routeRoot = path.join(tempRoot, `route-regression-${regression.id}`);
    await mkdir(routeRoot, { recursive: true });
    await run(node, ["scripts/route-request.mjs", "--repo", routeRoot, "--run-id", `REGRESSION-${regression.id}`, "--profile", regression.profile, "--request", regression.request]);
    const route = JSON.parse(await readFile(path.join(routeRoot, "run", "route.json"), "utf8"));
    const classification = JSON.parse(await readFile(path.join(routeRoot, "run", "workload-classification.json"), "utf8"));
    const intake = JSON.parse(await readFile(path.join(routeRoot, "run", "intake.json"), "utf8"));
    await run(node, ["scripts/intake-gate.mjs", "--repo", routeRoot]);
    await run(node, ["scripts/workload-classification-gate.mjs", "--repo", routeRoot]);
    await run(node, ["scripts/route-gate.mjs", "--repo", routeRoot]);
    assert(regression.check(route, classification, intake), `route regression failed: ${regression.id}`);
  }

  await mkdir(pyTarget, { recursive: true });
  await writeFile(path.join(pyTarget, "AGENTS.md"), "# Existing agent rules\n\nKeep this content.\n", "utf8");
  await writeFile(path.join(pyTarget, "CLAUDE.md"), "# Existing Claude rules\n\nKeep this content.\n", "utf8");
  await writeFile(path.join(pyTarget, "pyproject.toml"), "[project]\nname = \"sample\"\nversion = \"0.0.1\"\n", "utf8");
  await run(node, ["scripts/commission-harness.mjs", "--repo", pyTarget, "--project-name", "PyProject Only", "--out", pyPack, "--yes"]);
  const pyAdapter = JSON.parse(await readFile(path.join(pyPack, "project-adapter.json"), "utf8"));
  assert(!String(pyAdapter.validation.install).includes("requirements.txt"), "pyproject-only install command should not reference requirements.txt");
  const mergedAgents = await readFile(path.join(pyTarget, "AGENTS.md"), "utf8");
  const mergedClaude = await readFile(path.join(pyTarget, "CLAUDE.md"), "utf8");
  assert(mergedAgents.startsWith("# Existing agent rules") && mergedAgents.includes(".valdris-harness/AGENTS.md"), "commissioning did not preserve and merge an existing root AGENTS.md");
  assert(mergedClaude.startsWith("# Existing Claude rules") && mergedClaude.includes("@.valdris-harness/CLAUDE.md"), "commissioning did not preserve and merge an existing root CLAUDE.md");

  await mkdir(path.join(loaderConflictTarget, "AGENTS.md"), { recursive: true });
  let unsafeLoaderBlocked = false;
  try {
    await run(node, ["scripts/commission-harness.mjs", "--repo", loaderConflictTarget, "--project-name", "Unsafe Loader", "--yes"]);
  } catch (error) {
    unsafeLoaderBlocked = error.message.includes("Cannot install Valdris discovery loader") && error.message.includes("regular file");
  }
  assert(unsafeLoaderBlocked, "commissioning did not block an unsafe target-root discovery-loader path");

  await mkdir(malformedLoaderTarget, { recursive: true });
  await writeFile(path.join(malformedLoaderTarget, "AGENTS.md"), "<!-- valdris-sdlc-harness-loader:start -->\nmalformed block\n", "utf8");
  let malformedLoaderBlocked = false;
  try {
    await run(node, ["scripts/commission-harness.mjs", "--repo", malformedLoaderTarget, "--project-name", "Malformed Loader", "--yes"]);
  } catch (error) {
    malformedLoaderBlocked = error.message.includes("malformed or duplicate Valdris loader markers");
  }
  assert(malformedLoaderBlocked, "commissioning did not block malformed target-root discovery-loader markers");

  await mkdir(atomicLoaderTarget, { recursive: true });
  const atomicOriginals = {
    "AGENTS.md": "# Atomic agent rules\n",
    "CLAUDE.md": "# Atomic Claude rules\n",
  };
  for (const [fileName, content] of Object.entries(atomicOriginals)) await writeFile(path.join(atomicLoaderTarget, fileName), content, "utf8");
  const stalePlans = ["AGENTS.md", "CLAUDE.md"].map((fileName) => planRootDiscoveryLoader(atomicLoaderTarget, fileName));
  await writeFile(path.join(atomicLoaderTarget, "CLAUDE.md"), "# Concurrent Claude edit\n", "utf8");
  let staleLoaderPlanBlocked = false;
  try { installRootDiscoveryLoaders(stalePlans); }
  catch (error) { staleLoaderPlanBlocked = error.message.includes("changed after commissioning inspection") && error.message.includes("content digest differs"); }
  assert(staleLoaderPlanBlocked, "commissioning did not reject a loader changed after its plan was created");
  assert(await readFile(path.join(atomicLoaderTarget, "AGENTS.md"), "utf8") === atomicOriginals["AGENTS.md"], "stale loader-plan rejection partially wrote the other loader");
  await writeFile(path.join(atomicLoaderTarget, "CLAUDE.md"), atomicOriginals["CLAUDE.md"], "utf8");
  const rollbackPlans = ["AGENTS.md", "CLAUDE.md"].map((fileName) => planRootDiscoveryLoader(atomicLoaderTarget, fileName));
  let atomicRollbackPassed = false;
  try {
    installRootDiscoveryLoaders(rollbackPlans, { beforeReplace: (_plan, index) => { if (index === 1) throw new Error("synthetic second-loader failure"); } });
  } catch (error) {
    atomicRollbackPassed = error.message.includes("synthetic second-loader failure");
  }
  assert(atomicRollbackPassed, "synthetic second-loader failure did not reach the transactional rollback path");
  for (const [fileName, content] of Object.entries(atomicOriginals)) {
    assert(await readFile(path.join(atomicLoaderTarget, fileName), "utf8") === content, `two-loader rollback did not restore ${fileName}`);
  }
  const concurrentRollbackPlans = ["AGENTS.md", "CLAUDE.md"].map((fileName) => planRootDiscoveryLoader(atomicLoaderTarget, fileName));
  const concurrentAgentEdit = "# Concurrent edit after first loader replacement\n";
  let concurrentRollbackConflictPreserved = false;
  try {
    installRootDiscoveryLoaders(concurrentRollbackPlans, { beforeReplace: (_plan, index) => {
      if (index === 1) {
        writeFileSync(path.join(atomicLoaderTarget, "AGENTS.md"), concurrentAgentEdit, "utf8");
        throw new Error("synthetic concurrent rollback conflict");
      }
    } });
  } catch (error) {
    concurrentRollbackConflictPreserved = error.message.includes("rollback conflict") && error.message.includes("preserving current content");
  }
  assert(concurrentRollbackConflictPreserved, "rollback did not report a concurrent edit conflict");
  assert(await readFile(path.join(atomicLoaderTarget, "AGENTS.md"), "utf8") === concurrentAgentEdit, "rollback overwrote a concurrent edit to the first loader");

  await mkdir(path.join(iosTarget, "apps", "mobile", "clients", "apple", "ios", "ValdrisGame.xcodeproj"), { recursive: true });
  await writeFile(path.join(iosTarget, "Package.swift"), "// swift-tools-version: 6.0\n", "utf8");
  await run(node, ["scripts/commission-harness.mjs", "--repo", iosTarget, "--project-name", "Valdris iOS Game", "--out", iosPack, "--yes"]);
  const iosAdapter = JSON.parse(await readFile(path.join(iosPack, "project-adapter.json"), "utf8"));
  assert(iosAdapter.detected.frameworks.includes("Xcode/iOS") && iosAdapter.mobileIos?.detected === true, "iOS/Xcode repo detection missing");
  assert(iosAdapter.codeGraph.scanCommand.includes(".valdris-harness/scripts") && iosAdapter.finishLineAssurance.gateCommand.includes(".valdris-harness/scripts"), "nested adapter commands do not point at the installed pack");
  assert(iosAdapter.workloadTaxonomy.gateCommand.includes(".valdris-harness/scripts") && iosAdapter.foundationAssurance.gateCommand.includes(".valdris-harness/scripts"), "nested Layer 0 adapter commands do not point at the installed pack");
  assert(iosAdapter.validation.knowledge.includes(".valdris-harness/scripts") && iosAdapter.validation.finishLine.includes(".valdris-harness/scripts"), "nested adapter validation commands are not target-root-relative");
  assert(String(iosAdapter.validation.build).includes("xcodebuild archive") && String(iosAdapter.validation.test).includes("xcodebuild test"), "iOS macOS-runner validation commands missing");
  const iosRequest = "Build a multiplayer iOS game with an AI dungeon master, accounts, purchases, cloud saves, matchmaking, minors, and ship it to TestFlight.";
  await run(node, ["scripts/route-request.mjs", "--repo", iosTarget, "--run-id", "IOS-ROUTE-VERIFY", "--profile", "enterprise", "--environment", "verification", "--actor", "verification-owner", "--request", iosRequest]);
  await run(node, [path.join(iosPack, "scripts", "workload-classification-gate.mjs"), "--repo", iosTarget], { cwd: iosTarget });
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
  assert(iosGeneratedPackage.scripts["intake:gate"].includes('repo ".."') && iosGeneratedPackage.scripts["classification:gate"].includes('repo ".."') && iosGeneratedPackage.scripts["foundation:gate"].includes('repo ".."') && iosGeneratedPackage.scripts["route:gate"].includes('repo ".."') && iosGeneratedPackage.scripts["goal:gate:active"] && iosGeneratedPackage.scripts["run:accept"].includes('repo ".."'), "nested package scripts do not target the application repo or support active-start and hydrated acceptance");
  const iosWorkflow = await readFile(path.join(iosPack, ".github", "workflows", "valdris-assurance.yml"), "utf8");
  const iosAcceptanceWorkflow = await readFile(path.join(iosPack, ".github", "workflows", "valdris-run-acceptance.yml"), "utf8");
  assert(iosWorkflow.includes(".valdris-harness/scripts") && iosWorkflow.includes("catalog-integrity-gate.mjs") && iosWorkflow.includes("persist-credentials: false") && !iosWorkflow.includes("run-packet-gate.mjs") && !iosWorkflow.includes("UASH_REVIEW_TRUST_SHA256"), "nested always-on CI must be structural, credential-free, and independent of run artifacts");
  assert(iosAcceptanceWorkflow.includes("environment: valdris-run-acceptance") && iosAcceptanceWorkflow.includes("run-acceptance.mjs") && iosAcceptanceWorkflow.includes("Validate exact source commit input") && iosAcceptanceWorkflow.indexOf("Validate exact source commit input") < iosAcceptanceWorkflow.indexOf("uses: actions/checkout@v4") && iosAcceptanceWorkflow.includes("ref: ${{ inputs.source_commit }}") && iosAcceptanceWorkflow.includes("VALDRIS_ARTIFACT_BUNDLE: ${{ runner.temp }}/valdris-run-artifacts") && iosAcceptanceWorkflow.includes("fetch-depth: 0") && iosAcceptanceWorkflow.includes("persist-credentials: false") && !iosAcceptanceWorkflow.split(/\r?\n/).some((line) => line.trimStart().startsWith("run:") && line.includes("${{")), "nested explicit run acceptance workflow is missing injection-safe exact-source validation, protected-environment hydration, or checkout hardening");
  const iosValidationDoc = await readFile(path.join(iosPack, "docs", "Validation Commands.md"), "utf8");
  assert(iosValidationDoc.includes(".valdris-harness/scripts") && iosValidationDoc.includes("catalog-integrity-gate.mjs") && iosValidationDoc.includes("intake-gate.mjs") && iosValidationDoc.includes("workload-classification-gate.mjs") && iosValidationDoc.includes("route-gate.mjs") && iosValidationDoc.includes("foundation-gate.mjs") && iosValidationDoc.includes("goal-gate.mjs") && iosValidationDoc.includes("--repo .valdris-harness") && iosValidationDoc.includes("run-acceptance.mjs") && iosValidationDoc.includes("valdris.run-artifact-bundle.v1"), "generated validation document uses pack-root commands or omits catalog integrity, active-start, or hydrated acceptance gates in a nested install");
  await run(node, [path.join(iosPack, "scripts", "okf-vault-gate.mjs"), "--repo", iosPack], { cwd: iosTarget });
  await run(node, [path.join(iosPack, "scripts", "skill-registry-gate.mjs"), "--repo", iosPack], { cwd: iosTarget });
  await run("git", ["init"], { cwd: iosTarget });
  await run("git", ["config", "user.name", "Valdris Harness Verifier"], { cwd: iosTarget });
  await run("git", ["config", "user.email", "verifier@example.invalid"], { cwd: iosTarget });
  await run("git", ["config", "core.autocrlf", "false"], { cwd: iosTarget });
  await run("git", ["add", ".valdris-harness", "AGENTS.md", "CLAUDE.md"], { cwd: iosTarget });
  await run("git", ["commit", "-m", "test: commit iOS commissioned runtime"], { cwd: iosTarget });
  await mkdir(nonAiIosTarget, { recursive: true });
  await run(node, ["scripts/route-request.mjs", "--repo", nonAiIosTarget, "--run-id", "IOS-NONAI-VERIFY", "--profile", "enterprise", "--environment", "verification", "--actor", "verification-owner", "--request", "Build a full-stack iOS game with accounts and ship it to TestFlight."]);
  await run(node, ["scripts/route-gate.mjs", "--repo", nonAiIosTarget]);
  const nonAiRoute = JSON.parse(await readFile(path.join(nonAiIosTarget, "run", "route.json"), "utf8"));
  assert(nonAiRoute.ai.workloadDetected === false && nonAiRoute.ai.aiProfile === "AI-0", "non-AI iOS route was misclassified or rejected");

  await run(node, ["scripts/verify-bridge-lease.mjs"]);

  bridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, UASH_BRIDGE_PORT: String(port), UASH_DATA_DIR: dataDir, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN, UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY, UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bridgeLog = "";
  bridge.stdout.on("data", (chunk) => (bridgeLog += chunk));
  bridge.stderr.on("data", (chunk) => (bridgeLog += chunk));

  const health = await waitForHealth(port);
  assert(health.ok, "bridge health did not return ok");
  assert(health.contractVersion === "uash.connector-events.v0.5", "bridge contract version mismatch");
  assert(health.listenMode === "loopback", "unauthenticated health did not disclose only the bounded listen mode");
  const unauthenticatedHealthText = JSON.stringify(health);
  assert(!Object.hasOwn(health, "dataDir") && !Object.hasOwn(health, "repoRoot")
    && !unauthenticatedHealthText.includes(path.resolve(dataDir))
    && !unauthenticatedHealthText.includes(path.resolve(root)),
  "unauthenticated health disclosed absolute local topology");
  const detailedHealthResponse = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-uash-bridge-token": VERIFY_BRIDGE_ACCESS_TOKEN } });
  const detailedHealth = await detailedHealthResponse.json();
  assert(detailedHealthResponse.status === 200 && detailedHealth.proofSchema === "uash.proof.v1" && detailedHealth.adapterAware && detailedHealth.bridgeAccessTokenConfigured && detailedHealth.bridgeIntegrityKeyConfigured && detailedHealth.humanApprovalTokenConfigured && detailedHealth.reviewTrustSha256Configured, "authenticated bridge hardening metadata missing");
  assert(detailedHealth.nodeIds.includes("code-intelligence") && detailedHealth.nodeIds.includes("design-anchors"), "Code Intelligence/design anchor nodes missing from authenticated bridge health");
  const unauthenticatedRuns = await fetch(`http://127.0.0.1:${port}/runs`);
  assert(unauthenticatedRuns.status === 401, "run reads were exposed without x-uash-bridge-token");
  const unauthenticatedMutation = await fetch(`http://127.0.0.1:${port}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"id":"VERIFY-UNAUTHENTICATED"}' });
  assert(unauthenticatedMutation.status === 401, "run writes were accepted without x-uash-bridge-token");
  const wrongAccessToken = await fetch(`http://127.0.0.1:${port}/runs`, { headers: { "x-uash-bridge-token": "verify-wrong-access-token" } });
  assert(wrongAccessToken.status === 401, "run reads were accepted with an invalid bridge access token");
  const disallowedOrigin = await fetch(`http://127.0.0.1:${port}/health`, { headers: { origin: "https://untrusted.example" } });
  assert(disallowedOrigin.status === 403 && !disallowedOrigin.headers.get("access-control-allow-origin"), "untrusted browser origin received bridge CORS access");
  const loopbackOrigin = await fetch(`http://127.0.0.1:${port}/health`, { headers: { origin: "http://localhost:3000" } });
  assert(loopbackOrigin.status === 200 && loopbackOrigin.headers.get("access-control-allow-origin") === "http://localhost:3000", "loopback UI origin was not granted exact-origin CORS access");

  const competingBridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, UASH_BRIDGE_PORT: String(port + 1), UASH_DATA_DIR: dataDir, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN, UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY, UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let competingBridgeLog = "";
  competingBridge.stdout.on("data", (chunk) => (competingBridgeLog += chunk));
  competingBridge.stderr.on("data", (chunk) => (competingBridgeLog += chunk));
  const competingExit = await waitForExit(competingBridge);
  if (!competingExit.exited) await stopProcess(competingBridge);
  assert(competingExit.exited && competingExit.code !== 0 && competingBridgeLog.includes("already leased by another bridge process"), "second bridge process was not blocked from sharing UASH_DATA_DIR");

  const legacyDataDir = path.join(tempRoot, "legacy-runs");
  await mkdir(path.join(legacyDataDir, "LEGACY-RUN"), { recursive: true });
  await writeFile(path.join(legacyDataDir, "LEGACY-RUN", "run.json"), '{"id":"LEGACY-RUN"}\n', "utf8");
  const hashShapedLegacyRunId = `run-${"a".repeat(64)}`;
  await mkdir(path.join(legacyDataDir, hashShapedLegacyRunId), { recursive: true });
  await writeFile(path.join(legacyDataDir, hashShapedLegacyRunId, "run.json"), `${JSON.stringify({ id: hashShapedLegacyRunId })}\n`, "utf8");
  const eventOnlyLegacyDirectory = `run-${"b".repeat(64)}`;
  await mkdir(path.join(legacyDataDir, eventOnlyLegacyDirectory), { recursive: true });
  await writeFile(path.join(legacyDataDir, eventOnlyLegacyDirectory, "events.jsonl"), '{"event":{"runId":"LEGACY-EVENT-ONLY"}}\n', "utf8");
  const legacyBridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
    cwd: root,
    env: { ...process.env, UASH_BRIDGE_PORT: String(port + 2), UASH_DATA_DIR: legacyDataDir, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN, UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY, UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let legacyBridgeLog = "";
  legacyBridge.stdout.on("data", (chunk) => (legacyBridgeLog += chunk));
  legacyBridge.stderr.on("data", (chunk) => (legacyBridgeLog += chunk));
  const legacyExit = await waitForExit(legacyBridge);
  if (!legacyExit.exited) await stopProcess(legacyBridge);
  assert(legacyExit.exited && legacyExit.code !== 0
    && legacyBridgeLog.includes("legacy bridge state requires explicit archival")
    && legacyBridgeLog.includes(hashShapedLegacyRunId)
    && legacyBridgeLog.includes(eventOnlyLegacyDirectory),
  "pre-v0.8 raw, hash-shaped, or event-only state did not trigger the explicit migration boundary");

  const keylessEnv = cleanVerifierEnv({
    UASH_BRIDGE_PORT: String(port + 3),
    UASH_DATA_DIR: path.join(tempRoot, "keyless-runs"),
    UASH_REVIEW_TRUST_SHA256: VERIFY_REVIEW_TRUST_SHA256,
  });
  const keylessBridge = spawn(node, ["scripts/claude-code-bridge.mjs"], { cwd: root, env: keylessEnv, stdio: ["ignore", "pipe", "pipe"] });
  let keylessBridgeLog = "";
  keylessBridge.stdout.on("data", (chunk) => (keylessBridgeLog += chunk));
  keylessBridge.stderr.on("data", (chunk) => (keylessBridgeLog += chunk));
  const keylessExit = await waitForExit(keylessBridge);
  if (!keylessExit.exited) await stopProcess(keylessBridge);
  assert(keylessExit.exited && keylessExit.code !== 0 && keylessBridgeLog.includes("UASH_BRIDGE_INTEGRITY_KEY is required for bridge run integrity"), "bridge did not fail closed when the operator integrity key was absent");

  for (const [label, reviewTrustValue, expectedText, offset] of [
    ["missing", undefined, "UASH_REVIEW_TRUST_SHA256 is required", 10],
    ["malformed", "not-a-sha256-digest", "UASH_REVIEW_TRUST_SHA256 must be a 64-character SHA-256 digest", 11],
  ]) {
    const reviewTrustEnv = cleanVerifierEnv({
      UASH_BRIDGE_PORT: String(port + offset),
      UASH_DATA_DIR: path.join(tempRoot, `${label}-review-trust-pin`),
      UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN,
      UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY,
      UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN,
    });
    if (reviewTrustValue === undefined) delete reviewTrustEnv.UASH_REVIEW_TRUST_SHA256;
    else reviewTrustEnv.UASH_REVIEW_TRUST_SHA256 = reviewTrustValue;
    const reviewTrustBridge = spawn(node, ["scripts/claude-code-bridge.mjs"], { cwd: root, env: reviewTrustEnv, stdio: ["ignore", "pipe", "pipe"] });
    let reviewTrustBridgeLog = "";
    reviewTrustBridge.stdout.on("data", (chunk) => (reviewTrustBridgeLog += chunk));
    reviewTrustBridge.stderr.on("data", (chunk) => (reviewTrustBridgeLog += chunk));
    const reviewTrustExit = await waitForExit(reviewTrustBridge);
    if (!reviewTrustExit.exited) await stopProcess(reviewTrustBridge);
    assert(reviewTrustExit.exited && reviewTrustExit.code !== 0 && reviewTrustBridgeLog.includes(expectedText), `bridge accepted ${label} operator review trust pin`);
  }

  for (const [index, weakName] of ["UASH_BRIDGE_INTEGRITY_KEY", "UASH_BRIDGE_ACCESS_TOKEN", "UASH_HUMAN_APPROVAL_TOKEN"].entries()) {
    const weakBridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
      cwd: root,
      env: cleanVerifierEnv({
        UASH_BRIDGE_PORT: String(port + 7 + index),
        UASH_DATA_DIR: path.join(tempRoot, `weak-credential-${index}`),
        UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN,
        UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY,
        UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN,
        UASH_REVIEW_TRUST_SHA256: VERIFY_REVIEW_TRUST_SHA256,
        [weakName]: `weak-${index}`,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let weakBridgeLog = "";
    weakBridge.stdout.on("data", (chunk) => (weakBridgeLog += chunk));
    weakBridge.stderr.on("data", (chunk) => (weakBridgeLog += chunk));
    const weakExit = await waitForExit(weakBridge);
    if (!weakExit.exited) await stopProcess(weakBridge);
    assert(weakExit.exited && weakExit.code !== 0
      && weakBridgeLog.includes(weakName)
      && weakBridgeLog.includes("at least 32 bytes"),
    `${weakName} accepted weak secret material`);
  }

  const credentialCases = [
    ["UASH_BRIDGE_ACCESS_TOKEN", "UASH_HUMAN_APPROVAL_TOKEN"],
    ["UASH_BRIDGE_ACCESS_TOKEN", "UASH_BRIDGE_INTEGRITY_KEY"],
    ["UASH_HUMAN_APPROVAL_TOKEN", "UASH_BRIDGE_INTEGRITY_KEY"],
  ];
  for (const [leftName, rightName] of credentialCases) {
    const equalValue = `verify-equal-${leftName.toLowerCase()}-${rightName.toLowerCase()}`;
    const credentials = {
      UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN,
      UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY,
      UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN,
      [leftName]: equalValue,
      [rightName]: equalValue,
    };
    const equalBridge = spawn(node, ["scripts/claude-code-bridge.mjs"], {
      cwd: root,
      env: cleanVerifierEnv({
        ...credentials,
        UASH_REVIEW_TRUST_SHA256: VERIFY_REVIEW_TRUST_SHA256,
        UASH_BRIDGE_PORT: String(port + 4 + credentialCases.findIndex((entry) => entry[0] === leftName && entry[1] === rightName)),
        UASH_DATA_DIR: path.join(tempRoot, `equal-credentials-${leftName}-${rightName}`),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let equalBridgeLog = "";
    equalBridge.stdout.on("data", (chunk) => (equalBridgeLog += chunk));
    equalBridge.stderr.on("data", (chunk) => (equalBridgeLog += chunk));
    const equalExit = await waitForExit(equalBridge);
    if (!equalExit.exited) await stopProcess(equalBridge);
    assert(equalExit.exited && equalExit.code !== 0
      && equalBridgeLog.includes("bridge credentials must be pairwise distinct")
      && equalBridgeLog.includes(leftName)
      && equalBridgeLog.includes(rightName),
    `${leftName} and ${rightName} credential reuse did not fail closed`);
  }
  const sanitizedGateEnv = finishLineChildEnv({
    SAFE_SENTINEL: "preserved",
    UASH_REVIEW_TRUST_SHA256: VERIFY_REVIEW_TRUST_SHA256,
    UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN,
    UASH_BRIDGE_INTEGRITY_KEY: VERIFY_BRIDGE_INTEGRITY_KEY,
    UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN,
  });
  assert(sanitizedGateEnv.SAFE_SENTINEL === "preserved"
    && sanitizedGateEnv.UASH_REVIEW_TRUST_SHA256 === VERIFY_REVIEW_TRUST_SHA256
    && !Object.prototype.hasOwnProperty.call(sanitizedGateEnv, "UASH_BRIDGE_ACCESS_TOKEN")
    && !Object.prototype.hasOwnProperty.call(sanitizedGateEnv, "UASH_BRIDGE_INTEGRITY_KEY")
    && !Object.prototype.hasOwnProperty.call(sanitizedGateEnv, "UASH_HUMAN_APPROVAL_TOKEN"),
  "finish-line child environment retained a bridge credential or removed the nonsecret review trust pin/unrelated environment state");

  const orphanRunId = "VERIFY-CONFIG-ORPHAN-RECOVERY";
  const originalOrphan = await postRun(port, { id: orphanRunId });
  const orphanRunDir = bridgeRunDir(dataDir, orphanRunId);
  const originalOrphanConfig = await readFile(path.join(orphanRunDir, "run-config.json"), "utf8");
  await rm(path.join(orphanRunDir, "run.json"), { force: true });
  const recoveredOrphan = await postRun(port, { id: orphanRunId });
  assert(recoveredOrphan.id === orphanRunId && recoveredOrphan.createdAt === originalOrphan.createdAt && existsSync(path.join(orphanRunDir, "run.json")), "config-only creation crash orphan was not recovered safely on retry");
  assert(await readFile(path.join(orphanRunDir, "run-config.json"), "utf8") === originalOrphanConfig, "config-only recovery replaced the authenticated immutable creation record");

  const idempotentRunId = "VERIFY-IDEMPOTENT-CREATE";
  const idempotentBody = { id: idempotentRunId, title: "Idempotent sync", task: "Prove retry-safe run creation" };
  const firstCreate = await postRun(port, idempotentBody);
  const replayedCreate = await postRun(port, idempotentBody);
  assert(replayedCreate.idempotentReplay === true && replayedCreate.createdAt === firstCreate.createdAt, "ordinary POST /runs retry was not idempotent");
  const conflictingCreate = await postRun(port, { ...idempotentBody, title: "Conflicting sync" }, 409);
  assert(conflictingCreate.error === "run_already_exists", "conflicting POST /runs retry did not fail explicitly");
  const invalidScalarRunId = "VERIFY-INVALID-CREATE-SCALAR";
  const invalidScalarCreate = await postRun(port, { id: invalidScalarRunId, title: "" }, 400);
  const invalidScalarRetry = await postRun(port, { id: invalidScalarRunId, title: "" }, 400);
  assert(invalidScalarCreate.error === "run_creation_contract_violation"
    && invalidScalarRetry.error === "run_creation_contract_violation"
    && !existsSync(bridgeRunDir(dataDir, invalidScalarRunId)),
  "empty run-creation scalar was normalized into non-idempotent persisted state");
  const objectScalarCreate = await postRun(port, { id: "VERIFY-OBJECT-CREATE-SCALAR", task: { unsafe: true } }, 400);
  assert(objectScalarCreate.error === "run_creation_contract_violation", "object-valued run-creation scalar was accepted");
  const invalidCreationContractCases = [
    ["MODE", { mode: "turbo" }],
    ["RUN-MODE", { runMode: "turbo" }],
    ["MODE-ALIAS-CONFLICT", { mode: "live", runMode: "replay" }],
    ["EVENT-SOURCE", { eventSource: "untrusted-webhook" }],
    ["CLIENT-STATUS", { status: "running" }],
  ];
  for (const [suffix, body] of invalidCreationContractCases) {
    const invalidContractRunId = `VERIFY-INVALID-CREATE-${suffix}`;
    const invalidContractCreate = await postRun(port, { id: invalidContractRunId, ...body }, 400);
    assert(invalidContractCreate.error === "run_creation_contract_violation"
      && !existsSync(bridgeRunDir(dataDir, invalidContractRunId)),
    `invalid run-creation contract case ${suffix} was accepted or persisted`);
  }
  const matchingModeAliases = await postRun(port, { id: "VERIFY-MATCHING-MODE-ALIASES", mode: "live", runMode: "live", eventSource: "api" });
  assert(matchingModeAliases.mode === "live" && matchingModeAliases.eventSource === "api", "matching supported mode aliases or supported eventSource were rejected");

  const commissionedOrphanRunId = "VERIFY-COMMISSIONED-CONFIG-ORPHAN-RECOVERY";
  const originalCommissionedOrphan = await postRun(port, { id: commissionedOrphanRunId, artifactRoot: iosTarget });
  assert(originalCommissionedOrphan.commissionedRuntime && originalCommissionedOrphan.adapterPolicy?.portableFinishLineRequired, "commissioned orphan fixture did not bind the v0.8 runtime");
  const commissionedOrphanRunDir = bridgeRunDir(dataDir, commissionedOrphanRunId);
  const originalCommissionedOrphanConfig = await readFile(path.join(commissionedOrphanRunDir, "run-config.json"), "utf8");
  await rm(path.join(commissionedOrphanRunDir, "run.json"), { force: true });
  const recoveredCommissionedOrphan = await postRun(port, { id: commissionedOrphanRunId });
  const persistedCommissionedOrphan = await (await bridgeFetch(port, `/runs/${commissionedOrphanRunId}`)).json();
  for (const [label, expected, actual] of [
    ["createdAt", originalCommissionedOrphan.createdAt, recoveredCommissionedOrphan.createdAt],
    ["artifactRoot", originalCommissionedOrphan.artifactRoot, recoveredCommissionedOrphan.artifactRoot],
    ["adapterPath", originalCommissionedOrphan.adapterPath, recoveredCommissionedOrphan.adapterPath],
    ["adapterPolicy", originalCommissionedOrphan.adapterPolicy, recoveredCommissionedOrphan.adapterPolicy],
    ["commissionedRuntime", originalCommissionedOrphan.commissionedRuntime, recoveredCommissionedOrphan.commissionedRuntime],
  ]) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `commissioned config-only recovery downgraded ${label}`);
    assert(JSON.stringify(persistedCommissionedOrphan[label]) === JSON.stringify(expected), `commissioned config-only recovery response and persisted ${label} diverged`);
  }
  assert(await readFile(path.join(commissionedOrphanRunDir, "run-config.json"), "utf8") === originalCommissionedOrphanConfig, "commissioned config-only recovery replaced the authenticated immutable creation record");
  const { humanApprovalTokenRequired: _tokenRequired, humanApprovalTokenNotice: _tokenNotice, ...recoveredCommissionedPersistedShape } = recoveredCommissionedOrphan;
  const {
    eventPage: commissionedOrphanEventPage,
    eventCount: commissionedOrphanEventCount,
    eventsTruncated: commissionedOrphanEventsTruncated,
    approvalCount: commissionedOrphanApprovalCount,
    approvalsTruncated: commissionedOrphanApprovalsTruncated,
    ...persistedCommissionedCoreShape
  } = persistedCommissionedOrphan;
  assert(JSON.stringify(recoveredCommissionedPersistedShape) === JSON.stringify(persistedCommissionedCoreShape), "commissioned config-only recovery HTTP response did not match the persisted run core");
  assert(commissionedOrphanEventCount === 0
    && commissionedOrphanEventsTruncated === false
    && commissionedOrphanApprovalCount === 0
    && commissionedOrphanApprovalsTruncated === false
    && commissionedOrphanEventPage?.offset === 0
    && commissionedOrphanEventPage?.returned === 0
    && commissionedOrphanEventPage?.total === 0,
  "commissioned config-only recovery returned invalid bounded-history metadata");

  const canonicalIdRun = await postRun(port, { id: "VERIFY_ID_ALIAS" });
  assert(canonicalIdRun.id === "VERIFY_ID_ALIAS", "canonical run ID was not accepted");
  const invalidRunId = await postRun(port, { id: "VERIFY/ID/ALIAS" }, 400);
  assert(invalidRunId.error === "invalid_run_id", "lossy run-ID alias was not rejected at creation");
  const invalidEventRunId = await postEvent(port, "VERIFY/ID/ALIAS", baseEvent("node.entered", "intake", "reject colliding run ID", { actor: "harness" }), 400);
  assert(invalidEventRunId.error === "invalid_run_id", "lossy run-ID alias was not rejected before event locking/storage");

  const duplicateRunId = "VERIFY-DUPLICATE-EVENT";
  await postRun(port, { id: duplicateRunId });
  const duplicateEvent = baseEvent("node.entered", "intake", "deduplicate event ID", { id: `${duplicateRunId}-event`, actor: "harness" });
  await postEvent(port, duplicateRunId, duplicateEvent);
  const duplicateRejected = await postEvent(port, duplicateRunId, duplicateEvent, 409);
  assertProblem(duplicateRejected, "event.id already exists", "duplicate event ID");
  const duplicateRun = await (await bridgeFetch(port, `/runs/${duplicateRunId}`)).json();
  assert(duplicateRun.events?.filter((event) => event.id === duplicateEvent.id).length === 1, "duplicate event rejection quarantined or duplicated the run journal");

  const invalidEventIdRunId = "VERIFY-INVALID-EVENT-ID";
  await postRun(port, { id: invalidEventIdRunId });
  const invalidEventId = await postEvent(port, invalidEventIdRunId, baseEvent("node.entered", "intake", "reject object event ID", { id: { poison: true }, actor: "harness" }), 400);
  assertProblem(invalidEventId, "event.id must be a non-empty string", "non-string event ID");
  const validAfterInvalidId = await postEvent(port, invalidEventIdRunId, baseEvent("node.entered", "intake", "journal remains usable", { id: `${invalidEventIdRunId}-valid`, actor: "harness" }));
  assert(validAfterInvalidId.run.events?.length === 1, "invalid event ID poisoned the authenticated journal before rejection");

  const firstRootRunId = "VERIFY-FIRST-NONCOMMISSIONED-ROOT";
  const firstRoot = path.join(tempRoot, "first-noncommissioned-root");
  const changedRoot = path.join(tempRoot, "changed-noncommissioned-root");
  await mkdir(firstRoot, { recursive: true });
  await mkdir(changedRoot, { recursive: true });
  await postRun(port, { id: firstRootRunId });
  const firstRootSnapshotPath = path.join(bridgeRunDir(dataDir, firstRootRunId), "run.json");
  const rootlessSnapshot = await readFile(firstRootSnapshotPath, "utf8");
  const firstRootEvent = await postEvent(port, firstRootRunId, baseEvent("node.entered", "intake", "bind ordinary artifact root", { id: `${firstRootRunId}-first`, artifactRoot: firstRoot, actor: "harness" }));
  assert(path.resolve(firstRootEvent.run.artifactRoot) === path.resolve(firstRoot), "first noncommissioned artifactRoot was not sealed before journal append");
  await writeFile(firstRootSnapshotPath, rootlessSnapshot, "utf8");
  const recoveredFirstRoot = await (await bridgeFetch(port, `/runs/${firstRootRunId}`)).json();
  assert(path.resolve(recoveredFirstRoot.artifactRoot) === path.resolve(firstRoot) && recoveredFirstRoot.events?.length === 1, "noncommissioned first-event root seal did not recover from snapshot lag");
  const firstRootJournalPath = path.join(bridgeRunDir(dataDir, firstRootRunId), "events.jsonl");
  const rootJournalBeforeChange = await readFile(firstRootJournalPath, "utf8");
  const changedRootBlocked = await postEvent(port, firstRootRunId, baseEvent("node.entered", "intake", "reject root mutation", { id: `${firstRootRunId}-changed`, artifactRoot: changedRoot, actor: "harness" }), 409);
  assertProblem(changedRootBlocked, "artifactRoot cannot change", "later noncommissioned artifactRoot change");
  assert(await readFile(firstRootJournalPath, "utf8") === rootJournalBeforeChange, "rejected artifactRoot mutation appended a journal record");

  const authTamperRunId = "VERIFY-AUTH-SNAPSHOT-TAMPER";
  await postRun(port, { id: authTamperRunId });
  await postEvent(port, authTamperRunId, baseEvent("approval.requested", "redzone", "request authenticated approval", { status: "needs_approval", approvalOwner: "security-owner", approvalScope: "snapshot-integrity" }));
  const authTamperRunPath = path.join(bridgeRunDir(dataDir, authTamperRunId), "run.json");
  const authTamperSource = await readFile(authTamperRunPath, "utf8");
  const authTamperSnapshot = JSON.parse(authTamperSource);
  authTamperSnapshot.auth.humanApprovalTokenSha256 = `sha256:${createHash("sha256").update("verify-attacker-token").digest("hex")}`;
  await writeFile(authTamperRunPath, `${JSON.stringify(authTamperSnapshot, null, 2)}\n`, "utf8");
  const forgedAuthGrant = await postEvent(port, authTamperRunId, baseEvent("approval.granted", "redzone", "attempt forged persisted auth", { actor: "human", approvalOwner: "security-owner", approvalScope: "snapshot-integrity" }), 409, { "x-uash-human-token": "verify-attacker-token" });
  assertProblem(forgedAuthGrant, "run snapshot integrity", "persisted approval auth tamper");
  await writeFile(authTamperRunPath, authTamperSource, "utf8");
  const validAuthGrant = await postEvent(port, authTamperRunId, baseEvent("approval.granted", "redzone", "accept operator-held approval", { actor: "human", approvalOwner: "security-owner", approvalScope: "snapshot-integrity" }), 200, { "x-uash-human-token": VERIFY_HUMAN_APPROVAL_TOKEN });
  assert(validAuthGrant.run.approvals?.some((approval) => approval.scope === "snapshot-integrity" && approval.status === "granted"), "restored authenticated snapshot did not accept the operator-held token");

  const envOnlyApprovalRunId = "VERIFY-ENV-ONLY-HUMAN-APPROVAL";
  await postRun(port, { id: envOnlyApprovalRunId });
  await postEvent(port, envOnlyApprovalRunId, baseEvent("approval.requested", "redzone", "request env-only operator approval", { status: "needs_approval", approvalOwner: "security-owner", approvalScope: "env-only-approval" }));
  for (const bodyTokenField of ["humanToken", "humanApprovalToken"]) {
    const bodyTokenGrant = await postEvent(port, envOnlyApprovalRunId, baseEvent("approval.granted", "redzone", "reject body-carried human token", {
      actor: "human",
      approvalOwner: "security-owner",
      approvalScope: "env-only-approval",
      [bodyTokenField]: VERIFY_HUMAN_APPROVAL_TOKEN,
    }), 400);
    assertProblem(bodyTokenGrant, "accepted only through x-uash-human-token", `${bodyTokenField} event-body fallback`);
  }
  const envOnlyEmitterGrant = await run(node, [
    "scripts/uash-emit-event.mjs",
    envOnlyApprovalRunId,
    "approval.granted",
    "redzone",
    "operator environment approved the scoped action",
    "--status", "ok",
    "--actor", "human",
    "--approval-owner", "security-owner",
    "--approval-scope", "env-only-approval",
  ], {
    env: {
      UASH_BRIDGE_URL: `http://127.0.0.1:${port}`,
      UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN,
      UASH_HUMAN_APPROVAL_TOKEN: VERIFY_HUMAN_APPROVAL_TOKEN,
    },
  });
  const envOnlyEmitterResponse = JSON.parse(envOnlyEmitterGrant.stdout);
  assert(envOnlyEmitterResponse.run?.approvals?.some((approval) => approval.scope === "env-only-approval" && approval.status === "granted"), "operator-env emitter did not complete the token-gated human grant");

  const appleApprovalRoot = path.join(tempRoot, "apple-approval-root");
  await writeArtifact(appleApprovalRoot, "domain/assurance.json", '{"buildId":"BUILD-A"}\n');
  await postRun(port, { id: "VERIFY-APPLE-APPROVAL-DIGEST", artifactRoot: appleApprovalRoot });
  await postEvent(port, "VERIFY-APPLE-APPROVAL-DIGEST", baseEvent("approval.requested", "redzone", "TestFlight release approval requested", { artifact: "domain/assurance.json", status: "needs_approval", approvalOwner: "release-owner", approvalScope: "testflight-release" }));
  const appleGrant = await postEvent(port, "VERIFY-APPLE-APPROVAL-DIGEST", baseEvent("approval.granted", "redzone", "TestFlight release approved for bound domain packet", { id: "VERIFY-APPLE-GRANT-001", artifact: "domain/assurance.json", actor: "human", approvalOwner: "release-owner", approvalScope: "testflight-release" }), 200, { "x-uash-human-token": VERIFY_HUMAN_APPROVAL_TOKEN });
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
  ], { cwd: iosTarget, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}`, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN } });
  const nestedEmitterResponse = JSON.parse(nestedEmitter.stdout);
  assert(nestedEmitterResponse.run?.adapterPolicy?.enterpriseFinishLineRequired === true
    && nestedEmitterResponse.run?.adapterPolicy?.portableFinishLineRequired === true,
  "nested emitter did not load the v0.8 adapter policy");
  const implicitNestedEmitter = await run(node, [
    path.join(iosPack, "scripts", "uash-emit-event.mjs"),
    "IOS-IMPLICIT-ADAPTER-VERIFY", "node.entered", "intake", "implicit nested adapter discovery",
    "--artifact", "run/intake.json", "--status", "ok", "--actor", "codex", "--artifact-root", iosTarget
  ], { cwd: iosTarget, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}`, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN } });
  const implicitNestedEmitterResponse = JSON.parse(implicitNestedEmitter.stdout);
  assert(implicitNestedEmitterResponse.run?.adapterPolicy?.enterpriseFinishLineRequired === true
    && implicitNestedEmitterResponse.run?.adapterPolicy?.portableFinishLineRequired === true,
  "nested adapter omission bypassed v0.8 finish-line policy");
  await postRun(port, { id: "IOS-PRECREATED-IMPLICIT-ADAPTER" });
  const precreatedImplicitEmitter = await run(node, [
    path.join(iosPack, "scripts", "uash-emit-event.mjs"),
    "IOS-PRECREATED-IMPLICIT-ADAPTER", "node.entered", "intake", "pre-created run implicit nested adapter discovery",
    "--artifact", "run/intake.json", "--status", "ok", "--actor", "codex", "--artifact-root", iosTarget
  ], { cwd: iosTarget, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}`, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN } });
  const precreatedImplicitEmitterResponse = JSON.parse(precreatedImplicitEmitter.stdout);
  assert(precreatedImplicitEmitterResponse.run?.adapterPolicy?.enterpriseFinishLineRequired === true
    && precreatedImplicitEmitterResponse.run?.adapterPolicy?.portableFinishLineRequired === true,
  "pre-created run bypassed implicit nested adapter loading");

  const generatedEmitterArtifactRoot = path.join(tempRoot, "generated-emitter-artifacts");
  await mkdir(generatedEmitterArtifactRoot, { recursive: true });
  await run(node, [
    "scripts/uash-emit-event.mjs",
    "VERIFY-GENERATED-EMITTER",
    "node.entered",
    "intake",
    "--hyphen-leading generated emitter smoke",
    "--artifact",
    "run/intake.json",
    "--status",
    "ok",
    "--actor",
    "codex",
    "--artifact-root",
    generatedEmitterArtifactRoot,
  ], { cwd: generatedOut, env: { UASH_BRIDGE_URL: `http://127.0.0.1:${port}`, UASH_BRIDGE_ACCESS_TOKEN: VERIFY_BRIDGE_ACCESS_TOKEN } });

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

  const directComplete = await postRun(port, { id: "VERIFY-INJECTED-COMPLETE", status: "complete" }, 400);
  assert(directComplete.error === "run_creation_contract_violation"
    && (directComplete.problems || []).some((problem) => String(problem).includes("run.status cannot be supplied"))
    && !existsSync(bridgeRunDir(dataDir, "VERIFY-INJECTED-COMPLETE")),
  "direct complete was not rejected before persistence");

  const maliciousComplete = await postRun(port, { id: "VERIFY-MALICIOUS-COMPLETE", status: "complete", artifacts: [{ path: "proof/proof.json", required: false, present: true }] }, 400);
  assert(maliciousComplete.error === "run_creation_contract_violation"
    && (maliciousComplete.problems || []).some((problem) => String(problem).includes("run.status cannot be supplied"))
    && !existsSync(bridgeRunDir(dataDir, "VERIFY-MALICIOUS-COMPLETE")),
  "malicious complete was not rejected before persistence");

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
  const symlinkTarget = path.join(tempRoot, "symlink-target.json");
  await writeFile(symlinkTarget, JSON.stringify({ outsideArtifactRoot: true }));
  let symlinkEscapeChecked = false;
  try {
    await symlink(symlinkTarget, path.join(symlinkRoot, "proof", "proof.json"), "file");
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

  const minimalArtifactAdapter = {
    schema: "uash.project-adapter.v2",
    runtime: {
      connectorContractVersion: "uash.connector-events.v0.5",
      requiredNodes: ["prove", "handoff"],
      artifactByNode: { prove: "proof/proof.json", handoff: "handoff/final.md" },
    },
    proofSchema: { schema: "uash.proof.v1" },
    humanApproval: { tokenRequiredForGrant: true },
  };
  const mutationRunId = "VERIFY-SEALED-ARTIFACT-MUTATION";
  const mutationRoot = path.join(tempRoot, "sealed-artifact-mutation");
  await writeArtifact(mutationRoot, "project-adapter.json", JSON.stringify(minimalArtifactAdapter));
  await postRun(port, { id: mutationRunId, artifactRoot: mutationRoot, adapterPath: "project-adapter.json" });
  const preArtifactSnapshot = await readFile(path.join(bridgeRunDir(dataDir, mutationRunId), "run.json"), "utf8");
  await writeArtifact(mutationRoot, "proof/proof.json", proofJson(mutationRunId));
  const mutationProofClaim = await postEvent(port, mutationRunId, baseEvent("artifact.written", "prove", "seal proof bytes", { artifact: "proof/proof.json" }));
  const sealedProofDigest = mutationProofClaim.run.artifacts.find(({ nodeId }) => nodeId === "prove")?.verification?.sha256;
  assert(/^[a-f0-9]{64}$/.test(sealedProofDigest || ""), "artifact.written event did not persist a bridge-sealed SHA-256 claim");
  await writeArtifact(mutationRoot, "handoff/final.md", "# Mutation test handoff\n");
  await postEvent(port, mutationRunId, baseEvent("artifact.written", "handoff", "seal handoff bytes", { artifact: "handoff/final.md" }));
  const validButChangedProof = JSON.parse(proofJson(mutationRunId));
  validButChangedProof.summary = `${validButChangedProof.summary} changed after claim`;
  await writeArtifact(mutationRoot, "proof/proof.json", JSON.stringify(validButChangedProof));
  await writeFile(path.join(bridgeRunDir(dataDir, mutationRunId), "run.json"), preArtifactSnapshot, "utf8");
  const replayedMutationRun = await (await bridgeFetch(port, `/runs/${mutationRunId}`)).json();
  assert(replayedMutationRun.artifacts.find(({ nodeId }) => nodeId === "prove")?.verification?.sha256 === sealedProofDigest,
    "snapshot-lag journal replay adopted mutated artifact bytes instead of the HMAC-sealed claim");
  const mutationBlocked = await postEvent(port, mutationRunId, baseEvent("run.completed", "handoff", "reject changed proof bytes", { artifact: "handoff/final.md" }), 409);
  assertProblem(mutationBlocked, "SHA-256 mismatch", "post-claim artifact mutation");

  const deletionRunId = "VERIFY-SEALED-ARTIFACT-DELETION";
  const deletionRoot = path.join(tempRoot, "sealed-artifact-deletion");
  await writeArtifact(deletionRoot, "project-adapter.json", JSON.stringify(minimalArtifactAdapter));
  await postRun(port, { id: deletionRunId, artifactRoot: deletionRoot, adapterPath: "project-adapter.json" });
  await writeArtifact(deletionRoot, "proof/proof.json", proofJson(deletionRunId));
  await postEvent(port, deletionRunId, baseEvent("artifact.written", "prove", "seal proof before deletion test", { artifact: "proof/proof.json" }));
  await writeArtifact(deletionRoot, "handoff/final.md", "# Deletion test handoff\n");
  await postEvent(port, deletionRunId, baseEvent("artifact.written", "handoff", "seal handoff before deletion", { artifact: "handoff/final.md" }));
  await rm(path.join(deletionRoot, "handoff", "final.md"), { force: true });
  const deletionBlocked = await postEvent(port, deletionRunId, baseEvent("run.completed", "handoff", "reject deleted handoff", { artifact: "handoff/final.md" }), 409);
  assertProblem(deletionBlocked, "does not exist", "post-claim artifact deletion");

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
    generatorVersion: "0.7.0",
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
  await postEvent(port, v07PassRunId, baseEvent("approval.granted", "route", "human approved the bound route", { actor: "human", artifact: "run/route.json", approvalOwner: "verification-owner", approvalScope: "route" }), 200, { "x-uash-human-token": VERIFY_HUMAN_APPROVAL_TOKEN });
  await writeArtifact(v07PassRoot, "proof/proof.json", proofJson(v07PassRunId));
  await postEvent(port, v07PassRunId, baseEvent("artifact.written", "prove", "v0.7 passing proof", { artifact: "proof/proof.json", actor: "harness" }));
  await writeArtifact(v07PassRoot, "handoff/final.md", "# v0.7 passing handoff\n");
  await postEvent(port, v07PassRunId, baseEvent("artifact.written", "handoff", "v0.7 passing handoff", { artifact: "handoff/final.md", actor: "harness" }));
  const preCompletionSnapshot = await readFile(path.join(bridgeRunDir(dataDir, v07PassRunId), "run.json"), "utf8");
  const v07PassComplete = await postEvent(port, v07PassRunId, baseEvent("run.completed", "handoff", "v0.7 aggregate finish line passed", { artifact: "handoff/final.md", actor: "harness" }), 200);
  assert(v07PassComplete.run.status === "complete", "v0.7 aggregate bridge finish line did not complete");
  const completedRunList = await (await bridgeFetch(port, "/runs")).json();
  assert(completedRunList.some((run) => run.id === v07PassRunId && run.status === "complete"), "GET /runs did not retain a bridge-derived completed run");

  const originalCompletedHandoff = await readFile(path.join(v07PassRoot, "handoff", "final.md"), "utf8");
  await writeArtifact(v07PassRoot, "handoff/final.md", "# Mutated after completion\n");
  await writeFile(path.join(bridgeRunDir(dataDir, v07PassRunId), "run.json"), preCompletionSnapshot, "utf8");
  const staleCompletedRead = await bridgeFetch(port, `/runs/${v07PassRunId}`);
  const staleCompletedBody = await staleCompletedRead.json();
  assert(staleCompletedRead.status !== 200 && !Object.prototype.hasOwnProperty.call(staleCompletedBody, "status"), "snapshot-lag replay returned complete after post-completion artifact drift");
  const staleCompletedList = await (await bridgeFetch(port, "/runs")).json();
  assert(!staleCompletedList.some((run) => run.id === v07PassRunId), "GET /runs retained a completed run after post-completion artifact drift");
  await writeFile(path.join(v07PassRoot, "handoff", "final.md"), originalCompletedHandoff, "utf8");
  const recoveredCompletedRead = await bridgeFetch(port, `/runs/${v07PassRunId}`);
  const recoveredCompletedRun = await recoveredCompletedRead.json();
  assert(recoveredCompletedRead.status === 200 && recoveredCompletedRun.status === "complete", "trusted completion did not recover from journal/snapshot crash after artifact bytes were restored");

  await rm(bridgeRunDir(dataDir, v07PassRunId), { recursive: true, force: true });
  const v08RuntimeRunId = "VERIFY-V08-TRUSTED-RUNTIME";
  const v08UntrustedRoot = path.join(tempRoot, "v08-untrusted-runtime-root");
  const v08RootOnlyAdapterRoot = path.join(tempRoot, "v08-root-only-adapter");
  const v08RuntimeRoot = path.join(tempRoot, "v08-committed-runtime-root");
  const v08Adapter = JSON.stringify({
    schema: "uash.project-adapter.v2",
    generatorVersion: "0.8.0",
    runtime: { requiredNodes: ["prove", "handoff"], artifactByNode: { prove: "proof/proof.json", handoff: "handoff/final.md" } },
    proofSchema: { schema: "uash.proof.v1" },
    productionReadiness: { schema: "uash.production-readiness.v2" },
    finishLineAssurance: { required: true, packetRequired: true },
    humanApproval: { tokenRequiredForGrant: true },
  });
  const commissionedGateStub = (marker) => `import { writeFileSync } from "node:fs";\nimport path from "node:path";\nconst repoIndex = process.argv.indexOf("--repo");\nwriteFileSync(path.join(path.resolve(process.argv[repoIndex + 1]), ${JSON.stringify(marker)}), "nested-runtime\\n", "utf8");\n`;
  await writeArtifact(v08UntrustedRoot, ".valdris-harness/project-adapter.json", v08Adapter);
  for (const [script, marker] of [
    ["enterprise-ai-gate-all.mjs", "untrusted-enterprise.marker"],
    ["rca-gate.mjs", "untrusted-rca.marker"],
    ["review-gate.mjs", "untrusted-review.marker"],
    ["run-packet-gate.mjs", "untrusted-packet.marker"],
  ]) await writeArtifact(v08UntrustedRoot, `.valdris-harness/scripts/${script}`, commissionedGateStub(marker));
  const nonGitRuntimeBlocked = await postRun(port, { id: "VERIFY-V08-UNTRUSTED", artifactRoot: v08UntrustedRoot }, 400);
  assertProblem(nonGitRuntimeBlocked, "Git worktree with a committed HEAD", "non-Git commissioned runtime bootstrap");
  assert(!existsSync(path.join(v08UntrustedRoot, "untrusted-enterprise.marker")), "bridge executed an untrusted non-Git commissioned gate");
  await writeArtifact(v08RootOnlyAdapterRoot, "project-adapter.json", v08Adapter);
  const rootOnlyPortableAdapterBlocked = await postRun(port, { id: "VERIFY-V08-ROOT-ONLY", artifactRoot: v08RootOnlyAdapterRoot }, 400);
  assertProblem(rootOnlyPortableAdapterBlocked, "portable v0.8 adapter policy requires the canonical target-nested", "root-only portable adapter");

  await mkdir(v08RuntimeRoot, { recursive: true });
  await run(node, ["scripts/commission-harness.mjs", "--repo", v08RuntimeRoot, "--project-name", "Committed Runtime Verification", "--yes"]);
  await writeArtifact(v08RuntimeRoot, ".valdris-harness/scripts/enterprise-ai-gate-all.mjs", commissionedGateStub("enterprise-runtime.marker"));
  await writeArtifact(v08RuntimeRoot, ".valdris-harness/scripts/review-gate.mjs", commissionedGateStub("review-runtime.marker"));
  await writeArtifact(v08RuntimeRoot, ".valdris-harness/scripts/run-packet-gate.mjs", commissionedGateStub("packet-runtime.marker"));
  await run("git", ["init"], { cwd: v08RuntimeRoot });
  await run("git", ["config", "user.name", "Valdris Harness Verifier"], { cwd: v08RuntimeRoot });
  await run("git", ["config", "user.email", "verifier@example.invalid"], { cwd: v08RuntimeRoot });
  await run("git", ["config", "core.autocrlf", "false"], { cwd: v08RuntimeRoot });
  await run("git", ["add", ".valdris-harness", "AGENTS.md", "CLAUDE.md"], { cwd: v08RuntimeRoot });
  await run("git", ["commit", "-m", "test: commit untrusted commissioned stubs"], { cwd: v08RuntimeRoot });
  const committedStubsBlocked = await postRun(port, { id: "VERIFY-V08-COMMITTED-STUBS", artifactRoot: v08RuntimeRoot }, 400);
  assertProblem(committedStubsBlocked, "differs from the trusted host runtime", "committed finish-line stubs");
  assert(!existsSync(path.join(v08RuntimeRoot, "enterprise-runtime.marker")), "bridge executed a committed but semantically untrusted finish-line stub");

  await run(node, ["scripts/commission-harness.mjs", "--repo", v08RuntimeRoot, "--project-name", "Committed Runtime Verification", "--yes", "--force"]);
  const crlfValidatorPath = path.join(v08RuntimeRoot, ".valdris-harness", "scripts", "enterprise-ai-gate-all.mjs");
  const canonicalValidatorSource = await readFile(crlfValidatorPath, "utf8");
  await writeFile(crlfValidatorPath, canonicalValidatorSource.replace(/\r?\n/g, "\r\n"), "utf8");
  await run("git", ["add", ".valdris-harness", "AGENTS.md", "CLAUDE.md"], { cwd: v08RuntimeRoot });
  await run("git", ["commit", "-m", "test: restore genuine commissioned validators"], { cwd: v08RuntimeRoot });
  const nestedAdapterPath = path.join(v08RuntimeRoot, ".valdris-harness", "project-adapter.json");
  const trustedAdapterSource = await readFile(nestedAdapterPath, "utf8");
  const trustedAdapter = JSON.parse(trustedAdapterSource);

  await writeArtifact(v08RuntimeRoot, ".valdris-harness/untracked-runtime-note.md", "untracked runtime drift");
  const incompletePackCommitBlocked = await postRun(port, { id: "VERIFY-V08-INCOMPLETE-PACK-COMMIT", artifactRoot: v08RuntimeRoot }, 400);
  assertProblem(incompletePackCommitBlocked, "complete commissioned runtime inventory does not match committed Git HEAD", "incomplete commissioned-pack commit");
  await rm(path.join(v08RuntimeRoot, ".valdris-harness", "untracked-runtime-note.md"), { force: true });

  await writeArtifact(v08RuntimeRoot, "project-adapter.json", JSON.stringify({ ...trustedAdapter, finishLineAssurance: { required: false, packetRequired: false } }));
  const legacyAdapterDowngradeBlocked = await postRun(port, { id: "VERIFY-V08-LEGACY-DOWNGRADE", artifactRoot: v08RuntimeRoot }, 400);
  assertProblem(legacyAdapterDowngradeBlocked, "legacy target-root project adapter conflicts", "legacy root adapter downgrade");
  const explicitAdapterDowngradeBlocked = await postRun(port, { id: "VERIFY-V08-EXPLICIT-DOWNGRADE", artifactRoot: v08RuntimeRoot, adapterPath: "project-adapter.json" }, 400);
  assertProblem(explicitAdapterDowngradeBlocked, "explicit adapterPath must identify .valdris-harness/project-adapter.json", "explicit adapter downgrade");
  await rm(path.join(v08RuntimeRoot, "project-adapter.json"), { force: true });

  await writeArtifact(v08RuntimeRoot, ".valdris-harness/project-adapter.json", JSON.stringify({ ...trustedAdapter, finishLineAssurance: { required: false, packetRequired: false } }));
  const dirtyNestedAdapterBlocked = await postRun(port, { id: "VERIFY-V08-DIRTY-ADAPTER", artifactRoot: v08RuntimeRoot }, 400);
  assertProblem(dirtyNestedAdapterBlocked, "project adapter does not match its committed Git blob", "dirty nested adapter downgrade");
  await writeFile(nestedAdapterPath, trustedAdapterSource, "utf8");

  const v08RuntimeCreated = await postRun(port, { id: v08RuntimeRunId, artifactRoot: v08RuntimeRoot });
  assert(v08RuntimeCreated.adapterPath?.endsWith(".valdris-harness\\project-adapter.json") || v08RuntimeCreated.adapterPath?.endsWith(".valdris-harness/project-adapter.json"), "v0.8 bridge did not discover the commissioned nested adapter");
  const initialRuntimeIdentity = v08RuntimeCreated.commissionedRuntime?.runtimeSha256;
  assert(/^[a-f0-9]{64}$/.test(initialRuntimeIdentity || ""), "v0.8 bridge did not persist a stable runtime-content identity");

  const sealRecoveryRunId = "VERIFY-FIRST-EVENT-SEAL-RECOVERY";
  await postRun(port, { id: sealRecoveryRunId });
  const sealRecoveryRunPath = path.join(bridgeRunDir(dataDir, sealRecoveryRunId), "run.json");
  const preSealSnapshot = await readFile(sealRecoveryRunPath, "utf8");
  await postEvent(port, sealRecoveryRunId, baseEvent("node.entered", "intake", "commission on first event", { id: `${sealRecoveryRunId}-event`, artifactRoot: v08RuntimeRoot, actor: "harness" }));
  await writeFile(sealRecoveryRunPath, preSealSnapshot, "utf8");
  const recoveredSealedRun = await (await bridgeFetch(port, `/runs/${sealRecoveryRunId}`)).json();
  assert(recoveredSealedRun.events?.some(({ id }) => id === `${sealRecoveryRunId}-event`) && recoveredSealedRun.commissionedRuntime?.runtimeSha256 === initialRuntimeIdentity, "bridge did not recover a crash between first-event configuration sealing and snapshot replacement");

  await writeArtifact(v08RuntimeRoot, "product-source.txt", "normal product-only change during the run\n");
  await run("git", ["add", "product-source.txt"], { cwd: v08RuntimeRoot });
  await run("git", ["commit", "-m", "test: normal product-only run commit"], { cwd: v08RuntimeRoot });
  const productCommitEvent = await postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", "continue after product-only commit", { actor: "harness" }));
  assert(productCommitEvent.run?.commissionedRuntime?.runtimeSha256 === initialRuntimeIdentity, "product-only commit changed the commissioned runtime identity or blocked the run");
  const persistedRunPath = path.join(bridgeRunDir(dataDir, v08RuntimeRunId), "run.json");
  const journalRecoveryEvent = {
    id: `${v08RuntimeRunId}-journal-recovery`,
    type: "node.entered",
    ts: new Date().toISOString(),
    at: new Date().toISOString(),
    actor: "harness",
    nodeId: "intake",
    message: "recover snapshot from authoritative event journal",
    status: "ok",
    runMode: "live",
    eventSource: "bridge",
  };
  const eventJournalPath = path.join(bridgeRunDir(dataDir, v08RuntimeRunId), "events.jsonl");
  const preJournalRecoverySnapshot = await readFile(persistedRunPath, "utf8");
  const preJournalRecoveryJournal = await readFile(eventJournalPath, "utf8");
  await postEvent(port, v08RuntimeRunId, journalRecoveryEvent);
  await writeFile(persistedRunPath, preJournalRecoverySnapshot, "utf8");
  const journalRecoveredRun = await (await bridgeFetch(port, `/runs/${v08RuntimeRunId}`)).json();
  assert(journalRecoveredRun.events?.some(({ id }) => id === journalRecoveryEvent.id), "bridge did not recover a snapshot that lagged its authoritative event journal");
  await writeFile(eventJournalPath, '{"id":"partial-crash-tail"', { flag: "a" });
  const truncatedTailRecovery = await (await bridgeFetch(port, `/runs/${v08RuntimeRunId}`)).json();
  assert(truncatedTailRecovery.events?.some(({ id }) => id === journalRecoveryEvent.id), "bridge did not preserve complete events while recovering a partial journal tail");
  assert((await readFile(eventJournalPath, "utf8")).endsWith("\n") && !(await readFile(eventJournalPath, "utf8")).includes("partial-crash-tail"), "bridge did not truncate an incomplete journal append safely");

  const concurrentEventIds = [`${v08RuntimeRunId}-concurrent-a`, `${v08RuntimeRunId}-concurrent-b`];
  await Promise.all(concurrentEventIds.map((id) => postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", `serialize ${id}`, { id, actor: "harness" }))));
  const concurrentRunRead = await (await bridgeFetch(port, `/runs/${v08RuntimeRunId}`)).json();
  assert(concurrentEventIds.every((id) => concurrentRunRead.events?.some((event) => event.id === id)), "per-run event serialization lost or quarantined a concurrent event");

  const trustedJournalSource = await readFile(eventJournalPath, "utf8");
  const trustedSnapshotSource = await readFile(persistedRunPath, "utf8");
  const tamperedJournalLines = trustedJournalSource.trimEnd().split(/\r?\n/);
  const tamperedJournalRecord = JSON.parse(tamperedJournalLines.at(-1));
  tamperedJournalRecord.event.type = "run.completed";
  tamperedJournalRecord.event.nodeId = "handoff";
  tamperedJournalRecord.event.status = "ok";
  tamperedJournalRecord.event.message = "forged local completion";
  tamperedJournalLines[tamperedJournalLines.length - 1] = JSON.stringify(tamperedJournalRecord);
  await writeFile(eventJournalPath, `${tamperedJournalLines.join("\n")}\n`, "utf8");
  const tamperedJournalList = await (await bridgeFetch(port, "/runs")).json();
  assert(!tamperedJournalList.some((run) => run.id === v08RuntimeRunId), "GET /runs accepted a completion forged by editing the authenticated event journal");
  assert(tamperedJournalList.some((run) => run.id === adapterAwareRunId), "journal quarantine did not isolate the tampered run from healthy records");
  await writeFile(eventJournalPath, trustedJournalSource, "utf8");
  const restoredJournalRun = await (await bridgeFetch(port, `/runs/${v08RuntimeRunId}`)).json();
  assert(restoredJournalRun.events?.some((event) => event.id === concurrentEventIds[1]), "authenticated event journal did not recover after tampered bytes were restored");

  await writeFile(persistedRunPath, preJournalRecoverySnapshot, "utf8");
  await writeFile(eventJournalPath, preJournalRecoveryJournal, "utf8");
  const rolledBackJournalList = await (await bridgeFetch(port, "/runs")).json();
  assert(!rolledBackJournalList.some((run) => run.id === v08RuntimeRunId), "bridge accepted a valid-prefix rollback below the process-observed journal head");
  await writeFile(persistedRunPath, trustedSnapshotSource, "utf8");
  await writeFile(eventJournalPath, trustedJournalSource, "utf8");
  const rollbackRestoredRun = await (await bridgeFetch(port, `/runs/${v08RuntimeRunId}`)).json();
  assert(rollbackRestoredRun.events?.some((event) => event.id === concurrentEventIds[1]), "run did not recover after the valid-prefix rollback bytes were restored");

  const persistedRunSource = await readFile(persistedRunPath, "utf8");
  const trustedRunList = await (await bridgeFetch(port, "/runs")).json();
  assert(trustedRunList.some((run) => run.id === v08RuntimeRunId), "GET /runs omitted a trusted v0.8 record");
  const staleCompleteRun = JSON.parse(persistedRunSource);
  staleCompleteRun.status = "complete";
  await writeFile(persistedRunPath, `${JSON.stringify(staleCompleteRun, null, 2)}\n`, "utf8");
  const quarantinedRunListResponse = await bridgeFetch(port, "/runs");
  const quarantinedRunList = await quarantinedRunListResponse.json();
  assert(quarantinedRunListResponse.status === 200, "GET /runs crashed instead of quarantining an untrusted v0.8 record");
  assert(!quarantinedRunList.some((run) => run.id === v08RuntimeRunId), "GET /runs rendered a stale/tampered v0.8 record as complete");
  assert(quarantinedRunList.some((run) => run.id === adapterAwareRunId), "GET /runs did not isolate the untrusted v0.8 record from healthy records");
  await writeFile(persistedRunPath, persistedRunSource, "utf8");
  const restoredRunList = await (await bridgeFetch(port, "/runs")).json();
  assert(restoredRunList.some((run) => run.id === v08RuntimeRunId && run.status !== "complete"), "GET /runs did not restore a trusted v0.8 record after quarantine conditions cleared");
  const persistedConfigPath = path.join(bridgeRunDir(dataDir, v08RuntimeRunId), "run-config.json");
  const persistedConfigSource = await readFile(persistedConfigPath, "utf8");
  const identitylessConfig = JSON.parse(persistedConfigSource);
  identitylessConfig.commissionedRuntime = null;
  await writeFile(persistedConfigPath, `${JSON.stringify(identitylessConfig, null, 2)}\n`, "utf8");
  const missingIdentityBlocked = await postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", "reject removed commissioned identity", { actor: "harness" }), 409);
  assertProblem(missingIdentityBlocked, "run configuration integrity", "removed authenticated commissioned runtime identity");
  await writeFile(persistedConfigPath, persistedConfigSource, "utf8");
  const neutralRedirectRoot = path.join(tempRoot, "redirected-uncommissioned-root");
  await mkdir(neutralRedirectRoot, { recursive: true });
  const strippedCommissioningRun = JSON.parse(persistedRunSource);
  strippedCommissioningRun.artifactRoot = neutralRedirectRoot;
  strippedCommissioningRun.adapterPath = null;
  strippedCommissioningRun.adapterPolicy = null;
  delete strippedCommissioningRun.commissionedRuntime;
  const strippedCommissioningConfig = JSON.parse(persistedConfigSource);
  strippedCommissioningConfig.artifactRoot = neutralRedirectRoot;
  strippedCommissioningConfig.adapterPath = null;
  strippedCommissioningConfig.adapterPolicy = null;
  strippedCommissioningConfig.commissionedRuntime = null;
  await writeFile(persistedRunPath, `${JSON.stringify(strippedCommissioningRun, null, 2)}\n`, "utf8");
  await writeFile(persistedConfigPath, `${JSON.stringify(strippedCommissioningConfig, null, 2)}\n`, "utf8");
  const strippedCommissioningBlocked = await postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", "reject stripped commissioning state", { actor: "harness" }), 409);
  assertProblem(strippedCommissioningBlocked, "run snapshot integrity", "stripped commissioned run downgrade across both state files");
  await writeFile(persistedRunPath, persistedRunSource, "utf8");
  await writeFile(persistedConfigPath, persistedConfigSource, "utf8");
  const downgradedRun = JSON.parse(persistedRunSource);
  downgradedRun.adapterPolicy.enterpriseFinishLineRequired = false;
  downgradedRun.adapterPolicy.portableFinishLineRequired = false;
  await writeFile(persistedRunPath, `${JSON.stringify(downgradedRun, null, 2)}\n`, "utf8");
  const persistedPolicyDowngradeBlocked = await postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", "reject persisted adapter downgrade on ordinary event", { actor: "harness" }), 409);
  assertProblem(persistedPolicyDowngradeBlocked, "run snapshot integrity", "persisted adapter-policy downgrade");
  await writeFile(persistedRunPath, persistedRunSource, "utf8");

  const missingRuntimePath = path.join(v08RuntimeRoot, ".valdris-harness-missing");
  await rename(path.join(v08RuntimeRoot, ".valdris-harness"), missingRuntimePath);
  const missingRuntimeDowngradeBlocked = await postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", "reject missing commissioned runtime", { actor: "harness" }), 409);
  assertProblem(missingRuntimeDowngradeBlocked, "canonical .valdris-harness runtime is missing", "missing commissioned runtime with persisted downgrade");
  await rename(missingRuntimePath, path.join(v08RuntimeRoot, ".valdris-harness"));
  await writeFile(persistedRunPath, persistedRunSource, "utf8");

  await writeFile(nestedAdapterPath, `${trustedAdapterSource.trimEnd()}\n `, "utf8");
  const midRunRuntimeDriftBlocked = await postEvent(port, v08RuntimeRunId, baseEvent("node.entered", "intake", "reject dirty commissioned runtime on ordinary event", { actor: "harness" }), 409);
  assertProblem(midRunRuntimeDriftBlocked, "project adapter does not match its committed Git blob", "mid-run commissioned runtime drift");
  await writeFile(nestedAdapterPath, trustedAdapterSource, "utf8");

  const redzoneRunId = "VERIFY-REDZONE-NO-GRANT";
  const redzoneRoot = path.join(tempRoot, redzoneRunId);
  const redzoneCreated = await postRun(port, { id: redzoneRunId, artifactRoot: redzoneRoot });
  await satisfyCoreArtifacts(port, redzoneRunId, redzoneRoot, { leaveRedzoneOpen: true });
  await postEvent(port, redzoneRunId, baseEvent("approval.requested", "redzone", "red zone approval requested", { status: "needs_approval", approvalOwner: "release-owner", approvalScope: "redzone" }));
  const agentGrant = await postEvent(port, redzoneRunId, baseEvent("approval.granted", "redzone", "agent tried to grant red zone", { actor: "codex", approvalOwner: "release-owner", approvalScope: "redzone" }), 400);
  assertProblem(agentGrant, "actor human", "agent grant");
  const humanGrantNoToken = await postEvent(port, redzoneRunId, baseEvent("approval.granted", "redzone", "human grant missing token", { actor: "human", approvalOwner: "release-owner", approvalScope: "redzone" }), 409);
  assertProblem(humanGrantNoToken, "human approval token", "human grant no token");
  const accessTokenCannotApprove = await postEvent(port, redzoneRunId, baseEvent("approval.granted", "redzone", "access token cannot stand in for human approval", { actor: "human", approvalOwner: "release-owner", approvalScope: "redzone" }), 409, { "x-uash-human-token": VERIFY_BRIDGE_ACCESS_TOKEN });
  assertProblem(accessTokenCannotApprove, "did not match UASH_HUMAN_APPROVAL_TOKEN", "bridge access token used as human approval token");
  const redzoneBlocked = await postEvent(port, redzoneRunId, baseEvent("run.completed", "handoff", "try completion without approval", { artifact: "handoff/final.md" }), 409);
  assertProblem(redzoneBlocked, "approval pending", "redzone completion");

  const grantNoPending = await postEvent(port, "VERIFY-GRANT-NO-PENDING", baseEvent("approval.granted", "redzone", "human grant without request", { actor: "human", approvalOwner: "release-owner", approvalScope: "redzone" }), 409, { "x-uash-human-token": VERIFY_HUMAN_APPROVAL_TOKEN });
  assert(grantNoPending.error === "event_state_violation", "grant without pending approval did not return state violation");


  const tokenRunId = "VERIFY-HUMAN-TOKEN-GRANT";
  const tokenRoot = path.join(tempRoot, tokenRunId);
  const tokenCreated = await postRun(port, { id: tokenRunId, artifactRoot: tokenRoot });
  assert(!Object.prototype.hasOwnProperty.call(tokenCreated, "humanApprovalToken"), "POST /runs leaked a raw human approval token");
  assert(!Object.prototype.hasOwnProperty.call(tokenCreated, "auth"), "POST /runs leaked human approval auth metadata");
  await postEvent(port, tokenRunId, baseEvent("approval.requested", "redzone", "token-gated approval requested", { status: "needs_approval", approvalOwner: "release-owner", approvalScope: "redzone" }));
  await postEvent(port, tokenRunId, baseEvent("approval.granted", "redzone", "token-gated human grant", { actor: "human", approvalOwner: "release-owner", approvalScope: "redzone" }), 200, { "x-uash-human-token": VERIFY_HUMAN_APPROVAL_TOKEN });
  const tokenRunFromHttp = await (await bridgeFetch(port, `/runs/${encodeURIComponent(tokenRunId)}`)).json();
  assert(!Object.prototype.hasOwnProperty.call(tokenRunFromHttp, "auth"), "GET /runs/:id leaked human approval auth metadata");
  const tokenEventsJsonl = await readFile(path.join(bridgeRunDir(dataDir, tokenRunId), "events.jsonl"), "utf8");
  const tokenRunJson = await readFile(path.join(bridgeRunDir(dataDir, tokenRunId), "run.json"), "utf8");
  const tokenRunConfig = await readFile(path.join(bridgeRunDir(dataDir, tokenRunId), "run-config.json"), "utf8");
  for (const [label, rawSecret] of [
    ["bridge access token", VERIFY_BRIDGE_ACCESS_TOKEN],
    ["bridge integrity key", VERIFY_BRIDGE_INTEGRITY_KEY],
    ["human approval token", VERIFY_HUMAN_APPROVAL_TOKEN],
  ]) {
    assert(!tokenEventsJsonl.includes(rawSecret), `${label} leaked to events.jsonl`);
    assert(!tokenRunJson.includes(rawSecret), `${label} leaked to run.json`);
    assert(!tokenRunConfig.includes(rawSecret), `${label} leaked to run-config.json`);
  }

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

  const eventsJsonl = await readFile(path.join(bridgeRunDir(dataDir, runId), "events.jsonl"), "utf8");
  assert(eventsJsonl.includes("run.completed"), "events.jsonl missing run.completed");

  console.log("Valdris SDLC Harness verification passed");
  console.log(
    JSON.stringify(
      {
        commissioningQuestionGroups: questionGroups.length,
        commissioningQuestions: questionGroups.reduce((count, group) => count + group.questions.length, 0),
        generatedFrontDoors: ["AGENTS.md", "CLAUDE.md", ".agents/skills", ".claude/skills", ".claude/commands/valdris-sdlc-harness.md", "docs/Codex Runtime Prompt.md", "knowledge/index.md", "controls/workload-taxonomy.v1.json", "controls/foundation-layer.v1.json", "scripts/workload-classification-gate.mjs", "scripts/foundation-gate.mjs", "scripts/enterprise-ai-gate-all.mjs", "scripts/run-acceptance.mjs", ".github/workflows/valdris-assurance.yml", ".github/workflows/valdris-run-acceptance.yml"],
        targetRootDiscoveryLoaders: true,
        existingRootInstructionsPreserved: true,
        unsafeRootLoaderBlocked: true,
        malformedRootLoaderBlocked: true,
        staleRootLoaderPlanBlocked: staleLoaderPlanBlocked,
        atomicRootLoaderRollback: atomicRollbackPassed,
        concurrentRootLoaderRollbackPreserved: concurrentRollbackConflictPreserved,
        adapterSchema: adapter.schema,
        generatorVersion: adapter.generatorVersion,
        foundationBlueprint: true,
        workloadTaxonomy: true,
        foundationAssurance: true,
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
        v08CommittedRuntimeBootstrap: true,
        v08NonGitRuntimeBlocked: true,
        v08CommittedGateStubsBlocked: true,
        v08CrlfValidatorParity: true,
        v08CompletePackCommitRequired: true,
        v08AdapterDowngradesBlocked: true,
        v08RootOnlyPortableAdapterBlocked: true,
        v08ListRuntimeTrustQuarantine: true,
        v08PersistedRunTrustRevalidated: true,
        v08MissingRuntimeDowngradeBlocked: true,
        v08MidRunRuntimeDriftBlocked: true,
        independentReviewApplicabilityDowngradeBlocked: true,
        humanApprovalTokenGate: true,
        humanApprovalTokenNotReturnedByHttp: true,
        clientSuppliedHumanTokenRejected: true,
        humanApprovalTokenArgvRejected: true,
        humanApprovalTokenEventBodyRejected: true,
        humanApprovalOperatorEnvGrant: true,
        ciWorkflow: true,
        strictEventValidation: true,
        artifactRootRequired: true,
        artifactFileVerification: true,
        artifactDigestJournalBound: true,
        artifactMutationBlocked: true,
        artifactDeletionBlocked: true,
        postCompletionArtifactDriftQuarantined: true,
        completionJournalSnapshotRecovery: true,
        hashShapedLegacyStateBlocked: true,
        bridgeCredentialSeparation: true,
        bridgeCredentialsPairwiseDistinct: true,
        bridgeCredentialStrengthMinimum: true,
        finishLineChildCredentialsStripped: true,
        bridgeStaleLeaseRecoverySerialized: true,
        bridgeRecoveryMutexFailsClosed: true,
        idempotentRunCreation: true,
        invalidRunCreationScalarsBlocked: true,
        invalidEventIdPreAppendBlocked: true,
        firstNoncommissionedRootSealRecovered: true,
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
