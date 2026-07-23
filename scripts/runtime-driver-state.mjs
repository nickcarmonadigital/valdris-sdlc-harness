#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson } from "./control-gate-lib.mjs";
import {
  RUNTIME_DRIVER_STATE_SCHEMA,
  validateRuntimeDriverStateDocument,
} from "./operating-contracts-lib.mjs";
import {
  canonicalJson,
  resolveArtifactPath,
  safeIdentifier,
  sha256,
} from "./proof-runner.mjs";

const STATUSES = new Set([
  "running",
  "completed",
  "blocked",
  "cancelled",
  "failed",
]);
const EMPTY_HEAD =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const RUNTIME_DRIVER_LOCK_SCHEMA = "valdris.runtime-driver-lock.v2";
const RUNTIME_DRIVER_JOURNAL_SCHEMA = "valdris.runtime-driver-journal.v1";
const RUNTIME_DRIVER_JOURNAL_COMMIT_SCHEMA =
  "valdris.runtime-driver-journal-commit.v1";
const RUNTIME_DRIVER_LOCK_TTL_MS = 15 * 60_000;
const RUNTIME_DRIVER_HEARTBEAT_MS = 30_000;
const TEST_MODE_ENV = "VALDRIS_RUNTIME_DRIVER_TEST_MODE";
const TEST_FAULT_ENV = "VALDRIS_RUNTIME_DRIVER_TEST_FAULT_PHASE";
const TEST_PAUSE_ENV = "VALDRIS_RUNTIME_DRIVER_TEST_PAUSE_AFTER_LOCK_MS";

function canonicalIso(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    return false;
  return new Date(value).toISOString() === value;
}

function statIdentity(target) {
  const stats = lstatSync(target, { bigint: true });
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    mode: String(stats.mode),
    size: String(stats.size),
  };
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function fsyncFile(target) {
  const descriptor = openSync(target, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(target) {
  if (platform() === "win32") return;
  const descriptor = openSync(target, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function identityCommand(command, args, maxOutputLength = 512) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: maxOutputLength + 1,
    windowsHide: true,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
    },
  });
  if (result.error || result.status !== 0) return null;
  const output = result.stdout.trim();
  return output.length > 0 && output.length <= maxOutputLength ? output : null;
}

function windowsPowerShell(command) {
  const executable = process.env.SystemRoot
    ? path.join(
        process.env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
    : "powershell.exe";
  return identityCommand(executable, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command,
  ]);
}

function readIdentityFile(target) {
  try {
    const value = readFileSync(target, "utf8").trim();
    return value.length > 0 && value.length <= 512 ? value : null;
  } catch {
    return null;
  }
}

function localHostIdentity() {
  if (platform() === "linux") {
    const machineId =
      readIdentityFile("/etc/machine-id") ||
      readIdentityFile("/var/lib/dbus/machine-id");
    return machineId ? `linux-machine-id:${machineId}` : null;
  }
  if (platform() === "win32") {
    const machineId = windowsPowerShell(
      "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid",
    );
    return machineId ? `windows-machine-guid:${machineId}` : null;
  }
  if (platform() === "darwin") {
    const output = identityCommand(
      "/usr/sbin/ioreg",
      ["-rd1", "-c", "IOPlatformExpertDevice"],
      64 * 1024,
    );
    const match = output?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/u);
    return match ? `darwin-platform-uuid:${match[1]}` : null;
  }
  return null;
}

function localBootIdentity() {
  if (platform() === "linux") {
    const bootId = readIdentityFile("/proc/sys/kernel/random/boot_id");
    return bootId ? `linux-boot-id:${bootId}` : null;
  }
  if (platform() === "win32") {
    const bootTime = windowsPowerShell(
      "(Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')",
    );
    return bootTime ? `windows-boot-time:${bootTime}` : null;
  }
  if (platform() === "darwin") {
    const bootTime = identityCommand("/usr/sbin/sysctl", [
      "-n",
      "kern.boottime",
    ]);
    return bootTime ? `darwin-boot-time:${bootTime}` : null;
  }
  return null;
}

function localProcessCreationIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  if (platform() === "linux") {
    const stat = readIdentityFile(`/proc/${pid}/stat`);
    if (!stat) return null;
    const closingParenthesis = stat.lastIndexOf(")");
    const fields =
      closingParenthesis >= 0
        ? stat
            .slice(closingParenthesis + 1)
            .trim()
            .split(/\s+/u)
        : [];
    const startTicks = fields[19];
    return /^\d+$/u.test(startTicks || "")
      ? `linux-proc-start-ticks:${startTicks}`
      : null;
  }
  if (platform() === "win32") {
    const creationTime = windowsPowerShell(
      `$p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if ($null -eq $p) { exit 3 }; $p.CreationDate.ToUniversalTime().ToString('o')`,
    );
    return creationTime ? `windows-process-created:${creationTime}` : null;
  }
  if (platform() === "darwin") {
    const creationTime = identityCommand("/bin/ps", [
      "-o",
      "lstart=",
      "-p",
      String(pid),
    ]);
    return creationTime ? `darwin-process-created:${creationTime}` : null;
  }
  return null;
}

export function runtimeDriverLocalIdentity(pid = process.pid) {
  const hostId = localHostIdentity();
  const bootId = localBootIdentity();
  const processIdentity = localProcessCreationIdentity(pid);
  if (!hostId || !bootId || !processIdentity)
    throw new Error(
      "runtime-driver could not obtain exact host boot and process creation identity",
    );
  return {
    host: hostname(),
    hostId,
    bootId,
    processIdentity,
  };
}

function boundedIdentity(value) {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 512 &&
    !/[\u0000-\u001f]/u.test(value)
  );
}

function validateLockMetadata(metadata, target) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    metadata.schema !== RUNTIME_DRIVER_LOCK_SCHEMA ||
    !Number.isSafeInteger(metadata.pid) ||
    metadata.pid < 1 ||
    typeof metadata.host !== "string" ||
    metadata.host.length < 1 ||
    metadata.host.length > 255 ||
    /[\u0000-\u001f]/.test(metadata.host) ||
    !boundedIdentity(metadata.hostId) ||
    !boundedIdentity(metadata.bootId) ||
    !boundedIdentity(metadata.processIdentity) ||
    !canonicalIso(metadata.startedAt) ||
    !canonicalIso(metadata.heartbeatAt) ||
    !canonicalIso(metadata.expiresAt) ||
    Date.parse(metadata.heartbeatAt) < Date.parse(metadata.startedAt) ||
    Date.parse(metadata.expiresAt) - Date.parse(metadata.heartbeatAt) !==
      RUNTIME_DRIVER_LOCK_TTL_MS ||
    metadata.lockTtlMs !== RUNTIME_DRIVER_LOCK_TTL_MS ||
    !/^[a-f0-9]{32}$/.test(metadata.nonce || "") ||
    !/^[a-f0-9]{64}$/.test(metadata.fencingToken || "") ||
    metadata.targetSha256 !== sha256(path.resolve(target))
  )
    throw new Error(
      "runtime-driver lock metadata is malformed or not bound to this state file",
    );
}

function readLockSnapshot(lockPath, target) {
  if (!lstatSync(lockPath).isDirectory())
    throw new Error(
      "runtime-driver lock is not an atomic metadata directory; manual recovery is required",
    );
  const ownerPath = path.join(lockPath, "owner.json");
  if (!existsSync(ownerPath) || !lstatSync(ownerPath).isFile())
    throw new Error(
      "runtime-driver lock metadata is incomplete; manual recovery is required",
    );
  const raw = readFileSync(ownerPath, "utf8");
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw new Error(
      "runtime-driver lock metadata is malformed; manual recovery is required",
    );
  }
  validateLockMetadata(metadata, target);
  return {
    raw,
    metadata,
    lockIdentity: statIdentity(lockPath),
    ownerIdentity: statIdentity(ownerPath),
  };
}

