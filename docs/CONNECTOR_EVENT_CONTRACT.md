# Connector Event Contract v0

The connector contract lets Claude Code, Codex, Hermes, or any future agent runtime appear on the visual board without turning this product into an IDE.

## Core event types

| Event | Meaning |
|---|---|
| `run.started` | Human/task created a run packet |
| `agent.connected` | Runtime connector attached to the run |
| `node.entered` | Agent or harness entered a workflow node |
| `gate.fired` | Mechanical gate started or evaluated |
| `artifact.written` | Required run artifact appeared |
| `approval.requested` | Human approval/Red Zone pause |
| `run.blocked` | Completion is blocked by missing proof, failed gate, or approval |
| `run.completed` | Required artifacts passed and answer contract can be produced |

## Event schema

```ts
type RunEvent = {
  id: string;
  type:
    | "run.started"
    | "agent.connected"
    | "node.entered"
    | "gate.fired"
    | "artifact.written"
    | "approval.requested"
    | "run.blocked"
    | "run.completed";
  ts: string;
  actor: "claude-code" | "codex" | "hermes" | "human" | "harness";
  nodeId?: string;
  artifact?: string;
  message: string;
  status?: "ok" | "warn" | "blocked";
};
```

## Workflow node IDs

Current visualizer nodes:

```text
intake → route → investigate → design → implement → redzone → prove → handoff
```

## Adapter responsibility

The connector is responsible for translating runtime-specific signals into the v0 event schema.

Examples:

- Claude Code hook sees `CLAUDE.md` loaded → `agent.connected`
- Codex run starts in repo/worktree → `node.entered` at `implement`
- Gate script writes `proof/proof.json` → `artifact.written`
- Red Zone script returns approval required → `approval.requested`
- Finish-line validator sees missing proof → `run.blocked`

## Storage boundary

v0 supports local JSONL:

```text
data/runs/<run-id>/events.jsonl
```

Hosted database is intentionally deferred. The schema should be stable enough to later back with Supabase/Postgres without changing connectors.
