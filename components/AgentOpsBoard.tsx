"use client";

import { useEffect, useMemo, useState } from "react";
import {
  demoRunEvents,
  latestNodeForAgent,
  reduceNodeStates,
  type AgentRuntime,
  type RunEvent,
  workflowEdges,
  workflowNodes,
} from "../lib/run-events";

const actorLabels: Record<AgentRuntime, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
};

const actorMarks: Record<AgentRuntime, string> = {
  "claude-code": "C",
  codex: "X",
  hermes: "H",
};

export function AgentOpsBoard() {
  const [events, setEvents] = useState<RunEvent[]>(demoRunEvents);
  const [visibleCount, setVisibleCount] = useState(5);

  useEffect(() => {
    const poll = async () => {
      try {
        const response = await fetch("/api/runs/demo/events", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { events?: RunEvent[] };
        if (payload.events?.length) {
          setEvents(payload.events);
        }
      } catch {
        // The Vercel preview can run purely from bundled demo data. On-prem installs can add the API/file bridge.
      }
    };

    poll();
    const poller = window.setInterval(poll, 2500);
    return () => window.clearInterval(poller);
  }, []);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setVisibleCount((count) => (count >= events.length ? 4 : count + 1));
    }, 1500);
    return () => window.clearInterval(ticker);
  }, [events.length]);

  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);
  const nodeStates = useMemo(() => reduceNodeStates(visibleEvents), [visibleEvents]);
  const nodeById = useMemo(() => Object.fromEntries(workflowNodes.map((node) => [node.id, node])), []);
  const agents: AgentRuntime[] = ["claude-code", "codex", "hermes"];
  const artifacts = visibleEvents.filter((event) => event.artifact);

  return (
    <section className="agentOpsSection" aria-label="Agent operations visualizer">
      <div className="sectionHeading">
        <p className="eyebrow">Miro / n8n style run board</p>
        <h2>Watch coding agents move through the harness instead of building another IDE.</h2>
        <p>
          Claude Code, Codex, or Hermes keeps doing the code work in its own runtime. This board is the visual control plane: nodes, gate state, artifacts, and human pauses.
        </p>
      </div>

      <div className="opsBoard">
        <div className="canvasHeader">
          <div>
            <span className="tinyLabel">Run</span>
            <strong>BUGFIX-visual-control-plane</strong>
          </div>
          <div className="signalPills" aria-label="Runtime connectors">
            {agents.map((agent) => (
              <span key={agent}>{actorLabels[agent]}</span>
            ))}
          </div>
        </div>

        <div className="workflowCanvas">
          <svg className="edgeLayer" viewBox="0 0 100 78" preserveAspectRatio="none" aria-hidden="true">
            {workflowEdges.map(([from, to]) => {
              const start = nodeById[from];
              const end = nodeById[to];
              const midX = (start.x + end.x) / 2;
              return (
                <path
                  d={`M ${start.x + 8} ${start.y + 5} C ${midX} ${start.y + 5}, ${midX} ${end.y + 5}, ${end.x + 8} ${end.y + 5}`}
                  key={`${from}-${to}`}
                />
              );
            })}
          </svg>

          {workflowNodes.map((node) => (
            <article className={`graphNode ${nodeStates[node.id]}`} key={node.id} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
              <div className="graphNodeTop">
                <span>{node.lane}</span>
                <b>{nodeStates[node.id]}</b>
              </div>
              <h3>{node.shortLabel}</h3>
              <p>{node.label}</p>
              <code>{node.artifact}</code>
            </article>
          ))}

          {agents.map((agent, index) => {
            const nodeId = latestNodeForAgent(visibleEvents, agent) ?? "intake";
            const node = nodeById[nodeId];
            return (
              <div
                className={`agentToken ${agent}`}
                key={agent}
                style={{ left: `calc(${node.x}% + ${20 + index * 24}px)`, top: `calc(${node.y}% - 18px)` }}
                title={actorLabels[agent]}
              >
                <span>{actorMarks[agent]}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="opsGrid">
        <article className="eventStream">
          <div className="panelHeader">
            <span className="tinyLabel">Live event stream</span>
            <strong>{visibleEvents.length}/{events.length} events</strong>
          </div>
          <div className="eventList">
            {visibleEvents.slice(-6).map((event) => (
              <div className={`eventRow ${event.status ?? "ok"}`} key={event.id}>
                <span>{event.ts}</span>
                <div>
                  <b>{event.type}</b>
                  <p>{event.message}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="artifactLedger">
          <div className="panelHeader">
            <span className="tinyLabel">Artifact ledger</span>
            <strong>No Supabase required for v0</strong>
          </div>
          <p>
            On-prem connector writes JSONL events and gate artifacts to the run packet. Vercel can render the visual board; local installs can persist to filesystem.
          </p>
          <ul>
            {artifacts.slice(-5).map((event) => (
              <li key={`${event.id}-${event.artifact}`}>
                <code>{event.artifact}</code>
                <span>{event.status === "blocked" ? "missing / blocks done" : "observed"}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
