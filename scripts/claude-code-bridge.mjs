#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.UASH_BRIDGE_PORT || 8787);
const HOST = process.env.UASH_BRIDGE_HOST || "127.0.0.1";
const DATA_DIR = path.resolve(process.env.UASH_DATA_DIR || path.join(os.homedir(), ".uash", "runs"));
const SERVICE = "uash-claude-code-bridge";
const CONTRACT_VERSION = "uash.connector-events.v0.5";
const PROOF_SCHEMA = "uash.proof.v1";
const REPO_ROOT = path.resolve(process.env.UASH_REPO_ROOT || process.cwd());
const EXTRA_ADAPTER_ROOTS = (process.env.UASH_ADAPTER_ROOTS || "")
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => path.resolve(entry));

const artifactByNode = {
  intake: "run/intake.json",
  route: "run/route.json",
  "code-intelligence": "graph/graph.json",
  "design-anchors": "design/anchors.json",
  "system-design": "design/system_design.md",
  "production-readiness": "production/layer-assessment.json",
  "cloud-platform": "cloud/service-map.json",
  implement: "session/events.jsonl",
  redzone: "approvals/redzone.json",
  "qa-break-it": "qa/break-it-results.md",
  prove: "proof/proof.json",
  "live-smoke": "smoke/smoke_proof.json",
  "self-heal": "self_heal/self_heal_report.md",
  handoff: "handoff/final.md",
};

const labelByNode = {
  intake: "Intake",
  route: "Route",
  "code-intelligence": "GitNexus",
  "design-anchors": "Code Anchors",
  "system-design": "System Design",
  "production-readiness": "Production Layers",
  "cloud-platform": "Cloud / Platform",
  implement: "Implement",
  redzone: "Red Zone",
  "qa-break-it": "Break-it QA",
  prove: "Proof Gate",
  "live-smoke": "Live Smoke",
  "self-heal": "Self-Heal",
  handoff: "Handoff",
};

const EVENT_TYPES = new Set([
  "run.created",
  "run.mode_set",
  "agent.connected",
  "node.entered",
  "node.skipped",
  "node.failed",
  "gate.fired",
  "artifact.written",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "run.blocked",
  "run.completed",
  "self_heal.detected",
  "self_heal.pr_opened",
  "self_heal.pr_proposed",
]);

const NODE_IDS = new Set(Object.keys(artifactByNode));
const ACTORS = new Set(["claude-code", "codex", "hermes", "harness", "human", "system"]);
const STATUSES = new Set(["ok", "warn", "blocked", "skipped", "failed", "needs_approval", "passed"]);
const RUN_MODES = new Set(["blueprint", "live", "replay"]);
const EVENT_SOURCES = new Set(["bridge", "mcp", "api", "watched-artifact", "local-jsonl", "database", "run-packet", "static-blueprint", "browser-local"]);

function createBaseArtifacts(adapterPolicy = {}) {
  const artifactMap = { ...artifactByNode, ...(adapterPolicy.artifactByNode || {}) };
  const policyRequiredNodes = Array.isArray(adapterPolicy.requiredNodes)
    ? adapterPolicy.requiredNodes.filter((nodeId) => NODE_IDS.has(nodeId))
    : Object.keys(artifactByNode);
  // Adapters may narrow project-specific gates, but they may never remove the finish-line proof or handoff invariants.
  const requiredNodes = new Set([...policyRequiredNodes, "prove", "handoff"]);
  return Object.entries(artifactByNode).map(([nodeId, defaultArtifactPath]) => {
    const artifactPath = artifactMap[nodeId] || defaultArtifactPath;
    return {
      path: artifactPath,
      label: labelByNode[nodeId] || nodeId,
      nodeId,
      required: requiredNodes.has(nodeId),
      present: false,
    };
  });
}

function runDir(runId) {
  return path.join(DATA_DIR, sanitize(runId));
}

function sanitize(value) {
  return String(value || "RUN-UNKNOWN").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function nowIso() {
  return new Date().toISOString();
}

function send(res, status, body) {
  const payload = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, x-uash-human-token",
  });
  res.end(payload);
}


function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function generateHumanApprovalToken() {
  return `uash-human-${randomBytes(24).toString("base64url")}`;
}

function digestHumanApprovalToken(token) {
  return `sha256:${sha256(token)}`;
}

