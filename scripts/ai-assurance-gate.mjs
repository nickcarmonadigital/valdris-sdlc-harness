#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evidencePolicyForEffectiveTier, existingFileWithinRepo, gateResult, isIsoTimestamp, nonEmpty, parseRepoFileArgs, readJson, sha256File, validateControl } from "./control-gate-lib.mjs";

export const AI_ASSURANCE_SCHEMA = "uash.ai-assurance.v1";
export const AI_CONTROL_CATALOG_SCHEMA = "uash.ai-control-catalog.v1";
export const CANONICAL_AI_CATALOG_SHA256 = "dbdfe7854f000dd6312f0c7c08fc882ec1b39bec411de9ccd52a423c3a358ebc";
const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const AI_PROFILES = new Set(["AI-0", "AI-1", "AI-2", "AI-3"]);
const AI_CONTROL_IDS = ["AI-INVENTORY-001", "AI-EVAL-001", "AI-DATA-001", "AI-RAG-001", "AI-SAFETY-001", "AI-TOOLS-001", "AI-MEMORY-001", "AI-OBS-001", "AI-COST-001", "AI-LIFECYCLE-001"];
const AI_CONDITIONALS = { "AI-RAG-001": "rag", "AI-TOOLS-001": "tools", "AI-MEMORY-001": "memory" };