function sameLockSnapshot(left, right) {
  return (
    left.raw === right.raw &&
    sameIdentity(left.lockIdentity, right.lockIdentity) &&
    sameIdentity(left.ownerIdentity, right.ownerIdentity)
  );
}

function localProcessStatus(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "dead";
    return "unknown";
  }
}

function assertLockIsReclaimable(snapshot) {
  const currentHostId = localHostIdentity();
  if (!currentHostId)
    throw new Error(
      "runtime-driver cannot verify the local host identity; lock recovery fails closed",
    );
  if (snapshot.metadata.hostId !== currentHostId)
    throw new Error(
      "runtime-driver state is locked by a foreign host; an external fencing provider or explicit manual recovery is required",
    );
  const currentBootId = localBootIdentity();
  if (!currentBootId)
    throw new Error(
      "runtime-driver cannot verify the local boot identity; lock recovery fails closed",
    );
  if (snapshot.metadata.bootId !== currentBootId) return;
  const status = localProcessStatus(snapshot.metadata.pid);
  if (status === "dead") return;
  if (status !== "alive")
    throw new Error(
      "runtime-driver state lock owner could not be verified as stopped",
    );
  const processIdentity = localProcessCreationIdentity(snapshot.metadata.pid);
  if (!processIdentity)
    throw new Error(
      "runtime-driver cannot verify the lock owner's exact process creation identity",
    );
  if (processIdentity !== snapshot.metadata.processIdentity) return;
  throw new Error(
    "runtime-driver state is locked by the exact live same-host writer",
  );
}

function reclaimStaleLock(lockPath, target) {
  const first = readLockSnapshot(lockPath, target);
  assertLockIsReclaimable(first);
  const second = readLockSnapshot(lockPath, target);
  assertLockIsReclaimable(second);
  if (!sameLockSnapshot(first, second))
    throw new Error(
      "runtime-driver lock changed while stale ownership was being verified",
    );
  const tombstone = `${lockPath}.stale-${first.metadata.nonce}`;
  if (existsSync(tombstone))
    throw new Error(
      "runtime-driver stale-lock tombstone already exists; concurrent recovery rejected",
    );
  renameSync(lockPath, tombstone);
  const moved = readLockSnapshot(tombstone, target);
  if (!sameLockSnapshot(second, moved))
    throw new Error(
      "runtime-driver lock identity changed during stale-lock quarantine",
    );
}

function createLockCandidate(lockPath, target) {
  const now = new Date();
  const identity = runtimeDriverLocalIdentity();
  const metadata = {
    schema: RUNTIME_DRIVER_LOCK_SCHEMA,
    pid: process.pid,
    ...identity,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + RUNTIME_DRIVER_LOCK_TTL_MS,
    ).toISOString(),
    lockTtlMs: RUNTIME_DRIVER_LOCK_TTL_MS,
    nonce: randomBytes(16).toString("hex"),
    fencingToken: randomBytes(32).toString("hex"),
    targetSha256: sha256(path.resolve(target)),
  };
  const candidate = `${lockPath}.candidate-${metadata.pid}-${metadata.nonce}`;
  mkdirSync(candidate, { recursive: false, mode: 0o700 });
  let owner;
  try {
    owner = openSync(path.join(candidate, "owner.json"), "wx", 0o600);
    writeFileSync(owner, `${JSON.stringify(metadata, null, 2)}\n`);
    fsyncSync(owner);
    closeSync(owner);
    owner = undefined;
    fsyncDirectory(candidate);
  } catch (error) {
    if (owner !== undefined) {
      closeSync(owner);
      owner = undefined;
    }
    rmSync(candidate, { recursive: true, force: true });
    throw error;
  } finally {
    if (owner !== undefined) closeSync(owner);
  }
  return { candidate, metadata };
}

