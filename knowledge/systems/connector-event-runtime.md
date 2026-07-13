---
type: System
title: Connector Event Runtime
description: Local bridge and event contract that records run events, verifies artifacts, and rejects fake completion.
resource: scripts/claude-code-bridge.mjs
tags: [connector, bridge, events, artifacts, approvals, proof]
timestamp: 2026-07-04T00:00:00Z
---

# Purpose

The connector runtime is the boundary between Codex/Claude/Hermes-style external agents and the harness run ledger. It accepts real events, verifies artifacts under the declared artifact root, and blocks completion when proof, skip reasons, approvals, or self-heal obligations are missing.

# Related Playbooks

* [Engineering Task Routing](/playbooks/engineering-task-routing.md)
* [Proof-First Harness](/concepts/proof-first-harness.md)

# Authoritative Repo Files

* `docs/CONNECTOR_EVENT_CONTRACT.md`
* `docs/CODEX_CONNECTOR.md`
* `docs/CLAUDE_CODE_CONNECTOR.md`
* `scripts/uash-emit-event.mjs`
* `scripts/claude-code-bridge.mjs`
