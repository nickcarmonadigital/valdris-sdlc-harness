# Production Generative-AI Assurance Pack

- Status: research specification
- Research date: 2026-07-12
- Target: Valdris SDLC Harness
- Applies to: production AI features, RAG systems, agents, multi-agent workflows, model-powered automation, and AI-assisted engineering

## Bottom line

Valdris should implement generative-AI assurance as a cross-cutting profile over the existing 13 production-readiness layers, not as a fourteenth application layer.

The current repository has the right conceptual families in <code>docs/OPERATING_INTELLIGENCE_LAYER.md</code> and the right domain-pack intent in <code>docs/ENTERPRISE_PROOF_BANK.md</code>. It does not yet have executable assurance. The existing <code>uash.production-readiness.v1</code> gate accepts non-empty evidence strings and successful command-shaped objects; it does not verify that an evidence file exists, that its digest and subject match the current run, that it is fresh for the target environment, or that an AI-specific nested result passed. An AI feature can therefore be documented as "passed" without proving model, retrieval, tool, memory, safety, or production behavior.

The required maturity jump is:

<pre>
AI applicability and stakes classification
-> system and dependency inventory
-> legal/privacy and threat assessment
-> typed model/RAG/tool/memory contracts
-> offline and adversarial evaluation
-> release/canary decision
-> production traces, SLOs, cost and incidents
-> rollback, change control and decommissioning
</pre>

This design follows NIST's Govern, Map, Measure, Manage lifecycle and its emphasis on governance, provenance, pre-deployment testing, and incident disclosure; treats OWASP and MITRE ATLAS as threat catalogs; uses OpenTelemetry's GenAI conventions as the telemetry vocabulary; and uses official OpenAI, Anthropic, and Google guidance as implementation evidence rather than as universal policy. [NIST AI 600-1][S1] [OWASP LLM Top 10][S3] [OWASP Agentic Top 10][S4] [MITRE ATLAS][S6] [OpenTelemetry GenAI][S7]

## Source hierarchy and limitations

Use this precedence when sources conflict:

1. Applicable law and contractual obligations.
2. Organization risk policy and a commissioned risk appetite.
3. Normative standards and government risk frameworks.
4. Security threat catalogs and engineering standards.
5. Provider documentation and system/model cards.
6. The supplied PDFs as product intent and teaching material.

The supplied <code>1317.pdf</code> is directionally strong on goal loops, tests plus evals, trajectory review, context engineering, skills, tools, sandboxes, orchestration, memory, observability, economics, and human handoffs (especially pp. 10-18, 23-31, 37-45). It is a strategic paper, not a control specification. Its statistics and product claims should not become gates without independent evidence.

The 13 Tier-3 kits correctly identify broad enterprise topics on pp. 2-3 of each kit, but their final "AI Audit Prompt" pages mostly ask for basic or visually inspectable checks. Those prompts cannot establish enterprise readiness. "Sentry is connected," "CI exists," or "secrets use environment variables" are configuration observations, not proof of efficacy, isolation, resilience, or safe AI behavior. Valdris should preserve the 13-layer teaching model while replacing prompt-only pass/fail with typed evidence and deployment-context tests.

NIST AI RMF 1.0 is being revised, and the OpenTelemetry GenAI conventions are versioned and still evolving. Valdris must pin the source version used by each profile and run a scheduled framework-drift review rather than treating this document as timeless. [NIST AI RMF resources][S2] [OpenTelemetry GenAI repository][S7]

This document is engineering guidance, not legal advice. Jurisdiction, product role, and use case must be classified by qualified counsel where legal consequences are material.

## Assurance profiles

Every Valdris run must classify AI applicability. It must never infer "no AI impact" merely because no model file changed.

| Profile | Typical system | Minimum assurance |
|---|---|---|
| AI-0: AI-assisted engineering only | An agent helps write deterministic software, but no AI behavior ships | Normal SDLC proof, provenance of agent-made changes, code review and security checks; runtime AI gates are explicitly skipped |
| AI-1: bounded generation | Summarization, classification, drafting, extraction with no sensitive corpus and no action tools | Versioned model/prompt, functional and safety evals, structured output validation, observability and cost limits |
| AI-2: grounded or sensitive AI | RAG, enterprise knowledge, tenant data, user-facing recommendations, persistent memory | AI-1 plus corpus provenance, retrieval/groundedness evaluation, tenant ACL proof, privacy/retention, poisoning tests and incident plan |
| AI-3: agentic or consequential | Agents with write tools, code execution, transactions, multi-agent delegation, regulated/high-impact decisions | Full pack, threat model, least privilege, sandbox, scoped human approvals, trajectory evals, adaptive red team, canary, kill switch and rollback exercise |

The profile is a floor, not a legal classification. A seemingly simple classifier used in employment, credit, health, education, critical infrastructure, law enforcement, or another high-impact context may require AI-3 controls and a legal compliance pack. The EU AI Act, for example, requires lifecycle risk management for covered high-risk systems, automatic event logging, effective human oversight, and appropriate accuracy, robustness, and cybersecurity; it separately includes transparency duties for systems that interact with people. [EU AI Act, Articles 9, 12, 14, 15 and 50][S18]

### Automatic escalation triggers

Escalate at least one profile when any of these are true:

- personal, confidential, privileged, regulated, safety-critical, or tenant-separated data enters prompts, retrieval, fine-tuning, evals, logs, or memory;
- the model can mutate data, send communications, spend money, execute code, change permissions, publish content, or call a tool with a consequential side effect;
- untrusted external content can reach a model that also has a sensitive data source or action tool;
- a model output is used in a consequential human decision;
- multiple agents share memory, identity, tools, or delegation;
- a provider, model, prompt, retriever, embedding model, corpus, tool, memory policy, guardrail, or evaluator changes;
- production behavior cannot be deterministically replayed or rolled back.

## Canonical evidence model

### Evidence envelope

Every AI proof artifact must use a shared envelope. A path or prose assertion alone is not evidence.

