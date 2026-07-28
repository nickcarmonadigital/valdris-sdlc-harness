---
type: System
title: Valdris SDLC Harness
description: Universal proof-first SDLC harness with seven lifecycle-system skills, eight work-type skills, durable goals, assurance gates, and evidence-backed completion.
resource: README.md
tags: [valdris, harness, system, sdlc, codex]
timestamp: 2026-07-13T00:00:00-04:00
---

# Purpose

Valdris SDLC Harness turns agent engineering work into a reviewable run packet. It keeps coding agents external, but gives them a repo-specific operating manual, bound workload classification, Layer 0 foundation assurance, workflow nodes, proof gates, and handoff rules.

The lifecycle control flow is `commission -> route-goal -> assure -> connect-runtime -> execute-workflow -> prove-govern -> trust-improve`. These seven skills select the owning Valdris system. Inside routed work, a separate eight-skill catalog selects one primary workflow skill per intake, delivery, or proof-handoff phase. The catalogs are complementary, not a fifteen-way flat choice.

Lifecycle skills, workflow skills, and commissioned lanes have different jobs. A lifecycle skill owns one control-plane system end to end. A workflow skill
selects the phase procedure. A lane loads project-specific context, ownership,
commands, runtime/model policy, and gate emphasis. The immutable route may bind
the work skill and lane while the lifecycle registry governs the surrounding system flow; none is a substitute for another.

A commissioned target must review and commit its generated `.valdris-harness`
pack and front-door files before it creates an immutable route. Routing then
runs from the target root with the committed target-local router. Independent
review covers the frozen evidence set after all applicable technical evidence,
including Red Zone authorization and smoke proof; changing that set requires a
fresh review.

# Agent Entry Points

Use [Engineering Task Routing](/playbooks/engineering-task-routing.md) for normal tasks. Use [Layer Zero Assurance](/playbooks/layer-zero-assurance.md) to bind classification and resolve foundation requirements before feature or architecture implementation. Use [GitNexus Code Intelligence](/playbooks/gitnexus-code-intelligence.md) before code-impacting claims. Use [Production Readiness 13 Domains](/playbooks/production-readiness-13-layers.md) when production behavior could be affected.

The thirteen production domains are the current shared assurance baseline, not an exhaustive list of literal system layers. Asynchronous orchestration is cross-cutting and must be evaluated across every domain it affects.

# Authoritative Repo Files

- `README.md` for the product overview.
- `AGENTS.md` and `CLAUDE.md` for runtime front doors.
- `controls/workload-taxonomy.v1.json` and `scripts/workload-classification-gate.mjs` for bound workload classification.
- `controls/foundation-layer.v1.json` and `scripts/foundation-gate.mjs` for Layer 0 assurance.
- `skills/registry.json` and `skills/codex-routing.yaml` for the seven lifecycle and eight workflow skill catalogs.
- `scripts/route-lifecycle-skill.mjs` for deterministic lifecycle-system routing.
- `scripts/commission-harness.mjs` for generated pack structure.
- `scripts/verify-harness.mjs` for adversarial proof coverage.
- `docs/HARNESS_REPO_MAP.md` for the deeper file-by-file map.
