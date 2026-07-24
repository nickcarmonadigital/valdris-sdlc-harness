import { readFileSync } from "node:fs";

import {
  canonicalJson,
  fileSha256,
  resolveArtifactPath,
  safeIdentifier,
  sha256,
  validatePortableProof,
} from "./proof-runner.mjs";

export const REQUIREMENTS_CONTRACT_SCHEMA = "uash.requirements-contract.v1";
export const ACCEPTANCE_RESULTS_SCHEMA = "uash.acceptance-results.v1";
export const TOOL_REGISTRY_SCHEMA = "valdris.tool-registry.v1";
export const MEMORY_HEAD_RECEIPT_SCHEMA = "valdris.memory-head-receipt.v1";
export const MODEL_JUDGE_CALIBRATION_SCHEMA = "uash.model-judge-calibration.v1";
export const AI_ECONOMICS_LEDGER_SCHEMA = "uash.ai-economics-ledger.v1";
export const INTEROP_TRANSCRIPT_SCHEMA = "valdris.interop-transcript.v1";
export const INTEROP_REQUEST_SCHEMA = "valdris.interop-conformance-request.v1";
export const INTEROP_RESPONSE_SCHEMA =
  "valdris.interop-conformance-response.v1";
export const INTEROP_ASSERTION_SCHEMA =
  "valdris.interop-conformance-assertion.v1";
export const INTEROP_EXECUTION_RECEIPT_SCHEMA =
  "valdris.interop-execution-receipt.v1";
export const RUNTIME_DRIVER_SCHEMA = "valdris.runtime-driver.v1";
export const RUNTIME_DRIVER_STATE_SCHEMA = "valdris.runtime-driver-state.v1";
export const IMPLEMENTATION_EXECUTION_RECEIPT_SCHEMA =
  "valdris.implementation-execution-receipt.v1";
export const DEPENDENCY_PROVENANCE_SCHEMA = "valdris.dependency-provenance.v1";
export const DECISION_EVIDENCE_SCHEMA = "uash.decision-evidence.v1";
export const TRACE_RECEIPT_SCHEMA = "valdris.trace-receipt.v2";

const SHA256 = /^[a-f0-9]{64}$/i;
const EMPTY_HEAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EFFECTS = new Set([
  "read",
  "write",
  "execute",
  "network",
  "approve",
  "deploy",
]);
const RISKS = new Set(["low", "medium", "high", "critical"]);
const APPROVAL_RULES = new Set(["none", "policy", "human-required"]);
const MEMORY_ACTIONS = new Set(["read", "write", "update", "delete", "expire"]);
const RUNTIME_DRIVER_STATUSES = new Set([
  "running",
  "completed",
  "blocked",
  "cancelled",
  "failed",
]);
const RUNTIME_DRIVER_STATE_FIELDS = new Set([
  "schema",
  "runId",
  "leaseId",
  "leaseOwner",
  "leaseExpiresAt",
  "checkpointRevision",
  "priorHeadSha256",
  "currentHeadSha256",
  "status",
  "checkpointHistory",
]);
const RUNTIME_DRIVER_CHECKPOINT_FIELDS = new Set([
  "runId",
  "leaseId",
  "leaseOwner",
  "leaseExpiresAt",
  "checkpointRevision",
  "priorHeadSha256",
  "currentHeadSha256",
  "status",
]);
export const INTEROP_TESTS = Object.freeze([
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
]);

function interopChallenge(options, id, purpose) {
  return sha256(
    canonicalJson({
      protocol: options.protocol,
      version: options.version,
      runId: options.runId,
      identitySha256: options.identitySha256.toLowerCase(),
      authRootSha256: options.authRootSha256.toLowerCase(),
      id,
      purpose,
    }),
  );
}

function interopTestContract(id, options) {
  const capabilitySetSha256 = sha256(canonicalJson(options.capabilities));
  const challenge = (purpose) => interopChallenge(options, id, purpose);
  switch (id) {
    case "initialize":
      return {
        request: {
          operation: "initialize",
          clientIdentitySha256: challenge("client-identity"),
          supportedVersions: [options.version],
          requestedCapabilities: options.capabilities,
        },
        expectedResult: {
          initialized: true,
          selectedVersion: options.version,
          serverIdentitySha256: options.identitySha256.toLowerCase(),
          authRootSha256: options.authRootSha256.toLowerCase(),
          capabilitySetSha256,
        },
      };
    case "version-negotiation": {
      const unsupportedVersion = `${options.version}-unsupported`;
      return {
        request: {
          operation: "negotiate-version",
          offeredVersions: [unsupportedVersion, options.version],
        },
        expectedResult: {
          negotiation: "compatible",
          selectedVersion: options.version,
          rejectedVersions: [unsupportedVersion],
        },
      };
    }
    case "auth-root-isolation": {
      const rejectedRootSha256 = challenge("unauthorized-auth-root");
      return {
        request: {
          operation: "probe-auth-root",
          authorizedRootSha256: options.authRootSha256.toLowerCase(),
          candidateRootSha256: rejectedRootSha256,
        },
        expectedResult: {
          isolation: "enforced",
          allowedRootSha256: options.authRootSha256.toLowerCase(),
          rejectedRootSha256,
        },
      };
    }
    case "capability-discovery": {
      const unknownCapability = "valdris-unknown-capability";
      return {
        request: {
          operation: "discover-capabilities",
          requestedCapabilities: [...options.capabilities, unknownCapability],
        },
        expectedResult: {
          advertisedCapabilities: options.capabilities,
          unsupportedCapabilities: [unknownCapability],
          capabilitySetSha256,
        },
      };
    }
    case "schema-negotiation": {
      const unsupportedSchema = "valdris.interop-envelope.v0";
      return {
        request: {
          operation: "negotiate-schema",
          requestSchemas: [
            unsupportedSchema,
            "valdris.interop-envelope.request.v1",
          ],
          responseSchemas: [
            unsupportedSchema,
            "valdris.interop-envelope.response.v1",
          ],
        },
        expectedResult: {
          negotiation: "compatible",
          selectedRequestSchema: "valdris.interop-envelope.request.v1",
          selectedResponseSchema: "valdris.interop-envelope.response.v1",
          rejectedSchemas: [unsupportedSchema],
        },
      };
    }
    case "event-correlation": {
      const payloadSha256 = challenge("event-payload");
      const correlationId = challenge("correlation");
      return {
        request: {
          operation: "correlate-event",
          event: { correlationId, payloadSha256 },
        },
        expectedResult: {
          correlationId,
          eventSha256: sha256(canonicalJson({ correlationId, payloadSha256 })),
          correlated: true,
        },
      };
    }
    case "timeout":
      return {
        request: {
          operation: "deadline-probe",
          deadlineMs: options.timeoutMs,
          workloadSha256: challenge("bounded-workload"),
        },
        expectedResult: {
          deadlineMs: options.timeoutMs,
          deadlineEnforced: true,
          timedOut: false,
          completedWithinDeadline: true,
        },
      };
    case "cancellation": {
      const cancellationTokenSha256 = challenge("cancellation-token");
      return {
        request: {
          operation: "cancel",
          cancellationTokenSha256,
          pendingOperationSha256: challenge("pending-operation"),
        },
        expectedResult: {
          cancellationTokenSha256,
          cancelled: true,
          mutationObserved: false,
        },
      };
    }
    case "unknown-tool-rejection": {
      const toolName = `valdris.unknown.${challenge("tool").slice(0, 16)}`;
      return {
        request: {
          operation: "invoke-tool",
          toolName,
          argumentsSha256: challenge("tool-arguments"),
        },
        expectedResult: {
          decision: "rejected",
          errorCode: "UNKNOWN_TOOL",
          toolNameSha256: sha256(toolName),
        },
      };
    }
    case "replay-protection": {
      const nonce = challenge("replay-nonce");
      return {
        request: {
          operation: "replay-probe",
          nonce,
          sequence: 1,
          attempts: 2,
        },
        expectedResult: {
          nonceSha256: sha256(nonce),
          firstDecision: "accepted",
          replayDecision: "rejected",
          errorCode: "REPLAY_DETECTED",
        },
      };
    }
    default:
      throw new Error(`unsupported interop conformance test: ${id}`);
  }
}

