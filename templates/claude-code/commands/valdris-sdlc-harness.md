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

Do not just answer. Walk the Valdris SDLC Harness / ICM flow node-by-node and emit a bridge event for each node, gate, artifact, approval, and blocker.

The bridge event command is:

```bash
node scripts/uash-emit-event.mjs <RUN_ID> <event-type> <node-id> "<message>" --artifact <path> --status <ok|warn|blocked> --actor <claude-code|harness|human>
```

If this script is not available in the target repo, tell the user to copy it from the Universal Harness repo or run the command from that repo with the same `RUN_ID`.

## Required node flow

```text
intake → route → investigate → design → implement → redzone → prove → handoff
```

## Required event sequence

### 1. Intake

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake "Claude Code received the task and is starting Valdris SDLC Harness intake" --artifact run/intake.json --status ok --actor claude-code
```

Clarify task, repo, branch, environment, affected user/account/run IDs, screenshots/logs, and risk.

### 2. Route

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" agent.connected route "Claude Code attached and selected the Valdris SDLC Harness lane" --artifact run/route.json --status ok --actor claude-code
```

Name the lane and work type. Examples: engineering-default, agent-runtime, incidents, support-triage, data-supabase, provider-config, voice-vapi.

### 3. Investigate

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" gate.fired investigate "RCA/evidence gate fired; cause claims are blocked until evidence exists" --artifact rca/rca.json --status ok --actor harness
```

Gather live/runtime evidence before naming cause. Static code findings are hypotheses until runtime evidence confirms the path.

### 4. Design

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" artifact.written design "Design anchors and acceptance criteria written" --artifact design/anchors.json --status ok --actor claude-code
```

Write anchors, acceptance criteria, blast radius, and ADR if hard-to-reverse.

### 5. Implement

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" node.entered implement "Implementation started in Claude Code runtime" --artifact session/events.jsonl --status ok --actor claude-code
```

Keep edits narrow and tied to the design anchors.

### 6. Red Zone

If the change touches auth, billing, data deletion, provider config, deployments, production secrets, or migrations, stop:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required before continuing" --artifact approvals/redzone.json --status warn --actor harness
```

Wait for human approval.

If no Red Zone applies:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" gate.fired redzone "Red Zone checked; no approval required" --artifact approvals/redzone.json --status ok --actor harness
```

### 7. Prove

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" gate.fired prove "Proof gate fired; validation must produce proof/proof.json" --artifact proof/proof.json --status ok --actor harness
```

Run tests/evals/smoke checks. If proof is missing or failing:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" run.blocked prove "Finish blocked because proof/proof.json is missing or failing" --artifact proof/proof.json --status blocked --actor harness
```

### 8. Handoff

Only after required proof exists:

```bash
node scripts/uash-emit-event.mjs "$RUN_ID" run.completed handoff "All required artifacts are present; Answer Contract handoff ready" --artifact handoff/final.md --status ok --actor harness
```

Final answer shape:

```text
Bottom line
Why
Proof
Fix
Your call

Lane taken:
Gates fired + artifact paths:
Skipped steps + why:
```
