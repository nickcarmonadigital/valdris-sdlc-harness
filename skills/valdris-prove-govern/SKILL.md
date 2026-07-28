---
name: valdris-prove-govern
description: Turn completed Valdris execution into typed evidence, applicable gate results, scoped approvals, independent review, and a frozen run packet. Select for the proof-and-governance system or finish-line assembly; use valdris-proof-handoff as the work-phase primary when the route itself is at final review.
---

# Valdris Prove And Govern

This skill owns **Proof and Governance**. It converts an implementation claim into a reviewable completion candidate. It cannot make failed behavior pass.

## Deterministic flow

1. Freeze implementation scope and verify the current intake, classification, route, goal, source commit, environment, catalogs, and evidence identities.
2. Run every always-required gate and every route-applicable code-intelligence, foundation, production, AI, domain, eval, trajectory, smoke, RCA, privacy, provenance, neutrality, schema, and authoritative-assurance gate. Validate non-applicability instead of assuming it.
3. Produce typed proof at `proof/proof.json` or the commissioned portable proof path. Command success alone is not semantic proof; assertions must establish the named behavior or control.
4. Obtain token-gated route and Red Zone approvals only when required. Approval authorizes a scoped decision; it does not replace missing or failed technical evidence.
5. Print the accepted gate set and frozen evidence-bundle digest with `run-create.mjs`. After the freeze, reject source, route, catalog, trust-store, evidence, or gate mutation.
6. Commission exactly four distinct roles: scout, implementer, verifier, and independent reviewer. The independent reviewer signs the full roster and frozen evidence bundle with an active operator-commissioned key.
7. Create `run/packet.json` as `valdris.run-packet.v3`, binding the assurance level, resolved catalog snapshots, artifacts, proof, review, applicable RCA, approvals, executor receipts, and bridge-head receipts.
8. Run `run-packet-gate.mjs` and the finish-line gates. Treat historical v2 packets as structural history only.

## Completion criterion

This stage passes only when all required gates pass; proof and review bind the same frozen evidence; all four roles are independent; required approvals are human and artifact-bound; and `run/packet.json` validates without post-freeze mutation.

Any failed required gate means blocked. A valid packet hands off to `$valdris-trust-improve`.