~~~json
{
  "schema": "uash.ai-evidence.v1",
  "runId": "EXAMPLE-RUN-123",
  "taskId": "EXAMPLE-ISSUE-456",
  "generatedAt": "2026-07-12T15:00:00.000Z",
  "expiresAt": "2026-07-19T15:00:00.000Z",
  "environment": "staging",
  "status": "passed",
  "subject": {
    "repoCommit": "git-sha",
    "releaseId": "release-2026-07-12.1",
    "aiSystemId": "support-agent",
    "aiSystemVersion": "3.4.0",
    "model": "provider/model-immutable-version",
    "promptDigest": "sha256:...",
    "toolsetDigest": "sha256:...",
    "corpusDigest": "sha256:...",
    "indexDigest": "sha256:...",
    "memoryPolicyDigest": "sha256:..."
  },
  "producer": {
    "name": "valdris-ai-eval-gate",
    "version": "1.0.0",
    "command": "npm run ai:eval",
    "exitCode": 0
  },
  "controls": ["EVAL-01", "EVAL-02"],
  "dataClassification": "internal",
  "redactions": {
    "rawPromptsCaptured": false,
    "rawToolArgumentsCaptured": false,
    "policy": "observability/redaction-policy.json"
  },
  "findings": [],
  "artifacts": [
    {
      "path": "ai/evals/results.json",
      "schema": "uash.ai-eval-results.v1",
      "sha256": "sha256:..."
    }
  ]
}
~~~

### Required artifact set

| Artifact | Schema | Required when | Purpose |
|---|---|---|---|
| <code>ai/system-profile.json</code> | <code>uash.ai-system-profile.v1</code> | Every run | AI profile, intended use, prohibited use, actors, impacts, data, autonomy, legal flags |
| <code>ai/inventory.json</code> | <code>uash.ai-inventory.v1</code> | AI-1+ | Models, providers, prompts, guardrails, tools, datasets, corpora, indexes, memories, agents and evaluators |
| <code>ai/risk-assessment.json</code> | <code>uash.ai-risk-assessment.v1</code> | AI-1+ | NIST risk mapping, severity/likelihood, risk owner, treatment and residual risk |
| <code>ai/threat-model.json</code> | <code>uash.ai-threat-model.v1</code> | AI-2+; AI-1 if external input | OWASP/MITRE attack paths, trust boundaries, sources, sinks and mitigations |
| <code>ai/evals/plan.json</code> | <code>uash.ai-eval-plan.v1</code> | AI-1+ | Dataset, slices, metrics, thresholds, evaluator, confidence and failure policy |
| <code>ai/evals/results.json</code> | <code>uash.ai-eval-results.v1</code> | AI-1+ | Instance and aggregate outcomes tied to an exact system version |
| <code>ai/trajectory/trace.jsonl</code> | <code>uash.ai-trajectory-event.v1</code> | Agentic/multi-step systems | Ordered decisions, tools, approvals, retries, budgets and stop reason |
| <code>ai/rag/manifest.json</code> | <code>uash.ai-rag-manifest.v1</code> | RAG/grounding | Corpus/index provenance, ACL, retention, ingestion, retrieval and citation contract |
| <code>ai/rag/results.json</code> | <code>uash.ai-rag-results.v1</code> | RAG/grounding | Retrieval, groundedness, attribution, completeness and abstention results |
| <code>ai/tools/registry.json</code> | <code>uash.ai-tool-registry.v1</code> | Tool use | Schemas, identities, scopes, risk, approval, idempotency, rollback and owner |
| <code>ai/memory/policy.json</code> | <code>uash.ai-memory-policy.v1</code> | Persistent/shared memory | Purpose, scope, provenance, write rules, ACL, TTL, deletion and poisoning controls |
| <code>ai/observability/proof.json</code> | <code>uash.ai-observability.v1</code> | AI-1+ in production | Trace coverage, redaction, dashboards, SLOs, alerts and feedback route |
| <code>ai/cost/ledger.json</code> | <code>uash.ai-cost-ledger.v1</code> | AI-1+ | Token, request, tool, storage, cache, human-review and provider-cost evidence |
| <code>ai/release/promotion.json</code> | <code>uash.ai-promotion.v1</code> | Production promotion | Exact candidate, baseline comparison, approvals, canary, rollback and kill switch |
| <code>ai/incidents/plan.json</code> | <code>uash.ai-incident-plan.v1</code> | AI-2+ | Detection, containment, evidence preservation, notification, recovery and exercise |
| <code>ai/assurance.json</code> | <code>uash.ai-assurance.v1</code> | Every run | Verified roll-up of all applicable controls and nested evidence |

### Eval result contract

An eval pass is meaningful only when its subject, data, method, thresholds, and uncertainty are explicit.

~~~json
{
  "schema": "uash.ai-eval-results.v1",
  "runId": "EXAMPLE-RUN-123",
  "generatedAt": "2026-07-12T15:00:00.000Z",
  "environment": "staging",
  "status": "passed",
  "subject": {
    "aiSystemVersion": "3.4.0",
    "model": "provider/model-immutable-version",
    "promptDigest": "sha256:...",
    "toolsetDigest": "sha256:...",
    "corpusDigest": "sha256:..."
  },
  "dataset": {
    "id": "support-golden-v7",
    "sha256": "sha256:...",
    "sampleCount": 1400,
    "holdout": true,
    "contaminationReviewed": true,
    "slices": ["language", "tenant", "intent", "risk", "adversarial"]
  },
  "evaluator": {
    "type": "deterministic+model+human-calibrated",
    "version": "grader-v4",
    "promptDigest": "sha256:...",
    "humanCalibrationSet": "calibration-v3",
    "agreement": 0.86
  },
  "metrics": [
    {
      "name": "task_success",
      "direction": "higher_is_better",
      "value": 0.94,
      "threshold": 0.92,
      "confidenceInterval95": [0.925, 0.951],
      "passed": true
    },
    {
      "name": "unsafe_tool_attempt_rate",
      "direction": "lower_is_better",
      "value": 0.0,
      "threshold": 0.0,
      "passed": true
    }
  ],
  "sliceFailures": [],
  "regressions": [],
  "failedCaseArtifact": "ai/evals/failures.jsonl"
}
~~~

Do not impose one universal hallucination, groundedness, or safety threshold across products. Thresholds must follow intended use, consequence, baseline, representative slices, and risk appetite. NIST explicitly calls for measurement in deployment-like conditions and evaluation of the validity and error of the metrics themselves. Google similarly documents calibrating model judges against human ratings rather than assuming the judge is ground truth. [NIST AI 600-1, Measure 2.3 and 2.13][S1] [Google judge-model evaluation][S16]

### Gate verification rules

Every executable AI gate must:

