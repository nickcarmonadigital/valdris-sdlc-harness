# Test-Day Acceptance Gates

## Bottom line

This is the repo-facing version of the test-day discussion: Valdris is not “done” because a diagram exists or a prompt sounds right. It is done when the control plane can commission a repo, teach what good looks like, route agents through the correct flow, reject fake completion, and show proof that survives adversarial checks.

## Test-day gates

| Gate | Question | Pass signal |
|---|---|---|
| Commissioning depth | Did the harness ask enough to know the team/repo/quality bar? | `npm run commission:questions` returns 31 groups / 158 questions. |
| Good-looks-like foundation | Does the generated pack teach architecture/quality/proof before feature work? | Generated docs include Good Looks Like, Code Quality Guardrails, Enterprise Proof Bank. |
| GitNexus/code intelligence | Does the run map the repo before cross-file reasoning? | `graph/gitnexus.json`, `graph/graph.json`, `graph/freshness.json`, `design/anchors.json` pass gates. |
| Mode honesty | Does UI/docs separate Blueprint, Live Run, and Replay? | No fake live telemetry; live requires bridge/MCP/API/CLI/watched events. |
| Event contract | Are skipped/failed/approval/self-heal states explicit? | Bridge validates event type, node, status, actor, mode, source, skip/failure/recovery metadata. |
| Proof bank | Does proof cover enterprise dimensions, not toy demo proof? | `proof/proof.json` cites relevant proof-bank dimensions or skip reasons. |
| Red Zone | Can an agent approve its own risky action? | No; approval grants/denials require human actor and matching pending scope. |
| Self-heal | If the harness failed, does the system force a proposed fix? | `self_heal.detected` blocks done until PR/proposal artifact exists. |
| Finish line | Can a run mark complete early? | Bridge rejects completion until required artifacts pass or are skipped with reasons. |
| Handoff | Can a human make the next decision quickly? | `handoff/final.md` includes bottom line, proof, risk, rollback/next step. |

## Required local verification command set

Run before claiming the repo update is done:

```bash
npm run typecheck
npm run dependency:audit
npm run build
npm run knowledge:gate
npm run skills:gate
npm run catalog:gate
npm run provenance:gate
npm run neutrality:gate
npm run privacy:gate
npm run verify:release-privacy
npm run privacy:release
npm run schema:compat:gate
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:enterprise-ai
npm run verify:work-harness-import
npm run verify:commissioned-portability
npm run verify:harness
```

`verify:work-harness-import` runs the focused import-boundary, assurance-overlay, portable-execution, proof-security, run-packet-trust, and commissioned-portability adversarial verifiers. The explicit commissioned-portability run remains in this release sequence so commissioning regressions are visible as a first-class acceptance gate.

Then verify target-root `AGENTS.md` and `CLAUDE.md` each contain exactly one bounded `valdris-sdlc-harness-loader` block that loads the corresponding nested front door without replacing pre-existing instructions, and that both loaders are Git-tracked with the pack. Verify the generated pack contains:

```text
project-adapter.json
AGENTS.md
CLAUDE.md
.claude/commands/valdris-sdlc-harness.md
docs/Codex Runtime Prompt.md
docs/Proof Schema.md
docs/Code Intelligence Graph.md
docs/GitNexus Code Intelligence.md
docs/Good Looks Like Foundation.md
docs/Code Quality Guardrails.md
docs/Enterprise Proof Bank.md
docs/Operating Intelligence Layer.md
docs/Team Harness Registry.md
docs/Human Agent Protocol.md
scripts/code-intelligence-scan.mjs
scripts/uash-emit-event.mjs
scripts/uash-write-proof.mjs
scripts/code-intelligence-local-scan.mjs
scripts/code-intelligence-gate.mjs
scripts/anchor-gate.mjs
```

## What “main updated” means

Do not call `main` updated until:

1. local worktree contains the intended changes;
2. validation command set passes;
3. independent review finds no blocker;
4. changes are committed;
5. commit is pushed to `origin/main`;
6. remote `origin/main` SHA equals local `HEAD`;
7. public/raw GitHub files show the key strings after push.

## Current v0.8 status and remaining next phase

The v0.8 closure now includes executable context-manifest, typed context A/B result, eval, trajectory, skill-registry, enterprise-AI, domain-pack, portable-proof, four-role review, and coherent run-packet gates. Their focused verifiers are part of the required command set above.

Remaining productization work is deeper tool/hook policy enforcement, executable load and observability gates, broader domain-specific adapters, and an optional hosted backend / MCP daemon / A2A connector runtime. These are explicit future capabilities, not missing implementations of the current v0.8 schemas.