function humanApprovalTokenMatches(token, expectedDigest) {
  if (!token || !expectedDigest) return false;
  return safeCompare(digestHumanApprovalToken(token), expectedDigest);
}

function extractHumanToken(req, body) {
  const headerToken = req.headers["x-uash-human-token"];
  if (Array.isArray(headerToken)) return headerToken[0];
  return headerToken || body.humanToken || body.humanApprovalToken;
}

function humanApprovalAuthRecord(now = nowIso()) {
  const envToken = process.env.UASH_HUMAN_APPROVAL_TOKEN;
  if (!envToken) {
    return {
      humanApprovalTokenRequired: true,
      humanApprovalTokenMode: "operator-env-required",
    };
  }
  return {
    humanApprovalTokenSha256: digestHumanApprovalToken(envToken),
    humanApprovalTokenIssuedAt: now,
    humanApprovalTokenMode: "process-env",
  };
}

function safeAdapterRoots(artifactRoot) {
  return [artifactRoot, REPO_ROOT, ...EXTRA_ADAPTER_ROOTS]
    .filter(Boolean)
    .map((entry) => path.resolve(String(entry)))
    .filter((entry) => existsSync(entry))
    .map((entry) => realpathSync(entry));
}

function resolveAdapterPath(adapterPath, artifactRoot) {
  if (!adapterPath) return { adapterPath: null, problems: [] };
  const base = artifactRoot ? path.resolve(String(artifactRoot)) : REPO_ROOT;
  const candidate = path.isAbsolute(String(adapterPath)) ? path.resolve(String(adapterPath)) : path.resolve(base, String(adapterPath));
  if (!existsSync(candidate)) return { adapterPath: candidate, problems: [`adapterPath does not exist: ${candidate}`] };
  if (lstatSync(candidate).isSymbolicLink()) return { adapterPath: candidate, problems: [`adapterPath is a symlink and is not allowed: ${adapterPath}`] };
  const realCandidate = realpathSync(candidate);
  const allowedRoots = safeAdapterRoots(artifactRoot);
  if (!allowedRoots.some((allowedRoot) => isInside(allowedRoot, realCandidate))) {
    return {
      adapterPath: realCandidate,
      problems: [`adapterPath must resolve inside artifactRoot, UASH_REPO_ROOT, or UASH_ADAPTER_ROOTS: ${adapterPath}`],
    };
  }
  return { adapterPath: realCandidate, problems: [] };
}

function adapterPolicyFrom(adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error("project adapter must be a JSON object");
  const runtime = adapter.runtime && typeof adapter.runtime === "object" ? adapter.runtime : {};
  const artifactMap = runtime.artifactByNode && typeof runtime.artifactByNode === "object" ? runtime.artifactByNode : {};
  const requiredNodes = Array.isArray(runtime.requiredNodes) ? runtime.requiredNodes : Object.keys(artifactByNode);
  const unknownRequired = requiredNodes.filter((nodeId) => !NODE_IDS.has(nodeId));
  if (unknownRequired.length) throw new Error(`project adapter contains unknown required node IDs: ${unknownRequired.join(", ")}`);
  const requiredSet = new Set(requiredNodes);
  const missingInvariantNodes = ["prove", "handoff"].filter((nodeId) => !requiredSet.has(nodeId));
  if (missingInvariantNodes.length) throw new Error(`project adapter cannot remove finish-line required node IDs: ${missingInvariantNodes.join(", ")}`);
  const invalidArtifacts = Object.keys(artifactMap).filter((nodeId) => !NODE_IDS.has(nodeId));
  if (invalidArtifacts.length) throw new Error(`project adapter contains unknown artifact node IDs: ${invalidArtifacts.join(", ")}`);
  return {
    schema: adapter.schema,
    generatorVersion: adapter.generatorVersion,
    requiredNodes,
    artifactByNode: Object.fromEntries(Object.entries(artifactMap).filter(([nodeId, value]) => NODE_IDS.has(nodeId) && typeof value === "string" && value.trim())),
    approvalOwner: adapter.humanApproval?.approvalOwner || adapter.answers?.approval_owner || adapter.humanAgentProtocol?.decisionOwner || "primary human/operator",
    proofSchema: adapter.proofSchema?.schema || PROOF_SCHEMA,
  };
}

