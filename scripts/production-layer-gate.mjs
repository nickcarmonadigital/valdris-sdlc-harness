#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCKING_STATUSES,
  existingFileWithinRepo,
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  validateControl,
} from "./control-gate-lib.mjs";

export const PRODUCTION_LAYER_SCHEMA = "uash.production-readiness.v1";
export const PRODUCTION_LAYER_SCHEMA_V2 = "uash.production-readiness.v2";
export const PRODUCTION_CONTROL_CATALOG_SCHEMA = "uash.production-control-catalog.v2";
const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PRODUCTION_LAYERS = [
  "frontend",
  "backend-api-logic",
  "database-storage",
  "auth-permissions-rls",
  "hosting-deployment",
  "cloud-compute",
  "cicd-version-control",
  "security",
  "rate-limiting",
  "caching-cdn",
  "load-balancing-scaling",
  "error-tracking-logs-observability",
  "availability-recovery-dr",
];

const V1_ALLOWED = new Set(["passed", "skipped", "required", "pending", "failed", "blocked", "needs_approval"]);
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const PRODUCTION_CONTROL_IDS = {
  "frontend": ["FE-ACCESSIBILITY-001", "FE-BEHAVIOR-001", "FE-PERFORMANCE-001"],
  "backend-api-logic": ["API-CONTRACT-001", "API-FAILURE-001", "API-TRACE-001"],
  "database-storage": ["DATA-MIGRATION-001", "DATA-INTEGRITY-001", "DATA-RECOVERY-001"],
  "auth-permissions-rls": ["AUTH-AUTHZ-001", "AUTH-TENANT-001", "AUTH-LIFECYCLE-001"],
  "hosting-deployment": ["DEPLOY-PROMOTION-001", "DEPLOY-HEALTH-001", "DEPLOY-ROLLBACK-001"],
  "cloud-compute": ["CLOUD-IAC-001", "CLOUD-BOUNDARY-001", "CLOUD-COST-001"],
  "cicd-version-control": ["CI-GATES-001", "CI-SUPPLYCHAIN-001", "CI-PROVENANCE-001"],
  "security": ["SEC-THREAT-001", "SEC-SECRETS-001", "SEC-VULNERABILITY-001"],
  "rate-limiting": ["RATE-POLICY-001", "RATE-FAILURE-001", "RATE-METERING-001"],
  "caching-cdn": ["CACHE-KEY-001", "CACHE-INVALIDATION-001", "CACHE-ISOLATION-001"],
  "load-balancing-scaling": ["SCALE-CAPACITY-001", "SCALE-PROGRESSIVE-001", "SCALE-FAILOVER-001"],
  "error-tracking-logs-observability": ["OBS-TELEMETRY-001", "OBS-SLO-001", "OBS-REDACTION-001"],
  "availability-recovery-dr": ["DR-OBJECTIVES-001", "DR-RESTORE-001", "DR-INCIDENT-001"],
};
const METRIC_CONTROLS = new Set(["FE-PERFORMANCE-001", "DEPLOY-HEALTH-001", "CLOUD-COST-001", "RATE-METERING-001", "SCALE-CAPACITY-001", "OBS-SLO-001", "DR-OBJECTIVES-001"]);
const COMMAND_CONTROLS = new Set(["FE-ACCESSIBILITY-001", "FE-BEHAVIOR-001", "API-CONTRACT-001", "API-FAILURE-001", "DATA-MIGRATION-001", "DATA-INTEGRITY-001", "DATA-RECOVERY-001", "AUTH-AUTHZ-001", "AUTH-TENANT-001", "AUTH-LIFECYCLE-001", "DEPLOY-ROLLBACK-001", "CI-GATES-001", "CI-SUPPLYCHAIN-001", "SEC-SECRETS-001", "SEC-VULNERABILITY-001", "RATE-FAILURE-001", "CACHE-KEY-001", "CACHE-INVALIDATION-001", "CACHE-ISOLATION-001", "SCALE-PROGRESSIVE-001", "SCALE-FAILOVER-001", "DR-RESTORE-001"]);

function requiredEvidenceTypes(controlId) {
  if (METRIC_CONTROLS.has(controlId)) return ["metric"];
  if (COMMAND_CONTROLS.has(controlId)) return ["command"];
  return ["artifact", "provider-report"];
}

