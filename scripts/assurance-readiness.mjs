#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, resolveArtifactPath } from "./proof-runner.mjs";
import {
  AUTHORITY_TRUST_SHA256_ENV,
  RUNTIME_EXECUTION_THREAT_BOUNDARY,
  V09_CANONICAL_ARTIFACTS,
  authorityTrustStoreSha256,
  runtimeExecutionIsolationBindingsMatch,
  validExecutorAuthoritySeparationBinding,
  validRuntimeExecutionIsolationBinding,
  validateAuthoritativeClosureDocument,
} from "./v09-assurance-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { repo: process.cwd(), level: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--level") args.level = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function optionalJson(repoRoot, relativePath) {
  try {
    const file = resolveArtifactPath(repoRoot, relativePath, {
      mustExist: true,
    });
    return {
      path: relativePath,
      present: true,
      document: readJson(file),
      sha256: null,
    };
  } catch (error) {
    return {
      path: relativePath,
      present: false,
      document: null,
      problem: error.message,
    };
  }
}

export function assessAssuranceReadiness(repoRoot, options = {}) {
  repoRoot = path.resolve(repoRoot);
  const policyPath = existsSync(
    path.join(repoRoot, "controls", "authoritative-assurance.v1.json"),
  )
    ? "controls/authoritative-assurance.v1.json"
    : ".valdris-harness/controls/authoritative-assurance.v1.json";
  const trustPath = existsSync(
    path.join(repoRoot, "controls", "authority-trust.v1.json"),
  )
    ? "controls/authority-trust.v1.json"
    : ".valdris-harness/controls/authority-trust.v1.json";
  const policy = readJson(
    resolveArtifactPath(repoRoot, policyPath, { mustExist: true }),
  );
  const artifacts = Object.fromEntries(
    Object.entries(V09_CANONICAL_ARTIFACTS).map(([name, relativePath]) => [
      name,
      optionalJson(repoRoot, relativePath),
    ]),
  );
  const closure = artifacts.authoritative.document;
  const requestedLevel =
    options.level || closure?.assuranceLevel || "structural";
  const semantic = artifacts.semantic.document;
  const runtime = artifacts.runtime.document;
  const runtimeDriver = optionalJson(repoRoot, "runtime/driver.json").document;
  const readiness = artifacts.readiness.document;
  const review = artifacts.changeReview.document;
  const evalResults = optionalJson(repoRoot, "evals/results.json").document;
  const route = optionalJson(repoRoot, "run/route.json").document;
  const classification = optionalJson(
    repoRoot,
    "run/workload-classification.json",
  ).document;
  const required =
    policy.assuranceLevels?.[requestedLevel]?.requiredArtifacts || [];
  const missingArtifacts = required.filter(
    (relativePath) =>
      !existsSync(path.join(repoRoot, ...relativePath.split("/"))),
  );
  const missingSemantic = [];
  if (requestedLevel !== "structural") {
    if (!readiness?.sealReceipt)
      missingSemantic.push("externally signed implementation-readiness seal");
    if (!readiness?.implementationStartReceipt)
      missingSemantic.push("later signed implementation-start receipt");
    if (
      !readiness?.contracts?.some(
        (entry) =>
          entry.schema === "uash.requirements-contract.v1" &&
          entry.path === "run/requirements-contract.json",
      )
    )
      missingSemantic.push(
        "typed requirement-to-acceptance-to-test/eval/stop contract",
      );
    if (!Array.isArray(semantic?.adapters) || semantic.adapters.length === 0)
      missingSemantic.push("commissioned semantic adapters");
    if (
      !Array.isArray(semantic?.acceptancePolicy?.thresholds) ||
      semantic.acceptancePolicy.thresholds.length === 0
    )
      missingSemantic.push("owner-commissioned acceptance thresholds");
    if (!semantic?.aiWorkloadIdentity)
      missingSemantic.push("AI workload identity or explicit AI0 identity");
    if (
      !Array.isArray(semantic?.approvalReceipts) ||
      semantic.approvalReceipts.length < 2
    )
      missingSemantic.push("augmentation and acceptance-policy approvals");
    if (!runtime?.aiRuntimeIdentity)
      missingSemantic.push("runtime AI identity");
    if (!runtime?.conformanceReceipt)
      missingSemantic.push("signed runtime-conformance receipt");
    if (!runtime?.toolRegistry || !Array.isArray(runtime?.toolCallReceipts))
      missingSemantic.push("typed tool registry and observed call receipts");
    if (
      runtime?.memoryEvents?.length &&
      !Array.isArray(runtime?.memoryHeadReceipts)
    )
      missingSemantic.push("durable memory-head continuity receipts");
    if (!runtime?.runtimeDriver)
      missingSemantic.push(
        "runtime-driver checkpoint and implementation receipt",
      );
    if (!runtime?.economicsLedger)
      missingSemantic.push("reconciled AI economics ledger");
    if (!runtime?.traceReceipt)
      missingSemantic.push("trajectory-bound observable trace receipt");
    if (
      runtime?.interop?.some(
        (entry) => !entry?.transcript?.path || !entry?.transcript?.sha256,
      )
    )
      missingSemantic.push("MCP/A2A conformance transcripts");
    if (
      evalResults?.suites?.some(
        (suite) =>
          suite?.evaluator?.kind === "model" && !suite?.judgeCalibration,
      )
    )
      missingSemantic.push("calibrated independent model-judge evidence");
    if (!review?.diffSha256)
      missingSemantic.push("Git-derived AI change review");
    if (
      review?.dependencies?.some((entry) =>
        ["added", "updated"].includes(entry?.change),
      ) &&
      !Array.isArray(review?.dependencyProvenance)
    )
      missingSemantic.push("dependency provenance and confusable-name review");
    if (!closure?.evaluationEvidence)
      missingSemantic.push("eval, trajectory, and smoke evidence bindings");
  }
  const trust = optionalJson(repoRoot, trustPath);
  const activeAuthorityKeys =
    trust.document?.keys?.filter((key) => key.status === "active").length || 0;
  const requiredTrustSha256 =
    options.requiredTrustSha256 || process.env[AUTHORITY_TRUST_SHA256_ENV];
  const trustPinMatches = Boolean(
    requiredTrustSha256 &&
    trust.document &&
    authorityTrustStoreSha256(trust.document) ===
      requiredTrustSha256.toLowerCase(),
  );
  const missingAuthority = [];
  const commissionedRuntimeBoundary = validRuntimeExecutionIsolationBinding(
    semantic?.acceptancePolicy?.proofExecutor,
  );
  const observedRuntimeBoundary = validRuntimeExecutionIsolationBinding(
    runtime?.executorReceipt,
  );
  const runtimeBoundaryMatchesCommissioning =
    runtimeExecutionIsolationBindingsMatch(
      runtime?.executorReceipt,
      semantic?.acceptancePolicy?.proofExecutor,
    );
  const executorAuthoritySeparated = validExecutorAuthoritySeparationBinding(
    runtime,
    semantic?.acceptancePolicy?.proofExecutor,
  );
  if (requestedLevel === "authoritative") {
    if (activeAuthorityKeys === 0)
      missingAuthority.push("active operator-commissioned authority key");
    if (!trustPinMatches)
      missingAuthority.push(`operator-held ${AUTHORITY_TRUST_SHA256_ENV}`);
    for (const [field, label] of [
      ["executorReceipt", "immutable executor receipt"],
      [
        "executorAuthoritySeparationReceipt",
        "independently signed executor authority-separation receipt",
      ],
      ["bridgeHeadReceipt", "rollback-resistant head receipt"],
      ["traceReceipt", "trace receipt"],
      ["usageReceipt", "usage receipt"],
    ])
      if (!runtime?.[field]) missingAuthority.push(label);
    if (!runtime?.modelRouting?.receipt)
      missingAuthority.push("model-routing receipt");
    if (!commissionedRuntimeBoundary)
      missingAuthority.push(
        "commissioned trusted-host versus isolated-workload execution boundary",
      );
    if (!observedRuntimeBoundary)
      missingAuthority.push(
        "observed trusted-host versus isolated-workload executor receipt binding",
      );
    if (
      commissionedRuntimeBoundary &&
      observedRuntimeBoundary &&
      !runtimeBoundaryMatchesCommissioning
    )
      missingAuthority.push(
        "executor receipt isolation boundary matching commissioning",
      );
    if (!executorAuthoritySeparated)
      missingAuthority.push(
        "independent external-principal executor authority separation",
      );
    if (!runtimeDriver?.implementationReceipt?.attestation)
      missingAuthority.push("attested implementation-execution receipt");
    if (
      runtime?.memoryEvents?.length &&
      !runtime?.memoryHeadReceipts?.every((receipt) => receipt?.attestation)
    )
      missingAuthority.push("attested durable-memory head receipts");
  }
  const promotionRequired =
    route?.lifecycle?.sourceStage ===
      policy.applicability?.productionPromotion?.sourceStage &&
    route?.lifecycle?.targetStage ===
      policy.applicability?.productionPromotion?.targetStage;
  const learningRequired =
    route?.changeKinds?.some((kind) =>
      policy.applicability?.harnessLearning?.changeKinds?.includes(kind),
    ) ||
    policy.applicability?.harnessLearning?.failureDispositions?.includes(
      route?.lifecycle?.failureDisposition,
    );
  if (promotionRequired && !artifacts.promotion.present)
    missingSemantic.push("production promotion receipt");
  if (learningRequired && !artifacts.learning.present)
    missingSemantic.push("harness-learning receipt");
  let validation = {
    valid: false,
    problems: ["authoritative closure is not present"],
  };
  if (closure)
    validation = validateAuthoritativeClosureDocument(closure, repoRoot, {
      policy,
      requiredTrustSha256,
      now: options.now,
    });
  const semanticEligible =
    requestedLevel === "structural" ||
    (missingArtifacts.length === 0 &&
      missingSemantic.length === 0 &&
      (requestedLevel !== "semantic" || validation.valid));
  const authoritativeEligible =
    requestedLevel === "authoritative" &&
    semanticEligible &&
    missingAuthority.length === 0 &&
    validation.valid;
  return {
    schema: "valdris.assurance-readiness-report.v1",
    requestedLevel,
    selectedProfile: classification?.requestedProfile || null,
    workloadProfiles: classification?.workloadProfiles || [],
    environment: classification?.environment || null,
    effectiveAssuranceTier: classification?.effectiveTier || null,
    effectiveAiTier: classification?.effectiveAiTier || "AI0",
    eligibility: {
      structural: true,
      semantic: semanticEligible,
      authoritative: authoritativeEligible,
    },
    applicability: {
      promotionRequired: Boolean(promotionRequired),
      learningRequired: Boolean(learningRequired),
    },
    trust: {
      path: trustPath,
      activeAuthorityKeys,
      pinPresent: Boolean(requiredTrustSha256),
      pinMatches: trustPinMatches,
    },
    runtimeExecutionBoundary: {
      threatBoundary: RUNTIME_EXECUTION_THREAT_BOUNDARY,
      commissioned: commissionedRuntimeBoundary,
      observed: observedRuntimeBoundary,
      matchesCommissioning: runtimeBoundaryMatchesCommissioning,
      authoritySeparated: executorAuthoritySeparated,
      authoritativeEligible:
        runtimeBoundaryMatchesCommissioning &&
        executorAuthoritySeparated &&
        validation.valid,
    },
    missing: {
      artifacts: missingArtifacts,
      semantic: [...new Set(missingSemantic)],
      authoritative: [...new Set(missingAuthority)],
    },
    validationProblems: validation.valid ? [] : validation.problems,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/assurance-readiness.mjs --repo . [--level structural|semantic|authoritative]",
    );
  if (
    args.level &&
    !["structural", "semantic", "authoritative"].includes(args.level)
  )
    throw new Error("--level must be structural, semantic, or authoritative");
  const result = assessAssuranceReadiness(args.repo, { level: args.level });
  console.log(JSON.stringify(result, null, 2));
  if (!result.eligibility[result.requestedLevel]) process.exitCode = 1;
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
