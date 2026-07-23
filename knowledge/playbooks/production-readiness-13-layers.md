---
type: Playbook
title: Production Readiness 13 Domains
description: Full-stack production assurance across the 13 canonical domains and any workload-specific additions.
resource: scripts/production-layer-gate.mjs
tags: [production, full-stack, readiness, gates, proof]
timestamp: 2026-07-13T00:00:00-04:00
---

# When To Use

Use this when work can affect production behavior, users, deployability, security, data, reliability, runtime operations, or handoff risk.

Start with [Layer Zero Assurance](/playbooks/layer-zero-assurance.md) when workload classification or foundation assurance applies. Layer 0 resolves the minimum capabilities, tiers, profile, and proof contract before production-domain evidence is accepted.

# Canonical Assurance Domains

`frontend`, `backend-api-logic`, `database-storage`, `auth-permissions-rls`, `hosting-deployment`, `cloud-compute`, `cicd-version-control`, `security`, `rate-limiting`, `caching-cdn`, `load-balancing-scaling`, `error-tracking-logs-observability`, `availability-recovery-dr`.

Existing schemas and artifact fields use `layer` for compatibility, but these are assurance domains, not an exhaustive list of literal code, infrastructure, or runtime layers. They are the current common baseline. Workload-specific domain packs and commissioned controls may add obligations without pretending they are part of the canonical thirteen.

Asynchronous orchestration is cross-cutting rather than a fourteenth domain. Assess queues, schedulers, workers, retries, idempotency, ordering, backpressure, telemetry, scaling, and recovery in every affected domain.

Catalog `dependencies` are hard assurance prerequisites. `conditionalDependencies` are common architectural relationships that classification or accountable review must resolve; they do not automatically turn a static frontend, SDK, CLI, or isolated service change into a full-stack application.

# Required Artifact

`production/layer-assessment.json` must classify every canonical domain exactly once using the compatibility `layer` field.

- `passed` requires evidence.
- `skipped` requires a reason.
- `failed`, `pending`, `blocked`, `required`, and `needs_approval` block completion.

# Command

```bash
node scripts/production-layer-gate.mjs --repo .
```

# Related Concept

Use [Layer Zero Assurance](/playbooks/layer-zero-assurance.md) to validate the foundation contract and [Proof-First Harness](/concepts/proof-first-harness.md) to shape the final evidence report.
