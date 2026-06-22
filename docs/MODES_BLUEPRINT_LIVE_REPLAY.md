# Blueprint, Live Run, and Replay Modes

The harness must never imply fake telemetry.

## Mode contract

| Mode | Meaning | Allowed data source | UI rule |
|---|---|---|---|
| Blueprint | Explains topology, lane taxonomy, nodes, and proof rules | static docs/schema/demo topology | No claim that an agent actually ran |
| Live Run | Shows current run state from real connector events | MCP/local daemon/CLI emitter/API/watched artifacts | Nodes light up only from real events/artifacts |
| Replay | Shows historical run packets/events/artifacts | database or durable JSONL event store | Clearly label run ID, event source, timestamps |

## Data-source contract

Live tracking requires explicit telemetry:

```text
Claude Code / Codex / Hermes
→ MCP tool or local CLI emitter / daemon
→ run event API / local bridge
→ database or durable JSONL event store
→ visual board
→ finish-line and self-healing logic
```

The harness can observe only:

- emitted tool events
- CLI emitter events
- watched files/artifacts
- process output
- API callbacks
- MCP tool calls
- backend run records

It must not claim to read hidden reasoning, private chain-of-thought, or internal IDE state.

## UI copy rules

Use explicit labels:

- **Blueprint topology** — static explanation of the harness.
- **Live run** — real connected telemetry.
- **Replay sample** — historical/durable event playback.

Avoid ambiguous labels like “Live topology” when the data is static or replayed.

## Event mode field

Run packets and event streams should carry mode metadata:

```json
{
  "runMode": "blueprint | live | replay",
  "eventSource": "static-blueprint | local-jsonl | bridge | mcp | api | database",
  "telemetryClaim": "demo topology only | live connector events | replayed event packet"
}
```

## Public explainer rule

A public page may show a demo board, but it must be labeled as blueprint/demo/replay. It cannot present sample nodes as proof that Claude/Codex actually traversed a run.
