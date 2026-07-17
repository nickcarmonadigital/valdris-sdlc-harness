#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, parseRepoFileArgs, readJson } from "./control-gate-lib.mjs";
import { validateCatalogIntegrity } from "./catalog-integrity-gate.mjs";
import { PRODUCTION_LAYERS } from "./production-layer-gate.mjs";
import {
  validateWorkloadClassification,
  validateWorkloadTaxonomy,
} from "./workload-classifier-lib.mjs";

const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function jsonValueSha256(filePath) {
  return createHash("sha256").update(JSON.stringify(JSON.parse(readFileSync(filePath, "utf8")))).digest("hex");
}

function assetPaths(assetRoot) {
  return {
    taxonomy: path.join(assetRoot, "controls", "workload-taxonomy.v1.json"),
    foundation: path.join(assetRoot, "controls", "foundation-layer.v1.json"),
    production: path.join(assetRoot, "controls", "production-layers.v2.json"),
    ai: path.join(assetRoot, "controls", "genai-assurance.v1.json"),
    domainIndex: path.join(assetRoot, "controls", "domain-packs", "index.json"),
  };
}

export function validateWorkloadClassificationFile(filePath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.dirname(path.dirname(filePath)));
  const assetRoot = path.resolve(options.assetRoot || ASSET_ROOT);
  const paths = assetPaths(assetRoot);
  const missing = Object.entries(paths).filter(([, target]) => !existsSync(target)).map(([name]) => `workload classification asset missing: ${name}`);
  if (missing.length) return { checked: true, valid: false, problems: missing };
  try {
    const document = readJson(filePath);
    const intakePath = path.join(repoRoot, "run", "intake.json");
    if (!existsSync(intakePath)) return { checked: true, valid: false, schema: document.schema, problems: ["workload classification requires run/intake.json"] };
    const taxonomy = readJson(paths.taxonomy);
    const production = readJson(paths.production);
    const ai = readJson(paths.ai);
    const domainIndex = readJson(paths.domainIndex);
    const productionControlIds = (production.layers || []).flatMap((layer) => (layer.controls || []).map((control) => control.id));
    const aiControlIds = (ai.controls || []).map((control) => control.id);
    const domainPackIds = (domainIndex.packs || []).map((pack) => pack.id);
    const catalogDigests = Object.fromEntries(Object.entries(paths).map(([name, target]) => [name, jsonValueSha256(target)]));
    const problems = [
      ...validateCatalogIntegrity(assetRoot).problems,
      ...validateWorkloadTaxonomy(taxonomy, { productionLayers: PRODUCTION_LAYERS, productionControlIds, aiControlIds, domainPackIds }),
      ...validateWorkloadClassification(document, {
        intake: readJson(intakePath),
        taxonomy,
        domainIndex,
        productionLayers: PRODUCTION_LAYERS,
        productionCatalog: production,
        expectedCatalogDigests: catalogDigests,
      }),
    ];
    return {
      checked: true,
      valid: problems.length === 0,
      schema: document.schema,
      runId: document.runId,
      requestedProfile: document.requestedProfile,
      effectiveTier: document.effectiveTier,
      taskType: document.taskType,
      workloadProfiles: document.workloadProfiles || [],
      crossCuttingConcerns: document.crossCuttingConcerns || [],
      problems,
    };
  } catch (error) {
    return { checked: true, valid: false, problems: [`workload classification or catalog must be valid JSON: ${error.message}`] };
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "run/workload-classification.json" });
  if (args.help) return console.log("Usage: node scripts/workload-classification-gate.mjs --repo . [--file run/workload-classification.json]");
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) return gateResult(args.file, { checked: true, valid: false, problems: [`workload classification missing: ${args.file}`] });
  gateResult(args.file, validateWorkloadClassificationFile(target, { repoRoot }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
