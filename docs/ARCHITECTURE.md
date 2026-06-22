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
- red-zone rules
- tasks
- sessions
- session events
- artifacts
- artifact versions
- gates
- gate runs
- approvals
- graph snapshots
- worktrees

## MVP deployment

- Frontend/API: Vercel.
- Local runner: user's machine, later downloadable daemon.
- GitHub: repo install / OAuth / app later.
- Agent runtime: external connector, not embedded IDE.
- Database: start with SQLite/local JSON for CLI; move to Postgres/Supabase when hosted collaboration begins.

## Control principle

The workflow engine owns control flow. The model proposes actions or writes artifacts. The harness validates whether required gates are satisfied.
