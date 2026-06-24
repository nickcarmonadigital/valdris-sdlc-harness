# Connector Event Contract v0.4

The connector contract lets Claude Code, Codex, Hermes, or any future agent runtime appear on the visual board without turning this product into an IDE.

## Core principle

The harness can only show what was explicitly emitted, written, verified, or replayed. It cannot read hidden reasoning or internal IDE state.

```text
agent runtime
→ MCP tool / CLI emitter / local daemon / watched artifact
→ event store
→ node states + verified artifact ledger
→ visual board
→ finish-line + self-healing logic
```

## Presentation modes

| Mode | Meaning | Event source |
|---|---|---|
| `blueprint` | Static topology/lane explanation | `static-blueprint` |
| `live` | Current real run telemetry | `bridge`, `mcp`, `api`, `watched-artifact`, `browser-local` |
| `replay` | Historical event playback | `local-jsonl`, `database`, `run-packet` |

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
| `artifact.written` | Required run artifact exists and should be verified |
| `approval.requested` | Human approval/Red Zone pause |
| `approval.granted` | Human approved scoped Red Zone action |
| `approval.denied` | Human denied scoped Red Zone action |
| `run.blocked` | Completion is blocked by missing proof, failed gate, or approval |
| `run.completed` | Required artifacts passed and answer contract can be produced |
| `self_heal.detected` | Finish-line found a harness/process gap |
| `self_heal.pr_opened` | A scoped PR was opened to fix the harness pack |
| `self_heal.pr_proposed` | A scoped PR/patch artifact was proposed to fix the harness pack |

## Strict event schema

The v0.4 local bridge is intentionally strict. Events missing required fields are rejected with `event_contract_violation`.

```ts
type RunMode = "blueprint" | "live" | "replay";
type EventSource =
  | "static-blueprint"
  | "bridge"
  | "mcp"
  | "api"
  | "watched-artifact"
  | "local-jsonl"
  | "database"
  | "run-packet"
  | "browser-local";
type NodeState = "passed" | "active" | "failed" | "skipped" | "pending" | "needs_approval";
type Actor = "claude-code" | "codex" | "hermes" | "human" | "harness" | "system";
type Status = "ok" | "warn" | "blocked" | "skipped" | "failed" | "needs_approval" | "passed";

type NodeId =
  | "intake"
  | "route"
  | "graphify"
  | "design-anchors"
  | "system-design"
  | "production-readiness"
  | "cloud-platform"
  | "implement"
  | "redzone"
  | "qa-break-it"
  | "prove"
  | "live-smoke"
  | "self-heal"
  | "handoff";

type RunEvent = {
  id?: string;              // generated if omitted
  type: string;             // must be one of the core event types above
  ts?: string;              // generated if omitted
  actor: Actor;
  runMode: RunMode;
  eventSource: EventSource;
  nodeId: NodeId;
  nodeState?: NodeState;
  artifact?: string;
  artifactRoot?: string;    // required on the run for artifact.written verification
  message: string;
  status: Status;
  skipReason?: string;
  failureReason?: string;
  recoveryPath?: string;
  approvalOwner?: string;
  approvalScope?: string;
  selfHealPrUrl?: string;
};
```

## Workflow node IDs

Base v0.4 bridge flow:

```text
intake → route → graphify → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

Cloud/platform expansion nodes are documented lane-detail concepts, but the current local bridge only accepts the base node IDs above. Expansion nodes should be represented inside `cloud/service-map.json` or future adapter schemas until the bridge adds adapter-defined nodes.

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
- `approval.granted` and `approval.denied` must be emitted by `actor: "human"` and must match an existing pending approval.
- `artifact.written` requires an actual file under the run `artifactRoot`; symlink/path escapes are rejected.
- `run.completed` can only pass when all required nodes are verified-present or explicitly skipped with reasons.
- If `self_heal.detected` is emitted, a later `self_heal.pr_opened` or `self_heal.pr_proposed` is required before completion.

## Event examples

```json
{
  "type": "node.skipped",
  "actor": "harness",
  "runMode": "live",
  "eventSource": "bridge",
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
  "actor": "harness",
  "runMode": "live",
  "eventSource": "bridge",
  "nodeId": "qa-break-it",
  "nodeState": "failed",
  "status": "failed",
  "artifact": "qa/break-it-results.md",
  "failureReason": "Tenant-boundary negative test failed.",
  "recoveryPath": "Fix RLS policy, rerun negative authz test, attach request IDs.",
  "message": "Break-it QA failed on tenant-boundary negative case."
}
```

```json
{
  "type": "artifact.written",
  "actor": "codex",
  "runMode": "live",
  "eventSource": "bridge",
  "nodeId": "prove",
  "status": "ok",
  "artifact": "proof/proof.json",
  "artifactRoot": "/path/to/repo-or-run-packet",
  "message": "Proof artifact written after validation commands passed."
}
```

```json
{
  "type": "self_heal.pr_proposed",
  "actor": "harness",
  "runMode": "live",
  "eventSource": "bridge",
  "nodeId": "self-heal",
  "nodeState": "passed",
  "status": "ok",
  "artifact": "self_heal/pr.json",
  "selfHealPrUrl": "file://self_heal/pr.json",
  "message": "Proposed patch to add a missing cloud/platform commissioning question."
}
```

## Adapter responsibility

The connector translates runtime-specific signals into this schema.

Examples:

- Claude Code hook sees `CLAUDE.md` loaded → `agent.connected`
- Codex run starts in repo/worktree → `node.entered`
- Gate script writes `proof/proof.json` → `artifact.written`
- Red Zone script returns approval required → `approval.requested`
- Human approves scoped Red Zone action → `approval.granted`
- Finish-line validator sees missing proof → `run.blocked`
- Finish-line validator sees harness gap → `self_heal.detected`
- Harness patch PR is opened/proposed → `self_heal.pr_opened` / `self_heal.pr_proposed`

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
