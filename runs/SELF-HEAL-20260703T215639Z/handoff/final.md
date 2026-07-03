# Final Handoff — v0.6 Fable Phase 1 Trust-Boundary Hardening

## Bottom line

Fable Phase 1 remediation has been implemented in the repo as v0.6.0 and verified locally.

## What changed

- Pinned all direct dependencies instead of `latest`.
- Added GitHub Actions CI for install, typecheck, build, local code-intelligence scan, graph/anchor gates, harness verifier, and commissioning smoke.
- Added `uash.proof.v1` content validation and `scripts/uash-write-proof.mjs` proof generation.
- Made the local bridge adapter-aware via safe `project-adapter.json` loading and runtime `requiredNodes` / `artifactByNode` policy.
- Added token-gated human approval grants/denials; raw tokens are hashed/compared and never persisted.
- Labeled bundled UI seed scenarios as Demo so Replay remains historical run data only.
- Synced README, connector docs, generated pack docs, and v0.6 hardening docs.

## Proof

See `proof/proof.json`.

The proof artifact records passing runs for:

- `npm ci --ignore-scripts`
- `npm run typecheck`
- `npm run build`
- `npm run code-intelligence:scan`
- `npm run graphify:gate`
- `npm run verify:harness`
- commissioning smoke with adapter/proof/token assertions

## Risk

No cloud/provider/IAM/secret/deploy mutation occurred. The remaining product-grade gaps are intentionally Phase 2/3: hosted backend, multi-user auth, MCP daemon connector, commercial GitNexus/license path, and executable enterprise proof-bank/domain-pack gates.

## Next use

This is ready to dogfood for infrastructure/system architecture work as a local control plane after commit/push to `main`.
