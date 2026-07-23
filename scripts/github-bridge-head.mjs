#!/usr/bin/env node
import {
  createPrivateKey,
  createPublicKey,
  sign as signPayload,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
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
import {
  AUTHORITY_TRUST_SHA256_ENV,
  authorityAttestationPayload,
  authorityTrustStoreSha256,
} from "./v09-assurance-lib.mjs";
import {
  assertOperatorRootSecurity,
  assertOperatorRootUnchanged,
} from "./operator-root-security.mjs";

const SHA256 = /^[a-f0-9]{64}$/i;
const ZERO_HEAD = "0".repeat(64);
const MAX_GITHUB_HISTORY_ENTRIES = 999;
const EMPTY_HISTORY_SHA256 = sha256(canonicalJson([]));
const GITHUB_CHECKPOINT_SCHEMA = "valdris.github-head-checkpoint.v1";
const GITHUB_CHECK_ATTESTATION_SCHEMA =
  "valdris.github-head-check-attestation.v1";
const MAX_GITHUB_OPERATION_DEADLINE_MS = 600_000;
const MAX_SPAWN_TIMEOUT_MS = 2_147_483_647;

function canonicalGithubHostname(value) {
  if (
    typeof value !== "string" ||
    value !== value.toLowerCase() ||
    value.endsWith(".") ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(value) ||
    value.split(".").some((label) => !label || label.length > 63)
  )
    throw new Error("GitHub hostname must be canonical lowercase DNS form");
  return value;
}

export function createGithubOperationDeadline(
  limitMs,
  startedMs = Date.now(),
  now = () => Date.now(),
) {
  if (
    !Number.isSafeInteger(limitMs) ||
    limitMs < 1 ||
    limitMs > MAX_GITHUB_OPERATION_DEADLINE_MS
  )
    throw new Error("GitHub total operation deadline is invalid");
  const deadlineMs = startedMs + limitMs;
  const remaining = (phase) => {
    const value = Math.floor(deadlineMs - now());
    if (value < 1)
      throw new Error(
        `GitHub total operation deadline exceeded during ${phase}`,
      );
    return Math.min(value, MAX_SPAWN_TIMEOUT_MS);
  };
  return {
    limitMs,
    startedAt: new Date(startedMs).toISOString(),
    remaining,
    assert(phase) {
      remaining(phase);
    },
  };
}

function githubApi(api, hostname, deadline, phase, args, tolerate404 = false) {
  const timeoutMs = deadline.remaining(phase);
  const result = api(
    ["api", "--hostname", canonicalGithubHostname(hostname), ...args],
    { tolerate404, timeoutMs },
  );
  deadline.assert(phase);
  return result;
}

function sortedUniqueStrings(values) {
  if (!Array.isArray(values) || values.some((value) => !safeIdentifier(value)))
    throw new Error("commissioned GitHub writer restrictions are invalid");
  return [...new Set(values)].sort();
}

function commissionedWriterApps(entries) {
  if (
    !Array.isArray(entries) ||
    entries.some(
      (entry) =>
        !safeIdentifier(entry?.slug) ||
        !Number.isSafeInteger(entry?.id) ||
        entry.id <= 0,
    )
  )
    throw new Error("commissioned GitHub writer restrictions are invalid");
  const identities = entries.map((entry) => ({
    id: entry.id,
    slug: entry.slug,
  }));
  if (
    new Set(identities.map((entry) => entry.id)).size !== identities.length ||
    new Set(identities.map((entry) => entry.slug)).size !== identities.length
  )
    throw new Error("commissioned GitHub writer restrictions are duplicated");
  return identities.sort((left, right) => left.id - right.id);
}

function actualWriterApps(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({ id: entry?.id, slug: entry?.slug }))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function actualRestrictionNames(entries, field) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => entry?.[field])
    .filter((value) => typeof value === "string")
    .sort();
}

function validateGithubProposalPolicy(policy) {
  if (
    policy?.mergeMethod !== "rebase" ||
    !Number.isSafeInteger(policy?.operationDeadlineMs) ||
    policy.operationDeadlineMs < 1 ||
    policy.operationDeadlineMs > MAX_GITHUB_OPERATION_DEADLINE_MS ||
    !Number.isSafeInteger(policy?.pollIntervalMs) ||
    policy.pollIntervalMs < 1 ||
    policy.pollIntervalMs > policy.operationDeadlineMs ||
    !Number.isSafeInteger(policy?.fullReplayInterval) ||
    policy.fullReplayInterval < 1 ||
    policy.fullReplayInterval > MAX_GITHUB_HISTORY_ENTRIES
  )
    throw new Error(
      "commissioned GitHub proposal flow must use bounded rebase merge and full-replay intervals",
    );
  return policy;
}

export function validateGithubProtectionPolicy(policy, response) {
  if (
    !policy ||
    policy.enforceAdmins !== true ||
    policy.requiredLinearHistory !== true ||
    policy.strictStatusChecks !== true ||
    policy.requirePullRequest !== true ||
    policy.noBypassAllowances !== true ||
    !safeIdentifier(policy.appendOnlyStatusCheck?.context) ||
    !Number.isSafeInteger(policy.appendOnlyStatusCheck?.appId) ||
    policy.appendOnlyStatusCheck.appId <= 0 ||
    !policy.writerRestrictions
  )
    throw new Error(
      "commissioned GitHub protection policy must enforce admins, linear history, strict append-only status checks, and writer restrictions",
    );
  const proposalPolicy = validateGithubProposalPolicy(policy.proposalFlow);
  const expectedWriters = {
    apps: commissionedWriterApps(policy.writerRestrictions.apps),
    teams: sortedUniqueStrings(policy.writerRestrictions.teams),
    users: sortedUniqueStrings(policy.writerRestrictions.users),
  };
  if (
    expectedWriters.apps.length === 0 ||
    expectedWriters.teams.length !== 0 ||
    expectedWriters.users.length !== 0
  )
    throw new Error(
      "commissioned GitHub bridge writer restrictions must grant only named GitHub Apps",
    );
  if (
    expectedWriters.apps.some(
      (writer) => writer.id === policy.appendOnlyStatusCheck.appId,
    )
  )
    throw new Error(
      "commissioned GitHub append-only validator and branch writer apps must preserve separation of duties",
    );
  const actualWriters = {
    apps: actualWriterApps(response?.restrictions?.apps),
    teams: actualRestrictionNames(response?.restrictions?.teams, "slug"),
    users: actualRestrictionNames(response?.restrictions?.users, "login"),
  };
  const commissionedStatusCheck =
    response?.required_status_checks?.checks?.some(
      (entry) =>
        entry?.context === policy.appendOnlyStatusCheck.context &&
        entry?.app_id === policy.appendOnlyStatusCheck.appId,
    );
  const bypass =
    response?.required_pull_request_reviews?.bypass_pull_request_allowances;
  const bypassCount =
    (bypass?.apps?.length || 0) +
    (bypass?.teams?.length || 0) +
    (bypass?.users?.length || 0);
  if (
    response?.allow_force_pushes?.enabled !== false ||
    response?.allow_deletions?.enabled !== false ||
    response?.enforce_admins?.enabled !== true ||
    response?.required_linear_history?.enabled !== true ||
    response?.required_status_checks?.strict !== true ||
    !response?.required_pull_request_reviews ||
    bypassCount !== 0 ||
    !commissionedStatusCheck ||
    canonicalJson(actualWriters) !== canonicalJson(expectedWriters)
  )
    throw new Error(
      "GitHub head branch does not enforce the commissioned append-only status check, admin protection, linear history, and exclusive writer restrictions",
    );
  return {
    forcePushDisabled: true,
    deletionDisabled: true,
    adminsEnforced: true,
    linearHistoryRequired: true,
    strictStatusChecks: true,
    pullRequestRequired: true,
    bypassAllowancesDisabled: true,
    appendOnlyStatusCheckSha256: sha256(
      canonicalJson(policy.appendOnlyStatusCheck),
    ),
    proposalFlowSha256: sha256(canonicalJson(proposalPolicy)),
    writerRestrictionsSha256: sha256(canonicalJson(actualWriters)),
  };
}

