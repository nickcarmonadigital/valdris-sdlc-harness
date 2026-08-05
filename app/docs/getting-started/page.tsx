import type { Metadata } from "next";
import { packageVersion, repositoryUrl } from "../../../lib/docs-catalog";

export const metadata: Metadata = {
  title: "Getting Started",
  description:
    "Install the Valdris source, commission a target repository, and route the first request.",
};

const steps = [
  {
    number: "01",
    title: "Clone the release candidate",
    copy: `The current package is ${packageVersion}. Valdris is not published as an npm installer or marketplace plugin.`,
    commands: [
      `git clone ${repositoryUrl}.git`,
      "cd valdris-sdlc-harness",
      "npm ci",
    ],
  },
  {
    number: "02",
    title: "Verify the source",
    copy: "Run the development checks before commissioning another repository.",
    commands: ["npm run typecheck", "npm run build", "npm run verify:harness"],
  },
  {
    number: "03",
    title: "Commission the target",
    copy: "Generate the project adapter, bounded agent front doors, skills, controls, scripts, and review checklist.",
    commands: [
      'npm run commission -- --repo /path/to/repo --project-name "Example" --out /path/to/repo/.valdris-harness --yes',
    ],
  },
  {
    number: "04",
    title: "Review and commit the pack",
    copy: "A route must bind a committed source state. Review the generated answers before the first run.",
    commands: [
      "git -C /path/to/repo status --short",
      "git -C /path/to/repo add -- .valdris-harness AGENTS.md CLAUDE.md",
      'git -C /path/to/repo commit -m "chore: commission Valdris harness"',
    ],
  },
  {
    number: "05",
    title: "Route the first request",
    copy: "The router writes the intake, workload classification, route, and durable goal. It does not launch or approve the coding agent.",
    commands: [
      "cd /path/to/repo",
      'node .valdris-harness/scripts/route-request.mjs --repo . --profile enterprise --actor "owner" --request "Build a secure account settings page."',
    ],
  },
];

export default function GettingStartedPage() {
  return (
    <main className="docsReferencePage">
      <header className="docsReferenceHero">
        <p className="docsBreadcrumb">
          <a href="/docs">Docs</a> / getting started
        </p>
        <p className="docsKicker">Source installation</p>
        <h1>Commission one repository before routing work.</h1>
        <p>
          Commissioning learns the repository and generates a portable project
          pack. Claude Code, Codex, Hermes, or another external coding agent
          then performs implementation under that pack.
        </p>
      </header>

      <section className="docsStartSteps">
        {steps.map((step) => (
          <article key={step.number}>
            <span>{step.number}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.copy}</p>
              <div className="docsCommand">
                {step.commands.map((command) => (
                  <code key={command}>{command}</code>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>

      <aside className="docsConformanceNote">
        <strong>Development proof is not production release proof.</strong>
        <p>
          Read the repository <code>AGENTS.md</code> before a merge or release.
          Authoritative release remains blocked until a commissioned target has
          trusted provider keys, protected execution, signed receipts, and
          externally stored state that cannot be silently moved backward.
        </p>
      </aside>
    </main>
  );
}
