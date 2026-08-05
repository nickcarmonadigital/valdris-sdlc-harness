#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requiresWebVerification,
  validateClassificationRecord,
  validateTerminologyPolicy,
} from "./terminology-policy-lib.mjs";
import {
  declaredLocalEvidenceBytes,
  validateClassificationRecordFiles,
} from "./classification-record-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  readFileSync(
    path.join(root, "policies", "technical-communication.v1.json"),
    "utf8",
  ),
);
const valdrisRecord = JSON.parse(
  readFileSync(
    path.join(root, "classification", "valdris-system-classification.v1.json"),
    "utf8",
  ),
);

function clone(value) {
  return structuredClone(value);
}

function localRecord() {
  return {
    schema: "valdris.ontology-classification.v1",
    subject: { name: "Fixture", kind: "system" },
    observableMechanism: [
      "Reads a repository policy and validates an artifact.",
    ],
    responsibilityBoundary: {
      owns: ["artifact validation"],
      doesNotOwn: ["code implementation"],
    },
    domain: "software delivery assurance",
    ontology: {
      name: "Fixture system categories",
      sourceRefs: ["LOCAL-1"],
    },
    candidateCategories: ["artifact validator", "coding agent"],
    classCriteria: [
      {
        id: "CRIT-1",
        description: "Validates a declared artifact.",
        decisive: true,
        status: "satisfied",
        evidenceRefs: ["LOCAL-1"],
      },
    ],
    localEvidenceInspected: true,
    webVerification: {
      required: false,
      status: "not_required",
      reason: "Direct repository evidence supports every decisive criterion.",
    },
    evidence: [
      {
        id: "LOCAL-1",
        origin: "local",
        sourceType: "official_repository",
        publisher: "Fixture project",
        title: "Validator source",
        url: null,
        repositoryPath: "scripts/fixture.mjs",
        revision: "0123456789abcdef0123456789abcdef01234567",
        accessedAt: "2026-08-01",
        claim: "The source validates the declared artifact.",
      },
    ],
    sourcedFacts: ["The source validates the declared artifact."],
    inferences: ["The fixture is an artifact validator."],
    selectedCategory: "artifact validator",
    selectedTerm: "artifact validator",
    plainMeaning: "Software that validates a declared artifact.",
    termStatus: "internal",
    classificationStatus: "established",
    rejectedTerms: [
      {
        term: "coding agent",
        reason: "The fixture does not implement code changes.",
      },
    ],
    uncertainties: [],
  };
}

function expectProblem(record, expected) {
  const problems = validateClassificationRecord(record, policy);
  assert.ok(
    problems.some((problem) => problem.includes(expected)),
    `expected problem containing ${JSON.stringify(expected)}; got ${JSON.stringify(problems)}`,
  );
}

function expectPolicyProblem(candidate, expected) {
  const problems = validateTerminologyPolicy(candidate);
  assert.ok(
    problems.some((problem) => problem.includes(expected)),
    `expected policy problem containing ${JSON.stringify(expected)}; got ${JSON.stringify(problems)}`,
  );
}

function git(repoRoot, args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}

function withTemporaryEvidenceRepository(callback) {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "valdris-terminology-"));
  try {
    mkdirSync(path.join(repoRoot, "policies"), { recursive: true });
    mkdirSync(path.join(repoRoot, "classification"), { recursive: true });
    mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "policies", "technical-communication.v1.json"),
      `${JSON.stringify(policy, null, 2)}\n`,
    );
    writeFileSync(
      path.join(repoRoot, "scripts", "fixture.mjs"),
      "export const fixture = true;\n",
    );
    git(repoRoot, ["init", "--quiet"]);
    git(repoRoot, ["config", "user.email", "terminology-test@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Terminology Test"]);
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "--quiet", "-m", "fixture"]);
    const record = localRecord();
    record.evidence[0].revision = git(repoRoot, ["rev-parse", "HEAD"]);
    const recordPath = path.join(
      repoRoot,
      "classification",
      "classification.json",
    );
    const writeRecord = () =>
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    writeRecord();
    callback({ repoRoot, record, recordPath, writeRecord });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

assert.deepEqual(validateTerminologyPolicy(policy), []);
assert.deepEqual(validateClassificationRecord(localRecord(), policy), []);
assert.deepEqual(validateClassificationRecord(valdrisRecord, policy), []);
assert.equal(requiresWebVerification(localRecord()), false);

{
  const result = validateClassificationRecordFiles(
    path.resolve(root, "..", "outside-classification.json"),
    { repoRoot: root },
  );
  assert.ok(
    result.problems.includes(
      "ontology classification record path must stay within the repository",
    ),
  );
}

