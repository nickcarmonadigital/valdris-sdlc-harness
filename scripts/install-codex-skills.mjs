#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const args = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") args.target = argv[++index];
    else if (arg === "--check") args.check = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function filesUnder(root, prefix = "") {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...filesUnder(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function compareSkill(source, target) {
  const sourceFiles = filesUnder(source);
  const targetFiles = filesUnder(target);
  const problems = [];
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles))
    problems.push("file list differs");
  for (const relative of sourceFiles) {
    const targetFile = path.join(target, relative);
    if (!fs.existsSync(targetFile))
      problems.push(`missing ${relative.replaceAll("\\", "/")}`);
    else if (digest(path.join(source, relative)) !== digest(targetFile))
      problems.push(`content differs ${relative.replaceAll("\\", "/")}`);
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/install-codex-skills.mjs [--target <CODEX_HOME>/skills] [--check]",
    );
  const codexHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  const targetRoot = path.resolve(
    args.target || path.join(codexHome, "skills"),
  );
  if (targetRoot === path.parse(targetRoot).root)
    throw new Error(
      "Refusing to use a filesystem root as the Codex skills target",
    );
  const registry = JSON.parse(
    fs.readFileSync(path.join(ASSET_ROOT, "skills", "registry.json"), "utf8"),
  );
  const installEntries = registry.skills.map((skill) => ({
    name: skill.name,
    source: path.resolve(ASSET_ROOT, path.dirname(skill.path)),
  }));
  const metaSkillSource = path.join(
    ASSET_ROOT,
    "meta-skills",
    "valdris-sdlc-harness",
  );
  if (fs.existsSync(metaSkillSource))
    installEntries.push({
      name: "valdris-sdlc-harness",
      source: metaSkillSource,
    });
  const expectedNames = new Set(installEntries.map((entry) => entry.name));
  expectedNames.add("valdris-sdlc-harness");
  const results = [];
  const globalProblems = [];
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith("valdris-") || expectedNames.has(entry.name))
      continue;
    if (args.check)
      globalProblems.push(
        `unregistered installed Valdris skill: ${entry.name}`,
      );
    else
      fs.rmSync(path.join(targetRoot, entry.name), {
        recursive: true,
        force: true,
      });
  }
  for (const entry of installEntries) {
    if (!/^[a-z0-9-]+$/.test(entry.name))
      throw new Error(`Invalid skill name: ${entry.name}`);
    const target = path.resolve(targetRoot, entry.name);
    if (path.dirname(target) !== targetRoot)
      throw new Error(`Skill target escapes install root: ${entry.name}`);
    if (!args.check) {
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(entry.source, target, { recursive: true });
    }
    const problems = compareSkill(entry.source, target);
    results.push({
      name: entry.name,
      status: problems.length ? "drifted" : "synced",
      problems,
    });
  }
  const drifted = results.filter((result) => result.problems.length);
  console.log(
    JSON.stringify(
      {
        ok: drifted.length === 0 && globalProblems.length === 0,
        mode: args.check ? "check" : "sync",
        targetRoot,
        skills: results,
        problems: globalProblems,
      },
      null,
      2,
    ),
  );
  if (drifted.length || globalProblems.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
