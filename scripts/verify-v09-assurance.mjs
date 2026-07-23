#!/usr/bin/env node
import { generateKeyPairSync, sign as signPayload } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, fileSha256, sha256 } from "./proof-runner.mjs";
import { validateAuthoritativeAssurance } from "./authoritative-assurance-gate.mjs";
import { evaluateAuthoritativeRelease } from "./authoritative-release-gate.mjs";
import {
  createExecutionDeadline,
  isolatedRuntimeEnvironment,
  materializeVerifiedOutputEnvelope,
  probeRuntimeDaemonIdentity,
} from "./attested-proof-executor.mjs";
import {
  assertOperatorRootSecurity,
  inspectOperatorRoot,
} from "./operator-root-security.mjs";
import { validateEvalResultsDocument } from "./eval-gate.mjs";
import {
  abortGithubReceiptReservation,
  assertGithubReceiptRootSeparated,
  commitGithubReceiptReservation,
  createGithubOperationDeadline,
  deterministicBridgeTimestamp,
  executeGithubProtectedProposal,
  githubCliEnvironment,
  reserveGithubReceipt,
  validateGithubAppendOnlyHistory,
  validateGithubProtectionPolicy,
} from "./github-bridge-head.mjs";
import {
  aiEconomicsUsageSha256,
  validateRuntimeDriverStateDocument,
} from "./operating-contracts-lib.mjs";
import { historicalValidationRuntimeProblems } from "./run-packet-gate.mjs";
import {
  nextRuntimeDriverState,
  runtimeDriverLocalIdentity,
} from "./runtime-driver-state.mjs";
import {
  AUTHORITY_TRUST_SCHEMA,
  CONTEXT_MANIFEST_V2_SCHEMA,
  V09_CANONICAL_ARTIFACTS,
  authorityAttestationPayload,
  authorityTrustStoreSha256,
  authoritativeProofInputSetManifest,
  runtimeConformanceSetSha256,
  runtimeSessionIdentity,
  semanticProofSetManifest,
  semanticProofSetSha256,
  semanticValidatorSetSha256,
  validateAuthoritativeClosureDocument,
  validateChangeReviewDocument,
  validateImplementationReadinessDocument,
  validateLearningReceiptDocument,
  validatePromotionReceiptDocument,
  validateRuntimeSessionDocument,
  validateSemanticAssuranceDocument,
} from "./v09-assurance-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = JSON.parse(
  readFileSync(
    path.join(ROOT, "controls", "authoritative-assurance.v1.json"),
    "utf8",
  ),
);
const NOW = "2030-01-02T00:00:00.000Z";
const GENERATED = "2030-01-01T12:00:00.000Z";
const RUN_ID = "EXAMPLE-RUN-V09-PROOF";
let COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ENVIRONMENT = "staging";
const SHA256 = /^[a-f0-9]{64}$/iu;
const D = (value) => sha256(String(value));

function canonicalTempDirectory(prefix) {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}
const LOCK_METADATA = (value = {}) => sha256(canonicalJson(value));
const clone = (value) => structuredClone(value);

function rebindGithubBridgeProof(runtime) {
  const proof = runtime.bridgeHeadReceipt.providerProof;
  runtime.bridgeHeadReceipt.providerProofSha256 = sha256(canonicalJson(proof));
  runtime.bridgeHeadReceipt.providerReceiptSha256 = sha256(
    canonicalJson({
      hostname: proof.hostname,
      repository: proof.repository,
      branch: proof.branch,
      baseCommitSha: proof.baseCommitSha,
      commissionedCheck: proof.commissionedCheck,
      contentSha: proof.contentSha,
      historySha256: proof.historySha256,
      mergeCommitSha: proof.mergeCommitSha,
      path: proof.recordPath,
      priorHistorySha256: proof.priorHistorySha256,
      proposalBranch: proof.proposalBranch,
      proposalCommitSha: proof.proposalCommitSha,
      pullRequestNumber: proof.pullRequestNumber,
      operationId: proof.operationId,
      protectionObservations: proof.protectionObservations,
      cleanup: proof.cleanup,
      recordSha256: proof.recordSha256,
      recordUpdatedAt: proof.recordUpdatedAt,
    }),
  );
  runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
  return runtime;
}

function writeJson(root, relativePath, document) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return target;
}

function subject(schema) {
  return {
    schema,
    generatedAt: GENERATED,
    status: "ready",
    runId: RUN_ID,
    commit: COMMIT,
    environment: ENVIRONMENT,
  };
}

function git(root, args, encoding = "utf8") {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding,
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout).toString()}`,
    );
  return encoding ? result.stdout.trim() : result.stdout;
}

function executableOnPath(name) {
  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [name],
    { encoding: "utf8", shell: false, windowsHide: true },
  );
  if (lookup.error || lookup.status !== 0)
    throw new Error(`required executable is unavailable: ${name}`);
  return realpathSync(lookup.stdout.trim().split(/\r?\n/u)[0]);
}

function secureVerifierOperatorRoot(target) {
  if (process.platform !== "win32") {
    chmodSync(target, 0o700);
    return;
  }
  const powershell = path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:VALDRIS_TEST_ROOT
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $target
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($current, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl
`,
    ],
    {
      encoding: "utf8",
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        VALDRIS_TEST_ROOT: target,
      },
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `failed to secure Windows executor output root: ${
        result.error?.message || result.stderr || result.stdout
      }`,
    );
}

function containerRuntimeProbe() {
  const probes = [];
  for (const runtime of ["docker", "podman"]) {
    let runtimeCli;
    try {
      runtimeCli = executableOnPath(runtime);
    } catch {
      probes.push({ runtime, outcome: "cli-unavailable" });
      continue;
    }
    const isolationRoot = canonicalTempDirectory("valdris-runtime-probe-");
    try {
      for (const directory of ["xdg-config", "xdg-cache", "docker"])
        mkdirSync(path.join(isolationRoot, directory));
      for (const file of ["containers.conf", "registries.conf", "storage.conf"])
        writeFileSync(path.join(isolationRoot, file), "");
      const identity = probeRuntimeDaemonIdentity(
        runtime,
        runtimeCli,
        isolatedRuntimeEnvironment(isolationRoot),
        createExecutionDeadline(15_000),
      );
      return {
        status: "available",
        runtime,
        runtimeCli,
        runtimeCliSha256: sha256(readFileSync(runtimeCli)),
        daemonIdentitySha256: identity.identitySha256,
        probes,
      };
    } catch (error) {
      probes.push({
        runtime,
        outcome: /deadline/u.test(error.message)
          ? "daemon-probe-timeout"
          : "daemon-unavailable",
      });
    } finally {
      rmSync(isolationRoot, { recursive: true, force: true });
    }
  }
  return {
    status: "skipped",
    reason: "Docker and Podman runtimes are unavailable",
    probes,
  };
}

function immutableBusyboxReference(runtime) {
  const tag = "busybox:1.36.1";
  let pulledByVerifier = false;
  let inspected = spawnSync(
    runtime,
    ["image", "inspect", "--format={{json .RepoDigests}}", tag],
    {
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 1_048_576,
    },
  );
  if (inspected.error || inspected.status !== 0) {
    const pulled = spawnSync(runtime, ["pull", tag], {
      encoding: "utf8",
      shell: false,
      timeout: 180_000,
      windowsHide: true,
      maxBuffer: 4_194_304,
    });
    if (pulled.error || pulled.status !== 0)
      throw new Error(
        `container runtime is available but the verifier could not pull ${tag}: ${
          pulled.error?.message || pulled.stderr || pulled.stdout
        }`,
      );
    pulledByVerifier = true;
    inspected = spawnSync(
      runtime,
      ["image", "inspect", "--format={{json .RepoDigests}}", tag],
      {
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 1_048_576,
      },
    );
  }
  if (inspected.error || inspected.status !== 0)
    throw new Error(
      `container runtime is available but ${tag} could not be inspected: ${
        inspected.error?.message || inspected.stderr || inspected.stdout
      }`,
    );
  let digests;
  try {
    digests = JSON.parse(inspected.stdout.trim());
  } catch {
    throw new Error(
      `container runtime returned malformed RepoDigests for ${tag}`,
    );
  }
  const image = digests?.find((entry) =>
    /^[^\s]+@sha256:[a-f0-9]{64}$/iu.test(entry),
  );
  if (!image)
    throw new Error(
      `container runtime did not resolve ${tag} to an immutable digest`,
    );
  return { image, pulledByVerifier, tag };
}

function interopAdapterSource(fault = "none") {
  return `import { createHash } from "node:crypto";

const FAULT = ${JSON.stringify(fault)};
const REQUEST_ENVELOPE_SCHEMA = "valdris.interop-envelope.request.v1";
const RESPONSE_ENVELOPE_SCHEMA = "valdris.interop-envelope.response.v1";
const canonicalJson = (value) => {
  if (Array.isArray(value)) return \`[\${value.map(canonicalJson).join(",")}]\`;
  if (value && typeof value === "object") return \`{\${Object.keys(value).sort().map((key) => \`\${JSON.stringify(key)}:\${canonicalJson(value[key])}\`).join(",")}}\`;
  return JSON.stringify(value);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const wait = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

function resultFor(request) {
  switch (request.id) {
    case "initialize":
      return {
        initialized: true,
        selectedVersion: request.version,
        serverIdentitySha256: request.identitySha256,
        authRootSha256: request.authRootSha256,
        capabilitySetSha256: sha256(canonicalJson(request.capabilities)),
      };
    case "version-negotiation":
      return {
        negotiation: "compatible",
        selectedVersion: request.version,
        rejectedVersions: request.test.offeredVersions.filter((version) => version !== request.version),
      };
    case "auth-root-isolation":
      return {
        isolation: "enforced",
        allowedRootSha256: request.authRootSha256,
        rejectedRootSha256: request.test.candidateRootSha256,
      };
    case "capability-discovery":
      return {
        advertisedCapabilities: request.capabilities,
        unsupportedCapabilities: request.test.requestedCapabilities.filter((capability) => !request.capabilities.includes(capability)),
        capabilitySetSha256: sha256(canonicalJson(request.capabilities)),
      };
    case "schema-negotiation":
      return {
        negotiation: "compatible",
        selectedRequestSchema: REQUEST_ENVELOPE_SCHEMA,
        selectedResponseSchema: RESPONSE_ENVELOPE_SCHEMA,
        rejectedSchemas: [...new Set([...request.test.requestSchemas, ...request.test.responseSchemas].filter((schema) => ![REQUEST_ENVELOPE_SCHEMA, RESPONSE_ENVELOPE_SCHEMA].includes(schema)))],
      };
    case "event-correlation": {
      const event = request.test.event;
      return {
        correlationId: event.correlationId,
        eventSha256: sha256(canonicalJson({ correlationId: event.correlationId, payloadSha256: event.payloadSha256 })),
        correlated: true,
      };
    }
    case "timeout":
      return {
        deadlineMs: request.test.deadlineMs,
        deadlineEnforced: true,
        timedOut: false,
        completedWithinDeadline: true,
      };
    case "cancellation":
      return {
        cancellationTokenSha256: request.test.cancellationTokenSha256,
        cancelled: true,
        mutationObserved: false,
      };
    case "unknown-tool-rejection":
      return {
        decision: "rejected",
        errorCode: "UNKNOWN_TOOL",
        toolNameSha256: sha256(request.test.toolName),
      };
    case "replay-protection":
      return {
        nonceSha256: sha256(request.test.nonce),
        firstDecision: "accepted",
        replayDecision: "rejected",
        errorCode: "REPLAY_DETECTED",
      };
    default:
      throw new Error("unsupported test");
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (FAULT === "echo-only") {
    process.stdout.write(JSON.stringify({ id: request.id, status: "passed" }));
    return;
  }
  if (FAULT === "timeout" && request.id === "timeout") wait(request.test.deadlineMs + 500);
  const result = resultFor(request);
  if (FAULT === "initialize" && request.id === "initialize") result.selectedVersion = "downgraded";
  if (FAULT === "version-negotiation" && request.id === "version-negotiation") result.rejectedVersions = [];
  if (FAULT === "auth-root-isolation" && request.id === "auth-root-isolation") result.allowedRootSha256 = request.test.candidateRootSha256;
  if (FAULT === "capability-discovery" && request.id === "capability-discovery") result.advertisedCapabilities = request.test.requestedCapabilities;
  if (FAULT === "schema-negotiation" && request.id === "schema-negotiation") result.selectedRequestSchema = "valdris.interop-envelope.v0";
  if (FAULT === "event-correlation" && request.id === "event-correlation") result.correlationId = sha256("detached-correlation");
  if (FAULT === "cancellation" && request.id === "cancellation") result.mutationObserved = true;
  if (FAULT === "unknown-tool-rejection" && request.id === "unknown-tool-rejection") result.decision = "accepted";
  if (FAULT === "replay-protection" && request.id === "replay-protection") result.replayDecision = "accepted";
  const response = {
    schema: "valdris.interop-conformance-response.v1",
    id: request.id,
    status: "passed",
    protocol: request.protocol,
    version: request.version,
    correlationId: request.correlationId,
    requestSha256: sha256(canonicalJson(request)),
    result,
  };
  if (FAULT === "request-binding" && request.id === "initialize") response.requestSha256 = sha256("detached-request");
  process.stdout.write(JSON.stringify(response));
});
`;
}

