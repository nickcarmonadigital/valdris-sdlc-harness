#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.UASH_BRIDGE_PORT || 8787);
const HOST = process.env.UASH_BRIDGE_HOST || "127.0.0.1";
const DATA_DIR = path.resolve(process.env.UASH_DATA_DIR || path.join(os.homedir(), ".uash", "runs"));
const SERVICE = "uash-claude-code-bridge";
const CONTRACT_VERSION = "uash.connector-events.v0.4";

const artifactByNode = {
  intake: "run/intake.json",
  route: "run/route.json",
  graphify: "graph/graph.json",
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
  graphify: "GitNexus",
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

function createBaseArtifacts() {
  return Object.entries(artifactByNode).map(([nodeId, artifactPath]) => ({
    path: artifactPath,
    label: labelByNode[nodeId] || nodeId,
    nodeId,
    required: true,
    present: false,
  }));
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
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
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
  return {
    ...run,
    contractVersion: run.contractVersion || CONTRACT_VERSION,
    approvals: normalizeApprovalRecords(run.approvals || []),
    artifacts: Array.isArray(run.artifacts) && run.artifacts.length ? run.artifacts : createBaseArtifacts(),
    events: Array.isArray(run.events) ? run.events : [],
  };
}

function createMinimalRun(runId, event = {}) {
  const now = nowIso();
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
    createdAt: now,
    updatedAt: now,
    approvals: [],
    artifacts: createBaseArtifacts(),
    events: [],
  });
}

function createRunFromBody(body) {
  const base = createMinimalRun(body.id, body);
  return normalizeRun({
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
    // Never trust client-supplied completion, artifact truth, events, or approvals on run creation.
    status: "running",
    approvals: [],
    artifacts: createBaseArtifacts(),
    events: [],
  });
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

function eventStateProblems(run, event) {
  const problems = [];
  if (event.type === "approval.granted" || event.type === "approval.denied") {
    const approvals = normalizeApprovalRecords(run.approvals || []);
    const pending = approvals.find((approval) => approval.scope === event.approvalScope && approval.owner === event.approvalOwner && approval.status === "pending");
    if (!pending) problems.push(`approval ${event.type} requires an existing pending approval for ${event.approvalScope} owned by ${event.approvalOwner}`);
  }
  return problems;
}

function artifactTargetFor(event) {
  if (event.type === "artifact.written" && event.artifact) return event.artifact;
  return artifactByNode[event.nodeId] || event.artifact;
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
  return resolveArtifactPath(run, event.artifact, true).problems;
}

function artifactVerification(run, event) {
  if (event.type !== "artifact.written") return undefined;
  const result = resolveArtifactPath(run, event.artifact, true);
  if (result.problems.length) return { checked: true, exists: false, problems: result.problems, path: result.resolved };
  const stat = statSync(result.resolved);
  return { checked: true, exists: true, path: result.resolved, realPath: result.realTarget, size: stat.size, mtimeMs: stat.mtimeMs };
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
  const targetArtifact = artifactTargetFor(event);
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
      const run = createRunFromBody(body);
      await writeRun(run);
      return send(res, 200, run);
    }

    if (parts[0] === "runs" && parts[1] && req.method === "GET" && parts.length === 2) {
      return send(res, 200, await readRun(parts[1]));
    }

    if (parts[0] === "runs" && parts[1] && parts[2] === "events" && req.method === "POST") {
      const runId = parts[1];
      const body = await readJson(req);
      let run;
      try {
        run = await readRun(runId);
      } catch {
        run = createMinimalRun(runId, body);
      }
      const event = normalizeEvent(runId, body);
      const contractProblems = eventContractProblems(event);
      if (contractProblems.length) {
        return send(res, 400, { ok: false, error: "event_contract_violation", problems: contractProblems });
      }
      const stateProblems = eventStateProblems(run, event);
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
  console.log("Open the app, click Check bridge, then Sync run to bridge.");
});
