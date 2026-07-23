import { createPublicKey, verify as verifySignature } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  fileSha256,
  readJson,
  resolveArtifactPath,
  safeIdentifier,
  sha256,
} from "./proof-runner.mjs";
import { validateContextManifest } from "./context-manifest-gate.mjs";
import { validateEvalResultsDocument } from "./eval-gate.mjs";
import { validateSmoke } from "./smoke-gate.mjs";
import { validateTrajectoryDocument } from "./trajectory-gate.mjs";
import {
  AI_ECONOMICS_LEDGER_SCHEMA,
  DEPENDENCY_PROVENANCE_SCHEMA,
  IMPLEMENTATION_EXECUTION_RECEIPT_SCHEMA,
  MEMORY_HEAD_RECEIPT_SCHEMA,
  REQUIREMENTS_CONTRACT_SCHEMA,
  RUNTIME_DRIVER_SCHEMA,
  TOOL_REGISTRY_SCHEMA,
  TRACE_RECEIPT_SCHEMA,
  countObservableTraceEvents,
  loadAndValidateOperatingArtifact,
  validateAiEconomicsLedgerDocument,
  validateAcceptanceResultsDocument,
  validateDecisionEvidenceDocument,
  validateDependencyProvenance,
  validateInteropTranscriptDocument,
  validateMemoryContinuity,
  validateRequirementsContractDocument,
  validateRuntimeDriverDocument,
  validateToolCallReceipts,
  validateToolRegistryDocument,
} from "./operating-contracts-lib.mjs";

export const AUTHORITY_TRUST_SHA256_ENV = "VALDRIS_AUTHORITY_TRUST_SHA256";
export const AUTHORITY_TRUST_SCHEMA = "valdris.authority-trust.v1";
export const AUTHORITATIVE_POLICY_SCHEMA =
  "valdris.authoritative-assurance-policy.v1";
export const AUTHORITATIVE_CLOSURE_SCHEMA = "valdris.authoritative-closure.v1";
export const IMPLEMENTATION_READINESS_SCHEMA =
  "uash.implementation-readiness.v1";
export const IMPLEMENTATION_READINESS_RECEIPT_SCHEMA =
  "uash.implementation-readiness-receipt.v1";
export const IMPLEMENTATION_START_RECEIPT_SCHEMA =
  "uash.implementation-start-receipt.v1";
export const AGENT_EVAL_PLAN_SCHEMA = "uash.agent-eval-plan.v1";
export const SEMANTIC_ASSURANCE_SCHEMA = "valdris.semantic-assurance.v1";
export const RUNTIME_SESSION_SCHEMA = "valdris.runtime-session.v1";
export const CHANGE_REVIEW_SCHEMA = "uash.ai-change-review.v1";
export const PROMOTION_SCHEMA = "uash.promotion-receipt.v1";
export const LEARNING_SCHEMA = "uash.harness-learning.v1";
export const CONTEXT_MANIFEST_V2_SCHEMA = "uash.context-manifest.v2";
export const ASSURANCE_LEVELS = Object.freeze([
  "structural",
  "semantic",
  "authoritative",
]);
export const RUNTIME_EXECUTION_THREAT_BOUNDARY =
  "trusted-host-operator-vs-isolated-untrusted-workload";
export const RUNTIME_SAME_PRINCIPAL_COMPROMISE_POLICY =
  "external-isolation-required";
export const EXECUTOR_AUTHORITY_SEPARATION_RECEIPT_SCHEMA =
  "valdris.executor-authority-separation-receipt.v1";
export const EXECUTOR_AUTHORITY_SEPARATION_MODE =
  "independent-external-principal";
export const EXECUTOR_WALL_CLOCK_SCOPE =
  "total host operation: preflight, archive, import, build, inspect, execution, materialization, and cleanup";
export const REFERENCE_EXECUTOR_CONTAINER_UID = 65_534;
export const REFERENCE_EXECUTOR_CONTAINER_GID = 65_534;

export function validExecutorResourceLimits(limits) {
  if (!object(limits)) return false;
  if (!Number.isFinite(limits.cpu) || limits.cpu <= 0) return false;
  for (const field of ["memory", "outputBytes", "wallClockMs"])
    if (!Number.isSafeInteger(limits[field]) || limits[field] < 1) return false;
  if (
    limits.wallClockScope !== EXECUTOR_WALL_CLOCK_SCOPE ||
    !Number.isSafeInteger(limits.cleanupReserveMs) ||
    limits.cleanupReserveMs < 1 ||
    limits.cleanupReserveMs >= limits.wallClockMs ||
    limits.cleanupReserveMs >
      Math.min(45_000, Math.max(1, Math.floor(limits.wallClockMs / 3)))
  )
    return false;
  return true;
}

export function runtimeExecutionIsolationPolicy({
  authorityIdentitySha256,
  threatBoundary = RUNTIME_EXECUTION_THREAT_BOUNDARY,
  samePrincipalCompromisePolicy = RUNTIME_SAME_PRINCIPAL_COMPROMISE_POLICY,
  containerUid = REFERENCE_EXECUTOR_CONTAINER_UID,
  containerGid = REFERENCE_EXECUTOR_CONTAINER_GID,
  networkPolicy = "none",
  hostMounts = false,
  capsuleAccess = false,
  liveWorktreeMount = false,
  inheritAmbientSecrets = false,
}) {
  const policy = {
    schema: "valdris.runtime-execution-isolation-policy.v1",
    threatBoundary,
    authorityIdentitySha256,
    samePrincipalCompromisePolicy,
    untrustedWorkload: {
      kind: "linux-container-uid-gid",
      uid: containerUid,
      gid: containerGid,
      networkPolicy,
    },
    hostAccess: {
      hostMounts,
      capsuleAccess,
      liveWorktreeMount,
      inheritAmbientSecrets,
    },
  };
  return {
    ...policy,
    policySha256: sha256(canonicalJson(policy)),
  };
}

export function validRuntimeExecutionIsolationBinding(executor) {
  if (!executor || typeof executor !== "object") return false;
  if (
    executor.runtimeExecutionThreatBoundary !==
      RUNTIME_EXECUTION_THREAT_BOUNDARY ||
    executor.runtimeExecutionSamePrincipalCompromisePolicy !==
      RUNTIME_SAME_PRINCIPAL_COMPROMISE_POLICY ||
    !SHA256.test(executor.runtimeExecutionAuthorityIdentitySha256 || "") ||
    !SHA256.test(executor.runtimeExecutionIsolationPolicySha256 || "") ||
    executor.containerUid !== REFERENCE_EXECUTOR_CONTAINER_UID ||
    executor.containerGid !== REFERENCE_EXECUTOR_CONTAINER_GID ||
    executor.networkPolicy !== "none" ||
    executor.hostMounts !== false ||
    executor.capsuleAccess !== false ||
    executor.liveWorktreeMount !== false ||
    executor.inheritAmbientSecrets !== false
  )
    return false;
  const expected = runtimeExecutionIsolationPolicy({
    authorityIdentitySha256: executor.runtimeExecutionAuthorityIdentitySha256,
    threatBoundary: executor.runtimeExecutionThreatBoundary,
    samePrincipalCompromisePolicy:
      executor.runtimeExecutionSamePrincipalCompromisePolicy,
    containerUid: executor.containerUid,
    containerGid: executor.containerGid,
    networkPolicy: executor.networkPolicy,
    hostMounts: executor.hostMounts,
    capsuleAccess: executor.capsuleAccess,
    liveWorktreeMount: executor.liveWorktreeMount,
    inheritAmbientSecrets: executor.inheritAmbientSecrets,
  });
  return (
    executor.runtimeExecutionIsolationPolicySha256 === expected.policySha256
  );
}

export function runtimeExecutionIsolationBindingsMatch(observed, commissioned) {
  return (
    validRuntimeExecutionIsolationBinding(observed) &&
    validRuntimeExecutionIsolationBinding(commissioned) &&
    observed.runtimeExecutionIsolationPolicySha256 ===
      commissioned.runtimeExecutionIsolationPolicySha256
  );
}

export function validExecutorAuthoritySeparationBinding(
  runtime,
  commissionedExecutor,
) {
  const executor = runtime?.executorReceipt;
  const separation = runtime?.executorAuthoritySeparationReceipt;
  return (
    separation?.schema === EXECUTOR_AUTHORITY_SEPARATION_RECEIPT_SCHEMA &&
    separation?.runId === runtime?.runId &&
    separation?.mode === EXECUTOR_AUTHORITY_SEPARATION_MODE &&
    separation?.workloadCannotAccessAuthority === true &&
    separation?.deliveryAgentCannotAccessAuthority === true &&
    separation?.executorEventId === executor?.eventId &&
    separation?.executorReceiptPayloadSha256 ===
      executor?.attestation?.payloadSha256 &&
    separation?.authorityIdentitySha256 ===
      executor?.runtimeExecutionAuthorityIdentitySha256 &&
    separation?.isolationPolicySha256 ===
      executor?.runtimeExecutionIsolationPolicySha256 &&
    SHA256.test(separation?.validatorSha256 || "") &&
    separation?.validatorSha256 ===
      commissionedExecutor?.authoritySeparationValidatorSha256 &&
    SHA256.test(separation?.providerIdentitySha256 || "") &&
    separation?.providerIdentitySha256 ===
      commissionedExecutor?.authoritySeparationProviderIdentitySha256 &&
    separation?.attestation?.keyId !== executor?.attestation?.keyId &&
    separation?.actor?.id !== executor?.actor?.id &&
    separation?.actor?.type === "service"
  );
}

export const V09_CANONICAL_ARTIFACTS = Object.freeze({
  readiness: "run/implementation-readiness.json",
  semantic: "assurance/semantic.json",
  runtime: "runtime/session.json",
  changeReview: "review/change-review.json",
  authoritative: "assurance/authoritative.json",
  promotion: "release/promotion.json",
  learning: "learning/feedback-loop.json",
});

const SHA256 = /^[a-f0-9]{64}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AI_TIERS = new Set(["AI0", "AI1", "AI2", "AI3"]);
const AI_TIER_RANK = Object.freeze({ AI0: 0, AI1: 1, AI2: 2, AI3: 3 });
const ASSURANCE_TIER_RANK = Object.freeze({ T0: 0, T1: 1, T2: 2, T3: 3 });
const RECEIPT_SCHEMAS = new Set([
  "uash.approval-receipt.v1",
  IMPLEMENTATION_READINESS_RECEIPT_SCHEMA,
  IMPLEMENTATION_START_RECEIPT_SCHEMA,
  "valdris.semantic-execution-receipt.v1",
  "valdris.proof-executor-receipt.v1",
  EXECUTOR_AUTHORITY_SEPARATION_RECEIPT_SCHEMA,
  "valdris.bridge-head-receipt.v1",
  "valdris.model-routing-receipt.v1",
  TRACE_RECEIPT_SCHEMA,
  "valdris.usage-receipt.v1",
  "valdris.runtime-conformance-receipt.v1",
  MEMORY_HEAD_RECEIPT_SCHEMA,
  "uash.tool-approval-receipt.v1",
  IMPLEMENTATION_EXECUTION_RECEIPT_SCHEMA,
  PROMOTION_SCHEMA,
  LEARNING_SCHEMA,
]);
const RUNTIME_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function digest(value) {
  return typeof value === "string" && SHA256.test(value);
}

function portableAbsolutePath(value) {
  return (
    nonEmpty(value) &&
    (path.posix.isAbsolute(value) || path.win32.isAbsolute(value))
  );
}

function canonicalHostname(value) {
  return (
    typeof value === "string" &&
    value === value.toLowerCase() &&
    !value.endsWith(".") &&
    /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(value) &&
    value.split(".").every((label) => label && label.length <= 63)
  );
}

function deterministicGithubBridgeTimestamp(operationId) {
  if (!digest(operationId)) return null;
  const epoch = Date.parse("2020-01-01T00:00:00.000Z");
  const windowMs = 50 * 365 * 24 * 60 * 60 * 1000;
  const offset = Number(BigInt(`0x${operationId.slice(0, 12)}`)) % windowMs;
  return new Date(epoch + offset).toISOString();
}

