# Connector Event Contract v0.5

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

| Mode        | Meaning                          | Event source                                                |
| ----------- | -------------------------------- | ----------------------------------------------------------- |
| `blueprint` | Static topology/lane explanation | `static-blueprint`                                          |
| `live`      | Current real run telemetry       | `bridge`, `mcp`, `api`, `watched-artifact`, `browser-local` |
| `replay`    | Historical event playback        | `local-jsonl`, `database`, `run-packet`                     |

## Core event types

| Event                   | Meaning                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `run.created`           | Human/task created a run packet                                  |
| `run.mode_set`          | Run declares blueprint/live/replay source                        |
| `agent.connected`       | Runtime connector attached to the run                            |
| `node.entered`          | Agent or harness entered a workflow node                         |
| `node.skipped`          | Node was intentionally skipped with reason                       |
| `node.failed`           | Node failed with failure reason and recovery path                |
| `gate.fired`            | Mechanical gate started or evaluated                             |
| `artifact.written`      | Required run artifact exists and should be verified              |
| `approval.requested`    | Human approval/Red Zone pause                                    |
| `approval.granted`      | Human approved scoped Red Zone action                            |
| `approval.denied`       | Human denied scoped Red Zone action                              |
| `run.blocked`           | Completion is blocked by missing proof, failed gate, or approval |
| `run.completed`         | Required artifacts passed and answer contract can be produced    |
| `self_heal.detected`    | Finish-line found a harness/process gap                          |
| `self_heal.pr_opened`   | A scoped PR was opened to fix the harness pack                   |
| `self_heal.pr_proposed` | A scoped PR/patch artifact was proposed to fix the harness pack  |

## Strict event schema

The v0.5 local bridge is intentionally strict. Events missing required fields are rejected with `event_contract_violation`.

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
type NodeState =
  "passed" | "active" | "failed" | "skipped" | "pending" | "needs_approval";
type Actor =
  "claude-code" | "codex" | "hermes" | "human" | "harness" | "system";
type Status =
  | "ok"
  | "warn"
  | "blocked"
  | "skipped"
  | "failed"
  | "needs_approval"
  | "passed";

type NodeId =
  | "intake"
  | "route"
  | "code-intelligence"
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
  id?: string; // generated if omitted
  type: string; // must be one of the core event types above
  ts?: string; // generated if omitted
  actor: Actor;
  runMode: RunMode;
  eventSource: EventSource;
  nodeId: NodeId;
  nodeState?: NodeState;
  artifact?: string;
  artifactRoot?: string; // required on the run for artifact.written verification
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

Base v0.5 bridge flow. The stable node ID remains `code-intelligence`, but the preferred backend for that node is now GitNexus/code intelligence:

```text
intake → route → code-intelligence → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

Cloud/platform expansion nodes are documented lane-detail concepts, but the current local bridge only accepts the base node IDs above. Expansion nodes should be represented inside `cloud/service-map.json` or future adapter schemas until the bridge adds adapter-defined nodes.

## Credential boundary

The bridge requires three strong, distinct process credentials and fails closed at startup if any is missing, contains fewer than 32 bytes, or reuses another role's value:

| Credential                  | Request surface                                                                                                                                     | Least-privilege holder                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UASH_BRIDGE_INTEGRITY_KEY` | No request header. It keys HMAC-SHA-256 authentication for `run-config.json`, derived `run.json`, and the run-ID-bound `events.jsonl` chain.        | Bridge process only; never agents, browsers, or UI processes.                                                                                            |
| `UASH_BRIDGE_ACCESS_TOKEN`  | `x-uash-bridge-token` on ordinary `GET`/`POST` run API requests.                                                                                    | Bridge process, ordinary agent/API clients, and the server-side UI proxy. Never browser JavaScript.                                                      |
| `UASH_HUMAN_APPROVAL_TOKEN` | `x-uash-human-token`, additionally required for `approval.granted` and `approval.denied`. The operator-shell emitter reads it from its environment. | Bridge process and human operator approval shell only; never ordinary agents or the UI proxy. Never pass it through process arguments or request bodies. |

Generate at least 32 random bytes for each credential; do not reuse one value across roles. A human grant/deny request needs both the ordinary access header and the human header. Possession of the access token alone cannot self-approve, and possession of the human token alone does not authorize an API write. Raw credentials are never persisted or returned by the run API. Unauthenticated `GET /health` is liveness-only (`ok`, service, contract version, and bounded listen mode); absolute data/repository paths, node inventories, port, and credential-state details are returned only when `x-uash-bridge-token` is valid. The same-origin UI routes hold the access token server-side and proxy to the loopback bridge; no bridge credential belongs in `NEXT_PUBLIC_*` or a client bundle. Finish-line child validators run with all three credential variables removed from their environment.

