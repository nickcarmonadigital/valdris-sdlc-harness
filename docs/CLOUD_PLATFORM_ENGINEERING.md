# Cloud / Platform Engineering Lane

Cloud/platform work is the live execution and operability layer for production software. It belongs inside the Agentic SDLC Harness as a first-class lane family.

## Trigger conditions

Route through this lane when a task mentions or touches:

- AWS, Azure, GCP, Vercel, Supabase infra
- ECS, EKS, Lambda, EC2, App Runner, Cloud Run, Functions
- S3/object storage, RDS/Aurora, DynamoDB, queues/workers
- VPC/VNet, DNS, TLS, ingress/egress, load balancers
- IAM/roles/OIDC/service accounts, secrets/env vars/KMS
- CI/CD, deploys, staging/prod promotion, rollback
- CloudWatch/logs/metrics/traces/alerts
- cost, scaling, backups, disaster recovery

## Required questions

For each relevant run ask/record:

1. Which cloud services are touched?
2. Is the environment dev, staging, or production?
3. Does it affect customer data, auth, secrets, billing, or public traffic?
4. Is the change IaC-managed or console/manual?
5. What rollback path exists?
6. What proof is required: deploy log, CloudWatch log, health check, smoke test, screenshot, request ID, or CLI output?
7. Does this require Red Zone approval?
8. What cost/scaling risk exists?
9. What observability exists after the change?
10. What docs/runbook must be updated?

## Node pack

```text
cloud-intake
aws-service-map
iam-secrets-check
networking-check
iac-diff-check
deploy-plan
observability-proof
cost-risk-check
rollback-plan
live-smoke
runbook-update
```

Each node must end as `passed`, `active`, `failed`, `skipped`, `pending`, or `needs_approval`. Skipped nodes require reasons. Failed nodes require recovery paths.

## Example proof artifact

```text
Cloud deploy proof:
- environment: staging
- provider/service: AWS ECS/FastAPI worker
- command/log: <exact command or deploy URL>
- health check: <endpoint/status>
- CloudWatch/request ID: <id if available>
- rollback path: <previous task definition/deployment>
- cost/scaling risk: <none|low|medium|high with reason>
```

## Free AWS source pack

These are approved public reference links for learning/validation docs:

- AWS Skill Builder — https://skillbuilder.aws/
- AWS Cloud Practitioner Essentials — https://aws.amazon.com/training/digital/aws-cloud-practitioner-essentials/
- AWS Architecture Center — https://aws.amazon.com/architecture/
- AWS Well-Architected Framework — https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- AWS Workshops / Builder Center — https://workshops.aws/
- AWS Hands-on Tutorials — https://aws.amazon.com/getting-started/hands-on/
- AWS Documentation — https://docs.aws.amazon.com/

## Pitfalls

- Do not flatten AWS/cloud into “just code.”
- Do not imply cloud verification without logs, CLI output, health checks, screenshots, dashboard/request IDs, or runbook links.
- Do not make certification/training content the product. Treat external resources as reference material for the lane and gate rules.
