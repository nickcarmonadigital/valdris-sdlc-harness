#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const node = process.execPath;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...(options.env || {}) }, stdio: ["ignore", "pipe", "pipe"] });
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

async function postEvent(port, runId, event, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:${port}/runs/${encodeURIComponent(runId)}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (response.status !== expectedStatus) {
    throw new Error(`expected ${expectedStatus} for ${event.type}, got ${response.status}: ${text}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "valdris-harness-verify-"));
const generatedOut = path.join(tempRoot, "commissioned");
const dataDir = path.join(tempRoot, "runs");
const port = 18000 + Math.floor(Math.random() * 20000);
let bridge;

try {
  const questions = await run(node, ["scripts/commission-harness.mjs", "--print-questions"]);
  const questionGroups = JSON.parse(questions.stdout);
  assert(questionGroups.length >= 12, `expected at least 12 commissioning groups, got ${questionGroups.length}`);

  await run(node, [
    "scripts/commission-harness.mjs",
    "--repo",
    ".",
    "--project-name",
    "Valdris SDLC Harness",
    "--out",
    generatedOut,
    "--yes",
  ]);

  const adapter = JSON.parse(await readFile(path.join(generatedOut, "project-adapter.json"), "utf8"));
  assert(adapter.schema === "uash.project-adapter.v2", "adapter schema mismatch");
  assert(adapter.productionReadiness.layers.length === 13, "production readiness layer count mismatch");
  assert(adapter.telemetryModes.modes.includes("live"), "live telemetry mode missing");
  assert(adapter.nodeStateContract.skippedRequiresReason, "skip-reason rule missing");
  assert(adapter.nodeStateContract.failedRequiresRecoveryPath, "failure recovery rule missing");
  await readFile(path.join(generatedOut, "AGENTS.md"), "utf8");
  await readFile(path.join(generatedOut, "CLAUDE.md"), "utf8");
  await readFile(path.join(generatedOut, ".claude", "commands", "valdris-sdlc-harness.md"), "utf8");
  await readFile(path.join(generatedOut, "docs", "Codex Runtime Prompt.md"), "utf8");

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

  await postEvent(
    port,
    "VERIFY-BAD-SKIP",
    { type: "node.skipped", nodeId: "cloud-platform", status: "skipped", actor: "harness", message: "bad skip missing reason" },
    400,
  );

  const blocked = await postEvent(
    port,
    "VERIFY-BLOCKED",
    { type: "run.completed", nodeId: "handoff", artifact: "handoff/final.md", status: "ok", actor: "harness", message: "try to finish too early" },
    409,
  );
  assert(blocked.error === "finish_line_blocked", "early completion was not blocked");
  assert(blocked.problems.some((problem) => problem.includes("proof/proof.json")), "blocked run did not cite missing proof");

  const runId = `VERIFY-PASS-${Date.now()}`;
  const okEvents = [
    { type: "node.entered", nodeId: "intake", artifact: "run/intake.json", status: "ok", actor: "codex", message: "Codex started intake", runMode: "live", eventSource: "bridge" },
    { type: "agent.connected", nodeId: "route", artifact: "run/route.json", status: "ok", actor: "codex", message: "Codex attached to harness route" },
    { type: "node.skipped", nodeId: "system-design", artifact: "design/system_design.md", status: "skipped", actor: "harness", message: "system design skipped", skipReason: "No architecture/API/data-model/hard-to-reverse decision in this verification run" },
    { type: "artifact.written", nodeId: "production-readiness", artifact: "production/layer-assessment.json", status: "ok", actor: "codex", message: "production layers assessed" },
    { type: "node.skipped", nodeId: "cloud-platform", artifact: "cloud/skip.json", status: "skipped", actor: "harness", message: "cloud skipped", skipReason: "No cloud/IAM/deploy/provider change in this verification run" },
    { type: "node.entered", nodeId: "implement", artifact: "session/events.jsonl", status: "ok", actor: "codex", message: "implementation node entered" },
    { type: "node.skipped", nodeId: "redzone", artifact: "approvals/redzone.json", status: "skipped", actor: "harness", message: "red zone skipped", skipReason: "No production/secrets/billing/auth/data/destructive action" },
    { type: "node.skipped", nodeId: "qa-break-it", artifact: "qa/break-it-results.md", status: "skipped", actor: "harness", message: "break-it QA skipped", skipReason: "Verification checks connector contract only; no product behavior changed" },
    { type: "gate.fired", nodeId: "prove", artifact: "proof/proof.json", status: "ok", actor: "harness", message: "proof attached: verify-harness assertions passed" },
    { type: "node.skipped", nodeId: "live-smoke", artifact: "smoke/skip.json", status: "skipped", actor: "harness", message: "live smoke skipped", skipReason: "No deployed/provider/runtime behavior changed" },
    { type: "node.skipped", nodeId: "self-heal", artifact: "self_heal/self_heal_report.md", status: "skipped", actor: "harness", message: "self-heal skipped", skipReason: "No harness gap detected by this verification run" },
    { type: "run.completed", nodeId: "handoff", artifact: "handoff/final.md", status: "ok", actor: "harness", message: "finish line passed with proof and skip reasons" },
  ];

  let finalBody;
  for (const event of okEvents) finalBody = await postEvent(port, runId, event, 200);
  assert(finalBody.run.status === "complete", "verified run did not complete");
  assert(finalBody.run.events.some((event) => event.actor === "codex"), "Codex actor event missing from verified run");

  const eventsJsonl = await readFile(path.join(dataDir, runId, "events.jsonl"), "utf8");
  assert(eventsJsonl.includes("run.completed"), "events.jsonl missing run.completed");

  console.log("Valdris SDLC Harness verification passed");
  console.log(
    JSON.stringify(
      {
        commissioningQuestionGroups: questionGroups.length,
        generatedFrontDoors: ["AGENTS.md", "CLAUDE.md", ".claude/commands/valdris-sdlc-harness.md", "docs/Codex Runtime Prompt.md"],
        adapterSchema: adapter.schema,
        productionLayers: adapter.productionReadiness.layers.length,
        bridgeHealth: health.service,
        earlyCompletionBlocked: true,
        verifiedRun: runId,
        eventCount: finalBody.run.events.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (bridge && !bridge.killed) bridge.kill("SIGTERM");
  await rm(tempRoot, { recursive: true, force: true });
}
