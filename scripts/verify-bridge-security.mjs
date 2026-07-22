#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { BRIDGE_CREDENTIAL_ENV_NAMES, finishLineChildEnv } from "./bridge-security.mjs";
import { terminateChildProcess } from "./process-lifecycle.mjs";

const reviewTrustSha256 = "a".repeat(64);
const contaminatedEnvironment = {
  PATH: process.env.PATH,
  UASH_REVIEW_TRUST_SHA256: reviewTrustSha256,
};
const alternatingCase = (value) => [...value]
  .map((character, index) => index % 2 === 0 ? character.toUpperCase() : character.toLowerCase())
  .join("");
for (const [index, name] of BRIDGE_CREDENTIAL_ENV_NAMES.entries()) {
  contaminatedEnvironment[name] = ["uppercase", "fixture", index].join("-");
  contaminatedEnvironment[name.toLowerCase()] = ["lowercase", "fixture", index].join("-");
  contaminatedEnvironment[alternatingCase(name)] = ["mixed-case", "fixture", index].join("-");
}

const credentialNames = new Set(BRIDGE_CREDENTIAL_ENV_NAMES.map((name) => name.toUpperCase()));
const credentialAliases = (environment) => Object.keys(environment)
  .filter((name) => credentialNames.has(name.toUpperCase()));

const childEnvironment = finishLineChildEnv(contaminatedEnvironment);
assert.deepEqual(credentialAliases(childEnvironment), [], "sanitized validator environment retained a case-variant bridge credential");
assert.equal(childEnvironment.UASH_REVIEW_TRUST_SHA256, reviewTrustSha256, "sanitization removed the nonsecret review-trust pin");

const child = spawnSync(process.execPath, ["-e", [
  "const credentialNames = new Set(JSON.parse(process.argv[1]));",
  "const aliases = Object.keys(process.env).filter((name) => credentialNames.has(name.toUpperCase()));",
  "process.stdout.write(JSON.stringify({ aliases, reviewTrustSha256: process.env.UASH_REVIEW_TRUST_SHA256 }));",
].join(""), JSON.stringify([...credentialNames])], {
  encoding: "utf8",
  env: childEnvironment,
  shell: false,
  windowsHide: true,
});
assert.equal(child.status, 0, child.stderr || child.error?.message || "validator child failed");
const observed = JSON.parse(child.stdout);
assert.deepEqual(observed.aliases, [], "validator child inherited a case-variant bridge credential");
assert.equal(observed.reviewTrustSha256, reviewTrustSha256, "validator child did not inherit the nonsecret review-trust pin");

const bridgeAccessToken = "verify-bridge-access-token-32-bytes-minimum";
const bridgeIntegrityKey = "verify-bridge-integrity-key-32-bytes-minimum";
const humanApprovalToken = "verify-human-approval-token-32-bytes-minimum";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "valdris-bridge-security-"));
const port = 22000 + Math.floor(Math.random() * 18000);
const bridgeEnvironment = {
  ...finishLineChildEnv(process.env),
  UASH_BRIDGE_PORT: String(port),
  UASH_DATA_DIR: path.join(tempRoot, "runs"),
  UASH_BRIDGE_ACCESS_TOKEN: bridgeAccessToken,
  UASH_BRIDGE_INTEGRITY_KEY: bridgeIntegrityKey,
  UASH_HUMAN_APPROVAL_TOKEN: humanApprovalToken,
  UASH_REVIEW_TRUST_SHA256: reviewTrustSha256,
  UASH_BRIDGE_MAX_EVENTS_PER_RUN: "4",
};
const bridge = spawn(process.execPath, ["scripts/claude-code-bridge.mjs"], {
  cwd: path.resolve("."),
  env: bridgeEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let bridgeLog = "";
bridge.stdout.on("data", (chunk) => (bridgeLog += chunk));
bridge.stderr.on("data", (chunk) => (bridgeLog += chunk));

async function waitForBridge() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (bridge.exitCode !== null) throw new Error(`bridge exited during startup: ${bridgeLog}`);
    try {
      const remaining = Math.max(1, 5_000 - (Date.now() - started));
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(Math.min(1_000, remaining)),
      });
      if (response.ok) return;
    } catch {
      // Bridge is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`bridge did not become healthy: ${bridgeLog}`);
}

