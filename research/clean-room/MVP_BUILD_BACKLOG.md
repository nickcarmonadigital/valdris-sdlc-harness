# MVP Build Backlog — Universal Agentic SDLC Harness Platform

## Epic 0 — Clean-room evidence and spec

- [x] Create Source Manifest for every supplied source.
- [x] Create per-source evidence files.
- [x] Aggregate Source Evidence Dossier.
- [x] Integrate latest Prompt Library.
- [x] Produce clean-room functional spec.
- [x] Produce public OSS architecture map.

## Epic 1 — Local commissioning CLI

- [ ] Create repo/package: `valdris-sdlc-harness`.
- [ ] Define `project.yaml` schema.
- [ ] Define `answers.yaml` commissioning schema.
- [ ] Implement `harness commission --repo --answers --out`.
- [ ] Ask missing questions interactively.
- [ ] Generate `project.yaml`, `source_truth.yaml`, `red_zone.yaml`, `validation.yaml`.
- [ ] Generate root files: `AGENTS.md`, `CLAUDE.md`, `00_MAP.md`, `CONTEXT.md`, `INDEX.md`, `REVIEW_ORDER.md`.
- [ ] Generate selected workspaces/lanes/stages.
- [ ] Generate Prompt Library from project adapter.
- [ ] Run coherence check.

## Epic 2 — Graphify adapter

- [ ] Run Graphify scan against local repo path.
- [ ] Store graph snapshot metadata.
- [ ] Generate Codebase Map.
- [ ] Generate Blast Radius Map.
- [ ] Add graph freshness check.
- [ ] Add unresolved-human-questions list after scan.

## Epic 3 — Gate/artifact validator

- [ ] Define gate artifact schema.
- [ ] Port/provision proof, RCA, redzone, smoke, finish-line gates.
- [ ] Add required-artifacts resolver by lane/work type.
- [ ] Implement finish-line validator: missing artifact = cannot mark done.
- [ ] Add anti-skip nudge library.
- [ ] Add dry-run redzone simulation.

## Epic 4 — Kanban / run packet integration

- [ ] Create board per project.
- [ ] Create root card per task.
- [ ] Generate cards for stages.
- [ ] Attach run packet path.
- [ ] Persist stage outputs/artifact paths.
- [ ] Block completion unless finish-line validator passes.

## Epic 5 — Runner MVP

- [ ] Implement Hermes adapter first.
- [ ] Run agent in per-task worktree.
- [ ] Capture session transcript/events.
- [ ] Capture tool calls/diffs/proofs.
- [ ] Add resume/fork metadata.
- [ ] Add Claude/Codex adapters later.

## Epic 6 — Web app MVP

- [ ] Project creation.
- [ ] Commissioning interview wizard.
- [ ] GitHub read-only connection.
- [ ] Harness preview/diff.
- [ ] Source Truth + Red Zone approval screens.
- [ ] Task/artifact dashboard.
- [ ] Gate/proof viewer.

## Epic 7 — Product safety

- [ ] Secret redaction in logs/events.
- [ ] Tool policy allowlist/denylist/approval list.
- [ ] License provenance field per source/repo.
- [ ] Audit log for approvals and tool calls.
- [ ] No transcript invention: blocked transcript must show blocker.
