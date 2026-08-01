#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requiresWebVerification,
  validateClassificationRecord,
  validateTerminologyPolicy,
} from "./terminology-policy-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  readFileSync(
    path.join(root, "controls", "terminology-policy.v1.json"),
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

assert.deepEqual(validateTerminologyPolicy(policy), []);
assert.deepEqual(validateClassificationRecord(localRecord(), policy), []);
assert.deepEqual(validateClassificationRecord(valdrisRecord, policy), []);
assert.equal(requiresWebVerification(localRecord()), false);

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
    "blocked or incomplete web verification requires uncertain or not_established",
  );
  expectProblem(
    record,
    "blocked or incomplete web verification cannot select a final category",
  );
}

{
  const record = localRecord();
  record.classCriteria[0].status = "not_satisfied";
  expectProblem(
    record,
    "established classification requires every decisive criterion",
  );
}

{
  const record = localRecord();
  record.evidence[0].origin = "web";
  record.evidence[0].url = "http://example.com/source";
  record.evidence[0].repositoryPath = null;
  expectProblem(record, "web evidence LOCAL-1 url must use https");
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
  const candidate = clone(policy);
  candidate.formal_asd_ste100_compliance = true;
  expectPolicyProblem(candidate, "formal_asd_ste100_compliance must be false");
}

{
  const candidate = clone(policy);
  candidate.procedure = candidate.procedure.filter(
    (step) =>
      step !== "escalate_unsupported_criteria_to_authoritative_web_sources",
  );
  expectPolicyProblem(candidate, "procedure missing canonical step");
}

console.log("Ontology and terminology policy verification passed");
