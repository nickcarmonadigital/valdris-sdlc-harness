#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, isIsoTimestamp, nonEmpty, parseRepoFileArgs, readJson } from "./control-gate-lib.mjs";
import { PRODUCTION_LAYERS } from "./production-layer-gate.mjs";

export const ROUTE_SCHEMA = "uash.route.v1";
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const TASK_TYPES = new Set(["bug", "feature", "architecture-refactor", "security", "platform-release", "genai", "audit", "incident", "docs-only"]);
const APPLICABILITY = new Set(["required", "potentially-affected", "not-applicable"]);
const GATE_DECISIONS = new Set(["required", "not-applicable"]);
const REQUIRED_GATE_KEYS = ["code-intelligence", "production", "ai-assurance", "domain-assurance", "eval", "trajectory", "smoke"];

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function signalMatches(signal, trigger) {
  const left = signal.toLowerCase();
  const right = trigger.toLowerCase();
  return left.includes(right) || right.includes(left);
}

export function validateRouteDocument(document, options) {
  const { registry, registryPath, domainIndex, domainIndexPath, productionCatalogPath, aiCatalogPath, catalogRoot, intake, intakePath, mobileIosAdapter } = options;
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["route must be a JSON object"] };
  if (document.schema !== ROUTE_SCHEMA) problems.push(`route schema must be ${ROUTE_SCHEMA}`);
  if (!nonEmpty(document.runId)) problems.push("route runId is required");
  if (!isIsoTimestamp(document.generatedAt)) problems.push("route generatedAt must be an ISO timestamp");
  if (!PROFILES.has(document.profile)) problems.push("route profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("route commit is required");
  if (!nonEmpty(document.environment)) problems.push("route environment is required");
  if (!TASK_TYPES.has(document.taskType)) problems.push("route taskType is invalid");
  if (!Array.isArray(document.requestSignals) || document.requestSignals.length === 0 || document.requestSignals.some((item) => !nonEmpty(item))) problems.push("route requestSignals must be a non-empty string array");
  if (!intakePath || !existsSync(intakePath) || document.intakeSha256 !== sha256File(intakePath)) problems.push("route intakeSha256 must match run/intake.json");
  if (intake?.runId !== document.runId) problems.push("route runId must match intake runId");

  if (!registryPath || !existsSync(registryPath)) problems.push("route skill registry path is missing");
  else if (document.registrySha256 !== sha256File(registryPath)) problems.push("route registrySha256 does not match the selected skill registry");
  if (document.catalogDigests?.production !== sha256File(productionCatalogPath)) problems.push("route production catalog digest mismatch");
  if (document.catalogDigests?.ai !== sha256File(aiCatalogPath)) problems.push("route AI catalog digest mismatch");
  if (document.catalogDigests?.domainIndex !== sha256File(domainIndexPath)) problems.push("route domain index digest mismatch");
  const skillNames = new Set((registry?.skills || []).map((skill) => skill.name));
  const expectedPhases = registry?.selection?.phaseTransitions || [];
  const phases = Array.isArray(document.skillPhases) ? document.skillPhases : [];
  const seenPhases = new Set();
  for (const [index, phase] of phases.entries()) {
    const label = `route skillPhases[${index}]`;
    if (!expectedPhases.includes(phase?.phase)) problems.push(`${label}.phase is invalid`);
    if (seenPhases.has(phase?.phase)) problems.push(`${label}.phase is duplicated`);
    seenPhases.add(phase?.phase);
    if (!skillNames.has(phase?.primary)) problems.push(`${label}.primary is not registered`);
    const supporting = Array.isArray(phase?.supporting) ? phase.supporting : [];
    if (supporting.length > registry?.selection?.maxSupporting) problems.push(`${label}.supporting exceeds registry maximum`);
    if (new Set(supporting).size !== supporting.length) problems.push(`${label}.supporting contains duplicates`);
    if (supporting.includes(phase?.primary)) problems.push(`${label}.primary cannot also be supporting`);
    for (const skill of supporting) if (!skillNames.has(skill)) problems.push(`${label}.supporting skill is not registered: ${skill}`);
  }
  for (const phase of expectedPhases) if (!seenPhases.has(phase)) problems.push(`route missing skill phase: ${phase}`);

  const layers = Array.isArray(document.productionLayers) ? document.productionLayers : [];
  const seenLayers = new Set();
  for (const layer of layers) {
    if (!PRODUCTION_LAYERS.includes(layer?.layer)) problems.push(`route has unknown production layer: ${layer?.layer || "missing"}`);
    if (seenLayers.has(layer?.layer)) problems.push(`route production layer duplicated: ${layer?.layer}`);
    seenLayers.add(layer?.layer);
    if (!APPLICABILITY.has(layer?.initialApplicability)) problems.push(`route production layer ${layer?.layer || "missing"} initialApplicability is invalid`);
    if (layer?.initialApplicability === "not-applicable" && !nonEmpty(layer.reason)) problems.push(`route production layer ${layer.layer} is not-applicable without reason`);
  }
  for (const layer of PRODUCTION_LAYERS) if (!seenLayers.has(layer)) problems.push(`route production layer missing: ${layer}`);

  if (typeof document.ai?.workloadDetected !== "boolean") problems.push("route ai.workloadDetected must be boolean");
  if (!nonEmpty(document.ai?.aiProfile)) problems.push("route ai.aiProfile is required");
  for (const feature of ["rag", "tools", "memory", "consequential", "userFacing", "sensitiveData", "autonomous"]) if (typeof document.ai?.features?.[feature] !== "boolean") problems.push(`route ai.features.${feature} must be boolean`);
  const selectedPacks = Array.isArray(document.domainPacks) ? document.domainPacks : [];
  if (new Set(selectedPacks).size !== selectedPacks.length) problems.push("route domainPacks contains duplicates");
  const knownPacks = new Set((domainIndex?.packs || []).map((pack) => pack.id));
  for (const pack of selectedPacks) if (!knownPacks.has(pack)) problems.push(`route has unknown domain pack: ${pack}`);
  for (const packId of selectedPacks) {
    const entry = (domainIndex?.packs || []).find((pack) => pack.id === packId);
    const packPath = entry ? path.resolve(catalogRoot, entry.path) : null;
    if (!packPath || !existsSync(packPath) || document.catalogDigests?.domainPacks?.[packId] !== sha256File(packPath)) problems.push(`route domain catalog digest mismatch: ${packId}`);
  }
  if (selectedPacks.includes("mobile-ios")) {
    if (!document.mobileIos || !["commissioned", "missing"].includes(document.mobileIos.status)) problems.push("mobile-ios route must declare commissioning status");
    if (mobileIosAdapter) {
      const expected = { scheme: String(mobileIosAdapter.scheme || ""), bundleAndTeam: String(mobileIosAdapter.bundleAndTeam || ""), macosRunner: String(mobileIosAdapter.macosRunner || ""), commissioningSha256: sha256(JSON.stringify(mobileIosAdapter)) };
      if (document.mobileIos?.status !== "commissioned") problems.push("mobile-ios route must use the available commissioned adapter identity");
      for (const field of Object.keys(expected)) if (document.mobileIos?.[field] !== expected[field]) problems.push(`mobile-ios route ${field} does not match the authoritative adapter`);
    } else if (document.mobileIos?.status === "commissioned") problems.push("mobile-ios route claims commissioned identity without an adapter");
  }
  const trustedSignals = [intake?.requestText || ""];
  if (trustedSignals.some((signal) => /\b(ai|llm|model|prompt|rag|embedding|agent|generative)\b/i.test(signal)) && document.ai?.workloadDetected !== true) problems.push("intake/route signals detect an AI workload but route ai.workloadDetected is false");
  for (const pack of domainIndex?.packs || []) {
    if (trustedSignals.some((signal) => pack.triggers.some((trigger) => signalMatches(signal, trigger))) && !selectedPacks.includes(pack.id)) problems.push(`intake/route signals require domain pack: ${pack.id}`);
  }

  const gateApplicability = document.gateApplicability && typeof document.gateApplicability === "object" ? document.gateApplicability : {};
  for (const gate of REQUIRED_GATE_KEYS) {
    const decision = gateApplicability[gate];
    if (!decision || !GATE_DECISIONS.has(decision.status)) problems.push(`route gateApplicability.${gate}.status is invalid`);
    if (decision?.status === "not-applicable" && !nonEmpty(decision.reason)) problems.push(`route gateApplicability.${gate} is not-applicable without reason`);
  }
  if (document.ai?.workloadDetected === true && gateApplicability["ai-assurance"]?.status !== "required") problems.push("route with AI workload must require ai-assurance");
  if (document.ai?.workloadDetected === true && gateApplicability.eval?.status !== "required") problems.push("route with AI workload must require eval");
  if (selectedPacks.length > 0 && gateApplicability["domain-assurance"]?.status !== "required") problems.push("route with domain packs must require domain-assurance");
  if (gateApplicability.trajectory?.status !== "required") problems.push("durable multi-checkpoint route must require trajectory");
  if (document.taskType !== "docs-only" && gateApplicability["code-intelligence"]?.status !== "required") problems.push("non-docs route must require code-intelligence");
  if (document.taskType !== "docs-only" && gateApplicability.production?.status !== "required") problems.push("non-docs route must require production assurance");
  if (layers.some((layer) => layer.initialApplicability === "required") && gateApplicability.production?.status !== "required") problems.push("route with required production layers must require production assurance");
  const requestText = intake?.requestText || "";
  const fullStackSignal = /\b(full[- ]stack|game|app|multiplayer|accounts?|purchases?|cloud saves?|matchmaking|ship|production)\b/i.test(requestText);
  if (fullStackSignal) {
    for (const layer of layers) if (layer.initialApplicability !== "required") problems.push(`full-stack intake requires production layer: ${layer.layer}`);
  }
  const smokeSignal = /\b(ship|deploy|release|testflight|production|provider)\b/i.test(requestText);
  if (smokeSignal && gateApplicability.smoke?.status !== "required") problems.push("deployment/TestFlight intake must require live smoke");

  if (!Array.isArray(document.redZone) || document.redZone.some((item) => !nonEmpty(item))) problems.push("route redZone must be a string array");
  if (!Array.isArray(document.rejectedAlternatives)) problems.push("route rejectedAlternatives must be an array");
  if (!Array.isArray(document.authority?.allowedActions) || !Array.isArray(document.authority?.forbiddenActions)) problems.push("route authority must declare allowedActions and forbiddenActions arrays");
  return { valid: problems.length === 0, schema: document.schema, runId: document.runId, skillPhaseCount: phases.length, domainPacks: selectedPacks, problems };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "run/route.json" });
  if (args.help) return console.log("Usage: node scripts/route-gate.mjs --repo . [--file run/route.json]");
  const repoRoot = path.resolve(args.repo);
  const assetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = path.resolve(repoRoot, args.file);
  const intakePath = path.join(repoRoot, "run", "intake.json");
  const registryPath = path.join(assetRoot, "skills", "registry.json");
  const domainIndexPath = path.join(assetRoot, "controls", "domain-packs", "index.json");
  const catalogRoot = assetRoot;
  const productionCatalogPath = path.join(assetRoot, "controls", "production-layers.v2.json");
  const aiCatalogPath = path.join(assetRoot, "controls", "genai-assurance.v1.json");
  const adapterPath = [path.join(repoRoot, "project-adapter.json"), path.join(repoRoot, ".valdris-harness", "project-adapter.json")].find(existsSync);
  const mobileIosAdapter = adapterPath ? readJson(adapterPath).mobileIos : undefined;
  if (!existsSync(target)) return gateResult(args.file, { valid: false, problems: [`route missing: ${args.file}`] });
  try { gateResult(args.file, validateRouteDocument(readJson(target), { registry: readJson(registryPath), registryPath, domainIndex: readJson(domainIndexPath), domainIndexPath, productionCatalogPath, aiCatalogPath, catalogRoot, intake: readJson(intakePath), intakePath, mobileIosAdapter })); }
  catch (error) { gateResult(args.file, { valid: false, problems: [`route or catalog must be valid JSON: ${error.message}`] }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