function buildFixture(
  root,
  { learningRoute = false, headProvider = "github" } = {},
) {
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "tests"), { recursive: true });
  mkdirSync(path.join(root, "contracts"), { recursive: true });
  mkdirSync(path.join(root, "commissioning"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "feature.ts"),
    "export const feature = false;\n",
  );
  writeFileSync(
    path.join(root, "package-lock.json"),
    '{"lockfileVersion":3,"packages":{}}\n',
  );
  writeFileSync(
    path.join(root, "contracts", "feature-contract-v1.json"),
    '{"expected":true}\n',
  );
  writeFileSync(
    path.join(root, "tests", "red-001.json"),
    '{"status":"failed"}\n',
  );
  writeFileSync(
    path.join(root, "commissioning", "acceptance.md"),
    "# Commissioned acceptance\n",
  );
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Valdris Test"]);
  git(root, ["config", "user.email", "valdris@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture base"]);
  const baseCommit = git(root, ["rev-parse", "HEAD"]);
  const baseTreeSha256 = sha256(
    git(root, ["rev-parse", `${baseCommit}^{tree}`]),
  );
  writeFileSync(
    path.join(root, "src", "feature.ts"),
    "export const feature = true;\n",
  );
  writeFileSync(
    path.join(root, "package-lock.json"),
    '{"lockfileVersion":3,"packages":{"example":{"version":"1.2.3","resolved":"https://registry.example.invalid/example/-/example-1.2.3.tgz","integrity":"sha512-example"}}}\n',
  );
  git(root, ["add", "src/feature.ts", "package-lock.json"]);
  git(root, ["commit", "-qm", "fixture change"]);
  const headCommit = git(root, ["rev-parse", "HEAD"]);
  COMMIT = headCommit;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const allowedSchemas = [
    "uash.approval-receipt.v1",
    "uash.implementation-readiness-receipt.v1",
    "uash.implementation-start-receipt.v1",
    "valdris.semantic-execution-receipt.v1",
    "valdris.proof-executor-receipt.v1",
    "valdris.bridge-head-receipt.v1",
    "valdris.model-routing-receipt.v1",
    "valdris.trace-receipt.v2",
    "valdris.usage-receipt.v1",
    "valdris.runtime-conformance-receipt.v1",
    "valdris.memory-head-receipt.v1",
    "uash.tool-approval-receipt.v1",
    "valdris.implementation-execution-receipt.v1",
    "uash.promotion-receipt.v1",
    "uash.harness-learning.v1",
  ];
  const trustStore = {
    schema: AUTHORITY_TRUST_SCHEMA,
    description: "Synthetic verifier trust store.",
    keys: [
      {
        keyId: "operator-key",
        algorithm: "ed25519",
        status: "active",
        publicKeyPem: publicKey
          .export({ format: "pem", type: "spki" })
          .toString(),
        allowedSchemas,
        allowedActorIds: ["release-operator"],
      },
    ],
  };
  const trustPin = authorityTrustStoreSha256(trustStore);
  writeJson(root, "controls/authority-trust.v1.json", trustStore);

  function receipt(schema, eventId, fields = {}) {
    const signedAt = fields._signedAt || GENERATED;
    const actorType =
      fields._actorType ||
      (["uash.approval-receipt.v1", "uash.tool-approval-receipt.v1"].includes(
        schema,
      )
        ? "human"
        : "service");
    const receiptFields = { ...fields };
    delete receiptFields._signedAt;
    delete receiptFields._actorType;
    const document = {
      schema,
      actor: { id: "release-operator", type: actorType },
      eventId,
      correlationSha256: D(`${eventId}-correlation`),
      authorityTrustSha256: trustPin,
      issuedAt: GENERATED,
      expiresAt: "2099-01-01T00:00:00.000Z",
      ...receiptFields,
      attestation: { scheme: "ed25519", keyId: "operator-key", signedAt },
    };
    const payload = canonicalJson(authorityAttestationPayload(document));
    document.attestation.payloadSha256 = sha256(payload);
    document.attestation.signature = signPayload(
      null,
      Buffer.from(payload),
      privateKey,
    ).toString("base64");
    return document;
  }

  writeFileSync(path.join(root, "context-source.md"), "bounded context\n");
  mkdirSync(path.join(root, "evals"), { recursive: true });
  const contextCasesPath = writeJson(root, "evals/context-cases.json", {
    schema: "uash.context-case-set.v1",
    cases: [{ id: "case-1", input: "prove the commissioned behavior" }],
  });
  const contextAnswersPath = writeJson(root, "evals/context-answers.json", {
    schema: "uash.context-answer-key.v1",
    answers: [{ caseId: "case-1", expected: "grounded" }],
  });
  const contextManifest = {
    schema: CONTEXT_MANIFEST_V2_SCHEMA,
    generatedAt: GENERATED,
    runId: RUN_ID,
    profile: "enterprise",
    environment: ENVIRONMENT,
    commit: COMMIT,
    loadedFiles: [
      {
        path: "context-source.md",
        sha256: fileSha256(path.join(root, "context-source.md")),
        loadedAt: "2030-01-01T11:59:00.000Z",
        kind: "knowledge",
        loadMode: "static",
        purpose: "Synthetic assurance context",
        owner: "platform-team",
        version: "1.0.0",
        tokenEstimate: 20,
      },
    ],
    budget: { maxTokens: 100, staticMaxTokens: 50, loadedTokens: 20 },
    contextQuality: {
      schema: "uash.context-quality-eval.v1",
      suiteId: "context-quality",
      baselineMode: "limited-context",
      caseSet: {
        id: "context-cases",
        version: "1",
        caseCount: 1,
        path: "evals/context-cases.json",
        sha256: fileSha256(contextCasesPath),
      },
      answerKey: {
        id: "context-answers",
        version: "1",
        caseCount: 1,
        path: "evals/context-answers.json",
        sha256: fileSha256(contextAnswersPath),
      },
      metric: {
        id: "accuracy",
        direction: "higher-is-better",
        minDelta: 0.1,
        candidateThreshold: 0.9,
      },
    },
  };
  const contextPath = writeJson(root, "context/manifest.json", contextManifest);

  const evalPlan = {
    schema: "uash.agent-eval-plan.v1",
    aiTier: "AI2",
    dimensions: POLICY.aiEvalDimensions.AI2,
    suites: [
      {
        id: "context-quality",
        caseSetSha256: contextManifest.contextQuality.caseSet.sha256,
        rubricId: "context-answers",
      },
    ],
  };
  const evaluationPlanSha256 = sha256(canonicalJson(evalPlan));
  const suiteIds = evalPlan.suites.map((suite) => suite.id);
  const evaluator = {
    name: "valdris-evaluator",
    version: "1.0.0",
    kind: "deterministic",
  };
  const model = {
    provider: "example-provider",
    name: "example-model",
    version: "1.0.0",
  };
  const promptVersion = "prompt-v1";
  const configDigest = D("eval-config");
  const armResult = (contextMode, value) => ({
    schema: "uash.context-arm-result.v1",
    suiteId: "context-quality",
    contextManifestSha256: fileSha256(contextPath),
    runId: RUN_ID,
    profile: "enterprise",
    commit: COMMIT,
    environment: ENVIRONMENT,
    contextMode,
    caseSet: contextManifest.contextQuality.caseSet,
    answerKey: contextManifest.contextQuality.answerKey,
    evaluator,
    model,
    promptVersion,
    configDigest,
    metric: contextManifest.contextQuality.metric,
    cases: [{ caseId: "case-1", value, criticalRegression: false }],
    aggregate: {
      method: "arithmetic-mean",
      caseCount: 1,
      value,
      criticalRegressions: 0,
    },
  });
  const baselinePath = writeJson(
    root,
    "evals/context-baseline.json",
    armResult("limited-context", 0.7),
  );
  const candidatePath = writeJson(
    root,
    "evals/context-candidate.json",
    armResult("loaded-context", 0.95),
  );
  const arm = (contextMode, value, resultPath, resultDigest) => ({
    contextMode,
    value,
    resultPath,
    resultDigest,
    caseSet: contextManifest.contextQuality.caseSet,
    answerKey: contextManifest.contextQuality.answerKey,
    evaluator,
    model,
    promptVersion,
    configDigest,
  });
  const evalResults = {
    schema: "uash.eval-results.v1",
    generatedAt: GENERATED,
    status: "passed",
    runId: RUN_ID,
    profile: "enterprise",
    commit: COMMIT,
    environment: ENVIRONMENT,
    evaluationPlanSha256,
    suiteIds,
    dimensions: evalPlan.dimensions,
    suites: [
      {
        id: "context-quality",
        kind: "ai",
        datasets: [contextManifest.contextQuality.caseSet],
        rubrics: [contextManifest.contextQuality.answerKey],
        evaluator,
        model,
        promptVersion,
        configDigest,
        criticalFailures: 0,
        slices: [
          {
            id: "critical-context",
            value: 0.95,
            threshold: 0.9,
            operator: ">=",
          },
        ],
        resultPath: "evals/context-candidate.json",
        resultDigest: fileSha256(candidatePath),
        threshold: 0.9,
        value: 0.95,
        operator: ">=",
        startedAt: "2030-01-01T11:40:00.000Z",
        completedAt: "2030-01-01T11:45:00.000Z",
        contextComparison: {
          schema: "uash.context-comparison.v1",
          contextManifestSha256: fileSha256(contextPath),
          baselineMode: "limited-context",
          metric: contextManifest.contextQuality.metric,
          criticalRegressions: 0,
          delta: 0.25,
          baseline: arm(
            "limited-context",
            0.7,
            "evals/context-baseline.json",
            fileSha256(baselinePath),
          ),
          candidate: arm(
            "loaded-context",
            0.95,
            "evals/context-candidate.json",
            fileSha256(candidatePath),
          ),
        },
      },
    ],
  };
  let priorTraceEventSha256 =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const traceEvents = [
    {
      eventId: "trace-event-1",
      occurredAt: "2030-01-01T12:00:00.000Z",
      type: "tool-call",
    },
    {
      eventId: "trace-decision-1",
      occurredAt: "2030-01-01T12:00:01.000Z",
      type: "decision",
      decisionId: "select-verification-model",
      decisionEvidenceSha256: D("routing-quality-evidence"),
    },
  ].map((event, index) => {
    const chained = {
      ...event,
      sequence: index + 1,
      priorEventSha256: priorTraceEventSha256,
    };
    chained.eventSha256 = sha256(canonicalJson(chained));
    priorTraceEventSha256 = chained.eventSha256;
    return chained;
  });
  writeFileSync(
    path.join(root, "trajectory-trace.jsonl"),
    traceEvents.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  const trajectory = {
    schema: "uash.trajectory.v1",
    generatedAt: GENERATED,
    status: "passed",
    goalId: RUN_ID,
    profile: "enterprise",
    commit: COMMIT,
    environment: ENVIRONMENT,
    evaluationPlanSha256,
    suiteIds,
    dimensions: evalPlan.dimensions,
    finalStatus: "completed",
    budget: {
      limits: {
        attempts: 2,
        toolCalls: 10,
        tokens: 1000,
        costUsd: 10,
        wallClockMinutes: 10,
      },
      used: {
        attempts: 1,
        toolCalls: 1,
        tokens: 100,
        costUsd: 1,
        wallClockMinutes: 1,
      },
    },
    attempts: [
      {
        id: "attempt-1",
        outcome: "succeeded",
        usage: {
          toolCalls: 1,
          tokens: 100,
          costUsd: 1,
          wallClockMinutes: 1,
        },
        actions: ["evaluate"],
        startedAt: "2030-01-01T11:40:00.000Z",
        completedAt: "2030-01-01T11:45:00.000Z",
      },
    ],
    forbiddenActions: [],
    violations: [],
    tracePath: "trajectory-trace.jsonl",
    traceDigest: fileSha256(path.join(root, "trajectory-trace.jsonl")),
  };
  const smokeOutput = writeJson(root, "smoke/provider-output.json", {
    status: "passed",
  });
  const smoke = {
    schema: "uash.live-smoke.v1",
    generatedAt: GENERATED,
    status: "passed",
    runId: RUN_ID,
    profile: "enterprise",
    commit: COMMIT,
    environment: ENVIRONMENT,
    evaluationPlanSha256,
    suiteIds,
    dimensions: evalPlan.dimensions,
    target: { kind: "deployment", identifier: "example-deployment" },
    control: {
      id: "LIVE-SMOKE-001",
      status: "passed",
      evidence: [
        {
          type: "command",
          subject: "LIVE-SMOKE-001",
          runId: RUN_ID,
          commit: COMMIT,
          environment: ENVIRONMENT,
          trustTier: "ci-attested",
          producer: { name: "example-ci", version: "1", kind: "ci" },
          command: "verify-deployment",
          exitCode: 0,
          completedAt: GENERATED,
          outputPath: "smoke/provider-output.json",
          outputDigest: fileSha256(smokeOutput),
          targetIdentifier: "example-deployment",
        },
      ],
    },
  };
  const evaluationEvidence = {
    evaluationPlanSha256,
    suiteIds,
    dimensions: evalPlan.dimensions,
    results: {
      path: "evals/results.json",
      sha256: fileSha256(writeJson(root, "evals/results.json", evalResults)),
    },
    trajectory: {
      path: "trajectory/trajectory.json",
      sha256: fileSha256(
        writeJson(root, "trajectory/trajectory.json", trajectory),
      ),
    },
    smoke: {
      path: "smoke/smoke_proof.json",
      sha256: fileSha256(writeJson(root, "smoke/smoke_proof.json", smoke)),
    },
  };
  const greenAcceptancePath = path.join(root, "tests", "green-red-001.json");
  const greenAcceptanceRun = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts", "proof-runner.mjs"),
      "--repo",
      root,
      "--run-id",
      RUN_ID,
      "--commit",
      COMMIT,
      "--environment",
      ENVIRONMENT,
      "--output",
      "tests/green-red-001.json",
      "--",
      process.execPath,
      "-e",
      "process.exit(0)",
      "red-001",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (greenAcceptanceRun.status !== 0)
    throw new Error(
      `failed to create native green acceptance proof: ${greenAcceptanceRun.stderr || greenAcceptanceRun.stdout}`,
    );
  const greenAcceptanceProof = JSON.parse(
    readFileSync(greenAcceptancePath, "utf8"),
  );
  const acceptanceResults = {
    ...subject("uash.acceptance-results.v1"),
    tests: [
      {
        id: "red-001",
        status: "passed",
        evidenceKind: "portable-proof",
        producer: {
          name: "valdris-proof-runner",
          version: "1.0.0",
          kind: "proof-runner",
        },
        commandSha256: greenAcceptanceProof.bindings.commandSha256,
        evidencePath: "tests/green-red-001.json",
        evidenceSha256: fileSha256(greenAcceptancePath),
      },
    ],
    evalSuites: [
      {
        id: "context-quality",
        status: "passed",
        evidenceKind: "native-eval",
        producer: {
          name: "valdris-eval-gate",
          version: "1.0.0",
          kind: "native-eval",
        },
        evidencePath: "evals/results.json",
        evidenceSha256: evaluationEvidence.results.sha256,
      },
    ],
  };
  const acceptanceResultsPath = writeJson(
    root,
    "run/acceptance-results.json",
    acceptanceResults,
  );
  writeFileSync(
    path.join(root, "tests", "first-mutation.json"),
    '{"mutation":"src/feature.ts"}\n',
  );
  const workloadClassification = {
    schema: "uash.workload-classification.v1",
    runId: RUN_ID,
    requestedProfile: "enterprise",
    environment: ENVIRONMENT,
    effectiveTier: "T2",
    effectiveAiTier: "AI2",
    workloadProfiles: ["ai-agentic"],
  };
  const classificationPath = writeJson(
    root,
    "run/workload-classification.json",
    workloadClassification,
  );
  const route = {
    schema: "uash.route.v2",
    runId: RUN_ID,
    requestedProfile: "enterprise",
    environment: ENVIRONMENT,
    workloadClassificationSha256: fileSha256(classificationPath),
    assuranceTier: { effective: "T2", aiEffective: "AI2" },
    workloadProfiles: ["ai-agentic"],
    lifecycle: {
      sourceStage: "production",
      targetStage: "production",
      failureDisposition: "none",
    },
    changeKinds: learningRoute ? ["harness-rule"] : ["application-code"],
  };
  const routePath = writeJson(root, "run/route.json", route);
  const sourceRequestSha256 = D("build the commissioned feature");
  const goal = {
    schema: "uash.goal.v1",
    id: RUN_ID,
    requestSha256: sourceRequestSha256,
    stoppingConditions: [
      {
        id: "goal-completed",
        description: "All acceptance and assurance evidence passes.",
      },
    ],
  };
  writeJson(root, "goal/goal.json", goal);
  const requirementsContract = {
    ...subject("uash.requirements-contract.v1"),
    sourceRequestSha256,
    requirements: [
      {
        id: "feature-behavior",
        owner: "product-owner",
        statement: "The commissioned feature satisfies its bounded behavior.",
        critical: true,
        assumptions: ["The target environment is commissioned."],
        unknowns: [],
        constraints: ["Evidence must be replayable."],
        stoppingConditionIds: ["goal-completed"],
        apiSchemaIdentities: [D("feature-api-schema")],
        eventSchemaIdentities: [D("feature-event-schema")],
        acceptanceCriteria: [
          {
            id: "feature-negative-boundary",
            description: "The feature rejects the pre-implementation failure.",
            kind: "negative",
            testIds: ["red-001"],
            evalSuiteIds: ["context-quality"],
          },
        ],
      },
    ],
  };
  const requirementsPath = writeJson(
    root,
    "run/requirements-contract.json",
    requirementsContract,
  );
  const contracts = [
    {
      id: "requirements-contract-v1",
      schema: "uash.requirements-contract.v1",
      path: "run/requirements-contract.json",
      sha256: fileSha256(requirementsPath),
    },
    {
      id: "feature-contract-v1",
      path: "contracts/feature-contract-v1.json",
      sha256: fileSha256(
        path.join(root, "contracts", "feature-contract-v1.json"),
      ),
    },
  ];
  const redBaselines = [
    {
      testId: "red-001",
      status: "failed",
      evidencePath: "tests/red-001.json",
      evidenceSha256: fileSha256(path.join(root, "tests", "red-001.json")),
    },
  ];
  const readiness = {
    ...subject("uash.implementation-readiness.v1"),
    routeSha256: fileSha256(routePath),
    workloadClassificationSha256: fileSha256(classificationPath),
    contractSetSha256: sha256(canonicalJson(contracts)),
    testPlanSha256: sha256(canonicalJson(redBaselines)),
    evaluationPlanSha256,
    journalHeadSha256: D("journal-head"),
    journalSequence: 4,
    implementationFixedPoint: {
      baseCommit,
      baseTreeSha256,
      source: "commissioned-pre-implementation",
    },
    sealedAt: "2030-01-01T10:00:00.000Z",
    contracts,
    redBaselines,
    evalPlan,
  };
  readiness.sealReceipt = receipt(
    "uash.implementation-readiness-receipt.v1",
    "readiness-seal",
    {
      runId: RUN_ID,
      issuedAt: readiness.sealedAt,
      _signedAt: readiness.sealedAt,
      readinessPayloadSha256: sha256(canonicalJson(readiness)),
      routeSha256: readiness.routeSha256,
      workloadClassificationSha256: readiness.workloadClassificationSha256,
      contractSetSha256: readiness.contractSetSha256,
      testPlanSha256: readiness.testPlanSha256,
      evaluationPlanSha256: readiness.evaluationPlanSha256,
      sequence: readiness.journalSequence,
      priorHeadSha256: D("journal-head-3"),
      currentHeadSha256: readiness.journalHeadSha256,
      compareAndSwap: "applied",
      sealedAt: readiness.sealedAt,
    },
  );
  readiness.implementationStartReceipt = receipt(
    "uash.implementation-start-receipt.v1",
    "implementation-start",
    {
      runId: RUN_ID,
      issuedAt: "2030-01-01T10:01:00.000Z",
      _signedAt: "2030-01-01T10:01:00.000Z",
      implementationStartedAt: "2030-01-01T10:01:00.000Z",
      readinessPayloadSha256: readiness.sealReceipt.readinessPayloadSha256,
      routeSha256: readiness.routeSha256,
      workloadClassificationSha256: readiness.workloadClassificationSha256,
      sequence: readiness.journalSequence + 1,
      priorHeadSha256: readiness.journalHeadSha256,
      currentHeadSha256: D("implementation-head"),
      compareAndSwap: "applied",
      firstMutationSha256: D("src/feature.ts:first-change"),
      firstMutationEvidencePath: "tests/first-mutation.json",
      firstMutationEvidenceSha256: fileSha256(
        path.join(root, "tests", "first-mutation.json"),
      ),
    },
  );

  const augmentation = {
    schema: "uash.assurance-augmentation.v1",
    routeSha256: readiness.routeSha256,
    workloadClassificationSha256: readiness.workloadClassificationSha256,
    rationale: "AI workload requires semantic grounding and tool assurance.",
    additions: [
      { kind: "ai-tier-elevation", id: "AI2" },
      { kind: "control", id: "grounded-output" },
    ],
  };
  const adapters = [
    {
      schema: "valdris.semantic-proof-adapter.v1",
      controlId: "grounded-output",
      commandId: "semantic-grounding-eval",
      inputSchema: { type: "object", required: ["caseSet"] },
      assertionSchema: { type: "object", required: ["grounded-rate"] },
      inputSha256: D("semantic-input"),
      resultSha256: D("semantic-result"),
      supportedTier: "AI2",
      timeoutMs: 60000,
      maxOutputBytes: 1048576,
      validatorSha256: D("validator"),
      assertions: [{ metric: "grounded-rate", observed: 0.97, passed: true }],
    },
  ];
  adapters[0].executionReceipt = receipt(
    "valdris.semantic-execution-receipt.v1",
    "semantic-grounding-execution",
    {
      runId: RUN_ID,
      controlId: adapters[0].controlId,
      commandId: adapters[0].commandId,
      inputSha256: adapters[0].inputSha256,
      resultSha256: adapters[0].resultSha256,
      validatorSha256: adapters[0].validatorSha256,
      supportedTier: adapters[0].supportedTier,
      assertionsSha256: sha256(canonicalJson(adapters[0].assertions)),
      environment: ENVIRONMENT,
      startedAt: "2030-01-01T11:50:00.000Z",
      finishedAt: "2030-01-01T11:51:00.000Z",
      exitCode: 0,
    },
  );
  const adapterSetSha256 = sha256(canonicalJson(adapters));
  const validatorSetSha256 = semanticValidatorSetSha256({ adapters });
  const githubHeadProtectionPolicy = {
    enforceAdmins: true,
    requiredLinearHistory: true,
    strictStatusChecks: true,
    requirePullRequest: true,
    noBypassAllowances: true,
    appendOnlyStatusCheck: {
      context: "valdris-append-only-head",
      appId: 424242,
    },
    writerRestrictions: {
      apps: [{ id: 31337, slug: "valdris-head-writer" }],
      teams: [],
      users: [],
    },
    proposalFlow: {
      mergeMethod: "rebase",
      operationDeadlineMs: 30_000,
      pollIntervalMs: 1_000,
      fullReplayInterval: 1,
    },
  };
  const acceptancePolicy = {
    schema: "valdris.acceptance-policy.v1",
    owner: "product-owner",
    version: "1.0.0",
    source: "commissioning/acceptance.md",
    sourceSha256: fileSha256(path.join(root, "commissioning", "acceptance.md")),
    profile: "enterprise",
    workloadProfiles: ["ai-agentic"],
    environment: ENVIRONMENT,
    effectiveAssuranceTier: "T2",
    effectiveAiTier: "AI2",
    adapterSetSha256,
    proofExecutor: {
      commandIdentitySha256: D("commissioned-command"),
      validatorSetSha256,
      imageSha256: D("oci-image"),
      executorId: "oci-reference-executor",
      sourceSnapshotMode: "git-raw-object-tree-content-addressed-oci-layer",
      liveWorktreeMount: false,
      exclusiveOutputRoot: true,
      outputRootPathSha256: D("operator-owned-output-root-path"),
      outputRootIdentitySha256: D("operator-owned-output-root-identity"),
      outputRootPolicySha256: sha256(
        canonicalJson({
          pathSha256: D("operator-owned-output-root-path"),
          identitySha256: D("operator-owned-output-root-identity"),
        }),
      ),
      containerIdentity: "cidfile-and-unique-name",
      runtimeKind: "docker",
      runtimeEndpoint: "local-default",
      runtimeCliPath: "/opt/valdris/bin/docker",
      runtimeCliPathSha256: sha256("/opt/valdris/bin/docker"),
      runtimeCliSha256: D("commissioned-docker-binary"),
      gitCliPath: "/opt/valdris/bin/git",
      gitCliPathSha256: sha256("/opt/valdris/bin/git"),
      gitCliSha256: D("commissioned-git-binary"),
      daemonIdentitySha256: sha256(
        canonicalJson({
          schema: "valdris.oci-daemon-identity.v1",
          runtimeKind: "docker",
          endpoint: "local-default",
          daemonId: "commissioned-daemon",
          daemonVersion: "1.0.0",
          operatingSystem: "linux",
          architecture: "amd64",
        }),
      ),
    },
    bridgeHead:
      headProvider === "github"
        ? {
            provider: "github",
            providerIdentitySha256: D("github-head-provider"),
            adapterSchema: "valdris.github-head-provider-proof.v1",
            target: {
              hostname: "github.example.invalid",
              repository: "example/valdris",
              branch: "valdris-heads",
              headPath: "heads/authoritative.json",
            },
            targetSha256: sha256(
              canonicalJson({
                hostname: "github.example.invalid",
                repository: "example/valdris",
                branch: "valdris-heads",
                headPath: "heads/authoritative.json",
              }),
            ),
            receiptRootPolicy: {
              pathSha256: D("github-receipt-root-path"),
              identitySha256: D("github-receipt-root-identity"),
            },
            protectionPolicy: githubHeadProtectionPolicy,
            protectionPolicySha256: sha256(
              canonicalJson(githubHeadProtectionPolicy),
            ),
          }
        : {
            provider: "neutral-ledger",
            providerIdentitySha256: D("neutral-head-provider"),
            adapterSchema: "example.neutral-head-provider-proof.v1",
            target: {
              namespace: "example",
              stream: "authoritative-head",
            },
            targetSha256: sha256(
              canonicalJson({
                namespace: "example",
                stream: "authoritative-head",
              }),
            ),
            protectionPolicySha256: D("neutral-head-protection-policy"),
          },
    thresholds: [
      {
        controlId: "grounded-output",
        metric: "grounded-rate",
        operator: "gte",
        value: 0.95,
      },
    ],
  };
  const semantic = {
    ...subject("valdris.semantic-assurance.v1"),
    routeSha256: readiness.routeSha256,
    workloadClassificationSha256: readiness.workloadClassificationSha256,
    augmentation,
    acceptancePolicy,
    adapters,
    adapterSetSha256,
    aiWorkloadIdentity: {
      schema: "uash.ai-workload-identity.v1",
      tier: "AI2",
      taskClass: "ai-feature",
      modelSha256: D("provider/model-version"),
      providerSha256: D("provider-identity"),
      promptSha256: D("prompt"),
      toolSetSha256: D("tools"),
      corpusSha256: D("corpus"),
      memoryPolicySha256: D("memory"),
      evaluationPlanSha256: readiness.evaluationPlanSha256,
      smokeTestSha256: D("smoke"),
      observabilityPolicySha256: D("observability"),
    },
    approvalReceipts: [
      receipt("uash.approval-receipt.v1", "approval-augmentation", {
        _actorType: "human",
        runId: RUN_ID,
        scope: "assurance-augmentation",
        artifactSha256: sha256(canonicalJson(augmentation)),
        providerReceipt: {
          id: "approval-provider-1",
          sha256: D("approval-provider-1"),
        },
      }),
      receipt("uash.approval-receipt.v1", "approval-policy", {
        _actorType: "human",
        runId: RUN_ID,
        scope: "acceptance-policy",
        artifactSha256: sha256(canonicalJson(acceptancePolicy)),
        providerReceipt: {
          id: "approval-provider-2",
          sha256: D("approval-provider-2"),
        },
      }),
    ],
  };

  const toolRegistry = {
    ...subject("valdris.tool-registry.v1"),
    tools: [
      {
        id: "repository-read",
        version: "1.0.0",
        providerSha256: D("repository-tool-provider"),
        inputSchemaSha256: D("repository-read-input"),
        outputSchemaSha256: D("repository-read-output"),
        effectClass: "read",
        riskClass: "low",
        approvalRule: "none",
        timeoutMs: 30000,
        retry: {
          maxAttempts: 2,
          backoffMs: 100,
          idempotencyKeyRequired: false,
        },
        auditSchema: "repository-read-audit-v1",
        scopes: {
          capabilities: ["read"],
          data: ["repository"],
          network: [],
          filesystem: ["source-readonly"],
        },
      },
    ],
  };
  const toolRegistryPath = writeJson(
    root,
    "runtime/tool-registry.json",
    toolRegistry,
  );
  const toolCallInputSha256 = D("tool-call-input");
  const toolCallOutputSha256 = D("tool-call-output");
  const toolIdentitySha256 = sha256(
    canonicalJson({ id: "repository-read", version: "1.0.0" }),
  );
  const hookReceipts = POLICY.execution.hookPoints.map((hook) => ({
    eventId: `hook-${hook}`,
    hook,
    outcome: "allow",
    enforced: true,
    policySha256: D(`hook-${hook}`),
    inputSha256: ["before-tool", "after-tool"].includes(hook)
      ? toolCallInputSha256
      : D(`hook-input-${hook}`),
    evidenceSha256: D(`hook-proof-${hook}`),
    ...(["before-tool", "after-tool"].includes(hook)
      ? {
          toolCallEventId: "tool-call-1",
          toolIdentitySha256,
        }
      : {}),
    ...(hook === "after-tool" ? { outputSha256: toolCallOutputSha256 } : {}),
  }));
  const beforeToolHook = hookReceipts.find(
    (receiptEntry) => receiptEntry.hook === "before-tool",
  );
  const afterToolHook = hookReceipts.find(
    (receiptEntry) => receiptEntry.hook === "after-tool",
  );
  const toolCallReceipts = [
    {
      eventId: "tool-call-1",
      agentId: "orchestrator",
      toolId: "repository-read",
      toolVersion: "1.0.0",
      inputSha256: toolCallInputSha256,
      outputSha256: toolCallOutputSha256,
      outcome: "passed",
      startedAt: "2030-01-01T11:20:00.000Z",
      finishedAt: "2030-01-01T11:20:01.000Z",
      beforeHookEventId: beforeToolHook.eventId,
      afterHookEventId: afterToolHook.eventId,
      beforeHookSha256: sha256(canonicalJson(beforeToolHook)),
      afterHookSha256: sha256(canonicalJson(afterToolHook)),
    },
  ];
  const memoryProviderSha256 = sha256(
    canonicalJson({ actorId: "release-operator", keyId: "operator-key" }),
  );
  const memoryHeadReceipt = receipt(
    "valdris.memory-head-receipt.v1",
    "memory-head-1",
    {
      runId: RUN_ID,
      memoryId: "run-memory",
      owner: "platform-team",
      scope: "run",
      providerSha256: memoryProviderSha256,
      storeIdentitySha256: D("memory-store"),
      priorHeadSha256: POLICY.context.emptyMemoryHeadSha256,
      currentHeadSha256: D("memory-head-1"),
      sourceSessionIdentitySha256: D("prior-runtime-session"),
      contentSha256: D("memory-content"),
      action: "write",
    },
  );
  const priorMemoryHeadReceipt = receipt(
    "valdris.memory-head-receipt.v1",
    "prior-memory-head",
    {
      runId: "prior-run",
      memoryId: "persisted-memory",
      owner: "platform-team",
      scope: "run",
      providerSha256: memoryProviderSha256,
      storeIdentitySha256: D("memory-store"),
      priorHeadSha256: POLICY.context.emptyMemoryHeadSha256,
      currentHeadSha256: D("persisted-memory-prior-head"),
      sourceSessionIdentitySha256: D("older-runtime-session"),
      contentSha256: D("persisted-memory-content"),
      action: "write",
    },
  );
  const memoryReadReceipt = receipt(
    "valdris.memory-head-receipt.v1",
    "memory-read-head",
    {
      runId: RUN_ID,
      memoryId: "persisted-memory",
      owner: "platform-team",
      scope: "run",
      providerSha256: memoryProviderSha256,
      storeIdentitySha256: D("memory-store"),
      priorHeadSha256: priorMemoryHeadReceipt.currentHeadSha256,
      currentHeadSha256: D("persisted-memory-read-head"),
      sourceSessionIdentitySha256:
        priorMemoryHeadReceipt.sourceSessionIdentitySha256,
      sourceReceiptEventId: priorMemoryHeadReceipt.eventId,
      contentSha256: D("persisted-memory-content"),
      action: "read",
    },
  );
  const driverInput = (status, expectedHead) => ({
    runId: RUN_ID,
    leaseId: "runtime-lease-1",
    leaseOwner: "codex-runtime",
    leaseMinutes: 60,
    expectedHead,
    status,
  });
  const driverState1 = nextRuntimeDriverState(
    null,
    driverInput(
      "running",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ),
    new Date("2030-01-01T11:00:00.000Z"),
  );
  const driverState2 = nextRuntimeDriverState(
    driverState1,
    driverInput("running", driverState1.currentHeadSha256),
    new Date("2030-01-01T11:10:00.000Z"),
  );
  const driverState = nextRuntimeDriverState(
    driverState2,
    driverInput("completed", driverState2.currentHeadSha256),
    new Date("2030-01-01T11:20:00.000Z"),
  );
  const driverStatePath = writeJson(
    root,
    "runtime/driver-state.json",
    driverState,
  );
  const implementationReceipt = receipt(
    "valdris.implementation-execution-receipt.v1",
    "implementation-execution-1",
    {
      runId: RUN_ID,
      commandSha256: D("codex implementation command"),
      sandboxPolicySha256: D("sandbox-policy"),
      capabilityPolicySha256: D("capability-policy"),
      beforeTreeSha256: baseTreeSha256,
      afterTreeSha256: D("implementation-tree-after"),
      diffSha256: D("implementation-diff"),
      eventJournalSha256: D("implementation-journal"),
      driverStateHeadSha256: driverState.currentHeadSha256,
      driverStateDocumentSha256: fileSha256(driverStatePath),
      startedAt: "2030-01-01T11:30:00.000Z",
      finishedAt: "2030-01-01T11:31:00.000Z",
      mutationResult: "changed",
      sandboxEnforced: true,
      inheritAmbientSecrets: false,
      networkPolicy: "none",
      exitCode: 0,
    },
  );
  const runtimeDriver = {
    ...subject("valdris.runtime-driver.v1"),
    adapter: {
      id: "codex-reference-driver",
      version: "1.0.0",
      runtime: "codex",
      providerSha256: D("codex-runtime-provider"),
    },
    state: {
      path: "runtime/driver-state.json",
      sha256: fileSha256(driverStatePath),
      leaseId: driverState.leaseId,
      leaseOwner: driverState.leaseOwner,
      leaseExpiresAt: driverState.leaseExpiresAt,
      checkpointRevision: driverState.checkpointRevision,
      priorHeadSha256: driverState.priorHeadSha256,
      currentHeadSha256: driverState.currentHeadSha256,
    },
    stopPolicy: {
      goalSha256: fileSha256(path.join(root, "goal", "goal.json")),
      budgetSha256: D("runtime-budget"),
      terminalStates: ["completed", "blocked", "cancelled", "failed"],
      resumeSupported: true,
      cancelSupported: true,
    },
    implementationReceipt,
  };
  const runtimeDriverPath = writeJson(
    root,
    "runtime/driver.json",
    runtimeDriver,
  );
  const economicsLedger = {
    ...subject("uash.ai-economics-ledger.v1"),
    pricingPolicySha256: D("pricing-policy"),
    providerBillingReceiptSha256: D("pending-provider-billing"),
    currency: "USD",
    totals: {
      inputTokens: 1000,
      outputTokens: 500,
      toolCalls: toolCallReceipts.length,
      retryCount: 0,
      latencyMsP50: 400,
      latencyMsP95: 900,
      modelSpend: 1.2,
      toolSpend: 0.05,
      retryWasteSpend: 0,
      humanReviewMinutes: 5,
      actualSpend: 1.25,
      maximumSpend: 2,
    },
    firstPassSuccess: {
      sampleWindowSha256: D("first-pass-window"),
      successfulRuns: 10,
      totalRuns: 10,
      rate: 1,
      currentRunFirstPass: true,
    },
    modelUsage: [
      {
        modelSha256: D("provider/model-version"),
        providerSha256: D("provider-identity"),
        inputTokens: 1000,
        outputTokens: 500,
        cost: 1.2,
      },
    ],
    toolUsage: [
      {
        toolCallEventId: toolCallReceipts[0].eventId,
        toolIdentitySha256,
        providerSha256: toolRegistry.tools[0].providerSha256,
        billingReceiptSha256: D("repository-tool-billing"),
        currency: "USD",
        cost: 0.05,
      },
    ],
    tenantUsage: [],
  };
  economicsLedger.providerBillingReceiptSha256 =
    aiEconomicsUsageSha256(economicsLedger);
  const economicsPath = writeJson(
    root,
    "runtime/economics.json",
    economicsLedger,
  );
  const interopTests = [
    "initialize",
    "version-negotiation",
    "auth-root-isolation",
    "capability-discovery",
    "schema-negotiation",
    "event-correlation",
    "timeout",
    "cancellation",
    "unknown-tool-rejection",
    "replay-protection",
  ];
  const interopTranscript = {
    ...subject("valdris.interop-transcript.v1"),
    protocol: "mcp",
    version: "2029-01",
    identitySha256: D("mcp-identity"),
    authRootSha256: D("mcp-auth-root"),
    capabilitySetSha256: sha256(canonicalJson(["tools"])),
    tests: interopTests.map((id, index) => ({
      id,
      status: "passed",
      requestSha256: D(`interop-request-${id}`),
      responseSha256: D(`interop-response-${id}`),
      assertionSha256: D(`interop-assertion-${id}`),
      startedAt: `2030-01-01T11:${String(index).padStart(2, "0")}:00.000Z`,
      finishedAt: `2030-01-01T11:${String(index).padStart(2, "0")}:01.000Z`,
    })),
  };
  const interopPath = writeJson(
    root,
    "runtime/interop/mcp.json",
    interopTranscript,
  );
  const decisionEvidence = {
    ...subject("uash.decision-evidence.v1"),
    decisions: [
      {
        id: "select-verification-model",
        question: "Which commissioned model satisfies the minimum capability?",
        alternatives: ["provider/model-version", "provider/fallback-model"],
        selected: "provider/model-version",
        rationale: "The quality suite passed within the commissioned budget.",
        authority: "routing-policy",
        evidenceSha256: D("routing-quality-evidence"),
        outcome: "selected",
        decidedAt: "2030-01-01T11:10:00.000Z",
      },
    ],
  };
  const decisionEvidencePath = writeJson(
    root,
    "runtime/decision-evidence.json",
    decisionEvidence,
  );

  const runtime = {
    ...subject("valdris.runtime-session.v1"),
    execution: {
      mode: "orchestrator",
      maxParallelAgents: 2,
      agents: [
        { id: "orchestrator", role: "orchestrator", parentId: null },
        { id: "specialist", role: "specialist", parentId: "orchestrator" },
      ],
      fanIn: [
        {
          childId: "specialist",
          parentId: "orchestrator",
          status: "joined",
          inputSha256: D("specialist-input"),
          outputSha256: D("specialist-output"),
          joinedAt: GENERATED,
        },
      ],
    },
    connectors: (() => {
      const capabilityManifest = { capabilities: ["read", "review"] };
      const conformanceEvidence = {
        passed: true,
        tests: ["auth-boundary", "pagination"],
      };
      return [
        {
          id: "github-connector",
          version: "1.0.0",
          capabilityManifest,
          capabilityManifestSha256: sha256(canonicalJson(capabilityManifest)),
          conformanceEvidence,
          conformanceEvidenceSha256: sha256(canonicalJson(conformanceEvidence)),
        },
      ];
    })(),
    capabilityPolicy: {
      policySha256: D("capability-policy"),
      grants: [
        {
          agentId: "orchestrator",
          resourceType: "capability",
          resource: "read",
        },
        {
          agentId: "orchestrator",
          resourceType: "data",
          resource: "repository",
        },
        {
          agentId: "orchestrator",
          resourceType: "filesystem",
          resource: "source-readonly",
        },
        {
          agentId: "orchestrator",
          resourceType: "capability",
          resource: "execute",
        },
        {
          agentId: "specialist",
          resourceType: "capability",
          resource: "read",
        },
        {
          agentId: "specialist",
          resourceType: "data",
          resource: "repository",
        },
      ],
    },
    toolRegistry: {
      path: "runtime/tool-registry.json",
      sha256: fileSha256(toolRegistryPath),
    },
    toolCallReceipts,
    toolApprovalReceipts: [],
    hookReceipts,
    context: {
      schema: CONTEXT_MANIFEST_V2_SCHEMA,
      path: "context/manifest.json",
      manifestSha256: fileSha256(contextPath),
      tokenBudget: 100,
      tokensLoaded: 20,
    },
    memoryEvents: [
      {
        memoryId: "persisted-memory",
        action: "read",
        scope: "run",
        contentSha256: D("persisted-memory-content"),
        occurredAt: GENERATED,
        owner: "platform-team",
        headReceiptEventId: memoryReadReceipt.eventId,
      },
      {
        memoryId: "run-memory",
        action: "write",
        scope: "run",
        contentSha256: D("memory-content"),
        occurredAt: GENERATED,
        owner: "platform-team",
        expiresAt: "2030-02-01T00:00:00.000Z",
        headReceiptEventId: memoryHeadReceipt.eventId,
      },
    ],
    memoryHeadReceipts: [memoryReadReceipt, memoryHeadReceipt],
    priorMemoryHeadReceipts: [priorMemoryHeadReceipt],
    runtimeDriver: {
      path: "runtime/driver.json",
      sha256: fileSha256(runtimeDriverPath),
    },
    modelRouting: {
      policySha256: D("routing-policy"),
      minimumCapabilitySha256: D("minimum-capability"),
      qualitySuiteSha256: D("routing-quality-suite"),
      fallbackPolicySha256: D("routing-fallback-policy"),
      fallbackReason: "primary-qualified",
      taskClass: "ai-feature",
      selectedModel: "provider/model-version",
      providerSha256: D("provider-identity"),
      lifecycleStage: "verification",
      estimatedCost: 1.25,
      receipt: null,
    },
    aiRuntimeIdentity: clone(semantic.aiWorkloadIdentity),
    costBudget: { currency: "USD", maximum: 2.0, actual: 1.25 },
    economicsLedger: {
      path: "runtime/economics.json",
      sha256: fileSha256(economicsPath),
    },
    acceptanceResults: {
      path: "run/acceptance-results.json",
      sha256: fileSha256(acceptanceResultsPath),
    },
    traceReceipt: null,
    usageReceipt: null,
    executorReceipt: null,
    bridgeHeadReceipt: receipt(
      "valdris.bridge-head-receipt.v1",
      "bridge-head-receipt",
      {
        runId: RUN_ID,
        sequence: 8,
        priorHeadSha256: D("head-7"),
        currentHeadSha256: D("head-8"),
        compareAndSwap: "applied",
        provider: "github",
        providerReceiptSha256: D("github-commit"),
      },
    ),
    interop: [
      {
        protocol: "mcp",
        version: "2029-01",
        capabilities: ["tools"],
        identitySha256: D("mcp-identity"),
        transcript: {
          path: "runtime/interop/mcp.json",
          sha256: fileSha256(interopPath),
        },
      },
    ],
  };
  runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
  runtime.modelRouting.receipt = receipt(
    "valdris.model-routing-receipt.v1",
    "routing-receipt",
    {
      runId: RUN_ID,
      taskClass: "ai-feature",
      selectedModelSha256: D("provider/model-version"),
      policySha256: D("routing-policy"),
      minimumCapabilitySha256: D("minimum-capability"),
      qualitySuiteSha256: D("routing-quality-suite"),
      fallbackPolicySha256: D("routing-fallback-policy"),
      fallbackReason: "primary-qualified",
      providerSha256: D("provider-identity"),
      lifecycleStage: "verification",
      sessionIdentitySha256: runtime.sessionIdentitySha256,
    },
  );
  runtime.traceReceipt = receipt("valdris.trace-receipt.v2", "trace-receipt", {
    runId: RUN_ID,
    traceId: "trace-main",
    tracePath: trajectory.tracePath,
    traceSha256: trajectory.traceDigest,
    actionCount: 2,
    firstEventSha256: traceEvents[0].eventSha256,
    lastEventSha256: traceEvents.at(-1).eventSha256,
    redactionPolicySha256: D("trace-redaction-policy"),
    trajectoryArtifact: {
      path: evaluationEvidence.trajectory.path,
      sha256: evaluationEvidence.trajectory.sha256,
    },
    decisionEvidence: {
      path: "runtime/decision-evidence.json",
      sha256: fileSha256(decisionEvidencePath),
    },
    sessionIdentitySha256: runtime.sessionIdentitySha256,
  });
  runtime.usageReceipt = receipt("valdris.usage-receipt.v1", "usage-receipt", {
    runId: RUN_ID,
    usageSha256: economicsLedger.providerBillingReceiptSha256,
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cost: 1.25,
    currency: "USD",
    latencyMsP50: 400,
    latencyMsP95: 900,
    humanReviewMinutes: 5,
    sessionIdentitySha256: runtime.sessionIdentitySha256,
  });
  runtime.conformanceReceipt = receipt(
    "valdris.runtime-conformance-receipt.v1",
    "runtime-conformance",
    {
      runId: RUN_ID,
      sessionIdentitySha256: runtime.sessionIdentitySha256,
      conformanceSetSha256: runtimeConformanceSetSha256(runtime),
    },
  );

  const changeReview = {
    ...subject("uash.ai-change-review.v1"),
    baseCommit,
    headCommit,
    baseCommitSha256: sha256(baseCommit),
    headCommitSha256: sha256(headCommit),
    diffSha256: sha256(
      git(root, ["diff", "--binary", baseCommit, headCommit, "--"], null),
    ),
    dependencyGraphSha256: D("dependency-graph"),
    testEvidenceSha256: D("tests"),
    reviewEvidenceSha256: D("review"),
    changedPaths: ["src/feature.ts", "package-lock.json"],
    lockfilePaths: ["package-lock.json"],
    coverage: POLICY.reviewCoverage,
    errorPaths: [
      {
        path: "provider timeout",
        testId: "provider-timeout",
        status: "passed",
      },
    ],
    dependencies: [
      {
        locator: "npm:package-lock.json#example",
        name: "example",
        version: "1.2.3",
        metadataSha256: LOCK_METADATA({
          integrity: ["sha512-example"],
          sources: [
            "https://registry.example.invalid/example/-/example-1.2.3.tgz",
          ],
        }),
        change: "added",
      },
    ],
    dependencyProvenance: [
      {
        schema: "valdris.dependency-provenance.v1",
        name: "example",
        version: "1.2.3",
        locator: "npm:package-lock.json#example",
        lockMetadataSha256: LOCK_METADATA({
          integrity: ["sha512-example"],
          sources: [
            "https://registry.example.invalid/example/-/example-1.2.3.tgz",
          ],
        }),
        registry: "https://registry.example.invalid",
        sourceUrl: "https://source.example.invalid/example/1.2.3",
        publisher: "example-publisher",
        license: "MIT",
        packageSha256: D("example-package"),
        integritySha256: D("example-integrity"),
        vulnerabilityReportSha256: D("example-vulnerability-report"),
        providerReceiptSha256: D("example-registry-receipt"),
        confusableNameCheck: "passed",
        allowlisted: true,
        reviewDisposition: "approved",
      },
    ],
    findings: [
      {
        id: "finding-1",
        severity: "medium",
        status: "resolved",
        resolutionEvidenceSha256: D("finding-1-resolution"),
      },
    ],
  };

  const jsonFileSha256 = (document) =>
    sha256(`${JSON.stringify(document, null, 2)}\n`);
  const authoritativeProofInput = {
    routeSha256: readiness.routeSha256,
    workloadClassificationSha256: readiness.workloadClassificationSha256,
    readinessSha256: jsonFileSha256(readiness),
    semanticProofSetSha256: semanticProofSetSha256(semantic),
    changeReviewSha256: jsonFileSha256(changeReview),
    evaluationEvidence,
  };
  const proofInputSetSha256 = sha256(canonicalJson(authoritativeProofInput));
  const acceptedGateManifest = {
    schema: "valdris.accepted-gate-artifact-set.v1",
    gates: [
      {
        gate: "semantic-assurance",
        path: "assurance/semantic.json",
        sha256: jsonFileSha256(semantic),
      },
    ],
  };
  const acceptedGateArtifactsSha256 = sha256(
    canonicalJson(acceptedGateManifest),
  );
  const bridgeProofInputPath = writeJson(
    root,
    "assurance/bridge-proof-input.json",
    {
      schema: "valdris.bridge-proof-input.v1",
      runId: RUN_ID,
      proofInput: authoritativeProofInput,
    },
  );
  const githubOperationId = sha256(
    canonicalJson({
      schema: "valdris.github-head-operation.v1",
      runId: RUN_ID,
      targetSha256: acceptancePolicy.bridgeHead.targetSha256,
      proofInputFileSha256: fileSha256(bridgeProofInputPath),
      currentHeadSha256: proofInputSetSha256,
      expectedSequence: 7,
      expectedHeadSha256: D("head-7"),
      expectedHistorySha256: D("github-prior-history"),
    }),
  );
  const headProviderProof =
    headProvider === "github"
      ? {
          schema: "valdris.github-head-provider-proof.v1",
          hostname: acceptancePolicy.bridgeHead.target.hostname,
          repository: acceptancePolicy.bridgeHead.target.repository,
          branch: acceptancePolicy.bridgeHead.target.branch,
          headPath: acceptancePolicy.bridgeHead.target.headPath,
          historyDirectory: "heads/authoritative.history",
          checkpointPath: "heads/authoritative.checkpoint.json",
          recordPath: "heads/authoritative.history/00000000000000000008.json",
          priorHistorySha256: D("github-prior-history"),
          historySha256: D("github-history"),
          baseCommitSha: D("github-base"),
          proposalBranch: "valdris-head-8-fixture",
          proposalCommitSha: D("github-proposal"),
          pullRequestNumber: 8,
          commissionedCheck: {
            context: githubHeadProtectionPolicy.appendOnlyStatusCheck.context,
            appId: githubHeadProtectionPolicy.appendOnlyStatusCheck.appId,
            checkRunId: 88,
            attestationSha256: D("github-check-attestation"),
            fullReplayPerformed: true,
          },
          contentSha: D("github-content"),
          mergeCommitSha: D("github-merge"),
          commitSha: D("github-merge"),
          operationId: githubOperationId,
          recordSha256: D("github-head-record"),
          recordUpdatedAt: deterministicBridgeTimestamp(githubOperationId),
          resumed: false,
          cleanup: {
            attempts: 1,
            status: "completed",
          },
          protectionObservations: [
            "pre-proposal",
            "pre-merge",
            "post-merge",
          ].map((phase) => ({
            phase,
            evidenceSha256: D("github-branch-protection-evidence"),
            proof: {
              forcePushDisabled: true,
              deletionDisabled: true,
              adminsEnforced: true,
              linearHistoryRequired: true,
              strictStatusChecks: true,
              pullRequestRequired: true,
              bypassAllowancesDisabled: true,
              appendOnlyStatusCheckSha256: sha256(
                canonicalJson(githubHeadProtectionPolicy.appendOnlyStatusCheck),
              ),
              proposalFlowSha256: sha256(
                canonicalJson(githubHeadProtectionPolicy.proposalFlow),
              ),
              writerRestrictionsSha256: sha256(
                canonicalJson(githubHeadProtectionPolicy.writerRestrictions),
              ),
            },
          })),
          receiptRootPathSha256:
            acceptancePolicy.bridgeHead.receiptRootPolicy.pathSha256,
          receiptRootIdentitySha256:
            acceptancePolicy.bridgeHead.receiptRootPolicy.identitySha256,
        }
      : {
          schema: acceptancePolicy.bridgeHead.adapterSchema,
          targetSha256: acceptancePolicy.bridgeHead.targetSha256,
          appendReceiptSha256: D("neutral-ledger-append-receipt"),
        };
  runtime.bridgeHeadReceipt = receipt(
    "valdris.bridge-head-receipt.v1",
    "bridge-head-receipt",
    {
      runId: RUN_ID,
      sequence: 8,
      priorHeadSha256: D("head-7"),
      currentHeadSha256: proofInputSetSha256,
      compareAndSwap: "applied",
      provider: acceptancePolicy.bridgeHead.provider,
      providerIdentitySha256:
        acceptancePolicy.bridgeHead.providerIdentitySha256,
      targetSha256: acceptancePolicy.bridgeHead.targetSha256,
      protectionPolicySha256:
        acceptancePolicy.bridgeHead.protectionPolicySha256,
      operationId:
        headProvider === "github"
          ? headProviderProof.operationId
          : D("neutral-head-operation"),
      expectedHistorySha256:
        headProvider === "github"
          ? headProviderProof.priorHistorySha256
          : D("neutral-prior-history"),
      receiptRootPolicySha256:
        headProvider === "github"
          ? sha256(canonicalJson(acceptancePolicy.bridgeHead.receiptRootPolicy))
          : D("neutral-receipt-root-policy"),
      subjectPath: "assurance/bridge-proof-input.json",
      subjectFileSha256: fileSha256(bridgeProofInputPath),
      subjectSha256: proofInputSetSha256,
      providerProof: headProviderProof,
      providerProofSha256: sha256(canonicalJson(headProviderProof)),
      providerReceiptSha256:
        headProvider === "github"
          ? sha256(
              canonicalJson({
                hostname: headProviderProof.hostname,
                repository: headProviderProof.repository,
                branch: headProviderProof.branch,
                baseCommitSha: headProviderProof.baseCommitSha,
                commissionedCheck: headProviderProof.commissionedCheck,
                contentSha: headProviderProof.contentSha,
                historySha256: headProviderProof.historySha256,
                mergeCommitSha: headProviderProof.mergeCommitSha,
                path: headProviderProof.recordPath,
                priorHistorySha256: headProviderProof.priorHistorySha256,
                proposalBranch: headProviderProof.proposalBranch,
                proposalCommitSha: headProviderProof.proposalCommitSha,
                pullRequestNumber: headProviderProof.pullRequestNumber,
                operationId: headProviderProof.operationId,
                protectionObservations:
                  headProviderProof.protectionObservations,
                cleanup: headProviderProof.cleanup,
                recordSha256: headProviderProof.recordSha256,
                recordUpdatedAt: headProviderProof.recordUpdatedAt,
              }),
            )
          : D("neutral-provider-receipt"),
    },
  );
  const sourceSnapshotManifest = {
    schema: "valdris.git-object-tree-manifest.v1",
    commit: COMMIT,
    tree: "tree",
    objectFormat: "sha1",
    entries: [
      {
        path: "README.md",
        mode: "100644",
        type: "blob",
        objectId: COMMIT,
        size: 8,
        contentSha256: D("README"),
      },
    ],
  };
  const daemonIdentity = {
    schema: "valdris.oci-daemon-identity.v1",
    runtimeKind: acceptancePolicy.proofExecutor.runtimeKind,
    endpoint: acceptancePolicy.proofExecutor.runtimeEndpoint,
    daemonId: "commissioned-daemon",
    daemonVersion: "1.0.0",
    operatingSystem: "linux",
    architecture: "amd64",
  };
  runtime.executorReceipt = receipt(
    "valdris.proof-executor-receipt.v1",
    "executor-receipt",
    {
      runId: RUN_ID,
      sourceCommit: COMMIT,
      sourceTreeSha256: D("tree"),
      workingTreeSha256: D("tree"),
      argvSha256: D("argv"),
      commandIdentitySha256:
        acceptancePolicy.proofExecutor.commandIdentitySha256,
      validatorSha256: acceptancePolicy.proofExecutor.validatorSetSha256,
      inputSetSha256: D("inputs"),
      outputSetSha256: D("outputs"),
      imageSha256: acceptancePolicy.proofExecutor.imageSha256,
      sourceSnapshotSha256: D("source-snapshot"),
      sourceSnapshotManifest,
      sourceSnapshotManifestSha256: sha256(
        canonicalJson(sourceSnapshotManifest),
      ),
      executionImageSha256: D("execution-image"),
      executorId: acceptancePolicy.proofExecutor.executorId,
      sourceSnapshotMode: acceptancePolicy.proofExecutor.sourceSnapshotMode,
      liveWorktreeMount: acceptancePolicy.proofExecutor.liveWorktreeMount,
      exclusiveOutputRoot: acceptancePolicy.proofExecutor.exclusiveOutputRoot,
      outputRootPolicySha256:
        acceptancePolicy.proofExecutor.outputRootPolicySha256,
      outputRootPathSha256: acceptancePolicy.proofExecutor.outputRootPathSha256,
      outputRootIdentitySha256:
        acceptancePolicy.proofExecutor.outputRootIdentitySha256,
      outputDirectoryIdentitySha256: D("exclusive-output-directory-identity"),
      containerIdentity: acceptancePolicy.proofExecutor.containerIdentity,
      runtimeKind: acceptancePolicy.proofExecutor.runtimeKind,
      runtimeEndpoint: acceptancePolicy.proofExecutor.runtimeEndpoint,
      runtimeCliPath: acceptancePolicy.proofExecutor.runtimeCliPath,
      runtimeCliPathSha256: acceptancePolicy.proofExecutor.runtimeCliPathSha256,
      runtimeCliSha256: acceptancePolicy.proofExecutor.runtimeCliSha256,
      gitCliPath: acceptancePolicy.proofExecutor.gitCliPath,
      gitCliPathSha256: acceptancePolicy.proofExecutor.gitCliPathSha256,
      gitCliSha256: acceptancePolicy.proofExecutor.gitCliSha256,
      daemonIdentity,
      daemonIdentitySha256: acceptancePolicy.proofExecutor.daemonIdentitySha256,
      semanticProofSetSha256: semanticProofSetSha256(semantic),
      proofInputSetSha256,
      acceptedGateArtifactsSha256,
      readOnlySource: true,
      isolatedOutput: true,
      inheritAmbientSecrets: false,
      networkPolicy: "none",
      limits: {
        cpu: 2,
        memory: 1073741824,
        outputBytes: 10485760,
        wallClockMs: 120000,
      },
      startedAt: "2030-01-01T11:58:00.000Z",
      finishedAt: "2030-01-01T11:59:00.000Z",
      exitCode: 0,
      mutationResult: "source-frozen-immutable-image",
    },
  );
  adapters[0].executionReceipt = receipt(
    "valdris.semantic-execution-receipt.v1",
    "semantic-grounding-execution",
    {
      runId: RUN_ID,
      controlId: adapters[0].controlId,
      commandId: adapters[0].commandId,
      inputSha256: adapters[0].inputSha256,
      resultSha256: adapters[0].resultSha256,
      validatorSha256: adapters[0].validatorSha256,
      supportedTier: adapters[0].supportedTier,
      assertionsSha256: sha256(canonicalJson(adapters[0].assertions)),
      executorEventId: runtime.executorReceipt.eventId,
      executorReceiptPayloadSha256:
        runtime.executorReceipt.attestation.payloadSha256,
      environment: ENVIRONMENT,
      startedAt: "2030-01-01T11:50:00.000Z",
      finishedAt: "2030-01-01T11:51:00.000Z",
      exitCode: 0,
    },
  );
  semantic.adapterSetSha256 = sha256(canonicalJson(adapters));
  acceptancePolicy.adapterSetSha256 = semantic.adapterSetSha256;
  semantic.approvalReceipts = [
    receipt("uash.approval-receipt.v1", "approval-augmentation", {
      runId: RUN_ID,
      scope: "assurance-augmentation",
      artifactSha256: sha256(canonicalJson(augmentation)),
      providerReceipt: {
        id: "approval-provider-1",
        sha256: D("approval-provider-1"),
      },
    }),
    receipt("uash.approval-receipt.v1", "approval-policy", {
      runId: RUN_ID,
      scope: "acceptance-policy",
      artifactSha256: sha256(canonicalJson(acceptancePolicy)),
      providerReceipt: {
        id: "approval-provider-2",
        sha256: D("approval-provider-2"),
      },
    }),
  ];

  const learning = learningRoute
    ? receipt("uash.harness-learning.v1", "learning-positive", {
        ...subject("uash.harness-learning.v1"),
        failureSha256: D("learning-failure"),
        rcaSha256: D("learning-rca"),
        causeClusterSha256: D("learning-cause-cluster"),
        regressionCaseSha256: D("learning-regression"),
        changeSha256: D("learning-change"),
        reviewSha256: D("learning-review"),
        rollbackSha256: D("learning-rollback"),
        changeKind: "harness-rule",
        expiresAt: "2099-01-01T00:00:00.000Z",
        rollbackCondition: "commissioned regression",
        autoApplied: false,
      })
    : null;
  const documents = {
    readiness,
    semantic,
    runtime,
    changeReview,
    ...(learning ? { learning } : {}),
  };
  for (const [key, document] of Object.entries(documents))
    writeJson(root, V09_CANONICAL_ARTIFACTS[key], document);
  const closure = {
    ...subject("valdris.authoritative-closure.v1"),
    assuranceLevel: "authoritative",
    acceptedGateArtifactsSha256,
    routeSha256: readiness.routeSha256,
    workloadClassificationSha256: readiness.workloadClassificationSha256,
    applicability: {
      routeSha256: readiness.routeSha256,
      workloadClassificationSha256: readiness.workloadClassificationSha256,
      sourceStage: "production",
      targetStage: "production",
      targetEnvironment: ENVIRONMENT,
      changeKinds: learningRoute ? ["harness-rule"] : ["application-code"],
      failureDisposition: "none",
    },
    evaluationEvidence,
    artifacts: Object.fromEntries(
      Object.entries(documents).map(([key]) => [
        key,
        {
          path: V09_CANONICAL_ARTIFACTS[key],
          sha256: fileSha256(
            path.join(root, ...V09_CANONICAL_ARTIFACTS[key].split("/")),
          ),
        },
      ]),
    ),
    catalogSnapshots: [
      {
        path: "controls/authoritative-assurance.v1.json",
        sha256: sha256(canonicalJson(POLICY)),
        document: POLICY,
      },
    ],
  };
  return {
    trustStore,
    trustPin,
    privateKey,
    documents,
    closure,
    receipt,
    acceptedGateManifest,
    authoritativeProofInput,
  };
}

