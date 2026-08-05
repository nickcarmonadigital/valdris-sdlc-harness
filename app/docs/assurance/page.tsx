import type { Metadata } from "next";
import { productionDomains, proofLevels } from "../../../lib/docs-catalog";

export const metadata: Metadata = {
  title: "Assurance Model",
  description:
    "Layer 0, the 13 production assurance domains, and the three Valdris proof levels.",
};

export default function AssurancePage() {
  return (
    <main className="docsReferencePage">
      <header className="docsReferenceHero">
        <p className="docsBreadcrumb">
          <a href="/docs">Docs</a> / assurance model
        </p>
        <p className="docsKicker">Assurance taxonomy</p>
        <h1>Foundation first. Production domains second.</h1>
        <p>
          Valdris resolves the product and proof foundation before
          implementation. It then classifies every production domain as
          required, potentially affected, or not applicable.
        </p>
      </header>

      <section className="docsLayerZero">
        <span>FOUNDATION</span>
        <div>
          <h2>Layer 0</h2>
          <p>
            Confirm the product goal, requirements, test plan, system boundary,
            data rules, owners, risks, and proof contract before implementation.
          </p>
        </div>
        <strong>Not a fourteenth production domain</strong>
      </section>

      <section className="docsDomainReference">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">13 production domains</p>
            <h2>Assess each domain explicitly.</h2>
          </div>
          <p>
            These are assurance categories. They are not thirteen literal
            runtime layers. A skipped domain requires a clear reason.
          </p>
        </div>
        <div className="docsDomainCards">
          {productionDomains.map((domain) => (
            <article key={domain.id}>
              <div className="docsCardTopline">
                <span>domain</span>
                <b>{String(domain.number).padStart(2, "0")}</b>
              </div>
              <h3>{domain.title}</h3>
              <p>{domain.summary}</p>
              <div className="docsCapabilityList">
                {domain.capabilities.map((capability) => (
                  <span key={capability.id}>{capability.title}</span>
                ))}
              </div>
              <small>{domain.controlCount} catalog controls</small>
            </article>
          ))}
        </div>
      </section>

      <section className="docsProofReference">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">Proof levels</p>
            <h2>Do not promote one proof level into another.</h2>
          </div>
          <p>
            A local file can prove structure. It cannot create outside provider
            authority or independently trusted execution.
          </p>
        </div>
        <div className="docsProofGrid">
          {proofLevels.map((level, index) => (
            <article key={level.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{level.name}</h3>
              <p>{level.meaning}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
