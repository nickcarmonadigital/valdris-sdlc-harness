import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  allSkills,
  getSkill,
  repositoryUrl,
} from "../../../../lib/docs-catalog";

export function generateStaticParams() {
  return allSkills.map((skill) => ({ slug: skill.name }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const skill = getSkill(slug);
  if (!skill) return {};
  return {
    title: skill.title,
    description: skill.summary,
  };
}

function plainIdentifier(value: string) {
  const words = value
    .replaceAll("_", "-")
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const expanded: Record<string, string> = {
        ai: "artificial intelligence",
        api: "application programming interface",
        cicd: "continuous integration and delivery",
        mcp: "Model Context Protocol",
        rca: "root cause analysis",
      };
      return expanded[part.toLowerCase()] ?? part;
    })
    .join(" ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plainPublicText(value: string) {
  const replacements: Array<[RegExp, string]> = [
    [/\bA2A\b/g, "Agent2Agent protocol"],
    [/\bAPI\b/g, "application programming interface"],
    [/\bCI\b/g, "continuous integration"],
    [/\bDNS\b/g, "Domain Name System"],
    [/\bIAM\b/g, "identity and access management"],
    [/\bLLM\b/g, "large language model"],
    [/\bMCP\b/g, "Model Context Protocol"],
    [/\bQA\b/g, "quality assurance"],
    [/\bRAG\b/g, "retrieval-augmented generation"],
    [/\bRCA\b/g, "root cause analysis"],
    [/\bRLS\b/g, "row-level security"],
    [/\bSLO\b/g, "service-level objective"],
  ];

  return replacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function DetailList({
  title,
  items,
  description,
  identifiers = false,
}: {
  title: string;
  items: string[];
  description?: string;
  identifiers?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="docsDetailBlock">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item}>
            {identifiers ? (
              <>
                <code>{item}</code> — {plainPublicText(plainIdentifier(item))}
              </>
            ) : (
              plainPublicText(item)
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function SkillPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const skill = getSkill(slug);
  if (!skill) notFound();
  const skillType =
    skill.kind === "lifecycle" ? "lifecycle skill" : "work-type skill";

  return (
    <main className="docsArticleShell">
      <aside className="docsArticleSidebar">
        <a href="/docs">Documentation home</a>
        <span>Skill catalog</span>
        {allSkills.map((item) => (
          <a
            aria-current={item.name === skill.name ? "page" : undefined}
            className={item.name === skill.name ? "active" : ""}
            href={`/docs/skills/${item.name}`}
            key={item.name}
          >
            {item.title}
          </a>
        ))}
      </aside>

      <article className="docsArticle">
        <p className="docsBreadcrumb">
          <a href="/docs">Docs</a> / {skillType}
        </p>
        <div className="docsArticleTitle">
          <span>{skillType}</span>
          <code>{skill.name}</code>
          <h1>{skill.title}</h1>
          <p>{skill.summary}</p>
        </div>

        {skill.system ? (
          <section className="docsSystemLabel">
            <span>Owning system</span>
            <strong>{plainIdentifier(skill.system)}</strong>
          </section>
        ) : null}

        <DetailList title="Use this skill for" items={skill.primaryFor} />
        <DetailList title="Common triggers" items={skill.triggers} />
        <DetailList title="Required inputs" items={skill.requiredInputs} />
        <DetailList title="Required outputs" items={skill.requiredOutputs} />
        <div className="docsDetailGrid">
          <DetailList
            identifiers
            title="Required gate identifiers"
            items={skill.requiredGates}
          />
          <DetailList
            identifiers
            title="Conditional gate identifiers"
            items={skill.conditionalGates}
          />
          <DetailList
            description="A Red Zone trigger identifies high-risk work that requires explicit human approval."
            identifiers
            title="Red Zone trigger identifiers"
            items={skill.redZoneTriggers}
          />
        </div>

        {skill.next ? (
          <section className="docsNextSkill">
            <span>Next lifecycle system</span>
            <a href={`/docs/skills/${skill.next}`}>{skill.next}</a>
          </section>
        ) : null}

        <a
          className="docsSourceLink"
          href={`${repositoryUrl}/blob/main/${skill.sourcePath}`}
        >
          Read the complete skill source on GitHub
        </a>
      </article>
    </main>
  );
}