function compareUtf8Path(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function lockfileInventory(lockfile, text) {
  const result = new Map();
  const normalizedLockfile = lockfile.replaceAll("\\", "/");
  const normalizedMetadata = (metadata = {}) => {
    const normalized = {};
    for (const field of ["integrity", "markers", "sources"]) {
      const values = (
        Array.isArray(metadata[field]) ? metadata[field] : [metadata[field]]
      )
        .filter(nonEmpty)
        .map((value) => value.trim());
      if (values.length) normalized[field] = [...new Set(values)].sort();
    }
    return normalized;
  };
  const collectYamlMetadata = (metadata, line) => {
    const value = line.trim();
    for (const match of value.matchAll(
      /(?:integrity|checksum|hash)\s*:\s*['"]?([^,\s'"}\]]+)/gu,
    ))
      metadata.integrity.push(match[1]);
    for (const match of value.matchAll(
      /(?:tarball|url|repo|path)\s*:\s*['"]?([^,\s'"}\]]+)/gu,
    ))
      metadata.sources.push(match[1]);
    for (const match of value.matchAll(/(?:git\+)?https?:\/\/[^,\s'"}\]]+/gu))
      metadata.sources.push(match[0]);
  };
  const add = (
    ecosystem,
    nativeLocator,
    name,
    version,
    { metadata = {} } = {},
  ) => {
    if (
      !nonEmpty(ecosystem) ||
      !nonEmpty(nativeLocator) ||
      !nonEmpty(name) ||
      !nonEmpty(version)
    )
      return;
    const baseLocator = `${ecosystem}:${normalizedLockfile}#${nativeLocator}`;
    let locator = baseLocator;
    let occurrence = 1;
    while (result.has(locator)) {
      occurrence += 1;
      locator = `${baseLocator}#occurrence=${occurrence}`;
    }
    result.set(locator, {
      locator,
      name: name.trim(),
      version: version.trim(),
      metadataSha256: sha256(canonicalJson(normalizedMetadata(metadata))),
    });
  };
  if (/(^|\/)package-lock\.json$/i.test(lockfile)) {
    const document = JSON.parse(text);
    for (const [packagePath, value] of Object.entries(
      document.packages || {},
    )) {
      if (!packagePath || !value?.version) continue;
      add(
        "npm",
        packagePath.replaceAll("\\", "/").replace(/^\.\//u, ""),
        value.name ||
          packagePath.replace(/^.*node_modules\//u, "").replace(/^\.\//u, ""),
        value.version,
        {
          metadata: {
            integrity: [value.integrity],
            sources: [value.resolved],
          },
        },
      );
    }
    return result;
  }
  if (/(^|\/)pnpm-lock\.yaml$/i.test(lockfile)) {
    let inPackages = false;
    let current = null;
    const flush = () => {
      if (current)
        add("pnpm", current.locator, current.name, current.version, {
          metadata: current.metadata,
        });
      current = null;
    };
    for (const line of text.split(/\r?\n/u)) {
      if (/^packages:\s*$/u.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages && /^\S/u.test(line)) {
        flush();
        break;
      }
      const match = inPackages
        ? /^\s{2}['"]?([^'":]+(?:\/[^'":]+)?@[^'":]+)['"]?:\s*$/u.exec(line)
        : null;
      if (match) {
        flush();
        const identity = match[1].replace(/^\//u, "").replace(/\(.+$/u, "");
        const separator = identity.lastIndexOf("@");
        if (separator > 0)
          current = {
            locator: match[1].replace(/^\//u, ""),
            name: identity.slice(0, separator),
            version: identity.slice(separator + 1),
            metadata: { integrity: [], sources: [] },
          };
      } else if (current) collectYamlMetadata(current.metadata, line);
    }
    flush();
    return result;
  }
  if (/(^|\/)yarn\.lock$/i.test(lockfile)) {
    let current = null;
    const flush = () => {
      if (current?.name && current?.version)
        add("yarn", current.locator, current.name, current.version, {
          metadata: current.metadata,
        });
      current = null;
    };
    for (const line of `${text}\n__end__:`.split(/\r?\n/u)) {
      if (/^\S.*:\s*$/u.test(line)) {
        flush();
        const locator = line
          .replace(/:\s*$/u, "")
          .trim()
          .replace(/^['"]|['"]$/gu, "");
        const selector = locator.split(",")[0].trim();
        const separator = selector.lastIndexOf("@");
        current = {
          locator,
          name: separator > 0 ? selector.slice(0, separator) : null,
          version: null,
          metadata: { integrity: [], sources: [] },
        };
      } else if (current) {
        const version = /^\s+version(?:\s+|:\s*)['"]?([^'"\s]+)['"]?\s*$/u.exec(
          line,
        );
        if (version) current.version = version[1];
        const source =
          /^\s+(?:resolved|resolution)(?:\s+|:\s*)['"]?([^'"]+?)['"]?\s*$/u.exec(
            line,
          );
        const integrity =
          /^\s+(?:integrity|checksum)(?:\s+|:\s*)['"]?([^'"\s]+)['"]?\s*$/u.exec(
            line,
          );
        if (source) current.metadata.sources.push(source[1]);
        if (integrity) current.metadata.integrity.push(integrity[1]);
      }
    }
    return result;
  }
  if (/(^|\/)(Cargo\.lock|uv\.lock|poetry\.lock)$/i.test(lockfile)) {
    let packageLines = null;
    const flush = () => {
      if (!packageLines) return;
      const block = packageLines.join("\n");
      const name = /^name\s*=\s*"([^"]+)"/mu.exec(block)?.[1];
      const version = /^version\s*=\s*"([^"]+)"/mu.exec(block)?.[1];
      const metadata = { integrity: [], sources: [] };
      for (const match of block.matchAll(/(?:checksum|hash)\s*=\s*"([^"]+)"/gu))
        metadata.integrity.push(match[1]);
      for (const match of block.matchAll(
        /(?:source|url|registry)\s*=\s*(?:"([^"]+)"|(\{[^}]+\}))/gu,
      ))
        metadata.sources.push(match[1] || match[2]);
      if (name && version)
        add("toml", `${name}@${version}`, name, version, { metadata });
      packageLines = null;
    };
    for (const line of `${text}\n[[package]]`.split(/\r?\n/u)) {
      if (/^\[\[package\]\]\s*$/u.test(line)) {
        flush();
        packageLines = [];
      } else if (packageLines) {
        packageLines.push(line.trim());
      }
    }
    return result;
  }
  if (/(^|\/)go\.sum$/i.test(lockfile)) {
    const packages = new Map();
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/u);
      if (parts.length !== 3)
        throw new Error(`unsupported semantic go.sum line: ${line.trim()}`);
      const [name, rawVersion, checksum] = parts;
      const version = rawVersion?.replace(/\/go\.mod$/u, "");
      const identity = `${name}@${version}`;
      const entry = packages.get(identity) || {
        name,
        version,
        integrity: [],
      };
      entry.integrity.push(
        `${rawVersion.endsWith("/go.mod") ? "go.mod" : "module"}:${checksum}`,
      );
      packages.set(identity, entry);
    }
    for (const [identity, entry] of packages)
      add("go", identity, entry.name, entry.version, {
        metadata: { integrity: entry.integrity },
      });
    return result;
  }
  if (/(^|\/)requirements[^/]*\.txt$/i.test(lockfile)) {
    const statements = [];
    let continued = "";
    for (const rawLine of text.split(/\r?\n/u)) {
      const trimmed = rawLine.trim();
      if (!continued && (!trimmed || trimmed.startsWith("#"))) continue;
      const hasContinuation = trimmed.endsWith("\\");
      const fragment = hasContinuation ? trimmed.slice(0, -1).trim() : trimmed;
      continued = `${continued} ${fragment}`.trim();
      if (!hasContinuation) {
        statements.push(continued);
        continued = "";
      }
    }
    if (continued)
      throw new Error("unsupported unterminated requirements continuation");
    for (const statement of statements) {
      const match =
        /^([A-Za-z0-9_.-]+)(\[[^\]]+\])?\s*(?:(?:==([^\s;]+))|(?:@\s*([^\s;]+)))(.*)$/u.exec(
          statement,
        );
      if (!match)
        throw new Error(`unsupported semantic requirements line: ${statement}`);
      const name = match[1].toLowerCase().replace(/[-_.]+/gu, "-");
      const extras = (match[2] || "").toLowerCase().replaceAll(/\s+/gu, "");
      const tail = (match[5] || "").trim();
      const markerMatch = /^;\s*(.*?)(?=\s+--hash(?:=|\s)|$)/u.exec(tail);
      const marker = markerMatch?.[1]?.trim().replaceAll(/\s+/gu, " ") || "";
      const integrity = [...tail.matchAll(/--hash(?:=|\s+)([^\s]+)/gu)].map(
        (entry) => entry[1],
      );
      const unsupportedTail = tail
        .replace(/^;\s*(.*?)(?=\s+--hash(?:=|\s)|$)/u, "")
        .replaceAll(/--hash(?:=|\s+)[^\s]+/gu, "")
        .trim();
      if (unsupportedTail)
        throw new Error(
          `unsupported semantic requirements qualifier: ${unsupportedTail}`,
        );
      add("python", `${name}${extras}`, name, match[3] || "direct", {
        metadata: {
          integrity,
          markers: [marker],
          sources: [match[4]],
        },
      });
    }
    return result;
  }
  throw new Error(`unsupported lockfile format: ${lockfile}`);
}

function dependencyChanges(before, after) {
  const changes = [];
  const unmatchedBefore = new Map(before);
  const unmatchedAfter = new Map(after);
  const added = (entry) =>
    changes.push({
      locator: entry.locator,
      name: entry.name,
      version: entry.version,
      metadataSha256: entry.metadataSha256,
      change: "added",
    });
  const removed = (entry) =>
    changes.push({
      locator: entry.locator,
      name: entry.name,
      version: entry.version,
      metadataSha256: entry.metadataSha256,
      change: "removed",
    });
  const updated = (previous, current) => {
    const change = {
      locator: current.locator,
      name: current.name,
      version: current.version,
      previousVersion: previous.version,
      metadataSha256: current.metadataSha256,
      previousMetadataSha256: previous.metadataSha256,
      change: "updated",
    };
    if (previous.locator !== current.locator)
      change.previousLocator = previous.locator;
    changes.push(change);
  };

  for (const [locator, previous] of before) {
    const current = after.get(locator);
    if (!current) continue;
    unmatchedBefore.delete(locator);
    unmatchedAfter.delete(locator);
    if (
      previous.name === current.name &&
      previous.version === current.version &&
      previous.metadataSha256 === current.metadataSha256
    )
      continue;
    if (previous.name === current.name) updated(previous, current);
    else {
      removed(previous);
      added(current);
    }
  }

  const groupByName = (entries) => {
    const grouped = new Map();
    for (const entry of entries) {
      const group = grouped.get(entry.name) || [];
      group.push(entry);
      grouped.set(entry.name, group);
    }
    return grouped;
  };
  const beforeByName = groupByName(unmatchedBefore.values());
  const afterByName = groupByName(unmatchedAfter.values());
  for (const name of new Set([...beforeByName.keys(), ...afterByName.keys()])) {
    const previous = beforeByName.get(name) || [];
    const current = afterByName.get(name) || [];
    if (
      previous.length === 1 &&
      current.length === 1 &&
      (previous[0].version !== current[0].version ||
        previous[0].metadataSha256 !== current[0].metadataSha256)
    ) {
      updated(previous[0], current[0]);
      continue;
    }
    for (const entry of previous) removed(entry);
    for (const entry of current) added(entry);
  }
  return changes;
}

function dependencyChangeSortKey(entry) {
  return [
    entry.locator,
    entry.previousLocator || "",
    entry.name,
    entry.change,
    entry.metadataSha256,
    entry.previousMetadataSha256 || "",
    entry.previousVersion || "",
    entry.version,
  ].join("\0");
}

function canonicalIso(value) {
  return (
    typeof value === "string" &&
    ISO.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function uniqueStrings(values, label, problems, allowed) {
  if (!Array.isArray(values) || values.length === 0) {
    problems.push(`${label} must be a non-empty array`);
    return [];
  }
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (!nonEmpty(value))
      problems.push(`${label}[${index}] must be a non-empty string`);
    else if (seen.has(value))
      problems.push(`${label} contains duplicate ${value}`);
    else if (allowed && !allowed.has(value))
      problems.push(`${label} contains unsupported value ${value}`);
    else seen.add(value);
  }
  return [...seen];
}

function subjectProblems(document, label) {
  const problems = [];
  if (!safeIdentifier(document?.runId))
    problems.push(`${label}.runId is invalid`);
  if (!safeIdentifier(document?.commit))
    problems.push(`${label}.commit is invalid`);
  if (!safeIdentifier(document?.environment))
    problems.push(`${label}.environment is invalid`);
  if (!canonicalIso(document?.generatedAt))
    problems.push(`${label}.generatedAt must be a canonical ISO timestamp`);
  if (document?.status !== "ready")
    problems.push(`${label}.status must be ready`);
  return problems;
}

function sameSubject(document, expected, label, problems) {
  for (const field of ["runId", "commit", "environment"]) {
    if (document?.[field] !== expected?.[field])
      problems.push(
        `${label}.${field} does not match the authoritative closure`,
      );
  }
}

function canonicalArtifactDigest(document, omittedField) {
  const copy = structuredClone(document);
  delete copy[omittedField];
  return sha256(canonicalJson(copy));
}

function readinessSealPayloadSha256(document) {
  const copy = structuredClone(document);
  delete copy.sealReceipt;
  delete copy.implementationStartReceipt;
  return sha256(canonicalJson(copy));
}

function sameStringSet(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    canonicalJson([...left].sort()) === canonicalJson([...right].sort())
  );
}

function validateBoundFiles(entries, repoRoot, label, digestField, problems) {
  if (!repoRoot) {
    problems.push(`${label} validation requires a repository root`);
    return;
  }
  for (const [index, entry] of entries.entries()) {
    try {
      const target = resolveArtifactPath(repoRoot, entry.path, {
        mustExist: true,
      });
      if (fileSha256(target) !== entry[digestField])
        problems.push(`${label}[${index}] digest does not match ${entry.path}`);
    } catch (error) {
      problems.push(`${label}[${index}] path is invalid: ${error.message}`);
    }
  }
}

export function authorityTrustStoreSha256(document) {
  return sha256(canonicalJson(document));
}

function authorityPublicKeyFingerprint(publicKeyPem) {
  try {
    return sha256(
      createPublicKey(publicKeyPem).export({ format: "der", type: "spki" }),
    );
  } catch {
    return null;
  }
}

export function validateAuthorityTrustStore(document) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["authority trust store must be an object"],
    };
  if (document.schema !== AUTHORITY_TRUST_SCHEMA)
    problems.push(
      `authority trust store schema must be ${AUTHORITY_TRUST_SCHEMA}`,
    );
  if (!Array.isArray(document.keys))
    return {
      valid: false,
      problems: [...problems, "authority trust store keys must be an array"],
    };
  const seen = new Set();
  const activePublicKeyFingerprints = new Map();
  for (const [index, key] of document.keys.entries()) {
    const label = `authority trust key ${index + 1}`;
    if (!object(key)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    if (!safeIdentifier(key.keyId)) problems.push(`${label}.keyId is invalid`);
    else if (seen.has(key.keyId)) problems.push(`${label}.keyId is duplicated`);
    else seen.add(key.keyId);
    if (key.algorithm !== "ed25519")
      problems.push(`${label}.algorithm must be ed25519`);
    if (!["active", "revoked"].includes(key.status))
      problems.push(`${label}.status must be active or revoked`);
    if (
      !nonEmpty(key.publicKeyPem) ||
      !key.publicKeyPem.includes("BEGIN PUBLIC KEY")
    )
      problems.push(`${label}.publicKeyPem is invalid`);
    else {
      const fingerprint = authorityPublicKeyFingerprint(key.publicKeyPem);
      if (!fingerprint) problems.push(`${label}.publicKeyPem cannot be parsed`);
      else if (key.status === "active") {
        const priorKeyId = activePublicKeyFingerprints.get(fingerprint);
        if (priorKeyId)
          problems.push(
            `authority trust store reuses one active public key across key IDs ${priorKeyId} and ${key.keyId}`,
          );
        else activePublicKeyFingerprints.set(fingerprint, key.keyId);
      }
    }
    uniqueStrings(
      key.allowedSchemas,
      `${label}.allowedSchemas`,
      problems,
      RECEIPT_SCHEMAS,
    );
    if (key.allowedActorIds !== undefined)
      uniqueStrings(key.allowedActorIds, `${label}.allowedActorIds`, problems);
  }
  return { valid: problems.length === 0, problems };
}

export function authorityAttestationPayload(document) {
  const copy = structuredClone(document);
  if (object(copy.attestation)) {
    delete copy.attestation.payloadSha256;
    delete copy.attestation.signature;
  }
  return copy;
}

export function validateAuthorityReceipt(
  document,
  expectedSchema,
  options = {},
) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["authority receipt must be an object"] };
  if (document.schema !== expectedSchema)
    problems.push(`authority receipt schema must be ${expectedSchema}`);
  if (!RECEIPT_SCHEMAS.has(expectedSchema))
    problems.push(`unsupported authority receipt schema: ${expectedSchema}`);
  if (
    !object(document.actor) ||
    !safeIdentifier(document.actor.id) ||
    !["human", "service"].includes(document.actor.type)
  )
    problems.push("authority receipt actor must identify a human or service");
  if (
    ["uash.approval-receipt.v1", "uash.tool-approval-receipt.v1"].includes(
      expectedSchema,
    ) &&
    document.actor?.type !== "human"
  )
    problems.push("approval authority receipt must be issued by a human actor");
  if (!canonicalIso(document.issuedAt))
    problems.push(
      "authority receipt issuedAt must be a canonical ISO timestamp",
    );
  if (!canonicalIso(document.expiresAt))
    problems.push(
      "authority receipt expiresAt must be a canonical ISO timestamp",
    );
  const now = Date.parse(options.now || new Date().toISOString());
  if (
    canonicalIso(document.issuedAt) &&
    Date.parse(document.issuedAt) > now + 5 * 60 * 1000
  )
    problems.push("authority receipt issuedAt is in the future");
  if (canonicalIso(document.expiresAt) && Date.parse(document.expiresAt) <= now)
    problems.push("authority receipt is expired");
  if (
    canonicalIso(document.issuedAt) &&
    canonicalIso(document.expiresAt) &&
    Date.parse(document.expiresAt) <= Date.parse(document.issuedAt)
  )
    problems.push("authority receipt expiresAt must be after issuedAt");
  if (!safeIdentifier(document.runId))
    problems.push("authority receipt runId is invalid");
  if (!safeIdentifier(document.eventId))
    problems.push("authority receipt eventId is invalid");
  if (!digest(document.correlationSha256))
    problems.push("authority receipt correlationSha256 is invalid");
  if (!object(document.attestation))
    return {
      valid: false,
      problems: [
        ...problems,
        "authority receipt requires an Ed25519 attestation",
      ],
    };
  const attestation = document.attestation;
  if (attestation.scheme !== "ed25519")
    problems.push("authority receipt attestation.scheme must be ed25519");
  if (!safeIdentifier(attestation.keyId))
    problems.push("authority receipt attestation.keyId is invalid");
  if (!canonicalIso(attestation.signedAt))
    problems.push(
      "authority receipt attestation.signedAt must be a canonical ISO timestamp",
    );
  if (
    canonicalIso(attestation.signedAt) &&
    canonicalIso(document.issuedAt) &&
    Date.parse(attestation.signedAt) < Date.parse(document.issuedAt)
  )
    problems.push("authority receipt cannot be signed before it is issued");
  if (
    canonicalIso(attestation.signedAt) &&
    canonicalIso(document.expiresAt) &&
    Date.parse(attestation.signedAt) >= Date.parse(document.expiresAt)
  )
    problems.push("authority receipt cannot be signed after it expires");
  if (!digest(attestation.payloadSha256))
    problems.push("authority receipt attestation.payloadSha256 is invalid");
  if (
    !nonEmpty(attestation.signature) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(attestation.signature)
  )
    problems.push("authority receipt attestation.signature must be base64");
  const trustStore = options.trustStore;
  const trustValidation = validateAuthorityTrustStore(trustStore);
  problems.push(...trustValidation.problems);
  const requiredPin = options.requiredTrustSha256;
  const actualPin = object(trustStore)
    ? authorityTrustStoreSha256(trustStore)
    : null;
  if (!digest(requiredPin))
    problems.push(
      `${AUTHORITY_TRUST_SHA256_ENV} is required as an operator-held authority trust-store pin`,
    );
  else if (actualPin !== requiredPin.toLowerCase())
    problems.push(
      `authority trust store does not match operator-held ${AUTHORITY_TRUST_SHA256_ENV}`,
    );
  if (document.authorityTrustSha256 !== requiredPin)
    problems.push(
      `authority receipt authorityTrustSha256 must match operator-held ${AUTHORITY_TRUST_SHA256_ENV}`,
    );
  const key = trustStore?.keys?.find(
    (candidate) => candidate.keyId === attestation.keyId,
  );
  if (!key) problems.push("authority receipt attestation key is not trusted");
  else {
    if (key.status !== "active")
      problems.push("authority receipt attestation key is revoked");
    if (!key.allowedSchemas?.includes(expectedSchema))
      problems.push(
        "authority receipt schema is not allowed for the attestation key",
      );
    if (
      Array.isArray(key.allowedActorIds) &&
      !key.allowedActorIds.includes(document.actor?.id)
    )
      problems.push(
        "authority receipt actor is not allowed for the attestation key",
      );
  }
  const payload = canonicalJson(authorityAttestationPayload(document));
  const payloadSha256 = sha256(payload);
  if (attestation.payloadSha256 !== payloadSha256)
    problems.push(
      "authority receipt payload digest does not match the signed payload",
    );
  if (key?.publicKeyPem && nonEmpty(attestation.signature)) {
    try {
      if (
        !verifySignature(
          null,
          Buffer.from(payload),
          key.publicKeyPem,
          Buffer.from(attestation.signature, "base64"),
        )
      )
        problems.push("authority receipt signature is invalid");
    } catch (error) {
      problems.push(
        `authority receipt signature cannot be verified: ${error.message}`,
      );
    }
  }
  return { valid: problems.length === 0, problems };
}

function validateEvaluationPlan(plan, policy, aiTier, problems) {
  if (!object(plan) || plan.schema !== AGENT_EVAL_PLAN_SCHEMA) {
    problems.push(
      `implementation readiness evalPlan.schema must be ${AGENT_EVAL_PLAN_SCHEMA}`,
    );
    return;
  }
  if (!AI_TIERS.has(aiTier))
    problems.push("implementation readiness evalPlan.aiTier is invalid");
  if (plan.aiTier !== aiTier)
    problems.push(
      "implementation readiness evalPlan.aiTier does not match the workload identity",
    );
  const required = policy?.aiEvalDimensions?.[aiTier] || [];
  const declared = uniqueStrings(
    plan.dimensions,
    "implementation readiness evalPlan.dimensions",
    problems,
  );
  for (const dimension of required)
    if (!declared.includes(dimension))
      problems.push(
        `implementation readiness evalPlan is missing risk-derived dimension ${dimension}`,
      );
  if (!Array.isArray(plan.suites) || plan.suites.length === 0)
    problems.push("implementation readiness evalPlan.suites must be non-empty");
  for (const [index, suite] of (plan.suites || []).entries()) {
    if (
      !object(suite) ||
      !safeIdentifier(suite.id) ||
      !digest(suite.caseSetSha256) ||
      !nonEmpty(suite.rubricId)
    )
      problems.push(
        `implementation readiness evalPlan.suites[${index}] is invalid`,
      );
  }
}

export function validateImplementationReadinessDocument(
  document,
  options = {},
) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["implementation readiness must be an object"],
    };
  if (document.schema !== IMPLEMENTATION_READINESS_SCHEMA)
    problems.push(
      `implementation readiness schema must be ${IMPLEMENTATION_READINESS_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "implementation readiness"));
  for (const field of [
    "routeSha256",
    "workloadClassificationSha256",
    "contractSetSha256",
    "testPlanSha256",
    "evaluationPlanSha256",
    "journalHeadSha256",
  ])
    if (!digest(document[field]))
      problems.push(`implementation readiness.${field} is invalid`);
  if (!canonicalIso(document.sealedAt))
    problems.push(
      "implementation readiness.sealedAt must be a canonical ISO timestamp",
    );
  if (
    !Number.isSafeInteger(document.journalSequence) ||
    document.journalSequence < 1
  )
    problems.push("implementation readiness.journalSequence must be positive");
  const fixedPoint = document.implementationFixedPoint;
  if (
    !object(fixedPoint) ||
    !/^[a-f0-9]{40,64}$/i.test(fixedPoint.baseCommit || "") ||
    !digest(fixedPoint.baseTreeSha256) ||
    fixedPoint.source !== "commissioned-pre-implementation"
  )
    problems.push(
      "implementation readiness must seal a commissioned pre-implementation Git fixed point",
    );
  else if (options.repoRoot) {
    const tree = spawnSync(
      "git",
      ["-C", options.repoRoot, "rev-parse", `${fixedPoint.baseCommit}^{tree}`],
      { encoding: "utf8", shell: false, timeout: 30_000, windowsHide: true },
    );
    if (
      tree.status !== 0 ||
      sha256(tree.stdout.trim()) !== fixedPoint.baseTreeSha256
    )
      problems.push(
        "implementation readiness fixed point does not match the reconstructed Git tree",
      );
  }
  const contractsValid =
    Array.isArray(document.contracts) &&
    document.contracts.length > 0 &&
    document.contracts.every(
      (entry) =>
        object(entry) &&
        nonEmpty(entry.id) &&
        nonEmpty(entry.path) &&
        digest(entry.sha256),
    );
  if (!contractsValid)
    problems.push(
      "implementation readiness.contracts must bind at least one versioned contract path and digest",
    );
  const baselinesValid =
    Array.isArray(document.redBaselines) &&
    document.redBaselines.length > 0 &&
    document.redBaselines.every(
      (entry) =>
        object(entry) &&
        nonEmpty(entry.testId) &&
        entry.status === "failed" &&
        nonEmpty(entry.evidencePath) &&
        digest(entry.evidenceSha256),
    );
  if (!baselinesValid)
    problems.push(
      "implementation readiness.redBaselines must bind failing pre-implementation evidence paths and digests",
    );
  if (contractsValid) {
    if (
      document.contractSetSha256 !== sha256(canonicalJson(document.contracts))
    )
      problems.push(
        "implementation readiness.contractSetSha256 does not match contracts",
      );
    validateBoundFiles(
      document.contracts,
      options.repoRoot,
      "implementation readiness.contracts",
      "sha256",
      problems,
    );
  }
  if (baselinesValid) {
    if (
      document.testPlanSha256 !== sha256(canonicalJson(document.redBaselines))
    )
      problems.push(
        "implementation readiness.testPlanSha256 does not match red baselines",
      );
    validateBoundFiles(
      document.redBaselines.map((entry) => ({
        path: entry.evidencePath,
        evidenceSha256: entry.evidenceSha256,
      })),
      options.repoRoot,
      "implementation readiness.redBaselines",
      "evidenceSha256",
      problems,
    );
  }
  const requirementsBinding = (document.contracts || []).find(
    (entry) => entry?.schema === REQUIREMENTS_CONTRACT_SCHEMA,
  );
  if (
    !requirementsBinding ||
    requirementsBinding.path !== "run/requirements-contract.json"
  )
    problems.push(
      "implementation readiness requires run/requirements-contract.json using uash.requirements-contract.v1",
    );
  else if (options.repoRoot) {
    try {
      const target = resolveArtifactPath(
        options.repoRoot,
        requirementsBinding.path,
        {
          mustExist: true,
        },
      );
      const requirements = readJson(target);
      let goal = null;
      try {
        goal = readJson(
          resolveArtifactPath(options.repoRoot, "goal/goal.json", {
            mustExist: true,
          }),
        );
      } catch (error) {
        problems.push(
          `requirements contract goal binding is invalid: ${error.message}`,
        );
      }
      const validation = validateRequirementsContractDocument(requirements, {
        redBaselines: document.redBaselines,
        evalPlan: document.evalPlan,
        goal,
      });
      problems.push(
        ...validation.problems.map(
          (problem) => `implementation readiness requirements: ${problem}`,
        ),
      );
      sameSubject(requirements, document, "requirements contract", problems);
      if (
        goal?.requestSha256 &&
        requirements.sourceRequestSha256 !== goal.requestSha256
      )
        problems.push(
          "requirements contract source request does not match the immutable goal request",
        );
    } catch (error) {
      problems.push(
        `implementation readiness requirements are invalid: ${error.message}`,
      );
    }
  }
  const effectiveAiTier =
    options.effectiveAiTier || options.aiTier || document.evalPlan?.aiTier;
  validateEvaluationPlan(
    document.evalPlan,
    options.policy,
    effectiveAiTier,
    problems,
  );
  if (
    object(document.evalPlan) &&
    digest(document.evaluationPlanSha256) &&
    sha256(canonicalJson(document.evalPlan)) !== document.evaluationPlanSha256
  )
    problems.push(
      "implementation readiness.evaluationPlanSha256 does not match evalPlan",
    );
  const seal = document.sealReceipt;
  const sealResult = validateAuthorityReceipt(
    seal,
    IMPLEMENTATION_READINESS_RECEIPT_SCHEMA,
    options,
  );
  problems.push(
    ...sealResult.problems.map(
      (problem) => `implementation readiness seal: ${problem}`,
    ),
  );
  if (seal?.runId !== document.runId)
    problems.push("implementation readiness seal runId does not match");
  if (seal?.readinessPayloadSha256 !== readinessSealPayloadSha256(document))
    problems.push(
      "implementation readiness seal does not bind the readiness payload",
    );
  for (const field of [
    "routeSha256",
    "workloadClassificationSha256",
    "contractSetSha256",
    "testPlanSha256",
    "evaluationPlanSha256",
  ])
    if (seal?.[field] !== document[field])
      problems.push(`implementation readiness seal does not bind ${field}`);
  if (
    seal?.currentHeadSha256 !== document.journalHeadSha256 ||
    seal?.sequence !== document.journalSequence ||
    seal?.compareAndSwap !== "applied"
  )
    problems.push(
      "implementation readiness seal does not bind an applied monotonic journal head",
    );
  if (
    !digest(seal?.priorHeadSha256) ||
    seal?.priorHeadSha256 === seal?.currentHeadSha256
  )
    problems.push(
      "implementation readiness seal must advance the journal head",
    );
  if (seal?.sealedAt !== document.sealedAt)
    problems.push("implementation readiness seal does not bind sealedAt");
  if (
    seal?.issuedAt !== document.sealedAt ||
    seal?.attestation?.signedAt !== document.sealedAt
  )
    problems.push(
      "implementation readiness seal must be issued and signed at the sealed readiness boundary",
    );
  if (
    seal?.firstImplementationAt !== undefined ||
    seal?.firstImplementationSequence !== undefined
  )
    problems.push(
      "implementation readiness seal cannot predict or backfill the later implementation start",
    );
  const start = document.implementationStartReceipt;
  const startResult = validateAuthorityReceipt(
    start,
    IMPLEMENTATION_START_RECEIPT_SCHEMA,
    options,
  );
  problems.push(
    ...startResult.problems.map(
      (problem) => `implementation start receipt: ${problem}`,
    ),
  );
  if (
    start?.runId !== document.runId ||
    start?.readinessPayloadSha256 !== seal?.readinessPayloadSha256 ||
    start?.routeSha256 !== document.routeSha256 ||
    start?.workloadClassificationSha256 !==
      document.workloadClassificationSha256
  )
    problems.push(
      "implementation start receipt does not bind the sealed readiness and routing inputs",
    );
  if (
    !canonicalIso(start?.implementationStartedAt) ||
    start?.issuedAt !== start?.implementationStartedAt ||
    start?.attestation?.signedAt !== start?.implementationStartedAt ||
    Date.parse(start?.implementationStartedAt) <= Date.parse(document.sealedAt)
  )
    problems.push(
      "implementation start receipt must be independently issued after readiness was sealed",
    );
  if (
    !Number.isSafeInteger(start?.sequence) ||
    start.sequence <= document.journalSequence ||
    start?.priorHeadSha256 !== document.journalHeadSha256 ||
    !digest(start?.currentHeadSha256) ||
    start?.currentHeadSha256 === start?.priorHeadSha256 ||
    start?.compareAndSwap !== "applied"
  )
    problems.push(
      "implementation start receipt must advance the sealed journal head with an applied compare-and-swap",
    );
  if (
    !digest(start?.firstMutationSha256) ||
    !nonEmpty(start?.firstMutationEvidencePath) ||
    !digest(start?.firstMutationEvidenceSha256)
  )
    problems.push(
      "implementation start receipt must bind the first mutation identity and evidence",
    );
  else
    validateBoundFiles(
      [
        {
          path: start.firstMutationEvidencePath,
          evidenceSha256: start.firstMutationEvidenceSha256,
        },
      ],
      options.repoRoot,
      "implementation start receipt evidence",
      "evidenceSha256",
      problems,
    );
  return { valid: problems.length === 0, problems };
}

function validateApproval(receipt, options, expected, problems) {
  const result = validateAuthorityReceipt(
    receipt,
    "uash.approval-receipt.v1",
    options,
  );
  problems.push(
    ...result.problems.map((problem) => `approval receipt: ${problem}`),
  );
  if (receipt?.runId !== expected.runId)
    problems.push("approval receipt runId does not match semantic assurance");
  if (receipt?.scope !== expected.scope)
    problems.push(`approval receipt scope must be ${expected.scope}`);
  if (receipt?.artifactSha256 !== expected.artifactSha256)
    problems.push(
      "approval receipt artifactSha256 does not bind the approved policy or augmentation",
    );
  if (
    !object(receipt?.providerReceipt) ||
    !safeIdentifier(receipt.providerReceipt.id) ||
    !digest(receipt.providerReceipt.sha256)
  )
    problems.push("approval receipt providerReceipt is invalid");
}

export function semanticProofSetManifest(document) {
  return (document?.adapters || []).map((adapter) => ({
    controlId: adapter.controlId,
    commandId: adapter.commandId,
    inputSha256: adapter.inputSha256,
    resultSha256: adapter.resultSha256,
    validatorSha256: adapter.validatorSha256,
    supportedTier: adapter.supportedTier,
    assertions: adapter.assertions,
  }));
}

export function semanticProofSetSha256(document) {
  return sha256(canonicalJson(semanticProofSetManifest(document)));
}

export function semanticValidatorSetSha256(document) {
  return sha256(
    canonicalJson(
      [
        ...new Set(
          (document?.adapters || []).map((adapter) => adapter.validatorSha256),
        ),
      ]
        .filter((value) => digest(value))
        .sort(),
    ),
  );
}

export function validateSemanticAssuranceDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["semantic assurance must be an object"] };
  if (document.schema !== SEMANTIC_ASSURANCE_SCHEMA)
    problems.push(
      `semantic assurance schema must be ${SEMANTIC_ASSURANCE_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "semantic assurance"));
  const baseline =
    options.routingBaseline ||
    (options.repoRoot
      ? loadImmutableRouting(options.repoRoot, document, problems)
      : null);
  if (
    !digest(document.routeSha256) ||
    !digest(document.workloadClassificationSha256)
  )
    problems.push(
      "semantic assurance must bind route and workload classification digests",
    );
  const augmentation = document.augmentation;
  if (
    !object(augmentation) ||
    augmentation.schema !== "uash.assurance-augmentation.v1"
  )
    problems.push(
      "semantic assurance augmentation schema must be uash.assurance-augmentation.v1",
    );
  else {
    if (
      augmentation.routeSha256 !== document.routeSha256 ||
      augmentation.workloadClassificationSha256 !==
        document.workloadClassificationSha256
    )
      problems.push(
        "assurance augmentation must bind the immutable route and classification",
      );
    if (!nonEmpty(augmentation.rationale))
      problems.push("assurance augmentation rationale is required");
    if (
      !Array.isArray(augmentation.additions) ||
      augmentation.additions.length === 0
    )
      problems.push("assurance augmentation additions must be non-empty");
    for (const [index, addition] of (augmentation.additions || []).entries())
      if (
        !object(addition) ||
        ![
          "profile",
          "concern",
          "pack",
          "gate",
          "control",
          "assurance-tier-elevation",
          "ai-tier-elevation",
        ].includes(addition.kind) ||
        !nonEmpty(addition.id)
      )
        problems.push(`assurance augmentation additions[${index}] is invalid`);
    if (
      augmentation.removals !== undefined ||
      augmentation.tierReduction !== undefined
    )
      problems.push(
        "assurance augmentation cannot remove controls or reduce the tier",
      );
  }
  const policy = document.acceptancePolicy;
  if (!object(policy) || policy.schema !== "valdris.acceptance-policy.v1")
    problems.push(
      "semantic assurance acceptancePolicy schema must be valdris.acceptance-policy.v1",
    );
  else {
    if (
      !safeIdentifier(policy.owner) ||
      !nonEmpty(policy.version) ||
      !nonEmpty(policy.source) ||
      !digest(policy.sourceSha256)
    )
      problems.push(
        "acceptance policy owner, version, source, and digest are required",
      );
    if (
      !safeIdentifier(policy.profile) ||
      policy.environment !== document.environment ||
      !AI_TIERS.has(policy.effectiveAiTier) ||
      !Object.hasOwn(ASSURANCE_TIER_RANK, policy.effectiveAssuranceTier) ||
      !Array.isArray(policy.workloadProfiles)
    )
      problems.push(
        "acceptance policy must bind profile, environment, workload profiles, and effective assurance tiers",
      );
    if (options.repoRoot) {
      try {
        const source = resolveArtifactPath(options.repoRoot, policy.source, {
          mustExist: true,
        });
        if (fileSha256(source) !== policy.sourceSha256)
          problems.push(
            "acceptance policy sourceSha256 does not match its commissioned source",
          );
      } catch (error) {
        problems.push(`acceptance policy source is invalid: ${error.message}`);
      }
    }
    if (!Array.isArray(policy.thresholds) || policy.thresholds.length === 0)
      problems.push("acceptance policy thresholds must be non-empty");
    for (const [index, threshold] of (policy.thresholds || []).entries())
      if (
        !object(threshold) ||
        !safeIdentifier(threshold.controlId) ||
        !nonEmpty(threshold.metric) ||
        !Number.isFinite(threshold.value) ||
        !["gte", "lte", "eq"].includes(threshold.operator)
      )
        problems.push(`acceptance policy thresholds[${index}] is invalid`);
  }
  if (!Array.isArray(document.adapters) || document.adapters.length === 0)
    problems.push("semantic assurance adapters must be non-empty");
  const adapterSetSha256 = Array.isArray(document.adapters)
    ? sha256(canonicalJson(document.adapters))
    : null;
  if (
    !digest(document.adapterSetSha256) ||
    document.adapterSetSha256 !== adapterSetSha256
  )
    problems.push(
      "semantic assurance adapterSetSha256 does not match adapters",
    );
  if (policy?.adapterSetSha256 !== document.adapterSetSha256)
    problems.push(
      "acceptance policy must bind the commissioned semantic adapter set",
    );
  const proofExecutor = policy?.proofExecutor;
  const bridgeHeadPolicy = policy?.bridgeHead;
  const githubProtectionPolicy = bridgeHeadPolicy?.protectionPolicy;
  const githubWriterApps = githubProtectionPolicy?.writerRestrictions?.apps;
  const githubBridgePolicyInvalid =
    bridgeHeadPolicy?.provider === "github" &&
    (!object(githubProtectionPolicy) ||
      bridgeHeadPolicy.protectionPolicySha256 !==
        sha256(canonicalJson(githubProtectionPolicy)) ||
      githubProtectionPolicy.enforceAdmins !== true ||
      githubProtectionPolicy.requiredLinearHistory !== true ||
      githubProtectionPolicy.strictStatusChecks !== true ||
      githubProtectionPolicy.requirePullRequest !== true ||
      githubProtectionPolicy.noBypassAllowances !== true ||
      !safeIdentifier(githubProtectionPolicy.appendOnlyStatusCheck?.context) ||
      !Number.isSafeInteger(
        githubProtectionPolicy.appendOnlyStatusCheck?.appId,
      ) ||
      githubProtectionPolicy.appendOnlyStatusCheck.appId < 1 ||
      !Array.isArray(githubWriterApps) ||
      githubWriterApps.length === 0 ||
      githubWriterApps.some(
        (writer) =>
          !safeIdentifier(writer?.slug) ||
          !Number.isSafeInteger(writer?.id) ||
          writer.id < 1 ||
          writer.id === githubProtectionPolicy.appendOnlyStatusCheck.appId,
      ) ||
      githubProtectionPolicy.writerRestrictions.teams?.length !== 0 ||
      githubProtectionPolicy.writerRestrictions.users?.length !== 0 ||
      githubProtectionPolicy.proposalFlow?.mergeMethod !== "rebase" ||
      !Number.isSafeInteger(
        githubProtectionPolicy.proposalFlow?.operationDeadlineMs,
      ) ||
      githubProtectionPolicy.proposalFlow.operationDeadlineMs < 1 ||
      githubProtectionPolicy.proposalFlow.operationDeadlineMs > 600_000 ||
      !Number.isSafeInteger(
        githubProtectionPolicy.proposalFlow?.pollIntervalMs,
      ) ||
      githubProtectionPolicy.proposalFlow.pollIntervalMs < 1 ||
      githubProtectionPolicy.proposalFlow.pollIntervalMs >
        githubProtectionPolicy.proposalFlow.operationDeadlineMs ||
      !Number.isSafeInteger(
        githubProtectionPolicy.proposalFlow?.fullReplayInterval,
      ) ||
      githubProtectionPolicy.proposalFlow.fullReplayInterval < 1 ||
      githubProtectionPolicy.proposalFlow.fullReplayInterval > 999 ||
      !canonicalHostname(bridgeHeadPolicy.target?.hostname) ||
      !digest(bridgeHeadPolicy.receiptRootPolicy?.pathSha256) ||
      !digest(bridgeHeadPolicy.receiptRootPolicy?.identitySha256));
  if (
    options.level === "authoritative" &&
    (!object(proofExecutor) ||
      !digest(proofExecutor.commandIdentitySha256) ||
      !digest(proofExecutor.validatorSetSha256) ||
      !digest(proofExecutor.imageSha256) ||
      !safeIdentifier(proofExecutor.executorId) ||
      proofExecutor.sourceSnapshotMode !==
        "git-raw-object-tree-content-addressed-oci-layer" ||
      proofExecutor.liveWorktreeMount !== false ||
      proofExecutor.exclusiveOutputRoot !== true ||
      !digest(proofExecutor.outputRootPathSha256) ||
      !digest(proofExecutor.outputRootIdentitySha256) ||
      !digest(proofExecutor.outputRootPolicySha256) ||
      proofExecutor.outputRootPolicySha256 !==
        sha256(
          canonicalJson({
            pathSha256: proofExecutor.outputRootPathSha256,
            identitySha256: proofExecutor.outputRootIdentitySha256,
          }),
        ) ||
      proofExecutor.containerIdentity !== "cidfile-and-unique-name" ||
      !["docker", "podman"].includes(proofExecutor.runtimeKind) ||
      proofExecutor.runtimeEndpoint !== "local-default" ||
      proofExecutor.runtimeExecutionMode !== "hardened-private-capsule" ||
      !validRuntimeExecutionIsolationBinding(proofExecutor) ||
      proofExecutor.authoritySeparationMode !==
        EXECUTOR_AUTHORITY_SEPARATION_MODE ||
      !digest(proofExecutor.authoritySeparationValidatorSha256) ||
      !digest(proofExecutor.authoritySeparationProviderIdentitySha256) ||
      !validExecutorResourceLimits(proofExecutor.limits) ||
      !portableAbsolutePath(proofExecutor.runtimeCliPath) ||
      proofExecutor.runtimeCliPathSha256 !==
        sha256(proofExecutor.runtimeCliPath || "") ||
      !digest(proofExecutor.runtimeCliSha256) ||
      !portableAbsolutePath(proofExecutor.gitCliPath) ||
      proofExecutor.gitCliPathSha256 !==
        sha256(proofExecutor.gitCliPath || "") ||
      !digest(proofExecutor.gitCliSha256) ||
      !digest(proofExecutor.daemonIdentitySha256))
  )
    problems.push(
      "authoritative acceptance policy must commission absolute and exact Git/runtime binaries, a trusted-host versus isolated-workload threat boundary, independent external authority separation, hardened private runtime-capsule execution, local-default daemon identity, exact resource ceilings, command, validator set, image, executor identity, raw-object source mode, stable output-root identity, and dual container identity",
    );
  if (
    options.level === "authoritative" &&
    (!object(bridgeHeadPolicy) ||
      !safeIdentifier(bridgeHeadPolicy.provider) ||
      !digest(bridgeHeadPolicy.providerIdentitySha256) ||
      !nonEmpty(bridgeHeadPolicy.adapterSchema) ||
      !object(bridgeHeadPolicy.target) ||
      bridgeHeadPolicy.targetSha256 !==
        sha256(canonicalJson(bridgeHeadPolicy.target)) ||
      !digest(bridgeHeadPolicy.protectionPolicySha256) ||
      githubBridgePolicyInvalid)
  )
    problems.push(
      "authoritative acceptance policy must commission the bridge-head provider, adapter, target, and executable protection policy",
    );
  const controls = new Set();
  for (const [index, adapter] of (document.adapters || []).entries()) {
    if (
      !object(adapter) ||
      adapter.schema !== "valdris.semantic-proof-adapter.v1"
    ) {
      problems.push(`semantic adapter ${index + 1} schema is invalid`);
      continue;
    }
    if (!safeIdentifier(adapter.controlId) || controls.has(adapter.controlId))
      problems.push(
        `semantic adapter ${index + 1} controlId is invalid or duplicated`,
      );
    else controls.add(adapter.controlId);
    if (
      !safeIdentifier(adapter.commandId) ||
      !digest(adapter.validatorSha256) ||
      !digest(adapter.inputSha256) ||
      !digest(adapter.resultSha256) ||
      !object(adapter.inputSchema) ||
      !object(adapter.assertionSchema)
    )
      problems.push(
        `semantic adapter ${index + 1} must bind command, input, result, assertion, and validator identities`,
      );
    if (
      !AI_TIERS.has(adapter.supportedTier) ||
      AI_TIER_RANK[adapter.supportedTier] <
        AI_TIER_RANK[policy?.effectiveAiTier]
    )
      problems.push(
        `semantic adapter ${index + 1} does not support the effective AI tier`,
      );
    if (
      !Number.isSafeInteger(adapter.timeoutMs) ||
      adapter.timeoutMs < 1 ||
      !Number.isSafeInteger(adapter.maxOutputBytes) ||
      adapter.maxOutputBytes < 1
    )
      problems.push(`semantic adapter ${index + 1} must bound time and output`);
    if (
      !Array.isArray(adapter.assertions) ||
      adapter.assertions.length === 0 ||
      adapter.assertions.some(
        (assertion) =>
          !object(assertion) ||
          !nonEmpty(assertion.metric) ||
          !Number.isFinite(assertion.observed) ||
          assertion.passed !== true,
      )
    )
      problems.push(
        `semantic adapter ${index + 1} must contain passing semantic assertions`,
      );
    const executionResult = validateAuthorityReceipt(
      adapter.executionReceipt,
      "valdris.semantic-execution-receipt.v1",
      options,
    );
    problems.push(
      ...executionResult.problems.map(
        (problem) =>
          `semantic adapter ${index + 1} execution receipt: ${problem}`,
      ),
    );
    const executionReceipt = adapter.executionReceipt;
    if (
      executionReceipt?.runId !== document.runId ||
      executionReceipt?.controlId !== adapter.controlId ||
      executionReceipt?.commandId !== adapter.commandId ||
      executionReceipt?.inputSha256 !== adapter.inputSha256 ||
      executionReceipt?.resultSha256 !== adapter.resultSha256 ||
      executionReceipt?.validatorSha256 !== adapter.validatorSha256 ||
      executionReceipt?.supportedTier !== adapter.supportedTier ||
      executionReceipt?.assertionsSha256 !==
        sha256(canonicalJson(adapter.assertions))
    )
      problems.push(
        `semantic adapter ${index + 1} execution receipt does not bind the commissioned command, input, result, validator, tier, and assertions`,
      );
    if (
      !canonicalIso(executionReceipt?.startedAt) ||
      !canonicalIso(executionReceipt?.finishedAt) ||
      Date.parse(executionReceipt?.finishedAt) <
        Date.parse(executionReceipt?.startedAt) ||
      executionReceipt?.exitCode !== 0 ||
      executionReceipt?.environment !== document.environment
    )
      problems.push(
        `semantic adapter ${index + 1} execution receipt has invalid execution outcome, timestamps, or environment`,
      );
    if (
      !digest(executionReceipt?.executorReceiptPayloadSha256) ||
      !safeIdentifier(executionReceipt?.executorEventId)
    )
      problems.push(
        `semantic adapter ${index + 1} execution receipt must bind its proof executor receipt`,
      );
  }
  for (const threshold of policy?.thresholds || []) {
    if (!controls.has(threshold.controlId)) {
      problems.push(
        `acceptance threshold has no semantic adapter: ${threshold.controlId}`,
      );
      continue;
    }
    const assertion = document.adapters
      .find((adapter) => adapter.controlId === threshold.controlId)
      ?.assertions?.find((candidate) => candidate.metric === threshold.metric);
    if (!assertion) {
      problems.push(
        `acceptance threshold has no matching semantic assertion: ${threshold.controlId}/${threshold.metric}`,
      );
      continue;
    }
    const meets =
      threshold.operator === "gte"
        ? assertion.observed >= threshold.value
        : threshold.operator === "lte"
          ? assertion.observed <= threshold.value
          : assertion.observed === threshold.value;
    if (!meets)
      problems.push(
        `semantic assertion does not meet the commissioned threshold: ${threshold.controlId}/${threshold.metric}`,
      );
  }
  if (
    options.level === "authoritative" &&
    proofExecutor?.validatorSetSha256 !== semanticValidatorSetSha256(document)
  )
    problems.push(
      "acceptance policy proof executor validator set does not match the commissioned semantic adapters",
    );
  const aiTier = document.aiWorkloadIdentity?.tier || "AI0";
  if (baseline) {
    if (
      document.routeSha256 !== baseline.routeSha256 ||
      document.workloadClassificationSha256 !== baseline.classificationSha256
    )
      problems.push(
        "semantic assurance routing digests do not match the immutable route and classification artifacts",
      );
    if (policy?.profile !== baseline.profile)
      problems.push(
        "acceptance policy profile does not match the immutable requested profile",
      );
    if (!sameStringSet(policy?.workloadProfiles, baseline.workloadProfiles))
      problems.push(
        "acceptance policy workloadProfiles do not match immutable classification",
      );
    if (policy?.environment !== baseline.environment)
      problems.push(
        "acceptance policy environment does not match immutable classification",
      );
  }
  if (policy?.effectiveAiTier !== aiTier)
    problems.push(
      "AI workload identity tier does not match the route-effective acceptance-policy tier",
    );
  const augmentedTiers = (augmentation?.additions || [])
    .filter(
      (entry) => entry.kind === "ai-tier-elevation" && AI_TIERS.has(entry.id),
    )
    .map((entry) => entry.id);
  const augmentedEffectiveTier = [
    baseline?.effectiveAiTier || "AI0",
    ...augmentedTiers,
  ].sort((left, right) => AI_TIER_RANK[right] - AI_TIER_RANK[left])[0];
  if (augmentedEffectiveTier !== aiTier)
    problems.push(
      "AI workload identity tier does not match the signed additive assurance augmentation",
    );
  const assuranceElevations = (augmentation?.additions || [])
    .filter(
      (entry) =>
        entry.kind === "assurance-tier-elevation" &&
        Object.hasOwn(ASSURANCE_TIER_RANK, entry.id),
    )
    .map((entry) => entry.id);
  const effectiveAssuranceTier = [
    baseline?.effectiveAssuranceTier || "T0",
    ...assuranceElevations,
  ].sort(
    (left, right) => ASSURANCE_TIER_RANK[right] - ASSURANCE_TIER_RANK[left],
  )[0];
  if (policy?.effectiveAssuranceTier !== effectiveAssuranceTier)
    problems.push(
      "acceptance policy effectiveAssuranceTier does not match the immutable baseline plus additive elevations",
    );
  if (!AI_TIERS.has(aiTier))
    problems.push("AI workload identity tier is invalid");
  if (aiTier !== "AI0") {
    const identity = document.aiWorkloadIdentity;
    if (!object(identity) || identity.schema !== "uash.ai-workload-identity.v1")
      problems.push("AI claims require uash.ai-workload-identity.v1");
    else {
      if (!nonEmpty(identity.taskClass))
        problems.push("AI workload identity taskClass is required");
      for (const field of [
        "modelSha256",
        "providerSha256",
        "promptSha256",
        "toolSetSha256",
        "corpusSha256",
        "memoryPolicySha256",
        "evaluationPlanSha256",
        "smokeTestSha256",
        "observabilityPolicySha256",
      ])
        if (!digest(identity[field]))
          problems.push(`AI workload identity ${field} is invalid`);
    }
  }
  const augmentationSha = object(augmentation)
    ? sha256(canonicalJson(augmentation))
    : null;
  const policySha = object(policy) ? sha256(canonicalJson(policy)) : null;
  if (
    !Array.isArray(document.approvalReceipts) ||
    document.approvalReceipts.length < 2
  )
    problems.push(
      "semantic assurance requires distinct augmentation and acceptance-policy approvals",
    );
  const events = new Set();
  for (const receipt of document.approvalReceipts || []) {
    if (events.has(receipt?.eventId))
      problems.push("approval receipt replay detected");
    else events.add(receipt?.eventId);
  }
  const augmentationApproval = (document.approvalReceipts || []).find(
    (receipt) => receipt.scope === "assurance-augmentation",
  );
  const policyApproval = (document.approvalReceipts || []).find(
    (receipt) => receipt.scope === "acceptance-policy",
  );
  if (augmentationApproval)
    validateApproval(
      augmentationApproval,
      options,
      {
        runId: document.runId,
        scope: "assurance-augmentation",
        artifactSha256: augmentationSha,
      },
      problems,
    );
  else
    problems.push(
      "semantic assurance is missing the augmentation approval receipt",
    );
  if (policyApproval)
    validateApproval(
      policyApproval,
      options,
      {
        runId: document.runId,
        scope: "acceptance-policy",
        artifactSha256: policySha,
      },
      problems,
    );
  else
    problems.push(
      "semantic assurance is missing the acceptance-policy approval receipt",
    );
  return { valid: problems.length === 0, aiTier, problems };
}