1. Resolve artifact paths inside the authorized artifact root and reject traversal, symlinks escaping the root, and arbitrary absolute paths.
2. Verify file existence, parseability, exact supported schema, and schema version.
3. Recompute SHA-256 and match the declared digest.
4. Match <code>runId</code>, repository commit, release, environment, and every applicable subject version.
5. Enforce freshness/expiry based on artifact type and deployment risk.
6. Verify nested referenced artifacts recursively, with cycle detection.
7. Reject <code>passed</code> when a required metric, slice, adverse case, approval, or rollback field is missing.
8. Reject a metric when direction, threshold, value, sample count, and evaluator version are absent.
9. Treat <code>failed</code>, <code>blocked</code>, <code>pending</code>, <code>needs_approval</code>, unknown status, and schema drift as blocking.
10. Allow <code>skipped</code> only when applicability is explicitly false, a specific reason is recorded, and no escalation trigger contradicts the skip.
11. Emit the verified result into <code>ai/assurance.json</code>; never promote from an unverified prose summary.
12. Link the AI roll-up from <code>proof/proof.json</code> and each affected entry in <code>production/layer-assessment.json</code>.

## Cited control catalog

Control status should be <code>passed</code>, <code>failed</code>, <code>blocked</code>, <code>needs_approval</code>, or <code>skipped</code>. "Documented" is not a passing status unless the control itself is a documentation control and the document's integrity and owner are verified.

### Governance, inventory and risk

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| GOV-01 | Define intended purpose, users, affected people, expected benefit, prohibited uses, reasonably foreseeable misuse, decision impact and deployment context. | <code>ai/system-profile.json</code> with accountable owner | NIST Map 1.1 and EU AI Act lifecycle risk model [S1][S18] |
| GOV-02 | Name risk, product, security, privacy, data, evaluation, operations and rollback owners; define approval and escalation SLAs. | Owner map and approval policy | NIST Govern 2.1; ISO/IEC 42001 management-system approach [S1][S20] |
| GOV-03 | Maintain an AI inventory/AIBOM for models, providers, prompts, tools, agents, datasets, corpora, indexes, memories, guardrails and evaluators, including versions and dependencies. | <code>ai/inventory.json</code>, SBOM/AIBOM digest | NIST Govern 1.6; OWASP supply-chain and Agentic ASI04 [S1][S3][S4] |
| GOV-04 | Classify applicable laws, contracts, provider terms, privacy, copyright, residency, records, accessibility, sector and high-impact obligations before build/promotion. | Legal applicability record, counsel owner where material | NIST Govern 1.1; EU AI Act; GDPR [S1][S18][S19] |
| GOV-05 | Perform provider and component due diligence: data use/retention, region, security, model/system card, incident/change notice, SLA, portability, fallback and exit. | Vendor assessment and approved-provider entry | NIST Govern 6.1/6.2 and Manage 3.1 [S1] |
| GOV-06 | Define transparency, disclosure, citation, limitation, appeal, correction, override and human-handoff behavior. | UX policy plus tests/screenshots | NIST information integrity and Human-AI Configuration; EU AI Act Articles 14 and 50 [S1][S18] |
| GOV-07 | Train operators and reviewers for the system, its limitations, approvals, incidents and evidence interpretation. | Role-specific training record | EU AI Act Article 4; NIST Govern 2.1 [S18][S1] |
| GOV-08 | Reassess risk after model, prompt, RAG, tool, memory, guardrail, evaluator, provider or use-case change. | Change trigger and new risk/eval artifacts | NIST Manage 3.1-003 explicitly calls for reassessment after fine-tuning or RAG [S1] |

### Data, privacy and provenance

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| DATA-01 | Record source, ownership/license, consent/legal basis, collection time, classification, geography, transformation, checksum and downstream uses for training, fine-tuning, RAG and eval data. | Versioned dataset/corpus manifest | NIST provenance and value-chain controls [S1] |
| DATA-02 | Minimize data and define purpose, retention, deletion, rectification and backup propagation; do not put secrets or unnecessary PII into prompts, logs, evals or memory. | Data-flow map, retention/deletion test | GDPR Article 5 data minimization and storage limitation; NIST Data Privacy [S19][S1] |
| DATA-03 | Enforce tenant/user ACLs at storage and retrieval, not only through prompt instructions. | Negative authorization tests across corpus, vector store, memory and cache | OWASP LLM02/LLM08 and ASI03/ASI06 [S3][S4] |
| DATA-04 | Quarantine and validate newly ingested or user-contributed content; detect malformed content, instruction-like payloads, secrets, malware and duplicates; preserve provenance/taint. | Ingestion test results and quarantine log | OWASP LLM04/LLM08; MITRE RAG and agent-context poisoning techniques [S3][S6] |
| DATA-05 | Separate development, evaluation and production data; protect holdouts against contamination and unauthorized access. | Environment ACL proof, dataset digests and contamination review | NIST TEVV/data provenance [S1] |
| DATA-06 | Track deletion, rectification, source expiry, revocation and re-index completion end to end. | Deletion test showing source, chunks, vectors, caches and memory removed/invalidated | NIST Manage 4.1; GDPR accuracy/storage limitation [S1][S19] |

### Model, prompt and output

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| MODEL-01 | Pin or record the immutable requested and actual response model, provider, region, parameters, context limits, prompt digest, guardrails and fallback order. | Model manifest and request/response trace | NIST inventory/value chain; OpenTelemetry request/response model attributes [S1][S7] |
| MODEL-02 | Select models against a quality baseline; use smaller/cheaper models only after they meet the commissioned eval threshold. | Baseline comparison with cost/latency | OpenAI recommends establishing eval performance, then optimizing cost/latency [S9] |
| MODEL-03 | Review provider model/system cards, capability limits, safety evaluations, data controls and known unsupported uses. | Dated provider review with source versions | NIST Manage 3.1-005 [S1] |
| MODEL-04 | Define timeouts, maximum output, retries, fallback behavior, graceful degradation and behavior when the provider is unavailable or safety-blocks. | Fault-injection and fallback results | NIST Manage 2.4/6.2; OWASP LLM10 [S1][S23] |
| PROMPT-01 | Version system/developer prompts and policy templates as code; enforce instruction trust hierarchy and keep untrusted retrieved/tool content in data channels. | Prompt registry, digest and injection tests | OpenAI instruction-hierarchy research and prompt-injection guidance [S10][S11] |
| PROMPT-02 | Do source-sink analysis: untrusted content must not silently authorize a sensitive sink such as data exfiltration, navigation, communication, write, purchase or code execution. | Threat model with source/sink cases and approval tests | OpenAI prompt-injection defense; Anthropic browser-agent defense [S10][S13] |
| OUTPUT-01 | Treat model output as untrusted. Parse against a strict schema, validate types/ranges/identifiers and safely encode for the destination. Never execute generated code/SQL/HTML/shell without a separate policy boundary. | Negative parser/injection tests | OWASP LLM05 and ASI05 [S3][S4] |
| OUTPUT-02 | For factual or consequential responses, expose uncertainty, sources, limitations and an abstain/escalate path; verify citations against retrieved evidence. | Groundedness/citation/abstention eval | NIST Confabulation and Information Integrity; Google groundedness contract [S1][S17] |

