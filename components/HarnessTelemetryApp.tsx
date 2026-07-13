"use client";

import { useMemo, useState } from "react";
import {
  flowLayers,
  getScenarioNodeReason,
  getScenarioNodeStatus,
  harnessNodes,
  nodesForLayer,
  scenarios,
  type HarnessNode,
  type NodeStatus,
} from "../lib/harness-telemetry";
import { productionLayers } from "../lib/control-plane";

const statusLabels: Record<NodeStatus, string> = {
  done: "passed",
  active: "active",
  blocked: "failed",
  skipped: "skipped",
  pending: "pending",
  warning: "needs approval",
};

const statusSymbols: Record<NodeStatus, string> = {
  done: "✓",
  active: "●",
  blocked: "!",
  skipped: "↷",
  pending: "·",
  warning: "△",
};

const layerProofById: Record<string, string> = {
  frontend: "screenshot, browser/e2e pass, route proof",
  "backend-api-logic": "API test, request/response proof, logs",
  "database-storage": "migration proof, rollback path, data sample",
  "auth-permissions-rls": "authz test, RLS proof, negative permission case",
  "hosting-deployment": "deploy log, URL, health check",
  "cloud-compute": "service map, CLI output, resource diff",
  "cicd-version-control": "workflow run, required check list",
  security: "threat note, secret scan, security checklist",
  "rate-limiting": "policy/config proof, load/edge-case note",
  "caching-cdn": "cache policy, invalidation proof, stale-data test",
  "load-balancing-scaling": "LB/health config, scaling policy, traffic proof",
  "error-tracking-logs-observability": "log/query/dashboard/alert proof",
  "availability-recovery-dr": "rollback plan, backup/restore note, RTO/RPO",
};

function nodeKindLabel(node: HarnessNode) {
  if (node.kind === "gate") return "enforced gate";
  if (node.kind === "skill") return "skill fired";
  if (node.kind === "scan") return "scan / map";
  if (node.kind === "runtime") return "runtime connector";
  return node.kind;
}

