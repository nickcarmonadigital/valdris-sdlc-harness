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
5. For authoritative claims, verify every Ed25519 receipt against the operator-held `VALDRIS_AUTHORITY_TRUST_SHA256`. Human approvals must identify a human actor. Require raw-Git-object OCI execution with exact Git/runtime/daemon identities, a hardened private runtime capsule copied from commissioned bytes before the first daemon call, an isolated secure output root, and inspect-confirmed container cleanup. Commission exact CPU, memory, output-byte, total wall-clock, canonical scope, and cleanup-reserve limits; reject runtime substitutions, elapsed-time overrun, or an unbounded reserve. Bind `trusted-host-operator-vs-isolated-untrusted-workload`: the untrusted workload runs as UID/GID 65534 with no host mounts, capsule access, network, or ambient secrets. The host operator, OS administrator roots, executor code, signing key, and receipt roots are trusted. If arbitrary code can execute as one of those principals, apply `external-isolation-required`; the local executor receipt alone is not authoritative. Require `valdris.executor-authority-separation-receipt.v1` from a different commissioned key and actor, binding the executor receipt, authority identity, isolation-policy digest, validator, and external provider while attesting that workload and delivery agent cannot access the authority. The executor receipt must bind the commissioned runtime and the capsule content, path, mode, stable root identity, authority identity, and isolation-policy digest. Require the built-in GitHub monotonic bridge-head validator for stable release until another provider adapter ships an executable authoritative validator.
6. Require promotion proof when prototype evidence moves to production and learning proof when production failure changes a prompt, tool, skill, eval, or harness rule.
7. For declared MCP/A2A surfaces, require the full typed conformance transcript. Cross-bind `valdris.trace-receipt.v2` to the exact evaluated trajectory and observable trace bytes; store decision evidence, never private chain-of-thought.
8. Run `run-create.mjs --print-accepted-gate-set`, bind the digest into the executor and closure, then run `npm run assurance:readiness -- --level semantic|authoritative`. Create `valdris.run-packet.v3` only after all gaps close. Non-HEAD and v2 packets receive integrity-only structural inspection; full revalidation requires an isolated exact-commit checkout.
9. Stable releases use the protected manual pre-tag workflow only. It accepts a successful commissioned same-repository workflow run, exact release-source manifest, artifact, and commit; revalidates the authoritative closure under the operator-held trust pin; and lets only the ruleset-authorized release App create the stable tag. RC operation remains non-authoritative and cannot enter this stable path.

The default empty authority trust store means authoritative status is unavailable until a real target is commissioned. Never replace missing external authority with agent-authored JSON.
