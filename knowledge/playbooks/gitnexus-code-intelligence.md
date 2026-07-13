---
type: Playbook
title: GitNexus Code Intelligence
description: Required repo-intelligence route before codebase, architecture, refactor, debugging, or cross-file implementation claims.
resource: scripts/code-intelligence-scan.mjs
tags: [gitnexus, code-intelligence, graph, anchors, proof]
timestamp: 2026-07-04T00:00:00Z
---

# When To Use

Use this before design claims or code edits that depend on understanding repo structure, file ownership, dependency paths, or blast radius.

# Commands

```bash
node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local
node scripts/code-intelligence-gate-all.mjs --repo .
```

Use strict mode when GitNexus itself must be proved:

```bash
node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback none --strict
```

# Artifacts

* `graph/gitnexus.json`
* `graph/graph.json`
* `graph/freshness.json`
* `design/anchors.json`

# Disclosure Rule

If the scan falls back to the local static graph, say that clearly and do not claim GitNexus-backed analysis. A normal success path can be described as GitNexus indexed plus local stable projection.
