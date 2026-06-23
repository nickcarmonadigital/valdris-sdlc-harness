# Valdris SDLC Harness Agent Instructions

This repo builds the Valdris SDLC Harness: a connector-first control plane and commissioning system for AI-assisted software delivery.

## Start here

Before planning or editing, read:

1. `README.md`
2. `docs/UNIVERSAL_CORE_FROM_ZIP.md`
3. `docs/UNIVERSAL_COMMISSIONING_FLOW.md`
4. `docs/ARCHITECTURE.md`
5. `docs/CONNECTOR_EVENT_CONTRACT.md`
6. `docs/CLAUDE_CODE_CONNECTOR.md`
7. `docs/CODEX_CONNECTOR.md`

## Product rule

This is not an IDE and not a prompt library by itself. It is the control plane, commissioning layer, connector bridge, run visualizer, and proof-gate layer around Claude Code, Codex, Hermes, and future coding agents.

## Core loop

```text
commission repo/team
→ generate project-specific adapter
→ install AGENTS.md / CLAUDE.md / Claude slash-command / Codex prompt front doors
→ run external coding agent
→ stream events/artifacts/gates
→ block done until required proof exists
```

## Claude/Codex entrypoints

- Claude Code: read `CLAUDE.md`; generated target packs include `.claude/commands/valdris-sdlc-harness.md`.
- Codex/general agents: read `AGENTS.md`; generated target packs include `docs/Codex Runtime Prompt.md`.
- Live telemetry requires real bridge/MCP/CLI/API/watched-artifact events. Never claim a live run from static docs or demo data.

## Universal vs project-specific

Keep universal:

- commissioning interview
- project-adapter schema
- agent front doors
- router/lane pattern
- stage flow
- run packet model
- proof/red-zone/RCA/anchor gates
- answer contract
- connector event contract
- lane-context eval pattern

Move into generated adapters:

- product/team names
- source-of-truth order
- branch/deploy model
- validation commands
- Red Zone actions and approvers
- safe edit paths and review-required paths
- enabled lanes
- human answer style

## Validation

Run before claiming done:

```bash
npm run typecheck
npm run build
npm run verify:harness
npm run commission -- --repo . --project-name "Valdris SDLC Harness" --out /tmp/valdris-commissioned --yes
```

Verify `/tmp/valdris-commissioned/project-adapter.json` parses and required generated front doors exist: `AGENTS.md`, `CLAUDE.md`, `.claude/commands/valdris-sdlc-harness.md`, and `docs/Codex Runtime Prompt.md`.

## Answer style

Use decision packets: bottom line, why, proof, fix/plan, your call. Avoid process narration unless the user asks for the raw trace.
