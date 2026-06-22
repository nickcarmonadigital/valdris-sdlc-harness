# Claude Code Connector v0

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
- when an artifact is written
- when Red Zone approval is needed
- when finish-line proof blocks completion

That gives the exact thing Nick described: the app shows the flow, validation points, node-by-node movement, and the useful information the agent provides at each node.

## Setup on the Mac

From this repo:

```bash
npm install
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

## App flow

1. Open the app:

```text
https://valdris-sdlc-harness.vercel.app
```

2. Create or select a run.
3. In the Connector Bridge panel:
   - click **Check bridge**
   - click **Sync run to bridge**
   - click **Poll bridge**
   - click **Copy Claude prompt**
4. Paste that prompt into Claude Code, or install the slash-command template below.
5. Claude Code emits events as it moves through the Valdris SDLC Harness flow.
6. The app pulls those events and updates:
   - current node
   - agent chip position
   - event stream
   - required artifact status
   - blocked/approval state

## Emit event manually

From the project root:

```bash
node scripts/uash-emit-event.mjs RUN-1042 agent.connected route \
  "Claude Code attached to the Valdris SDLC Harness run" \
  --artifact run/route.json \
  --status ok \
  --actor claude-code
```

Another example:

```bash
node scripts/uash-emit-event.mjs RUN-1042 gate.fired investigate \
  "RCA gate fired; gathering runtime evidence before cause" \
  --artifact rca/rca.json \
  --status ok \
  --actor harness
```

Blocking proof example:

```bash
node scripts/uash-emit-event.mjs RUN-1042 run.blocked prove \
  "Missing proof/proof.json" \
  --artifact proof/proof.json \
  --status blocked \
  --actor harness
```

## Claude Code slash command path

Create this in the target repo:

```text
.claude/commands/valdris-sdlc-harness.md
```

Use the template at:

```text
templates/claude-code/commands/valdris-sdlc-harness.md
```

Then in Claude Code, invoke:

```text
/valdris-sdlc-harness RUN_ID=RUN-1042 BRIDGE_URL=http://127.0.0.1:8787 <your task>
```

The command tells Claude Code to use the Valdris SDLC Harness flow and emit bridge events at every node/gate.

## Event contract

The bridge accepts:

```text
POST /runs/:id/events
```

Payload:

```json
{
  "type": "gate.fired",
  "nodeId": "investigate",
  "artifact": "rca/rca.json",
  "status": "ok",
  "actor": "harness",
  "message": "RCA gate fired; runtime evidence attached."
}
```

Supported node IDs:

```text
intake → route → investigate → design → implement → redzone → prove → handoff
```

## What we can and cannot observe

| Can observe | Cannot honestly observe without Claude/tool cooperation |
|---|---|
| stage entered | Claude’s private hidden reasoning |
| gate fired | every internal token/thought |
| artifact written | uninstrumented UI-only actions |
| approval requested | real runtime state unless emitted/watched |
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
