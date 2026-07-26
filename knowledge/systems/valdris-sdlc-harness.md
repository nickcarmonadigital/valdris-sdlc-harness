---
type: System
title: Valdris SDLC Harness
description: Universal proof-first SDLC harness that classifies workloads, gates foundation assurance, routes agent work, and blocks done until evidence exists.
resource: README.md
tags: [valdris, harness, system, sdlc, codex]
timestamp: 2026-07-13T00:00:00-04:00
---

# Purpose

Valdris SDLC Harness turns agent engineering work into a reviewable run packet. It keeps coding agents external, but gives them a repo-specific operating manual, bound workload classification, Layer 0 foundation assurance, workflow nodes, proof gates, and handoff rules.

The control flow is `authorized intake -> workload classification -> Layer 0 foundation -> one primary workflow skill per phase -> production and domain assurance -> proof handoff`. Classification and foundation are executable gates, not additional selectable skills.

Workflow skills and commissioned lanes have different jobs. A workflow skill
selects the phase procedure. A lane loads project-specific context, ownership,
commands, runtime/model policy, and gate emphasis. The immutable route may bind
both; neither is a substitute for the other.

# Agent Entry Points

Use [Engineering Task Routing](/playbooks/engineering-task-routing.md) for normal tasks. Use [Layer Zero Assurance](/playbooks/layer-zero-assurance.md) to bind classification and resolve foundation requirements before feature or architecture implementation. Use [GitNexus Code Intelligence](/playbooks/gitnexus-code-intelligence.md) before code-impacting claims. Use [Production Readiness 13 Domains](/playbooks/production-readiness-13-layers.md) when production behavior could be affected.

The thirteen production domains are the current shared assurance baseline, not an exhaustive list of literal system layers. Asynchronous orchestration is cross-cutting and must be evaluated across every domain it affects.

# Authoritative Repo Files

- `README.md` for the product overview.
- `AGENTS.md` and `CLAUDE.md` for runtime front doors.
- `controls/workload-taxonomy.v1.json` and `scripts/workload-classification-gate.mjs` for bound workload classification.
- `controls/foundation-layer.v1.json` and `scripts/foundation-gate.mjs` for Layer 0 assurance.
- `scripts/commission-harness.mjs` for generated pack structure.
- `scripts/verify-harness.mjs` for adversarial proof coverage.
- `docs/HARNESS_REPO_MAP.md` for the deeper file-by-file map.
