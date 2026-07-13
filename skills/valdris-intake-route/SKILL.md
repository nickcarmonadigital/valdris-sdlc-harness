---
name: valdris-intake-route
description: Classify a new or ambiguous Valdris request and select the smallest safe workflow. Select as the primary for generic end-to-end audits, mixed or unclear requests, greenfield discovery without a concrete build outcome, or work whose stakes, authority, production impact, and delivery workflow are not established. Do not use as the delivery primary when the user clearly asks to build a feature/application, fix a bug, perform a security review, change architecture/platform, assure AI, or verify the finish; route those to the matching Valdris skill.
---

# Valdris Intake And Route

Use the project adapter as the repo-specific source of truth. Prefer `project-adapter.json`, then `.valdris-harness/project-adapter.json`.

When the deterministic router is installed, start with `node scripts/route-request.mjs --repo . --request "<request>"` (or the `.valdris-harness/scripts/` path for a nested pack), then review its conservative output rather than hand-authoring an unbound route.

## Route

1. Capture the user outcome, affected users, constraints, exclusions, and verifiable stopping condition.
2. Classify the work as bug, feature, architecture/refactor, security, platform/release, GenAI, audit, incident, or docs-only.
3. Select a stakes profile: `prototype`, `production`, `enterprise`, or `regulated`.
4. Classify all 13 production layers initially as `required`, `potentially-affected`, or `not-applicable`. Resolve every `potentially-affected` layer before final proof; never omit one silently.
5. Detect GenAI impact: models, prompts, retrieval, agents, tools, memory, evals, or AI telemetry.
6. Identify Red Zone actions before tools or edits are used.
7. Select one primary Valdris skill and only the supporting skills needed for proof and handoff.

Use phase transitions for large work: intake may be primary first, delivery becomes primary after the route and goal are accepted, and proof-handoff becomes primary at the finish line. Break ties by explicit outcome, highest consequential risk, artifact being changed, then the narrowest match.

## Artifacts

Write or update:

- `run/intake.json`
- `run/route.json`
- `goal/goal.json` for multi-checkpoint work

Advance checkpoints and conditions with `goal-transition.mjs` and the current expected revision so stale agents cannot silently overwrite newer goal state.

The goal pins the intake request and initial route digests. Do not rewrite intake/route to make gates disappear; open a reviewed new run when the authorized request or initial route must change.

Ask a question only when the answer changes scope, architecture, authority, or proof. Otherwise record a conservative assumption and continue.

Do not claim Live Run telemetry unless real connector events exist.