function validateAttestedRuntimeReceipt(
  receipt,
  schema,
  options,
  label,
  problems,
) {
  const result = validateAuthorityReceipt(receipt, schema, options);
  problems.push(...result.problems.map((problem) => `${label}: ${problem}`));
}

export function runtimeSessionIdentity(document) {
  return sha256(
    canonicalJson({
      execution: document.execution,
      connectors: document.connectors,
      capabilityPolicy: document.capabilityPolicy,
      toolRegistry: document.toolRegistry,
      toolCallReceipts: document.toolCallReceipts,
      toolApprovalReceipts: document.toolApprovalReceipts,
      hookReceipts: document.hookReceipts,
      context: document.context,
      memoryEvents: document.memoryEvents,
      memoryHeadReceipts: document.memoryHeadReceipts,
      priorMemoryHeadReceipts: document.priorMemoryHeadReceipts,
      runtimeDriver: document.runtimeDriver,
      aiRuntimeIdentity: document.aiRuntimeIdentity,
      modelRouting: object(document.modelRouting)
        ? {
            policySha256: document.modelRouting.policySha256,
            minimumCapabilitySha256:
              document.modelRouting.minimumCapabilitySha256,
            qualitySuiteSha256: document.modelRouting.qualitySuiteSha256,
            fallbackPolicySha256: document.modelRouting.fallbackPolicySha256,
            fallbackReason: document.modelRouting.fallbackReason,
            taskClass: document.modelRouting.taskClass,
            selectedModel: document.modelRouting.selectedModel,
            providerSha256: document.modelRouting.providerSha256,
            lifecycleStage: document.modelRouting.lifecycleStage,
            estimatedCost: document.modelRouting.estimatedCost,
          }
        : document.modelRouting,
      costBudget: document.costBudget,
      economicsLedger: document.economicsLedger,
      acceptanceResults: document.acceptanceResults,
      interop: document.interop,
    }),
  );
}

