---
type: System
title: Valdris SDLC Harness
description: Universal proof-first SDLC harness that commissions repos, routes agent work, and blocks done until evidence exists.
resource: README.md
tags: [valdris, harness, system, sdlc, codex]
timestamp: 2026-07-04T00:00:00Z
---

# Purpose

Valdris SDLC Harness turns agent engineering work into a reviewable run packet. It keeps coding agents external, but gives them a repo-specific operating manual, workflow nodes, proof gates, and handoff rules.

# Agent Entry Points

Use [Engineering Task Routing](/playbooks/engineering-task-routing.md) for normal tasks. Use [GitNexus Code Intelligence](/playbooks/gitnexus-code-intelligence.md) before code-impacting claims. Use [Production Readiness 13 Layers](/playbooks/production-readiness-13-layers.md) when production behavior could be affected.

# Authoritative Repo Files

* `README.md` for the product overview.
* `AGENTS.md` and `CLAUDE.md` for runtime front doors.
* `scripts/commission-harness.mjs` for generated pack structure.
* `scripts/verify-harness.mjs` for adversarial proof coverage.
* `docs/HARNESS_REPO_MAP.md` for the deeper file-by-file map.
