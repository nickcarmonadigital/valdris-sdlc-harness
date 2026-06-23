# Connector Event Contract v0.2

The connector contract lets Claude Code, Codex, Hermes, or any future agent runtime appear on the visual board without turning this product into an IDE.

## Core principle

The harness can only show what was explicitly emitted, written, or replayed. It cannot read hidden reasoning or internal IDE state.

```text
agent runtime
→ MCP tool / CLI emitter / local daemon / watched artifact
→ event store
→ node states + artifact ledger
→ visual board
→ finish-line + self-healing logic
```

## Presentation modes

| Mode | Meaning | Event source |
|---|---|---|
| `blueprint` / **Blueprint** | Static topology/lane explanation | `static-blueprint` |
| `live` / **Live Run** | Current real run telemetry | `bridge`, `mcp`, `api`, `watched-artifact` |
| `replay` / **Replay** | Historical event playback | `local-jsonl`, `database`, `run-packet` |

## Core event types

| Event | Meaning |
|---|---|
| `run.created` | Human/task created a run packet |
| `run.mode_set` | Run declares blueprint/live/replay source |
| `agent.connected` | Runtime connector attached to the run |
| `node.entered` | Agent or harness entered a workflow node |
| `node.skipped` | Node was intentionally skipped with reason |
| `node.failed` | Node failed with failure reason and recovery path |
| `gate.fired` | Mechanical gate started or evaluated |
| `artifact.written` | Required run artifact appeared |
| `approval.requested` | Human approval/Red Zone pause |
| `approval.granted` | Human approved scoped Red Zone action |
| `approval.denied` | Human denied scoped Red Zone action |
| `run.blocked` | Completion is blocked by missing proof, failed gate, or approval |
| `run.completed` | Required artifacts passed and answer contract can be produced |
| `self_heal.detected` | Finish-line found a harness/process gap |
| `self_heal.pr_opened` | A scoped PR was opened/proposed to fix the harness pack |

## Event schema

```ts
type RunMode = "blueprint" | "live" | "replay";
type EventSource = "static-blueprint" | "bridge" | "mcp" | "api" | "watched-artifact" | "local-jsonl" | "database" | "run-packet";
type NodeState = "passed" | "active" | "failed" | "skipped" | "pending" | "needs_approval";

type RunEvent = {
  id: string;
  type:
    | "run.created"
    | "run.mode_set"
    | "agent.connected"
    | "node.entered"
    | "node.skipped"
    | "node.failed"
    | "gate.fired"
    | "artifact.written"
    | "approval.requested"
    | "approval.granted"
    | "approval.denied"
    | "run.blocked"
    | "run.completed"
    | "self_heal.detected"
    | "self_heal.pr_opened";
  ts: string;
  actor: "claude-code" | "codex" | "hermes" | "human" | "harness";
  runMode?: RunMode;
  eventSource?: EventSource;
  nodeId?: string;
  nodeState?: NodeState;
  artifact?: string;
  message: string;
  status?: "ok" | "warn" | "blocked" | "skipped" | "failed" | "needs_approval";
  skipReason?: string;
  failureReason?: string;
  recoveryPath?: string;
  approvalOwner?: string;
  approvalScope?: string;
  selfHealPrUrl?: string;
};
```

## Workflow node IDs

Base flow:

```text
intake → route → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

Cloud/platform expansion pack:

```text
cloud-intake → aws-service-map → iam-secrets-check → networking-check → iac-diff-check → deploy-plan → observability-proof → cost-risk-check → rollback-plan → live-smoke → runbook-update
```

## Node state rules

Every node ends as exactly one of:

- `passed`
- `active`
- `failed`
- `skipped`
- `pending`
- `needs_approval`

Rules:

- `skipped` requires `skipReason`.
- `failed` requires `failureReason` and `recoveryPath`.
- `needs_approval` requires `approvalOwner` and `approvalScope`.
- `passed` requires an artifact/proof when the node is required.
- Finish-line can only pass when all required nodes are passed or explicitly skipped with reasons.
- The local bridge enforces this by rejecting `run.completed` with `finish_line_blocked` when artifacts are missing, nodes failed, or skip/failure metadata is incomplete.

## Event examples

```json
{
  "type": "node.skipped",
  "nodeId": "cloud-platform",
  "nodeState": "skipped",
  "status": "skipped",
  "artifact": "cloud/skip.json",
  "skipReason": "No deploy, cloud resource, secret, IAM, network, or provider setting changed.",
  "message": "Cloud/platform lane skipped with explicit reason."
}
```

```json
{
  "type": "node.failed",
  "nodeId": "qa-break-it",
  "nodeState": "failed",
  "status": "failed",
  "artifact": "qa/break-it-results.md",
  "failureReason": "Tenant-boundary negative test failed.",
  "recoveryPath": "Fix RLS policy, rerun negative authz test, attach request IDs."
}
```

```json
{
  "type": "self_heal.pr_opened",
  "nodeId": "self-heal",
  "nodeState": "passed",
  "status": "ok",
  "artifact": "self_heal/pr.json",
  "selfHealPrUrl": "https://github.com/org/repo/pull/123",
  "message": "Opened PR to add a missing cloud/platform commissioning question."
}
```

## Adapter responsibility

The connector translates runtime-specific signals into this schema.

Examples:

- Claude Code hook sees `CLAUDE.md` loaded → `agent.connected`
- Codex run starts in repo/worktree → `node.entered` at `implement`
- Gate script writes `proof/proof.json` → `artifact.written`
- Red Zone script returns approval required → `approval.requested`
- Finish-line validator sees missing proof → `run.blocked`
- Finish-line validator sees harness gap → `self_heal.detected`
- Harness patch PR is opened → `self_heal.pr_opened`

## Storage boundary

v0 supports local JSONL via the bridge:

```text
~/.uash/runs/<run-id>/events.jsonl
```

The older in-repo demo adapter can also read:

```text
data/runs/<run-id>/events.jsonl
```

Hosted database is intentionally deferred. The schema should be stable enough to later back with Supabase/Postgres without changing connectors.