### RAG and grounding

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| RAG-01 | Version the full retrieval subject: source documents, chunker, transformations, embedding model, vector/index configuration, filters, retriever, reranker and query rewrite. | <code>ai/rag/manifest.json</code> and digests | NIST Map 1.1/2.2 and Manage 3.1-003 [S1] |
| RAG-02 | Apply authorization filters before candidate documents enter model context; prove cross-tenant and cross-role isolation with negative tests. | ACL test matrix and traces | OWASP LLM08 and sensitive disclosure [S3] |
| RAG-03 | Evaluate retrieval independently using representative queries and relevance judgments. Include recall/coverage, ranking quality, zero-result rate and per-slice results. | Retrieval dataset and <code>ai/rag/results.json</code> | NIST TREC RAG separates retrieval, augmented generation and full-RAG evaluation [S21] |
| RAG-04 | Evaluate generation separately for groundedness/faithfulness, citation attribution, answer completeness, contradiction, uncertainty and abstention. | Instance-level evidence and aggregate/slice metrics | NIST source/citation verification; Google groundedness and eval results [S1][S17][S15] |
| RAG-05 | Red-team direct and indirect prompt injection, poisoned documents, stale/revoked sources, malicious metadata, hidden content, conflicting sources and retrieval denial. | Adversarial corpus and attack-success metrics | OWASP LLM01/04/08, ASI01/06; MITRE RAG poisoning and credential harvesting [S3][S4][S6] |
| RAG-06 | Define freshness SLOs and invalidation for source changes, permissions, deletions, index rebuilds and caches. | Staleness dashboard, invalidation and deletion tests | NIST provenance/monitoring; GDPR accuracy/retention [S1][S19] |
| RAG-07 | Preserve source identity and claim-level attribution in the user experience; citations must resolve to content the current user is authorized to view. | Citation resolution and ACL tests | NIST Information Integrity; Google grounding chunks include source metadata [S1][S17] |

### Tools, agents and multi-agent systems

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| TOOL-01 | Register each tool with owner, version, strict input/output schema, side effects, data classification, identity, scopes, timeout, rate/cost limit and allowed environments. | <code>ai/tools/registry.json</code> | OpenAI well-defined tool guidance; OWASP excessive agency [S9][S3] |
| TOOL-02 | Use deterministic authorization outside the model, least privilege, short-lived credentials and per-user/tenant delegation. The model never grants itself permission. | IAM diff and negative authorization tests | OWASP LLM06 and ASI03; Anthropic trustworthy-agent guidance [S3][S4][S14] |
| TOOL-03 | Classify tools as read, reversible write, irreversible/destructive, external transmission, financial or code execution. Require scoped, fresh human approval for Red Zone calls. | Approval artifact bound to exact tool/arguments/subject | OpenAI tool-risk and human-intervention guidance; OWASP ASI02/05 [S9][S4] |
| TOOL-04 | Prefer preview/dry-run, idempotency keys, bounded targets, transactional writes, verification and compensating actions. | Duplicate/retry and rollback tests | OWASP excessive agency/cascading failures [S3][S4] |
| TOOL-05 | Sandbox code and computer use with explicit filesystem roots, egress allowlists, secret isolation, resource limits and cleanup; prove attempted escapes are blocked. | Sandbox policy and adversarial escape tests | OWASP ASI05; OpenAI coding-agent sandbox/approval practice [S4][S12] |
| TOOL-06 | Treat MCP/A2A servers, tool descriptions, agent cards, tool output and peer messages as supply-chain and trust-boundary inputs; authenticate peers and pin/approve dependencies. | Server/agent inventory, signatures/attestation and spoofing tests | OWASP ASI04/07/10; MITRE agent tool and configuration techniques [S4][S6] |
| AGENT-01 | Bind every run to a goal, allowed scope, success criteria, stop conditions, max turns/time/tokens/cost/tool calls/retries and escalation path. | System profile plus trajectory stop event | OpenAI agent loop/exit and human intervention; OWASP LLM10 [S9][S23] |
| AGENT-02 | Evaluate the trajectory, not only the final answer: tool choice, argument validity, permissions, ordering, retries, delegation, approvals, stop behavior and forbidden sequences. | <code>ai/trajectory/trace.jsonl</code> and trajectory graders | Google agent eval includes tool-use quality and traces; OWASP Agentic risks [S15][S4] |
| AGENT-03 | Bound multi-agent delegation depth/fan-out, authenticate agents, isolate identities and memories, validate handoffs, detect loops/cascades and retain end-to-end causality. | Multi-agent graph and adversarial handoff tests | OWASP ASI07/08/10; MITRE Agentic AI matrix [S4][S6] |
| AGENT-04 | Make human control real: show proposed high-risk action and relevant data, allow denial/modify/cancel, prevent approval fatigue, and record who approved what. | UX proof and approval audit | Anthropic human-control principles; OWASP ASI09 [S14][S4] |

