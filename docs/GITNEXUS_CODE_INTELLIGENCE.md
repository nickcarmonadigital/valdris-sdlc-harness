# GitNexus Code Intelligence

This repo uses GitNexus as the preferred backend for the harness `code-intelligence` node.

See [`CODE_INTELLIGENCE_GRAPH.md`](CODE_INTELLIGENCE_GRAPH.md) for the full gate contract.

## Command

```bash
npm run code-intelligence:scan
npm run code-intelligence:gate
```

## Artifacts

- `graph/gitnexus.json`
- `graph/graph.json`
- `graph/freshness.json`
- `design/anchors.json`

## Boundary

GitNexus is invoked externally via `npx gitnexus@latest analyze --index-only`; it is not vendored into this repo.