export function runtimeConformanceSetSha256(document) {
  return sha256(
    canonicalJson({
      connectors: document.connectors,
      capabilityPolicy: document.capabilityPolicy,
      toolRegistry: document.toolRegistry,
      toolCallReceipts: document.toolCallReceipts,
      toolApprovalReceipts: document.toolApprovalReceipts || [],
      hookReceipts: document.hookReceipts,
      context: document.context,
      memoryEvents: document.memoryEvents,
      memoryHeadReceipts: document.memoryHeadReceipts,
      priorMemoryHeadReceipts: document.priorMemoryHeadReceipts || [],
      runtimeDriver: document.runtimeDriver,
      economicsLedger: document.economicsLedger,
      acceptanceResults: document.acceptanceResults,
      interop: document.interop || [],
    }),
  );
}

export function validateRuntimeSessionDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["runtime session must be an object"] };
  if (document.schema !== RUNTIME_SESSION_SCHEMA)
    problems.push(`runtime session schema must be ${RUNTIME_SESSION_SCHEMA}`);
  problems.push(...subjectProblems(document, "runtime session"));
  const execution = document.execution;
  if (
    !object(execution) ||
    !options.policy?.execution?.modes?.includes(execution.mode)
  )
    problems.push("runtime session execution.mode is invalid");
  if (!Array.isArray(execution?.agents) || execution.agents.length === 0)
    problems.push("runtime session execution.agents must be non-empty");
  const ids = new Set();
  for (const [index, agent] of (execution?.agents || []).entries()) {
    if (!object(agent) || !safeIdentifier(agent.id) || ids.has(agent.id))
      problems.push(
        `runtime session agent ${index + 1} id is invalid or duplicated`,
      );
    else ids.add(agent.id);
    if (
      ![
        "scout",
        "implementer",
        "verifier",
        "reviewer",
        "orchestrator",
        "specialist",
      ].includes(agent.role)
    )
      problems.push(`runtime session agent ${index + 1} role is invalid`);
    if (
      agent.parentId !== null &&
      agent.parentId !== undefined &&
      !safeIdentifier(agent.parentId)
    )
      problems.push(`runtime session agent ${index + 1} parentId is invalid`);
  }
  for (const agent of execution?.agents || [])
    if (agent.parentId && !ids.has(agent.parentId))
      problems.push(
        `runtime session agent ${agent.id} references an unknown parent`,
      );
  const parent = new Map(
    (execution?.agents || []).map((agent) => [agent.id, agent.parentId]),
  );
  for (const id of ids) {
    const visited = new Set();
    let cursor = id;
    while (cursor) {
      if (visited.has(cursor)) {
        problems.push(`runtime session agent DAG contains a cycle at ${id}`);
        break;
      }
      visited.add(cursor);
      cursor = parent.get(cursor);
    }
  }
  if (execution?.mode === "single-agent" && ids.size !== 1)
    problems.push("single-agent mode must contain exactly one agent");
  if (
    execution?.mode !== "single-agent" &&
    !Number.isSafeInteger(execution?.maxParallelAgents)
  )
    problems.push("multi-agent execution must declare maxParallelAgents");
  const depthWidths = new Map();
  for (const id of ids) {
    let depth = 0;
    let cursor = parent.get(id);
    const seen = new Set([id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = parent.get(cursor);
    }
    depthWidths.set(depth, (depthWidths.get(depth) || 0) + 1);
  }
  const dagWidth = Math.max(0, ...depthWidths.values());
  if (
    Number.isSafeInteger(execution?.maxParallelAgents) &&
    dagWidth > execution.maxParallelAgents
  )
    problems.push("runtime session DAG width exceeds maxParallelAgents");
  if (
    !Array.isArray(execution?.fanIn) ||
    execution.fanIn.some(
      (entry) =>
        !object(entry) ||
        !safeIdentifier(entry.childId) ||
        !safeIdentifier(entry.parentId) ||
        parent.get(entry.childId) !== entry.parentId ||
        entry.status !== "joined" ||
        !digest(entry.inputSha256) ||
        !digest(entry.outputSha256) ||
        !canonicalIso(entry.joinedAt),
    )
  )
    problems.push(
      "runtime session execution.fanIn must prove parent-bound joined child inputs and outputs",
    );
  if (execution?.mode !== "single-agent")
    for (const agent of execution?.agents || [])
      if (
        agent.parentId &&
        !execution.fanIn?.some((entry) => entry.childId === agent.id)
      )
        problems.push(
          `runtime session child ${agent.id} has no fan-in receipt`,
        );
  const connectors = document.connectors;
  if (!Array.isArray(connectors) || connectors.length === 0)
    problems.push("runtime session connectors must be non-empty");
  for (const [index, connector] of (connectors || []).entries()) {
    if (
      !object(connector) ||
      !safeIdentifier(connector.id) ||
      !nonEmpty(connector.version) ||
      !object(connector.capabilityManifest) ||
      !Array.isArray(connector.capabilityManifest.capabilities) ||
      !object(connector.conformanceEvidence) ||
      connector.conformanceEvidence.passed !== true ||
      !Array.isArray(connector.conformanceEvidence.tests) ||
      connector.conformanceEvidence.tests.length === 0 ||
      !digest(connector.capabilityManifestSha256) ||
      connector.capabilityManifestSha256 !==
        sha256(canonicalJson(connector.capabilityManifest)) ||
      !digest(connector.conformanceEvidenceSha256) ||
      connector.conformanceEvidenceSha256 !==
        sha256(canonicalJson(connector.conformanceEvidence))
    )
      problems.push(
        `runtime session connector ${index + 1} is invalid or lacks bound conformance evidence`,
      );
  }
  const capabilityPolicy = document.capabilityPolicy;
  if (
    !object(capabilityPolicy) ||
    !digest(capabilityPolicy.policySha256) ||
    !Array.isArray(capabilityPolicy.grants)
  )
    problems.push("runtime session capabilityPolicy is invalid");
  const allowedCapabilities = new Set(
    options.policy?.execution?.capabilities || [],
  );
  const resourceTypes = new Set([
    "capability",
    "data",
    "network",
    "filesystem",
  ]);
  const grantIdentities = new Set();
  for (const [index, grant] of (capabilityPolicy?.grants || []).entries())
    if (
      !object(grant) ||
      !ids.has(grant.agentId) ||
      !resourceTypes.has(grant.resourceType) ||
      !nonEmpty(grant.resource) ||
      (grant.resourceType === "capability" &&
        !allowedCapabilities.has(grant.resource)) ||
      grantIdentities.has(
        `${grant.agentId}:${grant.resourceType}:${grant.resource}`,
      )
    )
      problems.push(`runtime session capability grant ${index + 1} is invalid`);
    else
      grantIdentities.add(
        `${grant.agentId}:${grant.resourceType}:${grant.resource}`,
      );
  const toolRegistryResult = loadAndValidateOperatingArtifact(
    options.repoRoot,
    document.toolRegistry,
    "runtime/tool-registry.json",
    validateToolRegistryDocument,
  );
  problems.push(
    ...toolRegistryResult.problems.map(
      (problem) => `runtime session tool registry: ${problem}`,
    ),
  );
  const toolCallValidation = validateToolCallReceipts(
    document.toolCallReceipts,
    toolRegistryResult.document,
    {
      agentIds: [...ids],
      grants: capabilityPolicy?.grants || [],
      hookReceipts: document.hookReceipts || [],
      approvalReceipts: document.toolApprovalReceipts || [],
    },
  );
  problems.push(
    ...toolCallValidation.problems.map(
      (problem) => `runtime session ${problem}`,
    ),
  );
  if (!Array.isArray(document.hookReceipts))
    problems.push("runtime session hookReceipts must be an array");
  const hookEventIds = new Set();
  for (const [index, hookReceipt] of (document.hookReceipts || []).entries()) {
    if (
      !object(hookReceipt) ||
      !safeIdentifier(hookReceipt.eventId) ||
      hookEventIds.has(hookReceipt.eventId) ||
      !nonEmpty(hookReceipt.hook) ||
      !["allow", "deny"].includes(hookReceipt.outcome) ||
      typeof hookReceipt.enforced !== "boolean" ||
      !digest(hookReceipt.policySha256) ||
      !digest(hookReceipt.inputSha256) ||
      !digest(hookReceipt.evidenceSha256) ||
      (["before-tool", "after-tool"].includes(hookReceipt.hook) &&
        (!safeIdentifier(hookReceipt.toolCallEventId) ||
          !digest(hookReceipt.toolIdentitySha256) ||
          (hookReceipt.hook === "after-tool" &&
            !digest(hookReceipt.outputSha256))))
    )
      problems.push(`runtime session hook receipt ${index + 1} is invalid`);
    else hookEventIds.add(hookReceipt.eventId);
  }
  if (!Array.isArray(document.toolApprovalReceipts))
    problems.push("runtime session toolApprovalReceipts must be an array");
  const requiredHooks = new Set(options.policy?.execution?.hookPoints || []);
  for (const hook of requiredHooks)
    if (
      !(document.hookReceipts || []).some(
        (receipt) =>
          receipt.hook === hook &&
          receipt.outcome === "allow" &&
          receipt.enforced === true &&
          digest(receipt.policySha256) &&
          digest(receipt.inputSha256) &&
          digest(receipt.evidenceSha256),
      )
    )
      problems.push(`runtime session is missing enforced hook ${hook}`);
  if (
    !object(document.context) ||
    document.context.schema !== CONTEXT_MANIFEST_V2_SCHEMA ||
    document.context.path !== "context/manifest.json" ||
    !digest(document.context.manifestSha256) ||
    !Number.isSafeInteger(document.context.tokenBudget) ||
    document.context.tokenBudget < 1 ||
    !Number.isSafeInteger(document.context.tokensLoaded) ||
    document.context.tokensLoaded > document.context.tokenBudget
  )
    problems.push(
      "runtime session context must bind a budget-compliant v2 manifest",
    );
  else if (options.repoRoot) {
    try {
      const contextPath = resolveArtifactPath(
        options.repoRoot,
        document.context.path,
        { mustExist: true },
      );
      if (fileSha256(contextPath) !== document.context.manifestSha256)
        problems.push("runtime session context manifest digest does not match");
      const validation = validateContextManifest(contextPath, {
        repoRoot: options.repoRoot,
      });
      if (!validation.valid || validation.schema !== CONTEXT_MANIFEST_V2_SCHEMA)
        problems.push(
          `runtime session context manifest is invalid: ${validation.problems.join("; ")}`,
        );
      const manifest = readJson(contextPath);
      if (
        document.context.tokenBudget !== manifest.budget?.maxTokens ||
        document.context.tokensLoaded !== manifest.budget?.loadedTokens
      )
        problems.push(
          "runtime session context token counts must exactly match the bound manifest budget",
        );
    } catch (error) {
      problems.push(
        `runtime session context manifest is invalid: ${error.message}`,
      );
    }
  }
  if (!Array.isArray(document.memoryEvents))
    problems.push("runtime session memoryEvents must be an array");
  const memoryActions = new Set(options.policy?.context?.memoryActions || []);
  for (const [index, event] of (document.memoryEvents || []).entries()) {
    if (
      !object(event) ||
      !safeIdentifier(event.memoryId) ||
      !memoryActions.has(event.action) ||
      !options.policy?.context?.isolationScopes?.includes(event.scope) ||
      !digest(event.contentSha256) ||
      !canonicalIso(event.occurredAt) ||
      !nonEmpty(event.owner) ||
      !safeIdentifier(event.headReceiptEventId)
    )
      problems.push(`runtime session memory event ${index + 1} is invalid`);
    if (
      ["write", "update"].includes(event?.action) &&
      (!canonicalIso(event.expiresAt) ||
        Date.parse(event.expiresAt) <= Date.parse(event.occurredAt))
    )
      problems.push(
        `runtime session memory event ${index + 1} must declare future expiry`,
      );
    if (event?.scope === "tenant" && !safeIdentifier(event.tenantId))
      problems.push(
        `runtime session memory event ${index + 1} must bind tenantId`,
      );
  }
  const memoryState = new Map();
  const memoryIsolation = new Map();
  for (const [index, event] of (document.memoryEvents || []).entries()) {
    if (!object(event) || !safeIdentifier(event.memoryId)) continue;
    const isolation = `${event.scope}:${event.tenantId || "-"}`;
    if (
      memoryIsolation.has(event.memoryId) &&
      memoryIsolation.get(event.memoryId) !== isolation
    )
      problems.push(
        `runtime session memory ${event.memoryId} crosses an isolation boundary`,
      );
    else memoryIsolation.set(event.memoryId, isolation);
    const prior = memoryState.get(event.memoryId);
    if (prior && prior.owner !== event.owner)
      problems.push(
        `runtime session memory ${event.memoryId} cannot change owner`,
      );
    if (prior?.terminal)
      problems.push(
        `runtime session memory ${event.memoryId} has events after ${prior.action}`,
      );
    if (prior && Date.parse(event.occurredAt) < Date.parse(prior.occurredAt))
      problems.push(
        `runtime session memory ${event.memoryId} events are out of order`,
      );
    if (["delete", "expire"].includes(event.action))
      memoryState.set(event.memoryId, { ...event, terminal: true });
    else memoryState.set(event.memoryId, event);
    if (
      event.action === "read" &&
      prior &&
      event.contentSha256 !== prior.contentSha256
    )
      problems.push(
        `runtime session memory ${event.memoryId} read does not bind current content`,
      );
  }
  const memoryContinuity = validateMemoryContinuity(
    document.memoryEvents,
    document.memoryHeadReceipts,
    {
      now: options.now,
      sessionIdentitySha256: document.sessionIdentitySha256,
      emptyHeadSha256: options.policy?.context?.emptyMemoryHeadSha256,
      priorReceipts: document.priorMemoryHeadReceipts || [],
    },
  );
  problems.push(
    ...memoryContinuity.problems.map((problem) => `runtime session ${problem}`),
  );
  for (const [index, receipt] of (document.memoryHeadReceipts || []).entries())
    if (receipt?.runId !== document.runId)
      problems.push(
        `runtime session current memory-head receipt ${index + 1} belongs to a different run`,
      );
  for (const [index, receipt] of (
    document.priorMemoryHeadReceipts || []
  ).entries())
    if (receipt?.runId === document.runId)
      problems.push(
        `runtime session prior memory-head receipt ${index + 1} must come from a different run`,
      );
  for (const [index, receipt] of (
    document.toolApprovalReceipts || []
  ).entries())
    if (receipt?.runId !== document.runId)
      problems.push(
        `runtime session tool approval receipt ${index + 1} belongs to a different run`,
      );
  let activeGoalSha256 = null;
  if (options.repoRoot)
    try {
      activeGoalSha256 = fileSha256(
        resolveArtifactPath(options.repoRoot, "goal/goal.json", {
          mustExist: true,
        }),
      );
    } catch (error) {
      problems.push(`runtime session active goal is invalid: ${error.message}`);
    }
  const runtimeDriverResult = loadAndValidateOperatingArtifact(
    options.repoRoot,
    document.runtimeDriver,
    "runtime/driver.json",
    validateRuntimeDriverDocument,
    { goalSha256: activeGoalSha256, repoRoot: options.repoRoot },
  );
  problems.push(
    ...runtimeDriverResult.problems.map(
      (problem) => `runtime session driver: ${problem}`,
    ),
  );
  if (runtimeDriverResult.document)
    sameSubject(
      runtimeDriverResult.document,
      document,
      "runtime driver",
      problems,
    );
  if (runtimeDriverResult.document && options.repoRoot)
    try {
      const readiness = readJson(
        resolveArtifactPath(
          options.repoRoot,
          V09_CANONICAL_ARTIFACTS.readiness,
          {
            mustExist: true,
          },
        ),
      );
      if (
        runtimeDriverResult.document.implementationReceipt?.beforeTreeSha256 !==
        readiness.implementationFixedPoint?.baseTreeSha256
      )
        problems.push(
          "runtime implementation receipt does not begin at the sealed pre-implementation fixed point",
        );
    } catch (error) {
      problems.push(
        `runtime implementation fixed point is invalid: ${error.message}`,
      );
    }
  if (
    !object(document.modelRouting) ||
    !digest(document.modelRouting.policySha256) ||
    !digest(document.modelRouting.minimumCapabilitySha256) ||
    !digest(document.modelRouting.qualitySuiteSha256) ||
    !digest(document.modelRouting.fallbackPolicySha256) ||
    !nonEmpty(document.modelRouting.fallbackReason) ||
    !nonEmpty(document.modelRouting.taskClass) ||
    !nonEmpty(document.modelRouting.selectedModel) ||
    !digest(document.modelRouting.providerSha256) ||
    !options.policy?.modelLifecycleStages?.includes(
      document.modelRouting.lifecycleStage,
    ) ||
    !Number.isFinite(document.modelRouting.estimatedCost) ||
    document.modelRouting.estimatedCost < 0
  )
    problems.push("runtime session modelRouting is invalid");
  const aiIdentity = document.aiRuntimeIdentity;
  if (
    !object(aiIdentity) ||
    aiIdentity.schema !== "uash.ai-workload-identity.v1" ||
    !AI_TIERS.has(aiIdentity.tier) ||
    !nonEmpty(aiIdentity.taskClass)
  )
    problems.push("runtime session must bind uash.ai-workload-identity.v1");
  else
    for (const field of [
      "modelSha256",
      "providerSha256",
      "promptSha256",
      "toolSetSha256",
      "corpusSha256",
      "memoryPolicySha256",
      "evaluationPlanSha256",
      "smokeTestSha256",
      "observabilityPolicySha256",
    ])
      if (!digest(aiIdentity[field]))
        problems.push(`runtime session AI identity ${field} is invalid`);
  if (
    !object(document.costBudget) ||
    !nonEmpty(document.costBudget.currency) ||
    !Number.isFinite(document.costBudget.maximum) ||
    document.costBudget.maximum < 0 ||
    !Number.isFinite(document.costBudget.actual) ||
    document.costBudget.actual < 0 ||
    document.costBudget.actual > document.costBudget.maximum ||
    document.costBudget.actual !== document.modelRouting?.estimatedCost
  )
    problems.push("runtime session costBudget is invalid or exceeded");
  let trajectoryAttempts;
  if (options.repoRoot)
    try {
      trajectoryAttempts = readJson(
        resolveArtifactPath(options.repoRoot, "trajectory/trajectory.json", {
          mustExist: true,
        }),
      )?.attempts?.length;
    } catch (error) {
      problems.push(
        `runtime session trajectory economics are invalid: ${error.message}`,
      );
    }
  const economicsResult = loadAndValidateOperatingArtifact(
    options.repoRoot,
    document.economicsLedger,
    "runtime/economics.json",
    validateAiEconomicsLedgerDocument,
    {
      usageReceipt: object(document.usageReceipt)
        ? document.usageReceipt
        : undefined,
      toolCallCount: Array.isArray(document.toolCallReceipts)
        ? document.toolCallReceipts.length
        : undefined,
      toolCallReceipts: document.toolCallReceipts || [],
      toolRegistry: toolRegistryResult.document,
      attempts: trajectoryAttempts,
      multiTenant: options.workloadProfiles?.includes("saas"),
    },
  );
  problems.push(
    ...economicsResult.problems.map(
      (problem) => `runtime session economics: ${problem}`,
    ),
  );
  if (economicsResult.document) {
    sameSubject(
      economicsResult.document,
      document,
      "AI economics ledger",
      problems,
    );
    if (
      economicsResult.document.currency !== document.costBudget?.currency ||
      economicsResult.document.totals?.actualSpend !==
        document.costBudget?.actual ||
      economicsResult.document.totals?.maximumSpend !==
        document.costBudget?.maximum
    )
      problems.push(
        "runtime session economics ledger does not match the runtime cost budget",
      );
  }
  const acceptanceResult = loadAndValidateOperatingArtifact(
    options.repoRoot,
    document.acceptanceResults,
    "run/acceptance-results.json",
    validateAcceptanceResultsDocument,
  );
  problems.push(
    ...acceptanceResult.problems.map(
      (problem) => `runtime session acceptance results: ${problem}`,
    ),
  );
  if (acceptanceResult.document && options.repoRoot) {
    try {
      const readiness = readJson(
        resolveArtifactPath(
          options.repoRoot,
          "run/implementation-readiness.json",
          {
            mustExist: true,
          },
        ),
      );
      const requirements = readJson(
        resolveArtifactPath(
          options.repoRoot,
          "run/requirements-contract.json",
          {
            mustExist: true,
          },
        ),
      );
      const acceptanceValidation = validateRequirementsContractDocument(
        requirements,
        {
          redBaselines: readiness.redBaselines,
          evalPlan: readiness.evalPlan,
          goal: readJson(
            resolveArtifactPath(options.repoRoot, "goal/goal.json", {
              mustExist: true,
            }),
          ),
          acceptanceResults: acceptanceResult.document,
          repoRoot: options.repoRoot,
        },
      );
      problems.push(
        ...acceptanceValidation.problems.map(
          (problem) => `runtime session requirements closure: ${problem}`,
        ),
      );
    } catch (error) {
      problems.push(
        `runtime session requirements closure is invalid: ${error.message}`,
      );
    }
  }
  const trace = document.traceReceipt;
  if (
    !object(trace) ||
    trace.schema !== TRACE_RECEIPT_SCHEMA ||
    trace.runId !== document.runId ||
    !safeIdentifier(trace.traceId) ||
    !nonEmpty(trace.tracePath) ||
    !digest(trace.traceSha256) ||
    !Number.isSafeInteger(trace.actionCount) ||
    trace.actionCount < 1 ||
    !digest(trace.firstEventSha256) ||
    !digest(trace.lastEventSha256) ||
    !digest(trace.redactionPolicySha256) ||
    !object(trace.trajectoryArtifact) ||
    trace.trajectoryArtifact.path !== "trajectory/trajectory.json" ||
    !digest(trace.trajectoryArtifact.sha256) ||
    !object(trace.decisionEvidence) ||
    trace.decisionEvidence.path !== "runtime/decision-evidence.json" ||
    !digest(trace.decisionEvidence.sha256)
  )
    problems.push(
      "trace receipt must bind the observable trace, redaction policy, evaluated trajectory, and decision evidence",
    );
  else if (options.repoRoot) {
    try {
      const observed = countObservableTraceEvents(
        options.repoRoot,
        trace.tracePath,
      );
      if (
        observed.sha256 !== trace.traceSha256 ||
        observed.count !== trace.actionCount ||
        observed.firstEventSha256 !== trace.firstEventSha256 ||
        observed.lastEventSha256 !== trace.lastEventSha256
      )
        problems.push(
          "trace receipt does not match the observable trace bytes and event count",
        );
      const trajectoryPath = resolveArtifactPath(
        options.repoRoot,
        trace.trajectoryArtifact.path,
        { mustExist: true },
      );
      const trajectory = readJson(trajectoryPath);
      if (fileSha256(trajectoryPath) !== trace.trajectoryArtifact.sha256)
        problems.push(
          "trace receipt trajectory artifact digest does not match",
        );
      if (
        trajectory.tracePath !== trace.tracePath ||
        trajectory.traceDigest !== trace.traceSha256
      )
        problems.push(
          "trace receipt is not cross-bound to the trajectory that was evaluated",
        );
      const decisionPath = resolveArtifactPath(
        options.repoRoot,
        trace.decisionEvidence.path,
        { mustExist: true },
      );
      if (fileSha256(decisionPath) !== trace.decisionEvidence.sha256)
        problems.push("trace receipt decision-evidence digest does not match");
      const decisionEvidence = readJson(decisionPath);
      const decisionValidation =
        validateDecisionEvidenceDocument(decisionEvidence);
      problems.push(
        ...decisionValidation.problems.map(
          (problem) => `trace receipt decision evidence: ${problem}`,
        ),
      );
      sameSubject(decisionEvidence, document, "decision evidence", problems);
      const observedDecisions = observed.events
        .filter((event) => event.type === "decision")
        .map((event) => ({
          id: event.decisionId,
          evidenceSha256: event.decisionEvidenceSha256,
        }));
      const expectedDecisions = (decisionEvidence.decisions || []).map(
        (decision) => ({
          id: decision.id,
          evidenceSha256: decision.evidenceSha256,
        }),
      );
      if (canonicalJson(observedDecisions) !== canonicalJson(expectedDecisions))
        problems.push(
          "trace decision events do not exactly cover the bound decision evidence",
        );
    } catch (error) {
      problems.push(`trace receipt artifacts are invalid: ${error.message}`);
    }
  }
  if (
    !digest(document.sessionIdentitySha256) ||
    document.sessionIdentitySha256 !== runtimeSessionIdentity(document)
  )
    problems.push(
      "runtime session sessionIdentitySha256 does not match the bound execution",
    );
  const conformance = document.conformanceReceipt;
  validateAttestedRuntimeReceipt(
    conformance,
    "valdris.runtime-conformance-receipt.v1",
    options,
    "runtime conformance receipt",
    problems,
  );
  if (
    conformance?.runId !== document.runId ||
    conformance?.sessionIdentitySha256 !== document.sessionIdentitySha256 ||
    conformance?.conformanceSetSha256 !== runtimeConformanceSetSha256(document)
  )
    problems.push(
      "runtime conformance receipt does not bind the session connector, hook, context, memory, and interop evidence",
    );
  if (options.level === "authoritative") {
    validateAttestedRuntimeReceipt(
      document.modelRouting?.receipt,
      "valdris.model-routing-receipt.v1",
      options,
      "model routing receipt",
      problems,
    );
    validateAttestedRuntimeReceipt(
      document.traceReceipt,
      TRACE_RECEIPT_SCHEMA,
      options,
      "trace receipt",
      problems,
    );
    validateAttestedRuntimeReceipt(
      document.usageReceipt,
      "valdris.usage-receipt.v1",
      options,
      "usage receipt",
      problems,
    );
    validateAttestedRuntimeReceipt(
      document.executorReceipt,
      "valdris.proof-executor-receipt.v1",
      options,
      "executor receipt",
      problems,
    );
    validateAttestedRuntimeReceipt(
      document.executorAuthoritySeparationReceipt,
      EXECUTOR_AUTHORITY_SEPARATION_RECEIPT_SCHEMA,
      options,
      "executor authority-separation receipt",
      problems,
    );
    validateAttestedRuntimeReceipt(
      document.bridgeHeadReceipt,
      "valdris.bridge-head-receipt.v1",
      options,
      "bridge-head receipt",
      problems,
    );
    for (const [index, receipt] of (Array.isArray(document.memoryHeadReceipts)
      ? document.memoryHeadReceipts
      : []
    ).entries())
      validateAttestedRuntimeReceipt(
        receipt,
        MEMORY_HEAD_RECEIPT_SCHEMA,
        options,
        `memory-head receipt ${index + 1}`,
        problems,
      );
    for (const [index, receipt] of (Array.isArray(
      document.priorMemoryHeadReceipts,
    )
      ? document.priorMemoryHeadReceipts
      : []
    ).entries())
      validateAttestedRuntimeReceipt(
        receipt,
        MEMORY_HEAD_RECEIPT_SCHEMA,
        options,
        `prior memory-head receipt ${index + 1}`,
        problems,
      );
    for (const [index, receipt] of (Array.isArray(document.toolApprovalReceipts)
      ? document.toolApprovalReceipts
      : []
    ).entries())
      validateAttestedRuntimeReceipt(
        receipt,
        "uash.tool-approval-receipt.v1",
        options,
        `tool approval receipt ${index + 1}`,
        problems,
      );
    validateAttestedRuntimeReceipt(
      runtimeDriverResult.document?.implementationReceipt,
      IMPLEMENTATION_EXECUTION_RECEIPT_SCHEMA,
      options,
      "implementation execution receipt",
      problems,
    );
    const executor = document.executorReceipt;
    const commissionedExecutor = options.acceptancePolicy?.proofExecutor;
    const snapshotManifest = executor?.sourceSnapshotManifest;
    const daemonIdentity = executor?.daemonIdentity;
    if (
      !validExecutorAuthoritySeparationBinding(document, commissionedExecutor)
    )
      problems.push(
        "authoritative executor lacks an independently signed external-principal authority-separation receipt",
      );
    if (
      executor?.readOnlySource !== true ||
      executor?.sourceSnapshotMode !==
        "git-raw-object-tree-content-addressed-oci-layer" ||
      executor?.liveWorktreeMount !== false ||
      executor?.isolatedOutput !== true ||
      executor?.exclusiveOutputRoot !== true ||
      !digest(executor?.outputRootPathSha256) ||
      !digest(executor?.outputRootIdentitySha256) ||
      !digest(executor?.outputDirectoryIdentitySha256) ||
      !digest(executor?.outputRootPolicySha256) ||
      executor?.outputRootPolicySha256 !==
        sha256(
          canonicalJson({
            pathSha256: executor?.outputRootPathSha256,
            identitySha256: executor?.outputRootIdentitySha256,
          }),
        ) ||
      executor?.containerIdentity !== "cidfile-and-unique-name" ||
      executor?.inheritAmbientSecrets !== false ||
      !validRuntimeExecutionIsolationBinding(executor)
    )
      problems.push("authoritative executor receipt violates isolation policy");
    if (!validExecutorResourceLimits(executor?.limits))
      problems.push(
        "authoritative executor receipt resource limits, total wall-clock scope, or cleanup reserve are invalid",
      );
    if (executor?.mutationResult !== "source-frozen-immutable-image")
      problems.push(
        "authoritative executor receipt must prove execution used a frozen immutable source image",
      );
    if (
      !/^[a-f0-9]{40,64}$/i.test(executor?.sourceCommit || "") ||
      !digest(executor?.sourceTreeSha256) ||
      !digest(executor?.workingTreeSha256) ||
      !digest(executor?.argvSha256) ||
      !digest(executor?.commandIdentitySha256) ||
      !digest(executor?.validatorSha256) ||
      !digest(executor?.inputSetSha256) ||
      !digest(executor?.outputSetSha256) ||
      !digest(executor?.semanticProofSetSha256) ||
      !digest(executor?.proofInputSetSha256) ||
      !digest(executor?.acceptedGateArtifactsSha256) ||
      !digest(executor?.imageSha256) ||
      !digest(executor?.sourceSnapshotSha256) ||
      !digest(executor?.sourceSnapshotManifestSha256) ||
      !digest(executor?.executionImageSha256) ||
      !safeIdentifier(executor?.executorId) ||
      !["docker", "podman"].includes(executor?.runtimeKind) ||
      executor?.runtimeEndpoint !== "local-default" ||
      executor?.runtimeExecutionMode !== "hardened-private-capsule" ||
      !validRuntimeExecutionIsolationBinding(executor) ||
      !portableAbsolutePath(executor?.runtimeCliPath) ||
      executor?.runtimeCliPathSha256 !==
        sha256(executor?.runtimeCliPath || "") ||
      !digest(executor?.runtimeCliSha256) ||
      !digest(executor?.runtimeExecutionPathSha256) ||
      executor?.runtimeExecutionSha256 !== executor?.runtimeCliSha256 ||
      !digest(executor?.runtimeExecutionRootPathSha256) ||
      !digest(executor?.runtimeExecutionRootIdentitySha256) ||
      !portableAbsolutePath(executor?.gitCliPath) ||
      executor?.gitCliPathSha256 !== sha256(executor?.gitCliPath || "") ||
      !digest(executor?.gitCliSha256) ||
      !digest(executor?.daemonIdentitySha256)
    )
      problems.push(
        "authoritative executor receipt does not bind raw source manifest, execution image, argv, executor, Git/runtime binaries, trusted-host versus isolated-workload boundary, hardened runtime capsule, daemon, stable output root, input, and output identities",
      );
    if (
      !object(snapshotManifest) ||
      snapshotManifest.schema !== "valdris.git-object-tree-manifest.v1" ||
      snapshotManifest.commit !== executor?.sourceCommit ||
      sha256(snapshotManifest.tree || "") !== executor?.sourceTreeSha256 ||
      !["sha1", "sha256"].includes(snapshotManifest.objectFormat) ||
      !Array.isArray(snapshotManifest.entries) ||
      snapshotManifest.entries.length === 0 ||
      snapshotManifest.entries.some(
        (entry) =>
          !object(entry) ||
          !nonEmpty(entry.path) ||
          !["100644", "100755", "120000"].includes(entry.mode) ||
          entry.type !== "blob" ||
          !/^[a-f0-9]{40}([a-f0-9]{24})?$/i.test(entry.objectId || "") ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          !digest(entry.contentSha256),
      ) ||
      new Set(snapshotManifest.entries.map((entry) => entry.path)).size !==
        snapshotManifest.entries.length ||
      canonicalJson(
        [...snapshotManifest.entries].sort((left, right) =>
          compareUtf8Path(left.path, right.path),
        ),
      ) !== canonicalJson(snapshotManifest.entries) ||
      executor?.sourceSnapshotManifestSha256 !==
        sha256(canonicalJson(snapshotManifest))
    )
      problems.push(
        "authoritative executor receipt raw Git tree manifest is invalid, incomplete, duplicated, unsorted, or digest-mismatched",
      );
    if (
      !object(daemonIdentity) ||
      daemonIdentity.schema !== "valdris.oci-daemon-identity.v1" ||
      daemonIdentity.runtimeKind !== executor?.runtimeKind ||
      daemonIdentity.endpoint !== "local-default" ||
      !nonEmpty(daemonIdentity.daemonId) ||
      !nonEmpty(daemonIdentity.daemonVersion) ||
      executor?.daemonIdentitySha256 !== sha256(canonicalJson(daemonIdentity))
    )
      problems.push(
        "authoritative executor receipt daemon identity is invalid or digest-mismatched",
      );
    if (
      object(commissionedExecutor) &&
      (executor?.commandIdentitySha256 !==
        commissionedExecutor.commandIdentitySha256 ||
        executor?.validatorSha256 !== commissionedExecutor.validatorSetSha256 ||
        executor?.imageSha256 !== commissionedExecutor.imageSha256 ||
        executor?.executorId !== commissionedExecutor.executorId ||
        executor?.sourceSnapshotMode !==
          commissionedExecutor.sourceSnapshotMode ||
        executor?.liveWorktreeMount !==
          commissionedExecutor.liveWorktreeMount ||
        executor?.exclusiveOutputRoot !==
          commissionedExecutor.exclusiveOutputRoot ||
        executor?.outputRootPathSha256 !==
          commissionedExecutor.outputRootPathSha256 ||
        executor?.outputRootIdentitySha256 !==
          commissionedExecutor.outputRootIdentitySha256 ||
        executor?.outputRootPolicySha256 !==
          commissionedExecutor.outputRootPolicySha256 ||
        executor?.containerIdentity !==
          commissionedExecutor.containerIdentity ||
        executor?.runtimeKind !== commissionedExecutor.runtimeKind ||
        executor?.runtimeEndpoint !== commissionedExecutor.runtimeEndpoint ||
        executor?.runtimeExecutionMode !==
          commissionedExecutor.runtimeExecutionMode ||
        executor?.runtimeExecutionThreatBoundary !==
          commissionedExecutor.runtimeExecutionThreatBoundary ||
        executor?.runtimeExecutionSamePrincipalCompromisePolicy !==
          commissionedExecutor.runtimeExecutionSamePrincipalCompromisePolicy ||
        executor?.runtimeExecutionAuthorityIdentitySha256 !==
          commissionedExecutor.runtimeExecutionAuthorityIdentitySha256 ||
        executor?.runtimeExecutionIsolationPolicySha256 !==
          commissionedExecutor.runtimeExecutionIsolationPolicySha256 ||
        executor?.containerUid !== commissionedExecutor.containerUid ||
        executor?.containerGid !== commissionedExecutor.containerGid ||
        executor?.hostMounts !== commissionedExecutor.hostMounts ||
        executor?.capsuleAccess !== commissionedExecutor.capsuleAccess ||
        executor?.networkPolicy !== commissionedExecutor.networkPolicy ||
        executor?.inheritAmbientSecrets !==
          commissionedExecutor.inheritAmbientSecrets ||
        executor?.runtimeCliPath !== commissionedExecutor.runtimeCliPath ||
        executor?.runtimeCliPathSha256 !==
          commissionedExecutor.runtimeCliPathSha256 ||
        executor?.runtimeCliSha256 !== commissionedExecutor.runtimeCliSha256 ||
        executor?.gitCliPath !== commissionedExecutor.gitCliPath ||
        executor?.gitCliPathSha256 !== commissionedExecutor.gitCliPathSha256 ||
        executor?.gitCliSha256 !== commissionedExecutor.gitCliSha256 ||
        executor?.daemonIdentitySha256 !==
          commissionedExecutor.daemonIdentitySha256 ||
        canonicalJson(executor?.limits) !==
          canonicalJson(commissionedExecutor.limits))
    )
      problems.push(
        "authoritative executor receipt substituted a commissioned command, validator, image, executor, raw source mode, output-root identity, Git/runtime binary or capsule mode, daemon, container identity, or resource limits",
      );
    const executorElapsedMs =
      Date.parse(executor?.finishedAt) - Date.parse(executor?.startedAt);
    if (
      !canonicalIso(executor?.startedAt) ||
      !canonicalIso(executor?.finishedAt) ||
      !Number.isFinite(executorElapsedMs) ||
      executorElapsedMs < 0 ||
      !Number.isSafeInteger(executor?.completedOperationElapsedMs) ||
      executor.completedOperationElapsedMs !== executorElapsedMs ||
      (validExecutorResourceLimits(executor?.limits) &&
        executorElapsedMs > executor.limits.wallClockMs) ||
      executor?.exitCode !== 0
    )
      problems.push(
        "authoritative executor receipt timestamps or completed operation duration exceed the commissioned total wall-clock limit or its exit result is invalid",
      );
    for (const [label, receipt] of [
      ["model routing", document.modelRouting?.receipt],
      ["trace", document.traceReceipt],
      ["usage", document.usageReceipt],
    ])
      if (receipt?.sessionIdentitySha256 !== document.sessionIdentitySha256)
        problems.push(
          `${label} receipt does not bind the runtime session identity`,
        );
    const routingReceipt = document.modelRouting?.receipt;
    if (
      routingReceipt?.runId !== document.runId ||
      routingReceipt?.providerSha256 !==
        document.modelRouting?.providerSha256 ||
      routingReceipt?.policySha256 !== document.modelRouting?.policySha256 ||
      routingReceipt?.minimumCapabilitySha256 !==
        document.modelRouting?.minimumCapabilitySha256 ||
      routingReceipt?.qualitySuiteSha256 !==
        document.modelRouting?.qualitySuiteSha256 ||
      routingReceipt?.fallbackPolicySha256 !==
        document.modelRouting?.fallbackPolicySha256 ||
      routingReceipt?.fallbackReason !==
        document.modelRouting?.fallbackReason ||
      routingReceipt?.taskClass !== document.modelRouting?.taskClass ||
      routingReceipt?.lifecycleStage !==
        document.modelRouting?.lifecycleStage ||
      routingReceipt?.selectedModelSha256 !==
        sha256(document.modelRouting?.selectedModel || "")
    )
      problems.push(
        "model-routing receipt does not bind provider, policy, minimum capability, quality suite, fallback decision, task, lifecycle, selected model, and session",
      );
    if (
      !digest(document.usageReceipt?.usageSha256) ||
      !Number.isSafeInteger(document.usageReceipt?.inputTokens) ||
      !Number.isSafeInteger(document.usageReceipt?.outputTokens) ||
      document.usageReceipt?.totalTokens !==
        document.usageReceipt?.inputTokens +
          document.usageReceipt?.outputTokens ||
      document.usageReceipt?.currency !== document.costBudget?.currency
    )
      problems.push(
        "usage receipt must bind token counts, cost, currency, and session",
      );
    if (document.usageReceipt?.cost !== document.costBudget?.actual)
      problems.push(
        "usage receipt cost does not match the runtime cost budget",
      );
    const head = document.bridgeHeadReceipt;
    if (
      !Number.isSafeInteger(head?.sequence) ||
      head.sequence < 1 ||
      !digest(head?.priorHeadSha256) ||
      !digest(head?.currentHeadSha256) ||
      head?.compareAndSwap !== "applied"
    )
      problems.push(
        "bridge-head receipt must prove a successful monotonic compare-and-swap",
      );
    if (!safeIdentifier(head?.provider) || !digest(head?.providerReceiptSha256))
      problems.push(
        "bridge-head receipt must bind provider identity and provider receipt",
      );
    if (head?.currentHeadSha256 === head?.priorHeadSha256)
      problems.push("bridge-head receipt must advance the head");
    const commissionedHead = options.acceptancePolicy?.bridgeHead;
    if (
      !object(commissionedHead) ||
      head?.provider !== commissionedHead.provider ||
      head?.providerIdentitySha256 !==
        commissionedHead.providerIdentitySha256 ||
      head?.targetSha256 !== commissionedHead.targetSha256 ||
      head?.protectionPolicySha256 !==
        commissionedHead.protectionPolicySha256 ||
      head?.subjectPath !== "assurance/bridge-proof-input.json" ||
      !digest(head?.subjectFileSha256) ||
      !digest(head?.subjectSha256) ||
      head?.subjectSha256 !== head?.currentHeadSha256 ||
      !object(head?.providerProof) ||
      head.providerProof.schema !== commissionedHead.adapterSchema ||
      head?.providerProofSha256 !== sha256(canonicalJson(head.providerProof))
    )
      problems.push(
        "bridge-head receipt must bind the accepted subject and exact commissioned provider target, protection policy, and adapter proof",
      );
    if (head?.provider === "github") {
      const proof = head.providerProof;
      const target = commissionedHead?.target;
      const expectedHistoryDirectory = target?.headPath?.replace(
        /\.json$/u,
        ".history",
      );
      const expectedCheckpointPath = target?.headPath?.replace(
        /\.json$/u,
        ".checkpoint.json",
      );
      const expectedRecordPath = `${expectedHistoryDirectory}/${String(
        head.sequence,
      ).padStart(20, "0")}.json`;
      const observations = proof?.protectionObservations;
      const expectedObservationPhases =
        proof?.resumed === true
          ? ["pre-proposal", "post-merge-resume"]
          : ["pre-proposal", "pre-merge", "post-merge"];
      const observationEvidence = Array.isArray(observations)
        ? new Set(observations.map((entry) => entry?.evidenceSha256))
        : new Set();
      const expectedProposalFlowSha256 = sha256(
        canonicalJson(commissionedHead?.protectionPolicy?.proposalFlow),
      );
      const expectedStatusCheckSha256 = sha256(
        canonicalJson(
          commissionedHead?.protectionPolicy?.appendOnlyStatusCheck,
        ),
      );
      const expectedWriterRestrictionsSha256 = sha256(
        canonicalJson({
          apps: [
            ...(commissionedHead?.protectionPolicy?.writerRestrictions?.apps ||
              []),
          ].sort((left, right) => left.id - right.id),
          teams: [
            ...(commissionedHead?.protectionPolicy?.writerRestrictions?.teams ||
              []),
          ].sort(),
          users: [
            ...(commissionedHead?.protectionPolicy?.writerRestrictions?.users ||
              []),
          ].sort(),
        }),
      );
      const expectedOperationId = sha256(
        canonicalJson({
          schema: "valdris.github-head-operation.v1",
          runId: head?.runId,
          targetSha256: commissionedHead?.targetSha256,
          proofInputFileSha256: head?.subjectFileSha256,
          currentHeadSha256: head?.currentHeadSha256,
          expectedSequence: head?.sequence - 1,
          expectedHeadSha256: head?.priorHeadSha256,
          expectedHistorySha256: head?.expectedHistorySha256,
        }),
      );
      const validProtectionObservations =
        Array.isArray(observations) &&
        canonicalJson(observations.map((entry) => entry?.phase)) ===
          canonicalJson(expectedObservationPhases) &&
        observationEvidence.size === 1 &&
        observations.every(
          (entry) =>
            digest(entry?.evidenceSha256) &&
            entry?.proof?.forcePushDisabled === true &&
            entry?.proof?.deletionDisabled === true &&
            entry?.proof?.adminsEnforced === true &&
            entry?.proof?.linearHistoryRequired === true &&
            entry?.proof?.strictStatusChecks === true &&
            entry?.proof?.pullRequestRequired === true &&
            entry?.proof?.bypassAllowancesDisabled === true &&
            entry?.proof?.appendOnlyStatusCheckSha256 ===
              expectedStatusCheckSha256 &&
            entry?.proof?.proposalFlowSha256 === expectedProposalFlowSha256 &&
            entry?.proof?.writerRestrictionsSha256 ===
              expectedWriterRestrictionsSha256,
        );
      const expectedProviderReceiptSha256 = sha256(
        canonicalJson({
          hostname: proof?.hostname,
          repository: proof?.repository,
          branch: proof?.branch,
          baseCommitSha: proof?.baseCommitSha,
          commissionedCheck: proof?.commissionedCheck,
          contentSha: proof?.contentSha,
          historySha256: proof?.historySha256,
          mergeCommitSha: proof?.mergeCommitSha,
          path: proof?.recordPath,
          priorHistorySha256: proof?.priorHistorySha256,
          proposalBranch: proof?.proposalBranch,
          proposalCommitSha: proof?.proposalCommitSha,
          pullRequestNumber: proof?.pullRequestNumber,
          operationId: proof?.operationId,
          protectionObservations: proof?.protectionObservations,
          cleanup: proof?.cleanup,
          recordSha256: proof?.recordSha256,
          recordUpdatedAt: proof?.recordUpdatedAt,
        }),
      );
      if (
        proof?.schema !== "valdris.github-head-provider-proof.v1" ||
        proof?.hostname !== target?.hostname ||
        !canonicalHostname(proof?.hostname) ||
        proof?.repository !== target?.repository ||
        proof?.branch !== target?.branch ||
        proof?.headPath !== target?.headPath ||
        proof?.historyDirectory !== expectedHistoryDirectory ||
        proof?.checkpointPath !== expectedCheckpointPath ||
        proof?.recordPath !== expectedRecordPath ||
        !digest(proof?.priorHistorySha256) ||
        !digest(proof?.historySha256) ||
        head?.expectedHistorySha256 !== proof?.priorHistorySha256 ||
        !digest(head?.operationId) ||
        head?.operationId !== proof?.operationId ||
        head?.operationId !== expectedOperationId ||
        !digest(proof?.recordSha256) ||
        proof?.recordUpdatedAt !==
          deterministicGithubBridgeTimestamp(proof?.operationId) ||
        head?.receiptRootPolicySha256 !==
          sha256(canonicalJson(commissionedHead?.receiptRootPolicy)) ||
        proof?.receiptRootPathSha256 !==
          commissionedHead?.receiptRootPolicy?.pathSha256 ||
        proof?.receiptRootIdentitySha256 !==
          commissionedHead?.receiptRootPolicy?.identitySha256 ||
        !/^[a-f0-9]{40,64}$/i.test(proof?.baseCommitSha || "") ||
        !safeIdentifier(proof?.proposalBranch) ||
        !/^[a-f0-9]{40,64}$/i.test(proof?.proposalCommitSha || "") ||
        !Number.isSafeInteger(proof?.pullRequestNumber) ||
        proof.pullRequestNumber < 1 ||
        proof?.commissionedCheck?.context !==
          commissionedHead?.protectionPolicy?.appendOnlyStatusCheck?.context ||
        proof?.commissionedCheck?.appId !==
          commissionedHead?.protectionPolicy?.appendOnlyStatusCheck?.appId ||
        !Number.isSafeInteger(proof?.commissionedCheck?.checkRunId) ||
        proof.commissionedCheck.checkRunId < 1 ||
        !digest(proof?.commissionedCheck?.attestationSha256) ||
        typeof proof?.commissionedCheck?.fullReplayPerformed !== "boolean" ||
        (head.sequence %
          commissionedHead.protectionPolicy.proposalFlow.fullReplayInterval ===
          0 &&
          proof?.commissionedCheck?.fullReplayPerformed !== true) ||
        !/^[a-f0-9]{40,64}$/i.test(proof?.contentSha || "") ||
        !/^[a-f0-9]{40,64}$/i.test(proof?.mergeCommitSha || "") ||
        !/^[a-f0-9]{40,64}$/i.test(proof?.commitSha || "") ||
        proof?.commitSha !== proof?.mergeCommitSha ||
        proof?.baseCommitSha === proof?.mergeCommitSha ||
        !validProtectionObservations ||
        !["completed", "pending"].includes(proof?.cleanup?.status) ||
        !Number.isSafeInteger(proof?.cleanup?.attempts) ||
        proof.cleanup.attempts < 1 ||
        (proof?.cleanup?.status === "pending" &&
          !digest(proof?.cleanup?.problemSha256)) ||
        head?.providerReceiptSha256 !== expectedProviderReceiptSha256
      )
        problems.push(
          "GitHub bridge-head proof does not prove the commissioned protected target and provider response",
        );
    } else
      problems.push(
        "authoritative bridge-head provider has no built-in executable validator; commission the GitHub reference adapter or add a reviewed provider validator",
      );
  }
  if (document.interop !== undefined && !Array.isArray(document.interop))
    problems.push("runtime session interop must be an array when present");
  const interopProtocols = new Set();
  for (const [index, entry] of (Array.isArray(document.interop)
    ? document.interop
    : []
  ).entries()) {
    if (interopProtocols.has(entry?.protocol))
      problems.push(
        `runtime session duplicates interop protocol ${entry.protocol}`,
      );
    else if (entry?.protocol) interopProtocols.add(entry.protocol);
    if (
      !object(entry) ||
      !options.policy?.interop?.protocols?.includes(entry.protocol) ||
      !nonEmpty(entry.version) ||
      !Array.isArray(entry.capabilities) ||
      !digest(entry.identitySha256) ||
      !object(entry.transcript) ||
      !digest(entry.transcript.sha256)
    )
      problems.push(
        `runtime session interop ${index + 1} is invalid or lacks a bound conformance transcript`,
      );
    else if (options.repoRoot) {
      const expectedPath = `runtime/interop/${entry.protocol}.json`;
      const result = loadAndValidateOperatingArtifact(
        options.repoRoot,
        entry.transcript,
        expectedPath,
        validateInteropTranscriptDocument,
        {
          protocol: entry.protocol,
          version: entry.version,
          identitySha256: entry.identitySha256,
          capabilitySetSha256: sha256(canonicalJson(entry.capabilities)),
        },
      );
      problems.push(
        ...result.problems.map(
          (problem) => `runtime session interop ${index + 1}: ${problem}`,
        ),
      );
      if (result.document)
        sameSubject(
          result.document,
          document,
          `interop transcript ${index + 1}`,
          problems,
        );
    }
  }
  return { valid: problems.length === 0, problems };
}

