---
type: Playbook
title: Engineering Task Routing
description: First route for using the Valdris skill on any engineering task in this repo or a commissioned repo.
resource: AGENTS.md
tags: [codex, engineering, routing, skill, playbook]
timestamp: 2026-07-04T00:00:00Z
---

# Start

Use one skill as the entrypoint. The skill should read this vault index first, then open only the playbook or concept needed for the current task.

# Route

1. If the request changes code, architecture, debugging, refactoring, or cross-file behavior, use [GitNexus Code Intelligence](/playbooks/gitnexus-code-intelligence.md).
2. If the request could affect user-facing or production behavior, use [Production Readiness 13 Layers](/playbooks/production-readiness-13-layers.md).
3. If the request is about event emission, live telemetry, Red Zone, self-heal, or completion, read [Connector Event Runtime](/systems/connector-event-runtime.md).
4. If the request is docs-only, still update this vault when the docs change stable routing knowledge.

# Proof

Prefer commands from `docs/Validation Commands.md`, `project-adapter.json`, or `package.json`. For this harness repo, the normal proof stack is:

```bash
npm run knowledge:gate
npm run typecheck
npm run build
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:harness
```

# Handoff

Final answers should name the lane, proof commands, artifact paths, skipped nodes with reasons, and open risks. Use [Proof-First Harness](/concepts/proof-first-harness.md) as the final-answer standard.
