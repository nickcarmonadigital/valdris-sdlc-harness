#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IGNORED_DIRS = new Set([
  ".git",
  ".gitnexus",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".vite",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "node_modules",
  "vendor",
  "coverage",
  "__pycache__",
  "venv",
]);

const GENERIC_LANE_SUFFIXES = new Set([
  "adapter",
  "adapters",
  "agnostic",
  "communications",
  "compute",
  "configured",
  "governance",
  "integration",
  "integrations",
  "permissions",
  "platform",
  "provider",
  "runtime",
  "service",
  "services",
  "storage",
]);

const GENERIC_PROVIDER_VALUES = new Set([
  "adapter",
  "agnostic",
  "commissioned",
  "configurable",
  "configured",
  "managed",
  "platform",
  "project-specific",
  "provider",
  "runtime",
  "service",
]);

const KNOWN_PROVIDER_SUFFIXES = new Set([
  joined("acme", "db"),
  joined("a", "ws"),
  joined("az", "ure"),
  joined("cloud", "flare"),
  joined("gc", "p"),
  joined("git", "hub"),
  joined("line", "ar"),
  joined("n", "8n"),
  joined("re", "dis"),
  joined("stri", "pe"),
  joined("supa", "base"),
  joined("tem", "poral"),
  joined("ver", "cel"),
]);

function joined(...parts) {
  return parts.join("");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allMatches(pattern, value) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...String(value).matchAll(new RegExp(pattern.source, flags))];
}

function buildGenericDetectors() {
  const branchTokens = [joined("sta", "ging"), joined("ma", "in"), joined("prod", "uction")];
  const topology = new RegExp(`\\b${branchTokens[0]}\\b.{0,80}(?:-{1,2}>|→|\\bto\\b).{0,80}\\b${branchTokens[1]}\\b.{0,80}(?:-{1,2}>|→|\\bto\\b).{0,80}\\b${branchTokens[2]}\\b`, "gi");
  const lanePrefixes = [
    joined("da", "ta"),
    joined("voi", "ce"),
    joined("de", "ploy"),
    joined("host", "ing"),
    joined("data", "base"),
    joined("cl", "oud"),
    joined("que", "ue"),
    joined("pay", "ment"),
  ];
  const lane = new RegExp(`\\b(?:${lanePrefixes.join("|")})-([a-z][a-z0-9]*)\\b`, "gi");
  const providerKeys = [joined("data", "base"), joined("voi", "ce"), joined("deploy", "ment"), joined("host", "ing"), joined("ticket", "ing"), joined("pay", "ment")];
  const provider = new RegExp(`\\b(?:${providerKeys.join("|")})[_ -]?provider\\b\\s*["']?\\s*[:=]\\s*["']?([a-z][a-z0-9._-]{1,63})`, "gi");
  return [
    { category: "fixed-branch-topology", find: (value) => allMatches(topology, value) },
    {
      category: "fixed-provider-lane",
      find(value) {
        return allMatches(lane, value).filter((match) => {
          const suffix = match[1]?.toLowerCase();
          return !GENERIC_LANE_SUFFIXES.has(suffix) && KNOWN_PROVIDER_SUFFIXES.has(suffix);
        });
      },
    },
    {
      category: "fixed-provider-assumption",
      find(value, context) {
        if (context.mode === "commissioned" && /^(?:project-adapter\.json|project\.ya?ml)$/i.test(context.relativePath)) return [];
        return allMatches(provider, value).filter((match) => !GENERIC_PROVIDER_VALUES.has(match[1].toLowerCase()));
      },
    },
  ];
}

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    restrictedValuesFile: process.env.VALDRIS_RESTRICTED_VALUES_FILE || null,
    mode: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--restricted-values") args.restrictedValuesFile = argv[++index];
    else if (argv[index] === "--mode") args.mode = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.mode && !["public", "commissioned"].includes(args.mode)) throw new Error("--mode must be public or commissioned");
  return args;
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function collectFiles(repo) {
  const files = [];
  const symlinks = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        symlinks.push(target);
        continue;
      }
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  visit(repo);
  return { files: [...new Set(files)].sort(), symlinks: [...new Set(symlinks)].sort() };
}

