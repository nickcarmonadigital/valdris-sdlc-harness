---
type: Playbook
title: Semantic and Authoritative Assurance
description: Separate structural, semantic, and authoritative claims with commissioned proof adapters, runtime identity, external receipts, and run-packet v3.
resource: controls/authoritative-assurance.v1.json
tags: [semantic-proof, authoritative, runtime, receipts, run-packet]
timestamp: 2026-07-22T00:00:00.000Z
---

# Semantic and Authoritative Assurance

Use this playbook when a user asks whether a result is merely structurally valid, proves workload behavior, or is safe to treat as externally authoritative.

1. Choose `structural`, `semantic`, or `authoritative` before freezing review evidence.
2. Keep the immutable intake, classification, and route. Add discoveries through `uash.assurance-augmentation.v1`; never remove a control or lower a tier.
3. Before implementation, write `uash.requirements-contract.v1` so every requirement reaches acceptance criteria, sealed red tests, eval suites, and goal stopping conditions. Seal the pre-implementation Git fixed point with `uash.implementation-readiness-receipt.v1`; record the first mutation only through a separately signed, later `uash.implementation-start-receipt.v1` that advances the sealed head. Closure also requires `uash.acceptance-results.v1` proving every mapped test and eval suite finished green.
4. For semantic claims, derive profile, workload profiles, environment, T-tier, AI tier, promotion, and learning applicability from immutable route/classification artifacts. Bind eval results, trajectory, smoke, typed tools/calls, durable memory heads, runtime-driver/implementation receipts, economics, and dependency provenance. Require calibrated evidence only when a model is the judge.
5. For authoritative claims, verify every Ed25519 receipt against the operator-held `VALDRIS_AUTHORITY_TRUST_SHA256`. Human approvals must identify a human actor. Require raw-Git-object OCI execution with exact Git/runtime/daemon identities, an isolated secure output root, and inspect-confirmed container cleanup. Require a monotonic bridge-head compare-and-swap derived from the accepted proof-input set and bound to the canonical provider hostname, explicit expected history digest, cumulative checkpoint, externally attested replay interval, protection observations, deterministic operation/resume state, cleanup result, and secure operator receipt root.
6. Require promotion proof when prototype evidence moves to production and learning proof when production failure changes a prompt, tool, skill, eval, or harness rule.
7. For declared MCP/A2A surfaces, require the full typed conformance transcript. Cross-bind `valdris.trace-receipt.v2` to the exact evaluated trajectory and observable trace bytes; store decision evidence, never private chain-of-thought.
8. Run `run-create.mjs --print-accepted-gate-set`, bind the digest into the executor and closure, then run `npm run assurance:readiness -- --level semantic|authoritative`. Create `valdris.run-packet.v3` only after all gaps close. Non-HEAD and v2 packets receive integrity-only structural inspection; full revalidation requires an isolated exact-commit checkout.
9. Stable releases use the protected manual pre-tag workflow only. It accepts a successful commissioned same-repository workflow run, exact release-source manifest, artifact, and commit; revalidates the authoritative closure under the operator-held trust pin; and lets only the ruleset-authorized release App create the stable tag. RC operation remains non-authoritative and cannot enter this stable path.

The default empty authority trust store means authoritative status is unavailable until a real target is commissioned. Never replace missing external authority with agent-authored JSON.
