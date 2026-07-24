#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const SAFE_REPOSITORY =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u;
const SAFE_WORKFLOW_PATH =
  /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.ya?ml$/u;
const SOURCE_SCHEMA = "valdris.authoritative-release-source.v1";

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(document, keys) {
  return (
    object(document) &&
    JSON.stringify(Object.keys(document).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateTrustedReleaseMetadata({
  run,
  artifactListing,
  expected,
  authorityTrustSha256,
}) {
  const problems = [];
  if (!SAFE_REPOSITORY.test(expected?.repository || ""))
    problems.push("expected repository must be OWNER/REPO");
  if (!positiveInteger(expected?.workflowId))
    problems.push("trusted workflow ID must be a positive integer");
  if (!SAFE_WORKFLOW_PATH.test(expected?.workflowPath || ""))
    problems.push("trusted workflow path is invalid");
  if (!positiveInteger(expected?.runId))
    problems.push("trusted workflow run ID must be a positive integer");
  if (!GIT_SHA.test(expected?.sourceCommit || ""))
    problems.push("intended release commit must be a lowercase Git SHA");
  if (!SAFE_ARTIFACT.test(expected?.artifactName || ""))
    problems.push("commissioned authoritative artifact name is invalid");
  if (
    typeof expected?.defaultBranch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,126}$/u.test(expected.defaultBranch) ||
    expected.defaultBranch.includes("..") ||
    expected.defaultBranch.endsWith("/")
  )
    problems.push("default release branch is invalid");
  if (!SHA256.test(authorityTrustSha256 || ""))
    problems.push(
      "VALDRIS_AUTHORITY_TRUST_SHA256 is required from the protected release environment",
    );
  if (
    !object(run) ||
    run.id !== expected.runId ||
    run.workflow_id !== expected.workflowId ||
    run.path !== expected.workflowPath ||
    run.event !== "workflow_dispatch" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !positiveInteger(run.run_attempt) ||
    run.repository?.full_name !== expected.repository ||
    run.head_repository?.full_name !== expected.repository ||
    run.head_branch !== expected.defaultBranch ||
    run.head_sha !== expected.sourceCommit
  )
    problems.push(
      "trusted workflow run is missing, unsuccessful, cross-repository, from the wrong workflow/branch, or bound to a different commit",
    );
  const artifactPages = Array.isArray(artifactListing)
    ? artifactListing
    : [artifactListing];
  const artifacts = artifactPages
    .flatMap((page) => (Array.isArray(page?.artifacts) ? page.artifacts : []))
    .filter((artifact) => artifact?.name === expected.artifactName);
  if (artifacts.length !== 1)
    problems.push(
      "trusted workflow run must expose exactly one commissioned authoritative artifact",
    );
  const artifact = artifacts[0];
  if (
    artifact &&
    (!positiveInteger(artifact.id) ||
      artifact.expired !== false ||
      !positiveInteger(artifact.size_in_bytes) ||
      artifact.workflow_run?.id !== expected.runId ||
      artifact.workflow_run?.head_branch !== expected.defaultBranch ||
      artifact.workflow_run?.head_sha !== expected.sourceCommit ||
      artifact.workflow_run?.repository_id !== run?.repository?.id ||
      artifact.workflow_run?.head_repository_id !== run?.head_repository?.id)
  )
    problems.push(
      "authoritative artifact provenance does not match the trusted completed workflow run",
    );
  return {
    valid: problems.length === 0,
    problems,
    runAttempt: run?.run_attempt,
    artifactId: artifact?.id,
  };
}

export function validateTrustedReleaseSource({
  run,
  artifactListing,
  provenance,
  artifactRoot,
  expected,
  authorityTrustSha256,
}) {
  const metadata = validateTrustedReleaseMetadata({
    run,
    artifactListing,
    expected,
    authorityTrustSha256,
  });
  const problems = [...metadata.problems];
  const expectedProvenanceKeys = [
    "artifactName",
    "repository",
    "runRoot",
    "schema",
    "sourceCommit",
    "workflowId",
    "workflowPath",
    "workflowRunAttempt",
    "workflowRunId",
  ];
  if (
    !exactKeys(provenance, expectedProvenanceKeys) ||
    provenance?.schema !== SOURCE_SCHEMA ||
    provenance.repository !== expected.repository ||
    provenance.workflowRunId !== expected.runId ||
    provenance.workflowRunAttempt !== run?.run_attempt ||
    provenance.workflowId !== expected.workflowId ||
    provenance.workflowPath !== expected.workflowPath ||
    provenance.sourceCommit !== expected.sourceCommit ||
    provenance.artifactName !== expected.artifactName ||
    provenance.runRoot !== "run-root"
  )
    problems.push(
      "downloaded authoritative artifact omitted or substituted its trusted release-source provenance",
    );
  let canonicalArtifactRoot;
  let canonicalRunRoot;
  try {
    const artifactStats = lstatSync(artifactRoot);
    const runRoot = path.join(artifactRoot, "run-root");
    const runStats = lstatSync(runRoot);
    if (
      !artifactStats.isDirectory() ||
      artifactStats.isSymbolicLink() ||
      !runStats.isDirectory() ||
      runStats.isSymbolicLink()
    )
      throw new Error("artifact and run roots must be real directories");
    canonicalArtifactRoot = realpathSync(artifactRoot);
    canonicalRunRoot = realpathSync(runRoot);
    if (
      path.dirname(canonicalRunRoot) !== canonicalArtifactRoot ||
      path.basename(canonicalRunRoot) !== "run-root"
    )
      throw new Error("run root escaped the downloaded artifact");
    const requiredFiles = [
      path.join(canonicalArtifactRoot, "release-source.json"),
      ...["assurance/authoritative.json", "runtime/session.json"].map(
        (relativePath) => path.join(canonicalRunRoot, relativePath),
      ),
    ];
    for (const requiredFile of requiredFiles) {
      if (!existsSync(requiredFile))
        throw new Error(
          `missing ${path.relative(canonicalArtifactRoot, requiredFile)}`,
        );
      const stats = lstatSync(requiredFile);
      const canonicalRequiredFile = realpathSync(requiredFile);
      if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        (canonicalRequiredFile !==
          path.join(canonicalArtifactRoot, "release-source.json") &&
          !canonicalRequiredFile.startsWith(`${canonicalRunRoot}${path.sep}`))
      )
        throw new Error(
          `required release evidence escaped its artifact boundary: ${path.relative(canonicalArtifactRoot, requiredFile)}`,
        );
    }
    const closure = JSON.parse(
      readFileSync(
        path.join(canonicalRunRoot, "assurance", "authoritative.json"),
        "utf8",
      ),
    );
    if (closure?.commit !== expected.sourceCommit)
      throw new Error(
        "authoritative closure subject commit does not match the intended release commit",
      );
  } catch (error) {
    problems.push(
      `authoritative artifact run root is invalid: ${error.message}`,
    );
  }
  return {
    valid: problems.length === 0,
    problems,
    runAttempt: metadata.runAttempt,
    artifactId: metadata.artifactId,
    runRoot: canonicalRunRoot,
  };
}

function parseArgs(argv) {
  const args = { metadataOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--metadata-only") args.metadataOnly = true;
    else if (arg === "--run-metadata") args.runMetadata = argv[++index];
    else if (arg === "--artifact-metadata")
      args.artifactMetadata = argv[++index];
    else if (arg === "--artifact-root") args.artifactRoot = argv[++index];
    else if (arg === "--repository") args.repository = argv[++index];
    else if (arg === "--workflow-id") args.workflowId = Number(argv[++index]);
    else if (arg === "--workflow-path") args.workflowPath = argv[++index];
    else if (arg === "--run-id") args.runId = Number(argv[++index]);
    else if (arg === "--source-commit") args.sourceCommit = argv[++index];
    else if (arg === "--artifact-name") args.artifactName = argv[++index];
    else if (arg === "--default-branch") args.defaultBranch = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/authoritative-release-source-gate.mjs --run-metadata FILE --artifact-metadata FILE --repository OWNER/REPO --workflow-id ID --workflow-path .github/workflows/FILE.yml --run-id ID --source-commit SHA --artifact-name NAME --default-branch BRANCH [--metadata-only | --artifact-root DIR]",
    );
    return;
  }
  if (!args.runMetadata || !args.artifactMetadata)
    throw new Error("--run-metadata and --artifact-metadata are required");
  const run = readJson(args.runMetadata);
  const artifactListing = readJson(args.artifactMetadata);
  const expected = {
    repository: args.repository,
    workflowId: args.workflowId,
    workflowPath: args.workflowPath,
    runId: args.runId,
    sourceCommit: args.sourceCommit,
    artifactName: args.artifactName,
    defaultBranch: args.defaultBranch,
  };
  const authorityTrustSha256 = process.env.VALDRIS_AUTHORITY_TRUST_SHA256 || "";
  const result = args.metadataOnly
    ? validateTrustedReleaseMetadata({
        run,
        artifactListing,
        expected,
        authorityTrustSha256,
      })
    : validateTrustedReleaseSource({
        run,
        artifactListing,
        provenance: readJson(
          path.join(
            path.resolve(args.artifactRoot || ""),
            "release-source.json",
          ),
        ),
        artifactRoot: path.resolve(args.artifactRoot || ""),
        expected,
        authorityTrustSha256,
      });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    main();
  } catch (error) {
    console.error(
      JSON.stringify({ valid: false, problems: [error.message] }, null, 2),
    );
    process.exit(1);
  }
