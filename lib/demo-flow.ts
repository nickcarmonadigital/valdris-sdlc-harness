export type FlowState = "complete" | "active" | "blocked" | "queued";

export type HarnessStep = {
  id: string;
  label: string;
  description: string;
  artifact: string;
  state: FlowState;
};

export const demoHarnessSteps: HarnessStep[] = [
  {
    id: "commission",
    label: "Commission",
    description: "Interview + repo scan generate the project adapter.",
    artifact: "project.yaml",
    state: "complete",
  },
  {
    id: "orient",
    label: "Orient",
    description: "Source-of-truth, branch model, Graphify freshness, lane route.",
    artifact: "run/orient.json",
    state: "complete",
  },
  {
    id: "investigate",
    label: "Investigate",
    description: "Evidence-first research before cause or code claims.",
    artifact: "research/research.md",
    state: "active",
  },
  {
    id: "design",
    label: "Design",
    description: "Plan, ADRs, code anchors, and reviewable artifacts.",
    artifact: "design/anchors.json",
    state: "queued",
  },
  {
    id: "implement",
    label: "Implement",
    description: "Connector launches Claude Code/Codex/Hermes in an isolated worktree.",
    artifact: "session/events.jsonl",
    state: "queued",
  },
  {
    id: "prove",
    label: "Prove",
    description: "Required gate files must exist before the run can be called done.",
    artifact: "proof/proof.json",
    state: "blocked",
  },
  {
    id: "ship",
    label: "Ship / Handoff",
    description: "Smoke/deploy proof and final Answer Contract packet.",
    artifact: "handoff/final.md",
    state: "queued",
  },
];