export function validateGithubAppendOnlyHistory(
  records,
  expectedSequence,
  expectedHead,
  expectedHistorySha256,
) {
  if (
    !Number.isSafeInteger(expectedSequence) ||
    expectedSequence < 0 ||
    !SHA256.test(expectedHead || "") ||
    !SHA256.test(expectedHistorySha256 || "")
  )
    throw new Error("GitHub append-only history expectation is invalid");
  if (
    !Array.isArray(records) ||
    records.length !== expectedSequence ||
    records.length > MAX_GITHUB_HISTORY_ENTRIES
  )
    throw new Error(
      "GitHub append-only history does not match the commissioned high-water sequence",
    );
  let priorHeadSha256 = ZERO_HEAD;
  let historySha256 = EMPTY_HISTORY_SHA256;
  for (const [index, record] of records.entries()) {
    if (
      record?.schema !== "valdris.bridge-head.v1" ||
      record.sequence !== index + 1 ||
      record.priorHeadSha256 !== priorHeadSha256 ||
      record.priorHistorySha256 !== historySha256 ||
      !SHA256.test(record.currentHeadSha256 || "") ||
      record.currentHeadSha256 === priorHeadSha256 ||
      !SHA256.test(record.operationId || "") ||
      !SHA256.test(record.protectionEvidenceSha256 || "") ||
      !safeIdentifier(record.runId) ||
      Number.isNaN(Date.parse(record.updatedAt || ""))
    )
      throw new Error(
        "GitHub append-only history is non-contiguous, malformed, or rolled back",
      );
    priorHeadSha256 = record.currentHeadSha256.toLowerCase();
    historySha256 = sha256(
      canonicalJson({
        priorHistorySha256: historySha256,
        recordSha256: sha256(canonicalJson(record)),
        sequence: record.sequence,
      }),
    );
  }
  if (
    priorHeadSha256 !== expectedHead.toLowerCase() ||
    historySha256 !== expectedHistorySha256.toLowerCase()
  )
    throw new Error(
      "GitHub append-only history high-water head or digest does not match compare-and-swap",
    );
  return {
    sequence: expectedSequence,
    currentHeadSha256: priorHeadSha256,
    historySha256,
  };
}

function githubHistoryDirectory(headPath) {
  return headPath.replace(/\.json$/u, ".history");
}

function githubHistoryRecordPath(headPath, sequence) {
  return `${githubHistoryDirectory(headPath)}/${String(sequence).padStart(
    20,
    "0",
  )}.json`;
}

function githubCheckpointPath(headPath) {
  return headPath.replace(/\.json$/u, ".checkpoint.json");
}

function githubRefSha(response, label) {
  const document =
    typeof response === "string" ? JSON.parse(response) : response;
  const value = document?.object?.sha;
  if (!/^[a-f0-9]{40,64}$/iu.test(value || ""))
    throw new Error(`${label} did not return a Git commit identity`);
  return value.toLowerCase();
}

function githubContentDocument(response, label) {
  const document =
    typeof response === "string" ? JSON.parse(response) : response;
  try {
    return {
      document: JSON.parse(
        Buffer.from(
          String(document?.content || "").replace(/\s/gu, ""),
          "base64",
        ).toString("utf8"),
      ),
      contentSha: document?.sha,
    };
  } catch {
    throw new Error(`${label} did not return valid JSON content`);
  }
}

function githubHistorySha256(priorHistorySha256, record) {
  return sha256(
    canonicalJson({
      priorHistorySha256,
      recordSha256: sha256(canonicalJson(record)),
      sequence: record.sequence,
    }),
  );
}

function loadGithubCheckpoint(
  api,
  hostname,
  deadline,
  repository,
  headPath,
  ref,
) {
  const checkpointPath = githubCheckpointPath(headPath);
  const response = githubApi(
    api,
    hostname,
    deadline,
    "checkpoint read",
    [
      `repos/${repository}/contents/${checkpointPath}?ref=${encodeURIComponent(
        ref,
      )}`,
    ],
    true,
  );
  if (response === null) return null;
  const content = githubContentDocument(response, "GitHub history checkpoint");
  if (!/^[a-f0-9]{40,64}$/iu.test(content.contentSha || ""))
    throw new Error("GitHub history checkpoint content identity is invalid");
  return {
    checkpoint: content.document,
    checkpointContentSha: content.contentSha,
    checkpointPath,
  };
}

function validateGithubCheckpoint(checkpoint, headPath) {
  if (
    checkpoint?.schema !== GITHUB_CHECKPOINT_SCHEMA ||
    !Number.isSafeInteger(checkpoint.sequence) ||
    checkpoint.sequence < 1 ||
    checkpoint.sequence > MAX_GITHUB_HISTORY_ENTRIES ||
    !SHA256.test(checkpoint.currentHeadSha256 || "") ||
    !SHA256.test(checkpoint.priorHistorySha256 || "") ||
    !SHA256.test(checkpoint.historySha256 || "") ||
    !SHA256.test(checkpoint.recordSha256 || "") ||
    !SHA256.test(checkpoint.operationId || "") ||
    checkpoint.recordPath !==
      githubHistoryRecordPath(headPath, checkpoint.sequence) ||
    !/^[a-f0-9]{40,64}$/iu.test(checkpoint.recordContentSha || "")
  )
    throw new Error("GitHub cumulative history checkpoint is invalid");
  return checkpoint;
}

function loadGithubTail(api, hostname, deadline, repository, checkpoint, ref) {
  const content = githubContentDocument(
    githubApi(api, hostname, deadline, "history tail read", [
      `repos/${repository}/contents/${
        checkpoint.recordPath
      }?ref=${encodeURIComponent(ref)}`,
    ]),
    "GitHub immutable history tail",
  );
  if (
    content.contentSha !== checkpoint.recordContentSha ||
    sha256(canonicalJson(content.document)) !== checkpoint.recordSha256 ||
    content.document.sequence !== checkpoint.sequence ||
    content.document.operationId !== checkpoint.operationId
  )
    throw new Error(
      "GitHub immutable history tail does not match its authenticated checkpoint",
    );
  return { contentSha: content.contentSha, record: content.document };
}

function checkpointMatchesExpected(
  checkpoint,
  expectedSequence,
  expectedHead,
  expectedHistorySha256,
) {
  if (expectedSequence === 0)
    return (
      checkpoint === null &&
      expectedHead.toLowerCase() === ZERO_HEAD &&
      expectedHistorySha256.toLowerCase() === EMPTY_HISTORY_SHA256
    );
  return (
    checkpoint?.sequence === expectedSequence &&
    checkpoint.currentHeadSha256 === expectedHead.toLowerCase() &&
    checkpoint.historySha256 === expectedHistorySha256.toLowerCase()
  );
}

function parseCheckAttestation(check, expected, policy) {
  let attestation;
  try {
    attestation = JSON.parse(check?.output?.summary);
  } catch {
    throw new Error(
      "GitHub commissioned append-only check omitted its machine attestation",
    );
  }
  const replayRequired = expected.sequence % policy.fullReplayInterval === 0;
  const replay = attestation.fullReplay;
  if (
    attestation.schema !== GITHUB_CHECK_ATTESTATION_SCHEMA ||
    attestation.operationId !== expected.operationId ||
    attestation.sequence !== expected.sequence ||
    attestation.currentHeadSha256 !== expected.currentHeadSha256 ||
    attestation.historySha256 !== expected.historySha256 ||
    attestation.protectionEvidenceSha256 !==
      expected.protectionEvidenceSha256 ||
    !replay ||
    typeof replay.performed !== "boolean" ||
    (replay.performed &&
      (replay.throughSequence !== expected.sequence ||
        replay.historySha256 !== expected.historySha256)) ||
    (replayRequired && replay.performed !== true)
  )
    throw new Error(
      "GitHub commissioned append-only check attestation is incomplete or mismatched",
    );
  return {
    appId: check.app.id,
    checkRunId: check.id,
    context: check.name,
    attestationSha256: sha256(canonicalJson(attestation)),
    fullReplayPerformed: replay.performed,
  };
}