function acquireRuntimeDriverLock(lockPath, target) {
  const { candidate, metadata } = createLockCandidate(lockPath, target);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (existsSync(lockPath)) reclaimStaleLock(lockPath, target);
      let acquired = false;
      try {
        renameSync(candidate, lockPath);
        acquired = true;
      } catch (error) {
        if (!existsSync(lockPath)) throw error;
      }
      if (!acquired) continue;
      const published = readLockSnapshot(lockPath, target);
      if (
        published.metadata.nonce !== metadata.nonce ||
        published.metadata.fencingToken !== metadata.fencingToken ||
        published.metadata.pid !== metadata.pid ||
        published.metadata.hostId !== metadata.hostId ||
        published.metadata.bootId !== metadata.bootId ||
        published.metadata.processIdentity !== metadata.processIdentity
      )
        throw new Error(
          "runtime-driver lock ownership changed during atomic acquisition",
        );
      return metadata;
    }
    throw new Error(
      "runtime-driver state is locked by another writer; retry from the latest head",
    );
  } finally {
    if (existsSync(candidate))
      rmSync(candidate, { recursive: true, force: true });
  }
}

function assertRuntimeDriverLockOwned(lockPath, target, metadata) {
  const current = readLockSnapshot(lockPath, target);
  if (
    current.metadata.nonce !== metadata.nonce ||
    current.metadata.fencingToken !== metadata.fencingToken ||
    current.metadata.pid !== metadata.pid ||
    current.metadata.hostId !== metadata.hostId ||
    current.metadata.bootId !== metadata.bootId ||
    current.metadata.processIdentity !== metadata.processIdentity
  )
    throw new Error(
      "runtime-driver fencing token or exact lock ownership changed",
    );
  return current;
}

