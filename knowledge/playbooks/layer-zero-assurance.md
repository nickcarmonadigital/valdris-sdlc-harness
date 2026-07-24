---
type: Playbook
title: Layer Zero Assurance
description: Bind workload classification to minimum foundation capabilities, tiers, profiles, and proof before delivery.
resource: scripts/foundation-gate.mjs
tags:
  [layer-zero, classification, foundation, capabilities, tiers, profiles, proof]
timestamp: 2026-07-13T00:00:00-04:00
---

# Purpose

Layer 0 is the pre-delivery assurance plane. Its catalog identity is `layer.id: foundation`, `layer.number: 0`, titled **Foundation / Good Looks Like**. It turns an authorized request into a bound workload classification and a machine-checked foundation contract before any non-docs implementation begins. Controlled assurance documents use a lighter requirements/ownership/risk review because changing a security, privacy, compliance, release, incident, AI-safety, or financial policy changes governed expectations even when runtime behavior is unchanged. It is an executable gate, not another planning document and not a fourteenth production domain.

# Executable Contract

| Decision                | Catalog                                                                    | Run artifact                                                           | Gate                                                     |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Workload classification | `controls/workload-taxonomy.v1.json` (`uash.workload-taxonomy-catalog.v1`) | `run/workload-classification.json` (`uash.workload-classification.v1`) | `node scripts/workload-classification-gate.mjs --repo .` |
| Foundation assurance    | `controls/foundation-layer.v1.json` (`uash.foundation-control-catalog.v1`) | `foundation/assessment.json` (`uash.foundation-assessment.v1`)         | `node scripts/foundation-gate.mjs --repo .`              |

The classification artifact must bind to the authorized intake and route. The foundation assessment must bind to that classification, the selected profile, the current commit and environment, and the catalog digests required by the route.

# Model

- A **capability** is an ability the commissioned workload or workflow must be able to exercise or verify.
- An **assurance tier** (`T0` through `T3`) is the minimum proof strength required by the effective workload classification.
- A **workload profile** such as SaaS, mobile, payments, realtime, regulated, or AI/agentic selects a minimum assurance tier and relevant domain obligations. The stakes/evidence profile (`prototype`, `production`, `enterprise`, or `regulated`) remains a separate input controlling evidence rigor and freshness. Neither kind of profile is proof by itself.
- **Proof** is typed, subject-bound evidence that satisfies the selected tier. Evidence trust tiers describe provenance and must not be confused with assurance tiers.

Risk overlays may raise a tier. They must not silently lower a requirement selected by the workload profile, domain pack, authority boundary, or route.

# Routing

1. `valdris-intake-route` creates and binds `run/workload-classification.json` while it is primary for the intake phase.
2. The route records whether foundation assurance is required and pins the classification and catalog state.
3. Every non-docs delivery primary is blocked until both classification and foundation gates pass. Ordinary README/copy changes may skip Foundation with a reason; controlled assurance documents may not.
4. `valdris-proof-handoff` validates classification and foundation artifacts whenever the route requires them, including their bindings, required capabilities, effective assurance tier, profiles, proof, and non-applicability decisions.

Classification and foundation are gates, not selectable skills. The registry must continue to expose exactly eight Valdris workflow skills and one primary per phase.

# Relationship To Production Assurance

Layer 0 precedes the 13 canonical production assurance domains. Those domains are the current common baseline, not an exhaustive list of literal application, infrastructure, or runtime layers. Product-specific domain packs can add further assurance obligations.

Asynchronous orchestration is cross-cutting. Queues, schedulers, workers, retries, idempotency, ordering, observability, scaling, and recovery must be evaluated in every affected domain rather than represented as a single extra domain.
