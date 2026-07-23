#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESERVED_FILENAMES = new Set(["index.md", "log.md"]);
const REQUIRED_CONCEPT_FIELDS = ["type", "title", "description"];

function parseArgs(argv) {
  const args = { repo: process.cwd(), root: "knowledge" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--root") args.root = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`OKF vault gate

Usage:
  node scripts/okf-vault-gate.mjs --repo . [--root knowledge]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function normalizeSlash(value) {
  return value.split(path.sep).join("/");
}

function listMarkdownFiles(rootDir, currentDir = rootDir) {
  const files = [];
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory())
      files.push(...listMarkdownFiles(rootDir, fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end === -1) return null;
  const frontmatter = {};
  for (const rawLine of lines.slice(1, end)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body: lines.slice(end + 1).join("\n") };
}

function markdownLinks(text) {
  const links = [];
  const pattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const rawTarget = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, "");
    if (!rawTarget) continue;
    links.push(rawTarget);
  }
  return links;
}

function resolveLinkTarget(bundleRoot, sourceFile, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#"))
    return null;
  const withoutAnchor = target.split("#")[0];
  if (!withoutAnchor) return null;
  const base = withoutAnchor.startsWith("/")
    ? path.join(bundleRoot, withoutAnchor.slice(1))
    : path.resolve(path.dirname(sourceFile), withoutAnchor);
  return withoutAnchor.endsWith("/") ? path.join(base, "index.md") : base;
}

function validateOkfVault(repo, root = "knowledge") {
  const problems = [];
  const warnings = [];
  const bundleRoot = path.resolve(repo, root);

  if (!existsSync(bundleRoot) || !statSync(bundleRoot).isDirectory()) {
    return {
      ok: false,
      root,
      conceptCount: 0,
      indexCount: 0,
      logCount: 0,
      problems: [`OKF vault root missing: ${root}`],
      warnings,
    };
  }

  const rootIndex = path.join(bundleRoot, "index.md");
  const rootLog = path.join(bundleRoot, "log.md");
  if (!existsSync(rootIndex))
    problems.push("root index.md is required for progressive disclosure");
  if (!existsSync(rootLog))
    problems.push("root log.md is required for update history");

  const files = listMarkdownFiles(bundleRoot);
  let conceptCount = 0;
  let indexCount = 0;
  let logCount = 0;

  for (const file of files) {
    const rel = normalizeSlash(path.relative(bundleRoot, file));
    const basename = path.basename(file);
    const text = readFileSync(file, "utf8");

    if (basename === "index.md") {
      indexCount += 1;
      if (!markdownLinks(text).length)
        problems.push(
          `${rel}: index.md must include at least one markdown link`,
        );
      continue;
    }

    if (basename === "log.md") {
      logCount += 1;
      if (!/^## \d{4}-\d{2}-\d{2}/m.test(text))
        problems.push(
          `${rel}: log.md must include ISO date headings like ## YYYY-MM-DD`,
        );
      continue;
    }

    if (RESERVED_FILENAMES.has(basename)) continue;
    conceptCount += 1;
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      problems.push(
        `${rel}: concept documents must start with YAML frontmatter`,
      );
      continue;
    }
    for (const field of REQUIRED_CONCEPT_FIELDS) {
      if (!String(parsed.frontmatter[field] || "").trim())
        problems.push(`${rel}: missing frontmatter field ${field}`);
    }
    if (
      parsed.frontmatter.timestamp &&
      Number.isNaN(Date.parse(parsed.frontmatter.timestamp))
    ) {
      problems.push(`${rel}: timestamp must be ISO 8601 when present`);
    }
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const target of markdownLinks(text)) {
      const resolved = resolveLinkTarget(bundleRoot, file, target);
      if (!resolved) continue;
      if (!resolved.startsWith(bundleRoot)) {
        problems.push(
          `${normalizeSlash(path.relative(bundleRoot, file))}: link escapes knowledge root: ${target}`,
        );
      } else if (!existsSync(resolved)) {
        problems.push(
          `${normalizeSlash(path.relative(bundleRoot, file))}: broken internal link: ${target}`,
        );
      }
    }
  }

  if (conceptCount === 0)
    problems.push("knowledge vault must include at least one concept document");
  return {
    ok: problems.length === 0,
    root,
    conceptCount,
    indexCount,
    logCount,
    problems,
    warnings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = validateOkfVault(args.repo, args.root);
  const output = JSON.stringify(result, null, 2);
  if (!result.ok) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export { validateOkfVault };
