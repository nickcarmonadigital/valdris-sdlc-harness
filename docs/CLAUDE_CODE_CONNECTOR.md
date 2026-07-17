# Claude Code Connector v0.5

This is the practical answer to: “If I open Claude Code on my Mac, how does this application connect to it?”

## Short answer

Run a tiny local bridge on the same Mac as Claude Code.

```text
Claude Code on Mac
→ emits node/gate/artifact events
→ local bridge at http://127.0.0.1:8787
→ app polls/imports that run
→ workflow board moves node-by-node
```

The app can still be the UI without Supabase for v0, but the browser does not call the bridge with a credential. It calls the app's same-origin `/api/bridge` routes; that server-side proxy injects the bridge access token and calls loopback. Run the app server in the same machine or network namespace as the local bridge. A remotely hosted server cannot reach a bridge on the user's `localhost`.

## Why this is the right v0

Claude Code is the runtime. The Universal Harness app is the **control plane**.

We do **not** scrape Claude’s UI or try to read private thoughts. We instrument the workflow boundary:

- when Claude enters a harness node
- when a gate fires
- when an artifact is written and verified
- when Red Zone approval is needed
- when finish-line proof blocks completion

That gives the intended operator experience: the app shows the flow, validation points, node-by-node movement, and the useful information the agent provides at each node.

## Setup on the Mac

From this repo:

```bash
npm ci
UASH_INTEGRITY_VALUE="$(openssl rand -base64 32)"
UASH_ACCESS_VALUE="$(openssl rand -base64 32)"
UASH_APPROVAL_VALUE="$(openssl rand -base64 32)"
export UASH_BRIDGE_INTEGRITY_KEY="$UASH_INTEGRITY_VALUE"
export UASH_BRIDGE_ACCESS_TOKEN="$UASH_ACCESS_VALUE"
export UASH_HUMAN_APPROVAL_TOKEN="$UASH_APPROVAL_VALUE"
npm run bridge:claude
```

PowerShell:

```powershell
npm ci
function NewUashSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes)
}
$env:UASH_BRIDGE_INTEGRITY_KEY = NewUashSecret
$env:UASH_BRIDGE_ACCESS_TOKEN = NewUashSecret
$env:UASH_HUMAN_APPROVAL_TOKEN = NewUashSecret
npm run bridge:claude
```

Generate and retain three **different** values of at least 32 bytes each. Do not reuse one credential for multiple roles:

| Credential | Holder | Purpose |
|---|---|---|
| `UASH_BRIDGE_INTEGRITY_KEY` | Bridge process only | HMAC-authenticates immutable run configuration, derived snapshots, and the event-journal chain. Never give it to an agent, browser, or UI process. |
| `UASH_BRIDGE_ACCESS_TOKEN` | Bridge process, ordinary agent process, and server-side UI proxy | Authorizes ordinary `GET`/`POST` run API access through `x-uash-bridge-token`. The emitter reads it from the environment. Never expose it through `NEXT_PUBLIC_*` or browser JavaScript. |
| `UASH_HUMAN_APPROVAL_TOKEN` | Bridge process and human operator approval shell only | Additionally authorizes `approval.granted` and `approval.denied` through `x-uash-human-token`. The emitter reads it from the operator-shell environment; never pass it through process arguments or request bodies, and never give it to an ordinary agent or UI process. |
| `UASH_REVIEW_TRUST_SHA256` | Operator/protected CI, bridge, and finish-line validator processes | Nonsecret canonical-JSON SHA-256 pin for the reviewed review-trust store. Keep its authority outside the checkout; an agent-selected value is not an external trust root. |

The bridge fails closed at startup unless all three contain at least 32 bytes and are **pairwise different**. A normal Claude Code shell receives only `UASH_BRIDGE_ACCESS_TOKEN`. A human approval shell needs both the access token and the human approval token because approval is still a bridge write. The server-side UI proxy receives only `UASH_BRIDGE_ACCESS_TOKEN` (and `UASH_BRIDGE_URL` when the default loopback URL is not used). Finish-line validator subprocesses receive none of the three bridge credentials.

Portable v0.8 additionally fails closed unless `UASH_REVIEW_TRUST_SHA256` is a 64-hex canonical-JSON digest matching both the live trust store and the store at the reviewed commit. The bridge seals its startup pin into authenticated immutable run configuration and propagates that nonsecret pin to child validators while removing all three credentials. Configure it as a protected CI/repository variable or in an operator-owned service environment. For governed key rotation, review the new trust store and update the protected pin out of band before accepting it; never derive or auto-update the authoritative value from the checkout in the same delivery-agent session.

The bridge starts at:

```text
http://127.0.0.1:8787
```

It stores local run state at:

```text
~/.uash/runs/run-<SHA256_OF_RUN_ID>/run.json
~/.uash/runs/run-<SHA256_OF_RUN_ID>/run-config.json
~/.uash/runs/run-<SHA256_OF_RUN_ID>/events.jsonl
```

