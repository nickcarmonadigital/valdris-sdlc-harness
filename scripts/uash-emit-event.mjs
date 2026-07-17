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
  --artifact-root path (explicit run artifact root for local proof verification)
  --adapter-path path (project adapter inside artifactRoot or an allowed adapter root)
  --event-id id (predeclared ID used to correlate approval evidence)

Example:
  node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 node.skipped cloud-platform "Cloud skipped" --artifact cloud/skip.json --status skipped --skip-reason "No cloud change" --actor harness`);
  process.exit(2);
}

const options = {
  message: "",
  artifact: undefined,
  status: "ok",
  actor: "claude-code",
  runMode: "live",
  eventSource: "bridge",
  skipReason: undefined,
  failureReason: undefined,
  recoveryPath: undefined,
  approvalOwner: undefined,
  approvalScope: undefined,
  selfHealPrUrl: undefined,
  artifactRoot: undefined,
  adapterPath: undefined,
  eventId: undefined,
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
  "--artifact-root": "artifactRoot",
  "--adapter-path": "adapterPath",
  "--event-id": "eventId",
};

const messageParts = [];
for (let i = 0; i < rest.length; i += 1) {
  const item = rest[i];
  const key = optionMap[item];
  if (key) {
    const value = rest[i + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("-")) {
      console.error(`Option ${item} requires a non-empty, non-flag value`);
      process.exit(2);
    }
    options[key] = value;
    i += 1;
  } else if (item.startsWith("--")) {
    const diagnosticOption = /^--[A-Za-z][A-Za-z0-9_.-]{0,127}/.exec(item)?.[0] || "--[invalid]";
    console.error(`Unknown option: ${diagnosticOption}`);
    process.exit(2);
  } else {
    messageParts.push(item);
  }
}

options.message = messageParts.join(" ").trim() || `${type} ${nodeId}`;

const bridgeUrl = process.env.UASH_BRIDGE_URL || "http://127.0.0.1:8787";
const url = `${bridgeUrl.replace(/\/$/, "")}/runs/${encodeURIComponent(runId)}/events`;

const bridgeToken = process.env.UASH_BRIDGE_ACCESS_TOKEN;
if (!bridgeToken) {
  console.error("UASH_BRIDGE_ACCESS_TOKEN is required for bridge event writes");
  process.exit(2);
}
const humanApprovalDecision = type === "approval.granted" || type === "approval.denied";
const humanToken = humanApprovalDecision ? process.env.UASH_HUMAN_APPROVAL_TOKEN : undefined;
if (humanApprovalDecision && !humanToken) {
  console.error("UASH_HUMAN_APPROVAL_TOKEN is required in the separate operator shell for approval grant/deny events");
  process.exit(2);
}
const headers = { "content-type": "application/json" };
headers["x-uash-bridge-token"] = bridgeToken;
if (humanToken) headers["x-uash-human-token"] = humanToken;

const response = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify({
    id: options.eventId,
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
    artifactRoot: options.artifactRoot,
    adapterPath: options.adapterPath,
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(body);
  process.exit(1);
}

console.log(body);
