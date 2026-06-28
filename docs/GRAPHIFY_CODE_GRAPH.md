# GitNexus / Code Intelligence Gate

`graphify` remains the stable harness node ID, but the preferred backend for that node is now **GitNexus-backed code intelligence**. LLMs should not navigate a non-trivial codebase from vibes, memory, or file-name guesses.

## Required flow position

```text
intake → route → graphify → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## Artifacts

| Artifact | Purpose |
|---|---|
| `graph/gitnexus.json` | GitNexus index evidence: package, license boundary, command, status, output, and index alias. |
| `graph/graph.json` | Stable Valdris graph artifact consumed by the harness. |
| `graph/freshness.json` | Commit/freshness proof for the graph. |
| `design/anchors.json` | Files/symbols the agent must cite before architecture, refactor, debugging, or cross-file implementation claims. |

## Local commands

```bash
npm run code-intelligence:scan
npm run graphify:gate
```

Use the strict path when fallback is not acceptable:

```bash
npm run code-intelligence:scan:strict
npm run graphify:gate
```

## Backend boundary

The harness invokes GitNexus externally:

```bash
npx -y gitnexus@latest analyze . --index-only --name <repo-alias> --force --worker-timeout 60
```

It does **not** vendor or redistribute GitNexus code. GitNexus is licensed PolyForm Noncommercial 1.0.0, so commercial/product use needs license review or a commercial permission path.

If GitNexus is unavailable, `code-intelligence-scan.mjs --fallback local` can still produce the stable graph/freshness/anchor artifacts from the local static scanner. That fallback must be disclosed in the handoff; never claim GitNexus-backed analysis unless `graph/gitnexus.json` says `ok: true` and `graphify-gate` passes.

## Skip rule

The `graphify` node may only be skipped for docs-only/non-code work. The run must emit explicit skip reasons for both:

- `graphify`
- `design-anchors`

## Why this exists

The code-intelligence gate is the harness map layer. It helps agents answer:

- where code lives,
- what imports/calls what,
- which files are likely entrypoints,
- what blast radius a change may have,
- what concrete files/symbols the design is anchored to.
