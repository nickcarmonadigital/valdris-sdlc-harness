# Test-Day Acceptance Gates

## Bottom line

This is the repo-facing version of the test-day discussion: Valdris is not “done” because a diagram exists or a prompt sounds right. It is done when the control plane can commission a repo, teach what good looks like, route agents through the correct flow, reject fake completion, and show proof that survives adversarial checks.

## Test-day gates

| Gate | Question | Pass signal |
|---|---|---|
| Commissioning depth | Did the harness ask enough to know the team/repo/quality bar? | `npm run commission:questions` returns 30 groups / 150 questions. |
| Good-looks-like foundation | Does the generated pack teach architecture/quality/proof before feature work? | Generated docs include Good Looks Like, Code Quality Guardrails, Enterprise Proof Bank. |
| Graphify/code graph | Does the run map the repo before cross-file reasoning? | `graph/graph.json`, `graph/freshness.json`, `design/anchors.json` pass gates. |
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
npm run build
npm run verify:harness
npm run graphify:scan
npm run graphify:gate
npm run commission -- --repo . --project-name "Valdris SDLC Harness" --out /tmp/valdris-commissioned --yes
```

Then verify the generated pack contains:

```text
project-adapter.json
AGENTS.md
CLAUDE.md
.claude/commands/valdris-sdlc-harness.md
docs/Codex Runtime Prompt.md
docs/Graphify Code Graph.md
docs/Good Looks Like Foundation.md
docs/Code Quality Guardrails.md
docs/Enterprise Proof Bank.md
docs/Operating Intelligence Layer.md
docs/Team Harness Registry.md
docs/Human Agent Protocol.md
scripts/uash-emit-event.mjs
scripts/graphify-scan.mjs
scripts/graphify-gate.mjs
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

## Known next phase after v0.5

The v0.5 update installs structural operating intelligence. The next phase is executable specialization:

- eval gate script;
- trajectory scorer;
- context manifest gate;
- skill registry gate;
- tool/hook registry enforcement;
- sandbox policy gate;
- model-routing/cost ledger enforcement;
- enterprise/domain proof-bank semantic validators;
- hosted backend / MCP daemon / A2A connector runtime.
