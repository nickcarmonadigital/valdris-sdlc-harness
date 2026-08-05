import type { Metadata } from "next";
import { controlledTerms, ontologyTerms } from "../../../lib/docs-catalog";

export const metadata: Metadata = {
  title: "Controlled Terminology",
  description:
    "The controlled public terminology and ontology definitions used by the Valdris SDLC Harness.",
};

export default function GlossaryPage() {
  return (
    <main className="docsReferencePage">
      <header className="docsReferenceHero">
        <p className="docsBreadcrumb">
          <a href="/docs">Docs</a> / glossary
        </p>
        <p className="docsKicker">Controlled terminology</p>
        <h1>One stable term for one meaning.</h1>
        <p>
          These terms describe the actual Valdris mechanism and its boundary.
          Branding does not prove a technical category.
        </p>
      </header>

      <section className="docsTermSection">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">Valdris vocabulary</p>
            <h2>Approved public and internal terms</h2>
          </div>
          <p>
            Status identifies whether a term is standard, emerging,
            vendor-specific, internal, contested, or uncertain. Usage identifies
            where the term belongs.
          </p>
        </div>
        <div className="docsTermList">
          {controlledTerms.map((term) => (
            <article key={term.term}>
              <div>
                <h3>{term.term}</h3>
                <p>{term.meaning}</p>
              </div>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{term.status}</dd>
                </div>
                <div>
                  <dt>Usage</dt>
                  <dd>{term.usage.replaceAll("_", " ")}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="docsTermSection docsOntologySection">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">Classification language</p>
            <h2>Do not use these terms as synonyms.</h2>
          </div>
          <p>
            Ontology defines available kinds. Taxonomy organizes categories.
            Classification applies criteria. Terminology names the result.
          </p>
        </div>
        <div className="docsOntologyGrid">
          {ontologyTerms.map((term) => (
            <article key={term.term}>
              <span>{term.status}</span>
              <h3>{term.term}</h3>
              <p>{term.meaning}</p>
            </article>
          ))}
        </div>
      </section>

      <aside className="docsConformanceNote">
        <strong>ASD-STE100 Issue 9 boundary</strong>
        <p>
          Valdris uses Issue 9 as the target authoring standard for technical
          and operational communication. Formal conformance is not verified
          unless the complete applicable writing rules and controlled dictionary
          are checked.
        </p>
      </aside>
    </main>
  );
}
