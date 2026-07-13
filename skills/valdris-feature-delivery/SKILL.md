---
name: valdris-feature-delivery
description: Deliver a feature through Valdris as small verified vertical slices. Select as the delivery primary when the user clearly asks to build or implement new behavior, an integration, product change, API, UI, data flow, game, mobile app, or full-stack application. Establish the intake/route phase first when its artifacts are absent. Add architecture, security, platform, and GenAI skills only as supporting risk lanes; use valdris-intake-route as primary only when the requested outcome itself remains unclear.
---

# Valdris Feature Delivery

If `run/intake.json` or `run/route.json` is absent, establish the intake phase with `$valdris-intake-route` or the installed deterministic router before beginning delivery. The intake skill is primary for that phase; return to this skill as delivery primary after the route is bound.

1. Confirm the user-visible outcome, acceptance criteria, constraints, and stopping condition.
2. Run code intelligence and cite design anchors before choosing seams.
3. Prefer a tracer-bullet slice that crosses every required layer and is independently verifiable.
4. Record architecture decisions when contracts, data, auth, providers, or deployment topology change.
5. Use test-driven delivery at pre-agreed seams: failing test, minimal implementation, refactor under green tests. Invoke `$tdd` when that supporting skill is installed.
6. Classify and prove every affected production layer.
7. Apply the GenAI assurance pack when models, prompts, RAG, agents, tools, or AI data are touched.
8. Run break-it QA, live smoke when relevant, and the finish-line gates.

Keep branches and deployments within the project adapter. Stop for human approval before Red Zone actions.

Done means the acceptance criteria are evidenced, not merely implemented.
