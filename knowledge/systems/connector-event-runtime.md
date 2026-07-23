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

- [Engineering Task Routing](/playbooks/engineering-task-routing.md)
- [Proof-First Harness](/concepts/proof-first-harness.md)

# Credential Boundary

The bridge fails closed unless three credentials containing at least 32 bytes each are configured with pairwise-distinct values. `UASH_BRIDGE_INTEGRITY_KEY` remains bridge-only and keys authenticated local state. `UASH_BRIDGE_ACCESS_TOKEN` is the ordinary API capability supplied to agents and the server-side UI proxy. `UASH_HUMAN_APPROVAL_TOKEN` remains with the human operator and is additionally required for grant/deny events. A human approval write requires both access and approval credentials; neither agents nor browser JavaScript receive integrity or approval credentials, and finish-line validator subprocesses receive none of the three.

`UASH_REVIEW_TRUST_SHA256` is the separate, nonsecret trust-root pin. An operator or protected CI context supplies the canonical-JSON SHA-256 out of band; the bridge seals it into immutable run configuration and propagates it to child validators while stripping all bridge credentials. Live and reviewed-commit trust stores must both match it. Commissioning may print the candidate digest for operator review, but neither a repository copy nor an agent-controlled environment can authorize its own replacement. Rotation requires the protected external pin to be updated through the governed operator path before artifacts under the new trust store are accepted.

Artifact claims are content-bound runtime state: the bridge seals each claimed SHA-256 into the authenticated event journal, preserves that baseline during crash replay, and rechecks required files before and after finish-line gates and whenever completed state is read. Persistent mutation, deletion, symlink replacement, proof/production schema drift, or final-gate drift quarantines completion. Create retries are idempotent, malformed event IDs are rejected before append, and first-event artifact-root/adapter bindings are persisted before the journal can reference them.

# Authoritative Repo Files

- `docs/CONNECTOR_EVENT_CONTRACT.md`
- `docs/CODEX_CONNECTOR.md`
- `docs/CLAUDE_CODE_CONNECTOR.md`
- `scripts/uash-emit-event.mjs`
- `scripts/claude-code-bridge.mjs`
