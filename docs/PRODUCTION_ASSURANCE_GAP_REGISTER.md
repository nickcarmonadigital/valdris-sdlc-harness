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
| P1 | Immutable or read-only proof execution | Pre/post worktree snapshots detect net mutation, but a command can temporarily change application source, execute against that content, and restore it before the post-command snapshot. | An adversarial proof command that mutates a tracked application file, observes the changed content, restores the original bytes, and exits zero must be rejected by an isolated immutable/read-only execution model. |
| P1 | Offline rollback-resistant bridge head | HMAC-bound snapshots and journals reject edits, forged events, and rollback below the head observed by the running bridge, but a stopped process has no external monotonic counter. An operator with old valid copies of both files can restore a prior authenticated prefix before restart. | After bridge restart, restoring an older valid snapshot/journal pair must fail against a protected remote, WORM, TPM, or equivalent monotonic head service that is outside `UASH_DATA_DIR`. |

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
- Proof commands run portably with argv arrays, timeouts, output bounds, repetition, redaction, optional red-baseline evidence, and exact pre/post Git/worktree/validator bindings; Windows npm shims run without enabling shell execution. These snapshots reject net mutation and later post-proof changes, but do not close the transient mutate-and-restore blocker above. The v0.8 bridge likewise revalidates the commissioned runtime before every nested gate and after the gate sequence, but its validate-then-spawn pathname interval is not an immutable execution environment and remains covered by this same open P1 blocker.
- Privacy recursively scans the canonical harness tree and generated `.valdris-harness` pack, evaluates every same-line candidate, and fails closed on binary content unless a shipped public asset matches an approved path and SHA-256. After `next build`, a separate release-artifact mode scans the otherwise ignored `.next` production text surfaces for high-confidence credentials and deployable local-user paths, permits only known binary asset extensions, and fails closed on unscannable executable/config content; its focused verifier proves generated caches, development output, source maps, traces, dependency traces, build-root metadata, and expected binary assets do not create false positives while binary code and an embedded server-bundle credential fail. Commissioned target binaries use project policy; generated `graph/` and `design/anchors.json` receive a separate bounded evidence scan.
- Typed RCA is required for bugs (including regressions), incidents, and self-heal corrective work, and binds one regression command and failure signature across distinct existing pre-fix/post-fix commits plus a real source change.
- Independent review requires an Ed25519 signature from a committed project trust store; digest-bound run packets validate canonical intake, classification, route, goal, and route-applicable gate artifacts.
- Context manifests now commission a provider-neutral repo-specific case set, answer key, baseline mode, metric direction, candidate threshold, and positive minimum delta. The eval gate requires paired `uash.context-arm-result.v1` JSON documents bound to the exact manifest, derives aggregate score/case count/critical-regression count from ordered per-case evidence, requires identical evaluator/model/prompt/config identities, and fails closed when the comparison is absent, stale, or detached from its result bytes.
- Bridge state transitions are serialized per canonical run ID and journal-first; lossy storage aliases are rejected and a data-directory lease prevents multi-process writers. A separate exclusive recovery mutex covers stale-main-lease revalidation, unlink, and replacement, closing the concurrent-reclaimer race; malformed or stale recovery mutexes require explicit operator cleanup instead of automatic theft. Atomic snapshot replacement, incomplete-tail recovery, first-event seal replay, and run-ID-bound HMAC bindings over the immutable commissioning record, derived snapshot, event journal, and artifact SHA-256 claims prevent concurrent event loss, forged replay, crash-gap baseline adoption, persistent post-claim artifact drift, and commissioned-to-local downgrade. Required artifact bytes are rechecked before and after finish-line gates. Three distinct credentials are mandatory at startup: the bridge-only integrity key authenticates state, the ordinary access token authorizes API reads/writes and the server-side UI proxy, and the human approval token additionally authorizes grant/deny events. Raw credentials are never persisted, agents never receive the integrity or human token, and there is no ambiguous unsigned mode.

## Proof commands

```bash
npm run typecheck
npm run build
npm run knowledge:gate
npm run skills:gate
npm run catalog:gate
npm run provenance:gate
npm run neutrality:gate
npm run privacy:gate
npm run verify:release-privacy
npm run privacy:release
npm run schema:compat:gate
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:enterprise-ai
npm run verify:proof-security
npm run verify:run-packet-trust
npm run verify:work-harness-import
npm run verify:commissioned-portability
npm run verify:harness
```

Passing these proves the current structural contract and adversarial regression suite for the checked surfaces. It neither erases the acceptance blockers above nor purges pre-existing public Git history.
