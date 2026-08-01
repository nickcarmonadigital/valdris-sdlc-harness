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

## Technical communication

Ontology-grounded terminology and controlled technical English govern how repository agents speak and write. This is not an architecture layer, route gate, packet namespace, or product capability.

All technical and operational output uses one stable term for one meaning, direct sentences, and explicit uncertainty. A material public, architectural, legal, safety, or standards naming decision uses this procedure:

```text
direct mechanism and repository evidence
    -> applicable domain ontology
    -> explicit candidate-class criteria
    -> authoritative web verification when local support is incomplete
    -> smallest supported term
    -> plain definition, term status, and uncertainty
```

The external coding agent performs source retrieval through its available tools. A material naming decision can use `classification/classification-record.template.json` when it needs an auditable evidence record. Routine communication does not require a classification artifact.

## Mode principle

The product has three presentation modes:

- **Blueprint** — static topology/lane taxonomy; no live-run claim.
- **Live Run** — real connector/MCP/CLI/API events only.
- **Replay** — durable historical run packet/events/artifacts.

No UI or doc should imply Claude, Codex, or Hermes traversed a run unless real emitted events or stored replay data exist.
