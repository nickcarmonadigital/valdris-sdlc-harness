#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROL_STATUSES,
  EVIDENCE_TYPES,
  gateResult,
  parseRepoFileArgs,
  readJson,
} from "./control-gate-lib.mjs";

const EXPECTED_COMMIT = "77853d410438ce7a2909a94c2db41d258e3d04a0";
const EXPECTED_LAYERS = [
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
const EXPECTED_SOURCE_DOMAINS = Object.freeze({
  FND: "foundation",
  L01: "frontend",
  L02: "backend-api-logic",
  L03: "database-storage",
  L04: "auth-permissions-rls",
  L05: "hosting-deployment",
  L06: "cloud-compute",
  L07: "cicd-version-control",
  L08: "security",
  L09: "rate-limiting",
  L10: "caching-cdn",
  L11: "load-balancing-scaling",
  L12: "error-tracking-logs-observability",
  L13: "availability-recovery-dr",
});
const EXPECTED_SOURCE_FILES = Object.freeze({
  "harness/controls/baseline/L01-frontend-foundations.json": "8e312a1e01c54b3594685b97a4dbe4c62c4c07f09e16e28ac88add05d3fa1863",
  "harness/controls/baseline/L02-apis-and-backend-logic.json": "6adaf3666ebff974f5d6758a95e14727cda648a99dcccbb8f4d9990f5ebaa80a",
  "harness/controls/baseline/L03-database-and-storage.json": "e1825ca409746a109a86f19847b1ecba999bb48bbb5ee71b91206fe3988beaf3",
  "harness/controls/baseline/L04-authentication-and-permissions.json": "a2db62990420f8ccaa8cb46d7a919dd123d46e440b8d74ac5fb2b215157a54e6",
  "harness/controls/baseline/L05-hosting-and-deployment.json": "9fd7732dbfa38d66bee7139c48458d47f8ce047516789133ffeedc71749e336d",
  "harness/controls/baseline/L06-cloud-compute.json": "48f804acae8137094de81db70e664951de7e40a500922dd6cca162505f6a3cb2",
  "harness/controls/baseline/L07-ci-cd-and-version-control.json": "6a2dda364b0e2b841c65a83185eb33379a833e403c111794d463037cae3fe4aa",
  "harness/controls/baseline/L08-security-and-rls.json": "ff4b70c28bc78a8ea90cc7bbe3d2a32536c43dd933c149e1fcaf8bd2a26d206b",
  "harness/controls/baseline/L09-rate-limiting.json": "e1ef940b4111578bf5a2caecbd9c4f1c5f9521109356587d221cde038be75193",
  "harness/controls/baseline/L10-caching-and-cdn.json": "5ba8bc3e225cb39d371575230008cd348526c2038bacb6557924ce8c9916abf1",
  "harness/controls/baseline/L11-load-balancing-and-scaling.json": "70673428b1d54622d48c75e97dea2e31ec1cbc413179f06717096ea453bbf9ac",
  "harness/controls/baseline/L12-observability.json": "f074b5caf9a34785b988ad62e9f91f32d74260e74dcf66121c4d9b284c6da755",
  "harness/controls/baseline/L13-availability-and-recovery.json": "f7567cb136aa91eb20a8130319ad0a5dd32423f44018e82abad56c7ba77dc739",
  "harness/controls/profiles/ai-agentic.json": "5165c5b4b5bae81ca501c4867b84c0f2defc516b98708013851a1824986254f4",
  "harness/controls/profiles/saas.json": "170a5a037d3843c5e36cd22e6e952ad1e5b99457eef379d658e51c0a042842e3",
  "harness/controls/capabilities/async-workflows.json": "0efbd3137c13e79bda6b1f48d9072deec2ac92982f460266c6ff92537f8c9e8d",
});
const EXPECTED_SOURCE_CONTROLS = [
  "L01.FRONTEND.STATES.001",
  "L01.ACCESSIBILITY.BASELINE.001",
  "L01.PERFORMANCE.BUDGET.001",
  "L02.API.CONTRACT.001",
  "L02.LOGIC.INVARIANTS.001",
  "L02.ASYNC.IDEMPOTENCY.001",
  "L03.DATA.INTEGRITY.001",
  "L03.DATA.MIGRATION.001",
  "L03.DATA.LIFECYCLE.001",
  "L04.AUTHN.SESSION.001",
  "L04.AUTHZ.NEGATIVE.001",
  "L04.IDENTITY.SERVICE.001",
  "L05.DEPLOY.TOPOLOGY.001",
  "L05.DEPLOY.HEALTH.001",
  "L05.DEPLOY.ROLLBACK.001",
  "L06.COMPUTE.PROCESS.001",
  "L06.COMPUTE.RESOURCE.001",
  "L06.QUEUE.DLQ.001",
  "L07.CI.REQUIRED.001",
  "L07.QUALITY.STRATEGY.001",
  "L07.ARTIFACT.PROVENANCE.001",
  "L08.SECURITY.THREAT.001",
  "L08.SECURITY.SECRETS.001",
  "L08.SECURITY.DEPENDENCIES.001",
  "L08.SECURITY.DATA.001",
  "L09.LIMIT.REQUEST.001",
  "L09.LIMIT.BACKPRESSURE.001",
  "L09.LIMIT.PROVIDER.001",
  "L10.CACHE.POLICY.001",
  "L10.CACHE.INVALIDATION.001",
  "L10.CACHE.ISOLATION.001",
  "L11.SCALE.CAPACITY.001",
  "L11.SCALE.AUTOSCALING.001",
  "L11.SCALE.DEPENDENCY.001",
  "L12.OBS.LOGS.001",
  "L12.OBS.ALERTS.001",
  "L12.OBS.SLO.001",
  "L12.OBS.TRACES.001",
  "L13.RECOVERY.MONITORING.001",
  "L13.RECOVERY.BACKUP.001",
  "L13.RECOVERY.RESTORE.001",
  "L13.RECOVERY.INCIDENT.001",
  "AI.CONTEXT.BOUNDARY.001",
  "AI.EVAL.REGRESSION.001",
  "AI.TOOLS.AUTHZ.001",
  "AI.RAG.GROUNDING.001",
  "AI.SECURITY.INJECTION.001",
  "AI.BUDGET.USAGE.001",
  "AI.RECOVERY.PROVIDER.001",
  "SAAS.UI.DASHBOARD.001",
  "SAAS.API.WEBHOOK.001",
  "SAAS.DATA.TENANCY.001",
  "SAAS.AUTH.TEAMS.001",
  "SAAS.DEPLOY.TENANT.001",
  "SAAS.USAGE.METERING.001",
  "SAAS.OBS.TENANT.001",
  "CAP.ASYNC.STATE.001",
  "CAP.ASYNC.HANDOFF.001",
  "CAP.ASYNC.REPLAY.001",
  "CAP.ASYNC.OBSERVABILITY.001",
  "CAP.ASYNC.VERSIONING.001",
];
const EXPECTED_ASYNC_CONTROLS = Object.freeze({
  "ASYNC-STATE-001": "state",
  "ASYNC-HANDOFF-001": "handoff",
  "ASYNC-REPLAY-001": "replay",
  "ASYNC-OBSERVABILITY-001": "observability",
  "ASYNC-VERSIONING-001": "versioning",
});
const EXPECTED_ASYNC_SOURCE_TARGETS = Object.freeze({
  "CAP.ASYNC.STATE.001": "ASYNC-STATE-001",
  "CAP.ASYNC.HANDOFF.001": "ASYNC-HANDOFF-001",
  "CAP.ASYNC.REPLAY.001": "ASYNC-REPLAY-001",
  "CAP.ASYNC.OBSERVABILITY.001": "ASYNC-OBSERVABILITY-001",
  "CAP.ASYNC.VERSIONING.001": "ASYNC-VERSIONING-001",
});
const SOURCE_STATES = ["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE", "WAIVED", "UNKNOWN"];
const SOURCE_TO_UASH = Object.freeze({
  PASS: "passed",
  FAIL: "failed",
  BLOCKED: "blocked",
  NOT_APPLICABLE: "skipped",
  WAIVED: null,
  UNKNOWN: "pending",
});
const UASH_TO_SOURCE = Object.freeze({
  passed: "PASS",
  skipped: "NOT_APPLICABLE",
  required: "UNKNOWN",
  pending: "UNKNOWN",
  failed: "FAIL",
  blocked: "BLOCKED",
  needs_approval: "BLOCKED",
});
const LIFECYCLE_STAGES = ["specify", "design", "implement", "verify", "review", "release", "operate", "evolve"];
const FAILURE_POLICIES = ["block-stage", "block-release"];
const EVIDENCE_CATEGORIES = ["static", "executable", "runtime", "recovery", "human"];
const FILES = Object.freeze({
  foundation: "controls/foundation-layer.v1.json",
  production: "controls/production-layers.v2.json",
  ai: "controls/genai-assurance.v1.json",
  saas: "controls/domain-packs/saas.v1.json",
  taxonomy: "controls/workload-taxonomy.v1.json",
  policy: "controls/assurance-execution-policy.v1.json",
  crosswalk: "controls/crosswalks/thirteen-layers-to-uash.v1.json",
  asyncPack: "controls/capability-packs/async-workflows.v1.json",
});
const EXPECTED_OVERLAY_SEMANTIC_SHA256 = Object.freeze({
  policy: "8c44818fbdedf8c7bb3333e76fa53e5cd7256b035390fe49abf4abb899b62655",
  crosswalk: "41269ae1176199c79a7693438497b61bcaa4440d142ccdf4a32ea911ad2ed00e",
  asyncPack: "dbe9b82d84aa66be8285b057467b049bcba55a71a81b13cb54276d205dd87392",
});

function semanticSha256(document) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function sameSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value));
}