function loadRestrictedDetectors(file) {
  if (!file) return [];
  const parsed = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("restricted-values document must be an object");
  const values = parsed.values ?? [];
  const issuePrefixes = parsed.issuePrefixes ?? [];
  if (!Array.isArray(values) || !Array.isArray(issuePrefixes)) throw new Error("restricted-values arrays are invalid");
  if (values.length + issuePrefixes.length > 512) throw new Error("restricted-values document exceeds the entry limit");
  const detectors = [];
  for (const raw of values) {
    if (typeof raw !== "string" || raw.trim().length < 3 || raw.trim().length > 200) throw new Error("restricted value has an invalid shape");
    const pattern = new RegExp(escapeRegex(raw.trim()), "gi");
    detectors.push({ category: "restricted-value", find: (value) => allMatches(pattern, value) });
  }
  for (const raw of issuePrefixes) {
    if (typeof raw !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(raw)) throw new Error("restricted issue prefix has an invalid shape");
    const pattern = new RegExp(`\\b${escapeRegex(raw)}-[A-Z0-9][A-Z0-9_-]*\\b`, "gi");
    detectors.push({ category: "restricted-issue-id", find: (value) => allMatches(pattern, value) });
  }
  return detectors;
}

function redactedFinding(category, relativePath, line, matchedValue, pathSensitive) {
  const safeCategory = category.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  return {
    category,
    path: pathSensitive ? "[REDACTED_PATH]" : relativePath,
    line,
    redacted: `[REDACTED:${safeCategory}]`,
    fingerprint: createHash("sha256").update(`${category}\0${relativePath}\0${line}\0${matchedValue}`).digest("hex").slice(0, 12),
  };
}

function classifyContent(target) {
  const bytes = readFileSync(target);
  if (bytes.includes(0)) return { binary: true };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[^\t\n\r\x20-\x7e\x80-\u{10ffff}]/u.test(text)) return { binary: true };
    return { binary: false, text };
  } catch {
    return { binary: true };
  }
}

export function validateNeutrality(repo, options = {}) {
  const resolvedRepo = path.resolve(repo);
  const mode = options.mode || (existsSync(path.join(resolvedRepo, "project-adapter.json")) ? "commissioned" : "public");
  const restrictedDetectors = loadRestrictedDetectors(options.restrictedValuesFile || process.env.VALDRIS_RESTRICTED_VALUES_FILE || null);
  const detectors = [...restrictedDetectors, ...buildGenericDetectors()];
  const findings = [];
  let scannedFiles = 0;
  let binaryFiles = 0;
  const collected = collectFiles(resolvedRepo);
  for (const target of collected.symlinks) {
    const relativePath = normalize(path.relative(resolvedRepo, target));
    findings.push(redactedFinding("unapproved-symlink", relativePath, 0, relativePath, true));
  }
  for (const target of collected.files) {
    const relativePath = normalize(path.relative(resolvedRepo, target));
    const context = { mode, relativePath };
    const pathMatches = detectors.flatMap((detector) => detector.find(relativePath, context).map((match) => ({ detector, match })));
    const pathSensitive = pathMatches.some(({ detector }) => detector.category.startsWith("restricted-"));
    for (const { detector, match } of pathMatches) findings.push(redactedFinding(detector.category, relativePath, 0, match[0], pathSensitive));
    const content = classifyContent(target);
    if (content.binary) {
      binaryFiles += 1;
      continue;
    }
    scannedFiles += 1;
    const lines = content.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const detector of detectors) {
        for (const match of detector.find(lines[index], context)) {
          findings.push(redactedFinding(detector.category, relativePath, index + 1, match[0], pathSensitive));
        }
      }
    }
  }
  return {
    ok: findings.length === 0,
    gate: "import-neutrality",
    mode,
    scannedFiles,
    binaryFiles,
    binaryPolicy: "deferred-to-import-privacy",
    symlinkFiles: collected.symlinks.length,
    findings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/neutrality-gate.mjs --repo . [--mode public|commissioned] [--restricted-values /outside/repo/restricted-values.json]");
    return;
  }
  const output = validateNeutrality(path.resolve(args.repo), args);
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(JSON.stringify({ ok: false, gate: "import-neutrality", findings: [{ category: "gate-error", path: "[REDACTED_PATH]", line: 0, redacted: "[REDACTED:GATE_ERROR]", fingerprint: createHash("sha256").update(error.name).digest("hex").slice(0, 12) }] }, null, 2));
    process.exitCode = 1;
  });
}
