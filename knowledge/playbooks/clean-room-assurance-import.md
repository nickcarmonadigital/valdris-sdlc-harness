---
type: Playbook
title: Clean-Room Assurance Import
description: Selectively port reusable assurance behavior from a private or project-specific harness without importing its identities, evidence, topology, or operating rules.
tags: [clean-room, assurance, provenance, privacy, portability]
---

# Clean-Room Assurance Import

Use this playbook when a private, employer-owned, customer-specific, or otherwise restricted harness contains useful delivery mechanics that should inform Valdris.

## Authority

Valdris remains the runtime and schema authority:

1. Layer 0 defines the commissioned foundation.
2. The thirteen production-assurance domains remain the shared baseline.
3. Cross-cutting behavior belongs in profiles or capability packs, not a new numbered layer.
4. Project names, people, branch models, providers, environments, commands, and approval owners belong in a generated private adapter.

## Import boundary

Treat the restricted source as behavioral evidence only. Do not copy its prose, code, run packets, logs, incidents, identifiers, repository snapshots, personal setup, provider configuration, or production topology.

Only a separately published source with an immutable revision and compatible license may be imported directly. Record that source in the provenance catalog and map its concepts into current UASH identifiers through a reviewed crosswalk.

## Scope and history boundary

Apply this contract to the current canonical tree, every release artifact assembled from it, and every newly generated commissioned pack. Gate each surface before it is published or used.

Do not equate a clean current tree with purged Git history. A normal merge leaves previously published commit objects intact, and those commits may retain earlier restricted content. A history rewrite, ref replacement, downstream coordination, and any necessary credential revocation are separate destructive work that only the repository owner may authorize. A full-history secret scan detects supported findings; it does not remove them. Keep historical retention recorded as residual risk until the owner explicitly accepts or remediates it.

## Required sequence

```text
provenance
-> neutrality
-> privacy
-> release-artifact privacy behavior verification
-> release-artifact privacy gate
-> schema compatibility
-> portable execution verification
-> existing enterprise/AI verification
-> commissioned-pack verification
```

Every gate is fail-closed. For this canonical repository, privacy walks the harness tree recursively, excluding only explicit non-shipping dependency and cache directories; a binary file is rejected unless its path and SHA-256 match the approved shipped-public-asset inventory. After `npm run build`, `npm run verify:release-privacy` proves the release scanner's adversarial behavior and `npm run privacy:release` scans the deployable `.next` output. A commissioned target uses the pack rule over its committed `.valdris-harness`, not over arbitrary product binaries. After code-intelligence generation, use explicit `--include graph --include design/anchors.json` scope to inspect generated evidence. Product assets remain governed by the target's commissioned asset, privacy, security, and supply-chain policy. A waiver remains a separate approval object and never becomes a passing control result.

## Portable execution

Command proof uses argument arrays with shell execution disabled, bounded time and output, deterministic redaction, repeated-run consistency checks, and binding to run, source revision, environment, and artifact digests. The v0.8 commissioned runtime has one supported layout: a complete, committed `.valdris-harness` directory in the same Git worktree as the target. The review trust store is bound at `.valdris-harness/controls/review-trust.v1.json`. Provider or mutation recipes are commissioned adapters and are never automatic defaults.

## Corrective-work RCA

RCA is required for bug work, including regressions, incidents, and self-heal corrective work. Completion requires runtime evidence for the original symptom and cause, a bound failing pre-fix reproduction, and a bound passing post-fix regression proof. A narrative explanation or a fix without both proof phases cannot close the run.

## Completion evidence

- import decision describing rewrite/import/exclude boundaries;
- immutable upstream provenance manifest and third-party notice;
- schema crosswalk and execution-policy overlay;
- neutral synthetic fixtures;
- recursive privacy coverage with fail-closed binary handling;
- passing provenance, neutrality, privacy, compatibility, execution, catalog, skill, knowledge, enterprise/AI, and harness verifiers on Linux and Windows; and
- a recorded decision for any pre-existing public-history retention risk.
