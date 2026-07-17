#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
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

const PUBLIC_BINARY_ASSETS = new Map([
  ["docs/assets/flow-monitor-screenshot.png", "df55a27b364f2a0d4151758e71ee9182ea623abbce689fe2ab3b5c6706b75c0c"],
]);

const APPROVED_OPERATIONAL_FIXTURE_PATHS = new Set([
  "runs/_run-template/README.md",
]);

const EXAMPLE_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.invalid",
]);

const EXACT_SECRET_PLACEHOLDERS = new Set([
  "<redacted>",
  "[redacted]",
  "<placeholder>",
  "[placeholder]",
]);

const CONTENT_DETECTORS = [
  { id: "private-key", category: "secret", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi },
  { id: "aws-access-key", category: "secret", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-token", category: "secret", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g },
  { id: "provider-key", category: "secret", pattern: /\bsk-[A-Za-z0-9_-]{20,255}\b/g },
  { id: "bearer-token", category: "secret", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi },
  {
    id: "secret-assignment",
    category: "secret",
    pattern: /\b(?:access[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?key|password)\b\s*["']?\s*[:=]\s*["']?((?:<[^>\r\n]+>|\[[^\]\r\n]+\]|\$\{[^}\r\n]+\}|[^\s"',;}]{8,}))/gi,
  },
  { id: "windows-user-path", category: "local-user-path", pattern: /\b[A-Za-z]:(?:\\{1,4}|\/)Users(?:\\{1,4}|\/)[^\s"'`,;]+/gi },
  { id: "unix-user-path", category: "local-user-path", pattern: /\/(?:Users|home)\/[^/\s"'`,;]+(?:\/[^\s"'`,;]*)?/gi },
  { id: "email", category: "non-example-email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: "uuid", category: "non-example-id", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi },
  {
    id: "named-id",
    category: "non-example-id",
    pattern: /\b(?:user|customer|account|tenant|employee|run|thread|session)[_-]?id\b\s*["']?\s*[:=]\s*["']?((?=[A-Za-z0-9_.:-]{6,}(?:["'\s,;}\]]|$))(?=[A-Za-z0-9_.:-]*\d)[A-Za-z0-9][A-Za-z0-9_.:-]{5,})/gi,
  },
];

function parseArgs(argv) {
  const args = { repo: process.cwd(), includes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--include") args.includes.push(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function resolveIncludedPath(repo, value) {
  const requested = String(value || "").replaceAll("\\", "/");
  if (!requested || requested.includes("\0") || path.isAbsolute(requested) || /^[A-Za-z]:/.test(requested)) {
    throw new Error(`privacy include path must be a non-empty relative path: ${JSON.stringify(value)}`);
  }
  const segments = requested.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`privacy include path contains an unsafe segment: ${JSON.stringify(value)}`);
  }
  const target = path.resolve(repo, ...segments);
  const relative = path.relative(repo, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`privacy include path must stay inside the repository: ${JSON.stringify(value)}`);
  }
  return { target, normalized: normalize(relative) };
}

function collectFiles(repo, includes = []) {
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
  function addTrackedFiles() {
    const worktree = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", shell: false, timeout: 30_000, killSignal: "SIGTERM" });
    if (worktree.status !== 0) return;
    const tracked = spawnSync("git", ["-C", repo, "ls-files", "-z", "--", "."], { encoding: "utf8", shell: false, timeout: 30_000, killSignal: "SIGTERM" });
    if (tracked.status !== 0) throw new Error(`privacy gate could not enumerate tracked files: ${(tracked.stderr || tracked.stdout || "git ls-files failed").trim()}`);
    for (const entry of tracked.stdout.split("\0").filter(Boolean)) {
      const target = path.resolve(repo, entry);
      const relative = path.relative(repo, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const stats = lstatSync(target);
      if (stats.isSymbolicLink()) symlinks.push(target);
      else if (stats.isFile()) files.push(target);
    }
  }
  const scope = [];
  if (includes.length === 0) {
    visit(repo);
    addTrackedFiles();
  } else {
    const realRepo = realpathSync(repo);
    for (const include of includes) {
      const resolved = resolveIncludedPath(repo, include);
      scope.push(resolved.normalized);
      const stats = lstatSync(resolved.target);
      if (stats.isSymbolicLink()) {
        symlinks.push(resolved.target);
        continue;
      }
      const realTarget = realpathSync(resolved.target);
      const realRelative = path.relative(realRepo, realTarget);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new Error(`privacy include path escapes the repository: ${JSON.stringify(include)}`);
      }
      if (stats.isDirectory()) visit(resolved.target);
      else if (stats.isFile()) files.push(resolved.target);
      else throw new Error(`privacy include path must resolve to a regular file or directory: ${JSON.stringify(include)}`);
    }
  }
  return {
    files: [...new Set(files)].sort(),
    symlinks: [...new Set(symlinks)].sort(),
    scope: [...new Set(scope)].sort(),
  };
}

function allMatches(pattern, value) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...String(value).matchAll(new RegExp(pattern.source, flags))];
}

function isVerificationFixturePath(relativePath) {
  return /^scripts\/verify-[^/]+\.mjs$/i.test(relativePath) || /^examples\//i.test(relativePath);
}

function isExactSecretPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return EXACT_SECRET_PLACEHOLDERS.has(normalized)
    || /^\$\{[a-z_][a-z0-9_]*\}$/i.test(normalized)
    || /^process\.env\.[a-z_][a-z0-9_]*$/i.test(normalized);
}

