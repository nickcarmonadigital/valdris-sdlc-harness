import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const PASSING_STATUSES = new Set(["passed", "skipped"]);
export const BLOCKING_STATUSES = new Set([
  "required",
  "pending",
  "failed",
  "blocked",
  "needs_approval",
]);
export const CONTROL_STATUSES = new Set([
  ...PASSING_STATUSES,
  ...BLOCKING_STATUSES,
]);
export const EVIDENCE_TYPES = new Set([
  "artifact",
  "command",
  "metric",
  "approval",
  "provider-report",
]);
export const PROFILE_EVIDENCE_MAX_AGE_HOURS = {
  prototype: 720,
  production: 168,
  enterprise: 72,
  regulated: 24,
};
const TRUST_TIERS = new Set([
  "automated-local",
  "ci-attested",
  "provider-attested",
  "human-approved",
]);
const PRODUCER_KINDS = new Set(["tool", "ci", "provider", "human"]);
const TRUST_PRODUCER_KIND = {
  "automated-local": "tool",
  "ci-attested": "ci",
  "provider-attested": "provider",
  "human-approved": "human",
};
const TECHNICAL_TRUST_RANK = {
  "automated-local": 0,
  "ci-attested": 1,
  "provider-attested": 2,
};

export const ASSURANCE_TIER_EVIDENCE_POLICY = Object.freeze({
  T0: Object.freeze({
    profile: "prototype",
    minimumTechnicalTrust: "automated-local",
    externalAttestationRequired: false,
  }),
  T1: Object.freeze({
    profile: "production",
    minimumTechnicalTrust: "automated-local",
    externalAttestationRequired: false,
  }),
  T2: Object.freeze({
    profile: "enterprise",
    minimumTechnicalTrust: "ci-attested",
    externalAttestationRequired: false,
  }),
  T3: Object.freeze({
    profile: "regulated",
    minimumTechnicalTrust: "ci-attested",
    externalAttestationRequired: true,
  }),
});

export function evidencePolicyForEffectiveTier(effectiveTier) {
  return ASSURANCE_TIER_EVIDENCE_POLICY[effectiveTier] || null;
}

export function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function isIsoTimestamp(value) {
  return Boolean(nonEmpty(value)) && !Number.isNaN(Date.parse(value));
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function portableManifestSha256(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let canonicalBytes = bytes;
  if (!bytes.includes(0)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
        canonicalBytes = Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
    } catch {
      // Binary and non-UTF-8 files retain their exact byte identity.
    }
  }
  return createHash("sha256").update(canonicalBytes).digest("hex");
}

export function resolveWithinRepo(repoRoot, candidate) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, candidate);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

export function existingFileWithinRepo(repoRoot, target) {
  if (
    !target ||
    !existsSync(target) ||
    !statSync(target).isFile() ||
    lstatSync(target).isSymbolicLink()
  )
    return false;
  const root = realpathSync(repoRoot);
  const resolved = realpathSync(target);
  const relative = path.relative(root, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function validateDigest(value, label, problems) {
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(value)))
    problems.push(`${label} must be a SHA-256 hex digest`);
}

function compareMetric(value, operator, target) {
  if (operator === "<") return value < target;
  if (operator === "<=") return value <= target;
  if (operator === "=") return value === target;
  if (operator === ">=") return value >= target;
  if (operator === ">") return value > target;
  return false;
}

