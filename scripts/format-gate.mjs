#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedGit } from "./bounded-git.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(repoRoot, args) {
  return runBoundedGit(repoRoot, args);
}

function assertDiffCheck(repoRoot, args, label) {
  const result = git(repoRoot, ["diff", "--check", ...args]);
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(
      `${label} failed${result.error ? `: ${result.error.message}` : ""}${output ? `:\n${output}` : ""}`,
    );
  }
}

const FORMATTED_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function changedRanges(repoRoot, baseRef) {
  const commands = [
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--unified=0",
      "--no-color",
      "--diff-filter=ACMR",
    ],
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--cached",
      "--unified=0",
      "--no-color",
      "--diff-filter=ACMR",
    ],
  ];
  if (baseRef && !/^0+$/.test(baseRef))
    commands.push([
      "-c",
      "core.quotePath=false",
      "diff",
      "--unified=0",
      "--no-color",
      "--diff-filter=ACMR",
      baseRef,
      "--",
    ]);
  const ranges = new Map();
  for (const args of commands) {
    const result = runBoundedGit(repoRoot, args);
    if (result.status !== 0)
      throw new Error(
        `unable to resolve changed files for formatting${result.error ? `: ${result.error.message}` : ""}`,
      );
    let relative = "";
    for (const line of String(result.stdout || "").split(/\r?\n/u)) {
      if (line.startsWith("+++ ")) {
        const candidate = line.slice(4);
        relative =
          candidate === "/dev/null" ? "" : candidate.replace(/^b\//u, "");
        continue;
      }
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u);
      if (!relative || !hunk) continue;
      const lineCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (
        lineCount === 0 ||
        !FORMATTED_EXTENSIONS.has(path.extname(relative).toLowerCase()) ||
        !existsSync(path.join(repoRoot, relative))
      )
        continue;
      const key = `${hunk[1]}:${lineCount}`;
      const fileRanges = ranges.get(relative) || new Map();
      fileRanges.set(key, { startLine: Number(hunk[1]), lineCount });
      ranges.set(relative, fileRanges);
    }
  }
  return new Map(
    [...ranges].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function enforceDeterministicFormatting(
  repoRoot,
  ranges,
  { write = false } = {},
) {
  if (ranges.size === 0) return;
  const prettier = path.join(
    ROOT,
    "node_modules",
    "prettier",
    "bin",
    "prettier.cjs",
  );
  if (!existsSync(prettier))
    throw new Error("pinned Prettier runtime is unavailable; run npm ci");
  for (const [relative, fileRanges] of ranges) {
    const orderedRanges = [...fileRanges.values()].sort((left, right) =>
      write
        ? right.startLine - left.startLine
        : left.startLine - right.startLine,
    );
    for (const { startLine, lineCount } of orderedRanges) {
      const content = readFileSync(path.join(repoRoot, relative), "utf8");
      const lineOffsets = [0];
      for (let index = 0; index < content.length; index += 1)
        if (content[index] === "\n") lineOffsets.push(index + 1);
      const rangeStart =
        lineOffsets[Math.max(0, startLine - 1)] ?? content.length;
      const endLineIndex = startLine - 1 + lineCount;
      const rangeEnd =
        endLineIndex < lineOffsets.length
          ? lineOffsets[endLineIndex]
          : content.length;
      const result = spawnSync(
        process.execPath,
        [
          prettier,
          write ? "--write" : "--check",
          "--range-start",
          String(rangeStart),
          "--range-end",
          String(rangeEnd),
          relative,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      if (result.status !== 0) {
        const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
        throw new Error(
          `deterministic formatting check failed for ${relative}${result.error ? `: ${result.error.message}` : ""}${output ? `:\n${output}` : ""}`,
        );
      }
    }
  }
}

export function assertRepositoryFormatting(
  repoRoot,
  { baseRef, write = false } = {},
) {
  assertDiffCheck(repoRoot, [], "working-tree whitespace check");
  assertDiffCheck(repoRoot, ["--cached"], "index whitespace check");

  const candidate = String(baseRef || "").trim();
  if (candidate && !/^0+$/.test(candidate)) {
    const resolved = git(repoRoot, [
      "rev-parse",
      "--verify",
      `${candidate}^{commit}`,
    ]);
    if (resolved.status !== 0)
      throw new Error("format comparison base is not an available commit");
    assertDiffCheck(
      repoRoot,
      [`${candidate}...HEAD`],
      "committed-change whitespace check",
    );
  }
  enforceDeterministicFormatting(repoRoot, changedRanges(repoRoot, candidate), {
    write,
  });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const write = process.argv.slice(2).includes("--write");
  if (process.argv.slice(2).some((argument) => argument !== "--write"))
    throw new Error("Usage: node scripts/format-gate.mjs [--write]");
  assertRepositoryFormatting(ROOT, {
    baseRef: process.env.VALDRIS_FORMAT_BASE_REF,
    write,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        gate: "format",
        mode: write ? "write" : "check",
        committedBaseChecked: Boolean(process.env.VALDRIS_FORMAT_BASE_REF),
      },
      null,
      2,
    ),
  );
}
