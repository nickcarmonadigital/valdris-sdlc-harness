export type AgentRuntime = "claude-code" | "codex" | "hermes";
export type RunStatus = "queued" | "running" | "blocked" | "approval" | "complete";
export type RiskLevel = "low" | "medium" | "red-zone";
export type RunMode = "blueprint" | "live" | "replay";
export type EventSource = "static-blueprint" | "browser-local" | "bridge" | "mcp" | "api" | "watched-artifact" | "local-jsonl" | "database" | "run-packet";

export type AppEventType =
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
  | "self_heal.pr_opened"
  | "self_heal.pr_proposed";

export type AppEventStatus = "ok" | "warn" | "blocked" | "skipped" | "failed" | "needs_approval" | "passed";
export type NodeTerminalState = "passed" | "active" | "failed" | "skipped" | "pending" | "needs_approval";

export type AppEvent = {
  id: string;
  type: AppEventType;
  at: string;
  actor: AgentRuntime | "human" | "harness" | "system";
  nodeId: string;
  artifact?: string;
  message: string;
  status: AppEventStatus;
  runMode?: RunMode;
  eventSource?: EventSource;
  nodeState?: NodeTerminalState;
  skipReason?: string;
  failureReason?: string;
  recoveryPath?: string;
  approvalOwner?: string;
  approvalScope?: string;
  selfHealPrUrl?: string;
};

export type RunArtifact = {
  path: string;
  label: string;
  required: boolean;
  present: boolean;
  skipped?: boolean;
  skipReason?: string;
  failed?: boolean;
  failureReason?: string;
  recoveryPath?: string;
  verification?: {
    checked?: boolean;
    exists?: boolean;
    source?: string;
    path?: string;
    realPath?: string;
    size?: number;
    mtimeMs?: number;
  };
};

export type ApprovalRecord = {
  scope: string;
  owner: string;
  status: "pending" | "granted" | "denied";
  nodeId?: string;
  eventId?: string;
  updatedAt?: string;
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
  mode: RunMode;
  eventSource: EventSource;
  currentNodeId: string;
  createdAt: string;
  updatedAt: string;
  artifacts: RunArtifact[];
  approvals: Array<string | ApprovalRecord>;
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
    description: "Capture ask, repo, runtime, risk, environment, and work type.",
    requiredArtifact: "run/intake.json",
    x: 4,
    y: 8,
  },
  {
    id: "route",
    label: "Route",
    lane: "harness",
    description: "Choose lane family, source of truth, gate set, and run packet.",
    requiredArtifact: "run/route.json",
    x: 22,
    y: 8,
  },
  {
    id: "system-design",
    label: "System Design",
    lane: "design",
    description: "Capture requirements, constraints, API/data/failure tradeoffs, and ADR needs.",
    requiredArtifact: "design/system_design.md",
    x: 40,
    y: 8,
  },
  {
    id: "production-readiness",
    label: "Production Layers",
    lane: "production",
    description: "Classify the 13 production-readiness layers as required or skipped with reasons.",
    requiredArtifact: "production/layer-assessment.json",
    x: 58,
    y: 8,
  },
  {
    id: "cloud-platform",
    label: "Cloud / Platform",
    lane: "platform",
    description: "Service map, IAM/secrets, networking, IaC/deploy, observability, cost, rollback.",
    requiredArtifact: "cloud/service-map.json",
    x: 76,
    y: 8,
  },
  {
    id: "implement",
    label: "Implement",
    lane: "runtime",
    description: "Claude Code/Codex/Hermes works in its own runtime while emitting events.",
    requiredArtifact: "session/events.jsonl",
    x: 76,
    y: 43,
  },
  {
    id: "redzone",
    label: "Red Zone",
    lane: "control",
    description: "Pause for high-risk deploy, provider, auth, data, billing, or destructive actions.",
    requiredArtifact: "approvals/redzone.json",
    x: 58,
    y: 43,
  },
  {
    id: "qa-break-it",
    label: "Break-it QA",
    lane: "qa",
    description: "Try edge cases, malformed input, auth boundaries, provider failures, concurrency.",
    requiredArtifact: "qa/break-it-results.md",
    x: 40,
    y: 43,
  },
  {
    id: "prove",
    label: "Proof Gate",
    lane: "validation",
    description: "Run validation commands and attach proof before done can pass.",
    requiredArtifact: "proof/proof.json",
    x: 22,
    y: 43,
  },
  {
    id: "live-smoke",
    label: "Live Smoke",
    lane: "release",
    description: "Prove changed route/API/job/provider/voice path in target environment when required.",
    requiredArtifact: "smoke/smoke_proof.json",
    x: 4,
    y: 43,
  },
  {
    id: "self-heal",
    label: "Self-Heal",
    lane: "learn",
    description: "If the harness/process failed, create a self-heal artifact and PR path.",
    requiredArtifact: "self_heal/self_heal_report.md",
    x: 4,
    y: 70,
  },
  {
    id: "handoff",
    label: "Handoff",
    lane: "ship",
    description: "Answer Contract, evidence packet, skipped nodes, risks, and next decision.",
    requiredArtifact: "handoff/final.md",
    x: 22,
    y: 70,
  },
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