export function validateTypedEvidence(evidence, options = {}) {
  const {
    repoRoot = process.cwd(),
    profile = "production",
    label = "evidence",
    subject,
    asOf,
    runId,
    commit,
    environment,
    minimumTechnicalTrust,
    maxAgeHours = PROFILE_EVIDENCE_MAX_AGE_HOURS[profile],
  } = options;
  const problems = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return [`${label} must be an object`];
  }

  const type = nonEmpty(evidence.type);
  if (!EVIDENCE_TYPES.has(type)) {
    problems.push(
      `${label}.type must be one of ${Array.from(EVIDENCE_TYPES).join(", ")}`,
    );
    return problems;
  }
  if (subject && evidence.subject !== subject)
    problems.push(`${label}.subject must match ${subject}`);
  if (runId && evidence.runId !== runId)
    problems.push(`${label}.runId must match ${runId}`);
  if (commit && evidence.commit !== commit)
    problems.push(`${label}.commit must match the enclosing artifact`);
  if (environment && evidence.environment !== environment)
    problems.push(`${label}.environment must match the enclosing artifact`);
  if (!TRUST_TIERS.has(evidence.trustTier))
    problems.push(`${label}.trustTier is invalid`);
  if (
    !evidence.producer ||
    typeof evidence.producer !== "object" ||
    Array.isArray(evidence.producer)
  )
    problems.push(`${label}.producer must be an object`);
  else {
    if (!nonEmpty(evidence.producer.name))
      problems.push(`${label}.producer.name is required`);
    if (!nonEmpty(evidence.producer.version))
      problems.push(`${label}.producer.version is required`);
    if (!PRODUCER_KINDS.has(evidence.producer.kind))
      problems.push(`${label}.producer.kind is invalid`);
    else if (
      TRUST_PRODUCER_KIND[evidence.trustTier] &&
      evidence.producer.kind !== TRUST_PRODUCER_KIND[evidence.trustTier]
    )
      problems.push(
        `${label}.producer.kind must be ${TRUST_PRODUCER_KIND[evidence.trustTier]} for trustTier ${evidence.trustTier}`,
      );
  }
  if (type === "provider-report" && evidence.trustTier !== "provider-attested")
    problems.push(
      `${label}.provider-report evidence must use provider-attested trust`,
    );
  if (type === "approval" && evidence.trustTier !== "human-approved")
    problems.push(`${label}.approval evidence must use human-approved trust`);
  if (
    type !== "approval" &&
    TECHNICAL_TRUST_RANK[minimumTechnicalTrust] !== undefined &&
    (TECHNICAL_TRUST_RANK[evidence.trustTier] ?? -1) <
      TECHNICAL_TRUST_RANK[minimumTechnicalTrust]
  ) {
    problems.push(
      `${label} requires ${minimumTechnicalTrust} or stronger technical evidence`,
    );
  }

  if (type === "artifact") {
    const relativePath = nonEmpty(evidence.path);
    if (!relativePath) problems.push(`${label}.path is required`);
    const target = relativePath
      ? resolveWithinRepo(repoRoot, relativePath)
      : null;
    const safeTarget = target && existingFileWithinRepo(repoRoot, target);
    if (relativePath && !target)
      problems.push(`${label}.path must stay inside the repository`);
    if (target && !safeTarget)
      problems.push(
        `${label}.path must be a real non-symlink file inside the repository: ${relativePath}`,
      );
    if (!isIsoTimestamp(evidence.generatedAt))
      problems.push(`${label}.generatedAt must be an ISO timestamp`);
    if (["enterprise", "regulated"].includes(profile)) {
      validateDigest(evidence.sha256, `${label}.sha256`, problems);
      if (!nonEmpty(evidence.commit))
        problems.push(`${label}.commit is required for ${profile} evidence`);
      if (!nonEmpty(evidence.environment))
        problems.push(
          `${label}.environment is required for ${profile} evidence`,
        );
    }
    if (
      safeTarget &&
      nonEmpty(evidence.sha256) &&
      /^[a-f0-9]{64}$/i.test(evidence.sha256) &&
      sha256File(target) !== evidence.sha256.toLowerCase()
    ) {
      problems.push(`${label}.sha256 does not match ${relativePath}`);
    }
  }

  if (type === "command") {
    if (!nonEmpty(evidence.command))
      problems.push(`${label}.command is required`);
    if (evidence.exitCode !== 0) problems.push(`${label}.exitCode must be 0`);
    if (!isIsoTimestamp(evidence.completedAt))
      problems.push(`${label}.completedAt must be an ISO timestamp`);
    validateDigest(evidence.outputDigest, `${label}.outputDigest`, problems);
    if (!nonEmpty(evidence.environment))
      problems.push(`${label}.environment is required`);
    if (!nonEmpty(evidence.commit))
      problems.push(`${label}.commit is required`);
    const outputPath = nonEmpty(evidence.outputPath);
    const outputTarget = outputPath
      ? resolveWithinRepo(repoRoot, outputPath)
      : null;
    if (!outputPath) problems.push(`${label}.outputPath is required`);
    else if (!outputTarget || !existingFileWithinRepo(repoRoot, outputTarget))
      problems.push(
        `${label}.outputPath must be a real non-symlink file inside the repository`,
      );
    else if (
      /^[a-f0-9]{64}$/i.test(nonEmpty(evidence.outputDigest)) &&
      sha256File(outputTarget) !== evidence.outputDigest.toLowerCase()
    )
      problems.push(`${label}.outputDigest does not match ${outputPath}`);
  }

  if (type === "metric") {
    if (!nonEmpty(evidence.metric))
      problems.push(`${label}.metric is required`);
    if (!Number.isFinite(evidence.value))
      problems.push(`${label}.value must be numeric`);
    if (!Number.isFinite(evidence.target))
      problems.push(`${label}.target must be numeric`);
    if (!["<", "<=", "=", ">=", ">"].includes(evidence.operator))
      problems.push(`${label}.operator is invalid`);
    if (!nonEmpty(evidence.window))
      problems.push(`${label}.window is required`);
    if (!nonEmpty(evidence.source))
      problems.push(`${label}.source is required`);
    if (!isIsoTimestamp(evidence.observedAt))
      problems.push(`${label}.observedAt must be an ISO timestamp`);
    if (!nonEmpty(evidence.environment))
      problems.push(`${label}.environment is required`);
    if (!nonEmpty(evidence.commit))
      problems.push(`${label}.commit is required`);
    if (
      Number.isFinite(evidence.value) &&
      Number.isFinite(evidence.target) &&
      ["<", "<=", "=", ">=", ">"].includes(evidence.operator) &&
      !compareMetric(evidence.value, evidence.operator, evidence.target)
    ) {
      problems.push(`${label} does not meet its target`);
    }
  }

  if (type === "approval") {
    if (evidence.actorType !== "human")
      problems.push(`${label}.actorType must be human`);
    if (!nonEmpty(evidence.actor)) problems.push(`${label}.actor is required`);
    if (!nonEmpty(evidence.approvalId))
      problems.push(`${label}.approvalId is required`);
    if (!nonEmpty(evidence.scope)) problems.push(`${label}.scope is required`);
    if (evidence.status !== "granted")
      problems.push(`${label}.status must be granted`);
    if (!isIsoTimestamp(evidence.approvedAt))
      problems.push(`${label}.approvedAt must be an ISO timestamp`);
    if (!isIsoTimestamp(evidence.expiresAt))
      problems.push(`${label}.expiresAt must be an ISO timestamp`);
    if (
      isIsoTimestamp(evidence.approvedAt) &&
      isIsoTimestamp(evidence.expiresAt) &&
      Date.parse(evidence.expiresAt) <= Date.parse(evidence.approvedAt)
    )
      problems.push(`${label}.expiresAt must be after approvedAt`);
    if (
      isIsoTimestamp(asOf) &&
      isIsoTimestamp(evidence.expiresAt) &&
      Date.parse(evidence.expiresAt) < Date.parse(asOf)
    )
      problems.push(`${label} approval is expired`);
    if (
      evidence.trustTier !== "human-approved" ||
      evidence.producer?.kind !== "human"
    )
      problems.push(
        `${label} approval must use human-approved trust and a human producer`,
      );
  }

  if (type === "provider-report") {
    if (!/^https:\/\//i.test(nonEmpty(evidence.url)))
      problems.push(`${label}.url must use https`);
    if (evidence.status !== "passed")
      problems.push(`${label}.status must be passed`);
    if (!isIsoTimestamp(evidence.checkedAt))
      problems.push(`${label}.checkedAt must be an ISO timestamp`);
    validateDigest(evidence.digest, `${label}.digest`, problems);
    if (!nonEmpty(evidence.provider))
      problems.push(`${label}.provider is required`);
    if (!nonEmpty(evidence.reportId))
      problems.push(`${label}.reportId is required`);
    if (!nonEmpty(evidence.environment))
      problems.push(`${label}.environment is required`);
    if (!nonEmpty(evidence.commit))
      problems.push(`${label}.commit is required`);
    if (
      evidence.trustTier !== "provider-attested" ||
      evidence.producer?.kind !== "provider"
    )
      problems.push(
        `${label} provider report must use provider-attested trust and a provider producer`,
      );
    const attestationPath = nonEmpty(evidence.attestationPath);
    const attestationTarget = attestationPath
      ? resolveWithinRepo(repoRoot, attestationPath)
      : null;
    if (!attestationPath) problems.push(`${label}.attestationPath is required`);
    else if (
      !attestationTarget ||
      !existingFileWithinRepo(repoRoot, attestationTarget)
    )
      problems.push(
        `${label}.attestationPath must be a real non-symlink file inside the repository`,
      );
    else if (
      /^[a-f0-9]{64}$/i.test(nonEmpty(evidence.digest)) &&
      sha256File(attestationTarget) !== evidence.digest.toLowerCase()
    )
      problems.push(`${label}.digest does not match ${attestationPath}`);
  }

  const observedAt =
    type === "artifact"
      ? evidence.generatedAt
      : type === "command"
        ? evidence.completedAt
        : type === "metric"
          ? evidence.observedAt
          : type === "approval"
            ? evidence.approvedAt
            : evidence.checkedAt;
  if (isIsoTimestamp(asOf) && isIsoTimestamp(observedAt)) {
    const ageMs = Date.parse(asOf) - Date.parse(observedAt);
    if (ageMs < 0)
      problems.push(
        `${label} timestamp is after the enclosing artifact timestamp`,
      );
    if (Number.isFinite(maxAgeHours) && ageMs > maxAgeHours * 60 * 60 * 1000)
      problems.push(
        `${label} is older than the ${maxAgeHours}-hour ${profile} evidence window`,
      );
  }

  return problems;
}

