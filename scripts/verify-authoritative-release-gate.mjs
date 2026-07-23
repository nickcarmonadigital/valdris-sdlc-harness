#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateAuthoritativeRelease,
  readCandidatePackageAtCommit,
  resolveCandidateGitIdentity,
  runReleaseGit,
  validateCandidateSourceBinding,
  validateStableHeadProviderReceipt,
} from "./authoritative-release-gate.mjs";
import { canonicalJson, sha256 } from "./proof-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = path.join(ROOT, "scripts", "authoritative-release-gate.mjs");

function run(args) {
  return spawnSync(process.execPath, [gate, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    shell: false,
    windowsHide: true,
  });
}

function git(repositoryRoot, args) {
  return runReleaseGit(repositoryRoot, args, "release verifier Git command");
}

function createCandidateRepository(repositoryRoot, version, label) {
  writeFileSync(
    path.join(repositoryRoot, "package.json"),
    `${JSON.stringify({ version })}\n`,
  );
  writeFileSync(path.join(repositoryRoot, "candidate.txt"), `${label}-one\n`);
  git(repositoryRoot, ["init", "-q"]);
  git(repositoryRoot, ["config", "user.name", "Valdris Release Verifier"]);
  git(repositoryRoot, ["config", "user.email", "release@example.invalid"]);
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["commit", "-qm", `${label} one`]);
  const firstCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  git(repositoryRoot, ["tag", "v0.9.0", firstCommit]);
  writeFileSync(path.join(repositoryRoot, "candidate.txt"), `${label}-two\n`);
  git(repositoryRoot, ["add", "candidate.txt"]);
  git(repositoryRoot, ["commit", "-qm", `${label} two`]);
  const secondCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  return { firstCommit, secondCommit };
}

const prerelease = run([]);
if (prerelease.error || prerelease.status !== 0)
  throw new Error(
    `local prerelease gate must remain available: ${
      prerelease.error?.message || prerelease.stderr || prerelease.stdout
    }`,
  );
const prereleaseResult = JSON.parse(prerelease.stdout);
if (
  prereleaseResult.releaseClass !== "prerelease" ||
  prereleaseResult.authoritativeEligible !== false
)
  throw new Error(
    "local release gate must distinguish prerelease operation from authoritative eligibility",
  );

const stableWithoutProviderProof = run(["--tag", "v0.9.0"]);
if (
  stableWithoutProviderProof.status === 0 ||
  !/requires repositoryRoot/u.test(
    stableWithoutProviderProof.stdout + stableWithoutProviderProof.stderr,
  )
)
  throw new Error(
    "stable authoritative release accepted a CLI request without an explicit candidate checkout",
  );

const directStableWithoutCandidateRoot = evaluateAuthoritativeRelease({
  tag: "v0.9.0",
});
if (
  directStableWithoutCandidateRoot.ok ||
  !directStableWithoutCandidateRoot.problems?.some((problem) =>
    problem.includes("requires repositoryRoot"),
  )
)
  throw new Error(
    "programmatic stable authoritative release accepted no candidate checkout",
  );

const stableVersionMismatchRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-stable-release-version-mismatch-"),
);
try {
  const mismatch = createCandidateRepository(
    stableVersionMismatchRoot,
    "0.9.1",
    "version-mismatch",
  );
  git(stableVersionMismatchRoot, [
    "tag",
    "-f",
    "v0.9.0",
    mismatch.secondCommit,
  ]);
  const stableVersionMismatch = evaluateAuthoritativeRelease({
    tag: "v0.9.0",
    repositoryRoot: stableVersionMismatchRoot,
  });
  if (
    stableVersionMismatch.ok ||
    !stableVersionMismatch.problems?.some((problem) =>
      problem.includes("does not match candidate package version"),
    )
  )
    throw new Error(
      "stable authoritative release accepted a tag that does not match the candidate package version",
    );

  const missingCandidateRoot = path.join(
    stableVersionMismatchRoot,
    "missing-candidate",
  );
  const repositoryRootCli = run([
    "--tag",
    "v0.9.0",
    "--repository-root",
    missingCandidateRoot,
  ]);
  let repositoryRootCliResult;
  try {
    repositoryRootCliResult = JSON.parse(repositoryRootCli.stdout);
  } catch {
    repositoryRootCliResult = undefined;
  }
  if (
    repositoryRootCli.error ||
    repositoryRootCli.status === 0 ||
    repositoryRootCliResult?.ok !== false ||
    !repositoryRootCliResult?.problems?.some((problem) =>
      problem.includes("candidate source identity is invalid"),
    )
  )
    throw new Error(
      `stable authoritative release CLI did not fail closed for an invalid --repository-root: status=${repositoryRootCli.status}; stdout=${repositoryRootCli.stdout.trim()}; stderr=${repositoryRootCli.stderr.trim()}`,
    );
} finally {
  rmSync(stableVersionMismatchRoot, { recursive: true, force: true });
}

const stableCandidateRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-stable-release-candidate-"),
);
try {
  const candidate = createCandidateRepository(
    stableCandidateRoot,
    "0.9.0",
    "missing-packet",
  );
  git(stableCandidateRoot, ["tag", "-f", "v0.9.0", candidate.secondCommit]);
  const missingRunRoot = path.join(stableCandidateRoot, "missing-run");
  const completeCli = run([
    "--tag",
    "v0.9.0",
    "--repository-root",
    stableCandidateRoot,
    "--run-root",
    missingRunRoot,
  ]);
  let completeCliResult;
  try {
    completeCliResult = JSON.parse(completeCli.stdout);
  } catch {
    completeCliResult = undefined;
  }
  if (
    completeCli.error ||
    completeCli.status === 0 ||
    completeCliResult?.ok !== false ||
    !completeCliResult?.problems?.some((problem) =>
      problem.includes("authoritative release packet is unavailable"),
    )
  )
    throw new Error(
      `stable authoritative release CLI did not forward the complete production argument set: status=${completeCli.status}; stdout=${completeCli.stdout.trim()}; stderr=${completeCli.stderr.trim()}`,
    );
  writeFileSync(path.join(stableCandidateRoot, "package.json"), "{malformed\n");
  const missingPacket = evaluateAuthoritativeRelease({
    tag: "v0.9.0",
    repositoryRoot: stableCandidateRoot,
  });
  if (
    missingPacket.ok ||
    !missingPacket.problems.some((problem) =>
      problem.includes("real commissioned authoritative run"),
    )
  )
    throw new Error(
      "matching stable tag unexpectedly passed without a real provider-backed packet",
    );
} finally {
  rmSync(stableCandidateRoot, { recursive: true, force: true });
}

const sourceBindingRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-stable-release-source-binding-"),
);
try {
  const firstRepository = path.join(sourceBindingRoot, "first");
  const secondRepository = path.join(sourceBindingRoot, "second");
  mkdirSync(firstRepository);
  mkdirSync(secondRepository);
  const priorGitConfigCount = process.env.GIT_CONFIG_COUNT;
  const priorGitConfigKey = process.env.GIT_CONFIG_KEY_0;
  const priorGitConfigValue = process.env.GIT_CONFIG_VALUE_0;
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "commit.gpgSign";
  process.env.GIT_CONFIG_VALUE_0 = "true";
  let first;
  let second;
  try {
    first = createCandidateRepository(firstRepository, "0.9.0", "first");
    second = createCandidateRepository(secondRepository, "0.9.0", "second");
  } finally {
    for (const [key, value] of [
      ["GIT_CONFIG_COUNT", priorGitConfigCount],
      ["GIT_CONFIG_KEY_0", priorGitConfigKey],
      ["GIT_CONFIG_VALUE_0", priorGitConfigValue],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }

  const tagMismatchIdentity = resolveCandidateGitIdentity({
    repositoryRoot: firstRepository,
    tag: "v0.9.0",
  });
  const tagMismatch = validateCandidateSourceBinding({
    candidateHead: tagMismatchIdentity.headCommit,
    tagCommit: tagMismatchIdentity.tagCommit,
    executorSourceCommit: tagMismatchIdentity.headCommit,
    closureCommit: tagMismatchIdentity.headCommit,
    bridgeRunId: "run-one",
    closureRunId: "run-one",
  });
  if (
    tagMismatch.valid ||
    !tagMismatch.problems.some((problem) =>
      problem.includes("stable tag target does not match candidate Git HEAD"),
    )
  )
    throw new Error(
      "stable tag resolving to a different candidate commit was accepted",
    );

  git(firstRepository, ["tag", "-f", "v0.9.0", first.secondCommit]);
  const alignedIdentity = resolveCandidateGitIdentity({
    repositoryRoot: firstRepository,
    tag: "v0.9.0",
  });
  writeFileSync(
    path.join(firstRepository, "package.json"),
    `${JSON.stringify({ version: "9.9.9" })}\n`,
  );
  if (readCandidatePackageAtCommit(alignedIdentity).version !== "0.9.0")
    throw new Error(
      "candidate version proof read mutable worktree package metadata",
    );
  git(secondRepository, ["tag", "-f", "v0.9.0", second.secondCommit]);
  const substitutedIdentity = resolveCandidateGitIdentity({
    repositoryRoot: secondRepository,
    tag: "v0.9.0",
  });
  const substitutedCandidate = validateCandidateSourceBinding({
    candidateHead: substitutedIdentity.headCommit,
    tagCommit: substitutedIdentity.tagCommit,
    executorSourceCommit: alignedIdentity.headCommit,
    closureCommit: alignedIdentity.headCommit,
    bridgeRunId: "run-one",
    closureRunId: "run-one",
  });
  if (
    substitutedCandidate.valid ||
    !substitutedCandidate.problems.some((problem) =>
      problem.includes(
        "executor sourceCommit does not match candidate Git HEAD",
      ),
    )
  )
    throw new Error(
      "same-version candidate checkout with a different Git HEAD was accepted",
    );

  const substitutedExecutor = validateCandidateSourceBinding({
    candidateHead: alignedIdentity.headCommit,
    tagCommit: alignedIdentity.tagCommit,
    executorSourceCommit: first.firstCommit,
    closureCommit: first.firstCommit,
    promotionCommit: first.firstCommit,
    bridgeRunId: "run-one",
    closureRunId: "run-one",
  });
  if (
    substitutedExecutor.valid ||
    !substitutedExecutor.problems.some((problem) =>
      problem.includes(
        "executor sourceCommit does not match candidate Git HEAD",
      ),
    )
  )
    throw new Error(
      "authoritative run from a different source commit was accepted for the candidate",
    );

  const alignedSource = validateCandidateSourceBinding({
    candidateHead: alignedIdentity.headCommit,
    tagCommit: alignedIdentity.tagCommit,
    executorSourceCommit: alignedIdentity.headCommit,
    closureCommit: alignedIdentity.headCommit,
    promotionCommit: alignedIdentity.headCommit,
    bridgeRunId: "run-one",
    closureRunId: "run-one",
  });
  if (!alignedSource.valid)
    throw new Error(
      `aligned candidate source binding was rejected: ${alignedSource.problems.join(
        "; ",
      )}`,
    );
  const substitutedPromotion = validateCandidateSourceBinding({
    candidateHead: alignedIdentity.headCommit,
    tagCommit: alignedIdentity.tagCommit,
    executorSourceCommit: alignedIdentity.headCommit,
    closureCommit: alignedIdentity.headCommit,
    promotionCommit: first.firstCommit,
    bridgeRunId: "run-one",
    closureRunId: "run-one",
  });
  if (
    substitutedPromotion.valid ||
    !substitutedPromotion.problems.some((problem) =>
      problem.includes("promotion receipt commit"),
    )
  )
    throw new Error(
      "promotion receipt from another source commit was accepted",
    );
  const substitutedBridgeRun = validateCandidateSourceBinding({
    candidateHead: alignedIdentity.headCommit,
    tagCommit: alignedIdentity.tagCommit,
    executorSourceCommit: alignedIdentity.headCommit,
    closureCommit: alignedIdentity.headCommit,
    promotionCommit: alignedIdentity.headCommit,
    bridgeRunId: "run-two",
    closureRunId: "run-one",
  });
  if (
    substitutedBridgeRun.valid ||
    !substitutedBridgeRun.problems.some((problem) =>
      problem.includes("bridge-head receipt runId"),
    )
  )
    throw new Error("bridge-head receipt from another run was accepted");
} finally {
  rmSync(sourceBindingRoot, { recursive: true, force: true });
}

const neutralProviderProof = {
  schema: "example.neutral-head-provider-proof.v1",
  targetSha256: sha256("neutral-target"),
  appendReceiptSha256: sha256("neutral-append-receipt"),
};
const neutralHead = {
  provider: "neutral-ledger",
  providerIdentitySha256: sha256("neutral-provider"),
  providerProof: neutralProviderProof,
  providerProofSha256: sha256(canonicalJson(neutralProviderProof)),
  providerReceiptSha256: sha256("neutral-provider-receipt"),
  targetSha256: sha256("neutral-target"),
  protectionPolicySha256: sha256("neutral-protection"),
};
const neutralValidation = validateStableHeadProviderReceipt(neutralHead);
if (
  neutralValidation.valid ||
  !neutralValidation.problems.some((problem) =>
    problem.includes("GitHub rollback-resistant head adapter"),
  )
)
  throw new Error("unvalidated provider-neutral stable head was accepted");
const missingNeutralBindings = structuredClone(neutralHead);
delete missingNeutralBindings.providerProof;
delete missingNeutralBindings.providerReceiptSha256;
delete missingNeutralBindings.targetSha256;
if (validateStableHeadProviderReceipt(missingNeutralBindings).valid)
  throw new Error("stable head accepted missing neutral provider bindings");
const mismatchedNeutralProof = structuredClone(neutralHead);
mismatchedNeutralProof.providerProofSha256 = sha256(
  "mismatched-neutral-provider-proof",
);
if (validateStableHeadProviderReceipt(mismatchedNeutralProof).valid)
  throw new Error("stable head accepted a mismatched neutral provider proof");

console.log(
  JSON.stringify(
    {
      ok: true,
      tests: {
        localPrereleaseAllowed: true,
        stableTagRequiresRealOciAndProviderProof: true,
        unvalidatedProviderNeutralHeadRejected: true,
        explicitCandidateCheckoutRequired: true,
        candidateHeadTagAndExecutedSourceMustMatch: true,
        committedPackageVersionBoundToCandidateHead: true,
        ambientGitSigningConfigurationIgnored: true,
        promotionAndBridgeBindingsMustMatch: true,
        sameVersionDifferentCandidateHeadRejected: true,
        stableTagVersionSubstitutionRejected: true,
        repositoryRootCliFailsClosed: true,
        completeProductionCliArgumentsForwarded: true,
        missingOrMismatchedProviderBindingsRejected: true,
      },
    },
    null,
    2,
  ),
);