### Memory

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| MEM-01 | Classify session, episodic, semantic, procedural and shared memory by purpose, owner, subject, tenant, classification, consent/legal basis, TTL and retrieval scope. | <code>ai/memory/policy.json</code> | NIST Data Privacy/Human-AI Configuration; GDPR purpose/retention [S1][S19] |
| MEM-02 | Attach provenance, creation actor, source digest, trust/taint, timestamp and policy version to every durable memory item. | Memory record schema and provenance tests | NIST provenance; OWASP ASI06 [S1][S4] |
| MEM-03 | Gate durable writes. Untrusted content, tool output and peer-agent messages cannot directly become trusted memory; quarantine or require validation/approval. | Poisoning tests and quarantine logs | OWASP ASI06 and MITRE agent-context poisoning [S4][S6] |
| MEM-04 | Enforce ACLs on both write and retrieval; prevent cross-user/tenant/agent leakage and privilege carryover. | Negative isolation tests | OWASP ASI03/06/07 [S4] |
| MEM-05 | Support correction, deletion, expiry, conflict resolution and invalidation of derived summaries/embeddings/caches; never retain secrets by default. | End-to-end delete/expiry tests | GDPR Article 5; NIST Manage 4.1 [S19][S1] |
| MEM-06 | Evaluate relevance, stale-memory use, poisoning, leakage, overload and incorrect personalization before promotion and continuously in production. | Memory-specific eval suite and alerts | OWASP ASI06/08; Anthropic warns that open environments require layered defenses [S4][S14] |

### Evaluation, safety and security

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| EVAL-01 | Build an eval plan from real tasks, failures, misuse and risk cases, with representative and adversarial slices, before changing behavior. | <code>ai/evals/plan.json</code> | NIST pre-deployment TEVV; OpenAI and Google eval systems [S1][S22][S15] |
| EVAL-02 | Combine deterministic checks, reference-based metrics, calibrated model graders and human review. Do not let one model judge be the sole release authority for high-stakes behavior. | Evaluator manifest and human calibration | NIST Measure 2.13; Google judge calibration [S1][S16] |
| EVAL-03 | Report sample size, metric direction, threshold, confidence/variance, slice results, failed cases and regression against the current production baseline. | <code>ai/evals/results.json</code> | NIST deployment-context measurement and construct validity [S1] |
| EVAL-04 | Test final-response quality and the process: tool use, hallucination/confabulation, safety, permissions, handoffs, stop conditions and recovery. | Functional plus trajectory evals | Google agent evaluation exposes response, tool, hallucination and safety metrics with traces [S15] |
| SAFE-01 | Define harm/abuse policy for the actual domain, including disallowed content/actions, protected groups, vulnerable users, self-harm, fraud, cyber, privacy and information integrity where applicable. | Risk assessment and policy tests | NIST GAI risk catalog [S1] |
| SAFE-02 | Layer deterministic constraints, authentication/authorization, input/output filters, model guardrails, tool controls, sandbox, monitoring and human intervention. No single prompt-injection classifier is sufficient. | Control map and bypass tests | OpenAI and Anthropic both describe defense in depth and prompt injection as unresolved [S10][S13][S14] |
| SAFE-03 | Conduct pre-deployment and periodic red teaming with domain and security expertise, including adaptive multi-turn attacks and deployment-realistic tools/data. | Red-team plan, attack-success rate and remediations | NIST adversarial testing/red-team guidance; Anthropic adaptive testing [S1][S13] |
| SEC-01 | Threat-model against current OWASP LLM and Agentic Top 10 plus relevant MITRE ATLAS tactics/techniques; record applicable/not-applicable with reasons. | <code>ai/threat-model.json</code> | OWASP and MITRE [S3][S4][S6] |
| SEC-02 | Verify AI supply chain: packages, models, adapters, prompts, skills, MCP servers, datasets and indexes; pin versions, scan, sign/attest where possible and monitor advisories. | SBOM/AIBOM, signatures and vulnerability results | OWASP LLM03/ASI04; NIST value chain [S3][S4][S1] |
| SEC-03 | Protect secrets and credentials from prompts, context, tools, logs, traces, memory and outputs; use secret brokers/short-lived credentials and egress controls. | Secret scan, redaction and exfiltration tests | OWASP LLM02/ASI03; MITRE credential/exfiltration techniques [S3][S4][S6] |
| SEC-04 | Establish AI incident detection, containment, kill switch, evidence retention, notification, recovery, postmortem and regression capture; exercise it. | <code>ai/incidents/plan.json</code> and tabletop result | NIST incident disclosure and Manage 4.2/4.3 [S1] |

### Observability, cost and lifecycle

| ID | Requirement | Minimum evidence | Primary basis |
|---|---|---|---|
| OBS-01 | Emit end-to-end traces for model inference, retrieval, agent invocation, workflows and tool execution using a pinned OpenTelemetry GenAI schema version. | Trace sample and coverage report | OpenTelemetry GenAI spans/metrics/events [S7][S8] |
| OBS-02 | Record low-cardinality operational attributes such as operation, provider, requested/response model, agent/tool identity, error type, duration and token usage. Raw instructions/messages/tool arguments/results are opt-in and redacted. | Redaction policy and trace inspection | OpenTelemetry marks content capture as opt-in and defines model/tool/usage fields [S7] |
| OBS-03 | Define SLOs and alerts for availability, latency/TTFT, provider errors, rate limits, token/cost, tool denial/failure, loop depth, retrieval zero-result/staleness, safety blocks, injection signals, groundedness drift and escalation. | Dashboard/alert queries plus test alerts | NIST post-deployment monitoring; OpenTelemetry metrics [S1][S8] |
| OBS-04 | Preserve run, user/tenant pseudonym, agent, model, prompt, corpus, toolset, approval and release correlation without exposing unnecessary content. | Correlated trace and privacy review | NIST incident/provenance requirements; GDPR minimization [S1][S19] |
| OBS-05 | Provide user/operator feedback, correction, appeal and issue escalation; feed confirmed failures into the eval regression set. | Feedback route and closed-loop example | NIST Measure 3.3 and Manage 4.1 [S1] |
| COST-01 | Budget per request/run/user/tenant/day and cap input/output tokens, turns, retries, tool calls, queued work, wall time and concurrency. | <code>ai/cost/ledger.json</code> and limit tests | OWASP LLM10 denial-of-wallet; OpenAI agent stop conditions [S23][S9] |
| COST-02 | Track actual provider usage, cache tokens, storage/vector costs, tool costs and human review; allocate cost to release/tenant/use case. | Usage-to-invoice reconciliation sample | OpenTelemetry token usage; NIST environmental/resource considerations [S8][S1] |
| COST-03 | Rate limit and quota by authenticated principal and expensive operation; use circuit breakers, backpressure and graceful degradation. | Load/abuse test and alert | OWASP LLM10 [S23] |
| COST-04 | Route models for cost/latency only after quality/safety parity is proven; re-evaluate fallback models and provider failover. | Baseline/candidate/fallback eval matrix | OpenAI model-selection guidance; NIST rollover/fallback testing [S9][S1] |
| LIFE-01 | Maintain lifecycle state: proposed, sandboxed, evaluated, approved, canary, production, restricted, rolled_back, retired. | Registry state and transition audit | NIST lifecycle management and decommissioning; ISO Plan-Do-Check-Act [S1][S20] |
| LIFE-02 | Promotion must bind exact model/prompt/tool/corpus/index/memory/guardrail/evaluator versions to passed evidence and an owner decision. | <code>ai/release/promotion.json</code> | NIST pre-deployment testing and go/no-go evidence [S1] |
| LIFE-03 | Canary on bounded traffic/data/tools with success, safety and cost thresholds; support immediate disable and tested rollback. | Canary result, kill-switch and rollback exercise | NIST Manage 2.4 and 4.1 [S1] |
| LIFE-04 | Monitor provider/model/corpus/user behavior drift and emerging attacks; define triggers for restriction, re-eval or rollback. | Drift dashboard and response test | NIST post-deployment monitoring; MITRE ATLAS living threat base [S1][S6] |
| LIFE-05 | Decommission safely: disable access/identities, archive required evidence, delete data/memory/indexes per policy, notify dependencies/users and test that traffic cannot reach the retired system. | Decommission checklist and negative route test | NIST Govern 1.7 [S1] |

