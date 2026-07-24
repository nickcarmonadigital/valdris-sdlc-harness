---
type: Concept
title: Proof-First Harness
description: Operating principle that every completion claim must be backed by files, commands, or live events.
resource: docs/PROOF_SCHEMA.md
tags: [proof, gates, artifacts, completion, handoff]
timestamp: 2026-07-04T00:00:00Z
---

# Definition

Proof-first means the harness treats artifacts and command output as stronger than agent claims. A run is not done because an agent says it checked something; it is done when the configured gates can verify the required evidence.

# Practical Rules

- Required artifacts must exist under the declared artifact root.
- Skipped nodes need explicit reasons.
- Failed nodes need failure reasons and recovery paths.
- Red Zone approval is human-only.
- Self-heal findings need a real reviewable artifact or PR path.

# Related Playbooks

- [Engineering Task Routing](/playbooks/engineering-task-routing.md)
- [Production Readiness 13 Layers](/playbooks/production-readiness-13-layers.md)
