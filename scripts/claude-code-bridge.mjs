#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, open, readFile, readdir, rename, truncate, unlink } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPairwiseDistinctBridgeCredentials, finishLineChildEnv } from "./bridge-security.mjs";
import { validateProductionLayerAssessment } from "./production-layer-gate.mjs";
import { requiredReviewTrustSha256 } from "./review-gate.mjs";
import { routeRequiresRca, validationRuntimeBinding } from "./run-packet-gate.mjs";

const PORT = Number(process.env.UASH_BRIDGE_PORT || 8787);
const HOST = process.env.UASH_BRIDGE_HOST || "127.0.0.1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const DATA_DIR = path.resolve(process.env.UASH_DATA_DIR || path.join(os.homedir(), ".uash", "runs"));
const SERVICE = "uash-claude-code-bridge";
const CONTRACT_VERSION = "uash.connector-events.v0.5";
const PROOF_SCHEMA = "uash.proof.v1";
const EVENT_JOURNAL_SCHEMA = "uash.bridge-event-journal.v1";
const RUN_SNAPSHOT_SCHEMA = "uash.bridge-run-snapshot.v1";
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OBSERVED_RUN_HEADS = new Map();
const COMPLETED_RUN_VALIDATIONS = new Map();
const MAX_COMPLETED_RUN_VALIDATIONS = 256;
const COMPLETED_RUN_VALIDATION_METRICS = { executions: 0, cacheHits: 0 };
const FINISH_LINE_GATE_TIMEOUT_MS = 120_000;
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 768 * 1024;
const MAX_EVENT_DOCUMENT_BYTES = 16 * 1024;
const MAX_EVENTS_PER_RUN = boundedEnvironmentInteger("UASH_BRIDGE_MAX_EVENTS_PER_RUN", 2048, 1, 2048);
const MAX_EVENT_JOURNAL_BYTES = MAX_EVENTS_PER_RUN * (MAX_EVENT_DOCUMENT_BYTES + 1024);
const MAX_RUN_CONFIG_BYTES = 512 * 1024;
const MAX_RUN_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const DEFAULT_RUN_PAGE_LIMIT = 25;
const MAX_RUN_PAGE_LIMIT = 50;
const DEFAULT_EVENT_PAGE_LIMIT = 100;
const MAX_EVENT_PAGE_LIMIT = 200;
const MAX_RUN_DIRECTORY_ENTRIES = 10_000;
const MAX_PUBLIC_APPROVALS = 100;
const MAX_PUBLIC_APPROVAL_BYTES = 48 * 1024;
const MINIMUM_BRIDGE_CREDENTIAL_BYTES = 32;
const BRIDGE_SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(process.env.UASH_REPO_ROOT || process.cwd());
const EXTRA_ADAPTER_ROOTS = (process.env.UASH_ADAPTER_ROOTS || "")
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => path.resolve(entry));
const EXTRA_ALLOWED_ORIGINS = new Set((process.env.UASH_ALLOWED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean));
const REVIEW_TRUST_SHA256 = requiredReviewTrustSha256();
process.env.UASH_REVIEW_TRUST_SHA256 = REVIEW_TRUST_SHA256;

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
  return path.join(DATA_DIR, storageRunKey(runId));
}

function canonicalRunId(value) {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    const error = new Error("run.id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
    error.code = "INVALID_RUN_ID";
    throw error;
  }
  return value;
}

function storageRunKey(runId) {
  const canonicalId = canonicalRunId(runId);
  return `run-${createHash("sha256").update(canonicalId, "utf8").digest("hex")}`;
}

function assertMonotonicObservedJournal(runId, journalState) {
  const prior = OBSERVED_RUN_HEADS.get(runId);
  if (prior) {
    if (journalState.events.length < prior.eventCount) {
      throw new Error("authenticated event journal rolled back below the process-observed head");
    }
    const retainedHead = prior.eventCount > 0 ? journalState.digests[prior.eventCount - 1] : null;
    if (retainedHead !== prior.journalHeadDigest) {
      throw new Error("authenticated event journal no longer extends the process-observed head");
    }
  }
  OBSERVED_RUN_HEADS.set(runId, {
    eventCount: journalState.events.length,
    journalHeadDigest: journalState.lastDigest || null,
  });
}

function nowIso() {
  return new Date().toISOString();
}

function boundedEnvironmentInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function allowedBridgeOrigin(origin) {
  if (!origin) return false;
  if (EXTRA_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && LOOPBACK_HOSTS.has(parsed.hostname)
      && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function send(res, status, body, extraHeaders = {}) {
  let payload = typeof body === "string" ? body : JSON.stringify(body);
  let responseStatus = status;
  if (Buffer.byteLength(payload, "utf8") > MAX_RESPONSE_BODY_BYTES) {
    responseStatus = 500;
    payload = JSON.stringify({
      ok: false,
      error: "response_page_too_large",
      message: "The requested bridge page exceeded the response byte limit. Request a smaller page.",
      limitBytes: MAX_RESPONSE_BODY_BYTES,
    });
  }
  const origin = res.req?.headers?.origin;
  const headers = {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload, "utf8")),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, x-uash-bridge-token, x-uash-human-token",
    "vary": "Origin",
    ...extraHeaders,
  };
  if (allowedBridgeOrigin(origin)) headers["access-control-allow-origin"] = origin;
  res.writeHead(responseStatus, headers);
  res.end(payload);
}

function boundedPageParameter(searchParams, name, fallback, minimum, maximum, { optional = false } = {}) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { value: optional ? null : fallback, problems: [] };
  if (values.length !== 1 || !/^\d+$/.test(values[0])) {
    return { value: null, problems: [`${name} must be supplied once as an integer between ${minimum} and ${maximum}`] };
  }
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return { value: null, problems: [`${name} must be an integer between ${minimum} and ${maximum}`] };
  }
  return { value, problems: [] };
}

function paginationHeaders({ offset, limit, returned, total, nextCursor }) {
  const headers = {
    "x-uash-page-offset": String(offset),
    "x-uash-page-limit": String(limit),
    "x-uash-page-returned": String(returned),
    "x-uash-page-total": String(total),
  };
  if (nextCursor !== null && nextCursor !== undefined) headers["x-uash-next-cursor"] = String(nextCursor);
  return headers;
}

function unsupportedQueryParameterProblems(searchParams, allowedNames) {
  const allowed = new Set(allowedNames);
  return [...new Set(searchParams.keys())]
    .filter((name) => !allowed.has(name))
    .map((name) => `unsupported query parameter: ${name}`);
}


function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function digestHumanApprovalToken(token) {
  return `sha256:${sha256(token)}`;
}

function humanApprovalTokenMatches(token, expectedDigest) {
  if (!token || !expectedDigest) return false;
  return safeCompare(digestHumanApprovalToken(token), expectedDigest);
}

function extractHumanToken(req) {
  const headerToken = req.headers["x-uash-human-token"];
  if (Array.isArray(headerToken)) return headerToken[0];
  return headerToken;
}

function humanApprovalAuthRecord(now = nowIso()) {
  const envToken = requiredHumanApprovalToken();
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

function bridgeAccessTokenProblems(req) {
  const suppliedHeader = req.headers["x-uash-bridge-token"];
  const supplied = Array.isArray(suppliedHeader) ? suppliedHeader[0] : suppliedHeader;
  if (!supplied) return ["x-uash-bridge-token is required for run reads and writes"];
  if (!safeCompare(String(supplied), requiredBridgeAccessToken())) return ["x-uash-bridge-token did not match UASH_BRIDGE_ACCESS_TOKEN"];
  return [];
}

function gitHeadAt(repoRoot) {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    killSignal: "SIGTERM",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`target must be a Git worktree with a committed HEAD: ${String(result.stderr || result.stdout || result.error?.message || "unknown Git error").trim()}`);
  const commit = String(result.stdout || "").trim();
  if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw new Error("target Git HEAD is invalid");
  return commit;
}

function canonicalCommissionedRuntime(artifactRoot) {
  if (!artifactRoot) return null;
  const root = path.resolve(String(artifactRoot));
  if (!existsSync(root)) return null;
  const realRoot = realpathSync(root);
  const pack = path.join(realRoot, ".valdris-harness");
  if (!existsSync(pack)) return null;
  const packStats = lstatSync(pack);
  if (packStats.isSymbolicLink() || !packStats.isDirectory()) throw new Error("canonical .valdris-harness runtime must be a regular directory");
  const realPack = realpathSync(pack);
  if (!isInside(realRoot, realPack)) throw new Error("canonical .valdris-harness runtime escapes artifactRoot");
  const adapterPath = path.join(realPack, "project-adapter.json");
  if (!existsSync(adapterPath)) throw new Error("canonical .valdris-harness runtime is missing project-adapter.json");
  const adapterStats = lstatSync(adapterPath);
  if (adapterStats.isSymbolicLink() || !adapterStats.isFile()) throw new Error("canonical nested project adapter must be a regular file");
  const scripts = path.join(realPack, "scripts");
  if (!existsSync(scripts)) throw new Error("canonical .valdris-harness scripts directory is missing");
  const scriptStats = lstatSync(scripts);
  if (scriptStats.isSymbolicLink() || !scriptStats.isDirectory()) throw new Error("canonical .valdris-harness scripts path must be a regular directory");
  return { root: realRoot, pack: realPack, scripts: realpathSync(scripts), adapterPath: realpathSync(adapterPath) };
}

function assertCommissionedScriptsMatchHost(binding) {
  const sources = (binding.files || []).filter(({ kind }) => kind === "validator-source");
  if (sources.length === 0) throw new Error("commissioned runtime has no bound validator sources");
  for (const source of sources) {
    const relativePath = String(source.path || "").replaceAll("\\", "/");
    if (!relativePath.startsWith("scripts/") || path.posix.normalize(relativePath) !== relativePath) {
      throw new Error(`commissioned validator path is invalid: ${relativePath}`);
    }
    const hostFile = path.join(path.resolve(BRIDGE_SCRIPT_DIR, ".."), ...relativePath.split("/"));
    if (!isInside(BRIDGE_SCRIPT_DIR, hostFile) || !existsSync(hostFile)) {
      throw new Error(`commissioned validator is not present in the trusted host runtime: ${relativePath}`);
    }
    const stats = lstatSync(hostFile);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`trusted host validator must be a regular file: ${relativePath}`);
    const hostBytes = readFileSync(hostFile);
    const hostText = hostBytes.toString("utf8");
    if (hostBytes.includes(0) || !Buffer.from(hostText, "utf8").equals(hostBytes)) throw new Error(`trusted host validator must be UTF-8 text: ${relativePath}`);
    const hostSha256 = createHash("sha256").update(hostText.replace(/\r\n/g, "\n"), "utf8").digest("hex");
    if (source.sha256 !== hostSha256) {
      throw new Error(`commissioned validator differs from the trusted host runtime; recommission required: ${relativePath}`);
    }
  }
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
    productionReadinessSchema: adapter.productionReadiness?.schema,
    enterpriseFinishLineRequired: adapter.finishLineAssurance?.required === true,
    portableFinishLineRequired: adapter.finishLineAssurance?.packetRequired === true,
  };
}

function bootstrapCommissionedRuntime(artifactRoot) {
  const runtime = canonicalCommissionedRuntime(artifactRoot);
  if (!runtime) return null;
  const commit = gitHeadAt(runtime.root);
  const binding = validationRuntimeBinding(runtime.root, commit, { runtimeRoot: runtime.pack });
  assertCommissionedScriptsMatchHost(binding);
  const adapter = JSON.parse(readFileSync(runtime.adapterPath, "utf8"));
  const adapterPolicy = adapterPolicyFrom(adapter);
  if (!adapterPolicy.enterpriseFinishLineRequired || !adapterPolicy.portableFinishLineRequired) {
    throw new Error("canonical v0.8 project adapter cannot disable enterprise or portable finish-line assurance");
  }
  return { ...runtime, commit, binding, adapterPolicy };
}

function commissionedRuntimeIdentity(runtime) {
  return {
    schema: "uash.commissioned-runtime-identity.v1",
    runtimeSha256: runtime.binding.runtimeSha256,
    targetPath: runtime.binding.source.targetPath,
    runtimePath: runtime.binding.source.runtimePath,
  };
}

function generatorRequiresCanonicalRuntime(version) {
  const [major, minor] = String(version || "").split(".").map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) && (major > 0 || minor >= 8);
}

