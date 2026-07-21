#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_SCHEMA = "valdris.skill-retirement-manifest.v1";
const ROOT_KINDS = new Set(["codex", "claude"]);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_CANDIDATE_FILES = 10_000;
const MAX_CANDIDATE_BYTES = 64 * 1024 * 1024;

function parseArgs(argv) {
  const args = { repo: process.cwd(), roots: {}, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--manifest") args.manifest = argv[++index];
    else if (arg === "--codex-root") args.roots.codex = argv[++index];
    else if (arg === "--claude-root") args.roots.claude = argv[++index];
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error("unknown skill-retirement argument");
  }
  return args;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertNoSymlinkBoundary(absolute) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("skill-retirement input cannot cross a symbolic-link boundary");
  }
}

function regularExternalManifest(requested, repo) {
  const absolute = path.resolve(requested);
  assertNoSymlinkBoundary(absolute);
  if (!existsSync(absolute)) throw new Error("skill-retirement manifest is missing");
  const stats = lstatSync(absolute);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MANIFEST_BYTES) throw new Error("skill-retirement manifest must be a bounded regular file");
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW || 0);
  const descriptor = openSync(absolute, fsConstants.O_RDONLY | noFollow);
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    const beforeIdentity = identity(absolute);
    if (!openedBefore.isFile() || openedBefore.size > BigInt(MAX_MANIFEST_BYTES) || `${openedBefore.dev}:${openedBefore.ino}:${openedBefore.mode}` !== beforeIdentity) throw new Error("skill-retirement manifest changed before reading");
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    assertNoSymlinkBoundary(absolute);
    if (!existsSync(absolute) || `${openedAfter.dev}:${openedAfter.ino}:${openedAfter.mode}` !== beforeIdentity || identity(absolute) !== beforeIdentity || bytes.length !== Number(openedBefore.size)) throw new Error("skill-retirement manifest changed while reading");
    const real = realpathSync(absolute);
    if (real === repo || isWithin(repo, real)) throw new Error("skill-retirement manifest must remain outside the public repository");
    return { real, bytes };
  } finally {
    closeSync(descriptor);
  }
}

function validateSkillName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === "." || value === ".." || /[. ]$/.test(value) || WINDOWS_RESERVED.test(value)) throw new Error("skill-retirement manifest contains an unsafe skill name");
  return value;
}

function identity(target) {
  const stats = lstatSync(target, { bigint: true });
  return `${stats.dev}:${stats.ino}:${stats.mode}`;
}

function loadRoot(kind, requested) {
  if (!ROOT_KINDS.has(kind) || !requested) throw new Error("every retirement root must be an explicitly configured Codex or Claude skill root");
  const absolute = path.resolve(requested);
  assertNoSymlinkBoundary(absolute);
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) throw new Error("configured skill root must be a real non-symlink directory");
  const real = realpathSync(absolute);
  const parentName = path.basename(path.dirname(real)).toLowerCase();
  if (path.basename(real).toLowerCase() !== "skills" || parentName !== `.${kind}`) throw new Error("configured root must be the skills directory directly under the matching .codex or .claude home");
  return { path: real, identity: identity(real) };
}

