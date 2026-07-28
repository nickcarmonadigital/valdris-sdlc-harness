---
name: valdris-route-goal
description: Turn an authorized request into deterministic intake, workload classification, an immutable Valdris route, and a durable budget-controlled goal. Select for starting or inspecting a Valdris run or resolving lifecycle ambiguity; ordinary feature, bug, audit, or release execution still uses the delivery primary recorded by this stage.
---

# Valdris Route And Goal

This skill owns **Routing and Goal Control**. It decides what Valdris must do and what evidence will stop the loop. It never hand-writes a weaker route to avoid a gate.

## Deterministic flow

1. Require a committed commissioned pack. If `.valdris-harness/project-adapter.json` is absent or stale, stop and hand off to `$valdris-commission`.
2. Capture the exact requested outcome, exclusions, affected users, environment, operator, authority boundary, and measurable stopping condition. Ask only when an answer changes scope, architecture, authority, or proof.
3. Run the deterministic router from the target root:

   `node .valdris-harness/scripts/route-request.mjs --repo . --profile <profile> --actor "<owner>" --request "<request>"`

4. Validate `run/intake.json`, `run/workload-classification.json`, `run/route.json`, and `goal/goal.json` with the intake, classification, route, goal, and skill-registry gates.
5. Confirm the route contains exactly three work phases: intake-route, delivery, and proof-handoff. Confirm it selects one delivery primary from the eight work-type skills and no more than four supporting skills.
6. Confirm the route keeps Layer 0 plus the 13 production assurance domains authoritative. AI, async workflow, orchestration, and specialized products remain cross-cutting concerns or domain packs, never Layer 14.
7. Review material unknowns, Red Zone actions, attempt/tool/token/cost/wall-clock budgets, forbidden sequences, checkpoints, and stopping conditions. Do not increase budgets or rewrite the initial route in place; a material scope change starts a new reviewed run.

## Completion criterion

This stage is complete only when all four artifacts exist, their digests bind to one request/run/commit/environment, every gate above passes, the route's work-skill choice matches the deterministic classifier, and the operator can state what ends the goal loop.

If classification or authority is unresolved, stay here. If the route is valid, hand off to `$valdris-assure`.
