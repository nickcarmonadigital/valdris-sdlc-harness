# Architecture

## System classification

Valdris is a repository-level SDLC assurance harness for AI coding agents. It commissions repository controls, routes work, records external coding-agent activity as structured evidence, evaluates gates, and preserves run packets. Claude Code, Codex, Hermes, or another external runtime performs implementation.

Valdris has a qualified secondary role as a repository-level policy and evidence control plane around external coding agents. The qualifier identifies the controlled resources and boundary. `Connector-first` describes an internal integration design; it is not the public product category.

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
    +--> Code intelligence adapter (GitNexus preferred, local graph fallback)
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

## Ontology and terminology assurance

Material product, system, architecture, taxonomy, and controlled-documentation claims use this conditional path:

```text
direct mechanism and evidence
    -> domain ontology and candidate categories
    -> decisive criteria
    -> authoritative web verification when local support is incomplete
    -> classification record
    -> terminology gate
    -> policy/evidence binding in the run packet
```

The external coding agent performs source retrieval through its available tools. Valdris commissions the rule, preserves the source metadata and inference boundary, and rejects structurally unsupported completion. Passing the local terminology gate is structural proof, not semantic or authoritative proof.

## Mode principle

The product has three presentation modes:

- **Blueprint** — static topology/lane taxonomy; no live-run claim.
- **Live Run** — real connector/MCP/CLI/API events only.
- **Replay** — durable historical run packet/events/artifacts.

No UI or doc should imply Claude, Codex, or Hermes traversed a run unless real emitted events or stored replay data exist.
