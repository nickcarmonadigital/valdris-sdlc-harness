# Enterprise Software and AI Assurance Control Model (2026)

Status: research baseline for Valdris; evidence date 2026-07-12

Scope: the 13 Valdris production layers plus cross-cutting software-supply-chain, privacy, accessibility, reliability, and generative-AI assurance

Decision: keep the 13 layers as routing facets, but do not treat them as a complete control framework or as independent pass/fail silos.

## Executive conclusion

The PDF set is a useful teaching map, not an enterprise certification standard. Its first pages frequently name real enterprise concerns, but its final “AI Audit Prompt” reduces those concerns to a handful of generic yes/no questions. Valdris currently preserves that same structural weakness: [`docs/PRODUCTION_READINESS_LAYER_PACK.md`](../../docs/PRODUCTION_READINESS_LAYER_PACK.md) defines the 13-row classification, and `scripts/production-layer-gate.mjs` proves that all 13 names are present and that a passed layer contains some non-empty evidence-shaped value, but it does not prove that the evidence exists, is fresh, is bound to the current commit/run/environment, was produced by a trustworthy tool, or satisfies any versioned external control.

The recommended 2026 model is therefore:

1. use the 13 layers for **applicability routing and ownership**;
2. select **version-pinned control profiles** based on workload, data, exposure, criticality, regulatory context, and AI use;
3. evaluate **atomic controls**, not a prose score for an entire layer;
4. accept only **typed, resolved, fresh, subject-bound evidence**;
5. represent waivers, compensating controls, human approvals, and expiry explicitly;
6. apply software-supply-chain, privacy, accessibility, reliability, and AI controls across layer boundaries; and
7. block “done” when required controls are failed, stale, unverified, waived without authority, or silently absent.

No single cited framework is sufficient by itself. NIST SSDF is an outcome-oriented secure-development baseline, OWASP ASVS is an application verification catalog, OWASP SAMM is a maturity model, SLSA covers artifact/source provenance, OpenSSF covers project security hygiene, OpenTelemetry standardizes telemetry, SRE/SLO guidance governs reliability decisions, and the NIST AI RMF/GenAI Profile governs AI risks. The Valdris control graph should compose them without claiming that any one score equals “enterprise ready.”

## Source posture and version rules

Only standards owners, standards bodies, government publications, and first-party framework documentation were used. Stable/final material is normative for this proposal; drafts are tracked but cannot satisfy a gate unless a project deliberately adopts a draft profile.