function expectValid(label, result) {
  if (!result.valid)
    throw new Error(
      `${label} unexpectedly failed: ${result.problems.join("; ")}`,
    );
}

function expectInvalid(rejected, label, result, expected) {
  if (result.valid) throw new Error(`${label} unexpectedly passed`);
  if (
    expected &&
    !result.problems.some((problem) => problem.includes(expected))
  )
    throw new Error(
      `${label} failed for the wrong reason: ${result.problems.join("; ")}`,
    );
  rejected.push(label);
}

function expectProcessRejected(rejected, label, result, expected) {
  if (result.status === 0) throw new Error(`${label} unexpectedly passed`);
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (expected && !output.includes(expected))
    throw new Error(`${label} failed for the wrong reason: ${output}`);
  rejected.push(label);
}

async function main() {
  const root = canonicalTempDirectory("valdris-v09-");
  const rejected = [];
  let executorRuntimeVerification = {
    status: "not-run",
    reason: "executor runtime verifier did not complete",
  };
  try {
    const fixture = buildFixture(root);
    const options = {
      repoRoot: root,
      policy: POLICY,
      level: "authoritative",
      now: NOW,
      trustStore: fixture.trustStore,
      requiredTrustSha256: fixture.trustPin,
      acceptancePolicy: fixture.documents.semantic.acceptancePolicy,
    };
    expectValid(
      "authoritative baseline",
      validateAuthoritativeClosureDocument(fixture.closure, root, options),
    );
    expectValid(
      "semantic baseline",
      validateSemanticAssuranceDocument(fixture.documents.semantic, options),
    );
    expectValid(
      "runtime baseline",
      validateRuntimeSessionDocument(fixture.documents.runtime, options),
    );
    expectValid(
      "readiness baseline",
      validateImplementationReadinessDocument(fixture.documents.readiness, {
        ...options,
        effectiveAiTier: "AI2",
      }),
    );
    expectValid(
      "change-review baseline",
      validateChangeReviewDocument(fixture.documents.changeReview, {
        policy: POLICY,
        repoRoot: root,
      }),
    );
    const githubTokenKey = ["GH", "TOKEN"].join("_");
    const excludedEnvironmentKeys = [
      ["AWS", "SECRET", "ACCESS", "KEY"].join("_"),
      ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"),
      ["VALDRIS", "HEAD", "PRIVATE", "KEY", "FILE"].join("_"),
      ["UASH", "AUTHORITY", "TRUST", "SHA256"].join("_"),
      ["GH", "HOST"].join("_"),
    ];
    const candidateGithubEnvironment = {
      PATH: "example-path",
      SystemRoot: "example-system-root",
      [githubTokenKey]: "synthetic-github-value",
    };
    for (const key of excludedEnvironmentKeys)
      candidateGithubEnvironment[key] = "synthetic-excluded-value";
    const githubEnvironment = githubCliEnvironment(candidateGithubEnvironment);
    if (
      githubEnvironment[githubTokenKey] !== "synthetic-github-value" ||
      Object.keys(githubEnvironment).some((name) =>
        excludedEnvironmentKeys.includes(name),
      )
    )
      throw new Error("GitHub CLI environment leaked a non-GitHub secret");
    const commissionedGithubProtection =
      fixture.documents.semantic.acceptancePolicy.bridgeHead.protectionPolicy;
    const githubProtectionResponse = {
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      enforce_admins: { enabled: true },
      required_linear_history: { enabled: true },
      required_status_checks: {
        strict: true,
        contexts: [],
        checks: [
          {
            context: commissionedGithubProtection.appendOnlyStatusCheck.context,
            app_id: commissionedGithubProtection.appendOnlyStatusCheck.appId,
          },
        ],
      },
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        bypass_pull_request_allowances: {
          apps: [],
          teams: [],
          users: [],
        },
      },
      restrictions: {
        apps: [{ id: 31337, slug: "valdris-head-writer" }],
        teams: [],
        users: [],
      },
    };
    const githubProtectionProof = validateGithubProtectionPolicy(
      commissionedGithubProtection,
      githubProtectionResponse,
    );
    if (
      githubProtectionProof.adminsEnforced !== true ||
      githubProtectionProof.linearHistoryRequired !== true ||
      !SHA256.test(githubProtectionProof.writerRestrictionsSha256)
    )
      throw new Error(
        "GitHub protection proof did not bind the commissioned controls",
      );
    const githubHeadOne = D("github-head-one");
    const githubHeadTwo = D("github-head-two");
    const emptyGithubHistorySha256 = sha256(canonicalJson([]));
    const githubHistory = [
      {
        schema: "valdris.bridge-head.v1",
        sequence: 1,
        priorHeadSha256: "0".repeat(64),
        priorHistorySha256: emptyGithubHistorySha256,
        currentHeadSha256: githubHeadOne,
        operationId: D("github-history-operation-one"),
        protectionEvidenceSha256: D("github-history-protection"),
        runId: "github-history-one",
        updatedAt: GENERATED,
      },
      {
        schema: "valdris.bridge-head.v1",
        sequence: 2,
        priorHeadSha256: githubHeadOne,
        priorHistorySha256: "",
        currentHeadSha256: githubHeadTwo,
        operationId: D("github-history-operation-two"),
        protectionEvidenceSha256: D("github-history-protection"),
        runId: "github-history-two",
        updatedAt: GENERATED,
      },
    ];
    const githubHistoryDigest = (priorHistorySha256, record) =>
      sha256(
        canonicalJson({
          priorHistorySha256,
          recordSha256: sha256(canonicalJson(record)),
          sequence: record.sequence,
        }),
      );
    githubHistory[1].priorHistorySha256 = githubHistoryDigest(
      emptyGithubHistorySha256,
      githubHistory[0],
    );
    const githubHighWaterSha256 = githubHistoryDigest(
      githubHistory[1].priorHistorySha256,
      githubHistory[1],
    );
    const githubHighWater = validateGithubAppendOnlyHistory(
      githubHistory,
      2,
      githubHeadTwo,
      githubHighWaterSha256,
    );
    if (
      githubHighWater.sequence !== 2 ||
      githubHighWater.currentHeadSha256 !== githubHeadTwo ||
      !SHA256.test(githubHighWater.historySha256)
    )
      throw new Error("GitHub append-only high-water proof is invalid");
    const githubReceiptRoot = path.join(root, "github-receipts");
    mkdirSync(githubReceiptRoot);
    secureVerifierOperatorRoot(githubReceiptRoot);
    const githubReceiptRootDescriptor = inspectOperatorRoot(githubReceiptRoot);
    const githubReceiptRootPolicy = {
      pathSha256: githubReceiptRootDescriptor.pathSha256,
      identitySha256: githubReceiptRootDescriptor.identitySha256,
    };
    const githubReceiptReservation = reserveGithubReceipt(
      githubReceiptRoot,
      "github-head-provider-receipt.json",
      D("github-receipt-operation"),
      githubReceiptRootPolicy,
    );
    const githubReceiptContents = `${JSON.stringify({
      schema: "valdris.bridge-head-receipt.v1",
      operationId: D("github-receipt-operation"),
      providerProof: {
        operationId: D("github-receipt-operation"),
      },
      ok: true,
    })}\n`;
    const githubReceiptPath = commitGithubReceiptReservation(
      githubReceiptReservation,
      githubReceiptContents,
    );
    if (!existsSync(githubReceiptPath))
      throw new Error("GitHub receipt was not committed to its reserved root");
    const durableReservationDocument = JSON.parse(
      readFileSync(githubReceiptReservation.reservationPath, "utf8"),
    );
    const durableJournalDocument = JSON.parse(
      readFileSync(githubReceiptReservation.journalPath, "utf8"),
    );
    if (
      githubReceiptPath === githubReceiptReservation.reservationPath ||
      durableReservationDocument.schema !==
        "valdris.github-receipt-reservation.v2" ||
      durableReservationDocument.status !== "reserved" ||
      durableJournalDocument.schema !== "valdris.github-receipt-journal.v1" ||
      durableJournalDocument.contentsSha256 !== sha256(githubReceiptContents)
    )
      throw new Error(
        "GitHub final receipt truncated or replaced its durable reservation journal",
      );
    const idempotentGithubReceipt = reserveGithubReceipt(
      githubReceiptRoot,
      "github-head-provider-receipt.json",
      D("github-receipt-operation"),
      githubReceiptRootPolicy,
    );
    const idempotentGithubReceiptPath = commitGithubReceiptReservation(
      idempotentGithubReceipt,
      githubReceiptContents,
    );
    if (
      idempotentGithubReceiptPath !== githubReceiptPath ||
      readFileSync(githubReceiptPath, "utf8") !== githubReceiptContents
    )
      throw new Error(
        "GitHub existing final receipt was not recovered idempotently",
      );
    const unjournaledOperationId = D("github-unjournaled-final-operation");
    const unjournaledReceiptName = "github-unjournaled-final.json";
    const unjournaledReceiptPath = path.join(
      githubReceiptRoot,
      unjournaledReceiptName,
    );
    writeFileSync(
      unjournaledReceiptPath,
      `${JSON.stringify({
        schema: "valdris.bridge-head-receipt.v1",
        operationId: unjournaledOperationId,
        providerProof: { operationId: unjournaledOperationId },
        forged: true,
      })}\n`,
    );
    const unjournaledReservation = reserveGithubReceipt(
      githubReceiptRoot,
      unjournaledReceiptName,
      unjournaledOperationId,
      githubReceiptRootPolicy,
    );
    let unjournaledFailure;
    try {
      commitGithubReceiptReservation(
        unjournaledReservation,
        `${JSON.stringify({
          schema: "valdris.bridge-head-receipt.v1",
          operationId: unjournaledOperationId,
          providerProof: { operationId: unjournaledOperationId },
          forged: false,
        })}\n`,
      );
    } catch (error) {
      unjournaledFailure = error;
    }
    if (!unjournaledFailure)
      throw new Error(
        "GitHub unjournaled pre-existing final receipt was trusted",
      );
    abortGithubReceiptReservation(unjournaledReservation, { preserve: true });
    rmSync(unjournaledReceiptPath, { force: true });
    rmSync(unjournaledReservation.reservationPath, { force: true });
    rmSync(unjournaledReservation.journalPath, { force: true });
    const receiptCrashPhases = [
      "after-temp-create",
      "after-temp-partial-write",
      "after-temp-fsync",
      "after-publish",
      "after-target-fsync",
    ];
    for (const [index, faultPhase] of receiptCrashPhases.entries()) {
      const operationId = D(`github-receipt-crash-${faultPhase}`);
      const receiptName = `github-crash-${index}.json`;
      const contents = `${JSON.stringify({
        schema: "valdris.bridge-head-receipt.v1",
        operationId,
        providerProof: { operationId },
        phase: faultPhase,
      })}\n`;
      const reservation = reserveGithubReceipt(
        githubReceiptRoot,
        receiptName,
        operationId,
        githubReceiptRootPolicy,
      );
      let injectedFailure;
      try {
        commitGithubReceiptReservation(reservation, contents, {
          fault(phase) {
            if (phase !== faultPhase) return;
            const error = new Error(`synthetic ${faultPhase} failure`);
            if (
              phase === "after-temp-partial-write" ||
              phase === "after-temp-fsync"
            )
              error.code = "ENOSPC";
            throw error;
          },
        });
      } catch (error) {
        injectedFailure = error;
      }
      if (!injectedFailure)
        throw new Error(`GitHub receipt ${faultPhase} fault was not injected`);
      const publishedBeforeRetry = existsSync(
        path.join(githubReceiptRoot, receiptName),
      );
      if (
        publishedBeforeRetry !==
        ["after-publish", "after-target-fsync"].includes(faultPhase)
      )
        throw new Error(
          `GitHub receipt ${faultPhase} exposed the wrong publication state`,
        );
      abortGithubReceiptReservation(reservation, { preserve: true });
      if (faultPhase === "after-temp-create")
        writeFileSync(reservation.tempPath, "{malformed-stale-temp");
      const retryReservation = reserveGithubReceipt(
        githubReceiptRoot,
        receiptName,
        operationId,
        githubReceiptRootPolicy,
      );
      const recoveredPath = commitGithubReceiptReservation(
        retryReservation,
        contents,
      );
      if (
        readFileSync(recoveredPath, "utf8") !== contents ||
        existsSync(retryReservation.tempPath)
      )
        throw new Error(
          `GitHub receipt ${faultPhase} did not recover exact final bytes`,
        );
      if (
        faultPhase === "after-temp-create" &&
        !readdirSync(githubReceiptRoot).some((entry) =>
          entry.includes(".quarantine-"),
        )
      )
        throw new Error(
          "GitHub malformed stale receipt temp was not quarantined",
        );
    }
    const githubAttempt = (attempt) => {
      try {
        attempt();
        return { valid: true, problems: [] };
      } catch (error) {
        return { valid: false, problems: [error.message] };
      }
    };
    const githubProposalNext = {
      schema: "valdris.bridge-head.v1",
      sequence: 1,
      priorHeadSha256: "0".repeat(64),
      currentHeadSha256: D("github-proposal-head"),
      operationId: D("github-proposal-operation"),
      runId: "github-proposal-run",
      updatedAt: deterministicBridgeTimestamp(D("github-proposal-operation")),
    };
    const createGithubProposalMock = (fault = "none") => {
      const repository = "example/valdris";
      const branch = "valdris-heads";
      const hostname = "github.example.invalid";
      const checkpointPath = "heads/authoritative.checkpoint.json";
      const recordPath =
        "heads/authoritative.history/00000000000000000001.json";
      const state = {
        baseCommitSha: D("github-proposal-base"),
        calls: [],
        checkpoint: null,
        checkpointContentSha: D("github-checkpoint-content"),
        clock: 0,
        contentSha: D("github-proposal-content"),
        fault,
        mergeCommitSha: D("github-proposal-merge"),
        merged: false,
        proposalCommitSha: D("github-proposal-commit"),
        protectionReads: 0,
        record: null,
        refReads: 0,
      };
      const jsonContent = (document, contentSha) =>
        JSON.stringify({
          content: Buffer.from(
            `${JSON.stringify(document, null, 2)}\n`,
          ).toString("base64"),
          sha: contentSha,
        });
      const decodeFormDocument = (args) => {
        const encoded = args
          .find((entry) => String(entry).startsWith("content="))
          ?.slice("content=".length);
        return JSON.parse(
          Buffer.from(encoded || "", "base64").toString("utf8"),
        );
      };
      const protectionResponse = () => {
        state.protectionReads += 1;
        const response = clone(githubProtectionResponse);
        if (
          (state.fault === "pre-merge-protection-drift" &&
            state.protectionReads === 2) ||
          (state.fault === "post-merge-protection-drift" &&
            state.protectionReads === 3)
        )
          response.enforce_admins.enabled = false;
        return JSON.stringify(response);
      };
      const checkAttestation = () => ({
        schema: "valdris.github-head-check-attestation.v1",
        operationId: state.record.operationId,
        sequence: state.record.sequence,
        currentHeadSha256: state.record.currentHeadSha256,
        historySha256: state.checkpoint.historySha256,
        protectionEvidenceSha256: state.record.protectionEvidenceSha256,
        fullReplay: {
          performed: state.fault !== "missing-full-replay",
          throughSequence: state.record.sequence,
          historySha256:
            state.fault === "mismatched-full-replay"
              ? D("mismatched-replay")
              : state.checkpoint.historySha256,
        },
      });
      state.api = (args, apiOptions = {}) => {
        state.calls.push({ args: [...args], options: { ...apiOptions } });
        if (
          args[0] !== "api" ||
          args[1] !== "--hostname" ||
          args[2] !== hostname
        )
          throw new Error("GitHub API call omitted the canonical hostname");
        if (
          !Number.isSafeInteger(apiOptions.timeoutMs) ||
          apiOptions.timeoutMs < 1
        )
          throw new Error("GitHub API call omitted its remaining deadline");
        const methodIndex = args.indexOf("--method");
        const method =
          methodIndex === -1 ? "GET" : String(args[methodIndex + 1]);
        const endpoint = args.find((entry) =>
          String(entry).startsWith(`repos/${repository}/`),
        );
        if (
          method === "GET" &&
          endpoint === `repos/${repository}/branches/${branch}/protection`
        )
          return protectionResponse();
        if (
          method === "GET" &&
          endpoint === `repos/${repository}/git/ref/heads/${branch}`
        ) {
          state.refReads += 1;
          if (state.refReads === 2 && state.fault === "competing-sequence")
            return JSON.stringify({
              object: { sha: D("github-competing-commit") },
            });
          if (
            state.merged &&
            state.fault === "post-merge-crash" &&
            !state.postMergeCrashObserved
          ) {
            state.postMergeCrashObserved = true;
            throw new Error("synthetic crash after committed merge");
          }
          if (state.merged && state.fault === "post-merge-ref-substitution")
            return JSON.stringify({
              object: { sha: D("github-substituted-merge") },
            });
          return JSON.stringify({
            object: {
              sha: state.merged ? state.mergeCommitSha : state.baseCommitSha,
            },
          });
        }
        if (
          method === "GET" &&
          endpoint?.startsWith(
            `repos/${repository}/contents/${checkpointPath}?ref=`,
          )
        ) {
          if (!state.merged) {
            if (!apiOptions.tolerate404)
              throw new Error("empty checkpoint must tolerate 404");
            return null;
          }
          return jsonContent(state.checkpoint, state.checkpointContentSha);
        }
        if (
          method === "GET" &&
          endpoint?.startsWith(
            `repos/${repository}/contents/${recordPath}?ref=`,
          )
        ) {
          const contentSha =
            state.fault === "post-merge-content-substitution"
              ? D("github-substituted-content")
              : state.contentSha;
          return jsonContent(state.record, contentSha);
        }
        if (method === "POST" && endpoint === `repos/${repository}/git/refs`)
          return JSON.stringify({ ref: `refs/heads/${branch}` });
        if (
          method === "PUT" &&
          endpoint === `repos/${repository}/contents/${recordPath}`
        ) {
          if (
            args.includes(`branch=${branch}`) ||
            !args.some((entry) =>
              String(entry).startsWith("branch=valdris-head-1-"),
            )
          )
            throw new Error(
              "proposal record attempted a direct protected-branch PUT",
            );
          state.record = decodeFormDocument(args);
          return JSON.stringify({
            content: { sha: state.contentSha },
            commit: { sha: D("github-record-commit") },
          });
        }
        if (
          method === "PUT" &&
          endpoint === `repos/${repository}/contents/${checkpointPath}`
        ) {
          state.checkpoint = decodeFormDocument(args);
          return JSON.stringify({
            content: { sha: state.checkpointContentSha },
            commit: { sha: state.proposalCommitSha },
          });
        }
        if (method === "POST" && endpoint === `repos/${repository}/pulls`)
          return JSON.stringify({
            number: 7,
            head: { sha: state.proposalCommitSha },
            base: { sha: state.baseCommitSha },
          });
        if (method === "GET" && endpoint === `repos/${repository}/pulls/7`)
          return JSON.stringify({
            head: { sha: state.proposalCommitSha },
            base: { ref: branch, sha: state.baseCommitSha },
            state: "open",
            draft: false,
            mergeable: true,
          });
        if (
          method === "GET" &&
          endpoint ===
            `repos/${repository}/commits/${state.mergeCommitSha}/pulls`
        )
          return JSON.stringify([
            {
              number: 7,
              head: {
                ref: `valdris-head-1-${githubProposalNext.operationId.slice(
                  0,
                  16,
                )}`,
                sha: state.proposalCommitSha,
              },
              base: { ref: branch, sha: state.baseCommitSha },
              merge_commit_sha: state.mergeCommitSha,
              merged_at: GENERATED,
            },
          ]);
        if (
          method === "GET" &&
          endpoint ===
            `repos/${repository}/commits/${state.proposalCommitSha}/check-runs`
        ) {
          if (state.fault === "late-success") state.clock = 31_000;
          const wrongApp = state.fault === "missing-commissioned-check";
          const pending = state.fault === "pending-commissioned-check";
          const failed = state.fault === "failed-commissioned-check";
          return JSON.stringify({
            check_runs: [
              {
                id: 90,
                name: commissionedGithubProtection.appendOnlyStatusCheck
                  .context,
                app: {
                  id: wrongApp
                    ? commissionedGithubProtection.appendOnlyStatusCheck.appId +
                      1
                    : commissionedGithubProtection.appendOnlyStatusCheck.appId,
                },
                status: pending ? "in_progress" : "completed",
                conclusion: failed ? "failure" : pending ? null : "success",
                output: {
                  summary: JSON.stringify(checkAttestation()),
                },
              },
            ],
          });
        }
        if (
          method === "PUT" &&
          endpoint === `repos/${repository}/pulls/7/merge`
        ) {
          if (
            !args.includes(`sha=${state.proposalCommitSha}`) ||
            !args.includes("merge_method=rebase")
          )
            throw new Error(
              "protected merge omitted the proposal SHA or rebase policy",
            );
          if (state.fault === "competing-merge")
            return JSON.stringify({ merged: false, sha: null });
          state.merged = true;
          return JSON.stringify({
            merged: true,
            sha: state.mergeCommitSha,
          });
        }
        if (
          method === "DELETE" &&
          endpoint?.startsWith(
            `repos/${repository}/git/refs/heads/valdris-head-1-`,
          )
        ) {
          if (state.fault === "cleanup-failure")
            throw new Error("synthetic proposal cleanup failure");
          return "{}";
        }
        throw new Error(
          `unexpected mocked GitHub call: ${method} ${endpoint || args.join(" ")}`,
        );
      };
      return state;
    };
    const runGithubProposal = (fault = "none", existingState = null) => {
      const state = existingState || createGithubProposalMock(fault);
      state.fault = fault;
      let result;
      let failure;
      const deadline = createGithubOperationDeadline(
        commissionedGithubProtection.proposalFlow.operationDeadlineMs,
        0,
        () => state.clock,
      );
      try {
        result = executeGithubProtectedProposal({
          api: state.api,
          hostname: "github.example.invalid",
          repository: "example/valdris",
          branch: "valdris-heads",
          headPath: "heads/authoritative.json",
          runId: githubProposalNext.runId,
          next: githubProposalNext,
          expectedSequence: 0,
          expectedHead: "0".repeat(64),
          expectedHistorySha256: emptyGithubHistorySha256,
          statusCheck: commissionedGithubProtection.appendOnlyStatusCheck,
          protectionPolicy: commissionedGithubProtection,
          proposalPolicy: commissionedGithubProtection.proposalFlow,
          deadline,
          wait: (milliseconds) => {
            state.clock += milliseconds;
            if (fault === "pending-commissioned-check") state.clock = 31_000;
          },
        });
      } catch (error) {
        failure = error;
      }
      if (
        state.calls.some(
          ({ args }) =>
            args.includes("--method") &&
            args[args.indexOf("--method") + 1] === "PUT" &&
            args.some((entry) => String(entry).includes("/contents/heads/")) &&
            args.includes("branch=valdris-heads"),
        )
      )
        throw new Error("GitHub adapter issued a direct protected-branch PUT");
      if (failure) throw failure;
      return { result, state };
    };
    const githubProposal = runGithubProposal();
    if (
      githubProposal.result.pullRequestNumber !== 7 ||
      githubProposal.result.proposalCommitSha !==
        githubProposal.state.proposalCommitSha ||
      githubProposal.result.mergeCommitSha !==
        githubProposal.state.mergeCommitSha ||
      githubProposal.result.contentSha !== githubProposal.state.contentSha ||
      githubProposal.result.cleanup.status !== "completed"
    )
      throw new Error(
        "GitHub protected proposal proof did not bind all provider identities",
      );
    if (
      githubProposal.state.calls.some(
        ({ args }) =>
          args[0] !== "api" ||
          args[1] !== "--hostname" ||
          args[2] !== "github.example.invalid",
      )
    )
      throw new Error("GitHub API call escaped the commissioned hostname");
    const githubHistoryReads = githubProposal.state.calls.filter(
      ({ args }) =>
        args.some((entry) =>
          String(entry).includes("/contents/heads/authoritative"),
        ) && !args.includes("--method"),
    ).length;
    if (githubHistoryReads > 3)
      throw new Error(
        "GitHub cumulative history verification exceeded constant-call bounds",
      );
    expectInvalid(
      rejected,
      "GitHub append-only history truncation",
      githubAttempt(() =>
        validateGithubAppendOnlyHistory(
          githubHistory.slice(0, 1),
          2,
          githubHeadTwo,
          githubHighWaterSha256,
        ),
      ),
      "high-water sequence",
    );
    const rolledBackGithubHistory = clone(githubHistory);
    rolledBackGithubHistory[1].priorHeadSha256 = "0".repeat(64);
    expectInvalid(
      rejected,
      "GitHub append-only history chain rollback",
      githubAttempt(() =>
        validateGithubAppendOnlyHistory(
          rolledBackGithubHistory,
          2,
          githubHeadTwo,
          githubHighWaterSha256,
        ),
      ),
      "rolled back",
    );
    const unprotectedGithubResponse = clone(githubProtectionResponse);
    unprotectedGithubResponse.enforce_admins.enabled = false;
    expectInvalid(
      rejected,
      "GitHub bridge admin bypass",
      githubAttempt(() =>
        validateGithubProtectionPolicy(
          commissionedGithubProtection,
          unprotectedGithubResponse,
        ),
      ),
      "admin protection",
    );
    const overbroadGithubWriters = clone(githubProtectionResponse);
    overbroadGithubWriters.restrictions.users.push({ login: "admin-user" });
    expectInvalid(
      rejected,
      "GitHub bridge overbroad writer restrictions",
      githubAttempt(() =>
        validateGithubProtectionPolicy(
          commissionedGithubProtection,
          overbroadGithubWriters,
        ),
      ),
      "writer restrictions",
    );
    const substitutedGithubStatusApp = clone(githubProtectionResponse);
    substitutedGithubStatusApp.required_status_checks.checks[0].app_id += 1;
    expectInvalid(
      rejected,
      "GitHub append-only status-app substitution",
      githubAttempt(() =>
        validateGithubProtectionPolicy(
          commissionedGithubProtection,
          substitutedGithubStatusApp,
        ),
      ),
      "append-only status check",
    );
    const selfApprovingGithubPolicy = clone(commissionedGithubProtection);
    selfApprovingGithubPolicy.appendOnlyStatusCheck.appId =
      selfApprovingGithubPolicy.writerRestrictions.apps[0].id;
    const selfApprovingGithubResponse = clone(githubProtectionResponse);
    selfApprovingGithubResponse.required_status_checks.checks[0].app_id =
      selfApprovingGithubPolicy.appendOnlyStatusCheck.appId;
    expectInvalid(
      rejected,
      "GitHub writer self-approves append-only rollback",
      githubAttempt(() =>
        validateGithubProtectionPolicy(
          selfApprovingGithubPolicy,
          selfApprovingGithubResponse,
        ),
      ),
      "separation of duties",
    );
    const invalidGithubProposalPolicy = clone(commissionedGithubProtection);
    invalidGithubProposalPolicy.proposalFlow.mergeMethod = "squash";
    expectInvalid(
      rejected,
      "GitHub uncommissioned proposal merge method",
      githubAttempt(() =>
        validateGithubProtectionPolicy(
          invalidGithubProposalPolicy,
          githubProtectionResponse,
        ),
      ),
      "bounded rebase merge",
    );
    expectInvalid(
      rejected,
      "GitHub commissioned check remains pending",
      githubAttempt(() => runGithubProposal("pending-commissioned-check")),
      "total operation deadline exceeded",
    );
    expectInvalid(
      rejected,
      "GitHub commissioned check fails",
      githubAttempt(() => runGithubProposal("failed-commissioned-check")),
      "rejected the proposal",
    );
    expectInvalid(
      rejected,
      "GitHub merge without commissioned check",
      githubAttempt(() => runGithubProposal("missing-commissioned-check")),
      "total operation deadline exceeded",
    );
    expectInvalid(
      rejected,
      "GitHub late check success",
      githubAttempt(() => runGithubProposal("late-success")),
      "total operation deadline exceeded",
    );
    expectInvalid(
      rejected,
      "GitHub required full replay omitted",
      githubAttempt(() => runGithubProposal("missing-full-replay")),
      "check attestation is incomplete or mismatched",
    );
    expectInvalid(
      rejected,
      "GitHub full replay digest mismatch",
      githubAttempt(() => runGithubProposal("mismatched-full-replay")),
      "check attestation is incomplete or mismatched",
    );
    expectInvalid(
      rejected,
      "GitHub competing append-only sequence",
      githubAttempt(() => runGithubProposal("competing-sequence")),
      "advanced during proposal",
    );
    expectInvalid(
      rejected,
      "GitHub competing protected merge",
      githubAttempt(() => runGithubProposal("competing-merge")),
      "protected merge was rejected",
    );
    expectInvalid(
      rejected,
      "GitHub post-merge branch substitution",
      githubAttempt(() => runGithubProposal("post-merge-ref-substitution")),
      "changed before post-merge verification",
    );
    expectInvalid(
      rejected,
      "GitHub post-merge content substitution",
      githubAttempt(() => runGithubProposal("post-merge-content-substitution")),
      "immutable history tail does not match",
    );
    expectInvalid(
      rejected,
      "GitHub pre-merge protection drift",
      githubAttempt(() => runGithubProposal("pre-merge-protection-drift")),
      "does not enforce",
    );
    expectInvalid(
      rejected,
      "GitHub post-merge protection drift",
      githubAttempt(() => runGithubProposal("post-merge-protection-drift")),
      "does not enforce",
    );
    const crashState = createGithubProposalMock("post-merge-crash");
    expectInvalid(
      rejected,
      "GitHub merge-then-crash",
      githubAttempt(() => runGithubProposal("post-merge-crash", crashState)),
      "synthetic crash after committed merge",
    );
    crashState.clock = 0;
    const resumedGithubProposal = runGithubProposal("none", crashState);
    if (
      resumedGithubProposal.result.resumed !== true ||
      resumedGithubProposal.result.mergeCommitSha !==
        crashState.mergeCommitSha ||
      resumedGithubProposal.result.cleanup.status !== "completed"
    )
      throw new Error(
        "GitHub merge-then-crash operation did not reconcile its exact durable tail",
      );
    const cleanupState = createGithubProposalMock("cleanup-failure");
    const cleanupPending = runGithubProposal("cleanup-failure", cleanupState);
    if (
      cleanupPending.result.cleanup.status !== "pending" ||
      !SHA256.test(cleanupPending.result.cleanup.problemSha256 || "")
    )
      throw new Error(
        "GitHub committed cleanup failure was not recorded for retry",
      );
    cleanupState.clock = 0;
    const cleanupRetried = runGithubProposal("none", cleanupState);
    if (
      cleanupRetried.result.resumed !== true ||
      cleanupRetried.result.cleanup.status !== "completed"
    )
      throw new Error("GitHub committed cleanup was not retried on resume");
    expectInvalid(
      rejected,
      "GitHub receipt path traversal",
      githubAttempt(() =>
        reserveGithubReceipt(
          githubReceiptRoot,
          "../escaped-github-receipt.json",
          D("github-traversal-operation"),
          githubReceiptRootPolicy,
        ),
      ),
      "direct-child",
    );
    expectInvalid(
      rejected,
      "GitHub receipt root overlaps repository",
      githubAttempt(() =>
        assertGithubReceiptRootSeparated(githubReceiptRoot, root),
      ),
      "must not contain the repository",
    );
    expectInvalid(
      rejected,
      "GitHub receipt exclusive overwrite",
      githubAttempt(() =>
        reserveGithubReceipt(
          githubReceiptRoot,
          "github-head-provider-receipt.json",
          D("github-forged-operation"),
          githubReceiptRootPolicy,
        ),
      ),
      "different operation",
    );
    const githubReceiptOutside = path.join(
      path.dirname(root),
      `${path.basename(root)}-github-receipt-outside`,
    );
    const githubReceiptLink = path.join(root, "github-receipt-link");
    mkdirSync(githubReceiptOutside);
    secureVerifierOperatorRoot(githubReceiptOutside);
    assertGithubReceiptRootSeparated(githubReceiptOutside, root);
    try {
      symlinkSync(
        githubReceiptOutside,
        githubReceiptLink,
        process.platform === "win32" ? "junction" : "dir",
      );
      expectInvalid(
        rejected,
        "GitHub receipt linked root",
        githubAttempt(() =>
          reserveGithubReceipt(
            githubReceiptLink,
            "receipt.json",
            D("github-linked-operation"),
            {
              pathSha256: D("linked-root-path"),
              identitySha256: D("linked-root-identity"),
            },
          ),
        ),
        "root",
      );
    } finally {
      rmSync(githubReceiptLink, { recursive: true, force: true });
      rmSync(githubReceiptOutside, { recursive: true, force: true });
    }
    const abortReservation = reserveGithubReceipt(
      githubReceiptRoot,
      "aborted.json",
      D("github-aborted-operation"),
      githubReceiptRootPolicy,
    );
    abortGithubReceiptReservation(abortReservation);
    if (existsSync(path.join(githubReceiptRoot, "aborted.json")))
      throw new Error("GitHub receipt reservation was not removed on abort");
    const swapRoot = path.join(root, "github-receipt-swap");
    const movedSwapRoot = `${swapRoot}-moved`;
    mkdirSync(swapRoot);
    secureVerifierOperatorRoot(swapRoot);
    const swapDescriptor = inspectOperatorRoot(swapRoot);
    const swapReservation = reserveGithubReceipt(
      swapRoot,
      "receipt.json",
      D("github-root-swap-operation"),
      {
        pathSha256: swapDescriptor.pathSha256,
        identitySha256: swapDescriptor.identitySha256,
      },
    );
    try {
      renameSync(swapRoot, movedSwapRoot);
      mkdirSync(swapRoot);
      secureVerifierOperatorRoot(swapRoot);
      expectInvalid(
        rejected,
        "GitHub receipt root identity swap",
        githubAttempt(() =>
          commitGithubReceiptReservation(
            swapReservation,
            `${JSON.stringify({
              operationId: D("github-root-swap-operation"),
            })}\n`,
          ),
        ),
        "identity changed",
      );
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EBUSY", "EPERM", "EACCES"].includes(error.code)
      )
        throw error;
      rejected.push("GitHub receipt root swap prevented by Windows");
    } finally {
      abortGithubReceiptReservation(swapReservation);
      rmSync(swapRoot, { recursive: true, force: true });
      rmSync(movedSwapRoot, { recursive: true, force: true });
    }
    const dependencyDeltaRoot = path.join(root, "dependency-delta-fixture");
    mkdirSync(dependencyDeltaRoot, { recursive: true });
    git(dependencyDeltaRoot, ["init", "-q"]);
    git(dependencyDeltaRoot, ["config", "user.name", "Valdris Test"]);
    git(dependencyDeltaRoot, [
      "config",
      "user.email",
      "valdris@example.invalid",
    ]);
    const dependencyBaseLocks = {
      "package-lock.json": `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/parallel": { name: "parallel", version: "1.0.0" },
          "node_modules/a/node_modules/parallel": {
            name: "parallel",
            version: "2.0.0",
          },
          "node_modules/remove-me": {
            name: "remove-me",
            version: "1.0.0",
          },
          "node_modules/npm-metadata": {
            name: "npm-metadata",
            version: "1.0.0",
            resolved: "https://base.invalid/npm-metadata.tgz",
            integrity: "sha512-npm-base",
          },
        },
      })}\n`,
      "pnpm-lock.yaml":
        "lockfileVersion: '9.0'\npackages:\n  pnpm-alpha@1.0.0:\n    resolution: {integrity: base}\n",
      "yarn.lock":
        '# yarn lockfile v1\n\nyarn-alpha@^1.0.0:\n  version "1.0.0"\n  resolved "https://base.invalid/yarn-alpha.tgz"\n  integrity "sha512-yarn-base"\n',
      "Cargo.lock":
        'version = 3\n\n[[package]]\nname = "cargo-alpha"\nversion = "1.0.0"\nsource = "registry+https://base.invalid/cargo"\nchecksum = "cargo-base"\n',
      "uv.lock":
        'version = 1\n\n[[package]]\nname = "uv-alpha"\nversion = "1.0.0"\nsource = { registry = "https://base.invalid/uv" }\nsdist = { url = "https://base.invalid/uv-alpha.tar.gz", hash = "sha256:uv-base" }\n',
      "poetry.lock":
        '[[package]]\nname = "poetry-alpha"\nversion = "1.0.0"\nsource = "https://base.invalid/poetry"\nfiles = [{file = "poetry-alpha.whl", hash = "sha256:poetry-base"}]\n',
      "go.sum":
        "example.invalid/go-alpha v1.0.0 h1:base\nexample.invalid/go-alpha v1.0.0/go.mod h1:base-mod\n",
      "requirements.txt":
        'requirements-alpha==1.0.0 --hash=sha256:req-base\ndirect-alpha @ https://base.invalid/direct-alpha.whl ; python_version >= "3.10" --hash=sha256:direct-base\nmarker-alpha==1.0.0 ; python_version < "3.12"\n',
      "requirements-removed.txt": "removed-file==1.0.0\n",
    };
    for (const [lockfile, contents] of Object.entries(dependencyBaseLocks))
      writeFileSync(path.join(dependencyDeltaRoot, lockfile), contents);
    git(dependencyDeltaRoot, ["add", "."]);
    git(dependencyDeltaRoot, ["commit", "-qm", "dependency base"]);
    const dependencyBase = git(dependencyDeltaRoot, ["rev-parse", "HEAD"]);
    const dependencyHeadLocks = {
      "package-lock.json": `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/parallel": { name: "parallel", version: "1.0.0" },
          "node_modules/a/node_modules/parallel": {
            name: "parallel",
            version: "2.0.0",
          },
          "node_modules/b/node_modules/parallel": {
            name: "parallel",
            version: "3.0.0",
          },
          "node_modules/npm-metadata": {
            name: "npm-metadata",
            version: "1.0.0",
            resolved: "https://head.invalid/npm-metadata.tgz",
            integrity: "sha512-npm-head",
          },
        },
      })}\n`,
      "pnpm-lock.yaml":
        "lockfileVersion: '9.0'\npackages:\n  pnpm-alpha@1.0.0:\n    resolution: {integrity: head}\n",
      "yarn.lock":
        '# yarn lockfile v1\n\nyarn-alpha@^1.0.0:\n  version "1.0.0"\n  resolved "https://head.invalid/yarn-alpha.tgz"\n  integrity "sha512-yarn-head"\n',
      "Cargo.lock":
        'version = 3\n\n[[package]]\nname = "cargo-alpha"\nversion = "1.0.0"\nsource = "registry+https://head.invalid/cargo"\nchecksum = "cargo-head"\n',
      "uv.lock":
        'version = 1\n\n[[package]]\nname = "uv-alpha"\nversion = "1.0.0"\nsource = { registry = "https://head.invalid/uv" }\nsdist = { url = "https://head.invalid/uv-alpha.tar.gz", hash = "sha256:uv-head" }\n',
      "poetry.lock":
        '[[package]]\nname = "poetry-alpha"\nversion = "1.0.0"\nsource = "https://head.invalid/poetry"\nfiles = [{file = "poetry-alpha.whl", hash = "sha256:poetry-head"}]\n',
      "go.sum":
        "example.invalid/go-alpha v1.0.0 h1:head\nexample.invalid/go-alpha v1.0.0/go.mod h1:head-mod\n",
      "requirements.txt":
        'requirements-alpha==1.0.0 --hash=sha256:req-head\ndirect-alpha @ https://head.invalid/direct-alpha.whl ; python_version >= "3.10" --hash=sha256:direct-head\nmarker-alpha==1.0.0 ; python_version >= "3.12"\n',
      "requirements-added.txt": "added-file==1.0.0\n",
    };
    rmSync(path.join(dependencyDeltaRoot, "requirements-removed.txt"));
    for (const [lockfile, contents] of Object.entries(dependencyHeadLocks))
      writeFileSync(path.join(dependencyDeltaRoot, lockfile), contents);
    git(dependencyDeltaRoot, ["add", "-A"]);
    git(dependencyDeltaRoot, ["commit", "-qm", "dependency delta"]);
    const dependencyHead = git(dependencyDeltaRoot, ["rev-parse", "HEAD"]);
    const metadataUpdate = (
      locator,
      name,
      version,
      previousMetadata,
      metadata,
    ) => ({
      locator,
      name,
      version,
      previousVersion: version,
      metadataSha256: LOCK_METADATA(metadata),
      previousMetadataSha256: LOCK_METADATA(previousMetadata),
      change: "updated",
    });
    const reviewedDependencies = [
      {
        locator: "npm:package-lock.json#node_modules/b/node_modules/parallel",
        name: "parallel",
        version: "3.0.0",
        metadataSha256: LOCK_METADATA(),
        change: "added",
      },
      {
        locator: "npm:package-lock.json#node_modules/remove-me",
        name: "remove-me",
        version: "1.0.0",
        metadataSha256: LOCK_METADATA(),
        change: "removed",
      },
      metadataUpdate(
        "npm:package-lock.json#node_modules/npm-metadata",
        "npm-metadata",
        "1.0.0",
        {
          integrity: ["sha512-npm-base"],
          sources: ["https://base.invalid/npm-metadata.tgz"],
        },
        {
          integrity: ["sha512-npm-head"],
          sources: ["https://head.invalid/npm-metadata.tgz"],
        },
      ),
      metadataUpdate(
        "pnpm:pnpm-lock.yaml#pnpm-alpha@1.0.0",
        "pnpm-alpha",
        "1.0.0",
        { integrity: ["base"] },
        { integrity: ["head"] },
      ),
      metadataUpdate(
        "yarn:yarn.lock#yarn-alpha@^1.0.0",
        "yarn-alpha",
        "1.0.0",
        {
          integrity: ["sha512-yarn-base"],
          sources: ["https://base.invalid/yarn-alpha.tgz"],
        },
        {
          integrity: ["sha512-yarn-head"],
          sources: ["https://head.invalid/yarn-alpha.tgz"],
        },
      ),
      metadataUpdate(
        "toml:Cargo.lock#cargo-alpha@1.0.0",
        "cargo-alpha",
        "1.0.0",
        {
          integrity: ["cargo-base"],
          sources: ["registry+https://base.invalid/cargo"],
        },
        {
          integrity: ["cargo-head"],
          sources: ["registry+https://head.invalid/cargo"],
        },
      ),
      metadataUpdate(
        "toml:uv.lock#uv-alpha@1.0.0",
        "uv-alpha",
        "1.0.0",
        {
          integrity: ["sha256:uv-base"],
          sources: [
            "https://base.invalid/uv-alpha.tar.gz",
            '{ registry = "https://base.invalid/uv" }',
          ],
        },
        {
          integrity: ["sha256:uv-head"],
          sources: [
            "https://head.invalid/uv-alpha.tar.gz",
            '{ registry = "https://head.invalid/uv" }',
          ],
        },
      ),
      metadataUpdate(
        "toml:poetry.lock#poetry-alpha@1.0.0",
        "poetry-alpha",
        "1.0.0",
        {
          integrity: ["sha256:poetry-base"],
          sources: ["https://base.invalid/poetry"],
        },
        {
          integrity: ["sha256:poetry-head"],
          sources: ["https://head.invalid/poetry"],
        },
      ),
      metadataUpdate(
        "go:go.sum#example.invalid/go-alpha@v1.0.0",
        "example.invalid/go-alpha",
        "v1.0.0",
        { integrity: ["go.mod:h1:base-mod", "module:h1:base"] },
        { integrity: ["go.mod:h1:head-mod", "module:h1:head"] },
      ),
      metadataUpdate(
        "python:requirements.txt#requirements-alpha",
        "requirements-alpha",
        "1.0.0",
        { integrity: ["sha256:req-base"] },
        { integrity: ["sha256:req-head"] },
      ),
      metadataUpdate(
        "python:requirements.txt#direct-alpha",
        "direct-alpha",
        "direct",
        {
          integrity: ["sha256:direct-base"],
          markers: ['python_version >= "3.10"'],
          sources: ["https://base.invalid/direct-alpha.whl"],
        },
        {
          integrity: ["sha256:direct-head"],
          markers: ['python_version >= "3.10"'],
          sources: ["https://head.invalid/direct-alpha.whl"],
        },
      ),
      metadataUpdate(
        "python:requirements.txt#marker-alpha",
        "marker-alpha",
        "1.0.0",
        { markers: ['python_version < "3.12"'] },
        { markers: ['python_version >= "3.12"'] },
      ),
      {
        locator: "python:requirements-added.txt#added-file",
        name: "added-file",
        version: "1.0.0",
        metadataSha256: LOCK_METADATA(),
        change: "added",
      },
      {
        locator: "python:requirements-removed.txt#removed-file",
        name: "removed-file",
        version: "1.0.0",
        metadataSha256: LOCK_METADATA(),
        change: "removed",
      },
    ];
    const dependencyReview = clone(fixture.documents.changeReview);
    Object.assign(dependencyReview, {
      commit: dependencyHead,
      baseCommit: dependencyBase,
      headCommit: dependencyHead,
      baseCommitSha256: sha256(dependencyBase),
      headCommitSha256: sha256(dependencyHead),
      diffSha256: sha256(
        git(
          dependencyDeltaRoot,
          ["diff", "--binary", dependencyBase, dependencyHead, "--"],
          null,
        ),
      ),
      changedPaths: [
        ...new Set([
          ...Object.keys(dependencyBaseLocks),
          ...Object.keys(dependencyHeadLocks),
        ]),
      ],
      lockfilePaths: [
        ...new Set([
          ...Object.keys(dependencyBaseLocks),
          ...Object.keys(dependencyHeadLocks),
        ]),
      ],
      dependencies: reviewedDependencies,
      dependencyProvenance: reviewedDependencies
        .filter(
          (dependency) =>
            dependency.change === "added" || dependency.change === "updated",
        )
        .map((dependency) => {
          return {
            ...fixture.documents.changeReview.dependencyProvenance[0],
            locator: dependency.locator,
            name: dependency.name,
            version: dependency.version,
            lockMetadataSha256: dependency.metadataSha256,
            sourceUrl: `https://source.example.invalid/${encodeURIComponent(dependency.name)}`,
          };
        }),
    });
    const dependencyReadiness = {
      implementationFixedPoint: {
        baseCommit: dependencyBase,
        baseCommitSha256: sha256(dependencyBase),
        source: "commissioned-pre-implementation",
      },
    };
    expectValid(
      "parallel dependency versions and removal baseline",
      validateChangeReviewDocument(dependencyReview, {
        policy: POLICY,
        repoRoot: dependencyDeltaRoot,
        readiness: dependencyReadiness,
      }),
    );
    const omittedParallelDependency = clone(dependencyReview);
    omittedParallelDependency.dependencies =
      omittedParallelDependency.dependencies.filter(
        (dependency) => dependency.name !== "parallel",
      );
    omittedParallelDependency.dependencyProvenance = [];
    expectInvalid(
      rejected,
      "omitted parallel dependency locator",
      validateChangeReviewDocument(omittedParallelDependency, {
        policy: POLICY,
        repoRoot: dependencyDeltaRoot,
        readiness: dependencyReadiness,
      }),
      "do not exactly match the reconstructed lockfile delta",
    );
    const omittedRemovedDependency = clone(dependencyReview);
    omittedRemovedDependency.dependencies =
      omittedRemovedDependency.dependencies.filter(
        (dependency) => dependency.change !== "removed",
      );
    expectInvalid(
      rejected,
      "omitted removed dependency",
      validateChangeReviewDocument(omittedRemovedDependency, {
        policy: POLICY,
        repoRoot: dependencyDeltaRoot,
        readiness: dependencyReadiness,
      }),
      "do not exactly match the reconstructed lockfile delta",
    );
    for (const dependencyName of [
      "npm-metadata",
      "pnpm-alpha",
      "yarn-alpha",
      "cargo-alpha",
      "uv-alpha",
      "poetry-alpha",
      "example.invalid/go-alpha",
      "requirements-alpha",
      "direct-alpha",
      "marker-alpha",
    ]) {
      const omittedMetadataChange = clone(dependencyReview);
      omittedMetadataChange.dependencies =
        omittedMetadataChange.dependencies.filter(
          (dependency) => dependency.name !== dependencyName,
        );
      omittedMetadataChange.dependencyProvenance =
        omittedMetadataChange.dependencyProvenance.filter(
          (provenance) => provenance.name !== dependencyName,
        );
      expectInvalid(
        rejected,
        `unreviewed ${dependencyName} same-version metadata substitution`,
        validateChangeReviewDocument(omittedMetadataChange, {
          policy: POLICY,
          repoRoot: dependencyDeltaRoot,
          readiness: dependencyReadiness,
        }),
        "do not exactly match the reconstructed lockfile delta",
      );
    }
    const detachedLockMetadataProvenance = clone(dependencyReview);
    detachedLockMetadataProvenance.dependencyProvenance.find(
      (provenance) => provenance.name === "npm-metadata",
    ).lockMetadataSha256 = D("detached-lock-metadata");
    expectInvalid(
      rejected,
      "dependency provenance lock-metadata substitution",
      validateChangeReviewDocument(detachedLockMetadataProvenance, {
        policy: POLICY,
        repoRoot: dependencyDeltaRoot,
        readiness: dependencyReadiness,
      }),
      "lacks metadata-bound provenance",
    );
    writeFileSync(
      path.join(dependencyDeltaRoot, "requirements-unsupported.txt"),
      "unsupported-alpha>=1.0.0\n",
    );
    git(dependencyDeltaRoot, ["add", "requirements-unsupported.txt"]);
    git(dependencyDeltaRoot, [
      "commit",
      "-qm",
      "unsupported semantic requirement",
    ]);
    const unsupportedRequirementsHead = git(dependencyDeltaRoot, [
      "rev-parse",
      "HEAD",
    ]);
    const unsupportedRequirementsReview = clone(dependencyReview);
    const unsupportedDependency = {
      locator: "python:requirements-unsupported.txt#unsupported-alpha",
      name: "unsupported-alpha",
      version: "1.0.0",
      metadataSha256: LOCK_METADATA(),
      change: "added",
    };
    Object.assign(unsupportedRequirementsReview, {
      commit: unsupportedRequirementsHead,
      baseCommit: dependencyHead,
      headCommit: unsupportedRequirementsHead,
      baseCommitSha256: sha256(dependencyHead),
      headCommitSha256: sha256(unsupportedRequirementsHead),
      diffSha256: sha256(
        git(
          dependencyDeltaRoot,
          [
            "diff",
            "--binary",
            dependencyHead,
            unsupportedRequirementsHead,
            "--",
          ],
          null,
        ),
      ),
      changedPaths: ["requirements-unsupported.txt"],
      lockfilePaths: ["requirements-unsupported.txt"],
      dependencies: [unsupportedDependency],
      dependencyProvenance: [
        {
          ...fixture.documents.changeReview.dependencyProvenance[0],
          locator: unsupportedDependency.locator,
          name: unsupportedDependency.name,
          version: unsupportedDependency.version,
          lockMetadataSha256: unsupportedDependency.metadataSha256,
          sourceUrl: "https://source.example.invalid/unsupported-alpha",
        },
      ],
    });
    expectInvalid(
      rejected,
      "unsupported semantic requirements line",
      validateChangeReviewDocument(unsupportedRequirementsReview, {
        policy: POLICY,
        repoRoot: dependencyDeltaRoot,
        readiness: {
          implementationFixedPoint: {
            baseCommit: dependencyHead,
            baseCommitSha256: sha256(dependencyHead),
            source: "commissioned-pre-implementation",
          },
        },
      }),
      "unsupported semantic requirements line",
    );
    const semanticManifest = semanticProofSetManifest(
      fixture.documents.semantic,
    );
    const proofInputManifest = authoritativeProofInputSetManifest(
      fixture.closure,
      fixture.documents,
    );
    const manifestArtifact = (value) => {
      const bytes = Buffer.from(canonicalJson(value));
      return {
        id: "manifest",
        sha256: sha256(bytes),
        contentBase64: bytes.toString("base64"),
      };
    };
    const artifactIdAttempt = (id, outputName) => {
      const semantic = { kind: "semantic" };
      const proofInput = { kind: "proof-input" };
      const gates = { kind: "accepted-gates" };
      const emptySha256 = sha256(Buffer.alloc(0));
      const outputRoot = path.join(root, outputName);
      try {
        materializeVerifiedOutputEnvelope(
          JSON.stringify({
            schema: "valdris.proof-executor-output.v1",
            runId: RUN_ID,
            sourceCommit: COMMIT,
            status: "passed",
            validatorSha256: D("validator"),
            semanticProofArtifacts: [
              manifestArtifact(semantic),
              { id, sha256: emptySha256, contentBase64: "" },
            ],
            proofInputArtifacts: [manifestArtifact(proofInput)],
            acceptedGateArtifacts: [manifestArtifact(gates)],
          }),
          outputRoot,
          {
            runId: RUN_ID,
            semanticProofSetSha256: sha256(canonicalJson(semantic)),
            proofInputSetSha256: sha256(canonicalJson(proofInput)),
            acceptedGateArtifactsSha256: sha256(canonicalJson(gates)),
            validatorSha256: D("validator"),
            outputBytes: 16_384,
          },
          { commit: COMMIT },
        );
        return { valid: true, problems: [] };
      } catch (error) {
        return { valid: false, problems: [error.message] };
      } finally {
        rmSync(outputRoot, { recursive: true, force: true });
      }
    };
    const materializedOutput = path.join(
      root,
      "executor-positive-materialized-output",
    );
    const semanticManifestSha256 = sha256(canonicalJson(semanticManifest));
    const proofInputManifestSha256 = sha256(canonicalJson(proofInputManifest));
    const gateManifestSha256 = sha256(
      canonicalJson(fixture.acceptedGateManifest),
    );
    if (
      semanticManifestSha256 !==
        fixture.documents.runtime.executorReceipt.semanticProofSetSha256 ||
      proofInputManifestSha256 !==
        fixture.documents.runtime.executorReceipt.proofInputSetSha256 ||
      gateManifestSha256 !== fixture.closure.acceptedGateArtifactsSha256
    )
      throw new Error(
        "positive executor manifests do not bind the valid authoritative closure",
      );
    materializeVerifiedOutputEnvelope(
      JSON.stringify({
        schema: "valdris.proof-executor-output.v1",
        runId: RUN_ID,
        sourceCommit: COMMIT,
        status: "passed",
        validatorSha256:
          fixture.documents.runtime.executorReceipt.validatorSha256,
        semanticProofArtifacts: [manifestArtifact(semanticManifest)],
        proofInputArtifacts: [manifestArtifact(proofInputManifest)],
        acceptedGateArtifacts: [manifestArtifact(fixture.acceptedGateManifest)],
      }),
      materializedOutput,
      {
        runId: RUN_ID,
        semanticProofSetSha256: semanticManifestSha256,
        proofInputSetSha256: proofInputManifestSha256,
        acceptedGateArtifactsSha256: gateManifestSha256,
        validatorSha256:
          fixture.documents.runtime.executorReceipt.validatorSha256,
        outputBytes: 1_048_576,
      },
      { commit: COMMIT },
    );
    for (const relative of [
      "result.json",
      "semanticProofArtifacts/manifest.bin",
      "proofInputArtifacts/manifest.bin",
      "acceptedGateArtifacts/manifest.bin",
    ])
      if (!existsSync(path.join(materializedOutput, ...relative.split("/"))))
        throw new Error(`positive executor output is missing ${relative}`);
    rmSync(materializedOutput, { recursive: true, force: true });
    const calibratedEval = JSON.parse(
      readFileSync(path.join(root, "evals", "results.json"), "utf8"),
    );
    const calibration = {
      schema: "uash.model-judge-calibration.v1",
      judgeModelSha256: D("independent-judge-model"),
      judgeProviderSha256: D("independent-judge-provider"),
      judgePromptSha256: D("judge-prompt"),
      calibrationSetSha256: D("judge-calibration-set"),
      humanLabelsSha256: D("judge-human-labels"),
      owner: "evaluation-owner",
      generatedAt: GENERATED,
      expiresAt: "2030-02-01T00:00:00.000Z",
      agreement: 0.95,
      minimumAgreement: 0.9,
      errorRate: 0.05,
      maximumErrorRate: 0.1,
      criticalSlices: ["safety", "grounding"],
      independentFromSystemUnderTest: true,
    };
    const calibrationPath = writeJson(
      root,
      "evals/calibrations/context-quality.json",
      calibration,
    );
    const judgeEvaluator = {
      ...calibratedEval.suites[0].evaluator,
      kind: "model",
      judgeIdentity: {
        modelSha256: calibration.judgeModelSha256,
        providerSha256: calibration.judgeProviderSha256,
        promptSha256: calibration.judgePromptSha256,
      },
    };
    calibratedEval.suites[0].evaluator = judgeEvaluator;
    const originalArmContents = new Map();
    for (const [armName, armPath] of [
      ["baseline", "evals/context-baseline.json"],
      ["candidate", "evals/context-candidate.json"],
    ]) {
      const absoluteArmPath = path.join(root, armPath);
      const originalArm = readFileSync(absoluteArmPath, "utf8");
      originalArmContents.set(absoluteArmPath, originalArm);
      const armDocument = JSON.parse(originalArm);
      armDocument.evaluator = judgeEvaluator;
      const writtenArmPath = writeJson(root, armPath, armDocument);
      calibratedEval.suites[0].contextComparison[armName].evaluator =
        judgeEvaluator;
      calibratedEval.suites[0].contextComparison[armName].resultDigest =
        fileSha256(writtenArmPath);
      if (armName === "candidate")
        calibratedEval.suites[0].resultDigest = fileSha256(writtenArmPath);
    }
    calibratedEval.suites[0].judgeCalibration = {
      schema: calibration.schema,
      path: "evals/calibrations/context-quality.json",
      sha256: fileSha256(calibrationPath),
    };
    expectValid(
      "calibrated model-judge baseline",
      validateEvalResultsDocument(calibratedEval, { repoRoot: root, now: NOW }),
    );
    for (const [absoluteArmPath, contents] of originalArmContents)
      writeFileSync(absoluteArmPath, contents);
    const initialDriverState = nextRuntimeDriverState(
      null,
      {
        runId: RUN_ID,
        leaseOwner: "codex-runtime",
        leaseId: "lease-a",
        expectedHead:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        leaseMinutes: 30,
        status: "running",
      },
      new Date(GENERATED),
    );
    const resumedDriverState = nextRuntimeDriverState(
      initialDriverState,
      {
        runId: RUN_ID,
        leaseOwner: "codex-runtime",
        leaseId: "lease-a",
        leaseMinutes: 30,
        status: "completed",
        expectedHead: initialDriverState.currentHeadSha256,
      },
      new Date("2030-01-01T12:01:00.000Z"),
    );
    if (
      resumedDriverState.checkpointRevision !== 2 ||
      resumedDriverState.priorHeadSha256 !==
        initialDriverState.currentHeadSha256
    )
      throw new Error("runtime-driver checkpoint baseline did not advance");
    const driverCliDirectory = path.join(root, "runtime-driver-cli-positive");
    try {
      const driverCli = (extraArgs) =>
        spawnSync(
          process.execPath,
          [
            path.join(ROOT, "scripts", "runtime-driver-state.mjs"),
            "--repo",
            root,
            "--file",
            "runtime-driver-cli-positive/state.json",
            "--run-id",
            RUN_ID,
            "--lease-owner",
            "codex-runtime",
            "--write",
            ...extraArgs,
          ],
          { cwd: root, encoding: "utf8", windowsHide: true },
        );
      const first = driverCli([
        "--status",
        "running",
        "--lease-id",
        "cli-lease",
        "--expected-head",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ]);
      if (first.status !== 0)
        throw new Error(
          `runtime-driver CLI initial checkpoint failed: ${first.stderr || first.stdout}`,
        );
      const firstState = JSON.parse(first.stdout).state;
      const second = driverCli([
        "--status",
        "completed",
        "--expected-head",
        firstState.currentHeadSha256,
        "--lease-id",
        "cli-lease",
      ]);
      if (
        second.status !== 0 ||
        JSON.parse(second.stdout).state.checkpointRevision !== 2
      )
        throw new Error(
          `runtime-driver CLI resume checkpoint failed: ${second.stderr || second.stdout}`,
        );
    } finally {
      rmSync(driverCliDirectory, { recursive: true, force: true });
    }
    const interopFixturePaths = [];
    const writeInteropAdapter = (fault) => {
      const target = path.join(root, `interop-adapter-${fault}.mjs`);
      writeFileSync(target, interopAdapterSource(fault));
      interopFixturePaths.push(target);
      return target;
    };
    const runInterop = (
      adapterPath,
      outputName,
      { timeoutMs = 3_000 } = {},
    ) => {
      const output = `runtime/${outputName}.json`;
      interopFixturePaths.push(path.join(root, ...output.split("/")));
      return spawnSync(
        process.execPath,
        [
          path.join(ROOT, "scripts", "interop-conformance-runner.mjs"),
          "--repo",
          root,
          "--protocol",
          "mcp",
          "--version",
          "2029-01",
          "--identity-sha256",
          D("interop-runner-identity"),
          "--auth-root-sha256",
          D("interop-runner-auth"),
          "--capabilities-json",
          '["tools"]',
          "--command-json",
          JSON.stringify([process.execPath, adapterPath]),
          "--run-id",
          RUN_ID,
          "--commit",
          COMMIT,
          "--environment",
          ENVIRONMENT,
          "--timeout-ms",
          String(timeoutMs),
          "--output",
          output,
        ],
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 60_000,
        },
      );
    };
    try {
      const positiveOutput = "runtime/interop-runner-positive.json";
      const positiveAdapter = writeInteropAdapter("none");
      const interopRunner = runInterop(
        positiveAdapter,
        "interop-runner-positive",
      );
      if (interopRunner.status !== 0)
        throw new Error(
          `interop reference runner failed: ${interopRunner.stderr || interopRunner.stdout}`,
        );
      const transcript = JSON.parse(
        readFileSync(path.join(root, ...positiveOutput.split("/")), "utf8"),
      );
      if (
        transcript.tests.length !== 10 ||
        transcript.tests.some(
          (test) => !/^[a-f0-9]{64}$/.test(test.assertionSha256 || ""),
        )
      )
        throw new Error(
          "interop reference runner omitted typed assertion bindings",
        );

      const interopAdversarialCases = [
        [
          "interop echo-only adapter",
          "echo-only",
          "exact typed response fields",
        ],
        [
          "interop detached request binding",
          "request-binding",
          "response envelope does not bind",
        ],
        [
          "interop initialize downgrade",
          "initialize",
          "initialize response result does not satisfy",
        ],
        [
          "interop version negotiation omission",
          "version-negotiation",
          "version-negotiation response result does not satisfy",
        ],
        [
          "interop auth-root escape",
          "auth-root-isolation",
          "auth-root-isolation response result does not satisfy",
        ],
        [
          "interop capability overclaim",
          "capability-discovery",
          "capability-discovery response result does not satisfy",
        ],
        [
          "interop schema downgrade",
          "schema-negotiation",
          "schema-negotiation response result does not satisfy",
        ],
        [
          "interop correlation substitution",
          "event-correlation",
          "event-correlation response result does not satisfy",
        ],
        [
          "interop cancellation mutation",
          "cancellation",
          "cancellation response result does not satisfy",
        ],
        [
          "interop unknown tool accepted",
          "unknown-tool-rejection",
          "unknown-tool-rejection response result does not satisfy",
        ],
        [
          "interop replay accepted",
          "replay-protection",
          "replay-protection response result does not satisfy",
        ],
      ];
      for (const [label, fault, expected] of interopAdversarialCases) {
        expectProcessRejected(
          rejected,
          label,
          runInterop(
            writeInteropAdapter(fault),
            `interop-runner-reject-${fault}`,
          ),
          expected,
        );
      }
      expectProcessRejected(
        rejected,
        "interop adapter deadline violation",
        runInterop(
          writeInteropAdapter("timeout"),
          "interop-runner-reject-timeout",
          { timeoutMs: 200 },
        ),
        "interop test timeout failed",
      );
    } finally {
      for (const target of interopFixturePaths)
        rmSync(target, { recursive: true, force: true });
    }
    const learningRoot = canonicalTempDirectory("valdris-v09-learning-");
    const primaryCommit = COMMIT;
    try {
      const learningFixture = buildFixture(learningRoot, {
        learningRoute: true,
      });
      expectValid(
        "route-derived learning closure baseline",
        validateAuthoritativeClosureDocument(
          learningFixture.closure,
          learningRoot,
          {
            repoRoot: learningRoot,
            policy: POLICY,
            level: "authoritative",
            now: NOW,
            trustStore: learningFixture.trustStore,
            requiredTrustSha256: learningFixture.trustPin,
          },
        ),
      );
    } finally {
      COMMIT = primaryCommit;
      rmSync(learningRoot, { recursive: true, force: true });
    }
    const neutralHeadRoot = canonicalTempDirectory("valdris-v09-neutral-head-");
    try {
      const neutralFixture = buildFixture(neutralHeadRoot, {
        headProvider: "neutral-ledger",
      });
      const neutralValidationOptions = {
        repoRoot: neutralHeadRoot,
        policy: POLICY,
        level: "authoritative",
        now: NOW,
        trustStore: neutralFixture.trustStore,
        requiredTrustSha256: neutralFixture.trustPin,
        acceptancePolicy: neutralFixture.documents.semantic.acceptancePolicy,
      };
      expectValid(
        "provider-neutral authoritative head baseline",
        validateAuthoritativeClosureDocument(
          neutralFixture.closure,
          neutralHeadRoot,
          neutralValidationOptions,
        ),
      );
      writeJson(
        neutralHeadRoot,
        V09_CANONICAL_ARTIFACTS.authoritative,
        neutralFixture.closure,
      );
      const evaluateNeutralRelease = () =>
        evaluateAuthoritativeRelease({
          tag: "v0.9.0",
          runRoot: neutralHeadRoot,
          repositoryRoot: ROOT,
          validationOptions: neutralValidationOptions,
        });
      const neutralRelease = evaluateNeutralRelease();
      if (!neutralRelease.ok || !neutralRelease.authoritativeEligible)
        throw new Error(
          `provider-neutral stable release unexpectedly failed: ${neutralRelease.problems.join("; ")}`,
        );
      const originalRuntime = clone(neutralFixture.documents.runtime);
      const originalClosure = clone(neutralFixture.closure);
      const runNeutralReleaseMutation = (label, mutate, expected) => {
        const runtime = clone(originalRuntime);
        mutate(runtime.bridgeHeadReceipt);
        writeJson(neutralHeadRoot, V09_CANONICAL_ARTIFACTS.runtime, runtime);
        const closure = clone(originalClosure);
        closure.artifacts.runtime.sha256 = fileSha256(
          path.join(
            neutralHeadRoot,
            ...V09_CANONICAL_ARTIFACTS.runtime.split("/"),
          ),
        );
        writeJson(
          neutralHeadRoot,
          V09_CANONICAL_ARTIFACTS.authoritative,
          closure,
        );
        const result = evaluateNeutralRelease();
        if (result.ok)
          throw new Error(`${label} unexpectedly passed stable release`);
        if (
          expected &&
          !result.problems.some((problem) => problem.includes(expected))
        )
          throw new Error(
            `${label} failed for the wrong reason: ${result.problems.join("; ")}`,
          );
        rejected.push(label);
      };
      runNeutralReleaseMutation(
        "stable release missing neutral provider bindings",
        (head) => {
          delete head.providerIdentitySha256;
          delete head.providerProof;
          delete head.providerReceiptSha256;
          delete head.targetSha256;
          delete head.protectionPolicySha256;
        },
        "exact provider, proof, receipt, target, and protection identities",
      );
      runNeutralReleaseMutation(
        "stable release neutral provider-proof digest mismatch",
        (head) => {
          head.providerProofSha256 = D("mismatched-neutral-provider-proof");
        },
        "exact provider, proof, receipt, target, and protection identities",
      );
      runNeutralReleaseMutation(
        "stable release commissioned provider identity mismatch",
        (head) => {
          head.providerIdentitySha256 = D("foreign-neutral-provider");
        },
        "exact commissioned provider target",
      );
    } finally {
      COMMIT = primaryCommit;
      rmSync(neutralHeadRoot, { recursive: true, force: true });
    }

    const cases = [
      [
        "control removal",
        () => {
          const d = clone(fixture.documents.semantic);
          d.augmentation.removals = ["security"];
          return validateSemanticAssuranceDocument(d, options);
        },
        "cannot remove",
      ],
      [
        "threshold without adapter",
        () => {
          const d = clone(fixture.documents.semantic);
          d.acceptancePolicy.thresholds[0].controlId = "unproven";
          return validateSemanticAssuranceDocument(d, options);
        },
        "no semantic adapter",
      ],
      [
        "self-asserted semantic pass",
        () => {
          const d = clone(fixture.documents.semantic);
          d.adapters[0].assertions[0].observed = 0.1;
          return validateSemanticAssuranceDocument(d, options);
        },
        "commissioned threshold",
      ],
      [
        "forged semantic execution",
        () => {
          const d = clone(fixture.documents.semantic);
          d.adapters[0].executionReceipt.attestation.signature =
            Buffer.alloc(64).toString("base64");
          return validateSemanticAssuranceDocument(d, options);
        },
        "signature is invalid",
      ],
      [
        "adapter tier downgrade",
        () => {
          const d = clone(fixture.documents.semantic);
          d.adapters[0].supportedTier = "AI1";
          return validateSemanticAssuranceDocument(d, options);
        },
        "effective AI tier",
      ],
      [
        "effective tier downgrade",
        () => {
          const d = clone(fixture.documents.semantic);
          d.aiWorkloadIdentity.tier = "AI1";
          d.acceptancePolicy.effectiveAiTier = "AI1";
          return validateSemanticAssuranceDocument(d, options);
        },
        "signed additive assurance augmentation",
      ],
      [
        "acceptance environment substitution",
        () => {
          const d = clone(fixture.documents.semantic);
          d.acceptancePolicy.environment = "development";
          return validateSemanticAssuranceDocument(d, options);
        },
        "profile, environment",
      ],
      [
        "acceptance workload-profile substitution",
        () => {
          const d = clone(fixture.documents.semantic);
          d.acceptancePolicy.workloadProfiles = ["saas"];
          return validateSemanticAssuranceDocument(d, options);
        },
        "workloadProfiles do not match immutable classification",
      ],
      [
        "assurance-tier downgrade",
        () => {
          const d = clone(fixture.documents.semantic);
          d.acceptancePolicy.effectiveAssuranceTier = "T1";
          return validateSemanticAssuranceDocument(d, options);
        },
        "immutable baseline plus additive elevations",
      ],
      [
        "acceptance-policy validator-set substitution",
        () => {
          const d = clone(fixture.documents.semantic);
          d.acceptancePolicy.proofExecutor.validatorSetSha256 = D(
            "substituted-validator-set",
          );
          return validateSemanticAssuranceDocument(d, options);
        },
        "validator set does not match the commissioned semantic adapters",
      ],
      [
        "acceptance-policy live-worktree executor",
        () => {
          const d = clone(fixture.documents.semantic);
          d.acceptancePolicy.proofExecutor.liveWorktreeMount = true;
          return validateSemanticAssuranceDocument(d, options);
        },
        "absolute and exact Git/runtime binaries",
      ],
      [
        "forged approval",
        () => {
          const d = clone(fixture.documents.semantic);
          d.approvalReceipts[0].attestation.signature =
            Buffer.alloc(64).toString("base64");
          return validateSemanticAssuranceDocument(d, options);
        },
        "signature is invalid",
      ],
      [
        "expired approval",
        () => {
          const d = clone(fixture.documents.semantic);
          d.approvalReceipts[0].expiresAt = "2029-01-01T00:00:00.000Z";
          return validateSemanticAssuranceDocument(d, options);
        },
        "expired",
      ],
      [
        "approval replay",
        () => {
          const d = clone(fixture.documents.semantic);
          d.approvalReceipts[1].eventId = d.approvalReceipts[0].eventId;
          return validateSemanticAssuranceDocument(d, options);
        },
        "replay",
      ],
      [
        "late readiness",
        () => {
          const d = clone(fixture.documents.readiness);
          d.sealedAt = d.implementationStartReceipt.implementationStartedAt;
          return validateImplementationReadinessDocument(d, {
            ...options,
            effectiveAiTier: "AI2",
          });
        },
        "independently issued after",
      ],
      [
        "backfilled readiness seal",
        () => {
          const d = clone(fixture.documents.readiness);
          d.sealReceipt.readinessPayloadSha256 = D("backfilled");
          return validateImplementationReadinessDocument(d, {
            ...options,
            effectiveAiTier: "AI2",
          });
        },
        "readiness payload",
      ],
      [
        "backfilled implementation-start head",
        () => {
          const d = clone(fixture.documents.readiness);
          d.implementationStartReceipt.priorHeadSha256 = D("unsealed-head");
          return validateImplementationReadinessDocument(d, {
            ...options,
            effectiveAiTier: "AI2",
          });
        },
        "advance the sealed journal head",
      ],
      [
        "missing risk eval",
        () => {
          const d = clone(fixture.documents.readiness);
          d.evalPlan.dimensions = ["task-success"];
          d.evaluationPlanSha256 = sha256(canonicalJson(d.evalPlan));
          return validateImplementationReadinessDocument(d, {
            ...options,
            effectiveAiTier: "AI2",
          });
        },
        "risk-derived dimension",
      ],
      [
        "unmapped requirement acceptance",
        () => {
          const requirementsPath = path.join(
            root,
            "run",
            "requirements-contract.json",
          );
          const original = readFileSync(requirementsPath, "utf8");
          try {
            const requirements = JSON.parse(original);
            requirements.requirements[0].acceptanceCriteria[0].testIds = [
              "red-002",
            ];
            writeJson(root, "run/requirements-contract.json", requirements);
            const d = clone(fixture.documents.readiness);
            const binding = d.contracts.find(
              (entry) => entry.schema === "uash.requirements-contract.v1",
            );
            binding.sha256 = fileSha256(requirementsPath);
            d.contractSetSha256 = sha256(canonicalJson(d.contracts));
            return validateImplementationReadinessDocument(d, {
              ...options,
              effectiveAiTier: "AI2",
            });
          } finally {
            writeFileSync(requirementsPath, original);
          }
        },
        "red baseline red-001 is not mapped",
      ],
      [
        "unmapped goal stopping condition",
        () => {
          const requirementsPath = path.join(
            root,
            "run",
            "requirements-contract.json",
          );
          const original = readFileSync(requirementsPath, "utf8");
          try {
            const requirements = JSON.parse(original);
            requirements.requirements[0].stoppingConditionIds = [
              "different-stop",
            ];
            writeJson(root, "run/requirements-contract.json", requirements);
            const d = clone(fixture.documents.readiness);
            const binding = d.contracts.find(
              (entry) => entry.schema === "uash.requirements-contract.v1",
            );
            binding.sha256 = fileSha256(requirementsPath);
            d.contractSetSha256 = sha256(canonicalJson(d.contracts));
            return validateImplementationReadinessDocument(d, {
              ...options,
              effectiveAiTier: "AI2",
            });
          } finally {
            writeFileSync(requirementsPath, original);
          }
        },
        "goal stopping condition goal-completed is not mapped",
      ],
      [
        "uncalibrated model judge",
        () => {
          const d = JSON.parse(
            readFileSync(path.join(root, "evals", "results.json"), "utf8"),
          );
          d.suites[0].evaluator.kind = "model";
          return validateEvalResultsDocument(d, { repoRoot: root, now: NOW });
        },
        "exact judge identity",
      ],
      [
        "runtime-driver stale compare-and-swap",
        () => {
          try {
            nextRuntimeDriverState(initialDriverState, {
              runId: RUN_ID,
              leaseOwner: "codex-runtime",
              leaseId: "lease-a",
              leaseMinutes: 30,
              status: "completed",
              expectedHead: D("stale-runtime-head"),
            });
            return { valid: true, problems: [] };
          } catch (error) {
            return { valid: false, problems: [error.message] };
          }
        },
        "stale head",
      ],
      [
        "runtime-driver foreign lease takeover",
        () => {
          try {
            nextRuntimeDriverState(
              initialDriverState,
              {
                runId: RUN_ID,
                leaseOwner: "different-runtime",
                leaseId: "lease-a",
                leaseMinutes: 30,
                status: "completed",
                expectedHead: initialDriverState.currentHeadSha256,
              },
              new Date("2030-01-01T12:01:00.000Z"),
            );
            return { valid: true, problems: [] };
          } catch (error) {
            return { valid: false, problems: [error.message] };
          }
        },
        "held by another owner",
      ],
      [
        "runtime-driver terminal resume",
        () => {
          try {
            nextRuntimeDriverState(resumedDriverState, {
              runId: RUN_ID,
              leaseOwner: "codex-runtime",
              leaseId: "lease-a",
              leaseMinutes: 30,
              status: "running",
              expectedHead: resumedDriverState.currentHeadSha256,
            });
            return { valid: true, problems: [] };
          } catch (error) {
            return { valid: false, problems: [error.message] };
          }
        },
        "terminal state cannot be resumed",
      ],
      [
        "runtime-driver malformed legacy lock",
        () => {
          const directory = path.join(root, "runtime-driver-cli-test");
          const lockPath = path.join(directory, "state.json.lock");
          mkdirSync(directory, { recursive: true });
          writeFileSync(lockPath, "held\n");
          try {
            const result = spawnSync(
              process.execPath,
              [
                path.join(ROOT, "scripts", "runtime-driver-state.mjs"),
                "--repo",
                root,
                "--file",
                "runtime-driver-cli-test/state.json",
                "--run-id",
                RUN_ID,
                "--status",
                "running",
                "--lease-owner",
                "codex-runtime",
                "--lease-id",
                "lock-test-lease",
                "--expected-head",
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "--write",
              ],
              { cwd: root, encoding: "utf8", windowsHide: true },
            );
            return {
              valid: result.status === 0,
              problems: [`${result.stdout || ""}${result.stderr || ""}`],
            };
          } finally {
            rmSync(directory, { recursive: true, force: true });
          }
        },
        "not an atomic metadata directory",
      ],
      [
        "agent DAG cycle",
        () => {
          const d = clone(fixture.documents.runtime);
          d.execution.agents[0].parentId = "specialist";
          return validateRuntimeSessionDocument(d, options);
        },
        "cycle",
      ],
      [
        "agent DAG width overrun",
        () => {
          const d = clone(fixture.documents.runtime);
          d.execution.maxParallelAgents = 1;
          d.execution.agents.push({
            id: "specialist-two",
            role: "specialist",
            parentId: "orchestrator",
          });
          d.execution.fanIn.push({
            childId: "specialist-two",
            parentId: "orchestrator",
            status: "joined",
            inputSha256: D("specialist-two-input"),
            outputSha256: D("specialist-two-output"),
            joinedAt: GENERATED,
          });
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "DAG width",
      ],
      [
        "fan-in parent substitution",
        () => {
          const d = clone(fixture.documents.runtime);
          d.execution.fanIn[0].parentId = "specialist";
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "parent-bound",
      ],
      [
        "hook bypass",
        () => {
          const d = clone(fixture.documents.runtime);
          d.hookReceipts = d.hookReceipts.filter(
            (entry) => entry.hook !== "before-deploy",
          );
          return validateRuntimeSessionDocument(d, options);
        },
        "before-deploy",
      ],
      [
        "capability escalation",
        () => {
          const d = clone(fixture.documents.runtime);
          d.capabilityPolicy.grants[0].resource = "root";
          return validateRuntimeSessionDocument(d, options);
        },
        "capability grant",
      ],
      [
        "unknown runtime tool",
        () => {
          const d = clone(fixture.documents.runtime);
          d.toolCallReceipts[0].toolId = "unregistered-tool";
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "unknown tool",
      ],
      [
        "context budget overrun",
        () => {
          const d = clone(fixture.documents.runtime);
          d.context.tokensLoaded = 101;
          return validateRuntimeSessionDocument(d, options);
        },
        "context",
      ],
      [
        "context manifest count mismatch",
        () => {
          const d = clone(fixture.documents.runtime);
          d.context.tokensLoaded = 19;
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "exactly match the bound manifest budget",
      ],
      [
        "memory without expiry",
        () => {
          const d = clone(fixture.documents.runtime);
          delete d.memoryEvents[1].expiresAt;
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "future expiry",
      ],
      [
        "memory isolation crossover",
        () => {
          const d = clone(fixture.documents.runtime);
          d.memoryEvents.push({
            ...d.memoryEvents[0],
            action: "read",
            scope: "tenant",
            tenantId: "tenant-a",
            occurredAt: "2030-01-01T12:01:00.000Z",
          });
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "isolation boundary",
      ],
      [
        "memory owner substitution",
        () => {
          const d = clone(fixture.documents.runtime);
          d.memoryEvents.push({
            ...d.memoryEvents[0],
            action: "update",
            owner: "different-owner",
            occurredAt: "2030-01-01T12:01:00.000Z",
            expiresAt: "2030-02-02T00:00:00.000Z",
          });
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "cannot change owner",
      ],
      [
        "memory head rollback",
        () => {
          const d = clone(fixture.documents.runtime);
          d.memoryHeadReceipts[1].priorHeadSha256 = D("stale-memory-head");
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "commissioned empty head",
      ],
      [
        "runtime checkpoint rollback",
        () => {
          const statePath = path.join(root, "runtime", "driver-state.json");
          const original = readFileSync(statePath, "utf8");
          try {
            const state = JSON.parse(original);
            state.currentHeadSha256 = state.priorHeadSha256;
            writeJson(root, "runtime/driver-state.json", state);
            return validateRuntimeSessionDocument(
              fixture.documents.runtime,
              options,
            );
          } finally {
            writeFileSync(statePath, original);
          }
        },
        "runtime driver state digest does not match",
      ],
      [
        "coordinated runtime checkpoint rollback",
        () => {
          const statePath = path.join(root, "runtime", "driver-state.json");
          const driverPath = path.join(root, "runtime", "driver.json");
          const originalState = readFileSync(statePath, "utf8");
          const originalDriver = readFileSync(driverPath, "utf8");
          try {
            const current = JSON.parse(originalState);
            const rolledCheckpoint = current.checkpointHistory[1];
            const rolledState = {
              schema: current.schema,
              ...rolledCheckpoint,
              checkpointHistory: current.checkpointHistory.slice(0, 2),
            };
            writeJson(root, "runtime/driver-state.json", rolledState);
            const driver = JSON.parse(originalDriver);
            Object.assign(driver.state, rolledCheckpoint, {
              path: "runtime/driver-state.json",
              sha256: fileSha256(statePath),
            });
            driver.implementationReceipt.driverStateHeadSha256 =
              rolledState.currentHeadSha256;
            driver.implementationReceipt.driverStateDocumentSha256 =
              driver.state.sha256;
            writeJson(root, "runtime/driver.json", driver);
            const runtime = clone(fixture.documents.runtime);
            runtime.runtimeDriver.sha256 = fileSha256(driverPath);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(statePath, originalState);
            writeFileSync(driverPath, originalDriver);
          }
        },
        "signature is invalid",
      ],
      [
        "runtime checkpoint history gap",
        () => {
          const statePath = path.join(root, "runtime", "driver-state.json");
          const driverPath = path.join(root, "runtime", "driver.json");
          const originalState = readFileSync(statePath, "utf8");
          const originalDriver = readFileSync(driverPath, "utf8");
          try {
            const state = JSON.parse(originalState);
            state.checkpointHistory[1].checkpointRevision = 7;
            writeJson(root, "runtime/driver-state.json", state);
            const driver = JSON.parse(originalDriver);
            driver.state.sha256 = fileSha256(statePath);
            driver.implementationReceipt.driverStateDocumentSha256 =
              driver.state.sha256;
            writeJson(root, "runtime/driver.json", driver);
            const runtime = clone(fixture.documents.runtime);
            runtime.runtimeDriver.sha256 = fileSha256(driverPath);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(statePath, originalState);
            writeFileSync(driverPath, originalDriver);
          }
        },
        "gap-free digest chain",
      ],
      [
        "implementation receipt mutation mismatch",
        () => {
          const driverPath = path.join(root, "runtime", "driver.json");
          const original = readFileSync(driverPath, "utf8");
          try {
            const driver = JSON.parse(original);
            driver.implementationReceipt.afterTreeSha256 =
              driver.implementationReceipt.beforeTreeSha256;
            writeJson(root, "runtime/driver.json", driver);
            const d = clone(fixture.documents.runtime);
            d.runtimeDriver.sha256 = fileSha256(driverPath);
            d.sessionIdentitySha256 = runtimeSessionIdentity(d);
            return validateRuntimeSessionDocument(d, options);
          } finally {
            writeFileSync(driverPath, original);
          }
        },
        "changed implementation receipt did not change the tree",
      ],
      [
        "connector evidence substitution",
        () => {
          const d = clone(fixture.documents.runtime);
          d.connectors[0].conformanceEvidence.tests = [];
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "conformance evidence",
      ],
      [
        "self-asserted connector conformance",
        () => {
          const d = clone(fixture.documents.runtime);
          d.connectors[0].conformanceEvidence.tests = ["self-asserted-pass"];
          d.connectors[0].conformanceEvidenceSha256 = sha256(
            canonicalJson(d.connectors[0].conformanceEvidence),
          );
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "runtime conformance receipt does not bind",
      ],
      [
        "lifecycle cost overrun",
        () => {
          const d = clone(fixture.documents.runtime);
          d.costBudget.actual = 3;
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "costBudget",
      ],
      [
        "economics tool-call mismatch",
        () => {
          const ledgerPath = path.join(root, "runtime", "economics.json");
          const original = readFileSync(ledgerPath, "utf8");
          try {
            const ledger = JSON.parse(original);
            ledger.totals.toolCalls = 2;
            writeJson(root, "runtime/economics.json", ledger);
            const d = clone(fixture.documents.runtime);
            d.economicsLedger.sha256 = fileSha256(ledgerPath);
            d.sessionIdentitySha256 = runtimeSessionIdentity(d);
            return validateRuntimeSessionDocument(d, options);
          } finally {
            writeFileSync(ledgerPath, original);
          }
        },
        "tool-call count does not match",
      ],
      [
        "economics first-pass trajectory mismatch",
        () => {
          const ledgerPath = path.join(root, "runtime", "economics.json");
          const original = readFileSync(ledgerPath, "utf8");
          try {
            const ledger = JSON.parse(original);
            ledger.firstPassSuccess.currentRunFirstPass = false;
            writeJson(root, "runtime/economics.json", ledger);
            const d = clone(fixture.documents.runtime);
            d.economicsLedger.sha256 = fileSha256(ledgerPath);
            d.sessionIdentitySha256 = runtimeSessionIdentity(d);
            return validateRuntimeSessionDocument(d, options);
          } finally {
            writeFileSync(ledgerPath, original);
          }
        },
        "current-run first-pass result does not match",
      ],
      [
        "trace substitution",
        () => {
          const d = clone(fixture.documents.runtime);
          d.traceReceipt.sessionIdentitySha256 = D("other-session");
          return validateRuntimeSessionDocument(d, options);
        },
        "does not bind",
      ],
      [
        "trace identity omission",
        () => {
          const d = clone(fixture.documents.runtime);
          delete d.traceReceipt.traceId;
          return validateRuntimeSessionDocument(d, options);
        },
        "observable trace",
      ],
      [
        "observable trace byte substitution",
        () => {
          const tracePath = path.join(root, "trajectory-trace.jsonl");
          const original = readFileSync(tracePath, "utf8");
          try {
            writeFileSync(
              tracePath,
              `${original}${JSON.stringify({
                eventId: "trace-event-2",
                occurredAt: GENERATED,
                type: "substituted-action",
              })}\n`,
            );
            return validateRuntimeSessionDocument(
              fixture.documents.runtime,
              options,
            );
          } finally {
            writeFileSync(tracePath, original);
          }
        },
        "trace receipt artifacts are invalid",
      ],
      [
        "observable trace event replay",
        () => {
          const tracePath = path.join(root, "trajectory-trace.jsonl");
          const original = readFileSync(tracePath, "utf8");
          try {
            const events = original
              .trim()
              .split(/\r?\n/u)
              .map((line) => JSON.parse(line));
            events[1].eventId = events[0].eventId;
            delete events[1].eventSha256;
            events[1].eventSha256 = sha256(canonicalJson(events[1]));
            writeFileSync(
              tracePath,
              `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
            );
            return validateRuntimeSessionDocument(
              fixture.documents.runtime,
              options,
            );
          } finally {
            writeFileSync(tracePath, original);
          }
        },
        "trace receipt artifacts are invalid",
      ],
      [
        "observable trace sequence gap",
        () => {
          const tracePath = path.join(root, "trajectory-trace.jsonl");
          const original = readFileSync(tracePath, "utf8");
          try {
            const events = original
              .trim()
              .split(/\r?\n/u)
              .map((line) => JSON.parse(line));
            events[1].sequence = 3;
            delete events[1].eventSha256;
            events[1].eventSha256 = sha256(canonicalJson(events[1]));
            writeFileSync(
              tracePath,
              `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
            );
            return validateRuntimeSessionDocument(
              fixture.documents.runtime,
              options,
            );
          } finally {
            writeFileSync(tracePath, original);
          }
        },
        "trace receipt artifacts are invalid",
      ],
      [
        "observable trace event reorder",
        () => {
          const tracePath = path.join(root, "trajectory-trace.jsonl");
          const original = readFileSync(tracePath, "utf8");
          try {
            let priorEventSha256 =
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
            const events = original
              .trim()
              .split(/\r?\n/u)
              .map((line) => JSON.parse(line))
              .reverse()
              .map((event, index) => {
                const reordered = {
                  ...event,
                  sequence: index + 1,
                  priorEventSha256,
                };
                delete reordered.eventSha256;
                reordered.eventSha256 = sha256(canonicalJson(reordered));
                priorEventSha256 = reordered.eventSha256;
                return reordered;
              });
            writeFileSync(
              tracePath,
              `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
            );
            return validateRuntimeSessionDocument(
              fixture.documents.runtime,
              options,
            );
          } finally {
            writeFileSync(tracePath, original);
          }
        },
        "trace receipt artifacts are invalid",
      ],
      [
        "model-routing provider omission",
        () => {
          const d = clone(fixture.documents.runtime);
          delete d.modelRouting.receipt.providerSha256;
          return validateRuntimeSessionDocument(d, options);
        },
        "model-routing receipt",
      ],
      [
        "model-routing capability substitution",
        () => {
          const d = clone(fixture.documents.runtime);
          d.modelRouting.minimumCapabilitySha256 = D("weaker-capability");
          d.sessionIdentitySha256 = runtimeSessionIdentity(d);
          return validateRuntimeSessionDocument(d, options);
        },
        "minimum capability",
      ],
      [
        "usage currency substitution",
        () => {
          const d = clone(fixture.documents.runtime);
          d.usageReceipt.currency = "EUR";
          return validateRuntimeSessionDocument(d, options);
        },
        "token counts, cost, currency",
      ],
      [
        "ambient secret inheritance",
        () => {
          const d = clone(fixture.documents.runtime);
          d.executorReceipt.inheritAmbientSecrets = true;
          return validateRuntimeSessionDocument(d, options);
        },
        "isolation policy",
      ],
      [
        "source mutation",
        () => {
          const d = clone(fixture.documents.runtime);
          d.executorReceipt.mutationResult = "restored-after-mutation";
          return validateRuntimeSessionDocument(d, options);
        },
        "frozen immutable source image",
      ],
      [
        "executor identity omission",
        () => {
          const d = clone(fixture.documents.runtime);
          delete d.executorReceipt.imageSha256;
          return validateRuntimeSessionDocument(d, options);
        },
        "does not bind raw source manifest",
      ],
      [
        "stale bridge head",
        () => {
          const d = clone(fixture.documents.runtime);
          d.bridgeHeadReceipt.currentHeadSha256 =
            d.bridgeHeadReceipt.priorHeadSha256;
          return validateRuntimeSessionDocument(d, options);
        },
        "advance the head",
      ],
      [
        "bridge provider omission",
        () => {
          const d = clone(fixture.documents.runtime);
          delete d.bridgeHeadReceipt.providerReceiptSha256;
          return validateRuntimeSessionDocument(d, options);
        },
        "provider identity and provider receipt",
      ],
      [
        "bridge unprotected provider target",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.protectionObservations[1].proof.forcePushDisabled = false;
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge proposal identity omission",
        () => {
          const runtime = clone(fixture.documents.runtime);
          delete runtime.bridgeHeadReceipt.providerProof.proposalCommitSha;
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge commissioned check app substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.commissionedCheck.appId += 1;
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge hostname substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.hostname =
            "other.github.example.invalid";
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge operation identity omission",
        () => {
          const runtime = clone(fixture.documents.runtime);
          delete runtime.bridgeHeadReceipt.providerProof.operationId;
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge expected history substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.priorHistorySha256 = D(
            "substituted-prior-history",
          );
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge receipt root substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.receiptRootIdentitySha256 = D(
            "substituted-receipt-root",
          );
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge protection phase omission",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.protectionObservations.pop();
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge cleanup failure evidence omission",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.providerProof.cleanup = {
            attempts: 1,
            status: "pending",
          };
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge check attestation omission",
        () => {
          const runtime = clone(fixture.documents.runtime);
          delete runtime.bridgeHeadReceipt.providerProof.commissionedCheck
            .attestationSha256;
          return validateRuntimeSessionDocument(
            rebindGithubBridgeProof(runtime),
            options,
          );
        },
        "does not prove the commissioned protected target",
      ],
      [
        "bridge arbitrary target substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.targetSha256 = D("arbitrary-head-target");
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "exact commissioned provider target",
      ],
      [
        "unknown interop",
        () => {
          const d = clone(fixture.documents.runtime);
          d.interop[0].protocol = "unknown";
          return validateRuntimeSessionDocument(d, options);
        },
        "interop",
      ],
      [
        "incomplete interop transcript",
        () => {
          const transcriptPath = path.join(
            root,
            "runtime",
            "interop",
            "mcp.json",
          );
          const original = readFileSync(transcriptPath, "utf8");
          try {
            const transcript = JSON.parse(original);
            transcript.tests = transcript.tests.filter(
              (test) => test.id !== "replay-protection",
            );
            writeJson(root, "runtime/interop/mcp.json", transcript);
            const d = clone(fixture.documents.runtime);
            d.interop[0].transcript.sha256 = fileSha256(transcriptPath);
            d.sessionIdentitySha256 = runtimeSessionIdentity(d);
            return validateRuntimeSessionDocument(d, options);
          } finally {
            writeFileSync(transcriptPath, original);
          }
        },
        "missing replay-protection",
      ],
      [
        "review coverage omission",
        () => {
          const d = clone(fixture.documents.changeReview);
          d.coverage = ["diff"];
          return validateChangeReviewDocument(d, {
            policy: POLICY,
            repoRoot: root,
          });
        },
        "missing required coverage",
      ],
      [
        "forged Git review diff",
        () => {
          const d = clone(fixture.documents.changeReview);
          d.diffSha256 = D("forged-diff");
          return validateChangeReviewDocument(d, {
            policy: POLICY,
            repoRoot: root,
          });
        },
        "actual Git diff",
      ],
      [
        "untrusted dependency provenance",
        () => {
          const d = clone(fixture.documents.changeReview);
          d.dependencyProvenance[0].confusableNameCheck = "failed";
          return validateChangeReviewDocument(d, {
            policy: POLICY,
            repoRoot: root,
          });
        },
        "invalid, duplicated, or unapproved",
      ],
      [
        "prototype evidence reuse",
        () => {
          const d = {
            ...subject("uash.promotion-receipt.v1"),
            sourceStage: "prototype",
            targetStage: "production",
            sourceRunSha256: D("same"),
            productionBuildSha256: D("build"),
            semanticProofSha256: D("same"),
            rollbackPlanSha256: D("rollback"),
            targetEnvironment: "production",
            assuranceLevel: "semantic",
          };
          return validatePromotionReceiptDocument(d, { level: "semantic" });
        },
        "reuse prototype evidence",
      ],
      [
        "automatic harness learning",
        () => {
          const d = {
            ...subject("uash.harness-learning.v1"),
            failureSha256: D("failure"),
            rcaSha256: D("rca"),
            causeClusterSha256: D("cluster"),
            regressionCaseSha256: D("case"),
            changeSha256: D("change"),
            reviewSha256: D("review"),
            rollbackSha256: D("rollback"),
            changeKind: "harness-rule",
            expiresAt: "2099-01-01T00:00:00.000Z",
            rollbackCondition: "regression",
            autoApplied: true,
          };
          return validateLearningReceiptDocument(d, {
            level: "semantic",
            now: NOW,
          });
        },
        "cannot auto-apply",
      ],
      [
        "self-declared production promotion applicability",
        () => {
          const d = clone(fixture.closure);
          d.applicability.targetEnvironment = "production";
          return validateAuthoritativeClosureDocument(d, root, options);
        },
        "derived exactly from immutable route facts",
      ],
      [
        "self-declared harness-learning applicability",
        () => {
          const d = clone(fixture.closure);
          d.applicability.changeKinds = ["harness-rule"];
          return validateAuthoritativeClosureDocument(d, root, options);
        },
        "derived exactly from immutable route facts",
      ],
      [
        "catalog snapshot drift",
        () => {
          const d = clone(fixture.closure);
          d.catalogSnapshots[0].document.description = "tampered";
          return validateAuthoritativeClosureDocument(d, root, options);
        },
        "catalogSnapshots",
      ],
      [
        "evaluation result omission",
        () => {
          const d = clone(fixture.closure);
          delete d.evaluationEvidence.smoke;
          return validateAuthoritativeClosureDocument(d, root, options);
        },
        "evaluationEvidence.smoke binding is invalid",
      ],
      [
        "noncanonical fake evaluation artifact",
        () => {
          const d = clone(fixture.closure);
          d.evaluationEvidence.results.path = "evals/fake-results.json";
          return validateAuthoritativeClosureDocument(d, root, options);
        },
        "must use canonical path evals/results.json",
      ],
      [
        "executor accepted-proof substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.proofInputSetSha256 = D("different-proof");
          writeJson(root, V09_CANONICAL_ARTIFACTS.runtime, runtime);
          const d = clone(fixture.closure);
          d.artifacts.runtime.sha256 = fileSha256(
            path.join(root, ...V09_CANONICAL_ARTIFACTS.runtime.split("/")),
          );
          const result = validateAuthoritativeClosureDocument(d, root, options);
          writeJson(
            root,
            V09_CANONICAL_ARTIFACTS.runtime,
            fixture.documents.runtime,
          );
          return result;
        },
        "accepted gate, semantic, review, routing, and evaluation proof inputs",
      ],
      [
        "AI identity substitution",
        () => {
          const semantic = clone(fixture.documents.semantic);
          semantic.aiWorkloadIdentity.evaluationPlanSha256 =
            D("substituted-plan");
          writeJson(root, V09_CANONICAL_ARTIFACTS.semantic, semantic);
          const d = clone(fixture.closure);
          d.artifacts.semantic.sha256 = fileSha256(
            path.join(root, ...V09_CANONICAL_ARTIFACTS.semantic.split("/")),
          );
          const result = validateAuthoritativeClosureDocument(d, root, options);
          writeJson(
            root,
            V09_CANONICAL_ARTIFACTS.semantic,
            fixture.documents.semantic,
          );
          return result;
        },
        "substituted",
      ],
      [
        "model task-class downgrade",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.modelRouting.taskClass = "docs";
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          writeJson(root, V09_CANONICAL_ARTIFACTS.runtime, runtime);
          const d = clone(fixture.closure);
          d.artifacts.runtime.sha256 = fileSha256(
            path.join(root, ...V09_CANONICAL_ARTIFACTS.runtime.split("/")),
          );
          const result = validateAuthoritativeClosureDocument(d, root, options);
          writeJson(
            root,
            V09_CANONICAL_ARTIFACTS.runtime,
            fixture.documents.runtime,
          );
          return result;
        },
        "task class",
      ],
      ...[
        "promptSha256",
        "toolSetSha256",
        "corpusSha256",
        "memoryPolicySha256",
        "smokeTestSha256",
        "observabilityPolicySha256",
      ].map((field) => [
        `AI ${field} substitution`,
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.aiRuntimeIdentity[field] = D(`substituted-${field}`);
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          writeJson(root, V09_CANONICAL_ARTIFACTS.runtime, runtime);
          const d = clone(fixture.closure);
          d.artifacts.runtime.sha256 = fileSha256(
            path.join(root, ...V09_CANONICAL_ARTIFACTS.runtime.split("/")),
          );
          const result = validateAuthoritativeClosureDocument(d, root, options);
          writeJson(
            root,
            V09_CANONICAL_ARTIFACTS.runtime,
            fixture.documents.runtime,
          );
          return result;
        },
        "AI workload identities",
      ]),
      [
        "tool capability grant omission",
        () => {
          const registryPath = path.join(root, "runtime", "tool-registry.json");
          const original = readFileSync(registryPath, "utf8");
          try {
            const registry = JSON.parse(original);
            registry.tools[0].scopes.capabilities = ["deploy"];
            writeJson(root, "runtime/tool-registry.json", registry);
            const runtime = clone(fixture.documents.runtime);
            runtime.toolRegistry.sha256 = fileSha256(registryPath);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(registryPath, original);
          }
        },
        "lacks the commissioned capability resource grant deploy",
      ],
      [
        "tool data-scope grant omission",
        () => {
          const registryPath = path.join(root, "runtime", "tool-registry.json");
          const original = readFileSync(registryPath, "utf8");
          try {
            const registry = JSON.parse(original);
            registry.tools[0].scopes.data = ["restricted-secrets"];
            writeJson(root, "runtime/tool-registry.json", registry);
            const runtime = clone(fixture.documents.runtime);
            runtime.toolRegistry.sha256 = fileSha256(registryPath);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(registryPath, original);
          }
        },
        "lacks the commissioned data resource grant restricted-secrets",
      ],
      [
        "tool hook receipt substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.toolCallReceipts[0].beforeHookSha256 = D("forged-hook");
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "before-tool hook receipt is not an enforced call-bound allow decision",
      ],
      [
        "tool hook deny substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          const hook = runtime.hookReceipts.find(
            (entry) =>
              entry.eventId === runtime.toolCallReceipts[0].beforeHookEventId,
          );
          hook.outcome = "deny";
          runtime.toolCallReceipts[0].beforeHookSha256 = sha256(
            canonicalJson(hook),
          );
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "before-tool hook receipt is not an enforced call-bound allow decision",
      ],
      [
        "tool after-hook output substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          const hook = runtime.hookReceipts.find(
            (entry) =>
              entry.eventId === runtime.toolCallReceipts[0].afterHookEventId,
          );
          hook.outputSha256 = D("substituted-hook-output");
          runtime.toolCallReceipts[0].afterHookSha256 = sha256(
            canonicalJson(hook),
          );
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "after-tool hook receipt is not an enforced call-bound allow decision",
      ],
      [
        "fabricated consequential tool approval",
        () => {
          const registryPath = path.join(root, "runtime", "tool-registry.json");
          const original = readFileSync(registryPath, "utf8");
          try {
            const registry = JSON.parse(original);
            registry.tools[0].approvalRule = "human-required";
            writeJson(root, "runtime/tool-registry.json", registry);
            const runtime = clone(fixture.documents.runtime);
            runtime.toolRegistry.sha256 = fileSha256(registryPath);
            runtime.toolCallReceipts[0].approvalReceiptEventId =
              "fake-approval";
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(registryPath, original);
          }
        },
        "lacks trusted human approval",
      ],
      [
        "missing green acceptance result",
        () => {
          const target = path.join(root, "run", "acceptance-results.json");
          const original = readFileSync(target, "utf8");
          try {
            const acceptance = JSON.parse(original);
            acceptance.tests = [];
            writeJson(root, "run/acceptance-results.json", acceptance);
            const runtime = clone(fixture.documents.runtime);
            runtime.acceptanceResults.sha256 = fileSha256(target);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(target, original);
          }
        },
        "required acceptance test red-001 has no passing result",
      ],
      [
        "self-asserted green acceptance evidence",
        () => {
          const acceptancePath = path.join(
            root,
            "run",
            "acceptance-results.json",
          );
          const evidencePath = path.join(root, "tests", "green-red-001.json");
          const originalAcceptance = readFileSync(acceptancePath, "utf8");
          const originalEvidence = readFileSync(evidencePath, "utf8");
          try {
            writeFileSync(
              evidencePath,
              `${JSON.stringify({ status: "passed", testId: "red-001" })}\n`,
            );
            const acceptance = JSON.parse(originalAcceptance);
            acceptance.tests[0].evidenceSha256 = fileSha256(evidencePath);
            writeJson(root, "run/acceptance-results.json", acceptance);
            const runtime = clone(fixture.documents.runtime);
            runtime.acceptanceResults.sha256 = fileSha256(acceptancePath);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(acceptancePath, originalAcceptance);
            writeFileSync(evidencePath, originalEvidence);
          }
        },
        "must bind a passing native portable proof",
      ],
      [
        "acceptance eval-suite membership substitution",
        () => {
          const acceptancePath = path.join(
            root,
            "run",
            "acceptance-results.json",
          );
          const original = readFileSync(acceptancePath, "utf8");
          try {
            const acceptance = JSON.parse(original);
            acceptance.evalSuites[0].id = "uncommissioned-suite";
            writeJson(root, "run/acceptance-results.json", acceptance);
            const runtime = clone(fixture.documents.runtime);
            runtime.acceptanceResults.sha256 = fileSha256(acceptancePath);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(acceptancePath, original);
          }
        },
        "must bind a passing native eval result containing that commissioned suite",
      ],
      [
        "omitted reconstructed dependency",
        () => {
          const review = clone(fixture.documents.changeReview);
          review.dependencies = [];
          review.dependencyProvenance = [];
          return validateChangeReviewDocument(review, {
            policy: POLICY,
            repoRoot: root,
            readiness: fixture.documents.readiness,
          });
        },
        "do not exactly match the reconstructed lockfile delta",
      ],
      [
        "model judge identity substitution",
        () => {
          const evaluation = clone(calibratedEval);
          evaluation.suites[0].evaluator.judgeIdentity.modelSha256 = D(
            "substituted-judge-model",
          );
          return validateEvalResultsDocument(evaluation, {
            repoRoot: root,
            now: NOW,
          });
        },
        "calibration does not match the evaluator judge identity",
      ],
      [
        "invented prior memory head",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.priorMemoryHeadReceipts = [];
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "must bind a trusted prior-session memory head receipt",
      ],
      [
        "prior memory provider substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.memoryHeadReceipts[0].providerSha256 = D(
            "substituted-memory-provider",
          );
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "must bind a trusted prior-session memory head receipt",
      ],
      [
        "prior memory content substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.priorMemoryHeadReceipts[0].contentSha256 = D(
            "substituted-prior-memory-content",
          );
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "must bind a trusted prior-session memory head receipt",
      ],
      [
        "prior memory source-session substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.memoryHeadReceipts[0].sourceSessionIdentitySha256 = D(
            "substituted-source-session",
          );
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "must bind a trusted prior-session memory head receipt",
      ],
      [
        "interop capability substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.interop[0].capabilities = ["tools", "prompts"];
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "capability set does not match runtime declaration",
      ],
      [
        "duplicate interop protocol",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.interop.push(clone(runtime.interop[0]));
          runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
          return validateRuntimeSessionDocument(runtime, options);
        },
        "duplicates interop protocol",
      ],
      [
        "decision evidence detached from trace",
        () => {
          const target = path.join(root, "runtime", "decision-evidence.json");
          const original = readFileSync(target, "utf8");
          try {
            const decision = JSON.parse(original);
            decision.decisions[0].evidenceSha256 = D("detached-decision");
            writeJson(root, "runtime/decision-evidence.json", decision);
            const runtime = clone(fixture.documents.runtime);
            runtime.traceReceipt.decisionEvidence.sha256 = fileSha256(target);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(target, original);
          }
        },
        "do not exactly cover the bound decision evidence",
      ],
      [
        "economics model breakdown mismatch",
        () => {
          const target = path.join(root, "runtime", "economics.json");
          const original = readFileSync(target, "utf8");
          try {
            const economics = JSON.parse(original);
            economics.modelUsage[0].cost = 0.5;
            writeJson(root, "runtime/economics.json", economics);
            const runtime = clone(fixture.documents.runtime);
            runtime.economicsLedger.sha256 = fileSha256(target);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(target, original);
          }
        },
        "model usage does not reconcile",
      ],
      [
        "economics billing receipt substitution",
        () => {
          const target = path.join(root, "runtime", "economics.json");
          const original = readFileSync(target, "utf8");
          try {
            const economics = JSON.parse(original);
            economics.providerBillingReceiptSha256 = D(
              "substituted-provider-billing",
            );
            writeJson(root, "runtime/economics.json", economics);
            const runtime = clone(fixture.documents.runtime);
            runtime.economicsLedger.sha256 = fileSha256(target);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(target, original);
          }
        },
        "usage and billing identity do not match the signed usage receipt",
      ],
      [
        "economics tool usage omission",
        () => {
          const target = path.join(root, "runtime", "economics.json");
          const original = readFileSync(target, "utf8");
          try {
            const economics = JSON.parse(original);
            economics.toolUsage = [];
            writeJson(root, "runtime/economics.json", economics);
            const runtime = clone(fixture.documents.runtime);
            runtime.economicsLedger.sha256 = fileSha256(target);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(target, original);
          }
        },
        "does not exactly cover runtime tool-call receipts",
      ],
      [
        "economics tool provider substitution",
        () => {
          const target = path.join(root, "runtime", "economics.json");
          const original = readFileSync(target, "utf8");
          try {
            const economics = JSON.parse(original);
            economics.toolUsage[0].providerSha256 = D(
              "substituted-tool-provider",
            );
            writeJson(root, "runtime/economics.json", economics);
            const runtime = clone(fixture.documents.runtime);
            runtime.economicsLedger.sha256 = fileSha256(target);
            runtime.sessionIdentitySha256 = runtimeSessionIdentity(runtime);
            return validateRuntimeSessionDocument(runtime, options);
          } finally {
            writeFileSync(target, original);
          }
        },
        "detached from a runtime tool call",
      ],
      [
        "service-authored semantic approval",
        () => {
          const semantic = clone(fixture.documents.semantic);
          semantic.approvalReceipts[0].actor.type = "service";
          return validateSemanticAssuranceDocument(semantic, options);
        },
        "must be issued by a human actor",
      ],
      [
        "executor command substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.commandIdentitySha256 = D(
            "substituted-executor-command",
          );
          return validateRuntimeSessionDocument(runtime, options);
        },
        "substituted a commissioned command",
      ],
      [
        "executor validator-set substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.validatorSha256 = D(
            "substituted-executor-validator-set",
          );
          return validateRuntimeSessionDocument(runtime, options);
        },
        "substituted a commissioned command",
      ],
      [
        "executor image substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.imageSha256 = D("substituted-executor-image");
          return validateRuntimeSessionDocument(runtime, options);
        },
        "substituted a commissioned command",
      ],
      [
        "executor live-worktree mount substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.liveWorktreeMount = true;
          return validateRuntimeSessionDocument(runtime, options);
        },
        "violates isolation policy",
      ],
      [
        "executor output-root policy substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.outputRootPolicySha256 = D(
            "substituted-output-root-policy",
          );
          return validateRuntimeSessionDocument(runtime, options);
        },
        "substituted a commissioned command",
      ],
      [
        "executor output-root stable identity substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.outputRootIdentitySha256 = D(
            "substituted-output-root-identity",
          );
          return validateRuntimeSessionDocument(runtime, options);
        },
        "violates isolation policy",
      ],
      [
        "executor raw-tree manifest substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.sourceSnapshotManifest.entries[0].size += 1;
          return validateRuntimeSessionDocument(runtime, options);
        },
        "raw Git tree manifest is invalid",
      ],
      [
        "executor runtime binary substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.runtimeCliSha256 = D(
            "substituted-runtime-binary",
          );
          return validateRuntimeSessionDocument(runtime, options);
        },
        "substituted a commissioned command",
      ],
      [
        "executor daemon identity substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.daemonIdentity.daemonId =
            "substituted-daemon";
          return validateRuntimeSessionDocument(runtime, options);
        },
        "daemon identity is invalid",
      ],
      [
        "executor container identity substitution",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.executorReceipt.containerIdentity = "name-only";
          return validateRuntimeSessionDocument(runtime, options);
        },
        "violates isolation policy",
      ],
      [
        "unrelated rollback head subject",
        () => {
          const runtime = clone(fixture.documents.runtime);
          runtime.bridgeHeadReceipt.currentHeadSha256 = D("unrelated-subject");
          runtime.bridgeHeadReceipt.subjectSha256 = D("unrelated-subject");
          writeJson(root, V09_CANONICAL_ARTIFACTS.runtime, runtime);
          const closure = clone(fixture.closure);
          closure.artifacts.runtime.sha256 = fileSha256(
            path.join(root, ...V09_CANONICAL_ARTIFACTS.runtime.split("/")),
          );
          const result = validateAuthoritativeClosureDocument(
            closure,
            root,
            options,
          );
          writeJson(
            root,
            V09_CANONICAL_ARTIFACTS.runtime,
            fixture.documents.runtime,
          );
          return result;
        },
        "does not bind the accepted authoritative proof input set",
      ],
      [
        "self-selected change-review base",
        () => {
          const review = clone(fixture.documents.changeReview);
          review.baseCommit = review.headCommit;
          review.baseCommitSha256 = sha256(review.headCommit);
          review.changedPaths = [];
          review.lockfilePaths = [];
          review.diffSha256 = sha256(Buffer.alloc(0));
          return validateChangeReviewDocument(review, {
            policy: POLICY,
            repoRoot: root,
            readiness: fixture.documents.readiness,
          });
        },
        "sealed pre-implementation fixed point",
      ],
      [
        "unresolved change-review finding",
        () => {
          const review = clone(fixture.documents.changeReview);
          review.findings[0].status = "open";
          delete review.findings[0].resolutionEvidenceSha256;
          return validateChangeReviewDocument(review, {
            policy: POLICY,
            repoRoot: root,
            readiness: fixture.documents.readiness,
          });
        },
        "unresolved open finding",
      ],
      [
        "executor no-op output",
        () => {
          try {
            materializeVerifiedOutputEnvelope(
              "true\n",
              path.join(root, "executor-no-op-output"),
              {
                runId: RUN_ID,
                semanticProofSetSha256: D("semantic"),
                proofInputSetSha256: D("proof-input"),
                acceptedGateArtifactsSha256: D("gates"),
                validatorSha256: D("validator"),
                outputBytes: 1024,
              },
              { commit: COMMIT },
            );
            return { valid: true, problems: [] };
          } catch (error) {
            return { valid: false, problems: [error.message] };
          }
        },
        "output envelope identity or status is invalid",
      ],
      [
        "executor result-envelope byte overflow",
        () => {
          const semantic = { kind: "semantic" };
          const proofInput = { kind: "proof-input" };
          const gates = { kind: "accepted-gates" };
          const outputRoot = path.join(root, "executor-byte-overflow-output");
          try {
            materializeVerifiedOutputEnvelope(
              JSON.stringify({
                schema: "valdris.proof-executor-output.v1",
                runId: RUN_ID,
                sourceCommit: COMMIT,
                status: "passed",
                validatorSha256: D("validator"),
                semanticProofArtifacts: [manifestArtifact(semantic)],
                proofInputArtifacts: [manifestArtifact(proofInput)],
                acceptedGateArtifacts: [manifestArtifact(gates)],
              }),
              outputRoot,
              {
                runId: RUN_ID,
                semanticProofSetSha256: sha256(canonicalJson(semantic)),
                proofInputSetSha256: sha256(canonicalJson(proofInput)),
                acceptedGateArtifactsSha256: sha256(canonicalJson(gates)),
                validatorSha256: D("validator"),
                outputBytes: 1,
              },
              { commit: COMMIT },
            );
            return { valid: true, problems: [] };
          } catch (error) {
            return { valid: false, problems: [error.message] };
          } finally {
            rmSync(outputRoot, { recursive: true, force: true });
          }
        },
        "commissioned byte limit",
      ],
      [
        "executor artifact-id path traversal",
        () => {
          const emptySha256 = sha256(Buffer.alloc(0));
          const maliciousId = "a/../../../escaped-executor-artifact";
          const maliciousArtifact = {
            id: maliciousId,
            sha256: emptySha256,
            contentBase64: "",
          };
          const semantic = { kind: "semantic" };
          const proofInput = { kind: "proof-input" };
          const gates = { kind: "accepted-gates" };
          const outputRoot = path.join(root, "executor-traversal-output");
          const escaped = path.join(root, "escaped-executor-artifact.bin");
          try {
            materializeVerifiedOutputEnvelope(
              JSON.stringify({
                schema: "valdris.proof-executor-output.v1",
                runId: RUN_ID,
                sourceCommit: COMMIT,
                status: "passed",
                validatorSha256: D("validator"),
                semanticProofArtifacts: [
                  manifestArtifact(semantic),
                  maliciousArtifact,
                ],
                proofInputArtifacts: [manifestArtifact(proofInput)],
                acceptedGateArtifacts: [manifestArtifact(gates)],
              }),
              outputRoot,
              {
                runId: RUN_ID,
                semanticProofSetSha256: sha256(canonicalJson(semantic)),
                proofInputSetSha256: sha256(canonicalJson(proofInput)),
                acceptedGateArtifactsSha256: sha256(canonicalJson(gates)),
                validatorSha256: D("validator"),
                outputBytes: 16_384,
              },
              { commit: COMMIT },
            );
            return { valid: true, problems: [] };
          } catch (error) {
            return existsSync(escaped)
              ? { valid: true, problems: [] }
              : { valid: false, problems: [error.message] };
          } finally {
            rmSync(outputRoot, { recursive: true, force: true });
            rmSync(escaped, { force: true });
          }
        },
        "invalid or duplicated",
      ],
      [
        "executor artifact-id NTFS alternate data stream",
        () => artifactIdAttempt("evidence:payload", "executor-ads-output"),
        "invalid or duplicated",
      ],
      [
        "executor artifact-id Windows device name",
        () => artifactIdAttempt("CON", "executor-device-output"),
        "invalid or duplicated",
      ],
      [
        "executor precreated output-root swap",
        () => {
          const outputRoot = path.join(root, "executor-swapped-output");
          const outside = path.join(root, "executor-swapped-target");
          mkdirSync(outputRoot);
          mkdirSync(outside);
          rmSync(outputRoot, { recursive: true, force: true });
          try {
            symlinkSync(
              outside,
              outputRoot,
              process.platform === "win32" ? "junction" : "dir",
            );
            const semantic = { kind: "semantic" };
            const proofInput = { kind: "proof-input" };
            const gates = { kind: "accepted-gates" };
            materializeVerifiedOutputEnvelope(
              JSON.stringify({
                schema: "valdris.proof-executor-output.v1",
                runId: RUN_ID,
                sourceCommit: COMMIT,
                status: "passed",
                validatorSha256: D("validator"),
                semanticProofArtifacts: [manifestArtifact(semantic)],
                proofInputArtifacts: [manifestArtifact(proofInput)],
                acceptedGateArtifacts: [manifestArtifact(gates)],
              }),
              outputRoot,
              {
                runId: RUN_ID,
                semanticProofSetSha256: sha256(canonicalJson(semantic)),
                proofInputSetSha256: sha256(canonicalJson(proofInput)),
                acceptedGateArtifactsSha256: sha256(canonicalJson(gates)),
                validatorSha256: D("validator"),
                outputBytes: 16_384,
                precreatedOutputRoot: true,
              },
              { commit: COMMIT },
            );
            return { valid: true, problems: [] };
          } catch (error) {
            return readdirSync(outside).length > 0
              ? { valid: true, problems: [] }
              : { valid: false, problems: [error.message] };
          } finally {
            rmSync(outputRoot, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
          }
        },
        "precreated output root is missing, aliased, or not empty",
      ],
    ];
    for (const [label, run, expected] of cases)
      expectInvalid(rejected, label, run(), expected);
    const outsideClosure = writeJson(
      path.dirname(root),
      `${path.basename(root)}-outside.json`,
      fixture.closure,
    );
    expectInvalid(
      rejected,
      "standalone closure path escape",
      validateAuthoritativeAssurance(outsideClosure, options),
      "canonical path",
    );
    rmSync(outsideClosure, { force: true });
    const outsideContract = writeJson(
      path.dirname(root),
      `${path.basename(root)}-outside-contract.json`,
      fixture.documents.readiness,
    );
    expectProcessRejected(
      rejected,
      "standalone operating-contract path escape",
      spawnSync(
        process.execPath,
        [
          path.join(ROOT, "scripts", "operating-contract-gate.mjs"),
          "--repo",
          root,
          "--file",
          `../${path.basename(outsideContract)}`,
        ],
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "canonical repository-relative",
    );
    rmSync(outsideContract, { force: true });
    expectProcessRejected(
      rejected,
      "runtime-driver state path escape",
      spawnSync(
        process.execPath,
        [
          path.join(ROOT, "scripts", "runtime-driver-state.mjs"),
          "--repo",
          root,
          "--file",
          "../outside-driver-state.json",
          "--run-id",
          RUN_ID,
          "--status",
          "running",
          "--lease-owner",
          "codex-runtime",
          "--lease-id",
          "escape-lease",
          "--expected-head",
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "--write",
        ],
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "parent traversal components",
    );
    expectProcessRejected(
      rejected,
      "runtime-driver omitted CAS identity",
      spawnSync(
        process.execPath,
        [
          path.join(ROOT, "scripts", "runtime-driver-state.mjs"),
          "--repo",
          root,
          "--file",
          "runtime/omitted-cas-state.json",
          "--run-id",
          RUN_ID,
          "--status",
          "running",
          "--lease-owner",
          "codex-runtime",
        ],
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "--expected-head is required",
    );
    const runtimeDriverScript = path.join(
      ROOT,
      "scripts",
      "runtime-driver-state.mjs",
    );
    const emptyRuntimeHead =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const runtimeDriverWriteArgs = (
      relativePath,
      leaseId,
      expectedHead = emptyRuntimeHead,
    ) => [
      runtimeDriverScript,
      "--repo",
      root,
      "--file",
      relativePath,
      "--run-id",
      RUN_ID,
      "--status",
      "running",
      "--lease-owner",
      "codex-runtime",
      "--lease-id",
      leaseId,
      "--expected-head",
      expectedHead,
      "--write",
    ];
    const localRuntimeIdentity = runtimeDriverLocalIdentity();
    const writeRuntimeDriverLock = (relativePath, metadata) => {
      const lockRoot = path.join(root, `${relativePath}.lock`);
      mkdirSync(lockRoot, { recursive: true });
      writeJson(lockRoot, "owner.json", {
        schema: "valdris.runtime-driver-lock.v2",
        pid: metadata.pid,
        host: metadata.host || localRuntimeIdentity.host,
        hostId: metadata.hostId || localRuntimeIdentity.hostId,
        bootId: metadata.bootId || localRuntimeIdentity.bootId,
        processIdentity:
          metadata.processIdentity || localRuntimeIdentity.processIdentity,
        startedAt: metadata.startedAt,
        heartbeatAt: metadata.heartbeatAt || metadata.startedAt,
        expiresAt: metadata.expiresAt,
        lockTtlMs: metadata.lockTtlMs,
        nonce: metadata.nonce,
        fencingToken: metadata.fencingToken || D(`fence-${metadata.nonce}`),
        targetSha256: sha256(path.resolve(root, relativePath)),
      });
      return lockRoot;
    };
    const lockTtlMs = 15 * 60_000;
    const freshLockStartedAt = new Date(Date.now() - 60_000).toISOString();
    const freshLockExpiresAt = new Date(
      Date.parse(freshLockStartedAt) + lockTtlMs,
    ).toISOString();
    const expiredLockStartedAt = new Date(
      Date.now() - lockTtlMs - 2 * 60_000,
    ).toISOString();
    const expiredLockExpiresAt = new Date(
      Date.parse(expiredLockStartedAt) + lockTtlMs,
    ).toISOString();
    const deadPid = 2_147_483_647;

    const staleLocalFile = "runtime/stale-local-driver-state.json";
    const staleLocalNonce = D("stale-local-lock").slice(0, 32);
    writeRuntimeDriverLock(staleLocalFile, {
      pid: deadPid,
      host: hostname(),
      startedAt: freshLockStartedAt,
      expiresAt: freshLockExpiresAt,
      lockTtlMs,
      nonce: staleLocalNonce,
    });
    const staleLocalRecovery = spawnSync(
      process.execPath,
      runtimeDriverWriteArgs(staleLocalFile, "stale-local-lease"),
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (
      staleLocalRecovery.status !== 0 ||
      !existsSync(path.join(root, staleLocalFile)) ||
      existsSync(path.join(root, `${staleLocalFile}.lock`)) ||
      !existsSync(
        path.join(root, `${staleLocalFile}.lock.stale-${staleLocalNonce}`),
      )
    )
      throw new Error(
        `runtime-driver did not recover a crashed same-host lock: ${
          staleLocalRecovery.stderr || staleLocalRecovery.stdout
        }`,
      );

    const liveLocalFile = "runtime/live-local-driver-state.json";
    writeRuntimeDriverLock(liveLocalFile, {
      pid: process.pid,
      host: hostname(),
      startedAt: freshLockStartedAt,
      expiresAt: freshLockExpiresAt,
      lockTtlMs,
      nonce: D("live-local-lock").slice(0, 32),
    });
    expectProcessRejected(
      rejected,
      "runtime-driver live same-host lock",
      spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(liveLocalFile, "live-local-lease"),
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "runtime-driver state is locked by the exact live same-host writer",
    );

    const staleLiveLocalFile = "runtime/stale-live-local-driver-state.json";
    writeRuntimeDriverLock(staleLiveLocalFile, {
      pid: process.pid,
      startedAt: expiredLockStartedAt,
      expiresAt: expiredLockExpiresAt,
      lockTtlMs,
      nonce: D("stale-live-local-lock").slice(0, 32),
    });
    expectProcessRejected(
      rejected,
      "runtime-driver expired exact-live same-host lock",
      spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(staleLiveLocalFile, "stale-live-local-lease"),
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "runtime-driver state is locked by the exact live same-host writer",
    );

    const priorBootFile = "runtime/prior-boot-driver-state.json";
    const priorBootNonce = D("prior-boot-lock").slice(0, 32);
    writeRuntimeDriverLock(priorBootFile, {
      pid: process.pid,
      bootId: `${localRuntimeIdentity.bootId}-prior`,
      startedAt: freshLockStartedAt,
      expiresAt: freshLockExpiresAt,
      lockTtlMs,
      nonce: priorBootNonce,
    });
    const priorBootRecovery = spawnSync(
      process.execPath,
      runtimeDriverWriteArgs(priorBootFile, "prior-boot-lease"),
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (
      priorBootRecovery.status !== 0 ||
      !existsSync(path.join(root, priorBootFile)) ||
      existsSync(path.join(root, `${priorBootFile}.lock`)) ||
      !existsSync(
        path.join(root, `${priorBootFile}.lock.stale-${priorBootNonce}`),
      )
    )
      throw new Error(
        `runtime-driver did not recover a lock from a prior local boot: ${
          priorBootRecovery.stderr || priorBootRecovery.stdout
        }`,
      );

    const freshForeignFile = "runtime/fresh-foreign-driver-state.json";
    writeRuntimeDriverLock(freshForeignFile, {
      pid: deadPid,
      host: "foreign-host.example.invalid",
      hostId: "foreign-host-id:example-invalid",
      bootId: "foreign-boot-id:example-invalid",
      processIdentity: "foreign-process-created:example-invalid",
      startedAt: freshLockStartedAt,
      expiresAt: freshLockExpiresAt,
      lockTtlMs,
      nonce: D("fresh-foreign-lock").slice(0, 32),
    });
    expectProcessRejected(
      rejected,
      "runtime-driver fresh foreign-host lock",
      spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(freshForeignFile, "fresh-foreign-lease"),
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "runtime-driver state is locked by a foreign host",
    );

    const staleForeignFile = "runtime/stale-foreign-driver-state.json";
    writeRuntimeDriverLock(staleForeignFile, {
      pid: deadPid,
      host: "foreign-host.example.invalid",
      hostId: "foreign-host-id:example-invalid",
      bootId: "foreign-boot-id:example-invalid",
      processIdentity: "foreign-process-created:example-invalid",
      startedAt: expiredLockStartedAt,
      expiresAt: expiredLockExpiresAt,
      lockTtlMs,
      nonce: D("stale-foreign-lock").slice(0, 32),
    });
    expectProcessRejected(
      rejected,
      "runtime-driver expired foreign-host lock without external fencing",
      spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(staleForeignFile, "stale-foreign-lease"),
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "external fencing provider or explicit manual recovery is required",
    );

    const pausedWriterFile = "runtime/paused-writer-driver-state.json";
    const pausedWriterLock = path.join(root, `${pausedWriterFile}.lock`);
    const pausedWriter = spawn(
      process.execPath,
      runtimeDriverWriteArgs(pausedWriterFile, "paused-writer-lease"),
      {
        cwd: root,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          VALDRIS_RUNTIME_DRIVER_TEST_MODE: "1",
          VALDRIS_RUNTIME_DRIVER_TEST_PAUSE_AFTER_LOCK_MS: "30000",
        },
      },
    );
    const sleepSync = (milliseconds) =>
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        milliseconds,
      );
    const lockWaitDeadline = Date.now() + 10_000;
    while (!existsSync(pausedWriterLock) && Date.now() < lockWaitDeadline)
      sleepSync(25);
    if (!existsSync(pausedWriterLock)) {
      pausedWriter.kill("SIGTERM");
      throw new Error("runtime-driver paused writer did not acquire its lock");
    }
    expectProcessRejected(
      rejected,
      "runtime-driver two-writer pause fencing",
      spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(pausedWriterFile, "competing-writer-lease"),
        { cwd: root, encoding: "utf8", windowsHide: true },
      ),
      "runtime-driver state is locked by the exact live same-host writer",
    );
    pausedWriter.kill("SIGTERM");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("runtime-driver paused writer did not stop")),
        10_000,
      );
      pausedWriter.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      pausedWriter.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const pausedWriterRecovery = spawnSync(
      process.execPath,
      runtimeDriverWriteArgs(pausedWriterFile, "paused-writer-lease"),
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (
      pausedWriterRecovery.status !== 0 ||
      !existsSync(path.join(root, pausedWriterFile))
    )
      throw new Error(
        `runtime-driver did not recover the crashed paused writer: ${
          pausedWriterRecovery.stderr || pausedWriterRecovery.stdout
        }`,
      );

    const runtimeStateInput = (leaseId, expectedHead) => ({
      runId: RUN_ID,
      status: "running",
      leaseOwner: "codex-runtime",
      leaseId,
      expectedHead,
      leaseMinutes: 30,
    });
    const validRuntimeStateOne = nextRuntimeDriverState(
      null,
      runtimeStateInput("malformed-state-lease", emptyRuntimeHead),
      new Date(),
    );
    const validRuntimeStateTwo = nextRuntimeDriverState(
      validRuntimeStateOne,
      runtimeStateInput(
        "malformed-state-lease",
        validRuntimeStateOne.currentHeadSha256,
      ),
      new Date(Date.now() + 1_000),
    );
    const malformedRuntimeStates = [
      [
        "runtime-driver CLI rejects wrong state schema",
        (state) => {
          state.schema = "valdris.runtime-driver-state.invalid";
        },
      ],
      [
        "runtime-driver CLI rejects incomplete checkpoint history",
        (state) => {
          state.checkpointHistory.pop();
        },
      ],
      [
        "runtime-driver CLI rejects broken digest continuity",
        (state) => {
          state.checkpointHistory[1].priorHeadSha256 = D(
            "broken-runtime-prior-head",
          );
        },
      ],
      [
        "runtime-driver CLI rejects top-level latest mismatch",
        (state) => {
          state.leaseOwner = "different-runtime-owner";
        },
      ],
      [
        "runtime-driver CLI rejects invalid checkpoint status",
        (state) => {
          state.status = "unknown";
          state.checkpointHistory[1].status = "unknown";
        },
      ],
      [
        "runtime-driver CLI rejects wrong run subject",
        (state) => {
          state.runId = "EXAMPLE-OTHER-RUN";
        },
      ],
      [
        "runtime-driver CLI rejects unsupported state fields",
        (state) => {
          state.untrustedExtension = true;
        },
      ],
    ];
    for (const [index, [label, mutate]] of malformedRuntimeStates.entries()) {
      const relativePath = `runtime/malformed-driver-state-${index}.json`;
      const state = clone(validRuntimeStateTwo);
      mutate(state);
      writeJson(root, relativePath, state);
      expectProcessRejected(
        rejected,
        label,
        spawnSync(
          process.execPath,
          runtimeDriverWriteArgs(
            relativePath,
            "malformed-state-lease",
            state.currentHeadSha256,
          ),
          { cwd: root, encoding: "utf8", windowsHide: true },
        ),
        "existing runtime-driver state is invalid",
      );
    }

    const seedRuntimeState = (relativePath, leaseId) => {
      const state = nextRuntimeDriverState(
        null,
        runtimeStateInput(leaseId, emptyRuntimeHead),
        new Date(),
      );
      writeJson(root, relativePath, state);
      return state;
    };
    for (const [index, phase] of [
      "after-journal-fsync",
      "after-temp-fsync",
      "after-replace",
      "after-target-fsync",
      "after-parent-fsync",
      "during-commit-write",
    ].entries()) {
      const relativePath = `runtime/durability-fault-${index}.json`;
      const leaseId = `durability-fault-lease-${index}`;
      const initial = seedRuntimeState(relativePath, leaseId);
      const failed = spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(
          relativePath,
          leaseId,
          initial.currentHeadSha256,
        ),
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            VALDRIS_RUNTIME_DRIVER_TEST_MODE: "1",
            VALDRIS_RUNTIME_DRIVER_TEST_FAULT_PHASE: phase,
          },
        },
      );
      if (
        failed.status === 0 ||
        failed.stdout.includes('"ok": true') ||
        !failed.stderr.includes(`runtime-driver injected fault: ${phase}`)
      )
        throw new Error(
          `runtime-driver fault phase ${phase} reported success before durability`,
        );
      if (index === 0)
        expectProcessRejected(
          rejected,
          "runtime-driver dry-run refuses pending durability recovery",
          spawnSync(
            process.execPath,
            runtimeDriverWriteArgs(
              relativePath,
              leaseId,
              initial.currentHeadSha256,
            ).slice(0, -1),
            { cwd: root, encoding: "utf8", windowsHide: true },
          ),
          "pending durability journal",
        );
      const recovered = spawnSync(
        process.execPath,
        runtimeDriverWriteArgs(
          relativePath,
          leaseId,
          initial.currentHeadSha256,
        ),
        { cwd: root, encoding: "utf8", windowsHide: true },
      );
      const recoveredState = JSON.parse(
        readFileSync(path.join(root, relativePath), "utf8"),
      );
      const recoveredValidation =
        validateRuntimeDriverStateDocument(recoveredState);
      if (
        recovered.status !== 0 ||
        recoveredState.checkpointRevision !== 2 ||
        !recoveredValidation.valid ||
        existsSync(path.join(root, `${relativePath}.journal`))
      )
        throw new Error(
          `runtime-driver did not recover the last valid checkpoint after ${phase}: ${
            recovered.stderr ||
            recovered.stdout ||
            recoveredValidation.problems.join("; ")
          }`,
        );
    }

    const committedFaultFile = "runtime/durability-committed-fault.json";
    const committedFaultLease = "durability-committed-fault-lease";
    const committedInitial = seedRuntimeState(
      committedFaultFile,
      committedFaultLease,
    );
    const committedFault = spawnSync(
      process.execPath,
      runtimeDriverWriteArgs(
        committedFaultFile,
        committedFaultLease,
        committedInitial.currentHeadSha256,
      ),
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          VALDRIS_RUNTIME_DRIVER_TEST_MODE: "1",
          VALDRIS_RUNTIME_DRIVER_TEST_FAULT_PHASE: "after-commit-fsync",
        },
      },
    );
    const committedState = JSON.parse(
      readFileSync(path.join(root, committedFaultFile), "utf8"),
    );
    if (
      committedFault.status === 0 ||
      committedFault.stdout.includes('"ok": true') ||
      committedState.checkpointRevision !== 2 ||
      !validateRuntimeDriverStateDocument(committedState).valid
    )
      throw new Error(
        "runtime-driver commit-marker fault did not leave a durable, unreported checkpoint",
      );
    const committedRecovery = spawnSync(
      process.execPath,
      runtimeDriverWriteArgs(
        committedFaultFile,
        committedFaultLease,
        committedState.currentHeadSha256,
      ),
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    const committedRecoveredState = JSON.parse(
      readFileSync(path.join(root, committedFaultFile), "utf8"),
    );
    if (
      committedRecovery.status !== 0 ||
      committedRecoveredState.checkpointRevision !== 3 ||
      !validateRuntimeDriverStateDocument(committedRecoveredState).valid ||
      existsSync(path.join(root, `${committedFaultFile}.journal`))
    )
      throw new Error(
        `runtime-driver did not recover a durably committed journal: ${
          committedRecovery.stderr || committedRecovery.stdout
        }`,
      );

    let deadlineNow = 1_000;
    const deterministicDeadline = createExecutionDeadline(
      100,
      deadlineNow,
      () => deadlineNow,
    );
    if (
      deterministicDeadline.remaining("deterministic baseline") !== 100 ||
      deterministicDeadline.remaining("deterministic cleanup", {
        reserveCleanup: true,
      }) !== 90
    )
      throw new Error(
        "executor deadline does not reserve bounded cleanup time",
      );
    deadlineNow = 1_100;
    try {
      deterministicDeadline.assert("deterministic expiry");
      throw new Error("executor deadline unexpectedly accepted expired work");
    } catch (error) {
      if (!error.message.includes("total wall-clock deadline exceeded"))
        throw error;
    }

    const executorRepo = mkdtempSync(
      path.join(tmpdir(), "valdris-executor-source-"),
    );
    const executorParent = mkdtempSync(
      path.join(tmpdir(), "valdris-executor-output-"),
    );
    secureVerifierOperatorRoot(executorParent);
    const executorParentIdentity = assertOperatorRootSecurity(executorParent);
    try {
      writeFileSync(path.join(executorRepo, "README.md"), "executor fixture\n");
      git(executorRepo, ["init", "-q"]);
      git(executorRepo, ["config", "user.name", "Valdris Test"]);
      git(executorRepo, ["config", "user.email", "valdris@example.invalid"]);
      git(executorRepo, ["add", "."]);
      git(executorRepo, ["commit", "-qm", "executor fixture"]);
      const attributesPath = path.join(executorRepo, ".gitattributes");
      writeFileSync(attributesPath, "README.md filter=valdris-malicious\n");
      git(executorRepo, ["add", ".gitattributes"]);
      git(executorRepo, ["commit", "-qm", "executor filter fixture"]);

      const fsmonitorMarker = path.join(executorParent, "fsmonitor-invoked");
      const fsmonitorHook = path.join(executorParent, "fsmonitor.sh");
      const quotedMarker = fsmonitorMarker
        .split(path.sep)
        .join("/")
        .replaceAll("'", "'\\''");
      writeFileSync(
        fsmonitorHook,
        `#!/bin/sh\nprintf invoked >> '${quotedMarker}'\nprintf 'token\\0'\nexit 0\n`,
        { mode: 0o700 },
      );
      chmodSync(fsmonitorHook, 0o700);
      git(executorRepo, [
        "config",
        "core.fsmonitor",
        fsmonitorHook.split(path.sep).join("/"),
      ]);
      git(executorRepo, ["config", "core.fsmonitorHookVersion", "2"]);
      git(executorRepo, ["update-index", "--fsmonitor"]);
      const filterMarker = path.join(executorParent, "filter-invoked");
      const filterHook = path.join(executorParent, "filter.sh");
      const quotedFilterMarker = filterMarker
        .split(path.sep)
        .join("/")
        .replaceAll("'", "'\\''");
      writeFileSync(
        filterHook,
        `#!/bin/sh\nprintf invoked >> '${quotedFilterMarker}'\ncat\n`,
        { mode: 0o700 },
      );
      chmodSync(filterHook, 0o700);
      git(executorRepo, [
        "config",
        "filter.valdris-malicious.clean",
        `sh "${filterHook.split(path.sep).join("/")}"`,
      ]);
      writeFileSync(path.join(executorRepo, "README.md"), "EXECUTOR fixture\n");
      const untrustedStatus = spawnSync(
        "git",
        ["-C", executorRepo, "status", "--porcelain"],
        {
          encoding: "utf8",
          env: { ...process.env, GIT_TRACE_FSMONITOR: "1" },
          shell: false,
          windowsHide: true,
        },
      );
      if (untrustedStatus.error || untrustedStatus.status !== 0)
        throw new Error(
          `executor fsmonitor fixture status failed: ${
            untrustedStatus.error?.message ||
            untrustedStatus.stderr ||
            untrustedStatus.stdout
          }`,
        );
      const untrustedFilterStatus = spawnSync(
        "git",
        [
          "-c",
          "core.fsmonitor=false",
          "-C",
          executorRepo,
          "status",
          "--porcelain",
        ],
        {
          encoding: "utf8",
          shell: false,
          windowsHide: true,
        },
      );
      if (untrustedFilterStatus.error || untrustedFilterStatus.status !== 0)
        throw new Error(
          `executor filter fixture status failed: ${
            untrustedFilterStatus.error?.message ||
            untrustedFilterStatus.stderr ||
            untrustedFilterStatus.stdout
          }`,
        );
      if (!existsSync(fsmonitorMarker) || !existsSync(filterMarker))
        throw new Error(
          `executor Git fixture did not prove repository-controlled fsmonitor and filter execution: ${
            untrustedStatus.stderr || "no fsmonitor trace"
          }; filter status: ${
            untrustedFilterStatus.stderr || "no filter diagnostics"
          }`,
        );
      writeFileSync(path.join(executorRepo, "README.md"), "executor fixture\n");
      rmSync(fsmonitorMarker, { force: true });
      rmSync(filterMarker, { force: true });

      const executorArgs = [
        path.join(ROOT, "scripts", "attested-proof-executor.mjs"),
        "--repo",
        executorRepo,
        "--run-id",
        RUN_ID,
        "--image",
        `example.invalid/valdris@sha256:${D("image")}`,
        "--command-json",
        '["true"]',
        "--command-identity-sha256",
        sha256(canonicalJson(["true"])),
        "--validator-sha256",
        D("executor-output-validator"),
        "--semantic-proof-set-sha256",
        D("semantic-proof-set"),
        "--proof-input-set-sha256",
        D("proof-input-set"),
        "--accepted-gate-artifacts-sha256",
        D("accepted-gate-artifacts"),
        "--git-cli",
        executableOnPath("git"),
        "--git-cli-sha256",
        sha256(readFileSync(executableOnPath("git"))),
        "--runtime",
        "docker",
        "--runtime-cli",
        process.execPath,
        "--runtime-cli-sha256",
        sha256(readFileSync(process.execPath)),
        "--daemon-identity-sha256",
        D("dry-run-daemon"),
        "--dry-run",
      ];
      const positiveOutput = path.join(executorParent, "fresh-output");
      const positive = spawnSync(
        process.execPath,
        [...executorArgs, "--output-dir", positiveOutput],
        { encoding: "utf8", windowsHide: true },
      );
      if (positive.status !== 0)
        throw new Error(
          `executor dry-run baseline failed: ${positive.stderr || positive.stdout}`,
        );
      if (existsSync(fsmonitorMarker) || existsSync(filterMarker))
        throw new Error(
          "executor preflight ran repository-controlled core.fsmonitor or filter code",
        );
      const dryRunPlan = JSON.parse(positive.stdout).plan;
      const tmpfsSpecifications = dryRunPlan.argv.flatMap((argument, index) =>
        argument === "--tmpfs" ? [dryRunPlan.argv[index + 1]] : [],
      );
      if (
        dryRunPlan.source?.strategy !==
          "git-raw-object-tree-to-immutable-oci-layer" ||
        dryRunPlan.argv.some((argument) =>
          String(argument).includes(`src=${executorRepo}`),
        ) ||
        ["-v", "--volume", "--mount"].some((argument) =>
          dryRunPlan.argv.includes(argument),
        ) ||
        !dryRunPlan.argv.includes("<content-addressed-execution-image>") ||
        !tmpfsSpecifications.some(
          (value) =>
            value.startsWith("/output:") &&
            value.includes("uid=65534") &&
            value.includes("gid=65534"),
        ) ||
        !tmpfsSpecifications.some(
          (value) =>
            value.startsWith("/tmp:") &&
            value.includes("uid=65534") &&
            value.includes("gid=65534"),
        ) ||
        !dryRunPlan.limits?.wallClockScope?.startsWith("total host operation")
      )
        throw new Error(
          "executor dry-run must use a frozen source image, bounded nobody-owned tmpfs output, no host mount, and one total deadline",
        );
      expectProcessRejected(
        rejected,
        "executor total deadline includes preflight",
        spawnSync(
          process.execPath,
          [
            ...executorArgs,
            "--wall-clock-ms",
            "1",
            "--output-dir",
            path.join(executorParent, "deadline-output"),
          ],
          { encoding: "utf8", windowsHide: true },
        ),
        "executor total wall-clock deadline exceeded",
      );
      writeFileSync(attributesPath, "README.md filter\n");
      expectProcessRejected(
        rejected,
        "executor ambiguous filter attribute",
        spawnSync(
          process.execPath,
          [
            ...executorArgs,
            "--output-dir",
            path.join(executorParent, "ambiguous-filter-output"),
          ],
          { encoding: "utf8", windowsHide: true },
        ),
        "ambiguous or unsafe filter driver",
      );
      writeFileSync(attributesPath, "README.md filter=valdris-malicious\n");
      mkdirSync(path.join(executorParent, "existing-output"));
      expectProcessRejected(
        rejected,
        "executor existing-output alias",
        spawnSync(
          process.execPath,
          [
            ...executorArgs,
            "--output-dir",
            path.join(executorParent, "existing-output"),
          ],
          { encoding: "utf8", windowsHide: true },
        ),
        "must not already exist",
      );
      const alias = path.join(executorParent, "source-alias");
      try {
        symlinkSync(
          executorRepo,
          alias,
          process.platform === "win32" ? "junction" : "dir",
        );
        expectProcessRejected(
          rejected,
          "executor symlink-junction alias",
          spawnSync(
            process.execPath,
            [...executorArgs, "--output-dir", path.join(alias, "output")],
            { encoding: "utf8", windowsHide: true },
          ),
          "symbolic link or junction",
        );
      } catch (error) {
        if (existsSync(alias)) throw error;
        console.warn(
          `executor symlink-junction test skipped by platform policy: ${error.message}`,
        );
      }

      const runtimeProbe = containerRuntimeProbe();
      if (runtimeProbe.status === "skipped") {
        executorRuntimeVerification = runtimeProbe;
        console.warn(
          JSON.stringify({
            seam: "attested-proof-executor-real-runtime",
            ...runtimeProbe,
          }),
        );
      } else {
        const runtime = runtimeProbe.runtime;
        const baseImage = immutableBusyboxReference(runtime);
        try {
          const sourceCommit = git(executorRepo, ["rev-parse", "HEAD"]);
          const runtimeSemanticManifest = { kind: "semantic-runtime-proof" };
          const runtimeProofInputManifest = { kind: "runtime-proof-input" };
          const runtimeGateManifest = { kind: "runtime-accepted-gates" };
          const runtimeEnvelope = {
            schema: "valdris.proof-executor-output.v1",
            runId: RUN_ID,
            sourceCommit,
            status: "passed",
            validatorSha256: D("executor-runtime-validator"),
            semanticProofArtifacts: [manifestArtifact(runtimeSemanticManifest)],
            proofInputArtifacts: [manifestArtifact(runtimeProofInputManifest)],
            acceptedGateArtifacts: [manifestArtifact(runtimeGateManifest)],
          };
          const runtimeCommand = [
            "/bin/sh",
            "-c",
            "set -eu; printf writable > /output/uid-check; printf writable > /tmp/uid-check; printf '%s' \"$1\"",
            "valdris",
            JSON.stringify(runtimeEnvelope),
          ];
          const runtimeOutput = path.join(executorParent, "runtime-output");
          const keyFile = path.join(executorParent, "executor-private-key.pem");
          writeFileSync(
            keyFile,
            fixture.privateKey.export({ format: "pem", type: "pkcs8" }),
            { mode: 0o600 },
          );
          const wallClockMs = 180_000;
          const runtimeExecution = spawnSync(
            process.execPath,
            [
              path.join(ROOT, "scripts", "attested-proof-executor.mjs"),
              "--repo",
              executorRepo,
              "--run-id",
              RUN_ID,
              "--runtime",
              runtime,
              "--runtime-cli",
              runtimeProbe.runtimeCli,
              "--runtime-cli-sha256",
              runtimeProbe.runtimeCliSha256,
              "--daemon-identity-sha256",
              runtimeProbe.daemonIdentitySha256,
              "--git-cli",
              executableOnPath("git"),
              "--git-cli-sha256",
              sha256(readFileSync(executableOnPath("git"))),
              "--image",
              baseImage.image,
              "--command-json",
              JSON.stringify(runtimeCommand),
              "--command-identity-sha256",
              sha256(canonicalJson(runtimeCommand)),
              "--validator-sha256",
              runtimeEnvelope.validatorSha256,
              "--semantic-proof-set-sha256",
              sha256(canonicalJson(runtimeSemanticManifest)),
              "--proof-input-set-sha256",
              sha256(canonicalJson(runtimeProofInputManifest)),
              "--accepted-gate-artifacts-sha256",
              sha256(canonicalJson(runtimeGateManifest)),
              "--output-dir",
              runtimeOutput,
              "--receipt",
              path.join(runtimeOutput, "executor-receipt.json"),
              "--cpu",
              "1",
              "--memory",
              "134217728",
              "--output-bytes",
              "1048576",
              "--wall-clock-ms",
              String(wallClockMs),
            ],
            {
              encoding: "utf8",
              env: {
                ...process.env,
                VALDRIS_EXECUTOR_OUTPUT_ROOT: realpathSync(executorParent),
                VALDRIS_EXECUTOR_OUTPUT_ROOT_PATH_SHA256:
                  executorParentIdentity.pathSha256,
                VALDRIS_EXECUTOR_OUTPUT_ROOT_IDENTITY_SHA256:
                  executorParentIdentity.identitySha256,
                VALDRIS_EXECUTOR_PRIVATE_KEY_FILE: keyFile,
                VALDRIS_EXECUTOR_KEY_ID: "operator-key",
                VALDRIS_AUTHORITY_TRUST_SHA256: fixture.trustPin,
                VALDRIS_EXECUTOR_ACTOR_ID: "release-operator",
              },
              shell: false,
              timeout: wallClockMs + 30_000,
              windowsHide: true,
              maxBuffer: 4_194_304,
            },
          );
          if (runtimeExecution.error || runtimeExecution.status !== 0)
            throw new Error(
              `real ${runtime} executor verification failed: ${
                runtimeExecution.error?.message ||
                runtimeExecution.stderr ||
                runtimeExecution.stdout
              }`,
            );
          if (existsSync(fsmonitorMarker) || existsSync(filterMarker))
            throw new Error(
              "executor archive ran repository-controlled core.fsmonitor or filter code",
            );
          const receipt = JSON.parse(
            readFileSync(
              path.join(runtimeOutput, "executor-receipt.json"),
              "utf8",
            ),
          );
          const receiptDurationMs =
            Date.parse(receipt.finishedAt) - Date.parse(receipt.startedAt);
          if (
            receiptDurationMs < 0 ||
            receiptDurationMs > receipt.limits?.wallClockMs ||
            receipt.limits?.wallClockScope !==
              dryRunPlan.limits.wallClockScope ||
            receipt.runtimeKind !== runtime ||
            receipt.runtimeCliSha256 !== runtimeProbe.runtimeCliSha256 ||
            receipt.daemonIdentitySha256 !==
              runtimeProbe.daemonIdentitySha256 ||
            receipt.outputRootIdentitySha256 !==
              executorParentIdentity.identitySha256 ||
            receipt.sourceSnapshotManifestSha256 !==
              sha256(canonicalJson(receipt.sourceSnapshotManifest)) ||
            !existsSync(
              path.join(
                runtimeOutput,
                "semanticProofArtifacts",
                "manifest.bin",
              ),
            ) ||
            !existsSync(
              path.join(runtimeOutput, "proofInputArtifacts", "manifest.bin"),
            ) ||
            !existsSync(
              path.join(runtimeOutput, "acceptedGateArtifacts", "manifest.bin"),
            )
          )
            throw new Error(
              "real executor receipt did not bind total runtime or materialized proof artifacts",
            );
          executorRuntimeVerification = {
            status: "passed",
            runtime,
            image: baseImage.image,
            receiptDurationMs,
            writableTmpfsUid: 65_534,
            writableTmpfsGid: 65_534,
            hostMounts: false,
          };
        } finally {
          if (baseImage.pulledByVerifier) {
            const removed = spawnSync(
              runtime,
              ["image", "rm", "-f", baseImage.tag],
              {
                encoding: "utf8",
                shell: false,
                timeout: 30_000,
                windowsHide: true,
                maxBuffer: 1_048_576,
              },
            );
            if (removed.error || removed.status !== 0)
              throw new Error(
                `real-runtime verifier could not remove the image it pulled: ${
                  removed.error?.message || removed.stderr || removed.stdout
                }`,
              );
          }
        }
      }
    } finally {
      rmSync(executorRepo, { recursive: true, force: true });
      rmSync(executorParent, { recursive: true, force: true });
    }
    const historicalSource = {
      scheme: "git-head",
      commit: COMMIT,
      tree: git(root, ["rev-parse", `${COMMIT}^{tree}`]),
      targetPath: ".",
      runtimePath: ".",
    };
    const historicalFiles = [
      {
        kind: "control-catalog",
        path: "contracts/feature-contract-v1.json",
        sha256: fileSha256(
          path.join(root, "contracts", "feature-contract-v1.json"),
        ),
      },
    ];
    const historicalRuntimeSha256 = sha256(
      canonicalJson({
        targetPath: historicalSource.targetPath,
        runtimePath: historicalSource.runtimePath,
        files: historicalFiles,
      }),
    );
    const historicalRuntime = {
      schema: "valdris.run-packet-runtime.v1",
      source: historicalSource,
      files: historicalFiles,
      runtimeSha256: historicalRuntimeSha256,
      reviewTrustSha256: fixture.trustPin,
    };
    historicalRuntime.setSha256 = sha256(
      canonicalJson({
        source: historicalRuntime.source,
        files: historicalRuntime.files,
        runtimeSha256: historicalRuntime.runtimeSha256,
        reviewTrustSha256: historicalRuntime.reviewTrustSha256,
      }),
    );
    git(root, [
      "commit",
      "--allow-empty",
      "-qm",
      "advance runtime after historical packet",
    ]);
    expectValid(
      "historical runtime source reconstruction baseline",
      historicalValidationRuntimeProblems(
        historicalRuntime,
        root,
        COMMIT,
        fixture.trustPin,
      ),
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          seam: "v0.9 semantic and authoritative assurance",
          positiveTests: 15,
          negativeTests: rejected.length,
          rejected,
          executorRuntimeVerification,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
