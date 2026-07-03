# Self-Heal Report — Fable Phase 1 Trust Boundary Hardening

## Gap

Fable identified four hard ceilings: no CI, existence-only proof, adapter-blind gates, and spoofable human approval. Demo/Replay wording also drifted.

## Fix

Implemented v0.6.0 hardening: pinned dependencies, GitHub Actions CI, `uash.proof.v1` schema + proof writer, adapter-aware bridge policy, per-run/env human approval token gate, Demo labeling for bundled seed data, and docs/status sync.

## Verification

See `proof/proof.json` and `qa/break-it-results.md`.
