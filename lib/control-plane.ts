export type AgentRuntime = "claude-code" | "codex" | "hermes";
export type RunStatus = "queued" | "running" | "blocked" | "approval" | "complete";
export type RiskLevel = "low" | "medium" | "red-zone";

export type AppEventType =
  | "run.created"
  | "agent.connected"
  | "node.entered"
  | "gate.fired"
  | "artifact.written"
  | "approval.requested"
  | "approval.granted"
  | "run.blocked"
  | "run.completed";

export type AppEvent = {
  id: string;
  type: AppEventType;
  at: string;
  actor: AgentRuntime | "human" | "harness";
  nodeId: string;
  artifact?: string;
  message: string;
  status: "ok" | "warn" | "blocked";
};

export type RunArtifact = {
  path: string;
  label: string;
  required: boolean;
  present: boolean;
};

export type AppRun = {
  id: string;
  title: string;
  task: string;
  repo: string;
  branch: string;
  lane: string;
  agent: AgentRuntime;
  status: RunStatus;
  risk: RiskLevel;
  currentNodeId: string;
  createdAt: string;
  updatedAt: string;
  artifacts: RunArtifact[];
  approvals: string[];
  events: AppEvent[];
};

export type WorkflowNode = {
  id: string;
  label: string;
  lane: string;
  description: string;
  requiredArtifact: string;
  x: number;
  y: number;
};