`UASH_REVIEW_TRUST_SHA256` is a separate nonsecret authority input, not a bridge credential. It must be the operator- or protected-CI-held SHA-256 of the canonical JSON semantics of the commissioned review trust store. The bridge fails closed at startup when the pin is missing or malformed, seals it into the immutable run configuration, rejects recovered or active runs whose pin differs, and passes that same nonsecret pin to finish-line validators after stripping credentials. Review and packet validation require both the live and reviewed-commit trust stores to canonicalize to this value. An agent-controlled shell setting a digest derived from its own checkout does not establish authority. Trust-store rotation requires an out-of-band operator review and protected pin update; neither commissioning output nor repository bytes auto-enroll a replacement trust root.

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
- `approval.granted` and `approval.denied` must be emitted by `actor: "human"`, must match an existing pending approval, and must include the operator-held `UASH_HUMAN_APPROVAL_TOKEN` via `x-uash-human-token` in addition to the ordinary access header. The operator-shell emitter reads it from its environment; human tokens in process arguments or request bodies are rejected and tokens are never returned by HTTP.
- `UASH_BRIDGE_INTEGRITY_KEY` alone HMAC-authenticates `run-config.json`, the derived `run.json` snapshot, and a run-ID-bound chain of `events.jsonl` envelopes; neither API access nor human approval credentials are reused as state-integrity keys. Retain the same integrity key across restarts to reopen existing records. Canonical run IDs match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; exact IDs receive SHA-256 storage keys, and aliases that would collide after filesystem normalization are isolated. Event IDs are generated only when omitted; a supplied ID must be a non-empty string of at most 512 characters and is rejected before append otherwise. Run reads and writes are serialized per canonical ID, repeated equivalent `POST /runs` requests are idempotent, and a process lease prevents multiple bridges from sharing `UASH_DATA_DIR`. A separate exclusive recovery mutex serializes stale-main-lease revalidation, removal, and replacement; the bridge never automatically steals a malformed or stale recovery mutex, so crash residue requires explicit operator inspection and cleanup. The authenticated journal is authoritative over its bound derived snapshot, and a recoverable journal/snapshot crash gap is replayed without weakening the immutable commissioning record. Pre-v0.8 unsigned directory layouts trigger an explicit startup failure rather than silent migration or history forking.
- `UASH_REVIEW_TRUST_SHA256` is immutable bridge-run configuration. Startup, run creation, recovery, commissioned-runtime bootstrap, every child review/packet gate, and completed-run revalidation must agree on the same operator-held canonical trust-store digest.
- Run API reads are paginated before serialization. `GET /runs` accepts only `limit` (1-50, default 25) and non-negative `cursor`, returns summaries with no event bodies, and reports `eventCount`/`eventsTruncated`. `GET /runs/:id` accepts only `eventLimit` (1-200, default 100) and non-negative `eventCursor`; the default page is the newest events and the response carries `eventPage`. Decimal `x-uash-page-*` headers expose offset, limit, returned count, total, and an optional next cursor. The bridge enforces per-event, per-run, journal/snapshot/config, directory, and response-size ceilings; the server-side UI proxy independently caps upstream bytes and forwards only safe pagination metadata.
- `artifact.written` requires an actual regular file under the run `artifactRoot`; symlink/path escapes are rejected. The bridge records a SHA-256 claim inside the HMAC event journal, uses that sealed claim during snapshot-lag replay, and re-resolves, re-hashes, and revalidates every required artifact before and after the finish-line gate sequence. Portable v0.8 privacy scanning covers the bounded packet inputs, every declared gate artifact, universal enterprise evidence, waivers, conditional RCA, review, final packet, and required bridge artifacts—not only the UI node list. Completed-run reads repeat the artifact, privacy, runtime, approval, and finish-line closure; deletion, persistent byte drift, or privacy drift quarantines the record rather than returning stale `complete` state. For `prove`, the configured proof artifact must validate as passing `uash.proof.v1` with zero-exit command evidence. For `production-readiness`, `production/layer-assessment.json` must validate all 13 canonical layers; newly commissioned runs use control-level `uash.production-readiness.v2`, while legacy v1 history remains readable.
- Unchanged completed-run reads use a digest-bound cache keyed by the authenticated journal head, current commissioned runtime and loader identity, trust policy, closure status, and current artifact digests. Authenticated `GET /health` exposes aggregate cache execution/hit counts for operator verification; those counters never affect the trust decision.
- A nested commissioned pack supplies `adapterPath` on the first event (CLI: `--adapter-path .valdris-harness/project-adapter.json`). First-event artifact-root/adapter configuration is authenticated and persisted before journal append, including uncommissioned roots, so a crash cannot leave a valid event attached to an unbound configuration. The adapter must resolve inside `artifactRoot`, `UASH_REPO_ROOT`, or an explicitly configured `UASH_ADAPTER_ROOTS` entry; symlink and arbitrary-path escapes are rejected.
- When the adapter sets `finishLineAssurance.required`, `run.completed` executes the aggregate enterprise/AI gate against the run artifact root, binds route and goal IDs to the bridge run ID, and correlates active waivers with token-gated approval events. A packet-required adapter enforces typed RCA whenever the validated route requires it or an RCA artifact exists, then `valdris.review.v2` and new `valdris.run-packet.v3`. The signed review declares exactly `scout`, `implementer`, `verifier`, and `independentReviewer`; `actorId`, `sessionId`, and `executionId` are each pairwise distinct across all four roles. Scout evidence binds the route, implementer and verifier evidence bind portable proof, and the authorized Ed25519 independent reviewer signs the frozen pre-review evidence bundle, artifact inventory, and complete role roster. The v3 packet additionally binds assurance level and resolved catalogs; semantic or authoritative claims require the authoritative-assurance artifact. Historical v2 packets remain structural evidence only.
- `run.completed` can only pass when all required nodes are verified-present or explicitly skipped with reasons.
- If `self_heal.detected` is emitted, a later `self_heal.pr_opened` or `self_heal.pr_proposed` is required before completion, and that resolution must include a real pull request URL or a verified local `self_heal/pr.json` proposal artifact.
- Once a run has an `artifactRoot`, later events may not change it.

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

## Project-adapter runtime policy

The v0.5 bridge can load `project-adapter.json` from inside the run `artifactRoot`, `UASH_REPO_ROOT`, or `UASH_ADAPTER_ROOTS`. It consumes `runtime.requiredNodes` and `runtime.artifactByNode` so project-specific gates are enforced at runtime instead of only in prompts. Arbitrary absolute adapter paths are rejected.

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
