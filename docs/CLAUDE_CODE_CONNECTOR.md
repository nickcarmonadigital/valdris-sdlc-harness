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

The Vercel app can still be the UI because your browser is on the same Mac and can call `localhost`. No Supabase is required for v0.

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
npm run bridge:claude
```

The bridge starts at:

```text
http://127.0.0.1:8787
```

It stores local run state at:

```text
~/.uash/runs/<RUN_ID>/run.json
~/.uash/runs/<RUN_ID>/events.jsonl
```

## Current strict bridge rules

The v0.5 bridge rejects fake or incomplete events.

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

The RCA and both proof phases must bind the same run and environment while naming distinct existing pre-fix and post-fix commits; both phases execute the same bound regression command, and the final packet binds the post-fix commit. Generate the canonical pre-review evidence digest with `run-create.mjs --print-evidence-bundle`; the independent Ed25519 attestation must sign it and verify against the exact committed `.valdris-harness/controls/review-trust.v1.json` path derived from the same-worktree runtime pack. A narrative RCA, self-declared reviewer identity, unsigned evidence change, external validation runtime, post-proof application mutation, or code fix without regression proof cannot close the run.

## App flow

1. Open the app.
2. Create or select a run.
3. In the Connector Bridge panel:
   - click **Check bridge**
   - click **Sync run to bridge**
   - click **Poll bridge**
   - click **Copy Claude prompt**
4. Paste that prompt into Claude Code, or install the slash-command template below.
5. Claude Code emits events as it moves through the Valdris SDLC Harness flow, including GitNexus/code-intelligence evidence for the `code-intelligence` node on code-impacting runs.
6. The bridge rejects `run.completed` if required artifacts are missing, unverified, failed, skipped without reasons, waiting on approval, waiting on self-heal PR/proposal, or missing the required corrective-work RCA and proof chain.
7. The app pulls those events and updates:
   - current node
   - agent chip position
   - event stream
   - required artifact status
   - blocked/approval state

## Emit event manually

From the project root:

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

Only a human approval event may grant/deny approval:

```bash
node scripts/uash-emit-event.mjs EXAMPLE-RUN-1042 approval.granted redzone \
  "Human approved scoped Red Zone action" \
  --artifact approvals/redzone.json \
  --status ok \
  --actor human \
  --mode live \
  --source bridge \
  --approval-owner "primary operator" \
  --approval-scope "redzone" \
  --human-token "$UASH_HUMAN_APPROVAL_TOKEN"
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
