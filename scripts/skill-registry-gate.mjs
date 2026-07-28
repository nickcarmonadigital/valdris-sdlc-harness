#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  existingFileWithinRepo,
  gateResult,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  resolveWithinRepo,
} from "./control-gate-lib.mjs";

export const SKILL_REGISTRY_SCHEMA = "uash.skill-registry.v2";
const REQUIRED_PHASE_TRANSITIONS = [
  "intake-route",
  "delivery",
  "proof-handoff",
];
const REQUIRED_PRIMARY_SKILLS = [
  "valdris-intake-route",
  "valdris-bug-rca",
  "valdris-feature-delivery",
  "valdris-architecture-refactor",
  "valdris-security-audit",
  "valdris-platform-release",
  "valdris-genai-assurance",
  "valdris-proof-handoff",
];
const REQUIRED_LIFECYCLE_SKILLS = [
  "valdris-commission",
  "valdris-route-goal",
  "valdris-assure",
  "valdris-connect-runtime",
  "valdris-execute-workflow",
  "valdris-prove-govern",
  "valdris-trust-improve",
];
const REQUIRED_LIFECYCLE_TIE_BREAK_ORDER = [
  "explicit lifecycle skill invocation",
  "requested Valdris system or owned artifact",
  "furthest downstream requested outcome",
  "route and goal control when lifecycle intent remains ambiguous",
];

