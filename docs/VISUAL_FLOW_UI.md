# Visual Flow UI

## Target UX

A left-hand visual flow shows how the harness is executing while the coding agent runs elsewhere.

It should feel closer to:

- n8n workflow graph
- Temporal/River job execution visibility
- CI/CD pipeline status
- agent run flight recorder

Not like:

- VS Code replacement
- Replit-style IDE
- chat-only AI wrapper

## First visual grammar

Each node = a harness stage/gate.

Node state:

| State | Meaning |
|---|---|
| Queued | stage is waiting |
| Running | agent/session is currently there |
| Complete | required output exists |
| Blocked | missing proof, approval, source truth, or failing validation |

Each node shows:

- stage name
- one-line purpose
- required artifact path
- current owner: human / agent / system
- evidence confidence

## First MVP flow

```text
Commission
→ Orient
→ Investigate
→ Design
→ Implement
→ Prove
→ Ship / Handoff
```

## Important product rule

The UI should make skipped gates obvious.

Example:

```text
Agent says: “fixed and verified”
Harness says: BLOCKED — missing proof/proof.json
```

That mismatch is the product.
