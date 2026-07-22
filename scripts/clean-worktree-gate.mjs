#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedGit } from "./bounded-git.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assertCleanWorktree(repoRoot) {
  const result = runBoundedGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (result.status !== 0)
    throw new Error(
      `unable to inspect repository worktree state${result.error ? `: ${result.error.message}` : ""}`,
    );
  const entries = String(result.stdout || "")
    .split(/\r?\n/u)
    .filter(Boolean);
  if (entries.length > 0)
    throw new Error(
      `repository worktree is not clean (${entries.length} changed path${entries.length === 1 ? "" : "s"})`,
    );
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  assertCleanWorktree(ROOT);
  console.log(JSON.stringify({ ok: true, gate: "clean-worktree" }, null, 2));
}
