# v0.6 Trust-Boundary Hardening

This release implements the Phase 1 Fable audit remediation for the Universal Agentic SDLC Harness.

## Fixed ceilings

| Audit ceiling | v0.6 enforcement |
|---|---|
| No CI | `.github/workflows/ci.yml` runs install, typecheck, build, local code-intelligence scan, `code-intelligence-gate-all`, `verify:harness`, and commissioning smoke. |
| Existence-only proof | `proof/proof.json` must validate as `uash.proof.v1`; fake `{ "exitCode": 0 }` proof is rejected. |
| Adapter-blind gates | The bridge safely loads `project-adapter.json` and applies `runtime.requiredNodes` / `runtime.artifactByNode`. Arbitrary absolute adapter paths are rejected. |
| Unauthenticated bridge API | Ordinary run reads and writes require `UASH_BRIDGE_ACCESS_TOKEN` via `x-uash-bridge-token`; the server-side UI proxy injects it without exposing it to browser JavaScript. |
| Reused or weak control-plane secret | `UASH_BRIDGE_INTEGRITY_KEY` is bridge-only and keys state HMACs, `UASH_BRIDGE_ACCESS_TOKEN` authorizes ordinary API access, and `UASH_HUMAN_APPROVAL_TOKEN` is reserved for human decisions. Startup requires at least 32 bytes per role and rejects equal values; finish-line validator subprocesses inherit none of the three credentials. |
| Spoofable human approval | `approval.granted` / `approval.denied` require `actor: human`, a pending approval, ordinary bridge API authorization, and the operator-held `UASH_HUMAN_APPROVAL_TOKEN` via `x-uash-human-token`. The operator-shell emitter reads the token from its environment; secrets in process arguments or request bodies are rejected. Raw tokens are never returned by HTTP or persisted. |
| Demo/replay drift | Bundled seed UI scenarios are labeled Demo; Replay remains reserved for historical run packets. |

## v0.8 external review trust root

Committing an Ed25519 public key is no longer sufficient to make it trusted. Every `valdris.review.v2` path requires `UASH_REVIEW_TRUST_SHA256`, the canonical-JSON SHA-256 of the operator-reviewed trust store. The live store and the store at the reviewed commit must independently match that external pin, and the signed review records `reviewTrustSha256`. The run packet carries the same pin inside its validation-runtime binding and envelope.

The bridge validates the pin at startup, seals it into HMAC-authenticated immutable run configuration, rejects a different pin on later reads, and propagates only this nonsecret digest to finish-line child validators while removing all bridge credentials. A committed attacker key plus a valid attacker signature remains rejected when the operator retains the old pin.

The authoritative value belongs in an operator-owned service environment or protected CI/repository variable. A delivery agent setting its own environment variable proves only internal consistency, not external authorization. For governed rotation, a human reviews the new trust store and updates the protected pin out of band before accepting the new store. Commissioning prints and records the generated digest for handoff, but repository-local copies are explicitly informational and never self-authoritative.

## Still intentionally deferred

- hosted backend / multi-user auth
- Supabase/Postgres run store
- MCP daemon connector
- commercial GitNexus licensing decisions
- enterprise domain proof-bank executables

The harness remains a local-run control plane, but the trust boundary is hardened enough for serious dogfood/infrastructure work today.
