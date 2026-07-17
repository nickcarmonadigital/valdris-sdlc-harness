# ADR-0001: Retain pre-existing public history for the v0.8 merge

- Status: accepted for this merge
- Decision date: 2026-07-16
- Decision owner: repository owner
- Scope: `nickcarmonadigital/valdris-sdlc-harness` v0.8 clean-room assurance merge

## Context

The current canonical tree, generated packs, and release-facing artifacts are required to pass neutrality, privacy, provenance, and import-boundary gates. A normal pull-request merge does not remove older objects from an already-public Git history, downstream clones, forks, or caches.

The repository owner directed the clean-room branch to be merged. That authorization covers the non-destructive merge; it does not authorize a coordinated force-push or history rewrite.

## Decision

Retain the pre-existing public Git history for this merge and accept that residual exposure explicitly. Do not claim that v0.8 purges historical objects. Keep full-history secret scanning enabled, publish only the gated current tree, and describe history remediation as a separate owner-authorized operation.

## Consequences

- The current tree and new artifacts can be described as clean-room gated; the full repository history cannot be described as purged.
- Any known credential from historical material still requires revocation independently of a later rewrite.
- A future cleanup requires explicit authorization, coordinated ref rewriting, force-push planning, downstream notification, cache/fork handling, and post-rewrite rescanning.
