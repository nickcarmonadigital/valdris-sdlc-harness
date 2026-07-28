---
name: valdris-sdlc-harness
description: Operate on the Valdris SDLC Harness repository and its commissioning system. Use when Codex is asked to audit, validate, repair, extend, release, or commission the harness itself, its generated packs, UASH bridge, proof gates, knowledge vault, project adapters, or Layer 0 plus 13-domain control plane. Do not use as the primary workflow inside an already commissioned target repo; let the seven lifecycle skills select the owning Valdris system and the eight workflow skills route the engineering work.
---

# Valdris SDLC Harness

Use this meta skill to maintain the Valdris control plane and commissioning contract. Artifacts beat claims: no proof, no done.

## Core Protocol

1. Classify mode before loading context: Valdris repo work, commissioned target repo, live run, or docs/audit only. Read `references/run-modes.md` when the mode is not obvious.
2. Load the smallest source set. For the harness repo or a commissioned repo, read `knowledge/index.md` first when present; it is the OKF-style progressive-disclosure map. Then read `README.md`, `AGENTS.md`, `package.json`, and relevant `docs/` as needed. For target repos, prefer root `project-adapter.json`; else `.valdris-harness/project-adapter.json`.
3. If commissioned files exist, read them first and do not regenerate or re-ask stable facts unless the pack is incomplete.
4. Refresh branch context with git commands for code work. Read `references/verification-and-branches.md` for the command set and gates.
5. For codebase, architecture, refactor, debugging, or cross-file implementation work, run code intelligence before design claims. Disclose local fallback; do not claim GitNexus-backed analysis unless GitNexus succeeded.
6. For production-impacting work, require `production/layer-assessment.json` to classify all 13 canonical layers as passed with evidence or skipped with reasons.
7. When stable routing knowledge changes, update `knowledge/` and run the OKF vault gate if present.
8. For live bridge mode, emit only real events. Set `UASH_BRIDGE_URL="$BRIDGE_URL"`, run from the artifact root that contains the pack, and include `--artifact-root "$PWD"` on the first event or create/sync the run with the correct root first.
9. Before final, run relevant validation and report proof paths, skipped nodes/reasons, risks, and self-heal status.

## Reference Routing

- `references/repo-source-map.md`: use for locating harness docs/scripts and deciding which repo file owns a rule.
- `references/run-modes.md`: use for pack detection, `.valdris-harness/` mode, live bridge mode, and offline/local behavior.
- `references/verification-and-branches.md`: use before edits, gates, final proof, GitNexus fallback disclosure, and 13-layer production readiness.

## Hard Rules

- Project adapter is source of truth for commissioned repos.
- GitNexus-backed unless disclosed fallback.
- Skipped is a state, not silence.
- Red Zone is human-only.
- No fake live telemetry.
- Self-heal PR/proposal events require a real PR URL or verified local `self_heal/pr.json`.
- Final answer shape: Bottom line, why, proof, risk, fix/plan, your call.