| Source | 2026 status used here | Correct use in Valdris |
|---|---|---|
| [NIST SP 800-218, SSDF v1.1](https://csrc.nist.gov/pubs/sp/800/218/final) | Final. NIST lists SSDF v1.2 as SP 800-218 Rev. 1 draft (December 2025) on the [SSDF publications page](https://csrc.nist.gov/Projects/ssdf/publications). | Final secure-SDLC baseline: prepare, protect, produce, respond. Track the v1.2 draft; do not label it final. |
| [NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final) | Final, July 2024. | AI-model/system secure-development overlay used with SSDF, not instead of it. |
| [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework) and [SP 800-53 Rev. 5, release 5.2.0](https://csrc.nist.gov/Pubs/sp/800/53/r5/upd1/Final) | Final control-outcome and control-catalog sources. | Organization/system governance, protection, detection, response, recovery, and security/privacy control families. Tailor; do not require every catalog control. |
| [NIST Privacy Framework 1.0](https://www.nist.gov/privacy-framework/privacy-framework) | Final. PF 1.1 is an Initial Public Draft as of the evidence date, as shown on the [NIST PF page](https://www.nist.gov/privacy-framework). | Privacy-risk profile, data processing inventory, retention/deletion, transparency, and governance. Do not claim PF 1.1 conformance as final. |
| [NIST SP 800-63-4](https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines) and [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) | Final. SP 800-63-4 superseded 800-63-3 in 2025. | Identity assurance profile and resource-centric, continuously evaluated access decisions. |
| [NIST SP 800-34 Rev. 1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) | Final contingency-planning guidance. | Business-impact analysis, recovery objectives, strategy, plan, exercises, and maintenance. |
| [NIST AI RMF 1.0 Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/), [NIST AI 600-1 GenAI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf), and [AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/) | AI RMF 1.0 and AI 600-1 are final; NIST says AI RMF is being revised. The Playbook is voluntary and explicitly not a universal checklist. | Govern, Map, Measure, Manage profile for contextual AI risk, testing/evaluation, deployment decisions, monitoring, incident response, and decommissioning. |
| [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/) | Latest stable ASVS; released May 2025. Official JSON/CSV formats exist. | Versioned application security requirements and verification results. Store identifiers as `v5.0.0-<requirement>`. |
| [OWASP SAMM 2 model](https://owaspsamm.org/model/) | Current official model page. | Maturity improvement across Governance, Design, Implementation, Verification, and Operations; never use a maturity score as release proof. |
| [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x04-release-notes/) | Current official awareness list in this research. OWASP calls it an awareness document. | Threat discovery and negative-test seeding, especially authorization, resource consumption, business-flow abuse, and unsafe upstream APIs. Not a certification. |
| [SLSA v1.2](https://slsa.dev/spec/v1.2/) | Approved specification with Build and Source tracks. | Verifiable provenance and level claims. SLSA explicitly does not prove code quality or transitive dependency trust. |
| [OpenSSF OSPS Baseline v2026.02.19](https://baseline.openssf.org/versions/2026-02-19.html) | Current version on the [OSPS Baseline version index](https://baseline.openssf.org/). | Versioned minimum open-source project security controls. Self-attestation remains point-in-time; resolve observable controls where possible. |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard) | Current automated security-health metrics. | Supplemental signals such as branch protection, code review, CI tests, and dangerous workflows. A Scorecard number is not compliance. |
| [OpenTelemetry Specification 1.59.0](https://opentelemetry.io/docs/specs/otel/) | Current specification shown at the evidence date. | Signal schemas, resources, context propagation, and logs/traces/metrics correlation. It does not prove useful SLOs, retention, alerts, or incident readiness. |
| [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | W3C Recommendation republished December 2024; W3C recommends the current version for future applicability. | Frontend accessibility conformance scope and testable A/AA success criteria. Automated scans alone cannot establish full conformance. |
| [RFC 9111, HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html), [RFC 6585, HTTP 429](https://www.rfc-editor.org/info/rfc6585/), and [RFC 9700, OAuth 2.0 Security BCP](https://www.rfc-editor.org/info/rfc9700/) | IETF Standards Track/BCP publications. | Protocol-conformance tests for caching, throttling responses, and OAuth flows. The May 2026 RateLimit fields document is still an [Internet-Draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) and must not be treated as an RFC. |
| [Google SRE Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/) and [example error-budget policy](https://sre.google/workbook/error-budget-policy/) | First-party SRE practice. | User-centered SLIs/SLOs, error budgets, alerts, and policy-based release decisions. |
| [DORA software-delivery performance metrics](https://dora.dev/guides/dora-metrics/) | Five-metric model, updated January 2026. | Service-level trends: change lead time, deployment frequency, failed deployment recovery time, change fail rate, deployment rework rate. Improvement metrics, not per-run release gates. |
| [AWS Well-Architected Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) and [Google Cloud Well-Architected Reliability Pillar](https://docs.cloud.google.com/architecture/framework/reliability) | Current first-party cloud reliability guidance reviewed in this audit. | Workload-specific capacity, failure isolation, backup/restore, recovery, resilience testing, observability, and graceful degradation. Provider examples, not universal architecture mandates. |

## The assurance model Valdris should enforce

### 1. Scope before controls

Every run needs a machine-readable assurance plan generated from intake. At minimum it should bind:

```json
{
  "schema": "valdris.assurance-plan.v2",
  "runId": "EXAMPLE-RUN-123",
  "subject": {
    "repository": "owner/repo",
    "commit": "<40-hex-sha>",
    "artifactDigests": [],
    "environment": "staging"
  },
  "risk": {
    "businessCriticality": "high",
    "internetExposed": true,
    "dataClasses": ["customer-pii"],
    "regulatedContexts": [],
    "aiSystem": true,
    "productionImpact": true
  },
  "profiles": [
    { "id": "nist-ssdf", "version": "1.1" },
    { "id": "owasp-asvs", "version": "5.0.0", "level": "project-selected" },
    { "id": "nist-ai-rmf", "version": "1.0" }
  ]
}
```

This implements the outcome- and risk-tailoring posture of [SSDF](https://csrc.nist.gov/pubs/sp/800/218/final), [CSF 2.0](https://www.nist.gov/cyberframework), and [AI RMF](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/). “Enterprise” is not a single architecture. A low-volume internal system and a global consumer service can both need strong assurance while requiring different topology, recovery, privacy, and performance controls.

### 2. Atomic controls, not layer scores

Each selected requirement should become an atomic record:

```json
{
  "controlId": "asvs:v5.0.0-<requirement>",
  "layer": "auth-permissions-rls",
  "crossCutting": ["backend-api-logic", "security"],
  "applicability": "required",
  "owner": "security-team",
  "status": "passed",
  "evidenceRefs": ["ev-authz-negative-001"],
  "testedAt": "2026-07-12T15:00:00Z",
  "expiresAt": "2026-08-11T15:00:00Z"
}
```

Layer status must be derived from its required controls. A layer may be “not applicable” only when the assurance plan proves why; individual controls may be skipped with an applicability rationale. A free-text sentence must not be enough to skip an entire security, privacy, supply-chain, or recovery domain for production-impacting work.

### 3. Evidence must be resolved and bound

The evidence ledger should require:

- immutable evidence ID and declared type;
- subject commit or artifact digest;
- environment and scope;
- producer identity and tool/version;
- command, start/end timestamps, and exit status for command evidence;
- content digest and in-root path or authenticated provider URL;
- freshness policy;
- raw result plus normalized findings;
- trust tier (`self-claim`, `local-tool`, `ci-attested`, `provider-attested`, `human-reviewed`);
- redaction/data-class metadata; and
- links to the exact control(s) the evidence supports.

The current gate cannot do this. In `scripts/production-layer-gate.mjs:32-40`, any non-empty `evidence`, path-like string, array value, or any command object with `exitCode: 0` passes `hasEvidence`. It does not resolve the path, hash content, match `runId`, require the subject commit, constrain evidence age, validate environment, or verify producer identity. `generatedAt` only has to parse as a date (`:71-74`); it is not checked for freshness. This is a schema-presence gate, not an enterprise proof gate.

### 4. Waivers are first-class and expiring

An allowed exception requires scope, affected control IDs, risk statement, compensating controls, accountable human approver, approval token/reference, creation time, expiry, and a remediation owner. A waiver must never silently convert `failed` into `passed`. This is consistent with SSDF’s risk-based outcomes, SAMM governance, and Valdris’s existing human-only Red Zone rule.

## Source-cited requirements matrix

The “machine implication” column is a Valdris design derived from the cited requirements; it is not claimed to be a prescribed filename or schema from the source.

| Valdris layer/profile | Minimum enforceable requirements | Authoritative basis | Minimum evidence | Exact machine-gate implication |
|---|---|---|---|---|
| 1. Frontend | Define supported routes, browsers/devices and complete user journeys; test functional and negative paths; meet the selected WCAG 2.2 conformance level across full pages and complete processes; prove responsive, visual-regression, and user-centered performance budgets. | [WCAG 2.2 conformance](https://www.w3.org/TR/WCAG22/#conformance-reqs) requires full-page/complete-process conformance; [ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/) provides versioned technical verification requirements. | Route/journey manifest; browser/device matrix; automated accessibility results plus manual keyboard/screen-reader review where applicable; E2E and visual diff results; performance data tied to URLs/build. | `accessibility-gate` rejects an unversioned or scan-only “WCAG compliant” claim; `frontend-gate` verifies manifest coverage, result files, build digest, test freshness, and threshold failures. “Components are in separate files” is never a control. |
| 2. Backend/API/logic | Version API contracts; validate inputs and outputs; prove authentication and object/function/property authorization; protect sensitive business flows and resource consumption; test error, timeout, idempotency, replay, and unsafe upstream API paths. | [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/) is a verification standard; [OWASP API Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x04-release-notes/) identifies authorization, resource-consumption, business-flow, and unsafe-consumption risks but explicitly remains an awareness document; [SSDF PW](https://csrc.nist.gov/pubs/sp/800/218/final) covers design review, code review/analysis, and executable testing. | Contract artifact and diff; schema/conformance results; positive and negative authorization tests; fuzz/property results where selected; idempotency/replay tests; provider-failure tests; latency/throughput result. | `api-contract-gate` requires a versioned contract and breaking-change decision; `api-security-gate` consumes versioned ASVS control IDs and negative tests. Generic “proper HTTP methods” cannot pass the layer. |
| 3. Database/storage | Inventory data stores and classifications; enforce schema integrity and access boundaries; use reviewed, reversible/forward-compatible migration strategy; define retention/deletion and backup scope; set workload-specific RPO/RTO; perform restore and data-integrity exercises. | [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/Pubs/sp/800/53/r5/upd1/Final) supplies AC, AU, CP, SC, SI, and privacy control families; [NIST Privacy Framework 1.0](https://www.nist.gov/privacy-framework/privacy-framework) treats privacy as enterprise risk; [AWS REL09 and REL13](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) require protected backups, periodic recovery, recovery objectives, strategies, and DR testing; [NIST SP 800-34 Rev. 1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) requires BIA-driven contingency planning and exercises. | Data inventory/classification; schema and migration diff; migration/rollback rehearsal; integrity constraints test; retention/deletion test; encrypted-backup metadata; restore transcript with measured RPO/RTO and record counts/checksums. | `data-gate` blocks destructive migration without a reviewed migration plan and Red Zone approval; `recovery-gate` rejects “backups enabled” without a recent successful restore and objective comparison. |
| 4. Auth/permissions/RLS | Select identity/authentication assurance appropriate to risk; make authorization resource- and action-specific; prove least privilege and tenant/row isolation; secure sessions, recovery, federation and OAuth flows; evaluate access without implicit network trust. | [NIST SP 800-63-4](https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines) covers identity proofing, authentication, federation, authenticators and management; [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) rejects trust based solely on network location; [RFC 9700](https://www.rfc-editor.org/info/rfc9700/) requires exact redirect matching and PKCE for public clients, discourages implicit flow, and recommends replay protections; [ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/) provides application verification requirements. | Role/permission matrix; identity profile; positive/negative tests for every protected action and tenant boundary; session lifecycle results; OAuth/OIDC configuration and protocol tests; privileged-access review. | `authz-gate` expands the permission matrix into required tests and rejects missing negative cases; `oauth-gate` checks selected BCP 240 requirements; provider presence alone cannot pass. |
| 5. Hosting/deployment | Define environments and promotion policy; use reproducible, reviewable configuration; test deploy health and rollback; preserve deployment identity and audit evidence; use staged/canary/blue-green only when justified by risk and platform; separate automatic recovery from human-authorized production changes. | [SSDF PS and PW](https://csrc.nist.gov/pubs/sp/800/218/final) protect release integrity and secure configuration; [OWASP SAMM](https://owaspsamm.org/model/) includes Secure Deployment; [AWS REL08](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) calls for runbooks, functional/resiliency tests, immutable infrastructure, and deployment automation; [Google reliability guidance](https://docs.cloud.google.com/architecture/framework/reliability) stresses scoping, observation, response, and learning. | IaC/config diff; environment manifest; deployment record tied to artifact digest; health and smoke results; staged promotion evidence; timed rollback exercise; approver record where required. | `deployment-gate` verifies artifact identity from build provenance through target environment and requires smoke/rollback proof. Production deploy/promotion is Red Zone; a pre-authorized automated rollback may execute within a signed policy and must emit evidence. |
| 6. Cloud/compute | Inventory resources, accounts/projects, regions, networks, identities, secrets, quotas, dependencies, ownership and cost; enforce least privilege and configuration policy; model capacity and provider failure; justify topology and data residency. | [CSF 2.0](https://www.nist.gov/cyberframework), [SP 800-53](https://csrc.nist.gov/Pubs/sp/800/53/r5/upd1/Final), and [SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) cover governance, assets, access and protection; [AWS Reliability](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) covers quotas, monitoring, scaling and failure isolation; [Google Reliability](https://docs.cloud.google.com/architecture/framework/reliability) makes redundancy/scalability/failure testing workload-dependent. | Provider-authenticated resource inventory; IaC plan/state diff; IAM graph and policy findings; network/data-flow diagram; quota headroom; capacity/cost model; region/provider risk decision. | `cloud-gate` requires provider identity, account/project, environment, capture time, and resource digests. A prose “service map” or “10x traffic” guess cannot pass high-risk compute changes. |
| 7. CI/CD/version control | Protect the development environment; require reviewed source changes according to risk; isolate untrusted CI input from privileged credentials; scan to a documented policy; generate and verify provenance; preserve source/release identity; measure delivery outcomes over time. | [SSDF PO/PS/PW/RV](https://csrc.nist.gov/pubs/sp/800/218/final); [SLSA v1.2](https://slsa.dev/spec/v1.2/) Build/Source tracks and [artifact verification](https://slsa.dev/spec/v1.2/verifying-artifacts); [OpenSSF OSPS Baseline 2026.02.19](https://baseline.openssf.org/versions/2026-02-19.html) requires MFA for sensitive repository access, protected primary branches, safe handling of untrusted CI, secret prevention, change history and other maturity-specific controls; [DORA](https://dora.dev/guides/dora-metrics/) defines five service-level delivery metrics. | Branch/ruleset snapshot; review evidence; workflow analysis; CI result; vulnerability policy and findings/waivers; SBOM where selected; signed provenance and verification summary; release digest; DORA time series. | `supply-chain-gate` verifies a declared SLSA track/level instead of inferring it from “CI exists”; `osps-gate` evaluates pinned control IDs; `workflow-security-gate` blocks privileged secrets in untrusted jobs. DORA informs improvement and never substitutes for a passing run. |
| 8. Security | Maintain risk/threat models and security requirements; apply secure design, coding, verification, vulnerability response and incident processes; protect secrets through lifecycle; validate configuration and dependency policy; document residual risk and ownership. | [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final), [NIST CSF 2.0](https://www.nist.gov/cyberframework), [SP 800-53](https://csrc.nist.gov/Pubs/sp/800/53/r5/upd1/Final), [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/), and [OWASP SAMM](https://owaspsamm.org/model/). | Threat model/change analysis; security requirements/control mapping; SAST/SCA/DAST/secret results as applicable; dependency inventory; exploitability/severity policy; pen-test findings when required; exception ledger; incident/vulnerability response proof. | `security-gate` evaluates policy thresholds and expiring risk acceptance, not “scan clean.” It rejects a score-only artifact, unversioned rules, unknown scan scope, stale databases, and findings without disposition. |
| 9. Rate limiting | Identify scarce resources and abuse-sensitive business flows; define quotas by actor/resource/action/cost/concurrency as applicable; enforce consistently across instances; test bypass and distributed race behavior; return correct throttling responses; bound retries and observe rejection/error/cost outcomes. | [OWASP API Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x04-release-notes/) calls out unrestricted resource consumption and sensitive business flows; [RFC 6585](https://www.rfc-editor.org/info/rfc6585/) defines 429 and optional `Retry-After`; SLO/capacity policy follows [Google SRE](https://sre.google/workbook/implementing-slos/). | Versioned limit policy; endpoint/resource coverage; distributed load and bypass tests; 429/`Retry-After` protocol tests; retry-budget/idempotency tests; quota telemetry; cost-abuse thresholds and alerts. | `rate-limit-gate` rejects “rate limiting exists” without dimensions and coverage. It must not require draft RateLimit response fields as a standard. Naive immediate retries on 429 are a failure because they can amplify overload. |
| 10. Caching/CDN | Declare cacheability, cache key, authorization/privacy boundaries, freshness, validation, invalidation, stale behavior and purge/rollback for each cached resource class; test shared-cache leakage, poisoning/key confusion and deploy invalidation. | [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) defines HTTP cache storage, freshness, validation and authorization-related rules; privacy and security controls come from [NIST PF 1.0](https://www.nist.gov/privacy-framework/privacy-framework) and [ASVS](https://owasp.org/www-project-application-security-verification-standard/). | Cache-policy manifest; response-header captures; authenticated/anonymous cross-user isolation tests; freshness/revalidation tests; purge/invalidation evidence; cache-key cardinality/poison tests; origin/CDN metrics. | `cache-gate` executes semantic fixtures against the deployed target and rejects a Lighthouse/CDN badge as proof. User-specific responses in shared caches require explicit verified policy. |
| 11. Load balancing/scaling | Define service demand and capacity assumptions; test at expected and failure loads; monitor quotas/headroom; verify health routing, draining, session/state behavior, backpressure and dependency limits; prove failover/graceful degradation for required fault domains. | [AWS REL07, REL10-12](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) covers autoscaling, load tests, fault isolation, health/failover and resiliency tests; [Google Reliability](https://docs.cloud.google.com/architecture/framework/reliability) covers redundancy, horizontal scaling, observability, graceful degradation and recovery testing; [Google SRE](https://sre.google/workbook/implementing-slos/) ties capacity behavior to user-visible objectives. | Workload model; topology/fault-domain map; load-test raw results and thresholds; autoscaling events; quota/headroom; health/drain tests; dependency saturation and graceful-degradation results; cost model. | `capacity-gate` compares observed percentiles/error rates/saturation against declared thresholds and validates test duration/workload. “Simulate 100 then 1,000 users” is not a capacity model. |
| 12. Error tracking/logs/observability | Define user-centered SLIs/SLOs and error-budget policy; instrument necessary logs, metrics and traces with consistent service/resource identity and context correlation; protect sensitive telemetry; prove alert routing, actionable dashboards, incident linkage, retention and cost controls. | [OpenTelemetry 1.59.0](https://opentelemetry.io/docs/specs/otel/) defines interoperable signal semantics; [OpenTelemetry logging](https://opentelemetry.io/docs/specs/otel/logs/) describes trace/span and resource correlation; [Google SRE SLOs](https://sre.google/workbook/implementing-slos/) and [error-budget policy](https://sre.google/workbook/error-budget-policy/) connect telemetry to reliability decisions; SP 800-53 AU controls cover audit/accountability. | SLI/SLO specification; synthetic transaction trace with cross-service correlation; metric/log/trace query results; alert test and destination acknowledgment; dashboard links; redaction tests; retention/access policy; incident link; telemetry cost/volume report. | `observability-gate` queries or verifies exported telemetry for a known synthetic run and required service graph. “Sentry connected” and “logs are structured” are insufficient. `slo-gate` validates SLI math, window, target, burn, and release policy. |
| 13. Availability/recovery/DR | Perform BIA; define per-service/data-class availability, RTO and RPO; maintain recovery strategy/runbooks and dependencies; protect backups; test restores, failover, failback and reconstruction; conduct incidents/exercises and close postmortem actions. | [NIST SP 800-34 Rev. 1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final); [AWS REL09, REL12 and REL13](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html); [Google Reliability](https://docs.cloud.google.com/architecture/framework/reliability); [Google SRE error-budget policy](https://sre.google/workbook/error-budget-policy/). | BIA and dependency map; SLO/SLA/RTO/RPO decisions; backup inventory; timed restore with integrity checks; failover/failback exercise; runbook execution log; incident/postmortem with tracked actions; residual single points of failure. | `recovery-gate` measures actual recovery against declared objectives and rejects backup configuration without restore proof. `resilience-gate` requires safety controls, blast radius, abort criteria, owner and approval for live chaos; production experiments are Red Zone. |
| Cross-cutting: software supply chain | Protect source, build, release and dependency handling from tampering; preserve provenance; verify artifacts against expectations; maintain vulnerability/reporting policies and repository hygiene. | [SSDF](https://csrc.nist.gov/pubs/sp/800/218/final), [SLSA 1.2](https://slsa.dev/spec/v1.2/), and [OpenSSF OSPS Baseline 2026.02.19](https://baseline.openssf.org/versions/2026-02-19.html). | Source/build attestations, SBOM/dependency inventory, release digests/signatures, provenance verification, repo control snapshot, vulnerability policy/findings. | Always classified for code/release work; it cannot be skipped merely because the feature does not change CI files. |
| Cross-cutting: privacy | Identify processing purpose, data subjects/classes/flows/recipients, minimization, retention/deletion, access, transparency and risk; reconcile audit retention and deletion by data class and legal basis. | [NIST Privacy Framework 1.0](https://www.nist.gov/privacy-framework/privacy-framework) and SP 800-53 privacy controls. | Data/processing inventory; data-flow map; retention schedule; deletion/export test; third-party inventory; privacy impact/risk decision; telemetry/log redaction proof. | `privacy-gate` runs whenever personal/sensitive data or AI training/evaluation data is touched. It blocks a blanket “immutable logs” or “delete everything” claim without classification and policy. |
| Cross-cutting: generative AI/agents | Govern owners and risk tolerance; map intended use/context/affected actors/data/models/tools/dependencies; measure validity, safety, security, privacy, bias/impact and uncertainty with versioned evals; manage deployment, monitoring, incident, rollback and decommission decisions; secure model/system development and tool access. | [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/), [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf), [NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final), and [OWASP AI Exchange](https://owasp.org/www-project-ai-security-and-privacy-guide/). | AI system/context card; owner/approval matrix; model/provider/prompt/tool/retrieval/data inventory with versions; eval plan/dataset provenance/results/thresholds; adversarial and tool-permission tests; trajectory and cost ledger; canary/monitor/drift/incident/rollback/kill-switch proof. | `ai-profile-gate` selects risk controls; `ai-eval-gate` rejects demo-only or unversioned evals; `agent-trajectory-gate` checks tool permissions, retry/stop budgets and prohibited actions; production AI promotion/deployment requires explicit human authorization. |

## Contradictions and corrections to the PDF corpus

### The final audit prompts do not test the Tier-3 claims

The PDFs’ explanatory pages mention genuine advanced topics, but their audit prompts do not prove them. Examples:

- Layer 1 discusses micro-frontends, visual regression, WCAG 2.1 AA, cross-team governance and safe rollout on pp. 2-3, while its audit prompt asks whether components are in separate files, whether the app works at 375 px, and whether colors/fonts are consistent (p. 5; [extracted text](../../../tmp/pdfs/extracted/Layer-1-Frontend-Foundations-Tier-3-Enterprise-Kit.txt)).
- Layer 7 describes quality gates, security scanning, staged approvals, policy as code and audit trails on pp. 2-3, while its audit asks only whether tests/lint/build exist, automatic deployment is connected, and secrets appear in history (p. 5; [extracted text](../../../tmp/pdfs/extracted/Layer-7-CI-CD-Version-Control-Tier-3-Enterprise-Kit.txt)).
- Layer 12 describes distributed tracing, SLOs/error budgets, incident automation and audit logging on pp. 2-3, while its audit asks whether Sentry exists, logs are structured, alerts exist and source maps work (p. 5; [extracted text](../../../tmp/pdfs/extracted/Layer-12-Error-Tracking-Logs-Tier-3-Enterprise-Kit.txt)).
- Layer 13 describes multi-region redundancy, chaos engineering and formal incident response, while its audit asks for uptime monitoring, backups, one restore, rollback and a runbook (p. 5; [extracted text](../../../tmp/pdfs/extracted/Layer-13-Availability-Recovery-Tier-3-Enterprise-Kit.txt)).

Correction: distinguish `education prompt`, `design review`, `configuration inspection`, `test execution`, `provider-attested observation`, and `human assurance review`. A conversational score can route work; it cannot certify it.

### Architecture patterns are treated as universal requirements

The kits repeatedly imply that Tier 3 means micro-frontends, sharding, warehouses, multi-cloud, multi-region, read replicas, a WAF, or global CDN/edge deployment. Authoritative frameworks instead start from business context, risk tolerance, workload, user experience and failure objectives. Google’s reliability pillar explicitly begins with architecture scoping and realistic user-experience targets; NIST SSDF is outcome-based; the AI RMF is contextual; AWS treats multi-location deployment as one reliability practice among many.

Correction: the gate should require a justified architecture decision and objective evidence, not a named topology. A well-designed single-region workload can pass if its SLO/RTO/RPO and business risk permit it; an unjustified multi-region system can fail due to untested consistency, cost and operational complexity.

### WCAG 2.1 is stale as the forward baseline

Layer 1 names WCAG 2.1 AA. W3C’s current Recommendation is [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and W3C advises using the current version for future applicability. WCAG conformance also applies to full pages and complete processes, which a linter or Lighthouse score alone cannot establish.

Correction: commission the required legal/policy target explicitly; default new general web profiles to WCAG 2.2 AA, store the version and conformance scope, and combine automation with required manual/assistive-technology evidence.

### “Data loss is not an option” conflicts with the same corpus’s RPO model

Layer 3 says “Data loss is not an option” (p. 2), while Layer 13 later gives an example RPO of 15 minutes (p. 3). Recovery engineering necessarily makes workload-specific recovery-point and recovery-time decisions. [AWS REL13](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html) requires defined objectives and tested strategies; [NIST SP 800-34 Rev. 1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) begins with business-impact analysis.

Correction: replace absolutes with per-service/data-class objectives, consistency semantics and measured recovery evidence. If zero data loss is truly required, the architecture and test must prove that stronger objective and its failure modes.

### “Automatic deployment” conflicts with controlled promotion

Layer 5’s audit asks for automatic deploys on push; Layer 7’s audit asks for automatic deployment on merge. Yet Layer 7’s teaching content correctly requires staged rollouts and approval steps. DORA does not mandate automatic production deployment, and SLSA/SSDF focus on controlled, attributable, verifiable source/build/release paths.

Correction: distinguish continuous integration, continuous delivery, and continuous deployment. The project adapter must declare environment-specific promotion policy. Preview or staging may be automatic; production promotion may be automated only under approved policy and risk limits. Human-only Red Zone operations remain human-authorized.

### Chaos engineering is presented too casually

Layer 13 says chaos engineering intentionally breaks systems “in production” and frames it as a regular Tier-3 proof. AWS includes chaos engineering under resiliency testing, but also requires playbooks, post-incident analysis, recovery planning, and testing. A safe experiment needs a hypothesis, steady-state metric, limited blast radius, abort condition, owner, rollback, observability and authorization.

Correction: production chaos is Red Zone. Prefer lower environments first. A live experiment passes only with approved scope, safety guardrails and captured outcome; the existence of Gremlin/Litmus does not prove resilience.

### Secrets in environment variables are treated as sufficient

The Layer 5 and Layer 8 audit prompts treat “not hardcoded; stored in environment variables” as the pass condition, while Layer 8’s own teaching text correctly describes vaulting and rotation. Environment variables are an injection mechanism, not a complete secret lifecycle.

Correction: require inventory, least-privilege access, source, rotation/revocation, environment separation, log redaction, leak response and proof that untrusted CI cannot access privileged secrets. OpenSSF OSPS 2026.02.19 specifically requires isolation of privileged CI credentials from untrusted code snapshots.

### “Security scan clean” and arbitrary coverage thresholds are false confidence

Layer 7 states that a clean security scan and coverage above 80% open the gate. Neither demonstrates absence of vulnerabilities or adequate behavioral coverage. SSDF requires multiple secure-development and vulnerability-response outcomes; ASVS provides explicit verification requirements; SLSA explicitly says provenance does not establish code quality.

Correction: select required tests and ASVS/SSDF controls by risk. Apply severity/exploitability policy, triage findings, expire exceptions, record scanner/rules/database versions, and evaluate mutation/negative/property tests where justified. Coverage remains a diagnostic signal, not a universal release threshold.

### Compliance is conflated with code configuration

Layer 8 groups SOC 2, GDPR and HIPAA as “formal standards” and implies an app audit can prove compliance. They differ in legal/attestation form, scope and applicability. A codebase cannot by itself prove organizational controls, contracts, policies, training, vendor management, incident response or operating effectiveness.

Correction: Valdris must record `regulatedContext`, applicability rationale, control owner, evidence source, assessment period and assessor/authority. It may support a compliance evidence packet but must never state legal compliance from a generic repository scan. Legal/audit conclusions are human-owned Red Zone claims.

### Immutable audit logs and deletion rights require a data policy, not slogans

Layer 12 says compliance logs “can’t be deleted or modified”; Layer 8 asks for GDPR deletion across databases, backups and third parties. Both can be valid only after data classification, purpose, minimization, retention, access, legal basis and separation of audit/security events from unnecessary personal payloads.

Correction: make immutability/tamper evidence, retention and deletion class-specific. Prefer pseudonymous identifiers and redaction. Prove that privacy deletion workflows handle live stores, derived data, AI/retrieval indexes and third parties while preserved records follow an approved retention basis.

### Rate-limit retry advice can worsen overload

Layer 9 asks whether 429 responses are handled “with retry logic.” [RFC 6585](https://www.rfc-editor.org/info/rfc6585/) says a 429 response may include `Retry-After`; it does not endorse immediate or unbounded retry. Retries need idempotency, delay/jitter, maximum attempts/deadline and a shared retry budget.

Correction: gate bounded retry behavior and overload tests. Do not require the 2026 RateLimit fields Internet-Draft as a stable protocol.

### Vendor presence and headline scores are substituted for behavior

The prompts repeatedly equate “Sentry connected,” “CDN active,” “Lighthouse above 90,” “backups enabled,” or “auto-scaling configured” with readiness. OpenTelemetry only standardizes telemetry representation; AWS explicitly requires recovery and scalability tests; SRE requires meaningful SLIs/SLOs; RFC 9111 defines cache semantics, not a CDN badge.

Correction: require synthetic transaction traces, alert delivery, cache isolation/invalidation, restore/failover, and capacity threshold evidence bound to the deployed artifact/environment.

## Missing controls in the PDFs and current Valdris gate

1. **Versioned control source and applicability.** There is no control ID/version/profile in `uash.production-readiness.v1`.
2. **Subject binding.** `runId` is not required by `scripts/production-layer-gate.mjs`; commit, artifact digest and environment are absent.
3. **Evidence authenticity and resolution.** Evidence strings are accepted without verifying files, URLs, digests, producer, tool version or scope.
4. **Freshness.** A parseable timestamp is enough; there is no maximum age or change-sensitive invalidation.
5. **Atomic control coverage.** One evidence string passes a whole layer regardless of how many required controls exist.
6. **Cross-layer dependencies.** Auth, privacy, supply chain, telemetry and AI risks span multiple layers, but the gate models a flat list.
7. **Exception governance.** There is no typed waiver, compensating control, accountable risk owner or expiry.
8. **Assurance confidence.** A self-authored note is indistinguishable from CI/provider attestation or human review.
9. **Environment/provider proof.** There is no authenticated target identity, account/project, URL, deployment, region or provider evidence.
10. **Supply-chain provenance.** No SLSA track/level, provenance verification, source-control evidence, SBOM/dependency identity or release digest is required.
11. **Privacy lifecycle.** No processing inventory, purpose, minimization, retention/deletion, data subject, recipient or third-party proof exists.
12. **Accessibility conformance.** No version, conformance level/scope, complete-process coverage or manual evidence exists.
13. **SLO/error-budget semantics.** No SLI formula, window, target, error-budget burn, alert validation or release-policy link exists.
14. **Recovery measurement.** “Backup/restore note” is accepted without measured restore integrity, RTO/RPO comparison, failback or dependency coverage.
15. **Capacity methodology.** No workload model, duration, percentiles, saturation, failure load or threshold comparison is required.
16. **AI system governance.** [`docs/OPERATING_INTELLIGENCE_LAYER.md`](../../docs/OPERATING_INTELLIGENCE_LAYER.md) names eval/trajectory/context/tool/cost artifacts, but no executable gates validate versions, datasets, thresholds, tool permissions, trajectory policy, provider/model drift, canary, rollback or decommission state.
17. **Operational feedback.** DORA and incident/postmortem trends are not connected to harness improvement or error-budget policy.
18. **Legal/assessor boundary.** The system has no typed rule preventing agents from declaring legal compliance or audit attestation.

## Exact Valdris machine-gate implications

### Replace, do not merely expand, `hasEvidence`

`uash.production-readiness.v1` can remain readable for compatibility, but completion for serious work should require a new assurance bundle:

```text
assurance/plan.json                 valdris.assurance-plan.v2
assurance/controls.json             valdris.control-results.v2
assurance/evidence.json             valdris.evidence-ledger.v2
assurance/waivers.json              valdris.waiver-ledger.v1
assurance/dependencies.json         valdris.control-graph.v1
production/layer-assessment.json    derived view, not the source of truth
```

The layer assessment becomes a projection of atomic results. It must not be manually marked passed independently.

### Required gate chain

| Gate | Must reject |
|---|---|
| `assurance-plan-gate.mjs` | Missing subject commit/environment, unpinned profile, missing risk fields, AI/data/production applicability left unknown. |
| `control-coverage-gate.mjs` | Required control absent, duplicate control, selected profile incompletely mapped, cross-cutting dependency omitted, whole high-risk profile skipped. |
| `evidence-ledger-gate.mjs` | Missing/unreadable evidence; path escape; digest mismatch; stale evidence; wrong commit/artifact/environment; unknown producer/tool version; failed command; self-claim used where attested evidence is required. |
| `waiver-gate.mjs` | Agent-approved exception; missing risk owner; expired or over-broad waiver; no compensating control; waiver used for a non-waivable Red Zone action. |
| `supply-chain-gate.mjs` | Unsupported SLSA claim; unsigned/unverified provenance where the profile requires it; source/artifact mismatch; unsafe untrusted workflow; missing dependency/release identity. |
| `security-gate.mjs` | Unversioned requirements/scanners; findings without disposition; policy threshold breach; stale vulnerability data; missing threat/applicability analysis. |
| `privacy-gate.mjs` | Personal/sensitive data without processing inventory, purpose/owner, retention/deletion, third-party/data-flow handling or redaction test. |
| `accessibility-gate.mjs` | Version/scope omitted; automated scan represented as full conformance; required journey/viewports absent; unresolved A/AA failures. |
| `api-contract-gate.mjs` | Breaking contract without decision; missing negative auth/validation/error cases; target build not the tested build. |
| `capacity-gate.mjs` | No workload model/thresholds; invalid duration/concurrency; error/latency/saturation breach; no dependent-service measurements. |
| `observability-gate.mjs` | No correlated synthetic trace; required service missing; alert untested; SLI cannot be computed; telemetry contains prohibited sensitive data. |
| `slo-gate.mjs` | Invalid SLI/window/target math; exhausted error budget without policy action/waiver; release decision not linked to current SLO state. |
| `recovery-gate.mjs` | Backup-only claim; failed/stale restore; measured RTO/RPO exceeds objective; missing integrity/failback/dependency proof. |
| `ai-profile-gate.mjs` | AI context/owner/data/model/provider/tool inventory absent; risk profile not selected; prohibited use or required human review unresolved. |
| `ai-eval-gate.mjs` | Dataset/evaluator/model/prompt/tool versions absent; threshold undefined; regression/adversarial suite missing; results below threshold; sample/data leakage unresolved. |
| `agent-trajectory-gate.mjs` | Disallowed tool/action; permission escalation; retry/cost/latency/stop budget exceeded; missing approval; trace not bound to output. |
| `finish-line-gate.mjs` | Any required gate failed/pending/stale; waiver invalid; Red Zone pending; layer projection disagrees with atomic controls; handoff omits residual risk and skipped controls. |

### Evidence trust policy

Recommended minimum trust by outcome:

| Claim | Minimum acceptable evidence |
|---|---|
| Unit/build/lint result | Local tool for draft work; CI-attested for merge/release. |
| Release artifact identity/SLSA claim | Build-platform attestation plus verifier result tied to digest. |
| Deployed behavior | Provider-authenticated deployment identity plus target-environment smoke/query result. |
| Authorization/tenant isolation | Executed negative tests against the exact build/environment; human review for high-impact policy changes. |
| Restore/RTO/RPO | Exercise transcript with timestamps, target identity and integrity checks; operator sign-off for high-criticality systems. |
| WCAG conformance | Automated results plus required manual/assistive-technology review over declared scope. |
| Legal compliance/audit attestation | Human legal/audit authority only; Valdris may assemble evidence but may not grant the claim. |
| Production deployment, destructive migration, live chaos, credential/permission expansion | Human Red Zone authorization, scoped and auditable. |
| AI production promotion or expanded tool/data access | Passing versioned eval/risk gates plus human authorization when profile requires it. |

### Control dependency examples

Controls must form a graph, because the following pass/fail relationships are not representable in a flat 13-row checklist:

- authenticated caching depends on auth/tenant isolation, cache-key policy, privacy and negative cross-user tests;
- a database migration depends on data integrity, deployment sequencing, rollback/recovery, observability and Red Zone approval;
- an SLO depends on telemetry identity/correlation, load model, user journey and alert policy;
- a release-security claim depends on source controls, build provenance, scanner policy, artifact digest and deployment identity;
- an AI/RAG feature depends on data classification, retrieval authorization, prompt/tool policy, evals, trajectory traces, model/provider versions, rate/cost limits, monitoring and rollback.

## Generative-AI assurance overlay

The [1317 paper corpus](../../../tmp/pdfs/extracted/1317.txt) is directionally aligned with NIST’s lifecycle posture: it emphasizes goal-plan-act-observe loops, tests plus evals, trajectory review, context, skills, tools, memory, sandboxes, orchestration, observability, cost, human oversight and build-evaluate-deploy-observe-refine. Those are strong design themes, but they are not control specifications. Valdris should turn them into the following bounded profile.

### Commissioning requirements

- intended purpose, out-of-scope uses, affected users/communities and impact severity;
- system owner, risk owner, model/provider owner, data owner and incident owner;
- model/provider/version, prompts/policies, retrieval sources/index versions, tools/actions and permission roots;
- training/fine-tuning/eval data provenance, rights, classification, retention and contamination controls;
- human oversight/escalation and actions that always remain Red Zone;
- acceptable quality/safety/security/privacy/cost/latency thresholds;
- deployment stage, canary cohort, rollback/kill switch and decommission plan; and
- external dependencies, provider limits, fallback/degraded behavior and disclosure obligations.

This is a tailored implementation of the continuous Govern/Map/Measure/Manage functions in the [AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/), the generative-AI risk actions in [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf), and the secure-development additions in [SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final).

### Evaluation requirements

- test deterministic code/contracts separately from probabilistic behavior;
- version the task set, dataset, rubric, evaluators/judges, seeds/configuration where available, model, prompt, retrieval corpus and tools;
- define pre-deployment thresholds and confidence/variance expectations;
- include normal, edge, adversarial, unsafe, privacy, tool-misuse, permission-boundary, unavailable-provider and cost/latency cases;
- evaluate final output and trajectory/tool behavior;
- retain failures and regression cases with provenance;
- check data leakage/contamination and judge conflicts;
- run canary/monitoring and drift-triggered re-evaluation after deployment; and
- bind every result to the exact AI system version deployed.

An attractive demo, a single successful trajectory, or an LLM-authored qualitative score cannot pass `ai-eval-gate`.

### Agent-loop requirements

Every durable goal/loop should have an explicit objective, milestone DAG, allowed roots/network/tools, maximum attempts, token/cost/time budgets, observation schema, checkpoint/resume state, approval states, stop conditions, escalation rules, and terminal outcome. Tool calls and environment mutations must be logged with subject, actor and result. The trajectory gate should flag repeated ineffective retries, policy violations, context/tool drift, unapproved privilege expansion and completion without required proof.

## Recommended adoption order

1. **Trust foundation:** assurance plan, atomic control results, evidence resolver/digests/freshness/subject binding, waivers and derived layer projection.
2. **Highest-risk executable profiles:** supply chain, security/auth, privacy, deployment and recovery.
3. **Operational proof:** API contracts, capacity, observability, SLO/error budget, cache/rate-limit semantics and accessibility.
4. **AI profile:** AI inventory/context, eval gate, trajectory/tool-permission gate, cost/latency, canary/monitor/rollback/decommission.
5. **Improvement loop:** DORA trends, incident/postmortem actions, recurring control drift, self-heal proposals and profile-version updates.

Until step 1 exists, keep `uash.production-readiness.v1` labeled **structural classification only**. It should not be described as enterprise assurance or Tier-3 certification.

## Final verdict

Valdris’s 13-layer concept is worth keeping because it is understandable and useful for routing. It becomes defensible only when separated into:

- **layers**: where risk and ownership live;
- **profiles/controls**: what must be true and why;
- **evidence**: what was actually observed, by whom, for which subject and when;
- **policy**: what blocks, what can be waived, and who may approve;
- **goals/loops**: how work continues until verified stopping conditions are reached; and
- **feedback**: how incidents, delivery outcomes, eval failures and control drift improve the harness.

That model validates the useful parts of the PDFs, corrects their overbroad architecture claims, fills the missing supply-chain/privacy/AI/reliability controls, and gives Valdris an implementable path from “proof-shaped text” to evidence-backed software and AI assurance.