export function interopConformanceExpectation(id, options) {
  const contract = interopTestContract(id, options);
  const request = {
    schema: INTEROP_REQUEST_SCHEMA,
    protocol: options.protocol,
    version: options.version,
    id,
    correlationId: interopChallenge(options, id, "request-correlation"),
    identitySha256: options.identitySha256.toLowerCase(),
    authRootSha256: options.authRootSha256.toLowerCase(),
    capabilities: options.capabilities,
    test: contract.request,
  };
  const requestSha256 = sha256(canonicalJson(request));
  const response = {
    schema: INTEROP_RESPONSE_SCHEMA,
    id,
    status: "passed",
    protocol: options.protocol,
    version: options.version,
    correlationId: request.correlationId,
    requestSha256,
    result: contract.expectedResult,
  };
  const assertion = {
    schema: INTEROP_ASSERTION_SCHEMA,
    id,
    requestSchema: INTEROP_REQUEST_SCHEMA,
    responseSchema: INTEROP_RESPONSE_SCHEMA,
    expectedResult: contract.expectedResult,
  };
  return {
    request,
    expectedResult: contract.expectedResult,
    requestSha256,
    responseSha256: sha256(canonicalJson(response)),
    assertionSha256: sha256(canonicalJson(assertion)),
  };
}

export function interopTranscriptEvidenceSha256(document) {
  const evidence = structuredClone(document);
  delete evidence.executionReceipt;
  return sha256(canonicalJson(evidence));
}

export function interopTestDigestSetSha256(document, field) {
  return sha256(
    canonicalJson(
      (document?.tests || []).map((test) => ({
        id: test.id,
        [field]: test[field],
      })),
    ),
  );
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function digest(value) {
  return typeof value === "string" && SHA256.test(value);
}

function canonicalIso(value) {
  return (
    typeof value === "string" &&
    ISO.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
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

function uniqueStrings(values, label, problems, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    problems.push(
      `${label} must be ${allowEmpty ? "an" : "a non-empty"} array`,
    );
    return [];
  }
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (!nonEmpty(value)) problems.push(`${label}[${index}] is invalid`);
    else if (seen.has(value)) problems.push(`${label} duplicates ${value}`);
    else seen.add(value);
  }
  return [...seen];
}

function loadBoundJson(repoRoot, binding, expectedPath, label, problems) {
  if (
    !repoRoot ||
    !object(binding) ||
    binding.path !== expectedPath ||
    !digest(binding.sha256)
  ) {
    problems.push(`${label} must bind ${expectedPath} and its SHA-256 digest`);
    return null;
  }
  try {
    const target = resolveArtifactPath(repoRoot, binding.path, {
      mustExist: true,
    });
    if (fileSha256(target) !== binding.sha256)
      problems.push(`${label} digest does not match ${expectedPath}`);
    return JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    problems.push(`${label} is invalid: ${error.message}`);
    return null;
  }
}

function validateBoundFiles(entries, repoRoot, label, digestField, problems) {
  if (!repoRoot) return;
  for (const [index, entry] of entries.entries()) {
    try {
      const target = resolveArtifactPath(repoRoot, entry.evidencePath, {
        mustExist: true,
      });
      if (fileSha256(target) !== entry[digestField])
        problems.push(
          `${label}[${index}] digest does not match its evidence file`,
        );
    } catch (error) {
      problems.push(`${label}[${index}] is invalid: ${error.message}`);
    }
  }
}

function sameSubject(document, expected, label, problems) {
  for (const field of ["runId", "commit", "environment"])
    if (document?.[field] !== expected?.[field])
      problems.push(`${label}.${field} does not match its parent document`);
}

export function validateRequirementsContractDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["requirements contract must be an object"],
    };
  if (document.schema !== REQUIREMENTS_CONTRACT_SCHEMA)
    problems.push(
      `requirements contract schema must be ${REQUIREMENTS_CONTRACT_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "requirements contract"));
  if (!digest(document.sourceRequestSha256))
    problems.push("requirements contract.sourceRequestSha256 is invalid");

  if (
    !Array.isArray(document.requirements) ||
    document.requirements.length === 0
  )
    problems.push("requirements contract.requirements must be non-empty");
  const requirementIds = new Set();
  const acceptanceIds = new Set();
  const mappedTests = new Set();
  const mappedSuites = new Set();
  const mappedStops = new Set();
  for (const [index, requirement] of (document.requirements || []).entries()) {
    const label = `requirements contract.requirements[${index}]`;
    if (
      !object(requirement) ||
      !safeIdentifier(requirement.id) ||
      requirementIds.has(requirement.id) ||
      !nonEmpty(requirement.owner) ||
      !nonEmpty(requirement.statement) ||
      typeof requirement.critical !== "boolean"
    ) {
      problems.push(
        `${label} identity, owner, statement, or critical flag is invalid`,
      );
      continue;
    }
    requirementIds.add(requirement.id);
    uniqueStrings(requirement.assumptions, `${label}.assumptions`, problems, {
      allowEmpty: true,
    });
    uniqueStrings(requirement.unknowns, `${label}.unknowns`, problems, {
      allowEmpty: true,
    });
    uniqueStrings(requirement.constraints, `${label}.constraints`, problems, {
      allowEmpty: true,
    });
    const stopIds = uniqueStrings(
      requirement.stoppingConditionIds,
      `${label}.stoppingConditionIds`,
      problems,
    );
    for (const id of stopIds) mappedStops.add(id);
    if (
      !Array.isArray(requirement.acceptanceCriteria) ||
      requirement.acceptanceCriteria.length === 0
    )
      problems.push(`${label}.acceptanceCriteria must be non-empty`);
    let negativeOrBoundary = false;
    for (const [criterionIndex, criterion] of (
      requirement.acceptanceCriteria || []
    ).entries()) {
      const criterionLabel = `${label}.acceptanceCriteria[${criterionIndex}]`;
      if (
        !object(criterion) ||
        !safeIdentifier(criterion.id) ||
        acceptanceIds.has(criterion.id) ||
        !nonEmpty(criterion.description) ||
        !["positive", "negative", "boundary"].includes(criterion.kind)
      ) {
        problems.push(`${criterionLabel} is invalid or duplicated`);
        continue;
      }
      acceptanceIds.add(criterion.id);
      if (["negative", "boundary"].includes(criterion.kind))
        negativeOrBoundary = true;
      const testIds = uniqueStrings(
        criterion.testIds,
        `${criterionLabel}.testIds`,
        problems,
      );
      const suiteIds = uniqueStrings(
        criterion.evalSuiteIds,
        `${criterionLabel}.evalSuiteIds`,
        problems,
        { allowEmpty: true },
      );
      for (const id of testIds) mappedTests.add(id);
      for (const id of suiteIds) mappedSuites.add(id);
    }
    if (requirement.critical && !negativeOrBoundary)
      problems.push(
        `${label} critical requirement needs a negative or boundary criterion`,
      );
    for (const field of ["apiSchemaIdentities", "eventSchemaIdentities"])
      for (const [identityIndex, identity] of (Array.isArray(requirement[field])
        ? requirement[field]
        : []
      ).entries())
        if (!digest(identity))
          problems.push(
            `${label}.${field}[${identityIndex}] must be a SHA-256 digest`,
          );
  }

  const redTestIds = new Set(
    (options.redBaselines || []).map((entry) => entry?.testId).filter(Boolean),
  );
  for (const id of redTestIds)
    if (!mappedTests.has(id))
      problems.push(
        `red baseline ${id} is not mapped from an acceptance criterion`,
      );
  for (const id of mappedTests)
    if (redTestIds.size && !redTestIds.has(id))
      problems.push(`acceptance test ${id} has no sealed red baseline`);
  const suiteIds = new Set(
    (options.evalPlan?.suites || []).map((entry) => entry?.id).filter(Boolean),
  );
  for (const id of mappedSuites)
    if (!suiteIds.has(id))
      problems.push(`acceptance eval suite ${id} is not commissioned`);
  if (options.acceptanceResults) {
    const result = validateAcceptanceResultsDocument(
      options.acceptanceResults,
      {
        repoRoot: options.repoRoot,
        requiredTestIds: [...mappedTests],
        requiredEvalSuiteIds: [...mappedSuites],
        expectedSubject: document,
      },
    );
    problems.push(
      ...result.problems.map((problem) => `acceptance results: ${problem}`),
    );
  }
  const stoppingIds = new Set(
    (options.goal?.stoppingConditions || [])
      .map((entry) => entry?.id)
      .filter(Boolean),
  );
  for (const id of mappedStops)
    if (stoppingIds.size && !stoppingIds.has(id))
      problems.push(`requirement stopping condition ${id} is not in the goal`);
  for (const id of stoppingIds)
    if (!mappedStops.has(id))
      problems.push(
        `goal stopping condition ${id} is not mapped from a requirement`,
      );
  return { valid: problems.length === 0, problems };
}

export function validateAcceptanceResultsDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["acceptance results must be an object"] };
  if (document.schema !== ACCEPTANCE_RESULTS_SCHEMA)
    problems.push(
      `acceptance results schema must be ${ACCEPTANCE_RESULTS_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "acceptance results"));
  if (options.expectedSubject)
    sameSubject(
      document,
      options.expectedSubject,
      "acceptance results",
      problems,
    );
  const validateRows = (rows, label, evidenceKind) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      problems.push(`${label} must be a non-empty array`);
      return new Map();
    }
    const byId = new Map();
    for (const [index, row] of rows.entries()) {
      if (
        !object(row) ||
        !safeIdentifier(row.id) ||
        byId.has(row.id) ||
        row.status !== "passed" ||
        row.evidenceKind !== evidenceKind ||
        !object(row.producer) ||
        !nonEmpty(row.producer.name) ||
        !nonEmpty(row.producer.version) ||
        row.producer.kind !==
          (evidenceKind === "portable-proof"
            ? "proof-runner"
            : "native-eval") ||
        !nonEmpty(row.evidencePath) ||
        !digest(row.evidenceSha256)
      ) {
        problems.push(
          `${label}[${index}] is invalid, duplicated, or not passing`,
        );
        continue;
      }
      byId.set(row.id, row);
    }
    if (options.repoRoot)
      validateBoundFiles(
        [...byId.values()],
        options.repoRoot,
        label,
        "evidenceSha256",
        problems,
      );
    if (options.repoRoot)
      for (const [id, row] of byId) {
        let evidence;
        try {
          evidence = JSON.parse(
            readFileSync(
              resolveArtifactPath(options.repoRoot, row.evidencePath, {
                mustExist: true,
              }),
              "utf8",
            ),
          );
        } catch (error) {
          problems.push(`${label} ${id} evidence is invalid: ${error.message}`);
          continue;
        }
        if (evidenceKind === "portable-proof") {
          const validation = validatePortableProof(evidence);
          if (
            !validation.valid ||
            evidence.outcome?.status !== "passed" ||
            evidence.outcome?.successful !== true ||
            evidence.run?.id !== document.runId ||
            evidence.run?.commit !== document.commit ||
            evidence.run?.environment !== document.environment ||
            evidence.bindings?.commandSha256 !== row.commandSha256 ||
            !digest(row.commandSha256) ||
            !evidence.command?.argv?.includes(id)
          )
            problems.push(
              `${label} ${id} must bind a passing native portable proof whose command names the commissioned test`,
            );
        } else {
          const suite = (evidence?.suites || []).find(
            (candidate) => candidate?.id === id,
          );
          if (
            evidence?.schema !== "uash.eval-results.v1" ||
            evidence?.status !== "passed" ||
            evidence?.runId !== document.runId ||
            evidence?.commit !== document.commit ||
            evidence?.environment !== document.environment ||
            !suite ||
            !Number.isFinite(suite.value) ||
            !Number.isFinite(suite.threshold)
          )
            problems.push(
              `${label} ${id} must bind a passing native eval result containing that commissioned suite`,
            );
        }
      }
    return byId;
  };
  const tests = validateRows(
    document.tests,
    "acceptance results.tests",
    "portable-proof",
  );
  const suites = validateRows(
    document.evalSuites,
    "acceptance results.evalSuites",
    "native-eval",
  );
  for (const id of options.requiredTestIds || [])
    if (!tests.has(id))
      problems.push(`required acceptance test ${id} has no passing result`);
  for (const id of options.requiredEvalSuiteIds || [])
    if (!suites.has(id))
      problems.push(
        `required acceptance eval suite ${id} has no passing result`,
      );
  return { valid: problems.length === 0, problems };
}

