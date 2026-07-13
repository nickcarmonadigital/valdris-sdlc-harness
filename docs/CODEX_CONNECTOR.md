# Codex Connector v0.5

This repo is ready for Codex as a repo-level SDLC engineering harness, not as an IDE wrapper.

## Short answer

Point Codex at a commissioned repo. Codex reads `AGENTS.md`, uses `project-adapter.json` + `knowledge/index.md` + `00_MAP.md` + `CONTEXT.md`, then emits real harness events through the local bridge when a run is live.

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
npm ci
npm run commission -- --repo /path/to/target-repo --project-name "Target Project" --out /path/to/target-repo/.valdris-harness --yes
npm run bridge:claude
```

Then either:

1. Install the generated front doors, `.agents/skills`, `.claude/skills`, scripts, controls, and workflow into the target repo root, or
2. Keep it in `.valdris-harness/`, copy/merge the discovery front doors into the target root, and invoke gates from the target root with separate pack and project paths.

Nested-pack command shape:

```bash
node .valdris-harness/scripts/enterprise-ai-gate-all.mjs --repo .
node .valdris-harness/scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local
```

Do not `cd .valdris-harness` and claim the resulting scan proves the target application. Gate scripts resolve catalogs/skills from the pack while evidence and run artifacts resolve from `--repo`.

On the first nested-pack bridge event, include `--artifact-root "$PWD" --adapter-path .valdris-harness/project-adapter.json` so the bridge loads the commissioned v0.7 finish-line policy.

For normal Codex CLI/app usage, `AGENTS.md` is the primary front door. The generated `docs/Codex Runtime Prompt.md` is the run-level prompt to paste when you have a `RUN_ID` and bridge URL.

## Runtime prompt

Use:

```text
RUN_ID=RUN-1042
BRIDGE_URL=http://127.0.0.1:8787
Use the Valdris SDLC Harness. Read the installed root front doors or their explicit `.valdris-harness/` equivalents. Follow intake -> route -> code-intelligence -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff. Write the v0.7 intake, route, goal, context, production, AI, domain, eval, and trajectory artifacts. Run the relevant scripts with `--repo` set to the target project. Emit bridge events for every node/gate/artifact/approval/skip/failure. Do not emit `run.completed` until the bridge-enforced v0.7 finish line passes.

Task: <your task>
```

Current nested-pack command update: use `node .valdris-harness/scripts/code-intelligence-gate-all.mjs --repo .` after the scan, validate the pack vault with `node .valdris-harness/scripts/okf-vault-gate.mjs --repo .valdris-harness`, include both `--artifact-root "$PWD"` and `--adapter-path .valdris-harness/project-adapter.json` on the first live event, and do not finish until every route-required aggregate gate passes.

## Event command

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node .valdris-harness/scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake \
  "Codex started Valdris SDLC Harness intake" \
  --artifact run/intake.json \
  --status ok \
  --actor codex \
  --mode live \
  --source bridge \
  --artifact-root "$PWD" \
  --adapter-path .valdris-harness/project-adapter.json
```

## Red Zone approval events

Agents may request approval, but only a token-gated human approval event may grant or deny it. Use `--human-token` with the operator-held `UASH_HUMAN_APPROVAL_TOKEN`; the token is sent as a header, is never accepted from `POST /runs`, and is never persisted.

For v0.7 completion, the operator must also review the current route. Emit `approval.requested` and then a token-gated human `approval.granted` with `--approval-scope route --artifact run/route.json`; the bridge hashes that file at grant time and rejects completion if it later changes.

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone \
  "Red Zone approval required" \
  --artifact approvals/redzone.json \
  --status needs_approval \
  --actor codex \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone" \
  --artifact-root "$PWD"

UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone \
  "Human approved scoped Red Zone action" \
  --artifact approvals/redzone.json \
  --status ok \
  --actor human \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone" \
  --human-token "$UASH_HUMAN_APPROVAL_TOKEN" \
  --artifact-root "$PWD"
```

## Finish-line enforcement

The bridge rejects early completion:

- missing or unverified required artifact → blocked
- skipped proof or handoff invariant → blocked
- skipped node without `skipReason` → blocked
- failed node without recovery path → blocked
- Red Zone approval missing when requested → remains approval/blocked
- `self_heal.detected` without later `self_heal.pr_opened` or `self_heal.pr_proposed` → blocked

Use `npm run verify:harness` to prove this behavior locally.

The verifier also blocks invalid `production/layer-assessment.json` files, missing canonical production layers, fake self-heal PR/proposal events, and attempts to mutate `artifactRoot` after run creation.

## Boundary

Codex can only be observed through emitted events, files/artifacts, process output, or future MCP tools. The harness does not claim to read Codex private reasoning or uninstrumented UI state.
