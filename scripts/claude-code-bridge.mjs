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

const baseArtifacts = [
  ["run/intake.json", "Intake"],
  ["run/route.json", "Route"],
  ["rca/rca.json", "Investigate"],
  ["design/anchors.json", "Design"],
  ["session/events.jsonl", "Implement"],
  ["approvals/redzone.json", "Red Zone"],
  ["proof/proof.json", "Prove"],
  ["handoff/final.md", "Handoff"],
].map(([artifactPath, label]) => ({ path: artifactPath, label, required: true, present: artifactPath === "run/intake.json" }));

const artifactByNode = {
  intake: "run/intake.json",
  route: "run/route.json",
  investigate: "rca/rca.json",
  design: "design/anchors.json",
  implement: "session/events.jsonl",
  redzone: "approvals/redzone.json",
  prove: "proof/proof.json",
  handoff: "handoff/final.md",
};

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
  };
}

function applyEvent(run, event) {
  const updated = {
    ...run,
    currentNodeId: event.nodeId || run.currentNodeId,
    updatedAt: nowIso(),
    events: [...(run.events || []), event],
  };

  if (event.type === "approval.requested") updated.status = "approval";
  else if (event.type === "run.blocked" || event.status === "blocked") updated.status = "blocked";
  else if (event.type === "run.completed") updated.status = "complete";
  else updated.status = "running";

  if (event.type === "approval.granted" && event.nodeId === "redzone") {
    updated.approvals = Array.from(new Set([...(updated.approvals || []), "redzone"]));
  }

  if (event.artifact) {
    updated.artifacts = (updated.artifacts || baseArtifacts).map((artifact) =>
      artifact.path === event.artifact ? { ...artifact, present: event.status !== "blocked" } : artifact,
    );
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
