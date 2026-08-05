const CLASSIFICATION_SCHEMA = "valdris.ontology-classification.v1";
const POLICY_SCHEMA = "valdris.terminology-policy.v1";
const WEB_VERIFICATION_STATUSES = new Set([
  "not_required",
  "completed",
  "blocked",
  "incomplete",
]);
const CLASSIFICATION_STATUSES = [
  "established",
  "partially_supported",
  "unsupported",
  "contested",
  "uncertain",
  "not_established",
];
const CRITERION_STATUSES = [
  "satisfied",
  "not_satisfied",
  "unknown",
  "contested",
];
const TERM_STATUSES = [
  "standard",
  "emerging",
  "vendor_specific",
  "internal",
  "contested",
  "uncertain",
];
const SOURCE_TYPES = [
  "standard",
  "official_specification",
  "official_documentation",
  "official_repository",
  "peer_reviewed",
  "reputable_secondary",
];
const DIRECT_WEB_SOURCE_TYPES = new Set([
  "standard",
  "official_specification",
  "official_documentation",
  "official_repository",
  "peer_reviewed",
]);
const CANONICAL_PROCEDURE = [
  "inspect_direct_evidence",
  "describe_observable_mechanism",
  "record_responsibility_boundary",
  "identify_domain_ontology",
  "list_candidate_categories",
  "apply_decisive_criteria",
  "escalate_unsupported_criteria_to_authoritative_web_sources",
  "separate_sourced_facts_from_inference",
  "select_smallest_supported_category",
  "define_selected_term_plainly",
  "record_term_status_and_uncertainty",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => nonEmpty(item));
}

function uniqueStrings(values) {
  return new Set(values).size === values.length;
}

function validateNonEmptyStringArray(value, label, problems, options = {}) {
  const { allowEmpty = false } = options;
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    problems.push(
      `${label} must contain${allowEmpty ? " only" : " at least one"} non-empty string${allowEmpty ? " values" : ""}`,
    );
    return [];
  }
  const clean = value.map((item) => nonEmpty(item));
  if (clean.some((item) => !item))
    problems.push(`${label} must contain only non-empty strings`);
  if (!uniqueStrings(clean.filter(Boolean)))
    problems.push(`${label} must not contain duplicate values`);
  return clean.filter(Boolean);
}

function validateExactValues(values, expected, label, problems) {
  const actual = new Set(values);
  const required = new Set(expected);
  for (const value of expected)
    if (!actual.has(value)) problems.push(`${label} missing: ${value}`);
  for (const value of values)
    if (!required.has(value))
      problems.push(`${label} contains unsupported value: ${value}`);
}

function isSafeRepositoryPath(value) {
  const clean = nonEmpty(value);
  if (
    !clean ||
    clean.includes("\0") ||
    clean.startsWith("/") ||
    clean.startsWith("\\\\") ||
    /^[A-Za-z]:/.test(clean)
  )
    return false;
  return clean
    .replaceAll("\\", "/")
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value))
    for (const item of value) collectStrings(item, output);
  else if (isObject(value))
    for (const item of Object.values(value)) collectStrings(item, output);
  return output;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isDateLike(value) {
  return Boolean(nonEmpty(value)) && !Number.isNaN(Date.parse(value));
}