{
  const result = validateClassificationRecordFiles(
    path.join(root, "classification", "valdris-system-classification.v1.json"),
    { repoRoot: root, policyFile: "../outside-policy.json" },
  );
  assert.ok(
    result.problems.includes(
      "terminology policy path must stay within the repository",
    ),
  );
}

{
  const result = validateClassificationRecordFiles(
    path.join(root, "classification", "valdris-system-classification.v1.json"),
    { repoRoot: root },
  );
  assert.equal(result.valid, true, JSON.stringify(result.problems));
}

withTemporaryEvidenceRepository(
  ({ repoRoot, record, recordPath, writeRecord }) => {
    let result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.equal(result.valid, true, JSON.stringify(result.problems));

    const fixturePath = path.join(repoRoot, "scripts", "fixture.mjs");
    const committedFixtureBytes = readFileSync(fixturePath);
    writeFileSync(fixturePath, "export const fixture = 'worktree drift';\n");
    assert.deepEqual(
      declaredLocalEvidenceBytes(repoRoot, record.evidence[0]),
      committedFixtureBytes,
      "declared Git evidence must resolve committed bytes instead of dirty worktree bytes",
    );
    writeFileSync(fixturePath, committedFixtureBytes);

    const priorGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(repoRoot, "ambient-redirection.git");
    try {
      result = validateClassificationRecordFiles(recordPath, { repoRoot });
      assert.equal(
        result.valid,
        true,
        "ambient GIT_DIR must not redirect evidence verification",
      );
    } finally {
      if (priorGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = priorGitDir;
    }

    record.evidence[0].repositoryPath = "scripts";
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("not bound to the declared Git revision"),
      ),
      "a Git tree must not satisfy a local evidence file binding",
    );

    const fixtureBlob = git(repoRoot, [
      "rev-parse",
      "HEAD:scripts/fixture.mjs",
    ]);
    git(repoRoot, [
      "update-index",
      "--add",
      "--cacheinfo",
      "120000",
      fixtureBlob,
      "scripts/link.mjs",
    ]);
    git(repoRoot, ["commit", "--quiet", "-m", "symlink-mode fixture"]);
    record.evidence[0].repositoryPath = "scripts/link.mjs";
    record.evidence[0].revision = git(repoRoot, ["rev-parse", "HEAD"]);
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("not bound to the declared Git revision"),
      ),
      "a committed symlink blob must not satisfy a local evidence file binding",
    );

    record.evidence[0].repositoryPath = "scripts/missing.mjs";
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("not bound to the declared Git revision"),
      ),
    );

    record.evidence[0].repositoryPath = "scripts/fixture.mjs";
    record.evidence[0].revision = "0".repeat(40);
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("not bound to the declared Git revision"),
      ),
    );

    record.evidence[0].revision = "HEAD";
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("not bound to the declared Git revision"),
      ),
      "moving Git revision names must not bind local evidence",
    );

    const originalRevision = git(repoRoot, ["rev-parse", "HEAD"]);
    writeFileSync(
      path.join(repoRoot, "scripts", "fabricated-evidence.mjs"),
      "export const fabricated = true;\n",
    );
    git(repoRoot, ["add", "scripts/fabricated-evidence.mjs"]);
    git(repoRoot, ["commit", "--quiet", "-m", "replacement fixture"]);
    const replacementRevision = git(repoRoot, ["rev-parse", "HEAD"]);
    git(repoRoot, ["replace", originalRevision, replacementRevision]);
    record.evidence[0].repositoryPath = "scripts/fabricated-evidence.mjs";
    record.evidence[0].revision = originalRevision;
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("not bound to the declared Git revision"),
      ),
      "Git replacement refs must not substitute declared evidence",
    );
    git(repoRoot, ["replace", "-d", originalRevision]);

    record.evidence[0].repositoryPath = "scripts/fixture.mjs";
    record.evidence[0].revision = createHash("sha256")
      .update(readFileSync(path.join(repoRoot, "scripts", "fixture.mjs")))
      .digest("hex");
    writeRecord();
    result = validateClassificationRecordFiles(recordPath, { repoRoot });
    assert.equal(result.valid, true, JSON.stringify(result.problems));

    if (process.platform !== "win32") {
      const lazyEvidencePath = path.join(repoRoot, "lazy-fetch-evidence.txt");
      const helperPath = path.join(repoRoot, "lazy-fetch-helper.sh");
      const markerPath = path.join(repoRoot, "LAZY_FETCH_HELPER_EXECUTED");
      writeFileSync(
        lazyEvidencePath,
        "committed evidence that will be missing\n",
      );
      writeFileSync(helperPath, `#!/bin/sh\n: > "${markerPath}"\nexit 1\n`);
      chmodSync(helperPath, 0o755);
      git(repoRoot, ["add", "lazy-fetch-evidence.txt"]);
      git(repoRoot, ["commit", "--quiet", "-m", "lazy fetch fixture"]);
      const lazyRevision = git(repoRoot, ["rev-parse", "HEAD"]);
      const lazyBlob = git(repoRoot, [
        "rev-parse",
        "HEAD:lazy-fetch-evidence.txt",
      ]);
      rmSync(
        path.join(
          repoRoot,
          ".git",
          "objects",
          lazyBlob.slice(0, 2),
          lazyBlob.slice(2),
        ),
      );
      git(repoRoot, ["config", "extensions.partialClone", "origin"]);
      git(repoRoot, ["config", "remote.origin.promisor", "true"]);
      git(repoRoot, ["config", "remote.origin.url", `ext::${helperPath}`]);
      git(repoRoot, ["config", "protocol.ext.allow", "always"]);
      assert.equal(
        declaredLocalEvidenceBytes(repoRoot, {
          origin: "local",
          repositoryPath: "lazy-fetch-evidence.txt",
          revision: lazyRevision,
        }),
        null,
        "missing promisor evidence must fail closed",
      );
      assert.equal(
        existsSync(markerPath),
        false,
        "evidence lookup must not execute a lazy-fetch transport helper",
      );
    }
  },
);

