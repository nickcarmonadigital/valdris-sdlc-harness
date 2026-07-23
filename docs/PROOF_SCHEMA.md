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

## v0.9 portable proof, RCA, signed review, and assurance levels

The final v0.9 packet uses `proof/portable.json` in addition to the bridge event proof above. `proof-runner.mjs` requires `--commit` to equal Git `HEAD`, binds the committed tree plus the exact dirty/untracked worktree and proof-runner digest before and after execution, rejects net source mutation that remains in the post-command snapshot, and preserves a separate application-source projection that excludes only exact canonical post-proof artifacts. Final packet validation recomputes that projection, so application code changed after proof is rejected; similarly named or noncanonical evidence files remain application source. Structural proof retains this portable model. Authoritative proof additionally requires `valdris.proof-executor-receipt.v1` from a commissioned immutable executor. The optional OCI reference executor freezes committed Git objects into a content-addressed source layer, builds an execution image from the commissioned immutable base, never mounts the live worktree, exclusively creates output below a realpath- and digest-pinned operator-owned root, inherits no ambient secrets, disables network, applies resource limits, validates canonical proof-set manifests, and signs its result. Before its first daemon call it copies the commissioned OCI runtime from verified bytes into a randomly rooted hardened capsule; POSIX removes directory write authority, while Windows applies and continuously revalidates an owner-only read/execute ACL to both the capsule and its parent. The receipt binds the source runtime plus capsule mode, content, path, and root-identity digests. Local user paths and credential-like values are redacted; Windows `npm`, `pnpm`, and `yarn` shims resolve to `node` plus their JavaScript CLI while keeping `shell: false`.

Portable proof treats command argv as structured evidence, not as unrelated strings. A conservative long-flag policy normalizes camel case, dots, underscores, and hyphens and recognizes credential-bearing names and provider-prefixed suffixes such as `api-key`, `token`, `access-token`, `refresh-token`, `authorization`, `client-secret`, `secret`, `password`, `passphrase`, `credential`, private/signing/encryption keys, connection strings, database URLs, and common service DSNs. Both `--api-key VALUE` and `--api-key=VALUE` execute with the original value, while `command.argv` and `command.requestedArgv` preserve the flag name and persist only `[REDACTED]`; the structurally identified raw value is also added to stdout, stderr, and spawn-error redaction before the child runs. Missing or empty values and split values beginning with `-` fail closed; use the equals form for a legitimate value beginning with `-`. No short aliases are recognized because aliases such as `-p`, `-t`, and `-k` are globally ambiguous, so secret-bearing proof commands must use an explicit supported long flag. Existing environment-name/value and local-path redaction remains additive to this argv policy. Validators reject copied or hand-edited proof artifacts whose structured argv contains a raw or malformed secret-bearing value. This artifact policy does not hide the live child argv from operating-system process inspection; commands should still prefer an approved environment, standard input, or secret-manager handoff when the target tool supports one.

Every proof also binds `command.executionInputs` and its digest into the command identity and proof envelope. The contract records canonical passed-environment variable names, the structural positions of redacted secret-bearing argv flags, and one aggregate SHA-256 identity for the nonsecret allowlisted baseline environment (`CI`, `PATH`, `HOME`, locale, temporary-directory, and platform-launch variables). Raw environment values are never persisted. Any baseline-environment change therefore changes the command identity, while any explicit `--pass-env` use or secret-bearing argv marks the command `opaque-dynamic` and `causalIdentityEligible: false`. Such opaque proofs remain usable as execution evidence, but the RCA gate rejects them as red/green causal identity because the hidden input may have changed between runs.

Corrective-work RCA does not accept unrelated red and green commands. `rca/rca.json` must name distinct existing `preFixCommit` and `postFixCommit` revisions, bind one `commandSha256` and regression ID across both phases, identify a failure signature present in every red attempt, bind `rootCause.affectedPaths` to `fix.changedPaths` in the real non-evidence Git diff, and finish at the current post-fix `HEAD` with a clean-tree passing regression. Documentation/process repairs additionally use repeatable proof-runner `--causal-input <repo/path>` arguments. Each portable proof records the canonical repository-relative regular non-symlink path plus its exact before/after SHA-256 values and binds that list into the proof envelope. `regression.causalInputs` declares the exact pre-fix and post-fix Git-blob digests; the RCA gate requires every documentation/process causal path in both the red and green proof bindings and verifies those digests against Git. Both `rootCause.causalClass` and `fix.remediationClass` must be `documentation-process`. This proves digest-bound declared inputs, not impossible OS-level file-read tracing; untyped, absent, mismatched, or unrelated cover-input claims fail closed.