function loadAdapterPolicy(adapterPath, artifactRoot) {
  const canonicalRuntime = bootstrapCommissionedRuntime(artifactRoot);
  const rootAdapter = artifactRoot ? path.resolve(String(artifactRoot), "project-adapter.json") : null;
  if (canonicalRuntime) {
    if (adapterPath) {
      const explicit = resolveAdapterPath(adapterPath, artifactRoot);
      if (explicit.problems.length) throw new Error(explicit.problems.join("; "));
      if (path.relative(canonicalRuntime.adapterPath, realpathSync(explicit.adapterPath)) !== "") {
        throw new Error("canonical nested project adapter exists; explicit adapterPath must identify .valdris-harness/project-adapter.json");
      }
    }
    if (rootAdapter && existsSync(rootAdapter) && path.relative(canonicalRuntime.adapterPath, realpathSync(rootAdapter)) !== "") {
      const rootStats = lstatSync(rootAdapter);
      if (rootStats.isSymbolicLink() || !rootStats.isFile() || !readFileSync(rootAdapter).equals(readFileSync(canonicalRuntime.adapterPath))) {
        throw new Error("legacy target-root project adapter conflicts with the canonical nested adapter");
      }
    }
    return { adapterPath: canonicalRuntime.adapterPath, adapterPolicy: canonicalRuntime.adapterPolicy, commissionedRuntime: commissionedRuntimeIdentity(canonicalRuntime) };
  }
  const implicitAdapter = !adapterPath && rootAdapter && existsSync(rootAdapter)
    ? rootAdapter
    : !adapterPath && existsSync(path.resolve(REPO_ROOT, "project-adapter.json"))
        ? path.resolve(REPO_ROOT, "project-adapter.json")
        : adapterPath;
  if (!implicitAdapter) return { adapterPath: null, adapterPolicy: undefined };
  const resolved = resolveAdapterPath(implicitAdapter, artifactRoot);
  if (resolved.problems.length) throw new Error(resolved.problems.join("; "));
  const adapter = JSON.parse(readFileSync(resolved.adapterPath, "utf8"));
  const adapterPolicy = adapterPolicyFrom(adapter);
  if (adapterPolicy.portableFinishLineRequired || generatorRequiresCanonicalRuntime(adapterPolicy.generatorVersion)) {
    throw new Error("portable v0.8 adapter policy requires the canonical target-nested .valdris-harness runtime");
  }
  return { adapterPath: resolved.adapterPath, adapterPolicy };
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

function isProductionLayerEvent(run, event) {
  const productionPath = artifactPathForNode(run, "production-readiness") || artifactByNode["production-readiness"];
  return event.nodeId === "production-readiness" || event.artifact === productionPath || event.artifact === artifactByNode["production-readiness"];
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
  const envToken = process.env.UASH_HUMAN_APPROVAL_TOKEN;
  if (envToken) {
    if (!humanToken) return ["human approval token is required for approval grant/deny events"];
    if (!safeCompare(String(humanToken), String(envToken))) return ["human approval token did not match UASH_HUMAN_APPROVAL_TOKEN"];
    const runDigest = run.auth?.humanApprovalTokenSha256;
    if (runDigest && !humanApprovalTokenMatches(envToken, runDigest)) return ["current operator token does not match the token sealed for this run"];
    return [];
  }
  return ["human approval token is required; create a new run with operator-held UASH_HUMAN_APPROVAL_TOKEN configured before approval or commissioning"];
}

function requestBodyError(code) {
  const error = new Error(code === "REQUEST_BODY_TOO_LARGE"
    ? "request payload exceeds the configured byte limit"
    : "request body is not valid JSON");
  error.code = code;
  return error;
}

function discardUnreadRequestBody(req) {
  if (req.destroyed || req.complete) return;
  req.once("error", () => {});
  req.resume();
}

function declaredRequestBodyBytes(req) {
  const header = req.headers["content-length"];
  if (header === undefined) return null;
  if (Array.isArray(header) || !/^\d+$/.test(String(header))) {
    throw requestBodyError("INVALID_JSON");
  }
  const declared = BigInt(header);
  if (declared > BigInt(MAX_REQUEST_BODY_BYTES)) {
    discardUnreadRequestBody(req);
    throw requestBodyError("REQUEST_BODY_TOO_LARGE");
  }
  return Number(declared);
}

async function readJson(req) {
  declaredRequestBodyBytes(req);
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAborted);
      req.off("error", onError);
    };
    const settle = (operation) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.byteLength;
      if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
        settle(() => {
          discardUnreadRequestBody(req);
          reject(requestBodyError("REQUEST_BODY_TOO_LARGE"));
        });
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    const onAborted = () => settle(() => reject(requestBodyError("INVALID_JSON")));
    const onError = () => settle(() => reject(requestBodyError("INVALID_JSON")));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("aborted", onAborted);
    req.on("error", onError);
    if (req.readableEnded) onEnd();
  });
  if (!raw.trim()) return {};
  try {
    const document = JSON.parse(raw);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw requestBodyError("INVALID_JSON");
    }
    return document;
  } catch {
    throw requestBodyError("INVALID_JSON");
  }
}

function sendPayloadTooLarge(req, res) {
  res.shouldKeepAlive = false;
  res.setHeader("connection", "close");
  if (!req.complete && !req.destroyed) {
    discardUnreadRequestBody(req);
    res.once("finish", () => {
      if (!req.complete && !req.destroyed) req.destroy();
    });
  }
  return send(res, 413, { ok: false, error: "payload_too_large" });
}

