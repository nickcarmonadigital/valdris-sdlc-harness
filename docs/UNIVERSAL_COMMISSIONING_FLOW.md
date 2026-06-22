# Universal Commissioning Flow

## Bottom line

The uploaded Utari harness should not be made universal by watering down its rules. It should become a **commissioning system**: scan a repo, interview the human/operator, generate a repo-specific **project adapter**, then install front-door instructions for Claude Code/Codex that force every run through lanes, artifacts, proof gates, and Red Zone approvals.

```text
repo + human interview
→ project-adapter.json / project.yaml
→ AGENTS.md + CLAUDE.md + 00_MAP.md + CONTEXT.md
→ run packet template + validation/red-zone docs
→ Claude Code/Codex uses that adapter instead of freelancing
```

## Terminology calibration

| Nick-language | Best term | Semantics | Taxonomy | Domain-term calibration |
|---|---|---|---|---|
| “Make my harness universal” | Harness commissioning | Convert repo/team facts into an AI-operable harness pack | Internal Developer Platform / Agentic SDLC | Emerging, strong product term |
| “Questions asked to understand the person and repo” | Commissioning interview | Structured intake that captures facts code scanning cannot infer | Onboarding / discovery workflow | Standard pattern, product-specific use |
| “Put inside Claude Code or Codex” | Agent front door / runtime adapter | Instructions + local tools that make an external coding agent follow the harness | Agent connector | Emerging category |
| “See what was done / what the agent did” | Run packet / artifact ledger | Durable evidence of stages, gates, approvals, proof, and handoff | AgentOps / audit trail | Standardizing now |
| “Don’t let agents freelance” | Policy/gate engine | Mechanical rules that block done without required artifacts | SDLC governance | Standard concept applied to agents |

## What we extracted from the uploaded harness

The uploaded zip is a repo-native Utari/JeremyAI harness with:

- `AGENTS.md` and `CLAUDE.md` front doors.
- `00_MAP.md` and `CONTEXT.md` routing.
- Lane contexts under `workspaces/`.
- Mechanical gates under `_core/scripts/` such as proof, RCA, smoke, red-zone, finish-line, anchor, deploy, migration, and coherence checks.
- Stable docs for validation, red zone, support, incidents, deployment, Graphify, answer contracts, and evals.
- Run packet scaffolds under `runs/`.

That is the **project-specific adapter** for Utari. The universal product should generate the same class of pack for any repo.

## Universal core vs generated adapter

### Universal core

These stay the same across repos:

1. Stage flow: `intake → route → investigate → design → implement → redzone → prove → handoff`.
2. Artifact model: every stage writes or verifies a required artifact.
3. Gate types: pre-flight, revision, escalation, abort.
4. Red Zone model: high-risk mutations need human approval.
5. Proof rule: no artifact, no gate pass; no proof, no done.
6. Agent connector contract: Claude Code/Codex/Hermes emit events and write artifacts.
7. Run packet: task, session, events, proof, approvals, handoff.
8. Answer contract: bottom line, why, proof, fix/plan, your call.

### Project adapter

Generated per repo/team:

1. Human/operator preferences.
2. Project identity, users, production definition, worst failure.
3. Source-of-truth order.
4. Repo role, safe edit paths, review-required paths.
5. Branch and deploy model.
6. Validation commands.
7. Red Zone actions and approval owner.
8. Enabled lanes and custom lanes.
9. ADR policy.
10. Integration map: GitHub, Linear/Jira, Vercel/AWS/Supabase/etc.

## Commissioning interview question bank

The first implementation lives in `scripts/commission-harness.mjs` and exposes the questions via:

```bash
npm run commission:questions
```

Question groups:

1. **Person / team operating style**
   - Primary operator.
   - Preferred answer style.
   - Autonomy level.
   - Agent behavior to avoid.
2. **Project identity**
   - Product/project name.
   - Users/customers.
   - Production definition.
   - Worst plausible agent failure.
3. **Source of truth**
   - Conflict precedence order.
   - Issue tracker/work queue.
   - Stable docs/knowledge base.
4. **Repo and architecture**
   - Repo role.
   - Safe edit paths.
   - Review-required paths.
   - Whether code graph/Graphify scan is required.
5. **Branch and deploy model**
   - Default base branch.
   - Staging branch/environment.
   - Production branch/environment.
   - Merge/deploy owner.
   - Deployment proof.
6. **Validation and proof**
   - Install, lint, typecheck, test, build, smoke/e2e commands.
   - Done definition.
7. **Red Zone boundaries**
   - Approval-required actions.
   - Approval owner.
   - Whether read-only investigation is allowed without asking.
8. **Work lanes**
   - Enabled lanes.
   - Custom lanes.
   - ADR policy.

## Agent install shape

### Claude Code

Generated `CLAUDE.md` should tell Claude:

- Load `project-adapter.json` first.
- If missing, run/ask commissioning questions.
- Follow the node flow.
- Write required artifacts.
- Stop before Red Zone actions.
- Do not claim done without proof.

Future final form:

```text
Claude Code
→ UASH MCP tools / local daemon
→ uash.start_run / uash.write_artifact / uash.fire_gate / uash.request_approval
→ local run packet + cloud visualizer
```

### Codex

Generated `AGENTS.md` should tell Codex:

- Read `00_MAP.md` and `CONTEXT.md`.
- Route by task type.
- Use validation commands from `docs/Validation Commands.md`.
- Treat `project-adapter.json` as the source of repo-specific truth.
- Emit or write events/artifacts through the local bridge when available.

## MVP build sequence

1. **Local commissioning CLI** - implemented now as `npm run commission`.
2. **Repo scanner** - currently detects package manager, scripts, frameworks, repo role; extend with GitHub workflows, Python/Rust/Go, Docker, infra, tests.
3. **Generated harness pack** - implemented now: `project-adapter.json`, `project.yaml`, front doors, map/router, validation/red-zone docs, run template, review packet.
4. **Claude/Codex command templates** - next: add generic slash-command and Codex skill templates that call the local bridge.
5. **Gate script portability** - next: port the uploaded harness `_core/scripts/*` into reusable generator templates.
6. **UI commissioning surface** - next: render the question groups in the web app and store adapter drafts.
7. **Connector event enforcement** - next: make the bridge reject `run.completed` if required artifacts are missing.

## Acceptance criteria for the universal product

A repo is commissioned only when:

- `project-adapter.json` exists and validates.
- `AGENTS.md` and/or `CLAUDE.md` are generated.
- Validation commands are explicit.
- Red Zone owner and approval-required actions are explicit.
- Source-of-truth order is explicit.
- At least one run packet can be created.
- A simulated agent run blocks completion when proof is missing.

## Current proof command

```bash
npm run commission -- --repo /root/valdris-sdlc-harness --project-name "Valdris SDLC Harness" --out /tmp/valdris-commissioned --yes
node -e "JSON.parse(require('fs').readFileSync('/tmp/valdris-commissioned/project-adapter.json','utf8')); console.log('adapter ok')"
```