function normalizedLayerEntries(document) {
  if (Array.isArray(document.layers)) return document.layers;
  if (document.layers && typeof document.layers === "object") {
    return Object.entries(document.layers).map(([layer, value]) => value && typeof value === "object" && !Array.isArray(value) ? { layer, ...value } : { layer, status: value });
  }
  return [];
}

function hasLegacyEvidence(layer) {
  const values = [layer.evidence, layer.evidencePath, layer.proof, layer.proofPath];
  if (values.some(nonEmpty)) return true;
  if (Array.isArray(layer.proof) && layer.proof.some(nonEmpty)) return true;
  if (Array.isArray(layer.proofPaths) && layer.proofPaths.some(nonEmpty)) return true;
  if (Array.isArray(layer.artifacts) && layer.artifacts.some(nonEmpty)) return true;
  return Array.isArray(layer.commands) && layer.commands.some((command) => command && typeof command === "object" && command.exitCode === 0);
}

function baseFailure(schema, problems) {
  return { checked: true, valid: false, schema, layerCount: 0, passedLayers: 0, skippedLayers: 0, blockingLayers: [], problems };
}

function validateV1(document) {
  const problems = [];
  if (!isIsoTimestamp(document.generatedAt)) problems.push("production layer assessment generatedAt must be an ISO timestamp");
  if (document.status !== "passed") problems.push("production layer assessment status must be passed before finish-line completion");
  if (!nonEmpty(document.summary)) problems.push("production layer assessment summary is required");
  const entries = normalizedLayerEntries(document);
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push("production layer entries must be objects");
      continue;
    }
    const layer = nonEmpty(entry.layer || entry.id || entry.slug);
    const status = nonEmpty(entry.status);
    if (!layer) {
      problems.push("production layer entry missing layer/id/slug");
      continue;
    }
    if (seen.has(layer)) problems.push(`production layer duplicated: ${layer}`);
    seen.set(layer, { ...entry, layer, status });
    if (!PRODUCTION_LAYERS.includes(layer)) problems.push(`production layer is not canonical: ${layer}`);
    if (!V1_ALLOWED.has(status)) problems.push(`production layer ${layer} has unsupported status: ${status || "missing"}`);
    if (status === "skipped" && !nonEmpty(entry.reason || entry.skipReason)) problems.push(`production layer ${layer} skipped without reason`);
    if (status === "passed" && !hasLegacyEvidence(entry)) problems.push(`production layer ${layer} passed without evidence`);
    if (status === "failed") {
      if (!nonEmpty(entry.failureReason)) problems.push(`production layer ${layer} failed without failureReason`);
      if (!nonEmpty(entry.recoveryPath)) problems.push(`production layer ${layer} failed without recoveryPath`);
    }
    if (BLOCKING_STATUSES.has(status)) problems.push(`production layer ${layer} is still ${status}`);
  }
  for (const layer of PRODUCTION_LAYERS.filter((item) => !seen.has(item))) problems.push(`production layer missing: ${layer}`);
  return summarize(document, seen, problems);
}

