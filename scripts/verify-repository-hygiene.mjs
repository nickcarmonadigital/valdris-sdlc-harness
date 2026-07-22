#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCleanWorktree } from "./clean-worktree-gate.mjs";
import { assertRepositoryFormatting } from "./format-gate.mjs";
import { runBoundedGit } from "./bounded-git.mjs";

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`fixture git command failed: git ${args.join(" ")}`);
}

function rejects(action, message) {
  let rejected = false;
  try {
    action();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(message);
}

const fixture = mkdtempSync(
  path.join(os.tmpdir(), "valdris-repository-hygiene-"),
);
try {
  git(fixture, ["init", "--quiet"]);
  git(fixture, ["config", "user.email", "verifier@example.invalid"]);
  git(fixture, ["config", "user.name", "Valdris Verifier"]);
  writeFileSync(path.join(fixture, "proof.txt"), "clean\n", "utf8");
  git(fixture, ["add", "proof.txt"]);
  git(fixture, ["commit", "--quiet", "-m", "fixture"]);
  assertCleanWorktree(fixture);
  assertRepositoryFormatting(fixture);

  writeFileSync(
    path.join(fixture, "proof.txt"),
    "trailing whitespace   \n",
    "utf8",
  );
  rejects(() => assertCleanWorktree(fixture), "dirty worktree was accepted");
  rejects(
    () => assertRepositoryFormatting(fixture),
    "whitespace error was accepted",
  );

  writeFileSync(path.join(fixture, "proof.txt"), "clean\n", "utf8");
  writeFileSync(
    path.join(fixture, "fixture.mjs"),
    "export const fixture={enabled:true};\n",
    "utf8",
  );
  git(fixture, ["add", "fixture.mjs"]);
  rejects(
    () => assertRepositoryFormatting(fixture),
    "non-deterministically formatted source was accepted",
  );

  const started = Date.now();
  const stalled = runBoundedGit(fixture, [], {
    executable: process.execPath,
    prefixArgs: ["-e", "setTimeout(() => {}, 10000)"],
    timeoutMs: 25,
  });
  if (!stalled.error || Date.now() - started > 2_000)
    throw new Error(
      "stalled hygiene command was not terminated by its deadline",
    );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(
  JSON.stringify({ ok: true, gate: "repository-hygiene", cases: 6 }, null, 2),
);