function isExplicitExampleIdentifier(value, relativePath) {
  const normalized = String(value || "").trim();
  if (/^EXAMPLE(?:[-_.:][A-Z0-9]+)+$/i.test(normalized)) return true;
  return isVerificationFixturePath(relativePath) && /^(?:SYNTHETIC|FIXTURE|VERIFY)(?:[-_.:][A-Z0-9]+)+$/i.test(normalized);
}

function isAllowedMatch(detector, match, relativePath) {
  const matchedValue = match[0];
  if (detector.id === "secret-assignment") {
    const assignedValue = match[1];
    if (isExactSecretPlaceholder(assignedValue)) return true;
    return isVerificationFixturePath(relativePath) && /^fixture-[a-z0-9_-]+$/i.test(assignedValue || "");
  }
  if (detector.id === "email") {
    return EXAMPLE_EMAIL_DOMAINS.has(matchedValue.split("@").at(-1)?.toLowerCase());
  }
  if (detector.id === "uuid") return /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(matchedValue);
  if (detector.id === "named-id") return isExplicitExampleIdentifier(match[1], relativePath);
  if (detector.category === "local-user-path") {
    return /(?:[\\/])(?:<user>|\$\{user\})(?:[\\/]|$)/i.test(matchedValue);
  }
  return false;
}

function isApprovedOperationalFixturePath(relativePath) {
  return APPROVED_OPERATIONAL_FIXTURE_PATHS.has(relativePath);
}

function pathContainsPrivateValue(relativePath) {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(relativePath)) return true;
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(relativePath)) return true;
  if (/^(?:runs|logs)\//i.test(relativePath) && !isApprovedOperationalFixturePath(relativePath)) return true;
  return false;
}

function redactedFinding(category, relativePath, line, matchedValue) {
  const safeCategory = category.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  return {
    category,
    path: pathContainsPrivateValue(relativePath) || category === "raw-operational-evidence" ? "[REDACTED_PATH]" : relativePath,
    line,
    redacted: `[REDACTED:${safeCategory}]`,
    fingerprint: createHash("sha256").update(`${category}\0${relativePath}\0${line}\0${matchedValue}`).digest("hex").slice(0, 12),
  };
}

function classifyContent(target) {
  const bytes = readFileSync(target);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.includes(0)) return { binary: true, digest, size: bytes.length };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[^\t\n\r\x20-\x7e\x80-\u{10ffff}]/u.test(text)) return { binary: true, digest, size: bytes.length };
    return { binary: false, text };
  } catch {
    return { binary: true, digest, size: bytes.length };
  }
}

export function validatePrivacy(repo, options = {}) {
  const resolvedRepo = path.resolve(repo);
  const findings = [];
  let scannedFiles = 0;
  let binaryFiles = 0;
  let approvedBinaryFiles = 0;
  let unapprovedBinaryFiles = 0;
  const collected = collectFiles(resolvedRepo, options.includes || []);
  for (const target of collected.symlinks) {
    const relativePath = normalize(path.relative(resolvedRepo, target));
    findings.push(redactedFinding("unapproved-symlink", relativePath, 0, relativePath));
  }
  for (const target of collected.files) {
    const relativePath = normalize(path.relative(resolvedRepo, target));
    const content = classifyContent(target);
    if (content.binary) {
      binaryFiles += 1;
      const approvedDigest = PUBLIC_BINARY_ASSETS.get(relativePath);
      if (approvedDigest && approvedDigest === content.digest) {
        approvedBinaryFiles += 1;
      } else {
        unapprovedBinaryFiles += 1;
        findings.push(redactedFinding("unapproved-binary", relativePath, 0, `${content.digest}:${content.size}`));
      }
      continue;
    }
    scannedFiles += 1;
    if (/^(?:runs|logs)\//i.test(relativePath) && !isApprovedOperationalFixturePath(relativePath)) {
      findings.push(redactedFinding("raw-operational-evidence", relativePath, 0, relativePath));
    }
    const lines = content.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const detector of CONTENT_DETECTORS) {
        for (const match of allMatches(detector.pattern, line)) {
          if (isAllowedMatch(detector, match, relativePath)) continue;
          findings.push(redactedFinding(detector.category, relativePath, index + 1, match[0]));
        }
      }
    }
  }
  return {
    ok: findings.length === 0,
    gate: "import-privacy",
    scannedFiles,
    binaryFiles,
    approvedBinaryFiles,
    unapprovedBinaryFiles,
    binaryPolicy: "fail-closed-exact-public-asset-allowlist",
    symlinkFiles: collected.symlinks.length,
    scope: {
      mode: collected.scope.length > 0 ? "include" : "repository",
      paths: collected.scope,
    },
    findings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/privacy-gate.mjs --repo . [--include relative/file-or-directory ...]");
    return;
  }
  const output = validatePrivacy(path.resolve(args.repo), { includes: args.includes });
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(JSON.stringify({ ok: false, gate: "import-privacy", findings: [{ category: "gate-error", path: "[REDACTED_PATH]", line: 0, redacted: "[REDACTED:GATE_ERROR]", fingerprint: createHash("sha256").update(error.name).digest("hex").slice(0, 12) }] }, null, 2));
    process.exitCode = 1;
  });
}