export function validateToolRegistryDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["tool registry must be an object"] };
  if (document.schema !== TOOL_REGISTRY_SCHEMA)
    problems.push(`tool registry schema must be ${TOOL_REGISTRY_SCHEMA}`);
  problems.push(...subjectProblems(document, "tool registry"));
  if (!Array.isArray(document.tools) || document.tools.length === 0)
    problems.push("tool registry.tools must be non-empty");
  const identities = new Set();
  for (const [index, tool] of (document.tools || []).entries()) {
    const label = `tool registry.tools[${index}]`;
    const identity = `${tool?.id}@${tool?.version}`;
    if (
      !object(tool) ||
      !safeIdentifier(tool.id) ||
      !nonEmpty(tool.version) ||
      identities.has(identity) ||
      !digest(tool.providerSha256) ||
      !digest(tool.inputSchemaSha256) ||
      !digest(tool.outputSchemaSha256) ||
      !EFFECTS.has(tool.effectClass) ||
      !RISKS.has(tool.riskClass) ||
      !APPROVAL_RULES.has(tool.approvalRule) ||
      !Number.isSafeInteger(tool.timeoutMs) ||
      tool.timeoutMs < 1 ||
      !object(tool.retry) ||
      !Number.isSafeInteger(tool.retry.maxAttempts) ||
      tool.retry.maxAttempts < 1 ||
      !Number.isSafeInteger(tool.retry.backoffMs) ||
      tool.retry.backoffMs < 0 ||
      typeof tool.retry.idempotencyKeyRequired !== "boolean" ||
      !safeIdentifier(tool.auditSchema)
    ) {
      problems.push(`${label} is invalid or duplicated`);
      continue;
    }
    identities.add(identity);
    if (
      (["high", "critical"].includes(tool.riskClass) ||
        ["approve", "deploy"].includes(tool.effectClass)) &&
      tool.approvalRule !== "human-required"
    )
      problems.push(`${label} consequential tools require human approval`);
    if (
      tool.effectClass !== "read" &&
      tool.retry.maxAttempts > 1 &&
      tool.retry.idempotencyKeyRequired !== true
    )
      problems.push(`${label} retried mutating tool requires idempotency keys`);
    const scopes = tool.scopes;
    if (!object(scopes)) problems.push(`${label}.scopes is required`);
    else {
      uniqueStrings(
        scopes.capabilities,
        `${label}.scopes.capabilities`,
        problems,
      );
      uniqueStrings(scopes.data, `${label}.scopes.data`, problems, {
        allowEmpty: true,
      });
      uniqueStrings(scopes.network, `${label}.scopes.network`, problems, {
        allowEmpty: true,
      });
      uniqueStrings(scopes.filesystem, `${label}.scopes.filesystem`, problems, {
        allowEmpty: true,
      });
    }
  }
  if (
    options.expectedSha256 &&
    sha256(canonicalJson(document)) !== options.expectedSha256
  )
    problems.push(
      "tool registry digest does not match the bound runtime identity",
    );
  return { valid: problems.length === 0, problems };
}

export function validateToolCallReceipts(receipts, registry, options = {}) {
  const problems = [];
  if (!Array.isArray(receipts))
    return { valid: false, problems: ["tool call receipts must be an array"] };
  const tools = new Map(
    (registry?.tools || []).map((tool) => [`${tool.id}@${tool.version}`, tool]),
  );
  const eventIds = new Set();
  const grants = new Set(
    (options.grants || []).map(
      (grant) =>
        `${grant.agentId}:${grant.resourceType || "capability"}:${grant.resource || grant.capability}`,
    ),
  );
  const hookByEvent = new Map(
    (options.hookReceipts || []).map((receipt) => [receipt?.eventId, receipt]),
  );
  const approvalByEvent = new Map(
    (options.approvalReceipts || []).map((receipt) => [
      receipt?.eventId,
      receipt,
    ]),
  );
  for (const [index, receipt] of receipts.entries()) {
    const label = `tool call receipts[${index}]`;
    const tool = tools.get(`${receipt?.toolId}@${receipt?.toolVersion}`);
    if (
      !object(receipt) ||
      !safeIdentifier(receipt.eventId) ||
      eventIds.has(receipt.eventId) ||
      !safeIdentifier(receipt.agentId) ||
      !tool ||
      !digest(receipt.inputSha256) ||
      !digest(receipt.outputSha256) ||
      !["passed", "failed", "blocked"].includes(receipt.outcome) ||
      !canonicalIso(receipt.startedAt) ||
      !canonicalIso(receipt.finishedAt) ||
      Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt) ||
      !digest(receipt.beforeHookSha256) ||
      !digest(receipt.afterHookSha256)
    ) {
      problems.push(
        `${label} is invalid, replayed, or references an unknown tool`,
      );
      continue;
    }
    eventIds.add(receipt.eventId);
    for (const [resourceType, resources] of Object.entries({
      capability: tool.scopes?.capabilities || [],
      data: tool.scopes?.data || [],
      network: tool.scopes?.network || [],
      filesystem: tool.scopes?.filesystem || [],
    }))
      for (const resource of resources)
        if (!grants.has(`${receipt.agentId}:${resourceType}:${resource}`))
          problems.push(
            `${label} agent lacks the commissioned ${resourceType} resource grant ${resource}`,
          );
    const toolIdentitySha256 = sha256(
      canonicalJson({ id: tool.id, version: tool.version }),
    );
    const beforeHook = hookByEvent.get(receipt.beforeHookEventId);
    const afterHook = hookByEvent.get(receipt.afterHookEventId);
    if (
      receipt.beforeHookEventId === receipt.afterHookEventId ||
      beforeHook?.hook !== "before-tool" ||
      beforeHook?.outcome !== "allow" ||
      beforeHook?.enforced !== true ||
      beforeHook?.toolCallEventId !== receipt.eventId ||
      beforeHook?.toolIdentitySha256 !== toolIdentitySha256 ||
      beforeHook?.inputSha256 !== receipt.inputSha256 ||
      beforeHook?.outputSha256 !== undefined ||
      sha256(canonicalJson(beforeHook)) !== receipt.beforeHookSha256
    )
      problems.push(
        `${label} before-tool hook receipt is not an enforced call-bound allow decision`,
      );
    if (
      afterHook?.hook !== "after-tool" ||
      afterHook?.outcome !== "allow" ||
      afterHook?.enforced !== true ||
      afterHook?.toolCallEventId !== receipt.eventId ||
      afterHook?.toolIdentitySha256 !== toolIdentitySha256 ||
      afterHook?.inputSha256 !== receipt.inputSha256 ||
      afterHook?.outputSha256 !== receipt.outputSha256 ||
      sha256(canonicalJson(afterHook)) !== receipt.afterHookSha256
    )
      problems.push(
        `${label} after-tool hook receipt is not an enforced call-bound allow decision`,
      );
    if (tool.approvalRule === "human-required") {
      const approval = approvalByEvent.get(receipt.approvalReceiptEventId);
      if (
        !approval ||
        approval.schema !== "uash.tool-approval-receipt.v1" ||
        approval.actor?.type !== "human" ||
        approval.toolCallEventId !== receipt.eventId ||
        approval.toolIdentitySha256 !== toolIdentitySha256 ||
        approval.inputSha256 !== receipt.inputSha256
      )
        problems.push(
          `${label} consequential tool call lacks trusted human approval`,
        );
    }
    if (
      Array.isArray(options.agentIds) &&
      !options.agentIds.includes(receipt.agentId)
    )
      problems.push(`${label} references an unknown runtime agent`);
  }
  return { valid: problems.length === 0, problems };
}

export function validateMemoryHeadReceiptDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["memory head receipt must be an object"],
    };
  if (document.schema !== MEMORY_HEAD_RECEIPT_SCHEMA)
    problems.push(
      `memory head receipt schema must be ${MEMORY_HEAD_RECEIPT_SCHEMA}`,
    );
  for (const field of ["eventId", "memoryId", "owner", "scope"])
    if (!safeIdentifier(document[field]))
      problems.push(`memory head receipt.${field} is invalid`);
  for (const field of [
    "providerSha256",
    "storeIdentitySha256",
    "priorHeadSha256",
    "currentHeadSha256",
    "sourceSessionIdentitySha256",
    "contentSha256",
  ])
    if (!digest(document[field]))
      problems.push(`memory head receipt.${field} is invalid`);
  if (!MEMORY_ACTIONS.has(document.action))
    problems.push("memory head receipt.action is invalid");
  if (!canonicalIso(document.issuedAt) || !canonicalIso(document.expiresAt))
    problems.push("memory head receipt timestamps are invalid");
  else if (Date.parse(document.expiresAt) <= Date.parse(document.issuedAt))
    problems.push("memory head receipt must expire after issuance");
  if (
    options.now &&
    canonicalIso(document.expiresAt) &&
    Date.parse(document.expiresAt) <= Date.parse(options.now)
  )
    problems.push("memory head receipt is expired");
  if (document.scope === "tenant" && !safeIdentifier(document.tenantId))
    problems.push("tenant memory head receipt requires tenantId");
  if (document.priorHeadSha256 === document.currentHeadSha256)
    problems.push("memory head receipt must advance the memory head");
  const signingProviderSha256 = sha256(
    canonicalJson({
      actorId: document.actor?.id,
      keyId: document.attestation?.keyId,
    }),
  );
  if (document.providerSha256 !== signingProviderSha256)
    problems.push(
      "memory head receipt provider identity does not match its signing actor and key",
    );
  return { valid: problems.length === 0, problems };
}

export function validateMemoryContinuity(events, receipts, options = {}) {
  const problems = [];
  if (!Array.isArray(receipts))
    return { valid: false, problems: ["memoryHeadReceipts must be an array"] };
  const receiptByEvent = new Map();
  for (const [index, receipt] of receipts.entries()) {
    const result = validateMemoryHeadReceiptDocument(receipt, options);
    problems.push(
      ...result.problems.map(
        (problem) => `memoryHeadReceipts[${index}]: ${problem}`,
      ),
    );
    if (receiptByEvent.has(receipt?.eventId))
      problems.push(`memoryHeadReceipts replays ${receipt.eventId}`);
    receiptByEvent.set(receipt?.eventId, receipt);
  }
  const priorReceiptByEvent = new Map();
  for (const [index, receipt] of (options.priorReceipts || []).entries()) {
    const result = validateMemoryHeadReceiptDocument(receipt, options);
    problems.push(
      ...result.problems.map(
        (problem) => `priorMemoryHeadReceipts[${index}]: ${problem}`,
      ),
    );
    if (priorReceiptByEvent.has(receipt?.eventId))
      problems.push(`priorMemoryHeadReceipts replays ${receipt.eventId}`);
    priorReceiptByEvent.set(receipt?.eventId, receipt);
  }
  const heads = new Map();
  for (const [index, event] of (events || []).entries()) {
    const label = `memoryEvents[${index}]`;
    const receipt = receiptByEvent.get(event?.headReceiptEventId);
    const isolation = `${event?.scope}:${event?.tenantId || "-"}`;
    const prior = heads.get(event?.memoryId);
    if (!receipt) {
      problems.push(`${label} is missing its memory-head receipt`);
      continue;
    }
    for (const [field, expected] of [
      ["memoryId", event.memoryId],
      ["owner", event.owner],
      ["scope", event.scope],
      ["tenantId", event.tenantId],
      ["contentSha256", event.contentSha256],
      ["action", event.action],
    ])
      if ((receipt[field] ?? undefined) !== (expected ?? undefined))
        problems.push(`${label} ${field} does not match its head receipt`);
    if (prior) {
      if (receipt.priorHeadSha256 !== prior.head)
        problems.push(`${label} does not advance the prior memory head`);
      if (prior.isolation !== isolation)
        problems.push(`${label} crosses a memory isolation boundary`);
    } else if (event.action === "read") {
      const source = priorReceiptByEvent.get(receipt.sourceReceiptEventId);
      if (
        !source ||
        source.memoryId !== receipt.memoryId ||
        source.owner !== receipt.owner ||
        source.scope !== receipt.scope ||
        (source.tenantId ?? undefined) !== (receipt.tenantId ?? undefined) ||
        source.providerSha256 !== receipt.providerSha256 ||
        source.storeIdentitySha256 !== receipt.storeIdentitySha256 ||
        source.contentSha256 !== receipt.contentSha256 ||
        source.sourceSessionIdentitySha256 !==
          receipt.sourceSessionIdentitySha256 ||
        source.currentHeadSha256 !== receipt.priorHeadSha256 ||
        source.sourceSessionIdentitySha256 === options.sessionIdentitySha256 ||
        receipt.sourceSessionIdentitySha256 === options.sessionIdentitySha256
      )
        problems.push(
          `${label} initial persisted read must bind a trusted prior-session memory head receipt`,
        );
    } else if (
      event.action !== "read" &&
      receipt.priorHeadSha256 !== options.emptyHeadSha256
    )
      problems.push(
        `${label} new memory must begin at the commissioned empty head`,
      );
    heads.set(event.memoryId, {
      head: receipt.currentHeadSha256,
      isolation,
      owner: event.owner,
      terminal: ["delete", "expire"].includes(event.action),
    });
  }
  for (const receipt of receipts)
    if (
      !(events || []).some(
        (event) => event.headReceiptEventId === receipt.eventId,
      )
    )
      problems.push(
        `memory-head receipt ${receipt.eventId} is not used by a memory event`,
      );
  return { valid: problems.length === 0, problems };
}

export function validateModelJudgeCalibrationDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["model judge calibration must be an object"],
    };
  if (document.schema !== MODEL_JUDGE_CALIBRATION_SCHEMA)
    problems.push(
      `model judge calibration schema must be ${MODEL_JUDGE_CALIBRATION_SCHEMA}`,
    );
  for (const field of [
    "judgeModelSha256",
    "judgeProviderSha256",
    "judgePromptSha256",
    "calibrationSetSha256",
    "humanLabelsSha256",
  ])
    if (!digest(document[field]))
      problems.push(`model judge calibration.${field} is invalid`);
  if (!nonEmpty(document.owner))
    problems.push("model judge calibration.owner is required");
  if (!canonicalIso(document.generatedAt) || !canonicalIso(document.expiresAt))
    problems.push("model judge calibration timestamps are invalid");
  else if (Date.parse(document.expiresAt) <= Date.parse(document.generatedAt))
    problems.push("model judge calibration must expire after generation");
  if (
    options.now &&
    canonicalIso(document.expiresAt) &&
    Date.parse(document.expiresAt) <= Date.parse(options.now)
  )
    problems.push("model judge calibration is expired");
  if (
    !Number.isFinite(document.agreement) ||
    document.agreement < 0 ||
    document.agreement > 1 ||
    !Number.isFinite(document.minimumAgreement) ||
    document.minimumAgreement < 0 ||
    document.minimumAgreement > 1 ||
    document.agreement < document.minimumAgreement
  )
    problems.push(
      "model judge calibration agreement is invalid or below threshold",
    );
  if (
    !Number.isFinite(document.errorRate) ||
    document.errorRate < 0 ||
    document.errorRate > 1 ||
    !Number.isFinite(document.maximumErrorRate) ||
    document.maximumErrorRate < 0 ||
    document.maximumErrorRate > 1 ||
    document.errorRate > document.maximumErrorRate
  )
    problems.push(
      "model judge calibration error rate is invalid or above threshold",
    );
  uniqueStrings(
    document.criticalSlices,
    "model judge calibration.criticalSlices",
    problems,
  );
  if (document.independentFromSystemUnderTest !== true)
    problems.push("model judge must be independent from the system under test");
  if (
    options.systemModelSha256 &&
    document.judgeModelSha256 === options.systemModelSha256
  )
    problems.push(
      "model judge cannot use the system-under-test model identity",
    );
  return { valid: problems.length === 0, problems };
}

export function validateDecisionEvidenceDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["decision evidence must be an object"] };
  if (document.schema !== DECISION_EVIDENCE_SCHEMA)
    problems.push(
      `decision evidence schema must be ${DECISION_EVIDENCE_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "decision evidence"));
  if (!Array.isArray(document.decisions) || document.decisions.length === 0)
    problems.push("decision evidence.decisions must be non-empty");
  const ids = new Set();
  for (const [index, decision] of (document.decisions || []).entries()) {
    const label = `decision evidence.decisions[${index}]`;
    if (
      !object(decision) ||
      !safeIdentifier(decision.id) ||
      ids.has(decision.id) ||
      !nonEmpty(decision.question) ||
      !Array.isArray(decision.alternatives) ||
      decision.alternatives.length < 2 ||
      !nonEmpty(decision.selected) ||
      !decision.alternatives.includes(decision.selected) ||
      !nonEmpty(decision.rationale) ||
      !safeIdentifier(decision.authority) ||
      !digest(decision.evidenceSha256) ||
      !nonEmpty(decision.outcome) ||
      !canonicalIso(decision.decidedAt)
    ) {
      problems.push(`${label} is invalid or duplicated`);
      continue;
    }
    ids.add(decision.id);
    if (decision.privateReasoning !== undefined)
      problems.push(`${label} must not store private model reasoning`);
  }
  if (
    options.expectedSha256 &&
    sha256(canonicalJson(document)) !== options.expectedSha256
  )
    problems.push("decision evidence digest does not match its trace receipt");
  return { valid: problems.length === 0, problems };
}

export function countObservableTraceEvents(repoRoot, tracePath) {
  const target = resolveArtifactPath(repoRoot, tracePath, { mustExist: true });
  const lines = readFileSync(target, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  const events = [];
  const eventIds = new Set();
  const decisionIds = new Set();
  let priorEventSha256 =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  let priorTimestamp = null;
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`trace line ${index + 1} is not valid JSON`);
    }
    if (
      !object(event) ||
      !safeIdentifier(event.eventId) ||
      eventIds.has(event.eventId) ||
      event.sequence !== index + 1 ||
      event.priorEventSha256 !== priorEventSha256 ||
      !digest(event.eventSha256) ||
      !canonicalIso(event.occurredAt) ||
      (priorTimestamp !== null &&
        Date.parse(event.occurredAt) <= priorTimestamp) ||
      !nonEmpty(event.type) ||
      event.privateReasoning !== undefined
    )
      throw new Error(
        `trace line ${index + 1} is invalid or contains private reasoning`,
      );
    const eventPayload = structuredClone(event);
    delete eventPayload.eventSha256;
    if (sha256(canonicalJson(eventPayload)) !== event.eventSha256)
      throw new Error(`trace line ${index + 1} event digest is invalid`);
    if (
      event.type === "decision" &&
      (!safeIdentifier(event.decisionId) || decisionIds.has(event.decisionId))
    )
      throw new Error(
        `trace line ${index + 1} decision identity is invalid or replayed`,
      );
    eventIds.add(event.eventId);
    if (event.type === "decision") decisionIds.add(event.decisionId);
    priorEventSha256 = event.eventSha256;
    priorTimestamp = Date.parse(event.occurredAt);
    events.push(event);
  }
  return {
    count: lines.length,
    sha256: fileSha256(target),
    firstEventSha256: events[0]?.eventSha256,
    lastEventSha256: events.at(-1)?.eventSha256,
    target,
    events,
  };
}

export function validateAiEconomicsLedgerDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["AI economics ledger must be an object"],
    };
  if (document.schema !== AI_ECONOMICS_LEDGER_SCHEMA)
    problems.push(
      `AI economics ledger schema must be ${AI_ECONOMICS_LEDGER_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "AI economics ledger"));
  for (const field of ["pricingPolicySha256", "providerBillingReceiptSha256"])
    if (!digest(document[field]))
      problems.push(`AI economics ledger.${field} is invalid`);
  if (!nonEmpty(document.currency))
    problems.push("AI economics ledger.currency is required");
  const totals = document.totals;
  const numericFields = [
    "inputTokens",
    "outputTokens",
    "toolCalls",
    "retryCount",
    "latencyMsP50",
    "latencyMsP95",
    "modelSpend",
    "toolSpend",
    "retryWasteSpend",
    "humanReviewMinutes",
    "actualSpend",
    "maximumSpend",
  ];
  if (!object(totals)) problems.push("AI economics ledger.totals is required");
  else
    for (const field of numericFields)
      if (!Number.isFinite(totals[field]) || totals[field] < 0)
        problems.push(`AI economics ledger.totals.${field} is invalid`);
  if (
    Number.isFinite(totals?.latencyMsP50) &&
    Number.isFinite(totals?.latencyMsP95) &&
    totals.latencyMsP95 < totals.latencyMsP50
  )
    problems.push("AI economics ledger latency percentiles are inconsistent");
  if (
    Number.isFinite(totals?.actualSpend) &&
    Number.isFinite(totals?.maximumSpend) &&
    totals.actualSpend > totals.maximumSpend
  )
    problems.push("AI economics ledger exceeds its spend budget");
  if (
    Number.isFinite(totals?.actualSpend) &&
    Number.isFinite(totals?.modelSpend) &&
    Number.isFinite(totals?.toolSpend) &&
    Math.abs(totals.actualSpend - (totals.modelSpend + totals.toolSpend)) > 1e-9
  )
    problems.push("AI economics ledger actual spend does not reconcile");
  const firstPass = document.firstPassSuccess;
  if (
    !object(firstPass) ||
    !digest(firstPass.sampleWindowSha256) ||
    !Number.isSafeInteger(firstPass.successfulRuns) ||
    firstPass.successfulRuns < 0 ||
    !Number.isSafeInteger(firstPass.totalRuns) ||
    firstPass.totalRuns < 1 ||
    firstPass.successfulRuns > firstPass.totalRuns ||
    !Number.isFinite(firstPass.rate) ||
    Math.abs(firstPass.rate - firstPass.successfulRuns / firstPass.totalRuns) >
      1e-12 ||
    typeof firstPass.currentRunFirstPass !== "boolean"
  )
    problems.push(
      "AI economics ledger.firstPassSuccess is invalid or does not reconcile",
    );
  if (!Array.isArray(document.modelUsage) || document.modelUsage.length === 0)
    problems.push("AI economics ledger.modelUsage must be non-empty");
  let modelInputTokens = 0;
  let modelOutputTokens = 0;
  let modelSpend = 0;
  for (const [index, usage] of (document.modelUsage || []).entries())
    if (
      !object(usage) ||
      !digest(usage.modelSha256) ||
      !digest(usage.providerSha256) ||
      !Number.isSafeInteger(usage.inputTokens) ||
      usage.inputTokens < 0 ||
      !Number.isSafeInteger(usage.outputTokens) ||
      usage.outputTokens < 0 ||
      !Number.isFinite(usage.cost) ||
      usage.cost < 0
    )
      problems.push(`AI economics ledger.modelUsage[${index}] is invalid`);
    else {
      modelInputTokens += usage.inputTokens;
      modelOutputTokens += usage.outputTokens;
      modelSpend += usage.cost;
    }
  if (
    totals?.inputTokens !== modelInputTokens ||
    totals?.outputTokens !== modelOutputTokens ||
    Math.abs((totals?.modelSpend ?? Number.NaN) - modelSpend) > 1e-9
  )
    problems.push("AI economics model usage does not reconcile with totals");
  if (!Array.isArray(document.toolUsage))
    problems.push("AI economics ledger.toolUsage must be an array");
  const toolCalls = new Map(
    (options.toolCallReceipts || []).map((call) => [call.eventId, call]),
  );
  const tools = new Map(
    (options.toolRegistry?.tools || []).map((tool) => [
      `${tool.id}@${tool.version}`,
      tool,
    ]),
  );
  const toolUsageIds = new Set();
  let attributedToolSpend = 0;
  for (const [index, usage] of (document.toolUsage || []).entries()) {
    const call = toolCalls.get(usage?.toolCallEventId);
    const tool = call
      ? tools.get(`${call.toolId}@${call.toolVersion}`)
      : undefined;
    if (
      !object(usage) ||
      !safeIdentifier(usage.toolCallEventId) ||
      toolUsageIds.has(usage.toolCallEventId) ||
      !call ||
      !tool ||
      usage.toolIdentitySha256 !==
        sha256(canonicalJson({ id: tool.id, version: tool.version })) ||
      usage.providerSha256 !== tool.providerSha256 ||
      !digest(usage.billingReceiptSha256) ||
      usage.currency !== document.currency ||
      !Number.isFinite(usage.cost) ||
      usage.cost < 0
    )
      problems.push(
        `AI economics ledger.toolUsage[${index}] is invalid, duplicated, or detached from a runtime tool call`,
      );
    else {
      toolUsageIds.add(usage.toolCallEventId);
      attributedToolSpend += usage.cost;
    }
  }
  if (
    toolUsageIds.size !== toolCalls.size ||
    [...toolCalls.keys()].some((eventId) => !toolUsageIds.has(eventId))
  )
    problems.push(
      "AI economics tool usage does not exactly cover runtime tool-call receipts",
    );
  if (
    Number.isFinite(totals?.toolSpend) &&
    Math.abs(totals.toolSpend - attributedToolSpend) > 1e-9
  )
    problems.push("AI economics attributed tool spend does not reconcile");
  if (!Array.isArray(document.tenantUsage))
    problems.push("AI economics ledger.tenantUsage must be an array");
  if (options.multiTenant && document.tenantUsage?.length === 0)
    problems.push("multi-tenant AI economics requires tenant attribution");
  const tenantIds = new Set();
  let tenantSpend = 0;
  let tenantTokens = 0;
  let tenantToolCalls = 0;
  let tenantRetries = 0;
  for (const [index, usage] of (document.tenantUsage || []).entries()) {
    if (
      !object(usage) ||
      !safeIdentifier(usage.tenantId) ||
      tenantIds.has(usage.tenantId) ||
      !Number.isSafeInteger(usage.tokens) ||
      usage.tokens < 0 ||
      !Number.isSafeInteger(usage.toolCalls) ||
      usage.toolCalls < 0 ||
      !Number.isSafeInteger(usage.retries) ||
      usage.retries < 0 ||
      !Number.isFinite(usage.spend) ||
      usage.spend < 0
    )
      problems.push(`AI economics ledger.tenantUsage[${index}] is invalid`);
    else {
      tenantIds.add(usage.tenantId);
      tenantSpend += usage.spend;
      tenantTokens += usage.tokens;
      tenantToolCalls += usage.toolCalls;
      tenantRetries += usage.retries;
    }
  }
  if (
    document.tenantUsage?.length &&
    Number.isFinite(totals?.actualSpend) &&
    Math.abs(tenantSpend - totals.actualSpend) > 1e-9
  )
    problems.push(
      "AI economics tenant spend does not reconcile with actual spend",
    );
  if (
    document.tenantUsage?.length &&
    (tenantTokens !==
      (totals?.inputTokens || 0) + (totals?.outputTokens || 0) ||
      tenantToolCalls !== totals?.toolCalls ||
      tenantRetries !== totals?.retryCount)
  )
    problems.push("AI economics tenant usage does not reconcile with totals");
  if (options.usageReceipt) {
    const receipt = options.usageReceipt;
    if (
      document.providerBillingReceiptSha256 !== receipt.usageSha256 ||
      receipt.usageSha256 !== aiEconomicsUsageSha256(document) ||
      totals?.inputTokens !== receipt.inputTokens ||
      totals?.outputTokens !== receipt.outputTokens ||
      totals?.actualSpend !== receipt.cost ||
      totals?.latencyMsP50 !== receipt.latencyMsP50 ||
      totals?.latencyMsP95 !== receipt.latencyMsP95 ||
      totals?.humanReviewMinutes !== receipt.humanReviewMinutes ||
      document.currency !== receipt.currency
    )
      problems.push(
        "AI economics ledger usage and billing identity do not match the signed usage receipt",
      );
  }
  if (
    options.toolCallCount !== undefined &&
    totals?.toolCalls !== options.toolCallCount
  )
    problems.push(
      "AI economics tool-call count does not match runtime receipts",
    );
  if (
    options.attempts !== undefined &&
    totals?.retryCount !== Math.max(0, options.attempts - 1)
  )
    problems.push("AI economics retry count does not match the trajectory");
  if (
    options.attempts !== undefined &&
    firstPass?.currentRunFirstPass !== (options.attempts === 1)
  )
    problems.push(
      "AI economics current-run first-pass result does not match the trajectory",
    );
  return { valid: problems.length === 0, problems };
}

