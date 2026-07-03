# v0.6 Trust-Boundary Hardening

This release implements the Phase 1 Fable audit remediation for the Universal Agentic SDLC Harness.

## Fixed ceilings

| Audit ceiling | v0.6 enforcement |
|---|---|
| No CI | `.github/workflows/ci.yml` runs install, typecheck, build, local code-intelligence scan, graph/anchor gates, `verify:harness`, and commissioning smoke. |
| Existence-only proof | `proof/proof.json` must validate as `uash.proof.v1`; fake `{ "exitCode": 0 }` proof is rejected. |
| Adapter-blind gates | The bridge safely loads `project-adapter.json` and applies `runtime.requiredNodes` / `runtime.artifactByNode`. Arbitrary absolute adapter paths are rejected. |
| Spoofable human approval | `approval.granted` / `approval.denied` require `actor: human`, a pending approval, and the operator-held `UASH_HUMAN_APPROVAL_TOKEN` via `x-uash-human-token` / `--human-token`. Raw tokens are never accepted from `POST /runs`, never returned by HTTP, and never persisted. |
| Demo/replay drift | Bundled seed UI scenarios are labeled Demo; Replay remains reserved for historical run packets. |

## Still intentionally deferred

- hosted backend / multi-user auth
- Supabase/Postgres run store
- MCP daemon connector
- commercial GitNexus licensing decisions
- enterprise domain proof-bank executables

The harness remains a local-run control plane, but the trust boundary is hardened enough for serious dogfood/infrastructure work today.
