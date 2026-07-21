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

The Codex process must already have `UASH_BRIDGE_ACCESS_TOKEN`; the emitter sends it as `x-uash-bridge-token`. Do not request or load the bridge-only `UASH_BRIDGE_INTEGRITY_KEY` or the operator-held `UASH_HUMAN_APPROVAL_TOKEN` into the agent process.

## Required flow

```text
intake → route → code-intelligence → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Rules

1. Let Codex discover applicable skills from their `SKILL.md` YAML frontmatter, then read `AGENTS.md`, `project-adapter.json`, `knowledge/index.md`, `skills/codex-routing.yaml`, `skills/registry.json`, `00_MAP.md`, `CONTEXT.md`, `docs/Validation Commands.md`, `docs/Good Looks Like Foundation.md`, `docs/Code Quality Guardrails.md`, and `docs/Enterprise Proof Bank.md` before planning. Select one primary skill for the current phase and the smallest supporting set.
2. For codebase, architecture, refactor, debugging, or cross-file work, run `node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local`, then `node scripts/code-intelligence-gate-all.mjs --repo .` before design claims. If it falls back to local static graph, disclose that and do not claim GitNexus-backed analysis.
3. When stable routing knowledge changes, update `knowledge/` and run `node scripts/okf-vault-gate.mjs --repo .`.
4. Emit a real bridge event for every node/gate/artifact/approval/skip/failure when `RUN_ID` and `BRIDGE_URL` are provided.
5. Use `node.skipped` with `--skip-reason` for irrelevant nodes, including `code-intelligence` and `design-anchors` on docs-only/non-code runs.
6. Use `node.failed` with `--failure-reason` and `--recovery-path` for failed nodes.
7. Stop for Red Zone approval before production deploys, secrets/env changes, auth/billing/customer data, destructive ops, provider config, or cloud resource mutation.
8. Write durable multi-checkpoint state to `goal/goal.json`; runtime-native goal state does not override Valdris gates.
9. Activate AI and domain assurance when the route detects them. iOS, realtime multiplayer, digital commerce, and youth-AI packs live under `controls/domain-packs/`.
10. Do not emit `run.completed` until the ordered v0.8 closure below validates the completed goal, all route-required assurance and conditional RCA, the frozen evidence bundle, the exact signed four-role review, and the final immutable run packet.

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

Commissioned packs include `.valdris-harness/scripts/uash-emit-event.mjs`. Run event commands from the target repository root, invoke that nested script path, and pass the target root through `--artifact-root`; do not emit live telemetry from the pack directory.

## Red Zone token-gated approval

Agents may request approval, but only a real operator may grant or deny it. Run the operator command from a separate shell containing the ordinary `UASH_BRIDGE_ACCESS_TOKEN` for the API write plus the separate `UASH_HUMAN_APPROVAL_TOKEN` for the human decision. The emitter reads the human token from that operator-only environment and sends it as a header; never place it in command arguments or request bodies. The agent must never receive the human or integrity credential.

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone   "Red Zone approval required before continuing"   --artifact approvals/redzone.json   --status needs_approval   --actor codex   --mode live   --source bridge   --approval-owner "primary operator"   --approval-scope "specific risky action"   --artifact-root "$PWD"

UASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone   "Human approved scoped Red Zone action"   --artifact approvals/redzone.json   --status ok   --actor human   --mode live   --source bridge   --approval-owner "primary operator"   --approval-scope "specific risky action"   --artifact-root "$PWD"
```

## Ordered v0.8 completion closure

1. Run `node scripts/goal-gate.mjs --repo .` without `--allow-active`, then `node scripts/enterprise-ai-gate-all.mjs --repo .`.
2. For bug, regression, incident, or self-heal work—or whenever `rca/rca.json` exists—run `node scripts/rca-gate.mjs --repo .` and include `--rca rca/rca.json` in both packet-builder commands.
3. Freeze the pre-review subject with `node scripts/run-create.mjs --repo . --run-id "$RUN_ID" --commit "$COMMIT" --environment "$ENVIRONMENT" --proof proof/portable.json --gate "<required-gate>=<artifact-path>" --print-evidence-bundle`, repeating `--gate` for every route-required gate.
4. Obtain `review/review.json` as `valdris.review.v2` with exactly `scout`, `implementer`, `verifier`, and `independentReviewer`. Their `actorId`, `sessionId`, and `executionId` values must each be pairwise distinct across all four roles. An authorized independent reviewer signs the frozen evidence bundle and complete role roster with Ed25519 using an active key already present in the committed trust store. Run `node scripts/review-gate.mjs --repo .`.
5. Create `valdris.run-packet.v2` by repeating the identical gate/RCA arguments and adding `--review review/review.json --output run/packet.json`; then run `node scripts/run-packet-gate.mjs --repo .`.

Any post-review input, runtime, gate, RCA, portable-proof, or application-source drift invalidates completion.

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
