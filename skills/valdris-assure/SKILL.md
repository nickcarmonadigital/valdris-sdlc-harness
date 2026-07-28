---
name: valdris-assure
description: Resolve the Valdris assurance plan before implementation by proving Layer 0, classifying all 13 production assurance domains, and activating applicable AI, async, and domain controls. Select for whole-run assurance state, tier, or coverage; use narrower security or GenAI work skills when that engineering outcome itself is the task.
---

# Valdris Assure

This skill owns the **Assurance** system. Assurance is active across the run; this stage establishes the controls that execution and proof must satisfy.

## Deterministic flow

1. Require passing intake, classification, route, goal, and skill-registry gates. Reject absent, stale, unbound, or rewritten inputs.
2. Read the commissioned project adapter and route-derived workload profiles, stakes profile, effective tier, cross-cutting concerns, domain packs, and gate applicability.
3. When `classification.requiredGates.foundation` is true, produce `foundation/assessment.json` and run `foundation-gate.mjs`, including for controlled docs routes. Resolve product intent, requirements, architecture fit, repository understanding, ownership/risk, required skills, and the proof contract before implementation. When the route does not require foundation assurance, record the route-bound non-applicability reason instead of inferring a skip from the task label.
4. Classify every one of the 13 production assurance domains as required, potentially affected, or not applicable. Resolve every potentially affected decision before the finish line and validate `production/layer-assessment.json` when production assurance applies.
5. Activate AI assurance only when models, prompts, RAG, agents, tools, memory, evals, or AI telemetry are present. Activate async workflow controls across affected domains for queues, retries, idempotency, ordering, concurrency, observability, and recovery.
6. Activate commissioned domain packs only from route/workload signals. Domain packs add requirements; they cannot renumber or weaken the 13-domain baseline.
7. For semantic or authoritative claims, require commissioned acceptance thresholds, semantic proof adapters, workload identity, readiness receipts, and the route-derived effective tier. Later discoveries may add an assurance augmentation; they may not lower a tier or remove a control.
8. Run the applicable foundation, production, AI, domain, eval, and assurance-overlay gates. Record a route-bound reason for every valid non-applicability decision.

## Completion criterion

Assurance is ready only when Layer 0 passes where required; all 13 domains have explicit, resolved states; every detected cross-cutting concern and domain pack is represented; the effective tier cannot be downgraded by an agent; and each applicable gate passes with a concrete artifact.

Missing proof is not a skip. If assurance is ready, hand off to `$valdris-connect-runtime`.
