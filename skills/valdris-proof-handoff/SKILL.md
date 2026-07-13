---
name: valdris-proof-handoff
description: Validate a Valdris run packet and produce the final readiness decision and handoff. Select as the primary for verify-before-merge, release-readiness review, issue closure, final proof, or handoff after delivery work is complete. This skill decides whether evidence supports done; it does not perform feature implementation, defect repair, infrastructure changes, or the release operation itself.
---

# Valdris Proof And Handoff

1. Validate the goal stopping conditions and latest checkpoint.
2. Run the always-required goal, context, skill-registry, and proof gates, plus code-intelligence, production, AI-assurance, eval, trajectory, smoke, and domain-pack gates when the adapter and route make them applicable. Verify every non-applicability decision rather than assuming every possible gate is unconditional.
3. Verify artifact paths, hashes, environment, commit/deployment identity, freshness, and semantic pass criteria.
4. Reject unjustified skips, stale evidence, unsupported status claims, failed dependencies, agent-granted approvals, and fake self-heal events.
5. Confirm every Red Zone approval was granted by the scoped human owner. Before live completion, require token-gated human approval with scope `route` and artifact `run/route.json`; the bridge binds approval to the route digest.
6. For TestFlight/App Store release, require the token-gated grant to name `domain/assurance.json`, use the predeclared `bridgeEventId`, and remain bound to the current domain packet digest/build identity.
7. Treat CI/provider trust fields as contracts, not cryptographic proof by themselves. Release claims require imported provider receipts or signed attestations where the commissioned policy demands them.
8. Write `handoff/final.md` with bottom line, why, proof paths, risks, rollback, skipped controls, self-heal state, and the next human decision.

No proof means not done. A failed required gate means blocked, even when the implementation appears to work.
