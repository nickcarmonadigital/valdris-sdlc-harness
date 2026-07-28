---
name: valdris-execute-workflow
description: Execute the work skill selected by a bound Valdris route through small evidence-bearing slices and revision-safe goal checkpoints. Select when the requested outcome is to run, continue, or resume the governed delivery loop; let the route's eight-skill catalog decide whether the actual engineering work is a feature, bug, architecture, security, platform, GenAI, intake, or proof task.
---

# Valdris Execute Workflow

This skill owns **Workflow Execution**. It coordinates the selected work-type skill; it does not reclassify the request.

## Deterministic flow

1. Run the intake, classification, route, goal, foundation, and applicable assurance preflight gates. Stop before mutation if a required pre-implementation artifact fails.
2. Read `run/route.json`. Use its delivery primary as the engineering workflow and only its declared supporting skills. Do not select a more convenient primary or exceed four supporting skills.
3. Run code intelligence before codebase, architecture, debugging, refactor, or cross-file claims. Cite design anchors and refresh the graph whenever a bound source input changes.
4. Inspect the current goal revision, latest checkpoint, remaining risk, budgets, forbidden actions, and stopping conditions. Choose the smallest bounded slice that can produce new evidence.
5. Execute the selected workflow in its declared order. Use failing tests at pre-agreed seams, minimal implementation, task-specific validation, and refactoring under passing checks.
6. Record code, tests, evals, trajectory, migrations, smoke preparation, and affected assurance artifacts. Emit truthful events in Live Run mode.
7. Before any Red Zone action, request scoped human approval and stop. Never treat a user desire for completion as approval for credentials, deployment, billing, customer data, destructive migration, traffic, or provider changes.
8. Verify the slice, then advance `goal/goal.json` only with `goal-transition.mjs --expected-revision <n>`. On stale revision, reload instead of overwriting. Continue only while the next slice is within the immutable budget and adds evidence.
9. Stop as passed, blocked, failed, or escalated. Repeated failure without new evidence triggers RCA or self-heal, not an infinite loop.

## Completion criterion

Execution is complete only when the requested behavior is implemented; acceptance and regression evidence exists; affected controls are updated; every recorded checkpoint transition is revision-safe; no budget or authority boundary was crossed; and the goal is ready for finish-line proof.

Then hand off to `$valdris-prove-govern`.
