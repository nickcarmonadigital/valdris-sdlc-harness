export type AgentRuntime = "claude-code" | "codex" | "hermes";

export type RunEventType =
  | "run.started"
  | "agent.connected"
  | "node.entered"
  | "gate.fired"
  | "artifact.written"
  | "approval.requested"
  | "run.blocked"
  | "run.completed";

export type VisualNodeState = "waiting" | "running" | "passed" | "blocked";

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
  nodeId?: string;
  artifact?: string;
  message: string;
  status?: "ok" | "warn" | "blocked";
};

export const workflowNodes: WorkflowNode[] = [
  {
    id: "intake",
    label: "Task intake",
    shortLabel: "Intake",
    lane: "Trigger",
    artifact: "run/intake.json",
    x: 7,
    y: 16,
  },
  {
    id: "route",
    label: "Lane route",
    shortLabel: "Route",
    lane: "Harness",
    artifact: "run/route.json",
    x: 27,
    y: 16,
  },
  {
    id: "investigate",
    label: "Evidence pass",
    shortLabel: "Investigate",
    lane: "Research",
    artifact: "rca/rca.json",
    x: 50,
    y: 16,
  },
  {
    id: "design",
    label: "Design anchors",
    shortLabel: "Design",
    lane: "Plan",
    artifact: "design/anchors.json",
    x: 74,
    y: 16,
  },
  {
    id: "implement",
    label: "Agent worktree",
    shortLabel: "Build",
    lane: "Runtime",
    artifact: "session/events.jsonl",
    x: 74,
    y: 58,
  },
  {
    id: "redzone",
    label: "Red Zone check",
    shortLabel: "Red Zone",
    lane: "Control",
    artifact: "approvals/redzone.json",
    x: 50,
    y: 58,
  },
  {
    id: "prove",
    label: "Proof gate",
    shortLabel: "Prove",
    lane: "Validation",
    artifact: "proof/proof.json",
    x: 27,
    y: 58,
  },
  {
    id: "handoff",
    label: "Answer contract",
    shortLabel: "Handoff",
    lane: "Ship",
    artifact: "handoff/final.md",
    x: 7,
    y: 58,
  },
];

export const workflowEdges = [
  ["intake", "route"],
  ["route", "investigate"],
  ["investigate", "design"],
  ["design", "implement"],
  ["implement", "redzone"],
  ["redzone", "prove"],
  ["prove", "handoff"],
] as const;

export const demoRunEvents: RunEvent[] = [
  {
    id: "evt-001",
    type: "run.started",
    ts: "00:00",
    actor: "human",
    nodeId: "intake",
    artifact: "run/intake.json",
    message: "Nick asks: fix this bug, but keep the agent inside the harness flow.",
    status: "ok",
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
    type: "node.entered",
    ts: "00:09",
    actor: "harness",
    nodeId: "route",
    artifact: "run/route.json",
    message: "Harness routes work to engineering-default and computes required artifacts.",
    status: "ok",
  },
  {
    id: "evt-004",
    type: "gate.fired",
    ts: "00:17",
    actor: "harness",
    nodeId: "investigate",
    artifact: "rca/rca.json",
    message: "RCA gate opens. Static guesses stay hypotheses until runtime evidence is attached.",
    status: "ok",
  },
  {
    id: "evt-005",
    type: "artifact.written",
    ts: "00:31",
    actor: "claude-code",
    nodeId: "design",
    artifact: "design/anchors.json",
    message: "Agent pins code anchors and planned blast radius before touching implementation.",
    status: "ok",
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
    status: "warn",
  },
  {
    id: "evt-008",
    type: "run.blocked",
    ts: "01:21",
    actor: "harness",
    nodeId: "prove",
    artifact: "proof/proof.json",
    message: "Final answer blocked: required proof/proof.json is missing.",
    status: "blocked",
  },
];

export function reduceNodeStates(events: RunEvent[]): Record<string, VisualNodeState> {
  const states: Record<string, VisualNodeState> = Object.fromEntries(
    workflowNodes.map((node) => [node.id, "waiting" as VisualNodeState]),
  );

  for (const event of events) {
    if (!event.nodeId) continue;
    if (event.type === "run.blocked" || event.status === "blocked") {
      states[event.nodeId] = "blocked";
    } else if (event.type === "node.entered" || event.type === "gate.fired" || event.type === "approval.requested") {
      states[event.nodeId] = event.status === "warn" ? "running" : "running";
    } else if (event.type === "artifact.written" || event.status === "ok") {
      states[event.nodeId] = "passed";
    }
  }

  const latestActive = [...events].reverse().find((event) => event.nodeId && event.status !== "ok");
  if (latestActive?.nodeId && states[latestActive.nodeId] !== "blocked") {
    states[latestActive.nodeId] = "running";
  }

  return states;
}

export function latestNodeForAgent(events: RunEvent[], actor: AgentRuntime): string | undefined {
  return [...events].reverse().find((event) => event.actor === actor && event.nodeId)?.nodeId;
}
