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
  [
    "docs/assets/flow-monitor-screenshot.png",
    "df55a27b364f2a0d4151758e71ee9182ea623abbce689fe2ab3b5c6706b75c0c",
  ],
  [
    "docs/assets/readme/valdris-proof-to-done-flow.png",
    "9efddedc021a3ab3467a001f731158153a65474402bead060dfb9725e3c55659",
  ],
  [
    "docs/assets/readme/valdris-durable-goal-routing-loop.png",
    "5b540dcd945b2859152f24bb2f5ebbfd73e130f9eb087d11f3af22d64af9e055",
  ],
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

const CONNECTION_CREDENTIAL_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|mssql):\/\/([^:\s"'`@\/]*):([^@\s"'`\/]+)@[^\s"'`<>]+/gi;

const CONTENT_DETECTORS = [
  {
    id: "private-key",
    category: "secret",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  },
  {
    id: "aws-access-key",
    category: "secret",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "github-token",
    category: "secret",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g,
  },
  {
    id: "github-fine-grained-token",
    category: "secret",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
  },
  {
    id: "provider-key",
    category: "secret",
    pattern: /\bsk-[A-Za-z0-9_-]{20,255}\b/g,
  },
  {
    id: "bearer-token",
    category: "secret",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  },
  {
    id: "secret-assignment",
    category: "secret",
    pattern:
      /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:access[_-]?token|refresh[_-]?token|api[_-]?key|auth|authorization|client[_-]?secret|private[_-]?key|password|credentials?|secret|token|dsn|connection[_-]?(?:string|url)|(?:database|db|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|cache|mssql)[_-]?(?:url|dsn))\b\s*["']?\s*[:=]\s*(?:(?:\\+)?["'])?((?:<[^>\r\n]+>|\[[^\]\r\n]+\]|\$\{\{[^}\r\n]+\}\}|\$\{[^}\r\n]+\}|[^\s\\"',;}]{8,}))/gi,
  },
  {
    id: "connection-credential",
    category: "secret",
    pattern: CONNECTION_CREDENTIAL_PATTERN,
  },
  {
    id: "windows-user-path",
    category: "local-user-path",
    pattern: /\b[A-Za-z]:(?:\\{1,4}|\/)Users(?:\\{1,4}|\/)[^\s"'`,;]+/gi,
  },
  {
    id: "unix-user-path",
    category: "local-user-path",
    pattern:
      /(?<![A-Za-z0-9._~\/-])(?:\/(?:Users|home)\/[^/\s"'`,;]+(?:\/[^\s"'`,;]*)?|\/r[o]ot(?=\/|[\s"'`,;<>()\[\]{}]|$)(?:\/[^\s"'`,;<>()\[\]{}]*)?)/gi,
  },
  {
    id: "email",
    category: "non-example-email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    id: "uuid",
    category: "non-example-id",
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  },
  {
    id: "named-id",
    category: "non-example-id",
    pattern:
      /\b(?:user|customer|account|tenant|employee|run|thread|session)[_-]?id\b\s*["']?\s*[:=]\s*["']?((?=[A-Za-z0-9_.:-]{6,}(?:["'\s,;}\]]|$))(?=[A-Za-z0-9_.:-]*\d)[A-Za-z0-9][A-Za-z0-9_.:-]{5,})/gi,
  },
];

const RELEASE_ARTIFACT_DETECTOR_IDS = new Set([
  "private-key",
  "aws-access-key",
  "github-token",
  "github-fine-grained-token",
  "provider-key",
  "bearer-token",
  "secret-assignment",
  "connection-credential",
  "windows-user-path",
  "unix-user-path",
]);

const RELEASE_ARTIFACT_DETECTORS = CONTENT_DETECTORS.filter((detector) =>
  RELEASE_ARTIFACT_DETECTOR_IDS.has(detector.id),
);

const RELEASE_ARTIFACT_EXCLUDED_ROOT_DIRS = new Set([
  "cache",
  "dev",
  "diagnostics",
  "types",
]);

const RELEASE_ARTIFACT_EXCLUDED_FILE_PATTERNS = [
  /\.nft\.json$/i,
  /^trace(?:$|-)/i,
  /\.tsbuildinfo$/i,
];