function loadAdapterPolicy(adapterPath, artifactRoot) {
  const implicitAdapter = !adapterPath && artifactRoot && existsSync(path.resolve(String(artifactRoot), "project-adapter.json"))
    ? path.resolve(String(artifactRoot), "project-adapter.json")
    : !adapterPath && existsSync(path.resolve(REPO_ROOT, "project-adapter.json"))
      ? path.resolve(REPO_ROOT, "project-adapter.json")
      : adapterPath;
  if (!implicitAdapter) return { adapterPath: null, adapterPolicy: undefined };
  const resolved = resolveAdapterPath(implicitAdapter, artifactRoot);
  if (resolved.problems.length) throw new Error(resolved.problems.join("; "));
  const adapter = JSON.parse(readFileSync(resolved.adapterPath, "utf8"));
  return { adapterPath: resolved.adapterPath, adapterPolicy: adapterPolicyFrom(adapter) };
}

function artifactEntryForNode(run, nodeId) {
  return (run.artifacts || []).find((artifact) => artifact.nodeId === nodeId);
}

function artifactPathForNode(run, nodeId) {
  return artifactEntryForNode(run, nodeId)?.path || artifactByNode[nodeId];
}

function isProofEvent(run, event) {
  const proofPath = artifactPathForNode(run, "prove") || artifactByNode.prove;
  return event.nodeId === "prove" || event.artifact === proofPath || event.artifact === artifactByNode.prove;
}

function validateProofDocument(filePath) {
  const problems = [];
  let document;
  try {
    document = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return { checked: true, valid: false, schema: null, commandCount: 0, problems: [`proof artifact must be valid JSON: ${error.message}`] };
  }
  if (document.schema !== PROOF_SCHEMA) problems.push(`proof artifact schema must be ${PROOF_SCHEMA}`);
  if (!document.generatedAt || Number.isNaN(Date.parse(document.generatedAt))) problems.push("proof.generatedAt must be an ISO timestamp");
  if (document.status !== "passed") problems.push("proof.status must be passed for finish-line proof");
  if (typeof document.summary !== "string" || !document.summary.trim()) problems.push("proof.summary is required");
  if (!Array.isArray(document.commands) || document.commands.length === 0) {
    problems.push("proof.commands must contain at least one command result");
  } else {
    document.commands.forEach((command, index) => {
      if (!command || typeof command !== "object" || Array.isArray(command)) {
        problems.push(`proof.commands[${index}] must be an object`);
        return;
      }
      if (typeof command.command !== "string" || !command.command.trim()) problems.push(`proof.commands[${index}].command is required`);
      if (!Number.isInteger(command.exitCode)) problems.push(`proof.commands[${index}].exitCode must be an integer`);
      if (!command.completedAt || Number.isNaN(Date.parse(command.completedAt))) problems.push(`proof.commands[${index}].completedAt must be an ISO timestamp`);
      if (!command.stdoutTail && !command.stderrTail && !command.outputDigest) problems.push(`proof.commands[${index}] must include stdoutTail, stderrTail, or outputDigest`);
    });
  }
  if (Array.isArray(document.commands) && document.commands.some((command) => command?.exitCode !== 0)) {
    problems.push("finish-line proof requires every command exitCode to be 0");
  }
  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    commandCount: Array.isArray(document.commands) ? document.commands.length : 0,
    status: document.status,
    problems,
  };
}

function humanApprovalTokenProblems(run, event, humanToken) {
  if (event.type !== "approval.granted" && event.type !== "approval.denied") return [];
  const runDigest = run.auth?.humanApprovalTokenSha256;
  if (runDigest) {
    if (!humanToken) return ["human approval token is required for approval grant/deny events"];
    if (!humanApprovalTokenMatches(humanToken, runDigest)) return ["human approval token did not match this run"];
    return [];
  }
  const envToken = process.env.UASH_HUMAN_APPROVAL_TOKEN;
  if (envToken) {
    if (!humanToken) return ["human approval token is required for approval grant/deny events"];
    if (!safeCompare(String(humanToken), String(envToken))) return ["human approval token did not match UASH_HUMAN_APPROVAL_TOKEN"];
    return [];
  }
  return ["human approval token is required; restart the bridge with operator-held UASH_HUMAN_APPROVAL_TOKEN before approval grant/deny events"];
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function readRun(runId) {
  const file = path.join(runDir(runId), "run.json");
  const raw = await readFile(file, "utf8");
  return normalizeRun(JSON.parse(raw));
}

async function writeRun(run) {
  const dir = runDir(run.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "run.json"), JSON.stringify(normalizeRun(run), null, 2) + "\n");
}