{
  const record = localRecord();
  record.schema = "wrong";
  expectProblem(record, "schema must be valdris.ontology-classification.v1");
}

{
  const record = localRecord();
  record.observableMechanism = [];
  expectProblem(record, "observableMechanism must contain");
}

{
  const record = localRecord();
  record.classCriteria[0].decisive = false;
  expectProblem(record, "requires at least one decisive criterion");
}

{
  const record = localRecord();
  record.evidence.push(clone(record.evidence[0]));
  expectProblem(record, "evidence id duplicated: LOCAL-1");
}

{
  const record = localRecord();
  record.classCriteria[0].evidenceRefs = [];
  assert.equal(requiresWebVerification(record), true);
  expectProblem(record, "decisive criterion CRIT-1 requires evidence");
  expectProblem(record, "web verification is required");
}

{
  const record = localRecord();
  record.classCriteria[0].status = "unknown";
  assert.equal(requiresWebVerification(record), true);
  expectProblem(record, "web verification is required");
  expectProblem(
    record,
    "established classification requires every decisive criterion",
  );
}

{
  const record = localRecord();
  record.webVerification = {
    required: true,
    status: "not_required",
    reason: "fixture",
  };
  expectProblem(record, "required web verification cannot be not_required");
}

{
  const record = localRecord();
  record.webVerification = {
    required: true,
    status: "completed",
    reason: "fixture",
  };
  expectProblem(
    record,
    "completed web verification requires direct web evidence",
  );
}

{
  const record = localRecord();
  record.webVerification = {
    required: false,
    status: "completed",
    reason: "optional lookup",
  };
  expectProblem(
    record,
    "completed web verification requires direct web evidence",
  );
}

{
  const record = localRecord();
  record.webVerification = {
    required: true,
    status: "completed",
    reason: "fixture",
  };
  record.evidence.push({
    id: "WEB-1",
    origin: "web",
    sourceType: "reputable_secondary",
    publisher: "Secondary publisher",
    title: "Secondary article",
    url: "https://example.com/article",
    repositoryPath: null,
    revision: null,
    accessedAt: "2026-08-01",
    claim: "A secondary claim.",
  });
  expectProblem(
    record,
    "completed web verification requires direct web evidence",
  );
}

{
  const record = localRecord();
  record.webVerification = {
    required: true,
    status: "blocked",
    reason: "network unavailable",
  };
  expectProblem(
    record,
    "blocked or incomplete web verification requires one of the policy blocked statuses",
  );
  expectProblem(
    record,
    "blocked or incomplete web verification cannot select a final category",
  );
}

{
  const record = localRecord();
  record.classCriteria[0].status = "not_satisfied";
  assert.equal(requiresWebVerification(record), false);
  expectProblem(
    record,
    "established classification requires every decisive criterion",
  );

  record.classificationStatus = "unsupported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = ["The decisive criterion is not satisfied."];
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.classificationStatus = "unsupported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = ["The claim is unsupported."];
  expectProblem(
    record,
    "does not match decisive criterion outcome; expected established",
  );
}

