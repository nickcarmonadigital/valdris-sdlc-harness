# Break-it QA Results — v0.6.1 Trust-Boundary Hotfix

Status: **passed** after patch.

## Reviewer blockers closed

- Failed/non-passing `uash.proof.v1` proof is rejected; finish-line requires `status: "passed"` and every command `exitCode: 0`.
- Adapter `runtime.requiredNodes` cannot remove `prove` or `handoff`.
- `POST /runs` rejects client-supplied `humanApprovalToken`, `humanToken`, or `auth` and does not return a raw token.
- Human approval grants/denials require operator-held `UASH_HUMAN_APPROVAL_TOKEN`.
- Adapter custom proof paths are validated when emitted by `prove` and cannot be claimed by another node.
- `artifact.written` must match the configured artifact path for the emitted node.
- Static Claude/Codex templates and generated commissioning review now document v0.6 trust-boundary/token/proof rules.

## Negative tests now covered by `npm run verify:harness`

- Legacy fake proof rejected.
- Schema-shaped failed proof rejected.
- Adapter proof-gate removal rejected.
- Client-supplied human token rejected.
- Raw token absent from HTTP response, `run.json`, and `events.jsonl`.
- Custom proof path/node mismatch rejected.
- Invalid custom proof rejected.
- Valid adapter custom proof path still completes.
