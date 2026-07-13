#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateGoalDocument } from "./goal-gate.mjs";

function parseArgs(argv) {
  const args = { repo: process.cwd(), file: "goal/goal.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--file") args.file = argv[++index];
    else if (arg === "--expected-revision") args.expectedRevision = Number(argv[++index]);
    else if (arg === "--checkpoint") args.checkpoint = argv[++index];
    else if (arg === "--checkpoint-status") args.checkpointStatus = argv[++index];
    else if (arg === "--summary") args.summary = argv[++index];
    else if (arg === "--condition") args.condition = argv[++index];
    else if (arg === "--condition-status") args.conditionStatus = argv[++index];
    else if (arg === "--evidence-file") args.evidenceFile = argv[++index];
    else if (arg === "--goal-status") args.goalStatus = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function atomicWrite(file, document) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/goal-transition.mjs --repo . --expected-revision N [--checkpoint id --checkpoint-status progress --summary text] [--condition id --condition-status passed --evidence-file evidence.json] [--goal-status completed]");
  if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1) throw new Error("--expected-revision must be a positive integer");
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) throw new Error(`goal file missing: ${args.file}`);
  const lockPath = `${target}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, "wx");
    writeFileSync(lock, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), expectedRevision: args.expectedRevision })}\n`);
  } catch (error) {
    if (lock !== undefined) closeSync(lock);
    throw new Error(`goal transition locked by another writer: ${error.message}`);
  }
  try {
    const goal = JSON.parse(readFileSync(target, "utf8"));
    if (goal.revision !== args.expectedRevision) throw new Error(`goal revision conflict: expected ${args.expectedRevision}, current ${goal.revision}`);
    const now = new Date().toISOString();

  if (args.checkpoint) {
    if (!new Set(["started", "progress", "passed", "failed", "blocked"]).has(args.checkpointStatus)) throw new Error("--checkpoint-status is invalid");
    if (!args.summary?.trim()) throw new Error("--summary is required for a checkpoint transition");
    const checkpoint = goal.checkpoints.find((item) => item.id === args.checkpoint);
    if (checkpoint) Object.assign(checkpoint, { status: args.checkpointStatus, recordedAt: now, summary: args.summary.trim() });
    else goal.checkpoints.push({ id: args.checkpoint, status: args.checkpointStatus, recordedAt: now, summary: args.summary.trim() });
  }

  if (args.condition) {
    if (!new Set(["pending", "passed", "failed", "blocked"]).has(args.conditionStatus)) throw new Error("--condition-status is invalid");
    const condition = goal.stoppingConditions.find((item) => item.id === args.condition);
    if (!condition) throw new Error(`unknown stopping condition: ${args.condition}`);
    condition.status = args.conditionStatus;
    if (args.conditionStatus === "passed") {
      if (!args.evidenceFile) throw new Error("--evidence-file is required when passing a stopping condition");
      const evidence = JSON.parse(readFileSync(path.resolve(args.evidenceFile), "utf8"));
      if (!Array.isArray(evidence) || evidence.length === 0) throw new Error("evidence file must contain a non-empty JSON array");
      condition.evidence = evidence;
    } else delete condition.evidence;
  }

  if (args.goalStatus) goal.status = args.goalStatus;
  if (!args.checkpoint && !args.condition && !args.goalStatus) throw new Error("at least one transition is required");
  goal.revision += 1;
  goal.generatedAt = now;
  goal.updatedAt = now;
  const validation = validateGoalDocument(goal, { repoRoot, requireComplete: goal.status === "completed" });
  if (!validation.valid) throw new Error(`goal transition rejected: ${validation.problems.join("; ")}`);
    atomicWrite(target, goal);
    console.log(JSON.stringify({ ok: true, goalId: goal.goalId, previousRevision: args.expectedRevision, revision: goal.revision, status: goal.status, checkpoint: args.checkpoint, condition: args.condition }, null, 2));
  } finally {
    closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

try { main(); } catch (error) { console.error(error.message); process.exit(1); }
