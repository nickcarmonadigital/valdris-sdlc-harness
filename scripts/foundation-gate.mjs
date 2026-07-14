#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  existingFileWithinRepo,
  evidencePolicyForEffectiveTier,
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  validateControl,
} from "./control-gate-lib.mjs";

export const FOUNDATION_ASSESSMENT_SCHEMA = "uash.foundation-assessment.v1";
export const FOUNDATION_CATALOG_SCHEMA = "uash.foundation-control-catalog.v1";
export const CANONICAL_FOUNDATION_CATALOG_SHA256 = "a7403ada1c5dad44e126544337a5c2884ac1eaac43e6f6c2daf1bb2df90b319e";
const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const APPLICABILITY = new Set(["required", "not-applicable"]);
const EVIDENCE_TYPES = new Set(["artifact", "command", "metric", "approval", "provider-report"]);
const PROTOTYPE_REQUIRED_CAPABILITIES = new Set(["product-domain", "requirements-acceptance"]);
const CONTROLLED_DOCUMENTATION_REQUIRED_CAPABILITIES = new Set(["product-domain", "requirements-acceptance", "decisions-ownership-risk"]);
const FOUNDATION_CONTROL_IDS = Object.freeze({
  "product-domain": ["FND-PRODUCT-001", "FND-DOMAIN-001"],
  "requirements-acceptance": ["FND-REQ-001", "FND-ACCEPTANCE-001"],
  "quality-attributes": ["FND-QUALITY-001", "FND-FAILURE-001"],
  "architecture-boundaries": ["FND-ARCH-001", "FND-BOUNDARY-001"],
  "data-transactions": ["FND-DATA-001", "FND-TRANSACTION-001"],
  "engineering-test-strategy": ["FND-ENGINEERING-001", "FND-TEST-001"],
  "decisions-ownership-risk": ["FND-DECISION-001", "FND-RISK-001"],
});

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function validateCatalog(catalog) {
  const problems = [];
  if (catalog?.schema !== FOUNDATION_CATALOG_SCHEMA) problems.push(`foundation catalog schema must be ${FOUNDATION_CATALOG_SCHEMA}`);
  if (createHash("sha256").update(JSON.stringify(catalog)).digest("hex") !== CANONICAL_FOUNDATION_CATALOG_SHA256) problems.push("foundation catalog does not match the locked canonical v1 policy; change the catalog and validator together under a reviewed version update");
  if (catalog?.layer?.id !== "foundation" || catalog?.layer?.number !== 0 || !nonEmpty(catalog?.layer?.title)) problems.push("foundation catalog must define Layer 0 with id foundation");
  const capabilities = Array.isArray(catalog?.capabilities) ? catalog.capabilities : [];
  if (capabilities.length < 7) problems.push("foundation catalog must define at least seven foundation capabilities");
  const capabilityIds = new Set();
  const controlIds = new Set();
  const graph = new Map();
  for (const capability of capabilities) {
    const id = nonEmpty(capability?.id);
    if (!id || !nonEmpty(capability?.title) || !nonEmpty(capability?.description)) problems.push(`foundation catalog has an invalid capability: ${id || "missing"}`);
    if (capabilityIds.has(id)) problems.push(`foundation capability duplicated: ${id}`);
    capabilityIds.add(id);
    const dependencies = Array.isArray(capability?.dependencies) ? capability.dependencies : [];
    graph.set(id, dependencies);
    const controls = Array.isArray(capability?.controls) ? capability.controls : [];
    if (controls.length === 0) problems.push(`foundation capability ${id || "missing"} has no controls`);
    const actualControlIds = new Set();
    for (const control of controls) {
      const controlId = nonEmpty(control?.id);
      if (!controlId || !nonEmpty(control?.requirement)) problems.push(`foundation capability ${id || "missing"} has an invalid control`);
      if (controlIds.has(controlId)) problems.push(`foundation control duplicated: ${controlId}`);
      controlIds.add(controlId);
      actualControlIds.add(controlId);
      const types = control?.proofPolicy?.types;
      if (!Array.isArray(types) || types.length === 0 || types.some((type) => !EVIDENCE_TYPES.has(type))) problems.push(`foundation control ${controlId || "missing"} has invalid proofPolicy.types`);
    }
    const expectedControlIds = new Set(FOUNDATION_CONTROL_IDS[id] || []);
    for (const controlId of expectedControlIds) if (!actualControlIds.has(controlId)) problems.push(`foundation capability ${id || "missing"} missing canonical control: ${controlId}`);
    for (const controlId of actualControlIds) if (!expectedControlIds.has(controlId)) problems.push(`foundation capability ${id || "missing"} has non-canonical control: ${controlId}`);
  }
  for (const id of Object.keys(FOUNDATION_CONTROL_IDS)) if (!capabilityIds.has(id)) problems.push(`foundation catalog missing canonical capability: ${id}`);
  for (const id of capabilityIds) if (!Object.hasOwn(FOUNDATION_CONTROL_IDS, id)) problems.push(`foundation catalog has non-canonical capability: ${id}`);
  for (const [id, dependencies] of graph) for (const dependency of dependencies) if (!capabilityIds.has(dependency)) problems.push(`foundation capability ${id} has unknown dependency: ${dependency}`);
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      problems.push(`foundation catalog dependency cycle includes: ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of capabilityIds) visit(id);
  return problems;
}

export function validateFoundationAssessmentDocument(document, options = {}) {
  const { repoRoot = process.cwd(), catalog, classification, evidenceProfile, minimumTechnicalTrust } = options;
  const problems = validateCatalog(catalog);
  if (!document || typeof document !== "object" || Array.isArray(document)) return { checked: true, valid: false, problems: ["foundation assessment must be a JSON object"] };
  if (document.schema !== FOUNDATION_ASSESSMENT_SCHEMA) problems.push(`foundation assessment schema must be ${FOUNDATION_ASSESSMENT_SCHEMA}`);
  if (!isIsoTimestamp(document.generatedAt)) problems.push("foundation assessment generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId)) problems.push("foundation assessment runId is required");
  if (document.status !== "passed") problems.push("foundation assessment status must be passed");
  if (!nonEmpty(document.summary)) problems.push("foundation assessment summary is required");
  if (!PROFILES.has(document.profile)) problems.push("foundation assessment profile is invalid");
  if (!nonEmpty(document.environment)) problems.push("foundation assessment environment is required");
  if (!nonEmpty(document.commit)) problems.push("foundation assessment commit is required");
  if (!nonEmpty(document.owner)) problems.push("foundation assessment owner is required");
  if (classification) {
    if (document.runId !== classification.runId) problems.push("foundation assessment runId must match workload classification");
    if (document.profile !== classification.requestedProfile) problems.push("foundation assessment profile must match workload classification");
    if (document.effectiveTier !== classification.effectiveTier) problems.push("foundation assessment effectiveTier must match workload classification");
    if (document.commit !== classification.commit) problems.push("foundation assessment commit must match workload classification");
    if (document.environment !== classification.environment) problems.push("foundation assessment environment must match workload classification");
  }

  const catalogCapabilities = new Map((catalog?.capabilities || []).map((capability) => [capability.id, capability]));
  const entries = Array.isArray(document.capabilities) ? document.capabilities : [];
  const seen = new Map();
  for (const entry of entries) {
    const id = nonEmpty(entry?.id);
    if (!id || !catalogCapabilities.has(id)) {
      problems.push(`foundation assessment has unknown capability: ${id || "missing"}`);
      continue;
    }
    if (seen.has(id)) problems.push(`foundation assessment capability duplicated: ${id}`);
    seen.set(id, entry);
    if (!nonEmpty(entry.owner)) problems.push(`foundation capability ${id} owner is required`);
    if (!APPLICABILITY.has(entry.applicability)) problems.push(`foundation capability ${id} applicability must be required or not-applicable`);
    if (entry.applicability === "not-applicable") {
      if (entry.status !== "skipped") problems.push(`foundation capability ${id} must be skipped when not-applicable`);
      if (!nonEmpty(entry.reason || entry.skipReason)) problems.push(`foundation capability ${id} skipped without reason`);
      if (classification?.controlledDocumentation === true) {
        if (CONTROLLED_DOCUMENTATION_REQUIRED_CAPABILITIES.has(id)) problems.push(`controlled-documentation foundation capability ${id} must remain required`);
      } else {
        if (document.profile !== "prototype") problems.push(`foundation capability ${id} cannot be not-applicable for ${document.profile}`);
        if (PROTOTYPE_REQUIRED_CAPABILITIES.has(id)) problems.push(`prototype foundation capability ${id} must remain required`);
      }
      continue;
    }
    if (classification?.controlledDocumentation === true && !CONTROLLED_DOCUMENTATION_REQUIRED_CAPABILITIES.has(id)) problems.push(`controlled-documentation foundation capability ${id} must be not-applicable`);
    if (entry.status !== "passed") problems.push(`required foundation capability ${id} must be passed`);
    const definition = catalogCapabilities.get(id);
    const definitionsById = new Map((definition.controls || []).map((control) => [control.id, control]));
    const controls = Array.isArray(entry.controls) ? entry.controls : [];
    const seenControls = new Set();
    for (const control of controls) {
      const controlId = nonEmpty(control?.id);
      if (seenControls.has(controlId)) problems.push(`foundation control duplicated in ${id}: ${controlId}`);
      seenControls.add(controlId);
      const controlDefinition = definitionsById.get(controlId);
      if (!controlDefinition) {
        problems.push(`foundation capability ${id} has unknown control: ${controlId || "missing"}`);
        continue;
      }
      problems.push(...validateControl(control, { repoRoot, profile: evidenceProfile, minimumTechnicalTrust, label: `foundation control ${controlId}`, allowSkipped: false, asOf: document.generatedAt, runId: document.runId, commit: document.commit, environment: document.environment }));
      const allowedTypes = controlDefinition.proofPolicy.types;
      if (control?.status === "passed" && !control.evidence?.some((evidence) => allowedTypes.includes(evidence?.type))) problems.push(`foundation control ${controlId} requires evidence type: ${allowedTypes.join(" or ")}`);
    }
    for (const control of definition.controls || []) if (!seenControls.has(control.id)) problems.push(`foundation capability ${id} missing control: ${control.id}`);
  }
  for (const id of catalogCapabilities.keys()) if (!seen.has(id)) problems.push(`foundation capability missing: ${id}`);
  for (const [id, entry] of seen) {
    if (entry.applicability !== "required") continue;
    if (classification?.controlledDocumentation === true) continue;
    for (const dependency of catalogCapabilities.get(id)?.dependencies || []) {
      if (seen.get(dependency)?.applicability !== "required" || seen.get(dependency)?.status !== "passed") problems.push(`required foundation capability ${id} depends on passing required capability: ${dependency}`);
    }
  }
  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    runId: document.runId,
    profile: document.profile,
    capabilityCount: seen.size,
    passedCapabilities: [...seen.values()].filter((entry) => entry.status === "passed").length,
    skippedCapabilities: [...seen.values()].filter((entry) => entry.status === "skipped").length,
    problems,
  };
}

export function validateFoundationAssessment(filePath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.dirname(path.dirname(filePath)));
  const catalogPath = path.resolve(options.catalogPath || path.join(ASSET_ROOT, "controls", "foundation-layer.v1.json"));
  const classificationPath = path.resolve(options.classificationPath || path.join(repoRoot, "run", "workload-classification.json"));
  const taxonomyPath = path.resolve(options.taxonomyPath || path.join(ASSET_ROOT, "controls", "workload-taxonomy.v1.json"));
  try {
    if (!existsSync(catalogPath)) return { checked: true, valid: false, problems: [`foundation catalog missing: ${catalogPath}`] };
    if (!existingFileWithinRepo(repoRoot, classificationPath)) return { checked: true, valid: false, problems: ["foundation assessment requires a real non-symlink run/workload-classification.json inside the repository"] };
    if (!existsSync(taxonomyPath)) return { checked: true, valid: false, problems: [`workload taxonomy missing: ${taxonomyPath}`] };
    const document = readJson(filePath);
    if (document.catalogSha256 !== sha256File(catalogPath)) return { checked: true, valid: false, schema: document.schema, problems: ["foundation assessment catalogSha256 does not match the foundation catalog"] };
    if (document.workloadClassificationSha256 !== sha256File(classificationPath)) return { checked: true, valid: false, schema: document.schema, problems: ["foundation assessment workloadClassificationSha256 does not match run/workload-classification.json"] };
    const classification = readJson(classificationPath);
    const taxonomy = readJson(taxonomyPath);
    const tier = (taxonomy.assuranceTiers || []).find((candidate) => candidate.id === classification.effectiveTier);
    if (!tier) return { checked: true, valid: false, schema: document.schema, problems: [`foundation assessment effective tier is not defined by the workload taxonomy: ${classification.effectiveTier || "missing"}`] };
    const evidencePolicy = evidencePolicyForEffectiveTier(classification.effectiveTier);
    if (!evidencePolicy) return { checked: true, valid: false, schema: document.schema, problems: [`foundation assessment effective tier has no evidence policy: ${classification.effectiveTier || "missing"}`] };
    if (tier.minimumTechnicalTrust !== evidencePolicy.minimumTechnicalTrust || tier.externalAttestationRequired !== evidencePolicy.externalAttestationRequired) return { checked: true, valid: false, schema: document.schema, problems: [`foundation assessment evidence policy disagrees with workload taxonomy for ${classification.effectiveTier}`] };
    return validateFoundationAssessmentDocument(document, { repoRoot, catalog: readJson(catalogPath), classification, evidenceProfile: evidencePolicy.profile, minimumTechnicalTrust: evidencePolicy.minimumTechnicalTrust });
  } catch (error) {
    return { checked: true, valid: false, problems: [`foundation assessment or catalog must be valid JSON: ${error.message}`] };
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "foundation/assessment.json", catalog: "controls/foundation-layer.v1.json" });
  if (args.help) return console.log("Usage: node scripts/foundation-gate.mjs --repo . [--file foundation/assessment.json] [--catalog controls/foundation-layer.v1.json]");
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) return gateResult(args.file, { checked: true, valid: false, problems: [`foundation assessment missing: ${args.file}`] });
  const catalogPath = args.catalog === "controls/foundation-layer.v1.json" ? path.join(ASSET_ROOT, "controls", "foundation-layer.v1.json") : path.resolve(repoRoot, args.catalog);
  gateResult(args.file, validateFoundationAssessment(target, { repoRoot, catalogPath }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
