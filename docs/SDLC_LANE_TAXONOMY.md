# Agentic SDLC Harness Lane Taxonomy v0.2

## Core product truth

The parent product remains **Agentic SDLC Harness**.

SDLC is the lifecycle backbone. System design, production architecture, cloud/platform engineering, QA, DevOps/SRE, security, and self-healing are lane families inside that lifecycle.

```text
Human/business need
→ intake / requirements
→ lane classification
→ system design / production impact
→ implementation
→ QA / proof / live smoke
→ deploy / handoff
→ maintenance / self-healing
```

## Required top-level lane families

```text
01 Intake / classify
02 Product + app SDLC
03 System design
04 Cloud / platform engineering
05 Data + integrations
06 Security + compliance
07 QA + release
08 Reliability / observability
09 Handoff
10 Harness self-healing loop
```

## Product + app SDLC lanes

- Bug fix / debug / RCA
- Feature request / feature build
- Refactor / architecture improvement
- Frontend / UI / UX
- Backend / API
- Voice / realtime agent lane
- Agent runtime lane
- RAG / KB / evals lane
- Support triage
- Incident / hotfix
- Docs / process

## System design lanes

Route through System Design when work involves new architecture, scaling, APIs, data modeling, service boundaries, reliability tradeoffs, hard-to-reverse decisions, or ambiguous product behavior.

- Design requirements: throughput, latency, SLOs, SLAs, scale assumptions
- Architecture topology: single server, multi-service, workers, queues, deployment shape
- Computer architecture basics: CPU, RAM, disk, cache, bottlenecks
- Networking: TCP, UDP, DNS, IPs, TLS, ingress/egress
- Application protocols: HTTP, WebSockets, WebRTC, MQTT
- API design: REST, GraphQL, webhooks, contracts, versioning
- Data storage: SQL, NoSQL, graph DBs, object storage
- Database scaling: sharding, replication, ACID, vertical/horizontal scaling
- Caching / CDN: Redis, browser cache, CDN, invalidation strategy
- Load balancing: L4/L7 balancing, health checks, traffic routing
- Reliability: SPOF, failover, graceful degradation, retries, DLQs
- Observability design: logs, metrics, traces, dashboards, alerts
- CI/CD / production app architecture: environments, deploy pipeline, rollback, promotion
- Security design: authN, authZ, secrets, threat model, attack surface

## Cloud / platform engineering lanes

Cloud work is not just “infra.” Use **Platform Engineering** for cloud execution, deployment, operational safety, and production readiness.

- Cloud architecture: AWS/Azure/GCP service selection and account/subscription/project topology
- Infrastructure as Code: Terraform, CDK, Pulumi, CloudFormation, Bicep
- Networking: VPC/VNet, subnets, routing, NAT, DNS, TLS, ingress/egress
- Compute/orchestration: ECS, EKS, Lambda, EC2, App Runner, AKS, Functions, Cloud Run
- Data infrastructure: RDS/Aurora/DynamoDB/S3, Azure SQL/Cosmos/Blob, backups
- Identity/access: IAM, Azure Entra, roles, OIDC, least privilege, service accounts
- Secrets/keys: KMS, Secrets Manager, Key Vault, env var policy
- CI/CD platform: GitHub Actions, Vercel, cloud deploys, staging/prod promotion
- Observability/SRE: logs, metrics, traces, alerts, dashboards, SLOs
- Reliability/DR: rollback, backups, restore tests, RTO/RPO, multi-AZ/multi-region
- Security/compliance: threat model, WAF, vuln scan, audit trails, data boundaries
- FinOps/cost: spend, scaling policy, budget alarms, expensive service detection
- Migration/cutover: schema migrations, blue/green, canary, rollback

## Production Readiness Layer Pack

The “real full-stack is 13 layers” pattern belongs inside the harness as a production-readiness pack, not as the parent product name.

- Frontend
- Backend/API logic
- Database/storage
- Auth/permissions/RLS
- Hosting/deployment
- Cloud/compute
- CI/CD/version control
- Security
- Rate limiting
- Caching/CDN
- Load balancing/scaling
- Error tracking/logs/observability
- Availability/recovery/DR

For each run the harness asks:

> Which production layers does this task touch?

Relevant layers become required nodes/gates. Irrelevant layers are skipped with explicit reasons.

## QA + release lanes

QA is not just “run tests.” Every real run should identify which validation depth is required:

1. Normal QA — acceptance criteria, lint/type/test/build/evals/regression.
2. “Let’s break it” QA — intentionally test edge cases, malformed input, auth boundaries, stale data, latency, retries, concurrency, and failure paths.
3. Live smoke — prove the route/API/job/provider/voice path works in the target environment.

## Self-healing lane

At finish-line, the harness checks whether a failure was caused by product code or by the harness itself:

- repo adapter gap
- lane procedure gap
- gate policy gap
- connector/telemetry bug
- docs/onboarding gap
- missing validation command
- missing Red Zone rule
- missing production-readiness layer

If the process failed, write `self_heal/self_heal_report.md` and open or propose a scoped PR to update the adapter, lane docs, gates, prompts, or connector scripts.

## Terminology calibration

| Term | Meaning |
|---|---|
| SDLC | Full lifecycle backbone for engineering work |
| System design | Requirements, constraints, tradeoffs, scale, data, failure, security |
| Architecture | Current/proposed structure of the system |
| Production architecture | How the system actually runs and survives in live/cloud environments |
| Platform engineering | Infra, CI/CD, secrets, reliability, observability, cost, and developer platform work |
| Production readiness layers | Checklist of frontend/backend/data/auth/cloud/ops/recovery surfaces touched by a run |
| Harness self-healing | A process gap creates a scoped artifact/PR to improve the harness itself |
