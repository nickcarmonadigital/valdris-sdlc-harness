#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_LAYERS } from "./production-layer-gate.mjs";

const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function writeJson(file, value) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function mobileIosCommissioning(repoRoot) {
  const candidates = [path.join(repoRoot, "project-adapter.json"), path.join(repoRoot, ".valdris-harness", "project-adapter.json")];
  const adapterPath = candidates.find(existsSync);
  if (!adapterPath) return { status: "missing", reason: "No commissioned project adapter was found; native iOS proof cannot finish until Apple identity facts are commissioned." };
  const mobile = readJson(adapterPath).mobileIos;
  if (!mobile || typeof mobile !== "object") return { status: "missing", reason: "The project adapter has no mobileIos commissioning section." };
  return {
    status: "commissioned",
    scheme: String(mobile.scheme || ""),
    bundleAndTeam: String(mobile.bundleAndTeam || ""),
    macosRunner: String(mobile.macosRunner || ""),
    commissioningSha256: sha256(JSON.stringify(mobile)),
  };
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), profile: "enterprise", environment: "local", actor: "requesting human", force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--request") args.request = argv[++index];
    else if (arg === "--request-file") args.request = readFileSync(argv[++index], "utf8").trim();
    else if (arg === "--run-id") args.runId = argv[++index];
    else if (arg === "--profile") args.profile = argv[++index];
    else if (arg === "--environment") args.environment = argv[++index];
    else if (arg === "--actor") args.actor = argv[++index];
    else if (arg === "--force") args.force = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function classifyTask(request) {
  if (/\b(bug|broken|regression|failing|double[- ]charg|root cause|incident)\b/i.test(request)) return "bug";
  if (/\b(security|vulnerab|auth|permission|rls|compliance|privacy)\b/i.test(request) && /\b(audit|review|assess|test)\b/i.test(request)) return "security";
  if (/\b(architect|refactor|migrat|redesign|module boundar)\b/i.test(request)) return "architecture-refactor";
  if (/\b(deploy|release|rollback|cloud|infrastructure|slo|failover|backup)\b/i.test(request) && !/\b(build|feature|add|implement|game|app)\b/i.test(request)) return "platform-release";
  if (/\b(audit|review|assess)\b/i.test(request)) return "audit";
  if (/\b(ai|llm|rag|model|prompt|embedding|agent)\b/i.test(request) && !/\b(build|feature|add|implement|game|app)\b/i.test(request)) return "genai";
  return "feature";
}

function primaryForTask(taskType) {
  return {
    bug: "valdris-bug-rca", feature: "valdris-feature-delivery", "architecture-refactor": "valdris-architecture-refactor",
    security: "valdris-security-audit", "platform-release": "valdris-platform-release", genai: "valdris-genai-assurance",
    audit: "valdris-security-audit", incident: "valdris-platform-release", "docs-only": "valdris-intake-route",
  }[taskType];
}

function aiClassification(request) {
  const workloadDetected = /\b(ai|llm|rag|model|prompt|embedding|agent|generative|dungeon master)\b/i.test(request);
  const features = {
    rag: workloadDetected && /\b(rag|retriev|knowledge base|lore corpus|embedding)\b/i.test(request),
    tools: workloadDetected && /\b(agent|tool|action|purchase|billing|dungeon master|state[- ]chang)\b/i.test(request),
    memory: workloadDetected && /\b(memory|remember|campaign|cloud save|player state|dungeon master)\b/i.test(request),
    consequential: workloadDetected && /\b(purchase|billing|payment|entitlement|state[- ]chang|account action)\b/i.test(request),
    userFacing: workloadDetected && /\b(user|player|customer|game|app|chat|assistant)\b/i.test(request),
    sensitiveData: workloadDetected && /\b(account|personal|private|customer|player data|health|financial)\b/i.test(request),
    autonomous: workloadDetected && /\b(agent|autonom|dungeon master|take action|invoke)\b/i.test(request),
  };
  const aiProfile = !workloadDetected ? "AI-0" : features.consequential || features.autonomous ? "AI-3" : Object.values(features).some(Boolean) ? "AI-2" : "AI-1";
  return { workloadDetected, aiProfile, features };
}