function validateCatalog(catalog) {
  const problems = [];
  if (catalog?.schema !== PRODUCTION_CONTROL_CATALOG_SCHEMA) problems.push(`production catalog schema must be ${PRODUCTION_CONTROL_CATALOG_SCHEMA}`);
  if (!Array.isArray(catalog?.layers) || catalog.layers.length !== PRODUCTION_LAYERS.length) problems.push("production catalog must contain 13 layers");
  const seenLayers = new Set();
  const seenControls = new Set();
  const graph = new Map();
  for (const layer of catalog?.layers || []) {
    const id = nonEmpty(layer.layer);
    if (!PRODUCTION_LAYERS.includes(id)) problems.push(`production catalog layer is not canonical: ${id || "missing"}`);
    if (seenLayers.has(id)) problems.push(`production catalog layer duplicated: ${id}`);
    seenLayers.add(id);
    const dependencies = Array.isArray(layer.dependencies) ? layer.dependencies : [];
    graph.set(id, dependencies);
    for (const dependency of dependencies) if (!PRODUCTION_LAYERS.includes(dependency)) problems.push(`production catalog ${id} has unknown dependency: ${dependency}`);
    if (!Array.isArray(layer.controls) || layer.controls.length === 0) problems.push(`production catalog ${id} has no controls`);
    const actualIds = (layer.controls || []).map((control) => control.id);
    for (const expected of PRODUCTION_CONTROL_IDS[id] || []) if (!actualIds.includes(expected)) problems.push(`production catalog ${id} missing canonical control: ${expected}`);
    for (const actual of actualIds) if (!(PRODUCTION_CONTROL_IDS[id] || []).includes(actual)) problems.push(`production catalog ${id} has unknown control: ${actual}`);
    for (const control of layer.controls || []) {
      const controlId = nonEmpty(control.id);
      if (!controlId || !nonEmpty(control.requirement)) problems.push(`production catalog ${id} has an invalid control`);
      if (seenControls.has(controlId)) problems.push(`production control duplicated: ${controlId}`);
      seenControls.add(controlId);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(layer) {
    if (visiting.has(layer)) {
      problems.push(`production catalog dependency cycle includes: ${layer}`);
      return;
    }
    if (visited.has(layer)) return;
    visiting.add(layer);
    for (const dependency of graph.get(layer) || []) visit(dependency);
    visiting.delete(layer);
    visited.add(layer);
  }
  for (const layer of graph.keys()) visit(layer);
  return problems;
}

function validateV2(document, options) {
  const { repoRoot, catalog } = options;
  const problems = validateCatalog(catalog);
  if (!isIsoTimestamp(document.generatedAt)) problems.push("production assessment generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId)) problems.push("production assessment runId is required");
  if (document.status !== "passed") problems.push("production assessment status must be passed");
  if (!nonEmpty(document.summary)) problems.push("production assessment summary is required");
  if (!PROFILES.has(document.profile)) problems.push("production assessment profile is invalid");
  if (!nonEmpty(document.environment)) problems.push("production assessment environment is required");
  if (!nonEmpty(document.commit)) problems.push("production assessment commit is required");

  const catalogByLayer = new Map((catalog?.layers || []).map((item) => [item.layer, item]));
  const entries = normalizedLayerEntries(document);
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push("production layer entries must be objects");
      continue;
    }
    const layer = nonEmpty(entry.layer);
    const status = nonEmpty(entry.status);
    if (!layer) {
      problems.push("production layer entry missing layer");
      continue;
    }
    if (seen.has(layer)) problems.push(`production layer duplicated: ${layer}`);
    seen.set(layer, { ...entry, layer, status });
    const definition = catalogByLayer.get(layer);
    if (!definition) {
      problems.push(`production layer is not canonical: ${layer}`);
      continue;
    }
    if (!nonEmpty(entry.owner)) problems.push(`production layer ${layer} owner is required`);
    if (!new Set(["required", "not-applicable"]).has(entry.applicability)) problems.push(`production layer ${layer} applicability must be required or not-applicable`);
    if (entry.applicability === "not-applicable") {
      if (status !== "skipped") problems.push(`production layer ${layer} must be skipped when not-applicable`);
      if (!nonEmpty(entry.reason || entry.skipReason)) problems.push(`production layer ${layer} skipped without reason`);
      continue;
    }
    if (status !== "passed") problems.push(`required production layer ${layer} must be passed`);
    const controls = Array.isArray(entry.controls) ? entry.controls : [];
    const controlsById = new Map();
    for (const control of controls) {
      const id = nonEmpty(control?.id);
      if (controlsById.has(id)) problems.push(`production control duplicated in ${layer}: ${id}`);
      controlsById.set(id, control);
      if (!definition.controls.some((item) => item.id === id)) problems.push(`production layer ${layer} has unknown control: ${id || "missing"}`);
      problems.push(...validateControl(control, { repoRoot, profile: document.profile, label: `production control ${id || "missing"}`, allowSkipped: false, asOf: document.generatedAt, runId: document.runId, commit: document.commit, environment: document.environment }));
      if (control?.status === "passed" && !control.evidence?.some((evidence) => requiredEvidenceTypes(id).includes(evidence?.type))) problems.push(`production control ${id} requires evidence type: ${requiredEvidenceTypes(id).join(" or ")}`);
    }
    for (const required of definition.controls) if (!controlsById.has(required.id)) problems.push(`production layer ${layer} missing control: ${required.id}`);
    if (Array.isArray(entry.dependencies)) {
      for (const dependency of entry.dependencies) if (!definition.dependencies.includes(dependency)) problems.push(`production layer ${layer} declares unknown dependency: ${dependency}`);
    }
  }
  for (const layer of PRODUCTION_LAYERS.filter((item) => !seen.has(item))) problems.push(`production layer missing: ${layer}`);
  const requiredEntries = Array.from(seen.values()).filter((entry) => entry.applicability === "required");
  if (requiredEntries.length === 0) problems.push("production assessment must contain at least one required layer; skip the production node instead when no production layer applies");
  const alwaysRequired = document.profile === "prototype" ? [] : ["security", "cicd-version-control", "error-tracking-logs-observability"];
  for (const layer of alwaysRequired) if (seen.get(layer)?.applicability !== "required") problems.push(`production profile ${document.profile} requires cross-cutting layer: ${layer}`);
  for (const entry of requiredEntries) {
    const definition = catalogByLayer.get(entry.layer);
    for (const dependency of definition?.dependencies || []) {
      if (seen.get(dependency)?.applicability !== "required" || seen.get(dependency)?.status !== "passed") problems.push(`required production layer ${entry.layer} depends on passing required layer: ${dependency}`);
    }
  }
  return summarize(document, seen, problems);
}

function summarize(document, seen, problems) {
  const values = Array.from(seen.values());
  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    profile: document.profile,
    layerCount: seen.size,
    canonicalLayerCount: PRODUCTION_LAYERS.length,
    passedLayers: values.filter((entry) => entry.status === "passed").length,
    skippedLayers: values.filter((entry) => entry.status === "skipped").length,
    blockingLayers: values.filter((entry) => BLOCKING_STATUSES.has(entry.status)).map((entry) => entry.layer),
    layers: PRODUCTION_LAYERS.map((layer) => ({ layer, status: seen.get(layer)?.status || "missing" })),
    problems,
  };
}

