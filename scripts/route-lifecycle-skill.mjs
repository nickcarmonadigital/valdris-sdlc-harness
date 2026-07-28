#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function scoreSkill(skill, request) {
  const matchedTriggers = (skill.triggers || []).filter((trigger) =>
    request.includes(normalize(trigger)),
  );
  const matchedPrimaryFor = (skill.primaryFor || []).filter((phrase) =>
    request.includes(normalize(phrase)),
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
    const current =
      adapter.schema === "uash.project-adapter.v2" &&
      adapter.skillRouter?.schema === registry.schema &&
      adapter.skillRouter?.registry === "skills/registry.json" &&
      adapter.skillRouter?.codexRouting === "skills/codex-routing.yaml" &&
      adapter.skillRouter?.implicitInvocation === true &&
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
    return {
      commissioned: Boolean(current),
      adapterPath: path.relative(repoRoot, target).replaceAll("\\", "/"),
      reason: current ? "adapter-current" : "adapter-stale",
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

  const request = normalize(args.request);
  let selected;
  let matchedTriggers = [];
  let matchedPrimaryFor = [];
  let reason;

  if (args.stage) {
    selected = selectExplicit(lifecycleSkills, args.stage);
    if (!selected)
      throw new Error(`unknown lifecycle stage or skill: ${args.stage}`);
    reason = "explicit lifecycle stage";
  } else {
    const explicit = lifecycleSkills.find((skill) =>
      new RegExp(`(?:^|\\s)${skill.name}(?:\\s|$)`, "i").test(request),
    );
    if (explicit) {
      selected = explicit;
      reason = "explicit lifecycle skill invocation";
    } else {
      const ranked = lifecycleSkills
        .map((skill) => scoreSkill(skill, request))
        .filter((candidate) => candidate.phraseCount > 0)
        .sort(
          (left, right) =>
            right.skill.sequence - left.skill.sequence ||
            right.specificity - left.specificity ||
            right.phraseCount - left.phraseCount ||
            left.skill.name.localeCompare(right.skill.name),
        );
      if (ranked.length) {
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
    if (existsSync(output) && lstatSync(output).isSymbolicLink())
      throw new Error("--output must not be a symbolic link");
    writeFileSync(output, serialized, { flag: "w" });
  }
  process.stdout.write(serialized);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
