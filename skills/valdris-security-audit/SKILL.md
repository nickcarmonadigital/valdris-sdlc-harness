---
name: valdris-security-audit
description: Audit and remediate security, privacy, identity, tenant, secret, supply-chain, and agent-tool boundaries under Valdris. Select as the primary only when the requested outcome is a security, privacy, auth, RLS, tenant-isolation, vulnerability, compliance, secret, prompt-injection, or permission review/remediation. For a generic end-to-end audit use valdris-intake-route; for product delivery with security impact use this as a supporting lane.
---

# Valdris Security Audit

1. Confirm authorization and scope, then validate the intake, deterministic classification, route, and code-intelligence artifacts before testing or making repository claims.
2. Resolve the route-required Layer 0 foundation assessment. Audit-only work may report a failing foundation; remediation cannot proceed as though it passed.
3. Map assets, actors, trust boundaries, data classes, threats, and plausible abuse cases.
4. Inspect current code and configuration; do not infer controls from documentation alone.
5. Test positive and negative authorization, tenant isolation, input handling, secrets, dependencies, and failure paths.
6. For AI workloads, test direct and indirect prompt injection, tool authorization, retrieval permissions, memory isolation, and sensitive trace handling.
7. Rank findings by exploitability, impact, affected users, evidence, and remediation confidence.
8. Apply the smallest verified remediation and add regression proof when implementation is authorized, then resolve every route-required production, AI, eval, trajectory, smoke, and domain gate.

Human approval is mandatory for production IAM/RLS, credential rotation, destructive security testing, incident containment, customer-data access, or acceptance of residual critical risk.

Write `security/review.md` and attach scans/tests rather than replacing evidence with prose.
