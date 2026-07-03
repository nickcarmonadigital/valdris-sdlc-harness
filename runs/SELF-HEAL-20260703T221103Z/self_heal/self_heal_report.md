# Self-Heal Report — v0.6.1 Reviewer Blockers

## Gap

Independent reviewers found post-v0.6 bypasses in the trust-boundary patch.

## Fix

The bridge now requires passing proof status + zero-exit commands, prevents adapters from removing `prove`/`handoff`, rejects client-supplied approval tokens, validates custom proof paths, enforces node/artifact path consistency, and updates verifier/templates/generated docs.
