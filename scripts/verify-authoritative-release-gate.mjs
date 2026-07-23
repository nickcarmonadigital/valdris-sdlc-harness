#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateAuthoritativeRelease,
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

const stableVersionMismatch = run([
  "--tag",
  "v0.9.0",
  "--repository-root",
  ROOT,
]);
if (
  stableVersionMismatch.status === 0 ||
  !/does not match candidate package version/u.test(
    stableVersionMismatch.stdout + stableVersionMismatch.stderr,
  )
)
  throw new Error(
    "stable authoritative release accepted a tag that does not match the candidate package version",
  );

const stableCandidateRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-stable-release-candidate-"),
);
try {
  writeFileSync(
    path.join(stableCandidateRoot, "package.json"),
    `${JSON.stringify({ version: "0.9.0" })}\n`,
  );
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
        stableTagVersionSubstitutionRejected: true,
        missingOrMismatchedProviderBindingsRejected: true,
      },
    },
    null,
    2,
  ),
);
