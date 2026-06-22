export type NodeStatus = "done" | "active" | "blocked" | "skipped" | "pending" | "warning";

export type HarnessNode = {
  id: string;
  label: string;
  layer: string;
  kind: "input" | "scan" | "adapter" | "runtime" | "router" | "skill" | "gate" | "artifact" | "human";
  description: string;
  artifact: string;
  owner: string;
  tools: string[];
  whyItExists: string;
  recovery: string;
};

export type Scenario = {
  id: string;
  label: string;
  workType: "bug" | "feature" | "refactor" | "docs";
  subtitle: string;
  activeNodeId: string;
  nodeStates: Record<string, NodeStatus>;
  reasons: Record<string, string>;
  events: Array<{
    at: string;
    type: string;
    nodeId: string;
    message: string;
    status: NodeStatus;
    artifact?: string;
  }>;
};

export const flowLayers = [
  "Commission",
  "Front door",
  "Route + skills",
  "Build + gates",
  "Ship + learn",
] as const;

export const harnessNodes: HarnessNode[] = [
  {
    id: "commission",
    label: "Commissioning interview",
    layer: "Commission",
    kind: "input",
    description: "Ask the human/operator how this repo works, who approves risk, how answers should look, and what production means.",
    artifact: "project-adapter.json",
    owner: "human + harness",
    tools: ["commission-harness.mjs", "question bank"],
    whyItExists: "Graphify can infer code structure, but it cannot know team authority, source-of-truth order, answer style, or Red Zone boundaries.",
    recovery: "If answers are missing or stale, pause and re-run commissioning before letting an agent touch the repo.",
  },
  {
    id: "repo-scan",
    label: "Repo scan",
    layer: "Commission",
    kind: "scan",
    description: "Detect package manager, frameworks, validation commands, repo role, and obvious workflow files.",
    artifact: "adapter.detected",
    owner: "harness scanner",
    tools: ["package.json", "pyproject.toml", ".github/workflows", "Dockerfiles"],
    whyItExists: "The harness should prefill what machines can know so the human only answers what code cannot reveal.",
    recovery: "If detection is wrong, edit the adapter and mark that field as human-confirmed.",
  },
  {
    id: "graphify",
    label: "Graphify blast-radius scan",
    layer: "Commission",
    kind: "scan",
    description: "Build or refresh the code graph before architecture claims, risky refactors, or code-path debugging.",
    artifact: "graph/graph.json + design/anchors.json",
    owner: "Graphify adapter",
    tools: ["Graphify", "code graph", "get_neighbors", "shortest_path"],
    whyItExists: "This is the map layer: where code lives, what calls it, and what could break if the agent edits it.",
    recovery: "If Graphify is stale or unavailable, the run must say so and fall back to pinned code citations instead of pretending the graph was used.",
  },
  {
    id: "adapter",
    label: "Project adapter generated",
    layer: "Commission",
    kind: "adapter",
    description: "Write the local laws of the repo: source truth, lanes, validation, Red Zone, branch/deploy, and answer contract.",
    artifact: "project.yaml",
    owner: "harness generator",
    tools: ["project-adapter.json", "project.yaml"],
    whyItExists: "Universal core stays stable; the adapter makes it specific enough that Claude/Codex cannot freelance.",
    recovery: "Adapter drift routes to a self-healing correction: update the adapter with evidence and rerun coherence checks.",
  },
  {
    id: "front-door",
    label: "Agent front door installed",
    layer: "Front door",
    kind: "runtime",
    description: "Generate AGENTS.md / CLAUDE.md / command templates so Claude Code, Codex, or Hermes enters through the harness.",
    artifact: "AGENTS.md + CLAUDE.md",
    owner: "connector installer",
    tools: ["AGENTS.md", "CLAUDE.md", "valdris-sdlc-harness command"],
    whyItExists: "The agent starts with the flow, not with a vague prompt. This is the door into the operating system.",
    recovery: "If the front door is missing, the run starts blocked until the generated instructions are installed or pasted.",
  },
  {
    id: "run-start",
    label: "Run packet opened",
    layer: "Front door",
    kind: "artifact",
    description: "Create a durable record for the task, selected repo, branch, lane, runtime, risk, events, and artifacts.",
    artifact: "runs/<id>/run.json",
    owner: "control plane",
    tools: ["localStorage demo", "JSONL bridge", "future DB"],
    whyItExists: "A run is not a chat. It is an auditable object with state, proof, approvals, and handoff.",
    recovery: "If no run packet exists, the app cannot honestly visualize completion; create or recover the packet first.",
  },
  {
    id: "intake",
    label: "01 Intake",
    layer: "Front door",
    kind: "router",
    description: "Capture task, repo, branch, affected users, environment, screenshots/logs, risk, and work type.",
    artifact: "run/intake.json",
    owner: "agent + human",
    tools: ["intake form", "issue import", "chat prompt"],
    whyItExists: "Most misses start here: wrong repo, wrong branch, wrong risk, or unclear symptom.",
    recovery: "Ask only for the missing field that changes routing; otherwise continue with explicit assumptions.",
  },
  {
    id: "classify",
    label: "Classify work type",
    layer: "Route + skills",
    kind: "router",
    description: "Decide whether this is bug, feature, refactor, docs/process, incident, data, infra, provider, or security work.",
    artifact: "run/route.json",
    owner: "router",
    tools: ["CONTEXT.md", "lane table"],
    whyItExists: "Bug, feature, and refactor work require different proof. The wrong path causes skipped evidence or overbuilt planning.",
    recovery: "If classification is ambiguous, show both candidate paths and ask for the one decision that changes execution.",
  },
  {
    id: "skill-selector",
    label: "Skill selector",
    layer: "Route + skills",
    kind: "skill",
    description: "Load the right Matt Pocock-style skill pack / workflow pack for the work type.",
    artifact: "run/skills.json",
    owner: "harness router",
    tools: ["/debug", "/grill-with-docs", "/to-prd", "/improve-codebase-architecture"],
    whyItExists: "The visual should show not just the lane, but which skill procedure was actually used and why others were skipped.",
    recovery: "If a needed skill was not loaded, mark the run as missing-procedure and loop back before implementation.",
  },
  {
    id: "debug-skill",
    label: "Bug path: /debug",
    layer: "Route + skills",
    kind: "skill",
    description: "Reproduce, minimize, instrument, and form hypotheses without claiming cause too early.",
    artifact: "debug/repro.md",
    owner: "Claude/Codex runtime",
    tools: ["/debug", "logs", "tests", "instrumentation"],
    whyItExists: "Bug fixes need the failing behavior shown, not a plausible static-code story.",
    recovery: "If reproduction fails, record UNKNOWN instead of inventing a cause and route to evidence collection.",
  },
  {
    id: "rca-gate",
    label: "RCA evidence gate",
    layer: "Route + skills",
    kind: "gate",
    description: "Cause is blocked until runtime evidence ties the failing path to the symptom.",
    artifact: "rca/rca.json",
    owner: "harness gate",
    tools: ["rca_gate.py", "runtime logs", "request IDs"],
    whyItExists: "No evidence means hypothesis, not cause. The visual should show exactly where a cause claim is blocked.",
    recovery: "Attach re-runnable telemetry or downgrade the claim back to HYPOTHESIS.",
  },
  {
    id: "grill-skill",
    label: "Feature path: /grill-with-docs",
    layer: "Route + skills",
    kind: "skill",
    description: "Interrogate the feature, edge cases, terms, product assumptions, and hard-to-reverse decisions.",
    artifact: "product/questions.md",
    owner: "planning runtime",
    tools: ["/grill-with-docs", "project glossary", "decision prompts"],
    whyItExists: "New behavior needs a spec before code. This prevents agents from building the first fuzzy interpretation.",
    recovery: "Unresolved questions become explicit blocking decisions instead of hidden assumptions.",
  },
  {
    id: "prd-skill",
    label: "Feature path: /to-prd + ADR",
    layer: "Route + skills",
    kind: "skill",
    description: "Convert resolved decisions into PRD, acceptance criteria, tests, and architecture decision records.",
    artifact: "design/prd.md + docs/adr/*.md",
    owner: "planning runtime",
    tools: ["/to-prd", "ADR template", "acceptance tests"],
    whyItExists: "The harness should show whether feature work has a real spec or is just vibes with code.",
    recovery: "If a hard-to-reverse decision appears without ADR, block implementation until it is captured.",
  },
  {
    id: "refactor-skill",
    label: "Refactor path: architecture skill",
    layer: "Route + skills",
    kind: "skill",
    description: "Use architecture-improvement workflow for shape changes that should not change behavior.",
    artifact: "design/refactor-plan.md",
    owner: "architecture runtime",
    tools: ["/improve-codebase-architecture", "Graphify", "behavior lock tests"],
    whyItExists: "Refactors are not features. The proof is behavior preservation plus cleaner structure.",
    recovery: "If behavior changes, reclassify as feature/bug and require the appropriate gate.",
  },
  {
    id: "design-anchors",
    label: "Design anchors",
    layer: "Build + gates",
    kind: "artifact",
    description: "Pin cited code paths, blast radius, acceptance criteria, and relevant graph nodes before editing.",
    artifact: "design/anchors.json",
    owner: "agent + graph adapter",
    tools: ["anchor_gate.py", "Graphify", "git show"],
    whyItExists: "A design built on stale code is worse than no design. Anchors make freshness visible.",
    recovery: "If anchors drift, re-read current code and update the plan before implementation resumes.",
  },
  {
    id: "implement",
    label: "External runtime implements",
    layer: "Build + gates",
    kind: "runtime",
    description: "Claude Code, Codex, or Hermes edits in its own environment while the harness watches events and artifacts.",
    artifact: "session/events.jsonl",
    owner: "coding-agent runtime",
    tools: ["Claude Code", "Codex", "Hermes", "local bridge"],
    whyItExists: "The product is not an IDE. The code work stays in the agent tool; this app monitors the workflow boundary.",
    recovery: "If events stop, the run becomes telemetry-stale and needs manual sync or connector repair.",
  },
  {
    id: "redzone-gate",
    label: "Red Zone gate",
    layer: "Build + gates",
    kind: "gate",
    description: "Pause before production, deploy, auth, billing, secrets, provider config, destructive data, or other risky writes.",
    artifact: "approvals/redzone.json",
    owner: "human approver",
    tools: ["redzone_gate.py", "approval token", "adapter policy"],
    whyItExists: "This is where the human stays in control. If no Red Zone applies, the node is skipped with a visible reason.",
    recovery: "Record approval, narrow the action, or reroute to a read-only alternative.",
  },
  {
    id: "proof-gate",
    label: "Proof gate",
    layer: "Build + gates",
    kind: "gate",
    description: "Run the real validation commands and hash logs into proof artifacts.",
    artifact: "proof/proof.json",
    owner: "harness gate",
    tools: ["proof_gate.py", "lint", "typecheck", "test", "build", "evals"],
    whyItExists: "The model cannot just say tests passed. The run must have a proof object that can be re-verified.",
    recovery: "Fix failing command, rerun proof, or mark the run blocked with the exact failed command.",
  },
  {
    id: "review-gate",
    label: "Review gate",
    layer: "Build + gates",
    kind: "gate",
    description: "Independent review checks spec compliance, code quality, safety, and whether proof matches the claim.",
    artifact: "review/review.json",
    owner: "reviewer agent + human",
    tools: ["review_gate.py", "diff review", "security checklist"],
    whyItExists: "Coder should not be the only grader. The app should show that review happened or why it was skipped.",
    recovery: "Route blockers back to implementation; minor issues become explicit follow-ups.",
  },
  {
    id: "staging-smoke",
    label: "Staging / live smoke",
    layer: "Ship + learn",
    kind: "gate",
    description: "Prove behavior in the environment local tests cannot fully simulate.",
    artifact: "smoke/smoke_proof.json",
    owner: "harness + human",
    tools: ["smoke_gate.py", "deploy_verify.py", "browser pass"],
    whyItExists: "Some failures only appear after deploy, provider, worker, browser, or integration wiring.",
    recovery: "If not needed, require a skip reason. If failing, show failed smoke and block promotion.",
  },
  {
    id: "handoff",
    label: "Answer Contract handoff",
    layer: "Ship + learn",
    kind: "human",
    description: "Return the decision packet: bottom line, why, proof, fix/plan, your call, and any skipped steps.",
    artifact: "handoff/final.md",
    owner: "agent + operator",
    tools: ["Answer Contract", "Linear/GitHub note", "run summary"],
    whyItExists: "The user sees the conclusion and evidence, not the detective story.",
    recovery: "If proof or decisions are missing, handoff remains draft and finish-line check blocks completion.",
  },
  {
    id: "finish-line",
    label: "Finish-line check",
    layer: "Ship + learn",
    kind: "gate",
    description: "Final validator confirms all required nodes are done or explicitly skipped with reasons.",
    artifact: "finish/finish_line.json",
    owner: "harness gate",
    tools: ["finish_line_gate.py", "artifact ledger", "skip ledger"],
    whyItExists: "This is the n8n-style no-missed-node guarantee: every node is pass, fail, pending, or skipped with reason.",
    recovery: "Click the failed/missing node, repair it, or add a justified skip reason before calling done.",
  },
];

