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

Keep the generated runtime at `.valdris-harness/`, commit that complete directory in the target worktree, copy or merge only the discovery front-door loaders into the target root, and invoke gates from the target root with separate pack and project paths. External packs and root-installed runtime copies are not supported by the v0.8 proof/runtime binding.

Nested-pack command shape:

```bash
node .valdris-harness/scripts/enterprise-ai-gate-all.mjs --repo .
node .valdris-harness/scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local
node .valdris-harness/scripts/privacy-gate.mjs --repo .valdris-harness
node .valdris-harness/scripts/privacy-gate.mjs --repo . --include graph --include design/anchors.json
```

Do not `cd .valdris-harness` and claim the resulting code-intelligence scan proves the target application. Gate scripts resolve catalogs/skills from the pack while evidence and run artifacts resolve from `--repo`. The first privacy command is the clean-room pack policy; the second checks generated graph/anchor evidence only. Do not apply the harness binary allowlist to the arbitrary product tree.

On the first nested-pack bridge event, include `--artifact-root "$PWD" --adapter-path .valdris-harness/project-adapter.json` so the bridge loads the commissioned v0.8 finish-line policy.

For normal Codex CLI/app usage, `AGENTS.md` is the primary front door. The generated `docs/Codex Runtime Prompt.md` is the run-level prompt to paste when you have a `RUN_ID` and bridge URL.

## Runtime prompt

Use:

```text
RUN_ID=EXAMPLE-RUN-1042
BRIDGE_URL=http://127.0.0.1:8787
Use the Valdris SDLC Harness. Read the installed root front-door loader and its explicit `.valdris-harness/` sources. Follow intake -> route -> code-intelligence -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff. Write the v0.8 intake, route, goal, context, production, AI, domain, eval, trajectory, portable-proof, review, and run-packet artifacts. RCA is required for bug work (including regressions), incidents, and self-heal corrective work; it must run one bound regression command against distinct existing pre-fix/post-fix commits and preserve the failure signature. Before review, print the canonical evidence bundle with `run-create.mjs --print-evidence-bundle`; the independent Ed25519 signature must bind that digest and use an active key in the committed `.valdris-harness/controls/review-trust.v1.json`. Agents cannot create or commission their own trusted key. Run the relevant scripts with `--repo` set to the target project. Emit bridge events for every node/gate/artifact/approval/skip/failure. Do not emit `run.completed` until the bridge-enforced v0.8 finish line passes.

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

For v0.8 completion, the operator must also review the current route. Emit `approval.requested` and then a token-gated human `approval.granted` with `--approval-scope route --artifact run/route.json`; the bridge hashes that file at grant time and rejects completion if it later changes. The independent reviewer and delivery actor must differ, the review signature must verify against the committed project trust store, and `run/packet.json` must match the signed evidence bundle, native validators, application-source projection, and proof set.

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
- bug (including regression), incident, or self-heal corrective work without confirmed RCA using the same command identity across distinct pre-fix/post-fix commits → blocked
- Red Zone approval missing when requested → remains approval/blocked
- `self_heal.detected` without later `self_heal.pr_opened` or `self_heal.pr_proposed` → blocked

Use `npm run verify:harness` to prove this behavior locally.

The verifier also blocks invalid `production/layer-assessment.json` files, missing canonical production layers, fake self-heal PR/proposal events, and attempts to mutate `artifactRoot` after run creation.

## Boundary

Codex can only be observed through emitted events, files/artifacts, process output, or future MCP tools. The harness does not claim to read Codex private reasoning or uninstrumented UI state.