{
  const record = localRecord();
  record.classCriteria[0].status = "not_satisfied";
  record.evidence[0].origin = "web";
  record.evidence[0].sourceType = "reputable_secondary";
  record.evidence[0].url = "https://example.com/secondary";
  record.evidence[0].repositoryPath = null;
  record.evidence[0].revision = null;
  record.classificationStatus = "unsupported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = ["Only secondary evidence was available."];
  assert.equal(requiresWebVerification(record), true);
  expectProblem(record, "web verification is required");
  expectProblem(record, "cannot be established by secondary-only evidence");
}

{
  const record = localRecord();
  record.classCriteria[0].status = "not_satisfied";
  record.evidence.push({
    id: "WEB-1",
    origin: "web",
    sourceType: "reputable_secondary",
    publisher: "Secondary publisher",
    title: "Secondary article",
    url: "https://example.com/secondary",
    repositoryPath: null,
    revision: null,
    accessedAt: "2026-08-01",
    claim: "A secondary claim.",
  });
  record.classCriteria[0].evidenceRefs.push("WEB-1");
  record.classificationStatus = "unsupported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = [
    "The mixed evidence does not establish the category.",
  ];
  assert.equal(requiresWebVerification(record), true);
  expectProblem(record, "web verification is required");
  record.webVerification = {
    required: true,
    status: "completed",
    reason: "The web evidence was inspected.",
  };
  expectProblem(
    record,
    "completed web verification requires direct web evidence",
  );
}

{
  const record = localRecord();
  record.classCriteria.push({
    ...clone(record.classCriteria[0]),
    id: "CRIT-2",
    status: "contested",
  });
  record.classificationStatus = "partially_supported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = ["One decisive criterion is contested."];
  expectProblem(
    record,
    "does not match decisive criterion outcome; expected contested",
  );
}

{
  const record = localRecord();
  record.classCriteria.push({
    ...clone(record.classCriteria[0]),
    id: "CRIT-2",
    status: "not_satisfied",
  });
  record.classificationStatus = "partially_supported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = ["One decisive criterion is not satisfied."];
  expectProblem(
    record,
    "does not match decisive criterion outcome; expected unsupported",
  );

  record.classificationStatus = "unsupported";
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.evidence.push({
    id: "WEB-1",
    origin: "web",
    sourceType: "official_documentation",
    publisher: "Fixture authority",
    title: "Fixture documentation",
    url: "https://example.com/official",
    repositoryPath: null,
    revision: null,
    accessedAt: "2026-08-01",
    claim: "The second criterion remains unresolved.",
  });
  record.classCriteria.push({
    ...clone(record.classCriteria[0]),
    id: "CRIT-2",
    status: "unknown",
    evidenceRefs: ["WEB-1"],
  });
  record.webVerification = {
    required: true,
    status: "completed",
    reason: "A direct authoritative source was inspected.",
  };
  record.classificationStatus = "partially_supported";
  record.selectedCategory = null;
  record.selectedTerm = null;
  record.termStatus = "uncertain";
  record.uncertainties = ["One decisive criterion remains unknown."];
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.evidence[0].origin = "web";
  record.evidence[0].url = "http://example.com/source";
  record.evidence[0].repositoryPath = null;
  expectProblem(record, "web evidence LOCAL-1 url must use https");
}

for (const repositoryPath of [
  "/etc/passwd",
  "../outside.json",
  "evidence/../outside.json",
  ["C:", "Users", "operator", "evidence.json"].join("\\"),
  ["", "server", "share", "evidence.json"].join("\\"),
  ["", "", "server", "share", "evidence.json"].join("\\"),
  ["", "?", "C:", "evidence.json"].join("\\"),
  ["scripts", "commission-harness.mjs"].join("\\"),
  "scripts/fixture.mjs:stream",
  "scripts/CON",
  "scripts/trailing./evidence.json",
  "scripts/control\nfile.json",
  "evidence/./source.json",
  "evidence\0source.json",
]) {
  const record = localRecord();
  record.evidence[0].repositoryPath = repositoryPath;
  expectProblem(
    record,
    "repositoryPath must be a safe repository-relative path",
  );
}

{
  const record = localRecord();
  record.selectedCategory = "uncandidate category";
  expectProblem(record, "selectedCategory must be one of candidateCategories");
}

{
  const record = localRecord();
  record.rejectedTerms[0].term = "Artifact Validator";
  expectProblem(record, "selectedTerm cannot also be rejected");
}

{
  const record = localRecord();
  record.selectedTerm = "operating system";
  expectProblem(
    record,
    "selectedTerm cannot use a restricted term without qualification",
  );
}

