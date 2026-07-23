---
name: valdris-feature-delivery
description: Deliver a feature through Valdris as small verified vertical slices. Select as the delivery primary when the user clearly asks to build or implement new behavior, an integration, product change, API, UI, data flow, game, mobile app, or full-stack application. Establish and bind workload classification, then resolve the Layer 0 foundation gate before implementation. Add architecture, security, platform, and GenAI skills only as supporting risk lanes.
---

# Valdris Feature Delivery

If `run/intake.json`, `run/workload-classification.json`, or `run/route.json` is absent, establish the intake phase with `$valdris-intake-route` or the installed deterministic router before beginning delivery. The intake skill is primary for that phase; return to this skill as delivery primary after the classification and route are bound.

Before implementation, require `run/workload-classification.json` to pass the classification gate and `foundation/assessment.json` to pass the Layer 0 foundation gate. Layer 0 resolves the required capabilities, effective assurance tier, workload and stakes profiles, and proof contract for the build; prose about a good foundation is not a substitute for the gated artifact. For semantic or authoritative delivery, resolve the contract and failing-baseline paths and seal `run/implementation-readiness.json` before the first implementation mutation. Its externally signed `uash.implementation-readiness-receipt.v1` seals the readiness head; a separate later `uash.implementation-start-receipt.v1` must advance that head and bind the first mutation evidence. One backfilled receipt cannot prove both events.

1. Confirm the user-visible outcome, acceptance criteria, constraints, and stopping condition.
2. Run code intelligence and cite design anchors before choosing seams.
3. Prefer a tracer-bullet slice that crosses every required seam and assurance domain and is independently verifiable.
4. Record architecture decisions when contracts, data, auth, providers, or deployment topology change.
5. Use test-driven delivery at pre-agreed seams: failing test, minimal implementation, refactor under green tests. Invoke `$tdd` when that supporting skill is installed.
6. Classify and prove every affected production assurance domain. The 13 canonical domains are the shared baseline, not an exhaustive list of literal runtime layers.
7. Apply the GenAI assurance pack when models, prompts, RAG, agents, tools, or AI data are touched.
8. For semantic or authoritative claims, create the commissioned semantic proof, runtime session, AI-change review, and applicable promotion/learning artifacts; validate them before final review.
9. Run break-it QA, live smoke when relevant, and the finish-line gates.

Asynchronous orchestration is cross-cutting: assess its queues, retries, idempotency, ordering, observability, scaling, and recovery effects in every applicable domain rather than inventing a separate production domain.

Keep branches and deployments within the project adapter. Stop for human approval before Red Zone actions.

Done means the acceptance criteria are evidenced, not merely implemented.
