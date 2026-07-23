# Production Readiness Layer Pack

This pack turns “real full stack is more than frontend plus backend” into a control-level assurance model. It is a lane pack inside Valdris, not the whole SDLC.

## Thirteen layers

| Layer                             | Enterprise question                                                                                   | Catalog controls                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Frontend                          | Are critical client journeys accessible, correct, and within performance budgets?                     | accessibility, behavior, performance |
| Backend/API logic                 | Are contracts compatible and timeout/retry/idempotency/failure paths observable?                      | contract, failure, trace             |
| Database/storage                  | Are migrations, integrity boundaries, retention, backup, and restore proven?                          | migration, integrity, recovery       |
| Auth/permissions/RLS              | Does every operation enforce server-side and tenant-safe authorization across the identity lifecycle? | authz, tenant, lifecycle             |
| Hosting/deployment                | Is promotion attributable, target-environment health measured, and rollback exercised?                | promotion, health, rollback          |
| Cloud/compute                     | Is topology reproducible, least-privilege, drift-aware, regional, owned, and cost-bounded?            | IaC, boundary, cost                  |
| CI/CD/version control             | Do required checks, supply-chain scans, provenance, and approvals protect the release?                | gates, supply chain, provenance      |
| Security                          | Are current threats, secrets, vulnerabilities, and trust boundaries governed?                         | threat, secrets, vulnerability       |
| Rate limiting                     | Are limits, overload behavior, retry storms, and usage meters controlled?                             | policy, failure, metering            |
| Caching/CDN                       | Are identity-aware keys, invalidation, freshness, purge, and tenant isolation correct?                | key, invalidation, isolation         |
| Load balancing/scaling            | Are capacity, progressive delivery, abort, routing, and failure modes tested?                         | capacity, progressive, failover      |
| Error tracking/logs/observability | Are flows correlated, SLO-owned, alertable, and privacy-safe?                                         | telemetry, SLO, redaction            |
| Availability/recovery/DR          | Are workload-specific objectives, restore/failover, and incident roles exercised?                     | objectives, restore, incident        |

The machine catalog is `controls/production-layers.v2.json`. Its dependency fields form an acyclic assurance prerequisite graph.

## Per-run artifact

Every production-impacting run writes `production/layer-assessment.json` using `uash.production-readiness.v2`.

A required layer must name its owner and every catalog control. Every passing control contains typed evidence. A non-applicable layer uses `applicability: "not-applicable"`, `status: "skipped"`, and a precise reason. Intake may temporarily mark a layer `potentially-affected` in `run/route.json`, but that state must resolve before the v2 finish-line artifact is written.

Typed evidence is validated rather than trusted as prose:

- repository-contained, hash-bound artifacts;
- zero-exit commands with output digests;
- metrics whose operators and thresholds are recomputed;
- scoped approvals granted by a named human;
- digest-bound provider reports.

Enterprise and regulated artifact evidence also binds commit and environment. See `docs/ENTERPRISE_CONTROL_MODEL_V2.md` for the complete contract.

## Validate

```bash
npm run production:gate
```

Legacy `uash.production-readiness.v1` history remains readable, but the commission generator emits v2.

## Skip and finish rules

- No canonical layer may be silently omitted.
- A required layer or control cannot be skipped.
- `failed`, `pending`, `blocked`, `required`, and `needs_approval` block completion.
- Approval authorizes a risk decision; it does not turn missing or failing technical evidence into a pass.
- The finish line requires every applicable control to pass and every non-applicable layer to carry a workload-specific reason.
