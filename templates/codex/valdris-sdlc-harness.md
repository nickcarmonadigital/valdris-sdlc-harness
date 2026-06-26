# Valdris SDLC Harness for Codex

Use this when Codex is pointed at a repo commissioned by the Valdris SDLC Harness.

Codex should already read `AGENTS.md`. This prompt is the run-level protocol when a user supplies `RUN_ID`, `BRIDGE_URL`, and a task.

## Inputs

```text
RUN_ID=<run id>
BRIDGE_URL=http://127.0.0.1:8787
<task text>
```

If `RUN_ID` is missing, ask for it before changing files. Do not invent one.

## Required flow

```text
intake → route → graphify → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Rules

1. Read `AGENTS.md`, `project-adapter.json`, `00_MAP.md`, `CONTEXT.md`, `docs/Validation Commands.md`, `docs/Good Looks Like Foundation.md`, `docs/Code Quality Guardrails.md`, and `docs/Enterprise Proof Bank.md` before planning.
2. For codebase, architecture, refactor, debugging, or cross-file work, run or verify Graphify/code graph and design anchors before design claims.
3. Emit a real bridge event for every node/gate/artifact/approval/skip/failure when `RUN_ID` and `BRIDGE_URL` are provided.
4. Use `node.skipped` with `--skip-reason` for irrelevant nodes, including `graphify` and `design-anchors` on docs-only/non-code runs.
5. Use `node.failed` with `--failure-reason` and `--recovery-path` for failed nodes.
6. Stop for Red Zone approval before production deploys, secrets/env changes, auth/billing/customer data, destructive ops, provider config, or cloud resource mutation.
7. Do not emit `run.completed` until proof exists and every required node is passed or skipped with a reason.

## Event command

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake \
  "Codex started Valdris SDLC Harness intake" \
  --artifact run/intake.json \
  --status ok \
  --actor codex \
  --mode live \
  --source bridge
```

If `scripts/uash-emit-event.mjs` is not present in the target repo, run the command from the Valdris SDLC Harness repo or copy the script into the target repo.

## Handoff

Final answer must include:

```text
Bottom line
Why
Proof
Risk
Fix/Plan
Your call
Lane taken
Gates fired + artifact paths
Skipped steps + why
Self-heal needed/opened
```
