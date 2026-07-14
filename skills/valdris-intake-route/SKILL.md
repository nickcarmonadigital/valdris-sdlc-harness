---
name: valdris-intake-route
description: Classify a new or ambiguous Valdris request and bind it to the smallest safe workflow. Select as the primary for generic end-to-end audits, mixed or unclear requests, greenfield discovery without a concrete build outcome, or work whose workload class, stakes, authority, production impact, and delivery workflow are not established. Intake owns the workload-classification artifact and route binding; it does not replace the matching delivery primary once the outcome is clear.
---

# Valdris Intake And Route

Use the project adapter as the repo-specific source of truth. Prefer `project-adapter.json`, then `.valdris-harness/project-adapter.json`.

When the deterministic router is installed, start with `node scripts/route-request.mjs --repo . --request "<request>"` (or the `.valdris-harness/scripts/` path for a nested pack), then review its conservative output rather than hand-authoring an unbound route.

## Route

1. Capture the user outcome, affected users, constraints, exclusions, and verifiable stopping condition.
2. Classify the workload against `controls/workload-taxonomy.v1.json`, write `run/workload-classification.json`, and bind its digest to the authorized intake and route. The classification gate must pass before delivery relies on it.
3. Classify the work as bug, feature, architecture/refactor, security, platform/release, GenAI, audit, incident, or docs-only.
4. Select a stakes profile: `prototype`, `production`, `enterprise`, or `regulated`, then derive the minimum assurance tier and capability proof expected from the combined workload and stakes profiles instead of treating either profile as a label.
5. Decide whether Layer 0 foundation assurance is required. Every non-docs route requires it before implementation. Ordinary README/copy docs may skip it; controlled security, privacy, compliance, release, incident, AI-safety, or financial policy documents use the lightweight product/requirements/ownership-risk Foundation review path and accountable human review.
6. Classify the 13 canonical production assurance domains initially as `required`, `potentially-affected`, or `not-applicable`. They are the current shared baseline, not an exhaustive list of literal runtime layers. Resolve every `potentially-affected` domain before final proof; never omit one silently.
7. Detect GenAI impact: models, prompts, retrieval, agents, tools, memory, evals, or AI telemetry. Treat asynchronous orchestration as cross-cutting behavior whose effects must be assessed across applicable domains, not as a fourteenth domain.
8. Identify Red Zone actions before tools or edits are used.
9. Select one primary Valdris skill and only the supporting skills needed for proof and handoff.

Use phase transitions for large work: intake may be primary first, delivery becomes primary after the route and goal are accepted, and proof-handoff becomes primary at the finish line. Break ties by explicit outcome, highest consequential risk, artifact being changed, then the narrowest match.

## Artifacts

Write or update:

- `run/intake.json`
- `run/workload-classification.json`
- `run/route.json`
- `goal/goal.json` for multi-checkpoint work

Advance checkpoints and conditions with `goal-transition.mjs` and the current expected revision so stale agents cannot silently overwrite newer goal state.

The goal pins the intake request and initial route digests. Do not rewrite intake/route to make gates disappear; open a reviewed new run when the authorized request or initial route must change.

The router assigns a conservative immutable execution budget from task type and effective tier. Do not increase that budget in place; a materially larger scope requires a new reviewed run.

Ask a question only when the answer changes scope, architecture, authority, or proof. Otherwise record a conservative assumption and continue.

Do not claim Live Run telemetry unless real connector events exist.