function candidateDigest(directory) {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  const visit = (current, prefix = "") => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("retirement candidate contains a symlink and cannot be removed safely");
      hash.update(`${entry.isDirectory() ? "d" : "f"}\0${relative}\0`);
      if (entry.isDirectory()) visit(target, relative);
      else if (entry.isFile()) {
        const stats = lstatSync(target);
        files += 1;
        bytes += stats.size;
        if (files > MAX_CANDIDATE_FILES || bytes > MAX_CANDIDATE_BYTES) throw new Error("retirement candidate exceeded its verification bound");
        hash.update(readFileSync(target));
      } else throw new Error("retirement candidate contains an unsupported filesystem entry");
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function assertRootIdentity(root) {
  assertNoSymlinkBoundary(root.path);
  if (!existsSync(root.path) || identity(root.path) !== root.identity) throw new Error("configured skill root changed during retirement");
}

export function planSkillRetirement(options) {
  if (!options.manifest) throw new Error("an external skill-retirement manifest is required");
  const repo = realpathSync(path.resolve(options.repo));
  const manifest = regularExternalManifest(options.manifest, repo);
  let document;
  try { document = JSON.parse(manifest.bytes.toString("utf8")); }
  catch { throw new Error("skill-retirement manifest must contain valid JSON"); }
  if (!document || typeof document !== "object" || Array.isArray(document) || document.schema !== MANIFEST_SCHEMA || !Array.isArray(document.entries) || document.entries.length > 256) throw new Error(`skill-retirement manifest schema must be ${MANIFEST_SCHEMA} with a bounded entries array`);
  const roots = Object.fromEntries(Object.entries(options.roots).map(([kind, requested]) => [kind, loadRoot(kind, requested)]));
  const seen = new Set();
  const plan = [];
  for (const entry of document.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Array.isArray(entry.roots) || entry.roots.length === 0) throw new Error("skill-retirement entry is invalid");
    const name = validateSkillName(entry.name);
    for (const kind of entry.roots) {
      if (!ROOT_KINDS.has(kind) || !roots[kind]) throw new Error("skill-retirement entry references an unconfigured root");
      const key = `${kind}:${name.toLowerCase()}`;
      if (seen.has(key)) throw new Error("skill-retirement manifest contains an ambiguous case-insensitive match");
      seen.add(key);
      assertRootIdentity(roots[kind]);
      const matches = readdirSync(roots[kind].path, { withFileTypes: true }).filter((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (matches.length > 1) throw new Error("configured skill root contains an ambiguous case-insensitive match");
      if (matches.length === 0) {
        plan.push({ kind, name, target: null, status: "already-absent" });
        continue;
      }
      const target = path.join(roots[kind].path, matches[0].name);
      if (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) throw new Error("retirement candidate must be a real non-symlink skill directory");
      const realTarget = realpathSync(target);
      if (!isWithin(roots[kind].path, realTarget) || path.dirname(realTarget) !== roots[kind].path) throw new Error("retirement candidate escaped or was not a direct child of its configured skill root");
      plan.push({ kind, name, target: realTarget, identity: identity(realTarget), digest: candidateDigest(realTarget), status: options.apply ? "remove" : "would-remove" });
    }
  }
  return { roots, plan };
}

export function applySkillRetirementPlan(prepared) {
  for (const item of prepared.plan.filter((entry) => entry.target)) {
    const root = prepared.roots[item.kind];
    assertRootIdentity(root);
    if (!existsSync(item.target) || identity(item.target) !== item.identity || candidateDigest(item.target) !== item.digest) throw new Error("retirement candidate changed after planning");
    const quarantine = path.join(root.path, `.valdris-retirement-${randomBytes(16).toString("hex")}`);
    if (existsSync(quarantine)) throw new Error("retirement quarantine collision");
    renameSync(item.target, quarantine);
    try {
      assertRootIdentity(root);
      if (identity(quarantine) !== item.identity || candidateDigest(quarantine) !== item.digest) throw new Error("quarantined retirement candidate changed identity");
      rmSync(quarantine, { recursive: true, force: false });
      item.status = "removed";
    } catch (error) {
      if (existsSync(quarantine) && !existsSync(item.target) && identity(quarantine) === item.identity) renameSync(quarantine, item.target);
      throw error;
    }
  }
  return prepared;
}

export function retireSkills(options) {
  const prepared = planSkillRetirement(options);
  if (options.apply) applySkillRetirementPlan(prepared);
  return {
    ok: true,
    schema: "valdris.skill-retirement-result.v1",
    mode: options.apply ? "apply" : "dry-run",
    candidates: prepared.plan.length,
    removed: prepared.plan.filter((entry) => entry.status === "removed").length,
    alreadyAbsent: prepared.plan.filter((entry) => entry.status === "already-absent").length,
    entries: prepared.plan.map(({ kind, status }, index) => ({ ordinal: index + 1, root: kind, status })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/retire-local-skills.mjs --repo . --manifest /outside/retired-skills.json --codex-root ~/.codex/skills [--claude-root ~/.claude/skills] [--apply]");
    return;
  }
  console.log(JSON.stringify(retireSkills(args), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  void error;
  console.error(JSON.stringify({ ok: false, gate: "skill-retirement", problems: ["skill-retirement validation failed closed"] }));
  process.exit(1);
});
