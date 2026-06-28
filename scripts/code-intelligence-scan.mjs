#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVIDENCE = "graph/gitnexus.json";
const GITNEXUS_PACKAGE = "gitnexus@latest";
const GITNEXUS_REPO = "https://github.com/abhigyanpatwari/GitNexus";
const GITNEXUS_LICENSE = "PolyForm-Noncommercial-1.0.0";

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    provider: process.env.UASH_CODE_GRAPH_PROVIDER || "gitnexus",
    fallback: process.env.UASH_CODE_GRAPH_FALLBACK || "local",
    graph: "graph/graph.json",
    freshness: "graph/freshness.json",
    anchors: "design/anchors.json",
    evidence: DEFAULT_EVIDENCE,
    name: "",
    workerTimeout: "60",
    force: true,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--provider") args.provider = argv[++i];
    else if (arg === "--fallback") args.fallback = argv[++i];
    else if (arg === "--graph") args.graph = argv[++i];
    else if (arg === "--freshness") args.freshness = argv[++i];
    else if (arg === "--anchors") args.anchors = argv[++i];
    else if (arg === "--evidence") args.evidence = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--worker-timeout") args.workerTimeout = argv[++i];
    else if (arg === "--no-force") args.force = false;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`GitNexus-backed code-intelligence scan\n\nUsage:\n  node scripts/code-intelligence-scan.mjs --repo .\n\nDefault behavior uses GitNexus in index-only mode, writes graph/gitnexus.json as evidence, then emits the stable harness artifacts graph/graph.json, graph/freshness.json, and design/anchors.json. If GitNexus is unavailable and --fallback local is set, the script falls back to the local static graph and records the fallback in stdout.\n\nOptions:\n  --provider <gitnexus|local>  Backend to run. Defaults to gitnexus.\n  --fallback <local|none>      Fallback if GitNexus fails. Defaults to local.\n  --strict                     Fail instead of falling back when GitNexus fails.\n  --name <alias>               GitNexus registry alias. Defaults to repo basename + current path hash.\n  --worker-timeout <seconds>   GitNexus worker timeout. Defaults to 60.\n  --no-force                   Do not pass --force to GitNexus analyze.\n  --graph <path>               Stable graph artifact path. Defaults to graph/graph.json.\n  --freshness <path>           Freshness artifact path. Defaults to graph/freshness.json.\n  --anchors <path>             Design anchors path. Defaults to design/anchors.json.\n  --evidence <path>            GitNexus evidence artifact path. Defaults to graph/gitnexus.json.\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["gitnexus", "local"].includes(args.provider)) throw new Error(`Unsupported provider: ${args.provider}`);
  if (!["local", "none"].includes(args.fallback)) throw new Error(`Unsupported fallback: ${args.fallback}`);
  return args;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeAlias(repo) {
  const base = path.basename(repo).replace(/[^A-Za-z0-9_.-]/g, "-") || "repo";
  let hash = 0;
  for (const char of repo) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${base}-${hash.toString(16)}`;
}

function truncate(text, limit = 12000) {
  const value = String(text || "");
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]` : value;
}

function writeJsonInside(repo, relativePath, payload) {
  const target = path.resolve(repo, relativePath);
  if (!isInside(repo, target)) throw new Error(`output path escapes repo: ${relativePath}`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function run(command, commandArgs, options = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    command,
    args: commandArgs,
    startedAt,
    durationMs: Date.now() - started,
    exitCode: typeof result.status === "number" ? result.status : result.error ? 1 : 0,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr || result.error?.message || ""),
  };
}

function runGitNexus(repo, args) {
  const name = args.name || safeAlias(repo);
  const env = {
    ...process.env,
    GITNEXUS_SKIP_OPTIONAL_GRAMMARS: process.env.GITNEXUS_SKIP_OPTIONAL_GRAMMARS || "1",
  };
  const analyzeArgs = ["-y", GITNEXUS_PACKAGE, "analyze", repo, "--index-only", "--name", name, "--worker-timeout", String(args.workerTimeout)];
  if (args.force) analyzeArgs.push("--force");
  const analyze = run("npx", analyzeArgs, { cwd: repo, env });
  const status = analyze.exitCode === 0 ? run("npx", ["-y", GITNEXUS_PACKAGE, "status"], { cwd: repo, env }) : null;
  const evidence = {
    schema: "uash.gitnexus.evidence.v0.1",
    ok: analyze.exitCode === 0,
    generatedAt: new Date().toISOString(),
    provider: "GitNexus",
    package: GITNEXUS_PACKAGE,
    sourceRepo: GITNEXUS_REPO,
    license: GITNEXUS_LICENSE,
    licenseBoundary: "GitNexus is invoked as an external CLI in index-only mode; this repo does not vendor or redistribute GitNexus code.",
    repoRoot: repo,
    indexName: name,
    indexOnly: true,
    commands: {
      analyze,
      status,
    },
  };
  writeJsonInside(repo, args.evidence, evidence);
  return evidence;
}

function runLocalGraph(repo, args, provider, evidence) {
  const graphifyScript = path.join(SCRIPT_DIR, "graphify-scan.mjs");
  if (!existsSync(graphifyScript)) throw new Error(`Missing graphify-scan.mjs next to ${fileURLToPath(import.meta.url)}`);
  const graphifyArgs = [
    graphifyScript,
    "--repo",
    repo,
    "--graph",
    args.graph,
    "--freshness",
    args.freshness,
    "--anchors",
    args.anchors,
    "--backend-provider",
    provider,
  ];
  if (evidence?.ok) {
    graphifyArgs.push("--backend-evidence", args.evidence, "--backend-index-name", evidence.indexName);
  }
  const result = run(process.execPath, graphifyArgs, { cwd: repo, env: process.env });
  if (result.exitCode !== 0) {
    throw new Error(`graphify-scan failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const repo = realpathSync(path.resolve(args.repo));
let evidence = null;
let providerUsed = "local-static-code-graph";
let warning = null;

if (args.provider === "gitnexus") {
  evidence = runGitNexus(repo, args);
  if (evidence.ok) {
    providerUsed = "gitnexus";
  } else if (args.strict || args.fallback === "none") {
    console.error(JSON.stringify({ ok: false, providerRequested: args.provider, providerUsed: null, evidence: args.evidence, problems: ["GitNexus indexing failed and fallback is disabled"], gitnexusExitCode: evidence.commands.analyze.exitCode }, null, 2));
    process.exit(1);
  } else {
    warning = "GitNexus indexing failed; fell back to local static code graph. Do not claim GitNexus ran for this scan.";
  }
}

const graphify = runLocalGraph(repo, args, providerUsed, evidence);

console.log(JSON.stringify({
  ok: true,
  providerRequested: args.provider,
  providerUsed,
  fallback: warning,
  graph: args.graph,
  freshness: args.freshness,
  anchors: args.anchors,
  gitnexusEvidence: evidence ? args.evidence : null,
  gitnexusOk: evidence ? evidence.ok : false,
  graphify: {
    exitCode: graphify.exitCode,
    stdout: graphify.stdout,
    stderr: graphify.stderr,
  },
}, null, 2));