function allSkills(document) {
  return [...(document.skills || []), ...(document.lifecycleSkills || [])];
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => {
        const index = line.indexOf(":");
        return index > 0
          ? [
              line.slice(0, index).trim(),
              line
                .slice(index + 1)
                .trim()
                .replace(/^['"]|['"]$/g, ""),
            ]
          : null;
      })
      .filter(Boolean),
  );
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function appendYamlList(lines, key, values, indent = 4) {
  if (!values?.length) {
    lines.push(`${" ".repeat(indent)}${key}: []`);
    return;
  }
  lines.push(`${" ".repeat(indent)}${key}:`);
  for (const value of values || [])
    lines.push(`${" ".repeat(indent + 2)}- ${yamlString(value)}`);
}

function existingDirectoryWithinRepo(repoRoot, target) {
  if (
    !existsSync(repoRoot) ||
    !existsSync(target) ||
    lstatSync(target).isSymbolicLink() ||
    !lstatSync(target).isDirectory()
  )
    return false;
  const relative = path.relative(realpathSync(repoRoot), realpathSync(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function renderCodexRoutingYaml(document, repoRoot) {
  const lines = [
    'schema: "uash.codex-skill-routing.v1"',
    `version: ${yamlString(document.version)}`,
    'source_registry: "skills/registry.json"',
    "selection:",
    `  max_primary: ${document.selection.maxPrimary}`,
    `  max_supporting: ${document.selection.maxSupporting}`,
    '  ambiguity_fallback: "valdris-intake-route"',
    '  finish_skill: "valdris-proof-handoff"',
    "  implicit_invocation: true",
  ];
  appendYamlList(lines, "tie_break_order", document.selection.tieBreakOrder, 2);
  lines.push("skills:");
  for (const skill of document.skills || []) {
    const target = resolveWithinRepo(repoRoot, nonEmpty(skill.path));
    const metadata =
      target && existsSync(target)
        ? frontmatter(readFileSync(target, "utf8"))
        : {};
    lines.push(`  - name: ${yamlString(skill.name)}`);
    lines.push(`    description: ${yamlString(metadata.description || "")}`);
    lines.push(`    path: ${yamlString(skill.path)}`);
    lines.push("    implicit_invocation: true");
    appendYamlList(lines, "primary_for", skill.primaryFor, 4);
    appendYamlList(lines, "triggers", skill.triggers, 4);
    appendYamlList(lines, "required_gates", skill.requiredGates, 4);
    appendYamlList(lines, "conditional_gates", skill.conditionalGates || [], 4);
    appendYamlList(lines, "red_zone_triggers", skill.redZoneTriggers, 4);
  }
  lines.push("lifecycle_selection:");
  lines.push(`  max_primary: ${document.lifecycleSelection?.maxPrimary ?? 1}`);
  lines.push(
    `  ambiguity_fallback: ${yamlString(document.lifecycleSelection?.ambiguityFallback || "valdris-route-goal")}`,
  );
  lines.push(
    `  policy: ${yamlString(document.lifecycleSelection?.policy || "")}`,
  );
  lines.push("  deterministic_sequence: true");
  appendYamlList(
    lines,
    "tie_break_order",
    document.lifecycleSelection?.tieBreakOrder || [],
    2,
  );
  lines.push("lifecycle_skills:");
  for (const skill of document.lifecycleSkills || []) {
    const target = resolveWithinRepo(repoRoot, nonEmpty(skill.path));
    const metadata =
      target && existsSync(target)
        ? frontmatter(readFileSync(target, "utf8"))
        : {};
    lines.push(`  - sequence: ${skill.sequence}`);
    lines.push(`    name: ${yamlString(skill.name)}`);
    lines.push(`    system: ${yamlString(skill.system)}`);
    lines.push(`    description: ${yamlString(metadata.description || "")}`);
    lines.push(`    path: ${yamlString(skill.path)}`);
    lines.push("    implicit_invocation: true");
    appendYamlList(lines, "primary_for", skill.primaryFor, 4);
    appendYamlList(lines, "triggers", skill.triggers, 4);
    appendYamlList(lines, "required_inputs", skill.requiredInputs, 4);
    appendYamlList(lines, "required_outputs", skill.requiredOutputs, 4);
    appendYamlList(lines, "required_gates", skill.requiredGates, 4);
    appendYamlList(lines, "conditional_gates", skill.conditionalGates || [], 4);
    lines.push(`    next: ${skill.next ? yamlString(skill.next) : "null"}`);
  }
  return `${lines.join("\n")}\n`;
}

function quotedInterfaceField(yaml, field) {
  return (
    yaml.match(new RegExp(`^  ${field}:\\s*"([^"]*)"\\s*$`, "m"))?.[1] || ""
  );
}

function validateSkillMirror(document, repoRoot, relativeRoot, problems) {
  const mirrorRoot = path.join(repoRoot, relativeRoot);
  if (!existsSync(mirrorRoot)) {
    problems.push(`${relativeRoot} skill mirror is missing`);
    return;
  }
  const expected = new Set(allSkills(document).map((skill) => skill.name));
  for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith("valdris-") &&
      !expected.has(entry.name)
    )
      problems.push(
        `${relativeRoot} contains unregistered Valdris skill: ${entry.name}`,
      );
  }
  for (const skill of allSkills(document)) {
    const canonicalTarget = resolveWithinRepo(repoRoot, nonEmpty(skill.path));
    if (!canonicalTarget || !existingFileWithinRepo(repoRoot, canonicalTarget))
      continue;
    const canonicalDir = path.dirname(canonicalTarget);
    for (const relativeFile of [
      "SKILL.md",
      path.join("agents", "openai.yaml"),
    ]) {
      const canonical = path.join(canonicalDir, relativeFile);
      const mirror = path.join(mirrorRoot, skill.name, relativeFile);
      if (!existingFileWithinRepo(repoRoot, mirror))
        problems.push(
          `${relativeRoot}/${skill.name}/${relativeFile.replaceAll("\\", "/")} is missing or outside repo`,
        );
      else if (readFileSync(mirror, "utf8") !== readFileSync(canonical, "utf8"))
        problems.push(
          `${relativeRoot}/${skill.name}/${relativeFile.replaceAll("\\", "/")} differs from canonical skill`,
        );
    }
  }
  for (const file of ["registry.json", "codex-routing.yaml"]) {
    const canonical = path.join(repoRoot, "skills", file);
    const mirror = path.join(mirrorRoot, file);
    if (!existingFileWithinRepo(repoRoot, mirror))
      problems.push(`${relativeRoot}/${file} is missing or outside repo`);
    else if (readFileSync(mirror, "utf8") !== readFileSync(canonical, "utf8"))
      problems.push(
        `${relativeRoot}/${file} differs from canonical skills/${file}`,
      );
  }
}

export function validateSkillRegistry(document, repoRoot) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return {
      valid: false,
      skillCount: 0,
      problems: ["skill registry must be a JSON object"],
    };
  if (document.schema !== SKILL_REGISTRY_SCHEMA)
    problems.push(`skill registry schema must be ${SKILL_REGISTRY_SCHEMA}`);
  if (
    !Array.isArray(document.skills) ||
    document.skills.length < 5 ||
    document.skills.length > 8
  )
    problems.push("skill registry must contain 5-8 selectable skills");
  if (
    !Array.isArray(document.lifecycleSkills) ||
    document.lifecycleSkills.length !== 7
  )
    problems.push("skill registry must contain exactly 7 lifecycle skills");
  if (document.selection?.maxPrimary !== 1)
    problems.push("skill registry selection.maxPrimary must be 1");
  if (document.selection?.maxSupporting !== 4)
    problems.push("skill registry selection.maxSupporting must be 4");
  if (document.lifecycleSelection?.catalogSize !== 7)
    problems.push("skill registry lifecycleSelection.catalogSize must be 7");
  if (document.lifecycleSelection?.maxPrimary !== 1)
    problems.push("skill registry lifecycleSelection.maxPrimary must be 1");
  if (!nonEmpty(document.lifecycleSelection?.policy))
    problems.push("skill registry lifecycleSelection.policy is required");
  if (
    JSON.stringify(document.lifecycleSelection?.tieBreakOrder) !==
    JSON.stringify(REQUIRED_LIFECYCLE_TIE_BREAK_ORDER)
  )
    problems.push(
      "skill registry lifecycleSelection.tieBreakOrder must match the executable routing contract",
    );
  if (document.lifecycleSelection?.ambiguityFallback !== "valdris-route-goal")
    problems.push(
      "skill registry lifecycle ambiguity fallback must be valdris-route-goal",
    );
  if (
    JSON.stringify(document.selection?.phaseTransitions) !==
    JSON.stringify(REQUIRED_PHASE_TRANSITIONS)
  )
    problems.push(
      "skill registry phaseTransitions must be exactly intake-route, delivery, proof-handoff",
    );
  if (
    !nonEmpty(document.gatePolicy?.review).startsWith(
      "Every completion requires an Ed25519-attested independent review artifact",
    )
  )
    problems.push(
      "skill registry review policy must require independent review for every completion",
    );
  const seen = new Set();
  const workflowSeen = new Set();
  const lifecycleSeen = new Set();
  const knownGateTokens = new Set([
    ...(document.gatePolicy?.always || []),
    ...Object.keys(document.gatePolicy || {}).filter(
      (gate) => gate !== "always",
    ),
  ]);
  for (const skill of allSkills(document)) {
    const name = nonEmpty(skill?.name);
    if (!/^[a-z0-9-]+$/.test(name))
      problems.push(`skill has invalid name: ${name || "missing"}`);
    if (seen.has(name)) problems.push(`skill duplicated: ${name}`);
    seen.add(name);
    if ((document.skills || []).includes(skill)) workflowSeen.add(name);
    if ((document.lifecycleSkills || []).includes(skill))
      lifecycleSeen.add(name);
    const target = resolveWithinRepo(repoRoot, nonEmpty(skill?.path));
    if (!target || !existingFileWithinRepo(repoRoot, target)) {
      problems.push(
        `skill path missing or outside repo: ${skill?.path || "missing"}`,
      );
      continue;
    }
    const metadata = frontmatter(readFileSync(target, "utf8"));
    if (metadata.name !== name)
      problems.push(`skill ${name} frontmatter name does not match registry`);
    if (!nonEmpty(metadata.description))
      problems.push(`skill ${name} frontmatter description is required`);
    const openAiTarget = path.join(
      path.dirname(target),
      "agents",
      "openai.yaml",
    );
    if (!existingFileWithinRepo(repoRoot, openAiTarget)) {
      problems.push(
        `skill ${name} agents/openai.yaml is missing or outside repo`,
      );
    } else {
      const openAiYaml = readFileSync(openAiTarget, "utf8");
      const displayName = quotedInterfaceField(openAiYaml, "display_name");
      const shortDescription = quotedInterfaceField(
        openAiYaml,
        "short_description",
      );
      const defaultPrompt = quotedInterfaceField(openAiYaml, "default_prompt");
      if (!displayName)
        problems.push(
          `skill ${name} agents/openai.yaml display_name is required`,
        );
      if (shortDescription.length < 25 || shortDescription.length > 64)
        problems.push(
          `skill ${name} agents/openai.yaml short_description must be 25-64 characters`,
        );
      if (!defaultPrompt.includes(`$${name}`))
        problems.push(
          `skill ${name} agents/openai.yaml default_prompt must mention $${name}`,
        );
      if (
        !/^policy:\r?\n  allow_implicit_invocation:\s*true\s*$/m.test(
          openAiYaml,
        )
      )
        problems.push(
          `skill ${name} must allow implicit invocation in agents/openai.yaml`,
        );
    }
    for (const field of ["primaryFor", "triggers", "requiredGates"])
      if (!Array.isArray(skill[field]))
        problems.push(`skill ${name}.${field} must be an array`);
    if (!skill.primaryFor?.length)
      problems.push(`skill ${name} must declare primaryFor`);
    if (!skill.triggers?.length)
      problems.push(`skill ${name} must declare triggers`);
    if (!skill.requiredGates?.length)
      problems.push(`skill ${name} must declare requiredGates`);
    if (lifecycleSeen.has(name)) {
      for (const field of ["requiredInputs", "requiredOutputs"])
        if (!Array.isArray(skill[field]) || !skill[field].length)
          problems.push(`lifecycle skill ${name}.${field} must be non-empty`);
      if (!Array.isArray(skill.conditionalGates))
        problems.push(
          `lifecycle skill ${name}.conditionalGates must be an array`,
        );
      for (const gate of skill.requiredGates || [])
        if (!knownGateTokens.has(gate))
          problems.push(
            `lifecycle skill ${name} has unknown required gate entry ${gate}`,
          );
    } else if (!Array.isArray(skill.redZoneTriggers)) {
      problems.push(`skill ${name}.redZoneTriggers must be an array`);
    }
  }
  for (const skill of REQUIRED_PRIMARY_SKILLS)
    if (!workflowSeen.has(skill))
      problems.push(`skill registry missing canonical primary skill: ${skill}`);
  const systems = new Set();
  for (const [index, name] of REQUIRED_LIFECYCLE_SKILLS.entries()) {
    const skill = (document.lifecycleSkills || [])[index];
    if (!lifecycleSeen.has(name))
      problems.push(`skill registry missing lifecycle skill: ${name}`);
    if (skill?.name !== name || skill?.sequence !== index + 1)
      problems.push(`lifecycle skill sequence ${index + 1} must be ${name}`);
    if (!nonEmpty(skill?.system))
      problems.push(`lifecycle skill ${name} must declare system`);
    else if (systems.has(skill.system))
      problems.push(`lifecycle system duplicated: ${skill.system}`);
    else systems.add(skill.system);
    const expectedNext = REQUIRED_LIFECYCLE_SKILLS[index + 1] || null;
    if ((skill?.next ?? null) !== expectedNext)
      problems.push(
        `lifecycle skill ${name}.next must be ${expectedNext || "null"}`,
      );
  }
  if (
    JSON.stringify(document.lifecycleSelection?.sequence) !==
    JSON.stringify(REQUIRED_LIFECYCLE_SKILLS)
  )
    problems.push(
      "skill registry lifecycleSelection.sequence must match the canonical seven-skill chain",
    );
  const proofHandoff = (document.skills || []).find(
    (skill) => skill?.name === "valdris-proof-handoff",
  );
  if (
    !["run-packet", "review", "proof"].every((gate) =>
      proofHandoff?.requiredGates?.includes(gate),
    )
  )
    problems.push(
      "valdris-proof-handoff must require run-packet, review, and proof gates for every completion",
    );
  const canonicalSkillRoot = path.join(repoRoot, "skills");
  for (const entry of readdirSync(canonicalSkillRoot, {
    withFileTypes: true,
  })) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith("valdris-") &&
      !seen.has(entry.name)
    )
      problems.push(
        `skills contains unregistered Valdris skill: ${entry.name}`,
      );
  }
  if (document.selection?.catalogSize !== (document.skills || []).length)
    problems.push(
      "skill registry selection.catalogSize must match skills length",
    );
  if (
    document.lifecycleSelection?.catalogSize !==
    (document.lifecycleSkills || []).length
  )
    problems.push(
      "skill registry lifecycleSelection.catalogSize must match lifecycleSkills length",
    );
  const routingTarget = path.join(repoRoot, "skills", "codex-routing.yaml");
  if (!existingFileWithinRepo(repoRoot, routingTarget)) {
    problems.push("skills/codex-routing.yaml is missing or outside repo");
  } else if (!problems.some((problem) => problem.includes("skill path"))) {
    const expectedRouting = renderCodexRoutingYaml(document, repoRoot);
    if (
      readFileSync(routingTarget, "utf8").replace(/\r\n/g, "\n") !==
      expectedRouting
    )
      problems.push(
        "skills/codex-routing.yaml is stale relative to skills/registry.json or SKILL.md metadata",
      );
  }
  const adapterTarget = path.join(repoRoot, "project-adapter.json");
  const hasAgentMirror = existsSync(path.join(repoRoot, ".agents", "skills"));
  const hasClaudeMirror = existsSync(path.join(repoRoot, ".claude", "skills"));
  const looksCommissioned =
    existsSync(path.join(repoRoot, "00_MAP.md")) ||
    existsSync(path.join(repoRoot, "CONTEXT.md")) ||
    existsSync(path.join(repoRoot, "commissioning-review.md"));
  let adapterRequiresMirrors = false;
  if (existsSync(adapterTarget)) {
    const adapter = readJson(adapterTarget);
    if (adapter.schema !== "uash.project-adapter.v2") {
      problems.push("project adapter schema must be uash.project-adapter.v2");
    } else if (adapter.schema === "uash.project-adapter.v2") {
      adapterRequiresMirrors = true;
      if (adapter.skillRouter?.schema !== SKILL_REGISTRY_SCHEMA)
        problems.push(
          `project adapter skillRouter.schema must be ${SKILL_REGISTRY_SCHEMA}`,
        );
      if (adapter.skillRouter?.registry !== "skills/registry.json")
        problems.push(
          "project adapter skillRouter.registry must be skills/registry.json",
        );
      if (adapter.skillRouter?.codexRouting !== "skills/codex-routing.yaml")
        problems.push(
          "project adapter skillRouter.codexRouting must be skills/codex-routing.yaml",
        );
      if (adapter.skillRouter?.implicitInvocation !== true)
        problems.push(
          "project adapter skillRouter.implicitInvocation must be true",
        );
      if (adapter.skillRouter?.workflowCatalogSize !== 8)
        problems.push(
          "project adapter skillRouter.workflowCatalogSize must be 8",
        );
      if (adapter.skillRouter?.lifecycleCatalogSize !== 7)
        problems.push(
          "project adapter skillRouter.lifecycleCatalogSize must be 7",
        );
      if (
        ![
          'node scripts/route-lifecycle-skill.mjs --repo . --request "<request>"',
          'node .valdris-harness/scripts/route-lifecycle-skill.mjs --repo . --request "<request>"',
        ].includes(adapter.skillRouter?.lifecycleRouteCommand)
      )
        problems.push(
          "project adapter skillRouter.lifecycleRouteCommand must invoke the commissioned lifecycle router against the target root",
        );
    }
  }
  if (
    (hasAgentMirror || hasClaudeMirror || looksCommissioned) &&
    !existsSync(adapterTarget)
  )
    problems.push(
      "project-adapter.json is required when generated skill mirrors or commissioned front doors are present",
    );
  if (
    hasAgentMirror ||
    hasClaudeMirror ||
    looksCommissioned ||
    adapterRequiresMirrors
  ) {
    validateSkillMirror(
      document,
      repoRoot,
      path.join(".agents", "skills"),
      problems,
    );
    validateSkillMirror(
      document,
      repoRoot,
      path.join(".claude", "skills"),
      problems,
    );
  }
  const metaSkillTarget = path.join(
    repoRoot,
    "meta-skills",
    "valdris-sdlc-harness",
    "SKILL.md",
  );
  if (existsSync(metaSkillTarget)) {
    const metadata = frontmatter(readFileSync(metaSkillTarget, "utf8"));
    const metaOpenAi = path.join(
      path.dirname(metaSkillTarget),
      "agents",
      "openai.yaml",
    );
    if (
      metadata.name !== "valdris-sdlc-harness" ||
      !nonEmpty(metadata.description)
    )
      problems.push(
        "meta skill valdris-sdlc-harness has invalid YAML frontmatter",
      );
    if (
      !existingFileWithinRepo(repoRoot, metaOpenAi) ||
      !/^policy:\r?\n  allow_implicit_invocation:\s*true\s*$/m.test(
        readFileSync(metaOpenAi, "utf8"),
      )
    )
      problems.push(
        "meta skill valdris-sdlc-harness must allow implicit invocation",
      );
  }
  return {
    valid: problems.length === 0,
    schema: document.schema,
    skillCount: workflowSeen.size,
    lifecycleSkillCount: lifecycleSeen.size,
    totalSkillCount: seen.size,
    skills: Array.from(workflowSeen),
    lifecycleSkills: Array.from(lifecycleSeen),
    problems,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const writeRouting = argv.includes("--write-routing");
  const args = parseRepoFileArgs(
    argv.filter((arg) => arg !== "--write-routing"),
    {
      file: "skills/registry.json",
    },
  );
  args.writeRouting = writeRouting;
  if (args.help)
    return console.log(
      "Usage: node scripts/skill-registry-gate.mjs --repo . [--file skills/registry.json] [--write-routing]",
    );
  const repoRoot = path.resolve(args.repo);
  const requestedTarget = path.resolve(repoRoot, args.file);
  const assetRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const target =
    args.file === "skills/registry.json"
      ? path.join(assetRoot, "skills", "registry.json")
      : requestedTarget;
  if (!existsSync(target))
    return gateResult(args.file, {
      valid: false,
      skillCount: 0,
      problems: [`skill registry missing: ${args.file}`],
    });
  try {
    const document = readJson(target);
    if (args.writeRouting) {
      const registryRoot = path.resolve(target, "..", "..");
      const canonicalRegistry = path.join(repoRoot, "skills", "registry.json");
      const routingTarget = path.join(repoRoot, "skills", "codex-routing.yaml");
      const routingParent = path.dirname(routingTarget);
      if (
        path.resolve(target) !== canonicalRegistry ||
        registryRoot !== repoRoot ||
        !existingFileWithinRepo(repoRoot, target) ||
        !existingDirectoryWithinRepo(repoRoot, routingParent) ||
        (existsSync(routingTarget) &&
          !existingFileWithinRepo(repoRoot, routingTarget))
      )
        throw new Error(
          "routing projection write requires the existing canonical skills registry and routing file inside --repo",
        );
      writeFileSync(
        routingTarget,
        renderCodexRoutingYaml(document, registryRoot),
      );
    }
    gateResult(
      args.file,
      validateSkillRegistry(document, path.resolve(target, "..", "..")),
    );
  } catch (error) {
    gateResult(args.file, {
      valid: false,
      skillCount: 0,
      problems: [`skill registry must be valid JSON: ${error.message}`],
    });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
