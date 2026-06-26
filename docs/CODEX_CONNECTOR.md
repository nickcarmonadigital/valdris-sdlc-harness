# Codex Connector v0.4

This repo is ready for Codex as a repo-level SDLC engineering harness, not as an IDE wrapper.

## Short answer

Point Codex at a commissioned repo. Codex reads `AGENTS.md`, uses `project-adapter.json` + `00_MAP.md` + `CONTEXT.md`, then emits real harness events through the local bridge when a run is live.

```text
Codex in target repo
→ AGENTS.md front door
→ project-adapter.json + lane router
→ local bridge event emission
→ run packet / JSONL proof trail
→ done blocked until proof + skip reasons exist
```

## Setup

From the Valdris SDLC Harness repo:

```bash
npm install
npm run commission -- --repo /path/to/target-repo --project-name "Target Project" --out /path/to/target-repo/.valdris-harness --yes
npm run bridge:claude
```

Then either:

1. Copy the generated harness pack into the target repo root, or
2. Keep it in `.valdris-harness/` and tell Codex to read those files explicitly.

For normal Codex CLI/app usage, `AGENTS.md` is the primary front door. The generated `docs/Codex Runtime Prompt.md` is the run-level prompt to paste when you have a `RUN_ID` and bridge URL.

## Runtime prompt

Use:

```text
RUN_ID=RUN-1042
BRIDGE_URL=http://127.0.0.1:8787
Use the Valdris SDLC Harness. Read AGENTS.md, project-adapter.json, 00_MAP.md, CONTEXT.md, and docs/Validation Commands.md. Follow intake → route → graphify → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff. Emit bridge events for every node/gate/artifact/approval/skip/failure. Do not emit run.completed until proof exists and every required node is passed or skipped with a reason.

Task: <your task>
```

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

## Red Zone approval events

Agents may request approval, but only a human approval event may grant or deny it.

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone \
  "Red Zone approval required" \
  --artifact approvals/redzone.json \
  --status needs_approval \
  --actor codex \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone"

UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone \
  "Human approved scoped Red Zone action" \
  --artifact approvals/redzone.json \
  --status ok \
  --actor human \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone"
```

## Finish-line enforcement

The bridge rejects early completion:

- missing or unverified required artifact → blocked
- skipped node without `skipReason` → blocked
- failed node without recovery path → blocked
- Red Zone approval missing when requested → remains approval/blocked
- `self_heal.detected` without later `self_heal.pr_opened` or `self_heal.pr_proposed` → blocked

Use `npm run verify:harness` to prove this behavior locally.

## Boundary

Codex can only be observed through emitted events, files/artifacts, process output, or future MCP tools. The harness does not claim to read Codex private reasoning or uninstrumented UI state.
