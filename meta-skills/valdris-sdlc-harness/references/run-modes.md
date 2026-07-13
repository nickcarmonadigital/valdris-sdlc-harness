# Run Modes

## Detect the pack

Prefer these locations, in order:

1. `project-adapter.json` at repo root.
2. `.valdris-harness/project-adapter.json`.
3. A generated pack path named by the user.

A complete pack should include `AGENTS.md`, `00_MAP.md`, `CONTEXT.md`, `docs/Codex Runtime Prompt.md`, `docs/Validation Commands.md`, and `scripts/uash-emit-event.mjs`. If scripts are missing, treat the pack as incomplete and commission or repair it; do not carry scripts inside this skill.

## Choose mode

- Valdris repo work: modify or audit the harness itself. Read repo docs and run repo scripts.
- Commissioned target repo: read adapter and generated docs first. Do not regenerate unless missing/incomplete.
- Live run: user supplies `RUN_ID` and `BRIDGE_URL`, or asks for live connector telemetry.
- Docs/audit only: inspect and report; skip live event claims and say telemetry is not live.

## Live bridge rules

Use `UASH_BRIDGE_URL="$BRIDGE_URL"` for event commands. The emitter reads `UASH_BRIDGE_URL`, not bare `BRIDGE_URL`.

Run event commands from the artifact root that contains the pack, or pass the correct `--artifact-root "$PWD"` on the first event. If the pack lives under `.valdris-harness/`, resolve scripts as `.valdris-harness/scripts/...` and pass the adapter path when needed.

Do not emit `run.completed` until proof validates, required nodes are passed or skipped with reasons, Red Zone approvals are resolved by a human, and self-heal findings are resolved with real reviewable artifacts.