function defaultWait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function executeGithubProtectedProposal(options) {
  const {
    api,
    repository,
    branch,
    headPath,
    runId,
    next,
    expectedSequence,
    expectedHead,
    expectedHistorySha256,
    statusCheck,
    protectionPolicy,
    proposalPolicy,
    hostname,
    deadline,
    wait = defaultWait,
  } = options;
  if (
    typeof api !== "function" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository || "") ||
    !safeIdentifier(branch) ||
    !/^heads\/[A-Za-z0-9_.-]+\.json$/u.test(headPath || "") ||
    !safeIdentifier(runId) ||
    !Number.isSafeInteger(expectedSequence) ||
    expectedSequence < 0 ||
    expectedSequence >= MAX_GITHUB_HISTORY_ENTRIES ||
    !SHA256.test(expectedHead || "") ||
    !SHA256.test(expectedHistorySha256 || "") ||
    !safeIdentifier(statusCheck?.context) ||
    !Number.isSafeInteger(statusCheck?.appId) ||
    statusCheck.appId <= 0
  )
    throw new Error("GitHub protected proposal policy is invalid");
  canonicalGithubHostname(hostname);
  validateGithubProposalPolicy(proposalPolicy);
  if (!deadline?.remaining || !deadline?.assert)
    throw new Error("GitHub total operation deadline is required");
  const refEndpoint = `repos/${repository}/git/ref/heads/${encodeURIComponent(
    branch,
  )}`;
  const protectionEndpoint = `repos/${repository}/branches/${encodeURIComponent(
    branch,
  )}/protection`;
  const protectionObservations = [];
  const observeProtection = (phase) => {
    const response = JSON.parse(
      githubApi(api, hostname, deadline, `${phase} protection`, [
        protectionEndpoint,
      ]),
    );
    const proof = validateGithubProtectionPolicy(protectionPolicy, response);
    const evidenceSha256 = sha256(canonicalJson(response));
    if (
      protectionObservations.length &&
      protectionObservations[0].evidenceSha256 !== evidenceSha256
    )
      throw new Error(`GitHub branch protection drifted during ${phase}`);
    protectionObservations.push({ phase, evidenceSha256, proof });
    return { evidenceSha256, proof };
  };
  const initialProtection = observeProtection("pre-proposal");
  const baseCommitSha = githubRefSha(
    githubApi(api, hostname, deadline, "protected branch snapshot", [
      refEndpoint,
    ]),
    "GitHub protected branch",
  );
  const loadedCheckpoint = loadGithubCheckpoint(
    api,
    hostname,
    deadline,
    repository,
    headPath,
    baseCommitSha,
  );
  const priorCheckpoint = loadedCheckpoint
    ? validateGithubCheckpoint(loadedCheckpoint.checkpoint, headPath)
    : null;
  const priorTail = priorCheckpoint
    ? loadGithubTail(
        api,
        hostname,
        deadline,
        repository,
        priorCheckpoint,
        baseCommitSha,
      )
    : null;
  if (
    priorCheckpoint &&
    githubHistorySha256(
      priorCheckpoint.priorHistorySha256,
      priorTail.record,
    ) !== priorCheckpoint.historySha256
  )
    throw new Error(
      "GitHub cumulative history checkpoint digest does not authenticate its immutable tail",
    );
  const record = {
    ...next,
    priorHistorySha256: expectedHistorySha256.toLowerCase(),
    protectionEvidenceSha256: initialProtection.evidenceSha256,
  };
  if (
    record?.schema !== "valdris.bridge-head.v1" ||
    record.sequence !== expectedSequence + 1 ||
    record.priorHeadSha256 !== expectedHead.toLowerCase() ||
    record.runId !== runId ||
    !SHA256.test(record.operationId || "") ||
    record.updatedAt !== deterministicBridgeTimestamp(record.operationId) ||
    !SHA256.test(record.currentHeadSha256 || "") ||
    record.currentHeadSha256 === record.priorHeadSha256
  )
    throw new Error(
      "GitHub protected proposal record does not advance the commissioned compare-and-swap",
    );
  const historySha256 = githubHistorySha256(
    expectedHistorySha256.toLowerCase(),
    record,
  );
  const recordPath = githubHistoryRecordPath(headPath, record.sequence);
  const proposalBranch = `valdris-head-${record.sequence}-${record.operationId.slice(
    0,
    16,
  )}`;
  const proposalRef = `refs/heads/${proposalBranch}`;
  if (
    priorCheckpoint?.sequence === record.sequence &&
    priorCheckpoint.operationId === record.operationId
  ) {
    if (
      priorCheckpoint.currentHeadSha256 !== record.currentHeadSha256 ||
      priorCheckpoint.priorHistorySha256 !== record.priorHistorySha256 ||
      priorCheckpoint.historySha256 !== historySha256 ||
      canonicalJson(priorTail?.record) !== canonicalJson(record)
    )
      throw new Error(
        "GitHub protected history has a stale or different tail for this operation",
      );
    const pullRequests = JSON.parse(
      githubApi(api, hostname, deadline, "resume pull-request evidence", [
        `repos/${repository}/commits/${baseCommitSha}/pulls`,
      ]),
    );
    const matches = (Array.isArray(pullRequests) ? pullRequests : []).filter(
      (pull) =>
        pull?.head?.ref === proposalBranch &&
        pull?.base?.ref === branch &&
        pull?.merge_commit_sha === baseCommitSha &&
        pull?.merged_at,
    );
    if (matches.length !== 1)
      throw new Error(
        "GitHub committed proposal lacks unique durable pull-request evidence",
      );
    const pullRequest = matches[0];
    const proposalCommitSha = pullRequest?.head?.sha;
    if (!/^[a-f0-9]{40,64}$/iu.test(proposalCommitSha || ""))
      throw new Error("GitHub resumed proposal commit identity is invalid");
    const checks = JSON.parse(
      githubApi(api, hostname, deadline, "resume check evidence", [
        `repos/${repository}/commits/${proposalCommitSha}/check-runs`,
      ]),
    )?.check_runs;
    const checkMatches = (Array.isArray(checks) ? checks : []).filter(
      (check) =>
        check?.name === statusCheck.context &&
        check?.app?.id === statusCheck.appId &&
        check?.status === "completed" &&
        check?.conclusion === "success",
    );
    if (checkMatches.length !== 1)
      throw new Error(
        "GitHub committed proposal lacks unique commissioned check evidence",
      );
    const commissionedCheck = parseCheckAttestation(
      checkMatches[0],
      {
        operationId: record.operationId,
        sequence: record.sequence,
        currentHeadSha256: record.currentHeadSha256,
        historySha256,
        protectionEvidenceSha256: initialProtection.evidenceSha256,
      },
      proposalPolicy,
    );
    observeProtection("post-merge-resume");
    let cleanup;
    try {
      githubApi(
        api,
        hostname,
        deadline,
        "proposal ref cleanup retry",
        [
          "--method",
          "DELETE",
          `repos/${repository}/git/refs/heads/${encodeURIComponent(
            proposalBranch,
          )}`,
        ],
        true,
      );
      cleanup = { attempts: 1, status: "completed" };
    } catch (error) {
      cleanup = {
        attempts: 1,
        status: "pending",
        problemSha256: sha256(error.message),
      };
    }
    return {
      baseCommitSha: pullRequest.base?.sha,
      commissionedCheck,
      contentSha: priorCheckpoint.recordContentSha,
      historyDirectory: githubHistoryDirectory(headPath),
      historySha256,
      mergeCommitSha: baseCommitSha,
      operationId: record.operationId,
      priorHistorySha256: expectedHistorySha256.toLowerCase(),
      proposalBranch,
      proposalCommitSha,
      protectionObservations,
      pullRequestNumber: pullRequest.number,
      recordPath,
      recordSha256: sha256(canonicalJson(record)),
      recordUpdatedAt: record.updatedAt,
      resumed: true,
      cleanup,
    };
  }
  if (priorCheckpoint?.sequence === record.sequence)
    throw new Error(
      "GitHub protected history has a stale or different tail for this operation",
    );
  if (
    !checkpointMatchesExpected(
      priorCheckpoint,
      expectedSequence,
      expectedHead,
      expectedHistorySha256,
    )
  )
    throw new Error(
      "GitHub cumulative history checkpoint rejected the expected compare-and-swap",
    );
  let proposalCreated = false;
  let result;
  let failure;
  let committed = false;
  try {
    githubApi(api, hostname, deadline, "proposal ref creation", [
      "--method",
      "POST",
      `repos/${repository}/git/refs`,
      "-f",
      `ref=${proposalRef}`,
      "-f",
      `sha=${baseCommitSha}`,
    ]);
    proposalCreated = true;
    const proposalContent = JSON.parse(
      githubApi(api, hostname, deadline, "immutable record creation", [
        "--method",
        "PUT",
        `repos/${repository}/contents/${recordPath}`,
        "-f",
        `message=Valdris append-only head ${runId} sequence ${record.sequence}`,
        "-f",
        `content=${Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString(
          "base64",
        )}`,
        "-f",
        `branch=${proposalBranch}`,
      ]),
    );
    const contentSha = proposalContent?.content?.sha;
    if (
      !/^[a-f0-9]{40,64}$/iu.test(contentSha || "") ||
      !/^[a-f0-9]{40,64}$/iu.test(proposalContent?.commit?.sha || "")
    )
      throw new Error(
        "GitHub proposal did not return content and commit identities",
      );
    const checkpoint = {
      schema: GITHUB_CHECKPOINT_SCHEMA,
      sequence: record.sequence,
      currentHeadSha256: record.currentHeadSha256,
      priorHistorySha256: record.priorHistorySha256,
      historySha256,
      recordPath,
      recordSha256: sha256(canonicalJson(record)),
      recordContentSha: contentSha,
      operationId: record.operationId,
    };
    const checkpointArgs = [
      "--method",
      "PUT",
      `repos/${repository}/contents/${githubCheckpointPath(headPath)}`,
      "-f",
      `message=Valdris cumulative checkpoint ${runId} sequence ${record.sequence}`,
      "-f",
      `content=${Buffer.from(
        `${JSON.stringify(checkpoint, null, 2)}\n`,
      ).toString("base64")}`,
      "-f",
      `branch=${proposalBranch}`,
    ];
    if (loadedCheckpoint?.checkpointContentSha)
      checkpointArgs.push("-f", `sha=${loadedCheckpoint.checkpointContentSha}`);
    const checkpointResponse = JSON.parse(
      githubApi(
        api,
        hostname,
        deadline,
        "cumulative checkpoint update",
        checkpointArgs,
      ),
    );
    const proposalCommitSha = checkpointResponse?.commit?.sha;
    if (!/^[a-f0-9]{40,64}$/iu.test(proposalCommitSha || ""))
      throw new Error(
        "GitHub checkpoint update omitted its proposal commit identity",
      );
    const pullRequest = JSON.parse(
      githubApi(api, hostname, deadline, "proposal pull request creation", [
        "--method",
        "POST",
        `repos/${repository}/pulls`,
        "-f",
        `title=Valdris head ${runId} sequence ${record.sequence}`,
        "-f",
        `head=${proposalBranch}`,
        "-f",
        `base=${branch}`,
        "-f",
        `body=Append-only Valdris bridge-head proposal ${record.operationId}.`,
      ]),
    );
    if (
      !Number.isSafeInteger(pullRequest?.number) ||
      pullRequest.number < 1 ||
      pullRequest?.head?.sha !== proposalCommitSha ||
      pullRequest?.base?.sha !== baseCommitSha
    )
      throw new Error(
        "GitHub proposal pull request substituted its base or head",
      );
    let commissionedCheck;
    for (;;) {
      const observedPullRequest = JSON.parse(
        githubApi(api, hostname, deadline, "proposal poll", [
          `repos/${repository}/pulls/${pullRequest.number}`,
        ]),
      );
      if (
        observedPullRequest?.head?.sha !== proposalCommitSha ||
        observedPullRequest?.base?.ref !== branch ||
        observedPullRequest?.base?.sha !== baseCommitSha ||
        observedPullRequest?.state !== "open" ||
        observedPullRequest?.draft === true ||
        observedPullRequest?.mergeable === false
      )
        throw new Error(
          "GitHub proposal pull request changed before protected merge",
        );
      const checks = JSON.parse(
        githubApi(api, hostname, deadline, "commissioned check poll", [
          `repos/${repository}/commits/${proposalCommitSha}/check-runs`,
        ]),
      )?.check_runs;
      const matches = (Array.isArray(checks) ? checks : []).filter(
        (check) =>
          check?.name === statusCheck.context &&
          check?.app?.id === statusCheck.appId,
      );
      if (matches.length > 1)
        throw new Error(
          "GitHub proposal has ambiguous commissioned append-only checks",
        );
      commissionedCheck = matches[0];
      if (
        commissionedCheck?.status === "completed" &&
        commissionedCheck?.conclusion === "success" &&
        Number.isSafeInteger(commissionedCheck?.id) &&
        commissionedCheck.id > 0
      ) {
        commissionedCheck = parseCheckAttestation(
          commissionedCheck,
          {
            operationId: record.operationId,
            sequence: record.sequence,
            currentHeadSha256: record.currentHeadSha256,
            historySha256,
            protectionEvidenceSha256: initialProtection.evidenceSha256,
          },
          proposalPolicy,
        );
        break;
      }
      if (
        commissionedCheck?.status === "completed" &&
        commissionedCheck?.conclusion === "success"
      )
        throw new Error(
          "GitHub commissioned append-only check omitted its provider identity",
        );
      if (
        commissionedCheck?.status === "completed" &&
        commissionedCheck?.conclusion !== "success"
      )
        throw new Error(
          "GitHub commissioned append-only check rejected the proposal",
        );
      const waitMs = Math.min(
        proposalPolicy.pollIntervalMs,
        deadline.remaining("commissioned check wait"),
      );
      wait(waitMs);
      deadline.assert("commissioned check wait");
    }
    observeProtection("pre-merge");
    if (
      githubRefSha(
        githubApi(api, hostname, deadline, "pre-merge branch CAS", [
          refEndpoint,
        ]),
        "GitHub protected branch",
      ) !== baseCommitSha
    )
      throw new Error(
        "GitHub protected branch advanced during proposal compare-and-swap",
      );
    const merge = JSON.parse(
      githubApi(api, hostname, deadline, "protected merge", [
        "--method",
        "PUT",
        `repos/${repository}/pulls/${pullRequest.number}/merge`,
        "-f",
        `sha=${proposalCommitSha}`,
        "-f",
        `merge_method=${proposalPolicy.mergeMethod}`,
      ]),
    );
    if (merge?.merged !== true || !/^[a-f0-9]{40,64}$/iu.test(merge?.sha || ""))
      throw new Error(
        "GitHub protected merge was rejected or omitted its commit identity",
      );
    const mergeCommitSha = merge.sha.toLowerCase();
    committed = true;
    if (
      githubRefSha(
        githubApi(api, hostname, deadline, "post-merge branch read", [
          refEndpoint,
        ]),
        "GitHub protected branch after merge",
      ) !== mergeCommitSha
    )
      throw new Error(
        "GitHub protected branch changed before post-merge verification",
      );
    observeProtection("post-merge");
    const mergedLoadedCheckpoint = loadGithubCheckpoint(
      api,
      hostname,
      deadline,
      repository,
      headPath,
      mergeCommitSha,
    );
    const mergedCheckpoint = validateGithubCheckpoint(
      mergedLoadedCheckpoint?.checkpoint,
      headPath,
    );
    const mergedTail = loadGithubTail(
      api,
      hostname,
      deadline,
      repository,
      mergedCheckpoint,
      mergeCommitSha,
    );
    if (
      canonicalJson(mergedTail.record) !== canonicalJson(record) ||
      mergedTail.contentSha !== contentSha ||
      mergedCheckpoint.historySha256 !== historySha256 ||
      mergedCheckpoint.currentHeadSha256 !== record.currentHeadSha256
    )
      throw new Error(
        "GitHub post-merge history record or content identity was substituted",
      );
    result = {
      baseCommitSha,
      commissionedCheck,
      contentSha,
      historyDirectory: githubHistoryDirectory(headPath),
      historySha256,
      mergeCommitSha,
      operationId: record.operationId,
      priorHistorySha256: expectedHistorySha256.toLowerCase(),
      proposalBranch,
      proposalCommitSha,
      protectionObservations,
      pullRequestNumber: pullRequest.number,
      recordPath,
      recordSha256: sha256(canonicalJson(record)),
      recordUpdatedAt: record.updatedAt,
      resumed: false,
    };
  } catch (error) {
    failure = error;
  }
  let cleanup;
  if (proposalCreated)
    try {
      githubApi(
        api,
        hostname,
        deadline,
        "proposal ref cleanup",
        [
          "--method",
          "DELETE",
          `repos/${repository}/git/refs/heads/${encodeURIComponent(
            proposalBranch,
          )}`,
        ],
        true,
      );
      cleanup = { attempts: 1, status: "completed" };
    } catch (error) {
      cleanup = {
        attempts: 1,
        status: "pending",
        problemSha256: sha256(error.message),
      };
      if (!committed && !failure) failure = error;
    }
  if (failure) throw failure;
  return { ...result, cleanup: cleanup || { attempts: 0, status: "none" } };
}

