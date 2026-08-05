import type { Metadata } from "next";
import "./docs.css";

export const metadata: Metadata = {
  title: {
    default: "Valdris SDLC Harness Documentation",
    template: "%s | Valdris SDLC Harness",
  },
  description:
    "Documentation for the Valdris repository-level SDLC assurance harness for AI coding agents.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="docsSite">
      <header className="docsTopbar">
        <a
          className="docsBrand"
          href="/docs"
          aria-label="Valdris documentation home"
        >
          <span className="docsBrandMark" aria-hidden="true">
            V
          </span>
          <span>
            <strong>VALDRIS</strong>
            <small>SDLC Harness</small>
          </span>
        </a>
        <nav aria-label="Documentation navigation">
          <a href="/docs#lifecycle">Lifecycle</a>
          <a href="/docs#work-types">Work types</a>
          <a href="/docs/assurance">Assurance</a>
          <a href="/docs/glossary">Glossary</a>
        </nav>
        <div className="docsTopbarActions">
          <a href="/">Run visual</a>
          <a
            className="docsTopbarPrimary"
            href="https://github.com/nickcarmonadigital/valdris-sdlc-harness"
          >
            GitHub
          </a>
        </div>
      </header>
      {children}
      <footer className="docsFooter">
        <div>
          <a className="docsBrand" href="/docs">
            <span className="docsBrandMark" aria-hidden="true">
              V
            </span>
            <span>
              <strong>VALDRIS</strong>
              <small>Proof before completion</small>
            </span>
          </a>
          <p>A repository-level SDLC assurance harness for AI coding agents.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="/docs/getting-started">Getting started</a>
          <a href="/docs/assurance">Assurance model</a>
          <a href="/docs/glossary">Controlled terminology</a>
          <a href="https://github.com/nickcarmonadigital/valdris-sdlc-harness">
            Source repository
          </a>
        </nav>
      </footer>
    </div>
  );
}