export function validateChangeReviewDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["change review must be an object"] };
  if (document.schema !== CHANGE_REVIEW_SCHEMA)
    problems.push(`change review schema must be ${CHANGE_REVIEW_SCHEMA}`);
  problems.push(...subjectProblems(document, "change review"));
  for (const field of [
    "baseCommitSha256",
    "headCommitSha256",
    "diffSha256",
    "dependencyGraphSha256",
    "testEvidenceSha256",
    "reviewEvidenceSha256",
  ])
    if (!digest(document[field]))
      problems.push(`change review.${field} is invalid`);
  if (
    !/^[a-f0-9]{40,64}$/i.test(document.baseCommit || "") ||
    !/^[a-f0-9]{40,64}$/i.test(document.headCommit || "")
  )
    problems.push("change review must bind actual base and head Git commits");
  if (
    digest(document.baseCommitSha256) &&
    document.baseCommitSha256 !== sha256(document.baseCommit || "")
  )
    problems.push("change review.baseCommitSha256 does not match baseCommit");
  if (
    digest(document.headCommitSha256) &&
    document.headCommitSha256 !== sha256(document.headCommit || "")
  )
    problems.push("change review.headCommitSha256 does not match headCommit");
  if (
    !Array.isArray(document.changedPaths) ||
    document.changedPaths.length === 0 ||
    document.changedPaths.some((entry) => !nonEmpty(entry))
  )
    problems.push("change review.changedPaths must be non-empty");
  const coverage = uniqueStrings(
    document.coverage,
    "change review.coverage",
    problems,
  );
  for (const item of options.policy?.reviewCoverage || [])
    if (!coverage.includes(item))
      problems.push(`change review is missing required coverage ${item}`);
  if (
    !Array.isArray(document.errorPaths) ||
    document.errorPaths.length === 0 ||
    document.errorPaths.some(
      (entry) =>
        !object(entry) ||
        !nonEmpty(entry.path) ||
        !nonEmpty(entry.testId) ||
        entry.status !== "passed",
    )
  )
    problems.push(
      "change review.errorPaths must prove exercised error behavior",
    );
  if (
    !Array.isArray(document.dependencies) ||
    document.dependencies.some(
      (entry) =>
        !object(entry) ||
        !nonEmpty(entry.locator) ||
        !nonEmpty(entry.name) ||
        !nonEmpty(entry.version) ||
        !digest(entry.metadataSha256) ||
        !["added", "removed", "updated", "unchanged"].includes(entry.change) ||
        (entry.change === "updated" &&
          (!nonEmpty(entry.previousVersion) ||
            !digest(entry.previousMetadataSha256))) ||
        (entry.change !== "updated" &&
          (Object.hasOwn(entry, "previousVersion") ||
            Object.hasOwn(entry, "previousLocator") ||
            Object.hasOwn(entry, "previousMetadataSha256"))) ||
        (Object.hasOwn(entry, "previousLocator") &&
          !nonEmpty(entry.previousLocator)),
    )
  )
    problems.push("change review.dependencies is invalid");
  const provenance = validateDependencyProvenance(
    document.dependencyProvenance,
    { dependencies: document.dependencies },
  );
  problems.push(
    ...provenance.problems.map((problem) => `change review ${problem}`),
  );
  if (
    !Array.isArray(document.findings) ||
    document.findings.some(
      (finding) =>
        !object(finding) ||
        !safeIdentifier(finding.id) ||
        !["blocking", "critical", "high", "medium", "low"].includes(
          finding.severity,
        ) ||
        !["open", "resolved", "accepted"].includes(finding.status),
    )
  )
    problems.push("change review.findings is invalid");
  if ((document.findings || []).some((finding) => finding.status === "open"))
    problems.push("change review contains an unresolved open finding");
  for (const [index, finding] of (document.findings || []).entries()) {
    if (
      finding.status === "resolved" &&
      !digest(finding.resolutionEvidenceSha256)
    )
      problems.push(
        `change review.findings[${index}] resolved finding lacks evidence`,
      );
    if (
      finding.status === "accepted" &&
      (!object(finding.disposition) ||
        !nonEmpty(finding.disposition.owner) ||
        !nonEmpty(finding.disposition.rationale) ||
        !digest(finding.disposition.evidenceSha256) ||
        !canonicalIso(finding.disposition.expiresAt))
    )
      problems.push(
        `change review.findings[${index}] accepted risk lacks an owner-reviewed disposition`,
      );
  }
  if (!options.repoRoot)
    problems.push(
      "change review Git reconstruction requires a repository root",
    );
  else if (
    /^[a-f0-9]{40,64}$/i.test(document.baseCommit || "") &&
    /^[a-f0-9]{40,64}$/i.test(document.headCommit || "")
  ) {
    const runGit = (args, encoding = null) =>
      spawnSync("git", ["-C", options.repoRoot, ...args], {
        encoding,
        shell: false,
        windowsHide: true,
        timeout: 30_000,
      });
    const diff = runGit([
      "diff",
      "--binary",
      document.baseCommit,
      document.headCommit,
      "--",
    ]);
    const names = runGit([
      "diff",
      "--name-only",
      "-z",
      document.baseCommit,
      document.headCommit,
      "--",
    ]);
    let readiness = options.readiness;
    if (!readiness)
      try {
        readiness = readJson(
          resolveArtifactPath(
            options.repoRoot,
            V09_CANONICAL_ARTIFACTS.readiness,
            { mustExist: true },
          ),
        );
      } catch (error) {
        problems.push(
          `change review fixed point is unavailable: ${error.message}`,
        );
      }
    const fixedPoint = readiness?.implementationFixedPoint;
    const mergeBase = runGit(
      ["merge-base", document.baseCommit, document.headCommit],
      "utf8",
    );
    if (
      document.baseCommit !== fixedPoint?.baseCommit ||
      document.baseCommitSha256 !== sha256(fixedPoint?.baseCommit || "") ||
      mergeBase.status !== 0 ||
      mergeBase.stdout.trim() !== fixedPoint?.baseCommit
    )
      problems.push(
        "change review base must equal the sealed pre-implementation fixed point and merge base",
      );
    if (diff.status !== 0 || names.status !== 0)
      problems.push("change review Git commits cannot be reconstructed");
    else {
      const actualPaths = names.stdout
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .sort();
      const declaredPaths = [...(document.changedPaths || [])].sort();
      if (document.diffSha256 !== sha256(diff.stdout))
        problems.push(
          "change review.diffSha256 does not match the actual Git diff",
        );
      if (canonicalJson(actualPaths) !== canonicalJson(declaredPaths))
        problems.push(
          "change review.changedPaths does not match the actual Git diff",
        );
      if (document.headCommit !== document.commit)
        problems.push(
          "change review headCommit does not match the reviewed subject commit",
        );
      const changedLockfiles = actualPaths.filter((entry) =>
        /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|requirements[^/]*\.txt|Cargo\.lock|go\.sum)$/i.test(
          entry,
        ),
      );
      const declaredLockfiles = [...(document.lockfilePaths || [])].sort();
      if (canonicalJson(changedLockfiles) !== canonicalJson(declaredLockfiles))
        problems.push(
          "change review lockfile coverage does not match the actual Git diff",
        );
      if (
        changedLockfiles.length &&
        !(document.dependencies || []).some(
          (entry) => entry.change !== "unchanged",
        )
      )
        problems.push(
          "change review changed a lockfile without reviewed dependency changes",
        );
      const derivedDependencies = [];
      for (const lockfile of changedLockfiles) {
        const baseLock = runGit(
          ["show", `${document.baseCommit}:${lockfile}`],
          "utf8",
        );
        const headLock = runGit(
          ["show", `${document.headCommit}:${lockfile}`],
          "utf8",
        );
        try {
          const inventoryAtCommit = (commit, result) => {
            if (result.status === 0)
              return lockfileInventory(lockfile, result.stdout);
            const exists = runGit(["cat-file", "-e", `${commit}:${lockfile}`]);
            if (exists.status !== 0) return new Map();
            throw new Error(`cannot read ${lockfile} at ${commit}`);
          };
          const before = inventoryAtCommit(document.baseCommit, baseLock);
          const after = inventoryAtCommit(document.headCommit, headLock);
          derivedDependencies.push(...dependencyChanges(before, after));
        } catch (error) {
          problems.push(
            `change review cannot parse ${lockfile}: ${error.message}`,
          );
        }
      }
      const declaredChanged = (document.dependencies || [])
        .filter((entry) => entry.change !== "unchanged")
        .sort((left, right) =>
          dependencyChangeSortKey(left).localeCompare(
            dependencyChangeSortKey(right),
          ),
        );
      derivedDependencies.sort((left, right) =>
        dependencyChangeSortKey(left).localeCompare(
          dependencyChangeSortKey(right),
        ),
      );
      if (canonicalJson(derivedDependencies) !== canonicalJson(declaredChanged))
        problems.push(
          "change review declared dependency changes do not exactly match the reconstructed lockfile delta",
        );
    }
  }
  return { valid: problems.length === 0, problems };
}