{
  const record = localRecord();
  record.inferences = [record.sourcedFacts[0]];
  expectProblem(
    record,
    "sourcedFacts and inferences must not contain the same statement",
  );
}

{
  const record = localRecord();
  record.inferences.push("This fixture is ASD-STE100 compliant.");
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.sourcedFacts.push("Valdris is ASD-STE100 compliant.");
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.sourcedFacts.push(
    "A supplier claims that Valdris is ASD-STE100 compliant.",
  );
  record.inferences.push("The supplier claim is not established.");
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.inferences.push(
    "Valdris is not only documented but ASD-STE100 compliant.",
  );
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.inferences.push(
    "Valdris is not certified by a vendor but ASD-STE100 compliant.",
  );
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.sourcedFacts.push(
    "There is no doubt Valdris is ASD-STE100 compliant.",
  );
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.sourcedFacts.push("No one doubts Valdris is ASD-STE100 compliant.");
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.sourcedFacts.push(
    "The source claims that Valdris is ASD-STE100 compliant, but Valdris is ASD-STE100 compliant.",
  );
  expectProblem(record, "prohibited terminology claim");
}

for (const mixedReport of [
  "The supplier claims that its product is ASD-STE100 compliant and Valdris is ASD-STE100 compliant.",
  "According to the supplier, its product is ASD-STE100 compliant and Valdris is ASD-STE100 compliant.",
]) {
  const record = localRecord();
  record.sourcedFacts.push(mixedReport);
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.sourcedFacts.push(
    "This record states that Valdris is ASD-STE100 compliant.",
  );
  expectProblem(record, "prohibited terminology claim");
}

{
  const record = localRecord();
  record.inferences.push("This fixture is not ASD-STE100 compliant.");
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

for (const denial of [
  "Formal ASD-STE100 compliance is not established.",
  "ASD-STE100 compliance is not verified.",
  "Valdris does not have formal ASD-STE100 compliance.",
]) {
  const record = localRecord();
  record.inferences.push(denial);
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.observableMechanism.push(
    "Rejects the phrase ASD-STE100 compliant when no conformance profile exists.",
  );
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.evidence[0].claim =
    "The inspected source contains the phrase ASD-STE100 compliant.";
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const record = localRecord();
  record.responsibilityBoundary.doesNotOwn.push(
    "Certification that an output is ASD-STE100 compliant.",
  );
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const candidate = clone(policy);
  candidate.formal_asd_ste100_compliance = true;
  expectPolicyProblem(candidate, "formal_asd_ste100_compliance must be false");
}

{
  const candidate = clone(policy);
  candidate.communication_profile.target_standard.issue = "8";
  expectPolicyProblem(
    candidate,
    "target_standard must select ASD-STE100 Issue 9",
  );
}

{
  const candidate = clone(policy);
  candidate.record_use.required_for_routine_communication = true;
  expectPolicyProblem(
    candidate,
    "must not require a record for routine communication",
  );
}

{
  const candidate = clone(policy);
  candidate.record_use.required_for_material_decisions = [
    "public_product_or_system_category",
  ];
  expectPolicyProblem(
    candidate,
    "must not require records for every material decision",
  );
}

{
  const candidate = clone(policy);
  candidate.allowed_source_types.push("personal_blog");
  expectPolicyProblem(
    candidate,
    "allowed_source_types contains unsupported value",
  );
}

{
  const candidate = clone(policy);
  delete candidate.web_verification.blocked_statuses;
  expectPolicyProblem(
    candidate,
    "web_verification.blocked_statuses must contain",
  );
}

{
  const candidate = clone(policy);
  candidate.web_verification.blocked_statuses.push("contested");
  expectPolicyProblem(
    candidate,
    "web_verification.blocked_statuses contains unsupported value",
  );
}

for (const classificationStatus of ["partially_supported", "contested"]) {
  const record = localRecord();
  record.classificationStatus = classificationStatus;
  expectProblem(
    record,
    `${classificationStatus} classification cannot select a final category or term`,
  );
}

{
  const record = localRecord();
  record.termStatus = "contested";
  assert.deepEqual(validateClassificationRecord(record, policy), []);
}

{
  const candidate = clone(policy);
  candidate.procedure = candidate.procedure.filter(
    (step) =>
      step !== "escalate_unsupported_criteria_to_authoritative_web_sources",
  );
  expectPolicyProblem(candidate, "procedure missing canonical step");
}

{
  const candidate = clone(policy);
  candidate.procedure.push("invent_semantics");
  expectPolicyProblem(candidate, "procedure contains unsupported value");
}

console.log("Ontology and terminology policy verification passed");