export function validateTerminologyPolicy(policy) {
  const problems = [];
  if (!isObject(policy)) return ["terminology policy must be a JSON object"];
  if (policy.schema !== POLICY_SCHEMA)
    problems.push(`terminology policy schema must be ${POLICY_SCHEMA}`);
  if (!nonEmpty(policy.version))
    problems.push("terminology policy version is required");
  if (!nonEmpty(policy.title))
    problems.push("terminology policy title is required");
  if (!nonEmpty(policy.canonical_document))
    problems.push("terminology policy canonical_document is required");
  if (!nonEmpty(policy.source_register))
    problems.push("terminology policy source_register is required");
  if (policy.cross_cutting !== true)
    problems.push("terminology policy cross_cutting must be true");
  if (policy.optional_skill !== false)
    problems.push("terminology policy optional_skill must be false");
  if (policy.formal_asd_ste100_compliance !== false)
    problems.push(
      "terminology policy formal_asd_ste100_compliance must be false",
    );

  const procedure = Array.isArray(policy.procedure) ? policy.procedure : [];
  for (const step of CANONICAL_PROCEDURE)
    if (!procedure.includes(step))
      problems.push(
        `terminology policy procedure missing canonical step: ${step}`,
      );
  if (!uniqueStrings(procedure))
    problems.push("terminology policy procedure must not contain duplicates");
  validateExactValues(
    procedure,
    CANONICAL_PROCEDURE,
    "terminology policy procedure",
    problems,
  );

  const classificationStatuses = validateNonEmptyStringArray(
    policy.classification_statuses,
    "terminology policy classification_statuses",
    problems,
  );
  const criterionStatuses = validateNonEmptyStringArray(
    policy.criterion_statuses,
    "terminology policy criterion_statuses",
    problems,
  );
  const termStatuses = validateNonEmptyStringArray(
    policy.term_statuses,
    "terminology policy term_statuses",
    problems,
  );
  const sourceTypes = validateNonEmptyStringArray(
    policy.allowed_source_types,
    "terminology policy allowed_source_types",
    problems,
  );
  validateExactValues(
    classificationStatuses,
    CLASSIFICATION_STATUSES,
    "terminology policy classification_statuses",
    problems,
  );
  validateExactValues(
    criterionStatuses,
    CRITERION_STATUSES,
    "terminology policy criterion_statuses",
    problems,
  );
  validateExactValues(
    termStatuses,
    TERM_STATUSES,
    "terminology policy term_statuses",
    problems,
  );
  validateExactValues(
    sourceTypes,
    SOURCE_TYPES,
    "terminology policy allowed_source_types",
    problems,
  );

  if (policy.record_schema !== CLASSIFICATION_SCHEMA)
    problems.push(
      `terminology policy record_schema must be ${CLASSIFICATION_SCHEMA}`,
    );
  if (!nonEmpty(policy.record_template))
    problems.push("terminology policy record_template is required");
  if (!isObject(policy.record_use))
    problems.push("terminology policy record_use must be an object");
  else {
    validateNonEmptyStringArray(
      policy.record_use.recommended_for_material_decisions,
      "terminology policy record_use.recommended_for_material_decisions",
      problems,
    );
    if ("required_for_material_decisions" in policy.record_use)
      problems.push(
        "terminology policy must not require records for every material decision",
      );
    if (!nonEmpty(policy.record_use.required_when))
      problems.push("terminology policy record_use.required_when is required");
    if (policy.record_use.required_for_routine_communication !== false)
      problems.push(
        "terminology policy must not require a record for routine communication",
      );
  }
  if (!isObject(policy.web_verification))
    problems.push("terminology policy web_verification must be an object");
  else {
    if (
      policy.web_verification.required_when_decisive_criteria_lack_support !==
      true
    )
      problems.push(
        "terminology policy must require web verification when decisive criteria lack support",
      );
    if (policy.web_verification.direct_source_required !== true)
      problems.push("terminology policy must require direct-source inspection");
    if (
      policy.web_verification.secondary_only_cannot_establish_decisive_claim !==
      true
    )
      problems.push(
        "terminology policy must reject secondary-only decisive claims",
      );
  }

  if (!isObject(policy.communication_profile))
    problems.push("terminology policy communication_profile must be an object");
  else {
    if (
      policy.communication_profile.target_standard?.name !== "ASD-STE100" ||
      policy.communication_profile.target_standard?.issue !== "9" ||
      policy.communication_profile.target_standard?.conformance_status !==
        "not_verified"
    )
      problems.push(
        "communication profile target_standard must select ASD-STE100 Issue 9 with not_verified conformance status",
      );
    if (policy.communication_profile.formal_asd_ste100_compliance !== false)
      problems.push(
        "communication profile formal_asd_ste100_compliance must be false",
      );
    validateNonEmptyStringArray(
      policy.communication_profile.rules,
      "terminology policy communication_profile.rules",
      problems,
    );
  }

  const vocabulary = Array.isArray(policy.controlled_vocabulary)
    ? policy.controlled_vocabulary
    : [];
  if (vocabulary.length === 0)
    problems.push("terminology policy controlled_vocabulary is required");
  const vocabularyTerms = new Set();
  const termStatusSet = new Set(termStatuses);
  for (const entry of vocabulary) {
    if (!isObject(entry)) {
      problems.push(
        "terminology policy controlled_vocabulary entry is invalid",
      );
      continue;
    }
    const term = nonEmpty(entry.term);
    if (!term || !nonEmpty(entry.meaning) || !nonEmpty(entry.usage))
      problems.push(
        `terminology policy controlled_vocabulary entry is incomplete: ${term || "missing"}`,
      );
    if (vocabularyTerms.has(term))
      problems.push(`terminology policy controlled term duplicated: ${term}`);
    vocabularyTerms.add(term);
    if (!termStatusSet.has(entry.status))
      problems.push(
        `terminology policy controlled term ${term || "missing"} has invalid status`,
      );
  }

  validateNonEmptyStringArray(
    policy.restricted_unqualified_terms,
    "terminology policy restricted_unqualified_terms",
    problems,
  );
  validateNonEmptyStringArray(
    policy.prohibited_claims,
    "terminology policy prohibited_claims",
    problems,
  );
  if (!nonEmpty(policy.record_check_disclaimer))
    problems.push("terminology policy record_check_disclaimer is required");
  return problems;
}