export function HarnessTelemetryApp() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const scenario = useMemo(() => scenarios.find((item) => item.id === scenarioId) ?? scenarios[0], [scenarioId]);
  const [selectedNodeId, setSelectedNodeId] = useState(scenario.activeNodeId);

  const selectedNode = useMemo(() => harnessNodes.find((node) => node.id === selectedNodeId) ?? harnessNodes[0], [selectedNodeId]);
  const selectedStatus = getScenarioNodeStatus(scenario, selectedNode.id);
  const selectedReason = getScenarioNodeReason(scenario, selectedNode);
  const productionStatus = getScenarioNodeStatus(scenario, "production-readiness");
  const productionReason = getScenarioNodeReason(scenario, harnessNodes.find((node) => node.id === "production-readiness") ?? selectedNode);
  const activeLayerIds = new Set(scenario.id === "v02-production-pack" ? ["frontend", "backend-api-logic", "cicd-version-control", "error-tracking-logs-observability"] : scenario.id === "v03-cloud-redzone" ? ["cloud-compute", "hosting-deployment", "security", "availability-recovery-dr"] : []);

  const metrics = useMemo(() => {
    const counts: Record<NodeStatus, number> = { done: 0, active: 0, blocked: 0, skipped: 0, pending: 0, warning: 0 };
    for (const node of harnessNodes) counts[getScenarioNodeStatus(scenario, node.id)] += 1;
    return counts;
  }, [scenario]);

  function switchScenario(id: string) {
    const next = scenarios.find((item) => item.id === id) ?? scenarios[0];
    setScenarioId(next.id);
    setSelectedNodeId(next.activeNodeId);
  }

  return (
    <main className="telemetryShell">
      <aside className="telemetrySidebar">
        <div className="brandBlock telemetryBrand">
          <span className="brandMark">V</span>
          <div>
            <strong>Valdris SDLC Harness</strong>
            <small>Visual flow monitor, not an IDE</small>
          </div>
        </div>

        <section className="scenarioList" aria-label="Run scenarios">
          <div className="sidebarLabel">Blueprint / demo / replay paths</div>
          {scenarios.map((item) => (
            <button
              className={`scenarioButton ${item.id === scenario.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => switchScenario(item.id)}
              type="button"
            >
              <span>{item.mode.toUpperCase()} · {item.workType.toUpperCase()}</span>
              <strong>{item.label}</strong>
              <small>{item.subtitle}</small>
            </button>
          ))}
        </section>

        <section className="visualLegend" aria-label="Status legend">
          <div className="sidebarLabel">Node state</div>
          {(Object.keys(statusLabels) as NodeStatus[]).map((status) => (
            <div className={`legendRow ${status}`} key={status}>
              <span>{statusSymbols[status]}</span>
              <b>{statusLabels[status]}</b>
            </div>
          ))}
        </section>

        <section className="sidebarNote">
          <p className="eyebrow">Core guarantee</p>
          <p>Every node must end as passed, failed, pending, needs approval, or skipped with a visible reason. No fake live telemetry.</p>
        </section>
      </aside>

      <section className="telemetryMain">
        <header className="telemetryHero">
          <div>
            <p className="eyebrow">N8N-style Flow Monitor · Blueprint / Demo / Live Run / Replay separated</p>
            <h1>Trace the full Agentic SDLC: system design, production layers, cloud/platform, QA, proof, and self-healing.</h1>
            <p>
              This visual layer shows the universal SDLC harness topology, bundled Demo seed scenarios, and real/historical run modes. Live Run only lights up from connector events; Blueprint is static; Replay is historical event data.
            </p>
          </div>
          <div className="heroCallout">
            <span>Selected path · {scenario.mode}</span>
            <strong>{scenario.label}</strong>
            <small>{scenario.subtitle}</small>
          </div>
        </header>

        <section className="telemetryMetrics" aria-label="Flow status metrics">
          <article><span>Passed</span><strong>{metrics.done}</strong></article>
          <article><span>Active</span><strong>{metrics.active}</strong></article>
          <article><span>Failed</span><strong>{metrics.blocked}</strong></article>
          <article><span>Skipped with reason</span><strong>{metrics.skipped}</strong></article>
          <article><span>Pending</span><strong>{metrics.pending}</strong></article>
        </section>

        <section className="flowMonitor" aria-label="Harness workflow monitor">
          <div className="flowMonitorHeader">
            <div>
              <span className="tinyLabel">{scenario.mode} topology</span>
              <strong>Commission → front door → route/design → production layers → gates → self-heal</strong>
            </div>
            <div className="signalPills">
              <span>Production layers visible</span>
              <span>Break-it QA visible</span>
              <span>Why skipped visible</span>
              <span>Failed node visible</span>
            </div>
          </div>

          <div className="swimlaneGrid">
            {flowLayers.map((layer) => (
              <section className="swimlane" key={layer}>
                <div className="swimlaneTitle">{layer}</div>
                <div className="nodeStack">
                  {nodesForLayer(layer).map((node) => {
                    const status = getScenarioNodeStatus(scenario, node.id);
                    const reason = getScenarioNodeReason(scenario, node);
                    return (
                      <button
                        className={`telemetryNode ${status} ${selectedNode.id === node.id ? "selected" : ""}`}
                        key={node.id}
                        onClick={() => setSelectedNodeId(node.id)}
                        type="button"
                      >
                        <div className="nodeTopline">
                          <span>{nodeKindLabel(node)}</span>
                          <b>{statusSymbols[status]} {statusLabels[status]}</b>
                        </div>
                        <strong>{node.label}</strong>
                        <p>{node.description}</p>
                        <code>{node.artifact}</code>
                        {(status === "skipped" || status === "blocked" || status === "warning") ? (
                          <small>{reason}</small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="telemetryPanels">
          <article className={`nodeInspector ${selectedStatus}`}>
            <div className="panelHeader big">
              <div>
                <span className="tinyLabel">Selected node inspector</span>
                <h2>{selectedNode.label}</h2>
              </div>
              <span className={`statusChip ${selectedStatus}`}>{statusSymbols[selectedStatus]} {statusLabels[selectedStatus]}</span>
            </div>
            <p>{selectedNode.description}</p>
            <div className="inspectorGrid">
              <span>Layer <b>{selectedNode.layer}</b></span>
              <span>Owner <b>{selectedNode.owner}</b></span>
              <span>Artifact <b>{selectedNode.artifact}</b></span>
              <span>Kind <b>{nodeKindLabel(selectedNode)}</b></span>
            </div>
            <div className="reasonBox">
              <h3>{selectedStatus === "skipped" ? "Why skipped" : selectedStatus === "blocked" ? "Why failed" : selectedStatus === "warning" ? "Why approval is forecast" : "Why this node exists"}</h3>
              <p>{selectedReason}</p>
            </div>
            <div className="reasonBox recovery">
              <h3>Repair / recovery path</h3>
              <p>{selectedNode.recovery}</p>
            </div>
            <div className="toolPills">
              {selectedNode.tools.map((tool) => <span key={tool}>{tool}</span>)}
            </div>
          </article>

          <article className="eventPanel richEventPanel">
            <div className="panelHeader">
              <span className="tinyLabel">Event stream</span>
              <strong>{scenario.events.length} events</strong>
            </div>
            <div className="eventList appEventList">
              {scenario.events.slice().reverse().map((event) => (
                <button className={`eventRow ${event.status}`} key={`${event.at}-${event.nodeId}-${event.type}`} onClick={() => setSelectedNodeId(event.nodeId)} type="button">
                  <span>{event.at}</span>
                  <div>
                    <b>{event.type}</b>
                    <p>{event.message}</p>
                    {event.artifact ? <code>{event.artifact}</code> : null}
                  </div>
                </button>
              ))}
            </div>
          </article>

          <article className="artifactPanel skipLedger">
            <div className="panelHeader">
              <span className="tinyLabel">Skip / fail ledger</span>
              <strong>audit trail</strong>
            </div>
            <div className="artifactRows">
              {harnessNodes
                .filter((node) => ["skipped", "blocked", "warning"].includes(getScenarioNodeStatus(scenario, node.id)))
                .map((node) => {
                  const status = getScenarioNodeStatus(scenario, node.id);
                  return (
                    <button className={`ledgerRow ${status}`} key={node.id} onClick={() => setSelectedNodeId(node.id)} type="button">
                      <span>{statusSymbols[status]}</span>
                      <div>
                        <b>{node.label}</b>
                        <p>{getScenarioNodeReason(scenario, node)}</p>
                      </div>
                    </button>
                  );
                })}
            </div>
          </article>
        </section>

        <section className="productionLayerMatrix" aria-label="13 production layer ledger">
          <div className="panelHeader">
            <span className="tinyLabel">13 production layers</span>
            <strong>{statusLabels[productionStatus]}</strong>
          </div>
          <div className="layerRows productionLayerRows">
            {productionLayers.map((layer) => {
              const active = activeLayerIds.has(layer.id);
              const status = productionStatus === "skipped" ? "skipped" : active ? "passed" : "skipped";
              return (
                <div className={`layerRow ${status}`} key={layer.id}>
                  <span>{status}</span>
                  <b>{layer.label}</b>
                  <small>{active ? layerProofById[layer.id] : productionReason}</small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="operatingModel">
          <article>
            <span>1</span>
            <h3>Mode labels prevent fake telemetry</h3>
            <p>Blueprint explains topology, Demo is bundled seed data, Live Run uses real connector events, and Replay plays durable run packets. The UI says which one you are seeing.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Production layers are first-class</h3>
            <p>Frontend, backend, DB, auth, hosting, cloud, CI/CD, security, rate limits, cache, scaling, logs, and recovery are classified per run.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Cloud/platform is not just code</h3>
            <p>AWS/Azure/GCP work requires service maps, IAM/secrets, networking, observability, cost risk, rollback, and live smoke proof.</p>
          </article>
          <article>
            <span>4</span>
            <h3>Finish-line checks the ledger</h3>
            <p>Done is only allowed when every required node is passed or intentionally skipped with a reason the operator can inspect; process gaps route to self-heal PRs.</p>
          </article>
        </section>
      </section>
    </main>
  );
}
