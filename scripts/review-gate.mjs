#!/usr/bin/env node
import { verify as verifySignature } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentSelfGrantProblems,
  canonicalJson,
  fileSha256,
  readJson,
  resolveArtifactPath,
  safeIdentifier,
  secretDisclosureProblems,
  sha256,
  validatePortableProof,
} from "./proof-runner.mjs";

export const REVIEW_SCHEMA = "valdris.review.v1";
const SHA256 = /^[a-f0-9]{64}$/i;
const ACTOR_TYPES = new Set(["agent", "human", "service"]);
const REVIEW_TRUST_SCHEMA = "valdris.review-trust.v1";
const REVIEW_ATTESTATION_SCHEME = "ed25519";
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function nonEmpty(value, minimum = 1) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function provenanceProblems(provenance, label, digestField) {
  const problems = [];
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return [`${label} is required`];
  for (const field of ["actorId", "sessionId", "executionId"]) {
    if (!safeIdentifier(provenance[field])) problems.push(`${label}.${field} is invalid`);
  }
  if (!ACTOR_TYPES.has(provenance.actorType)) problems.push(`${label}.actorType is invalid`);
  if (!SHA256.test(provenance[digestField] || "")) problems.push(`${label}.${digestField} must be a SHA-256 digest`);
  return problems;
}

export function reviewAttestationPayload(document) {
  return {
    schema: document.schema,
    generatedAt: document.generatedAt,
    runId: document.runId,
    commit: document.commit,
    environment: document.environment,
    status: document.status,
    subject: document.subject,
    validationRuntimeSha256: document.validationRuntimeSha256,
    evidenceBundleSha256: document.evidenceBundleSha256,
    implementationProvenance: document.implementationProvenance,
    reviewProvenance: document.reviewProvenance,
    decision: document.decision,
    findings: document.findings,
    blockers: document.blockers,
    attestation: {
      scheme: document.attestation?.scheme,
      keyId: document.attestation?.keyId,
      signedAt: document.attestation?.signedAt,
    },
  };
}

