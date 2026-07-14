---
name: valdris-architecture-refactor
description: Design architecture changes and refactors with code-intelligence, dependency, blast-radius, migration, and proof discipline. Select as the primary when redesign, module boundaries, migration, large refactoring, system design, or technical-debt reduction is the requested outcome. Require bound workload classification and a resolved Layer 0 foundation gate before implementation; use as a supporting lane for features only when architecture is consequential.
---

# Valdris Architecture And Refactor

1. Run GitNexus-backed code intelligence; disclose any fallback.
2. Validate the bound `run/workload-classification.json`, then require `foundation/assessment.json` to pass the Layer 0 foundation gate before implementation. The foundation assessment must resolve the required capabilities, effective assurance tier, workload and stakes profiles, and proof contract for the architecture work.
3. Identify current boundaries, entrypoints, dependencies, invariants, and change pressure.
4. Produce at least two viable designs when the decision is consequential.
5. Prefer deep modules, narrow interfaces, explicit ownership, and reversible migration paths.
6. Record the decision in `design/system_design.md` or an ADR with alternatives and trade-offs.
7. Define expand-migrate-contract steps for changes that cannot land as one green vertical slice.
8. Map production-domain, security, data, deploy, and rollback impact. The 13 canonical production domains are a shared baseline, not an exhaustive list of literal layers; asynchronous orchestration is cross-cutting and must be traced through every affected domain.
9. Establish proof seams before implementation.

Use `$codebase-design` for module quality and `$code-review` after implementation when available.

Do not implement during an audit or design-only request. Do not approve a refactor whose behavior cannot be proven equivalent or intentionally changed.