export function validateAiAssurance(document, options) {
  const { repoRoot, catalog, classification, classificationSha256, evidenceProfile, minimumTechnicalTrust } = options;
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["AI assurance artifact must be a JSON object"] };
  if (document.schema !== AI_ASSURANCE_SCHEMA) problems.push(`AI assurance schema must be ${AI_ASSURANCE_SCHEMA}`);
  if (catalog?.schema !== AI_CONTROL_CATALOG_SCHEMA || !Array.isArray(catalog.controls)) problems.push(`AI control catalog schema must be ${AI_CONTROL_CATALOG_SCHEMA}`);
  if (createHash("sha256").update(JSON.stringify(catalog)).digest("hex") !== CANONICAL_AI_CATALOG_SHA256) problems.push("AI control catalog does not match the locked canonical v1 policy; change the catalog and validator together under a reviewed version update");
  const catalogIds = Array.isArray(catalog?.controls) ? catalog.controls.map((control) => control.id) : [];
  for (const id of AI_CONTROL_IDS) if (!catalogIds.includes(id)) problems.push(`AI control catalog missing canonical control: ${id}`);
  for (const id of catalogIds) if (!AI_CONTROL_IDS.includes(id)) problems.push(`AI control catalog contains unknown control: ${id}`);
  for (const control of catalog?.controls || []) {
    if (!nonEmpty(control.requirement)) problems.push(`AI control catalog ${control.id || "missing"} requirement is required`);
    const expectedConditional = AI_CONDITIONALS[control.id];
    if ((control.conditional || undefined) !== expectedConditional) problems.push(`AI control catalog ${control.id || "missing"} conditional must be ${expectedConditional || "absent"}`);
  }
  if (!isIsoTimestamp(document.generatedAt)) problems.push("AI assurance generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId)) problems.push("AI assurance runId is required");
  if (!PROFILES.has(document.profile)) problems.push("AI assurance profile is invalid");
  if (!nonEmpty(document.environment)) problems.push("AI assurance environment is required");
  if (!nonEmpty(document.commit)) problems.push("AI assurance commit is required");
  if (!evidencePolicyForEffectiveTier(document.effectiveTier)) problems.push("AI assurance effectiveTier is invalid");
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.workloadClassificationSha256))) problems.push("AI assurance workloadClassificationSha256 must be a SHA-256 digest");
  if (classification) {
    if (document.runId !== classification.runId) problems.push("AI assurance runId must match workload classification");
    if (document.profile !== classification.requestedProfile) problems.push("AI assurance profile must match workload classification");
    if (document.effectiveTier !== classification.effectiveTier) problems.push("AI assurance effectiveTier must match workload classification");
    if (document.commit !== classification.commit) problems.push("AI assurance commit must match workload classification");
    if (document.environment !== classification.environment) problems.push("AI assurance environment must match workload classification");
    if (document.workloadClassificationSha256 !== classificationSha256) problems.push("AI assurance workloadClassificationSha256 does not match run/workload-classification.json");
    if (document.workloadDetected !== classification.ai?.workloadDetected) problems.push("AI assurance workloadDetected must match workload classification");
    if (document.aiProfile !== classification.ai?.aiProfile) problems.push("AI assurance aiProfile must match workload classification");
    for (const feature of ["rag", "tools", "memory", "consequential", "userFacing", "sensitiveData", "autonomous"]) if (document.features?.[feature] !== classification.ai?.features?.[feature]) problems.push(`AI assurance features.${feature} must match workload classification`);
  }
  if (typeof document.workloadDetected !== "boolean") problems.push("AI assurance workloadDetected must be boolean");

  if (document.workloadDetected === false) {
    if (document.aiProfile !== "AI-0") problems.push("AI assurance without an AI workload must use aiProfile AI-0");
    if (document.status !== "skipped") problems.push("AI assurance without an AI workload must have skipped status");
    if (!nonEmpty(document.skipReason)) problems.push("AI assurance skipped without skipReason");
    return { valid: problems.length === 0, schema: document.schema, workloadDetected: false, controlCount: 0, problems };
  }

  if (document.status !== "passed") problems.push("AI assurance status must be passed when an AI workload is detected");
  if (!AI_PROFILES.has(document.aiProfile) || document.aiProfile === "AI-0") problems.push("detected AI workload must use aiProfile AI-1, AI-2, or AI-3");
  const features = document.features && typeof document.features === "object" ? document.features : {};
  for (const feature of ["rag", "tools", "memory", "consequential", "userFacing", "sensitiveData", "autonomous"]) if (typeof features[feature] !== "boolean") problems.push(`AI assurance features.${feature} must be boolean`);
  if (features.consequential === true && document.aiProfile !== "AI-3") problems.push("consequential AI behavior requires aiProfile AI-3");
  if (features.sensitiveData === true && document.aiProfile !== "AI-3") problems.push("sensitive-data AI behavior requires aiProfile AI-3");
  if (features.autonomous === true && document.aiProfile !== "AI-3") problems.push("autonomous AI behavior requires aiProfile AI-3");
  if (document.aiProfile === "AI-1" && ["rag", "tools", "memory", "consequential", "userFacing", "sensitiveData", "autonomous"].some((feature) => features[feature] === true)) problems.push("AI-1 is limited to bounded internal assistive behavior without RAG, tools, memory, sensitive data, autonomy, or direct user exposure");
  const expected = (catalog?.controls || []).filter((control) => !control.conditional || features[control.conditional] === true);
  const controls = Array.isArray(document.controls) ? document.controls : [];
  const seen = new Set();
  for (const control of controls) {
    const id = nonEmpty(control?.id);
    if (seen.has(id)) problems.push(`AI assurance control duplicated: ${id}`);
    seen.add(id);
    const definition = (catalog?.controls || []).find((item) => item.id === id);
    if (!definition) problems.push(`AI assurance has unknown control: ${id || "missing"}`);
    else if (definition.conditional && features[definition.conditional] !== true) problems.push(`AI assurance included inactive conditional control: ${id}`);
    problems.push(...validateControl(control, { repoRoot, profile: evidenceProfile, minimumTechnicalTrust, label: `AI control ${id || "missing"}`, allowSkipped: false, asOf: document.generatedAt, runId: document.runId, commit: document.commit, environment: document.environment }));
  }
  for (const control of expected) if (!seen.has(control.id)) problems.push(`AI assurance missing control: ${control.id}`);
  return { valid: problems.length === 0, schema: document.schema, workloadDetected: true, expectedControls: expected.length, controlCount: seen.size, problems };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "ai/assurance.json", catalog: "controls/genai-assurance.v1.json" });
  if (args.help) return console.log("Usage: node scripts/ai-assurance-gate.mjs --repo . [--file ai/assurance.json] [--catalog controls/genai-assurance.v1.json]");
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  const requestedCatalogPath = path.resolve(repoRoot, args.catalog);
  const catalogPath = args.catalog === "controls/genai-assurance.v1.json" ? path.join(ASSET_ROOT, "controls", "genai-assurance.v1.json") : requestedCatalogPath;
  if (!existsSync(target)) return gateResult(args.file, { valid: false, problems: [`AI assurance artifact missing: ${args.file}`] });
  const catalogRoot = path.resolve(catalogPath, "..", "..");
  if (!existingFileWithinRepo(catalogRoot, catalogPath)) return gateResult(args.file, { valid: false, problems: [`AI control catalog missing or unsafe: ${catalogPath}`] });
  const classificationPath = path.join(repoRoot, "run", "workload-classification.json");
  if (!existingFileWithinRepo(repoRoot, classificationPath)) return gateResult(args.file, { valid: false, problems: ["AI assurance requires a real non-symlink run/workload-classification.json inside the repository"] });
  try {
    const classification = readJson(classificationPath);
    const evidencePolicy = evidencePolicyForEffectiveTier(classification.effectiveTier);
    if (!evidencePolicy) return gateResult(args.file, { valid: false, problems: [`AI assurance effective tier has no evidence policy: ${classification.effectiveTier || "missing"}`] });
    gateResult(args.file, validateAiAssurance(readJson(target), { repoRoot, catalog: readJson(catalogPath), classification, classificationSha256: sha256File(classificationPath), evidenceProfile: evidencePolicy.profile, minimumTechnicalTrust: evidencePolicy.minimumTechnicalTrust }));
  }
  catch (error) { gateResult(args.file, { valid: false, problems: [`AI assurance artifact or catalog must be valid JSON: ${error.message}`] }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