async function post(pathname, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-uash-bridge-token": bridgeAccessToken,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, text: await response.text() };
}

async function get(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: { "x-uash-bridge-token": bridgeAccessToken },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function rawPost(pathname, bodyChunks, headers = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const candidate = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-uash-bridge-token": bridgeAccessToken,
        connection: "close",
        ...headers,
      },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode, text });
      });
    });
    candidate.on("error", (error) => {
      if (!settled) reject(error);
    });
    candidate.setTimeout(10_000, () =>
      candidate.destroy(new Error("raw bridge request timed out")),
    );
    for (const chunk of bodyChunks) candidate.write(chunk);
    candidate.end();
  });
}

async function stopBridge() {
  await terminateChildProcess(bridge, { label: "bridge security fixture" });
}

try {
  await waitForBridge();
  const invalidListPage = await get("/runs?limit=0");
  assert.equal(invalidListPage.status, 400, invalidListPage.text);
  assert.equal(JSON.parse(invalidListPage.text).error, "invalid_pagination", "list endpoint accepted an out-of-range page limit");
  const unknownListPage = await get("/runs?eventLimit=1");
  assert.equal(unknownListPage.status, 400, unknownListPage.text);
  assert.equal(JSON.parse(unknownListPage.text).error, "invalid_pagination", "list endpoint accepted a detail-only query parameter");

  const pagedRunId = "VERIFY-PAGED-HISTORY";
  const pagedCreated = await post("/runs", { id: pagedRunId, title: "bounded event-history fixture" });
  assert.equal(pagedCreated.status, 200, pagedCreated.text);
  for (let index = 0; index < 4; index += 1) {
    const appended = await post(`/runs/${pagedRunId}/events`, {
      id: `${pagedRunId}-${index}`,
      type: "node.entered",
      nodeId: "intake",
      actor: "codex",
      message: `bounded history event ${index}`,
      status: "ok",
      runMode: "live",
      eventSource: "bridge",
    });
    assert.equal(appended.status, 200, appended.text);
  }
  const countLimited = await post(`/runs/${pagedRunId}/events`, {
    id: `${pagedRunId}-OVER-LIMIT`,
    type: "node.entered",
    nodeId: "intake",
    actor: "codex",
    message: "this event must not be persisted beyond the configured run-history limit",
    status: "ok",
    runMode: "live",
    eventSource: "bridge",
  });
  assert.equal(countLimited.status, 409, countLimited.text);
  assert.equal(JSON.parse(countLimited.text).error, "event_state_violation", "run event-count limit did not fail at the state boundary");

  const firstEventPage = await get(`/runs/${pagedRunId}?eventLimit=2&eventCursor=0`);
  assert.equal(firstEventPage.status, 200, firstEventPage.text);
  const firstPageDocument = JSON.parse(firstEventPage.text);
  assert.deepEqual(firstPageDocument.events.map(({ id }) => id), [`${pagedRunId}-0`, `${pagedRunId}-1`], "detail event cursor did not return the requested stable event slice");
  assert.deepEqual(firstPageDocument.eventPage, {
    offset: 0,
    limit: 2,
    returned: 2,
    total: 4,
    previousCursor: null,
    nextCursor: "2",
    truncated: true,
    byteLimited: false,
  }, "detail response omitted deterministic event-page metadata");
  assert.equal(firstEventPage.headers.get("x-uash-next-cursor"), "2", "detail response omitted its next cursor header");
  assert.ok(Number(firstEventPage.headers.get("content-length")) <= 768 * 1024, "detail response exceeded the bridge byte cap");

  const newestEventPage = await get(`/runs/${pagedRunId}?eventLimit=2`);
  assert.equal(newestEventPage.status, 200, newestEventPage.text);
  const newestPageDocument = JSON.parse(newestEventPage.text);
  assert.deepEqual(newestPageDocument.events.map(({ id }) => id), [`${pagedRunId}-2`, `${pagedRunId}-3`], "detail default did not retain the newest bounded event page");
  assert.equal(newestPageDocument.eventPage.offset, 2, "newest detail page reported the wrong event offset");

  const invalidEventPage = await get(`/runs/${pagedRunId}?eventLimit=201`);
  assert.equal(invalidEventPage.status, 400, invalidEventPage.text);
  assert.equal(JSON.parse(invalidEventPage.text).error, "invalid_pagination", "detail endpoint accepted an out-of-range event limit");
  const unknownEventPage = await get(`/runs/${pagedRunId}?limit=1`);
  assert.equal(unknownEventPage.status, 400, unknownEventPage.text);
  assert.equal(JSON.parse(unknownEventPage.text).error, "invalid_pagination", "detail endpoint accepted a list-only query parameter");

  const listPage = await get("/runs?limit=1&cursor=0");
  assert.equal(listPage.status, 200, listPage.text);
  const listDocument = JSON.parse(listPage.text);
  assert.equal(listDocument.length, 1, "list endpoint ignored its bounded run limit");
  assert.deepEqual(listDocument[0].events, [], "list summary exposed an event history");
  assert.equal(typeof listDocument[0].eventCount, "number", "list summary omitted the persisted event count");
  assert.equal(listPage.headers.get("x-uash-page-limit"), "1", "list response omitted its page-limit header");
  assert.ok(Number(listPage.headers.get("content-length")) <= 768 * 1024, "list response exceeded the bridge byte cap");

  const approvalRunId = "VERIFY-BOUNDED-APPROVALS";
  const approvalCreated = await post("/runs", { id: approvalRunId, title: "bounded approval-history fixture" });
  assert.equal(approvalCreated.status, 200, approvalCreated.text);
  for (let index = 0; index < 4; index += 1) {
    const approvalRequested = await post(`/runs/${approvalRunId}/events`, {
      id: `${approvalRunId}-${index}`,
      type: "approval.requested",
      nodeId: "redzone",
      actor: "harness",
      message: `bounded approval record ${index}`,
      status: "needs_approval",
      runMode: "live",
      eventSource: "bridge",
      approvalOwner: `owner-${index}`,
      approvalScope: `scope-${index}-${"x".repeat(12 * 1024)}`,
    });
    assert.equal(approvalRequested.status, 200, approvalRequested.text);
  }
  const boundedApprovalDetail = await get(`/runs/${approvalRunId}`);
  assert.equal(boundedApprovalDetail.status, 200, boundedApprovalDetail.text);
  const boundedApprovalDocument = JSON.parse(boundedApprovalDetail.text);
  assert.equal(boundedApprovalDocument.approvalCount, 4, "detail response lost the authoritative approval count");
  assert.equal(boundedApprovalDocument.approvalsTruncated, true, "detail response did not byte-bound a large valid approval history");
  assert.ok(boundedApprovalDocument.approvals.length < boundedApprovalDocument.approvalCount, "detail response returned the entire oversized approval projection");
  const boundedApprovalList = await get("/runs?limit=50");
  assert.equal(boundedApprovalList.status, 200, boundedApprovalList.text);
  const boundedApprovalSummary = JSON.parse(boundedApprovalList.text).find((run) => run.id === approvalRunId);
  assert.ok(boundedApprovalSummary && boundedApprovalSummary.approvalsTruncated === true, "one large approval history poisoned or disappeared from the global run list");

  const oversizedRunId = "VERIFY-OVERSIZED-EVENT";
  const oversizedCreated = await post("/runs", { id: oversizedRunId });
  assert.equal(oversizedCreated.status, 200, oversizedCreated.text);
  const oversizedEvent = await post(`/runs/${oversizedRunId}/events`, {
    id: `${oversizedRunId}-EVENT`,
    type: "node.entered",
    nodeId: "intake",
    actor: "codex",
    message: "x".repeat(16 * 1024),
    status: "ok",
    runMode: "live",
    eventSource: "bridge",
  });
  assert.equal(oversizedEvent.status, 400, oversizedEvent.text);
  assert.equal(JSON.parse(oversizedEvent.text).error, "event_contract_violation", "oversized event input was not rejected before journal append");

  const oversizedStateRunId = "VERIFY-OVERSIZED-STATE";
  const oversizedStateCreated = await post("/runs", { id: oversizedStateRunId });
  assert.equal(oversizedStateCreated.status, 200, oversizedStateCreated.text);
  const oversizedStateDirectory = path.join(
    bridgeEnvironment.UASH_DATA_DIR,
    `run-${createHash("sha256").update(oversizedStateRunId, "utf8").digest("hex")}`,
  );
  const snapshotPath = path.join(oversizedStateDirectory, "run.json");
  const configPath = path.join(oversizedStateDirectory, "run-config.json");
  const trustedSnapshot = await readFile(snapshotPath);
  const trustedConfig = await readFile(configPath);
  await truncate(snapshotPath, 64 * 1024 * 1024 + 1);
  const oversizedSnapshotRead = await get(`/runs/${oversizedStateRunId}`);
  assert.equal(oversizedSnapshotRead.status, 500, oversizedSnapshotRead.text);
  assert.match(JSON.parse(oversizedSnapshotRead.text).error, /bridge run snapshot must be a regular file no larger than/, "oversized snapshot was parsed instead of rejected by stat size");
  assert.ok(Number(oversizedSnapshotRead.headers.get("content-length")) <= 768 * 1024, "oversized snapshot error exceeded the response cap");
  await writeFile(snapshotPath, trustedSnapshot);
  await writeFile(configPath, Buffer.alloc(512 * 1024 + 1, 0x61));
  const oversizedConfigRead = await get(`/runs/${oversizedStateRunId}`);
  assert.equal(oversizedConfigRead.status, 500, oversizedConfigRead.text);
  assert.match(JSON.parse(oversizedConfigRead.text).error, /bridge run configuration must be a regular file no larger than/, "oversized run configuration was parsed instead of rejected by stat size");
  await writeFile(configPath, trustedConfig);

  const malformedMarker = "SENSITIVE-MALFORMED-BODY-MARKER";
  const malformed = await rawPost("/runs", [`{\"id\":\"${malformedMarker}\",}`]);
  assert.equal(malformed.status, 400, malformed.text);
  assert.deepEqual(JSON.parse(malformed.text), { ok: false, error: "invalid_json" }, "malformed JSON must return only a generic client error");
  assert.equal(malformed.text.includes(malformedMarker), false, "malformed JSON response echoed request-body bytes");

  for (const pathname of ["/runs", "/runs/VERIFY-JSON-SHAPE/events"]) {
    for (const invalidDocument of ["null", "[]"]) {
      const invalidShape = await rawPost(pathname, [invalidDocument]);
      assert.equal(invalidShape.status, 400, `${pathname} accepted a non-object JSON document: ${invalidShape.text}`);
      assert.deepEqual(JSON.parse(invalidShape.text), { ok: false, error: "invalid_json" }, `${pathname} must reject non-object JSON generically`);
    }
  }

  const maximumBodyBytes = 1024 * 1024;
  const declaredOversize = await rawPost("/runs", [Buffer.from("{}", "utf8")], {
    "content-length": String(maximumBodyBytes + 1),
  });
  assert.equal(declaredOversize.status, 413, declaredOversize.text);
  assert.deepEqual(JSON.parse(declaredOversize.text), { ok: false, error: "payload_too_large" }, "declared oversized body must return only a generic 413");

  const chunkedOversize = await rawPost("/runs", [
    Buffer.alloc(Math.floor(maximumBodyBytes / 2), 0x62),
    Buffer.alloc(Math.ceil(maximumBodyBytes / 2) + 1, 0x63),
  ], { "transfer-encoding": "chunked" });
  assert.equal(chunkedOversize.status, 413, chunkedOversize.text);
  assert.deepEqual(JSON.parse(chunkedOversize.text), { ok: false, error: "payload_too_large" }, "chunked oversized body must return only a generic 413");

  const runId = "VERIFY-HEADER-ONLY-APPROVAL";
  const created = await post("/runs", { id: runId });
  assert.equal(created.status, 200, created.text);
  const requested = await post(`/runs/${runId}/events`, {
    id: `${runId}-REQUEST`,
    type: "approval.requested",
    nodeId: "redzone",
    actor: "harness",
    message: "request operator approval",
    status: "needs_approval",
    runMode: "live",
    eventSource: "bridge",
    approvalOwner: "verification-owner",
    approvalScope: "credential-channel",
  });
  assert.equal(requested.status, 200, requested.text);
  for (const field of ["humanToken", "humanApprovalToken"]) {
    const rejected = await post(`/runs/${runId}/events`, {
      id: `${runId}-${field}`,
      type: "approval.granted",
      nodeId: "redzone",
      actor: "human",
      message: "reject body-carried approval credential",
      status: "ok",
      runMode: "live",
      eventSource: "bridge",
      approvalOwner: "verification-owner",
      approvalScope: "credential-channel",
      [field]: humanApprovalToken,
    }, { "x-uash-human-token": humanApprovalToken });
    assert.equal(rejected.status, 400, `${field} plus a valid header was accepted: ${rejected.text}`);
    assert.equal(rejected.text.includes(humanApprovalToken), false, `${field} rejection echoed the raw approval credential`);
  }
} finally {
  await stopBridge();
  await rm(tempRoot, { recursive: true, force: true });
}