export function validatePromotionReceiptDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["promotion receipt must be an object"] };
  if (document.schema !== PROMOTION_SCHEMA)
    problems.push(`promotion receipt schema must be ${PROMOTION_SCHEMA}`);
  problems.push(...subjectProblems(document, "promotion receipt"));
  if (
    document.sourceStage !== "prototype" ||
    document.targetStage !== "production"
  )
    problems.push(
      "promotion receipt must explicitly promote prototype to production",
    );
  for (const field of [
    "sourceRunSha256",
    "productionBuildSha256",
    "semanticProofSha256",
    "rollbackPlanSha256",
  ])
    if (!digest(document[field]))
      problems.push(`promotion receipt.${field} is invalid`);
  if (document.sourceRunSha256 === document.semanticProofSha256)
    problems.push(
      "promotion receipt cannot reuse prototype evidence as production semantic proof",
    );
  if (
    !nonEmpty(document.targetEnvironment) ||
    !["semantic", "authoritative"].includes(document.assuranceLevel)
  )
    problems.push("promotion receipt target and assurance level are invalid");
  if (options.level === "authoritative")
    validateAttestedRuntimeReceipt(
      document,
      PROMOTION_SCHEMA,
      options,
      "promotion receipt",
      problems,
    );
  return { valid: problems.length === 0, problems };
}

