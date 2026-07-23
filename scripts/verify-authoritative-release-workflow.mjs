#!/usr/bin/env node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateTrustedReleaseMetadata,
  validateTrustedReleaseSource,
} from "./authoritative-release-source-gate.mjs";
import { evaluateAuthoritativeRelease } from "./authoritative-release-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_PATH = path.join(
  ROOT,
  ".github",
  "workflows",
  "authoritative-release.yml",
);
const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const problems = [];

function requireText(fragment, label = fragment) {
  if (!workflow.includes(fragment))
    problems.push(`authoritative release workflow is missing ${label}`);
}

const triggerBlock = workflow.slice(
  workflow.indexOf("on:"),
  workflow.indexOf("permissions:"),
);
if (
  !/workflow_dispatch:\s*$/mu.test(triggerBlock) ||
  /^\s{2}(?:push|pull_request|release):/mu.test(triggerBlock) ||
  /\btags:/u.test(triggerBlock)
)
  problems.push(
    "authoritative release workflow must be manual pre-tag dispatch only",
  );

for (const [fragment, label] of [
  ["permissions: {}", "deny-by-default top-level permissions"],
  ["environment: authoritative-release", "protected release environment"],
  ["actions: read", "read-only Actions permission"],
  ["contents: read", "read-only contents permission"],
  [
    "vars.VALDRIS_TRUSTED_AUTHORITATIVE_WORKFLOW_ID",
    "protected trusted workflow ID",
  ],
  [
    "vars.VALDRIS_TRUSTED_AUTHORITATIVE_WORKFLOW_PATH",
    "protected trusted workflow path",
  ],
  [
    "vars.VALDRIS_AUTHORITATIVE_ARTIFACT_NAME",
    "protected authoritative artifact name",
  ],
  [
    "vars.VALDRIS_TRUSTED_RELEASE_VALIDATOR_COMMIT",
    "protected validator commit",
  ],
  ["vars.VALDRIS_STABLE_TAG_RULESET_ID", "commissioned tag ruleset ID"],
  ["vars.VALDRIS_RELEASE_APP_ID", "commissioned release App ID"],
  ["vars.VALDRIS_AUTHORITY_TRUST_SHA256", "operator-held authority trust pin"],
  ["secrets.VALDRIS_RELEASE_APP_TOKEN", "dedicated release App token"],
  [
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "pinned cross-run artifact download",
  ],
  [
    "artifact-ids: ${{ steps.trusted-source.outputs.artifact_id }}",
    "immutable artifact identity",
  ],
  ["github-token: ${{ secrets.GITHUB_TOKEN }}", "read-only artifact token"],
  ["repository: ${{ github.repository }}", "same-repository artifact binding"],
  ["run-id: ${{ inputs.trusted_run_id }}", "trusted run identity"],
  [
    "authoritative-release-source-gate.mjs",
    "trusted release-source provenance gate",
  ],
  ["--metadata-only", "pre-download run validation"],
  ['--run-root "$RUNNER_TEMP/authoritative-artifact/run-root"', "run root"],
  [
    '--repository-root "$GITHUB_WORKSPACE/candidate"',
    "verified candidate package-version binding",
  ],
  ["gh api --hostname github.com", "explicit provider hostname"],
  ["installation/repositories?per_page=100", "release App installation proof"],
  [
    "active stable-tag ruleset is not restricted to the commissioned release App",
    "live stable-tag ruleset validation",
  ],
  ['gh release create "$RELEASE_TAG"', "stable release creation"],
]) {
  requireText(fragment, label);
}

if (/contents:\s*write/u.test(workflow))
  problems.push(
    "workflow GITHUB_TOKEN must not receive contents write; only the protected release App creates stable refs",
  );
if (/^\s{10}persist-credentials:\s*true\s*$/mu.test(workflow))
  problems.push("authoritative release checkout must not persist credentials");

const orderedSteps = [
  "Authorize protected stable-release request",
  "Checkout protected release validator",
  "Resolve trusted same-repository run and artifact",
  "Validate trusted run metadata before download",
  "Checkout intended release commit without credentials",
  "Verify intended commit provenance",
  "Download commissioned authoritative run artifact",
  "Validate downloaded artifact provenance",
  "Run authoritative stable-release gate before tag creation",
  "Verify active stable-tag ruleset",
  "Verify dedicated release-app identity and absent tag",
  "Create stable tag and release with dedicated release App",
  "Verify stable tag and published release",
];
let priorIndex = -1;
for (const step of orderedSteps) {
  const index = workflow.indexOf(`- name: ${step}`);
  if (index < 0 || index <= priorIndex)
    problems.push(`release workflow step is missing or out of order: ${step}`);
  priorIndex = index;
}
const stableGateIndex = workflow.indexOf(
  'node "$GITHUB_WORKSPACE/validator/scripts/authoritative-release-gate.mjs"',
);
const tagCreationIndex = workflow.indexOf('gh release create "$RELEASE_TAG"');
if (
  stableGateIndex < 0 ||
  tagCreationIndex < 0 ||
  stableGateIndex >= tagCreationIndex
)
  problems.push("stable authoritative gate must complete before tag creation");

