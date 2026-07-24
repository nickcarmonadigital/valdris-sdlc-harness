# Universal Commissioning Flow

## Bottom line

The restricted project harness pattern should not be made universal by watering down its rules. It should become a **commissioning system**: scan a repo, interview the human/operator, generate a repo-specific **project adapter**, then install front-door instructions for Claude Code/Codex that force every run through lanes, artifacts, proof gates, and Red Zone approvals.

```text
repo + human interview
→ project-adapter.json / project.yaml
→ AGENTS.md + CLAUDE.md + 00_MAP.md + CONTEXT.md
→ run packet template + validation/red-zone docs
→ Claude Code/Codex uses that adapter instead of freelancing
```

## Layer 0 before production assurance

New commissioned runs keep the stable connector node chain, but the `route` stage now owns two executable prerequisites:

```text
run/intake.json
-> run/workload-classification.json (`uash.workload-classification.v1`)
-> run/route.json (`uash.route.v2`, classification digest-bound)
-> foundation/assessment.json (`uash.foundation-assessment.v1`)
-> 13 production-readiness domains
```

The workload catalog classifies tiers and SaaS, AI/agentic, mobile, regulated, payments, and realtime profiles. The Foundation / Good Looks Like catalog is Layer 0: it establishes product/domain intent, requirements and acceptance, quality attributes, architecture boundaries, data/transaction semantics, engineering/test strategy, and decision ownership before implementation and production evidence.

Layer 0 is not a new connector node and not a fourteenth production domain. Async and multi-agent orchestration are cross-cutting execution concerns governed through the applicable foundation, production, AI, trajectory, authority, and proof gates.

## Terminology calibration

| Operator language                                   | Best term                          | Semantics                                                                               | Taxonomy                                   | Domain-term calibration                                                      |
| --------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| “Make my harness universal”                         | Harness commissioning              | Convert repo/team facts into an AI-operable harness pack                                | Internal Developer Platform / Agentic SDLC | Emerging, strong product term                                                |
| “Questions asked to understand the person and repo” | Commissioning interview            | Structured intake that captures facts code scanning cannot infer                        | Onboarding / discovery workflow            | Standard pattern, product-specific use                                       |
| “Put inside Claude Code or Codex”                   | Agent front door / runtime adapter | Instructions + local tools that make an external coding agent follow the harness        | Agent connector                            | Emerging category                                                            |
| “Use GitNexus in the SDLC flow”                     | Code-intelligence backend          | GitNexus indexes the repo; the harness consumes stable graph/freshness/anchor artifacts | Static analysis / GraphRAG / AgentOps      | GitNexus is vendor/project-specific; code-intelligence gate is standardizing |
| “See what was done / what the agent did”            | Run packet / artifact ledger       | Durable evidence of stages, gates, approvals, proof, and handoff                        | AgentOps / audit trail                     | Standardizing now                                                            |
| “Don’t let agents freelance”                        | Policy/gate engine                 | Mechanical rules that block done without required artifacts                             | SDLC governance                            | Standard concept applied to agents                                           |

## What we extracted from the uploaded harness

The restricted source is a repo-native, project-commissioned harness with:

- `AGENTS.md` and `CLAUDE.md` front doors.
- `00_MAP.md` and `CONTEXT.md` routing.
- Lane contexts under `workspaces/`.
- Mechanical gates under `_core/scripts/` such as proof, RCA, smoke, red-zone, finish-line, anchor, deploy, migration, and coherence checks.
- Stable docs for validation, red zone, support, incidents, deployment, Code Intelligence, answer contracts, and evals.
- Run packet scaffolds under `runs/`.

That is the **project-specific adapter** for its original environment. The universal product should generate the same class of pack for any repo.

## Universal core vs generated adapter

### Universal core

These stay the same across repos:

