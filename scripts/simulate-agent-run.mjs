#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), "data", "runs", "demo");
const outFile = path.join(outDir, "events.jsonl");

const events = [
  ["evt-local-001", "run.created", "human", "intake", "run/intake.json", "Local operator starts a production-readiness run from Claude Code/Codex/Hermes.", "ok", { runMode: "replay", eventSource: "local-jsonl" }],
  ["evt-local-002", "agent.connected", "claude-code", "route", "CLAUDE.md", "Claude Code connector attached to the local run packet.", "ok"],
  ["evt-local-003", "node.entered", "harness", "system-design", "design/system_design.md", "Harness entered system design: requirements, constraints, API/data/failure tradeoffs.", "ok"],
  ["evt-local-004", "artifact.written", "claude-code", "production-readiness", "production/layer-assessment.json", "Production Readiness Layer Pack written with touched/skipped layers.", "ok"],
  ["evt-local-005", "node.skipped", "harness", "cloud-platform", "cloud/skip.json", "Cloud/platform skipped with explicit reason.", "skipped", { skipReason: "No deploy, cloud resource, secret, IAM, network, or provider setting changed." }],
  ["evt-local-006", "node.entered", "codex", "implement", "session/events.jsonl", "Codex started implementation in its own runtime; UI only watches events.", "ok"],
  ["evt-local-007", "approval.requested", "harness", "redzone", "approvals/redzone.json", "Red Zone needs explicit human approval before provider/config changes.", "needs_approval", { approvalOwner: "primary operator", approvalScope: "provider/config mutation" }],
  ["evt-local-008", "node.failed", "harness", "qa-break-it", "qa/break-it-results.md", "Break-it QA failed because the artifact is missing.", "failed", { failureReason: "qa/break-it-results.md not written.", recoveryPath: "Run break-it checklist, attach results, then rerun finish-line." }],
  ["evt-local-009", "self_heal.detected", "harness", "self-heal", "self_heal/self_heal_report.md", "Harness gap detected: generated adapter lacked QA/break-it question.", "warn"],
  ["evt-local-010", "self_heal.pr_opened", "harness", "self-heal", "self_heal/pr.json", "Self-heal PR proposed for the missing adapter question.", "ok"],
];

await mkdir(outDir, { recursive: true });
await writeFile(
  outFile,
  events
    .map(([id, type, actor, nodeId, artifact, message, status = "ok", extra = {}], index) =>
      JSON.stringify({ id, type, actor, nodeId, artifact, message, status, ts: `00:${String(index * 7).padStart(2, "0")}`, ...extra }),
    )
    .join("\n") + "\n",
);

console.log(`Wrote ${events.length} events to ${outFile}`);
console.log("Run `npm run dev` and open http://localhost:3000 to see the on-prem JSONL replay feed.");