export function requiresWebVerification(record) {
  if (!isObject(record) || !Array.isArray(record.classCriteria)) return true;
  return record.classCriteria.some((criterion) => {
    if (!isObject(criterion) || criterion.decisive !== true) return false;
    return (
      criterion.status !== "satisfied" ||
      !Array.isArray(criterion.evidenceRefs) ||
      criterion.evidenceRefs.length === 0
    );
  });
}

export function validateClassificationRecord(record, policy) {
  const problems = [];
  const policyProblems = validateTerminologyPolicy(policy);
  if (policyProblems.length)
    return policyProblems.map(
      (problem) => `terminology policy invalid: ${problem}`,
    );
  if (!isObject(record)) return ["classification record must be a JSON object"];
  if (record.schema !== CLASSIFICATION_SCHEMA)
    problems.push(
      `classification record schema must be ${CLASSIFICATION_SCHEMA}`,
    );

  if (!isObject(record.subject))
    problems.push("classification record subject must be an object");
  else {
    if (!nonEmpty(record.subject.name))
      problems.push("classification record subject.name is required");
    if (!nonEmpty(record.subject.kind))
      problems.push("classification record subject.kind is required");
  }

  validateNonEmptyStringArray(
    record.observableMechanism,
    "classification record observableMechanism",
    problems,
  );
  if (!isObject(record.responsibilityBoundary))
    problems.push(
      "classification record responsibilityBoundary must be an object",
    );
  else {
    validateNonEmptyStringArray(
      record.responsibilityBoundary.owns,
      "classification record responsibilityBoundary.owns",
      problems,
    );
    validateNonEmptyStringArray(
      record.responsibilityBoundary.doesNotOwn,
      "classification record responsibilityBoundary.doesNotOwn",
      problems,
    );
  }
  if (!nonEmpty(record.domain))
    problems.push("classification record domain is required");
  if (!isObject(record.ontology))
    problems.push("classification record ontology must be an object");
  else {
    if (!nonEmpty(record.ontology.name))
      problems.push("classification record ontology.name is required");
    validateNonEmptyStringArray(
      record.ontology.sourceRefs,
      "classification record ontology.sourceRefs",
      problems,
    );
  }
  const candidateCategories = validateNonEmptyStringArray(
    record.candidateCategories,
    "classification record candidateCategories",
    problems,
  );
  if (record.localEvidenceInspected !== true)
    problems.push("classification record localEvidenceInspected must be true");

  const allowedSourceTypes = new Set(policy.allowed_source_types);
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  if (evidence.length === 0)
    problems.push(
      "classification record evidence must contain at least one entry",
    );
  const evidenceById = new Map();
  for (const item of evidence) {
    if (!isObject(item)) {
      problems.push("classification record evidence entry must be an object");
      continue;
    }
    const id = nonEmpty(item.id);
    if (!id) problems.push("classification record evidence id is required");
    else if (evidenceById.has(id))
      problems.push(`evidence id duplicated: ${id}`);
    else evidenceById.set(id, item);
    if (!new Set(["local", "web"]).has(item.origin))
      problems.push(`evidence ${id || "missing"} origin must be local or web`);
    if (!allowedSourceTypes.has(item.sourceType))
      problems.push(`evidence ${id || "missing"} sourceType is not allowed`);
    if (!nonEmpty(item.publisher))
      problems.push(`evidence ${id || "missing"} publisher is required`);
    if (!nonEmpty(item.title))
      problems.push(`evidence ${id || "missing"} title is required`);
    if (!isDateLike(item.accessedAt))
      problems.push(`evidence ${id || "missing"} accessedAt must be a date`);
    if (!nonEmpty(item.claim))
      problems.push(`evidence ${id || "missing"} claim is required`);
    if (item.origin === "web") {
      if (!isHttpsUrl(item.url))
        problems.push(`web evidence ${id || "missing"} url must use https`);
      if (nonEmpty(item.repositoryPath))
        problems.push(
          `web evidence ${id || "missing"} repositoryPath must be null`,
        );
    }
    if (item.origin === "local") {
      if (!isSafeRepositoryPath(item.repositoryPath))
        problems.push(
          `local evidence ${id || "missing"} repositoryPath must be a safe repository-relative path`,
        );
      if (!nonEmpty(item.revision))
        problems.push(`local evidence ${id || "missing"} revision is required`);
    }
  }

  const criteria = Array.isArray(record.classCriteria)
    ? record.classCriteria
    : [];
  if (criteria.length === 0)
    problems.push("classification record classCriteria is required");
  const criterionIds = new Set();
  const criterionStatuses = new Set(policy.criterion_statuses);
  for (const criterion of criteria) {
    if (!isObject(criterion)) {
      problems.push("classification criterion must be an object");
      continue;
    }
    const id = nonEmpty(criterion.id);
    if (!id) problems.push("classification criterion id is required");
    else if (criterionIds.has(id))
      problems.push(`classification criterion duplicated: ${id}`);
    criterionIds.add(id);
    if (!nonEmpty(criterion.description))
      problems.push(
        `classification criterion ${id || "missing"} description is required`,
      );
    if (typeof criterion.decisive !== "boolean")
      problems.push(
        `classification criterion ${id || "missing"} decisive must be boolean`,
      );
    if (!criterionStatuses.has(criterion.status))
      problems.push(
        `classification criterion ${id || "missing"} status is invalid`,
      );
    const refs = Array.isArray(criterion.evidenceRefs)
      ? criterion.evidenceRefs.map((ref) => nonEmpty(ref)).filter(Boolean)
      : [];
    if (criterion.decisive === true && refs.length === 0)
      problems.push(`decisive criterion ${id || "missing"} requires evidence`);
    for (const ref of refs)
      if (!evidenceById.has(ref))
        problems.push(
          `classification criterion ${id || "missing"} references unknown evidence: ${ref}`,
        );
    if (
      criterion.decisive === true &&
      criterion.status === "satisfied" &&
      refs.length > 0 &&
      refs.every(
        (ref) => evidenceById.get(ref)?.sourceType === "reputable_secondary",
      )
    )
      problems.push(
        `decisive criterion ${id || "missing"} cannot be established by secondary-only evidence`,
      );
  }

  for (const ref of record.ontology?.sourceRefs || [])
    if (!evidenceById.has(ref))
      problems.push(
        `classification ontology references unknown evidence: ${ref}`,
      );

  if (!isObject(record.webVerification))
    problems.push("classification record webVerification must be an object");
  else {
    if (typeof record.webVerification.required !== "boolean")
      problems.push("classification webVerification.required must be boolean");
    if (!WEB_VERIFICATION_STATUSES.has(record.webVerification.status))
      problems.push("classification webVerification.status is invalid");
    if (!nonEmpty(record.webVerification.reason))
      problems.push("classification webVerification.reason is required");
    const automaticallyRequired = requiresWebVerification(record);
    if (automaticallyRequired && record.webVerification.required !== true)
      problems.push(
        "web verification is required because decisive criteria lack support",
      );
    if (
      record.webVerification.required === true &&
      record.webVerification.status === "not_required"
    )
      problems.push("required web verification cannot be not_required");
    if (
      record.webVerification.required === false &&
      new Set(["blocked", "incomplete"]).has(record.webVerification.status)
    )
      problems.push(
        "blocked or incomplete web verification must be marked required",
      );
    if (record.webVerification.status === "completed") {
      const directWebEvidence = evidence.filter(
        (item) =>
          item?.origin === "web" &&
          DIRECT_WEB_SOURCE_TYPES.has(item.sourceType),
      );
      if (directWebEvidence.length === 0)
        problems.push(
          "completed web verification requires direct web evidence from an authoritative source class",
        );
    }
    if (new Set(["blocked", "incomplete"]).has(record.webVerification.status)) {
      if (
        !new Set(["uncertain", "not_established"]).has(
          record.classificationStatus,
        )
      )
        problems.push(
          "blocked or incomplete web verification requires uncertain or not_established classificationStatus",
        );
      if (nonEmpty(record.selectedCategory) || nonEmpty(record.selectedTerm))
        problems.push(
          "blocked or incomplete web verification cannot select a final category or term",
        );
    }
  }

  const classificationStatuses = new Set(policy.classification_statuses);
  if (!classificationStatuses.has(record.classificationStatus))
    problems.push("classification record classificationStatus is invalid");
  const termStatuses = new Set(policy.term_statuses);
  if (!termStatuses.has(record.termStatus))
    problems.push("classification record termStatus is invalid");

  if (record.classificationStatus === "established") {
    const decisive = criteria.filter(
      (criterion) => criterion?.decisive === true,
    );
    if (
      decisive.length === 0 ||
      decisive.some(
        (criterion) =>
          criterion.status !== "satisfied" ||
          !Array.isArray(criterion.evidenceRefs) ||
          criterion.evidenceRefs.length === 0,
      )
    )
      problems.push(
        "established classification requires every decisive criterion to be satisfied with evidence",
      );
    if (!nonEmpty(record.selectedCategory))
      problems.push("established classification selectedCategory is required");
    else if (!candidateCategories.includes(nonEmpty(record.selectedCategory)))
      problems.push(
        "established classification selectedCategory must be one of candidateCategories",
      );
    if (!nonEmpty(record.selectedTerm))
      problems.push("established classification selectedTerm is required");
    if (!nonEmpty(record.plainMeaning))
      problems.push("established classification plainMeaning is required");
    if (record.termStatus === "uncertain")
      problems.push(
        "established classification termStatus cannot be uncertain",
      );
  }

  if (
    new Set([
      "partially_supported",
      "unsupported",
      "contested",
      "uncertain",
      "not_established",
    ]).has(record.classificationStatus) &&
    (nonEmpty(record.selectedCategory) || nonEmpty(record.selectedTerm))
  )
    problems.push(
      `${record.classificationStatus} classification cannot select a final category or term`,
    );

  const sourcedFacts = validateNonEmptyStringArray(
    record.sourcedFacts,
    "classification record sourcedFacts",
    problems,
  );
  const inferences = validateNonEmptyStringArray(
    record.inferences,
    "classification record inferences",
    problems,
  );
  const factSet = new Set(sourcedFacts.map((item) => item.toLowerCase()));
  if (inferences.some((item) => factSet.has(item.toLowerCase())))
    problems.push(
      "classification record sourcedFacts and inferences must not contain the same statement",
    );

  const rejectedTerms = Array.isArray(record.rejectedTerms)
    ? record.rejectedTerms
    : [];
  if (rejectedTerms.length === 0)
    problems.push(
      "classification record rejectedTerms must contain at least one entry",
    );
  const rejectedNames = new Set();
  for (const rejected of rejectedTerms) {
    if (!isObject(rejected)) {
      problems.push(
        "classification record rejectedTerms entry must be an object",
      );
      continue;
    }
    const term = nonEmpty(rejected.term);
    if (!term || !nonEmpty(rejected.reason))
      problems.push(
        `classification record rejected term is incomplete: ${term || "missing"}`,
      );
    if (rejectedNames.has(term))
      problems.push(`classification record rejected term duplicated: ${term}`);
    rejectedNames.add(term);
  }

  validateNonEmptyStringArray(
    record.uncertainties,
    "classification record uncertainties",
    problems,
    { allowEmpty: record.classificationStatus === "established" },
  );
  if (
    record.classificationStatus !== "established" &&
    (!Array.isArray(record.uncertainties) || record.uncertainties.length === 0)
  )
    problems.push(
      "non-established classification must record at least one uncertainty",
    );

  const prohibitedClaims = policy.prohibited_claims.map((claim) =>
    claim.toLowerCase(),
  );
  for (const statement of collectStrings(record)) {
    const lower = statement.toLowerCase();
    const match = prohibitedClaims.find((claim) => lower.includes(claim));
    if (match)
      problems.push(
        `prohibited terminology claim found without a proven conformance profile: ${match}`,
      );
  }

  return problems;
}

export function formatProblems(problems) {
  if (!Array.isArray(problems) || problems.length === 0) return "No problems";
  return problems.map((problem) => `- ${problem}`).join("\n");
}

export { CLASSIFICATION_SCHEMA, POLICY_SCHEMA };
