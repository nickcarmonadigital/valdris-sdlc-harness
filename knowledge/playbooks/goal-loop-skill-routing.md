---
type: Playbook
title: Goal Loop and Skill Routing
description: Route a request into one primary Valdris skill and execute bounded proof-bearing checkpoints.
resource: skills/registry.json
tags: [goal, loop, skills, routing, proof]
timestamp: 2026-07-12T00:00:00.000Z
---

# Start

Read `skills/registry.json`. Select exactly one primary skill and the smallest supporting set, never more than four.

# Durable State

Write `goal/goal.json` with the objective, owner, authority boundary, budgets, checkpoints, and measurable stopping conditions. Runtime goal/loop features may mirror this state but never replace it.

# Loop

At each checkpoint:

1. Inspect evidence and remaining risk.
2. Choose the smallest bounded action that can advance a stopping condition.
3. Execute within tool, cost, attempt, token, and time budgets.
4. Run the required deterministic, eval, trajectory, production, AI, and proof gates.
5. Continue only with new evidence and remaining authority.

# Finish

A completed goal requires all stopping conditions to pass with typed evidence, no trajectory violation, no exceeded budget, no unresolved Red Zone approval, and an evidence-backed handoff.

# Related

* [Typed Evidence](/concepts/typed-evidence.md)
* [Generative AI Assurance](/playbooks/genai-assurance.md)
* [Production Readiness 13 Layers](/playbooks/production-readiness-13-layers.md)
