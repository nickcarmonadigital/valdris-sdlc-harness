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

export const REVIEW_SCHEMA = "valdris.review.v2";
const SHA256 = /^[a-f0-9]{64}$/i;
const ACTOR_TYPES = new Set(["agent", "human", "service"]);
const ROLE_PROVENANCE_SCHEMA = "valdris.review-role-provenance.v1";
const REQUIRED_REVIEW_ROLES = Object.freeze([
  "scout",
  "implementer",
  "verifier",
  "independentReviewer",
]);
const REVIEW_TRUST_SCHEMA = "valdris.review-trust.v1";
const REVIEW_ATTESTATION_SCHEME = "ed25519";
const REVIEW_TRUST_KEY_STATUSES = new Set(["active", "revoked"]);
const RUNTIME_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const REVIEW_TRUST_SHA256_ENV = "UASH_REVIEW_TRUST_SHA256";

function nonEmpty(value, minimum = 1) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function normalizedRelative(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

export function reviewTrustStoreSha256(document) {
  return sha256(canonicalJson(document));
}

export function requiredReviewTrustSha256(environment = process.env) {
  const value = environment?.[REVIEW_TRUST_SHA256_ENV];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `${REVIEW_TRUST_SHA256_ENV} is required as the operator-held review trust-store pin`,
    );
  }
  if (!SHA256.test(value)) {
    throw new Error(
      `${REVIEW_TRUST_SHA256_ENV} must be a 64-character SHA-256 digest`,
    );
  }
  return value.toLowerCase();
}

function reviewTrustStoreSchemaProblems(document) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return ["review trust store must be a JSON object"];
  const allowedStoreFields = new Set(["schema", "description", "keys"]);
  for (const field of Object.keys(document)) {
    if (!allowedStoreFields.has(field))
      problems.push(`review trust store contains unsupported field: ${field}`);
  }
  if (document?.schema !== REVIEW_TRUST_SCHEMA)
    problems.push(`review trust store schema must be ${REVIEW_TRUST_SCHEMA}`);
  if (document.description !== undefined && !nonEmpty(document.description))
    problems.push(
      "review trust store description must be a non-empty string when present",
    );
  if (!Array.isArray(document?.keys)) {
    problems.push("review trust store keys must be an array");
    return problems;
  }
  const keyOwners = new Map();
  for (const [index, key] of document.keys.entries()) {
    const label = `review trust store key ${index + 1}`;
    if (!key || typeof key !== "object" || Array.isArray(key)) {
      problems.push(`${label} must be a JSON object`);
      continue;
    }
    const allowedKeyFields = new Set([
      "keyId",
      "algorithm",
      "status",
      "publicKeyPem",
      "allowedActorIds",
      "allowedActorTypes",
    ]);
    for (const field of Object.keys(key)) {
      if (!allowedKeyFields.has(field))
        problems.push(`${label} contains unsupported field: ${field}`);
    }
    if (!safeIdentifier(key.keyId)) problems.push(`${label} keyId is invalid`);
    else if (keyOwners.has(key.keyId))
      problems.push(
        `${label} keyId duplicates key ${keyOwners.get(key.keyId)}`,
      );
    else keyOwners.set(key.keyId, index + 1);
    if (!REVIEW_TRUST_KEY_STATUSES.has(key.status))
      problems.push(`${label} status must be active or revoked`);
    if (key.algorithm !== REVIEW_ATTESTATION_SCHEME)
      problems.push(`${label} algorithm must be ${REVIEW_ATTESTATION_SCHEME}`);
    if (
      typeof key.publicKeyPem !== "string" ||
      !key.publicKeyPem.includes("BEGIN PUBLIC KEY")
    )
      problems.push(`${label} publicKeyPem is invalid`);
    if (
      key?.allowedActorIds !== undefined &&
      (!Array.isArray(key.allowedActorIds) || key.allowedActorIds.length === 0)
    ) {
      problems.push(
        `${label} allowedActorIds must be a non-empty array when present`,
      );
    }
    if (Array.isArray(key.allowedActorIds)) {
      for (const [actorIndex, actorId] of key.allowedActorIds.entries()) {
        if (!safeIdentifier(actorId))
          problems.push(
            `${label} allowedActorIds entry ${actorIndex + 1} is invalid`,
          );
      }
    }
    if (
      key?.allowedActorTypes !== undefined &&
      (!Array.isArray(key.allowedActorTypes) ||
        key.allowedActorTypes.length === 0)
    ) {
      problems.push(
        `${label} allowedActorTypes must be a non-empty array when present`,
      );
    }
    if (Array.isArray(key.allowedActorTypes)) {
      for (const [actorIndex, actorType] of key.allowedActorTypes.entries()) {
        if (!ACTOR_TYPES.has(actorType))
          problems.push(
            `${label} allowedActorTypes entry ${actorIndex + 1} is invalid`,
          );
      }
    }
  }
  return problems;
}

