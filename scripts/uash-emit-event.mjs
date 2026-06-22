#!/usr/bin/env node
const [runId, type, nodeId, ...rest] = process.argv.slice(2);

if (!runId || !type || !nodeId) {
  console.error(`Usage:
  node scripts/uash-emit-event.mjs <run-id> <event-type> <node-id> "message" [options]

Options:
  --artifact path
  --status ok|warn|blocked|skipped|failed|needs_approval
  --actor claude-code|codex|hermes|harness|human
  --mode blueprint|live|replay
  --source bridge|mcp|api|watched-artifact|local-jsonl|database|run-packet|static-blueprint
  --skip-reason text
  --failure-reason text
  --recovery-path text
  --approval-owner text
  --approval-scope text
  --self-heal-pr-url url

Example:
  node scripts/uash-emit-event.mjs RUN-1042 node.skipped cloud-platform "Cloud skipped" --artifact cloud/skip.json --status skipped --skip-reason "No cloud change" --actor harness`);
  process.exit(2);
}

const options = {
  message: "",
  artifact: undefined,
  status: "ok",
  actor: "claude-code",
  runMode: undefined,
  eventSource: undefined,
  skipReason: undefined,
  failureReason: undefined,
  recoveryPath: undefined,
  approvalOwner: undefined,
  approvalScope: undefined,
  selfHealPrUrl: undefined,
};

const optionMap = {
  "--artifact": "artifact",
  "--status": "status",
  "--actor": "actor",
  "--mode": "runMode",
  "--source": "eventSource",
  "--skip-reason": "skipReason",
  "--failure-reason": "failureReason",
  "--recovery-path": "recoveryPath",
  "--approval-owner": "approvalOwner",
  "--approval-scope": "approvalScope",
  "--self-heal-pr-url": "selfHealPrUrl",
};

const messageParts = [];
for (let i = 0; i < rest.length; i += 1) {
  const item = rest[i];
  const key = optionMap[item];
  if (key) {
    options[key] = rest[++i] || "";
  } else {
    messageParts.push(item);
  }
}

options.message = messageParts.join(" ").trim() || `${type} ${nodeId}`;

const bridgeUrl = process.env.UASH_BRIDGE_URL || "http://127.0.0.1:8787";
const url = `${bridgeUrl.replace(/\/$/, "")}/runs/${encodeURIComponent(runId)}/events`;

const response = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type,
    nodeId,
    artifact: options.artifact,
    status: options.status,
    actor: options.actor,
    message: options.message,
    runMode: options.runMode,
    eventSource: options.eventSource,
    skipReason: options.skipReason,
    failureReason: options.failureReason,
    recoveryPath: options.recoveryPath,
    approvalOwner: options.approvalOwner,
    approvalScope: options.approvalScope,
    selfHealPrUrl: options.selfHealPrUrl,
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(body);
  process.exit(1);
}

console.log(body);