function normalizeApprovalRecords(approvals = []) {
  return approvals.map((approval) => {
    if (typeof approval === "string") {
      return { scope: approval, status: "granted", owner: "unknown", migratedFromLegacy: true };
    }
    return approval;
  });
}

function normalizeRun(run) {
  const adapterPolicy = run.adapterPolicy || undefined;
  return {
    ...run,
    contractVersion: run.contractVersion || CONTRACT_VERSION,
    adapterPath: run.adapterPath,
    adapterPolicy,
    auth: run.auth,
    approvals: normalizeApprovalRecords(run.approvals || []),
    artifacts: Array.isArray(run.artifacts) && run.artifacts.length ? run.artifacts : createBaseArtifacts(adapterPolicy),
    events: Array.isArray(run.events) ? run.events : [],
  };
}

function createMinimalRun(runId, event = {}, options = {}) {
  const now = nowIso();
  const adapterConfig = loadAdapterPolicy(event.adapterPath, event.artifactRoot);
  return normalizeRun({
    id: runId,
    title: event.title || `Claude Code run ${runId}`,
    task: event.task || "Created by local bridge event.",
    repo: event.repo || "local/claude-code",
    branch: event.branch || "unknown",
    lane: event.lane || "agent-runtime",
    agent: event.actor === "codex" || event.actor === "hermes" ? event.actor : "claude-code",
    status: "running",
    risk: "medium",
    mode: event.runMode || event.mode || "live",
    eventSource: event.eventSource || "bridge",
    currentNodeId: event.nodeId || "intake",
    artifactRoot: event.artifactRoot,
    adapterPath: adapterConfig.adapterPath || event.adapterPath,
    adapterPolicy: adapterConfig.adapterPolicy,
    auth: humanApprovalAuthRecord(now),
    createdAt: now,
    updatedAt: now,
    approvals: [],
    artifacts: createBaseArtifacts(adapterConfig.adapterPolicy),
    events: [],
  });
}

function createRunFromBody(body) {
  const base = createMinimalRun(body.id, body);
  const run = normalizeRun({
    ...base,
    title: body.title || base.title,
    task: body.task || base.task,
    repo: body.repo || base.repo,
    branch: body.branch || base.branch,
    lane: body.lane || base.lane,
    agent: body.agent || base.agent,
    risk: body.risk || base.risk,
    mode: body.mode || body.runMode || base.mode,
    eventSource: body.eventSource || base.eventSource,
    artifactRoot: body.artifactRoot || base.artifactRoot,
    adapterPath: base.adapterPath,
    adapterPolicy: base.adapterPolicy,
    auth: base.auth,
    // Never trust client-supplied completion, artifact truth, events, or approvals on run creation.
    status: "running",
    approvals: [],
    artifacts: createBaseArtifacts(base.adapterPolicy),
    events: [],
  });
  return { run };
}

