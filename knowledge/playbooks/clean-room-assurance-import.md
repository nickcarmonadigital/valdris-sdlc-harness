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
-> runtime restricted-residue scan across repository, release archive, generated packs, knowledge, and installed-skill manifest
-> release-artifact privacy behavior verification
-> release-artifact privacy gate
-> schema compatibility
-> portable execution verification
-> existing enterprise/AI verification
-> commissioned-pack verification
```

Every gate is fail-closed. For this canonical repository, privacy walks the harness tree recursively, excluding only explicit non-shipping dependency and cache directories; a binary file is rejected unless its path and SHA-256 match the approved shipped-public-asset inventory. After `npm run build`, `npm run verify:release-privacy` proves the release scanner's adversarial behavior and `npm run privacy:release` scans the deployable `.next` output. A commissioned target uses the pack rule over its committed `.valdris-harness`, not over arbitrary product binaries. After code-intelligence generation, use explicit `--include graph --include design/anchors.json` scope to inspect generated evidence. Product assets remain governed by the target's commissioned asset, privacy, security, and supply-chain policy. A waiver remains a separate approval object and never becomes a passing control result.

Restricted private names, issue prefixes, and paths are supplied only through an external `valdris.restricted-residue-input.v1` manifest. Run `restricted-residue-gate.mjs` against the public repository plus every release tar/tgz, generated pack, knowledge vault, and installed-skill manifest. The gate emits only fixed surface identifiers and redaction categories; it emits no matched values, paths, names, or dictionary-reversible hashes. Never commit the manifest or its matched values. Retired local skills use a separate external `valdris.skill-retirement-manifest.v1`; `retire-local-skills.mjs` defaults to dry-run, accepts only direct children of matching `.codex/skills` and `.claude/skills` roots, and rejects traversal, symlinks, ambiguous case-insensitive matches, or candidates that change between planning and atomic quarantine.

For the protected GitHub attestation, configure `VALDRIS_RESTRICTED_VALUES_B64` and `VALDRIS_ARTIFACT_DECRYPTION_KEY_B64` as environment secrets. Configure `VALDRIS_TRUSTED_VALIDATOR_COMMIT`, `VALDRIS_ARTIFACT_ENCRYPTION_PUBLIC_KEY_B64`, and `VALDRIS_ARTIFACT_ENCRYPTION_PUBLIC_KEY_SHA256` as protected environment variables under `valdris-clean-room-acceptance`. The protected public key must match the private decryption key, and the private key must remain outside the repository. The workflow accepts only the default branch and requires protected approval before construction or upload. It builds candidate surfaces in a disposable, network-disabled, quota-bounded container, encrypts and authenticates every surface before persistence, and performs authenticated decryption plus the private scan on a fresh protected runner. The protected runner never executes candidate repository scripts; it verifies the pinned validator checkout before decrypting surfaces or materializing the restricted manifest.

Set the environment's deployment branch to the protected default branch, require an independent reviewer, enable prevent-self-review, and require CODEOWNER approval for changes to the workflow or scanner. GitHub environment secrets alone are not workflow-identity-bound. Unattended secret release therefore requires an external OIDC policy pinned to a reviewed reusable workflow through `job_workflow_ref`, or an independently controlled attestation repository. Without that binding, treat the workflow as operator-supervised evidence and do not use it alone to authorize the release tag.

Before a release tag, run the protected `Restricted Residue Attestation` workflow from the `valdris-clean-room-acceptance` environment. Its `VALDRIS_RESTRICTED_VALUES_B64` secret is the base64 encoding of the operator-curated external manifest. The workflow constructs every required surface, emits only aggregate counts to the job summary, deletes the temporary manifest, and publishes no manifest or result artifact. Synthetic convergence tests do not replace this protected operator attestation.

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
- passing provenance, neutrality, restricted-residue, privacy, compatibility, execution, catalog, skill, knowledge, enterprise/AI, convergence, and harness verifiers on Linux, Windows, and macOS portability lanes; and
- a recorded decision for any pre-existing public-history retention risk.
