#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existingFileWithinRepo, gateResult, nonEmpty, parseRepoFileArgs, readJson, resolveWithinRepo } from "./control-gate-lib.mjs";

export const SKILL_REGISTRY_SCHEMA = "uash.skill-registry.v1";

function frontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const index = line.indexOf(":");
    return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")] : null;
  }).filter(Boolean));
}

export function validateSkillRegistry(document, repoRoot) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, skillCount: 0, problems: ["skill registry must be a JSON object"] };
  if (document.schema !== SKILL_REGISTRY_SCHEMA) problems.push(`skill registry schema must be ${SKILL_REGISTRY_SCHEMA}`);
  if (!Array.isArray(document.skills) || document.skills.length < 5 || document.skills.length > 8) problems.push("skill registry must contain 5-8 selectable skills");
  if (document.selection?.maxPrimary !== 1) problems.push("skill registry selection.maxPrimary must be 1");
  if (document.selection?.maxSupporting !== 4) problems.push("skill registry selection.maxSupporting must be 4");
  if (!Array.isArray(document.selection?.phaseTransitions) || document.selection.phaseTransitions.length < 2) problems.push("skill registry must declare phaseTransitions");
  const seen = new Set();
  for (const skill of document.skills || []) {
    const name = nonEmpty(skill?.name);
    if (!/^[a-z0-9-]+$/.test(name)) problems.push(`skill has invalid name: ${name || "missing"}`);
    if (seen.has(name)) problems.push(`skill duplicated: ${name}`);
    seen.add(name);
    const target = resolveWithinRepo(repoRoot, nonEmpty(skill?.path));
    if (!target || !existingFileWithinRepo(repoRoot, target)) {
      problems.push(`skill path missing or outside repo: ${skill?.path || "missing"}`);
      continue;
    }
    const metadata = frontmatter(readFileSync(target, "utf8"));
    if (metadata.name !== name) problems.push(`skill ${name} frontmatter name does not match registry`);
    if (!nonEmpty(metadata.description)) problems.push(`skill ${name} frontmatter description is required`);
    for (const field of ["primaryFor", "triggers", "requiredGates", "redZoneTriggers"]) if (!Array.isArray(skill[field])) problems.push(`skill ${name}.${field} must be an array`);
    if (!skill.primaryFor?.length) problems.push(`skill ${name} must declare primaryFor`);
    if (!skill.triggers?.length) problems.push(`skill ${name} must declare triggers`);
    if (!skill.requiredGates?.length) problems.push(`skill ${name} must declare requiredGates`);
  }
  if (document.selection?.catalogSize !== (document.skills || []).length) problems.push("skill registry selection.catalogSize must match skills length");
  return { valid: problems.length === 0, schema: document.schema, skillCount: seen.size, skills: Array.from(seen), problems };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "skills/registry.json" });
  if (args.help) return console.log("Usage: node scripts/skill-registry-gate.mjs --repo . [--file skills/registry.json]");
  const repoRoot = path.resolve(args.repo);
  const requestedTarget = path.resolve(repoRoot, args.file);
  const assetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = args.file === "skills/registry.json" ? path.join(assetRoot, "skills", "registry.json") : requestedTarget;
  if (!existsSync(target)) return gateResult(args.file, { valid: false, skillCount: 0, problems: [`skill registry missing: ${args.file}`] });
  try {
    gateResult(args.file, validateSkillRegistry(readJson(target), path.resolve(target, "..", "..")));
  } catch (error) {
    gateResult(args.file, { valid: false, skillCount: 0, problems: [`skill registry must be valid JSON: ${error.message}`] });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
