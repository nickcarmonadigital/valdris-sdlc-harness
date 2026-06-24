# Final Handoff

## Bottom line

Completed one harness self-heal loop. The local bridge is now stricter and the verifier covers the audit bypasses that were found.

## What changed

- Hardened connector event contract to v0.3.
- Required strict event fields and valid event/node/status/mode/source enums.
- Required real artifact verification under `artifactRoot` for `artifact.written` and finish-line completion.
- Blocked symlink/path traversal artifact proof.
- Blocked direct completed-run injection and client-supplied artifact truth.
- Made Red Zone grants human-only and pending-request-bound.
- Made `self_heal.detected` require later PR opened/proposed, not a normal skip.
- Made commissioned packs include `scripts/uash-emit-event.mjs`.
- Added `--artifact-root` emitter support with current working directory default.
- Fixed pyproject-only commissioning install detection.
- Updated Claude/Codex connector docs and generated prompts for strict v0.3 behavior.
- Updated app-side types for approval records and self-heal proposed events.

## Proof

- `npm run verify:harness` passed.
- `npm run typecheck` passed.
- `npm run build` passed.
- Second-pass independent reviews passed for bridge/security and verifier coverage.
- Final focused Codex/generated docs review passed.

## Remaining future work

- Product-grade MCP/local daemon connector.
- Hosted durable backend and auth/RBAC.
- Adapter-defined custom nodes.
- Full live `/runs` operator UI wiring.
