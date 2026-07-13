---
name: valdris-security-audit
description: Audit and remediate security, privacy, identity, tenant, secret, supply-chain, and agent-tool boundaries under Valdris. Use for security reviews, auth/RLS changes, vulnerability findings, compliance-impacting work, prompt injection, untrusted content, data exposure, or high-blast-radius permissions.
---

# Valdris Security Audit

1. Confirm authorization and scope before testing.
2. Map assets, actors, trust boundaries, data classes, threats, and plausible abuse cases.
3. Inspect current code and configuration; do not infer controls from documentation alone.
4. Test positive and negative authorization, tenant isolation, input handling, secrets, dependencies, and failure paths.
5. For AI workloads, test direct and indirect prompt injection, tool authorization, retrieval permissions, memory isolation, and sensitive trace handling.
6. Rank findings by exploitability, impact, affected users, evidence, and remediation confidence.
7. Apply the smallest verified remediation and add regression proof when implementation is authorized.

Human approval is mandatory for production IAM/RLS, credential rotation, destructive security testing, incident containment, customer-data access, or acceptance of residual critical risk.

Write `security/review.md` and attach scans/tests rather than replacing evidence with prose.
