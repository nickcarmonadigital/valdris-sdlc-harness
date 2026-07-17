# UASH Proof Schema v1

`proof/proof.json` is now content-validated, not existence-validated.

A passing proof artifact must use `schema: "uash.proof.v1"`, `status: "passed"`, include a timestamp, a summary, and at least one command result with `command`, integer `exitCode`, `completedAt`, and output evidence (`stdoutTail`, `stderrTail`, or `outputDigest`). Every command must have `exitCode: 0`.

A legacy file like `{ "exitCode": 0 }`, or a schema-shaped proof with `status: "failed"` / non-zero command exits, is rejected by the bridge for the finish line.

## Minimal passing example

```json
{
  "schema": "uash.proof.v1",
  "generatedAt": "2026-07-03T00:00:00.000Z",
  "runId": "EXAMPLE-RUN-123",
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

## v0.8 portable proof, RCA, and signed review

The final v0.8 packet uses `proof/portable.json` in addition to the bridge event proof above. `proof-runner.mjs` requires `--commit` to equal Git `HEAD`, binds the committed tree plus the exact dirty/untracked worktree and proof-runner digest before and after execution, rejects source mutation during the command, and preserves a separate application-source projection that excludes only reserved harness evidence paths. Final packet validation recomputes that projection, so application code changed after proof is rejected. Local user paths and credential-like values are redacted; Windows `npm`, `pnpm`, and `yarn` shims resolve to `node` plus their JavaScript CLI while keeping `shell: false`.

Corrective-work RCA does not accept unrelated red and green commands. `rca/rca.json` must name distinct existing `preFixCommit` and `postFixCommit` revisions, bind one `commandSha256` and regression ID across both phases, identify a failure signature present in every red attempt, bind `rootCause.affectedPaths` to `fix.changedPaths` in the real non-evidence Git diff, and finish at the current post-fix `HEAD` with a clean-tree passing regression.

Before review, run `run-create.mjs --print-evidence-bundle` with every required non-review gate. The returned digest covers the intake, classification, route, completed goal, validator/catalog runtime, required-gate set, portable proof, RCA when applicable, and every other required gate artifact. `review/review.json` must include that `evidenceBundleSha256` and be signed with Ed25519; final packet creation rejects any post-review change to the covered evidence. The signature also binds its scheme and key ID.

In a commissioned target, the trusted public key is selected from the committed `.valdris-harness/controls/review-trust.v1.json`; the review gate derives that exact target-relative path from its runtime pack and rejects alternate locations. Private keys stay outside the repository and outside agent reach. Changing actor/session labels, review findings, evidence, signature identity, or runtime after signing invalidates the attestation. A commissioned project with no active trusted review key cannot pass the final review gate.

The complete `.valdris-harness` runtime must be committed in the same target Git worktree. Clean-room privacy validates that pack, while the bounded `--include graph --include design/anchors.json` check validates generated evidence without treating ordinary product binaries as imported harness material.