function roleProvenanceProblems(document, repoRoot) {
  const problems = [];
  const provenance = document.roleProvenance;
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  )
    return ["roleProvenance is required"];
  if (provenance.schema !== ROLE_PROVENANCE_SCHEMA)
    problems.push(`roleProvenance.schema must be ${ROLE_PROVENANCE_SCHEMA}`);
  const allowedFields = new Set(["schema", ...REQUIRED_REVIEW_ROLES]);
  for (const field of Object.keys(provenance)) {
    if (!allowedFields.has(field))
      problems.push(`roleProvenance contains unsupported role: ${field}`);
  }
  for (const role of REQUIRED_REVIEW_ROLES) {
    const entry = provenance[role];
    const label = `roleProvenance.${role}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${label} is required`);
      continue;
    }
    for (const field of ["actorId", "sessionId", "executionId"]) {
      if (!safeIdentifier(entry[field]))
        problems.push(`${label}.${field} is invalid`);
    }
    if (!ACTOR_TYPES.has(entry.actorType))
      problems.push(`${label}.actorType is invalid`);
    if (
      !entry.evidence ||
      typeof entry.evidence !== "object" ||
      Array.isArray(entry.evidence)
    ) {
      problems.push(`${label}.evidence is required`);
      continue;
    }
    if (!SHA256.test(entry.evidence.sha256 || ""))
      problems.push(`${label}.evidence.sha256 must be a SHA-256 digest`);
  }
  const actorOwners = new Map();
  for (const role of REQUIRED_REVIEW_ROLES) {
    const actorId = provenance[role]?.actorId;
    if (!safeIdentifier(actorId)) continue;
    if (actorOwners.has(actorId))
      problems.push(
        `roleProvenance actorId is reused by ${actorOwners.get(actorId)} and ${role}`,
      );
    else actorOwners.set(actorId, role);
  }
  const sessionOwners = new Map();
  for (const role of REQUIRED_REVIEW_ROLES) {
    const sessionId = provenance[role]?.sessionId;
    if (!safeIdentifier(sessionId)) continue;
    if (sessionOwners.has(sessionId))
      problems.push(
        `roleProvenance sessionId is reused by ${sessionOwners.get(sessionId)} and ${role}`,
      );
    else sessionOwners.set(sessionId, role);
  }
  const executionOwners = new Map();
  for (const role of REQUIRED_REVIEW_ROLES) {
    const executionId = provenance[role]?.executionId;
    if (!safeIdentifier(executionId)) continue;
    if (executionOwners.has(executionId))
      problems.push(
        `roleProvenance executionId is reused by ${executionOwners.get(executionId)} and ${role}`,
      );
    else executionOwners.set(executionId, role);
  }

  const artifactExpectations = new Map([
    ["scout", { path: "run/route.json", sha256: null }],
    [
      "implementer",
      { path: document.subject?.artifact, sha256: document.subject?.sha256 },
    ],
    [
      "verifier",
      { path: document.subject?.artifact, sha256: document.subject?.sha256 },
    ],
  ]);
  for (const [role, expected] of artifactExpectations) {
    const evidence = provenance[role]?.evidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
      continue;
    const label = `roleProvenance.${role}.evidence`;
    if (evidence.kind !== "artifact")
      problems.push(`${label}.kind must be artifact`);
    if (!nonEmpty(evidence.path) || evidence.path !== expected.path)
      problems.push(
        `${label}.path must be ${expected.path || "the reviewed subject artifact"}`,
      );
    if (
      SHA256.test(expected.sha256 || "") &&
      evidence.sha256 !== expected.sha256
    )
      problems.push(`${label}.sha256 must bind the reviewed subject`);
    if (nonEmpty(evidence.path)) {
      try {
        const artifactPath = resolveArtifactPath(repoRoot, evidence.path, {
          mustExist: true,
        });
        if (normalizedRelative(repoRoot, artifactPath) !== evidence.path)
          problems.push(`${label}.path must be canonical`);
        if (
          SHA256.test(evidence.sha256 || "") &&
          fileSha256(artifactPath) !== evidence.sha256
        )
          problems.push(`${label}.sha256 does not match ${evidence.path}`);
      } catch (error) {
        problems.push(`${label} is invalid: ${error.message}`);
      }
    }
  }
  const reviewerEvidence = provenance.independentReviewer?.evidence;
  if (
    reviewerEvidence &&
    typeof reviewerEvidence === "object" &&
    !Array.isArray(reviewerEvidence)
  ) {
    if (reviewerEvidence.kind !== "review-evidence-bundle")
      problems.push(
        "roleProvenance.independentReviewer.evidence.kind must be review-evidence-bundle",
      );
    if (Object.hasOwn(reviewerEvidence, "path"))
      problems.push(
        "roleProvenance.independentReviewer.evidence must not declare an artifact path",
      );
    if (reviewerEvidence.sha256 !== document.evidenceBundleSha256)
      problems.push(
        "roleProvenance.independentReviewer.evidence.sha256 must bind the reviewed evidence bundle",
      );
  }
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
    reviewTrustSha256: document.reviewTrustSha256,
    validationRuntimeSha256: document.validationRuntimeSha256,
    evidenceBundleSha256: document.evidenceBundleSha256,
    roleProvenance: document.roleProvenance,
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

