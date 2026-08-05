"use client";

import { useMemo, useState } from "react";

type SkillCard = {
  name: string;
  title: string;
  summary: string;
  kind: "lifecycle" | "workflow";
  sequence: number;
  primaryFor: string[];
};

export function DocsSearch({ skills }: { skills: SkillCard[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "lifecycle" | "workflow">("all");

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (kind !== "all" && skill.kind !== kind) return false;
      if (!normalized) return true;
      return [skill.name, skill.title, skill.summary, ...skill.primaryFor]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [kind, query, skills]);

  return (
    <section className="docsExplorer" aria-labelledby="explore-skills">
      <div className="docsSectionHeading">
        <div>
          <p className="docsKicker">Skill reference</p>
          <h2 id="explore-skills">Find the owning work-type skill</h2>
        </div>
        <p>
          Search by outcome, risk, artifact, or skill name. Lifecycle skills own
          Valdris systems. Work-type skills own engineering work.
        </p>
      </div>

      <div className="docsSearchControls">
        <label className="docsSearchField">
          <span>Search skills</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Example: rollback, security, route, agent"
            type="search"
            value={query}
          />
        </label>
        <div className="docsFilterGroup" aria-label="Filter skills">
          {(["all", "lifecycle", "workflow"] as const).map((value) => (
            <button
              aria-pressed={kind === value}
              className={kind === value ? "active" : ""}
              key={value}
              onClick={() => setKind(value)}
              type="button"
            >
              {value === "workflow" ? "work type" : value}
            </button>
          ))}
        </div>
      </div>

      <p className="docsResultCount" aria-live="polite">
        {visible.length} {visible.length === 1 ? "skill" : "skills"}
      </p>

      <div className="docsSkillGrid">
        {visible.map((skill) => (
          <a
            className="docsSkillCard"
            href={`/docs/skills/${skill.name}`}
            key={skill.name}
          >
            <div className="docsCardTopline">
              <span>
                {skill.kind === "workflow" ? "work type" : "lifecycle"}
              </span>
              <b>{String(skill.sequence).padStart(2, "0")}</b>
            </div>
            <code>{skill.name}</code>
            <h3>{skill.title}</h3>
            <p>{skill.summary}</p>
            <span className="docsCardLink">Open reference</span>
          </a>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="docsEmptyState">
          <strong>No matching skill.</strong>
          <p>Try a broader outcome or select all skills.</p>
        </div>
      ) : null}
    </section>
  );
}