function requireVocabulary(actual, expected, label, problems) {
  if (!Array.isArray(actual) || !sameSet(actual, expected)) {
    problems.push(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function validApplicabilityPath(value) {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.split("/").includes("..")
    && !value.startsWith("!")
    && !path.posix.isAbsolute(value)
    && !/^[A-Za-z]:/.test(value);
}

function validateExecutionMetadata(entry, label, vocabularies, problems) {
  if (!vocabularies.tiers.has(entry?.minimumEffectiveTier)) {
    problems.push(`${label}.minimumEffectiveTier is not in the T0-T3 catalog vocabulary`);
  }
  if (!Array.isArray(entry?.lifecycleStages) || entry.lifecycleStages.length === 0) {
    problems.push(`${label}.lifecycleStages must be a non-empty array`);
  } else {
    for (const stage of entry.lifecycleStages) {
      if (!vocabularies.lifecycle.has(stage)) problems.push(`${label}.lifecycleStages contains unsupported stage: ${stage}`);
    }
    for (const stage of duplicates(entry.lifecycleStages)) problems.push(`${label}.lifecycleStages duplicates: ${stage}`);
  }
  const changedPaths = entry?.applicability?.anyChangedPath;
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    problems.push(`${label}.applicability.anyChangedPath must be a non-empty array`);
  } else {
    for (const candidate of changedPaths) {
      if (!validApplicabilityPath(candidate)) problems.push(`${label}.applicability.anyChangedPath contains unsafe or invalid path: ${String(candidate)}`);
    }
    for (const candidate of duplicates(changedPaths)) problems.push(`${label}.applicability.anyChangedPath duplicates: ${candidate}`);
  }
  if (!vocabularies.failure.has(entry?.failurePolicy)) {
    problems.push(`${label}.failurePolicy is unsupported: ${String(entry?.failurePolicy)}`);
  }
  const evidence = entry?.requiredEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Object.keys(evidence).length === 0) {
    problems.push(`${label}.requiredEvidence must be a non-empty object`);
  } else {
    for (const [category, identifiers] of Object.entries(evidence)) {
      if (!vocabularies.evidence.has(category)) {
        problems.push(`${label}.requiredEvidence has unsupported category: ${category}`);
        continue;
      }
      if (!Array.isArray(identifiers) || identifiers.length === 0 || identifiers.some((id) => typeof id !== "string" || !id.trim())) {
        problems.push(`${label}.requiredEvidence.${category} must be a non-empty string array`);
      } else {
        for (const id of duplicates(identifiers)) problems.push(`${label}.requiredEvidence.${category} duplicates: ${id}`);
      }
    }
  }
}

function readOverlay(repoRoot) {
  const documents = {};
  const missing = [];
  for (const [name, relative] of Object.entries(FILES)) {
    const target = path.join(repoRoot, relative);
    if (!existsSync(target)) missing.push(`assurance overlay file missing: ${relative}`);
    else documents[name] = readJson(target);
  }
  return { documents, missing };
}

export function validateAssuranceOverlay(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const problems = [];
  let documents;
  try {
    const loaded = readOverlay(root);
    problems.push(...loaded.missing);
    documents = loaded.documents;
  } catch (error) {
    return { checked: true, valid: false, problems: [`assurance overlay must contain valid JSON: ${error.message}`] };
  }
  if (problems.length) return { checked: true, valid: false, problems };

  const { foundation, production, ai, saas, taxonomy, policy, crosswalk, asyncPack } = documents;
  if (semanticSha256(policy) !== EXPECTED_OVERLAY_SEMANTIC_SHA256.policy) problems.push("execution policy semantic integrity mismatch");
  if (semanticSha256(crosswalk) !== EXPECTED_OVERLAY_SEMANTIC_SHA256.crosswalk) problems.push("crosswalk semantic integrity mismatch");
  if (semanticSha256(asyncPack) !== EXPECTED_OVERLAY_SEMANTIC_SHA256.asyncPack) problems.push("async capability pack semantic integrity mismatch");
  if (foundation.schema !== "uash.foundation-control-catalog.v1") problems.push("foundation catalog schema is not authoritative");
  if (foundation.layer?.id !== "foundation" || foundation.layer?.number !== 0) problems.push("Layer 0 must remain the authoritative foundation layer");
  if (production.schema !== "uash.production-control-catalog.v2") problems.push("production catalog schema is not authoritative");
  requireVocabulary((production.layers || []).map((layer) => layer.layer), EXPECTED_LAYERS, "production layer IDs", problems);
  if ((production.layers || []).some((layer) => layer.layer === "foundation")) problems.push("Layer 0 must not be installed inside the thirteen production domains");
  if (ai.schema !== "uash.ai-control-catalog.v1") problems.push("AI assurance catalog schema is not authoritative");
  if (saas.schema !== "uash.domain-control-catalog.v1" || saas.id !== "saas") problems.push("SaaS domain catalog is not authoritative");

  const foundationControlIds = (foundation.capabilities || []).flatMap((capability) => (capability.controls || []).map((control) => control.id));
  const productionControlEntries = (production.layers || []).flatMap((layer) => (layer.controls || []).map((control) => ({ ...control, layer: layer.layer })));
  const productionControlIds = productionControlEntries.map((control) => control.id);
  const productionById = new Map(productionControlEntries.map((control) => [control.id, control]));
  const aiControlIds = (ai.controls || []).map((control) => control.id);
  const saasControlIds = (saas.controls || []).map((control) => control.id);
  for (const id of duplicates(foundationControlIds)) problems.push(`duplicate foundation control ID: ${id}`);
  for (const id of duplicates(productionControlIds)) problems.push(`duplicate production control ID: ${id}`);
  for (const id of duplicates(aiControlIds)) problems.push(`duplicate AI control ID: ${id}`);
  for (const id of duplicates(saasControlIds)) problems.push(`duplicate SaaS control ID: ${id}`);

  const taxonomyTiers = (taxonomy.assuranceTiers || []).map((tier) => tier.id);
  requireVocabulary(taxonomyTiers, ["T0", "T1", "T2", "T3"], "assurance tier IDs", problems);

  if (policy.schema !== "uash.assurance-execution-policy.v1") problems.push("execution policy schema must be uash.assurance-execution-policy.v1");
  if (policy.appliesToCatalog !== FILES.production) problems.push("execution policy must target the authoritative production catalog");
  if (policy.sourceCrosswalk !== FILES.crosswalk) problems.push("execution policy must reference the checked crosswalk");
  requireVocabulary(policy.tierVocabulary, taxonomyTiers, "execution policy tier vocabulary", problems);
  requireVocabulary(policy.lifecycleVocabulary, LIFECYCLE_STAGES, "execution policy lifecycle vocabulary", problems);
  requireVocabulary(policy.failurePolicyVocabulary, FAILURE_POLICIES, "execution policy failure-policy vocabulary", problems);
  requireVocabulary(Object.keys(policy.evidenceCategoryMapping || {}), EVIDENCE_CATEGORIES, "execution policy evidence categories", problems);
  for (const [category, evidenceTypes] of Object.entries(policy.evidenceCategoryMapping || {})) {
    if (!Array.isArray(evidenceTypes) || evidenceTypes.length === 0) {
      problems.push(`execution policy evidence mapping ${category} must be non-empty`);
      continue;
    }
    for (const type of evidenceTypes) {
      if (!EVIDENCE_TYPES.has(type)) problems.push(`execution policy evidence mapping ${category} has unsupported UASH type: ${type}`);
    }
  }

  const policyControls = Array.isArray(policy.controls) ? policy.controls : [];
  const policyIds = policyControls.map((entry) => entry?.controlId);
  const policyById = new Map(policyControls.map((entry) => [entry?.controlId, entry]));
  const taxonomyTierRanks = new Map((taxonomy.assuranceTiers || []).map((tier) => [tier.id, tier.rank]));
  for (const id of duplicates(policyIds)) problems.push(`duplicate execution policy control: ${id}`);
  for (const id of productionControlIds.filter((candidate) => !policyIds.includes(candidate))) problems.push(`execution policy missing production control: ${id}`);
  for (const id of policyIds.filter((candidate) => !productionById.has(candidate))) problems.push(`execution policy targets unknown production control: ${id}`);
  const vocabularies = {
    tiers: new Set(taxonomyTiers),
    lifecycle: new Set(LIFECYCLE_STAGES),
    failure: new Set(FAILURE_POLICIES),
    evidence: new Set(EVIDENCE_CATEGORIES),
  };
  for (const entry of policyControls) {
    const label = `execution policy ${entry?.controlId || "<missing>"}`;
    validateExecutionMetadata(entry, label, vocabularies, problems);
    const target = productionById.get(entry?.controlId);
    if (target) {
      const qualifyingTypes = new Set(
        Object.keys(entry.requiredEvidence || {}).flatMap((category) => policy.evidenceCategoryMapping?.[category] || []),
      );
      if (!(target.proofPolicy?.types || []).some((type) => qualifyingTypes.has(type))) {
        problems.push(`${label}.requiredEvidence cannot satisfy the target control proof policy`);
      }
    }
  }

  if (asyncPack.schema !== "uash.cross-cutting-capability-catalog.v1") problems.push("async pack schema must be uash.cross-cutting-capability-catalog.v1");
  if (asyncPack.id !== "async-workflows") problems.push("async pack ID must be async-workflows");
  if (asyncPack.classification?.kind !== "cross-cutting-capability" || asyncPack.classification?.productionLayer !== false) {
    problems.push("async workflows must remain a cross-cutting capability, never a production layer");
  }
  if (asyncPack.sourceCrosswalk !== FILES.crosswalk) problems.push("async pack must reference the checked crosswalk");
  const asyncControls = Array.isArray(asyncPack.controls) ? asyncPack.controls : [];
  const asyncIds = asyncControls.map((control) => control?.id);
  requireVocabulary(asyncIds, Object.keys(EXPECTED_ASYNC_CONTROLS), "async capability control IDs", problems);
  const localControlIds = new Set([...foundationControlIds, ...productionControlIds, ...aiControlIds, ...saasControlIds, ...asyncIds]);
  let executionPolicyReferencesChecked = 0;
  for (const control of asyncControls) {
    const label = `async capability ${control?.id || "<missing>"}`;
    if (EXPECTED_ASYNC_CONTROLS[control?.id] !== control?.capability) problems.push(`${label}.capability is invalid`);
    validateExecutionMetadata(control, label, vocabularies, problems);
    if (!Array.isArray(control?.mappedControlIds) || control.mappedControlIds.length === 0) {
      problems.push(`${label}.mappedControlIds must be non-empty`);
    } else {
      for (const id of duplicates(control.mappedControlIds)) problems.push(`${label}.mappedControlIds duplicates: ${id}`);
      for (const id of control.mappedControlIds) {
        if (!foundationControlIds.includes(id) && !productionById.has(id)) problems.push(`${label} maps to unknown existing UASH control: ${id}`);
        if (productionById.has(id)) {
          const targetPolicy = policyById.get(id);
          executionPolicyReferencesChecked += 1;
          if (!targetPolicy) problems.push(`${label} maps to production control without execution policy: ${id}`);
          else if ((taxonomyTierRanks.get(control.minimumEffectiveTier) ?? -1) < (taxonomyTierRanks.get(targetPolicy.minimumEffectiveTier) ?? Number.POSITIVE_INFINITY)) {
            problems.push(`${label}.minimumEffectiveTier is weaker than mapped execution policy control: ${id}`);
          }
        }
      }
    }
    if (!Array.isArray(control?.mappedProductionLayers) || control.mappedProductionLayers.length === 0) {
      problems.push(`${label}.mappedProductionLayers must be non-empty`);
    } else {
      for (const layer of duplicates(control.mappedProductionLayers)) problems.push(`${label}.mappedProductionLayers duplicates: ${layer}`);
      for (const layer of control.mappedProductionLayers) {
        if (!EXPECTED_LAYERS.includes(layer)) problems.push(`${label} references unknown production layer: ${layer}`);
        const hasMappedControl = (control.mappedControlIds || []).some((id) => productionById.get(id)?.layer === layer);
        if (!hasMappedControl) problems.push(`${label} references production layer without a mapped control: ${layer}`);
      }
      for (const id of control.mappedControlIds || []) {
        const layer = productionById.get(id)?.layer;
        if (layer && !control.mappedProductionLayers.includes(layer)) problems.push(`${label} omits mapped control layer: ${layer}`);
      }
    }
  }

  const routingProjection = asyncPack.routingProjection || {};
  const routedConcern = (taxonomy.crossCuttingConcerns || []).find((concern) => concern.id === routingProjection.concernId);
  if (!routedConcern) problems.push("async routingProjection concernId must identify a workload-taxonomy concern");
  if (routingProjection.selectedBy !== "controls/workload-taxonomy.v1.json#crossCuttingConcerns" || routingProjection.activation !== "trigger-match") {
    problems.push("async routingProjection must use deterministic workload-taxonomy trigger selection");
  }
  if (routedConcern) {
    requireVocabulary(routingProjection.routedProductionLayers, routedConcern.productionLayers || [], "async routed production layers", problems);
    requireVocabulary(routingProjection.routedControlIds, routedConcern.controlIds || [], "async routed control IDs", problems);
  }
  const asyncLayerUnion = [...new Set(asyncControls.flatMap((control) => control.mappedProductionLayers || []))];
  const asyncControlUnion = new Set(asyncControls.flatMap((control) => control.mappedControlIds || []));
  for (const layer of routingProjection.routedProductionLayers || []) {
    if (!asyncLayerUnion.includes(layer)) problems.push(`async routingProjection routes layer not covered by the capability pack: ${layer}`);
  }
  for (const id of routingProjection.routedControlIds || []) {
    if (!asyncControlUnion.has(id)) problems.push(`async routingProjection routes control not covered by the capability pack: ${id}`);
    if (!policyById.has(id)) problems.push(`async routingProjection routes control without execution policy: ${id}`);
  }
  const deferredLayers = asyncLayerUnion.filter((layer) => !(routingProjection.routedProductionLayers || []).includes(layer));
  requireVocabulary(routingProjection.applicabilityDeferredProductionLayers, deferredLayers, "async applicability-deferred production layers", problems);

  if (crosswalk.schema !== "uash.thirteen-layers-crosswalk.v1") problems.push("crosswalk schema must be uash.thirteen-layers-crosswalk.v1");
  if (crosswalk.source?.commit !== EXPECTED_COMMIT) problems.push(`crosswalk source commit must be ${EXPECTED_COMMIT}`);
  if (crosswalk.source?.license !== "MIT") problems.push("crosswalk must retain the public source MIT license boundary");
  if (crosswalk.source?.installationMode !== "crosswalk-only") problems.push("public source controls must be crosswalked, not installed as a second runtime");
  if (crosswalk.target?.foundationCatalog !== FILES.foundation || crosswalk.target?.productionCatalog !== FILES.production
    || crosswalk.target?.aiCatalog !== FILES.ai
    || !sameSet(crosswalk.target?.domainCatalogs || [], [FILES.saas])
    || crosswalk.target?.executionPolicy !== FILES.policy
    || !sameSet(crosswalk.target?.capabilityPacks || [], [FILES.asyncPack])) {
    problems.push("crosswalk target paths must reference the local authoritative catalogs");
  }

  const sourceFiles = Array.isArray(crosswalk.source?.files) ? crosswalk.source.files : [];
  const sourceFilePaths = sourceFiles.map((file) => file?.path);
  for (const file of duplicates(sourceFilePaths)) problems.push(`duplicate source file manifest entry: ${file}`);
  requireVocabulary(sourceFilePaths, Object.keys(EXPECTED_SOURCE_FILES), "source file manifest", problems);
  for (const file of sourceFiles) {
    if (EXPECTED_SOURCE_FILES[file?.path] !== file?.sha256) problems.push(`source file digest mismatch: ${file?.path}`);
    if (!Array.isArray(file?.controlIds) || file.controlIds.length === 0) problems.push(`source file has no control IDs: ${file?.path}`);
  }
  const manifestSourceIds = sourceFiles.flatMap((file) => file.controlIds || []);
  for (const id of duplicates(manifestSourceIds)) problems.push(`duplicate source control in manifest: ${id}`);
  requireVocabulary(manifestSourceIds, EXPECTED_SOURCE_CONTROLS, "source control manifest", problems);

  const mappings = Array.isArray(crosswalk.mappings) ? crosswalk.mappings : [];
  const mappedSourceIds = mappings.map((mapping) => mapping?.sourceControlId);
  for (const id of duplicates(mappedSourceIds)) problems.push(`duplicate source control mapping: ${id}`);
  for (const id of EXPECTED_SOURCE_CONTROLS.filter((candidate) => !mappedSourceIds.includes(candidate))) problems.push(`unmapped source control: ${id}`);
  for (const id of mappedSourceIds.filter((candidate) => !EXPECTED_SOURCE_CONTROLS.includes(candidate))) problems.push(`unknown source control mapping: ${id}`);
  for (const mapping of mappings) {
    const label = `source mapping ${mapping?.sourceControlId || "<missing>"}`;
    if (!["equivalent", "distributed", "contributes-to", "capability-overlay"].includes(mapping?.relationship)) problems.push(`${label} has unsupported relationship`);
    if (mapping?.relationship === "contributes-to" && (typeof mapping?.targetExtension !== "string" || !mapping.targetExtension.trim())) {
      problems.push(`${label} contributes-to mapping requires a targetExtension note`);
    }
    if (!Array.isArray(mapping?.targetControlIds) || mapping.targetControlIds.length === 0) {
      problems.push(`${label} has no local target controls`);
    } else {
      for (const id of duplicates(mapping.targetControlIds)) problems.push(`${label} duplicates local target control: ${id}`);
      for (const id of mapping.targetControlIds) {
        if (!localControlIds.has(id)) problems.push(`${label} references unknown target control: ${id}`);
      }
    }
  }
  const baselineMappings = mappings.filter((mapping) => !mapping.sourceControlId?.startsWith("CAP.ASYNC."));
  const baselineTargets = new Set(baselineMappings.flatMap((mapping) => mapping.targetControlIds || []));
  for (const id of productionControlIds) {
    if (!baselineTargets.has(id)) problems.push(`production control has no public baseline crosswalk source: ${id}`);
  }
  for (const [source, target] of Object.entries(EXPECTED_ASYNC_SOURCE_TARGETS)) {
    const mapping = mappings.find((candidate) => candidate.sourceControlId === source);
    if (!mapping || !sameSet(mapping.targetControlIds || [], [target])) problems.push(`${source} must map only to local capability control ${target}`);
  }

  const domainMappings = Array.isArray(crosswalk.domainMapping) ? crosswalk.domainMapping : [];
  const mappedDomains = domainMappings.map((mapping) => mapping?.sourceDomain);
  for (const domain of duplicates(mappedDomains)) problems.push(`duplicate source domain mapping: ${domain}`);
  requireVocabulary(mappedDomains, Object.keys(EXPECTED_SOURCE_DOMAINS), "source domain mappings", problems);
  for (const mapping of domainMappings) {
    const expectedTarget = EXPECTED_SOURCE_DOMAINS[mapping?.sourceDomain];
    if (mapping?.targetLayer !== expectedTarget) problems.push(`source domain ${mapping?.sourceDomain} must map to ${expectedTarget}`);
    const expectedClassification = mapping?.sourceDomain === "FND" ? "layer-zero" : "production-domain";
    if (mapping?.classification !== expectedClassification) problems.push(`source domain ${mapping?.sourceDomain} has invalid classification`);
  }

  const stateMapping = crosswalk.stateMapping || {};
  requireVocabulary(stateMapping.sourceVocabulary, SOURCE_STATES, "source state vocabulary", problems);
  requireVocabulary(stateMapping.uashVocabulary, [...CONTROL_STATUSES], "UASH state vocabulary", problems);
  const sourceToUash = Array.isArray(stateMapping.sourceToUash) ? stateMapping.sourceToUash : [];
  const mappedSourceStates = sourceToUash.map((mapping) => mapping?.source);
  for (const state of duplicates(mappedSourceStates)) problems.push(`duplicate source state mapping: ${state}`);
  requireVocabulary(mappedSourceStates, SOURCE_STATES, "source-to-UASH state mappings", problems);
  for (const mapping of sourceToUash) {
    if (mapping?.controlStatus !== SOURCE_TO_UASH[mapping?.source]) problems.push(`source state ${mapping?.source} has invalid UASH control status`);
    const shouldPass = ["PASS", "NOT_APPLICABLE"].includes(mapping?.source);
    if (mapping?.countsAsPass !== shouldPass) problems.push(`source state ${mapping?.source} has invalid completion disposition`);
  }
  const waived = sourceToUash.find((mapping) => mapping.source === "WAIVED");
  if (!waived || waived.controlStatus !== null || waived.waiverLedgerStatus !== "active" || waived.countsAsPass !== false || waived.requiresHumanApproval !== true) {
    problems.push("WAIVED must remain a separate human-approved waiver-ledger state and must never be passed");
  }
  if (!/never changes a control to passed/i.test(stateMapping.waiverInvariant || "")) problems.push("WAIVED invariant must explicitly forbid conversion to passed");

  const uashToSource = Array.isArray(stateMapping.uashToSource) ? stateMapping.uashToSource : [];
  const mappedUashStates = uashToSource.map((mapping) => mapping?.uash);
  for (const state of duplicates(mappedUashStates)) problems.push(`duplicate UASH state mapping: ${state}`);
  requireVocabulary(mappedUashStates, [...CONTROL_STATUSES], "UASH-to-source state mappings", problems);
  for (const mapping of uashToSource) {
    if (mapping?.source !== UASH_TO_SOURCE[mapping?.uash]) problems.push(`UASH state ${mapping?.uash} has invalid source state`);
  }

  return {
    checked: true,
    valid: problems.length === 0,
    sourceCommit: crosswalk.source?.commit,
    sourceControls: manifestSourceIds.length,
    policyControls: policyControls.length,
    capabilityControls: asyncControls.length,
    layerZero: foundation.layer?.number,
    productionLayers: production.layers?.length,
    crossCuttingCapability: asyncPack.id,
    executionPolicyConsumed: executionPolicyReferencesChecked > 0,
    routedConcern: routedConcern?.id,
    problems,
  };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/schema-compat-gate.mjs --repo .");
  gateResult("assurance overlay", validateAssuranceOverlay(args.repo));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
