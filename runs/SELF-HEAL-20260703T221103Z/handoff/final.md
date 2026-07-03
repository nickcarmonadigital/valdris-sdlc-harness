# Final Handoff — v0.6.1 Reviewer Blocker Hotfix

## Bottom line

The independent reviewer blockers from the v0.6.0 push were reproduced as plausible bypasses and closed in v0.6.1.

## Fixes

- `proof/proof.json` must be passing `uash.proof.v1`; failed/blocked proof status and non-zero command exits are rejected.
- Project adapters can narrow gates but cannot remove `prove` or `handoff`.
- `POST /runs` rejects client-supplied approval tokens and never returns a raw token.
- Human approvals require the operator-held `UASH_HUMAN_APPROVAL_TOKEN`.
- Adapter custom proof paths validate through the `prove` node and cannot be claimed by another node.
- Static Claude/Codex templates, generated prompts, README, acceptance gates, and commissioning review now agree on proof/token/v0.6 semantics.

## Proof

See `proof/proof.json` for passing command evidence:

- `npm ci --ignore-scripts`
- `npm run typecheck`
- `npm run build`
- `npm run code-intelligence:scan`
- `npm run graphify:gate`
- `npm run verify:harness`
- v0.6.1 commissioning smoke assertions

## Risk

No cloud/provider/IAM/secret/deployment mutation occurred. This is a local harness/control-plane security hotfix.
