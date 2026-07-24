#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(SCRIPT_DIR, script), ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited ${code}`));
    });
  });
}

const args = process.argv.slice(2);
function filterArgs(argv, allowedWithValue, allowedFlags = new Set()) {
  const filtered = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (allowedWithValue.has(arg)) {
      filtered.push(arg, argv[++i]);
    } else if (allowedFlags.has(arg)) {
      filtered.push(arg);
    } else if (
      arg.startsWith("--") &&
      i + 1 < argv.length &&
      !argv[i + 1].startsWith("--")
    ) {
      i += 1;
    }
  }
  return filtered;
}

await run("code-intelligence-gate.mjs", args);
await run(
  "anchor-gate.mjs",
  filterArgs(args, new Set(["--repo", "--anchors"])),
);
