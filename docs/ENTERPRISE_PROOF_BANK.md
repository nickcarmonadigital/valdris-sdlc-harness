# Enterprise Proof Bank

## Bottom line

The harness cannot treat proof as “the demo works.” For real software, proof means the run produced evidence across functional behavior, scale, reliability, security, data integrity, observability, cost, performance, domain-specific risk, live smoke, and operator handoff.

This document turns the PDF / test-day pattern into a durable Valdris rule: every commissioned repo gets a proof bank, and every serious run must state which evidence dimensions are required, passed, failed, pending, or skipped with a reason.

## Proof dimensions

| Dimension | What good looks like | Typical artifact |
|---|---|---|
| Functional correctness | Acceptance criteria are exercised end-to-end, including negative paths. | `proof/proof.json`, test output, screenshots/logs |
| Scale / concurrency | Capacity model or load test matches the user/product bar. | `proof/load.json`, `performance/capacity.md` |
| Reliability / recovery | Retries, rollback, backup/restore, queues/DLQs, and recovery owner are clear. | `reliability/recovery.md`, `rollback/plan.md` |
| Security | AuthN/authZ, secrets, tenant/data boundaries, dependency risk, and Red Zone actions are checked. | `security/review.md`, `approvals/redzone.json` |
| Data integrity | Migrations, schema changes, consistency, rollback, and corruption risks are covered. | `data/migration-proof.md`, `data/integrity.json` |
| Observability | Logs, metrics, traces, run/request IDs, dashboards, and alerts exist or are explicitly skipped. | `observability/proof.md`, provider links |
| Cost / FinOps | Provider spend, scaling costs, expensive retries, and budget exceptions are visible. | `cost/ledger.json`, `handoff/final.md` |
| Performance | Latency/FPS/throughput/cache budgets are checked for the target surface. | `performance/results.json` |
| Domain-specific proof | The product type has its own acceptance gates, not generic proof. | domain pack artifact |
| Live smoke | Target environment/provider/runtime behavior is actually exercised when relevant. | `smoke/smoke_proof.json` |
| Operator handoff | Human can see what changed, proof, risk, rollback, and next decision. | `handoff/final.md` |

## Domain packs

Commissioned repos should choose a default domain pack and add custom proof dimensions when needed.

### Enterprise web app / SaaS

Require evidence for:

- roles and auth boundaries;
- API contracts and negative tests;
- database/schema/migration proof;
- billing/provider/entitlement checks when applicable;
- load/concurrency/capacity model;
- observability and request IDs;
- rollback and deploy smoke;
- tenant isolation and data-boundary proof.

### AI product / agent runtime

Require evidence for:

- eval plan and eval results;
- prompt/tool/model versioning;
- retrieval/context manifest;
- tool permission policy;
- trajectory trace and retry/cost ledger;
- safety/behavior regressions;
- production-agent lifecycle state;
- canary/rollback path.

### API / integration platform

Require evidence for:

- schema/API contract;
- auth and rate limit behavior;
- webhook/provider failure handling;
- idempotency/retry behavior;
- observability and correlation IDs;
- provider-cost/rate-limit risk;
- integration smoke and rollback.

### Cloud / infrastructure / data

Require evidence for:

- service map;
- IAM/secrets review;
- networking boundary;
- IaC/manual diff;
- deploy plan;
- cost/scaling risk;
- observability proof;
- rollback/recovery plan;
- live smoke in target environment.

### Serious game / Shroudfront-class product

Require evidence for:

- core gameplay loop and progression integrity;
- save/load/data versioning;
- client performance budgets by target device;
- crash/error reporting;
- gameplay telemetry and analytics;
- backend service map for accounts/saves/inventory/commerce/matchmaking if applicable;
- server authority / anti-cheat / abuse model when online;
- launch/patch/rollback strategy;
- known bugs list with severity and owner;
- video/screenshot proof only as a surface-level proof, not the whole proof bank.

### Growth / marketing site

Require evidence for:

- responsive/mobile rendering;
- SEO/meta/social previews;
- form/lead capture proof;
- analytics/attribution instrumentation;
- CDN/cache/performance proof;
- high-traffic launch readiness;
- rollback/deploy proof.

## Status taxonomy

Use the repo-wide four-status model:

| Status | Meaning |
|---|---|
| Built | Code/gate/UI/model exists and was verified. |
| Partial | Artifact slot/docs/policy exists but enforcement is incomplete. |
| Policy/docs only | Written down, but not executable. |
| Missing | Not present. |

Never mark “docs only” as built.

## Commissioning fields

The `enterprise_proof_banks` question group asks for:

- domain proof pack;
- teaching artifacts that show what good looks like;
- scale/concurrency bar;
- observability bar;
- rollback/recovery bar.

Generated adapters store this under `enterpriseProofBank`.

## Finish-line rule

For serious work, `proof/proof.json` is not enough by itself. It must cite the relevant proof-bank dimensions and either attach evidence or record a skip reason. If a run cannot produce required proof, the correct status is `blocked`, not `done`.
