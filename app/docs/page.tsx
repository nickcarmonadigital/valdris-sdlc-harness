const docs = [
  ["SDLC Lane Taxonomy", "v0.2 parent/child taxonomy: SDLC backbone, system design, cloud/platform, QA, self-heal."],
  ["Production Readiness Layer Pack", "The 13 real full-stack layers as required/skipped harness checks."],
  ["Cloud / Platform Engineering", "AWS/cloud service maps, IAM/secrets, deploy proof, rollback, observability, cost risk."],
  ["QA, Live Smoke, and Self-Healing", "Normal QA, let's-break-it QA, live smoke, and self-healing PR loop."],
  ["Blueprint / Live Run / Replay Modes", "No fake telemetry: static topology, real connector events, and historical replay stay separate."],
  ["Product Direction", "Connector-first, not-an-IDE product correction."],
  ["Connector Model", "Codex, Claude Code, and Hermes adapter contract."],
  ["Claude Code Connector", "Local bridge + slash-command path for real Claude Code runs."],
  ["Connector Event Contract", "The shared runtime-event schema that powers the visual board."],
  ["Visual Flow UI", "Left-side workflow telemetry / n8n-style run visualizer."],
  ["On-Prem Run Visualizer", "Filesystem JSONL adapter for local/private installs without Supabase."],
  ["Architecture", "Vercel UI + workflow engine + local runner shape."],
  ["Clean-Room Notes", "Public-source boundary and implementation rules."],
];

export default function DocsPage() {
  return (
    <main className="docsPage">
      <a className="backLink" href="/">← Back to run visual</a>
      <p className="eyebrow">Docs-first MVP</p>
      <h1>Build the connector control plane before the full app.</h1>
      <p className="lede">
        These docs define the v0.2 product correction: SDLC stays the parent backbone, production readiness becomes a lane pack,
        cloud/platform work gets first-class gates, QA includes break-it/live-smoke proof, and Blueprint/Live/Replay modes prevent fake telemetry.
      </p>
      <section className="docsGrid">
        {docs.map(([title, copy]) => (
          <article className="connectorCard" key={title}>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
