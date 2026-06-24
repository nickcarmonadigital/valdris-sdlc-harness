#!/usr/bin/env node
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { repo: process.cwd(), anchors: "design/anchors.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--anchors") args.anchors = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Design/code anchor gate\n\nUsage:\n  node scripts/anchor-gate.mjs --repo .\n\nVerifies design/anchors.json exists and every cited path is a real file inside the repo.\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeAnchors(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.anchors)) return payload.anchors;
  if (payload && typeof payload === "object") {
    return Object.values(payload).flatMap((value) => (Array.isArray(value) ? value : []));
  }
  return [];
}

function anchorPath(anchor) {
  if (typeof anchor === "string") return anchor;
  return anchor?.path || anchor?.file || anchor?.filepath || anchor?.target;
}

const args = parseArgs(process.argv.slice(2));
const repo = realpathSync(path.resolve(args.repo));
const anchorsPath = path.resolve(repo, args.anchors);
const problems = [];

if (!isInside(repo, anchorsPath)) problems.push(`anchors path escapes repo: ${args.anchors}`);
else if (!existsSync(anchorsPath)) problems.push(`anchors artifact missing: ${args.anchors}`);

let anchors = [];
if (!problems.length) {
  const realAnchors = realpathSync(anchorsPath);
  if (!isInside(repo, realAnchors)) problems.push(`anchors real path escapes repo: ${args.anchors}`);
  else {
    const payload = JSON.parse(await readFile(realAnchors, "utf8"));
    anchors = normalizeAnchors(payload);
    if (!anchors.length) problems.push("anchors artifact contains no anchors");
  }
}

for (const [index, anchor] of anchors.entries()) {
  const cited = anchorPath(anchor);
  if (!cited) {
    problems.push(`anchor ${index} has no path/file`);
    continue;
  }
  const target = path.resolve(repo, cited);
  if (!isInside(repo, target)) {
    problems.push(`anchor ${index} escapes repo: ${cited}`);
    continue;
  }
  if (!existsSync(target)) {
    problems.push(`anchor ${index} target missing: ${cited}`);
    continue;
  }
  const lstat = lstatSync(target);
  if (lstat.isSymbolicLink()) {
    problems.push(`anchor ${index} target is symlink: ${cited}`);
    continue;
  }
  const realTarget = realpathSync(target);
  if (!isInside(repo, realTarget)) problems.push(`anchor ${index} real path escapes repo: ${cited}`);
  else if (!statSync(realTarget).isFile()) problems.push(`anchor ${index} target is not a file: ${cited}`);
}

if (problems.length) {
  console.error(JSON.stringify({ ok: false, problems, anchors: args.anchors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, anchors: args.anchors, anchorCount: anchors.length }, null, 2));