Before review, run `run-create.mjs --print-evidence-bundle` with every required non-review gate. The returned digest covers the intake, classification, route, completed goal, validator/catalog runtime, required-gate set, portable proof, RCA when applicable, and every other required gate artifact. `review/review.json` uses `valdris.review.v2` and declares exactly four signed roles: scout, implementer, verifier, and independent reviewer. Every role has explicit actor, session, and execution identities; each identity field is pairwise distinct across all four roles. Scout evidence binds the canonical route, implementer and verifier evidence bind the portable proof, and the independent reviewer binds `evidenceBundleSha256`. The review also declares `reviewTrustSha256`, the canonical-JSON SHA-256 of the commissioned review trust store, and the trusted reviewer signature covers that digest together with the complete role roster, evidence bindings, decision, findings, and attestation identity. Final packet creation rejects role omission, role collapse, trust-pin drift, or any post-review evidence change.

New `run/packet.json` artifacts use `valdris.run-packet.v3`. They expose `roleProvenanceSha256`, an explicit `structural`, `semantic`, or `authoritative` assurance level, and complete resolved catalog snapshots. Every snapshot includes the canonical policy digest and the raw source digest from the packet-bound committed validation runtime, so current catalog evolution cannot rewrite historical policy. The review evidence bundle signs their digests and the packet envelope binds them together with a strictly sorted artifact inventory. Genuine packets emitted by the pinned pre-v3 creator remain readable as structural evidence but are never silently upgraded. Semantic packets require `assurance/authoritative.json` to bind externally sealed typed requirements, semantic adapters and thresholds, conditional model-judge calibration, registered tool/call evidence, durable memory heads, runtime-driver and implementation receipts, reconciled economics, complete declared MCP/A2A transcripts, dependency provenance, trace-v2 trajectory/byte evidence, runtime session identity, and Git-reconstructed change review. Authoritative packets additionally require operator-pinned approval, model-routing, trace, usage, memory-head, implementation-execution, immutable-executor, and monotonic bridge-head receipts. The validation runtime records `reviewTrustSha256` and includes it in the runtime `setSha256`; `generatedAt` is canonical UTC ISO 8601 with millisecond precision and is envelope-bound. Role collapse has no implicit tier exception.

The authority trust store is separately pinned with `VALDRIS_AUTHORITY_TRUST_SHA256`. Its default empty key set intentionally prevents authoritative claims. `v0.9.0` may be tagged only after a commissioned target passes a real provider-backed authoritative run; mocked verifier receipts support release-candidate testing only.

In a commissioned target, the trusted public key is selected from the committed `.valdris-harness/controls/review-trust.v1.json`; the review gate derives that exact target-relative path from its runtime pack and rejects alternate locations. The operator or protected CI environment must independently provide `UASH_REVIEW_TRUST_SHA256`. Both the live store and the reviewed-commit store are parsed and canonicalized, and both digests must equal that external pin. The validator never derives or enrolls the authoritative pin from the checkout under review, and there is no CLI override. Private keys stay outside the repository and outside agent reach. Changing any role identity, role evidence, review finding, signature identity, trust pin, or runtime after signing invalidates the attestation. A commissioned project with no active trusted review key cannot pass the final review gate. Trust-store rotation is governed out of band: the operator reviews the proposed store and updates the protected pin before accepting artifacts signed under the new trust root.

The complete `.valdris-harness` runtime and target-root `AGENTS.md` / `CLAUDE.md` discovery loaders must be regular, Git-tracked, and clean in the same target Git worktree. Each root file must contain exactly one canonical bounded loader block. `runtimeSha256` binds the complete commissioned pack plus both root loaders independently of unrelated product files, so a normal product-only commit can advance a live run while pack or loader drift is rejected. The commit-specific `setSha256` additionally binds `HEAD`, the target tree, validator/catalog members, and `runtimeSha256`; it is signed in the review evidence bundle and final packet envelope. Digests come from committed Git blobs for EOL-stable trust, while live files must be semantically identical and the index must match `HEAD` without `assume-unchanged` or `skip-worktree` concealment. Runtime and target paths use literal Git-native worktree prefixes, including when the commissioned target is a subdirectory of a larger worktree. Portable proof binds that same `source.targetPath`, and final packet validation rejects proof copied from a sibling target. Clean-room privacy validates the pack, while the bounded `--include graph --include design/anchors.json` check validates generated evidence without treating ordinary product binaries as imported harness material.
