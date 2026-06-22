#!/usr/bin/env node
const [runId, type, nodeId, ...rest] = process.argv.slice(2);

if (!runId || !type || !nodeId) {
  console.error(`Usage:
  node scripts/uash-emit-event.mjs <run-id> <event-type> <node-id> "message" [--artifact path] [--status ok|warn|blocked] [--actor claude-code|harness|human]

Example:
  node scripts/uash-emit-event.mjs RUN-1042 gate.fired investigate "RCA gate fired" --artifact rca/rca.json --actor harness`);
  process.exit(2);
}

const options = {
  message: "",
  artifact: undefined,
  status: "ok",
  actor: "claude-code",
};

const messageParts = [];
for (let i = 0; i < rest.length; i += 1) {
  const item = rest[i];
  if (item === "--artifact") {
    options.artifact = rest[++i];
  } else if (item === "--status") {
    options.status = rest[++i] || "ok";
  } else if (item === "--actor") {
    options.actor = rest[++i] || "claude-code";
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
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(body);
  process.exit(1);
}

console.log(body);
