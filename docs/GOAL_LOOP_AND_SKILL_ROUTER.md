# Goal Loop and Eight-Skill Router

Valdris turns a request into a durable goal, routes it through one primary workflow skill, adds only the supporting skills justified by risk, and blocks completion until stopping conditions and proof gates pass.

## Router

The selectable catalog is intentionally small:

| Primary skill | Use it for |
|---|---|
| `valdris-intake-route` | Ambiguous requests, initial audits, greenfield classification. |
| `valdris-bug-rca` | Bugs, regressions, performance failures, incident diagnosis. |
| `valdris-feature-delivery` | Features, integrations, and vertical full-stack delivery. |
| `valdris-architecture-refactor` | Architecture, migrations, refactors, and technical debt. |
| `valdris-security-audit` | Auth, permissions, privacy, security, and compliance reviews. |
| `valdris-platform-release` | Cloud, CI/CD, deploy, SLO, rollback, backup, failover, incidents. |
| `valdris-genai-assurance` | Models, prompts, agents, RAG, embeddings, tools, memory, evals. |
| `valdris-proof-handoff` | Final verification, release readiness, and evidence-backed handoff. |

Select exactly one primary skill. Add no more than four supporting skills, and only when their risk domain is present. The registry is machine-validated with `npm run skills:gate`.

`run/intake.json` preserves the human request digest and authority boundary. `run/route.json` binds that intake to three skill phases, all thirteen initial layer decisions, AI profile/features, domain triggers, gate applicability, and SHA-256 digests for the registry and control catalogs. `npm run route:gate` rejects missing trigger-driven packs and registry/catalog drift.

Create the starting artifacts deterministically with `npm run route:request -- --repo . --profile enterprise --actor "<owner>" --request "<request>"`. The router uses explicit keyword/risk rules and conservative defaults; it does not pretend an LLM classification is trusted policy. Review architecture-changing unknowns before delivery begins.

## Durable goal loop

`goal/goal.json` is the protocol-independent source of truth. It binds goal ID, current Git commit, environment, profile, budgets, stopping conditions, and checkpoints:

```text
request
  -> intake and authority boundary
  -> one primary skill + supporting skills
  -> objective + measurable stopping conditions + budgets
  -> checkpoint: inspect evidence and remaining risk
  -> act: smallest bounded implementation slice
  -> verify: deterministic tests, evals, trajectory, production controls
  -> govern: current waiver ledger + token-gated human approvals
  -> loop if budgets and authority permit
  -> human approval at Red Zone
  -> finish only when every stopping condition and required gate passes
```

Budgets cover attempts, tool calls, tokens, cost, and wall-clock minutes. A loop that exceeds a budget, enters a forbidden sequence, or repeats failures without new evidence is blocked rather than declared done.

Update loop state through `goal-transition.mjs` with an expected revision. It acquires an exclusive goal-file lock, compares the expected revision while holding that lock, validates the resulting goal, and atomically replaces the file. A concurrent or stale agent cannot overwrite a newer checkpoint silently. Passing a stopping condition also requires a typed-evidence JSON array.

```bash
node .valdris-harness/scripts/goal-transition.mjs --repo . --expected-revision 1 --checkpoint intake-route --checkpoint-status passed --summary "Route reviewed"
```

The aggregate gate binds intake, route, goal, context, code-intelligence/anchors when required, production, AI, domain, eval, trajectory, live smoke when required, and waiver artifacts to one run/profile/commit/environment. The goal pins the authorized intake request and initial route digests. It enforces profile-specific freshness against current time and compares the commit with Git HEAD when available. Before accepting `run.completed`, the live bridge also requires token-gated human approval of the current `run/route.json` digest; proof and handoff remain non-skippable invariants.

Typed `ci-attested` and `provider-attested` fields are validation contracts, not cryptographic identities by themselves. Production release evidence should come from protected CI/provider imports or signed attestations. The bridge correlates route, waiver, and domain approval evidence to token-gated human events, but Valdris does not turn a locally authored provider-shaped JSON object into an Apple or compliance certification.

For iOS, the route snapshots the authoritative adapter's scheme, bundle/team reference, macOS runner, and commissioning digest. The mobile domain packet adds one immutable build ID. Native quality, archive, distribution, and Apple smoke evidence must bind to that same identity; mismatched app/build evidence blocks the aggregate finish line.

Apple release approval is also artifact-bound: the human grant uses a predeclared event ID and names `domain/assurance.json`; the bridge records its digest. `IOS-DISTRIBUTION-001.bridgeEventId` must match that token-gated event, and the approved digest must still equal the current domain packet at completion. A build swap after approval is blocked.

## Example: “Build me a full-stack iOS game”

The route would normally use `valdris-feature-delivery` as primary, with `valdris-platform-release`, `valdris-security-audit`, `valdris-genai-assurance` only if the game includes AI, and `valdris-proof-handoff` as supporting skills.

The goal should split into evidence-bearing milestones such as:

- Swift/SwiftUI or engine-based iOS client with game-state and offline/error behavior.
- Versioned backend contract, authoritative game logic, idempotency, abuse controls, and request tracing.
- Data model, migrations, tenant/player boundaries, backups, restore evidence, and retention/deletion policy.
- Identity, sessions, entitlements, parental/privacy requirements where applicable, and negative authorization tests.
- CI from source to signed artifact, dependency/supply-chain checks, a macOS/Xcode build runner, TestFlight staging, and rollback/release controls.
- Performance, concurrency, cost, SLOs, dashboards, alerts, incident path, RTO/RPO, and live smoke.
- If AI is used: versioned prompts/models, adversarial evals, tool boundaries, content safety, memory/RAG isolation, cost budgets, canary, and model rollback.

Valdris can commission and govern Codex, Claude Code, or another external coding agent through this durable goal/checkpoint loop; the runtime still performs the engineering actions. Valdris cannot manufacture unavailable authority or platform access. iOS signing, App Store Connect/TestFlight publication, production cloud changes, billing, secrets, and destructive migrations remain Red Zone actions. On a Windows host, actual iOS compilation and simulator/device proof require an authorized macOS/Xcode runner; until that evidence exists the corresponding stopping condition remains open.

## Runtime adapters

- Codex: use the repository skills and artifacts; a runtime goal may mirror Valdris state but not replace it.
- Claude Code: use the generated command/front door, hooks, and event bridge under the same artifact contract.
- MCP: expose bounded tools/resources and events; do not rely on experimental task semantics as durable state.
- A2A: use for cross-agent delegation only when the commissioned trust model requires it.

The primary-source runtime design, invocation rules, and golden-path acceptance tests are in `research/enterprise-ai-2026/agent-workflows.md`.