export function validateLearningReceiptDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["learning receipt must be an object"] };
  if (document.schema !== LEARNING_SCHEMA)
    problems.push(`learning receipt schema must be ${LEARNING_SCHEMA}`);
  problems.push(...subjectProblems(document, "learning receipt"));
  for (const field of [
    "failureSha256",
    "rcaSha256",
    "causeClusterSha256",
    "regressionCaseSha256",
    "changeSha256",
    "reviewSha256",
    "rollbackSha256",
  ])
    if (!digest(document[field]))
      problems.push(`learning receipt.${field} is invalid`);
  if (
    !["prompt", "tool", "skill", "harness-rule", "eval"].includes(
      document.changeKind,
    )
  )
    problems.push("learning receipt.changeKind is invalid");
  if (
    !canonicalIso(document.expiresAt) ||
    Date.parse(document.expiresAt) <=
      Date.parse(options.now || new Date().toISOString())
  )
    problems.push("learning receipt must have a future expiry");
  if (!nonEmpty(document.rollbackCondition))
    problems.push("learning receipt rollbackCondition is required");
  if (document.autoApplied === true)
    problems.push("learning receipt cannot auto-apply a harness change");
  if (options.level === "authoritative")
    validateAttestedRuntimeReceipt(
      document,
      LEARNING_SCHEMA,
      options,
      "learning receipt",
      problems,
    );
  return { valid: problems.length === 0, problems };
}

function loadBoundArtifact(repoRoot, binding, expectedPath, label, problems) {
  if (
    !object(binding) ||
    binding.path !== expectedPath ||
    !digest(binding.sha256)
  ) {
    problems.push(
      `${label} must bind canonical path ${expectedPath} and its digest`,
    );
    return null;
  }
  try {
    const file = resolveArtifactPath(repoRoot, binding.path, {
      mustExist: true,
    });
    if (fileSha256(file) !== binding.sha256)
      problems.push(`${label} digest does not match ${expectedPath}`);
    return readJson(file);
  } catch (error) {
    problems.push(`${label} is invalid: ${error.message}`);
    return null;
  }
}

function loadTrust(repoRoot, options, problems) {
  try {
    const trustPath =
      options.trustStorePath ||
      (existsSync(path.join(repoRoot, "controls", "authority-trust.v1.json"))
        ? "controls/authority-trust.v1.json"
        : ".valdris-harness/controls/authority-trust.v1.json");
    const trustStore =
      options.trustStore ||
      readJson(resolveArtifactPath(repoRoot, trustPath, { mustExist: true }));
    const requiredTrustSha256 =
      options.requiredTrustSha256 ||
      options.environment?.[AUTHORITY_TRUST_SHA256_ENV] ||
      process.env[AUTHORITY_TRUST_SHA256_ENV];
    const validation = validateAuthorityTrustStore(trustStore);
    problems.push(...validation.problems);
    if (!digest(requiredTrustSha256))
      problems.push(
        `${AUTHORITY_TRUST_SHA256_ENV} is required as an operator-held authority trust-store pin`,
      );
    else if (
      authorityTrustStoreSha256(trustStore) !==
      requiredTrustSha256.toLowerCase()
    )
      problems.push(
        `authority trust store does not match operator-held ${AUTHORITY_TRUST_SHA256_ENV}`,
      );
    return {
      trustStore,
      requiredTrustSha256: requiredTrustSha256?.toLowerCase(),
    };
  } catch (error) {
    problems.push(`authority trust store is invalid: ${error.message}`);
    return { trustStore: null, requiredTrustSha256: null };
  }
}

