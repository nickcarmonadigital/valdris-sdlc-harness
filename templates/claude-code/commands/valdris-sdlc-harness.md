# Valdris SDLC Harness

You are running inside a Universal Agentic SDLC Harness run.

Arguments supplied by the user may include:

```text
RUN_ID=<run id>
BRIDGE_URL=http://127.0.0.1:8787
<task text>
```

If `RUN_ID` is not provided, ask for it before doing work. Do not invent a run ID.

The Claude Code process must already have `UASH_BRIDGE_ACCESS_TOKEN`; the emitter sends it as `x-uash-bridge-token`. Do not request or load the bridge-only `UASH_BRIDGE_INTEGRITY_KEY` or operator-held `UASH_HUMAN_APPROVAL_TOKEN` into the agent process.

## Non-negotiable rule

Do not just answer. Walk the Valdris SDLC Harness / ICM flow node-by-node and emit a bridge event for each node, gate, artifact, approval, skip, failure, and self-heal blocker.

The bridge event command is:

```bash
node scripts/uash-emit-event.mjs <RUN_ID> <event-type> <node-id> "<message>" \
  --artifact <path> \
  --status <ok|warn|blocked|skipped|failed|needs_approval> \
  --actor <claude-code|codex|hermes|harness|human> \
  [--skip-reason "..."] \
  [--failure-reason "..."] \
  [--recovery-path "..."] \
  [--approval-owner "..."] \
  [--approval-scope "..."]
```

If this script is not available in the target repo, tell the user to copy it from the Universal Harness repo or run the command from that repo with the same `RUN_ID`.

## Required node flow

```text
intake → route → code-intelligence → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Mode rule

Separate:

- **Blueprint** — topology only, no live-run claim.
- **Live Run** — real connector/MCP/CLI/API/watched-artifact events.
- **Replay** — stored run packet/events/artifacts.

Never imply fake live telemetry.

## Required event sequence

Before routing, read `AGENTS.md`, `project-adapter.json`, `knowledge/index.md`, `skills/codex-routing.yaml`, `skills/registry.json`, `00_MAP.md`, `CONTEXT.md`, and `docs/Validation Commands.md` when present. Use `knowledge/` as the progressive-disclosure vault, select one primary skill for the current phase, store durable multi-checkpoint state in `goal/goal.json`, and run `node scripts/okf-vault-gate.mjs --repo .` when stable routing knowledge changes.

### 1. Intake

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake "Claude Code received the task and is starting Valdris SDLC Harness intake" --artifact run/intake.json --status ok --actor claude-code --mode live --source bridge
```

Clarify task, repo, branch, environment, affected user/account/run IDs, screenshots/logs, and risk.

### 2. Route

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" agent.connected route "Claude Code attached and selected the Valdris SDLC Harness lane" --artifact run/route.json --status ok --actor claude-code
```

Name the lane family and work type. Examples: engineering-default, system-design, production-readiness, cloud-platform, qa-release, agent-runtime, incidents, support-triage, data-platform, provider-config, communications.

### 3. GitNexus / Code Intelligence

For codebase, architecture, refactor, debugging, or cross-file implementation work, run GitNexus-backed code intelligence before design claims:

```bash
node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local
node scripts/code-intelligence-gate-all.mjs --repo .
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written code-intelligence "GitNexus/code-intelligence artifact written" --artifact graph/graph.json --status ok --actor claude-code --mode live --source bridge --artifact-root "$PWD"
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written design-anchors "Design anchors written for blast-radius reasoning" --artifact design/anchors.json --status ok --actor claude-code --mode live --source bridge --artifact-root "$PWD"
```

`graph/gitnexus.json` is the GitNexus evidence artifact. If the scan falls back to the local static graph, disclose that in the handoff and do not claim GitNexus-backed analysis.

If this is docs-only/non-code work, emit explicit skips for both `code-intelligence` and `design-anchors` with reasons.

### 4. System Design

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written system-design "System design captured requirements, constraints, tradeoffs, and ADR triggers" --artifact design/system_design.md --status ok --actor claude-code
```

Use this lane for architecture, APIs, data model, scaling, protocols, queues/workers, reliability, observability, security, or hard-to-reverse decisions.

If it does not apply:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped system-design "System design skipped" --artifact design/system_design.md --status skipped --actor harness --skip-reason "No architecture, API/data model, scaling, failure-mode, or hard-to-reverse decision in this run"
```

### 5. Production Readiness Layer Pack

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written production-readiness "Production Readiness Layer Pack assessed" --artifact production/layer-assessment.json --status ok --actor claude-code
```

Classify all layers initially as required, potentially affected, or not applicable, then resolve every potentially affected layer before finish. Newly commissioned runs use `uash.production-readiness.v2`: each required layer must pass every named catalog control with typed evidence.

Activate `ai/assurance.json`, eval, and trajectory gates for AI behavior. Activate matching catalogs under `controls/domain-packs/` for iOS, realtime multiplayer, digital commerce, or youth-facing AI.

### 6. Cloud / Platform

If AWS/Azure/GCP/Vercel/Supabase infra, deploy, IAM, secrets, networking, CI/CD, cost, observability, rollback, or provider config is touched:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written cloud-platform "Cloud/platform service map written" --artifact cloud/service-map.json --status ok --actor claude-code
```

If not:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped cloud-platform "Cloud/platform skipped" --artifact cloud/skip.json --status skipped --actor harness --skip-reason "No cloud resource, deploy, secret, IAM, network, cost, observability, or provider setting changed"
```

