#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existingFileWithinRepo } from "./control-gate-lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_MAX_AGE_HOURS = { prototype: 720, production: 168, enterprise: 72, regulated: 24 };
const GATES = [
  ["intake", "intake-gate.mjs"],
  ["route", "route-gate.mjs"],
  ["code-intelligence", "code-intelligence-gate-all.mjs"],
  ["skill-registry", "skill-registry-gate.mjs"],
  ["goal", "goal-gate.mjs"],
  ["context", "context-manifest-gate.mjs"],
  ["production", "production-layer-gate.mjs"],
  ["ai-assurance", "ai-assurance-gate.mjs"],
  ["domain-assurance", "domain-assurance-gate.mjs"],
  ["eval", "eval-gate.mjs"],
  ["trajectory", "trajectory-gate.mjs"],
  ["smoke", "smoke-gate.mjs"],
  ["waivers", "waiver-gate.mjs"],
];

function parseArgs(argv) {
  const args = { repo: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function crossArtifactProblems(repoRoot) {
  const load = (relative) => {
    const target = path.join(repoRoot, relative);
    if (!existingFileWithinRepo(repoRoot, target)) throw new Error(`${relative} must be a real non-symlink file inside the repository`);
    return JSON.parse(readFileSync(target, "utf8"));
  };
  const goal = load("goal/goal.json");
  const routeDocument = load("run/route.json");
  const productionRequired = routeDocument.gateApplicability?.production?.status === "required";
  const smokeRequired = routeDocument.gateApplicability?.smoke?.status === "required";
  const artifacts = [
    ["intake", load("run/intake.json"), "runId"],
    ["route", routeDocument, "runId"],
    ["context", load("context/manifest.json"), "runId"],
    ["AI", load("ai/assurance.json"), "runId"],
    ["domain", load("domain/assurance.json"), "runId"],
    ["eval", load("evals/results.json"), "runId"],
    ["trajectory", load("trajectory/trajectory.json"), "goalId"],
    ["waivers", load("waivers/waivers.json"), "runId"],
  ];
  if (productionRequired) artifacts.push(["production", load("production/layer-assessment.json"), "runId"]);
  if (smokeRequired) artifacts.push(["smoke", load("smoke/smoke_proof.json"), "runId"]);
  const problems = [];
  for (const [name, artifact, idField] of artifacts) {
    if (artifact[idField] !== goal.goalId) problems.push(`${name}.${idField} must match goal.goalId`);
    if (artifact.profile !== goal.profile) problems.push(`${name}.profile must match goal.profile`);
    if (artifact.commit !== goal.commit) problems.push(`${name}.commit must match goal.commit`);
    if (artifact.environment !== goal.environment) problems.push(`${name}.environment must match goal.environment`);
    const timestamp = artifact.generatedAt || artifact.receivedAt;
    if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
      const ageMs = Date.now() - Date.parse(timestamp);
      if (ageMs < -5 * 60 * 1000) problems.push(`${name} timestamp is in the future`);
      if (ageMs > (PROFILE_MAX_AGE_HOURS[goal.profile] || 168) * 60 * 60 * 1000) problems.push(`${name} is outside the current ${goal.profile} freshness window`);
    }
  }
  const route = artifacts.find(([name]) => name === "route")[1];
  const intake = artifacts.find(([name]) => name === "intake")[1];
  const ai = artifacts.find(([name]) => name === "AI")[1];
  const domain = artifacts.find(([name]) => name === "domain")[1];
  if (route.ai?.workloadDetected !== ai.workloadDetected || route.ai?.aiProfile !== ai.aiProfile) problems.push("route AI classification must match AI assurance");
  for (const feature of ["rag", "tools", "memory", "consequential", "userFacing", "sensitiveData", "autonomous"]) {
    if (route.ai?.features?.[feature] !== ai.features?.[feature]) problems.push(`route AI feature ${feature} must match AI assurance`);
  }
  if (intake.runId !== route.runId) problems.push("intake.runId must match route.runId");
  if (goal.objective !== intake.requestText || goal.requestSha256 !== intake.requestSha256) problems.push("goal objective/requestSha256 must remain bound to the authorized intake request");
  if (goal.initialRouteSha256 !== sha256JsonFile(path.join(repoRoot, "run", "route.json"))) problems.push("current route must match goal.initialRouteSha256; start a reviewed new run to change the initial route");
  const routedPacks = [...(route.domainPacks || [])].sort();
  const activePacks = [...(domain.packs || [])].map((pack) => pack.id).sort();
  if (JSON.stringify(routedPacks) !== JSON.stringify(activePacks)) problems.push("route domainPacks must match domain assurance packs");
  const mobilePack = (domain.packs || []).find((pack) => pack.id === "mobile-ios");
  if (mobilePack) {
    if (route.mobileIos?.status !== "commissioned") problems.push("mobile-ios completion requires commissioned Apple identity in the route");
    for (const field of ["scheme", "bundleAndTeam", "commissioningSha256"]) if (mobilePack.identity?.[field] !== route.mobileIos?.[field]) problems.push(`mobile-ios domain identity.${field} must match the commissioned route`);
    if (route.gateApplicability?.smoke?.status === "required") {
      const smoke = artifacts.find(([name]) => name === "smoke")?.[1];
      if (["testflight", "app-store"].includes(smoke?.target?.kind)) {
        if (smoke.target.identifier !== mobilePack.identity?.buildId) problems.push("Apple smoke target.identifier must match mobile-ios identity.buildId");
        for (const field of ["scheme", "bundleAndTeam", "commissioningSha256"]) if (smoke.target?.[field] !== mobilePack.identity?.[field]) problems.push(`Apple smoke target.${field} must match mobile-ios domain identity`);
      }
    }
  }
  const evals = artifacts.find(([name]) => name === "eval")[1];
  const trajectory = artifacts.find(([name]) => name === "trajectory")[1];
  for (const field of ["attempts", "toolCalls", "tokens", "costUsd", "wallClockMinutes"]) if (goal.budgets?.[field] !== trajectory.budget?.limits?.[field]) problems.push(`trajectory budget.limits.${field} must match goal.budgets.${field}`);
  if (route.gateApplicability?.eval?.status === "required" && evals.status !== "passed") problems.push("route-required eval cannot be skipped");
  if (route.gateApplicability?.eval?.status === "not-applicable" && evals.status !== "skipped") problems.push("route must mark eval required when eval suites are supplied");
  if (productionRequired) {
    const production = artifacts.find(([name]) => name === "production")[1];
    const routedLayers = new Map((route.productionLayers || []).map((layer) => [layer.layer, layer]));
    for (const layer of production.layers || []) if (routedLayers.get(layer.layer)?.initialApplicability === "required" && layer.applicability !== "required") problems.push(`route-required production layer changed to not-applicable: ${layer.layer}`);
  }
  const gitHead = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (gitHead.status === 0 && nonEmptyForBinding(gitHead.stdout) !== goal.commit) problems.push("goal.commit must match current Git HEAD");
  return problems;
}

function nonEmptyForBinding(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256JsonFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/enterprise-ai-gate-all.mjs --repo .");
  let gates = GATES;
  try {
    const route = JSON.parse(readFileSync(path.join(path.resolve(args.repo), "run", "route.json"), "utf8"));
    if (route.gateApplicability?.production?.status !== "required") gates = GATES.filter(([name]) => name !== "production");
    if (route.gateApplicability?.["code-intelligence"]?.status !== "required") gates = gates.filter(([name]) => name !== "code-intelligence");
    if (route.gateApplicability?.smoke?.status !== "required") gates = gates.filter(([name]) => name !== "smoke");
  } catch {}
  const results = [];
  for (const [name, script] of gates) {
    const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, script), "--repo", path.resolve(args.repo)], { encoding: "utf8" });
    results.push({ name, ok: result.status === 0, exitCode: result.status, output: (result.stdout || result.stderr || "").trim().slice(-4000) });
  }
  let consistencyProblems = [];
  if (results.every((result) => result.ok)) {
    try { consistencyProblems = crossArtifactProblems(path.resolve(args.repo)); }
    catch (error) { consistencyProblems = [`cross-artifact binding failed: ${error.message}`]; }
  }
  const ok = results.every((result) => result.ok) && consistencyProblems.length === 0;
  const summary = { ok, gateCount: results.length, passed: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).map((result) => result.name), consistencyProblems, results };
  (ok ? console.log : console.error)(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
