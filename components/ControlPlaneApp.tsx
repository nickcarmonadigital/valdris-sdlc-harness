"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  artifactForNode,
  baseArtifacts,
  computeNodeState,
  createEvent,
  demoRuns,
  labelForAgent,
  missingArtifacts,
  nextNodeId,
  type AgentRuntime,
  type AppRun,
  type RiskLevel,
  workflowEdges,
  workflowNodes,
} from "../lib/control-plane";

const STORAGE_KEY = "uash.control-plane.runs.v1";
const BRIDGE_URL = "http://127.0.0.1:8787";
const lanes = ["engineering-default", "agent-runtime", "connector-runtime", "support-triage", "incidents", "data-supabase"];

const nodeById = Object.fromEntries(workflowNodes.map((node) => [node.id, node]));

function makeRunId() {
  return `RUN-${Math.floor(1000 + Math.random() * 9000)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeParseRuns(raw: string | null): AppRun[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppRun[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function ControlPlaneApp() {
  const [runs, setRuns] = useState<AppRun[]>(demoRuns);
  const [selectedRunId, setSelectedRunId] = useState(demoRuns[0]?.id ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<"unknown" | "connected" | "offline">("unknown");
  const [bridgeMessage, setBridgeMessage] = useState("Bridge not checked yet.");
  const [bridgePolling, setBridgePolling] = useState(false);
  const [form, setForm] = useState({
    title: "",
    task: "",
    repo: "nickcarmonadigital/valdris-sdlc-harness",
    branch: "main",
    lane: "connector-runtime",
    agent: "claude-code" as AgentRuntime,
    risk: "medium" as RiskLevel,
  });

  useEffect(() => {
    const restored = safeParseRuns(window.localStorage.getItem(STORAGE_KEY));
    if (restored) {
      setRuns(restored);
      setSelectedRunId(restored[0]?.id ?? "");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  }, [runs]);

  useEffect(() => {
    if (!bridgePolling || !selectedRunId) return;
    const interval = window.setInterval(() => {
      void pullSelectedFromBridge(false);
    }, 2000);
    return () => window.clearInterval(interval);
  }, [bridgePolling, selectedRunId]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? runs[0], [runs, selectedRunId]);
  const missing = selectedRun ? missingArtifacts(selectedRun) : [];
  const stats = useMemo(
    () => ({
      total: runs.length,
      running: runs.filter((run) => ["running", "approval"].includes(run.status)).length,
      blocked: runs.filter((run) => run.status === "blocked").length,
      artifacts: runs.reduce((sum, run) => sum + run.artifacts.filter((artifact) => artifact.present).length, 0),
    }),
    [runs],
  );

  function updateSelected(mutator: (run: AppRun) => AppRun) {
    if (!selectedRun) return;
    setRuns((current) => current.map((run) => (run.id === selectedRun.id ? mutator(run) : run)));
  }

  function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = makeRunId();
    const createdAt = nowIso();
    const run: AppRun = {
      id,
      title: form.title.trim() || "Untitled agent run",
      task: form.task.trim() || "No task provided yet.",
      repo: form.repo.trim() || "local/on-prem repo",
      branch: form.branch.trim() || "main",
      lane: form.lane,
      agent: form.agent,
      status: "queued",
      risk: form.risk,
      currentNodeId: "intake",
      createdAt,
      updatedAt: createdAt,
      approvals: [],
      artifacts: baseArtifacts.map((artifact) => ({ ...artifact, present: artifact.path === "run/intake.json" })),
      events: [
        {
          id: `${id}-created`,
          type: "run.created",
          at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          actor: "human",
          nodeId: "intake",
          artifact: "run/intake.json",
          message: "Run created from the control-plane intake form.",
          status: "ok",
        },
      ],
    };

    setRuns((current) => [run, ...current]);
    setSelectedRunId(id);
    setShowCreate(false);
    setForm((current) => ({ ...current, title: "", task: "" }));
  }

  function advanceRun() {
    updateSelected((run) => {
      const next = nextNodeId(run.currentNodeId);
      if (!next) {
        return run;
      }

      const artifact = artifactForNode(next);
      const isRedZonePause = next === "redzone" && run.risk === "red-zone" && !run.approvals.includes("redzone");
      const type = isRedZonePause
        ? "approval.requested"
        : next === "investigate" || next === "prove" || next === "redzone"
          ? "gate.fired"
          : next === "handoff"
            ? "run.completed"
            : "node.entered";
      const status = isRedZonePause ? "warn" : "ok";
      const message = isRedZonePause
        ? "Red Zone pause: human approval required before continuing."
        : next === "handoff"
          ? "Handoff node entered. Complete only if every required artifact is present."
          : `${labelForAgent(run.agent)} moved into ${nodeById[next].label}.`;

      return {
        ...run,
        currentNodeId: next,
        status: isRedZonePause ? "approval" : next === "handoff" ? "running" : "running",
        updatedAt: nowIso(),
        artifacts: run.artifacts.map((item) => (item.path === artifact && next !== "prove" && next !== "handoff" ? { ...item, present: true } : item)),
        events: [...run.events, createEvent(run, type, next, message, status)],
      };
    });
  }

  function writeCurrentArtifact() {
    updateSelected((run) => {
      const artifact = artifactForNode(run.currentNodeId);
      return {
        ...run,
        status: run.status === "blocked" ? "running" : run.status,
        updatedAt: nowIso(),
        artifacts: run.artifacts.map((item) => (item.path === artifact ? { ...item, present: true } : item)),
        events: [...run.events, createEvent(run, "artifact.written", run.currentNodeId, `${artifact} written and observed by the app.`)],
      };
    });
  }

  function approveRedZone() {
    updateSelected((run) => ({
      ...run,
      status: "running",
      approvals: Array.from(new Set([...run.approvals, "redzone"])),
      updatedAt: nowIso(),
      artifacts: run.artifacts.map((item) => (item.path === "approvals/redzone.json" ? { ...item, present: true } : item)),
      events: [...run.events, createEvent(run, "approval.granted", "redzone", "Human approval granted for Red Zone stage.")],
    }));
  }

  function finishRun() {
    updateSelected((run) => {
      const absent = missingArtifacts(run);
      if (absent.length) {
        return {
          ...run,
          status: "blocked",
          currentNodeId: absent[0]?.path === "proof/proof.json" ? "prove" : run.currentNodeId,
          updatedAt: nowIso(),
          events: [
            ...run.events,
            createEvent(run, "run.blocked", absent[0]?.path === "proof/proof.json" ? "prove" : run.currentNodeId, `Cannot complete: missing ${absent.map((item) => item.path).join(", ")}.`, "blocked"),
          ],
        };
      }

      return {
        ...run,
        status: "complete",
        currentNodeId: "handoff",
        updatedAt: nowIso(),
        events: [...run.events, createEvent(run, "run.completed", "handoff", "All required artifacts are present. Answer Contract can be produced.")],
      };
    });
  }

  function resetDemo() {
    setRuns(demoRuns);
    setSelectedRunId(demoRuns[0]?.id ?? "");
  }

  function upsertRunFromBridge(run: AppRun) {
    setRuns((current) => {
      const exists = current.some((item) => item.id === run.id);
      return exists ? current.map((item) => (item.id === run.id ? run : item)) : [run, ...current];
    });
    setSelectedRunId(run.id);
  }

  async function checkBridge() {
    try {
      const response = await fetch(`${BRIDGE_URL}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { service?: string; dataDir?: string };
      setBridgeStatus("connected");
      setBridgeMessage(`${payload.service ?? "uash bridge"} online · ${payload.dataDir ?? BRIDGE_URL}`);
    } catch (error) {
      setBridgeStatus("offline");
      setBridgePolling(false);
      setBridgeMessage(`Bridge offline at ${BRIDGE_URL}. Start it with npm run bridge:claude.`);
    }
  }

  async function syncSelectedToBridge() {
    if (!selectedRun) return;
    try {
      const response = await fetch(`${BRIDGE_URL}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectedRun),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setBridgeStatus("connected");
      setBridgeMessage(`${selectedRun.id} synced to local bridge. Claude Code can now emit events into it.`);
    } catch {
      setBridgeStatus("offline");
      setBridgePolling(false);
      setBridgeMessage(`Could not sync to ${BRIDGE_URL}. Run npm run bridge:claude on the Mac first.`);
    }
  }

  async function pullSelectedFromBridge(showNotice = true) {
    if (!selectedRun) return;
    try {
      const response = await fetch(`${BRIDGE_URL}/runs/${encodeURIComponent(selectedRun.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const run = (await response.json()) as AppRun;
      upsertRunFromBridge(run);
      setBridgeStatus("connected");
      if (showNotice) setBridgeMessage(`${run.id} pulled from local bridge with ${run.events.length} event(s).`);
    } catch {
      setBridgeStatus("offline");
      setBridgePolling(false);
      if (showNotice) setBridgeMessage(`No local bridge run found for ${selectedRun.id}. Sync it first, then run Claude Code.`);
    }
  }

  async function copyClaudePrompt() {
    if (!selectedRun) return;
    const prompt = `Use the Valdris SDLC Harness for this run.\n\nRUN_ID=${selectedRun.id}\nBRIDGE_URL=${BRIDGE_URL}\nREPO=${selectedRun.repo}\nBRANCH=${selectedRun.branch}\nLANE=${selectedRun.lane}\nAGENT=${labelForAgent(selectedRun.agent)}\n\nTask:\n${selectedRun.task}\n\nRules:\n1. Do not shortcut the harness.\n2. Before each stage, emit a bridge event.\n3. Write or name each required artifact path.\n4. If a Red Zone action appears, stop and request approval.\n5. Finish only after proof/proof.json exists and passes.\n\nEmit examples from the project root that contains the connector scripts:\nnode scripts/uash-emit-event.mjs ${selectedRun.id} agent.connected route "Claude Code attached to the Valdris SDLC Harness run" --artifact run/route.json --status ok --actor claude-code\nnode scripts/uash-emit-event.mjs ${selectedRun.id} gate.fired investigate "RCA gate fired; gathering runtime evidence before cause" --artifact rca/rca.json --status ok --actor harness\nnode scripts/uash-emit-event.mjs ${selectedRun.id} artifact.written design "Design anchors written" --artifact design/anchors.json --status ok --actor claude-code\nnode scripts/uash-emit-event.mjs ${selectedRun.id} approval.requested redzone "Red Zone approval required" --artifact approvals/redzone.json --status warn --actor harness\nnode scripts/uash-emit-event.mjs ${selectedRun.id} run.blocked prove "Missing proof/proof.json" --artifact proof/proof.json --status blocked --actor harness\n\nNow start at Intake, route the lane, and continue node by node.`;
    await navigator.clipboard.writeText(prompt);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1400);
  }

  async function copyExport() {
    if (!selectedRun) return;
    await navigator.clipboard.writeText(JSON.stringify(selectedRun, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (!selectedRun) {
    return <main className="appShell">No runs available.</main>;
  }

  const selectedNode = nodeById[selectedRun.currentNodeId];

  return (
    <main className="appShell">
      <aside className="appSidebar">
        <div className="brandBlock">
          <span className="brandMark">UH</span>
          <div>
            <strong>Universal Harness</strong>
            <small>Agent control plane</small>
          </div>
        </div>

        <button className="newRunButton" onClick={() => setShowCreate(true)} type="button">
          + New run
        </button>

        <nav className="sideNav" aria-label="App sections">
          <a className="active" href="#runs">Runs</a>
          <a href="#board">Board</a>
          <a href="#artifacts">Artifacts</a>
          <a href="#connectors">Connectors</a>
        </nav>

        <section className="runList" id="runs">
          <div className="sidebarLabel">Run queue</div>
          {runs.map((run) => (
            <button className={`runListItem ${run.id === selectedRun.id ? "selected" : ""}`} key={run.id} onClick={() => setSelectedRunId(run.id)} type="button">
              <span>{run.id}</span>
              <strong>{run.title}</strong>
              <small>{run.status} · {labelForAgent(run.agent)}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="appMain">
        <header className="appHeader">
          <div>
            <p className="eyebrow">Legit app mode · local-first v0</p>
            <h1>Agentic SDLC Control Plane</h1>
            <p>Operate runs, connectors, gates, artifacts, approvals, and the workflow graph. This is the app surface — not a marketing page.</p>
          </div>
          <div className="headerActions">
            <span className="modePill">No Supabase</span>
            <span className="modePill">Browser + JSONL</span>
            <a className="ghostButton" href="/docs">Docs</a>
          </div>
        </header>

        <section className="metricGrid" aria-label="Run metrics">
          <article><span>Total runs</span><strong>{stats.total}</strong></article>
          <article><span>Running</span><strong>{stats.running}</strong></article>
          <article><span>Blocked</span><strong>{stats.blocked}</strong></article>
          <article><span>Artifacts seen</span><strong>{stats.artifacts}</strong></article>
        </section>

        {showCreate ? (
          <section className="createPanel" aria-label="Create run">
            <div>
              <p className="eyebrow">Create run</p>
              <h2>Start a harness-controlled agent run</h2>
            </div>
            <form onSubmit={createRun}>
              <label>
                Title
                <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Fix billing webhook bug" />
              </label>
              <label>
                Task
                <textarea value={form.task} onChange={(event) => setForm((current) => ({ ...current, task: event.target.value }))} placeholder="Describe the actual work the agent should do" />
              </label>
              <div className="formGrid">
                <label>
                  Repo
                  <input value={form.repo} onChange={(event) => setForm((current) => ({ ...current, repo: event.target.value }))} />
                </label>
                <label>
                  Branch
                  <input value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))} />
                </label>
                <label>
                  Agent
                  <select value={form.agent} onChange={(event) => setForm((current) => ({ ...current, agent: event.target.value as AgentRuntime }))}>
                    <option value="claude-code">Claude Code</option>
                    <option value="codex">Codex</option>
                    <option value="hermes">Hermes</option>
                  </select>
                </label>
                <label>
                  Lane
                  <select value={form.lane} onChange={(event) => setForm((current) => ({ ...current, lane: event.target.value }))}>
                    {lanes.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
                  </select>
                </label>
                <label>
                  Risk
                  <select value={form.risk} onChange={(event) => setForm((current) => ({ ...current, risk: event.target.value as RiskLevel }))}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="red-zone">red-zone</option>
                  </select>
                </label>
              </div>
              <div className="formActions">
                <button className="primaryButton" type="submit">Create run</button>
                <button className="ghostButton" onClick={() => setShowCreate(false)} type="button">Cancel</button>
              </div>
            </form>
          </section>
        ) : null}

        <section className="workspaceGrid">
          <article className="runDetailPanel">
            <div className="panelHeader big">
              <div>
                <span className={`statusDot ${selectedRun.status}`} />
                <p className="eyebrow">Selected run</p>
                <h2>{selectedRun.title}</h2>
              </div>
              <span className="runBadge">{selectedRun.id}</span>
            </div>
            <p className="taskText">{selectedRun.task}</p>
            <div className="detailRows">
              <span>Repo <b>{selectedRun.repo}</b></span>
              <span>Branch <b>{selectedRun.branch}</b></span>
              <span>Lane <b>{selectedRun.lane}</b></span>
              <span>Agent <b>{labelForAgent(selectedRun.agent)}</b></span>
            </div>
            <div className="actionBar">
              <button className="primaryButton" onClick={advanceRun} type="button">Advance stage</button>
              <button className="secondaryButton" onClick={writeCurrentArtifact} type="button">Write current artifact</button>
              <button className="secondaryButton" onClick={approveRedZone} type="button">Approve Red Zone</button>
              <button className="dangerButton" onClick={finishRun} type="button">Finish-line check</button>
            </div>
          </article>

          <article className="inspectorPanel">
            <div className="panelHeader">
              <span className="tinyLabel">Current node</span>
              <strong>{selectedNode.label}</strong>
            </div>
            <p>{selectedNode.description}</p>
            <code>{selectedNode.requiredArtifact}</code>
            <div className="missingBox">
              <span>{missing.length ? "Missing required artifacts" : "All required artifacts present"}</span>
              <strong>{missing.length}</strong>
            </div>
          </article>
        </section>

        <section className="visualWorkspace" id="board">
          <div className="canvasHeader appCanvasHeader">
            <div>
              <span className="tinyLabel">Workflow board</span>
              <strong>{selectedRun.id} · {selectedRun.lane}</strong>
            </div>
            <div className="signalPills">
              <span>{labelForAgent(selectedRun.agent)}</span>
              <span>{selectedRun.status}</span>
              <span>{selectedRun.risk}</span>
            </div>
          </div>
          <div className="workflowCanvas appCanvas">
            <svg className="edgeLayer" viewBox="0 0 100 78" preserveAspectRatio="none" aria-hidden="true">
              {workflowEdges.map(([from, to]) => {
                const start = nodeById[from];
                const end = nodeById[to];
                const midX = (start.x + end.x) / 2;
                return <path d={`M ${start.x + 8} ${start.y + 5} C ${midX} ${start.y + 5}, ${midX} ${end.y + 5}, ${end.x + 8} ${end.y + 5}`} key={`${from}-${to}`} />;
              })}
            </svg>
            {workflowNodes.map((node) => (
              <article className={`graphNode appGraphNode ${computeNodeState(selectedRun, node.id)}`} key={node.id} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
                <div className="graphNodeTop">
                  <span>{node.lane}</span>
                  <b>{computeNodeState(selectedRun, node.id)}</b>
                </div>
                <h3>{node.label}</h3>
                <p>{node.description}</p>
                <code>{node.requiredArtifact}</code>
              </article>
            ))}
            <div className={`agentToken ${selectedRun.agent}`} style={{ left: `calc(${selectedNode.x}% + 32px)`, top: `calc(${selectedNode.y}% - 20px)` }}>
              <span>{selectedRun.agent === "claude-code" ? "C" : selectedRun.agent === "codex" ? "X" : "H"}</span>
            </div>
          </div>
        </section>

        <section className="lowerGrid">
          <article className="artifactPanel" id="artifacts">
            <div className="panelHeader">
              <span className="tinyLabel">Gate artifacts</span>
              <strong>{selectedRun.artifacts.filter((artifact) => artifact.present).length}/{selectedRun.artifacts.length}</strong>
            </div>
            <div className="artifactRows">
              {selectedRun.artifacts.map((artifact) => (
                <div className={`artifactRow ${artifact.present ? "present" : "missing"}`} key={artifact.path}>
                  <span>{artifact.present ? "✓" : "×"}</span>
                  <code>{artifact.path}</code>
                  <small>{artifact.label}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="eventPanel">
            <div className="panelHeader">
              <span className="tinyLabel">Event stream</span>
              <strong>{selectedRun.events.length} events</strong>
            </div>
            <div className="eventList appEventList">
              {selectedRun.events.slice().reverse().map((event) => (
                <div className={`eventRow ${event.status}`} key={event.id}>
                  <span>{event.at}</span>
                  <div>
                    <b>{event.type}</b>
                    <p>{event.message}</p>
                    {event.artifact ? <code>{event.artifact}</code> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="connectorPanel" id="connectors">
            <div className="panelHeader">
              <span className="tinyLabel">Connector bridge</span>
              <strong className={`bridgeState ${bridgeStatus}`}>{bridgeStatus}</strong>
            </div>
            <p>Connect Claude Code through a tiny local bridge on your Mac. The Vercel app can talk to localhost from your browser, so no Supabase is needed for the first real connector loop.</p>
            <div className="bridgeMessage">{bridgeMessage}</div>
            <pre>{`# Terminal 1, on your Mac
npm run bridge:claude

# Terminal 2, inside Claude Code / your repo
node scripts/uash-emit-event.mjs ${selectedRun.id} node.entered investigate "entered investigate" --artifact rca/rca.json --actor claude-code`}</pre>
            <div className="formActions">
              <button className="secondaryButton" onClick={checkBridge} type="button">Check bridge</button>
              <button className="secondaryButton" onClick={syncSelectedToBridge} type="button">Sync run to bridge</button>
              <button className="secondaryButton" onClick={() => pullSelectedFromBridge()} type="button">Pull latest</button>
              <button className="secondaryButton" onClick={() => setBridgePolling((value) => !value)} type="button">{bridgePolling ? "Stop polling" : "Poll bridge"}</button>
              <button className="secondaryButton" onClick={copyClaudePrompt} type="button">{promptCopied ? "Prompt copied" : "Copy Claude prompt"}</button>
              <button className="secondaryButton" onClick={copyExport} type="button">{copied ? "Copied" : "Copy run JSON"}</button>
              <button className="ghostButton" onClick={resetDemo} type="button">Reset demo state</button>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
