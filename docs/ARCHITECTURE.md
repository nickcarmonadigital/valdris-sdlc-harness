# Architecture

## System shape

```text
Vercel UI / API
    |
    v
Task + artifact service
    |
    v
Workflow engine
    |
    +--> Codex connector
    +--> Claude Code connector
    +--> Hermes connector
    +--> Graphify adapter
    +--> GitHub adapter
    +--> Human approval adapter
    |
    v
Local runner daemon / worktree watcher
```

## Storage objects

- organizations
- projects
- repos
- harness packs
- source-truth rules
- lane families
- production-readiness layer assessments
- cloud/platform service maps
- QA plans and break-it results
- red-zone rules
- tasks
- sessions
- session events
- node states
- skip reasons
- failure recovery paths
- artifacts
- artifact versions
- gates
- gate runs
- approvals
- graph snapshots
- worktrees
- self-heal reports
- self-heal PRs

## MVP deployment

- Frontend/API: Vercel.
- Local runner: user's machine, later downloadable daemon.
- GitHub: repo install / OAuth / app later.
- Agent runtime: external connector, not embedded IDE.
- Database: start with SQLite/local JSON for CLI; move to Postgres/Supabase when hosted collaboration begins.

## Control principle

The workflow engine owns control flow. The model proposes actions or writes artifacts. The harness validates whether required gates are satisfied.

## Mode principle

The product has three presentation modes:

- **Blueprint** — static topology/lane taxonomy; no live-run claim.
- **Live Run** — real connector/MCP/CLI/API events only.
- **Replay** — durable historical run packet/events/artifacts.

No UI or doc should imply Claude, Codex, or Hermes traversed a run unless real emitted events or stored replay data exist.