export function validateControl(control, options = {}) {
  const {
    repoRoot = process.cwd(),
    profile = "production",
    label = "control",
    allowSkipped = true,
    asOf,
    runId,
    commit,
    environment,
    minimumTechnicalTrust,
    maxAgeHours,
  } = options;
  const problems = [];
  if (!control || typeof control !== "object" || Array.isArray(control))
    return [`${label} must be an object`];
  const id = nonEmpty(control.id);
  const status = nonEmpty(control.status);
  if (!id) problems.push(`${label}.id is required`);
  if (!CONTROL_STATUSES.has(status))
    problems.push(`${label} has unsupported status: ${status || "missing"}`);
  if (status === "passed") {
    if (!Array.isArray(control.evidence) || control.evidence.length === 0)
      problems.push(`${label} passed without typed evidence`);
    else
      control.evidence.forEach((item, index) =>
        problems.push(
          ...validateTypedEvidence(item, {
            repoRoot,
            profile,
            label: `${label}.evidence[${index}]`,
            subject: id,
            asOf,
            runId,
            commit,
            environment,
            minimumTechnicalTrust,
            maxAgeHours,
          }),
        ),
      );
    if (
      Array.isArray(control.evidence) &&
      control.evidence.length > 0 &&
      control.evidence.every((item) => item?.type === "approval")
    )
      problems.push(`${label} cannot pass on approval evidence alone`);
  }
  if (status === "skipped") {
    if (!allowSkipped) problems.push(`${label} cannot be skipped`);
    if (!nonEmpty(control.reason || control.skipReason))
      problems.push(`${label} skipped without reason`);
  }
  if (status === "failed") {
    if (!nonEmpty(control.failureReason))
      problems.push(`${label} failed without failureReason`);
    if (!nonEmpty(control.recoveryPath))
      problems.push(`${label} failed without recoveryPath`);
  }
  if (BLOCKING_STATUSES.has(status))
    problems.push(`${label} is still ${status}`);
  return problems;
}

export function parseRepoFileArgs(argv, defaults) {
  const args = { repo: process.cwd(), ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--file") args.file = argv[++index];
    else if (arg === "--catalog") args.catalog = argv[++index];
    else if (arg === "--allow-active") args.allowActive = true;
    else if (arg === "--allow-legacy") args.allowLegacy = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function gateResult(file, result) {
  const output = { ok: Boolean(result.valid), file, ...result };
  const write = result.valid ? console.log : console.error;
  write(JSON.stringify(output, null, 2));
  if (!result.valid) process.exitCode = 1;
}
