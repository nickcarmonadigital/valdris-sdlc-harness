# Repo Source Map

## Harness repo

Use these source files by purpose:

- `README.md`: product shape, status table, quick start, current frontier.
- `AGENTS.md` and `CLAUDE.md`: agent front doors.
- `knowledge/index.md`: OKF-style progressive-disclosure map for agent navigation.
- `scripts/okf-vault-gate.mjs`: validator for `knowledge/` frontmatter, indexes, logs, and internal links.
- `scripts/commission-harness.mjs`: generated adapters, prompts, copied scripts, canonical production layer list.
- `scripts/claude-code-bridge.mjs`: event contract enforcement, artifact verification, Red Zone, self-heal, finish line.
- `scripts/code-intelligence-scan.mjs`: GitNexus/local graph scan and fallback evidence.
- `scripts/code-intelligence-gate-all.mjs`: graph plus anchor gate wrapper.
- `scripts/production-layer-gate.mjs`: 13-layer schema validator.
- `scripts/verify-harness.mjs`: integration/adversarial verifier.
- `docs/PRODUCTION_READINESS_LAYER_PACK.md`: production layer artifact schema and examples.
- `docs/CONNECTOR_EVENT_CONTRACT.md`: event types, required fields, and finish-line rules.
- `docs/CODEX_CONNECTOR.md`: Codex-specific connection notes.

## Commissioned target repo

Prefer generated files over generic Valdris docs:

- `project-adapter.json`: source of truth for repo policy, required nodes, artifacts, validation, Red Zone, and production layers.
- `knowledge/index.md`: first low-token map when present; route into playbooks/concepts before opening broad docs.
- `00_MAP.md`: repo map and lane families.
- `CONTEXT.md`: routing by work type.
- `docs/Validation Commands.md`: commands and done definition.
- `docs/Codex Runtime Prompt.md`: live-run prompt when `RUN_ID` and `BRIDGE_URL` exist.

When sources conflict, prefer live system/git state, then adapter, then generated docs, then generic Valdris docs.
