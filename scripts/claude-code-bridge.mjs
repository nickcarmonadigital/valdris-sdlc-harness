#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.UASH_BRIDGE_PORT || 8787);
const HOST = process.env.UASH_BRIDGE_HOST || "127.0.0.1";
const DATA_DIR = path.resolve(process.env.UASH_DATA_DIR || path.join(os.homedir(), ".uash", "runs"));
const SERVICE = "uash-claude-code-bridge";

const artifactByNode = {
  intake: "run/intake.json",
  route: "run/route.json",
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

const baseArtifacts = Object.entries(artifactByNode).map(([nodeId, artifactPath]) => ({
  path: artifactPath,
  label: labelByNode[nodeId] || nodeId,
  required: true,
  present: artifactPath === "run/intake.json",
}));

function runDir(runId) {
  return path.join(DATA_DIR, sanitize(runId));
}

function sanitize(value) {
  return String(value || "RUN-UNKNOWN").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function nowIso() {
  return new Date().toISOString();
}

function nowClock() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  return JSON.parse(raw);
}

async function writeRun(run) {
  const dir = runDir(run.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
}

function createMinimalRun(runId, event = {}) {
  const now = nowIso();
  return {
    id: runId,
    title: event.title || `Claude Code run ${runId}`,
    task: event.task || "Created by local bridge event.",
    repo: event.repo || "local/claude-code",
    branch: event.branch || "unknown",
    lane: event.lane || "agent-runtime",
    agent: event.actor === "codex" || event.actor === "hermes" ? event.actor : "claude-code",
    status: "running",
    risk: "medium",
    mode: event.runMode || "live",
    eventSource: event.eventSource || "bridge",
    currentNodeId: event.nodeId || "intake",
    createdAt: now,
    updatedAt: now,
    approvals: [],
    artifacts: baseArtifacts,
    events: [],
  };
}

function normalizeEvent(runId, event) {
  const nodeId = event.nodeId || event.node || "route";
  return {
    id: event.id || `${runId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: event.type || "node.entered",
    at: event.at || nowClock(),
    actor: event.actor || "claude-code",
    nodeId,
    artifact: event.artifact || artifactByNode[nodeId],
    message: event.message || `${event.type || "node.entered"} ${nodeId}`,
    status: event.status || "ok",
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

function applyEvent(run, event) {
  const updated = {
    ...run,
    mode: event.runMode || run.mode || "live",
    eventSource: event.eventSource || run.eventSource || "bridge",
    currentNodeId: event.nodeId || run.currentNodeId,
    updatedAt: nowIso(),
    events: [...(run.events || []), event],
  };

  if (event.type === "approval.requested" || event.status === "needs_approval") updated.status = "approval";
  else if (event.type === "run.blocked" || event.type === "node.failed" || event.status === "blocked" || event.status === "failed") updated.status = "blocked";
  else if (event.type === "run.completed") updated.status = "complete";
  else updated.status = "running";

  if (event.type === "approval.granted" && event.nodeId === "redzone") {
    updated.approvals = Array.from(new Set([...(updated.approvals || []), "redzone"]));
  }

  if (event.artifact || event.nodeId) {
    const targetArtifact = artifactByNode[event.nodeId] || event.artifact;
    const hasTarget = (updated.artifacts || baseArtifacts).some((artifact) => artifact.path === targetArtifact);
    const artifacts = hasTarget
      ? updated.artifacts || baseArtifacts
      : [
          ...(updated.artifacts || baseArtifacts),
          {
            path: targetArtifact,
            label: labelByNode[event.nodeId] || event.nodeId || targetArtifact,
            required: true,
            present: false,
          },
        ];

    updated.artifacts = artifacts.map((artifact) => {
      if (artifact.path !== targetArtifact) return artifact;
      if (event.type === "node.skipped" || event.status === "skipped") {
        return {
          ...artifact,
          present: false,
          skipped: true,
          failed: false,
          skipReason: event.skipReason || event.message,
          evidenceArtifact: event.artifact,
        };
      }
      if (event.type === "node.failed" || event.status === "failed" || event.status === "blocked") {
        return {
          ...artifact,
          present: false,
          skipped: false,
          failed: true,
          failureReason: event.failureReason || event.message,
          recoveryPath: event.recoveryPath,
          evidenceArtifact: event.artifact,
        };
      }
      return { ...artifact, present: true, skipped: false, failed: false, evidenceArtifact: event.artifact };
    });
  }

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
      runs.push(JSON.parse(await readFile(file, "utf8")));
    } catch {
      // Skip corrupt local bridge files instead of crashing the connector.
    }
  }
  return runs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function handle(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, "");

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, service: SERVICE, dataDir: DATA_DIR, port: PORT });
    }

    if (req.method === "GET" && url.pathname === "/runs") {
      return send(res, 200, await listRuns());
    }

    if (req.method === "POST" && url.pathname === "/runs") {
      const run = await readJson(req);
      if (!run.id) return send(res, 400, { error: "run.id is required" });
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
      const nextRun = applyEvent(run, event);
      await writeRun(nextRun);
      await appendFile(path.join(runDir(runId), "events.jsonl"), JSON.stringify(event) + "\n");
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
  console.log(`data dir: ${DATA_DIR}`);
  console.log("Open the app, click Check bridge, then Sync run to bridge.");
});