1. Stage flow: `intake → route → code-intelligence → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff`, where `code-intelligence` is the stable node ID for the GitNexus/code-intelligence gate.
2. Artifact model: every stage writes/verifies a required artifact or records a skip reason.
3. Gate types: pre-flight, revision, escalation, abort, QA/break-it, live-smoke, self-heal.
4. Red Zone model: high-risk mutations need human approval.
5. Proof rule: no artifact, no gate pass; no proof, no done.
6. Agent connector contract: Claude Code/Codex/Hermes emit events and write artifacts.
7. Run packet: task, session, mode, events, proof, approvals, skipped nodes, failures, handoff.
8. Blueprint / Live Run / Replay separation: no fake telemetry.
9. Answer contract: bottom line, why, proof, risk, fix/plan, your call.
10. Layer 0 workload and foundation assurance: route v2 binds the workload classification, and the foundation gate resolves before implementation.
11. Production readiness domain pack: 13 full-stack production domains become required/skipped checks after Layer 0.

### Project adapter

Generated per repo/team:

1. Human/operator preferences.
2. Project identity, users, production definition, worst failure.
3. Source-of-truth order.
4. Repo role, safe edit paths, review-required paths.
5. Branch and deploy model.
6. Validation commands.
7. Red Zone actions and approval owner.
8. Enabled lanes and custom lanes.
9. System design triggers and ADR policy.
10. Workload taxonomy catalog/artifact/gate and route v2 binding policy.
11. Layer 0 foundation catalog/artifact/gate and enforcement policy.
12. Production Readiness Domain Pack defaults and skip policy.
13. Cloud/platform provider/service map, IaC policy, observability, cost/rollback policy.
14. QA plan, break-it QA, and live-smoke criteria.
15. Blueprint / Live Run / Replay telemetry policy.
16. Harness self-healing PR policy.
17. Integration map: GitHub, Linear/Jira, Vercel/AWS/Supabase/etc.

## Commissioning interview question bank

The implementation lives in `scripts/commission-harness.mjs` and exposes the executable question bank via:

```bash
npm run commission:questions
```

Current expanded bank:

- **31 question groups**
- **158 questions**
- **Full index:** [`docs/COMMISSIONING_QUESTION_BANK.md`](COMMISSIONING_QUESTION_BANK.md)

The first 13 groups commission the base control-plane skeleton: operator style, project identity, source of truth, repo/architecture, branch/deploy, validation, Red Zone, lanes, system design, production readiness, cloud/platform, QA/release, and modes/self-healing.

Groups 14–30 commission the operating-intelligence layer, and group 31 captures Apple/iOS platform facts:

1. Good looks like / foundation blueprint.
2. Anti-spaghetti code quality guardrails.
3. Enterprise proof banks / what good looks like.
4. Eval gate.
5. Trajectory evaluation.
6. Context manifest / ICM.
7. Skill registry / progressive disclosure.
8. Memory substrate.
9. Tool registry and hooks.
10. Sandbox manager.
11. Model routing.
12. AI economics ledger.
13. Background PR agents.
14. MCP / A2A interoperability.
15. Production-agent lifecycle.
16. Team harness registry.
17. Human-agent operating protocol.

The product UX should not force users to answer 150 blank fields manually. GitNexus/code-intelligence indexing should pre-fill code-derived facts, defaults should teach what good looks like, and humans should only confirm operating facts code cannot know.

## Good-looks-like foundation model

The recurring user problem is that teams often do not know what a proper foundation or non-spaghetti architecture looks like. Valdris solves this by generating explicit reference docs in every commissioned harness pack:

- `docs/Good Looks Like Foundation.md`
- `docs/Code Quality Guardrails.md`
- `docs/Enterprise Proof Bank.md`
- `docs/Operating Intelligence Layer.md`
- `docs/Team Harness Registry.md`
- `docs/Human Agent Protocol.md`

The generated prose is now paired with executable Layer 0 artifacts: `controls/foundation-layer.v1.json` defines the canonical foundation controls, `foundation/assessment.json` records their status and evidence, and `scripts/foundation-gate.mjs` blocks implementation/finish-line claims when the route requires unresolved foundation work.

See [`docs/GOOD_LOOKS_LIKE_FOUNDATION_MODEL.md`](GOOD_LOOKS_LIKE_FOUNDATION_MODEL.md) for the product pattern.

