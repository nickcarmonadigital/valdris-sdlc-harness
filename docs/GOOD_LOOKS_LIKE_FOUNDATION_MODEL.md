# Good Looks Like / Foundation Model

## Bottom line

People struggle because they are asked to build features before they have a picture of a healthy system. Valdris should not only ask “what app do you want?” It should commission a **reference foundation** and then grade work against it.

The solution is a three-part product pattern:

```text
1. Foundation blueprint — what a healthy repo/infrastructure shape looks like.
2. Code quality guardrails — what spaghetti looks like and when to stop/refactor.
3. Enterprise proof bank — what proof is required before “done.”
```

## Term calibration

| Nick-language | Best term | Meaning |
|---|---|---|
| “People don't know what good looks like” | Reference architecture / quality model | A concrete target shape agents and humans compare work against. |
| “Proper foundation of infrastructure” | Platform foundation / production readiness baseline | The minimum infra, CI/CD, security, data, observability, rollback, and ownership layers needed before serious velocity. |
| “How not to make spaghetti code” | Architectural guardrails / code quality gates | Boundary and dependency rules that prevent unrelated logic from tangling together. |

## Foundation blueprint

Every commissioned repo should define:

1. **Target architecture style** — modular monolith, service-oriented, event-driven, etc.
2. **Reference architecture** — UI/API/domain/data/provider/job boundaries.
3. **Foundation layers** — auth, data model, validation, tests, CI/CD, env config, observability, rollback, security, runbooks, ownership.
4. **Weak-foundation signals** — business logic in UI/routes, no typed contracts, unclear ownership, hidden provider coupling, no rollback, no logs.
5. **Golden path** — the normal way a feature should move from issue to proof.
6. **Foundation decision owner** — who can say “stop feature work; fix the base first.”

## Anti-spaghetti guardrails

A repo is drifting toward spaghetti when agents need to:

- copy/paste business logic;
- touch unrelated files for one change;
- mix UI, auth, DB, provider, and business logic in one route/component;
- add silent fallbacks because required data is missing;
- bypass tests because the boundaries are hard to test;
- add special cases instead of a clear interface;
- make changes without knowing the blast radius.

Valdris should block or request review when these appear.

## Enterprise proof bank

“Good” must be artifact-backed. A serious build needs proof across:

1. Functional correctness.
2. Scale / concurrency.
3. Reliability / recovery.
4. Security / auth / tenant boundaries.
5. Data integrity.
6. Observability.
7. Cost / FinOps.
8. Performance.
9. Domain-specific proof.
10. Live smoke.
11. Operator handoff.

## Product behavior

In the final product, onboarding should show examples and defaults so a non-expert is not staring at a blank form.

Example UX:

```text
Question: Which architecture style should this repo follow?
Default recommendation: modular monolith.
Why: easiest to reason about, least distributed complexity, can split later when scale/team boundaries prove it.
Bad signs: business logic in components, duplicated provider calls, unclear data boundary.
Good proof: service map + typed API contracts + tests at domain/API layers.
```

## Harness rule

Feature work can only proceed if the task fits the foundation. If the task requires more spaghetti, the correct output is not “feature done.” The correct output is:

```text
foundation gap detected
→ explain why feature work would worsen the system
→ propose smallest foundation fix
→ get approval if scope/risk expands
→ then implement feature through the clean boundary
```