function attestationProblems(document, repoRoot, options = {}) {
  const problems = [];
  const attestation = document.attestation;
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return ["review requires a cryptographically verified attestation"];
  if (attestation.scheme !== REVIEW_ATTESTATION_SCHEME) problems.push(`review attestation.scheme must be ${REVIEW_ATTESTATION_SCHEME}`);
  if (!safeIdentifier(attestation.keyId)) problems.push("review attestation.keyId is invalid");
  if (typeof attestation.signedAt !== "string" || Number.isNaN(Date.parse(attestation.signedAt))) problems.push("review attestation.signedAt must be an ISO timestamp");
  if (!SHA256.test(attestation.payloadSha256 || "")) problems.push("review attestation.payloadSha256 must be a SHA-256 digest");
  if (typeof attestation.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(attestation.signature)) problems.push("review attestation.signature must be base64");

  let trustStore;
  let trustPath;
  let trustPathRelative;
  try {
    const runtimeTrustPath = path.join(RUNTIME_ROOT, "controls", "review-trust.v1.json");
    trustPathRelative = path.relative(repoRoot, runtimeTrustPath).split(path.sep).join("/");
    if (!trustPathRelative || trustPathRelative === ".." || trustPathRelative.startsWith("../") || path.isAbsolute(trustPathRelative)) {
      throw new Error("review runtime must be installed inside the target Git worktree");
    }
    const configured = options.trustStorePath || trustPathRelative;
    trustPath = resolveArtifactPath(repoRoot, configured, { mustExist: true });
    const normalized = path.relative(repoRoot, trustPath).split(path.sep).join("/");
    if (normalized !== trustPathRelative || path.resolve(trustPath) !== path.resolve(runtimeTrustPath)) throw new Error(`trust store must use canonical runtime path ${trustPathRelative}`);
    trustStore = readJson(trustPath);
    const adapterPath = path.join(RUNTIME_ROOT, "project-adapter.json");
    if (existsSync(adapterPath)) {
      const adapter = readJson(adapterPath);
      if (adapter.reviewTrust?.path !== trustPathRelative) throw new Error(`project adapter reviewTrust.path must be ${trustPathRelative}`);
    }
  } catch (error) {
    problems.push(`review trust store is invalid: ${error.message}`);
    return problems;
  }
  if (trustStore?.schema !== REVIEW_TRUST_SCHEMA) problems.push(`review trust store schema must be ${REVIEW_TRUST_SCHEMA}`);
  if (!Array.isArray(trustStore?.keys)) problems.push("review trust store keys must be an array");
  if (/^[a-f0-9]{40,64}$/i.test(document.commit || "") && trustPath) {
    const committed = spawnSync("git", ["show", `${document.commit}:${trustPathRelative}`], { cwd: repoRoot, encoding: "utf8", shell: false, timeout: 30_000, killSignal: "SIGTERM", stdio: ["ignore", "pipe", "pipe"] });
    if (committed.status !== 0) problems.push("review trust store is not present at the reviewed commit");
    else {
      try {
        const committedTrustStore = JSON.parse(committed.stdout);
        if (canonicalJson(committedTrustStore) !== canonicalJson(trustStore)) problems.push("review trust store differs from the reviewed commit");
      } catch (error) {
        problems.push(`review trust store at the reviewed commit is invalid: ${error.message}`);
      }
    }
  } else {
    problems.push("review commit must be a Git commit hash for trust-store verification");
  }
  const keys = (trustStore?.keys || []).filter((entry) => entry?.status === "active" && entry?.keyId === attestation?.keyId);
  if (keys.length !== 1) {
    problems.push("review attestation keyId must resolve to exactly one active trusted key");
    return problems;
  }
  const key = keys[0];
  if (key.algorithm !== REVIEW_ATTESTATION_SCHEME) problems.push(`review trusted key algorithm must be ${REVIEW_ATTESTATION_SCHEME}`);
  if (typeof key.publicKeyPem !== "string" || !key.publicKeyPem.includes("BEGIN PUBLIC KEY")) problems.push("review trusted key publicKeyPem is invalid");
  if (Array.isArray(key.allowedActorIds) && !key.allowedActorIds.includes(document.reviewProvenance?.actorId)) problems.push("review actor is not authorized by the attestation key");
  if (Array.isArray(key.allowedActorTypes) && !key.allowedActorTypes.includes(document.reviewProvenance?.actorType)) problems.push("review actor type is not authorized by the attestation key");

  const payload = reviewAttestationPayload(document);
  const serialized = canonicalJson(payload);
  const payloadSha256 = sha256(serialized);
  if (SHA256.test(attestation.payloadSha256 || "") && attestation.payloadSha256 !== payloadSha256) problems.push("review attestation payload digest does not match the signed review");
  if (problems.length === 0) {
    try {
      const valid = verifySignature(null, Buffer.from(serialized, "utf8"), key.publicKeyPem, Buffer.from(attestation.signature, "base64"));
      if (!valid) problems.push("review attestation signature is invalid");
    } catch (error) {
      problems.push(`review attestation signature verification failed: ${error.message}`);
    }
  }
  return problems;
}

