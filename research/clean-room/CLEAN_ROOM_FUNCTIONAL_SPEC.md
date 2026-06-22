# Clean-Room Functional Spec — Universal Agentic SDLC Harness Platform

## Product definition

A universal agentic SDLC harness platform that turns any software repo/team into an AI-operable engineering environment.

It does this by:

1. interviewing the team,
2. connecting/scanning repos,
3. generating a project-specific harness pack,
4. running work through lanes/stages/artifacts/gates,
5. enforcing human approvals and proof artifacts before completion.

## Primary user flow

```text
Sign up / create workspace
→ create project
→ connect GitHub/local repo read-only
→ run Graphify scan
→ complete Harness Commissioning Interview
→ generate project adapter + harness pack
→ review Source of Truth + Red Zone + Validation commands
→ run coherence/proof/redzone dry runs
→ create first Kanban board/task
→ execute agent work through artifact-gated SDLC flow
```

## Functional modules

### 1. Harness Commissioning

Collects human/team facts Graphify cannot know:

- project purpose and users
- production definition
- source-of-truth order
- branch/deploy model
- validation commands
- Red Zone actions
- team permissions
- issue tracker / docs / chat integrations
- answer style
- lanes needed
- ADR thresholds

Output: `project.yaml`, `source_truth.yaml`, `red_zone.yaml`, `validation.yaml`, generated docs/workspaces/prompts.

### 2. Repo Intelligence / Graphify

- Build code graph from repo(s).
- Identify languages/frameworks/entrypoints.
- Map symbols/callers/callees.
- Detect hotspots/blast radius.
- Refresh/check graph freshness before code/design claims.
- Produce `Codebase Map`, `Runtime Surface Map`, `Blast Radius Map`.

### 3. Task Workspace

Each task contains:

- issue/source metadata
- repo(s), branch/worktree/container
- workflow/lane/stage state
- sessions and event logs
- artifacts and comments
- tool calls and approvals
- proof/gate artifacts
- final handoff

### 4. Workflow Engine

Supports configurable workflows:

- QRSPI: Questions → Research → Design → Structure → Plan → Implement
- RPI: Research → Plan → Implement
- Incident: Impact → Evidence → Mitigate → Validate → RCA → Postmortem
- Provider config: current diff → plan → approval → change → verify
- Data: read-only dry run → change plan → approval → execute → verify
- Freeform/oneshot with reduced gates for low-risk tasks

### 5. Agent/Runner Layer

- Provider adapters: Hermes, Claude Code, Codex, OpenCode, raw model APIs.
- Local daemon/runner first; remote workers later.
- Worktree/container isolation per task.
- Session start/resume/fork lineage.
- Tool-call/event/diff capture.
- BYOK credentials stored per org/project.

### 6. Tool + MCP Registry

- Register tools and MCP servers.
- Tool identity/version/schema.
- Per-tool policy: allowed, approval required, forbidden.
- Human approval tool calls as durable state.
- Tool results appended to session/event log.

### 7. Artifact System

Artifact types:

- intake
- research
- design
- ADR
- structure/outline
- implementation plan
- proof
- RCA
- smoke proof
- deploy proof
- handoff
- postmortem

Artifacts are versioned, commentable, and injectable into agent context.

### 8. Gate System

Required gates by work type:

| Work type | Required gates |
|---|---|
| Behavioral bug | preflight, evidence/RCA, proof |
| Feature | grill/spec, ADR if hard-to-reverse, red baseline, proof |
| AI/RAG change | proof + AI behavior/RAG eval + judge validation |
| Deploy | deploy verify + smoke gate |
| Provider config | redzone approval + rollback + verification |
| Data change | dry run + approval + verification queries |
| Incident | impact/evidence/mitigation/validation/RCA/postmortem |

### 9. Finish-Line Validator

A task cannot be marked done unless required artifacts exist and pass.

```text
done = required_artifacts_present && required_artifacts_status_pass || explicit_blocker
```

### 10. Human Collaboration

- Comments on artifacts.
- Approval requests for Red Zone actions.
- Decision capture into ADRs.
- Accepted decisions injected into later agent stages.
- Notification targets: Telegram/Slack/email/web.

## Non-goals for MVP

- Full HumanLayer visual clone.
- Private HumanLayer app compatibility.
- Enterprise SSO on day one.
- Hosted cloud runner before local runner works.
- Kubernetes-native control plane as default.
- Copying private/proprietary code/UI.

## MVP acceptance criteria

- Commission one local repo into a generated harness pack.
- Generate project adapter files from interview + Graphify.
- Create Kanban board and task.
- Run one toy task through intake → plan → proof → handoff.
- Finish-line validator blocks missing proof.
- Red Zone simulation blocks a fake deploy/secret/data action.