export function validateProductionLayerAssessmentDocument(document, options = {}) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return baseFailure(null, ["production layer assessment must be a JSON object"]);
  if (document.schema === PRODUCTION_LAYER_SCHEMA && options.allowLegacy !== true) return baseFailure(document.schema, [`legacy ${PRODUCTION_LAYER_SCHEMA} is historical-only; explicit allowLegacy is required`]);
  if (document.schema === PRODUCTION_LAYER_SCHEMA) return validateV1(document);
  if (document.schema !== PRODUCTION_LAYER_SCHEMA_V2) return baseFailure(document.schema, [`production layer assessment schema must be ${PRODUCTION_LAYER_SCHEMA_V2} (or legacy ${PRODUCTION_LAYER_SCHEMA})`]);
  return validateV2(document, options);
}

export function validateProductionLayerAssessment(filePath, options = {}) {
  const repoRoot = options.repoRoot || path.resolve(path.dirname(filePath), "..");
  const requestedCatalogPath = options.catalogPath || path.join(repoRoot, "controls", "production-layers.v2.json");
  const catalogPath = existsSync(requestedCatalogPath) ? requestedCatalogPath : path.join(ASSET_ROOT, "controls", "production-layers.v2.json");
  try {
    const document = readJson(filePath);
    if (document.schema === PRODUCTION_LAYER_SCHEMA && options.allowLegacy !== true) return baseFailure(document.schema, [`legacy ${PRODUCTION_LAYER_SCHEMA} is historical-only; current finish lines require ${PRODUCTION_LAYER_SCHEMA_V2}`]);
    if (document.schema === PRODUCTION_LAYER_SCHEMA) return validateProductionLayerAssessmentDocument(document, { repoRoot, allowLegacy: true });
    if (document.schema !== PRODUCTION_LAYER_SCHEMA_V2) return validateProductionLayerAssessmentDocument(document, { repoRoot });
    const catalogRoot = path.resolve(catalogPath, "..", "..");
    if (!existingFileWithinRepo(catalogRoot, catalogPath)) return baseFailure(document.schema, [`production control catalog missing or unsafe: ${catalogPath}`]);
    return validateProductionLayerAssessmentDocument(document, { repoRoot, catalog: readJson(catalogPath) });
  } catch (error) {
    return baseFailure(null, [`production layer assessment or catalog must be valid JSON: ${error.message}`]);
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "production/layer-assessment.json", catalog: "controls/production-layers.v2.json" });
  if (args.help) {
    console.log("Usage: node scripts/production-layer-gate.mjs --repo . [--file production/layer-assessment.json] [--catalog controls/production-layers.v2.json] [--allow-legacy]");
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) return gateResult(args.file, baseFailure(null, [`production layer assessment missing: ${args.file}`]));
  const catalogPath = args.catalog === "controls/production-layers.v2.json" ? path.join(ASSET_ROOT, "controls", "production-layers.v2.json") : path.resolve(repoRoot, args.catalog);
  gateResult(args.file, validateProductionLayerAssessment(target, { repoRoot, catalogPath, allowLegacy: Boolean(args.allowLegacy) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
