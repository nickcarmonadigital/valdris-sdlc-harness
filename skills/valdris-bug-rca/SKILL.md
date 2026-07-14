---
name: valdris-bug-rca
description: Diagnose and repair bugs under the Valdris proof contract. Select as the delivery primary when the requested outcome is to explain or fix broken, intermittent, slow, regressed, or unexplained behavior through reproduction, root-cause evidence, a narrow fix, regression tests, and verified handoff. Use other domain skills only as support when the defect also affects security, platform, or AI boundaries.
---

# Valdris Bug RCA

1. Load the adapter, authorized intake, bound workload classification, route, current branch state, and smallest relevant context. Run the intake, classification, route, and code-intelligence gates before codebase claims.
2. Resolve the route-required Layer 0 foundation assessment before repair. An audit may report a failing foundation, but a repair may not silently bypass it.
3. Reproduce the symptom with a deterministic command or observable trace.
4. Minimize the case and separate facts from hypotheses.
5. Instrument the boundary locally with synthetic data by default and identify the first incorrect state transition. Production telemetry or customer data requires explicit scoped approval.
6. Write `rca/rca.md` with symptom, reproduction, root cause, blast radius, and rejected hypotheses.
7. Add a failing regression test at the highest stable seam.
8. Apply the smallest fix that removes the proven cause.
9. Run the narrow test, relevant suite, every route-required production control, and break-it QA.

For billing or state-transition bugs, state the business invariant explicitly (for example, one logical purchase produces at most one provider charge across concurrency and retries) and test it at the authoritative boundary.

Keep code repair, incident containment, financial reconciliation, and customer communication as separate authority lanes. Charges, refunds, voids, reconciliation, payment-provider configuration, customer/payment data, production containment, deployment, and customer communication are Red Zone actions.

Use `$diagnosing-bugs` and `$tdd` when available. Do not implement speculative fixes before the cause is evidenced.

Required proof includes reproduction before, passing regression after, affected-layer evidence, and any residual risk.