function receiptFileIdentity(stats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    mode: String(stats.mode),
  };
}

function fsyncReceiptRoot(rootPath) {
  let descriptor;
  try {
    descriptor = openSync(rootPath, "r");
    fsyncSync(descriptor);
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EBADF", "EISDIR", "EPERM"].includes(error.code)
    )
      return;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeReceiptBytes(descriptor, contents, fault = () => {}) {
  const bytes = Buffer.from(contents, "utf8");
  const split = Math.max(1, Math.floor(bytes.length / 2));
  let offset = 0;
  while (offset < split) {
    offset += writeSync(descriptor, bytes, offset, split - offset, offset);
  }
  fault("after-temp-partial-write");
  while (offset < bytes.length) {
    offset += writeSync(
      descriptor,
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
  }
}

function readReceiptJson(filePath, label) {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error(`${label} is not a regular file`);
  const bytes = readFileSync(filePath, "utf8");
  let document;
  try {
    document = JSON.parse(bytes);
  } catch {
    throw new Error(`${label} is malformed`);
  }
  return { bytes, document };
}

function assertFinalGithubReceipt(filePath, operationId) {
  const result = readReceiptJson(filePath, "GitHub final receipt");
  if (
    result.document.schema !== "valdris.bridge-head-receipt.v1" ||
    result.document.operationId !== operationId ||
    result.document.providerProof?.operationId !== operationId
  )
    throw new Error(
      "GitHub final receipt is invalid or belongs to a different operation",
    );
  return result;
}

function receiptArtifactPaths(rootPath, receiptName, operationId) {
  const key = sha256(
    canonicalJson({
      schema: "valdris.github-receipt-artifacts.v1",
      receiptName,
      operationId,
    }),
  ).slice(0, 32);
  return {
    journalPath: path.join(rootPath, `.${key}.journal.json`),
    reservationPath: path.join(rootPath, `.${key}.reservation.json`),
    tempPath: path.join(rootPath, `.${key}.receipt.tmp`),
    quarantinePrefix: `.${key}.quarantine-`,
  };
}

function quarantineReceiptArtifact(reservation, filePath, kind) {
  assertOperatorRootUnchanged(reservation.rootPath, reservation.root);
  if (!existsSync(filePath)) return null;
  for (let index = 0; index < 1000; index += 1) {
    const candidate = path.join(
      reservation.root.path,
      `${reservation.quarantinePrefix}${kind}-${String(index).padStart(
        3,
        "0",
      )}`,
    );
    if (existsSync(candidate)) continue;
    try {
      renameSync(filePath, candidate);
      fsyncReceiptRoot(reservation.root.path);
      assertOperatorRootUnchanged(reservation.rootPath, reservation.root);
      return candidate;
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes(error.code)) continue;
      throw error;
    }
  }
  throw new Error("GitHub receipt quarantine namespace is exhausted");
}

function writeDurableReceiptArtifact(filePath, contents, rootPath) {
  let descriptor;
  try {
    descriptor = openSync(filePath, "wx", 0o600);
    writeReceiptBytes(descriptor, contents);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncReceiptRoot(rootPath);
}

function receiptReservationDocument(receiptName, operationId, artifactPaths) {
  return {
    schema: "valdris.github-receipt-reservation.v2",
    operationId,
    status: "reserved",
    targetName: receiptName,
    tempName: path.basename(artifactPaths.tempPath),
    journalName: path.basename(artifactPaths.journalPath),
  };
}

function receiptJournalDocument(reservation, contents) {
  return {
    schema: "valdris.github-receipt-journal.v1",
    operationId: reservation.operationId,
    status: "prepared",
    targetName: path.basename(reservation.target),
    tempName: path.basename(reservation.tempPath),
    contentsSha256: sha256(contents),
    byteLength: Buffer.byteLength(contents, "utf8"),
  };
}

function validateReceiptJournal(reservation, journal, contents = null) {
  const document = journal.document;
  if (
    document?.schema !== "valdris.github-receipt-journal.v1" ||
    document.operationId !== reservation.operationId ||
    document.status !== "prepared" ||
    document.targetName !== path.basename(reservation.target) ||
    document.tempName !== path.basename(reservation.tempPath) ||
    !SHA256.test(document.contentsSha256 || "") ||
    !Number.isSafeInteger(document.byteLength) ||
    document.byteLength < 1 ||
    (contents !== null &&
      (document.contentsSha256 !== sha256(contents) ||
        document.byteLength !== Buffer.byteLength(contents, "utf8")))
  )
    throw new Error("GitHub receipt journal is invalid");
  return document;
}

function safeReceiptName(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.json$/u.test(value) ||
    path.basename(value) !== value
  )
    throw new Error(
      "GitHub receipt must be one direct-child portable JSON filename",
    );
  return value;
}

export function assertGithubReceiptRootSeparated(receiptRoot, repoRoot) {
  const receipt = realpathSync(receiptRoot);
  const repository = realpathSync(repoRoot);
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== "..")
    );
  };
  if (contains(receipt, repository) || contains(repository, receipt))
    throw new Error(
      "GitHub receipt root must be outside and must not contain the repository",
    );
  return { receiptRoot: receipt, repoRoot: repository };
}