const legacyHumanToken = ["synthetic", "human", "approval", "value", "123456789"].join("-");
const emitterDiagnostic = spawnSync(process.execPath, [
  "scripts/uash-emit-event.mjs",
  "VERIFY-DIAGNOSTIC",
  "approval.granted",
  "redzone",
  "reject legacy argv credential",
  `--human-token=${legacyHumanToken}`,
], {
  cwd: path.resolve("."),
  encoding: "utf8",
  env: finishLineChildEnv(process.env),
  shell: false,
  windowsHide: true,
});
const emitterOutput = `${emitterDiagnostic.stdout || ""}\n${emitterDiagnostic.stderr || ""}`;
assert.notEqual(emitterDiagnostic.status, 0, "operator emitter accepted the removed human-token argv channel");
assert.equal(emitterOutput.includes(legacyHumanToken), false, "operator emitter diagnostic echoed a raw equals-form human token");
assert.match(emitterOutput, /Unknown option: --human-token/, "operator emitter diagnostic omitted the rejected flag name");

const leadingEmitterDiagnostic = spawnSync(process.execPath, [
  "scripts/uash-emit-event.mjs",
  "VERIFY-DIAGNOSTIC",
  "approval.granted",
  "redzone",
  `--human-token=${legacyHumanToken}`,
], {
  cwd: path.resolve("."),
  encoding: "utf8",
  env: finishLineChildEnv(process.env),
  shell: false,
  windowsHide: true,
});
const leadingEmitterOutput = `${leadingEmitterDiagnostic.stdout || ""}\n${leadingEmitterDiagnostic.stderr || ""}`;
assert.notEqual(leadingEmitterDiagnostic.status, 0, "operator emitter treated a leading removed human-token option as message text");
assert.equal(leadingEmitterOutput.includes(legacyHumanToken), false, "operator emitter echoed a leading raw human token");
assert.match(leadingEmitterOutput, /Unknown option: --human-token/, "operator emitter did not identify the rejected leading flag safely");

for (const optionTail of [
  ["--approval-owner"],
  ["--approval-owner", `--human-token=${legacyHumanToken}`],
]) {
  const malformedKnownOption = spawnSync(process.execPath, [
    "scripts/uash-emit-event.mjs",
    "VERIFY-DIAGNOSTIC",
    "approval.granted",
    "redzone",
    "reject malformed known option",
    ...optionTail,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: finishLineChildEnv(process.env),
    shell: false,
    windowsHide: true,
  });
  const malformedOutput = `${malformedKnownOption.stdout || ""}\n${malformedKnownOption.stderr || ""}`;
  assert.notEqual(malformedKnownOption.status, 0, "operator emitter accepted a missing or flag-like known-option value");
  assert.equal(malformedOutput.includes(legacyHumanToken), false, "known-option diagnostic echoed the consumed flag-like secret value");
  assert.match(malformedOutput, /Option --approval-owner requires a non-empty, non-flag value/, "operator emitter did not fail at the malformed known option");
}

console.log("bridge security verification passed: credentials isolated, request/response/state bytes bounded, histories paged and count-limited, malformed inputs redacted, and approval credentials restricted to headers");