async function writeTextAtomically(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readBoundedBridgeStateFile(file, maximumBytes, label) {
  const stats = statSync(file);
  if (!stats.isFile() || stats.size > maximumBytes) {
    throw new Error(`${label} must be a regular file no larger than ${maximumBytes} bytes`);
  }
  return readFile(file, "utf8");
}

function boundedBridgeStateText(document, maximumBytes, label) {
  const text = JSON.stringify(document, null, 2) + "\n";
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte safety limit`);
  }
  return text;
}

async function readRun(runId) {
  const expectedRunId = canonicalRunId(runId);
  const file = path.join(runDir(runId), "run.json");
  const raw = await readBoundedBridgeStateFile(file, MAX_RUN_SNAPSHOT_BYTES, "bridge run snapshot");
  const verifiedSnapshot = verifiedRunSnapshotPayload(JSON.parse(raw));
  let run = verifiedSnapshot.run;
  if (run.id !== expectedRunId) throw new Error("persisted run identity does not match its canonical storage key");
  const configPath = path.join(runDir(runId), "run-config.json");
  if (!existsSync(configPath)) throw new Error("immutable bridge run configuration is missing");
  const persistedConfig = verifiedRunConfigPayload(JSON.parse(await readBoundedBridgeStateFile(configPath, MAX_RUN_CONFIG_BYTES, "bridge run configuration")));
  const journalState = await readEventJournalState(runId);
  assertMonotonicObservedJournal(expectedRunId, journalState);
  const persistedEvents = journalState.events;
  const snapshotEvents = Array.isArray(run.events) ? run.events : [];
  if (snapshotEvents.length > persistedEvents.length
    || JSON.stringify(snapshotEvents) !== JSON.stringify(persistedEvents.slice(0, snapshotEvents.length))) {
    throw new Error("persisted run snapshot is not a prefix of the authoritative bridge event journal");
  }
  const expectedSnapshotHead = verifiedSnapshot.eventCount > 0
    ? journalState.digests[verifiedSnapshot.eventCount - 1]
    : null;
  if (verifiedSnapshot.eventCount !== snapshotEvents.length
    || verifiedSnapshot.journalHeadDigest !== expectedSnapshotHead) {
    throw new Error("persisted run snapshot is not bound to its authenticated journal prefix");
  }

  const snapshotConfig = immutableRunConfig(run);
  const configurationMatchesSnapshot = JSON.stringify(persistedConfig) === JSON.stringify(snapshotConfig);
  let snapshotRepairRequired = false;
  if (!configurationMatchesSnapshot) {
    const persistedAddsArtifactRoot = !snapshotConfig.artifactRoot && Boolean(persistedConfig.artifactRoot);
    const persistedAddsAdapter = !snapshotConfig.adapterPolicy && Boolean(persistedConfig.adapterPolicy);
    const firstEventSealBase = snapshotEvents.length === 0
      && !snapshotConfig.adapterPolicy
      && !snapshotConfig.commissionedRuntime
      && (persistedAddsArtifactRoot || persistedAddsAdapter);
    const canRecoverPreEventSeal = firstEventSealBase && persistedEvents.length === 0;
    const canRecoverJournaledFirstEventSeal = firstEventSealBase && persistedEvents.length > 0;
    if (!canRecoverPreEventSeal && !canRecoverJournaledFirstEventSeal) {
      throw new Error("persisted run configuration does not match the immutable bridge creation record");
    }
    const sealedBase = normalizeRun({
      ...run,
      artifactRoot: persistedConfig.artifactRoot || undefined,
      adapterPath: persistedConfig.adapterPath || undefined,
      adapterPolicy: persistedConfig.adapterPolicy || undefined,
      commissionedRuntime: persistedConfig.commissionedRuntime || undefined,
      artifacts: createBaseArtifacts(persistedConfig.adapterPolicy || undefined),
    });
    const recovered = canRecoverPreEventSeal ? sealedBase : replayJournalEvents(sealedBase, persistedEvents);
    if (JSON.stringify(persistedConfig) !== JSON.stringify(immutableRunConfig(recovered))) {
      throw new Error("persisted run configuration does not match a recoverable first-event commissioning seal");
    }
    run = recovered;
    snapshotRepairRequired = true;
  } else if (snapshotEvents.length < persistedEvents.length) {
    run = replayJournalEvents(run, persistedEvents.slice(snapshotEvents.length));
    snapshotRepairRequired = true;
  }
  run = validateRunRuntimeTrust(run);
  run = validatePersistedRunState(run, persistedEvents);
  if (run.status === "complete") {
    const validationFingerprint = completedRunValidationFingerprint(run, journalState);
    if (COMPLETED_RUN_VALIDATIONS.get(run.id) !== validationFingerprint) {
      COMPLETED_RUN_VALIDATION_METRICS.executions += 1;
      const problems = finishLineProblems(run);
      if (problems.length) {
        COMPLETED_RUN_VALIDATIONS.delete(run.id);
        throw new Error(`completed run failed trust revalidation: ${problems.join("; ")}`);
      }
      COMPLETED_RUN_VALIDATIONS.set(run.id, validationFingerprint);
      while (COMPLETED_RUN_VALIDATIONS.size > MAX_COMPLETED_RUN_VALIDATIONS) {
        COMPLETED_RUN_VALIDATIONS.delete(COMPLETED_RUN_VALIDATIONS.keys().next().value);
      }
    } else {
      COMPLETED_RUN_VALIDATION_METRICS.cacheHits += 1;
    }
  } else {
    COMPLETED_RUN_VALIDATIONS.delete(run.id);
  }
  if (snapshotRepairRequired) await writeRun(run);
  return run;
}

function replayJournalEvents(run, events) {
  let replayed = run;
  for (const event of events) {
    if (!replayed.adapterPolicy && event.artifactRoot) {
      const adapterConfig = loadAdapterPolicy(undefined, event.artifactRoot);
      if (adapterConfig.adapterPolicy) {
        replayed = normalizeRun({
          ...replayed,
          artifactRoot: event.artifactRoot,
          adapterPath: adapterConfig.adapterPath,
          adapterPolicy: adapterConfig.adapterPolicy,
          commissionedRuntime: adapterConfig.commissionedRuntime,
          artifacts: createBaseArtifacts(adapterConfig.adapterPolicy),
        });
      }
    }
    replayed = applyEvent(replayed, event);
  }
  return replayed;
}

function journalRecordDigest(runId, event, previousDigest, key = null) {
  const serialized = `${EVENT_JOURNAL_SCHEMA}\0${runId}\0${previousDigest || ""}\0${JSON.stringify(event)}`;
  return key
    ? createHmac("sha256", key).update(serialized, "utf8").digest("hex")
    : createHash("sha256").update(serialized, "utf8").digest("hex");
}

function sealJournalEvent(runId, event, previousDigest) {
  const key = requiredRunIntegrityKey();
  return {
    schema: EVENT_JOURNAL_SCHEMA,
    event,
    integrity: {
      scheme: "hmac-sha256-chain",
      previousDigest: previousDigest || null,
      digest: journalRecordDigest(runId, event, previousDigest, key),
    },
  };
}

function sealedArtifactVerificationProblems(event) {
  const requiresSealedVerification = event.type === "artifact.written" || (event.type === "approval.granted" && Boolean(event.artifact));
  if (!requiresSealedVerification) return [];
  const verification = event.artifactVerification;
  const problems = [];
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    return [`${event.type} journal records with artifacts require a bridge-sealed artifactVerification`];
  }
  if (verification.checked !== true || verification.exists !== true) problems.push("sealed artifact verification must be a successful file check");
  if (typeof verification.path !== "string" || typeof verification.realPath !== "string") problems.push("sealed artifact verification must bind resolved paths");
  if (!Number.isFinite(verification.size) || verification.size < 0) problems.push("sealed artifact verification must bind file size");
  if (!Number.isFinite(verification.mtimeMs) || verification.mtimeMs < 0) problems.push("sealed artifact verification must bind file modification time");
  if (!/^[a-f0-9]{64}$/.test(verification.sha256 || "")) problems.push("sealed artifact verification must bind a SHA-256 content digest");
  return problems;
}

function verifiedJournalRecord(runId, record, previousDigest) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || record.schema !== EVENT_JOURNAL_SCHEMA
    || !record.event || typeof record.event !== "object" || Array.isArray(record.event)) {
    throw new Error("bridge event journal contains an invalid or unauthenticated record");
  }
  if ((record.integrity?.previousDigest || null) !== (previousDigest || null)) {
    throw new Error("bridge event journal digest chain is discontinuous");
  }
  const key = requiredRunIntegrityKey();
  const requiredScheme = "hmac-sha256-chain";
  const supplied = typeof record.integrity?.digest === "string" && /^[a-f0-9]{64}$/i.test(record.integrity.digest)
    ? Buffer.from(record.integrity.digest, "hex")
    : null;
  const expected = Buffer.from(journalRecordDigest(runId, record.event, previousDigest, key), "hex");
  if (record.integrity?.scheme !== requiredScheme
    || !supplied
    || supplied.length !== expected.length
    || !timingSafeEqual(supplied, expected)) {
    throw new Error("bridge event journal integrity verification failed");
  }
  const contractProblems = eventContractProblems(record.event);
  const sealedVerificationProblems = sealedArtifactVerificationProblems(record.event);
  if (typeof record.event.id !== "string" || !record.event.id || contractProblems.length || sealedVerificationProblems.length) {
    throw new Error(`bridge event journal contains an invalid event: ${[...(record.event.id ? [] : ["event.id is required"]), ...contractProblems, ...sealedVerificationProblems].join("; ")}`);
  }
  return { event: record.event, digest: record.integrity.digest };
}

async function readEventJournalState(runId) {
  const canonicalId = canonicalRunId(runId);
  const eventLogPath = path.join(runDir(runId), "events.jsonl");
  if (!existsSync(eventLogPath)) return { events: [], digests: [], lastDigest: null };
  const journalBytes = statSync(eventLogPath).size;
  if (journalBytes > MAX_EVENT_JOURNAL_BYTES) {
    throw new Error(`bridge event journal exceeds the ${MAX_EVENT_JOURNAL_BYTES}-byte safety limit`);
  }
  let raw = await readFile(eventLogPath, "utf8");
  if (raw && !raw.endsWith("\n")) {
    const completeEnd = raw.lastIndexOf("\n") + 1;
    raw = completeEnd > 0 ? raw.slice(0, completeEnd) : "";
    await truncate(eventLogPath, completeEnd > 0 ? completeEnd : 0);
  }
  const events = [];
  const digests = [];
  const eventIds = new Set();
  let previousDigest = null;
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    if (events.length >= MAX_EVENTS_PER_RUN) {
      throw new Error(`bridge event journal exceeds the ${MAX_EVENTS_PER_RUN}-event safety limit`);
    }
    if (Buffer.byteLength(line, "utf8") > MAX_EVENT_DOCUMENT_BYTES + 1024) {
      throw new Error("bridge event journal record exceeds the per-event safety limit");
    }
    const verified = verifiedJournalRecord(canonicalId, JSON.parse(line), previousDigest);
    if (eventIds.has(verified.event.id)) throw new Error(`bridge event journal contains duplicate event id: ${verified.event.id}`);
    eventIds.add(verified.event.id);
    events.push(verified.event);
    digests.push(verified.digest);
    previousDigest = verified.digest;
  }
  return { events, digests, lastDigest: previousDigest };
}

async function readEventJournal(runId) {
  return (await readEventJournalState(runId)).events;
}

async function writeRun(run) {
  run = normalizeRun(run);
  const dir = runDir(run.id);
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, "run-config.json");
  const runPath = path.join(dir, "run.json");
  const eventLogPath = path.join(dir, "events.jsonl");
  if (existsSync(configPath) && !existsSync(runPath)) {
    const journalSource = existsSync(eventLogPath)
      ? await readBoundedBridgeStateFile(eventLogPath, MAX_EVENT_JOURNAL_BYTES, "bridge event journal")
      : "";
    if (!journalSource.trim()) {
      const orphanedConfig = verifiedRunConfigPayload(JSON.parse(await readBoundedBridgeStateFile(configPath, MAX_RUN_CONFIG_BYTES, "bridge run configuration")));
      if (orphanedConfig.runId !== run.id) throw new Error("orphaned bridge run configuration belongs to a different run");
      run = validateRunRuntimeTrust(normalizeRun({
        ...run,
        contractVersion: orphanedConfig.contractVersion,
        createdAt: orphanedConfig.createdAt,
        artifactRoot: orphanedConfig.artifactRoot || undefined,
        adapterPath: orphanedConfig.adapterPath || undefined,
        adapterPolicy: orphanedConfig.adapterPolicy || undefined,
        commissionedRuntime: orphanedConfig.commissionedRuntime || undefined,
        reviewTrustSha256: orphanedConfig.reviewTrustSha256,
        artifacts: createBaseArtifacts(orphanedConfig.adapterPolicy || undefined),
        events: [],
      }));
      if (JSON.stringify(immutableRunConfig(run)) !== JSON.stringify(orphanedConfig)) {
        throw new Error("orphaned bridge run configuration could not be reconstructed exactly");
      }
    }
  }
  const config = immutableRunConfig(run);
  if (existsSync(configPath)) {
    const persisted = verifiedRunConfigPayload(JSON.parse(await readBoundedBridgeStateFile(configPath, MAX_RUN_CONFIG_BYTES, "bridge run configuration")));
    if (JSON.stringify(persisted) !== JSON.stringify(config)) {
      const priorRun = existsSync(runPath)
        ? verifiedRunSnapshotPayload(JSON.parse(await readBoundedBridgeStateFile(runPath, MAX_RUN_SNAPSHOT_BYTES, "bridge run snapshot"))).run
        : null;
      const addsFirstArtifactRoot = !persisted.artifactRoot && Boolean(config.artifactRoot);
      const addsFirstAdapter = !persisted.adapterPolicy && Boolean(config.adapterPolicy);
      const safeFirstEventSeal = priorRun
        && JSON.stringify(persisted) === JSON.stringify(immutableRunConfig(priorRun))
        && !persisted.adapterPolicy
        && !persisted.commissionedRuntime
        && (addsFirstArtifactRoot || addsFirstAdapter)
        && (!persisted.artifactRoot || persisted.artifactRoot === config.artifactRoot)
        && Array.isArray(priorRun.events) && priorRun.events.length === 0
        && Array.isArray(run.events) && run.events.length <= 1
        && priorRun.status === "running"
        && priorRun.id === run.id
        && priorRun.createdAt === run.createdAt;
      if (!safeFirstEventSeal) throw new Error("immutable bridge run configuration cannot change after creation");
      await writeTextAtomically(configPath, boundedBridgeStateText(sealRunConfigPayload(config), MAX_RUN_CONFIG_BYTES, "bridge run configuration"));
    }
  } else {
    await writeTextAtomically(configPath, boundedBridgeStateText(sealRunConfigPayload(config), MAX_RUN_CONFIG_BYTES, "bridge run configuration"));
  }
  const journalState = await readEventJournalState(run.id);
  assertMonotonicObservedJournal(run.id, journalState);
  if (JSON.stringify(normalizeRun(run).events || []) !== JSON.stringify(journalState.events)) {
    throw new Error("refusing to persist a run snapshot that does not match the authenticated event journal");
  }
  await writeTextAtomically(runPath, boundedBridgeStateText(sealRunSnapshotPayload(run, journalState), MAX_RUN_SNAPSHOT_BYTES, "bridge run snapshot"));
  return normalizeRun(run);
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
    reviewTrustSha256: run.reviewTrustSha256,
    auth: run.auth,
    approvals: normalizeApprovalRecords(run.approvals || []),
    artifacts: Array.isArray(run.artifacts) && run.artifacts.length ? run.artifacts : createBaseArtifacts(adapterPolicy),
    events: Array.isArray(run.events) ? run.events : [],
  };
}

function immutableRunConfig(run) {
  return {
    schema: "uash.bridge-run-config.v1",
    contractVersion: run.contractVersion,
    runId: run.id,
    createdAt: run.createdAt,
    artifactRoot: run.artifactRoot ? path.resolve(String(run.artifactRoot)) : null,
    adapterPath: run.adapterPath ? path.resolve(String(run.adapterPath)) : null,
    adapterPolicy: run.adapterPolicy || null,
    commissionedRuntime: run.commissionedRuntime || null,
    reviewTrustSha256: run.reviewTrustSha256,
  };
}

function runIntegrityKey() {
  const value = process.env.UASH_BRIDGE_INTEGRITY_KEY;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredRunIntegrityKey() {
  const key = runIntegrityKey();
  if (!key) throw new Error("UASH_BRIDGE_INTEGRITY_KEY is required for bridge run integrity");
  if (Buffer.byteLength(key, "utf8") < MINIMUM_BRIDGE_CREDENTIAL_BYTES) throw new Error(`UASH_BRIDGE_INTEGRITY_KEY must contain at least ${MINIMUM_BRIDGE_CREDENTIAL_BYTES} bytes of secret material`);
  return key;
}

function requiredBridgeAccessToken() {
  const value = process.env.UASH_BRIDGE_ACCESS_TOKEN;
  if (typeof value !== "string" || value.length === 0) throw new Error("UASH_BRIDGE_ACCESS_TOKEN is required for bridge run API access");
  if (Buffer.byteLength(value, "utf8") < MINIMUM_BRIDGE_CREDENTIAL_BYTES) throw new Error(`UASH_BRIDGE_ACCESS_TOKEN must contain at least ${MINIMUM_BRIDGE_CREDENTIAL_BYTES} bytes of secret material`);
  return value;
}

function requiredHumanApprovalToken() {
  const value = process.env.UASH_HUMAN_APPROVAL_TOKEN;
  if (typeof value !== "string" || value.length === 0) throw new Error("UASH_HUMAN_APPROVAL_TOKEN is required for human approvals");
  if (Buffer.byteLength(value, "utf8") < MINIMUM_BRIDGE_CREDENTIAL_BYTES) throw new Error(`UASH_HUMAN_APPROVAL_TOKEN must contain at least ${MINIMUM_BRIDGE_CREDENTIAL_BYTES} bytes of secret material`);
  return value;
}

function assertBridgeCredentialSeparation() {
  assertPairwiseDistinctBridgeCredentials({
    UASH_BRIDGE_INTEGRITY_KEY: requiredRunIntegrityKey(),
    UASH_BRIDGE_ACCESS_TOKEN: requiredBridgeAccessToken(),
    UASH_HUMAN_APPROVAL_TOKEN: requiredHumanApprovalToken(),
  });
}

function runConfigHmac(payload, key) {
  return createHmac("sha256", key)
    .update("uash.bridge-run-config.v1\0", "utf8")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function sealRunConfigPayload(payload) {
  const key = requiredRunIntegrityKey();
  return {
    ...payload,
    integrity: {
      scheme: "hmac-sha256",
      digest: runConfigHmac(payload, key),
    },
  };
}

function verifiedRunConfigPayload(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("persisted run configuration integrity document is invalid");
  }
  const { integrity, ...payload } = document;
  const key = requiredRunIntegrityKey();
  const supplied = typeof integrity?.digest === "string" && /^[a-f0-9]{64}$/i.test(integrity.digest)
    ? Buffer.from(integrity.digest, "hex")
    : null;
  const expected = Buffer.from(runConfigHmac(payload, key), "hex");
  if (integrity?.scheme !== "hmac-sha256"
    || !supplied
    || supplied.length !== expected.length
    || !timingSafeEqual(supplied, expected)) {
    throw new Error("persisted run configuration integrity verification failed");
  }
  return payload;
}

function runSnapshotPayload(run) {
  const { snapshotIntegrity, ...payload } = normalizeRun(run);
  return payload;
}

function runSnapshotDigest(payload, binding, key = null) {
  const serialized = `${RUN_SNAPSHOT_SCHEMA}\0${JSON.stringify(binding)}\0${JSON.stringify(payload)}`;
  return key
    ? createHmac("sha256", key).update(serialized, "utf8").digest("hex")
    : createHash("sha256").update(serialized, "utf8").digest("hex");
}

function sealRunSnapshotPayload(run, journalState) {
  const payload = runSnapshotPayload(run);
  const key = requiredRunIntegrityKey();
  const binding = {
    eventCount: journalState.events.length,
    journalHeadDigest: journalState.lastDigest || null,
  };
  return {
    ...payload,
    snapshotIntegrity: {
      schema: RUN_SNAPSHOT_SCHEMA,
      scheme: "hmac-sha256",
      ...binding,
      digest: runSnapshotDigest(payload, binding, key),
    },
  };
}

function verifiedRunSnapshotPayload(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("persisted run snapshot integrity document is invalid");
  }
  const { snapshotIntegrity, ...payload } = document;
  const key = requiredRunIntegrityKey();
  const binding = {
    eventCount: snapshotIntegrity?.eventCount,
    journalHeadDigest: snapshotIntegrity?.journalHeadDigest ?? null,
  };
  const supplied = typeof snapshotIntegrity?.digest === "string" && /^[a-f0-9]{64}$/i.test(snapshotIntegrity.digest)
    ? Buffer.from(snapshotIntegrity.digest, "hex")
    : null;
  const expected = Buffer.from(runSnapshotDigest(payload, binding, key), "hex");
  const requiredScheme = "hmac-sha256";
  if (snapshotIntegrity?.schema !== RUN_SNAPSHOT_SCHEMA
    || snapshotIntegrity?.scheme !== requiredScheme
    || !Number.isInteger(binding.eventCount) || binding.eventCount < 0
    || (binding.journalHeadDigest !== null && !/^[a-f0-9]{64}$/i.test(binding.journalHeadDigest))
    || !supplied
    || supplied.length !== expected.length
    || !timingSafeEqual(supplied, expected)) {
    throw new Error("persisted run snapshot integrity verification failed");
  }
  return {
    run: normalizeRun(payload),
    eventCount: binding.eventCount,
    journalHeadDigest: binding.journalHeadDigest,
  };
}

function derivedPersistedStatus(run) {
  const events = Array.isArray(run.events) ? run.events : [];
  const last = events.at(-1);
  if (!last) return "running";
  if (last.type === "approval.requested" || last.status === "needs_approval") return "approval";
  if (last.type === "approval.denied" || last.type === "run.blocked" || last.type === "node.failed" || last.status === "blocked" || last.status === "failed") return "blocked";
  if (last.type === "run.completed") return "complete";
  if (unresolvedApprovalProblems(run).length) return "approval";
  return "running";
}

function validatePersistedRunState(run, persistedEvents) {
  if (JSON.stringify(run.events || []) !== JSON.stringify(persistedEvents)) {
    throw new Error("persisted run events do not match the append-only bridge event log");
  }
  const derivedStatus = derivedPersistedStatus(run);
  if (run.status !== derivedStatus) {
    throw new Error(`persisted run status does not match bridge events: expected ${derivedStatus}`);
  }
  return run;
}

function publicRun(run) {
  const normalized = normalizeRun(run);
  const { auth, ...safeRun } = normalized;
  return safeRun;
}

function publicRunWithoutEventHistory(run) {
  const safeRun = publicRun(run);
  const events = Array.isArray(safeRun.events) ? safeRun.events : [];
  const approvals = Array.isArray(safeRun.approvals) ? safeRun.approvals : [];
  const returnedApprovals = [];
  let approvalBytes = 2;
  for (let index = approvals.length - 1; index >= 0 && returnedApprovals.length < MAX_PUBLIC_APPROVALS; index -= 1) {
    const serialized = JSON.stringify(approvals[index]);
    const entryBytes = Buffer.byteLength(serialized, "utf8") + (returnedApprovals.length > 0 ? 1 : 0);
    if (approvalBytes + entryBytes > MAX_PUBLIC_APPROVAL_BYTES) break;
    returnedApprovals.unshift(approvals[index]);
    approvalBytes += entryBytes;
  }
  return {
    ...safeRun,
    approvals: returnedApprovals,
    approvalCount: approvals.length,
    approvalsTruncated: returnedApprovals.length < approvals.length,
    events: [],
    eventCount: events.length,
    eventsTruncated: events.length > 0,
  };
}

function publicRunEventPage(run, { eventCursor = null, eventLimit = DEFAULT_EVENT_PAGE_LIMIT } = {}) {
  const safeRun = publicRun(run);
  const events = Array.isArray(safeRun.events) ? safeRun.events : [];
  const base = publicRunWithoutEventHistory(safeRun);
  const explicitCursor = eventCursor !== null;
  const requestedOffset = explicitCursor
    ? Math.min(eventCursor, events.length)
    : Math.max(0, events.length - eventLimit);
  const requestedEnd = Math.min(events.length, requestedOffset + eventLimit);
  const reserveBytes = 8 * 1024;
  let responseBytes = Buffer.byteLength(JSON.stringify(base), "utf8") + reserveBytes;
  const returnedEvents = [];
  let actualOffset = requestedOffset;
  let byteLimited = false;

  if (explicitCursor) {
    for (let index = requestedOffset; index < requestedEnd; index += 1) {
      const eventBytes = Buffer.byteLength(JSON.stringify(events[index]), "utf8") + 1;
      if (responseBytes + eventBytes > MAX_RESPONSE_BODY_BYTES) {
        byteLimited = true;
        break;
      }
      returnedEvents.push(events[index]);
      responseBytes += eventBytes;
    }
  } else {
    for (let index = requestedEnd - 1; index >= requestedOffset; index -= 1) {
      const eventBytes = Buffer.byteLength(JSON.stringify(events[index]), "utf8") + 1;
      if (responseBytes + eventBytes > MAX_RESPONSE_BODY_BYTES) {
        byteLimited = true;
        break;
      }
      returnedEvents.unshift(events[index]);
      actualOffset = index;
      responseBytes += eventBytes;
    }
  }

  const returned = returnedEvents.length;
  const nextOffset = actualOffset + returned;
  const eventPage = {
    offset: actualOffset,
    limit: eventLimit,
    returned,
    total: events.length,
    previousCursor: actualOffset > 0 ? String(Math.max(0, actualOffset - eventLimit)) : null,
    nextCursor: nextOffset < events.length ? String(nextOffset) : null,
    truncated: returned < events.length,
    byteLimited,
  };
  return {
    run: {
      ...base,
      events: returnedEvents,
      eventsTruncated: eventPage.truncated,
      eventPage,
    },
    page: eventPage,
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
    commissionedRuntime: adapterConfig.commissionedRuntime,
    reviewTrustSha256: REVIEW_TRUST_SHA256,
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
    commissionedRuntime: base.commissionedRuntime,
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
    id: event.id === undefined ? `${runId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` : event.id,
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
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_EVENT_DOCUMENT_BYTES) {
    problems.push(`event document must be ${MAX_EVENT_DOCUMENT_BYTES} bytes or fewer`);
  }
  if (typeof event.id !== "string" || event.id.length === 0) problems.push("event.id must be a non-empty string when supplied or generated");
  else if (event.id.length > 512) problems.push("event.id must be 512 characters or fewer");
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
  if ((run.events || []).length >= MAX_EVENTS_PER_RUN) {
    problems.push(`run event history is limited to ${MAX_EVENTS_PER_RUN} persisted events; start a continuation run`);
  }
  if ((run.events || []).some((existing) => existing.id === event.id)) {
    problems.push(`event.id already exists for this run: ${event.id}`);
  }
  if (event.artifactRoot && run.artifactRoot) {
    const currentRoot = path.resolve(String(run.artifactRoot));
    const nextRoot = path.resolve(String(event.artifactRoot));
    if (currentRoot !== nextRoot) problems.push(`artifactRoot cannot change after run creation: existing ${currentRoot}, event ${nextRoot}`);
  }
  if (event.type === "approval.granted" || event.type === "approval.denied") {
    problems.push(...humanApprovalTokenProblems(run, event, humanToken));
    const approvals = normalizeApprovalRecords(run.approvals || []);
    const pending = approvals.find((approval) => approval.scope === event.approvalScope && approval.owner === event.approvalOwner && approval.status === "pending");
    if (!pending) problems.push(`approval ${event.type} requires an existing pending approval for ${event.approvalScope} owned by ${event.approvalOwner}`);
    if (event.approvalScope === "route") {
      if (event.artifact !== "run/route.json") problems.push("route approval must bind artifact run/route.json");
      else problems.push(...resolveArtifactPath(run, event.artifact, true).problems.map((problem) => `route approval artifact invalid: ${problem}`));
    }
    if (["testflight-release", "app-store-release"].includes(event.approvalScope)) {
      if (event.artifact !== "domain/assurance.json") problems.push("Apple release approval must bind artifact domain/assurance.json");
      else problems.push(...resolveArtifactPath(run, event.artifact, true).problems.map((problem) => `Apple release approval artifact invalid: ${problem}`));
    }
  }
  if (event.type === "self_heal.pr_opened" || event.type === "self_heal.pr_proposed") {
    problems.push(...selfHealResolutionProblems(run, event));
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

function runMetadataSizeProblems(body) {
  const limits = {
    title: 4 * 1024,
    task: 64 * 1024,
    repo: 4 * 1024,
    branch: 4 * 1024,
    lane: 1024,
    agent: 1024,
    risk: 1024,
    mode: 1024,
    runMode: 1024,
    eventSource: 1024,
    artifactRoot: 32 * 1024,
    adapterPath: 32 * 1024,
  };
  return Object.entries(limits).flatMap(([field, maximumBytes]) => {
    const value = body?.[field];
    if (typeof value !== "string") return [];
    return Buffer.byteLength(value, "utf8") > maximumBytes
      ? [`run.${field} must be ${maximumBytes} UTF-8 bytes or fewer`]
      : [];
  });
}

function runCreationBodyProblems(body) {
  const problems = runMetadataSizeProblems(body);
  for (const field of ["title", "task", "repo", "branch", "lane", "agent", "risk", "mode", "runMode", "eventSource", "artifactRoot", "adapterPath"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].trim().length === 0)) {
      problems.push(`run.${field} must be a non-empty string when supplied`);
    }
  }
  if (typeof body.mode === "string" && body.mode.trim().length > 0 && !RUN_MODES.has(body.mode)) {
    problems.push(`run.mode must be one of: ${[...RUN_MODES].join(", ")}`);
  }
  if (typeof body.runMode === "string" && body.runMode.trim().length > 0 && !RUN_MODES.has(body.runMode)) {
    problems.push(`run.runMode must be one of: ${[...RUN_MODES].join(", ")}`);
  }
  if (typeof body.mode === "string" && typeof body.runMode === "string" && body.mode !== body.runMode) {
    problems.push("run.mode and run.runMode must match when both aliases are supplied");
  }
  if (typeof body.eventSource === "string" && body.eventSource.trim().length > 0 && !EVENT_SOURCES.has(body.eventSource)) {
    problems.push(`run.eventSource must be one of: ${[...EVENT_SOURCES].join(", ")}`);
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    problems.push("run.status cannot be supplied at creation; completion must flow through verified run.completed events");
  }
  return problems;
}

function commissionedRuntimeForRun(run) {
  const runtime = bootstrapCommissionedRuntime(artifactRootFor(run));
  if (!runtime) throw new Error("canonical .valdris-harness runtime is missing");
  if (!run.adapterPath || path.relative(realpathSync(run.adapterPath), runtime.adapterPath) !== "") {
    throw new Error("v0.8 finish line adapter must come from the canonical .valdris-harness runtime");
  }
  if (JSON.stringify(run.adapterPolicy) !== JSON.stringify(runtime.adapterPolicy)) {
    throw new Error("v0.8 project adapter policy changed after the run was loaded");
  }
  if (!run.commissionedRuntime) {
    throw new Error("v0.8 commissioned runtime identity is required");
  }
  if (JSON.stringify(run.commissionedRuntime) !== JSON.stringify(commissionedRuntimeIdentity(runtime))) {
    throw new Error("v0.8 commissioned runtime identity changed after the run was created");
  }
  return runtime;
}

function runExpectsCommissionedRuntime(run) {
  if (run.commissionedRuntime || run.adapterPolicy?.portableFinishLineRequired) return true;
  if (!run.artifactRoot || !run.adapterPath) return false;
  const expected = path.resolve(String(run.artifactRoot), ".valdris-harness", "project-adapter.json");
  return path.relative(expected, path.resolve(String(run.adapterPath))) === "";
}

function validateRunRuntimeTrust(run) {
  if (run.reviewTrustSha256 !== REVIEW_TRUST_SHA256) {
    throw new Error("bridge run review trust pin does not match the operator-held startup UASH_REVIEW_TRUST_SHA256");
  }
  const packPresent = Boolean(canonicalCommissionedRuntime(artifactRootFor(run)));
  if (!packPresent && !runExpectsCommissionedRuntime(run)) return run;
  commissionedRuntimeForRun(run);
  return run;
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
  if (!lstat.isSymbolicLink() && !lstat.isFile()) problems.push(`artifact path must be a regular file: ${target}`);
  const realTarget = realpathSync(resolved);
  if (!isInside(realRoot, realTarget)) problems.push(`artifact real path escapes artifactRoot: ${target}`);
  return { root: realRoot, resolved, realTarget, problems };
}

function artifactWriteProblems(run, event, verification = artifactVerification(run, event)) {
  if (event.type !== "artifact.written") return [];
  const problems = artifactPathConsistencyProblems(run, event);
  if (problems.length) return problems;
  if (!verification?.checked || verification.exists !== true) {
    problems.push(...(verification?.problems || ["artifact verification did not produce a trusted file claim"]));
  }
  if (!problems.length && !/^[a-f0-9]{64}$/.test(verification.sha256 || "")) {
    problems.push("artifact verification did not bind a SHA-256 content digest");
  }
  if (!problems.length && isProofEvent(run, event) && verification.proof?.valid !== true) {
    problems.push(...(verification.proof?.problems || ["proof artifact was not schema-validated"]));
  }
  if (!problems.length && isProductionLayerEvent(run, event) && verification.productionLayerAssessment?.valid !== true) {
    problems.push(...(verification.productionLayerAssessment?.problems || ["production layer assessment was not schema-validated"]));
  }
  return problems;
}

function artifactVerification(run, event) {
  if (event.type !== "artifact.written" && !(event.type === "approval.granted" && event.artifact)) return undefined;
  const result = resolveArtifactPath(run, event.artifact, true);
  if (result.problems.length) return { checked: true, exists: false, problems: result.problems, path: result.resolved };
  const stat = statSync(result.resolved);
  const bytes = readFileSync(result.resolved);
  const verification = {
    checked: true,
    exists: true,
    path: result.resolved,
    realPath: result.realTarget,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  if (isProofEvent(run, event)) verification.proof = validateProofDocument(result.resolved);
  if (isProductionLayerEvent(run, event)) verification.productionLayerAssessment = productionAssessmentVerification(run, result.resolved);
  return verification;
}

function productionAssessmentVerification(run, filePath) {
  const expected = run.adapterPolicy?.productionReadinessSchema;
  const verification = validateProductionLayerAssessment(filePath, { allowLegacy: expected !== "uash.production-readiness.v2" });
  if (expected && verification.schema !== expected) {
    verification.valid = false;
    verification.problems = [...verification.problems, `production layer assessment schema must match adapter policy: ${expected}`];
  }
  return verification;
}

function selfHealResolutionProblems(run, event) {
  const problems = [];
  let hasVerifiedArtifact = false;

  if (event.artifact) {
    const result = resolveArtifactPath(run, event.artifact, true);
    if (result.problems.length) {
      problems.push(...result.problems.map((problem) => `self-heal resolution artifact invalid: ${problem}`));
    } else {
      hasVerifiedArtifact = true;
    }
  }

  if (event.selfHealPrUrl) {
    let parsed;
    try {
      parsed = new URL(event.selfHealPrUrl);
    } catch {
      problems.push("self-heal PR URL must be a valid URL");
      return problems;
    }
    if (parsed.protocol === "file:") {
      if (!hasVerifiedArtifact) problems.push("self-heal file URLs require a verified artifact under artifactRoot");
    } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      problems.push("self-heal PR URL must be http(s) or backed by a verified local artifact");
    } else if (event.type === "self_heal.pr_opened" && !/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(parsed.pathname)) {
      problems.push("self_heal.pr_opened requires a real pull-request URL or a verified local artifact");
    }
  } else if (!hasVerifiedArtifact) {
    problems.push("self-heal resolution requires a real PR URL or verified self_heal/pr.json artifact");
  }

  return problems;
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

function artifactProofProblems(run, artifact, phase = "finish-line") {
  if (!artifact.present) return [`${artifact.path} missing or not skipped`];
  if (!artifact.verification?.checked) return [`${artifact.path} present but not verified against artifactRoot`];
  if (!artifact.verification.exists) return [`${artifact.path} was claimed but file verification failed`];
  const sealedDigest = artifact.verification.sha256;
  if (!/^[a-f0-9]{64}$/.test(sealedDigest || "")) return [`${artifact.path} is missing a journal-sealed SHA-256 claim`];

  const current = artifactVerification(run, {
    type: "artifact.written",
    nodeId: artifact.nodeId,
    artifact: artifact.evidenceArtifact || artifact.path,
  });
  if (!current?.checked || current.exists !== true) {
    const detail = current?.problems?.join("; ") || "artifact could not be re-read";
    return [`${artifact.path} failed ${phase} revalidation: ${detail}`];
  }
  if (!safeCompare(current.sha256, sealedDigest)) {
    return [`${artifact.path} changed after its bridge-sealed artifact claim (${phase} SHA-256 mismatch)`];
  }
  if (artifact.nodeId === "prove" && current.proof?.valid !== true) {
    const problems = current.proof?.problems?.join("; ") || "proof content was not schema-validated";
    return [`${artifact.path} failed ${PROOF_SCHEMA} validation: ${problems}`];
  }
  if (artifact.nodeId === "production-readiness" && current.productionLayerAssessment?.valid !== true) {
    const problems = current.productionLayerAssessment?.problems?.join("; ") || "production layer assessment was not schema-validated";
    return [`${artifact.path} failed production layer validation: ${problems}`];
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
      if (artifact.nodeId === "prove" || artifact.nodeId === "handoff") {
        problems.push(`${artifact.path} is a non-skippable finish-line invariant`);
        continue;
      }
      if (!artifact.skipReason) problems.push(`${artifact.path} skipped without a reason`);
      continue;
    }
    problems.push(...artifactProofProblems(run, artifact));
  }
  problems.push(...unresolvedApprovalProblems(run));
  problems.push(...selfHealProblems(run));
  if (problems.length) return problems;
  problems.push(...enterpriseFinishLineProblems(run));
  for (const artifact of run.artifacts || []) {
    if (!artifact.required || artifact.failed || artifact.skipped) continue;
    problems.push(...artifactProofProblems(run, artifact, "post-gate"));
  }
  return problems;
}

const PORTABLE_PRIVACY_REQUIRED_PATHS = Object.freeze([
  "run/intake.json",
  "run/workload-classification.json",
  "run/route.json",
  "goal/goal.json",
  "context/manifest.json",
  "ai/assurance.json",
  "domain/assurance.json",
  "evals/results.json",
  "trajectory/trajectory.json",
  "waivers/waivers.json",
  "proof/portable.json",
  "review/review.json",
  "run/packet.json",
]);

const PORTABLE_PRIVACY_CONDITIONAL_PATHS = Object.freeze([
  "foundation/assessment.json",
  "production/layer-assessment.json",
  "smoke/smoke_proof.json",
  "rca/rca.json",
]);

const PORTABLE_PRIVACY_REFERENCE_DOCUMENT_PATHS = new Set([
  "ai/assurance.json",
  "context/manifest.json",
  "domain/assurance.json",
  "evals/results.json",
  "foundation/assessment.json",
  "graph/freshness.json",
  "graph/graph.json",
  "production/layer-assessment.json",
  "rca/rca.json",
  "review/review.json",
  "run/packet.json",
  "smoke/smoke_proof.json",
  "trajectory/trajectory.json",
]);
const PORTABLE_PRIVACY_MAX_PATHS = 128;
const PORTABLE_PRIVACY_MAX_REFERENCE_DEPTH = 4;
const PORTABLE_PRIVACY_MAX_REFERENCE_DOCUMENT_BYTES = 64 * 1024 * 1024;

function canonicalPortablePrivacyPath(value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.includes("\0")) return null;
  if (value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return null;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return path.posix.normalize(value) === value ? value : null;
}

function typedControlEvidencePaths(controls) {
  const referenced = [];
  for (const control of Array.isArray(controls) ? controls : []) {
    for (const evidence of Array.isArray(control?.evidence) ? control.evidence : []) {
      if (evidence?.type === "artifact") referenced.push(evidence.path);
      else if (evidence?.type === "command") referenced.push(evidence.outputPath);
      else if (evidence?.type === "provider-report") referenced.push(evidence.attestationPath);
    }
  }
  return referenced;
}

function assuranceEvidencePaths(artifactPath, document) {
  if (artifactPath === "ai/assurance.json") return typedControlEvidencePaths(document.controls);
  if (artifactPath === "domain/assurance.json") {
    return (Array.isArray(document.packs) ? document.packs : [])
      .flatMap((pack) => typedControlEvidencePaths(pack?.controls));
  }
  if (artifactPath === "foundation/assessment.json") {
    return (Array.isArray(document.capabilities) ? document.capabilities : [])
      .flatMap((capability) => typedControlEvidencePaths(capability?.controls));
  }
  if (artifactPath === "production/layer-assessment.json") {
    const layers = Array.isArray(document.layers)
      ? document.layers
      : document.layers && typeof document.layers === "object" && !Array.isArray(document.layers)
          ? Object.values(document.layers)
          : [];
    return layers.flatMap((layer) => typedControlEvidencePaths(layer?.controls));
  }
  if (artifactPath === "smoke/smoke_proof.json") return typedControlEvidencePaths([document.control]);
  return [];
}

function portablePrivacyReferencedPaths(artifactPath, document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const referenced = [];
  const add = (value) => {
    if (value !== undefined && value !== null) referenced.push(value);
  };

  if (artifactPath === "run/packet.json") {
    for (const entry of Object.values(document.inputs || {})) add(entry?.path);
    for (const entry of Array.isArray(document.gateArtifacts) ? document.gateArtifacts : []) {
      add(entry?.path);
      for (const supporting of Array.isArray(entry?.supportingArtifacts) ? entry.supportingArtifacts : []) add(supporting?.path);
    }
  }
  if (artifactPath === "trajectory/trajectory.json") add(document.tracePath);
  if (artifactPath === "context/manifest.json") {
    for (const entry of Array.isArray(document.loadedFiles) ? document.loadedFiles : []) add(entry?.path);
    add(document.contextQuality?.caseSet?.path);
    add(document.contextQuality?.answerKey?.path);
  }
  if (artifactPath === "evals/results.json") {
    for (const suite of Array.isArray(document.suites) ? document.suites : []) {
      add(suite?.resultPath);
      for (const arm of [suite?.contextComparison?.baseline, suite?.contextComparison?.candidate]) {
        add(arm?.resultPath);
        add(arm?.caseSet?.path);
        add(arm?.answerKey?.path);
      }
    }
  }
  if (artifactPath === "rca/rca.json") {
    for (const evidence of Array.isArray(document.evidence) ? document.evidence : []) add(evidence?.artifact);
  }
  if (artifactPath === "graph/graph.json") {
    add("graph/freshness.json");
    add(document.codeIntelligence?.evidenceArtifact);
  }
  if (artifactPath === "graph/freshness.json") add(document.codeIntelligence?.evidenceArtifact);
  if (artifactPath === "review/review.json") {
    add(document.subject?.artifact);
    for (const provenance of Object.values(document.roleProvenance || {})) {
      add(provenance?.evidence?.path);
      add(provenance?.evidence?.artifact);
    }
  }
  for (const evidencePath of assuranceEvidencePaths(artifactPath, document)) add(evidencePath);
  return referenced;
}

function portablePrivacyClosure(run) {
  const problems = [];
  const pending = [];
  const enqueued = new Set();
  const bounded = new Set();
  const enqueue = (value, depth = 0) => {
    const artifactPath = canonicalPortablePrivacyPath(value);
    if (!artifactPath) {
      problems.push("run-artifact privacy closure contains a missing, unsafe, or non-canonical path");
      return;
    }
    if (enqueued.has(artifactPath)) return;
    if (depth > PORTABLE_PRIVACY_MAX_REFERENCE_DEPTH) {
      problems.push("run-artifact privacy closure exceeded its reference-depth bound");
      return;
    }
    if (enqueued.size >= PORTABLE_PRIVACY_MAX_PATHS) {
      problems.push("run-artifact privacy closure exceeded its artifact-count bound");
      return;
    }
    enqueued.add(artifactPath);
    pending.push({ artifactPath, depth });
  };

  for (const artifact of run.artifacts || []) {
    if (artifact.required && !artifact.skipped) enqueue(artifact.evidenceArtifact || artifact.path);
  }
  for (const artifactPath of PORTABLE_PRIVACY_REQUIRED_PATHS) enqueue(artifactPath);
  for (const artifactPath of PORTABLE_PRIVACY_CONDITIONAL_PATHS) {
    const resolution = resolveArtifactPath(run, artifactPath, false);
    if (resolution.resolved && existsSync(resolution.resolved)) enqueue(artifactPath);
  }

  while (pending.length > 0) {
    const { artifactPath, depth } = pending.shift();
    const resolution = resolveArtifactPath(run, artifactPath, true);
    if (resolution.problems.length) {
      problems.push("run-artifact privacy closure contains a missing, unsafe, or non-file path");
      continue;
    }
    const canonicalRealPath = canonicalPortablePrivacyPath(path.relative(resolution.root, resolution.realTarget).split(path.sep).join("/"));
    if (!canonicalRealPath) {
      problems.push("run-artifact privacy closure resolved outside its canonical repository-relative namespace");
      continue;
    }
    bounded.add(canonicalRealPath);
    if (!PORTABLE_PRIVACY_REFERENCE_DOCUMENT_PATHS.has(artifactPath)) continue;
    if (statSync(resolution.realTarget).size > PORTABLE_PRIVACY_MAX_REFERENCE_DOCUMENT_BYTES) {
      problems.push("run-artifact privacy closure reference document exceeded its byte bound");
      continue;
    }
    try {
      const document = JSON.parse(readFileSync(resolution.realTarget, "utf8"));
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("invalid reference document");
      for (const referencedPath of portablePrivacyReferencedPaths(artifactPath, document)) enqueue(referencedPath, depth + 1);
    } catch {
      problems.push(artifactPath === "run/packet.json"
        ? "run packet is invalid for privacy-closure enumeration"
        : "run-artifact privacy closure contains invalid JSON in a reference-bearing document");
    }
  }
  return { paths: [...bounded].sort(), problems: [...new Set(problems)] };
}

function completedRunValidationFingerprint(run, journalState) {
  const closure = portablePrivacyClosure(run);
  const paths = new Set(closure.paths);
  for (const artifact of run.artifacts || []) {
    if (artifact.required && !artifact.skipped) paths.add(artifact.evidenceArtifact || artifact.path);
  }
  const artifacts = [];
  for (const artifactPath of [...paths].sort()) {
    const resolution = resolveArtifactPath(run, artifactPath, true);
    if (resolution.problems.length || !resolution.realTarget) {
      artifacts.push([artifactPath, "missing"]);
      continue;
    }
    artifacts.push([artifactPath, sha256(readFileSync(resolution.realTarget))]);
  }
  let currentRuntimeIdentity = null;
  if (runExpectsCommissionedRuntime(run) || canonicalCommissionedRuntime(artifactRootFor(run))) {
    try {
      const current = commissionedRuntimeForRun(run);
      currentRuntimeIdentity = {
        commit: current.commit,
        runtimeSha256: current.binding.runtimeSha256,
        setSha256: current.binding.setSha256,
      };
    } catch (error) {
      currentRuntimeIdentity = { trustError: error instanceof Error ? error.message : String(error) };
    }
  }
  return sha256(JSON.stringify({
    journalHeadDigest: journalState.lastDigest || null,
    reviewTrustSha256: run.reviewTrustSha256,
    commissionedRuntimeSha256: run.commissionedRuntime?.runtimeSha256 || null,
    currentRuntimeIdentity,
    closureProblems: closure.problems,
    artifacts,
  }));
}

function enterpriseFinishLineProblems(run) {
  let commissionedBaseline = null;
  try {
    if (runExpectsCommissionedRuntime(run) || canonicalCommissionedRuntime(artifactRootFor(run))) commissionedBaseline = commissionedRuntimeForRun(run);
  } catch (error) {
    return [`v0.8 commissioned runtime bootstrap failed: ${error.message}`];
  }
  if (!run.adapterPolicy?.enterpriseFinishLineRequired) return [];
  const finishLineVersion = run.adapterPolicy?.portableFinishLineRequired ? "v0.8" : "v0.7";
  if (!run.artifactRoot || !existsSync(run.artifactRoot)) return [`${finishLineVersion} finish-line artifactRoot is missing`];
  let finishLineScriptDir = BRIDGE_SCRIPT_DIR;
  if (run.adapterPolicy?.portableFinishLineRequired) {
    try {
      commissionedBaseline ||= commissionedRuntimeForRun(run);
      finishLineScriptDir = commissionedBaseline.scripts;
    } catch (error) {
      return [`v0.8 commissioned runtime resolution failed: ${error.message}`];
    }
  }
  const runGate = (script, scriptDir = BRIDGE_SCRIPT_DIR, extraArgs = []) => {
    if (commissionedBaseline) {
      try {
        const current = commissionedRuntimeForRun(run);
        if (current.commit !== commissionedBaseline.commit || current.binding.setSha256 !== commissionedBaseline.binding.setSha256) {
          return { status: null, error: new Error("commissioned runtime changed during finish-line execution") };
        }
      } catch (error) {
        return { status: null, error: new Error(`commissioned runtime trust validation failed: ${error.message}`) };
      }
    }
    const gatePath = path.join(scriptDir, script);
    if (!existsSync(gatePath)) return { status: null, error: new Error(`finish-line gate is missing: ${gatePath}`) };
    const gateStats = lstatSync(gatePath);
    if (gateStats.isSymbolicLink() || !gateStats.isFile()) return { status: null, error: new Error(`finish-line gate must be a regular file: ${gatePath}`) };
    return spawnSync(process.execPath, [gatePath, "--repo", run.artifactRoot, ...extraArgs], {
      encoding: "utf8",
      env: finishLineChildEnv({ ...process.env, UASH_REVIEW_TRUST_SHA256: run.reviewTrustSha256 }),
      shell: false,
      windowsHide: true,
      timeout: FINISH_LINE_GATE_TIMEOUT_MS,
      killSignal: "SIGTERM",
      maxBuffer: 16 * 1024 * 1024,
    });
  };
  const failureOutput = (result) => result.error?.code === "ETIMEDOUT"
    ? `timed out after ${FINISH_LINE_GATE_TIMEOUT_MS}ms`
    : String(result.stderr || result.stdout || result.error?.message || "no gate output").trim().slice(-4000);
  if (run.adapterPolicy?.portableFinishLineRequired) {
    const privacyClosure = portablePrivacyClosure(run);
    if (privacyClosure.problems.length) return privacyClosure.problems.map((problem) => `v0.8 run-artifact privacy finish line failed: ${problem}`);
    if (privacyClosure.paths.length === 0) return ["v0.8 run-artifact privacy finish line failed: no required run artifacts were selected"];
    const privacyArgs = privacyClosure.paths.flatMap((artifactPath) => ["--include", artifactPath]);
    const privacy = runGate("privacy-gate.mjs", finishLineScriptDir, privacyArgs);
    if (privacy.status !== 0) return [`v0.8 run-artifact privacy finish line failed: ${failureOutput(privacy)}`];
  }
  const result = runGate("enterprise-ai-gate-all.mjs", finishLineScriptDir);
  if (result.status !== 0) return [`${finishLineVersion} enterprise/AI finish line failed: ${failureOutput(result)}`];
  if (run.adapterPolicy?.portableFinishLineRequired) {
    const portableGates = [
      ["independent review", "review-gate.mjs"],
      ["run packet", "run-packet-gate.mjs"],
    ];
    try {
      const route = JSON.parse(readFileSync(path.join(run.artifactRoot, "run", "route.json"), "utf8"));
      const intake = JSON.parse(readFileSync(path.join(run.artifactRoot, "run", "intake.json"), "utf8"));
      if (routeRequiresRca(route, intake) || existsSync(path.join(run.artifactRoot, "rca", "rca.json"))) portableGates.unshift(["RCA", "rca-gate.mjs"]);
    } catch (error) {
      return [`v0.8 RCA applicability read failed: ${error.message}`];
    }
    for (const [label, script] of portableGates) {
      const gate = runGate(script, finishLineScriptDir);
      if (gate.status !== 0) return [`v0.8 ${label} finish line failed: ${failureOutput(gate)}`];
    }
  }
  try {
    const routePath = path.join(run.artifactRoot, "run", "route.json");
    const routeBytes = readFileSync(routePath);
    const route = JSON.parse(routeBytes.toString("utf8"));
    const goal = JSON.parse(readFileSync(path.join(run.artifactRoot, "goal", "goal.json"), "utf8"));
    const waiverLedger = JSON.parse(readFileSync(path.join(run.artifactRoot, "waivers", "waivers.json"), "utf8"));
    const domainPath = path.join(run.artifactRoot, "domain", "assurance.json");
    const domainBytes = readFileSync(domainPath);
    const domainAssurance = JSON.parse(domainBytes.toString("utf8"));
    const problems = [];
    if (route.runId !== run.id) problems.push("route.runId must match the bridge run ID");
    if (goal.goalId !== run.id) problems.push("goal.goalId must match the bridge run ID");
    const approvals = normalizeApprovalRecords(run.approvals || []);
    const routeDigest = createHash("sha256").update(routeBytes).digest("hex");
    if (!approvals.some((approval) => approval.status === "granted" && approval.scope === "route" && approval.artifact === "run/route.json" && approval.artifactDigest === routeDigest)) {
      problems.push("current run/route.json is not bound to a token-gated human route approval");
    }
    for (const waiver of waiverLedger.waivers || []) {
      if (!approvals.some((approval) => approval.status === "granted" && approval.eventId === waiver.approvalEventId && approval.scope === waiver.scope)) problems.push(`waiver ${waiver.id} is not bound to a granted token-gated bridge approval event`);
    }
    const domainDigest = createHash("sha256").update(domainBytes).digest("hex");
    for (const control of (domainAssurance.packs || []).flatMap((pack) => pack.controls || [])) {
      for (const evidence of control.evidence || []) {
        if (evidence.type === "approval" && !approvals.some((approval) => approval.status === "granted" && approval.eventId === evidence.bridgeEventId && approval.scope === evidence.scope && approval.artifact === "domain/assurance.json" && approval.artifactDigest === domainDigest)) {
          problems.push(`domain approval for ${control.id} is not bound to its token-gated bridge event`);
        }
      }
    }
    if (commissionedBaseline) {
      try {
        const current = commissionedRuntimeForRun(run);
        if (current.commit !== commissionedBaseline.commit || current.binding.setSha256 !== commissionedBaseline.binding.setSha256) {
          problems.push("commissioned runtime changed during finish-line execution");
        }
      } catch (error) {
        problems.push(`commissioned runtime final trust validation failed: ${error.message}`);
      }
    }
    return problems;
  } catch (error) {
    return [`${finishLineVersion} finish-line binding read failed: ${error.message}`];
  }
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
    artifact: event.artifact,
    updatedAt: nowIso(),
  };
  if (event.type === "approval.granted" && event.artifact) {
    record.artifactDigest = event.artifactVerification?.sha256;
  }
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
        verification: verification
          ? { ...verification, source: "human-approval-event", eventId: event.id }
          : { checked: false, exists: false, source: "human-approval-event", eventId: event.id, problems: ["approval artifact was not bridge-sealed"] },
      };
    }
    return entry;
  });
}

function applyEvent(run, event) {
  const sealedVerificationProblems = sealedArtifactVerificationProblems(event);
  if (sealedVerificationProblems.length) {
    throw new Error(`event is missing bridge-sealed artifact verification: ${sealedVerificationProblems.join("; ")}`);
  }
  const verification = event.artifactVerification;
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

async function listRuns({ cursor = 0, limit = DEFAULT_RUN_PAGE_LIMIT } = {}) {
  await mkdir(DATA_DIR, { recursive: true });
  const names = await readdir(DATA_DIR);
  if (names.length > MAX_RUN_DIRECTORY_ENTRIES) {
    throw new Error(`bridge data directory exceeds the ${MAX_RUN_DIRECTORY_ENTRIES}-entry safety limit`);
  }
  const candidates = names
    .filter((name) => /^run-[a-f0-9]{64}$/.test(name))
    .flatMap((name) => {
      const file = path.join(DATA_DIR, name, "run.json");
      if (!existsSync(file)) return [];
      try {
        return [{ name, updatedMs: statSync(file).mtimeMs }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.updatedMs - left.updatedMs || left.name.localeCompare(right.name));
  const runs = [];
  let candidateIndex = Math.min(cursor, candidates.length);
  let responseBytes = 2;
  const maximumCandidatesScanned = Math.max(limit * 4, limit);
  let scanned = 0;
  while (candidateIndex < candidates.length && runs.length < limit && scanned < maximumCandidatesScanned) {
    const candidateOffset = candidateIndex;
    const { name } = candidates[candidateIndex];
    candidateIndex += 1;
    scanned += 1;
    try {
      const file = path.join(DATA_DIR, name, "run.json");
      const candidate = JSON.parse(await readBoundedBridgeStateFile(file, MAX_RUN_SNAPSHOT_BYTES, "bridge run snapshot"));
      const runId = canonicalRunId(candidate.id);
      if (storageRunKey(runId) !== name) throw new Error("persisted run is stored under a noncanonical directory key");
      const summary = publicRunWithoutEventHistory(await withRunLock(runId, () => readRun(runId)));
      const summaryBytes = Buffer.byteLength(JSON.stringify(summary), "utf8") + (runs.length > 0 ? 1 : 0);
      if (responseBytes + summaryBytes > MAX_RESPONSE_BODY_BYTES - 8 * 1024) {
        if (runs.length === 0) continue;
        candidateIndex = candidateOffset;
        break;
      }
      runs.push(summary);
      responseBytes += summaryBytes;
    } catch {
      // Quarantine corrupt or runtime-untrusted records so stale completion cannot render.
    }
  }
  return {
    runs,
    page: {
      offset: Math.min(cursor, candidates.length),
      limit,
      returned: runs.length,
      total: candidates.length,
      nextCursor: candidateIndex < candidates.length ? String(candidateIndex) : null,
    },
  };
}

async function appendEvent(runId, event) {
  await mkdir(runDir(runId), { recursive: true });
  const contractProblems = eventContractProblems(event);
  if (contractProblems.length) {
    throw new Error(`refusing to append an invalid event: ${contractProblems.join("; ")}`);
  }
  const journal = await readEventJournalState(runId);
  if (journal.events.length >= MAX_EVENTS_PER_RUN) {
    throw new Error(`refusing to append beyond the ${MAX_EVENTS_PER_RUN}-event run-history limit`);
  }
  if (journal.events.some((existing) => existing.id === event.id)) {
    throw new Error(`refusing to append duplicate event id: ${event.id}`);
  }
  const record = sealJournalEvent(canonicalRunId(runId), event, journal.lastDigest);
  const handle = await open(path.join(runDir(runId), "events.jsonl"), "a");
  try {
    await handle.writeFile(JSON.stringify(record) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const RUN_LOCKS = new Map();

async function withRunLock(runId, operation) {
  const canonicalId = canonicalRunId(runId);
  const previous = RUN_LOCKS.get(canonicalId) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  RUN_LOCKS.set(canonicalId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (RUN_LOCKS.get(canonicalId) === queued) RUN_LOCKS.delete(canonicalId);
  }
}

async function assertNoLegacyRunDirectories() {
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const stateFiles = ["run.json", "run-config.json", "events.jsonl"];
  const legacy = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const directory = path.join(DATA_DIR, entry.name);
    const presentStateFiles = stateFiles.filter((file) => existsSync(path.join(directory, file)));
    if (!presentStateFiles.length) continue;

    const problems = [];
    if (!/^run-[a-f0-9]{64}$/.test(entry.name)) {
      problems.push("directory name is not a v0.8 storage key");
    }

    let configRunId = null;
    let snapshotRunId = null;
    try {
      if (presentStateFiles.includes("run-config.json")) {
        const config = verifiedRunConfigPayload(JSON.parse(await readBoundedBridgeStateFile(path.join(directory, "run-config.json"), MAX_RUN_CONFIG_BYTES, "bridge run configuration")));
        configRunId = canonicalRunId(config.runId);
      }
    } catch (error) {
      problems.push(`run-config identity is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      if (presentStateFiles.includes("run.json")) {
        const snapshot = verifiedRunSnapshotPayload(JSON.parse(await readBoundedBridgeStateFile(path.join(directory, "run.json"), MAX_RUN_SNAPSHOT_BYTES, "bridge run snapshot")));
        snapshotRunId = canonicalRunId(snapshot.run.id);
      }
    } catch (error) {
      problems.push(`run snapshot identity is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }

    const boundRunId = configRunId || snapshotRunId;
    if (!boundRunId) problems.push("no authenticated v0.8 run identity is present");
    if (configRunId && snapshotRunId && configRunId !== snapshotRunId) {
      problems.push("run-config and snapshot identities disagree");
    }
    if (boundRunId && storageRunKey(boundRunId) !== entry.name) {
      problems.push("authenticated run identity does not match the storage directory key");
    }
    if (snapshotRunId && !configRunId) problems.push("authenticated snapshot is missing its immutable run-config");

    if (boundRunId && storageRunKey(boundRunId) === entry.name && presentStateFiles.includes("events.jsonl")) {
      try {
        const journal = await readEventJournalState(boundRunId);
        if (!snapshotRunId && journal.events.length > 0) {
          problems.push("non-empty authenticated journal is missing its derived snapshot");
        }
      } catch (error) {
        problems.push(`event journal identity is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (problems.length) legacy.push(`${entry.name} (${problems.join("; ")})`);
  }
  if (legacy.length) {
    throw new Error(`legacy bridge state requires explicit archival before v0.8 startup; refusing silent migration or fork: ${legacy.join(", ")}`);
  }
}

function processAppearsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function writeExclusiveLease(lockPath, payload) {
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify(payload) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    return payload;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}

function leaseOwnedBy(document, ownership) {
  return document?.pid === process.pid
    && document?.hostname === os.hostname()
    && typeof ownership?.leaseId === "string"
    && document?.leaseId === ownership.leaseId;
}

async function removeOwnedRecoveryMutex(ownership) {
  let persisted;
  try {
    persisted = JSON.parse(await readFile(ownership.lockPath, "utf8"));
  } catch (error) {
    throw new Error(`bridge lease recovery mutex could not be revalidated for owned cleanup; stop and inspect ${ownership.lockPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!leaseOwnedBy(persisted, ownership)) {
    throw new Error(`bridge lease recovery mutex ownership changed; refusing to remove it automatically. Stop and inspect ${ownership.lockPath}`);
  }
  await unlink(ownership.lockPath);
}

async function acquireBridgeRecoveryMutex() {
  const lockPath = path.join(DATA_DIR, ".bridge-process-recovery.lock");
  const ownership = {
    schema: "uash.bridge-process-recovery-lease.v1",
    leaseId: randomBytes(16).toString("hex"),
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: nowIso(),
  };
  try {
    await writeExclusiveLease(lockPath, ownership);
    return { lockPath, ...ownership };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new Error(`bridge lease recovery mutex already exists; refusing to steal it even if it appears stale or malformed. Confirm no bridge startup is active, then archive or remove ${lockPath} explicitly before retrying`);
  }
}

async function acquireBridgeDataLease() {
  const lockPath = path.join(DATA_DIR, ".bridge-process.lock");
  const recovery = await acquireBridgeRecoveryMutex();
  let acquired = null;
  let acquisitionError = null;
  try {
    const lease = {
      schema: "uash.bridge-process-lease.v1",
      leaseId: randomBytes(16).toString("hex"),
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: nowIso(),
    };
    try {
      await writeExclusiveLease(lockPath, lease);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing = null;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        // A malformed main lease is never safe to steal automatically.
      }
      const staleLocalLease = existing?.schema === "uash.bridge-process-lease.v1"
        && typeof existing?.leaseId === "string"
        && existing.leaseId.length > 0
        && existing.hostname === os.hostname()
        && !processAppearsAlive(Number(existing.pid));
      if (!staleLocalLease) {
        throw new Error(`UASH_DATA_DIR is already leased by another bridge process or contains an unsafe lease: ${lockPath}`);
      }
      // Recovery ownership serializes this re-read, stale unlink, and replacement.
      // No second starter can remove a freshly-created main lease behind us.
      const revalidated = JSON.parse(await readFile(lockPath, "utf8"));
      if (JSON.stringify(revalidated) !== JSON.stringify(existing)) {
        throw new Error("bridge data-directory lease changed during stale recovery; refusing automatic reclamation");
      }
      await unlink(lockPath);
      await writeExclusiveLease(lockPath, lease);
    }
    acquired = { lockPath, ...lease };
  } catch (error) {
    acquisitionError = error;
  }

  try {
    await removeOwnedRecoveryMutex(recovery);
  } catch (error) {
    if (acquired) releaseBridgeDataLease(acquired);
    throw error;
  }
  if (acquisitionError) throw acquisitionError;
  return acquired;
}

function releaseBridgeDataLease(ownership) {
  try {
    const existing = JSON.parse(readFileSync(ownership.lockPath, "utf8"));
    if (leaseOwnedBy(existing, ownership)) unlinkSync(ownership.lockPath);
  } catch {
    // Exit cleanup is best effort; stale same-host leases are reclaimed safely.
  }
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.headers.origin && !allowedBridgeOrigin(req.headers.origin)) {
      return send(res, 403, { ok: false, error: "origin_not_allowed" });
    }
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (url.pathname.startsWith("/runs") && ["GET", "POST"].includes(req.method || "")) {
      const accessProblems = bridgeAccessTokenProblems(req);
      if (accessProblems.length) return send(res, 401, { ok: false, error: "bridge_auth_required", problems: accessProblems });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      const health = {
        ok: true,
        service: SERVICE,
        contractVersion: CONTRACT_VERSION,
        listenMode: LOOPBACK_HOSTS.has(HOST) ? "loopback" : "configured-network",
      };
      if (bridgeAccessTokenProblems(req).length === 0) {
        Object.assign(health, {
          dataDir: DATA_DIR,
          port: PORT,
          eventTypes: Array.from(EVENT_TYPES),
          nodeIds: Array.from(NODE_IDS),
          proofSchema: PROOF_SCHEMA,
          adapterAware: true,
          bridgeAccessTokenConfigured: true,
          bridgeIntegrityKeyConfigured: Boolean(process.env.UASH_BRIDGE_INTEGRITY_KEY),
          humanApprovalTokenConfigured: Boolean(process.env.UASH_HUMAN_APPROVAL_TOKEN),
          reviewTrustSha256Configured: true,
          completedRunValidation: { ...COMPLETED_RUN_VALIDATION_METRICS, cachedRuns: COMPLETED_RUN_VALIDATIONS.size },
          repoRoot: REPO_ROOT,
        });
      }
      return send(res, 200, health);
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      const cursor = boundedPageParameter(url.searchParams, "cursor", 0, 0, MAX_RUN_DIRECTORY_ENTRIES);
      const limit = boundedPageParameter(url.searchParams, "limit", DEFAULT_RUN_PAGE_LIMIT, 1, MAX_RUN_PAGE_LIMIT);
      const paginationProblems = [
        ...unsupportedQueryParameterProblems(url.searchParams, ["cursor", "limit"]),
        ...cursor.problems,
        ...limit.problems,
      ];
      if (paginationProblems.length) {
        return send(res, 400, { ok: false, error: "invalid_pagination", problems: paginationProblems });
      }
      const pageResult = await listRuns({ cursor: cursor.value, limit: limit.value });
      return send(res, 200, pageResult.runs, paginationHeaders(pageResult.page));
    }

    if (req.method === "POST" && url.pathname === "/runs") {
      const body = await readJson(req);
      if (!body.id) return send(res, 400, { error: "run.id is required" });
      let runId;
      try {
        runId = canonicalRunId(body.id);
      } catch (error) {
        return send(res, 400, { ok: false, error: "invalid_run_id", problems: [error instanceof Error ? error.message : String(error)] });
      }
      const creationProblems = runCreationBodyProblems(body);
      if (creationProblems.length) return send(res, 400, { ok: false, error: "run_creation_contract_violation", problems: creationProblems });
      return await withRunLock(runId, async () => {
      if (body.humanApprovalToken || body.humanToken || body.auth) {
        return send(res, 400, { ok: false, error: "client_supplied_human_token_rejected", problems: ["Human approval tokens are operator-held process configuration, not POST /runs input. Set UASH_HUMAN_APPROVAL_TOKEN on the bridge process."] });
      }
      try {
        const existing = await readRun(runId);
        const mismatches = [];
        const scalarFields = ["title", "task", "repo", "branch", "lane", "agent", "risk", "eventSource"];
        for (const field of scalarFields) {
          if (body[field] !== undefined && body[field] !== existing[field]) mismatches.push(`${field} differs from the existing run`);
        }
        const requestedMode = body.mode ?? body.runMode;
        if (requestedMode !== undefined && requestedMode !== existing.mode) mismatches.push("mode differs from the existing run");
        if (body.artifactRoot !== undefined && path.resolve(String(body.artifactRoot)) !== path.resolve(String(existing.artifactRoot || ""))) {
          mismatches.push("artifactRoot differs from the existing run");
        }
        if (body.adapterPath !== undefined) {
          const requestedAdapter = resolveAdapterPath(body.adapterPath, body.artifactRoot || existing.artifactRoot);
          if (requestedAdapter.problems.length || requestedAdapter.adapterPath !== existing.adapterPath) {
            mismatches.push("adapterPath differs from the existing run");
          }
        }
        if (mismatches.length) {
          return send(res, 409, { ok: false, error: "run_already_exists", problems: mismatches, run: publicRunEventPage(existing).run });
        }
        const existingPage = publicRunEventPage(existing).run;
        return send(res, 200, {
          ...existingPage,
          idempotentReplay: true,
          humanApprovalTokenRequired: true,
          humanApprovalTokenNotice: "Approval grant/deny requires operator-held UASH_HUMAN_APPROVAL_TOKEN sent as x-uash-human-token by the separate operator-shell emitter. Raw tokens are never accepted from request bodies and never returned by HTTP.",
        });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          return send(res, 409, { ok: false, error: "existing_run_trust_violation", problems: [error instanceof Error ? error.message : String(error)] });
        }
      }
      let created;
      try {
        created = createRunFromBody(body);
      } catch (error) {
        return send(res, 400, { ok: false, error: "adapter_policy_violation", problems: [error instanceof Error ? error.message : String(error)] });
      }
      created.run = await writeRun(created.run);
      return send(res, 200, {
        ...publicRun(created.run),
        humanApprovalTokenRequired: true,
        humanApprovalTokenNotice: "Approval grant/deny requires operator-held UASH_HUMAN_APPROVAL_TOKEN sent as x-uash-human-token by the separate operator-shell emitter. Raw tokens are never accepted from request bodies and never returned by HTTP.",
      });
      });
    }

    if (parts[0] === "runs" && parts[1] && req.method === "GET" && parts.length === 2) {
      let runId;
      try {
        runId = canonicalRunId(parts[1]);
      } catch (error) {
        return send(res, 400, { ok: false, error: "invalid_run_id", problems: [error instanceof Error ? error.message : String(error)] });
      }
      const eventCursor = boundedPageParameter(url.searchParams, "eventCursor", null, 0, MAX_EVENTS_PER_RUN, { optional: true });
      const eventLimit = boundedPageParameter(url.searchParams, "eventLimit", DEFAULT_EVENT_PAGE_LIMIT, 1, MAX_EVENT_PAGE_LIMIT);
      const paginationProblems = [
        ...unsupportedQueryParameterProblems(url.searchParams, ["eventCursor", "eventLimit"]),
        ...eventCursor.problems,
        ...eventLimit.problems,
      ];
      if (paginationProblems.length) {
        return send(res, 400, { ok: false, error: "invalid_pagination", problems: paginationProblems });
      }
      return await withRunLock(runId, async () => {
        const pageResult = publicRunEventPage(await readRun(runId), {
          eventCursor: eventCursor.value,
          eventLimit: eventLimit.value,
        });
        return send(res, 200, pageResult.run, paginationHeaders(pageResult.page));
      });
    }

    if (parts[0] === "runs" && parts[1] && parts[2] === "events" && req.method === "POST") {
      let runId;
      try {
        runId = canonicalRunId(parts[1]);
      } catch (error) {
        return send(res, 400, { ok: false, error: "invalid_run_id", problems: [error instanceof Error ? error.message : String(error)] });
      }
      const body = await readJson(req);
      const metadataSizeProblems = runMetadataSizeProblems(body);
      if (metadataSizeProblems.length) {
        return send(res, 400, { ok: false, error: "event_contract_violation", problems: metadataSizeProblems });
      }
      const bodyHumanCredentialFields = ["humanToken", "humanApprovalToken"]
        .filter((field) => body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, field));
      if (bodyHumanCredentialFields.length) {
        return send(res, 400, {
          ok: false,
          error: "client_supplied_human_token_rejected",
          problems: ["Human approval tokens are accepted only through x-uash-human-token, never from an event request body."],
        });
      }
      return await withRunLock(runId, async () => {
      const humanToken = extractHumanToken(req);
      let run;
      let createdImplicitly = false;
      try {
        run = await readRun(runId);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          return send(res, 409, { ok: false, error: "commissioned_runtime_trust_violation", problems: [error instanceof Error ? error.message : String(error)] });
        }
        try {
          run = createMinimalRun(runId, body);
          createdImplicitly = true;
        } catch (error) {
          return send(res, 400, { ok: false, error: "adapter_policy_violation", problems: [error instanceof Error ? error.message : String(error)] });
        }
      }
      const preBindingConfig = immutableRunConfig(run);
      if (!run.artifactRoot && body.artifactRoot) {
        if ((run.events || []).length > 0) {
          return send(res, 409, { ok: false, error: "event_state_violation", problems: ["artifactRoot must be bound before the first persisted event"] });
        }
        run = normalizeRun({ ...run, artifactRoot: path.resolve(String(body.artifactRoot)) });
      }
      if (!run.adapterPolicy && (body.adapterPath || body.artifactRoot || run.artifactRoot)) {
        try {
          const adapterConfig = loadAdapterPolicy(body.adapterPath, body.artifactRoot || run.artifactRoot);
          if (adapterConfig.adapterPolicy) run = normalizeRun({ ...run, artifactRoot: run.artifactRoot || body.artifactRoot, adapterPath: adapterConfig.adapterPath, adapterPolicy: adapterConfig.adapterPolicy, commissionedRuntime: adapterConfig.commissionedRuntime, artifacts: createBaseArtifacts(adapterConfig.adapterPolicy) });
        } catch (error) {
          return send(res, 400, { ok: false, error: "adapter_policy_violation", problems: [error instanceof Error ? error.message : String(error)] });
        }
      }
      const configurationBoundOnFirstEvent = !createdImplicitly
        && JSON.stringify(preBindingConfig) !== JSON.stringify(immutableRunConfig(run));
      if (configurationBoundOnFirstEvent && (run.events || []).length > 0) {
        return send(res, 409, { ok: false, error: "event_state_violation", problems: ["artifactRoot and adapter commissioning must be bound before the first persisted event"] });
      }
      if (run.commissionedRuntime && !runIntegrityKey()) {
        return send(res, 409, { ok: false, error: "commissioned_runtime_trust_violation", problems: ["commissioned run creation and first-event binding require UASH_BRIDGE_INTEGRITY_KEY before any journal append"] });
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
      const artifactClaim = artifactVerification(run, event);
      const artifactProblems = event.type === "artifact.written"
        ? artifactWriteProblems(run, event, artifactClaim)
        : artifactClaim?.exists === true && /^[a-f0-9]{64}$/.test(artifactClaim.sha256 || "")
            ? []
            : artifactClaim?.problems || (event.type === "approval.granted" && event.artifact
                ? ["approval artifact verification did not bind an existing regular file and SHA-256 digest"]
                : []);
      if (artifactProblems.length) {
        return send(res, 400, { ok: false, error: "artifact_verification_failed", problems: artifactProblems });
      }
      if (artifactClaim) event.artifactVerification = artifactClaim;
      const sealedEventProblems = eventContractProblems(event);
      if (sealedEventProblems.length) {
        return send(res, 400, { ok: false, error: "event_contract_violation", problems: sealedEventProblems });
      }

      // Persist a replayable base and any first-event adapter seal before the
      // journal append so a crash cannot orphan or downgrade the event stream.
      if (createdImplicitly || configurationBoundOnFirstEvent) run = await writeRun(run);
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
          await appendEvent(runId, blockedEvent);
          await writeRun(blockedRun);
          return send(res, 409, { ok: false, error: "finish_line_blocked", problems, run: publicRunEventPage(blockedRun).run, event: blockedEvent });
        }
      }

      await appendEvent(runId, event);
      await writeRun(nextRun);
      return send(res, 200, { ok: true, run: publicRunEventPage(nextRun).run, event });
      });
    }

    return send(res, 404, { error: "not_found", routes: ["GET /health", "GET /runs", "POST /runs", "GET /runs/:id", "POST /runs/:id/events"] });
  } catch (error) {
    if (error?.code === "REQUEST_BODY_TOO_LARGE") return sendPayloadTooLarge(req, res);
    if (error?.code === "INVALID_JSON") return send(res, 400, { ok: false, error: "invalid_json" });
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

assertBridgeCredentialSeparation();
await mkdir(DATA_DIR, { recursive: true });
const bridgeLeasePath = await acquireBridgeDataLease();
let bridgeLeaseReleased = false;
const releaseOwnedBridgeDataLease = () => {
  if (bridgeLeaseReleased) return;
  bridgeLeaseReleased = true;
  releaseBridgeDataLease(bridgeLeasePath);
};
process.once("exit", releaseOwnedBridgeDataLease);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    releaseOwnedBridgeDataLease();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}
try {
  await assertNoLegacyRunDirectories();
} catch (error) {
  releaseOwnedBridgeDataLease();
  throw error;
}

const server = createServer(handle);
const sanitizedBridgeServerError = (phase, error) => {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "UNKNOWN_SERVER_ERROR";
  const syscall = typeof error?.syscall === "string" && /^[a-z0-9_-]{1,32}$/i.test(error.syscall)
    ? ` (${error.syscall})`
    : "";
  console.error(`${SERVICE} ${phase} failed: ${code}${syscall}`);
};
const failBridgeStartup = (error) => {
  sanitizedBridgeServerError("startup", error);
  releaseOwnedBridgeDataLease();
  process.exitCode = 1;
};
let bridgeRuntimeFailureStarted = false;
const failBridgeRuntime = (error) => {
  if (bridgeRuntimeFailureStarted) return;
  bridgeRuntimeFailureStarted = true;
  sanitizedBridgeServerError("runtime", error);
  const exitAfterServerClose = () => {
    releaseOwnedBridgeDataLease();
    process.exit(1);
  };
  if (!server.listening) {
    exitAfterServerClose();
    return;
  }
  server.close(exitAfterServerClose);
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
};
server.once("error", failBridgeStartup);
try {
  server.listen(PORT, HOST, () => {
    server.on("error", failBridgeRuntime);
    server.removeListener("error", failBridgeStartup);
    console.log(`${SERVICE} listening on http://${HOST}:${PORT}`);
    console.log(`contract: ${CONTRACT_VERSION}`);
    console.log(`data dir: ${DATA_DIR}`);
    console.log("separate run-integrity, bridge-access, and human-approval credentials are configured");
    console.log("Open the app, click Check bridge, then Sync run to bridge.");
  });
} catch (error) {
  failBridgeStartup(error);
}
