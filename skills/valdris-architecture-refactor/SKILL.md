---
name: valdris-architecture-refactor
description: Design architecture changes and refactors with code-intelligence, dependency, blast-radius, migration, and proof discipline. Use for cross-file redesigns, module boundaries, migrations, large refactors, system design, technical-debt reduction, or changes whose safest implementation path is not yet obvious.
---

# Valdris Architecture And Refactor

1. Run GitNexus-backed code intelligence; disclose any fallback.
2. Identify current boundaries, entrypoints, dependencies, invariants, and change pressure.
3. Produce at least two viable designs when the decision is consequential.
4. Prefer deep modules, narrow interfaces, explicit ownership, and reversible migration paths.
5. Record the decision in `design/system_design.md` or an ADR with alternatives and trade-offs.
6. Define expand-migrate-contract steps for changes that cannot land as one green vertical slice.
7. Map production-layer, security, data, deploy, and rollback impact.
8. Establish proof seams before implementation.

Use `$codebase-design` for module quality and `$code-review` after implementation when available.

Do not implement during an audit or design-only request. Do not approve a refactor whose behavior cannot be proven equivalent or intentionally changed.
