#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privacyGate = path.join(root, "scripts", "privacy-gate.mjs");
const fixtureRoot = mkdtempSync(
  path.join(os.homedir(), ".valdris-privacy-boundary-"),
);
const sourceRepo = path.join(fixtureRoot, "source");
const scanRoot = path.join(fixtureRoot, "scan");
const staleWorktree = path.join(scanRoot, "aaa-stale-worktree");
const nestedWorktree = path.join(scanRoot, "nested-worktree");

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
}

function write(target, content) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function runGate(...includes) {
  const args = [privacyGate, "--repo", scanRoot];
  for (const include of includes) args.push("--include", include);
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    killSignal: "SIGTERM",
  });
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}

function secretFixture() {
  return ["token", "=", "gh", "p_", "A".repeat(40), "\n"].join("");
}

try {
  mkdirSync(sourceRepo, { recursive: true });
  mkdirSync(scanRoot, { recursive: true });
  write(path.join(sourceRepo, "README.md"), "# Privacy fixture\n");
  git(sourceRepo, ["init", "--quiet"]);
  git(sourceRepo, ["config", "user.email", "privacy-test@example.invalid"]);
  git(sourceRepo, ["config", "user.name", "Privacy Test"]);
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["commit", "--quiet", "-m", "fixture"]);
  git(sourceRepo, ["worktree", "add", "--quiet", staleWorktree, "HEAD"]);
  rmSync(staleWorktree, { recursive: true, force: true });
  git(sourceRepo, ["worktree", "add", "--quiet", nestedWorktree, "HEAD"]);

  const nestedPointer = readFileSync(path.join(nestedWorktree, ".git"), "utf8");
  assert.match(nestedPointer, /^gitdir: /);
  write(
    path.join(scanRoot, "manual-nested", ".git", "objects", "leak.txt"),
    secretFixture(),
  );
  write(path.join(scanRoot, "README.md"), "# Clean scan root\n");

  let result = runGate();
  assert.equal(
    result.status,
    0,
    `verified nested Git metadata must be excluded: ${output(result)}`,
  );

  const priorGitDir = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(scanRoot, "ambient-redirection.git");
  try {
    result = runGate();
    assert.equal(
      result.status,
      0,
      `ambient GIT_DIR must not redirect privacy traversal:\n${output(result)}`,
    );
  } finally {
    if (priorGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDir;
  }

  result = runGate("manual-nested/.git");
  assert.equal(
    result.status,
    0,
    `a directly included .git directory must be excluded: ${output(result)}`,
  );
  result = runGate("nested-worktree/.git");
  assert.equal(
    result.status,
    0,
    `a directly included registered-worktree pointer must be excluded: ${output(result)}`,
  );

  write(
    path.join(scanRoot, "unregistered-valid-pointer", ".git"),
    `gitdir: ${path.join(sourceRepo, ".git")}\n`,
  );
  result = runGate();
  assert.notEqual(
    result.status,
    0,
    "a .git file that points to another valid repository must remain scannable",
  );
  let parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.findings.some(
      (finding) =>
        finding.path === "unregistered-valid-pointer/.git" &&
        finding.category === "local-user-path",
    ),
    `unregistered valid .git pointer failed for the wrong reason: ${output(result)}`,
  );
  rmSync(path.join(scanRoot, "unregistered-valid-pointer"), {
    recursive: true,
    force: true,
  });

  write(
    path.join(staleWorktree, ".git"),
    `gitdir: ${path.join(sourceRepo, ".git")}\n`,
  );
  result = runGate();
  assert.notEqual(
    result.status,
    0,
    "a stale worktree registration must not authorize a pointer to different Git metadata",
  );
  parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.findings.some(
      (finding) =>
        finding.path === "aaa-stale-worktree/.git" &&
        finding.category === "local-user-path",
    ),
    `stale worktree pointer failed for the wrong reason: ${output(result)}`,
  );
  rmSync(staleWorktree, { recursive: true, force: true });

  write(
    path.join(scanRoot, "arbitrary", ".git"),
    `gitdir: ${path.join(os.homedir(), "missing-private-gitdir")}\n`,
  );
  result = runGate();
  assert.notEqual(
    result.status,
    0,
    "an arbitrary .git file with an unverified private path must remain scannable",
  );
  parsed = JSON.parse(result.stdout);
  assert.ok(
    parsed.findings.some(
      (finding) =>
        finding.path === "arbitrary/.git" &&
        finding.category === "local-user-path",
    ),
    `unverified .git pointer failed for the wrong reason: ${output(result)}`,
  );

  console.log(
    "Privacy boundary verifier passed (nested metadata excluded at traversal and include roots; only registered worktree pointers excluded).",
  );
} finally {
  spawnSync(
    "git",
    ["-C", sourceRepo, "worktree", "remove", "--force", nestedWorktree],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  spawnSync("git", ["-C", sourceRepo, "worktree", "prune", "--expire", "now"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  rmSync(fixtureRoot, { recursive: true, force: true });
}
