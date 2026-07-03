# Final Handoff — v0.6.2 GitNexus Code Intelligence Naming Correction

## Bottom line

Nick was right: the harness still contained retired code-map vendor naming after GitNexus had become the source of truth. v0.6.2 removes that drift.

## What changed

- Replaced the old repo-intelligence node ID with `code-intelligence`.
- Removed old repo-intelligence npm script aliases.
- Renamed local fallback/gate scripts to:
  - `scripts/code-intelligence-local-scan.mjs`
  - `scripts/code-intelligence-gate.mjs`
- Renamed docs to `docs/CODE_INTELLIGENCE_GRAPH.md` / generated `Code Intelligence Graph.md`.
- Updated bridge, UI, templates, commissioning generator, verifier, CI, README, and research docs to GitNexus/code-intelligence language.
- Removed old self-heal proof packets that contained stale retired naming and replaced them with this packet.
- Updated local skill guidance/memory so future harness work uses GitNexus/code-intelligence only.

## Proof

`proof/proof.json` records passing:

- `npm ci --ignore-scripts`
- `npm run typecheck`
- `npm run build`
- `npm run code-intelligence:scan`
- `npm run code-intelligence:gate`
- `npm run verify:harness`
- zero retired-name content/filename search
- v0.6.2 commissioning smoke

## Risk

No cloud/provider/IAM/secret/deployment mutation occurred. This is repo naming/API/docs/verification cleanup for the local harness.