function normalizeEvent(runId, event) {
  const nodeId = event.nodeId || event.node;
  const ts = event.ts || nowIso();
  return {
    id: event.id || `${runId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: event.type,
    ts,
    at: event.at || ts,
    actor: event.actor,
    nodeId,
    artifact: event.artifact,
    artifactRoot: event.artifactRoot,
    message: event.message,
    status: event.status,
    runMode: event.runMode,
    eventSource: event.eventSource,
    nodeState: event.nodeState,
    skipReason: event.skipReason,
    failureReason: event.failureReason,
    recoveryPath: event.recoveryPath,
    approvalOwner: event.approvalOwner,
    approvalScope: event.approvalScope,
    selfHealPrUrl: event.selfHealPrUrl,
    adapterPath: event.adapterPath,
  };
}

function eventContractProblems(event) {
  const problems = [];
  if (!event.type) problems.push("event.type is required");
  else if (!EVENT_TYPES.has(event.type)) problems.push(`unknown event.type: ${event.type}`);

  if (!event.actor) problems.push("event.actor is required");
  else if (!ACTORS.has(event.actor)) problems.push(`unknown event.actor: ${event.actor}`);

  if (!event.message) problems.push("event.message is required");

  if (!event.status) problems.push("event.status is required");
  else if (!STATUSES.has(event.status)) problems.push(`unknown event.status: ${event.status}`);

  if (!event.runMode) problems.push("event.runMode is required");
  else if (!RUN_MODES.has(event.runMode)) problems.push(`unknown event.runMode: ${event.runMode}`);

  if (!event.eventSource) problems.push("event.eventSource is required");
  else if (!EVENT_SOURCES.has(event.eventSource)) problems.push(`unknown event.eventSource: ${event.eventSource}`);

  if (!event.nodeId) problems.push("event.nodeId is required");
  else if (!NODE_IDS.has(event.nodeId)) problems.push(`unknown event.nodeId: ${event.nodeId}`);

  if ((event.type === "node.skipped" || event.status === "skipped") && !event.skipReason) {
    problems.push("node.skipped events must include skipReason");
  }
  if (event.type === "node.failed" || event.status === "failed") {
    if (!event.failureReason) problems.push("node.failed events must include failureReason");
    if (!event.recoveryPath) problems.push("node.failed events must include recoveryPath");
  }
  if (["approval.requested", "approval.granted", "approval.denied"].includes(event.type) || event.status === "needs_approval") {
    if (!event.approvalOwner) problems.push("approval events must include approvalOwner");
    if (!event.approvalScope) problems.push("approval events must include approvalScope");
  }
  if ((event.type === "approval.granted" || event.type === "approval.denied") && event.actor !== "human") {
    problems.push("approval.granted and approval.denied events must be emitted by actor human");
  }
  if ((event.type === "self_heal.pr_opened" || event.type === "self_heal.pr_proposed") && !event.selfHealPrUrl && !event.artifact) {
    problems.push("self-heal PR events must include selfHealPrUrl or artifact");
  }
  if (event.type === "artifact.written" && !event.artifact) {
    problems.push("artifact.written events must include artifact");
  }
  return problems;
}

function eventStateProblems(run, event, humanToken) {
  const problems = [];
  if (event.type === "approval.granted" || event.type === "approval.denied") {
    problems.push(...humanApprovalTokenProblems(run, event, humanToken));
    const approvals = normalizeApprovalRecords(run.approvals || []);
    const pending = approvals.find((approval) => approval.scope === event.approvalScope && approval.owner === event.approvalOwner && approval.status === "pending");
    if (!pending) problems.push(`approval ${event.type} requires an existing pending approval for ${event.approvalScope} owned by ${event.approvalOwner}`);
  }
  return problems;
}

function artifactTargetFor(run, event) {
  if (event.type === "artifact.written" && event.artifact) return event.artifact;
  return artifactPathForNode(run, event.nodeId) || event.artifact;
}

function artifactPathConsistencyProblems(run, event) {
  if (event.type !== "artifact.written" || !event.nodeId || !event.artifact) return [];
  const expected = artifactPathForNode(run, event.nodeId);
  if (expected && event.artifact !== expected) {
    return [`artifact.written for node ${event.nodeId} must use configured artifact path ${expected}; got ${event.artifact}`];
  }
  return [];
}

function artifactRootFor(run) {
  if (!run.artifactRoot) return null;
  return path.resolve(String(run.artifactRoot));
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveArtifactPath(run, target, requireExists = false) {
  const root = artifactRootFor(run);
  const problems = [];
  if (!root) return { problems: ["run.artifactRoot is required for artifact verification"] };
  if (!existsSync(root)) return { problems: [`artifactRoot does not exist: ${root}`] };

  const realRoot = realpathSync(root);
  const resolved = path.resolve(realRoot, target);
  if (!isInside(realRoot, resolved)) {
    problems.push(`artifact path escapes artifactRoot: ${target}`);
    return { root: realRoot, resolved, problems };
  }
  if (!existsSync(resolved)) {
    if (requireExists) problems.push(`artifact file does not exist under artifactRoot: ${target}`);
    return { root: realRoot, resolved, problems };
  }

  const lstat = lstatSync(resolved);
  if (lstat.isSymbolicLink()) problems.push(`artifact path is a symlink and is not allowed: ${target}`);
  const realTarget = realpathSync(resolved);
  if (!isInside(realRoot, realTarget)) problems.push(`artifact real path escapes artifactRoot: ${target}`);
  return { root: realRoot, resolved, realTarget, problems };
}

function artifactWriteProblems(run, event) {
  if (event.type !== "artifact.written") return [];
  const problems = artifactPathConsistencyProblems(run, event);
  if (problems.length) return problems;
  const result = resolveArtifactPath(run, event.artifact, true);
  problems.push(...result.problems);
  if (!problems.length && isProofEvent(run, event)) problems.push(...validateProofDocument(result.resolved).problems);
  return problems;
}

function artifactVerification(run, event) {
  if (event.type !== "artifact.written") return undefined;
  const result = resolveArtifactPath(run, event.artifact, true);
  if (result.problems.length) return { checked: true, exists: false, problems: result.problems, path: result.resolved };
  const stat = statSync(result.resolved);
  const verification = { checked: true, exists: true, path: result.resolved, realPath: result.realTarget, size: stat.size, mtimeMs: stat.mtimeMs };
  if (isProofEvent(run, event)) verification.proof = validateProofDocument(result.resolved);
  return verification;
}

function unresolvedApprovalProblems(run) {
  const approvals = normalizeApprovalRecords(run.approvals || []);
  return approvals.flatMap((approval) => {
    if (approval.status === "pending") return [`approval pending for ${approval.scope} owned by ${approval.owner}`];
    if (approval.status === "denied") return [`approval denied for ${approval.scope} by ${approval.owner}`];
    return [];
  });
}

function selfHealProblems(run) {
  const events = run.events || [];
  const detectedIndex = events.findLastIndex((event) => event.type === "self_heal.detected");
  if (detectedIndex < 0) return [];
  const resolvedIndex = events.findIndex((event, index) => index > detectedIndex && (event.type === "self_heal.pr_opened" || event.type === "self_heal.pr_proposed"));
  return resolvedIndex >= 0 ? [] : ["self-heal detected without later self_heal.pr_opened or self_heal.pr_proposed"];
}

function artifactProofProblems(run, artifact) {
  if (!artifact.present) return [`${artifact.path} missing or not skipped`];
  if (!artifact.verification?.checked) return [`${artifact.path} present but not verified against artifactRoot`];
  if (!artifact.verification.exists) return [`${artifact.path} was claimed but file verification failed`];
  if (artifact.nodeId === "prove" && artifact.verification.proof?.valid !== true) {
    const problems = artifact.verification.proof?.problems?.join("; ") || "proof content was not schema-validated";
    return [`${artifact.path} failed ${PROOF_SCHEMA} validation: ${problems}`];
  }
  return [];
}

function finishLineProblems(run) {
  const problems = [];
  for (const artifact of run.artifacts || []) {
    if (!artifact.required) continue;
    if (artifact.failed) {
      problems.push(`${artifact.path} failed${artifact.recoveryPath ? `; recovery: ${artifact.recoveryPath}` : ""}`);
      continue;
    }
    if (artifact.skipped) {
      if (!artifact.skipReason) problems.push(`${artifact.path} skipped without a reason`);
      continue;
    }
    problems.push(...artifactProofProblems(run, artifact));
  }
  problems.push(...unresolvedApprovalProblems(run));
  problems.push(...selfHealProblems(run));
  return problems;
}

function updateApproval(run, event) {
  const approvals = normalizeApprovalRecords(run.approvals || []);
  if (!["approval.requested", "approval.granted", "approval.denied"].includes(event.type) && event.status !== "needs_approval") return approvals;
  const scope = event.approvalScope;
  const owner = event.approvalOwner;
  const status = event.type === "approval.granted" ? "granted" : event.type === "approval.denied" ? "denied" : "pending";
  const existingIndex = approvals.findIndex((approval) => approval.scope === scope && approval.owner === owner);
  const record = {
    scope,
    owner,
    nodeId: event.nodeId,
    status,
    eventId: event.id,
    updatedAt: nowIso(),
  };
  if (existingIndex >= 0) {
    approvals[existingIndex] = { ...approvals[existingIndex], ...record };
    return approvals;
  }
  return [...approvals, record];
}

function applyArtifactEvent(run, event, verification) {
  const targetArtifact = artifactTargetFor(run, event);
  if (!targetArtifact) return run.artifacts || createBaseArtifacts();
  const artifacts = (run.artifacts || createBaseArtifacts()).some((entry) => entry.path === targetArtifact)
    ? run.artifacts || createBaseArtifacts()
    : [
        ...(run.artifacts || createBaseArtifacts()),
        {
          path: targetArtifact,
          label: labelByNode[event.nodeId] || event.nodeId || targetArtifact,
          nodeId: event.nodeId,
          required: true,
          present: false,
        },
      ];

  return artifacts.map((entry) => {
    if (entry.path !== targetArtifact) return entry;
    if (event.type === "node.skipped" || event.status === "skipped") {
      return {
        ...entry,
        present: false,
        skipped: true,
        failed: false,
        skipReason: event.skipReason || event.message,
        evidenceArtifact: event.artifact,
      };
    }
    if (event.type === "node.failed" || event.status === "failed" || event.status === "blocked") {
      return {
        ...entry,
        present: false,
        skipped: false,
        failed: true,
        failureReason: event.failureReason || event.message,
        recoveryPath: event.recoveryPath,
        evidenceArtifact: event.artifact,
      };
    }
    if (event.type === "artifact.written") {
      return {
        ...entry,
        present: true,
        skipped: false,
        failed: false,
        evidenceArtifact: event.artifact || targetArtifact,
        verification,
      };
    }
    if (event.type === "approval.granted" && event.nodeId === "redzone") {
      return {
        ...entry,
        present: true,
        skipped: false,
        failed: false,
        evidenceArtifact: event.artifact || targetArtifact,
        verification: { checked: true, exists: true, source: "human-approval-event", eventId: event.id },
      };
    }
    return entry;
  });
}

function applyEvent(run, event) {
  const verification = artifactVerification(run, event);
  const updated = normalizeRun({
    ...run,
    mode: event.runMode || run.mode || "live",
    eventSource: event.eventSource || run.eventSource || "bridge",
    currentNodeId: event.nodeId || run.currentNodeId,
    artifactRoot: event.artifactRoot || run.artifactRoot,
    updatedAt: nowIso(),
    events: [...(run.events || []), event],
  });

  updated.approvals = updateApproval(updated, event);
  updated.artifacts = applyArtifactEvent(updated, event, verification);

  if (event.type === "approval.requested" || event.status === "needs_approval") updated.status = "approval";
  else if (event.type === "approval.denied" || event.type === "run.blocked" || event.type === "node.failed" || event.status === "blocked" || event.status === "failed") updated.status = "blocked";
  else if (event.type === "run.completed") updated.status = "complete";
  else if (unresolvedApprovalProblems(updated).length) updated.status = "approval";
  else updated.status = "running";

  return updated;
}

async function listRuns() {
  await mkdir(DATA_DIR, { recursive: true });
  const names = await readdir(DATA_DIR);
  const runs = [];
  for (const name of names) {
    const file = path.join(DATA_DIR, name, "run.json");
    if (!existsSync(file)) continue;
    try {
      runs.push(normalizeRun(JSON.parse(await readFile(file, "utf8"))));
    } catch {
      // Skip corrupt local bridge files instead of crashing the connector.
    }
  }
  return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function appendEvent(runId, event) {
  await appendFile(path.join(runDir(runId), "events.jsonl"), JSON.stringify(event) + "\n");
}

async function handle(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, "");

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: SERVICE,
        contractVersion: CONTRACT_VERSION,
        dataDir: DATA_DIR,
        port: PORT,
        eventTypes: Array.from(EVENT_TYPES),
        nodeIds: Array.from(NODE_IDS),
        proofSchema: PROOF_SCHEMA,
        adapterAware: true,
        humanApprovalTokenConfigured: Boolean(process.env.UASH_HUMAN_APPROVAL_TOKEN),
        repoRoot: REPO_ROOT,
      });
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      return send(res, 200, await listRuns());
    }

    if (req.method === "POST" && url.pathname === "/runs") {
      const body = await readJson(req);
      if (!body.id) return send(res, 400, { error: "run.id is required" });
      if (body.status === "complete") {
        return send(res, 409, { ok: false, error: "run_creation_cannot_complete", problems: ["Create runs as running; completion must flow through verified run.completed events."] });
      }
      if (body.humanApprovalToken || body.humanToken || body.auth) {
        return send(res, 400, { ok: false, error: "client_supplied_human_token_rejected", problems: ["Human approval tokens are operator-held process configuration, not POST /runs input. Set UASH_HUMAN_APPROVAL_TOKEN on the bridge process."] });
      }
      let created;
      try {
        created = createRunFromBody(body);
      } catch (error) {
        return send(res, 400, { ok: false, error: "adapter_policy_violation", problems: [error instanceof Error ? error.message : String(error)] });
      }
      await writeRun(created.run);
      return send(res, 200, {
        ...created.run,
        humanApprovalTokenRequired: true,
        humanApprovalTokenNotice: "Approval grant/deny requires operator-held UASH_HUMAN_APPROVAL_TOKEN sent as x-uash-human-token or --human-token. Raw tokens are never accepted from POST /runs and never returned by HTTP.",
      });
    }

    if (parts[0] === "runs" && parts[1] && req.method === "GET" && parts.length === 2) {
      return send(res, 200, await readRun(parts[1]));
    }

    if (parts[0] === "runs" && parts[1] && parts[2] === "events" && req.method === "POST") {
      const runId = parts[1];
      const body = await readJson(req);
      const humanToken = extractHumanToken(req, body);
      let run;
      try {
        run = await readRun(runId);
      } catch {
        try {
          run = createMinimalRun(runId, body);
        } catch (error) {
          return send(res, 400, { ok: false, error: "adapter_policy_violation", problems: [error instanceof Error ? error.message : String(error)] });
        }
      }
      if (body.adapterPath && !run.adapterPolicy) {
        try {
          const adapterConfig = loadAdapterPolicy(body.adapterPath, body.artifactRoot || run.artifactRoot);
          run = normalizeRun({ ...run, adapterPath: adapterConfig.adapterPath, adapterPolicy: adapterConfig.adapterPolicy, artifacts: createBaseArtifacts(adapterConfig.adapterPolicy) });
        } catch (error) {
          return send(res, 400, { ok: false, error: "adapter_policy_violation", problems: [error instanceof Error ? error.message : String(error)] });
        }
      }
      const event = normalizeEvent(runId, body);
      const contractProblems = eventContractProblems(event);
      if (contractProblems.length) {
        return send(res, 400, { ok: false, error: "event_contract_violation", problems: contractProblems });
      }
      const stateProblems = eventStateProblems(run, event, humanToken);
      if (stateProblems.length) {
        return send(res, 409, { ok: false, error: "event_state_violation", problems: stateProblems });
      }
      const artifactProblems = artifactWriteProblems(run, event);
      if (artifactProblems.length) {
        return send(res, 400, { ok: false, error: "artifact_verification_failed", problems: artifactProblems });
      }

      const nextRun = applyEvent(run, event);
      if (event.type === "run.completed") {
        const problems = finishLineProblems(nextRun);
        if (problems.length) {
          const blockedEvent = normalizeEvent(runId, {
            type: "run.blocked",
            nodeId: "prove",
            artifact: "proof/proof.json",
            status: "blocked",
            actor: "harness",
            runMode: nextRun.mode || "live",
            eventSource: nextRun.eventSource || "bridge",
            message: `Finish line blocked: ${problems.join("; ")}`,
            failureReason: "Finish-line contract unsatisfied.",
            recoveryPath: "Attach verified artifacts, resolve approvals/self-heal, or emit node.skipped with explicit reasons, then retry run.completed.",
          });
          const blockedRun = applyEvent(run, blockedEvent);
          await writeRun(blockedRun);
          await appendEvent(runId, blockedEvent);
          return send(res, 409, { ok: false, error: "finish_line_blocked", problems, run: blockedRun, event: blockedEvent });
        }
      }

      await writeRun(nextRun);
      await appendEvent(runId, event);
      return send(res, 200, { ok: true, run: nextRun, event });
    }

    return send(res, 404, { error: "not_found", routes: ["GET /health", "GET /runs", "POST /runs", "GET /runs/:id", "POST /runs/:id/events"] });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

await mkdir(DATA_DIR, { recursive: true });

createServer(handle).listen(PORT, HOST, () => {
  console.log(`${SERVICE} listening on http://${HOST}:${PORT}`);
  console.log(`contract: ${CONTRACT_VERSION}`);
  console.log(`data dir: ${DATA_DIR}`);
  console.log(process.env.UASH_HUMAN_APPROVAL_TOKEN ? "human approval token: configured from UASH_HUMAN_APPROVAL_TOKEN" : "human approval token: NOT configured; approval.granted/denied will be rejected until UASH_HUMAN_APPROVAL_TOKEN is set");
  console.log("Open the app, click Check bridge, then Sync run to bridge.");
});
