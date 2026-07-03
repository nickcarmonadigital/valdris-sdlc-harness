# UASH Proof Schema v1

`proof/proof.json` is now content-validated, not existence-validated.

A passing proof artifact must use `schema: "uash.proof.v1"`, include a timestamp, a summary, and at least one command result with `command`, integer `exitCode`, `completedAt`, and output evidence (`stdoutTail`, `stderrTail`, or `outputDigest`).

A legacy file like `{ "exitCode": 0 }` is rejected by the bridge.

## Minimal passing example

```json
{
  "schema": "uash.proof.v1",
  "generatedAt": "2026-07-03T00:00:00.000Z",
  "runId": "RUN-123",
  "status": "passed",
  "summary": "Required validation commands passed.",
  "commands": [
    {
      "command": "npm run typecheck",
      "exitCode": 0,
      "startedAt": "2026-07-03T00:00:00.000Z",
      "completedAt": "2026-07-03T00:00:01.000Z",
      "outputDigest": "sha256:<digest>",
      "stdoutTail": "..."
    }
  ]
}
```

## Generate proof locally

```bash
node scripts/uash-write-proof.mjs --run-id "$RUN_ID" \
  --command "npm run typecheck" \
  --command "npm run build" \
  --out proof/proof.json
```

Then emit:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written prove \
  "Proof artifact written" \
  --artifact proof/proof.json \
  --status ok \
  --actor harness \
  --mode live \
  --source bridge \
  --artifact-root "$PWD"
```
