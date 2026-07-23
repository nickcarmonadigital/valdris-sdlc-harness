#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./control-gate-lib.mjs";
import {
  canonicalJson,
  resolveArtifactPath,
  safeIdentifier,
  sha256,
} from "./proof-runner.mjs";
import {
  V09_CANONICAL_ARTIFACTS,
  validExecutorAuthoritySeparationBinding,
  validRuntimeExecutionIsolationBinding,
  validateAuthoritativeClosureDocument,
} from "./v09-assurance-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[a-f0-9]{64}$/iu;
const GIT_COMMIT = /^[a-f0-9]{40,64}$/u;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function digest(value) {
  return typeof value === "string" && SHA256.test(value);
}

export function validateStableHeadProviderReceipt(head) {
  const problems = [];
  if (
    head?.provider !== "github" ||
    head?.providerProof?.schema !== "valdris.github-head-provider-proof.v1" ||
    !safeIdentifier(head?.provider) ||
    !digest(head?.providerIdentitySha256) ||
    !object(head?.providerProof) ||
    Object.keys(head.providerProof).length === 0 ||
    !digest(head?.providerProofSha256) ||
    head.providerProofSha256 !== sha256(canonicalJson(head.providerProof)) ||
    !digest(head?.providerReceiptSha256) ||
    !digest(head?.targetSha256) ||
    !digest(head?.protectionPolicySha256)
  )
    problems.push(
      "stable release requires the commissioned GitHub rollback-resistant head adapter until another provider has an executable authoritative validator",
    );
  return { valid: problems.length === 0, problems };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") args.tag = argv[++index];
    else if (arg === "--run-root") args.runRoot = argv[++index];
    else if (arg === "--repository-root") args.repositoryRoot = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function stableRelease(tag) {
  return /^\d+\.\d+\.\d+$/u.test(String(tag).replace(/^v/u, ""));
}

function gitEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
  return {
    ...environment,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function runReleaseGit(repositoryRoot, args, label) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    env: gitEnvironment(),
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${label} failed: ${String(
        result.error?.message ||
          result.stderr ||
          result.stdout ||
          "unknown error",
      ).trim()}`,
    );
  return result.stdout.trim();
}

export function canonicalCandidateRootKey(candidateRoot) {
  if (process.platform !== "win32") return candidateRoot;
  return candidateRoot.replace(
    /^([A-Za-z]):(?=[\\/])/u,
    (_, drive) => `${drive.toUpperCase()}:`,
  );
}

export function sameCandidateRootIdentity(leftRoot, rightRoot) {
  if (
    canonicalCandidateRootKey(leftRoot) === canonicalCandidateRootKey(rightRoot)
  )
    return true;
  if (process.platform !== "win32") return false;
  const leftStats = lstatSync(leftRoot, { bigint: true });
  const rightStats = lstatSync(rightRoot, { bigint: true });
  return (
    leftStats.ino !== 0n &&
    leftStats.dev === rightStats.dev &&
    leftStats.ino === rightStats.ino
  );
}

export function resolveCandidateGitHeadIdentity(repositoryRoot) {
  const requestedRoot = path.resolve(repositoryRoot);
  const stats = lstatSync(requestedRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("candidate repository root must be a real directory");
  const canonicalRoot = realpathSync(requestedRoot);
  const reportedRoot = realpathSync(
    runReleaseGit(
      canonicalRoot,
      ["rev-parse", "--show-toplevel"],
      "candidate root lookup",
    ),
  );
  if (!sameCandidateRootIdentity(reportedRoot, canonicalRoot))
    throw new Error(
      `candidate repository root must be the exact Git worktree root: ${JSON.stringify({ canonicalRoot, reportedRoot })}`,
    );
  const headCommit = runReleaseGit(
    canonicalRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "candidate HEAD lookup",
  ).toLowerCase();
  if (!GIT_COMMIT.test(headCommit))
    throw new Error("candidate HEAD did not resolve to a Git commit");
  return { repositoryRoot: canonicalRoot, headCommit };
}

export function resolveCandidateGitIdentity({ repositoryRoot, tag }) {
  const headIdentity = resolveCandidateGitHeadIdentity(repositoryRoot);
  const tagCommit = runReleaseGit(
    headIdentity.repositoryRoot,
    ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`],
    "candidate stable-tag lookup",
  ).toLowerCase();
  if (!GIT_COMMIT.test(tagCommit))
    throw new Error("candidate stable tag did not resolve to a Git commit");
  return { ...headIdentity, tagCommit };
}

