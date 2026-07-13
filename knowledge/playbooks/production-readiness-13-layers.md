---
type: Playbook
title: Production Readiness 13 Layers
description: Full-stack production readiness route for production-impacting engineering tasks.
resource: scripts/production-layer-gate.mjs
tags: [production, full-stack, readiness, gates, proof]
timestamp: 2026-07-04T00:00:00Z
---

# When To Use

Use this when work can affect production behavior, users, deployability, security, data, reliability, runtime operations, or handoff risk.

# Canonical Layers

`frontend`, `backend-api-logic`, `database-storage`, `auth-permissions-rls`, `hosting-deployment`, `cloud-compute`, `cicd-version-control`, `security`, `rate-limiting`, `caching-cdn`, `load-balancing-scaling`, `error-tracking-logs-observability`, `availability-recovery-dr`.

# Required Artifact

`production/layer-assessment.json` must classify every layer exactly once.

* `passed` requires evidence.
* `skipped` requires a reason.
* `failed`, `pending`, `blocked`, `required`, and `needs_approval` block completion.

# Command

```bash
node scripts/production-layer-gate.mjs --repo .
```

# Related Concept

Use [Proof-First Harness](/concepts/proof-first-harness.md) to shape the final evidence report.