`UASH_BRIDGE_INTEGRITY_KEY` is the only credential used for HMAC-SHA-256 state integrity, and its raw value is never written to the run directory. Retain the same integrity key across restarts to reopen existing records. `UASH_HUMAN_APPROVAL_TOKEN` is sealed to each run by digest for later human grant/deny checks, while `UASH_BRIDGE_ACCESS_TOKEN` is an API capability that may be rotated when the bridge restarts. Raw credentials are never returned by the run API. Unauthenticated `GET /health` returns liveness-only metadata and never returns absolute data/repository paths; the server-side UI proxy supplies the access token when it needs detailed health. There is no unsigned bridge-run mode, so an uncommissioned application run still receives authenticated local control-plane state.

v0.8 deliberately does not reinterpret pre-v0.8 `<RUN_ID>/run.json` directories as trusted state. If the data directory contains that legacy layout, startup fails with an explicit archival/migration boundary instead of silently hiding or forking those histories. Archive the old data directory for read-only retention and start v0.8 with a fresh `UASH_DATA_DIR`; there is no trust-preserving automatic conversion from the former unsigned snapshots and raw JSONL events.

## Current strict bridge rules

The v0.5 bridge rejects fake or incomplete events.

Writes for one canonical run ID are serialized, and noncanonical IDs are rejected instead of being lossily mapped onto a shared directory. Repeating the same `POST /runs` request returns the existing authenticated run; a conflicting retry fails explicitly. Storage uses a SHA-256 key of the exact ID, avoiding case-folding, reserved-name, and separator aliases across operating systems; the HMAC journal still binds the unhashed ID. One process lease prevents two bridge processes from sharing a data directory. Every startup first owns a separate exclusive recovery mutex; stale-main-lease revalidation, removal, and replacement all happen while that mutex is held. A pre-existing malformed or stale recovery mutex is never stolen automatically: confirm no startup is active, then archive or remove it explicitly. Every JSONL event is stored in a run-ID-bound HMAC-SHA-256 chain keyed only by `UASH_BRIDGE_INTEGRITY_KEY`, and the atomically replaced snapshot is independently authenticated and bound to its journal prefix. The event journal is fsynced before the snapshot is replaced, incomplete crash tails are truncated under the same per-run lock, and a snapshot that trails a complete authenticated journal entry is replayed. A first-event artifact root or commissioned adapter is sealed before journal append. The authenticated creation record prevents editing local state to downgrade a commissioned run into an uncommissioned run. Reads of completed runs revalidate required artifact digests, runtime identity, approvals, and finish-line gates; drift quarantines the record instead of returning stale `complete` state.

Bridge reads and histories are bounded. `GET /runs` accepts `limit` (default 25, maximum 50) and a non-negative `cursor`; it returns event-free run summaries with `eventCount` and `eventsTruncated`. `GET /runs/:id` accepts `eventLimit` (default 100, maximum 200) and `eventCursor`; omitting the cursor returns the newest page, while `eventPage` in the JSON body describes traversal. Both endpoints emit decimal `x-uash-page-*` headers plus `x-uash-next-cursor` when another page exists, and the same-origin Next proxy forwards only those safe headers and route-specific query names. Unknown, duplicate, or out-of-range query parameters fail closed. Individual events, event count, journal/snapshot/config files, directory candidates, and serialized responses all have explicit byte/count ceilings; a full run must continue under a new run ID instead of growing without bound.

Required event fields:

```text
type, actor, message, status, runMode, eventSource, nodeId
```

Artifact proof rule:

```text
artifact.written requires a real file under artifactRoot.
```

Pass `--artifact-root "$PWD"` on the first live event, or create/sync the run with the correct artifact root before emitting artifact events. The CLI emitter does not invent an artifact root.

Corrective-work proof rule:

```text
bug (including regression), incident, or self-heal corrective work
requires confirmed RCA + one command identity + failing pre-fix commit + passing post-fix commit
```

The RCA and both proof phases must bind the same run and environment while naming distinct existing pre-fix and post-fix commits; both phases execute the same bound regression command, and the final packet binds the post-fix commit. Generate the canonical pre-review evidence digest with `run-create.mjs --print-evidence-bundle`. `review/review.json` uses `valdris.review.v2` and declares exactly `scout`, `implementer`, `verifier`, and `independentReviewer`; `actorId`, `sessionId`, and `executionId` are each pairwise distinct across all four roles. The authorized independent reviewer signs the frozen evidence bundle and complete role roster with Ed25519. When operating this harness repository directly, the runtime-derived trust store is `controls/review-trust.v1.json`. In a commissioned target, it is `.valdris-harness/controls/review-trust.v1.json`. The review gate accepts only the exact committed path derived from the same-worktree runtime pack. The final `valdris.run-packet.v2` binds the role provenance. A narrative RCA, collapsed role identity, self-declared reviewer trust, unsigned evidence change, external validation runtime, post-proof application mutation, or code fix without regression proof cannot close the run.

## App flow