export const baseArtifacts: RunArtifact[] = workflowNodes.map((node) => ({
  path: node.requiredArtifact,
  label: node.label,
  required: true,
  present: node.id === "intake",
}));

export const demoRuns: AppRun[] = [
  {
    id: "RUN-2042",
    title: "Production readiness pack merge",
    task: "Merge the 13-layer production readiness pack, system design, QA/break-it, and self-healing into the universal harness model.",
    repo: "nickcarmonadigital/valdris-sdlc-harness",
    branch: "main",
    lane: "production-readiness",
    agent: "claude-code",
    status: "blocked",
    risk: "medium",
    mode: "replay",
    eventSource: "local-jsonl",
    currentNodeId: "qa-break-it",
    createdAt: "2026-06-22T22:31:00.000Z",
    updatedAt: "2026-06-22T22:42:00.000Z",
    approvals: [],
    artifacts: baseArtifacts.map((artifact) => ({
      ...artifact,
      present: [
        "run/intake.json",
        "run/route.json",
        "design/system_design.md",
        "production/layer-assessment.json",
        "session/events.jsonl",
      ].includes(artifact.path),
      skipped: artifact.path === "cloud/service-map.json",
      skipReason: artifact.path === "cloud/service-map.json" ? "No cloud resource, secret, IAM, network, deploy, or provider setting changed in this docs/model run." : undefined,
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
        runMode: "replay",
        eventSource: "local-jsonl",
      },
      {
        id: "evt-2",
        type: "run.mode_set",
        at: "22:32",
        actor: "harness",
        nodeId: "route",
        artifact: "run/route.json",
        message: "Mode is Replay: historical seed data, not fake live telemetry.",
        status: "ok",
        runMode: "replay",
        eventSource: "local-jsonl",
      },
      {
        id: "evt-3",
        type: "artifact.written",
        at: "22:35",
        actor: "claude-code",
        nodeId: "system-design",
        artifact: "design/system_design.md",
        message: "System design lane captured SDLC-as-parent taxonomy and ADR trigger rules.",
        status: "ok",
      },
      {
        id: "evt-4",
        type: "artifact.written",
        at: "22:38",
        actor: "claude-code",
        nodeId: "production-readiness",
        artifact: "production/layer-assessment.json",
        message: "Production Readiness Layer Pack classified frontend/backend/data/auth/cloud/ops/recovery surfaces.",
        status: "ok",
      },
      {
        id: "evt-5",
        type: "node.skipped",
        at: "22:40",
        actor: "harness",
        nodeId: "cloud-platform",
        artifact: "cloud/skip.json",
        message: "Cloud/platform node skipped with explicit reason.",
        status: "skipped",
        skipReason: "No deploy, cloud resource, secret, IAM, network, or provider setting changed.",
        nodeState: "skipped",
      },
      {
        id: "evt-6",
        type: "node.failed",
        at: "22:42",
        actor: "harness",
        nodeId: "qa-break-it",
        artifact: "qa/break-it-results.md",
        message: "Break-it QA artifact missing; finish-line remains blocked.",
        status: "failed",
        failureReason: "qa/break-it-results.md has not been written for the update run.",
        recoveryPath: "Run break-it checklist against docs/UI copy, attach results, then rerun finish-line.",
        nodeState: "failed",
      },
    ],
  },
  {
    id: "RUN-2043",
    title: "AWS deploy lane approval",
    task: "Prototype AWS/cloud platform lane checks for service maps, IAM/secrets, observability, cost, rollback, and live smoke.",
    repo: "nickcarmonadigital/valdris-sdlc-harness",
    branch: "main",
    lane: "cloud-platform",
    agent: "codex",
    status: "approval",
    risk: "red-zone",
    mode: "blueprint",
    eventSource: "static-blueprint",
    currentNodeId: "redzone",
    createdAt: "2026-06-22T22:51:00.000Z",
    updatedAt: "2026-06-22T22:59:00.000Z",
    approvals: [],
    artifacts: baseArtifacts.map((artifact) => ({
      ...artifact,
      present: ["run/intake.json", "run/route.json", "design/system_design.md", "production/layer-assessment.json", "cloud/service-map.json", "session/events.jsonl"].includes(artifact.path),
    })),
    events: [
      {
        id: "evt-a",
        type: "run.created",
        at: "22:51",
        actor: "human",
        nodeId: "intake",
        artifact: "run/intake.json",
        message: "Cloud/platform blueprint run opened.",
        status: "ok",
        runMode: "blueprint",
        eventSource: "static-blueprint",
      },
      {
        id: "evt-b",
        type: "artifact.written",
        at: "22:53",
        actor: "codex",
        nodeId: "cloud-platform",
        artifact: "cloud/service-map.json",
        message: "AWS service map node lists IAM/secrets, networking, deploy, observability, cost, and rollback checks.",
        status: "ok",
      },
      {
        id: "evt-c",
        type: "approval.requested",
        at: "22:59",
        actor: "harness",
        nodeId: "redzone",
        artifact: "approvals/redzone.json",
        message: "Red Zone approval required before production deploy or cloud mutation.",
        status: "needs_approval",
        approvalOwner: "primary human/operator",
        approvalScope: "cloud resource mutation / deploy",
        nodeState: "needs_approval",
      },
    ],
  },
];

const nextByNode: Record<string, string | undefined> = Object.fromEntries(
  workflowEdges.map(([from, to]) => [from, to]),
);
nextByNode.handoff = undefined;

export function nextNodeId(currentNodeId: string): string | undefined {
  return nextByNode[currentNodeId];
}

export function artifactForNode(nodeId: string): string {
  return workflowNodes.find((node) => node.id === nodeId)?.requiredArtifact ?? "run/unknown.json";
}

export function nodeIdForArtifact(path: string): string | undefined {
  return workflowNodes.find((node) => node.requiredArtifact === path)?.id;
}

export function labelForAgent(agent: AgentRuntime): string {
  return agent === "claude-code" ? "Claude Code" : agent === "codex" ? "Codex" : "Hermes";
}

export function hasGrantedApproval(run: AppRun, scope: string): boolean {
  return run.approvals.some((approval) =>
    typeof approval === "string" ? approval === scope : approval.scope === scope && approval.status === "granted",
  );
}

export function addGrantedApproval(run: AppRun, scope: string, owner = "human"): Array<string | ApprovalRecord> {
  if (hasGrantedApproval(run, scope)) return run.approvals;
  return [...run.approvals, { scope, owner, status: "granted", updatedAt: new Date().toISOString() }];
}

export function computeNodeState(run: AppRun, nodeId: string): "waiting" | "active" | "passed" | "blocked" | "approval" | "skipped" | "failed" {
  const artifact = artifactForNode(nodeId);
  const item = run.artifacts.find((artifactItem) => artifactItem.path === artifact);
  if (item?.failed) return "failed";
  if (item?.skipped) return "skipped";
  if (run.currentNodeId === nodeId && run.status === "blocked") return "blocked";
  if (run.currentNodeId === nodeId && run.status === "approval") return "approval";
  if (run.currentNodeId === nodeId && run.status !== "complete") return "active";
  if (item?.present) return "passed";
  return "waiting";
}

export function missingArtifacts(run: AppRun): RunArtifact[] {
  return run.artifacts.filter((artifact) => artifact.required && !artifact.present && !artifact.skipped);
}

export function createEvent(
  run: AppRun,
  type: AppEventType,
  nodeId: string,
  message: string,
  status: AppEventStatus = "ok",
  extra: Partial<AppEvent> = {},
): AppEvent {
  const artifact = extra.artifact ?? artifactForNode(nodeId);
  return {
    id: `${run.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    actor: extra.actor ?? run.agent,
    nodeId,
    artifact,
    message,
    status,
    runMode: run.mode,
    eventSource: run.eventSource,
    nodeState: extra.nodeState,
    skipReason: extra.skipReason,
    failureReason: extra.failureReason,
    recoveryPath: extra.recoveryPath,
    approvalOwner: extra.approvalOwner,
    approvalScope: extra.approvalScope,
    selfHealPrUrl: extra.selfHealPrUrl,
  };
}
