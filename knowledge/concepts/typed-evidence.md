---
type: Concept
title: Typed Evidence
description: Machine-resolvable control proof bound to a run, commit, environment, timestamp, and subject.
resource: scripts/control-gate-lib.mjs
tags: [proof, evidence, controls, enterprise, assurance]
timestamp: 2026-07-12T00:00:00.000Z
---

# Rule

Evidence-shaped prose is not proof. A passing control needs a supported typed evidence object that the gate can resolve and recompute.

# Types

- `artifact`: repository-contained path, timestamp, and for enterprise/regulated profiles a matching SHA-256, commit, and environment.
- `command`: exact command, zero exit, timestamp, environment, and output digest.
- `metric`: numeric observation, operator, target, source, window, and timestamp; the gate recomputes the result.
- `approval`: named human, approval ID, scope, granted status, and timestamp.
- `provider-report`: HTTPS result, passed status, timestamp, and digest.

# Boundaries

Approval proves authorization, not correctness. A skip proves non-applicability only when the enclosing layer permits it and a precise reason exists. Blocking states never count as passed.

Run acceptance is transactional. New v0.8 packets bind every non-review evidence file through `artifactInventory`; the review signs that inventory, the packet envelope digests it, and CI validates the exact closure in a detached worktree before hydrating the source checkout. Historical v2 packets without the field remain readable as structural evidence but cannot enter the hydrated acceptance path.
