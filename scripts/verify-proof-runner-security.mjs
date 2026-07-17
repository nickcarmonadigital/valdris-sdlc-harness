#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROOF_RUNNER = path.join(SCRIPT_DIR, "proof-runner.mjs");

function run(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    shell: false,
    windowsHide: true,
  });
}

function git(root, ...args) {
  const result = run("git", ["-C", root, ...args], { cwd: root });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function runProof(root, args) {
  return run(process.execPath, [PROOF_RUNNER, "--repo", root, ...args], { cwd: root });
}

function windowsShortPath(target) {
  if (process.platform !== "win32") return null;
  const parent = path.dirname(target);
  const name = path.basename(target);
  const result = run(process.env.ComSpec || "cmd.exe", [
    "/d",
    "/c",
    `for %I in (${name}) do @echo %~sI`,
  ], { cwd: parent });
  assert.equal(result.status, 0, `could not resolve Windows 8.3 path:\n${result.stdout}\n${result.stderr}`);
  const shortPath = result.stdout.trim();
  if (!shortPath) return null;
  return path.isAbsolute(shortPath) ? shortPath : path.join(parent, shortPath);
}

function expectRejected(result, message) {
  assert.notEqual(result.status, 0, "adversarial proof request was unexpectedly accepted");
  assert.match(`${result.stdout}\n${result.stderr}`, message);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const root = mkdtempSync(path.join(os.tmpdir(), "valdris-proof-security-"));
try {
  writeFileSync(path.join(root, "README.md"), "# Proof runner security fixture\n", "utf8");
  writeFileSync(path.join(root, "carrier.txt"), "carrier\n", "utf8");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "proof-runner-security-fixture", version: "1.0.0", private: true }, null, 2), "utf8");
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "proof-runner@example.com");
  git(root, "config", "user.name", "Proof Runner Verifier");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  const head = git(root, "rev-parse", "HEAD");

  const shortRoot = windowsShortPath(root);
  if (shortRoot && path.resolve(shortRoot).toLowerCase() !== path.resolve(root).toLowerCase()) {
    const shortRootProof = runProof(shortRoot, [
      "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
      "--output", "proof/windows-short-root.json", "--", process.execPath, "-e", "process.exit(0)",
    ]);
    assert.equal(
      shortRootProof.status,
      0,
      `Windows 8.3 root ${JSON.stringify(shortRoot)} (exists=${existsSync(shortRoot)}) failed:\n${shortRootProof.stdout || ""}\n${shortRootProof.stderr || ""}\n${shortRootProof.error?.stack || shortRootProof.error || ""}`,
    );
  }

  mkdirSync(path.join(root, "nested"), { recursive: true });
  const nestedRoot = runProof(path.join(root, "nested"), [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/nested-root.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(nestedRoot, /Git worktree root/);

  const fakeCommit = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", "0".repeat(40), "--environment", "test",
    "--output", "proof/fake.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(fakeCommit, /--commit must exactly match Git HEAD/);
  assert.equal(existsSync(path.join(root, "proof", "fake.json")), false);

  const ads = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "carrier.txt:proof.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(ads, /alternate data streams|drive-relative/);
  assert.equal(existsSync(path.join(root, "carrier.txt:proof.json")), false);

  const deviceNamespace = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", String.raw`\\?\C:\proof.json`, "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(deviceNamespace, /device namespace/);

  const reserved = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/NUL.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(reserved, /reserved Windows device name/);

  const localHome = process.env.USERPROFILE || process.env.HOME;
  assert.ok(localHome, "security verifier requires USERPROFILE or HOME");
  const pathProofPath = path.join(root, "proof", "path-redaction.json");
  const pathProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/path-redaction.json", "--", process.execPath, "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1])", localHome,
  ]);
  assert.equal(pathProof.status, 0, `${pathProof.stdout}\n${pathProof.stderr}`);
  const pathDocument = readJson(pathProofPath);
  const pathSerialized = JSON.stringify(pathDocument);
  assert.equal(pathSerialized.includes(localHome), false, "proof persisted a raw local home path");
  assert.ok(pathSerialized.includes("[REDACTED]"), "proof omitted the local-path redaction marker");
  assert.equal(pathDocument.source.gitHead, head);
  assert.equal(pathDocument.source.stable, true);
  assert.match(pathDocument.source.validatorSha256, /^[a-f0-9]{64}$/);
  assert.equal(pathDocument.source.validatorSha256, createHash("sha256").update(readFileSync(PROOF_RUNNER)).digest("hex"));

  mkdirSync(path.join(root, "proof"), { recursive: true });
  const npmProofPath = path.join(root, "proof", "npm.json");
  const npmProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/npm.json", "--", "npm", "--version",
  ]);
  assert.equal(npmProof.status, 0, `${npmProof.stdout}\n${npmProof.stderr}`);
  const npmDocument = readJson(npmProofPath);
  assert.equal(npmDocument.outcome.status, "passed");
  assert.equal(npmDocument.execution.shell, false);
  assert.equal(npmDocument.command.resolution, process.platform === "win32" ? "windows-npm-cli" : "direct");
  if (process.platform === "win32") {
    assert.equal(path.basename(npmDocument.command.argv[0]).toLowerCase(), "node.exe");
    const npmCmdProof = runProof(root, [
      "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
      "--output", "proof/npm-cmd.json", "--", "npm.cmd", "--version",
    ]);
    assert.equal(npmCmdProof.status, 0, `${npmCmdProof.stdout}\n${npmCmdProof.stderr}`);
    assert.equal(readJson(path.join(root, "proof", "npm-cmd.json")).command.resolution, "windows-npm-cli");
  }

  console.log(JSON.stringify({
    ok: true,
    suite: "proof-runner-security",
    cases: ["Git-native worktree root", "fake Git revision", "NTFS ADS", "Windows device namespace", "reserved Windows device", "local path redaction", "npm shell-free resolution"],
    platform: process.platform,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
