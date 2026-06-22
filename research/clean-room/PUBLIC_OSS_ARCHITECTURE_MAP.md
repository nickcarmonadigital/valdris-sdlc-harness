# Public OSS Architecture Map — Clean-Room HumanLayer-Like System

This map derives architecture from public/open-source sources only. It is not a copy of HumanLayer private software.

## Core public architecture primitives

| Primitive | Source evidence | Clean-room object |
|---|---|---|
| Agent configuration | `agentcontrolplane` Agent CRD, 12-factor agents | `agents` table/config |
| Model/provider config | `agentcontrolplane` LLM CRD | `llm_configs` / BYOK provider adapters |
| Tool servers | ACP `MCPServer`, 12-factor tools | `tool_servers`, `tools`, MCP registry |
| Human contact/approval | ACP `ContactChannel`, 12-factor human-as-tool | `human_approvals`, `contact_channels` |
| Task | ACP `Task`, HumanLayer homepage tasks | `tasks` |
| Tool call | ACP `ToolCall`, 12-factor structured outputs | `tool_calls` with status/result/error |
| Session | HumanLayer homepage sessions, SDK examples | `sessions`, `session_events` |
| Artifact | HumanLayer homepage artifacts, ACE/RPI docs | `artifacts`, `artifact_versions` |
| Workflow/stage | QRSPI/RPI, AI-that-works phase examples | `workflows`, `stages`, `stage_outputs` |
| Worktree/runner | homepage worktrees/daemon, rpi template | `workspaces`, `worktrees`, `runners` |
| Proof/gate | uploaded harness gates/prompt library | `proofs`, `gate_runs`, artifact validators |

## Recommended clean-room architecture

```text
Web UI / CLI / API
        |
        v
Task + Artifact API  <->  Postgres event store
        |
        v
Workflow engine / Kanban controller
        |
        +--> Agent adapter: Hermes / Claude Code / Codex / OpenCode
        +--> Tool adapter: MCP stdio/http / shell / browser / GitHub / Linear
        +--> Human adapter: Telegram / Slack / email / web approval
        +--> Graphify adapter: code graph query + freshness
        |
        v
Runner daemon
        |
        +--> git worktree/container per task
        +--> gate scripts / proof artifacts
        +--> event log / diffs / test output
```

## Data model v0

```text
orgs
projects
repos
repo_snapshots
graph_snapshots
harness_packs
harness_files
source_truth_rules
red_zone_rules
validation_commands
lanes
workflows
stages
tasks
sessions
session_events
tool_servers
tools
tool_calls
human_approvals
artifacts
artifact_versions
artifact_comments
gate_runs
proofs
adrs
run_packets
kanban_cards
```

## Control loop

1. Task created from UI/issue/webhook/chat.
2. Workflow engine routes to lane/stage.
3. Agent session starts with generated harness context.
4. Agent proposes structured action/tool call/artifact update.
5. Deterministic controller validates policy/Red Zone/source truth.
6. Tool call executes or waits for human approval/input.
7. Result appended to session/context and persisted as event.
8. Gate artifacts written by leaf scripts.
9. Finish-line validator checks required artifacts.
10. Final answer allowed only after gates pass or blocker is explicit.

## HumanLayer-like features to rebuild clean-room

- Task workspace with sessions/artifacts/worktrees.
- Multi-agent/multi-session task orchestration.
- Research/design/plan/implement workflows.
- BYOK provider abstraction.
- Local runner daemon first; remote/cloud runner later.
- Human review/approval as durable tool calls.
- Artifact comments and decision capture.
- Context forking/compaction via artifacts.
- Graphify-backed code grounding.
- Audit/event log from day one.

## What not to copy

- HumanLayer brand, name, site/app UI, private flows, private endpoints, binaries, or proprietary wording.
- No-license repo text/config verbatim.
- Generated SDK/provider source unless license compliance is intentionally handled.
