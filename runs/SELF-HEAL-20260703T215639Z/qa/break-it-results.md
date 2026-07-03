# Break-it QA Results — v0.6 Trust-Boundary Hardening

Status: **passed**

## Negative paths covered by `npm run verify:harness`

- Unknown event type / missing fields rejected.
- Skipped node without `skipReason` rejected.
- Direct completed-run injection rejected.
- Artifact write without `artifactRoot` rejected.
- Missing artifact file rejected.
- Symlink/path escape rejected.
- Legacy fake proof like `{ "exitCode": 0 }` rejected by `uash.proof.v1` validation.
- Unsafe absolute `adapterPath` outside allowed roots rejected.
- Adapter-aware reduced required-node policy proves bridge consumes `project-adapter.json` at runtime.
- Agent approval grant rejected.
- Human approval grant without token rejected.
- Human token grant accepted only with matching token.
- Raw human token verified absent from `run.json` and `events.jsonl`.
- Grant without pending approval rejected.
- Red Zone completion blocked while approval is pending.
- `self_heal.detected` cannot be resolved by a normal skip.
- Early `run.completed` blocked until all required proof/skips are satisfied.

## Positive path

A fully verified run completed with schema-valid proof, required artifacts, skip reasons, and event ledger.

See `proof/proof.json` for command-level evidence.