export const workflowNodes: WorkflowNode[] = [
  {
    id: "intake",
    label: "Intake",
    lane: "trigger",
    description: "Capture ask, repo, runtime, risk, and work type.",
    requiredArtifact: "run/intake.json",
    x: 5,
    y: 12,
  },
  {
    id: "route",
    label: "Route",
    lane: "harness",
    description: "Choose lane, source of truth, gate set, and run packet.",
    requiredArtifact: "run/route.json",
    x: 28,
    y: 12,
  },
  {
    id: "investigate",
    label: "Investigate",
    lane: "evidence",
    description: "Pull evidence before allowing cause or code claims.",
    requiredArtifact: "rca/rca.json",
    x: 52,
    y: 12,
  },
  {
    id: "design",
    label: "Design",
    lane: "plan",
    description: "Anchor the code path, ADRs, acceptance, and blast radius.",
    requiredArtifact: "design/anchors.json",
    x: 75,
    y: 12,
  },
  {
    id: "implement",
    label: "Implement",
    lane: "runtime",
    description: "Claude Code/Codex/Hermes works in its own runtime.",
    requiredArtifact: "session/events.jsonl",
    x: 75,
    y: 55,
  },
  {
    id: "redzone",
    label: "Red Zone",
    lane: "control",
    description: "Pause for high-risk deploy, provider, auth, data, or billing moves.",
    requiredArtifact: "approvals/redzone.json",
    x: 52,
    y: 55,
  },
  {
    id: "prove",
    label: "Prove",
    lane: "validation",
    description: "Proof gate, evals, smoke, and finish-line validator.",
    requiredArtifact: "proof/proof.json",
    x: 28,
    y: 55,
  },
  {
    id: "handoff",
    label: "Handoff",
    lane: "ship",
    description: "Answer Contract, evidence packet, and next decision.",
    requiredArtifact: "handoff/final.md",
    x: 5,
    y: 55,
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

export const baseArtifacts: RunArtifact[] = workflowNodes.map((node) => ({
  path: node.requiredArtifact,
  label: node.label,
  required: true,
  present: node.id === "intake",
}));

export const demoRuns: AppRun[] = [
  {
    id: "RUN-1042",
    title: "Fix clone KB miss",
    task: "Investigate why a clone says it does not know content that exists in the KB.",
    repo: "nickcarmonadigital/valdris-sdlc-harness",
    branch: "main",
    lane: "agent-runtime",
    agent: "claude-code",
    status: "blocked",
    risk: "medium",
    currentNodeId: "prove",
    createdAt: "2026-06-18T22:31:00.000Z",
    updatedAt: "2026-06-18T22:42:00.000Z",
    approvals: [],
    artifacts: baseArtifacts.map((artifact) => ({
      ...artifact,
      present: ["run/intake.json", "run/route.json", "rca/rca.json", "design/anchors.json", "session/events.jsonl"].includes(artifact.path),
    })),
    events: [
      {
        id: "evt-1",
        type: "run.created",
        at: "22:31",
        actor: "human",
        nodeId: "intake",
        artifact: "run/intake.json",
        message: "Run packet opened from app intake.",
        status: "ok",
      },
      {
        id: "evt-2",
        type: "agent.connected",
        at: "22:32",
        actor: "claude-code",
        nodeId: "route",
        artifact: "run/route.json",
        message: "Claude Code connector attached; lane=agent-runtime.",
        status: "ok",
      },
      {
        id: "evt-3",
        type: "gate.fired",
        at: "22:35",
        actor: "harness",
        nodeId: "investigate",
        artifact: "rca/rca.json",
        message: "RCA gate opened and runtime evidence attached.",
        status: "ok",
      },
      {
        id: "evt-4",
        type: "artifact.written",
        at: "22:38",
        actor: "claude-code",
        nodeId: "design",
        artifact: "design/anchors.json",
        message: "Design anchors written before implementation.",
        status: "ok",
      },
      {
        id: "evt-5",
        type: "run.blocked",
        at: "22:42",
        actor: "harness",
        nodeId: "prove",
        artifact: "proof/proof.json",
        message: "Cannot mark done: proof/proof.json is missing.",
        status: "blocked",
      },
    ],
  },
  {
    id: "RUN-1043",
    title: "Codex connector spike",
    task: "Prototype file/event bridge for Codex app runs without making this product an IDE.",
    repo: "nickcarmonadigital/valdris-sdlc-harness",
    branch: "main",
    lane: "connector-runtime",
    agent: "codex",
    status: "running",
    risk: "low",
    currentNodeId: "implement",
    createdAt: "2026-06-18T22:51:00.000Z",
    updatedAt: "2026-06-18T22:59:00.000Z",
    approvals: [],
    artifacts: baseArtifacts.map((artifact) => ({
      ...artifact,
      present: ["run/intake.json", "run/route.json", "rca/rca.json", "design/anchors.json"].includes(artifact.path),
    })),
    events: [
      {
        id: "evt-a",
        type: "run.created",
        at: "22:51",
        actor: "human",
        nodeId: "intake",
        artifact: "run/intake.json",
        message: "Connector spike run opened.",
        status: "ok",
      },
      {
        id: "evt-b",
        type: "agent.connected",
        at: "22:53",
        actor: "codex",
        nodeId: "route",
        artifact: "run/route.json",
        message: "Codex connector route selected.",
        status: "ok",
      },
      {
        id: "evt-c",
        type: "node.entered",
        at: "22:59",
        actor: "codex",
        nodeId: "implement",
        artifact: "session/events.jsonl",
        message: "Codex runtime is active; app is only observing the run.",
        status: "ok",
      },
    ],
  },
];

const nextByNode: Record<string, string | undefined> = {
  intake: "route",
  route: "investigate",
  investigate: "design",
  design: "implement",
  implement: "redzone",
  redzone: "prove",
  prove: "handoff",
  handoff: undefined,
};

export function nextNodeId(currentNodeId: string): string | undefined {
  return nextByNode[currentNodeId];
}

export function artifactForNode(nodeId: string): string {
  return workflowNodes.find((node) => node.id === nodeId)?.requiredArtifact ?? "run/unknown.json";
}

export function labelForAgent(agent: AgentRuntime): string {
  return agent === "claude-code" ? "Claude Code" : agent === "codex" ? "Codex" : "Hermes";
}

export function computeNodeState(run: AppRun, nodeId: string): "waiting" | "active" | "passed" | "blocked" | "approval" {
  if (run.currentNodeId === nodeId && run.status === "blocked") return "blocked";
  if (run.currentNodeId === nodeId && run.status === "approval") return "approval";
  if (run.currentNodeId === nodeId && run.status !== "complete") return "active";
  const artifact = artifactForNode(nodeId);
  const present = run.artifacts.some((item) => item.path === artifact && item.present);
  if (present) return "passed";
  return "waiting";
}

export function missingArtifacts(run: AppRun): RunArtifact[] {
  return run.artifacts.filter((artifact) => artifact.required && !artifact.present);
}

export function createEvent(run: AppRun, type: AppEventType, nodeId: string, message: string, status: AppEvent["status"] = "ok"): AppEvent {
  const artifact = artifactForNode(nodeId);
  return {
    id: `${run.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    actor: type.includes("approval") ? "human" : type === "gate.fired" || type === "run.blocked" || type === "run.completed" ? "harness" : run.agent,
    nodeId,
    artifact,
    message,
    status,
  };
}
