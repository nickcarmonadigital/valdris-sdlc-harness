#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson } from "./proof-runner.mjs";
import { terminateChildProcess } from "./process-lifecycle.mjs";
import { reviewTrustStoreSha256 } from "./review-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const accessToken = "verify-bridge-access-token-32-bytes-minimum";
const integrityKey = "verify-bridge-integrity-key-32-bytes-minimum";
const humanToken = "verify-human-approval-token-32-bytes-minimum";
const reviewTrustSha256 = reviewTrustStoreSha256(
  readJson(path.join(root, "controls", "review-trust.v1.json")),
);

function startBridge(port, dataDir, { nodeArgs = [], environment = {} } = {}) {
  const child = spawn(node, [...nodeArgs, "scripts/claude-code-bridge.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      UASH_BRIDGE_PORT: String(port),
      UASH_DATA_DIR: dataDir,
      UASH_BRIDGE_ACCESS_TOKEN: accessToken,
      UASH_BRIDGE_INTEGRITY_KEY: integrityKey,
      UASH_HUMAN_APPROVAL_TOKEN: humanToken,
      UASH_REVIEW_TRUST_SHA256: reviewTrustSha256,
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  return { child, log: () => log };
}

async function waitForHealth(port, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const remaining = Math.max(1, timeoutMs - (Date.now() - started));
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(Math.min(1_000, remaining)),
      });
      if (response.ok) return response.json();
    } catch {
      // The process is still starting or correctly failed closed.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`bridge on port ${port} did not become healthy`);
}

async function waitForExit(child, timeoutMs = 4000) {
  if (child.exitCode !== null) return { exited: true, code: child.exitCode };
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ exited: false, code: null }),
      timeoutMs,
    );
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code });
    });
  });
}

async function stop(child) {
  await terminateChildProcess(child, { label: "bridge lease fixture" });
}

async function post(port, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-uash-bridge-token": accessToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, text: await response.text() };
}

function storageRunKey(runId) {
  return `run-${createHash("sha256").update(runId, "utf8").digest("hex")}`;
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "valdris-bridge-lease-"));
const basePort = 26000 + Math.floor(Math.random() * 12000);
const children = [];
let occupiedPortServer;

