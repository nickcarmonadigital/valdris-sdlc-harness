const connectors = [
  {
    name: "Codex Connector",
    status: "Designing",
    copy: "Launches Codex with generated project context, tracks worktree/session events, and streams artifacts back to the harness.",
  },
  {
    name: "Claude Code Connector",
    status: "Designing",
    copy: "Generates CLAUDE.md + conditional instruction packs, then watches proof gates instead of becoming a competing IDE.",
  },
  {
    name: "Hermes Connector",
    status: "First-class",
    copy: "Uses Hermes Kanban, tools, subagents, and gateway channels as the reference execution backend.",
  },
];

export function ConnectorCards() {
  return (
    <section className="connectorGrid" aria-label="Connector cards">
      {connectors.map((connector) => (
        <article className="connectorCard" key={connector.name}>
          <div className="connectorTopline">
            <h3>{connector.name}</h3>
            <span>{connector.status}</span>
          </div>
          <p>{connector.copy}</p>
        </article>
      ))}
    </section>
  );
}
