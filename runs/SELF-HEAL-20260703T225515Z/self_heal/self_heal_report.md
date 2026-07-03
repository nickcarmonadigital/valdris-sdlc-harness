# Self-Heal Report — v0.6.2 Naming Drift

## Gap

The previous implementation preserved stale code-map vendor naming as an internal compatibility term even after Nick had directed the harness toward GitNexus.

## Fix

The harness now uses GitNexus/code-intelligence language only: `code-intelligence` node ID, `code-intelligence:*` npm scripts, renamed scan/gate files, renamed docs, and verifier/search coverage for zero stale naming.
