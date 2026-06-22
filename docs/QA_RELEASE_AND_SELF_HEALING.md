# QA, Live Smoke, and Harness Self-Healing

## QA plan

QA is not just “run tests.” The harness requires the run to state which validation depth applies.

### 1. Normal QA

Validate intended behavior and regression safety:

- lint
- typecheck
- unit/integration tests
- build
- evals if AI/runtime behavior changed
- acceptance criteria proof
- regression proof for nearby behavior

### 2. “Let’s break it” QA

Intentionally try to break the app, service, integration, voice flow, auth boundary, data path, or provider config.

Examples:

- malformed input
- empty/large payloads
- stale data
- permission mismatch
- tenant boundary/RLS negative case
- concurrency/race condition
- provider timeout/retry
- rate limit/abuse path
- cache staleness
- rollback path

Required artifact:

```text
qa/break-it-results.md
```

### 3. Live smoke

Prove the changed behavior in the target environment when local tests are insufficient.

Required fields:

- environment: local / preview / staging / production
- route/API/job/provider/voice path tested
- exact command/browser action/call performed
- observed result
- screenshot/log/request ID where possible
- what was not tested and why

Required artifact:

```text
smoke/smoke_proof.json
```

## Finish-line rule

Finish-line can only pass when all required nodes are passed or explicitly skipped with reasons.

```text
No artifact = no gate pass.
No gate pass = no done.
No evidence = no cause claim.
No approval = no Red Zone action.
Skipped node = explicit reason.
Failed node = recovery path.
```

## Harness self-healing

At the end of every run, classify whether failures came from product code or from the harness/process.

Harness/process failure types:

- repo adapter gap
- lane procedure gap
- gate policy gap
- connector/telemetry bug
- docs/onboarding gap
- missing validation command
- missing Red Zone rule
- missing production-readiness layer

If the process/harness failed, create:

```text
self_heal/self_heal_report.md
```

Then open or propose a scoped PR against the relevant repo/harness pack to update one of:

- adapter defaults
- lane docs
- gate scripts
- prompt/front-door instructions
- connector scripts/event schema
- commissioning questions
- validation commands
- Red Zone rules

## Self-heal event examples

```json
{
  "type": "self_heal.detected",
  "nodeId": "self-heal",
  "status": "warn",
  "artifact": "self_heal/self_heal_report.md",
  "message": "Run exposed a missing production-readiness layer in the adapter."
}
```

```json
{
  "type": "self_heal.pr_opened",
  "nodeId": "self-heal",
  "status": "ok",
  "artifact": "self_heal/pr.json",
  "message": "Opened PR to add cloud/platform commissioning questions."
}
```

Self-heal PRs must be scoped and reviewable. Do not silently mutate policy without an artifact and review path.