export function aiEconomicsUsageSha256(document) {
  return sha256(
    canonicalJson({
      currency: document?.currency,
      totals: document?.totals,
      modelUsage: document?.modelUsage,
      toolUsage: document?.toolUsage,
      tenantUsage: document?.tenantUsage,
      firstPassSuccess: document?.firstPassSuccess,
    }),
  );
}

export function validateInteropTranscriptDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["interop transcript must be an object"] };
  if (document.schema !== INTEROP_TRANSCRIPT_SCHEMA)
    problems.push(
      `interop transcript schema must be ${INTEROP_TRANSCRIPT_SCHEMA}`,
    );
  problems.push(...subjectProblems(document, "interop transcript"));
  if (
    !["mcp", "a2a"].includes(document.protocol) ||
    !nonEmpty(document.version)
  )
    problems.push("interop transcript protocol or version is invalid");
  for (const field of [
    "identitySha256",
    "authRootSha256",
    "capabilitySetSha256",
  ])
    if (!digest(document[field]))
      problems.push(`interop transcript.${field} is invalid`);
  const capabilitiesValid =
    Array.isArray(document.capabilities) &&
    document.capabilities.length > 0 &&
    document.capabilities.every((entry) => safeIdentifier(entry)) &&
    new Set(document.capabilities).size === document.capabilities.length;
  if (!capabilitiesValid)
    problems.push("interop transcript capabilities are invalid or duplicated");
  else if (
    document.capabilitySetSha256 !==
    sha256(canonicalJson(document.capabilities))
  )
    problems.push("interop transcript capability set digest does not match");
  if (!Number.isSafeInteger(document.timeoutMs) || document.timeoutMs < 1)
    problems.push("interop transcript timeoutMs is invalid");
  const expectationInputsValid =
    ["mcp", "a2a"].includes(document.protocol) &&
    nonEmpty(document.version) &&
    safeIdentifier(document.runId) &&
    digest(document.identitySha256) &&
    digest(document.authRootSha256) &&
    capabilitiesValid &&
    Number.isSafeInteger(document.timeoutMs) &&
    document.timeoutMs > 0;
  if (!Array.isArray(document.tests))
    problems.push("interop transcript.tests must be an array");
  const byId = new Map();
  for (const [index, test] of (document.tests || []).entries()) {
    if (
      !object(test) ||
      !safeIdentifier(test.id) ||
      byId.has(test.id) ||
      !INTEROP_TESTS.includes(test.id) ||
      test.status !== "passed" ||
      !digest(test.requestSha256) ||
      !digest(test.responseSha256) ||
      !digest(test.assertionSha256) ||
      !canonicalIso(test.startedAt) ||
      !canonicalIso(test.finishedAt) ||
      Date.parse(test.finishedAt) < Date.parse(test.startedAt)
    )
      problems.push(
        `interop transcript.tests[${index}] is invalid or duplicated`,
      );
    else {
      byId.set(test.id, test);
      if (expectationInputsValid) {
        const expectation = interopConformanceExpectation(test.id, {
          protocol: document.protocol,
          version: document.version,
          runId: document.runId,
          identitySha256: document.identitySha256,
          authRootSha256: document.authRootSha256,
          capabilities: document.capabilities,
          timeoutMs: document.timeoutMs,
        });
        for (const field of [
          "requestSha256",
          "responseSha256",
          "assertionSha256",
        ])
          if (test[field] !== expectation[field])
            problems.push(
              `interop transcript.tests[${index}].${field} does not match the commissioned conformance challenge`,
            );
      }
    }
  }
  for (const id of INTEROP_TESTS)
    if (!byId.has(id)) problems.push(`interop transcript is missing ${id}`);
  const execution = document.executionReceipt;
  if (!object(execution)) {
    if (options.allowPendingExecutionReceipt !== true)
      problems.push(
        "interop transcript requires an attested execution receipt",
      );
  } else {
    if (execution.schema !== INTEROP_EXECUTION_RECEIPT_SCHEMA)
      problems.push(
        `interop execution receipt schema must be ${INTEROP_EXECUTION_RECEIPT_SCHEMA}`,
      );
    for (const field of [
      "runId",
      "commit",
      "environment",
      "protocol",
      "version",
      "identitySha256",
      "authRootSha256",
      "capabilitySetSha256",
      "timeoutMs",
    ])
      if (execution[field] !== document[field])
        problems.push(
          `interop execution receipt ${field} does not match the transcript`,
        );
    for (const field of [
      "adapterCommandSha256",
      "adapterSourceSha256",
      "runnerSha256",
      "executorIdentitySha256",
      "transcriptEvidenceSha256",
      "requestSetSha256",
      "responseSetSha256",
      "assertionSetSha256",
    ])
      if (!digest(execution[field]))
        problems.push(`interop execution receipt ${field} is invalid`);
    const executorPrincipal = execution.executorPrincipal;
    const authorityPrincipal = execution.authorityPrincipal;
    if (
      !object(executorPrincipal) ||
      executorPrincipal.type !== "service" ||
      !safeIdentifier(executorPrincipal.id) ||
      !safeIdentifier(executorPrincipal.keyId) ||
      execution.executorIdentitySha256 !==
        sha256(canonicalJson(executorPrincipal))
    )
      problems.push(
        "interop execution receipt executor principal is invalid or does not match its identity digest",
      );
    if (
      !object(authorityPrincipal) ||
      authorityPrincipal.type !== "service" ||
      !safeIdentifier(authorityPrincipal.id) ||
      !safeIdentifier(authorityPrincipal.keyId) ||
      authorityPrincipal.id !== execution.actor?.id ||
      authorityPrincipal.type !== execution.actor?.type ||
      authorityPrincipal.keyId !== execution.attestation?.keyId
    )
      problems.push(
        "interop execution receipt authority principal does not match its signer",
      );
    if (
      object(executorPrincipal) &&
      object(authorityPrincipal) &&
      (executorPrincipal.id === authorityPrincipal.id ||
        executorPrincipal.keyId === authorityPrincipal.keyId)
    )
      problems.push(
        "interop execution receipt authority principal must be distinct from the executor principal",
      );
    if (
      execution.transcriptEvidenceSha256 !==
      interopTranscriptEvidenceSha256(document)
    )
      problems.push(
        "interop execution receipt does not bind the transcript evidence",
      );
    for (const [field, receiptField] of [
      ["requestSha256", "requestSetSha256"],
      ["responseSha256", "responseSetSha256"],
      ["assertionSha256", "assertionSetSha256"],
    ])
      if (
        execution[receiptField] !== interopTestDigestSetSha256(document, field)
      )
        problems.push(
          `interop execution receipt ${receiptField} does not bind the transcript tests`,
        );
    if (
      !canonicalIso(execution.startedAt) ||
      !canonicalIso(execution.finishedAt) ||
      Date.parse(execution.finishedAt) < Date.parse(execution.startedAt) ||
      execution.exitCode !== 0 ||
      execution.inheritAmbientSecrets !== false
    )
      problems.push(
        "interop execution receipt timing, exit status, or environment policy is invalid",
      );
  }
  if (options.protocol && document.protocol !== options.protocol)
    problems.push(
      "interop transcript protocol does not match runtime declaration",
    );
  if (options.version && document.version !== options.version)
    problems.push(
      "interop transcript version does not match runtime declaration",
    );
  if (
    options.identitySha256 &&
    document.identitySha256 !== options.identitySha256
  )
    problems.push(
      "interop transcript identity does not match runtime declaration",
    );
  if (
    options.capabilitySetSha256 &&
    document.capabilitySetSha256 !== options.capabilitySetSha256
  )
    problems.push(
      "interop transcript capability set does not match runtime declaration",
    );
  if (
    options.capabilities &&
    canonicalJson(document.capabilities) !== canonicalJson(options.capabilities)
  )
    problems.push(
      "interop transcript capabilities do not match runtime declaration",
    );
  if (
    options.authRootSha256 &&
    document.authRootSha256 !== options.authRootSha256
  )
    problems.push(
      "interop transcript auth root does not match runtime declaration",
    );
  if (options.timeoutMs && document.timeoutMs !== options.timeoutMs)
    problems.push(
      "interop transcript timeout does not match runtime declaration",
    );
  return { valid: problems.length === 0, problems };
}

export function validateRuntimeDriverStateDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return {
      valid: false,
      problems: ["runtime driver state must be an object"],
    };
  const unexpectedStateFields = Object.keys(document).filter(
    (field) => !RUNTIME_DRIVER_STATE_FIELDS.has(field),
  );
  if (unexpectedStateFields.length > 0)
    problems.push("runtime driver state contains unsupported fields");
  if (document.schema !== RUNTIME_DRIVER_STATE_SCHEMA)
    problems.push(
      `runtime driver state schema must be ${RUNTIME_DRIVER_STATE_SCHEMA}`,
    );
  if (!safeIdentifier(document.runId))
    problems.push("runtime driver state.runId is invalid");
  if (options.runId && document.runId !== options.runId)
    problems.push("runtime driver state belongs to a different run");
  if (!safeIdentifier(document.leaseId))
    problems.push("runtime driver state.leaseId is invalid");
  if (!safeIdentifier(document.leaseOwner))
    problems.push("runtime driver state.leaseOwner is invalid");
  if (!canonicalIso(document.leaseExpiresAt))
    problems.push(
      "runtime driver state.leaseExpiresAt must be a canonical ISO timestamp",
    );
  if (
    !Number.isSafeInteger(document.checkpointRevision) ||
    document.checkpointRevision < 1
  )
    problems.push("runtime driver state.checkpointRevision is invalid");
  if (!digest(document.priorHeadSha256))
    problems.push("runtime driver state.priorHeadSha256 is invalid");
  if (!digest(document.currentHeadSha256))
    problems.push("runtime driver state.currentHeadSha256 is invalid");
  if (document.priorHeadSha256 === document.currentHeadSha256)
    problems.push("runtime driver state head did not advance");
  if (!RUNTIME_DRIVER_STATUSES.has(document.status))
    problems.push("runtime driver state.status is invalid");

  const history = document.checkpointHistory;
  if (
    !Array.isArray(history) ||
    history.length !== document.checkpointRevision
  ) {
    problems.push(
      "runtime driver state checkpoint history must cover every revision",
    );
  } else {
    let expectedPrior = EMPTY_HEAD_SHA256;
    for (const [index, checkpoint] of history.entries()) {
      const label = `runtime driver checkpoint history revision ${index + 1}`;
      if (!object(checkpoint)) {
        problems.push(`${label} must be an object`);
        continue;
      }
      if (
        Object.keys(checkpoint).some(
          (field) => !RUNTIME_DRIVER_CHECKPOINT_FIELDS.has(field),
        )
      )
        problems.push(`${label} contains unsupported fields`);
      const structurallyValid =
        safeIdentifier(checkpoint.runId) &&
        checkpoint.runId === document.runId &&
        safeIdentifier(checkpoint.leaseId) &&
        safeIdentifier(checkpoint.leaseOwner) &&
        canonicalIso(checkpoint.leaseExpiresAt) &&
        Number.isSafeInteger(checkpoint.checkpointRevision) &&
        checkpoint.checkpointRevision === index + 1 &&
        digest(checkpoint.priorHeadSha256) &&
        digest(checkpoint.currentHeadSha256) &&
        RUNTIME_DRIVER_STATUSES.has(checkpoint.status);
      if (!structurallyValid)
        problems.push(`${label} has invalid schema or subject fields`);
      if (index === 0 && checkpoint.status !== "running")
        problems.push(
          "runtime driver state must begin with a running checkpoint",
        );
      if (index < history.length - 1 && checkpoint.status !== "running")
        problems.push(`${label} resumes a terminal checkpoint`);
      const transition = {
        runId: checkpoint.runId,
        leaseId: checkpoint.leaseId,
        leaseOwner: checkpoint.leaseOwner,
        leaseExpiresAt: checkpoint.leaseExpiresAt,
        checkpointRevision: checkpoint.checkpointRevision,
        priorHeadSha256: checkpoint.priorHeadSha256,
        status: checkpoint.status,
      };
      if (
        checkpoint.priorHeadSha256 !== expectedPrior ||
        checkpoint.currentHeadSha256 !== sha256(canonicalJson(transition))
      )
        problems.push(`${label} is not a gap-free digest chain`);
      expectedPrior = checkpoint.currentHeadSha256;
    }
    const latest = history.at(-1);
    if (
      RUNTIME_DRIVER_CHECKPOINT_FIELDS.size !==
        Object.keys(latest || {}).length ||
      [...RUNTIME_DRIVER_CHECKPOINT_FIELDS].some(
        (field) => latest?.[field] !== document[field],
      )
    )
      problems.push(
        "runtime driver state does not match its latest checkpoint history entry",
      );
  }
  return { valid: problems.length === 0, problems };
}

