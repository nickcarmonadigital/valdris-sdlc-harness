#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(
    path.join(fixture, "fixture.mjs"),
    'export const first = { enabled: true };\n\n// stable separator 1\n// stable separator 2\n// stable separator 3\n\nexport const legacy={keep:true};\n\nexport const second = ["value"];\n',
    "utf8",
  );
  writeFileSync(
    path.join(fixture, "fixture.json"),
    '{\n  "enabled": true\n}\n',
    "utf8",
  );
  git(fixture, ["add", "proof.txt", "fixture.mjs", "fixture.json"]);
  git(fixture, ["commit", "--quiet", "-m", "fixture"]);
  const baseRef = runBoundedGit(fixture, ["rev-parse", "HEAD"]).stdout.trim();
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
    'export const first={enabled:false};\n\n// stable separator 1\n// stable separator 2\n// stable separator 3\n\nexport const legacy={keep:true};\n\nexport const second=["changed"];\n',
    "utf8",
  );
  rejects(
    () => assertRepositoryFormatting(fixture),
    "non-deterministically formatted source was accepted",
  );
  assertRepositoryFormatting(fixture, { write: true });
  assertRepositoryFormatting(fixture);
  git(fixture, ["add", "fixture.mjs"]);
  git(fixture, ["commit", "--quiet", "-m", "formatted changes"]);
  writeFileSync(
    path.join(fixture, "fixture.mjs"),
    `// live working-tree shift\n// preserves coherent base coordinates\n${readFileSync(path.join(fixture, "fixture.mjs"), "utf8")}`,
    "utf8",
  );
  assertRepositoryFormatting(fixture, { baseRef });

  writeFileSync(
    path.join(fixture, "fixture.json"),
    '{\n  "enabled": true\n}',
    "utf8",
  );
  rejects(
    () => assertRepositoryFormatting(fixture),
    "JSON without a final newline was accepted",
  );
  assertRepositoryFormatting(fixture, { write: true });
  if (!readFileSync(path.join(fixture, "fixture.json"), "utf8").endsWith("\n"))
    throw new Error("JSON formatter did not restore the final newline");
  assertRepositoryFormatting(fixture);

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
  JSON.stringify({ ok: true, gate: "repository-hygiene", cases: 9 }, null, 2),
);
