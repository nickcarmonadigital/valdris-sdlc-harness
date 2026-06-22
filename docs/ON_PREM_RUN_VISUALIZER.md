# On-Prem Agent Run Visualizer

This product should feel like the “agent avatar moving around” demos people build around Claude Code, but without requiring game characters or a browser IDE.

## Product shape

```text
Claude Code / Codex / Hermes
→ connector bridge beside the runtime
→ JSONL run events + gate artifacts
→ Vercel/Next.js visual board
→ human sees stage, gate, artifact, blocker state
```

The visual surface is a **Miro / n8n-style workflow canvas**:

- nodes = harness stages
- lines = allowed stage transitions
- moving chips = active coding agents
- badges = stage status
- ledger = artifact evidence
- blocked state = missing proof or approval

## Why no Supabase for v0

We do not need hosted persistence yet. The v0 can run in two modes:

| Mode | Storage | Purpose |
|---|---|---|
| Vercel demo | bundled seed events | public/shareable product preview |
| On-prem/local | filesystem JSONL under `data/runs/<run>/events.jsonl` | real connector spike without hosted DB |

Later, when collaboration/auth/history matter, replace the file adapter with Postgres/Supabase/Vercel Postgres/etc. The event contract should not change.

## Local demo

```bash
npm run simulate:agent
npm run dev
```

Then open:

```text
http://localhost:3000
```

The API endpoint reads local JSONL when available:

```text
GET /api/runs/demo/events
```

If no local file exists, it falls back to bundled seed events so the Vercel deployment still works.

## Connector pattern

A connector does not need to edit code or replace Claude Code/Codex. It only needs to emit events when the real runtime crosses a workflow boundary.

Example event:

```json
{
  "id": "evt-123",
  "type": "gate.fired",
  "ts": "00:17",
  "actor": "claude-code",
  "nodeId": "investigate",
  "artifact": "rca/rca.json",
  "message": "RCA gate opened and requires runtime evidence before cause.",
  "status": "ok"
}
```

## Implementation rule

Do not build an IDE. Build the **visual flight recorder / control plane** around the existing coding-agent runtime.
