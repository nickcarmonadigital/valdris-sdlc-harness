# Valdris SDLC Harness Agent Instructions

This repo builds the Valdris SDLC Harness: a connector-first control plane and commissioning system for AI-assisted software delivery.

## Start here

Before planning or editing, read:

1. `README.md`
2. `docs/UNIVERSAL_CORE_FROM_ZIP.md`
3. `docs/UNIVERSAL_COMMISSIONING_FLOW.md`
4. `docs/ARCHITECTURE.md`
5. `docs/CONNECTOR_EVENT_CONTRACT.md`

## Product rule

This is not an IDE and not a prompt library by itself. It is the control plane, commissioning layer, connector bridge, run visualizer, and proof-gate layer around Claude Code, Codex, Hermes, and future coding agents.

## Core loop

```text
commission repo/team
→ generate project-specific adapter
→ install AGENTS.md / CLAUDE.md front doors
→ run external coding agent
→ stream events/artifacts/gates
→ block done until required proof exists
```

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
npm run commission -- --repo . --project-name "Valdris SDLC Harness" --out /tmp/valdris-commissioned --yes
```

Verify `/tmp/valdris-commissioned/project-adapter.json` parses and required generated front doors exist.

## Answer style

Use decision packets: bottom line, why, proof, fix/plan, your call. Avoid process narration unless the user asks for the raw trace.