export function validateReviewArtifact(document, repoRoot, options = {}) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["review artifact must be a JSON object"] };
  if (document.schema !== REVIEW_SCHEMA) problems.push(`review schema must be ${REVIEW_SCHEMA}`);
  if (document.status !== "passed") problems.push("review status must be passed");
  if (!safeIdentifier(document.runId)) problems.push("review runId is invalid");
  if (!safeIdentifier(document.commit)) problems.push("review commit is invalid");
  if (!safeIdentifier(document.environment)) problems.push("review environment is invalid");
  if (!nonEmpty(document.subject?.artifact)) problems.push("review subject.artifact is required");
  if (!SHA256.test(document.subject?.sha256 || "")) problems.push("review subject.sha256 must be a SHA-256 digest");
  if (!SHA256.test(document.validationRuntimeSha256 || "")) problems.push("review validationRuntimeSha256 must bind the reviewed validator/catalog closure");
  if (!SHA256.test(document.evidenceBundleSha256 || "")) problems.push("review evidenceBundleSha256 must bind all reviewed inputs and required evidence");
  problems.push(...provenanceProblems(document.implementationProvenance, "implementationProvenance", "artifactSha256"));
  problems.push(...provenanceProblems(document.reviewProvenance, "reviewProvenance", "observedArtifactSha256"));

  const implementation = document.implementationProvenance || {};
  const reviewer = document.reviewProvenance || {};
  for (const field of ["actorId", "sessionId", "executionId"]) {
    if (implementation[field] && implementation[field] === reviewer[field]) problems.push(`review is not independent: ${field} matches implementation provenance`);
  }
  if (implementation.artifactSha256 !== document.subject?.sha256) problems.push("implementation provenance is not bound to the reviewed subject");
  if (reviewer.observedArtifactSha256 !== document.subject?.sha256) problems.push("review provenance is not bound to the reviewed subject");

  if (document.decision?.status !== "accepted") problems.push("review decision must be accepted");
  if (!nonEmpty(document.decision?.summary, 8)) problems.push("review decision.summary is required");
  if (!Array.isArray(document.findings)) problems.push("review findings must be an array");
  if (!Array.isArray(document.blockers)) problems.push("review blockers must be an array");
  else {
    for (const [index, blocker] of document.blockers.entries()) {
      if (!blocker || typeof blocker !== "object" || !new Set(["resolved", "closed"]).has(blocker.status)) problems.push(`review blocker ${index + 1} remains open`);
    }
  }
  for (const [index, finding] of (document.findings || []).entries()) {
    if (new Set(["blocker", "critical"]).has(finding?.severity) && !new Set(["resolved", "closed"]).has(finding?.status)) problems.push(`review finding ${index + 1} is an open blocker`);
  }
  problems.push(...attestationProblems(document, repoRoot, options));

  if (nonEmpty(document.subject?.artifact)) {
    try {
      const subjectPath = resolveArtifactPath(repoRoot, document.subject.artifact, { mustExist: true });
      if (SHA256.test(document.subject.sha256 || "") && fileSha256(subjectPath) !== document.subject.sha256) problems.push("review subject digest does not match the artifact");
      try {
        const subject = readJson(subjectPath);
        if (subject.schema === "valdris.portable-proof.v1") {
          const validation = validatePortableProof(subject);
          if (!validation.valid) problems.push(`reviewed portable proof is invalid: ${validation.problems.join("; ")}`);
          if (subject.run?.id !== document.runId || subject.run?.commit !== document.commit || subject.run?.environment !== document.environment) problems.push("reviewed portable proof subject does not match the review");
        }
      } catch {
        // Reviews may target non-JSON artifacts; their digest still binds the subject.
      }
    } catch (error) {
      problems.push(`review subject is invalid: ${error.message}`);
    }
  }

  problems.push(...agentSelfGrantProblems(document, "review"));
  problems.push(...secretDisclosureProblems(document));
  return { valid: problems.length === 0, problems, blockerCount: (document.blockers || []).filter((entry) => !new Set(["resolved", "closed"]).has(entry?.status)).length };
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), file: "review/review.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--file") args.file = argv[++index];
    else if (arg === "--trust-store") args.trustStorePath = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/review-gate.mjs --repo . [--file review/review.json] [--trust-store <exact runtime trust path>]");
  const repoRoot = path.resolve(args.repo);
  const file = resolveArtifactPath(repoRoot, args.file, { mustExist: true });
  const result = validateReviewArtifact(readJson(file), repoRoot, { trustStorePath: args.trustStorePath });
  console.log(JSON.stringify({ ok: result.valid, artifact: path.relative(repoRoot, file), openBlockers: result.blockerCount || 0, problems: result.problems }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
