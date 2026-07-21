#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["bridge proxy", "verify-bridge-proxy.mjs", []],
  ["release privacy", "verify-release-artifact-privacy.mjs", []],
  ["portable review", "verify-portable-execution.mjs", []],
  ["transactional acceptance", "verify-commissioned-portability.mjs", ["--acceptance-only"]],
];

for (const [label, script, args] of checks) {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-12_000);
    throw new Error(`${label} runtime-closure verification failed${result.error ? `: ${result.error.message}` : ""}${output ? `:\n${output}` : ""}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  gate: "runtime-closure",
  checks: checks.map(([label]) => label),
  guarantees: [
    "redirect-rejecting deadline-bounded credential proxy",
    "release assignment-secret detection",
    "malformed JSON review fail-closed",
    "detached transactional packet-closure acceptance",
  ],
}, null, 2));
