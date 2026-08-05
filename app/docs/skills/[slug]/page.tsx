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

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="docsDetailBlock">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
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
          <a href="/docs">Docs</a> / {skill.kind} skill
        </p>
        <div className="docsArticleTitle">
          <span>{skill.kind}</span>
          <code>{skill.name}</code>
          <h1>{skill.title}</h1>
          <p>{skill.summary}</p>
        </div>

        {skill.system ? (
          <section className="docsSystemLabel">
            <span>Owning system</span>
            <strong>{skill.system}</strong>
          </section>
        ) : null}

        <DetailList title="Use this skill for" items={skill.primaryFor} />
        <DetailList title="Common triggers" items={skill.triggers} />
        <DetailList title="Required inputs" items={skill.requiredInputs} />
        <DetailList title="Required outputs" items={skill.requiredOutputs} />
        <DetailList title="Required gates" items={skill.requiredGates} />
        <DetailList title="Conditional gates" items={skill.conditionalGates} />
        <DetailList title="Red Zone triggers" items={skill.redZoneTriggers} />

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