try {
  const staleLeaseDataDir = path.join(tempRoot, "stale-main");
  await mkdir(staleLeaseDataDir, { recursive: true });
  await writeFile(
    path.join(staleLeaseDataDir, ".bridge-process.lock"),
    `${JSON.stringify({
      schema: "uash.bridge-process-lease.v1",
      leaseId: "verify-stale-main-lease",
      pid: 2147483647,
      hostname: os.hostname(),
      startedAt: new Date(0).toISOString(),
    })}\n`,
    "utf8",
  );

  const starters = [basePort, basePort + 1].map((port) => {
    const started = startBridge(port, staleLeaseDataDir);
    children.push(started.child);
    return { ...started, port };
  });
  const health = await Promise.allSettled(
    starters.map(({ port }) => waitForHealth(port)),
  );
  const winners = health.flatMap((result, index) =>
    result.status === "fulfilled" ? [index] : [],
  );
  assert.equal(
    winners.length,
    1,
    "concurrent stale-main recovery must admit exactly one bridge",
  );
  const winner = starters[winners[0]];
  const loser = starters[winners[0] === 0 ? 1 : 0];
  const publicHealth = health[winners[0]].value;
  const publicHealthText = JSON.stringify(publicHealth);
  assert.equal(
    publicHealth.listenMode,
    "loopback",
    "public health must disclose only the bounded listen mode",
  );
  assert.equal(
    Object.hasOwn(publicHealth, "dataDir"),
    false,
    "public health must omit the absolute data directory",
  );
  assert.equal(
    Object.hasOwn(publicHealth, "repoRoot"),
    false,
    "public health must omit the absolute repository root",
  );
  assert.equal(
    publicHealthText.includes(path.resolve(staleLeaseDataDir)),
    false,
    "serialized public health leaked the absolute data directory",
  );
  assert.equal(
    publicHealthText.includes(root),
    false,
    "serialized public health leaked the absolute repository root",
  );
  const privateHealthResponse = await fetch(
    `http://127.0.0.1:${winner.port}/health`,
    { headers: { "x-uash-bridge-token": accessToken } },
  );
  const privateHealth = await privateHealthResponse.json();
  assert.equal(
    privateHealthResponse.status,
    200,
    "authenticated detailed health must remain available",
  );
  assert.equal(
    privateHealth.dataDir,
    path.resolve(staleLeaseDataDir),
    "authenticated detailed health must bind the selected data directory",
  );
  assert.equal(
    privateHealth.repoRoot,
    root,
    "authenticated detailed health must bind the bridge repository root",
  );
  const loserExit = await waitForExit(loser.child);
  if (!loserExit.exited) await stop(loser.child);
  assert.ok(
    loserExit.exited && loserExit.code !== 0,
    "concurrent stale-main recovery loser must exit nonzero",
  );
  assert.match(
    loser.log(),
    /recovery mutex already exists|already leased by another bridge process/,
    "concurrent stale-main recovery loser must fail at the lease boundary",
  );
  await stop(winner.child);
  assert.equal(
    existsSync(path.join(staleLeaseDataDir, ".bridge-process-recovery.lock")),
    false,
    "successful recovery must remove its owned recovery mutex",
  );
  const remainingMainLeasePath = path.join(
    staleLeaseDataDir,
    ".bridge-process.lock",
  );
  if (existsSync(remainingMainLeasePath)) {
    const remainingMainLease = JSON.parse(
      await readFile(remainingMainLeasePath, "utf8"),
    );
    assert.equal(
      remainingMainLease.schema,
      "uash.bridge-process-lease.v1",
      "crash-left main lease must remain an authenticated lease-shaped recovery input",
    );
    assert.match(
      remainingMainLease.leaseId || "",
      /^[a-f0-9]{32}$/,
      "crash-left main lease must belong to the winning bridge, not the reclaimed fixture",
    );
  }

  const recoveryCases = [
    ["malformed", "not-json\n"],
    [
      "stale",
      `${JSON.stringify({ schema: "uash.bridge-process-recovery-lease.v1", leaseId: "verify-stale-recovery-mutex", pid: 2147483647, hostname: os.hostname(), startedAt: new Date(0).toISOString() })}\n`,
    ],
  ];
  for (const [index, [label, content]] of recoveryCases.entries()) {
    const dataDir = path.join(tempRoot, `${label}-recovery-mutex`);
    await mkdir(dataDir, { recursive: true });
    const recoveryPath = path.join(dataDir, ".bridge-process-recovery.lock");
    await writeFile(recoveryPath, content, "utf8");
    const candidate = startBridge(basePort + 2 + index, dataDir);
    children.push(candidate.child);
    const result = await waitForExit(candidate.child);
    if (!result.exited) await stop(candidate.child);
    assert.ok(
      result.exited && result.code !== 0,
      `${label} recovery mutex must block startup`,
    );
    assert.match(
      candidate.log(),
      /recovery mutex already exists; refusing to steal/,
      `${label} recovery mutex must produce explicit operator cleanup guidance`,
    );
    assert.equal(
      existsSync(recoveryPath),
      true,
      `${label} recovery mutex must never be stolen or removed automatically`,
    );
    assert.equal(
      await readFile(recoveryPath, "utf8"),
      content,
      `${label} recovery mutex content must remain unchanged`,
    );
  }

  const activeDataDir = path.join(tempRoot, "active-owner-journal");
  const activeOwner = startBridge(basePort + 4, activeDataDir);
  children.push(activeOwner.child);
  await waitForHealth(basePort + 4);
  const activeRunId = "VERIFY-ACTIVE-OWNER-JOURNAL";
  const created = await post(basePort + 4, "/runs", { id: activeRunId });
  assert.equal(created.status, 200, created.text);
  const entered = await post(basePort + 4, `/runs/${activeRunId}/events`, {
    id: `${activeRunId}-ENTERED`,
    type: "node.entered",
    nodeId: "intake",
    actor: "codex",
    message: "establish an authenticated journal before the lease-race probe",
    status: "ok",
    runMode: "live",
    eventSource: "bridge",
  });
  assert.equal(entered.status, 200, entered.text);
  const activeJournal = path.join(
    activeDataDir,
    storageRunKey(activeRunId),
    "events.jsonl",
  );
  const partialTail = Buffer.from(
    '{"partial":"owned-by-active-bridge"',
    "utf8",
  );
  await appendFile(activeJournal, partialTail);
  const journalBeforeLoser = await readFile(activeJournal);
  const activeLoser = startBridge(basePort + 5, activeDataDir);
  children.push(activeLoser.child);
  const activeLoserExit = await waitForExit(activeLoser.child);
  if (!activeLoserExit.exited) await stop(activeLoser.child);
  assert.ok(
    activeLoserExit.exited && activeLoserExit.code !== 0,
    "second bridge must fail while an active owner holds the data lease",
  );
  assert.match(
    activeLoser.log(),
    /already leased by another bridge process/,
    "second bridge must fail before reading or repairing active owner state",
  );
  assert.deepEqual(
    await readFile(activeJournal),
    journalBeforeLoser,
    "lease-denied bridge changed the active owner's partial journal before failing",
  );
  await stop(activeOwner.child);

  const invalidStateDataDir = path.join(tempRoot, "scan-failure-cleanup");
  const invalidStateDir = path.join(
    invalidStateDataDir,
    "legacy-run-directory",
  );
  await mkdir(invalidStateDir, { recursive: true });
  const invalidStateBytes = Buffer.from("not-json\n", "utf8");
  await writeFile(path.join(invalidStateDir, "run.json"), invalidStateBytes);
  const invalidStateBridge = startBridge(basePort + 6, invalidStateDataDir);
  children.push(invalidStateBridge.child);
  const invalidStateExit = await waitForExit(invalidStateBridge.child);
  if (!invalidStateExit.exited) await stop(invalidStateBridge.child);
  assert.ok(
    invalidStateExit.exited && invalidStateExit.code !== 0,
    "invalid run-state scan must fail bridge startup",
  );
  assert.match(
    invalidStateBridge.log(),
    /legacy bridge state requires explicit archival/,
    "invalid run-state scan omitted explicit recovery guidance",
  );
  assert.equal(
    existsSync(path.join(invalidStateDataDir, ".bridge-process.lock")),
    false,
    "failed post-lease run-state scan left the data-directory lease behind",
  );
  assert.deepEqual(
    await readFile(path.join(invalidStateDir, "run.json")),
    invalidStateBytes,
    "failed run-state scan changed invalid state while reporting it",
  );

  const occupiedDataDir = path.join(tempRoot, "occupied-port");
  occupiedPortServer = createServer((_request, response) =>
    response.end("occupied"),
  );
  await new Promise((resolve, reject) => {
    occupiedPortServer.once("error", reject);
    occupiedPortServer.listen(0, "127.0.0.1", resolve);
  });
  const occupiedAddress = occupiedPortServer.address();
  assert.ok(
    occupiedAddress && typeof occupiedAddress === "object",
    "occupied-port fixture did not expose a TCP port",
  );
  const occupiedBridge = startBridge(occupiedAddress.port, occupiedDataDir);
  children.push(occupiedBridge.child);
  const occupiedExit = await waitForExit(occupiedBridge.child);
  if (!occupiedExit.exited) await stop(occupiedBridge.child);
  assert.ok(
    occupiedExit.exited && occupiedExit.code !== 0,
    "bridge startup on an occupied port must exit nonzero",
  );
  assert.match(
    occupiedBridge.log(),
    /startup failed[^\r\n]*EADDRINUSE/i,
    "occupied-port startup failure must log a useful sanitized error code",
  );
  for (const forbidden of [
    accessToken,
    integrityKey,
    humanToken,
    path.resolve(occupiedDataDir),
  ]) {
    assert.equal(
      occupiedBridge.log().includes(forbidden),
      false,
      "occupied-port startup diagnostic leaked credential or data-directory material",
    );
  }
  assert.equal(
    existsSync(path.join(occupiedDataDir, ".bridge-process.lock")),
    false,
    "occupied-port startup failure left the data-directory lease behind",
  );

  const runtimeErrorDataDir = path.join(tempRoot, "runtime-server-error");
  const runtimeCloseMarker = path.join(tempRoot, "runtime-server-close.json");
  const runtimeErrorPreload = path.join(
    tempRoot,
    "inject-runtime-server-error.mjs",
  );
  await writeFile(
    runtimeErrorPreload,
    [
      'import http from "node:http";',
      'import { existsSync, writeFileSync } from "node:fs";',
      'import path from "node:path";',
      'import { syncBuiltinESMExports } from "node:module";',
      "const originalCreateServer = http.createServer;",
      "http.createServer = (...args) => {",
      "  const server = originalCreateServer(...args);",
      "  const originalClose = server.close.bind(server);",
      "  server.close = (callback) => originalClose((...closeArgs) => {",
      '    const leasePath = path.join(process.env.UASH_DATA_DIR, ".bridge-process.lock");',
      "    writeFileSync(process.env.UASH_VERIFY_SERVER_CLOSE_MARKER, JSON.stringify({ leasePresentAtClose: existsSync(leasePath) }));",
      "    if (callback) callback(...closeArgs);",
      "  });",
      '  server.once("listening", () => setTimeout(() => {',
      '    const error = Object.assign(new Error("synthetic runtime server failure"), { code: "VERIFY_RUNTIME_ERROR", syscall: "verify" });',
      '    server.emit("error", error);',
      "  }, 250));",
      "  return server;",
      "};",
      "syncBuiltinESMExports();",
      "",
    ].join("\n"),
    "utf8",
  );
  const runtimeErrorBridge = startBridge(basePort + 7, runtimeErrorDataDir, {
    nodeArgs: ["--import", pathToFileURL(runtimeErrorPreload).href],
    environment: { UASH_VERIFY_SERVER_CLOSE_MARKER: runtimeCloseMarker },
  });
  children.push(runtimeErrorBridge.child);
  const runtimeErrorExit = await waitForExit(runtimeErrorBridge.child);
  if (!runtimeErrorExit.exited) await stop(runtimeErrorBridge.child);
  assert.ok(
    runtimeErrorExit.exited && runtimeErrorExit.code !== 0,
    "runtime HTTP server error must terminate the bridge nonzero",
  );
  assert.match(
    runtimeErrorBridge.log(),
    /listening on http:\/\//,
    "runtime error fixture did not reach the post-listen server phase",
  );
  assert.match(
    runtimeErrorBridge.log(),
    /runtime failed: VERIFY_RUNTIME_ERROR \(verify\)/,
    "runtime HTTP server error omitted its sanitized runtime diagnostic",
  );
  assert.doesNotMatch(
    runtimeErrorBridge.log(),
    /startup failed: VERIFY_RUNTIME_ERROR/,
    "post-listen HTTP server error was handled by the stale startup listener",
  );
  const closeMarker = JSON.parse(await readFile(runtimeCloseMarker, "utf8"));
  assert.equal(
    closeMarker.leasePresentAtClose,
    true,
    "runtime server error released the data lease before the HTTP server close callback",
  );
  assert.equal(
    existsSync(path.join(runtimeErrorDataDir, ".bridge-process.lock")),
    false,
    "runtime server error left the data-directory lease behind after shutdown",
  );

  const replacement = startBridge(basePort + 7, runtimeErrorDataDir);
  children.push(replacement.child);
  await waitForHealth(basePort + 7);
  await stop(replacement.child);

  console.log(
    "bridge lease verification passed: startup/runtime cleanup, post-listen error handoff, pre-scan lease ownership, bounded health, concurrent stale recovery, and recovery-mutex fail-closed behavior",
  );
} finally {
  if (occupiedPortServer)
    await new Promise((resolve) => occupiedPortServer.close(resolve));
  for (const child of children) await stop(child);
  await rm(tempRoot, { recursive: true, force: true });
}
