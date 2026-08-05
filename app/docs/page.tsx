import { DocsSearch } from "../../components/DocsSearch";
import {
  allSkills,
  lifecycleSkills,
  packageVersion,
  productionDomains,
  proofLevels,
  referenceCards,
  repositoryUrl,
  runtimeCards,
  workflowSkills,
} from "../../lib/docs-catalog";

export default function DocsPage() {
  return (
    <main>
      <section className="docsHero">
        <div className="docsHeroGrid">
          <div className="docsHeroCopy">
            <p className="docsKicker">
              Public documentation · {packageVersion}
            </p>
            <h1>
              Repository-level SDLC assurance harness for AI coding agents.
            </h1>
            <p className="docsHeroLede">
              Valdris installs repository controls, routes work, records
              external coding-agent activity as evidence, checks required proof,
              and blocks unsupported completion. SDLC means software development
              lifecycle.
            </p>
            <div className="docsHeroActions">
              <a className="docsPrimaryButton" href="#install">
                Start with Valdris
              </a>
              <a className="docsSecondaryButton" href="#lifecycle">
                Browse the lifecycle
              </a>
            </div>
            <p className="docsBoundary">
              Valdris works around Claude Code, Codex, Hermes, and other coding
              agents. It is not an IDE or a coding agent.
            </p>
          </div>

          <div className="docsHeroPanel" aria-label="Valdris proof flow">
            <div className="docsSignalRow">
              <span>REQUEST</span>
              <b>01</b>
            </div>
            <div className="docsFlowLine">
              {[
                "Commission",
                "Route",
                "Assure",
                "Connect",
                "Execute",
                "Prove",
                "Trust",
              ].map((step, index) => (
                <div className="docsFlowStep" key={step}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
            <div className="docsProofState">
              <span>COMPLETION STATE</span>
              <strong>Blocked until required proof exists</strong>
            </div>
          </div>
        </div>

        <div className="docsMetricRail" aria-label="Harness summary">
          <div>
            <strong>7</strong>
            <span>lifecycle skills</span>
          </div>
          <div>
            <strong>8</strong>
            <span>work-type skills</span>
          </div>
          <div>
            <strong>13</strong>
            <span>production domains</span>
          </div>
          <div>
            <strong>3</strong>
            <span>proof levels</span>
          </div>
        </div>
      </section>

      <section
        className="docsInstall"
        id="install"
        aria-labelledby="install-heading"
      >
        <div>
          <p className="docsKicker">Current source install</p>
          <h2 id="install-heading">Commission one repository.</h2>
          <p>
            The current release candidate installs from source. It generates a
            reviewed <code>.valdris-harness</code> pack inside the target
            repository.
          </p>
          <a href="/docs/getting-started">Read the full installation path</a>
        </div>
        <div className="docsCommandStack">
          <div className="docsCommand">
            <span>1 · clone and install</span>
            <code>git clone {repositoryUrl}.git</code>
            <code>cd valdris-sdlc-harness &amp;&amp; npm ci</code>
          </div>
          <div className="docsCommand">
            <span>2 · commission a target</span>
            <code>
              npm run commission -- --repo /path/to/repo --project-name
              &quot;Example&quot; --out /path/to/repo/.valdris-harness --yes
            </code>
          </div>
        </div>
      </section>

      <section className="docsContentSection" id="lifecycle">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">01 · Core lifecycle</p>
            <h2>Seven systems move a request from discovery to trust.</h2>
          </div>
          <p>
            Each lifecycle skill owns one Valdris system. The sequence keeps
            repository discovery, execution, proof, and promotion distinct.
          </p>
        </div>
        <div className="docsSequenceGrid">
          {lifecycleSkills.map((skill) => (
            <a href={`/docs/skills/${skill.name}`} key={skill.name}>
              <span>{String(skill.sequence).padStart(2, "0")}</span>
              <code>{skill.name}</code>
              <h3>{skill.title}</h3>
              <p>{skill.summary}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="docsContentSection docsDarkSection" id="work-types">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">02 · Work-type skills</p>
            <h2>Route each phase to one primary work-type skill.</h2>
          </div>
          <p>
            Work-type skills classify the engineering work. They do not replace
            the seven lifecycle systems.
          </p>
        </div>
        <div className="docsWorkflowGrid">
          {workflowSkills.map((skill) => (
            <a href={`/docs/skills/${skill.name}`} key={skill.name}>
              <div className="docsCardTopline">
                <span>work type</span>
                <b>{String(skill.sequence).padStart(2, "0")}</b>
              </div>
              <code>{skill.name}</code>
              <h3>{skill.title}</h3>
              <p>{skill.summary}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="docsAssurancePreview" id="assurance">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">03 · Assurance model</p>
            <h2>
              Foundation first. Then assess the production domains that apply.
            </h2>
          </div>
          <p>
            Layer 0 establishes the product, requirement, ownership, and proof
            foundation. It is not a fourteenth production domain.
          </p>
        </div>

        <div className="docsAssuranceGrid">
          <article className="docsFoundationCard">
            <span>FOUNDATION</span>
            <strong>Layer 0</strong>
            <p>
              Confirm what is being built, why it matters, who owns the risk,
              and what evidence will support completion.
            </p>
          </article>
          <div className="docsDomainList">
            {productionDomains.map((domain) => (
              <div key={domain.id}>
                <span>{String(domain.number).padStart(2, "0")}</span>
                <strong>{domain.title}</strong>
              </div>
            ))}
          </div>
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
        <a className="docsTextLink" href="/docs/assurance">
          Open the complete assurance reference
        </a>
      </section>

      <section className="docsContentSection">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">04 · Runtime boundary</p>
            <h2>The coding agent implements. Valdris governs the run.</h2>
          </div>
          <p>
            Live Run requires real events from a connector, application
            programming interface, command-line tool, Model Context Protocol
            server, or watched artifact. Static documentation cannot prove live
            execution.
          </p>
        </div>
        <div className="docsRuntimeGrid">
          {runtimeCards.map((runtime) => (
            <article key={runtime.name}>
              <span>{runtime.role}</span>
              <h3>{runtime.name}</h3>
              <p>{runtime.entry}</p>
            </article>
          ))}
        </div>
      </section>

      <DocsSearch skills={allSkills} />

      <section className="docsReferenceSection">
        <div className="docsSectionHeading">
          <div>
            <p className="docsKicker">05 · Reference</p>
            <h2>Open the smallest source that answers the question.</h2>
          </div>
          <p>
            The public site explains the model. The repository remains the
            source for executable controls, schemas, scripts, and verification
            rules.
          </p>
        </div>
        <div className="docsReferenceGrid">
          {referenceCards.map((card) => (
            <a href={card.href} key={card.title}>
              <span>{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              <b>Open reference</b>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