## Detailed implementation requirements

### RAG gate

The RAG gate must fail closed unless all applicable stages pass:

1. Corpus admission: source rights, classification, owner, ACL, effective dates, checksum and deletion path.
2. Ingestion: quarantine, malware/secret/instruction-like content checks, transformations and chunk provenance.
3. Index: embedding and index versions, tenant filters, rebuild and invalidation behavior.
4. Retrieval: representative relevance judgments; top-k recall/coverage and ranking metric; zero-result and latency by slice.
5. Generation: groundedness/faithfulness, attribution/citation correctness, completeness, contradiction, uncertainty and abstention.
6. Adversarial: direct/indirect injection, poisoned source, malicious metadata, conflicting evidence, cross-tenant request and stale/revoked content.
7. Operations: freshness SLO, index/corpus drift, permission and deletion propagation, traces and cost.

NIST's TREC RAG program is useful because it treats retrieval, augmented generation, and the full RAG pipeline as separable tasks and evaluates relevance, completeness and attribution rather than collapsing everything into a single "answer quality" score. [NIST TREC RAG][S21]

### Model and prompt gate

The model gate must compare an exact candidate against the current production baseline and all configured fallbacks. Required slices include normal, ambiguous, unsupported, adversarial, high-risk, long-context, multilingual and domain-specific cases when relevant. A model alias change without an immutable response-model record is a blocking provenance gap.

Prompt changes are behavior changes. Store prompts and policy templates by digest, test instruction conflicts and indirect injection, and ensure untrusted tool/retrieval content is never represented as system/developer authority. Stronger model behavior can reduce attack success but cannot replace permissions, sandboxing, approvals or monitoring. OpenAI and Anthropic both explicitly treat prompt injection as an ongoing security problem rather than solved input classification. [OpenAI prompt-injection design][S10] [Anthropic prompt-injection defenses][S13]

### Tool and approval gate

The tool gate must evaluate authorization independently of model intent. For every call:

- bind the human/user principal, agent identity, tool version, exact arguments digest, target resources and approval requirement;
- validate arguments against a strict schema and destination policy;
- apply deterministic authorization and tenant rules;
- set timeout, retries, idempotency, rate/cost limits and output-size bounds;
- classify output trust and redact secrets before returning it to the model;
- emit start/result/denial/error trace events;
- verify postconditions and execute a compensating action when supported.

Approval is not a generic "yes." It must be scoped to the exact action and expire. Replaying an approval for different arguments, a different release, a different target or after a policy change must fail.

### Memory gate

Memory must be treated as a database and an attack surface, not as an append-only prompt convenience. Durable writes require a known actor, purpose, tenant/subject, source, trust state, TTL and policy. Retrieved memory must be authorized for the active principal and marked as data, not instruction. Poisoned or disputed memory must be quarantinable without destroying incident evidence. Deletion must cover the canonical record and derived summaries, embeddings, indexes and caches.

### Safety and evaluator gate

Release evaluation should use:

- deterministic assertions for schemas, permissions, prohibited calls, citations and invariants;
- reference-based metrics where ground truth exists;
- model graders for scalable semantic judgments;
- human calibration and review for ambiguous/high-impact cases;
- adversarial and multi-turn scenario evaluation;
- production sampling after release.

Store failed cases, not just aggregate scores. Averages cannot hide a critical slice failure. A zero-tolerance invariant such as "no unauthorized tool call" blocks even when overall task success improves.

Model graders require their own version, prompt digest, calibration set and agreement/quality evidence. Google documents both agent-specific metrics with traces and a process for comparing judge outputs to human ground truth. OpenAI's Evals API similarly treats the data schema and testing criteria as explicit versionable objects. [Google agent evaluation][S15] [Google judge evaluation][S16] [OpenAI Evals API][S22]

### Observability profile

Use the pinned OpenTelemetry GenAI schema available at commissioning time. At minimum, instrument:

- inference/chat/generation and embedding operations;
- retrieval operations;
- agent and workflow invocation;
- tool execution;
- errors, timeouts, rate limits and safety/approval denial;
- token usage, duration, time to first chunk and cost-derived metrics;
- evaluation events and release identifiers.

Recommended correlation:

<pre>
service trace
  -> user/task/run/release
  -> agent/workflow invocation
  -> retrieval spans
  -> model inference spans
  -> tool execution spans
  -> approval and policy-decision events
  -> eval/feedback/incident link
</pre>

Never enable raw prompt, message, retrieved-document, tool-argument or tool-result capture by default. Those fields can contain personal data, secrets, proprietary content and attacker payloads. Capture them only with an explicit purpose, access policy, retention period, redaction and jurisdiction review. OpenTelemetry's conventions expose content fields as opt-in for this reason. [OpenTelemetry GenAI repository][S7]

### Cost and denial-of-wallet profile

Cost is both FinOps and security. The run budget must include input/output/cache tokens, model calls, embeddings, reranking, vector queries/storage, tools, retries, agent fan-out, human review and provider egress where material.

Hard controls:

- maximum request and context size;
- maximum generated tokens;
- maximum turns, tool calls, delegation depth/fan-out and queued actions;
- per-principal request/token/tool quotas;
- wall-clock and per-call timeout;
- retry budget with exponential backoff and no unbounded self-heal loop;
- daily/tenant/project spend ceiling and alert;
- circuit breaker and graceful degradation;
- cost-quality eval before model routing changes.

OWASP classifies uncontrolled inference as unbounded consumption and explicitly includes denial-of-wallet, service degradation and model-extraction risk. [OWASP LLM10][S23]

## Lifecycle gate DAG

| Gate | Blocks on | Required outputs |
|---|---|---|
| AI-G0 Classify | Missing AI profile, unclear use/impact, contradictory skip | <code>ai/system-profile.json</code> |
| AI-G1 Govern | Missing owner, inventory, legal/privacy profile, prohibited-use policy | inventory, owner map, applicability |
| AI-G2 Threat | Missing trust boundaries or OWASP/MITRE applicability for AI-2/3 | threat model, mitigations, residual risk |
| AI-G3 Data/RAG | Missing provenance, ACL, deletion, retrieval or groundedness evidence | corpus/index manifest and RAG results |
| AI-G4 Behavior | Missing representative dataset, thresholds, slices, evaluator validity or regression pass | eval plan/results and failures |
| AI-G5 Agency | Unsafe/unregistered tools, unbounded loop, bad trajectory, memory gap, approval gap | tool registry, trajectory, memory proof |
| AI-G6 Safety/Security | Blocking safety case, injection/exfiltration/RCE path, supply-chain gap, failed red team | red-team/security evidence |
| AI-G7 Operability | No traces/SLOs/alerts, privacy-unsafe telemetry, unbounded cost | observability proof and cost ledger |
| AI-G8 Promote | Subject mismatch, stale evidence, absent canary/rollback/kill switch or human Red Zone approval | promotion artifact |
| AI-G9 Operate | SLO/safety/cost breach, incident, drift or feedback threshold | monitoring decision, incident/rollback/re-eval |
| AI-G10 Retire | Active credentials/routes/dependencies or incomplete retention/deletion | decommission proof |

### Red Zone actions

These actions require a human approval artifact even if an agent recommends them:

- production deployment/promotion of an AI-3 or legally high-impact system;
- granting or expanding agent/tool identity, permissions, filesystem/network roots or data access;
- enabling a destructive, financial, external-transmission, code-execution or cross-tenant tool;
- lowering a safety, security, authorization, groundedness or high-risk eval threshold;
- using sensitive production data for prompts, training, fine-tuning, evals, traces or memory outside an already approved policy;
- bypassing/quarantining a failed gate or accepting residual critical/high risk;
- changing legal classification, incident notification, retention hold or public disclosure;
- disabling monitoring, audit, kill switch, rollback or user recourse.

## Overlay on the 13 production layers

The AI pack does not replace any production layer. It changes what counts as proof inside each layer.

| Existing layer | AI assurance overlay | Required proof examples |
|---|---|---|
| 1. Frontend | AI disclosure, source/uncertainty display, safe rendering, correction/appeal, approval UX, accessibility and prevention of deceptive anthropomorphism/dark patterns | UI/e2e tests for disclosure, citations, denied approval, unsafe output encoding and human handoff |
| 2. Backend/API logic | Orchestrator state, structured output validation, policy enforcement, idempotency, source-sink boundary and provider failure handling | API contract/negative tests, tool authorization, loop-stop and fallback tests |
| 3. Database/storage | Dataset/corpus/index/memory/eval provenance, tenant isolation, retention, deletion, encryption and backups | manifests, ACL tests, deletion propagation, restore and integrity checks |
| 4. Auth/permissions/RLS | Human, agent, service and tool identities; delegated authorization; short-lived credentials; approval binding; tenant ACLs | IAM/RLS negative tests, expired/replayed approval denial, privilege escalation tests |
| 5. Hosting/deployment | Region/provider data handling, staging isolation, immutable release subject, canary, feature flag and rollback | promotion artifact, staged smoke, region/data-control review, kill-switch exercise |
| 6. Cloud/compute | Sandbox, egress, secret broker, model endpoint/GPU controls, workload isolation and resource caps | escape/exfiltration tests, network policy, quota/budget evidence |
| 7. CI/CD/version control | Version prompts/models/tools/corpora/evals as release inputs; run AI gates; sign/attest SBOM/AIBOM and promotion subject | CI eval/security results, digests, provenance, required human gate |
| 8. Security/RLS | OWASP LLM/Agentic and MITRE ATLAS threat model; injection, poisoning, supply chain, secret, output and code-execution defenses | threat model, adversarial/red-team results, dependency and secret scans |
| 9. Rate limiting | Request, token, context, tool, user/tenant, loop and spend quotas; denial-of-wallet protection | abuse/load test, circuit breaker, cost alert |
| 10. Caching/CDN | Prompt/response/embedding/retrieval cache privacy, tenant keying, provenance, invalidation and stale-policy behavior | cross-tenant cache tests, deletion/invalidation, cache-hit telemetry |
| 11. Load balancing/scaling | Provider quota, concurrency, queue/backpressure, multi-agent fan-out, cascade containment and graceful degradation | load/soak/failure test, max-depth/fan-out and failover results |
| 12. Error tracking/logs/observability | OpenTelemetry GenAI traces, redaction, model/prompt/tool/corpus correlation, behavior/safety/cost SLOs, user feedback and incidents | trace coverage, redaction inspection, dashboards/alerts, incident link |
| 13. Availability/recovery/DR | Provider/model fallback with eval parity, corpus/index/memory backup and rebuild, kill switch, rollback, manual fallback and decommission | failover and rollback exercise, restore/re-index RTO/RPO, retired-route denial |

Every affected production-layer entry should reference verified AI artifacts by path, schema and digest. Example:

~~~json
{
  "layer": "security",
  "status": "passed",
  "evidenceRefs": [
    {
      "path": "ai/threat-model.json",
      "schema": "uash.ai-threat-model.v1",
      "sha256": "sha256:..."
    },
    {
      "path": "ai/evals/results.json",
      "schema": "uash.ai-eval-results.v1",
      "sha256": "sha256:..."
    }
  ]
}
~~~

## What Valdris should build

### Phase 1 - contracts and gate trust

