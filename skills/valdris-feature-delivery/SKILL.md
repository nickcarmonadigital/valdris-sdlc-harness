---
name: valdris-feature-delivery
description: Deliver a feature through Valdris as small verified vertical slices. Use for new behavior, integrations, product changes, APIs, UI, data flows, or full-stack work that needs acceptance criteria, architectural boundaries, tests, production-layer proof, smoke validation, and a reviewable handoff.
---

# Valdris Feature Delivery

1. Confirm the user-visible outcome, acceptance criteria, constraints, and stopping condition.
2. Run code intelligence and cite design anchors before choosing seams.
3. Prefer a tracer-bullet slice that crosses every required layer and is independently verifiable.
4. Record architecture decisions when contracts, data, auth, providers, or deployment topology change.
5. Use `$tdd` at pre-agreed seams: failing test, minimal implementation, refactor under green tests.
6. Classify and prove every affected production layer.
7. Apply the GenAI assurance pack when models, prompts, RAG, agents, tools, or AI data are touched.
8. Run break-it QA, live smoke when relevant, and the finish-line gates.

Keep branches and deployments within the project adapter. Stop for human approval before Red Zone actions.

Done means the acceptance criteria are evidenced, not merely implemented.
