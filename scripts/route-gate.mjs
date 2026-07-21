#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, isIsoTimestamp, nonEmpty, parseRepoFileArgs, readJson } from "./control-gate-lib.mjs";
import { PRODUCTION_LAYERS } from "./production-layer-gate.mjs";
import { classifyAiWorkload, deliveryPrimaryForTask, executionBudgetForClassification, isFullStackRequest, MANDATORY_RED_ZONE, requiresLiveSmoke, supportingSkillsForClassification, triggerMatches } from "./workload-classifier-lib.mjs";

export const ROUTE_SCHEMA = "uash.route.v2";
export const LEGACY_ROUTE_SCHEMA = "uash.route.v1";
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const TASK_TYPES = new Set(["ambiguous", "bug", "feature", "architecture-refactor", "security", "platform-release", "genai", "audit", "incident", "proof-handoff", "docs-only"]);
const APPLICABILITY = new Set(["required", "potentially-affected", "not-applicable"]);
const GATE_DECISIONS = new Set(["required", "not-applicable"]);
const REQUIRED_GATE_KEYS = ["code-intelligence", "foundation", "production", "ai-assurance", "domain-assurance", "eval", "trajectory", "smoke"];
const REQUIRED_PHASES = ["intake-route", "delivery", "proof-handoff"];
const REQUIRED_PRIMARY_SKILLS = new Set(["valdris-intake-route", "valdris-proof-handoff", ...["ambiguous", "bug", "feature", "architecture-refactor", "security", "platform-release", "genai", "audit", "incident", "proof-handoff", "docs-only"].map(deliveryPrimaryForTask)]);

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function jsonValueSha256(filePath) {
  return createHash("sha256").update(JSON.stringify(JSON.parse(readFileSync(filePath, "utf8")))).digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateRouteDocument(document, options) {
  const { registry, registryPath, domainIndex, domainIndexPath, productionCatalogPath, aiCatalogPath, foundationCatalogPath, taxonomyPath, taxonomy, catalogRoot, intake, intakePath, classification, classificationPath, mobileIosAdapter } = options;
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["route must be a JSON object"] };
  if (document.schema === LEGACY_ROUTE_SCHEMA) problems.push(`legacy ${LEGACY_ROUTE_SCHEMA} is historical-only; current routes must use ${ROUTE_SCHEMA}`);
  else if (document.schema !== ROUTE_SCHEMA) problems.push(`route schema must be ${ROUTE_SCHEMA}`);
  if (!nonEmpty(document.runId)) problems.push("route runId is required");
  if (!isIsoTimestamp(document.generatedAt)) problems.push("route generatedAt must be an ISO timestamp");
  if (!PROFILES.has(document.profile)) problems.push("route profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("route commit is required");
  if (!nonEmpty(document.environment)) problems.push("route environment is required");
  if (!TASK_TYPES.has(document.taskType)) problems.push("route taskType is invalid");
  if (!Array.isArray(document.requestSignals) || document.requestSignals.length === 0 || document.requestSignals.some((item) => !nonEmpty(item))) problems.push("route requestSignals must be a non-empty string array");
  if (!intakePath || !existsSync(intakePath) || document.intakeSha256 !== sha256File(intakePath)) problems.push("route intakeSha256 must match run/intake.json");
  if (intake?.runId !== document.runId) problems.push("route runId must match intake runId");
  if (!classificationPath || !existsSync(classificationPath) || document.workloadClassificationSha256 !== sha256File(classificationPath)) problems.push("route workloadClassificationSha256 must match run/workload-classification.json");
  if (classification?.runId !== document.runId) problems.push("route runId must match workload classification runId");

  if (!registryPath || !existsSync(registryPath)) problems.push("route skill registry path is missing");
  else if (document.registrySha256 !== jsonValueSha256(registryPath)) problems.push("route registrySha256 does not match the selected skill registry");
  if (document.catalogDigests?.taxonomy !== jsonValueSha256(taxonomyPath)) problems.push("route workload taxonomy digest mismatch");
  if (document.catalogDigests?.foundation !== jsonValueSha256(foundationCatalogPath)) problems.push("route foundation catalog digest mismatch");
  if (document.catalogDigests?.production !== jsonValueSha256(productionCatalogPath)) problems.push("route production catalog digest mismatch");
  if (document.catalogDigests?.ai !== jsonValueSha256(aiCatalogPath)) problems.push("route AI catalog digest mismatch");
  if (document.catalogDigests?.domainIndex !== jsonValueSha256(domainIndexPath)) problems.push("route domain index digest mismatch");
  const skillNames = new Set((registry?.skills || []).map((skill) => skill.name));
  const configuredPhases = registry?.selection?.phaseTransitions || [];
  if (JSON.stringify(configuredPhases) !== JSON.stringify(REQUIRED_PHASES)) problems.push("skill registry phaseTransitions must be exactly intake-route, delivery, proof-handoff");
  for (const skill of REQUIRED_PRIMARY_SKILLS) if (!skillNames.has(skill)) problems.push(`skill registry missing canonical primary skill: ${skill}`);
  const expectedPhases = REQUIRED_PHASES;
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
  const expectedPrimaryByPhase = {
    "intake-route": "valdris-intake-route",
    delivery: deliveryPrimaryForTask(document.taskType),
    "proof-handoff": "valdris-proof-handoff",
  };
  for (const phase of phases) if (expectedPrimaryByPhase[phase.phase] && phase.primary !== expectedPrimaryByPhase[phase.phase]) problems.push(`route ${phase.phase} primary must be ${expectedPrimaryByPhase[phase.phase]} for taskType ${document.taskType}`);

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

  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (classification) {
    if (document.profile !== classification.requestedProfile) problems.push("route profile must match workload classification requestedProfile");
    if (document.requestedProfile !== classification.requestedProfile) problems.push("route requestedProfile must match workload classification requestedProfile");
    if (document.assuranceTier?.profileFloor !== classification.profileTierFloor || document.assuranceTier?.effective !== classification.effectiveTier) problems.push("route assuranceTier must match workload classification");
    for (const field of ["taskType", "workloadProfiles", "crossCuttingConcerns", "domainFeatures", "materialUnknowns", "foundation", "productionLayers", "ai", "domainPacks"]) {
      if (!sameJson(document[field], classification[field])) problems.push(`route ${field} must match workload classification`);
    }
    if (document.controlledDocumentation !== classification.controlledDocumentation) problems.push("route controlledDocumentation must match workload classification");
    const expectedExecutionBudget = executionBudgetForClassification(classification);
    if (!sameJson(intake?.executionBudget, expectedExecutionBudget)) problems.push("intake executionBudget must match the conservative deterministic task/tier budget");
    if (!sameJson(document.executionBudget, expectedExecutionBudget)) problems.push("route executionBudget must match the conservative deterministic task/tier budget");
    const expectedSupporting = supportingSkillsForClassification(classification, deliveryPrimaryForTask(classification.taskType));
    for (const phase of phases) {
      const expected = phase.phase === "proof-handoff" ? expectedSupporting.slice(0, 3) : expectedSupporting;
      if (!sameJson(phase.supporting, expected)) problems.push(`route ${phase.phase} supporting skills must match deterministic workload classification`);
    }
    if (!sameJson(document.requestSignals, classification.matchedSignals)) problems.push("route requestSignals must match workload classification matchedSignals");
    const concerns = new Map((taxonomy?.crossCuttingConcerns || []).map((concern) => [concern.id, concern]));
    const layerById = new Map(layers.map((layer) => [layer.layer, layer]));
    for (const concernId of classification.crossCuttingConcerns || []) {
      const concern = concerns.get(concernId);
      if (!concern) {
        problems.push(`route workload classification has unknown cross-cutting concern: ${concernId}`);
        continue;
      }
      if (document.taskType !== "docs-only") for (const layer of concern.productionLayers || []) if (layerById.get(layer)?.initialApplicability !== "required") problems.push(`cross-cutting concern ${concernId} requires production layer: ${layer}`);
    }
  }

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
    if (!packPath || !existsSync(packPath) || document.catalogDigests?.domainPacks?.[packId] !== jsonValueSha256(packPath)) problems.push(`route domain catalog digest mismatch: ${packId}`);
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
  if (document.taskType !== "docs-only") {
    if (trustedSignals.some((signal) => classifyAiWorkload(signal).workloadDetected) && document.ai?.workloadDetected !== true) problems.push("intake/route signals detect an AI workload but route ai.workloadDetected is false");
    for (const pack of domainIndex?.packs || []) {
      if (trustedSignals.some((signal) => pack.triggers.some((trigger) => triggerMatches(signal, trigger))) && !selectedPacks.includes(pack.id)) problems.push(`intake/route signals require domain pack: ${pack.id}`);
    }
  }

  const gateApplicability = document.gateApplicability && typeof document.gateApplicability === "object" ? document.gateApplicability : {};
  for (const gate of REQUIRED_GATE_KEYS) {
    const decision = gateApplicability[gate];
    if (!decision || !GATE_DECISIONS.has(decision.status)) problems.push(`route gateApplicability.${gate}.status is invalid`);
    if (decision?.status === "not-applicable" && !nonEmpty(decision.reason)) problems.push(`route gateApplicability.${gate} is not-applicable without reason`);
    const expectedStatus = classification?.requiredGates?.[gate] === true ? "required" : "not-applicable";
    if (classification?.requiredGates && decision?.status !== expectedStatus) problems.push(`route gateApplicability.${gate}.status must match workload classification requiredGates`);
  }
  if (document.taskType !== "docs-only" && document.ai?.workloadDetected === true && gateApplicability["ai-assurance"]?.status !== "required") problems.push("route with AI workload must require ai-assurance");
  if (document.taskType !== "docs-only" && document.ai?.workloadDetected === true && gateApplicability.eval?.status !== "required") problems.push("route with AI workload must require eval");
  if (document.taskType !== "docs-only" && selectedPacks.length > 0 && gateApplicability["domain-assurance"]?.status !== "required") problems.push("route with domain packs must require domain-assurance");
  if (gateApplicability.trajectory?.status !== "required") problems.push("durable multi-checkpoint route must require trajectory");
  if (document.taskType !== "docs-only" && gateApplicability["code-intelligence"]?.status !== "required") problems.push("non-docs route must require code-intelligence");
  if (document.taskType !== "docs-only" && gateApplicability.foundation?.status !== "required") problems.push("non-docs route must require Layer 0 foundation assurance");
  if (document.foundation?.initialApplicability === "required" && gateApplicability.foundation?.status !== "required") problems.push("route-required foundation cannot be downgraded");
  if (document.taskType !== "docs-only" && gateApplicability.production?.status !== "required") problems.push("non-docs route must require production assurance");
  if (layers.some((layer) => layer.initialApplicability === "required") && gateApplicability.production?.status !== "required") problems.push("route with required production layers must require production assurance");
  const requestText = intake?.requestText || "";
  if (document.taskType !== "docs-only" && isFullStackRequest(requestText)) {
    for (const layer of layers) if (layer.initialApplicability !== "required") problems.push(`full-stack intake requires production layer: ${layer.layer}`);
  }
  if (document.taskType !== "docs-only" && requiresLiveSmoke(requestText) && gateApplicability.smoke?.status !== "required") problems.push("deployment/TestFlight/provider-integration intake must require live smoke");

  if (!Array.isArray(document.redZone) || document.redZone.some((item) => !nonEmpty(item))) problems.push("route redZone must be a string array");
  else {
    if (new Set(document.redZone).size !== document.redZone.length) problems.push("route redZone contains duplicates");
    for (const boundary of MANDATORY_RED_ZONE) if (!document.redZone.includes(boundary)) problems.push(`route redZone missing mandatory boundary: ${boundary}`);
  }
  if (!Array.isArray(document.rejectedAlternatives)) problems.push("route rejectedAlternatives must be an array");
  if (!Array.isArray(document.authority?.allowedActions) || !Array.isArray(document.authority?.forbiddenActions)) problems.push("route authority must declare allowedActions and forbiddenActions arrays");
  else if (!sameJson(document.authority.allowedActions, intake?.allowedActions) || !sameJson(document.authority.forbiddenActions, intake?.forbiddenActions)) problems.push("route authority must match the authorized intake authority");
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
  const taxonomyPath = path.join(assetRoot, "controls", "workload-taxonomy.v1.json");
  const foundationCatalogPath = path.join(assetRoot, "controls", "foundation-layer.v1.json");
  const productionCatalogPath = path.join(assetRoot, "controls", "production-layers.v2.json");
  const aiCatalogPath = path.join(assetRoot, "controls", "genai-assurance.v1.json");
  const classificationPath = path.join(repoRoot, "run", "workload-classification.json");
  const adapterPath = [path.join(repoRoot, "project-adapter.json"), path.join(repoRoot, ".valdris-harness", "project-adapter.json")].find(existsSync);
  const mobileIosAdapter = adapterPath ? readJson(adapterPath).mobileIos : undefined;
  if (!existsSync(target)) return gateResult(args.file, { valid: false, problems: [`route missing: ${args.file}`] });
  try { gateResult(args.file, validateRouteDocument(readJson(target), { registry: readJson(registryPath), registryPath, domainIndex: readJson(domainIndexPath), domainIndexPath, productionCatalogPath, aiCatalogPath, foundationCatalogPath, taxonomyPath, taxonomy: readJson(taxonomyPath), catalogRoot, intake: readJson(intakePath), intakePath, classification: readJson(classificationPath), classificationPath, mobileIosAdapter })); }
  catch (error) { gateResult(args.file, { valid: false, problems: [`route or catalog must be valid JSON: ${error.message}`] }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
