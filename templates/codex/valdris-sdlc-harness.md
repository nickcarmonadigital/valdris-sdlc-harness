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
intake → route → code-intelligence → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Rules

1. Read `AGENTS.md`, `project-adapter.json`, `knowledge/index.md`, `skills/registry.json`, `00_MAP.md`, `CONTEXT.md`, `docs/Validation Commands.md`, `docs/Good Looks Like Foundation.md`, `docs/Code Quality Guardrails.md`, and `docs/Enterprise Proof Bank.md` before planning. Select one primary skill for the current phase and the smallest supporting set.
2. For codebase, architecture, refactor, debugging, or cross-file work, run `node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local`, then `node scripts/code-intelligence-gate-all.mjs --repo .` before design claims. If it falls back to local static graph, disclose that and do not claim GitNexus-backed analysis.
3. When stable routing knowledge changes, update `knowledge/` and run `node scripts/okf-vault-gate.mjs --repo .`.
4. Emit a real bridge event for every node/gate/artifact/approval/skip/failure when `RUN_ID` and `BRIDGE_URL` are provided.
5. Use `node.skipped` with `--skip-reason` for irrelevant nodes, including `code-intelligence` and `design-anchors` on docs-only/non-code runs.
6. Use `node.failed` with `--failure-reason` and `--recovery-path` for failed nodes.
7. Stop for Red Zone approval before production deploys, secrets/env changes, auth/billing/customer data, destructive ops, provider config, or cloud resource mutation.
8. Write durable multi-checkpoint state to `goal/goal.json`; runtime-native goal state does not override Valdris gates.
9. Activate AI and domain assurance when the route detects them. iOS, realtime multiplayer, digital commerce, and youth-AI packs live under `controls/domain-packs/`.
10. Do not emit `run.completed` until `proof/proof.json` validates as passing `uash.proof.v1`, the completed goal validates, `production/layer-assessment.json` validates all applicable v2 controls, all active AI/domain/eval/trajectory gates pass, and every required node is passed or skipped with a reason.

## Event command

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake \
  "Codex started Valdris SDLC Harness intake" \
  --artifact run/intake.json \
  --status ok \
  --actor codex \
  --mode live \
  --source bridge \
  --artifact-root "$PWD"
```

Commissioned packs include `scripts/uash-emit-event.mjs`. Run event commands from the generated pack root or pass the correct `--artifact-root` on the first event; do not emit live telemetry from a different repo root.

## Red Zone token-gated approval

Agents may request approval, but only a real operator may grant or deny it with the operator-held token configured on the bridge process.

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone   "Red Zone approval required before continuing"   --artifact approvals/redzone.json   --status needs_approval   --actor codex   --mode live   --source bridge   --approval-owner "primary operator"   --approval-scope "specific risky action"   --artifact-root "$PWD"

UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone   "Human approved scoped Red Zone action"   --artifact approvals/redzone.json   --status ok   --actor human   --mode live   --source bridge   --approval-owner "primary operator"   --approval-scope "specific risky action"   --human-token "$UASH_HUMAN_APPROVAL_TOKEN"   --artifact-root "$PWD"
```

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