### 7. Implement

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.entered implement "Implementation started in Claude Code runtime" --artifact session/events.jsonl --status ok --actor claude-code
```

Keep edits narrow and tied to design anchors, production-layer assessment, and the commissioned Good Looks Like / Code Quality / Enterprise Proof Bank docs.

### 8. Red Zone

If the change touches auth, billing, data deletion, provider config, deployments, production secrets, migrations, cloud resource mutation, or customer data, stop:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required before continuing" --artifact approvals/redzone.json --status needs_approval --actor harness --approval-owner "primary operator" --approval-scope "specific risky action"
```

Wait for human approval. The agent must not approve itself. A real operator runs the grant from a separate shell containing the ordinary `UASH_BRIDGE_ACCESS_TOKEN` for the API write and the separate `UASH_HUMAN_APPROVAL_TOKEN` for the human decision. The emitter reads the human token from that operator-only environment and sends it as a header; never place it in command arguments or request bodies:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone "Human approved scoped Red Zone action"   --artifact approvals/redzone.json   --status ok   --actor human   --mode live   --source bridge   --approval-owner "primary operator"   --approval-scope "specific risky action"
```

If no Red Zone applies:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped redzone "Red Zone skipped" --artifact approvals/redzone.json --status skipped --actor harness --skip-reason "No production, secrets, billing, auth, deploy, data mutation, or provider/cloud mutation in this run"
```

### 9. QA / Let's Break It

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written qa-break-it "Break-it QA results written" --artifact qa/break-it-results.md --status ok --actor claude-code
```

Try edge cases, malformed input, auth boundaries, stale data, latency, retries, concurrency, provider failures, rollback path.

If skipped, emit `node.skipped` with reason.

### 10. Prove

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" gate.fired prove "Proof gate fired; validation must produce uash.proof.v1 proof/proof.json" --artifact proof/proof.json --status ok --actor harness
```

Run tests/evals/smoke checks. For AI/runtime/provider changes, include eval proof; for serious production work, cite the Enterprise Proof Bank dimensions. If proof is missing or failing:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.failed prove "Proof gate failed" --artifact proof/proof.json --status failed --actor harness --failure-reason "proof/proof.json missing or validation failed" --recovery-path "Fix failing command, rerun validation, attach proof/proof.json"
```

### 11. Live Smoke

If deployed/provider/runtime behavior changed:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written live-smoke "Live smoke proof written" --artifact smoke/smoke_proof.json --status ok --actor claude-code
```

If not:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped live-smoke "Live smoke skipped" --artifact smoke/skip.json --status skipped --actor harness --skip-reason "No deployed/provider/runtime behavior changed"
```

### 12. Self-Heal

If the run exposed a harness/process gap:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" self_heal.detected self-heal "Harness gap detected" --artifact self_heal/self_heal_report.md --status warn --actor harness
```

If a PR is opened/proposed:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" self_heal.pr_opened self-heal "Self-heal PR opened/proposed" --artifact self_heal/pr.json --status ok --actor harness
```

If no harness/process gap was found:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped self-heal "Self-heal skipped" --artifact self_heal/self_heal_report.md --status skipped --actor harness --skip-reason "No harness/process gap found in this run"
```

### 13. Handoff

Before `run.completed`, execute the ordered v0.8 closure:

1. Validate the completed goal with `node scripts/goal-gate.mjs --repo .`; `--allow-active` is not a completion check.
2. Validate all route-required enterprise and AI evidence with `node scripts/enterprise-ai-gate-all.mjs --repo .`.
3. For bug, regression, incident, or self-heal work—or whenever `rca/rca.json` exists—run `node scripts/rca-gate.mjs --repo .` and include `--rca rca/rca.json` in both packet-builder commands below.
4. Freeze the pre-review subject with `node scripts/run-create.mjs --repo . --run-id "$RUN_ID" --commit "$COMMIT" --environment "$ENVIRONMENT" --proof proof/portable.json --gate "<required-gate>=<artifact-path>" --print-evidence-bundle`, repeating `--gate` for every gate required by the validated route.
5. Obtain `review/review.json` as `valdris.review.v2` with exactly `scout`, `implementer`, `verifier`, and `independentReviewer`. The `actorId`, `sessionId`, and `executionId` values must each be pairwise distinct across the four roles. The independent reviewer must use an authorized Ed25519 key from the already committed trust store to sign the frozen evidence bundle and complete role roster. Then run `node scripts/review-gate.mjs --repo .`.
6. Create `valdris.run-packet.v2` with the same gate/RCA arguments plus `--review review/review.json --output run/packet.json`, then run `node scripts/run-packet-gate.mjs --repo .`.

Only after that closure passes and irrelevant nodes have skip reasons may the handoff complete. The bridge rejects `run.completed` when required artifacts are missing, failed, drifted after review, or skipped without reasons:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" run.completed handoff "All required artifacts are present or skipped with reasons; Answer Contract handoff ready" --artifact handoff/final.md --status ok --actor harness
```

Final answer shape:

```text
Bottom line
Why
Proof
Risk
Fix/Plan
Your call
Lane taken:
Gates fired + artifact paths:
Skipped steps + why:
Self-heal needed/opened:
```
