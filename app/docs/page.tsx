const docs = [
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
        These docs define the product correction: connect to existing coding agents, show the harness flow visually, and make gate artifacts block completion.
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
