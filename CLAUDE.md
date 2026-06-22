# Valdris SDLC Harness Claude Instructions

You are working inside the Valdris SDLC Harness repo.

## Required orientation

Read:

1. `README.md`
2. `AGENTS.md`
3. `docs/UNIVERSAL_CORE_FROM_ZIP.md`
4. `docs/UNIVERSAL_COMMISSIONING_FLOW.md`
5. `docs/CLAUDE_CODE_CONNECTOR.md`

## Non-negotiable product boundary

Do not turn this into a browser IDE. The product is a commissioning/control-plane layer that connects to Claude Code, Codex, Hermes, and other coding-agent runtimes.

## Build discipline

When modifying code, prove the result with:

```bash
npm run typecheck
npm run build
```

When modifying commissioning behavior, also run:

```bash
npm run commission -- --repo . --project-name "Valdris SDLC Harness" --out /tmp/valdris-commissioned --yes
```

## Final-answer shape

Bottom line, why, proof, fix/plan, your call.