## Agent install shape

### Claude Code

Generated `CLAUDE.md` should tell Claude:

- Load `project-adapter.json` first.
- If missing, run/ask commissioning questions.
- Follow the node flow.
- Write required artifacts.
- Stop before Red Zone actions.
- Do not claim done without proof.

Future final form:

```text
Claude Code
→ UASH MCP tools / local daemon
→ uash.start_run / uash.write_artifact / uash.fire_gate / uash.request_approval
→ local run packet + cloud visualizer
```

### Codex

Generated `AGENTS.md` should tell Codex:

- Read `00_MAP.md` and `CONTEXT.md`.
- Route by task type.
- Use validation commands from `docs/Validation Commands.md`.
- Treat `project-adapter.json` as the source of repo-specific truth.
- Emit or write events/artifacts through the local bridge when available.

## MVP build sequence

1. **Local commissioning CLI** - implemented now as `npm run commission`.
2. **Repo scanner / code intelligence** - GitNexus-backed index is now preferred via `scripts/code-intelligence-scan.mjs`; local static graph remains disclosed fallback. Extend with GitHub workflows, Python/Rust/Go, Docker, infra, tests.
3. **Generated harness pack** - implemented now: `project-adapter.json`, `project.yaml`, front doors, workload/foundation catalogs and gates, map/router, validation/red-zone docs, run template, review packet.
4. **Claude/Codex command templates** - implemented now: generated Claude slash command plus Codex runtime prompt/front door.
5. **Gate script portability** - implemented: generated packs carry classification, Layer 0 foundation, production, AI/domain, and finish-line gate scripts plus controls, skills, package scripts, and a CI workflow template. v0.8 supports one layout: a committed `.valdris-harness` directory in the target Git worktree, invoked as `node .valdris-harness/scripts/<gate> --repo .` from the target root.
6. **UI commissioning surface** - next: render the question groups in the web app and store adapter drafts.
7. **Connector event enforcement** - implemented now in the local bridge: missing proof/artifacts, missing skip reasons, and missing failure recovery paths block `run.completed`.

## Acceptance criteria for the universal product

A repo is commissioned only when:

- `.valdris-harness/project-adapter.json` exists and validates.
- the complete `.valdris-harness` runtime and review trust store are committed in the target Git worktree before proof execution;
- `workloadTaxonomy` and `foundationAssurance` point to packaged catalogs, artifacts, and executable gates.
- `.valdris-harness/AGENTS.md` and `.valdris-harness/CLAUDE.md` are generated, and bounded discovery-loader blocks are created or safely merged into target-root `AGENTS.md` and `CLAUDE.md`; unsafe files or malformed/duplicate loader markers block commissioning. Immediately before installation, commissioning revalidates both original loader digests, stages both replacements in the target directory, and rolls back the first replacement if the second cannot be installed. The successful loaders are committed with the pack.
- Claude slash-command and Codex runtime prompt front doors are generated.
- Validation commands are explicit.
- clean-room privacy targets `.valdris-harness`, and generated graph/anchor evidence uses the bounded include scan instead of a full product-tree binary policy.
- Red Zone owner and approval-required actions are explicit.
- Source-of-truth order is explicit.
- At least one run packet can be created.
- The portable closure uses `valdris.review.v2` and new `valdris.run-packet.v3`: scout, implementer, verifier, and independent reviewer identities are explicit, evidence-bound, signed, and pairwise distinct on actor, session, and execution IDs; the packet envelope binds `roleProvenanceSha256`, assurance level, and resolved catalogs. Historical v2 packets remain structural evidence only.
- New route packets generate `uash.route.v2`, bind `run/workload-classification.json`, and enforce Layer 0 foundation assurance before implementation.
- A simulated agent run blocks completion when proof is missing.

## Current proof command

```bash
npm run typecheck
npm run dependency:audit
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
npm run verify:work-harness-import
npm run verify:commissioned-portability
npm run verify:harness
```
