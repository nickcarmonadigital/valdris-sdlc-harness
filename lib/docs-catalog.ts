import packageMetadata from "../package.json";
import productionCatalog from "../controls/production-layers.v2.json";
import terminologyPolicy from "../policies/technical-communication.v1.json";
import skillRegistry from "../skills/registry.json";

export type SkillKind = "lifecycle" | "workflow";

export type PublicSkill = {
  name: string;
  title: string;
  summary: string;
  kind: SkillKind;
  sequence: number;
  system?: string;
  sourcePath: string;
  primaryFor: string[];
  triggers: string[];
  requiredInputs: string[];
  requiredOutputs: string[];
  requiredGates: string[];
  conditionalGates: string[];
  redZoneTriggers: string[];
  next?: string | null;
};

const lifecycleSummaries: Record<string, string> = {
  "valdris-commission":
    "Learn a repository and install a reviewed, portable project pack.",
  "valdris-route-goal":
    "Bind the authorized request to an immutable route and durable goal.",
  "valdris-assure":
    "Resolve Layer 0 and every applicable production, AI, and domain assessment.",
  "valdris-connect-runtime":
    "Connect an external coding agent to real run events and evidence.",
  "valdris-execute-workflow":
    "Run the selected engineering workflow in bounded, verified checkpoints.",
  "valdris-prove-govern":
    "Assemble proof, approvals, independent review, and the final run packet.",
  "valdris-trust-improve":
    "Decide the supported trust level, hand off the result, and capture improvements.",
};

const workflowSummaries: Record<string, string> = {
  "valdris-intake-route":
    "Classify unclear or mixed work and select the smallest safe workflow.",
  "valdris-bug-rca":
    "Reproduce a failure, prove its cause, verify the fix, and prevent regression.",
  "valdris-feature-delivery":
    "Deliver a feature from accepted requirements through implementation proof.",
  "valdris-architecture-refactor":
    "Change architecture, migration paths, or module structure with bounded risk.",
  "valdris-security-audit":
    "Test security, privacy, authorization, and tenant-isolation claims.",
  "valdris-platform-release":
    "Govern cloud, deployment, rollback, recovery, and release work.",
  "valdris-genai-assurance":
    "Evaluate models, prompts, retrieval, agents, tools, memory, and AI telemetry.",
  "valdris-proof-handoff":
    "Run finish-line checks and hand off an evidence-backed result.",
};

const skillTitles: Record<string, string> = {
  "valdris-route-goal": "Route and Goal",
  "valdris-prove-govern": "Prove and Govern",
  "valdris-trust-improve": "Trust and Improve",
  "valdris-intake-route": "Intake and Route",
  "valdris-bug-rca": "Bug RCA",
  "valdris-genai-assurance": "GenAI Assurance",
};