function renewRuntimeDriverLock(lockPath, target, metadata) {
  assertRuntimeDriverLockOwned(lockPath, target, metadata);
  const now = new Date();
  const updated = {
    ...metadata,
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + RUNTIME_DRIVER_LOCK_TTL_MS,
    ).toISOString(),
  };
  const ownerPath = path.join(lockPath, "owner.json");
  const temporary = path.join(
    lockPath,
    `owner.${metadata.fencingToken}.renewing`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(updated, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, ownerPath);
    fsyncFile(ownerPath);
    fsyncDirectory(lockPath);
    Object.assign(metadata, updated);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function startRuntimeDriverHeartbeat(lockPath, target, metadata) {
  let heartbeatError = null;
  const timer = setInterval(() => {
    try {
      renewRuntimeDriverLock(lockPath, target, metadata);
    } catch (error) {
      heartbeatError = error;
    }
  }, RUNTIME_DRIVER_HEARTBEAT_MS);
  timer.unref();
  return {
    assert() {
      if (heartbeatError)
        throw new Error(
          `runtime-driver heartbeat lost lock ownership: ${heartbeatError.message}`,
        );
      assertRuntimeDriverLockOwned(lockPath, target, metadata);
    },
    renew() {
      if (heartbeatError)
        throw new Error(
          `runtime-driver heartbeat lost lock ownership: ${heartbeatError.message}`,
        );
      renewRuntimeDriverLock(lockPath, target, metadata);
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function releaseRuntimeDriverLock(lockPath, target, metadata) {
  assertRuntimeDriverLockOwned(lockPath, target, metadata);
  rmSync(lockPath, { recursive: true });
  fsyncDirectory(path.dirname(lockPath));
}

function injectTestFault(phase) {
  if (
    process.env[TEST_MODE_ENV] === "1" &&
    process.env[TEST_FAULT_ENV] === phase
  ) {
    process.stderr.write(`runtime-driver injected fault: ${phase}\n`);
    process.exit(86);
  }
}

async function pauseAfterLockForTest() {
  if (process.env[TEST_MODE_ENV] !== "1") return;
  const milliseconds = Number(process.env[TEST_PAUSE_ENV] || 0);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > 120_000
  )
    throw new Error("runtime-driver test pause is invalid");
  if (milliseconds > 0)
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeJournalBytes(value, label) {
  if (typeof value !== "string" || value.length < 1)
    throw new Error(`runtime-driver journal ${label} is invalid`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value)
    throw new Error(`runtime-driver journal ${label} is not canonical base64`);
  return decoded;
}

function validateJournalState(bytes, expectedSha256, label) {
  if (sha256(bytes) !== expectedSha256)
    throw new Error(`runtime-driver journal ${label} digest does not match`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`runtime-driver journal ${label} is not valid JSON`);
  }
  const validation = validateRuntimeDriverStateDocument(document);
  if (!validation.valid)
    throw new Error(
      `runtime-driver journal ${label} state is invalid: ${validation.problems.join("; ")}`,
    );
  return document;
}

function readRuntimeDriverJournal(journalPath, target) {
  if (!lstatSync(journalPath).isFile())
    throw new Error(
      "runtime-driver durability journal is not a regular file; manual recovery is required",
    );
  const raw = readFileSync(journalPath, "utf8");
  const lines = raw.trimEnd().split("\n");
  if (
    lines.length < 1 ||
    lines.length > 2 ||
    lines.some((line) => !line.trim())
  )
    throw new Error("runtime-driver durability journal is malformed");
  let prepared;
  let committed = null;
  try {
    prepared = JSON.parse(lines[0]);
  } catch {
    throw new Error("runtime-driver durability journal is malformed");
  }
  if (lines.length === 2) {
    try {
      committed = JSON.parse(lines[1]);
    } catch {
      committed = null;
    }
  }
  if (
    !prepared ||
    typeof prepared !== "object" ||
    Array.isArray(prepared) ||
    prepared.schema !== RUNTIME_DRIVER_JOURNAL_SCHEMA ||
    prepared.targetSha256 !== sha256(path.resolve(target)) ||
    typeof prepared.priorExists !== "boolean" ||
    !/^[a-f0-9]{64}$/u.test(prepared.priorDocumentSha256 || "") ||
    !/^[a-f0-9]{64}$/u.test(prepared.nextDocumentSha256 || "") ||
    !/^[a-f0-9]{64}$/u.test(prepared.nextHeadSha256 || "") ||
    !canonicalIso(prepared.preparedAt) ||
    !/^[a-f0-9]{64}$/u.test(prepared.fencingToken || "") ||
    typeof prepared.temporaryName !== "string" ||
    path.basename(prepared.temporaryName) !== prepared.temporaryName ||
    prepared.temporaryName.length > 255
  )
    throw new Error("runtime-driver durability journal metadata is malformed");
  if (
    (!prepared.priorExists && prepared.priorDocumentBase64 !== null) ||
    (prepared.priorExists && typeof prepared.priorDocumentBase64 !== "string")
  )
    throw new Error(
      "runtime-driver durability journal prior-state metadata is malformed",
    );
  const priorBytes = prepared.priorExists
    ? decodeJournalBytes(prepared.priorDocumentBase64, "prior state")
    : null;
  if (
    (priorBytes && sha256(priorBytes) !== prepared.priorDocumentSha256) ||
    (!priorBytes && prepared.priorDocumentSha256 !== EMPTY_HEAD)
  )
    throw new Error(
      "runtime-driver durability journal prior-state digest does not match",
    );
  if (priorBytes)
    validateJournalState(priorBytes, prepared.priorDocumentSha256, "prior");
  const nextBytes = decodeJournalBytes(
    prepared.nextDocumentBase64,
    "next state",
  );
  const nextDocument = validateJournalState(
    nextBytes,
    prepared.nextDocumentSha256,
    "next",
  );
  if (nextDocument.currentHeadSha256 !== prepared.nextHeadSha256)
    throw new Error(
      "runtime-driver durability journal next head does not match",
    );
  const priorDocument = priorBytes
    ? JSON.parse(priorBytes.toString("utf8"))
    : null;
  if (
    (priorDocument &&
      (nextDocument.runId !== priorDocument.runId ||
        nextDocument.checkpointRevision !==
          priorDocument.checkpointRevision + 1 ||
        nextDocument.priorHeadSha256 !== priorDocument.currentHeadSha256 ||
        canonicalJson(nextDocument.checkpointHistory.slice(0, -1)) !==
          canonicalJson(priorDocument.checkpointHistory))) ||
    (!priorDocument &&
      (nextDocument.checkpointRevision !== 1 ||
        nextDocument.priorHeadSha256 !== EMPTY_HEAD ||
        nextDocument.checkpointHistory.length !== 1))
  )
    throw new Error(
      "runtime-driver durability journal does not encode one exact state transition",
    );
  if (committed) {
    if (
      typeof committed !== "object" ||
      Array.isArray(committed) ||
      committed.schema !== RUNTIME_DRIVER_JOURNAL_COMMIT_SCHEMA ||
      committed.nextDocumentSha256 !== prepared.nextDocumentSha256 ||
      committed.nextHeadSha256 !== prepared.nextHeadSha256 ||
      !canonicalIso(committed.committedAt)
    )
      throw new Error(
        "runtime-driver durability journal commit marker is malformed",
      );
  }
  return { prepared, committed, priorBytes, nextBytes, nextDocument };
}

function durableReplaceBytes(target, bytes, temporary, options = {}) {
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (options.injectFaults) injectTestFault("after-temp-fsync");
    options.assertFence?.();
    renameSync(temporary, target);
    if (options.injectFaults) injectTestFault("after-replace");
    fsyncFile(target);
    if (options.injectFaults) injectTestFault("after-target-fsync");
    fsyncDirectory(path.dirname(target));
    if (options.injectFaults) injectTestFault("after-parent-fsync");
    options.assertFence?.();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function removeDurably(target) {
  if (existsSync(target)) unlinkSync(target);
  fsyncDirectory(path.dirname(target));
}

function recoverRuntimeDriverJournal(journalPath, target) {
  if (!existsSync(journalPath)) return null;
  const journal = readRuntimeDriverJournal(journalPath, target);
  const targetBytes = existsSync(target) ? readFileSync(target) : null;
  const targetSha256 = targetBytes ? sha256(targetBytes) : EMPTY_HEAD;
  const priorSha256 = journal.prepared.priorDocumentSha256;
  const nextSha256 = journal.prepared.nextDocumentSha256;
  const temporary = path.join(
    path.dirname(target),
    journal.prepared.temporaryName,
  );
  if (journal.committed) {
    if (targetSha256 !== nextSha256) {
      let targetContainsCommittedHead = false;
      if (targetBytes) {
        try {
          const targetDocument = JSON.parse(targetBytes.toString("utf8"));
          const validation = validateRuntimeDriverStateDocument(targetDocument);
          targetContainsCommittedHead =
            validation.valid &&
            targetDocument.checkpointHistory.some(
              (checkpoint) =>
                checkpoint.currentHeadSha256 ===
                journal.prepared.nextHeadSha256,
            );
        } catch {
          targetContainsCommittedHead = false;
        }
      }
      if (!targetContainsCommittedHead) {
        if (targetSha256 !== priorSha256)
          throw new Error(
            "runtime-driver committed journal does not match the current or prior state",
          );
        durableReplaceBytes(
          target,
          journal.nextBytes,
          `${target}.${process.pid}.${randomBytes(8).toString("hex")}.recover`,
        );
      }
    }
  } else {
    if (targetSha256 !== priorSha256 && targetSha256 !== nextSha256)
      throw new Error(
        "runtime-driver prepared journal does not match the current or prior state",
      );
    if (journal.prepared.priorExists) {
      if (targetSha256 !== priorSha256)
        durableReplaceBytes(
          target,
          journal.priorBytes,
          `${target}.${process.pid}.${randomBytes(8).toString("hex")}.recover`,
        );
    } else if (targetBytes) {
      removeDurably(target);
    }
  }
  if (existsSync(temporary)) unlinkSync(temporary);
  removeDurably(journalPath);
  return journal.committed ? "forward" : "rollback";
}

function writePreparedJournal(
  journalPath,
  target,
  priorBytes,
  nextBytes,
  next,
  lock,
  temporary,
) {
  const prepared = {
    schema: RUNTIME_DRIVER_JOURNAL_SCHEMA,
    targetSha256: sha256(path.resolve(target)),
    priorExists: priorBytes !== null,
    priorDocumentSha256: priorBytes ? sha256(priorBytes) : EMPTY_HEAD,
    priorDocumentBase64: priorBytes
      ? Buffer.from(priorBytes).toString("base64")
      : null,
    nextDocumentSha256: sha256(nextBytes),
    nextDocumentBase64: Buffer.from(nextBytes).toString("base64"),
    nextHeadSha256: next.currentHeadSha256,
    preparedAt: new Date().toISOString(),
    fencingToken: lock.fencingToken,
    temporaryName: path.basename(temporary),
  };
  const journalTemporary = `${journalPath}.${lock.fencingToken}.preparing`;
  let descriptor;
  try {
    descriptor = openSync(journalTemporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(prepared)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(journalTemporary, journalPath);
    fsyncFile(journalPath);
    fsyncDirectory(path.dirname(journalPath));
    injectTestFault("after-journal-fsync");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(journalTemporary)) unlinkSync(journalTemporary);
  }
}

function appendCommittedJournal(journalPath, next) {
  const commit = {
    schema: RUNTIME_DRIVER_JOURNAL_COMMIT_SCHEMA,
    nextDocumentSha256: sha256(`${JSON.stringify(next, null, 2)}\n`),
    nextHeadSha256: next.currentHeadSha256,
    committedAt: new Date().toISOString(),
  };
  const descriptor = openSync(journalPath, "a", 0o600);
  try {
    const serialized = `${JSON.stringify(commit)}\n`;
    if (
      process.env[TEST_MODE_ENV] === "1" &&
      process.env[TEST_FAULT_ENV] === "during-commit-write"
    ) {
      writeFileSync(descriptor, serialized.slice(0, serialized.length / 2));
      fsyncSync(descriptor);
      throw new Error("runtime-driver injected fault: during-commit-write");
    }
    writeFileSync(descriptor, serialized);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  injectTestFault("after-commit-fsync");
}

function persistRuntimeDriverState(target, next, lock, heartbeat) {
  const journalPath = `${target}.journal`;
  if (existsSync(journalPath))
    throw new Error(
      "runtime-driver durability journal was not recovered before transition",
    );
  const priorBytes = existsSync(target) ? readFileSync(target) : null;
  const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`);
  const temporary = `${target}.${process.pid}.${lock.nonce}.tmp`;
  writePreparedJournal(
    journalPath,
    target,
    priorBytes,
    nextBytes,
    next,
    lock,
    temporary,
  );
  try {
    heartbeat.renew();
    durableReplaceBytes(target, nextBytes, temporary, {
      injectFaults: true,
      assertFence: () => heartbeat.assert(),
    });
    appendCommittedJournal(journalPath, next);
    heartbeat.assert();
    removeDurably(journalPath);
  } catch (error) {
    heartbeat.assert();
    recoverRuntimeDriverJournal(journalPath, target);
    throw error;
  }
}

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    file: "runtime/driver-state.json",
    write: false,
    leaseMinutes: 30,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--write") args.write = true;
    else if (value === "--repo") args.repo = argv[++index];
    else if (value === "--file") args.file = argv[++index];
    else if (value === "--run-id") args.runId = argv[++index];
    else if (value === "--status") args.status = argv[++index];
    else if (value === "--lease-owner") args.leaseOwner = argv[++index];
    else if (value === "--lease-id") args.leaseId = argv[++index];
    else if (value === "--expected-head") args.expectedHead = argv[++index];
    else if (value === "--lease-minutes")
      args.leaseMinutes = Number(argv[++index]);
    else if (value === "--help") args.help = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

export function nextRuntimeDriverState(current, input, now = new Date()) {
  if (!safeIdentifier(input.runId)) throw new Error("--run-id is required");
  if (!safeIdentifier(input.leaseOwner))
    throw new Error("--lease-owner is required");
  if (!STATUSES.has(input.status)) throw new Error("--status is invalid");
  if (!Number.isFinite(input.leaseMinutes) || input.leaseMinutes < 1)
    throw new Error("--lease-minutes must be positive");
  if (!/^[a-f0-9]{64}$/i.test(input.expectedHead || ""))
    throw new Error("--expected-head is required for every state transition");
  if (!safeIdentifier(input.leaseId))
    throw new Error("--lease-id is required for every state transition");
  if (current) {
    const validation = validateRuntimeDriverStateDocument(current, {
      runId: input.runId,
    });
    if (!validation.valid)
      throw new Error(
        `existing runtime-driver state is invalid: ${validation.problems.join("; ")}`,
      );
  }
  if (!current && input.status !== "running")
    throw new Error("runtime-driver state must begin in running status");
  if (current && current.status !== "running")
    throw new Error("runtime-driver terminal state cannot be resumed");
  const priorHeadSha256 = current?.currentHeadSha256 || EMPTY_HEAD;
  if (input.expectedHead !== priorHeadSha256)
    throw new Error("runtime-driver compare-and-swap rejected a stale head");
  if (current && current.runId !== input.runId)
    throw new Error("runtime-driver state belongs to a different run");
  const leaseActive = Boolean(
    current?.leaseExpiresAt &&
    Date.parse(current.leaseExpiresAt) > now.getTime(),
  );
  if (leaseActive && current.leaseOwner !== input.leaseOwner)
    throw new Error("runtime-driver lease is held by another owner");
  if (leaseActive && input.leaseId !== current.leaseId)
    throw new Error("runtime-driver active lease identity cannot be replaced");
  const checkpointRevision = (current?.checkpointRevision || 0) + 1;
  const leaseId = leaseActive ? current.leaseId : input.leaseId;
  const leaseExpiresAt = new Date(
    now.getTime() + input.leaseMinutes * 60_000,
  ).toISOString();
  const transition = {
    runId: input.runId,
    leaseId,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt,
    checkpointRevision,
    priorHeadSha256,
    status: input.status,
  };
  const currentHeadSha256 = sha256(canonicalJson(transition));
  const checkpoint = { ...transition, currentHeadSha256 };
  return {
    schema: RUNTIME_DRIVER_STATE_SCHEMA,
    ...checkpoint,
    checkpointHistory: [...(current?.checkpointHistory || []), checkpoint],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/runtime-driver-state.mjs --repo . --run-id <id> --status <state> --lease-owner <owner> [--expected-head <sha256>] [--write]",
    );
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = resolveArtifactPath(repoRoot, args.file, {
    mustExist: false,
  });
  let next;
  if (args.write) {
    mkdirSync(path.dirname(target), { recursive: true });
    const lockPath = `${target}.lock`;
    const lock = acquireRuntimeDriverLock(lockPath, target);
    const heartbeat = startRuntimeDriverHeartbeat(lockPath, target, lock);
    try {
      await pauseAfterLockForTest();
      heartbeat.assert();
      recoverRuntimeDriverJournal(`${target}.journal`, target);
      const current = existsSync(target) ? readJson(target) : null;
      next = nextRuntimeDriverState(current, args);
      persistRuntimeDriverState(target, next, lock, heartbeat);
    } finally {
      heartbeat.stop();
      releaseRuntimeDriverLock(lockPath, target, lock);
    }
  } else {
    if (existsSync(`${target}.journal`))
      throw new Error(
        "runtime-driver has a pending durability journal; use --write to recover it before planning another transition",
      );
    const current = existsSync(target) ? readJson(target) : null;
    next = nextRuntimeDriverState(current, args);
  }
  console.log(
    JSON.stringify(
      { ok: true, persisted: args.write, path: args.file, state: next },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      JSON.stringify({ ok: false, problems: [error.message] }, null, 2),
    );
    process.exit(1);
  });