1. Add JSON Schemas for the evidence envelope and required artifact set.
2. Add <code>scripts/ai-profile-gate.mjs</code> and <code>scripts/ai-assurance-gate.mjs</code>.
3. Replace non-empty evidence acceptance with path, schema, digest, subject, freshness and nested-status verification.
4. Add AI applicability and profile fields to commissioning and <code>project-adapter.json</code>.
5. Make <code>proof/proof.json</code> and <code>production/layer-assessment.json</code> reference the verified AI roll-up.

### Phase 2 - executable domain gates

1. <code>scripts/ai-eval-gate.mjs</code> for dataset, evaluator, metrics, thresholds, confidence, slices and regressions.
2. <code>scripts/rag-gate.mjs</code> for manifest, ACL, retrieval, groundedness, citation and poisoning evidence.
3. <code>scripts/agent-trajectory-gate.mjs</code> for tool, approval, retry, budget, delegation and stop behavior.
4. <code>scripts/ai-tool-gate.mjs</code> and <code>scripts/ai-memory-gate.mjs</code>.
5. <code>scripts/ai-observability-gate.mjs</code> and <code>scripts/ai-cost-gate.mjs</code>.
6. Adversarial fixtures that prove fake, stale, mismatched, missing, replayed and path-escaping evidence is rejected.

### Phase 3 - promotion and operations

1. Add staged promotion, canary and rollback artifacts.
2. Export traces/events using a pinned OpenTelemetry GenAI schema.
3. Add dashboards for eval regression, injection/safety, tool actions, latency, token/cost, retrieval health and agent-loop health.
4. Add incident, feedback-to-regression and decommission workflows.
5. Schedule framework/provider/model drift reviews.

## Acceptance criteria for the pack

The implementation is complete only when a golden-path AI-3 reference application proves all of the following:

- every one of the 13 production layers is passed with verified typed evidence or skipped with a reason that survives contradiction checks;
- model, prompt, tools, corpus/index, memory policy, guardrails and evaluators are versioned and bound to the release;
- RAG retrieval and generation are evaluated separately, including ACL and poisoning cases;
- an agent trajectory demonstrates allowed tool use, a denied unauthorized tool call, a scoped human approval, budget stop and safe recovery;
- a malicious retrieved/tool payload cannot authorize an exfiltration or code-execution sink;
- raw sensitive content is absent from default traces while operations remain diagnosable;
- cost, latency, safety and availability limits trigger tested alerts/circuit breakers;
- canary, kill switch, rollback and provider failure are exercised;
- fake evidence, stale evidence, another run's evidence, a changed corpus/model/prompt/toolset, and an escaped artifact path all fail the gate;
- a production incident can be traced to the exact release subject, contained, rolled back and added to the regression set.

## Sources

### Authoritative and primary sources

[S1]: https://doi.org/10.6028/NIST.AI.600-1 "NIST AI 600-1 - Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile"
[S2]: https://www.nist.gov/itl/ai-risk-management-framework/ai-risk-management-framework-resources "NIST AI RMF resources"
[S3]: https://genai.owasp.org/llm-top-10/ "OWASP Top 10 for LLMs and Generative AI Applications 2025"
[S4]: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ "OWASP Top 10 for Agentic Applications 2026"
[S5]: https://genai.owasp.org/resources/ "OWASP GenAI Security resources and securing-agentic-applications guidance"
[S6]: https://atlas.mitre.org/ "MITRE ATLAS"
[S7]: https://github.com/open-telemetry/semantic-conventions-genai "OpenTelemetry GenAI Semantic Conventions"
[S8]: https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-metrics.md "OpenTelemetry GenAI metrics"
[S9]: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/ "OpenAI - A practical guide to building agents"
[S10]: https://openai.com/index/designing-agents-to-resist-prompt-injection/ "OpenAI - Designing AI agents to resist prompt injection"
[S11]: https://openai.com/index/instruction-hierarchy-challenge/ "OpenAI - Improving instruction hierarchy in frontier LLMs"
[S12]: https://openai.com/index/running-codex-safely/ "OpenAI - Running Codex safely at OpenAI"
[S13]: https://www.anthropic.com/research/prompt-injection-defenses "Anthropic - Mitigating the risk of prompt injections in browser use"
[S14]: https://www.anthropic.com/research/trustworthy-agents "Anthropic - Trustworthy agents in practice"
[S15]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/evaluate "Google Cloud - Evaluate agents"
[S16]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/evaluate-judge-model "Google Cloud - Evaluate a judge model"
[S17]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rpc/google.cloud.aiplatform.v1 "Google Cloud - Groundedness and grounding result API"
[S18]: https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en "Regulation EU 2024/1689 - Artificial Intelligence Act"
[S19]: https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj/eng "GDPR Article 5"
[S20]: https://www.iso.org/standard/42001 "ISO/IEC 42001:2023 AI management systems"
[S21]: https://pages.nist.gov/trec-browser/trec34/rag/overview/ "NIST TREC 2025 Retrieval-Augmented Generation track"
[S22]: https://platform.openai.com/docs/api-reference/evals "OpenAI Evals API"
[S23]: https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/ "OWASP LLM10:2025 Unbounded Consumption"

### Supplied source pack reviewed

- Operator-provided enterprise assurance source PDF, 51 pages; stable provenance is the `1317.pdf` entry in [`pdf-source-manifest.json`](pdf-source-manifest.json) under schema `valdris.pdf-audit-source-manifest.v1`.
- Layer 1: Frontend Foundations, Tier 3 Enterprise Kit.
- Layer 2: APIs and Backend Logic, Tier 3 Enterprise Kit.
- Layer 3: Database and Storage, Tier 3 Enterprise Kit.
- Layer 4: Authentication and Permissions, Tier 3 Enterprise Kit.
- Layer 5: Hosting and Deployment, Tier 3 Enterprise Kit.
- Layer 6: Cloud Compute, Tier 3 Enterprise Kit.
- Layer 7: CI/CD and Version Control, Tier 3 Enterprise Kit.
- Layer 8: Security and Row-Level Security, Tier 3 Enterprise Kit.
- Layer 9: Rate Limiting, Tier 3 Enterprise Kit.
- Layer 10: Caching and CDN, Tier 3 Enterprise Kit.
- Layer 11: Load Balancing and Scaling, Tier 3 Enterprise Kit.
- Layer 12: Error Tracking and Logs, Tier 3 Enterprise Kit.
- Layer 13: Availability and Recovery, Tier 3 Enterprise Kit.