1. Start the app server with `UASH_BRIDGE_ACCESS_TOKEN` and, if needed, `UASH_BRIDGE_URL` in its server-only environment; do not use a `NEXT_PUBLIC_*` variable.
2. Open the app.
3. Create or select a run.
4. In the Connector Bridge panel:
   - click **Check bridge**
   - click **Sync run to bridge**
   - click **Poll bridge**
   - click **Copy Claude prompt**
5. Launch Claude Code with only `UASH_BRIDGE_ACCESS_TOKEN` from the credential set, then paste that prompt or install the slash-command template below.
6. Claude Code emits events as it moves through the Valdris SDLC Harness flow, including GitNexus/code-intelligence evidence for the `code-intelligence` node on code-impacting runs.
7. The bridge rejects `run.completed` if required artifacts are missing, unverified, failed, skipped without reasons, waiting on approval, waiting on self-heal PR/proposal, or missing the required corrective-work RCA and proof chain.
8. The app pulls those events and updates:
   - current node
   - agent chip position
   - event stream
   - required artifact status
   - blocked/approval state

## Emit event manually

From the project root, set `UASH_BRIDGE_ACCESS_TOKEN` to the bridge's access credential. The emitter sends it as `x-uash-bridge-token`; it does not need and must not receive the integrity key.

```bash
node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 agent.connected route \
  "Claude Code attached to the Valdris SDLC Harness run" \
  --artifact run/route.json \
  --status ok \
  --actor claude-code \
  --mode live \
  --source bridge
```

Artifact proof example:

```bash
mkdir -p proof
node scripts/uash-write-proof.mjs --run-id EXAMPLE-RUN-1042 --command "npm run verify:harness" --out proof/proof.json
node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 artifact.written prove \
  "Proof artifact written after validation passed" \
  --artifact proof/proof.json \
  --status ok \
  --actor harness \
  --mode live \
  --source bridge \
  --artifact-root "$PWD"
```

Blocking proof example:

```bash
node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 run.blocked prove \
  "Missing proof/proof.json" \
  --artifact proof/proof.json \
  --status blocked \
  --actor harness \
  --mode live \
  --source bridge \
  --failure-reason "Proof artifact missing" \
  --recovery-path "Run validation, write proof/proof.json, emit artifact.written, retry completion"
```

Red Zone approval request example:

```bash
node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 approval.requested redzone \
  "Red Zone approval required" \
  --artifact approvals/redzone.json \
  --status needs_approval \
  --actor harness \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone"
```

Only a human approval event may grant/deny approval. Run this from an operator shell that has both `UASH_BRIDGE_ACCESS_TOKEN` and `UASH_HUMAN_APPROVAL_TOKEN`; an access token alone cannot self-approve. The emitter reads both credentials from the environment and never accepts the human token through command arguments or request bodies:

```bash
node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 approval.granted redzone \
  "Human approved scoped Red Zone action" \
  --artifact approvals/redzone.json \
  --status ok \
  --actor human \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone"
```

## Claude Code slash command path

Create this in the target repo:

```text
.claude/commands/valdris-sdlc-harness.md
```

Use the generated commissioned pack or the template at:

```text
templates/claude-code/commands/valdris-sdlc-harness.md
```

Then in Claude Code, invoke:

```text
/valdris-sdlc-harness RUN_ID=EXAMPLE-RUN-1042 BRIDGE_URL=http://127.0.0.1:8787 <your task>
```

The command tells Claude Code to use the Valdris SDLC Harness flow and emit bridge events at every node/gate.

## Event contract

The bridge accepts:

```text
POST /runs/:id/events
```

The request must include `x-uash-bridge-token`. Human grant/deny events must additionally include `x-uash-human-token`; neither credential can substitute for the other.

Strict-valid payload:

```json
{
  "type": "gate.fired",
  "nodeId": "prove",
  "artifact": "proof/proof.json",
  "status": "ok",
  "actor": "harness",
  "runMode": "live",
  "eventSource": "bridge",
  "message": "Proof gate fired; validation evidence expected."
}
```

Supported node IDs:

```text
intake → route → code-intelligence → design-anchors → system-design → production-readiness → cloud-platform → implement → redzone → qa-break-it → prove → live-smoke → self-heal → handoff
```

## What we can and cannot observe

| Can observe | Cannot honestly observe without Claude/tool cooperation |
|---|---|
| stage entered | Claude’s private hidden reasoning |
| gate fired | every internal token/thought |
| verified artifact written | uninstrumented UI-only actions |
| approval requested/granted/denied | real runtime state unless emitted/watched |
| run blocked/completed | arbitrary Mac process state without a connector |

So the clean implementation is **instrumented workflow telemetry**, not UI scraping.

## Later upgrade: MCP server

The stronger version is a local MCP server exposing tools:

```text
uash.start_run
uash.emit_event
uash.write_artifact
uash.request_approval
uash.finish_line_check
```

Then Claude Code calls tools directly instead of shelling out to `node scripts/uash-emit-event.mjs`. The bridge written here is the correct v0 before MCP.
