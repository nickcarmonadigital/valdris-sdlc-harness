# GitNexus Code Intelligence

This repo uses GitNexus as the preferred backend for the harness `graphify` node.

See [`GRAPHIFY_CODE_GRAPH.md`](GRAPHIFY_CODE_GRAPH.md) for the full gate contract.

## Command

```bash
npm run code-intelligence:scan
npm run graphify:gate
```

## Artifacts

- `graph/gitnexus.json`
- `graph/graph.json`
- `graph/freshness.json`
- `design/anchors.json`

## Boundary

GitNexus is invoked externally via `npx gitnexus@latest analyze --index-only`; it is not vendored into this repo.
