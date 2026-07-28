---
name: valdris-trust-improve
description: Decide the strongest supportable Valdris trust level, perform an authorized promotion or handoff, and close verified failures into governed learning. Select for final trust, semantic or authoritative release eligibility, promotion, self-healing, or lessons learned after a run packet already exists.
---

# Valdris Trust And Improve

This skill owns **Trust and Improvement**. It decides what the proved run is allowed to claim and what Valdris should learn from it.

## Deterministic flow

1. Require a passing `valdris.run-packet.v3`. Revalidate its exact commit and packet-bound runtime; never silently upgrade historical structural evidence.
2. Run assurance readiness and classify the strongest supported claim:
   - **structural**: required artifacts, schemas, bindings, and coverage are valid;
   - **semantic**: commissioned adapters and thresholds prove the intended behavior;
   - **authoritative**: an independent trusted runner, provider, signer, or authority attests the result with rollback-resistant state.
3. Refuse semantic or authoritative labels when acceptance policies, workload identity, executor receipts, provider receipts, bridge-head receipts, or operator-pinned authority are missing, stale, replayed, or mismatched.
4. If promotion or release is requested, run the commissioned authoritative release gate. Obtain the scoped human decision and write `release/promotion.json` only after technical proof passes.
5. Write `handoff/final.md` with bottom line, supported trust level, why, proof paths, unresolved risk, rollback, skipped controls, and the next human decision.
6. If application behavior failed, return to the routed work skill with RCA and regression proof. If the harness or process failed, write `self_heal/self_heal_report.md`, propose the smallest correction, and keep it blocked until independently reviewed.
7. When production learning changes a control, threshold, skill, or policy, write and validate `learning/feedback-loop.json`. Bind the failure, RCA, regression, reviewed change, expiry, and rollback. Do not let one run rewrite policy for all future runs without governance.
8. Re-run privacy and installed-skill drift checks after release or harness learning.

## Completion criterion

The lifecycle is complete only when the final claim does not exceed its evidence; any promotion is technically passing, human-authorized, and provider-backed where required; `handoff/final.md` supports the next decision; and every harness/process failure has a reviewed learning or remains explicitly open.

No proof means not done. No authority means not promoted.
