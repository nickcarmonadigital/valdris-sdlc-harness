#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcceptedInventory } from "./run-acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const inventoryFixture = mkdtempSync(
  path.join(os.tmpdir(), "valdris-accepted-inventory-"),
);
try {
  const relativePath = "run/packet.json";
  const target = path.join(inventoryFixture, "run", "packet.json");
  mkdirSync(path.dirname(target), { recursive: true });
  const original = Buffer.from('{"status":"accepted"}\n', "utf8");
  writeFileSync(target, original);
  const files = [
    {
      path: relativePath,
      size: original.length,
      sha256: createHash("sha256").update(original).digest("hex"),
    },
  ];
  assertAcceptedInventory(inventoryFixture, files);
  writeFileSync(target, Buffer.from('{"status":"tampered"}\n', "utf8"));
  let mutationRejected = false;
  try {
    assertAcceptedInventory(inventoryFixture, files);
  } catch {
    mutationRejected = true;
  }
  if (!mutationRejected)
    throw new Error("final accepted inventory mutation was not rejected");
} finally {
  rmSync(inventoryFixture, { recursive: true, force: true });
}
const configuredPortabilityTimeout = process.env.VALDRIS_PORTABILITY_TIMEOUT_MS;
const portabilityTimeoutMs =
  configuredPortabilityTimeout === undefined
    ? 600_000
    : Number(configuredPortabilityTimeout);
if (!Number.isFinite(portabilityTimeoutMs) || portabilityTimeoutMs <= 0) {
  throw new Error(
    "VALDRIS_PORTABILITY_TIMEOUT_MS must be a positive finite number",
  );
}
const checks = [
  ["process lifecycle", "verify-process-lifecycle.mjs", []],
  ["repository hygiene", "verify-repository-hygiene.mjs", []],
  ["bridge proxy", "verify-bridge-proxy.mjs", []],
  ["release privacy", "verify-release-artifact-privacy.mjs", []],
  ["portable review", "verify-portable-execution.mjs", []],
  [
    "transactional acceptance",
    "verify-commissioned-portability.mjs",
    ["--acceptance-only"],
  ],
];

const invalidTimeout = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "scripts", "verify-commissioned-portability.mjs"),
    "--acceptance-only",
  ],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      VALDRIS_PORTABILITY_TIMEOUT_MS: "not-a-finite-timeout",
    },
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  },
);
if (
  invalidTimeout.status === 0 ||
  !`${invalidTimeout.stdout || ""}\n${invalidTimeout.stderr || ""}`.includes(
    "must be a positive finite number",
  )
) {
  throw new Error(
    "commissioned portability did not reject an invalid wall-clock configuration safely",
  );
}

for (const [label, script, args] of checks) {
  const timeout =
    script === "verify-commissioned-portability.mjs"
      ? portabilityTimeoutMs + 30_000
      : 300_000;
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", script), ...args],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`
      .trim()
      .slice(-12_000);
    throw new Error(
      `${label} runtime-closure verification failed${result.error ? `: ${result.error.message}` : ""}${output ? `:\n${output}` : ""}`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: "runtime-closure",
      checks: checks.map(([label]) => label),
      guarantees: [
        "redirect-rejecting deadline-bounded credential proxy",
        "release assignment-secret detection",
        "malformed JSON review fail-closed",
        "detached transactional packet-closure acceptance",
        "confirmed child-process teardown and repository hygiene",
      ],
    },
    null,
    2,
  ),
);
