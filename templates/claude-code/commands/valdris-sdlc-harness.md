# Valdris SDLC Harness

You are running inside a Universal Agentic SDLC Harness run.

Arguments supplied by the user may include:

```text
RUN_ID=<run id>
BRIDGE_URL=http://127.0.0.1:8787
<task text>
```

If `RUN_ID` is not provided, ask for it before doing work. Do not invent a run ID.

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
intake → route → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Mode rule

Separate:

- **Blueprint** — topology only, no live-run claim.
- **Live Run** — real connector/MCP/CLI/API/watched-artifact events.
- **Replay** — stored run packet/events/artifacts.

Never imply fake live telemetry.

## Required event sequence

### 1. Intake

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake "Claude Code received the task and is starting Valdris SDLC Harness intake" --artifact run/intake.json --status ok --actor claude-code --mode live --source bridge
```

Clarify task, repo, branch, environment, affected user/account/run IDs, screenshots/logs, and risk.

### 2. Route

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" agent.connected route "Claude Code attached and selected the Valdris SDLC Harness lane" --artifact run/route.json --status ok --actor claude-code
```

Name the lane family and work type. Examples: engineering-default, system-design, production-readiness, cloud-platform, qa-release, agent-runtime, incidents, support-triage, data-supabase, provider-config, voice-vapi.

### 3. System Design

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written system-design "System design captured requirements, constraints, tradeoffs, and ADR triggers" --artifact design/system_design.md --status ok --actor claude-code
```

Use this lane for architecture, APIs, data model, scaling, protocols, queues/workers, reliability, observability, security, or hard-to-reverse decisions.

If it does not apply:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped system-design "System design skipped" --artifact design/system_design.md --status skipped --actor harness --skip-reason "No architecture, API/data model, scaling, failure-mode, or hard-to-reverse decision in this run"
```

### 4. Production Readiness Layer Pack

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written production-readiness "Production Readiness Layer Pack assessed" --artifact production/layer-assessment.json --status ok --actor claude-code
```

Classify touched/skipped layers: frontend, backend/API, DB/storage, auth/RLS, hosting/deploy, cloud/compute, CI/CD, security, rate limiting, caching/CDN, load balancing/scaling, logs/observability, availability/recovery.

### 5. Cloud / Platform

If AWS/Azure/GCP/Vercel/Supabase infra, deploy, IAM, secrets, networking, CI/CD, cost, observability, rollback, or provider config is touched:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written cloud-platform "Cloud/platform service map written" --artifact cloud/service-map.json --status ok --actor claude-code
```

If not:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped cloud-platform "Cloud/platform skipped" --artifact cloud/skip.json --status skipped --actor harness --skip-reason "No cloud resource, deploy, secret, IAM, network, cost, observability, or provider setting changed"
```

### 6. Implement

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.entered implement "Implementation started in Claude Code runtime" --artifact session/events.jsonl --status ok --actor claude-code
```

Keep edits narrow and tied to design anchors and production-layer assessment.

### 7. Red Zone

If the change touches auth, billing, data deletion, provider config, deployments, production secrets, migrations, cloud resource mutation, or customer data, stop:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required before continuing" --artifact approvals/redzone.json --status needs_approval --actor harness --approval-owner "primary operator" --approval-scope "specific risky action"
```

Wait for human approval.

If no Red Zone applies:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped redzone "Red Zone skipped" --artifact approvals/redzone.json --status skipped --actor harness --skip-reason "No production, secrets, billing, auth, deploy, data mutation, or provider/cloud mutation in this run"
```

### 8. QA / Let's Break It

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written qa-break-it "Break-it QA results written" --artifact qa/break-it-results.md --status ok --actor claude-code
```

Try edge cases, malformed input, auth boundaries, stale data, latency, retries, concurrency, provider failures, rollback path.

If skipped, emit `node.skipped` with reason.

### 9. Prove

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" gate.fired prove "Proof gate fired; validation must produce proof/proof.json" --artifact proof/proof.json --status ok --actor harness
```

Run tests/evals/smoke checks. If proof is missing or failing:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.failed prove "Proof gate failed" --artifact proof/proof.json --status failed --actor harness --failure-reason "proof/proof.json missing or validation failed" --recovery-path "Fix failing command, rerun validation, attach proof/proof.json"
```

### 10. Live Smoke

If deployed/provider/runtime behavior changed:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written live-smoke "Live smoke proof written" --artifact smoke/smoke_proof.json --status ok --actor claude-code
```

If not:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.skipped live-smoke "Live smoke skipped" --artifact smoke/skip.json --status skipped --actor harness --skip-reason "No deployed/provider/runtime behavior changed"
```

### 11. Self-Heal

If the run exposed a harness/process gap:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" self_heal.detected self-heal "Harness gap detected" --artifact self_heal/self_heal_report.md --status warn --actor harness
```

If a PR is opened/proposed:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" self_heal.pr_opened self-heal "Self-heal PR opened/proposed" --artifact self_heal/pr.json --status ok --actor harness
```

### 12. Handoff

Only after required proof exists and irrelevant nodes have skip reasons:

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
