# Commissioning Question Bank

The commissioning interview turns a repo/team into a project-specific Valdris SDLC Harness adapter.

- **Question groups:** 30
- **Questions:** 150
- **Executable source of truth:** `scripts/commission-harness.mjs --print-questions`
- **Verification:** `npm run verify:harness` asserts the expanded bank, generated adapter fields, and generated docs.

## Operating rule

Graphify/code scan should pre-fill code-derived facts. The human interview should focus on operating facts code cannot know: production meaning, approval owners, quality bars, source-of-truth order, what good looks like, and what must be blocked.

## Group index

1. **Person / team operating style** — operator, answer style, autonomy, annoyances.
2. **Project identity** — product, users, production meaning, worst agent failure.
3. **Source of truth** — conflict precedence, issue tracker, docs/KB.
4. **Repo and architecture** — repo role, safe paths, review-required paths, Graphify policy.
5. **Branch and deploy model** — branches/environments, merge/deploy owner, deploy proof.
6. **Validation and proof** — install/lint/type/test/build/smoke commands, done definition.
7. **Red Zone / approval boundaries** — approval-required actions, approval owner, read-only policy.
8. **Work lanes** — enabled/custom lanes and ADR policy.
9. **System design** — design triggers, design requirements, ADR-required decisions.
10. **Production readiness layer pack** — 13 full-stack layers, skip policy, proof.
11. **Cloud / platform engineering** — providers, services, IaC, observability, cost/rollback.
12. **QA and release** — QA plan, break-it QA, live smoke.
13. **Modes and self-healing** — Blueprint/Live/Replay policy and self-heal PR policy.
14. **Good looks like / foundation blueprint** — target architecture, reference architecture, weak-foundation signals, golden path.
15. **Anti-spaghetti code quality guardrails** — module boundaries, dependency direction, smells, complexity budget, refactor triggers.
16. **Enterprise proof banks / what good looks like** — domain pack, teaching artifacts, scale bar, observability bar, rollback bar.
17. **Eval gate** — eval-required changes, dataset owner, thresholds, run location, eval artifacts.
18. **Trajectory evaluation** — bad agent paths, retry limits, forbidden sequences, scoring, trace artifacts.
19. **Context manifest / ICM** — always-load context, lane context, approval context, staleness, budget, artifacts.
20. **Skill registry / progressive disclosure** — inventory, owners, activation, tool permissions, proof, registry artifacts.
21. **Memory substrate** — what to remember, what never to remember, review owner, retention, handoff, evals.
22. **Tool registry and hooks** — free/approval/forbidden tools, pre-tool hooks, post-edit hooks, audit logs.
23. **Sandbox manager** — isolation, filesystem roots, network, secrets, cleanup, escape proof.
24. **Model routing** — lane model policy, strong/cheap model cases, fallback, logging, quality gate.
25. **AI economics ledger** — run budget, token tracking, human review tracking, retry cost, spend approval, cost handoff.
26. **Background PR agents** — async agent policy, branch/PR policy, reviewers, proof, stale cleanup.
27. **MCP / A2A interoperability** — MCP tools, allowed runtimes, A2A need, auth/roots, live event definition.
28. **Production-agent lifecycle** — agent definition, lifecycle states, promotion gates, observability, rollback owner.
29. **Team harness registry** — harness/prompt/eval/connector owners, approval, drift checks.
30. **Human-agent operating protocol** — decision owner, reviewers, escalation, SLA, contact channels, approval contract.

## Why groups 14–16 exist

Most teams do not know what good engineering foundation looks like. Without an explicit reference model, agents optimize for local completion and slowly create spaghetti.

Valdris solves that by commissioning a **foundation blueprint** before feature work:

```text
reference architecture
+ foundation layers
+ weak-foundation signals
+ module/dependency boundaries
+ code smell blockers
+ enterprise proof banks
= agents know when to build vs when to stop and fix foundation
```

## Generated pack docs

The expanded generator now emits these additional docs into each commissioned pack:

- `docs/Good Looks Like Foundation.md`
- `docs/Code Quality Guardrails.md`
- `docs/Enterprise Proof Bank.md`
- `docs/Operating Intelligence Layer.md`
- `docs/Team Harness Registry.md`
- `docs/Human Agent Protocol.md`

## Human-facing positioning

The interview is not meant to make users answer 150 questions manually every time. The product should:

1. scan the repo first,
2. pre-fill what code can know,
3. ask the human only for operating facts,
4. show defaults and examples of what good looks like,
5. generate the adapter and proof docs,
6. run a first verifier/simulation before agents can work.
