#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = { repo: process.cwd(), graph: "graph/graph.json", freshness: "graph/freshness.json", allowStale: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--graph") args.graph = argv[++i];
    else if (arg === "--freshness") args.freshness = argv[++i];
    else if (arg === "--allow-stale") args.allowStale = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Code-intelligence graph freshness gate\n\nUsage:\n  node scripts/graphify-gate.mjs --repo .\n\nFails when graph artifacts are missing, malformed, empty, generated for a different git HEAD, or GitNexus-backed artifacts are missing GitNexus evidence.\nUse --allow-stale only for historical replay mode.\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function runGit(repo, args, fallback = "unknown") {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readJsonInside(repo, relativePath, label) {
  const target = path.resolve(repo, relativePath);
  if (!isInside(repo, target)) throw new Error(`${label} path escapes repo: ${relativePath}`);
  if (!existsSync(target)) throw new Error(`${label} missing: ${relativePath}`);
  const real = realpathSync(target);
  if (!isInside(repo, real)) throw new Error(`${label} real path escapes repo: ${relativePath}`);
  const stat = statSync(real);
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${relativePath}`);
  return JSON.parse(await readFile(real, "utf8"));
}

const args = parseArgs(process.argv.slice(2));
const repo = realpathSync(path.resolve(args.repo));
const graph = await readJsonInside(repo, args.graph, "graph artifact");
const freshness = await readJsonInside(repo, args.freshness, "freshness artifact");
const problems = [];

if (graph.schema !== "uash.graphify.compat.v0.1") problems.push(`unexpected graph schema: ${graph.schema}`);
if (!graph.graphifyCompatible) problems.push("graph artifact does not declare graphifyCompatible=true");
if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) problems.push("graph contains no nodes");
if (!Array.isArray(graph.edges)) problems.push("graph edges must be an array");
if (freshness.schema !== "uash.graph-freshness.v0.1") problems.push(`unexpected freshness schema: ${freshness.schema}`);
if (freshness.graphPath !== args.graph) problems.push(`freshness graphPath mismatch: ${freshness.graphPath}`);

const backend = graph.codeIntelligence?.provider || freshness.codeIntelligence?.provider;
if (backend === "gitnexus") {
  const evidenceArtifact = graph.codeIntelligence?.evidenceArtifact || freshness.codeIntelligence?.evidenceArtifact;
  if (!evidenceArtifact) {
    problems.push("GitNexus-backed graph is missing codeIntelligence.evidenceArtifact");
  } else {
    try {
      const evidence = await readJsonInside(repo, evidenceArtifact, "GitNexus evidence artifact");
      if (evidence.schema !== "uash.gitnexus.evidence.v0.1") problems.push(`unexpected GitNexus evidence schema: ${evidence.schema}`);
      if (evidence.provider !== "GitNexus") problems.push(`unexpected GitNexus evidence provider: ${evidence.provider}`);
      if (!evidence.ok) problems.push("GitNexus evidence artifact does not declare ok=true");
    } catch (error) {
      problems.push(error.message);
    }
  }
}

const currentCommit = runGit(repo, ["rev-parse", "HEAD"]);
const graphCommit = graph.git?.commit || freshness.git?.commit || freshness.validForCommit;
if (!args.allowStale && currentCommit !== "unknown" && graphCommit !== currentCommit) {
  problems.push(`stale graph: graph commit ${graphCommit || "unknown"} does not match current HEAD ${currentCommit}`);
}

if (problems.length) {
  console.error(JSON.stringify({ ok: false, problems, graph: args.graph, freshness: args.freshness }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, graph: args.graph, freshness: args.freshness, nodes: graph.nodes.length, edges: graph.edges.length, commit: graphCommit, dirty: Boolean(graph.git?.dirty) }, null, 2));
