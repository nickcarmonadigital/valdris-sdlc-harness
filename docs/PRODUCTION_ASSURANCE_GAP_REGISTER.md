# Production Assurance Gap Register

## Decision

The Layer 0, workload-taxonomy, thirteen-domain, domain-pack, skill-router, and goal-loop design is internally coherent and executable. Asynchronous workflow orchestration is correctly modeled as a cross-cutting concern; adding a fourteenth production domain would weaken the model.

This does **not** make Valdris a self-certifying production authority. The structural gates are suitable for routing and proof orchestration, while the blockers below must be commissioned or implemented before an unattended agent can make strong production-readiness claims.

## Acceptance blockers for strong production claims

| Priority | Gap | Why it matters | Required acceptance test |
|---|---|---|---|
| P1 | Control-specific semantic proof adapters | Typed shape, hashes, and trust metadata do not prove that an arbitrary command or artifact establishes a particular control. | `DATA-RECOVERY-001` must reject `echo pass` plus an unrelated hashed file unless a commissioned recovery adapter recognizes the test, target, assertions, and output schema. |
| P1 | Commissioned acceptance-threshold policy | A metric or eval must not choose its own easy target. | `FE-PERFORMANCE-001` must reject a locally supplied `999999 ms` target when it differs from the route-bound approved threshold. |
| P1 | End-to-end AI workload identity | Model, provider, prompt, tool schema, corpus, memory policy, eval, smoke, and observability must prove the same build identity. | A GPT implementation with a Claude eval packet must fail identity binding. |
| P1 | Authoritative approval-event verification | Approval-shaped JSON and bridge IDs are contracts, not proof that a token-gated human event occurred. | A material unknown edited directly to a human-shaped `granted` approval must fail unless the live bridge ledger independently verifies its event, token correlation, scope, run, artifact digest, and unknown ID. |
| P1 | Effective-tier coverage for eval/smoke/trajectory claims | T3 cannot be closed by locally authored result files outside the typed trust policy. | Eval, smoke, and trajectory completion evidence must satisfy the effective tier and bind to the control/result/config digests they support. |

Until these are resolved, final handoff must distinguish **structural gate conformance** from **provider-backed semantic assurance** and leave external proof conditions open.

## Clean-room residual risk

| Priority | Gap | Why it matters | Required acceptance test |
|---|---|---|---|
| Accepted residual | Pre-existing public Git history retention | The current canonical tree, release artifacts, and newly generated commissioned packs can pass clean-room gates while older public commit objects still retain content removed by a normal PR. Full-history secret scanning detects supported patterns but does not delete Git objects, downstream clones, forks, or caches. | [ADR-0001](decisions/ADR-0001-public-history-retention.md) records owner acceptance for this non-destructive merge. Any future rewrite remains a separate explicitly authorized operation followed by reachable-ref and published-artifact rescanning. |

## Hardening backlog

| Priority | Gap | Intended direction |
|---|---|---|
| P2 | Reviewed monotonic augmentation | Permit a scoped human review to add profiles, cross-cutting concerns, capability packs, gates, or a higher tier with bound rationale/approval while preserving Layer 0 plus the thirteen canonical production domains; never allow the augmentation path to create Layer 14 or remove or downgrade deterministic requirements. |
| P2 | Replayable catalog resolution | Preserve catalog/harness snapshots by digest or resolve a signed version manifest so immutable historical packets can be revalidated after policy upgrades. |
| P2 | Conditional pack features | Make SaaS metering/billing and youth-AI controls conditional on actual product features rather than the broad pack alone. |
| P3 | Provider and approval cryptographic provenance | Independent code review now requires an Ed25519 project-trusted attestation. Extend the same protected-import or signature model to external CI/provider receipts and approval ledgers where the risk justifies it. |

## Closed in the Layer 0 hardening

- Layer 0 is a prerequisite foundation, not production domain 14.
- Temporal, SQS, queues, schedulers, workers, retries, and durable workflows route as cross-cutting orchestration across business logic, data, platform, overload, observability, and recovery.
- Controlled HIPAA, security, rollback, prompt-injection, and payment-policy documents retain tier/concern review without pretending runtime behavior changed.
- Ordinary README/copy work remains lightweight and receives scoped write authority.
- SDKs, CLI packages, static frontends, and React context providers no longer trigger full-stack or live-provider proof accidentally.
- Hard production dependencies are enforced; conditional dependencies do not over-project unrelated domains.
- RBAC, patient data, regulated decisions, realtime state, iOS distribution, and modern AI/provider terms route to the intended concerns and packs.
- Effective assurance tier governs foundation, production, AI, domain, and goal evidence freshness/trust.
- Catalog integrity is unconditional, including inactive domain packs and docs-only routes.
- Skill phases, canonical primaries, supporting skills, immutable initial artifacts, and deterministic task/tier budgets are machine-enforced.

## Closed in the v0.8 clean-room assurance merge

- Restricted project material is excluded from the current canonical tree, release artifacts, and newly generated commissioned packs by project-neutrality and privacy gates; real operational run packets are not committed to those current surfaces. Pre-existing public commit objects remain governed by the accepted residual-risk decision above.
- The only direct-copy surface is an allowlisted, hash-verified MIT public assurance kernel pinned to its upstream commit.
- All source assurance concepts have an explicit Valdris mapping, and schema compatibility rejects unmapped controls, weakened status conversion, unknown tiers, unsafe paths, and any Layer 14 async mapping.
- Async workflow assurance is expressed as five cross-cutting controls spanning the applicable existing domains.
- Proof commands run portably with argv arrays, timeouts, output bounds, repetition, redaction, optional red-baseline evidence, and exact Git/worktree/validator bindings; Windows npm shims run without enabling shell execution.
- Privacy recursively scans the canonical harness tree and generated `.valdris-harness` pack, including generic publishable build directories, evaluates every same-line candidate, and fails closed on binary content unless a shipped public asset matches an approved path and SHA-256. Commissioned target binaries use project policy; generated `graph/` and `design/anchors.json` receive a separate bounded evidence scan.
- Typed RCA is required for bugs (including regressions), incidents, and self-heal corrective work, and binds one regression command and failure signature across distinct existing pre-fix/post-fix commits plus a real source change.
- Independent review requires an Ed25519 signature from a committed project trust store; digest-bound run packets validate canonical intake, classification, route, goal, and route-applicable gate artifacts.

## Proof commands

```bash
npm run catalog:gate
npm run provenance:gate
npm run neutrality:gate
npm run privacy:gate
npm run schema:compat:gate
npm run verify:enterprise-ai
npm run verify:proof-security
npm run verify:run-packet-trust
npm run verify:work-harness-import
npm run verify:harness
npm run knowledge:gate
npm run skills:gate
```

Passing these proves the current structural contract and adversarial regression suite for the checked surfaces. It neither erases the acceptance blockers above nor purges pre-existing public Git history.