function supportingSkills(request, primary, ai) {
  const candidates = [];
  if (ai.workloadDetected) candidates.push("valdris-genai-assurance");
  if (/\b(auth|accounts?|purchases?|billing|payments?|security|privacy|minors?|children|child|teens?|customer data)\b/i.test(request)) candidates.push("valdris-security-audit");
  if (/\b(ios|iphone|ipad|testflight|app store|cloud|deploy|multiplayer|realtime|matchmaking|release)\b/i.test(request)) candidates.push("valdris-platform-release");
  if (/\b(architect|migration|refactor|realtime|authoritative state)\b/i.test(request)) candidates.push("valdris-architecture-refactor");
  return [...new Set(candidates)].filter((name) => name !== primary).slice(0, 4);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/route-request.mjs --repo . --request \"Build ...\" [--run-id ID] [--profile enterprise] [--environment local] [--actor name] [--force]");
  if (!args.request?.trim()) throw new Error("--request or --request-file is required");
  if (!new Set(["prototype", "production", "enterprise", "regulated"]).has(args.profile)) throw new Error("--profile is invalid");
  const repoRoot = path.resolve(args.repo);
  const runId = args.runId || `VALDRIS-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("run ID may contain only letters, numbers, dot, underscore, and hyphen");
  const outputs = ["run/intake.json", "run/route.json", "goal/goal.json"].map((relative) => path.join(repoRoot, relative));
  if (!args.force && outputs.some(existsSync)) throw new Error("intake/route/goal artifact already exists; use --force only after reviewing the current run");

  const now = new Date().toISOString();
  const git = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  const commit = git.status === 0 ? git.stdout.trim() : `non-git-${sha256(args.request).slice(0, 12)}`;
  const registryPath = path.join(ASSET_ROOT, "skills", "registry.json");
  const catalogRoot = ASSET_ROOT;
  const productionCatalog = path.join(catalogRoot, "controls", "production-layers.v2.json");
  const aiCatalog = path.join(catalogRoot, "controls", "genai-assurance.v1.json");
  const domainIndexPath = path.join(catalogRoot, "controls", "domain-packs", "index.json");
  const domainIndex = readJson(domainIndexPath);
  const request = args.request.trim();
  const taskType = classifyTask(request);
  const ai = aiClassification(request);
  const domainPacks = domainIndex.packs.filter((pack) => pack.triggers.some((trigger) => request.toLowerCase().includes(trigger.toLowerCase()))).map((pack) => pack.id);
  if (/\b(child|children|minor|teen|youth)\b/i.test(request) && !domainPacks.includes("youth-ai-safety")) domainPacks.push("youth-ai-safety");
  const deliveryPrimary = primaryForTask(taskType);
  const supporting = supportingSkills(request, deliveryPrimary, ai);
  const fullStack = /\b(full[- ]stack|game|app|multiplayer|accounts?|purchases?|cloud saves?|matchmaking|ship|production)\b/i.test(request);
  const mobileIos = domainPacks.includes("mobile-ios") ? mobileIosCommissioning(repoRoot) : undefined;

  const intake = {
    schema: "uash.intake.v1", runId, receivedAt: now, profile: args.profile, commit, environment: args.environment,
    requestText: request, requestSha256: sha256(request), source: { actorType: "human", actor: args.actor },
    outcome: request, constraints: [], exclusions: [], allowedActions: ["read repository", "create scoped branch changes", "run local and commissioned validation"],
    forbiddenActions: ["agent self-approval", "production mutation without approval", "secret access without approval", "fabricated evidence"],
    stoppingConditions: ["commissioned acceptance criteria pass", "all applicable Valdris gates pass", "Red Zone approvals are human-granted", "handoff names remaining external blockers"]
  };
  writeJson(outputs[0], intake);

  const domainDigests = Object.fromEntries(domainPacks.map((id) => {
    const entry = domainIndex.packs.find((pack) => pack.id === id);
    return [id, sha256(readFileSync(path.join(catalogRoot, entry.path)))];
  }));
  const productionLayers = PRODUCTION_LAYERS.map((layer) => taskType === "docs-only"
    ? { layer, initialApplicability: "not-applicable", reason: "Docs-only route; reconsider if implementation or runtime behavior enters scope." }
    : { layer, initialApplicability: fullStack || ["security", "cicd-version-control", "error-tracking-logs-observability"].includes(layer) ? "required" : "potentially-affected" });
  const route = {
    schema: "uash.route.v1", runId, generatedAt: now, profile: args.profile, commit, environment: args.environment, taskType,
    requestSignals: [...new Set([taskType, ...domainPacks, ai.workloadDetected ? "AI workload" : "non-AI workload"])],
    intakeSha256: sha256(readFileSync(outputs[0])), registrySha256: sha256(readFileSync(registryPath)),
    catalogDigests: { production: sha256(readFileSync(productionCatalog)), ai: sha256(readFileSync(aiCatalog)), domainIndex: sha256(readFileSync(domainIndexPath)), domainPacks: domainDigests },
    skillPhases: [
      { phase: "intake-route", primary: "valdris-intake-route", supporting },
      { phase: "delivery", primary: deliveryPrimary, supporting },
      { phase: "proof-handoff", primary: "valdris-proof-handoff", supporting: supporting.slice(0, 3) }
    ],
    productionLayers, ai, domainPacks, ...(mobileIos ? { mobileIos } : {}),
    gateApplicability: {
      "code-intelligence": { status: taskType === "docs-only" ? "not-applicable" : "required", ...(taskType === "docs-only" ? { reason: "No codebase claim in the initial docs-only scope." } : {}) },
      production: { status: taskType === "docs-only" ? "not-applicable" : "required", ...(taskType === "docs-only" ? { reason: "No production behavior in the initial docs-only scope." } : {}) },
      "ai-assurance": { status: ai.workloadDetected ? "required" : "not-applicable", ...(!ai.workloadDetected ? { reason: "Intake contains no AI behavior signal." } : {}) },
      "domain-assurance": { status: domainPacks.length ? "required" : "not-applicable", ...(!domainPacks.length ? { reason: "No domain-pack trigger in intake." } : {}) },
      eval: { status: ai.workloadDetected || taskType !== "docs-only" ? "required" : "not-applicable", ...(ai.workloadDetected || taskType !== "docs-only" ? {} : { reason: "Docs-only route has no commissioned behavior threshold." }) },
      trajectory: { status: "required" },
      smoke: { status: /\b(ship|deploy|release|testflight|production|provider)\b/i.test(request) ? "required" : "not-applicable", ...(/\b(ship|deploy|release|testflight|production|provider)\b/i.test(request) ? {} : { reason: "No deployed/provider/platform-native behavior requested yet." }) }
    },
    redZone: ["production deploy or data mutation", "secrets/IAM/provider configuration", "billing/refund/reconciliation", "Apple signing/TestFlight/App Store actions", "customer or tester communication"],
    rejectedAlternatives: [{ skill: "valdris-intake-route", reason: "Intake-only primary transitions to the narrow delivery primary after routing." }],
    authority: { allowedActions: intake.allowedActions, forbiddenActions: intake.forbiddenActions }
  };
  writeJson(outputs[1], route);

  const goal = {
    schema: "uash.goal.v1", goalId: runId, revision: 1, generatedAt: now, updatedAt: now, objective: request, requestSha256: sha256(request), initialRouteSha256: sha256(readFileSync(outputs[1])), owner: args.actor, status: "in_progress", profile: args.profile, commit, environment: args.environment,
    budgets: { attempts: 40, toolCalls: 2000, tokens: 5000000, costUsd: 2500, wallClockMinutes: 43200 },
    stoppingConditions: [
      { id: "acceptance-criteria", status: "pending" }, { id: "applicable-control-gates", status: "pending" },
      { id: "red-zone-authority", status: "pending" }, { id: "proof-and-handoff", status: "pending" }
    ],
    checkpoints: [{ id: "intake-route", status: "started", recordedAt: now, summary: `Routed ${taskType} work to ${deliveryPrimary}; resolve architecture and authority unknowns before implementation.` }]
  };
  writeJson(outputs[2], goal);
  console.log(JSON.stringify({ ok: true, runId, repo: repoRoot, taskType, aiProfile: ai.aiProfile, domainPacks, primarySkill: deliveryPrimary, supportingSkills: supporting, artifacts: outputs.map((file) => path.relative(repoRoot, file)) }, null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exit(1); }
