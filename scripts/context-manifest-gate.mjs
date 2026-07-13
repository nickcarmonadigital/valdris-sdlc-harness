#!/usr/bin/env node
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  resolveWithinRepo,
  sha256File,
} from "./control-gate-lib.mjs";

export const CONTEXT_MANIFEST_SCHEMA = "uash.context-manifest.v1";
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);

function isSecretLike(relativePath) {
  const segments = relativePath.replaceAll("\\", "/").toLowerCase().split("/").filter(Boolean);
  return segments.some((segment) => segment === ".env" || segment.startsWith(".env.") || segment === ".npmrc" || segment === ".pypirc" || segment === "kubeconfig"
    || /^(credentials?|secrets?|keys?|service[-_]?account)(\..+)?$/.test(segment)
    || /\.(pem|p12|pfx|key|jks|keystore)$/.test(segment));
}

function isRealPathWithinRepo(repoRoot, target) {
  const root = realpathSync(repoRoot);
  const realTarget = realpathSync(target);
  const relative = path.relative(root, realTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function baseFailure(problems) {
  return { checked: true, valid: false, schema: null, loadedFileCount: 0, problems };
}

export function validateContextManifestDocument(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  if (!document || typeof document !== "object" || Array.isArray(document)) return baseFailure(["context manifest must be a JSON object"]);
  const problems = [];
  if (document.schema !== CONTEXT_MANIFEST_SCHEMA) problems.push(`context manifest schema must be ${CONTEXT_MANIFEST_SCHEMA}`);
  if (!isIsoTimestamp(document.generatedAt)) problems.push("context manifest generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId)) problems.push("context manifest runId is required");
  if (!PROFILES.has(document.profile)) problems.push("context manifest profile is invalid");
  if (!nonEmpty(document.environment)) problems.push("context manifest environment is required");
  if (!nonEmpty(document.commit)) problems.push("context manifest commit is required");

  const loadedFiles = Array.isArray(document.loadedFiles) ? document.loadedFiles : [];
  if (!Array.isArray(document.loadedFiles) || loadedFiles.length === 0) problems.push("context manifest loadedFiles must be a non-empty array");
  const seen = new Set();
  for (const [index, entry] of loadedFiles.entries()) {
    const label = `context manifest loadedFiles[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const relativePath = nonEmpty(entry.path);
    if (!relativePath) {
      problems.push(`${label}.path is required`);
      continue;
    }
    if (path.isAbsolute(relativePath)) problems.push(`${label}.path must be repository-relative`);
    const normalized = relativePath.replaceAll("\\", "/");
    if (seen.has(normalized)) problems.push(`context manifest loaded file duplicated: ${relativePath}`);
    else seen.add(normalized);
    if (isSecretLike(relativePath)) problems.push(`${label}.path is secret-like and must not be loaded: ${relativePath}`);
    if (!/^[a-f0-9]{64}$/i.test(nonEmpty(entry.sha256))) problems.push(`${label}.sha256 must be a SHA-256 hex digest`);
    if (!isIsoTimestamp(entry.loadedAt)) problems.push(`${label}.loadedAt must be an ISO timestamp`);
    if (isIsoTimestamp(entry.loadedAt) && isIsoTimestamp(document.generatedAt)
      && Date.parse(entry.loadedAt) > Date.parse(document.generatedAt)) {
      problems.push(`${label}.loadedAt must not be after generatedAt`);
    }

    const target = resolveWithinRepo(repoRoot, relativePath);
    if (!target) {
      problems.push(`${label}.path must stay inside the repository`);
      continue;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      problems.push(`${label}.path does not exist: ${relativePath}`);
      continue;
    }
    if (!isRealPathWithinRepo(repoRoot, target)) {
      problems.push(`${label}.path resolves outside the repository: ${relativePath}`);
      continue;
    }
    if (/^[a-f0-9]{64}$/i.test(nonEmpty(entry.sha256)) && sha256File(target) !== entry.sha256.toLowerCase()) {
      problems.push(`${label}.sha256 does not match ${relativePath}`);
    }
  }

  return {
    checked: true,
    valid: problems.length === 0,
    schema: document.schema,
    commit: document.commit,
    runId: document.runId,
    loadedFileCount: loadedFiles.length,
    problems,
  };
}

export function validateContextManifest(filePath, options = {}) {
  try {
    return validateContextManifestDocument(readJson(filePath), options);
  } catch (error) {
    return baseFailure([`context manifest must be valid JSON: ${error.message}`]);
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "context/manifest.json" });
  if (args.help) {
    console.log("Usage: node scripts/context-manifest-gate.mjs --repo . [--file context/manifest.json]");
    return;
  }
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target)) return gateResult(args.file, baseFailure([`context manifest missing: ${args.file}`]));
  gateResult(args.file, validateContextManifest(target, { repoRoot }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, problems: [error.message] }, null, 2));
    process.exit(1);
  });
}
