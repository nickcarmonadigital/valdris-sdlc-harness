#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".swift"]);
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".vercel", "out", ".turbo", ".cache", "runs"]);
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function parseArgs(argv) {
  const args = { repo: process.cwd(), graph: "graph/graph.json", freshness: "graph/freshness.json", anchors: "design/anchors.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--graph") args.graph = argv[++i];
    else if (arg === "--freshness") args.freshness = argv[++i];
    else if (arg === "--anchors") args.anchors = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Graphify-compatible local code graph scan\n\nUsage:\n  node scripts/graphify-scan.mjs --repo .\n\nOptions:\n  --repo <path>       Repo root. Defaults to cwd.\n  --graph <path>      Graph artifact path relative to repo. Defaults to graph/graph.json.\n  --freshness <path>  Freshness artifact path relative to repo. Defaults to graph/freshness.json.\n  --anchors <path>    Design anchors artifact path relative to repo. Defaults to design/anchors.json.\n`);
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

function walk(repo, dir = repo, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && ![".github"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(repo, full, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.relative(repo, full).split(path.sep).join("/"));
    }
  }
  return out;
}

function classify(file) {
  const ext = path.extname(file);
  if ([".tsx", ".jsx"].includes(ext)) return "ui-component";
  if ([".ts", ".js", ".mjs", ".cjs"].includes(ext)) return "javascript-module";
  if (ext === ".py") return "python-module";
  return "source-file";
}

function extractDependencies(file, content) {
  const deps = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
    /require\(["']([^"']+)["']\)/g,
    /import\(["']([^"']+)["']\)/g,
    /^\s*from\s+([\w.]+)\s+import\s+/gm,
    /^\s*import\s+([\w.]+)/gm,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) deps.add(match[1]);
  }
  return [...deps].filter(Boolean);
}

function resolveDependency(repo, fromFile, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  const fromDir = path.dirname(path.join(repo, fromFile));
  const base = path.resolve(fromDir, specifier);
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (!isInside(repo, candidate)) continue;
    const relative = path.relative(repo, candidate).split(path.sep).join("/");
    if (knownFiles.has(relative)) return relative;
  }
  return null;
}

function publicEntrypointScore(file) {
  let score = 0;
  if (/^(app|pages|src\/app|src\/pages)\//.test(file)) score += 5;
  if (/route\.(ts|js)$/.test(file)) score += 5;
  if (/page\.(tsx|jsx|ts|js)$/.test(file)) score += 4;
  if (/layout\.(tsx|jsx|ts|js)$/.test(file)) score += 3;
  if (/^(api|server|src\/server)\//.test(file)) score += 4;
  if (/^(components|src\/components)\//.test(file)) score += 2;
  return score;
}

function writeJson(repo, relativePath, payload) {
  const target = path.resolve(repo, relativePath);
  if (!isInside(repo, target)) throw new Error(`output path escapes repo: ${relativePath}`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const repo = realpathSync(path.resolve(args.repo));
const files = walk(repo);
const knownFiles = new Set(files);
const nodes = [];
const edges = [];

for (const file of files) {
  const full = path.join(repo, file);
  const content = readFileSync(full, "utf8");
  const stats = statSync(full);
  const dependencies = extractDependencies(file, content);
  nodes.push({
    id: file,
    path: file,
    kind: classify(file),
    lines: content.split(/\r?\n/).length,
    bytes: stats.size,
    imports: dependencies.length,
    entrypointScore: publicEntrypointScore(file),
  });
  for (const specifier of dependencies) {
    const target = resolveDependency(repo, file, specifier, knownFiles);
    if (target) edges.push({ from: file, to: target, kind: "imports", specifier });
  }
}

const commit = runGit(repo, ["rev-parse", "HEAD"]);
const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
const dirtyFiles = runGit(repo, ["status", "--short"], "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const generatedAt = new Date().toISOString();
const entrypoints = [...nodes]
  .filter((node) => node.entrypointScore > 0)
  .sort((a, b) => b.entrypointScore - a.entrypointScore || a.path.localeCompare(b.path))
  .slice(0, 25)
  .map((node) => node.path);

const graph = {
  schema: "uash.graphify.compat.v0.1",
  generator: "local-static-code-graph",
  graphifyCompatible: true,
  generatedAt,
  repoRoot: repo,
  git: { commit, branch, dirty: dirtyFiles.length > 0, dirtyFiles },
  summary: {
    nodes: nodes.length,
    edges: edges.length,
    entrypoints: entrypoints.length,
    note: "Local Graphify-compatible code graph. Replace generator with external Graphify when configured; never claim external Graphify ran unless it did.",
  },
  nodes,
  edges,
  entrypoints,
};

const freshness = {
  schema: "uash.graph-freshness.v0.1",
  generatedAt,
  graphPath: args.graph,
  generator: graph.generator,
  graphifyCompatible: true,
  git: graph.git,
  nodeCount: nodes.length,
  edgeCount: edges.length,
  validForCommit: commit,
  staleWhen: "git HEAD changes, cited files change, or task scope expands to uncrawled code",
};

const anchorFiles = (entrypoints.length ? entrypoints : nodes.map((node) => node.path).sort()).slice(0, 12);

const anchors = {
  schema: "uash.design-anchors.v0.1",
  generatedAt,
  source: args.graph,
  policy: "Agents must cite current files/symbols before architecture, refactor, bug-path, or cross-file implementation claims.",
  anchors: anchorFiles.map((file) => ({ path: file, kind: classify(file), reason: entrypoints.includes(file) ? "high-signal entrypoint from code graph scan" : "source file from code graph scan" })),
};

writeJson(repo, args.graph, graph);
writeJson(repo, args.freshness, freshness);
writeJson(repo, args.anchors, anchors);

console.log(JSON.stringify({ ok: true, graph: args.graph, freshness: args.freshness, anchors: args.anchors, nodes: nodes.length, edges: edges.length, entrypoints: entrypoints.length, commit, dirty: dirtyFiles.length > 0 }, null, 2));
