# Connector Model

## Principle

The harness is a **runtime adapter and control plane**, not the coding interface.

Users already have agent surfaces they like:

- Codex application/account
- Claude Code
- Hermes
- local terminal agents

The harness connects to those surfaces, starts/observes sessions, and enforces workflow artifacts.

## Adapter contract v0

Every connector should implement:

```ts
type AgentConnector = {
  id: string;
  displayName: string;
  capabilities: ConnectorCapability[];
  prepareContext(input: ProjectHarnessPack): Promise<PreparedContext>;
  startSession(input: AgentSessionStart): Promise<AgentSessionHandle>;
  streamEvents(handle: AgentSessionHandle): AsyncIterable<AgentEvent>;
  requestStop(handle: AgentSessionHandle): Promise<void>;
};
```

## Event types

```ts
type AgentEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "stage.changed"; stageId: string; status: string }
  | { type: "tool.called"; toolName: string; argsSummary: string }
  | { type: "artifact.written"; path: string; artifactType: string }
  | { type: "gate.passed"; gateId: string; artifactPath: string }
  | { type: "gate.blocked"; gateId: string; reason: string }
  | { type: "human.approval.requested"; approvalId: string; risk: string }
  | { type: "diff.changed"; files: string[] }
  | { type: "session.completed"; summary: string };
```

## Codex connector

Initial assumption:

- Generate `AGENTS.md` / context pack.
- Launch Codex CLI/app session where available.
- Watch filesystem events and gate artifact paths.
- Stream logs/diffs/proofs to the UI.

## Claude Code connector

Initial assumption:

- Generate `CLAUDE.md` and conditional instruction blocks.
- Launch Claude Code from the task worktree.
- Watch artifacts, transcript/export logs where available, and git diff.

## Hermes connector

Reference implementation:

- Use Hermes Kanban board/task.
- Use Hermes tools/subagents/processes.
- Capture run packet artifacts directly.
- Works first because we control this environment.
