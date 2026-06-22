# Production Readiness Layer Pack

This pack converts “real full-stack is more than frontend + backend” into harness nodes and gate rules.

It is **not** the whole SDLC. It is a lane pack inside the Agentic SDLC Harness.

## Layer checklist

| Layer | Harness question | Common proof |
|---|---|---|
| Frontend | Does the UI/client behavior change? | screenshot, browser/e2e pass, route proof |
| Backend/API logic | Does server behavior or API contract change? | API test, request/response proof, logs |
| Database/storage | Does persistence, schema, migration, or object storage change? | migration proof, rollback path, data sample |
| Auth/permissions/RLS | Does identity, authorization, RLS, tenant data, or roles change? | authz test, RLS policy proof, negative permission case |
| Hosting/deployment | Does runtime host, env, or deploy config change? | deploy log, preview/staging URL, health check |
| Cloud/compute | Does cloud compute/service topology change? | service map, CLI output, resource diff |
| CI/CD/version control | Does pipeline, branch, release, or workflow behavior change? | workflow run, required check list |
| Security | Does attack surface, secrets, data boundary, or threat model change? | threat note, secret scan, security checklist |
| Rate limiting | Could abuse/traffic/concurrency matter? | policy/config proof, load/edge-case note |
| Caching/CDN | Does cache, CDN, invalidation, or stale data matter? | cache policy, invalidation proof, stale-data test |
| Load balancing/scaling | Does traffic routing, scaling, or health check behavior change? | LB/health config, scaling policy, traffic proof |
| Error tracking/logs/observability | Can operators see failures after release? | log/query/dashboard/alert proof |
| Availability/recovery/DR | Could outage, rollback, backup, restore, or failover matter? | rollback plan, backup/restore note, RTO/RPO note |

## Required per-run classification

Every run should write or embed a production layer assessment:

```json
{
  "artifact": "production/layer-assessment.json",
  "touched_layers": ["backend-api", "database-storage", "auth-permissions"],
  "skipped_layers": [
    {
      "layer": "cdn-cache",
      "reason": "No read-heavy endpoint, static asset, or cross-region latency concern in this task."
    }
  ],
  "required_proof": ["api-test", "migration-proof", "authz-negative-test"]
}
```

## Skip rule

A layer is never silently absent. It is either:

- relevant and required,
- relevant but blocked/needs approval,
- skipped with a reason,
- pending because intake is incomplete.

Example skip reasons:

```text
Caching/CDN skipped:
No read-heavy endpoint, static asset, or cross-region latency concern in this task.

Load balancing skipped:
No traffic topology, health check, or scaling policy changed.

DR skipped:
No persistence, backup, restore, or rollback behavior changed; existing DR assumptions remain unchanged.
```

## Finish-line implication

Finish-line can pass only if every relevant production layer has proof or every irrelevant layer has a visible skip reason.
