#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portableManifestSha256 } from "./control-gate-lib.mjs";
import { REVIEW_TRUST_SHA256_ENV } from "./review-gate.mjs";
import { validationRuntimeBinding } from "./run-packet-gate.mjs";
import { validateSkillRegistry } from "./skill-registry-gate.mjs";

const ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const args = { repo: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--request") args.request = argv[++index];
    else if (arg === "--stage") args.stage = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[$`"'.,:;!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectExplicit(lifecycleSkills, stage) {
  const normalized = normalize(stage).replace(/^valdris /, "valdris-");
  return lifecycleSkills.find(
    (skill) =>
      normalize(skill.name).replaceAll(" ", "-") ===
        normalized.replaceAll(" ", "-") ||
      normalize(skill.system).replaceAll(" ", "-") ===
        normalized.replaceAll(" ", "-") ||
      String(skill.sequence) === normalized,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhrase(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNegatedAt(source, index) {
  const before = String(source || "")
    .toLowerCase()
    .slice(0, index)
    .slice(-128);
  if (
    /(?:^|[\s,;:.])why\s+not\s+(?:(?:use|using|invoke|select|run|choose|inspect|check|validate|read|open|touch|change|create|assemble)\s+)?$/u.test(
      before,
    )
  )
    return false;
  return /(?:^|[\s,;:.])(?:do\s+not|don't|dont|not|never|avoid|exclude|without|rather\s+than)\s+(?:(?:want|need|plan|intend|try)\s+to\s+)?(?:(?:use|using|invoke|select|run|choose|inspect|check|validate|read|open|touch|change|create|assemble)\s+)?$/u.test(
    before,
  );
}

function includesUnnegatedMatch(source, matcher) {
  for (const match of String(source || "")
    .toLowerCase()
    .matchAll(matcher))
    if (!isNegatedAt(source, match.index)) return true;
  return false;
}

function includesPhrase(request, value) {
  const tokens = normalizePhrase(value).split(" ").filter(Boolean);
  if (!tokens.length) return false;
  const phrase = tokens.map(escapeRegExp).join("[^a-z0-9]+");
  return includesUnnegatedMatch(
    request,
    new RegExp(`(?<![a-z0-9-])${phrase}(?![a-z0-9-])`, "g"),
  );
}

function includesLiteralSurface(request, value) {
  const surface = normalize(value);
  return (
    surface.length > 0 &&
    includesUnnegatedMatch(
      request,
      new RegExp(`(?<!\\S)${escapeRegExp(surface)}(?=\\s|$)`, "g"),
    )
  );
}

function scoreSkill(skill, request) {
  const matchedTriggers = (skill.triggers || []).filter((trigger) =>
    includesPhrase(request, trigger),
  );
  const matchedPrimaryFor = (skill.primaryFor || []).filter((phrase) =>
    includesPhrase(request, phrase),
  );
  const phrases = [...matchedTriggers, ...matchedPrimaryFor];
  return {
    skill,
    matchedTriggers,
    matchedPrimaryFor,
    phraseCount: phrases.length,
    specificity: phrases.reduce(
      (sum, phrase) =>
        sum + normalize(phrase).split(" ").length * 100 + phrase.length,
      0,
    ),
  };
}

function outputArtifactPaths(skill) {
  return (skill.requiredOutputs || []).flatMap((output) =>
    (String(output).match(/[a-z0-9_.-]+\/[a-z0-9_./-]+/gi) || []).map(
      normalize,
    ),
  );
}

function uniqueOwnedNamespaces(lifecycleSkills) {
  const owners = new Map();
  for (const skill of lifecycleSkills)
    for (const artifact of outputArtifactPaths(skill)) {
      const separator = artifact.indexOf("/");
      if (separator < 1) continue;
      const namespace = artifact.slice(0, separator + 1);
      if (!owners.has(namespace)) owners.set(namespace, new Set());
      owners.get(namespace).add(skill.name);
    }
  return new Map(
    lifecycleSkills.map((skill) => [
      skill.name,
      [...owners.entries()]
        .filter(
          ([, namespaceOwners]) =>
            namespaceOwners.size === 1 && namespaceOwners.has(skill.name),
        )
        .map(([namespace]) => namespace),
    ]),
  );
}

function ownedSurfaceMatches(skill, request, ownedNamespaces) {
  const systemForms = [
    normalize(skill.system),
    normalize(skill.system).replaceAll("-", " "),
  ].filter(Boolean);
  const systemMatches = [...new Set(systemForms)].filter((surface) => {
    if (surface.split(" ").length > 1) return includesPhrase(request, surface);
    return (
      includesPhrase(request, `${surface} system`) ||
      includesPhrase(request, `system ${surface}`)
    );
  });
  const artifactMatches = [...new Set(outputArtifactPaths(skill))].filter(
    (surface) => includesLiteralSurface(request, surface),
  );
  const namespaceMatches = (ownedNamespaces.get(skill.name) || []).filter(
    (namespace) =>
      includesUnnegatedMatch(
        request,
        new RegExp(`(?<!\\S)${escapeRegExp(namespace)}`, "g"),
      ),
  );
  return [
    ...new Set([...systemMatches, ...artifactMatches, ...namespaceMatches]),
  ];
}

function explicitInvocationMatches(lifecycleSkills, source) {
  const request = String(source || "").toLowerCase();
  const names = lifecycleSkills
    .map((skill) => skill.name)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  const matcher = new RegExp(`(?<![a-z0-9-])\\$?(${names})(?![a-z0-9-])`, "g");
  const lastState = new Map();
  let previousEnd = 0;
  let previousWasNegative = false;
  for (const match of request.matchAll(matcher)) {
    const connector = request.slice(previousEnd, match.index);
    const connectorResidue = connector
      .replace(/\b(?:and|or|nor)\b/g, "")
      .replace(/[,\s]/g, "");
    const coordinated =
      previousWasNegative &&
      connectorResidue === "" &&
      /,|\b(?:and|or|nor)\b/.test(connector);
    const negative = isNegatedAt(request, match.index) || coordinated;
    lastState.set(match[1], negative ? "negative" : "positive");
    previousWasNegative = negative;
    previousEnd = match.index + match[0].length;
  }
  const selected = lifecycleSkills
    .filter((skill) => lastState.get(skill.name) === "positive")
    .sort((left, right) => right.sequence - left.sequence);
  const negated = lifecycleSkills
    .filter((skill) => lastState.get(skill.name) === "negative")
    .map((skill) => skill.name);
  return {
    selected,
    negated,
  };
}

function regularFileWithin(root, target) {
  if (
    !existsSync(target) ||
    lstatSync(target).isSymbolicLink() ||
    !lstatSync(target).isFile()
  )
    return false;
  const relative = path.relative(realpathSync(root), realpathSync(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function runGit(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function collectRegularFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return null;
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) files.push(target);
      else return null;
      if (files.length + pending.length > 10_000) return null;
    }
  }
  return files;
}

function committedCommissioningSnapshot(repoRoot, adapterRoot) {
  const canonicalAdapterRoot = realpathSync(adapterRoot);
  if (path.basename(canonicalAdapterRoot) !== ".valdris-harness")
    return { current: false, reason: "adapter-noncanonical" };
  const targetRoot = path.dirname(canonicalAdapterRoot);
  const head = runGit(targetRoot, ["rev-parse", "HEAD"]);
  if (head.status !== 0 || !/^[a-f0-9]{40,64}$/i.test(head.stdout.trim()))
    return { current: false, reason: "adapter-uncommitted" };

  const manifestPath = path.join(
    canonicalAdapterRoot,
    "commissioning-manifest.json",
  );
  if (!regularFileWithin(canonicalAdapterRoot, manifestPath))
    return { current: false, reason: "adapter-uncommitted" };
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const liveFiles = collectRegularFiles(canonicalAdapterRoot)
      .map((file) =>
        path.relative(canonicalAdapterRoot, file).replaceAll("\\", "/"),
      )
      .filter((file) => file !== "commissioning-manifest.json")
      .sort();
    const packRegistry = JSON.parse(
      readFileSync(
        path.join(canonicalAdapterRoot, "skills", "registry.json"),
        "utf8",
      ),
    );
    const skillNames = [
      ...(packRegistry.skills || []),
      ...(packRegistry.lifecycleSkills || []),
    ].map(({ name }) => name);
    const requiredFiles = [
      "AGENTS.md",
      "CLAUDE.md",
      "commissioning-review.md",
      "package.json",
      "project-adapter.json",
      "skills/registry.json",
      "skills/codex-routing.yaml",
      ...[
        "route-lifecycle-skill.mjs",
        "skill-registry-gate.mjs",
        "run-packet-gate.mjs",
        "proof-runner.mjs",
        "review-gate.mjs",
        "goal-gate.mjs",
        "route-gate.mjs",
        "foundation-gate.mjs",
        "production-layer-gate.mjs",
        "ai-assurance-gate.mjs",
        "authoritative-assurance-gate.mjs",
        "enterprise-ai-gate-all.mjs",
      ].map((file) => `scripts/${file}`),
      ...[
        "assurance-execution-policy.v1.json",
        "authoritative-assurance.v1.json",
        "authority-trust.v1.json",
        "clean-room-behaviors.v1.json",
        "foundation-layer.v1.json",
        "genai-assurance.v1.json",
        "production-layers.v2.json",
        "review-trust.v1.json",
        "workload-taxonomy.v1.json",
      ].map((file) => `controls/${file}`),
      ...skillNames.flatMap((name) => [
        `skills/${name}/SKILL.md`,
        `.agents/skills/${name}/SKILL.md`,
        `.claude/skills/${name}/SKILL.md`,
      ]),
    ];
    if (
      manifest.schema !== "valdris.commissioned-pack-manifest.v1" ||
      requiredFiles.some((file) => !liveFiles.includes(file)) ||
      JSON.stringify(manifest.files.map((entry) => entry.path)) !==
        JSON.stringify(liveFiles)
    )
      return { current: false, reason: "adapter-incomplete" };
    for (const entry of manifest.files) {
      const file = path.join(canonicalAdapterRoot, ...entry.path.split("/"));
      if (
        !/^[a-f0-9]{64}$/.test(entry.sha256 || "") ||
        portableManifestSha256(readFileSync(file)) !== entry.sha256
      )
        return { current: false, reason: "adapter-incomplete" };
    }
    const skillValidation = validateSkillRegistry(
      packRegistry,
      canonicalAdapterRoot,
    );
    if (!skillValidation.valid)
      return { current: false, reason: "adapter-incomplete" };
    validationRuntimeBinding(targetRoot, head.stdout.trim(), {
      runtimeRoot: canonicalAdapterRoot,
    });
    return { current: true, reason: "adapter-current" };
  } catch (error) {
    if (String(error?.message || "").includes(REVIEW_TRUST_SHA256_ENV))
      return { current: false, reason: "adapter-trust-unready" };
    return { current: false, reason: "adapter-uncommitted" };
  }
}

function commissionedAdapter(repoRoot, registry, registryText) {
  const nested = path.join(
    repoRoot,
    ".valdris-harness",
    "project-adapter.json",
  );
  const root = path.join(repoRoot, "project-adapter.json");
  const target = existsSync(nested) ? nested : existsSync(root) ? root : null;
  if (!target)
    return { commissioned: false, adapterPath: null, reason: "adapter-absent" };
  if (!regularFileWithin(repoRoot, target))
    return {
      commissioned: false,
      adapterPath: path.relative(repoRoot, target).replaceAll("\\", "/"),
      reason: "adapter-path-invalid",
    };
  try {
    const adapter = JSON.parse(readFileSync(target, "utf8"));
    const adapterRoot = path.dirname(target);
    const registryTarget = path.resolve(
      adapterRoot,
      adapter.skillRouter?.registry || "",
    );
    const routingTarget = path.resolve(
      adapterRoot,
      adapter.skillRouter?.codexRouting || "",
    );
    const currentWorkflowCount = (registry.skills || []).length;
    const currentLifecycleCount = (registry.lifecycleSkills || []).length;
    const adapterRegistryText = regularFileWithin(adapterRoot, registryTarget)
      ? readFileSync(registryTarget, "utf8")
      : null;
    const adapterRegistry =
      adapterRegistryText && JSON.parse(adapterRegistryText);
    const assetRouting = path.join(ASSET_ROOT, "skills", "codex-routing.yaml");
    const adapterRoutingText = regularFileWithin(adapterRoot, routingTarget)
      ? readFileSync(routingTarget, "utf8")
      : null;
    const assetRoutingText = regularFileWithin(ASSET_ROOT, assetRouting)
      ? readFileSync(assetRouting, "utf8")
      : null;
    const expectedLifecycleCommand =
      path.basename(adapterRoot) === ".valdris-harness"
        ? 'node .valdris-harness/scripts/route-lifecycle-skill.mjs --repo . --request "<request>"'
        : 'node scripts/route-lifecycle-skill.mjs --repo . --request "<request>"';
    const metadataCurrent =
      adapter.schema === "uash.project-adapter.v2" &&
      adapter.skillRouter?.schema === registry.schema &&
      adapter.skillRouter?.registry === "skills/registry.json" &&
      adapter.skillRouter?.codexRouting === "skills/codex-routing.yaml" &&
      adapter.skillRouter?.implicitInvocation === true &&
      adapter.skillRouter?.lifecycleRouteCommand === expectedLifecycleCommand &&
      adapter.skillRouter?.workflowCatalogSize === currentWorkflowCount &&
      adapter.skillRouter?.lifecycleCatalogSize === currentLifecycleCount &&
      adapterRegistry?.schema === registry.schema &&
      (adapterRegistry.skills || []).length === currentWorkflowCount &&
      (adapterRegistry.lifecycleSkills || []).length ===
        currentLifecycleCount &&
      sha256(adapterRegistryText.replace(/\r\n/g, "\n")) ===
        sha256(registryText.replace(/\r\n/g, "\n")) &&
      adapterRoutingText &&
      assetRoutingText &&
      sha256(adapterRoutingText.replace(/\r\n/g, "\n")) ===
        sha256(assetRoutingText.replace(/\r\n/g, "\n"));
    const snapshot = metadataCurrent
      ? committedCommissioningSnapshot(repoRoot, adapterRoot)
      : { current: false, reason: "adapter-stale" };
    const current = metadataCurrent && snapshot.current;
    return {
      commissioned: Boolean(current),
      adapterPath: path.relative(repoRoot, target).replaceAll("\\", "/"),
      reason: current ? "adapter-current" : snapshot.reason,
    };
  } catch {
    return {
      commissioned: false,
      adapterPath: path.relative(repoRoot, target).replaceAll("\\", "/"),
      reason: "adapter-invalid",
    };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/route-lifecycle-skill.mjs [--repo .] (--request <text> | --stage <1-7|system|skill>) [--output run/lifecycle-skill-decision.json]",
    );
  if (!args.request?.trim() && !args.stage?.trim())
    throw new Error("--request or --stage is required");

  const registryPath = path.join(ASSET_ROOT, "skills", "registry.json");
  const registryText = readFileSync(registryPath, "utf8");
  const registry = JSON.parse(registryText);
  const lifecycleSkills = registry.lifecycleSkills || [];
  if (lifecycleSkills.length !== 7)
    throw new Error("lifecycle skill registry must contain exactly 7 skills");
  const ownedNamespaces = uniqueOwnedNamespaces(lifecycleSkills);

  const request = normalize(args.request);
  let selected;
  let matchedTriggers = [];
  let matchedPrimaryFor = [];
  let matchedOwnedSurfaces = [];
  let ignoredNegatedSkills = [];
  let reason;

  if (args.stage) {
    selected = selectExplicit(lifecycleSkills, args.stage);
    if (!selected)
      throw new Error(`unknown lifecycle stage or skill: ${args.stage}`);
    reason = "explicit lifecycle stage";
  } else {
    const explicit = explicitInvocationMatches(lifecycleSkills, args.request);
    ignoredNegatedSkills = explicit.negated;
    if (explicit.selected.length) {
      selected = explicit.selected[0];
      reason = "explicit lifecycle skill invocation";
    } else {
      const negatedNames = new Set(ignoredNegatedSkills);
      const owned = lifecycleSkills
        .filter((skill) => !negatedNames.has(skill.name))
        .map((skill) => ({
          skill,
          matches: ownedSurfaceMatches(skill, request, ownedNamespaces),
        }))
        .filter((candidate) => candidate.matches.length > 0)
        .sort(
          (left, right) =>
            right.skill.sequence - left.skill.sequence ||
            left.skill.name.localeCompare(right.skill.name),
        );
      const ranked = lifecycleSkills
        .filter((skill) => !negatedNames.has(skill.name))
        .map((skill) => scoreSkill(skill, request))
        .filter((candidate) => candidate.phraseCount > 0)
        .sort(
          (left, right) =>
            right.skill.sequence - left.skill.sequence ||
            right.specificity - left.specificity ||
            right.phraseCount - left.phraseCount ||
            left.skill.name.localeCompare(right.skill.name),
        );
      if (owned.length) {
        selected = owned[0].skill;
        matchedOwnedSurfaces = owned[0].matches;
        reason = "deterministic lifecycle owned-surface match";
      } else if (ranked.length) {
        selected = ranked[0].skill;
        matchedTriggers = ranked[0].matchedTriggers;
        matchedPrimaryFor = ranked[0].matchedPrimaryFor;
        reason = "deterministic lifecycle trigger match";
      } else {
        selected = lifecycleSkills.find(
          (skill) =>
            skill.name === registry.lifecycleSelection.ambiguityFallback,
        );
        if (!selected)
          throw new Error(
            `lifecycle ambiguity fallback skill not found in registry: ${registry.lifecycleSelection?.ambiguityFallback}`,
          );
        reason = "lifecycle ambiguity fallback";
      }
    }
  }

  const repoRoot = path.resolve(args.repo);
  const commissioning = commissionedAdapter(repoRoot, registry, registryText);
  const decision = {
    schema: "valdris.lifecycle-skill-decision.v1",
    registrySha256: sha256(registryText.replace(/\r\n/g, "\n")),
    requestSha256: args.request ? sha256(args.request.trim()) : null,
    commissioned: commissioning.commissioned,
    commissionedAdapter: commissioning.adapterPath,
    commissioningReason: commissioning.reason,
    selectedSkill: selected.name,
    sequence: selected.sequence,
    system: selected.system,
    reason,
    matchedTriggers,
    matchedPrimaryFor,
    matchedOwnedSurfaces,
    ignoredNegatedSkills,
    requiredInputs: selected.requiredInputs,
    requiredOutputs: selected.requiredOutputs,
    requiredGates: selected.requiredGates,
    conditionalGates: selected.conditionalGates,
    next: selected.next,
  };

  const serialized = `${JSON.stringify(decision, null, 2)}\n`;
  if (args.output) {
    const output = path.resolve(repoRoot, args.output);
    const allowedOutput = path.join(
      repoRoot,
      "run",
      "lifecycle-skill-decision.json",
    );
    if (output !== allowedOutput)
      throw new Error(
        "--output must be run/lifecycle-skill-decision.json under --repo",
      );
    const outputParent = path.dirname(output);
    if (!existsSync(outputParent))
      throw new Error("--output parent directory must already exist");
    const realRepo = realpathSync(repoRoot);
    const realParent = realpathSync(outputParent);
    if (
      realParent !== realRepo &&
      !realParent.startsWith(`${realRepo}${path.sep}`)
    )
      throw new Error("--output parent resolves outside --repo");
    if (existsSync(output)) {
      const outputStat = lstatSync(output);
      if (outputStat.isSymbolicLink())
        throw new Error("--output must not be a symbolic link");
      if (!outputStat.isFile())
        throw new Error("--output must be a regular file");
      if (outputStat.nlink > 1)
        throw new Error("--output must not be a hard link");
    }
    const temporaryOutput = path.join(
      outputParent,
      `.lifecycle-skill-decision.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      writeFileSync(temporaryOutput, serialized, {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryOutput, output);
    } finally {
      if (existsSync(temporaryOutput)) rmSync(temporaryOutput, { force: true });
    }
  }
  process.stdout.write(serialized);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