export function reserveGithubReceipt(
  receiptRoot,
  receiptName,
  operationId,
  policy,
) {
  if (!SHA256.test(operationId || ""))
    throw new Error("GitHub receipt operation identity is invalid");
  const root = assertOperatorRootSecurity(receiptRoot, {
    expectedPathSha256: policy?.pathSha256,
    expectedIdentitySha256: policy?.identitySha256,
  });
  const safeName = safeReceiptName(receiptName);
  const target = path.join(root.path, safeName);
  const artifactPaths = receiptArtifactPaths(root.path, safeName, operationId);
  const expectedReservation = receiptReservationDocument(
    safeName,
    operationId,
    artifactPaths,
  );
  let descriptor;
  let existingDocument = null;
  if (existsSync(target)) {
    existingDocument = assertFinalGithubReceipt(target, operationId).document;
  }
  let createdReservation = false;
  if (existsSync(artifactPaths.reservationPath)) {
    const existingReservation = readReceiptJson(
      artifactPaths.reservationPath,
      "GitHub receipt reservation",
    );
    if (
      canonicalJson(existingReservation.document) !==
      canonicalJson(expectedReservation)
    )
      throw new Error(
        "GitHub receipt reservation belongs to a different operation",
      );
    descriptor = openSync(artifactPaths.reservationPath, "r+");
  } else {
    descriptor = openSync(artifactPaths.reservationPath, "wx+", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(expectedReservation)}\n`);
    fsyncSync(descriptor);
    fsyncReceiptRoot(root.path);
    createdReservation = true;
  }
  const identity = receiptFileIdentity(fstatSync(descriptor, { bigint: true }));
  assertOperatorRootUnchanged(receiptRoot, root);
  return {
    ...artifactPaths,
    createdReservation,
    descriptor,
    existingDocument,
    identity,
    operationId,
    root,
    rootPath: receiptRoot,
    target,
  };
}

export function commitGithubReceiptReservation(
  reservation,
  contents,
  options = {},
) {
  const fault = typeof options.fault === "function" ? options.fault : () => {};
  assertOperatorRootUnchanged(reservation.rootPath, reservation.root);
  if (
    canonicalJson(
      receiptFileIdentity(fstatSync(reservation.descriptor, { bigint: true })),
    ) !== canonicalJson(reservation.identity) ||
    !existsSync(reservation.reservationPath) ||
    canonicalJson(
      receiptFileIdentity(
        lstatSync(reservation.reservationPath, { bigint: true }),
      ),
    ) !== canonicalJson(reservation.identity)
  )
    throw new Error(
      "GitHub receipt reservation identity changed before commit",
    );
  let requestedDocument;
  try {
    requestedDocument = JSON.parse(contents);
  } catch {
    throw new Error("GitHub final receipt contents are malformed");
  }
  if (
    requestedDocument.schema !== "valdris.bridge-head-receipt.v1" ||
    requestedDocument.operationId !== reservation.operationId ||
    requestedDocument.providerProof?.operationId !== reservation.operationId
  )
    throw new Error(
      "GitHub final receipt contents do not bind the reserved operation",
    );

  const finalizeExistingTarget = () => {
    const finalReceipt = assertFinalGithubReceipt(
      reservation.target,
      reservation.operationId,
    );
    let journalAuthenticated = false;
    if (existsSync(reservation.journalPath)) {
      try {
        const journal = readReceiptJson(
          reservation.journalPath,
          "GitHub receipt journal",
        );
        const journalDocument = validateReceiptJournal(reservation, journal);
        if (
          journalDocument.contentsSha256 !== sha256(finalReceipt.bytes) ||
          journalDocument.byteLength !==
            Buffer.byteLength(finalReceipt.bytes, "utf8")
        )
          throw new Error(
            "GitHub final receipt does not match its durable journal",
          );
        journalAuthenticated = true;
      } catch (error) {
        if (finalReceipt.bytes !== contents)
          throw new Error(
            `GitHub existing final receipt is not authenticated by its durable journal: ${error.message}`,
          );
        if (!existsSync(reservation.journalPath)) throw error;
        quarantineReceiptArtifact(
          reservation,
          reservation.journalPath,
          "journal",
        );
      }
    }
    if (!journalAuthenticated) {
      if (finalReceipt.bytes !== contents)
        throw new Error(
          "GitHub existing final receipt is not authenticated by a durable journal",
        );
      if (existsSync(reservation.journalPath))
        throw new Error(
          "GitHub existing final receipt journal recovery did not quarantine stale state",
        );
      writeDurableReceiptArtifact(
        reservation.journalPath,
        `${JSON.stringify(
          receiptJournalDocument(reservation, finalReceipt.bytes),
        )}\n`,
        reservation.root.path,
      );
      journalAuthenticated = true;
    }
    if (!journalAuthenticated)
      throw new Error(
        "GitHub existing final receipt could not be authenticated",
      );
    if (existsSync(reservation.tempPath)) {
      let removeTemp = false;
      try {
        const tempStats = lstatSync(reservation.tempPath);
        removeTemp =
          tempStats.isFile() &&
          !tempStats.isSymbolicLink() &&
          readFileSync(reservation.tempPath, "utf8") === finalReceipt.bytes;
      } catch {
        removeTemp = false;
      }
      if (removeTemp) {
        unlinkSync(reservation.tempPath);
        fsyncReceiptRoot(reservation.root.path);
      } else {
        quarantineReceiptArtifact(reservation, reservation.tempPath, "temp");
      }
    }
    if (reservation.descriptor !== undefined) {
      closeSync(reservation.descriptor);
      reservation.descriptor = undefined;
    }
    assertOperatorRootUnchanged(reservation.rootPath, reservation.root);
    return reservation.target;
  };

  if (existsSync(reservation.target)) return finalizeExistingTarget();

  let publicationContents = contents;
  let journalDocument;
  if (existsSync(reservation.journalPath)) {
    try {
      const journal = readReceiptJson(
        reservation.journalPath,
        "GitHub receipt journal",
      );
      journalDocument = validateReceiptJournal(reservation, journal);
    } catch {
      quarantineReceiptArtifact(
        reservation,
        reservation.journalPath,
        "journal",
      );
    }
  }
  if (journalDocument && existsSync(reservation.tempPath)) {
    try {
      const tempStats = lstatSync(reservation.tempPath);
      const tempBytes = readFileSync(reservation.tempPath, "utf8");
      if (
        !tempStats.isFile() ||
        tempStats.isSymbolicLink() ||
        sha256(tempBytes) !== journalDocument.contentsSha256 ||
        Buffer.byteLength(tempBytes, "utf8") !== journalDocument.byteLength
      )
        throw new Error("GitHub stale receipt temp is invalid");
      publicationContents = tempBytes;
    } catch {
      quarantineReceiptArtifact(reservation, reservation.tempPath, "temp");
      quarantineReceiptArtifact(
        reservation,
        reservation.journalPath,
        "journal",
      );
      journalDocument = undefined;
    }
  } else if (journalDocument) {
    quarantineReceiptArtifact(reservation, reservation.journalPath, "journal");
    journalDocument = undefined;
  } else if (existsSync(reservation.tempPath)) {
    quarantineReceiptArtifact(reservation, reservation.tempPath, "temp");
  }

  if (!journalDocument) {
    journalDocument = receiptJournalDocument(reservation, publicationContents);
    writeDurableReceiptArtifact(
      reservation.journalPath,
      `${JSON.stringify(journalDocument)}\n`,
      reservation.root.path,
    );
  }
  if (!existsSync(reservation.tempPath)) {
    let tempDescriptor;
    try {
      tempDescriptor = openSync(reservation.tempPath, "wx", 0o600);
      fault("after-temp-create");
      writeReceiptBytes(tempDescriptor, publicationContents, fault);
      fsyncSync(tempDescriptor);
      fault("after-temp-fsync");
    } finally {
      if (tempDescriptor !== undefined) closeSync(tempDescriptor);
    }
  }
  const tempStats = lstatSync(reservation.tempPath);
  const tempBytes = readFileSync(reservation.tempPath, "utf8");
  if (
    !tempStats.isFile() ||
    tempStats.isSymbolicLink() ||
    sha256(tempBytes) !== journalDocument.contentsSha256 ||
    Buffer.byteLength(tempBytes, "utf8") !== journalDocument.byteLength
  )
    throw new Error("GitHub receipt temp does not match its durable journal");
  assertOperatorRootUnchanged(reservation.rootPath, reservation.root);
  try {
    linkSync(reservation.tempPath, reservation.target);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  fault("after-publish");
  if (!existsSync(reservation.target))
    throw new Error("GitHub final receipt publication did not create a target");
  const targetDescriptor = openSync(reservation.target, "r+");
  try {
    fsyncSync(targetDescriptor);
  } finally {
    closeSync(targetDescriptor);
  }
  fault("after-target-fsync");
  fsyncReceiptRoot(reservation.root.path);
  fault("after-root-fsync");
  const result = finalizeExistingTarget();
  assertOperatorRootUnchanged(reservation.rootPath, reservation.root);
  return result;
}

export function abortGithubReceiptReservation(reservation, options = {}) {
  if (!reservation) return;
  if (reservation.descriptor !== undefined) {
    closeSync(reservation.descriptor);
    reservation.descriptor = undefined;
  }
  if (options.preserve === true) return;
  if (
    !reservation.existingDocument &&
    reservation.createdReservation &&
    !existsSync(reservation.target) &&
    existsSync(reservation.reservationPath) &&
    canonicalJson(
      receiptFileIdentity(
        lstatSync(reservation.reservationPath, { bigint: true }),
      ),
    ) === canonicalJson(reservation.identity)
  ) {
    for (const artifact of [
      reservation.tempPath,
      reservation.journalPath,
      reservation.reservationPath,
    ])
      if (existsSync(artifact)) unlinkSync(artifact);
    fsyncReceiptRoot(reservation.root.path);
  }
}

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    branch: "valdris-heads",
    proofInputFile: "assurance/bridge-proof-input.json",
    semanticFile: "assurance/semantic.json",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--github-repo") args.githubRepo = argv[++index];
    else if (arg === "--github-hostname") args.githubHostname = argv[++index];
    else if (arg === "--branch") args.branch = argv[++index];
    else if (arg === "--head-path") args.headPath = argv[++index];
    else if (arg === "--run-id") args.runId = argv[++index];
    else if (arg === "--expected-sequence")
      args.expectedSequence = Number(argv[++index]);
    else if (arg === "--expected-head") args.expectedHead = argv[++index];
    else if (arg === "--expected-history-sha256")
      args.expectedHistorySha256 = argv[++index];
    else if (arg === "--proof-input-file") args.proofInputFile = argv[++index];
    else if (arg === "--semantic-file") args.semanticFile = argv[++index];
    else if (arg === "--receipt") args.receipt = argv[++index];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

export function githubCliEnvironment(environment = process.env) {
  const clean = Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "HOME", "USERPROFILE"]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  if (environment.GH_TOKEN) clean.GH_TOKEN = environment.GH_TOKEN;
  else if (environment.GITHUB_TOKEN)
    clean.GITHUB_TOKEN = environment.GITHUB_TOKEN;
  return clean;
}

function gh(args, options = {}) {
  if (
    args[0] !== "api" ||
    args[1] !== "--hostname" ||
    !args[2] ||
    args[2] !== canonicalGithubHostname(args[2])
  )
    throw new Error("every GitHub API call must bind a canonical hostname");
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
    env: githubCliEnvironment(),
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (options.tolerate404 && /(?:HTTP 404|Not Found)/i.test(output))
      return null;
    throw new Error(`gh ${args.join(" ")} failed: ${output.trim()}`);
  }
  return result.stdout;
}

function preflightReceiptSigner(repoRoot) {
  const keyFile = process.env.VALDRIS_HEAD_PRIVATE_KEY_FILE;
  const keyId = process.env.VALDRIS_HEAD_KEY_ID;
  const trustPin = process.env[AUTHORITY_TRUST_SHA256_ENV];
  if (!keyFile || !existsSync(keyFile))
    throw new Error(
      "VALDRIS_HEAD_PRIVATE_KEY_FILE must reference an operator-controlled Ed25519 private key",
    );
  if (!safeIdentifier(keyId))
    throw new Error("VALDRIS_HEAD_KEY_ID is required");
  if (!SHA256.test(trustPin || ""))
    throw new Error(`${AUTHORITY_TRUST_SHA256_ENV} is required`);
  const privateKey = createPrivateKey(readFileSync(keyFile));
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("GitHub receipt signer must be an Ed25519 private key");
  const trustRelativePath = existsSync(
    path.join(repoRoot, "controls", "authority-trust.v1.json"),
  )
    ? path.join("controls", "authority-trust.v1.json")
    : path.join(".valdris-harness", "controls", "authority-trust.v1.json");
  const trustStore = readJson(
    resolveArtifactPath(repoRoot, trustRelativePath, { mustExist: true }),
  );
  if (authorityTrustStoreSha256(trustStore) !== trustPin.toLowerCase())
    throw new Error(
      `${AUTHORITY_TRUST_SHA256_ENV} does not match the commissioned authority trust store`,
    );
  const commissionedKey = trustStore.keys?.find(
    (entry) => entry?.keyId === keyId && entry?.status === "active",
  );
  const actorId = process.env.VALDRIS_HEAD_ACTOR_ID || "github-head-adapter";
  const derivedPublicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString()
    .trim();
  if (
    !commissionedKey?.publicKeyPem ||
    commissionedKey.algorithm !== "ed25519" ||
    !commissionedKey.allowedSchemas?.includes(
      "valdris.bridge-head-receipt.v1",
    ) ||
    !commissionedKey.allowedActorIds?.includes(actorId) ||
    commissionedKey.publicKeyPem.trim() !== derivedPublicKey
  )
    throw new Error(
      "GitHub receipt signer does not match the active commissioned authority key",
    );
  return {
    keyId,
    actorId,
    trustPin: trustPin.toLowerCase(),
    sign(document) {
      document.authorityTrustSha256 = trustPin.toLowerCase();
      document.attestation = {
        scheme: "ed25519",
        keyId,
        signedAt: new Date().toISOString(),
      };
      const payload = canonicalJson(authorityAttestationPayload(document));
      document.attestation.payloadSha256 = sha256(payload);
      document.attestation.signature = signPayload(
        null,
        Buffer.from(payload),
        privateKey,
      ).toString("base64");
      return document;
    },
  };
}

export function deterministicBridgeTimestamp(operationId) {
  const epoch = Date.parse("2020-01-01T00:00:00.000Z");
  const windowMs = 50 * 365 * 24 * 60 * 60 * 1000;
  const offset = Number(BigInt(`0x${operationId.slice(0, 12)}`)) % windowMs;
  return new Date(epoch + offset).toISOString();
}

function main() {
  const operationStartedMs = Date.now();
  const args = parseArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/github-bridge-head.mjs --repo . --proof-input-file assurance/bridge-proof-input.json --github-hostname github.com --github-repo OWNER/REPO --branch valdris-heads --head-path heads/NAME.json --run-id ID --expected-sequence N --expected-head SHA256 --expected-history-sha256 SHA256 --receipt NAME.json [--dry-run]",
    );
  canonicalGithubHostname(args.githubHostname);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.githubRepo || ""))
    throw new Error("--github-repo must be OWNER/REPO");
  if (!safeIdentifier(args.branch) || !safeIdentifier(args.runId))
    throw new Error("--branch and --run-id must be safe identifiers");
  if (!/^heads\/[A-Za-z0-9_.-]+\.json$/.test(args.headPath || ""))
    throw new Error("--head-path must be heads/NAME.json");
  if (!Number.isSafeInteger(args.expectedSequence) || args.expectedSequence < 0)
    throw new Error("--expected-sequence must be a non-negative integer");
  if (args.expectedSequence >= MAX_GITHUB_HISTORY_ENTRIES)
    throw new Error(
      "GitHub append-only history reached its commissioned namespace limit",
    );
  const repoRoot = path.resolve(args.repo);
  const proofInputPath = resolveArtifactPath(repoRoot, args.proofInputFile, {
    mustExist: true,
  });
  const semanticPath = resolveArtifactPath(repoRoot, args.semanticFile, {
    mustExist: true,
  });
  const commissionedHead = readJson(semanticPath)?.acceptancePolicy?.bridgeHead;
  const providerIdentitySha256 =
    process.env.VALDRIS_HEAD_PROVIDER_IDENTITY_SHA256;
  const target = {
    hostname: args.githubHostname,
    repository: args.githubRepo,
    branch: args.branch,
    headPath: args.headPath,
  };
  if (
    commissionedHead?.provider !== "github" ||
    commissionedHead?.adapterSchema !==
      "valdris.github-head-provider-proof.v1" ||
    commissionedHead?.targetSha256 !== sha256(canonicalJson(target)) ||
    !commissionedHead?.protectionPolicy ||
    commissionedHead?.protectionPolicySha256 !==
      sha256(canonicalJson(commissionedHead.protectionPolicy)) ||
    !SHA256.test(commissionedHead?.protectionPolicySha256 || "") ||
    !SHA256.test(providerIdentitySha256 || "") ||
    commissionedHead.providerIdentitySha256 !==
      providerIdentitySha256.toLowerCase() ||
    !SHA256.test(commissionedHead?.receiptRootPolicy?.pathSha256 || "") ||
    !SHA256.test(commissionedHead?.receiptRootPolicy?.identitySha256 || "")
  )
    throw new Error(
      "GitHub head target, adapter, protection policy, and provider identity must match the commissioned acceptance policy",
    );
  validateGithubProposalPolicy(commissionedHead.protectionPolicy.proposalFlow);
  const proofInputDocument = readJson(proofInputPath);
  if (
    proofInputDocument.schema !== "valdris.bridge-proof-input.v1" ||
    proofInputDocument.runId !== args.runId ||
    !proofInputDocument.proofInput ||
    typeof proofInputDocument.proofInput !== "object" ||
    Array.isArray(proofInputDocument.proofInput)
  )
    throw new Error("bridge proof-input manifest is invalid");
  const currentHead = sha256(canonicalJson(proofInputDocument.proofInput));
  const proofInputFileSha256 = fileSha256(proofInputPath);
  if (
    !SHA256.test(args.expectedHead || "") ||
    !SHA256.test(args.expectedHistorySha256 || "") ||
    args.expectedHead === currentHead
  )
    throw new Error(
      "expected and current heads must be distinct SHA-256 digests",
    );
  if (args.expectedSequence === 0 && args.expectedHead !== ZERO_HEAD)
    throw new Error("sequence zero must use the all-zero genesis head");
  if (
    args.expectedSequence === 0 &&
    args.expectedHistorySha256 !== EMPTY_HISTORY_SHA256
  )
    throw new Error(
      `sequence zero must use empty history digest ${EMPTY_HISTORY_SHA256}`,
    );
  const operationId = sha256(
    canonicalJson({
      schema: "valdris.github-head-operation.v1",
      runId: args.runId,
      targetSha256: commissionedHead.targetSha256,
      proofInputFileSha256,
      currentHeadSha256: currentHead,
      expectedSequence: args.expectedSequence,
      expectedHeadSha256: args.expectedHead.toLowerCase(),
      expectedHistorySha256: args.expectedHistorySha256.toLowerCase(),
    }),
  );
  const next = {
    schema: "valdris.bridge-head.v1",
    sequence: args.expectedSequence + 1,
    priorHeadSha256: args.expectedHead.toLowerCase(),
    currentHeadSha256: currentHead,
    runId: args.runId,
    operationId,
    updatedAt: deterministicBridgeTimestamp(operationId),
  };
  const plan = {
    provider: "github",
    providerIdentitySha256: providerIdentitySha256.toLowerCase(),
    repository: args.githubRepo,
    hostname: args.githubHostname,
    branch: args.branch,
    path: args.headPath,
    proofInput: {
      path: args.proofInputFile,
      fileSha256: proofInputFileSha256,
      subjectSha256: currentHead,
    },
    compareAndSwap: {
      expectedSequence: args.expectedSequence,
      expectedHeadSha256: args.expectedHead.toLowerCase(),
      expectedHistorySha256: args.expectedHistorySha256.toLowerCase(),
    },
    appendOnlyHistory: {
      directory: githubHistoryDirectory(args.headPath),
      checkpointPath: githubCheckpointPath(args.headPath),
      nextRecordPath: githubHistoryRecordPath(args.headPath, next.sequence),
    },
    proposalFlow: commissionedHead.protectionPolicy.proposalFlow,
    receiptRootPolicy: commissionedHead.receiptRootPolicy,
    operationId,
    next,
  };
  if (args.dryRun)
    return console.log(
      JSON.stringify({ ok: true, dryRun: true, plan }, null, 2),
    );
  if (!args.receipt)
    throw new Error("--receipt is required outside dry-run mode");
  const receiptRoot = process.env.VALDRIS_HEAD_RECEIPT_ROOT;
  if (!receiptRoot) throw new Error("VALDRIS_HEAD_RECEIPT_ROOT is required");
  assertGithubReceiptRootSeparated(receiptRoot, repoRoot);
  const deadline = createGithubOperationDeadline(
    commissionedHead.protectionPolicy.proposalFlow.operationDeadlineMs,
    operationStartedMs,
  );
  const signer = preflightReceiptSigner(repoRoot);
  deadline.assert("signer preflight");
  const reservation = reserveGithubReceipt(
    receiptRoot,
    args.receipt,
    operationId,
    commissionedHead.receiptRootPolicy,
  );
  deadline.assert("receipt reservation");
  let proposal;
  try {
    proposal = executeGithubProtectedProposal({
      api: gh,
      hostname: args.githubHostname,
      repository: args.githubRepo,
      branch: args.branch,
      headPath: args.headPath,
      runId: args.runId,
      next,
      expectedSequence: args.expectedSequence,
      expectedHead: args.expectedHead,
      expectedHistorySha256: args.expectedHistorySha256,
      statusCheck: commissionedHead.protectionPolicy.appendOnlyStatusCheck,
      protectionPolicy: commissionedHead.protectionPolicy,
      proposalPolicy: commissionedHead.protectionPolicy.proposalFlow,
      deadline,
    });
  } catch (error) {
    abortGithubReceiptReservation(reservation);
    throw error;
  }
  const providerReceiptSha256 = sha256(
    canonicalJson({
      hostname: args.githubHostname,
      repository: args.githubRepo,
      branch: args.branch,
      baseCommitSha: proposal.baseCommitSha,
      commissionedCheck: proposal.commissionedCheck,
      contentSha: proposal.contentSha,
      historySha256: proposal.historySha256,
      mergeCommitSha: proposal.mergeCommitSha,
      path: proposal.recordPath,
      priorHistorySha256: proposal.priorHistorySha256,
      proposalBranch: proposal.proposalBranch,
      proposalCommitSha: proposal.proposalCommitSha,
      pullRequestNumber: proposal.pullRequestNumber,
      operationId,
      protectionObservations: proposal.protectionObservations,
      cleanup: proposal.cleanup,
      recordSha256: proposal.recordSha256,
      recordUpdatedAt: proposal.recordUpdatedAt,
    }),
  );
  const providerProof = {
    schema: "valdris.github-head-provider-proof.v1",
    hostname: args.githubHostname,
    repository: args.githubRepo,
    branch: args.branch,
    headPath: args.headPath,
    historyDirectory: proposal.historyDirectory,
    checkpointPath: githubCheckpointPath(args.headPath),
    recordPath: proposal.recordPath,
    priorHistorySha256: proposal.priorHistorySha256,
    historySha256: proposal.historySha256,
    baseCommitSha: proposal.baseCommitSha,
    proposalBranch: proposal.proposalBranch,
    proposalCommitSha: proposal.proposalCommitSha,
    pullRequestNumber: proposal.pullRequestNumber,
    commissionedCheck: proposal.commissionedCheck,
    contentSha: proposal.contentSha,
    mergeCommitSha: proposal.mergeCommitSha,
    commitSha: proposal.mergeCommitSha,
    operationId,
    recordSha256: proposal.recordSha256,
    recordUpdatedAt: proposal.recordUpdatedAt,
    resumed: proposal.resumed,
    cleanup: proposal.cleanup,
    protectionObservations: proposal.protectionObservations,
    receiptRootPathSha256: reservation.root.pathSha256,
    receiptRootIdentitySha256: reservation.root.identitySha256,
  };
  const issuedAt = new Date().toISOString();
  const receipt = signer.sign({
    schema: "valdris.bridge-head-receipt.v1",
    actor: {
      id: signer.actorId,
      type: "service",
    },
    eventId: `bridge-head-${operationId.slice(0, 32)}`,
    correlationSha256: sha256(
      canonicalJson({
        runId: args.runId,
        prior: args.expectedHead,
        current: currentHead,
      }),
    ),
    issuedAt,
    expiresAt: new Date(
      Date.parse(issuedAt) + 24 * 60 * 60 * 1000,
    ).toISOString(),
    runId: args.runId,
    sequence: next.sequence,
    priorHeadSha256: args.expectedHead.toLowerCase(),
    currentHeadSha256: currentHead,
    compareAndSwap: "applied",
    provider: "github",
    providerIdentitySha256: providerIdentitySha256.toLowerCase(),
    targetSha256: commissionedHead.targetSha256,
    protectionPolicySha256: commissionedHead.protectionPolicySha256,
    operationId,
    expectedHistorySha256: args.expectedHistorySha256.toLowerCase(),
    receiptRootPolicySha256: sha256(
      canonicalJson(commissionedHead.receiptRootPolicy),
    ),
    subjectPath: args.proofInputFile,
    subjectFileSha256: proofInputFileSha256,
    subjectSha256: currentHead,
    providerProof,
    providerProofSha256: sha256(canonicalJson(providerProof)),
    providerReceiptSha256,
  });
  deadline.assert("receipt signing");
  const receiptPath = commitGithubReceiptReservation(
    reservation,
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  deadline.assert("receipt commit");
  console.log(
    JSON.stringify(
      {
        ok: true,
        receipt: receiptPath,
        sequence: next.sequence,
        providerReceiptSha256,
      },
      null,
      2,
    ),
  );
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
