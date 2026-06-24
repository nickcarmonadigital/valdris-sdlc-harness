# Graphify / Code Graph Gate

Graphify is a first-class harness flow node. LLMs should not navigate a non-trivial codebase from vibes, memory, or file-name guesses.

## Required flow position

```text
intake → route → graphify → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Artifacts

| Artifact | Purpose |
|---|---|
| `graph/graph.json` | Code topology / dependency graph. |
| `graph/freshness.json` | Commit/freshness proof for the graph. |
| `design/anchors.json` | Files/symbols the agent must cite before architecture, refactor, debugging, or cross-file implementation claims. |

## Local commands

```bash
npm run graphify:scan
npm run graphify:gate
```

The current implementation is a **Graphify-compatible local static code graph**. If an external Graphify service is connected later, it can replace the scanner while preserving the same artifacts and gate contract.

## Skip rule

Graphify may only be skipped for docs-only/non-code work. The run must emit explicit skip reasons for both:

- `graphify`
- `design-anchors`

Never imply Graphify ran when it did not.

## Why this exists

Graphify is the harness map layer. It helps agents answer:

- where code lives,
- what imports/calls what,
- which files are likely entrypoints,
- what blast radius a change may have,
- what concrete files/symbols the design is anchored to.