export function readCandidatePackageAtCommit(candidateIdentity) {
  const packageBytes = runReleaseGit(
    candidateIdentity.repositoryRoot,
    ["show", `${candidateIdentity.headCommit}:package.json`],
    "candidate committed package lookup",
  );
  const packageDocument = JSON.parse(packageBytes);
  if (
    !object(packageDocument) ||
    typeof packageDocument.version !== "string" ||
    packageDocument.version.length === 0
  )
    throw new Error("candidate committed package version is invalid");
  return packageDocument;
}

export function validateCandidateSourceBinding({
  candidateHead,
  tagCommit,
  executorSourceCommit,
  closureCommit,
  promotionCommit,
  bridgeRunId,
  closureRunId,
}) {
  const problems = [];
  for (const [label, value] of [
    ["candidate HEAD", candidateHead],
    ["stable tag target", tagCommit],
    ["executor sourceCommit", executorSourceCommit],
    ["authoritative closure commit", closureCommit],
  ])
    if (!GIT_COMMIT.test(value || ""))
      problems.push(`${label} is not a canonical Git commit`);
  if (candidateHead !== tagCommit)
    problems.push("stable tag target does not match candidate Git HEAD");
  if (candidateHead !== executorSourceCommit)
    problems.push("executor sourceCommit does not match candidate Git HEAD");
  if (candidateHead !== closureCommit)
    problems.push(
      "authoritative closure commit does not match candidate Git HEAD",
    );
  if (promotionCommit && promotionCommit !== candidateHead)
    problems.push("promotion receipt commit does not match candidate Git HEAD");
  if (bridgeRunId !== closureRunId)
    problems.push(
      "bridge-head receipt runId does not match authoritative closure runId",
    );
  return { valid: problems.length === 0, problems };
}