const RELEASE_ARTIFACT_BINARY_EXTENSIONS = new Set([
  ".avif",
  ".br",
  ".eot",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

function parseArgs(argv) {
  const args = { repo: process.cwd(), includes: [], releaseArtifact: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--include") args.includes.push(argv[++index]);
    else if (argv[index] === "--release-artifact") {
      if (args.releaseArtifact !== null)
        throw new Error("--release-artifact may only be provided once");
      args.releaseArtifact = argv[++index];
    } else if (argv[index] === "--help" || argv[index] === "-h")
      args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.releaseArtifact !== null && args.includes.length > 0) {
    throw new Error("--release-artifact cannot be combined with --include");
  }
  return args;
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function resolveIncludedPath(repo, value) {
  const requested = String(value || "").replaceAll("\\", "/");
  if (
    !requested ||
    requested.includes("\0") ||
    path.isAbsolute(requested) ||
    /^[A-Za-z]:/.test(requested)
  ) {
    throw new Error(
      `privacy include path must be a non-empty relative path: ${JSON.stringify(value)}`,
    );
  }
  const segments = requested.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(
      `privacy include path contains an unsafe segment: ${JSON.stringify(value)}`,
    );
  }
  const target = path.resolve(repo, ...segments);
  const relative = path.relative(repo, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `privacy include path must stay inside the repository: ${JSON.stringify(value)}`,
    );
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
    const worktree = spawnSync(
      "git",
      ["-C", repo, "rev-parse", "--is-inside-work-tree"],
      {
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        killSignal: "SIGTERM",
      },
    );
    if (worktree.status !== 0) return;
    const tracked = spawnSync(
      "git",
      ["-C", repo, "ls-files", "-z", "--", "."],
      {
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        killSignal: "SIGTERM",
      },
    );
    if (tracked.status !== 0)
      throw new Error(
        `privacy gate could not enumerate tracked files: ${(tracked.stderr || tracked.stdout || "git ls-files failed").trim()}`,
      );
    for (const entry of tracked.stdout.split("\0").filter(Boolean)) {
      const target = path.resolve(repo, entry);
      const relative = path.relative(repo, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        continue;
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
      if (
        !realRelative ||
        realRelative.startsWith("..") ||
        path.isAbsolute(realRelative)
      ) {
        throw new Error(
          `privacy include path escapes the repository: ${JSON.stringify(include)}`,
        );
      }
      if (stats.isDirectory()) visit(resolved.target);
      else if (stats.isFile()) files.push(resolved.target);
      else
        throw new Error(
          `privacy include path must resolve to a regular file or directory: ${JSON.stringify(include)}`,
        );
    }
  }
  return {
    files: [...new Set(files)].sort(),
    symlinks: [...new Set(symlinks)].sort(),
    scope: [...new Set(scope)].sort(),
  };
}

function isReleaseArtifactGeneratedNoise(relativeToArtifact, entry) {
  const segments = normalize(relativeToArtifact).split("/");
  if (entry.isDirectory()) {
    if (
      segments.length === 1 &&
      RELEASE_ARTIFACT_EXCLUDED_ROOT_DIRS.has(segments[0])
    )
      return true;
    if (segments[0] === "standalone" && segments[1] === "node_modules")
      return true;
    if (entry.name === "cache" && segments.at(-2) === ".next") return true;
    return false;
  }
  return RELEASE_ARTIFACT_EXCLUDED_FILE_PATTERNS.some((pattern) =>
    pattern.test(entry.name),
  );
}

function isExpectedReleaseBinaryAsset(relativePath) {
  return RELEASE_ARTIFACT_BINARY_EXTENSIONS.has(
    path.extname(relativePath).toLowerCase(),
  );
}

function isCompressedReleaseSourceMap(relativePath) {
  return /\.map\.(?:br|gz|zip)$/i.test(normalize(relativePath));
}

function collectReleaseArtifactFiles(repo, releaseArtifact) {
  const resolved = resolveIncludedPath(repo, releaseArtifact);
  const stats = lstatSync(resolved.target);
  if (stats.isSymbolicLink())
    throw new Error(
      "privacy release artifact root must not be a symbolic link",
    );
  if (!stats.isDirectory())
    throw new Error("privacy release artifact must resolve to a directory");

  const realRepo = realpathSync(repo);
  const realTarget = realpathSync(resolved.target);
  const realRelative = path.relative(realRepo, realTarget);
  if (
    !realRelative ||
    realRelative.startsWith("..") ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error("privacy release artifact escapes the repository");
  }

  const files = [];
  const symlinks = [];
  let excludedGeneratedEntries = 0;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relativeToArtifact = path.relative(resolved.target, target);
      if (isReleaseArtifactGeneratedNoise(relativeToArtifact, entry)) {
        excludedGeneratedEntries += 1;
        continue;
      }
      if (entry.isSymbolicLink()) {
        symlinks.push(target);
        continue;
      }
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  visit(resolved.target);
  return {
    files: [...new Set(files)].sort(),
    symlinks: [...new Set(symlinks)].sort(),
    scope: [resolved.normalized],
    excludedGeneratedEntries,
  };
}

function allMatches(pattern, value) {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  return [...String(value).matchAll(new RegExp(pattern.source, flags))];
}

function isVerificationFixturePath(relativePath) {
  return (
    /^scripts\/verify-[^/]+\.mjs$/i.test(relativePath) ||
    /^examples\//i.test(relativePath)
  );
}

function isExactSecretPlaceholder(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    EXACT_SECRET_PLACEHOLDERS.has(normalized) ||
    /^\$\{\{\s*secrets\.[a-z_][a-z0-9_]*\s*\}\}$/i.test(normalized) ||
    /^\$\{[a-z_][a-z0-9_]*\}$/i.test(normalized) ||
    /^\$[a-z_][a-z0-9_]*$/i.test(normalized) ||
    /^process\.env\.[a-z_][a-z0-9_]*$/i.test(normalized)
  );
}

function isNonMaterialSecretReference(value) {
  const normalized = String(value || "").trim();
  return (
    /^(?:undefined|null|true|false|configured|required|missing)$/i.test(
      normalized,
    ) ||
    /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:(?:\??\.)[A-Za-z_$][A-Za-z0-9_$]*|\[[A-Za-z0-9_$.'"`-]+\])*$/i.test(
      normalized,
    ) ||
    /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:(?:\??\.)[A-Za-z_$][A-Za-z0-9_$]*)*\([^"'`]*\)$/i.test(
      normalized,
    )
  );
}

function hasSafeAssignmentTerminator(match) {
  const suffix = String(match.input || "").slice(
    (match.index || 0) + match[0].length,
  );
  return /^(?:(?:\\+)?["'])?[ \t]*(?:[,;}\]]|#|$)/.test(suffix);
}

function isExplicitExampleIdentifier(value, relativePath) {
  const normalized = String(value || "").trim();
  if (/^EXAMPLE(?:[-_.:][A-Z0-9]+)+$/i.test(normalized)) return true;
  return (
    isVerificationFixturePath(relativePath) &&
    /^(?:SYNTHETIC|FIXTURE|VERIFY)(?:[-_.:][A-Z0-9]+)+$/i.test(normalized)
  );
}

function isAllowedMatch(detector, match, relativePath) {
  const matchedValue = match[0];
  if (detector.id === "secret-assignment") {
    const assignedValue = match[1];
    const verificationFixture = isVerificationFixturePath(relativePath);
    if (
      isExactSecretPlaceholder(assignedValue) &&
      (hasSafeAssignmentTerminator(match) || verificationFixture)
    )
      return true;
    if (
      isNonMaterialSecretReference(assignedValue) &&
      (hasSafeAssignmentTerminator(match) || verificationFixture)
    )
      return true;
    const connectionMatch = allMatches(
      CONNECTION_CREDENTIAL_PATTERN,
      assignedValue,
    )[0];
    if (
      connectionMatch &&
      isExactSecretPlaceholder(connectionMatch[2]) &&
      (hasSafeAssignmentTerminator(match) || verificationFixture)
    )
      return true;
    return (
      verificationFixture &&
      /^(?:fixture|synthetic|verify|example)-[a-z0-9_-]+$/i.test(
        assignedValue || "",
      )
    );
  }
  if (detector.id === "connection-credential")
    return isExactSecretPlaceholder(match[2]);
  if (detector.id === "email") {
    return EXAMPLE_EMAIL_DOMAINS.has(
      matchedValue.split("@").at(-1)?.toLowerCase(),
    );
  }
  if (detector.id === "uuid")
    return /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(matchedValue);
  if (detector.id === "named-id")
    return isExplicitExampleIdentifier(match[1], relativePath);
  if (detector.category === "local-user-path") {
    return /(?:[\\/])(?:<user>|\$\{user\})(?:[\\/]|$)/i.test(matchedValue);
  }
  return false;
}

function isAllowedReleaseArtifactMatch(detector, match, relativePath) {
  if (detector.id === "secret-assignment") {
    const assignedValue = String(match[1] || "");
    const prefix = String(match[0] || "").slice(
      0,
      String(match[0] || "").lastIndexOf(assignedValue),
    );
    const quotedLiteral = /(?:\\+)?["']$/.test(prefix);
    if (!quotedLiteral) {
      if (assignedValue.startsWith("==")) return true;
      if (
        assignedValue === "same-origin" ||
        isExactSecretPlaceholder(assignedValue)
      )
        return true;
      if (
        /^(?:undefined|null|true|false|configured|required|missing)$/i.test(
          assignedValue,
        )
      )
        return true;
      if (
        isNonMaterialSecretReference(assignedValue) &&
        /[.\[(]/.test(assignedValue)
      )
        return true;
      if (
        /^[A-Za-z_$]\.[A-Za-z_$][A-Za-z0-9_$?.()[\]|&!=:+*/-]*$/.test(
          assignedValue,
        )
      )
        return true;
      return false;
    }
  }
  if (isAllowedMatch(detector, match, relativePath)) return true;
  if (detector.id === "secret-assignment") {
    const assignedValue = String(match[1] || "");
    if (assignedValue === "same-origin") return true;
  }
  if (
    detector.id === "provider-key" &&
    match[0].toLowerCase() === ["sk", "async", "storage", "instance"].join("-")
  )
    return true;
  if (
    detector.category === "local-user-path" &&
    /(?:^|\/)required-server-files\.(?:json|js)$/i.test(relativePath)
  )
    return true;
  if (
    detector.category === "local-user-path" &&
    /^(?:[A-Za-z]:[\\/]ROOT[\\/]|\/ROOT\/)/.test(match[0])
  )
    return true;
  return false;
}

function isApprovedOperationalFixturePath(relativePath) {
  return APPROVED_OPERATIONAL_FIXTURE_PATHS.has(relativePath);
}

function pathContainsPrivateValue(relativePath) {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(relativePath))
    return true;
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(
      relativePath,
    )
  )
    return true;
  if (
    /^(?:runs|logs)\//i.test(relativePath) &&
    !isApprovedOperationalFixturePath(relativePath)
  )
    return true;
  return false;
}

function redactedFinding(category, relativePath, line, matchedValue) {
  const safeCategory = category.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  return {
    category,
    path:
      pathContainsPrivateValue(relativePath) ||
      category === "raw-operational-evidence"
        ? "[REDACTED_PATH]"
        : relativePath,
    line,
    redacted: `[REDACTED:${safeCategory}]`,
    fingerprint: createHash("sha256")
      .update(`${category}\0${relativePath}\0${line}\0${matchedValue}`)
      .digest("hex")
      .slice(0, 12),
  };
}

function classifyContent(target) {
  const bytes = readFileSync(target);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.includes(0)) return { binary: true, digest, size: bytes.length };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[^\t\n\r\x20-\x7e\x80-\u{10ffff}]/u.test(text))
      return { binary: true, digest, size: bytes.length };
    return { binary: false, text, digest, size: bytes.length };
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
    findings.push(
      redactedFinding("unapproved-symlink", relativePath, 0, relativePath),
    );
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
        findings.push(
          redactedFinding(
            "unapproved-binary",
            relativePath,
            0,
            `${content.digest}:${content.size}`,
          ),
        );
      }
      continue;
    }
    scannedFiles += 1;
    if (
      /^(?:runs|logs)\//i.test(relativePath) &&
      !isApprovedOperationalFixturePath(relativePath)
    ) {
      findings.push(
        redactedFinding(
          "raw-operational-evidence",
          relativePath,
          0,
          relativePath,
        ),
      );
    }
    const lines = content.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const detector of CONTENT_DETECTORS) {
        for (const match of allMatches(detector.pattern, line)) {
          if (isAllowedMatch(detector, match, relativePath)) continue;
          findings.push(
            redactedFinding(
              detector.category,
              relativePath,
              index + 1,
              match[0],
            ),
          );
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

export function validateReleaseArtifactPrivacy(repo, releaseArtifact) {
  const resolvedRepo = path.resolve(repo);
  const findings = [];
  let scannedFiles = 0;
  let skippedBinaryFiles = 0;
  let unscannableBinaryFiles = 0;
  let unscannableSourceMapFiles = 0;
  const collected = collectReleaseArtifactFiles(resolvedRepo, releaseArtifact);
  for (const target of collected.symlinks) {
    const relativePath = normalize(path.relative(resolvedRepo, target));
    findings.push(
      redactedFinding("unapproved-symlink", relativePath, 0, relativePath),
    );
  }
  for (const target of collected.files) {
    const relativePath = normalize(path.relative(resolvedRepo, target));
    const content = classifyContent(target);
    if (isCompressedReleaseSourceMap(relativePath)) {
      unscannableSourceMapFiles += 1;
      findings.push(
        redactedFinding(
          "unscannable-release-source-map",
          relativePath,
          0,
          `${content.digest}:${content.size}`,
        ),
      );
      continue;
    }
    if (content.binary) {
      if (isExpectedReleaseBinaryAsset(relativePath)) {
        skippedBinaryFiles += 1;
      } else {
        unscannableBinaryFiles += 1;
        findings.push(
          redactedFinding(
            "unscannable-release-binary",
            relativePath,
            0,
            `${content.digest}:${content.size}`,
          ),
        );
      }
      continue;
    }
    scannedFiles += 1;
    const lines = content.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const detector of RELEASE_ARTIFACT_DETECTORS) {
        for (const match of allMatches(detector.pattern, line)) {
          if (isAllowedReleaseArtifactMatch(detector, match, relativePath))
            continue;
          findings.push(
            redactedFinding(
              detector.category,
              relativePath,
              index + 1,
              match[0],
            ),
          );
        }
      }
    }
  }
  return {
    ok: findings.length === 0,
    gate: "release-artifact-privacy",
    scannedFiles,
    skippedBinaryFiles,
    unscannableBinaryFiles,
    unscannableSourceMapFiles,
    excludedGeneratedEntries: collected.excludedGeneratedEntries,
    detectorPolicy:
      "high-confidence-credentials-and-deployable-local-user-paths",
    binaryPolicy:
      "allow-known-release-asset-extensions-reject-compressed-source-maps-and-fail-closed-otherwise",
    sourceMapPolicy:
      "scan-plain-source-maps-and-reject-compressed-source-maps-without-decompression",
    generatedNoisePolicy:
      "exclude-next-cache-dev-diagnostics-types-traces-nft-standalone-dependencies-and-required-server-build-root-paths; scan-source-maps",
    symlinkFiles: collected.symlinks.length,
    scope: {
      mode: "release-artifact",
      paths: collected.scope,
    },
    findings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/privacy-gate.mjs --repo . [--include relative/file-or-directory ... | --release-artifact relative/directory]",
    );
    return;
  }
  const output =
    args.releaseArtifact === null
      ? validatePrivacy(path.resolve(args.repo), { includes: args.includes })
      : validateReleaseArtifactPrivacy(
          path.resolve(args.repo),
          args.releaseArtifact,
        );
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const gate = process.argv.includes("--release-artifact")
      ? "release-artifact-privacy"
      : "import-privacy";
    console.log(
      JSON.stringify(
        {
          ok: false,
          gate,
          findings: [
            {
              category: "gate-error",
              path: "[REDACTED_PATH]",
              line: 0,
              redacted: "[REDACTED:GATE_ERROR]",
              fingerprint: createHash("sha256")
                .update(error.name)
                .digest("hex")
                .slice(0, 12),
            },
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
