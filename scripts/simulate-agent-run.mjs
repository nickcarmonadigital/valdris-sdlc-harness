#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), "data", "runs", "demo");
const outFile = path.join(outDir, "events.jsonl");

const events = [
  ["evt-local-001", "run.started", "human", "intake", "run/intake.json", "Local operator starts a bugfix run from Claude Code/Codex/Hermes."],
  ["evt-local-002", "agent.connected", "claude-code", "route", "CLAUDE.md", "Claude Code connector attached to the local run packet."],
  ["evt-local-003", "node.entered", "harness", "route", "run/route.json", "Harness selected lane=engineering-default work_type=bug."],
  ["evt-local-004", "gate.fired", "harness", "investigate", "rca/rca.json", "RCA gate opened and requires runtime evidence before cause."],
  ["evt-local-005", "artifact.written", "claude-code", "design", "design/anchors.json", "Agent wrote code anchors and design notes."],
  ["evt-local-006", "node.entered", "codex", "implement", "session/events.jsonl", "Codex started implementation in its own runtime; UI only watches events."],
  ["evt-local-007", "approval.requested", "harness", "redzone", "approvals/redzone.json", "Red Zone needs explicit human approval before provider/config changes.", "warn"],
  ["evt-local-008", "run.blocked", "harness", "prove", "proof/proof.json", "Run blocked because proof/proof.json has not been written yet.", "blocked"],
];

await mkdir(outDir, { recursive: true });
await writeFile(
  outFile,
  events
    .map(([id, type, actor, nodeId, artifact, message, status = "ok"], index) =>
      JSON.stringify({ id, type, actor, nodeId, artifact, message, status, ts: `00:${String(index * 9).padStart(2, "0")}` }),
    )
    .join("\n") + "\n",
);

console.log(`Wrote ${events.length} events to ${outFile}`);
console.log("Run `npm run dev` and open http://localhost:3000 to see the on-prem JSONL feed.");