export function validateRuntimeDriverDocument(document, options = {}) {
  const problems = [];
  if (!object(document))
    return { valid: false, problems: ["runtime driver must be an object"] };
  if (document.schema !== RUNTIME_DRIVER_SCHEMA)
    problems.push(`runtime driver schema must be ${RUNTIME_DRIVER_SCHEMA}`);
  problems.push(...subjectProblems(document, "runtime driver"));
  const adapter = document.adapter;
  if (
    !object(adapter) ||
    !safeIdentifier(adapter.id) ||
    !nonEmpty(adapter.version) ||
    !["codex", "claude-code", "hermes", "custom"].includes(adapter.runtime) ||
    !digest(adapter.providerSha256)
  )
    problems.push("runtime driver.adapter is invalid");
  const state = document.state;
  if (
    !object(state) ||
    state.path !== "runtime/driver-state.json" ||
    !safeIdentifier(state.leaseId) ||
    !safeIdentifier(state.leaseOwner) ||
    !canonicalIso(state.leaseExpiresAt) ||
    !Number.isSafeInteger(state.checkpointRevision) ||
    state.checkpointRevision < 1 ||
    !digest(state.sha256) ||
    !digest(state.priorHeadSha256) ||
    !digest(state.currentHeadSha256) ||
    state.priorHeadSha256 === state.currentHeadSha256
  )
    problems.push("runtime driver.state is invalid or does not advance");
  if (
    options.repoRoot &&
    object(state) &&
    state.path === "runtime/driver-state.json"
  ) {
    const stateDocument = loadBoundJson(
      options.repoRoot,
      { path: state.path, sha256: state.sha256 },
      "runtime/driver-state.json",
      "runtime driver state",
      problems,
    );
    if (stateDocument) {
      const stateValidation = validateRuntimeDriverStateDocument(
        stateDocument,
        {
          runId: document.runId,
        },
      );
      problems.push(...stateValidation.problems);
      if (
        stateDocument.runId !== document.runId ||
        stateDocument.leaseId !== state.leaseId ||
        stateDocument.leaseOwner !== state.leaseOwner ||
        stateDocument.leaseExpiresAt !== state.leaseExpiresAt ||
        stateDocument.checkpointRevision !== state.checkpointRevision ||
        stateDocument.priorHeadSha256 !== state.priorHeadSha256 ||
        stateDocument.currentHeadSha256 !== state.currentHeadSha256 ||
        !RUNTIME_DRIVER_STATUSES.has(stateDocument.status)
      )
        problems.push(
          "runtime driver state document does not match the bound lease and checkpoint",
        );
    }
  }
  const stop = document.stopPolicy;
  if (
    !object(stop) ||
    !digest(stop.goalSha256) ||
    !digest(stop.budgetSha256) ||
    !Array.isArray(stop.terminalStates) ||
    !["completed", "blocked", "cancelled", "failed"].every((stateName) =>
      stop.terminalStates.includes(stateName),
    ) ||
    stop.resumeSupported !== true ||
    stop.cancelSupported !== true
  )
    problems.push("runtime driver.stopPolicy is invalid");
  const receipt = document.implementationReceipt;
  if (
    !object(receipt) ||
    receipt.schema !== IMPLEMENTATION_EXECUTION_RECEIPT_SCHEMA ||
    receipt.runId !== document.runId ||
    !safeIdentifier(receipt.eventId) ||
    !digest(receipt.commandSha256) ||
    !digest(receipt.sandboxPolicySha256) ||
    !digest(receipt.capabilityPolicySha256) ||
    !digest(receipt.beforeTreeSha256) ||
    !digest(receipt.afterTreeSha256) ||
    !digest(receipt.diffSha256) ||
    !digest(receipt.eventJournalSha256) ||
    !digest(receipt.driverStateHeadSha256) ||
    !digest(receipt.driverStateDocumentSha256) ||
    !canonicalIso(receipt.startedAt) ||
    !canonicalIso(receipt.finishedAt) ||
    Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt) ||
    !["changed", "no-change"].includes(receipt.mutationResult) ||
    receipt.sandboxEnforced !== true ||
    receipt.inheritAmbientSecrets !== false ||
    !["none", "allowlist"].includes(receipt.networkPolicy) ||
    receipt.exitCode !== 0
  )
    problems.push("runtime driver implementation receipt is invalid");
  if (
    receipt?.mutationResult === "changed" &&
    receipt.beforeTreeSha256 === receipt.afterTreeSha256
  )
    problems.push("changed implementation receipt did not change the tree");
  if (
    receipt?.mutationResult === "no-change" &&
    receipt.beforeTreeSha256 !== receipt.afterTreeSha256
  )
    problems.push("no-change implementation receipt changed the tree");
  if (
    receipt?.driverStateHeadSha256 !== state?.currentHeadSha256 ||
    receipt?.driverStateDocumentSha256 !== state?.sha256
  )
    problems.push(
      "runtime driver implementation receipt does not attest the exact checkpoint state and head",
    );
  if (options.goalSha256 && stop?.goalSha256 !== options.goalSha256)
    problems.push("runtime driver does not bind the active goal");
  return { valid: problems.length === 0, problems };
}

export function validateDependencyProvenance(entries, options = {}) {
  const problems = [];
  if (!Array.isArray(entries))
    return {
      valid: false,
      problems: ["dependency provenance must be an array"],
    };
  const changed = (options.dependencies || []).filter(
    (entry) => entry.change === "added" || entry.change === "updated",
  );
  const identities = new Map();
  for (const [index, entry] of entries.entries()) {
    const label = `dependency provenance[${index}]`;
    const identity = entry?.locator;
    if (
      !object(entry) ||
      entry.schema !== DEPENDENCY_PROVENANCE_SCHEMA ||
      !nonEmpty(entry.locator) ||
      !nonEmpty(entry.name) ||
      !nonEmpty(entry.version) ||
      identities.has(identity) ||
      !digest(entry.lockMetadataSha256) ||
      !/^https:\/\//u.test(entry.registry || "") ||
      !/^https:\/\//u.test(entry.sourceUrl || "") ||
      !nonEmpty(entry.publisher) ||
      !nonEmpty(entry.license) ||
      !digest(entry.packageSha256) ||
      !digest(entry.integritySha256) ||
      !digest(entry.vulnerabilityReportSha256) ||
      !digest(entry.providerReceiptSha256) ||
      entry.confusableNameCheck !== "passed" ||
      entry.allowlisted !== true ||
      entry.reviewDisposition !== "approved"
    ) {
      problems.push(`${label} is invalid, duplicated, or unapproved`);
      continue;
    }
    identities.set(identity, entry);
  }
  for (const dependency of changed) {
    const provenance = identities.get(dependency.locator);
    if (
      !provenance ||
      provenance.name !== dependency.name ||
      provenance.version !== dependency.version ||
      provenance.lockMetadataSha256 !== dependency.metadataSha256
    )
      problems.push(
        `changed dependency ${dependency.locator} lacks metadata-bound provenance`,
      );
  }
  return { valid: problems.length === 0, problems };
}

export function loadAndValidateOperatingArtifact(
  repoRoot,
  binding,
  expectedPath,
  validator,
  options = {},
) {
  const problems = [];
  const document = loadBoundJson(
    repoRoot,
    binding,
    expectedPath,
    expectedPath,
    problems,
  );
  if (document) {
    const result = validator(document, options);
    problems.push(...result.problems);
  }
  return { valid: problems.length === 0, document, problems };
}
