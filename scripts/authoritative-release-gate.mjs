#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
  validateAuthoritativeClosureDocument,
} from "./v09-assurance-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[a-f0-9]{64}$/iu;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function digest(value) {
  return typeof value === "string" && SHA256.test(value);
}

export function validateStableHeadProviderReceipt(head) {
  const problems = [];
  if (
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
      "stable release requires a commissioned provider-backed rollback-resistant head receipt with exact provider, proof, receipt, target, and protection identities",
    );
  return { valid: problems.length === 0, problems };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") args.tag = argv[++index];
    else if (arg === "--run-root") args.runRoot = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function stableRelease(tag) {
  return /^\d+\.\d+\.\d+$/u.test(String(tag).replace(/^v/u, ""));
}

export function evaluateAuthoritativeRelease({
  tag,
  runRoot,
  repositoryRoot = ROOT,
  validationOptions = {},
}) {
  const packageDocument = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const requestedTag = tag || `v${packageDocument.version}`;
  if (!stableRelease(requestedTag))
    return {
      ok: true,
      tag: requestedTag,
      releaseClass: "prerelease",
      authoritativeEligible: false,
      reason:
        "prerelease development is allowed without claiming authoritative release eligibility",
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
  if (validation.level !== "authoritative")
    problems.push("release packet does not claim authoritative assurance");
  if (
    executor?.sourceSnapshotMode !==
      "git-raw-object-tree-content-addressed-oci-layer" ||
    executor?.runtimeEndpoint !== "local-default" ||
    executor?.runtimeExecutionMode !== "hardened-private-capsule" ||
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
      "stable release requires a real commissioned OCI executor receipt with raw-tree, binary, daemon, and output-root identities",
    );
  problems.push(...validateStableHeadProviderReceipt(head).problems);
  return {
    ok: problems.length === 0,
    tag: requestedTag,
    releaseClass: "stable",
    authoritativeEligible: problems.length === 0,
    problems,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/authoritative-release-gate.mjs [--tag v0.9.0] [--run-root ABSOLUTE_PATH]",
    );
    return;
  }
  const result = evaluateAuthoritativeRelease({
    tag: args.tag,
    runRoot: args.runRoot,
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