export function evaluateAuthoritativeRelease({
  tag,
  runRoot,
  repositoryRoot,
  validationOptions = {},
}) {
  const candidateRoot = repositoryRoot ? path.resolve(repositoryRoot) : ROOT;
  let requestedTag = tag;
  let candidateIdentity;
  let committedPackageDocument;
  let committedPackageHeadCommit;
  if (!requestedTag && repositoryRoot)
    try {
      const headIdentity = resolveCandidateGitHeadIdentity(candidateRoot);
      committedPackageDocument = readCandidatePackageAtCommit(headIdentity);
      committedPackageHeadCommit = headIdentity.headCommit;
      requestedTag = `v${committedPackageDocument.version}`;
    } catch (error) {
      return {
        ok: false,
        tag: requestedTag,
        releaseClass: "stable",
        authoritativeEligible: false,
        problems: [
          `stable release candidate source identity is invalid: ${error.message}`,
        ],
      };
    }
  if (!requestedTag) {
    const packageDocument = JSON.parse(
      readFileSync(path.join(candidateRoot, "package.json"), "utf8"),
    );
    requestedTag = `v${packageDocument.version}`;
  }
  if (!stableRelease(requestedTag))
    return {
      ok: true,
      tag: requestedTag,
      releaseClass: "prerelease",
      authoritativeEligible: false,
      reason:
        "prerelease development is allowed without claiming authoritative release eligibility",
    };
  if (!repositoryRoot)
    return {
      ok: false,
      tag: requestedTag,
      releaseClass: "stable",
      authoritativeEligible: false,
      problems: [
        "a stable release requires repositoryRoot for the exact verified candidate checkout",
      ],
    };
  try {
    candidateIdentity = resolveCandidateGitIdentity({
      repositoryRoot: candidateRoot,
      tag: requestedTag,
    });
    if (
      committedPackageHeadCommit &&
      committedPackageHeadCommit !== candidateIdentity.headCommit
    )
      throw new Error(
        "candidate Git HEAD changed while resolving committed package metadata",
      );
    committedPackageDocument ||=
      readCandidatePackageAtCommit(candidateIdentity);
  } catch (error) {
    return {
      ok: false,
      tag: requestedTag,
      releaseClass: "stable",
      authoritativeEligible: false,
      problems: [
        `stable release candidate source identity is invalid: ${error.message}`,
      ],
    };
  }
  if (requestedTag !== `v${committedPackageDocument.version}`)
    return {
      ok: false,
      tag: requestedTag,
      releaseClass: "stable",
      authoritativeEligible: false,
      problems: [
        `stable release tag ${requestedTag} does not match candidate package version v${committedPackageDocument.version} from committed HEAD`,
      ],
    };
  if (!runRoot)
    return {
      ok: false,
      tag: requestedTag,
      releaseClass: "stable",
      authoritativeEligible: false,
      problems: [
        "a stable release tag requires --run-root for a real commissioned authoritative run",
      ],
    };
  const canonicalRunRoot = path.resolve(runRoot);
  let closure;
  let validation;
  let runtime;
  let semantic;
  let promotion;
  try {
    closure = readJson(
      resolveArtifactPath(
        canonicalRunRoot,
        V09_CANONICAL_ARTIFACTS.authoritative,
        { mustExist: true },
      ),
    );
    validation = validateAuthoritativeClosureDocument(
      closure,
      canonicalRunRoot,
      validationOptions,
    );
    runtime = readJson(
      resolveArtifactPath(canonicalRunRoot, V09_CANONICAL_ARTIFACTS.runtime, {
        mustExist: true,
      }),
    );
    semantic = readJson(
      resolveArtifactPath(canonicalRunRoot, V09_CANONICAL_ARTIFACTS.semantic, {
        mustExist: true,
      }),
    );
    if (closure.artifacts?.promotion)
      promotion = readJson(
        resolveArtifactPath(
          canonicalRunRoot,
          V09_CANONICAL_ARTIFACTS.promotion,
          { mustExist: true },
        ),
      );
  } catch (error) {
    return {
      ok: false,
      tag: requestedTag,
      releaseClass: "stable",
      authoritativeEligible: false,
      problems: [
        `authoritative release packet is unavailable: ${error.message}`,
      ],
    };
  }
  const executor = runtime.executorReceipt;
  const head = runtime.bridgeHeadReceipt;
  const problems = [...validation.problems];
  problems.push(
    ...validateCandidateSourceBinding({
      candidateHead: candidateIdentity.headCommit,
      tagCommit: candidateIdentity.tagCommit,
      executorSourceCommit: executor?.sourceCommit,
      closureCommit: closure?.commit,
      promotionCommit: promotion?.commit,
      bridgeRunId: head?.runId,
      closureRunId: closure?.runId,
    }).problems,
  );
  if (validation.level !== "authoritative")
    problems.push("release packet does not claim authoritative assurance");
  if (
    executor?.sourceSnapshotMode !==
      "git-raw-object-tree-content-addressed-oci-layer" ||
    executor?.runtimeEndpoint !== "local-default" ||
    executor?.runtimeExecutionMode !== "hardened-private-capsule" ||
    !validRuntimeExecutionIsolationBinding(executor) ||
    !validExecutorAuthoritySeparationBinding(
      runtime,
      semantic?.acceptancePolicy?.proofExecutor,
    ) ||
    !executor?.sourceSnapshotManifestSha256 ||
    !executor?.daemonIdentitySha256 ||
    !executor?.runtimeCliSha256 ||
    !executor?.runtimeExecutionPathSha256 ||
    executor?.runtimeExecutionSha256 !== executor?.runtimeCliSha256 ||
    !executor?.runtimeExecutionRootPathSha256 ||
    !executor?.runtimeExecutionRootIdentitySha256 ||
    !executor?.gitCliSha256 ||
    !executor?.outputRootIdentitySha256
  )
    problems.push(
      "stable release requires a real commissioned OCI executor plus an independently signed external-principal authority-separation receipt with raw-tree, binary, daemon, output-root, and trusted-host versus isolated-workload identities",
    );
  problems.push(...validateStableHeadProviderReceipt(head).problems);
  return {
    ok: problems.length === 0,
    tag: requestedTag,
    releaseClass: "stable",
    authoritativeEligible: problems.length === 0,
    sourceCommit: candidateIdentity?.headCommit,
    problems,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/authoritative-release-gate.mjs [--tag v0.9.0] [--run-root ABSOLUTE_PATH] [--repository-root VERIFIED_CANDIDATE_PATH]",
    );
    return;
  }
  const result = evaluateAuthoritativeRelease({
    tag: args.tag,
    runRoot: args.runRoot,
    repositoryRoot: args.repositoryRoot,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify({ ok: false, problems: [error.message] }, null, 2),
    );
    process.exit(1);
  }
