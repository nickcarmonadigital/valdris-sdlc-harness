#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROOF_SCHEMA = "uash.proof.v1";

function parseArgs(argv) {
  const args = { out: "proof/proof.json", runId: process.env.RUN_ID || "local-proof", commands: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--command" || arg === "-c") args.commands.push(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/uash-write-proof.mjs --run-id RUN-123 --command "npm run typecheck" --command "npm run build" [--out proof/proof.json]

Writes a schema-validated ${PROOF_SCHEMA} artifact. Exits non-zero if any command fails.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.commands.length) throw new Error("At least one --command is required");
  return args;
}

function digest(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function tail(text, max = 6000) {
  return String(text || "").slice(-max);
}

function runShell(command) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (exitCode) => {
      const completedAt = new Date().toISOString();
      resolve({
        command,
        exitCode,
        startedAt,
        completedAt,
        outputDigest: digest(`${stdout}\n--- STDERR ---\n${stderr}`),
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      });
    });
  });
}

const args = parseArgs(process.argv.slice(2));
const commandResults = [];
for (const command of args.commands) {
  commandResults.push(await runShell(command));
}
const passed = commandResults.every((result) => result.exitCode === 0);
const proof = {
  schema: PROOF_SCHEMA,
  generatedAt: new Date().toISOString(),
  runId: args.runId,
  status: passed ? "passed" : "failed",
  summary: passed ? "All proof commands exited 0." : "One or more proof commands failed.",
  commands: commandResults,
};
const outputPath = path.resolve(args.out);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(proof, null, 2) + "\n", "utf8");
console.log(`Wrote ${PROOF_SCHEMA}: ${outputPath}`);
if (!passed) process.exit(1);
