export type AgentRuntime = "claude-code" | "codex" | "hermes";
export type RunMode = "blueprint" | "live" | "replay";
export type EventSource = "static-blueprint" | "bridge" | "mcp" | "api" | "watched-artifact" | "local-jsonl" | "database" | "run-packet";

export type RunEventType =
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

export type VisualNodeState = "waiting" | "running" | "passed" | "blocked" | "skipped" | "failed" | "approval";

export type WorkflowNode = {
  id: string;
  label: string;
  shortLabel: string;
  lane: string;
  artifact: string;
  x: number;
  y: number;
};

export type RunEvent = {
  id: string;
  type: RunEventType;
  ts: string;
  actor: AgentRuntime | "human" | "harness";
  runMode?: RunMode;
  eventSource?: EventSource;
  nodeId?: string;
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

export const workflowNodes: WorkflowNode[] = [
  { id: "intake", label: "Task intake", shortLabel: "Intake", lane: "Trigger", artifact: "run/intake.json", x: 4, y: 8 },
  { id: "route", label: "Lane route", shortLabel: "Route", lane: "Harness", artifact: "run/route.json", x: 22, y: 8 },
  { id: "system-design", label: "System design", shortLabel: "Design", lane: "System", artifact: "design/system_design.md", x: 40, y: 8 },
  { id: "production-readiness", label: "Production layer assessment", shortLabel: "13 Layers", lane: "Production", artifact: "production/layer-assessment.json", x: 58, y: 8 },
  { id: "cloud-platform", label: "Cloud/platform lane", shortLabel: "Cloud", lane: "Platform", artifact: "cloud/service-map.json", x: 76, y: 8 },
  { id: "implement", label: "Agent worktree", shortLabel: "Build", lane: "Runtime", artifact: "session/events.jsonl", x: 76, y: 43 },
  { id: "redzone", label: "Red Zone check", shortLabel: "Red Zone", lane: "Control", artifact: "approvals/redzone.json", x: 58, y: 43 },
  { id: "qa-break-it", label: "Break-it QA", shortLabel: "Break QA", lane: "QA", artifact: "qa/break-it-results.md", x: 40, y: 43 },
  { id: "prove", label: "Proof gate", shortLabel: "Prove", lane: "Validation", artifact: "proof/proof.json", x: 22, y: 43 },
  { id: "live-smoke", label: "Live smoke", shortLabel: "Smoke", lane: "Release", artifact: "smoke/smoke_proof.json", x: 4, y: 43 },
  { id: "self-heal", label: "Self-heal PR", shortLabel: "Self-heal", lane: "Learn", artifact: "self_heal/self_heal_report.md", x: 4, y: 70 },
  { id: "handoff", label: "Answer contract", shortLabel: "Handoff", lane: "Ship", artifact: "handoff/final.md", x: 22, y: 70 },
];

export const workflowEdges = [
  ["intake", "route"],
  ["route", "system-design"],
  ["system-design", "production-readiness"],
  ["production-readiness", "cloud-platform"],
  ["cloud-platform", "implement"],
  ["implement", "redzone"],
  ["redzone", "qa-break-it"],
  ["qa-break-it", "prove"],
  ["prove", "live-smoke"],
  ["live-smoke", "self-heal"],
  ["self-heal", "handoff"],
] as const;

export const demoRunEvents: RunEvent[] = [
  {
    id: "evt-001",
    type: "run.created",
    ts: "00:00",
    actor: "human",
    nodeId: "intake",
    artifact: "run/intake.json",
    message: "Nick asks: merge production readiness + system design + cloud/platform into the harness.",
    status: "ok",
    runMode: "replay",
    eventSource: "local-jsonl",
  },
  {
    id: "evt-002",
    type: "agent.connected",
    ts: "00:05",
    actor: "claude-code",
    nodeId: "route",
    artifact: "CLAUDE.md",
    message: "Claude Code connector attaches to the local run packet; no IDE surface required.",
    status: "ok",
  },
  {
    id: "evt-003",
    type: "artifact.written",
    ts: "00:09",
    actor: "harness",
    nodeId: "system-design",
    artifact: "design/system_design.md",
    message: "System design lane captured requirements, constraints, tradeoffs, and ADR triggers.",
    status: "ok",
  },
  {
    id: "evt-004",
    type: "artifact.written",
    ts: "00:17",
    actor: "harness",
    nodeId: "production-readiness",
    artifact: "production/layer-assessment.json",
    message: "13 production layers assessed and mapped to required/skipped nodes.",
    status: "ok",
  },
  {
    id: "evt-005",
    type: "node.skipped",
    ts: "00:31",
    actor: "harness",
    nodeId: "cloud-platform",
    artifact: "cloud/skip.json",
    message: "Cloud/platform skipped with explicit reason.",
    status: "skipped",
    skipReason: "No cloud resource, IAM, secret, network, deploy, or provider setting changed.",
  },
  {
    id: "evt-006",
    type: "node.entered",
    ts: "00:43",
    actor: "codex",
    nodeId: "implement",
    artifact: "session/events.jsonl",
    message: "Codex can now run in its own app/account while the board watches the run packet.",
    status: "ok",
  },
  {
    id: "evt-007",
    type: "approval.requested",
    ts: "01:04",
    actor: "harness",
    nodeId: "redzone",
    artifact: "approvals/redzone.json",
    message: "Red Zone pauses on provider/config risk and asks for explicit human approval.",
    status: "needs_approval",
    approvalOwner: "primary operator",
    approvalScope: "provider/config mutation",
  },
  {
    id: "evt-008",
    type: "node.failed",
    ts: "01:21",
    actor: "harness",
    nodeId: "qa-break-it",
    artifact: "qa/break-it-results.md",
    message: "Break-it QA missing; finish-line remains blocked.",
    status: "failed",
    failureReason: "qa/break-it-results.md is missing.",
    recoveryPath: "Run destructive/edge-case QA and attach results before completion.",
  },
  {
    id: "evt-009",
    type: "self_heal.detected",
    ts: "01:30",
    actor: "harness",
    nodeId: "self-heal",
    artifact: "self_heal/self_heal_report.md",
    message: "Harness process gap detected and recorded for self-healing.",
    status: "warn",
  },
];

export function reduceNodeStates(events: RunEvent[]): Record<string, VisualNodeState> {
  const states: Record<string, VisualNodeState> = Object.fromEntries(
    workflowNodes.map((node) => [node.id, "waiting" as VisualNodeState]),
  );

  for (const event of events) {
    if (!event.nodeId) continue;
    if (event.type === "node.skipped" || event.status === "skipped") states[event.nodeId] = "skipped";
    else if (event.type === "node.failed" || event.status === "failed") states[event.nodeId] = "failed";
    else if (event.type === "approval.requested" || event.status === "needs_approval") states[event.nodeId] = "approval";
    else if (event.type === "run.blocked" || event.status === "blocked") states[event.nodeId] = "blocked";
    else if (event.type === "node.entered" || event.type === "gate.fired") states[event.nodeId] = "running";
    else if (event.type === "artifact.written" || event.status === "ok") states[event.nodeId] = "passed";
  }

  const latestActive = [...events].reverse().find((event) => event.nodeId && !["ok", "skipped", "failed"].includes(event.status ?? ""));
  if (latestActive?.nodeId && !["blocked", "approval"].includes(states[latestActive.nodeId])) {
    states[latestActive.nodeId] = "running";
  }

  return states;
}

export function latestNodeForAgent(events: RunEvent[], actor: AgentRuntime): string | undefined {
  return [...events].reverse().find((event) => event.actor === actor && event.nodeId)?.nodeId;
}