function titleFromName(name: string) {
  return (
    skillTitles[name] ??
    name
      .replace(/^valdris-/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export const lifecycleSkills: PublicSkill[] = skillRegistry.lifecycleSkills.map(
  (skill) => ({
    name: skill.name,
    title: titleFromName(skill.name),
    summary: lifecycleSummaries[skill.name] ?? skill.primaryFor[0],
    kind: "lifecycle",
    sequence: skill.sequence,
    system: skill.system,
    sourcePath: skill.path,
    primaryFor: skill.primaryFor,
    triggers: skill.triggers,
    requiredInputs: skill.requiredInputs,
    requiredOutputs: skill.requiredOutputs,
    requiredGates: skill.requiredGates,
    conditionalGates: skill.conditionalGates,
    redZoneTriggers: [],
    next: skill.next,
  }),
);

export const workflowSkills: PublicSkill[] = skillRegistry.skills.map(
  (skill, index) => ({
    name: skill.name,
    title: titleFromName(skill.name),
    summary: workflowSummaries[skill.name] ?? skill.primaryFor[0],
    kind: "workflow",
    sequence: index + 1,
    sourcePath: skill.path,
    primaryFor: skill.primaryFor,
    triggers: skill.triggers,
    requiredInputs: [],
    requiredOutputs: [],
    requiredGates: skill.requiredGates,
    conditionalGates: skill.conditionalGates ?? [],
    redZoneTriggers: skill.redZoneTriggers,
  }),
);

export const allSkills = [...lifecycleSkills, ...workflowSkills];

export function getSkill(name: string) {
  return allSkills.find((skill) => skill.name === name);
}

export const productionDomains = productionCatalog.layers.map(
  (domain, index) => ({
    id: domain.layer,
    number: index + 1,
    title: domain.title,
    summary: domain.capabilities[0]?.description ?? "",
    capabilities: domain.capabilities,
    controlCount: domain.controls.length,
  }),
);

export const controlledTerms = terminologyPolicy.controlled_vocabulary;

export const ontologyTerms = [
  {
    term: "Ontology",
    meaning:
      "An explicit model of the kinds of things in a domain, their defining properties, and their relationships.",
    status: "standard domain term",
  },
  {
    term: "Taxonomy",
    meaning: "The category hierarchy within an ontology.",
    status: "standard domain term",
  },
  {
    term: "Classification",
    meaning:
      "Assignment of a specific thing to the category whose defining properties it satisfies.",
    status: "standard domain term",
  },
  {
    term: "Terminology",
    meaning: "The selected word or phrase for a category.",
    status: "standard domain term",
  },
  {
    term: "Controlled vocabulary",
    meaning: "The approved terms and meanings for a project or domain.",
    status: "standard domain term",
  },
  {
    term: "Schema",
    meaning: "The required structure of a record.",
    status: "standard domain term",
  },
  {
    term: "Knowledge graph",
    meaning: "Actual entities and relationships represented as a graph.",
    status: "standard domain term",
  },
];

export const proofLevels = [
  {
    name: "Structural",
    meaning: "The required files, fields, paths, and digests exist.",
  },
  {
    name: "Semantic",
    meaning: "The evidence supports the control's intended meaning.",
  },
  {
    name: "Authoritative",
    meaning:
      "Trusted outside execution and rollback-resistant provider state support the proof.",
  },
];

export const runtimeCards = [
  {
    name: "Claude Code",
    entry: "CLAUDE.md and generated slash command",
    role: "External coding agent",
  },
  {
    name: "Codex",
    entry: "AGENTS.md, Codex runtime prompt, and OpenAI skill sidecars",
    role: "External coding agent",
  },
  {
    name: "Hermes",
    entry: "Commissioned instructions and connector events",
    role: "External coding agent",
  },
];

export const referenceCards = [
  {
    title: "Getting started",
    description:
      "Clone Valdris, commission a repository, and route the first request.",
    href: "/docs/getting-started",
    label: "Start here",
  },
  {
    title: "Assurance model",
    description:
      "Layer 0, the 13 production domains, and the three proof levels.",
    href: "/docs/assurance",
    label: "Core model",
  },
  {
    title: "Controlled terminology",
    description:
      "Public product terms, plain meanings, status, and usage boundaries.",
    href: "/docs/glossary",
    label: "Glossary",
  },
  {
    title: "Architecture",
    description:
      "System shape, responsibility boundary, connectors, and presentation modes.",
    href: "https://github.com/nickcarmonadigital/valdris-sdlc-harness/blob/main/docs/ARCHITECTURE.md",
    label: "Repository reference",
  },
  {
    title: "Connector event contract",
    description: "The event schema used for Live Run and Replay evidence.",
    href: "https://github.com/nickcarmonadigital/valdris-sdlc-harness/blob/main/docs/CONNECTOR_EVENT_CONTRACT.md",
    label: "Repository reference",
  },
  {
    title: "Agent knowledge vault",
    description:
      "The smallest agent-facing map into systems, playbooks, concepts, and sources.",
    href: "https://github.com/nickcarmonadigital/valdris-sdlc-harness/tree/main/knowledge",
    label: "Repository reference",
  },
];

export const packageVersion = packageMetadata.version;
export const repositoryUrl =
  "https://github.com/nickcarmonadigital/valdris-sdlc-harness";
