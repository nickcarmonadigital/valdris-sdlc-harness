# Enterprise Control Model v2

Valdris v0.7 replaces layer-level attestations with control-level, typed assurance. The thirteen production layers remain the full-stack map, but each required layer now expands into named controls whose evidence is machine-resolved before the run can finish.

## Decision model

1. Select the requested evidence/maturity profile: `prototype`, `production`, `enterprise`, or `regulated`.
2. Detect composable workload profiles such as SaaS, mobile, payments, realtime, regulated/high-impact, and AI/agentic; the strongest applicable floor determines the effective assurance tier.
3. Classify every canonical assurance domain as `required` or `not-applicable`.
4. Apply hard dependencies from `controls/production-layers.v2.json`; treat `conditionalDependencies` as applicability questions rather than automatic expansion.
5. Prove every required control. A whole domain cannot pass on one generic sentence.
6. Record residual risk and obtain a human approval where the Red Zone or policy requires it.
7. Re-run the gate against the exact commit and environment being handed off.

The catalog currently contains 39 controls across:

`frontend -> backend -> data -> auth -> deployment -> cloud -> CI/CD -> security -> rate limits -> cache/CDN -> scaling -> observability -> recovery`

The arrows describe an assurance map, not a fixed build order. `dependencies` form the enforced acyclic prerequisite graph; `conditionalDependencies` document common relationships that classification or human review must resolve without over-projecting unrelated systems.

## Typed evidence

Passing controls use one or more of these evidence types:

| Type | What the gate proves |
|---|---|
| `artifact` | Real non-symlink path exists inside the repo; enterprise/regulated evidence matches SHA-256, run, commit, and environment. |
| `command` | Named command exited zero and its captured output file matches the recorded SHA-256 digest. |
| `metric` | Observed numeric value satisfies a declared operator and target over a named window/source. |
| `approval` | A named human granted a scoped approval; an agent cannot self-approve. |
| `provider-report` | HTTPS provider result passed at a recorded time and is digest-bound. |

Evidence is subject-bound by control ID, run ID, profile, commit, environment, producer/version, trust tier, and a profile-specific freshness window. The aggregate gate binds the packet to current wall-clock time and Git HEAD when the target is a Git worktree. A URL, filename, command string, or `exitCode: 0` alone is not enterprise proof.

## Waivers and skips

- A required layer and required control cannot be skipped.
- A layer may be `not-applicable` only with a workload-specific reason.
- `failed`, `pending`, `blocked`, `required`, and `needs_approval` are blocking states.
- A human approval proves authorization, not technical correctness. It cannot convert a failing metric or missing artifact into a pass.
- Every run carries `waivers/waivers.json`, even when the ledger is empty. Active waivers require a control ID, human risk owner and approver, compensating controls, HTTPS remediation issue, expiry, and a token-gated bridge approval event. Valdris does not silently turn waivers into technical passes.

## Commands

```bash
npm run production:gate
npm run enterprise-ai:gate
```

The v2 validator retains read compatibility for historical `uash.production-readiness.v1` files. Newly commissioned packs generate v2 controls and validators.

## Standards posture

The implementation is designed as an evidence orchestration layer, not a claim of certification. The detailed primary-source baseline, crosswalk, contradictions in the supplied PDFs, and missing-control analysis are in `research/enterprise-ai-2026/enterprise-controls.md`. The control model should be reviewed whenever its source standards or a workload's regulatory obligations change.