export function reviewRoleProvenanceSha256(document) {
  if (
    !document?.roleProvenance ||
    typeof document.roleProvenance !== "object" ||
    Array.isArray(document.roleProvenance)
  ) {
    throw new Error("review roleProvenance is required");
  }
  return sha256(canonicalJson(document.roleProvenance));
}

function attestationProblems(document, repoRoot, options = {}) {
  const problems = [];
  let requiredTrustSha256;
  try {
    requiredTrustSha256 = requiredReviewTrustSha256();
  } catch (error) {
    problems.push(error.message);
  }
  const attestation = document.attestation;
  if (
    !attestation ||
    typeof attestation !== "object" ||
    Array.isArray(attestation)
  )
    return ["review requires a cryptographically verified attestation"];
  if (attestation.scheme !== REVIEW_ATTESTATION_SCHEME)
    problems.push(
      `review attestation.scheme must be ${REVIEW_ATTESTATION_SCHEME}`,
    );
  if (!safeIdentifier(attestation.keyId))
    problems.push("review attestation.keyId is invalid");
  if (
    typeof attestation.signedAt !== "string" ||
    Number.isNaN(Date.parse(attestation.signedAt))
  )
    problems.push("review attestation.signedAt must be an ISO timestamp");
  if (!SHA256.test(attestation.payloadSha256 || ""))
    problems.push("review attestation.payloadSha256 must be a SHA-256 digest");
  if (
    typeof attestation.signature !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(attestation.signature)
  )
    problems.push("review attestation.signature must be base64");

  let trustStore;
  let trustPath;
  let trustPathRelative;
  try {
    const runtimeTrustPath = path.join(
      RUNTIME_ROOT,
      "controls",
      "review-trust.v1.json",
    );
    trustPathRelative = path
      .relative(repoRoot, runtimeTrustPath)
      .split(path.sep)
      .join("/");
    if (
      !trustPathRelative ||
      trustPathRelative === ".." ||
      trustPathRelative.startsWith("../") ||
      path.isAbsolute(trustPathRelative)
    ) {
      throw new Error(
        "review runtime must be installed inside the target Git worktree",
      );
    }
    const configured = options.trustStorePath || trustPathRelative;
    trustPath = resolveArtifactPath(repoRoot, configured, { mustExist: true });
    const normalized = path
      .relative(repoRoot, trustPath)
      .split(path.sep)
      .join("/");
    if (
      normalized !== trustPathRelative ||
      path.resolve(trustPath) !== path.resolve(runtimeTrustPath)
    )
      throw new Error(
        `trust store must use canonical runtime path ${trustPathRelative}`,
      );
    trustStore = readJson(trustPath);
    const adapterPath = path.join(RUNTIME_ROOT, "project-adapter.json");
    if (existsSync(adapterPath)) {
      const adapter = readJson(adapterPath);
      if (adapter.reviewTrust?.path !== trustPathRelative)
        throw new Error(
          `project adapter reviewTrust.path must be ${trustPathRelative}`,
        );
    }
  } catch (error) {
    problems.push(`review trust store is invalid: ${error.message}`);
    return problems;
  }
  problems.push(...reviewTrustStoreSchemaProblems(trustStore));
  const liveTrustSha256 = reviewTrustStoreSha256(trustStore);
  if (requiredTrustSha256 && liveTrustSha256 !== requiredTrustSha256)
    problems.push(
      `review trust store does not match operator-held ${REVIEW_TRUST_SHA256_ENV}`,
    );
  if (requiredTrustSha256 && document.reviewTrustSha256 !== requiredTrustSha256)
    problems.push(
      `review reviewTrustSha256 must match operator-held ${REVIEW_TRUST_SHA256_ENV}`,
    );
  if (/^[a-f0-9]{40,64}$/i.test(document.commit || "") && trustPath) {
    const prefixResult = spawnSync("git", ["rev-parse", "--show-prefix"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      killSignal: "SIGTERM",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const targetPrefix =
      prefixResult.status === 0
        ? prefixResult.stdout.replace(/\r?\n$/, "").replaceAll("\\", "/")
        : "";
    const trustGitPath = `${targetPrefix}${trustPathRelative}`;
    const committed =
      prefixResult.status === 0
        ? spawnSync("git", ["show", `${document.commit}:${trustGitPath}`], {
            cwd: repoRoot,
            encoding: "utf8",
            shell: false,
            timeout: 30_000,
            killSignal: "SIGTERM",
            stdio: ["ignore", "pipe", "pipe"],
          })
        : prefixResult;
    if (committed.status !== 0)
      problems.push("review trust store is not present at the reviewed commit");
    else {
      try {
        const committedTrustStore = JSON.parse(committed.stdout);
        if (canonicalJson(committedTrustStore) !== canonicalJson(trustStore))
          problems.push("review trust store differs from the reviewed commit");
        if (
          requiredTrustSha256 &&
          reviewTrustStoreSha256(committedTrustStore) !== requiredTrustSha256
        )
          problems.push(
            `review trust store at the reviewed commit does not match operator-held ${REVIEW_TRUST_SHA256_ENV}`,
          );
      } catch (error) {
        problems.push(
          `review trust store at the reviewed commit is invalid: ${error.message}`,
        );
      }
    }
  } else {
    problems.push(
      "review commit must be a Git commit hash for trust-store verification",
    );
  }
  const keys = (Array.isArray(trustStore?.keys) ? trustStore.keys : []).filter(
    (entry) =>
      entry?.status === "active" && entry?.keyId === attestation?.keyId,
  );
  if (keys.length !== 1) {
    problems.push(
      "review attestation keyId must resolve to exactly one active trusted key",
    );
    return problems;
  }
  const key = keys[0];
  if (key.algorithm !== REVIEW_ATTESTATION_SCHEME)
    problems.push(
      `review trusted key algorithm must be ${REVIEW_ATTESTATION_SCHEME}`,
    );
  if (
    typeof key.publicKeyPem !== "string" ||
    !key.publicKeyPem.includes("BEGIN PUBLIC KEY")
  )
    problems.push("review trusted key publicKeyPem is invalid");
  const independentReviewer = document.roleProvenance?.independentReviewer;
  if (
    Array.isArray(key.allowedActorIds) &&
    !key.allowedActorIds.includes(independentReviewer?.actorId)
  )
    problems.push("review actor is not authorized by the attestation key");
  if (
    Array.isArray(key.allowedActorTypes) &&
    !key.allowedActorTypes.includes(independentReviewer?.actorType)
  )
    problems.push("review actor type is not authorized by the attestation key");

  const payload = reviewAttestationPayload(document);
  const serialized = canonicalJson(payload);
  const payloadSha256 = sha256(serialized);
  if (
    SHA256.test(attestation.payloadSha256 || "") &&
    attestation.payloadSha256 !== payloadSha256
  )
    problems.push(
      "review attestation payload digest does not match the signed review",
    );
  if (problems.length === 0) {
    try {
      const valid = verifySignature(
        null,
        Buffer.from(serialized, "utf8"),
        key.publicKeyPem,
        Buffer.from(attestation.signature, "base64"),
      );
      if (!valid) problems.push("review attestation signature is invalid");
    } catch (error) {
      problems.push(
        `review attestation signature verification failed: ${error.message}`,
      );
    }
  }
  return problems;
}

export function validateReviewArtifact(document, repoRoot, options = {}) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return {
      valid: false,
      problems: ["review artifact must be a JSON object"],
    };
  if (document.schema !== REVIEW_SCHEMA)
    problems.push(`review schema must be ${REVIEW_SCHEMA}`);
  if (document.status !== "passed")
    problems.push("review status must be passed");
  if (!safeIdentifier(document.runId)) problems.push("review runId is invalid");
  if (!safeIdentifier(document.commit))
    problems.push("review commit is invalid");
  if (!safeIdentifier(document.environment))
    problems.push("review environment is invalid");
  if (!nonEmpty(document.subject?.artifact))
    problems.push("review subject.artifact is required");
  if (!SHA256.test(document.subject?.sha256 || ""))
    problems.push("review subject.sha256 must be a SHA-256 digest");
  if (!SHA256.test(document.reviewTrustSha256 || ""))
    problems.push(
      "review reviewTrustSha256 must bind the operator-held review trust-store pin",
    );
  if (!SHA256.test(document.validationRuntimeSha256 || ""))
    problems.push(
      "review validationRuntimeSha256 must bind the reviewed validator/catalog closure",
    );
  if (!SHA256.test(document.evidenceBundleSha256 || ""))
    problems.push(
      "review evidenceBundleSha256 must bind all reviewed inputs and required evidence",
    );
  if (
    Object.hasOwn(document, "implementationProvenance") ||
    Object.hasOwn(document, "reviewProvenance")
  )
    problems.push("review v2 rejects legacy two-role provenance fields");
  problems.push(...roleProvenanceProblems(document, repoRoot));

  if (document.decision?.status !== "accepted")
    problems.push("review decision must be accepted");
  if (!nonEmpty(document.decision?.summary, 8))
    problems.push("review decision.summary is required");
  if (!Array.isArray(document.findings))
    problems.push("review findings must be an array");
  if (!Array.isArray(document.blockers))
    problems.push("review blockers must be an array");
  else {
    for (const [index, blocker] of document.blockers.entries()) {
      if (
        !blocker ||
        typeof blocker !== "object" ||
        !new Set(["resolved", "closed"]).has(blocker.status)
      )
        problems.push(`review blocker ${index + 1} remains open`);
    }
  }
  for (const [index, finding] of (document.findings || []).entries()) {
    if (
      new Set(["blocker", "critical"]).has(finding?.severity) &&
      !new Set(["resolved", "closed"]).has(finding?.status)
    )
      problems.push(`review finding ${index + 1} is an open blocker`);
  }
  problems.push(...attestationProblems(document, repoRoot, options));

  if (nonEmpty(document.subject?.artifact)) {
    try {
      const subjectPath = resolveArtifactPath(
        repoRoot,
        document.subject.artifact,
        { mustExist: true },
      );
      if (
        SHA256.test(document.subject.sha256 || "") &&
        fileSha256(subjectPath) !== document.subject.sha256
      )
        problems.push("review subject digest does not match the artifact");
      let subject;
      try {
        subject = readJson(subjectPath);
      } catch (error) {
        const extension = path.extname(document.subject.artifact).toLowerCase();
        if (extension === ".json")
          throw new Error(
            "review subject declares JSON but contains malformed JSON",
          );
        // Reviews may target non-JSON artifacts; their digest still binds the subject.
        // IO and validation failures are not JSON syntax failures and must fail closed.
        if (!(error instanceof SyntaxError)) throw error;
      }
      if (subject?.schema === "valdris.portable-proof.v1") {
        try {
          const validation = validatePortableProof(subject);
          if (!validation.valid)
            problems.push(
              `reviewed portable proof is invalid: ${validation.problems.join("; ")}`,
            );
          if (
            subject.run?.id !== document.runId ||
            subject.run?.commit !== document.commit ||
            subject.run?.environment !== document.environment
          )
            problems.push(
              "reviewed portable proof subject does not match the review",
            );
        } catch (error) {
          problems.push(
            `reviewed portable proof validation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      problems.push(`review subject is invalid: ${error.message}`);
    }
  }

  problems.push(...agentSelfGrantProblems(document, "review"));
  problems.push(...secretDisclosureProblems(document));
  return {
    valid: problems.length === 0,
    problems,
    blockerCount: (document.blockers || []).filter(
      (entry) => !new Set(["resolved", "closed"]).has(entry?.status),
    ).length,
  };
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
  if (args.help)
    return console.log(
      "Usage: node scripts/review-gate.mjs --repo . [--file review/review.json] [--trust-store <exact runtime trust path>]",
    );
  const repoRoot = path.resolve(args.repo);
  const file = resolveArtifactPath(repoRoot, args.file, { mustExist: true });
  const result = validateReviewArtifact(readJson(file), repoRoot, {
    trustStorePath: args.trustStorePath,
  });
  console.log(
    JSON.stringify(
      {
        ok: result.valid,
        artifact: path.relative(repoRoot, file),
        openBlockers: result.blockerCount || 0,
        problems: result.problems,
      },
      null,
      2,
    ),
  );
  if (!result.valid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
