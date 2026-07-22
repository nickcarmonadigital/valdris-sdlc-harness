#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_LAYERS } from "./production-layer-gate.mjs";
import { classifyWorkload, deliveryPrimaryForTask, executionBudgetForClassification, MANDATORY_FORBIDDEN_ACTIONS, MANDATORY_RED_ZONE, sha256, supportingSkillsForClassification } from "./workload-classifier-lib.mjs";

const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }
function writeJson(file, value) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function jsonValueSha256(file) { return sha256(JSON.stringify(readJson(file))); }

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
  const args = { repo: process.cwd(), profile: "enterprise", environment: "local", actor: "requesting human" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--request") args.request = argv[++index];
    else if (arg === "--request-file") args.request = readFileSync(argv[++index], "utf8").trim();
    else if (arg === "--run-id") args.runId = argv[++index];
    else if (arg === "--profile") args.profile = argv[++index];
    else if (arg === "--environment") args.environment = argv[++index];
    else if (arg === "--actor") args.actor = argv[++index];
    else if (arg === "--force") throw new Error("--force is disabled: intake, classification, initial route, and goal are immutable; start a new run ID and record supersession instead");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/route-request.mjs --repo . --request \"Build ...\" [--run-id ID] [--profile enterprise] [--environment local] [--actor name]\nExisting run artifacts are immutable; use a new run ID for revised scope.");
  if (!args.request?.trim()) throw new Error("--request or --request-file is required");
  if (!new Set(["prototype", "production", "enterprise", "regulated"]).has(args.profile)) throw new Error("--profile is invalid");
  const repoRoot = path.resolve(args.repo);
  const runId = args.runId || `VALDRIS-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("run ID may contain only letters, numbers, dot, underscore, and hyphen");
  const outputs = ["run/intake.json", "run/workload-classification.json", "run/route.json", "goal/goal.json"].map((relative) => path.join(repoRoot, relative));
  if (outputs.some(existsSync)) throw new Error("intake/classification/initial-route/goal artifact already exists and is immutable; start a new run ID in a clean run packet and record the superseded run in the handoff");

  const now = new Date().toISOString();
  const git = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  const commit = git.status === 0 ? git.stdout.trim() : `non-git-${sha256(args.request).slice(0, 12)}`;
  const registryPath = path.join(ASSET_ROOT, "skills", "registry.json");
  const catalogRoot = ASSET_ROOT;
  const workloadTaxonomy = path.join(catalogRoot, "controls", "workload-taxonomy.v1.json");
  const foundationCatalog = path.join(catalogRoot, "controls", "foundation-layer.v1.json");
  const productionCatalog = path.join(catalogRoot, "controls", "production-layers.v2.json");
  const aiCatalog = path.join(catalogRoot, "controls", "genai-assurance.v1.json");
  const domainIndexPath = path.join(catalogRoot, "controls", "domain-packs", "index.json");
  const domainIndex = readJson(domainIndexPath);
  const request = args.request.trim();
  const catalogDigests = {
    taxonomy: jsonValueSha256(workloadTaxonomy),
    foundation: jsonValueSha256(foundationCatalog),
    production: jsonValueSha256(productionCatalog),
    ai: jsonValueSha256(aiCatalog),
    domainIndex: jsonValueSha256(domainIndexPath),
  };
  const classification = classifyWorkload({
    runId,
    generatedAt: now,
    requestText: request,
    requestSha256: sha256(request),
    requestedProfile: args.profile,
    environment: args.environment,
    commit,
    taxonomy: readJson(workloadTaxonomy),
    domainIndex,
    productionLayers: PRODUCTION_LAYERS,
    productionCatalog: readJson(productionCatalog),
    catalogDigests,
  });
  const { taskType, ai, domainPacks } = classification;
  const deliveryPrimary = deliveryPrimaryForTask(taskType);
  const supporting = supportingSkillsForClassification(classification, deliveryPrimary);
  const executionBudget = executionBudgetForClassification(classification);
  const mobileIos = domainPacks.includes("mobile-ios") ? mobileIosCommissioning(repoRoot) : undefined;
  const sourceChangeRequested =
    taskType !== "ambiguous" &&
    /\b(fix|repair|remediat(?:e|ed|ion)|implement|build|add|change|update|refactor|migrat(?:e|ed|ing|ion)|redesign|develop|create|write|document|edit|rename|revise)\b/i.test(
      request,
    );
  const allowedActions = sourceChangeRequested
    ? ["read repository", "create scoped branch changes", "run local and commissioned validation"]
    : ["read repository", "run local and commissioned validation"];

  const intake = {
    schema: "uash.intake.v1", runId, receivedAt: now, profile: args.profile, requestedProfile: args.profile, commit, environment: args.environment,
    requestText: request, requestSha256: sha256(request), source: { actorType: "human", actor: args.actor },
    outcome: request, constraints: [], exclusions: [], allowedActions, executionBudget,
    forbiddenActions: [...MANDATORY_FORBIDDEN_ACTIONS],
    stoppingConditions: ["commissioned acceptance criteria pass", "all applicable Valdris gates pass", "Red Zone approvals are human-granted", "handoff names remaining external blockers"]
  };
  writeJson(outputs[0], intake);
  writeJson(outputs[1], classification);

  const domainDigests = Object.fromEntries(domainPacks.map((id) => {
    const entry = domainIndex.packs.find((pack) => pack.id === id);
    return [id, jsonValueSha256(path.join(catalogRoot, entry.path))];
  }));
  const decision = (required, reason) => required ? { status: "required" } : { status: "not-applicable", reason };
  const route = {
    schema: "uash.route.v2", runId, generatedAt: now, profile: args.profile, requestedProfile: args.profile, commit, environment: args.environment, taskType, controlledDocumentation: classification.controlledDocumentation, executionBudget,
    requestSignals: classification.matchedSignals,
    intakeSha256: sha256(readFileSync(outputs[0])), workloadClassificationSha256: sha256(readFileSync(outputs[1])), registrySha256: jsonValueSha256(registryPath),
    catalogDigests: { ...catalogDigests, domainPacks: domainDigests },
    skillPhases: [
      { phase: "intake-route", primary: "valdris-intake-route", supporting },
      { phase: "delivery", primary: deliveryPrimary, supporting },
      { phase: "proof-handoff", primary: "valdris-proof-handoff", supporting: supporting.slice(0, 3) }
    ],
    assuranceTier: { profileFloor: classification.profileTierFloor, effective: classification.effectiveTier },
    workloadProfiles: classification.workloadProfiles,
    crossCuttingConcerns: classification.crossCuttingConcerns,
    domainFeatures: classification.domainFeatures,
    materialUnknowns: classification.materialUnknowns,
    foundation: classification.foundation,
    productionLayers: classification.productionLayers,
    ai, domainPacks, ...(mobileIos ? { mobileIos } : {}),
    gateApplicability: {
      "code-intelligence": decision(classification.requiredGates["code-intelligence"], "No codebase claim in the initial docs-only scope."),
      foundation: decision(classification.requiredGates.foundation, "Docs-only route has no Layer 0 foundation change."),
      production: decision(classification.requiredGates.production, "No production behavior in the initial docs-only scope."),
      "ai-assurance": decision(classification.requiredGates["ai-assurance"], taskType === "docs-only" && ai.workloadDetected ? "Controlled documentation identifies an AI-governance subject but changes no model or runtime behavior." : "Intake contains no AI behavior signal."),
      "domain-assurance": decision(classification.requiredGates["domain-assurance"], taskType === "docs-only" && domainPacks.length ? "Controlled documentation identifies domain policy but changes no domain runtime behavior." : "No domain-pack trigger in intake."),
      eval: decision(classification.requiredGates.eval, "Docs-only route has no commissioned behavior threshold."),
      trajectory: decision(classification.requiredGates.trajectory, "No durable multi-checkpoint execution."),
      smoke: decision(classification.requiredGates.smoke, "No deployed/provider/platform-native behavior requested yet.")
    },
    redZone: [...MANDATORY_RED_ZONE],
    rejectedAlternatives: [{ skill: "valdris-intake-route", reason: "Intake-only primary transitions to the narrow delivery primary after routing." }],
    authority: { allowedActions: intake.allowedActions, forbiddenActions: intake.forbiddenActions }
  };
  writeJson(outputs[2], route);

  const goal = {
    schema: "uash.goal.v1", goalId: runId, revision: 1, generatedAt: now, updatedAt: now, objective: request, requestSha256: sha256(request), initialRouteSha256: sha256(readFileSync(outputs[2])), owner: args.actor, status: "in_progress", profile: args.profile, effectiveTier: classification.effectiveTier, workloadClassificationSha256: sha256(readFileSync(outputs[1])), commit, environment: args.environment,
    budgets: executionBudget,
    stoppingConditions: [
      { id: "acceptance-criteria", status: "pending" }, { id: "applicable-control-gates", status: "pending" },
      { id: "red-zone-authority", status: "pending" }, { id: "proof-and-handoff", status: "pending" },
      ...classification.materialUnknowns.map((unknown) => ({ id: `classification-unknown:${unknown.id}`, status: "pending" }))
    ],
    checkpoints: [{ id: "intake-route", status: "started", recordedAt: now, summary: `Routed ${taskType} work to ${deliveryPrimary}; resolve architecture and authority unknowns before implementation.` }]
  };
  writeJson(outputs[3], goal);
  console.log(JSON.stringify({ ok: true, runId, repo: repoRoot, taskType, aiProfile: ai.aiProfile, domainPacks, primarySkill: deliveryPrimary, supportingSkills: supporting, artifacts: outputs.map((file) => path.relative(repoRoot, file)) }, null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exit(1); }
