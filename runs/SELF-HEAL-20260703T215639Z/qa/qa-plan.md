# QA Plan — v0.6 Trust-Boundary Hardening

- Syntax-check all modified Node scripts.
- Run `npm ci --ignore-scripts`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run GitNexus-backed `npm run code-intelligence:scan`.
- Run `npm run graphify:gate`.
- Run `npm run verify:harness` with negative tests for fake proof, unsafe adapter path, adapter-aware required nodes, tokenless approval, token persistence, symlink/path escape, early completion, and self-heal bypass.
- Run commissioning smoke and assert generated adapter includes v0.6 proof schema, adapter-aware bridge policy, and human token gate.