const bugDone = [
  "commission",
  "repo-scan",
  "graphify",
  "adapter",
  "front-door",
  "run-start",
  "intake",
  "classify",
  "skill-selector",
  "debug-skill",
  "rca-gate",
  "design-anchors",
  "implement",
];

const featureDone = [
  "commission",
  "repo-scan",
  "graphify",
  "adapter",
  "front-door",
  "run-start",
  "intake",
  "classify",
  "skill-selector",
  "grill-skill",
];

const refactorDone = [
  "commission",
  "repo-scan",
  "graphify",
  "adapter",
  "front-door",
  "run-start",
  "intake",
  "classify",
  "skill-selector",
];

const docsDone = [
  "commission",
  "repo-scan",
  "adapter",
  "front-door",
  "run-start",
  "intake",
  "classify",
  "skill-selector",
  "design-anchors",
  "implement",
  "proof-gate",
  "review-gate",
];

function stateMap(done: string[], extra: Record<string, NodeStatus>) {
  return Object.fromEntries([...done.map((id) => [id, "done"] as const), ...Object.entries(extra)]);
}

export const scenarios: Scenario[] = [
  {
    id: "bug-proof-fail",
    label: "Bug run: proof failed",
    workType: "bug",
    subtitle: "Shows a normal bug path using Graphify, /debug, RCA evidence, then blocking at proof/proof.json.",
    activeNodeId: "proof-gate",
    nodeStates: stateMap(bugDone, {
      "grill-skill": "skipped",
      "prd-skill": "skipped",
      "refactor-skill": "skipped",
      "redzone-gate": "skipped",
      "proof-gate": "blocked",
      "review-gate": "pending",
      "staging-smoke": "pending",
      handoff: "pending",
      "finish-line": "pending",
    }),
    reasons: {
      "grill-skill": "Skipped because this is a bug fix, not new behavior. The needed procedure is /debug + RCA evidence.",
      "prd-skill": "Skipped because no new feature/API/product behavior is being specified.",
      "refactor-skill": "Skipped because this is not a behavior-preserving architecture refactor.",
      "redzone-gate": "Skipped: adapter says no production, secrets, billing, auth, deploy, or customer-data mutation in this run.",
      "proof-gate": "Failed: proof/proof.json is missing because the declared test command did not pass. Finish-line remains blocked.",
    },
    events: [
      { at: "09:00", type: "run.created", nodeId: "run-start", message: "Run packet opened from Claude Code prompt.", status: "done", artifact: "runs/RUN-2291/run.json" },
      { at: "09:03", type: "graphify.scan", nodeId: "graphify", message: "Graphify identified touched symbols and blast radius before debugging.", status: "done", artifact: "graph/graph.json" },
      { at: "09:09", type: "skill.loaded", nodeId: "debug-skill", message: "/debug loaded because intake classified the work as BUG.", status: "done", artifact: "debug/repro.md" },
      { at: "09:15", type: "gate.passed", nodeId: "rca-gate", message: "Runtime evidence tied request_id to the failing path.", status: "done", artifact: "rca/rca.json" },
      { at: "09:31", type: "gate.blocked", nodeId: "proof-gate", message: "Finish blocked: test command failed, proof/proof.json not PASS.", status: "blocked", artifact: "proof/proof.json" },
    ],
  },
  {
    id: "feature-spec-active",
    label: "Feature run: spec still active",
    workType: "feature",
    subtitle: "Shows /grill-with-docs, /to-prd + ADR, and Red Zone waiting before implementation.",
    activeNodeId: "prd-skill",
    nodeStates: stateMap(featureDone, {
      "debug-skill": "skipped",
      "rca-gate": "skipped",
      "prd-skill": "active",
      "refactor-skill": "skipped",
      "design-anchors": "pending",
      implement: "pending",
      "redzone-gate": "warning",
      "proof-gate": "pending",
      "review-gate": "pending",
      "staging-smoke": "pending",
      handoff: "pending",
      "finish-line": "pending",
    }),
    reasons: {
      "debug-skill": "Skipped because the work is new behavior, not a reproduced regression.",
      "rca-gate": "Skipped because no root-cause claim is being made.",
      "refactor-skill": "Skipped because this is building new behavior, not only changing internal shape.",
      "redzone-gate": "Warning: feature touches provider/auth config. Approval will be required before mutation.",
      "prd-skill": "Active: unresolved acceptance criteria and ADRs must be written before code starts.",
    },
    events: [
      { at: "10:12", type: "run.created", nodeId: "run-start", message: "Feature request opened from app intake.", status: "done", artifact: "run/intake.json" },
      { at: "10:17", type: "skill.loaded", nodeId: "grill-skill", message: "/grill-with-docs asked edge-case and terminology questions.", status: "done", artifact: "product/questions.md" },
      { at: "10:23", type: "artifact.pending", nodeId: "prd-skill", message: "PRD and ADR still active; implementation is not allowed yet.", status: "active", artifact: "design/prd.md" },
      { at: "10:24", type: "approval.forecast", nodeId: "redzone-gate", message: "Potential Red Zone: provider/auth surface flagged for later approval.", status: "warning", artifact: "approvals/redzone.json" },
    ],
  },
  {
    id: "refactor-graph-active",
    label: "Refactor run: graph active",
    workType: "refactor",
    subtitle: "Shows architecture refactor using Graphify and behavior lock before implementation.",
    activeNodeId: "refactor-skill",
    nodeStates: stateMap(refactorDone, {
      "debug-skill": "skipped",
      "rca-gate": "skipped",
      "grill-skill": "skipped",
      "prd-skill": "skipped",
      "refactor-skill": "active",
      "design-anchors": "pending",
      implement: "pending",
      "redzone-gate": "skipped",
      "proof-gate": "pending",
      "review-gate": "pending",
      "staging-smoke": "pending",
      handoff: "pending",
      "finish-line": "pending",
    }),
    reasons: {
      "debug-skill": "Skipped because no bug symptom is being diagnosed.",
      "rca-gate": "Skipped because no incident/cause claim is in scope.",
      "grill-skill": "Skipped because no net-new user behavior is being introduced.",
      "prd-skill": "Skipped because this is behavior-preserving refactor work.",
      "redzone-gate": "Skipped for now: adapter says planned edits are local code only. It reopens if deploy/provider/data actions appear.",
      "refactor-skill": "Active: Graphify hotspot and behavior-lock test set are being built before code movement.",
    },
    events: [
      { at: "13:42", type: "graphify.scan", nodeId: "graphify", message: "Graphify found callers/callees for the module being split.", status: "done", artifact: "graph/graph.json" },
      { at: "13:49", type: "skill.loaded", nodeId: "refactor-skill", message: "/improve-codebase-architecture loaded for shape-not-behavior work.", status: "active", artifact: "design/refactor-plan.md" },
      { at: "13:51", type: "skip.recorded", nodeId: "grill-skill", message: "Feature planning skipped with explicit reason: no new behavior.", status: "skipped" },
    ],
  },
  {
    id: "docs-only-skip-ledger",
    label: "Docs-only run: skips visible",
    workType: "docs",
    subtitle: "Shows the skip ledger: Graphify, Red Zone, staging smoke, and skill branches skipped for explicit reasons.",
    activeNodeId: "handoff",
    nodeStates: stateMap(docsDone, {
      graphify: "skipped",
      "debug-skill": "skipped",
      "rca-gate": "skipped",
      "grill-skill": "skipped",
      "prd-skill": "skipped",
      "refactor-skill": "skipped",
      "redzone-gate": "skipped",
      "staging-smoke": "skipped",
      handoff: "active",
      "finish-line": "pending",
    }),
    reasons: {
      graphify: "Skipped because this docs-only run makes no code-path or architecture claim. If code claims appear, Graphify reopens.",
      "debug-skill": "Skipped because no failing behavior is being diagnosed.",
      "rca-gate": "Skipped because no root-cause claim is being made.",
      "grill-skill": "Skipped because this is stable documentation, not a feature spec.",
      "prd-skill": "Skipped because no product behavior is being introduced.",
      "refactor-skill": "Skipped because no code shape is changing.",
      "redzone-gate": "Skipped because this is a local docs edit, no risky mutation.",
      "staging-smoke": "Skipped because no deployed runtime behavior changed. The skip reason is visible in finish-line review.",
      handoff: "Active: final answer must list skipped nodes and why so the operator can audit the path.",
    },
    events: [
      { at: "15:02", type: "run.created", nodeId: "run-start", message: "Docs-only harness map update started.", status: "done", artifact: "run/intake.json" },
      { at: "15:05", type: "skip.recorded", nodeId: "graphify", message: "Graphify skipped: no code or architecture claim in scope.", status: "skipped" },
      { at: "15:17", type: "gate.passed", nodeId: "proof-gate", message: "Docs build/typecheck passed; proof object present.", status: "done", artifact: "proof/proof.json" },
      { at: "15:19", type: "skip.recorded", nodeId: "staging-smoke", message: "Staging smoke skipped: no deployed behavior changed.", status: "skipped", artifact: "smoke/skip.json" },
    ],
  },
];

export function getScenarioNodeStatus(scenario: Scenario, nodeId: string): NodeStatus {
  return scenario.nodeStates[nodeId] ?? "pending";
}

export function getScenarioNodeReason(scenario: Scenario, node: HarnessNode): string {
  return scenario.reasons[node.id] ?? node.whyItExists;
}

export function nodesForLayer(layer: string) {
  return harnessNodes.filter((node) => node.layer === layer);
}
