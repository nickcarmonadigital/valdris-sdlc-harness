---
name: valdris-platform-release
description: Plan and prove cloud, deployment, CI/CD, observability, scaling, incident, and recovery work. Select as the primary when the requested outcome is to change infrastructure, hosting, provider configuration, deployment, TestFlight/App Store delivery, reliability, SLOs, rollback, backup, failover, incident response, or capacity. This skill owns the release operation; valdris-proof-handoff owns the final readiness decision.
---

# Valdris Platform And Release

1. Load the adapter's environment, provider, branch, deployment, and approval rules; validate the intake, classification, route, and code-intelligence artifacts.
2. Resolve the route-required Layer 0 foundation assessment before changing infrastructure or release behavior.
3. Produce a service and dependency map with owners, regions, data boundaries, and failure modes.
4. Require reviewable IaC or configuration diffs; reject dashboard-only claims without exported evidence.
5. Define workload-specific SLOs, error budgets, capacity assumptions, cost ceilings, rollback triggers, RTO, and RPO.
6. Validate CI provenance, staged promotion, health checks, telemetry, alerts, rollback, and restore. Require smoke only when the route identifies deployed, provider-integration, platform-native, or runtime behavior.
7. Exercise failure or recovery only inside the approved blast radius.
8. Classify all affected production assurance domains and hard dependencies; treat conditional dependencies as applicability questions, not automatic expansion.
9. If the current host cannot run platform-native proof, keep that stopping condition open and route it to an approved runner; never substitute source inspection for a signed build, device test, provider smoke, restore, or failover result.

Stop for human approval before production deploys, TestFlight/App Store uploads or promotions, traffic/DNS changes, secrets, IAM, data restore, failover, chaos tests, spend commitments, payment-provider changes, charges/refunds/voids/reconciliation, or customer communications.

Availability without correctness is not recovery; degraded AI fallbacks must also pass quality and safety gates.