function loadImmutableRouting(repoRoot, document, problems) {
  const load = (relative, expectedSha256, label) => {
    try {
      const target = resolveArtifactPath(repoRoot, relative, {
        mustExist: true,
      });
      if (fileSha256(target) !== expectedSha256)
        problems.push(`${label} digest does not match ${relative}`);
      return readJson(target);
    } catch (error) {
      problems.push(`${label} is invalid: ${error.message}`);
      return null;
    }
  };
  const route = load("run/route.json", document.routeSha256, "immutable route");
  const classification = load(
    "run/workload-classification.json",
    document.workloadClassificationSha256,
    "immutable workload classification",
  );
  if (
    route?.runId !== document.runId ||
    classification?.runId !== document.runId ||
    route?.workloadClassificationSha256 !==
      document.workloadClassificationSha256
  )
    problems.push(
      "immutable route and classification do not bind the authoritative closure run",
    );
  if (
    route?.requestedProfile !== classification?.requestedProfile ||
    route?.environment !== classification?.environment ||
    route?.assuranceTier?.effective !== classification?.effectiveTier ||
    route?.assuranceTier?.aiEffective !== classification?.effectiveAiTier ||
    !sameStringSet(route?.workloadProfiles, classification?.workloadProfiles)
  )
    problems.push(
      "immutable route projection does not match workload classification",
    );
  return {
    route,
    classification,
    routeSha256: document.routeSha256,
    classificationSha256: document.workloadClassificationSha256,
    profile: classification?.requestedProfile,
    workloadProfiles: classification?.workloadProfiles || [],
    environment: classification?.environment,
    effectiveAssuranceTier: classification?.effectiveTier,
    effectiveAiTier: classification?.effectiveAiTier,
  };
}

function loadEvaluationEvidence(repoRoot, evidence, readiness, problems) {
  if (!object(evidence)) {
    problems.push("authoritative closure evaluationEvidence is required");
    return null;
  }
  const loaded = {};
  const canonicalPaths = {
    results: "evals/results.json",
    trajectory: "trajectory/trajectory.json",
    smoke: "smoke/smoke_proof.json",
  };
  for (const key of ["results", "trajectory", "smoke"]) {
    const binding = evidence[key];
    if (
      !object(binding) ||
      !nonEmpty(binding.path) ||
      !digest(binding.sha256)
    ) {
      problems.push(`evaluationEvidence.${key} binding is invalid`);
      continue;
    }
    if (binding.path !== canonicalPaths[key])
      problems.push(
        `evaluationEvidence.${key} must use canonical path ${canonicalPaths[key]}`,
      );
    try {
      const target = resolveArtifactPath(repoRoot, binding.path, {
        mustExist: true,
      });
      if (fileSha256(target) !== binding.sha256)
        problems.push(`evaluationEvidence.${key} digest does not match`);
      loaded[key] = readJson(target);
    } catch (error) {
      problems.push(`evaluationEvidence.${key} is invalid: ${error.message}`);
    }
  }
  const planSha256 = readiness?.evaluationPlanSha256;
  const suiteIds = (readiness?.evalPlan?.suites || []).map((suite) => suite.id);
  const dimensions = readiness?.evalPlan?.dimensions || [];
  if (
    evidence.evaluationPlanSha256 !== planSha256 ||
    !sameStringSet(evidence.suiteIds, suiteIds) ||
    !sameStringSet(evidence.dimensions, dimensions)
  )
    problems.push(
      "evaluationEvidence does not bind the commissioned plan suites and dimensions",
    );
  for (const [label, artifact] of Object.entries(loaded))
    if (
      artifact?.evaluationPlanSha256 !== planSha256 ||
      !sameStringSet(artifact?.suiteIds, suiteIds) ||
      !sameStringSet(artifact?.dimensions, dimensions) ||
      artifact?.status !== "passed"
    )
      problems.push(
        `evaluationEvidence.${label} does not prove the commissioned plan`,
      );
  const nativeResults = loaded.results
    ? validateEvalResultsDocument(loaded.results, { repoRoot })
    : { valid: false, problems: ["missing eval results"] };
  const nativeTrajectory = loaded.trajectory
    ? validateTrajectoryDocument(loaded.trajectory, { repoRoot })
    : { valid: false, problems: ["missing trajectory"] };
  const nativeSmoke = loaded.smoke
    ? validateSmoke(loaded.smoke, { repoRoot })
    : { valid: false, problems: ["missing smoke proof"] };
  for (const [label, validation] of [
    ["results", nativeResults],
    ["trajectory", nativeTrajectory],
    ["smoke", nativeSmoke],
  ])
    if (!validation.valid)
      problems.push(
        `evaluationEvidence.${label} failed its native gate: ${validation.problems.join("; ")}`,
      );
  const expectedSubject = {
    runId: readiness?.runId,
    commit: readiness?.commit,
    environment: readiness?.environment,
  };
  if (
    loaded.results?.runId !== expectedSubject.runId ||
    loaded.results?.commit !== expectedSubject.commit ||
    loaded.results?.environment !== expectedSubject.environment ||
    loaded.trajectory?.goalId !== expectedSubject.runId ||
    loaded.trajectory?.commit !== expectedSubject.commit ||
    loaded.trajectory?.environment !== expectedSubject.environment ||
    loaded.smoke?.runId !== expectedSubject.runId ||
    loaded.smoke?.commit !== expectedSubject.commit ||
    loaded.smoke?.environment !== expectedSubject.environment
  )
    problems.push(
      "evaluationEvidence native gate subjects do not match implementation readiness",
    );
  return loaded;
}

export function authoritativeProofInputSetManifest(document, loaded) {
  return {
    routeSha256: document.routeSha256,
    workloadClassificationSha256: document.workloadClassificationSha256,
    readinessSha256: document.artifacts?.readiness?.sha256,
    semanticProofSetSha256: semanticProofSetSha256(loaded.semantic),
    changeReviewSha256: document.artifacts?.changeReview?.sha256,
    evaluationEvidence: document.evaluationEvidence,
  };
}

function authoritativeProofInputSetSha256(document, loaded) {
  return sha256(
    canonicalJson(authoritativeProofInputSetManifest(document, loaded)),
  );
}

export function validateAuthoritativeClosureDocument(
  document,
  repoRoot,
  options = {},
) {
  repoRoot = path.resolve(repoRoot);
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      level: null,
      problems: ["authoritative closure must be an object"],
    };
  if (document.schema !== AUTHORITATIVE_CLOSURE_SCHEMA)
    problems.push(
      `authoritative closure schema must be ${AUTHORITATIVE_CLOSURE_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "authoritative closure"));
  if (
    !digest(document.routeSha256) ||
    !digest(document.workloadClassificationSha256)
  )
    problems.push(
      "authoritative closure must bind route and workload classification digests",
    );
  if (
    !ASSURANCE_LEVELS.includes(document.assuranceLevel) ||
    document.assuranceLevel === "structural"
  )
    problems.push(
      "authoritative closure assuranceLevel must be semantic or authoritative",
    );
  const policy =
    options.policy ||
    readJson(
      path.join(RUNTIME_ROOT, "controls", "authoritative-assurance.v1.json"),
    );
  if (policy?.schema !== AUTHORITATIVE_POLICY_SCHEMA)
    problems.push(
      `authoritative assurance policy schema must be ${AUTHORITATIVE_POLICY_SCHEMA}`,
    );
  const routingBaseline = loadImmutableRouting(repoRoot, document, problems);
  const trust = loadTrust(repoRoot, options, problems);
  const validationOptions = {
    ...options,
    repoRoot,
    policy,
    level: document.assuranceLevel,
    routingBaseline,
    ...trust,
  };
  const loaded = {
    readiness: loadBoundArtifact(
      repoRoot,
      document.artifacts?.readiness,
      V09_CANONICAL_ARTIFACTS.readiness,
      "authoritative closure readiness",
      problems,
    ),
    semantic: loadBoundArtifact(
      repoRoot,
      document.artifacts?.semantic,
      V09_CANONICAL_ARTIFACTS.semantic,
      "authoritative closure semantic assurance",
      problems,
    ),
    runtime: loadBoundArtifact(
      repoRoot,
      document.artifacts?.runtime,
      V09_CANONICAL_ARTIFACTS.runtime,
      "authoritative closure runtime session",
      problems,
    ),
    changeReview: loadBoundArtifact(
      repoRoot,
      document.artifacts?.changeReview,
      V09_CANONICAL_ARTIFACTS.changeReview,
      "authoritative closure change review",
      problems,
    ),
  };
  if (document.artifacts?.promotion)
    loaded.promotion = loadBoundArtifact(
      repoRoot,
      document.artifacts.promotion,
      V09_CANONICAL_ARTIFACTS.promotion,
      "authoritative closure promotion",
      problems,
    );
  if (document.artifacts?.learning)
    loaded.learning = loadBoundArtifact(
      repoRoot,
      document.artifacts.learning,
      V09_CANONICAL_ARTIFACTS.learning,
      "authoritative closure learning",
      problems,
    );
  for (const [label, artifact] of Object.entries(loaded))
    if (artifact) sameSubject(artifact, document, label, problems);
  const semanticValidation = loaded.semantic
    ? validateSemanticAssuranceDocument(loaded.semantic, validationOptions)
    : { aiTier: "AI0", problems: [] };
  problems.push(...semanticValidation.problems);
  if (loaded.readiness)
    problems.push(
      ...validateImplementationReadinessDocument(loaded.readiness, {
        ...validationOptions,
        effectiveAiTier: semanticValidation.aiTier,
      }).problems,
    );
  loadEvaluationEvidence(
    repoRoot,
    document.evaluationEvidence,
    loaded.readiness,
    problems,
  );
  if (loaded.runtime)
    problems.push(
      ...validateRuntimeSessionDocument(loaded.runtime, {
        ...validationOptions,
        acceptancePolicy: loaded.semantic?.acceptancePolicy,
      }).problems,
    );
  if (loaded.changeReview)
    problems.push(
      ...validateChangeReviewDocument(loaded.changeReview, {
        policy,
        repoRoot,
        readiness: loaded.readiness,
      }).problems,
    );
  if (loaded.promotion)
    problems.push(
      ...validatePromotionReceiptDocument(loaded.promotion, validationOptions)
        .problems,
    );
  if (loaded.learning)
    problems.push(
      ...validateLearningReceiptDocument(loaded.learning, validationOptions)
        .problems,
    );
  if (loaded.semantic && loaded.readiness) {
    if (
      loaded.readiness.routeSha256 !== loaded.semantic.routeSha256 ||
      loaded.readiness.workloadClassificationSha256 !==
        loaded.semantic.workloadClassificationSha256
    )
      problems.push(
        "readiness and semantic assurance bind different routing inputs",
      );
    if (
      loaded.semantic.aiWorkloadIdentity?.evaluationPlanSha256 &&
      loaded.semantic.aiWorkloadIdentity.evaluationPlanSha256 !==
        loaded.readiness.evaluationPlanSha256
    )
      problems.push(
        "AI workload identity substituted the commissioned evaluation plan",
      );
  }
  if (
    loaded.semantic &&
    (loaded.semantic.routeSha256 !== document.routeSha256 ||
      loaded.semantic.workloadClassificationSha256 !==
        document.workloadClassificationSha256)
  )
    problems.push(
      "authoritative closure routing digests do not match semantic assurance",
    );
  if (
    loaded.semantic &&
    loaded.runtime &&
    loaded.semantic.aiWorkloadIdentity?.tier !== "AI0"
  ) {
    const identity = loaded.semantic.aiWorkloadIdentity;
    if (
      canonicalJson(loaded.runtime.aiRuntimeIdentity) !==
      canonicalJson(identity)
    )
      problems.push(
        "runtime substituted one or more commissioned AI workload identities",
      );
    if (
      sha256(loaded.runtime.modelRouting?.selectedModel || "") !==
      identity.modelSha256
    )
      problems.push(
        "runtime model selection substituted the commissioned AI model identity",
      );
    if (loaded.runtime.modelRouting?.providerSha256 !== identity.providerSha256)
      problems.push(
        "runtime model selection substituted the commissioned AI provider identity",
      );
    if (loaded.runtime.modelRouting?.taskClass !== identity.taskClass)
      problems.push(
        "runtime model routing downgraded or substituted the commissioned task class",
      );
    if (
      loaded.runtime.modelRouting?.receipt?.selectedModelSha256 !==
      identity.modelSha256
    )
      problems.push(
        "model routing receipt does not bind the commissioned AI model identity",
      );
  }
  const applicability = document.applicability;
  const routeApplicability = {
    routeSha256: document.routeSha256,
    workloadClassificationSha256: document.workloadClassificationSha256,
    sourceStage: routingBaseline.route?.lifecycle?.sourceStage,
    targetStage: routingBaseline.route?.lifecycle?.targetStage,
    targetEnvironment: routingBaseline.route?.environment,
    changeKinds: routingBaseline.route?.changeKinds || [],
    failureDisposition:
      routingBaseline.route?.lifecycle?.failureDisposition || "none",
  };
  if (
    !object(applicability) ||
    canonicalJson(applicability) !== canonicalJson(routeApplicability)
  )
    problems.push(
      "authoritative closure applicability must be derived exactly from immutable route facts",
    );
  const promotionRequired =
    routeApplicability.sourceStage ===
      policy?.applicability?.productionPromotion?.sourceStage &&
    routeApplicability.targetStage ===
      policy?.applicability?.productionPromotion?.targetStage;
  const learningRequired =
    routeApplicability.changeKinds.some((kind) =>
      policy?.applicability?.harnessLearning?.changeKinds?.includes(kind),
    ) ||
    policy?.applicability?.harnessLearning?.failureDispositions?.includes(
      routeApplicability.failureDisposition,
    );
  if (promotionRequired && !loaded.promotion)
    problems.push("production applicability requires a promotion receipt");
  if (learningRequired && !loaded.learning)
    problems.push("route applicability requires a harness-learning receipt");
  if (document.assuranceLevel === "authoritative") {
    const runtime = loaded.runtime;
    if (!runtime?.executorReceipt || !runtime?.bridgeHeadReceipt)
      problems.push(
        "authoritative closure requires executor and bridge-head receipts",
      );
    if (runtime?.executorReceipt?.sourceCommit !== document.commit)
      problems.push(
        "executor receipt sourceCommit does not match closure commit",
      );
    if (runtime?.bridgeHeadReceipt?.runId !== document.runId)
      problems.push("bridge-head receipt runId does not match closure run");
    if (
      runtime?.bridgeHeadReceipt?.currentHeadSha256 !==
      authoritativeProofInputSetSha256(document, loaded)
    )
      problems.push(
        "bridge-head receipt does not bind the accepted authoritative proof input set",
      );
    const executorPayloadSha256 =
      runtime?.executorReceipt?.attestation?.payloadSha256;
    for (const adapter of loaded.semantic?.adapters || [])
      if (
        adapter.executionReceipt?.executorEventId !==
          runtime?.executorReceipt?.eventId ||
        adapter.executionReceipt?.executorReceiptPayloadSha256 !==
          executorPayloadSha256
      )
        problems.push(
          "semantic execution receipt is not bound to the accepted proof executor",
        );
    if (
      runtime?.executorReceipt?.semanticProofSetSha256 !==
        semanticProofSetSha256(loaded.semantic) ||
      runtime?.executorReceipt?.proofInputSetSha256 !==
        authoritativeProofInputSetSha256(document, loaded) ||
      runtime?.executorReceipt?.acceptedGateArtifactsSha256 !==
        document.acceptedGateArtifactsSha256 ||
      !digest(document.acceptedGateArtifactsSha256)
    )
      problems.push(
        "executor receipt does not bind the accepted gate, semantic, review, routing, and evaluation proof inputs",
      );
  }
  if (
    !Array.isArray(document.catalogSnapshots) ||
    document.catalogSnapshots.length === 0
  )
    problems.push("authoritative closure catalogSnapshots must be non-empty");
  for (const [index, snapshot] of (document.catalogSnapshots || []).entries()) {
    if (
      !object(snapshot) ||
      !nonEmpty(snapshot.path) ||
      !digest(snapshot.sha256) ||
      !object(snapshot.document) ||
      sha256(canonicalJson(snapshot.document)) !== snapshot.sha256
    )
      problems.push(
        `authoritative closure catalogSnapshots[${index}] is invalid`,
      );
  }
  const policySnapshot = (document.catalogSnapshots || []).find(
    (snapshot) => snapshot.path === "controls/authoritative-assurance.v1.json",
  );
  if (
    !policySnapshot ||
    policySnapshot.sha256 !== sha256(canonicalJson(policy)) ||
    canonicalJson(policySnapshot.document) !== canonicalJson(policy)
  )
    problems.push(
      "authoritative closure must snapshot the active authoritative assurance policy",
    );
  const receiptDocuments = [
    loaded.readiness?.sealReceipt,
    loaded.readiness?.implementationStartReceipt,
    ...(loaded.semantic?.approvalReceipts || []),
    ...(loaded.semantic?.adapters || []).map(
      (adapter) => adapter.executionReceipt,
    ),
    loaded.runtime?.modelRouting?.receipt,
    loaded.runtime?.traceReceipt,
    loaded.runtime?.usageReceipt,
    loaded.runtime?.conformanceReceipt,
    ...(loaded.runtime?.memoryHeadReceipts || []),
    ...(loaded.runtime?.toolApprovalReceipts || []),
    loaded.runtime?.runtimeDriver &&
      (() => {
        try {
          return readJson(
            resolveArtifactPath(repoRoot, loaded.runtime.runtimeDriver.path, {
              mustExist: true,
            }),
          ).implementationReceipt;
        } catch {
          return null;
        }
      })(),
    loaded.runtime?.executorReceipt,
    loaded.runtime?.executorAuthoritySeparationReceipt,
    loaded.runtime?.bridgeHeadReceipt,
    loaded.promotion,
    loaded.learning,
  ].filter(Boolean);
  const receiptEvents = new Set();
  for (const receipt of receiptDocuments) {
    if (receiptEvents.has(receipt.eventId))
      problems.push(
        `authority receipt replay detected across closure: ${receipt.eventId}`,
      );
    else receiptEvents.add(receipt.eventId);
    if (receipt.runId !== document.runId)
      problems.push(
        `authority receipt ${receipt.eventId || "unknown"} runId does not match closure`,
      );
  }
  for (const receipt of loaded.runtime?.priorMemoryHeadReceipts || []) {
    if (receiptEvents.has(receipt.eventId))
      problems.push(
        `authority receipt replay detected across closure: ${receipt.eventId}`,
      );
    else receiptEvents.add(receipt.eventId);
    if (receipt.runId === document.runId)
      problems.push(
        `prior authority receipt ${receipt.eventId || "unknown"} must come from a prior run`,
      );
  }
  return {
    valid: problems.length === 0,
    level: document.assuranceLevel,
    problems,
  };
}

export function authoritativeArtifactPresent(repoRoot) {
  return existsSync(
    path.resolve(repoRoot, V09_CANONICAL_ARTIFACTS.authoritative),
  );
}