const fixtureRoot = mkdtempSync(
  path.join(tmpdir(), "valdris-authoritative-release-workflow-"),
);
try {
  const artifactRoot = path.join(fixtureRoot, "artifact");
  const runRoot = path.join(artifactRoot, "run-root");
  const candidateRoot = path.join(fixtureRoot, "candidate");
  mkdirSync(candidateRoot, { recursive: true });
  writeFileSync(
    path.join(candidateRoot, "package.json"),
    `${JSON.stringify({ version: "0.9.1" })}\n`,
  );
  const substitutedCandidateVersion = evaluateAuthoritativeRelease({
    tag: "v0.9.0",
    repositoryRoot: candidateRoot,
  });
  if (
    substitutedCandidateVersion.ok ||
    !substitutedCandidateVersion.problems?.some((problem) =>
      problem.includes("does not match candidate package version"),
    )
  )
    problems.push(
      "stable release gate accepted a tag from a substituted candidate package version",
    );
  mkdirSync(path.join(runRoot, "assurance"), { recursive: true });
  mkdirSync(path.join(runRoot, "runtime"), { recursive: true });
  const expected = {
    repository: "example/valdris",
    workflowId: 421,
    workflowPath: ".github/workflows/authoritative-evidence.yml",
    runId: 731,
    sourceCommit: "a".repeat(40),
    artifactName: "valdris-authoritative-run",
    defaultBranch: "main",
  };
  writeFileSync(
    path.join(runRoot, "assurance", "authoritative.json"),
    `${JSON.stringify({ commit: expected.sourceCommit })}\n`,
  );
  writeFileSync(path.join(runRoot, "runtime", "session.json"), "{}\n");
  const run = {
    id: expected.runId,
    workflow_id: expected.workflowId,
    path: expected.workflowPath,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    run_attempt: 2,
    head_branch: expected.defaultBranch,
    head_sha: expected.sourceCommit,
    repository: { id: 31, full_name: expected.repository },
    head_repository: { id: 31, full_name: expected.repository },
  };
  const artifact = {
    id: 1234,
    name: expected.artifactName,
    expired: false,
    size_in_bytes: 1024,
    workflow_run: {
      id: expected.runId,
      repository_id: 31,
      head_repository_id: 31,
      head_branch: expected.defaultBranch,
      head_sha: expected.sourceCommit,
    },
  };
  const artifactListing = [{ total_count: 1, artifacts: [artifact] }];
  const provenance = {
    schema: "valdris.authoritative-release-source.v1",
    repository: expected.repository,
    workflowRunId: expected.runId,
    workflowRunAttempt: run.run_attempt,
    workflowId: expected.workflowId,
    workflowPath: expected.workflowPath,
    sourceCommit: expected.sourceCommit,
    artifactName: expected.artifactName,
    runRoot: "run-root",
  };
  writeFileSync(
    path.join(artifactRoot, "release-source.json"),
    `${JSON.stringify(provenance)}\n`,
  );
  const trust = "b".repeat(64);
  const valid = validateTrustedReleaseSource({
    run,
    artifactListing,
    provenance,
    artifactRoot,
    expected,
    authorityTrustSha256: trust,
  });
  if (!valid.valid)
    problems.push(
      `valid trusted release source was rejected: ${valid.problems.join("; ")}`,
    );
  const adversarial = [
    [
      "missing workflow run",
      () =>
        validateTrustedReleaseMetadata({
          run: null,
          artifactListing,
          expected,
          authorityTrustSha256: trust,
        }),
    ],
    [
      "missing artifact",
      () =>
        validateTrustedReleaseMetadata({
          run,
          artifactListing: { artifacts: [] },
          expected,
          authorityTrustSha256: trust,
        }),
    ],
    [
      "commit substitution",
      () =>
        validateTrustedReleaseMetadata({
          run,
          artifactListing,
          expected: { ...expected, sourceCommit: "c".repeat(40) },
          authorityTrustSha256: trust,
        }),
    ],
    [
      "missing protected trust",
      () =>
        validateTrustedReleaseMetadata({
          run,
          artifactListing,
          expected,
          authorityTrustSha256: "",
        }),
    ],
    [
      "cross-repository run",
      () =>
        validateTrustedReleaseMetadata({
          run: {
            ...run,
            head_repository: { id: 99, full_name: "fork/valdris" },
          },
          artifactListing,
          expected,
          authorityTrustSha256: trust,
        }),
    ],
    [
      "artifact provenance substitution",
      () =>
        validateTrustedReleaseSource({
          run,
          artifactListing,
          provenance: { ...provenance, sourceCommit: "d".repeat(40) },
          artifactRoot,
          expected,
          authorityTrustSha256: trust,
        }),
    ],
    [
      "authoritative closure commit substitution",
      () => {
        writeFileSync(
          path.join(runRoot, "assurance", "authoritative.json"),
          `${JSON.stringify({ commit: "e".repeat(40) })}\n`,
        );
        const result = validateTrustedReleaseSource({
          run,
          artifactListing,
          provenance,
          artifactRoot,
          expected,
          authorityTrustSha256: trust,
        });
        writeFileSync(
          path.join(runRoot, "assurance", "authoritative.json"),
          `${JSON.stringify({ commit: expected.sourceCommit })}\n`,
        );
        return result;
      },
    ],
  ];
  for (const [label, evaluate] of adversarial) {
    const result = evaluate();
    if (result.valid)
      problems.push(`trusted release-source gate accepted ${label}`);
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

if (problems.length) {
  console.error(JSON.stringify({ ok: false, problems }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      tests: {
        workflowDispatchOnly: true,
        protectedEnvironment: true,
        leastPrivilegeTokens: true,
        trustedSameRepositoryRun: true,
        exactArtifactAndCommit: true,
        exactCandidatePackageVersion: true,
        protectedTrustRequired: true,
        stableGateBeforeTag: true,
        dedicatedReleaseIdentity: true,
        adversarialSourceMetadata: 7,
      },
    },
    null,
    2,
  ),
);
