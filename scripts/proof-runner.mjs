#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORTABLE_PROOF_SCHEMA = "valdris.portable-proof.v1";
export const EXECUTION_INPUTS_SCHEMA = "valdris.proof-execution-inputs.v1";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SECRET_NAME =
  /(?:^|_)(?:api_?key|auth|authorization|credentials?|database_?url|db_?url|dsn|connection_?(?:string|url)|password|private_?key|secret|(?:postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|cache|mssql)_?(?:url|dsn))(?:_|$)/i;
const TOKEN_NAME = /(?:^|_)token(?:_|$)/i;
const PLURAL_TOKEN_NAME = /(?:^|_)tokens(?:_|$)/i;
const SENSITIVE_TOKEN_NAME =
  /(?:^|_)(?:access|refresh|auth|authorization|bearer|session|api|oauth|csrf)_tokens?(?:_|$)/i;
const BENIGN_TOKEN_METRIC = /(^|_)token_(?:counts?|budgets?)(?=_|$)/gi;
const BENIGN_TOKEN_USAGE_METRIC =
  /^(?:(?:prompt|completion|input|output|total)_)?tokens$/i;
const SECRET_ASSIGNMENT_NAME =
  /(?:^|_)(?:access_token|refresh_token|api_key|auth|authorization|client_secret|private_key|password|dsn|connection_(?:string|url)|database_url|db_url|credentials?|secret|token|(?:postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|cache|mssql)_(?:url|dsn))$/i;
const SECRET_ARGV_FLAG_SUFFIX =
  /(?:^|_)(?:access_key(?:_id)?|access_token|api_key|api_secret|api_token|auth|auth_token|authorization|bearer_token|client_secret|connection_string|connection_url|credentials?|database_url|db_url|dsn|encryption_key|oauth_token|password|passphrase|private_key|refresh_token|secret|secret_access_key|secret_key|service_account_key|session_token|signing_key|token|webhook_secret|(?:postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|cache|mssql)_(?:url|dsn))$/i;
const LONG_ARGV_FLAG = /^--[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SAFE_ENV_NAMES = new Set([
  "APPDATA",
  "CI",
  "ComSpec",
  "GITHUB_ACTIONS",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "SHELL",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);
const SAFE_ENV_NAMES_UPPER = new Set(
  [...SAFE_ENV_NAMES].map((name) => name.toUpperCase()),
);
const LOCAL_PATH_ENV_NAMES = new Set(["HOME", "USERPROFILE"]);
const WINDOWS_RESERVED_COMPONENT =
  /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const PROOF_RUNNER_FILE = fileURLToPath(import.meta.url);
const POST_PROOF_ARTIFACT_PATHS = Object.freeze([
  "proof/portable.json",
  "rca/rca.json",
  "review/review.json",
  "run/packet.json",
]);
const HARNESS_EVIDENCE_PATH_PATTERNS = Object.freeze([
  /^ai\/assurance\.json$/,
  /^approvals\/.+\.json$/,
  /^cloud\/(?:service-map|skip)\.json$/,
  /^context\/manifest\.json$/,
  /^design\/(?:anchors\.json|system_design\.md)$/,
  /^domain\/assurance\.json$/,
  /^evals\/results\.json$/,
  /^foundation\/assessment\.json$/,
  /^goal\/goal\.json$/,
  /^graph\/(?:graph|gitnexus|freshness)\.json$/,
  /^handoff\/final\.md$/,
  /^production\/layer-assessment\.json$/,
  /^proof\/.+\.json$/,
  /^qa\/(?:qa-plan|break-it-results)\.md$/,
  /^rca\/.+\.json$/,
  /^review\/.+\.json$/,
  /^run\/(?:mode|intake|workload-classification|route|packet)\.json$/,
  /^self_heal\/self_heal_report\.md$/,
  /^smoke\/smoke_proof\.json$/,
  /^trajectory\/(?:trajectory\.json|trace\.jsonl)$/,
  /^waivers\/waivers\.json$/,
]);

function normalizedSecretName(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function isSecretLikeName(value) {
  const normalized = normalizedSecretName(value);
  if (SECRET_NAME.test(normalized)) return true;
  if (SENSITIVE_TOKEN_NAME.test(normalized)) return true;
  const withoutBenignMetrics = normalized.replace(
    BENIGN_TOKEN_METRIC,
    "$1metric",
  );
  return (
    TOKEN_NAME.test(withoutBenignMetrics) ||
    PLURAL_TOKEN_NAME.test(withoutBenignMetrics)
  );
}

function isBenignTokenMetricName(value) {
  const normalized = normalizedSecretName(value);
  if (SECRET_NAME.test(normalized) || SENSITIVE_TOKEN_NAME.test(normalized))
    return false;
  BENIGN_TOKEN_METRIC.lastIndex = 0;
  return (
    BENIGN_TOKEN_METRIC.test(normalized) ||
    BENIGN_TOKEN_USAGE_METRIC.test(normalized)
  );
}

function isNumericMetricTree(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (Array.isArray(value))
    return value.length > 0 && value.every(isNumericMetricTree);
  if (value && typeof value === "object") {
    const entries = Object.values(value);
    return entries.length > 0 && entries.every(isNumericMetricTree);
  }
  return false;
}

export function isSecretAssignmentName(value) {
  return SECRET_ASSIGNMENT_NAME.test(normalizedSecretName(value));
}

export function isHarnessEvidencePath(value) {
  const normalized = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
  return HARNESS_EVIDENCE_PATH_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function fileSha256(file) {
  return sha256(readFileSync(file));
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function safeIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function assertPortableArtifactPath(value) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("artifact path must be a non-empty string");
  if (value.includes("\0") || /[\u0000-\u001f]/.test(value))
    throw new Error("artifact path contains control characters");
  if (/^(?:\\\\[?.]\\|\\\?\?\\|\/\/[?.]\/)/.test(value))
    throw new Error("Windows device namespace paths are forbidden");
  if (/^(?:\\\\|\/\/)[^\/\\]/.test(value))
    throw new Error("UNC artifact paths are forbidden");

  const drivePrefix = /^[A-Za-z]:[\\/]/.test(value);
  const colonIndex = value.indexOf(":");
  if (
    colonIndex >= 0 &&
    !(drivePrefix && colonIndex === 1 && value.indexOf(":", 2) === -1)
  ) {
    throw new Error(
      "artifact paths must not use NTFS alternate data streams or drive-relative forms",
    );
  }
  if (drivePrefix && process.platform !== "win32")
    throw new Error(
      "Windows drive artifact paths are not portable on this platform",
    );

  const components = value
    .replace(/^[A-Za-z]:/, "")
    .split(/[\\/]+/)
    .filter(Boolean);
  for (const component of components) {
    if (component === "..")
      throw new Error(
        "artifact paths must not contain parent traversal components",
      );
    if (/[. ]$/.test(component))
      throw new Error(
        "artifact path components must not end in a dot or space",
      );
    if (WINDOWS_RESERVED_COMPONENT.test(component))
      throw new Error(
        `artifact path uses a reserved Windows device name: ${component}`,
      );
  }
  return value;
}

export function assertCanonicalRepoRelativePath(
  value,
  label = "causal input path",
) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  if (
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error(`${label} must be repository-relative`);
  }
  if (
    value.includes("\\") ||
    value === "." ||
    value.startsWith("./") ||
    value.endsWith("/") ||
    path.posix.normalize(value) !== value
  ) {
    throw new Error(
      `${label} must use canonical repository-relative POSIX form`,
    );
  }
  if (
    value
      .split("/")
      .some(
        (component) => !component || component === "." || component === "..",
      )
  ) {
    throw new Error(
      `${label} must use canonical repository-relative POSIX form`,
    );
  }
  assertPortableArtifactPath(value);
  return value;
}

export function resolveArtifactPath(
  repoRoot,
  relativeOrAbsolute,
  options = {},
) {
  assertPortableArtifactPath(relativeOrAbsolute);
  const root = realpathSync(path.resolve(repoRoot));
  const target = path.resolve(root, relativeOrAbsolute);
  if (!isWithin(root, target))
    throw new Error(`artifact path escapes repository: ${relativeOrAbsolute}`);
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink())
      throw new Error(
        `artifact path must not be a symbolic link: ${relativeOrAbsolute}`,
      );
    const real = realpathSync(target);
    if (!isWithin(root, real))
      throw new Error(
        `artifact path resolves outside repository: ${relativeOrAbsolute}`,
      );
  } else if (options.mustExist) {
    throw new Error(`artifact is missing: ${relativeOrAbsolute}`);
  } else {
    let ancestor = path.dirname(target);
    while (!existsSync(ancestor) && ancestor !== path.dirname(ancestor))
      ancestor = path.dirname(ancestor);
    const realAncestor = realpathSync(ancestor);
    if (!isWithin(root, realAncestor))
      throw new Error(
        `artifact parent resolves outside repository: ${relativeOrAbsolute}`,
      );
  }
  return target;
}

function causalInputState(repoRoot, requestedPaths) {
  const root = realpathSync(path.resolve(repoRoot));
  const seen = new Set();
  const entries = [];
  for (const requestedPath of requestedPaths) {
    assertCanonicalRepoRelativePath(requestedPath);
    if (seen.has(requestedPath))
      throw new Error(
        `causal input path was supplied more than once: ${requestedPath}`,
      );
    seen.add(requestedPath);
    const target = resolveArtifactPath(root, requestedPath, {
      mustExist: true,
    });
    const relative = path.relative(root, target).split(path.sep).join("/");
    if (relative !== requestedPath)
      throw new Error(`causal input path must be canonical: ${requestedPath}`);
    let cursor = root;
    for (const component of requestedPath.split("/")) {
      cursor = path.join(cursor, component);
      const stats = lstatSync(cursor);
      if (stats.isSymbolicLink())
        throw new Error(
          `causal input path must not traverse a symbolic link: ${requestedPath}`,
        );
    }
    if (!lstatSync(target).isFile())
      throw new Error(
        `causal input path must resolve to a regular file: ${requestedPath}`,
      );
    entries.push({ path: requestedPath, sha256: fileSha256(target) });
  }
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function git(repoRoot, args, options = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: options.encoding ?? null,
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    killSignal: "SIGTERM",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const message = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr || result.error?.message || "git failed");
    throw new Error(
      `proof source state requires Git: ${message.trim().slice(-2000)}`,
    );
  }
  return result.stdout;
}

function gitText(repoRoot, args) {
  const output = git(repoRoot, args);
  const text = Buffer.isBuffer(output)
    ? output.toString("utf8")
    : String(output);
  return text.replace(/\r?\n$/, "");
}

function assertGitWorktree(repoRoot, message) {
  const insideWorktree = gitText(repoRoot, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (insideWorktree !== "true") throw new Error(message);
}

function gitTargetPath(repoRoot) {
  const prefix = gitText(repoRoot, ["rev-parse", "--show-prefix"])
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (
    prefix === ".." ||
    prefix.startsWith("../") ||
    path.posix.isAbsolute(prefix) ||
    /[\u0000-\u001f]/.test(prefix)
  ) {
    throw new Error("proof target Git prefix is invalid");
  }
  return prefix || ".";
}

function validGitTargetPath(value) {
  if (value === ".") return true;
  if (
    typeof value !== "string" ||
    !value.length ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    /[\u0000-\u001f]/.test(value)
  )
    return false;
  return value
    .split("/")
    .every(
      (component) =>
        component.length > 0 && component !== "." && component !== "..",
    );
}

function untrackedBinding(repoRoot, pathspec = []) {
  const output = git(repoRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    ...pathspec,
  ]);
  const paths = (
    Buffer.isBuffer(output) ? output.toString("utf8") : String(output)
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const entries = [];
  for (const relativePath of paths) {
    const target = resolveArtifactPath(repoRoot, relativePath, {
      mustExist: true,
    });
    const stat = lstatSync(target);
    if (stat.isSymbolicLink())
      entries.push({
        path: relativePath.split(path.sep).join("/"),
        type: "symlink",
        sha256: sha256(readlinkSync(target)),
      });
    else if (stat.isFile())
      entries.push({
        path: relativePath.split(path.sep).join("/"),
        type: "file",
        sha256: fileSha256(target),
      });
    else
      entries.push({
        path: relativePath.split(path.sep).join("/"),
        type: "other",
        sha256: sha256(String(stat.mode)),
      });
  }
  return { count: entries.length, sha256: sha256(canonicalJson(entries)) };
}

export function trackedSourceState(repoRoot, expectedCommit) {
  const root = realpathSync(path.resolve(repoRoot));
  assertGitWorktree(root, "proof --repo must be inside a Git worktree");
  const head = gitText(root, ["rev-parse", "--verify", "HEAD"]);
  if (expectedCommit !== head)
    throw new Error(`--commit must exactly match Git HEAD (${head})`);
  const tree = gitText(root, ["rev-parse", "HEAD^{tree}"]);
  const pathspec = ["--", "."];
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    ...pathspec,
  ]);
  const diff = git(root, [
    "diff",
    "--binary",
    "--full-index",
    "HEAD",
    ...pathspec,
  ]);
  const untracked = untrackedBinding(root, pathspec);
  const state = {
    gitHead: head,
    targetPath: gitTargetPath(root),
    gitTreeSha256: sha256(tree),
    dirty: status.length > 0,
    statusSha256: sha256(status),
    diffSha256: sha256(diff),
    untrackedCount: untracked.count,
    untrackedSha256: untracked.sha256,
    validatorSha256: fileSha256(PROOF_RUNNER_FILE),
  };
  state.worktreeSha256 = sha256(canonicalJson(state));
  return state;
}

export function applicationSourceState(repoRoot, expectedCommit) {
  const root = realpathSync(path.resolve(repoRoot));
  assertGitWorktree(root, "application source state requires a Git worktree");
  const head = gitText(root, ["rev-parse", "--verify", "HEAD"]);
  if (expectedCommit !== head)
    throw new Error(
      `application source commit must exactly match Git HEAD (${head})`,
    );
  const pathspec = [
    "--",
    ".",
    ...POST_PROOF_ARTIFACT_PATHS.map((entry) => `:(exclude,literal)${entry}`),
  ];
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    ...pathspec,
  ]);
  const diff = git(root, [
    "diff",
    "--binary",
    "--full-index",
    "HEAD",
    ...pathspec,
  ]);
  const untracked = untrackedBinding(root, pathspec);
  const state = {
    gitHead: head,
    targetPath: gitTargetPath(root),
    dirty: status.length > 0,
    statusSha256: sha256(status),
    diffSha256: sha256(diff),
    untrackedCount: untracked.count,
    untrackedSha256: untracked.sha256,
  };
  state.worktreeSha256 = sha256(canonicalJson(state));
  return state;
}

function explicitSecretValues(names) {
  const selected = new Set(names);
  for (const name of Object.keys(process.env)) {
    if (isSecretLikeName(name)) selected.add(name);
  }
  const sourceByUpper = new Map(
    Object.keys(process.env).map((name) => [name.toUpperCase(), name]),
  );
  return [...selected]
    .map((name) => process.env[sourceByUpper.get(String(name).toUpperCase())])
    .filter((value) => typeof value === "string" && value.length >= 1)
    .sort((left, right) => right.length - left.length);
}

function localPathValues() {
  const sourceByUpper = new Map(
    Object.keys(process.env).map((name) => [name.toUpperCase(), name]),
  );
  const values = new Set();
  for (const requestedName of LOCAL_PATH_ENV_NAMES) {
    const sourceName = sourceByUpper.get(requestedName);
    const value = sourceName ? process.env[sourceName] : undefined;
    if (typeof value !== "string" || value.length < 2) continue;
    values.add(value);
    values.add(value.replaceAll("\\", "/"));
    values.add(value.replaceAll("/", "\\"));
  }
  return [...values]
    .filter((value) => value.length >= 2)
    .sort((left, right) => right.length - left.length);
}

const SECRET_ASSIGNMENT_PREFIX_PATTERN =
  /(?<![A-Za-z0-9_.-])(?:(?:\\+)?["'])?([A-Za-z][A-Za-z0-9_.-]{0,127})(?:(?:\\+)?["'])?\s*[:=]\s*/gi;
const REDACTED_SECRET_VALUE_PATTERN =
  /^(?:(?:\\+)?["'])?(?:\[REDACTED(?: [A-Z ]+)?\]|<redacted>|\[placeholder\]|<placeholder>)(?:(?:\\+)?["'])?(?=[ \t]*(?:[,;}\]]|\r?\n|$))/i;
const SAFE_STRUCTURED_SECRET_VALUE_PATTERN =
  /^(?:\[REDACTED(?: [A-Z ]+)?\]|<redacted>|\[placeholder\]|<placeholder>)$/i;

function secretValueEnd(value, start) {
  const tail = value.slice(start);
  const quote = /^(?:\\+)?["']/.exec(tail)?.[0];
  if (!quote) {
    const delimiter = tail.search(/[\r\n,;}]/);
    return delimiter < 0 ? value.length : start + delimiter;
  }

  const lineBreak = tail.search(/[\r\n]/);
  const lineEnd = lineBreak < 0 ? tail.length : lineBreak;
  let cursor = quote.length;
  let lastClosing = -1;
  while (cursor < lineEnd) {
    const candidate = tail.indexOf(quote, cursor);
    if (candidate < 0 || candidate >= lineEnd) break;
    lastClosing = candidate + quote.length;
    const remainder = tail.slice(lastClosing);
    if (/^[ \t]*(?:[,;}\]]|\r?\n|$)/.test(remainder))
      return start + lastClosing;
    cursor = lastClosing;
  }
  return start + (lastClosing >= 0 ? lastClosing : lineEnd);
}

function redactSecretAssignments(input) {
  let value = String(input ?? "");
  let searchFrom = 0;
  while (searchFrom < value.length) {
    SECRET_ASSIGNMENT_PREFIX_PATTERN.lastIndex = searchFrom;
    const match = SECRET_ASSIGNMENT_PREFIX_PATTERN.exec(value);
    if (!match) break;
    if (!isSecretAssignmentName(match[1])) {
      searchFrom = SECRET_ASSIGNMENT_PREFIX_PATTERN.lastIndex;
      continue;
    }
    const valueStart = SECRET_ASSIGNMENT_PREFIX_PATTERN.lastIndex;
    const tail = value.slice(valueStart);
    const alreadyRedacted = REDACTED_SECRET_VALUE_PATTERN.exec(tail)?.[0];
    if (alreadyRedacted) {
      searchFrom = valueStart + alreadyRedacted.length;
      continue;
    }
    const valueEnd = secretValueEnd(value, valueStart);
    if (valueEnd <= valueStart) {
      searchFrom = valueStart + 1;
      continue;
    }
    value = `${value.slice(0, valueStart)}[REDACTED]${value.slice(valueEnd)}`;
    searchFrom = valueStart + "[REDACTED]".length;
  }
  SECRET_ASSIGNMENT_PREFIX_PATTERN.lastIndex = 0;
  return value;
}

export function redactText(input, secretValues = []) {
  let value = String(input ?? "");
  for (const secret of secretValues)
    value = value.split(secret).join("[REDACTED]");
  value = value
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, "[REDACTED TOKEN]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g, "[REDACTED TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,255}\b/g, "[REDACTED TOKEN]");
  value = redactSecretAssignments(value);
  return value
    .replace(
      /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|mssql):\/\/)[^@\s"'`<>]*:[^@\s"'`<>/]+@/gi,
      "$1[REDACTED]@",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED JWT]",
    );
}

function isSecretArgvFlag(value) {
  return (
    LONG_ARGV_FLAG.test(value) &&
    SECRET_ARGV_FLAG_SUFFIX.test(normalizedSecretName(value.slice(2)))
  );
}

function secretArgvBindings(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error("command argv must be a non-empty string array");
  }
  const bindings = [];
  for (let index = 1; index < argv.length; index += 1) {
    const entry = argv[index];
    const equalsIndex = entry.indexOf("=");
    const flag = equalsIndex >= 0 ? entry.slice(0, equalsIndex) : entry;
    if (!isSecretArgvFlag(flag)) continue;
    if (equalsIndex >= 0) {
      const value = entry.slice(equalsIndex + 1);
      if (!value.length)
        throw new Error(
          `secret-bearing command flag ${flag} requires a non-empty value`,
        );
      bindings.push({ flag, flagIndex: index, form: "equals", value });
      continue;
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || !value.length)
      throw new Error(`secret-bearing command flag ${flag} requires a value`);
    if (value.startsWith("-"))
      throw new Error(
        `secret-bearing command flag ${flag} has an ambiguous flag-like split value; use ${flag}=<value>`,
      );
    bindings.push({
      flag,
      flagIndex: index,
      form: "split",
      value,
      valueIndex: index + 1,
    });
    index += 1;
  }
  return bindings;
}

function opaqueArgvMetadata(argv) {
  return secretArgvBindings(argv).map((binding) => ({
    flag: binding.flag,
    flagIndex: binding.flagIndex,
    form: binding.form,
    valueIndex: binding.form === "split" ? binding.valueIndex : null,
  }));
}

function canonicalPassedEnvironmentNames(names) {
  const normalized = [];
  for (const name of names) {
    if (
      typeof name !== "string" ||
      !name.length ||
      name.includes("=") ||
      /[\u0000-\u001f]/.test(name)
    ) {
      throw new Error(
        "--pass-env requires a non-empty environment variable name without control characters or equals signs",
      );
    }
    normalized.push(name.toUpperCase());
  }
  return [...new Set(normalized)].sort();
}

function allowlistedEnvironmentSha256(environment) {
  const canonicalEnvironment = Object.fromEntries(
    Object.entries(environment)
      .map(([name, value]) => [name.toUpperCase(), value])
      .filter(([name]) => SAFE_ENV_NAMES_UPPER.has(name))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return sha256(canonicalJson(canonicalEnvironment));
}

function executionInputContract(passEnvNames, resolvedArgv, childEnvironment) {
  const passedEnvironmentNames = canonicalPassedEnvironmentNames(passEnvNames);
  const opaqueArgv = opaqueArgvMetadata(resolvedArgv);
  const dynamic = passedEnvironmentNames.length > 0 || opaqueArgv.length > 0;
  return {
    schema: EXECUTION_INPUTS_SCHEMA,
    stability: dynamic ? "opaque-dynamic" : "static",
    causalIdentityEligible: !dynamic,
    passedEnvironmentNames,
    opaqueArgv,
    allowlistedEnvironmentSha256:
      allowlistedEnvironmentSha256(childEnvironment),
  };
}

function executionInputProblems(command) {
  const problems = [];
  const contract = command?.executionInputs;
  if (!contract || typeof contract !== "object" || Array.isArray(contract))
    return ["portable proof command.executionInputs is required"];
  if (
    canonicalJson(Object.keys(contract).sort()) !==
    canonicalJson([
      "allowlistedEnvironmentSha256",
      "causalIdentityEligible",
      "opaqueArgv",
      "passedEnvironmentNames",
      "schema",
      "stability",
    ])
  ) {
    problems.push("portable proof command.executionInputs fields are invalid");
  }
  if (contract.schema !== EXECUTION_INPUTS_SCHEMA)
    problems.push(
      `portable proof command.executionInputs.schema must be ${EXECUTION_INPUTS_SCHEMA}`,
    );
  if (!SHA256.test(contract.allowlistedEnvironmentSha256 || ""))
    problems.push(
      "portable proof command.executionInputs.allowlistedEnvironmentSha256 must be a SHA-256 digest",
    );
  let canonicalPassedNames = [];
  if (!Array.isArray(contract.passedEnvironmentNames))
    problems.push(
      "portable proof command.executionInputs.passedEnvironmentNames must be an array",
    );
  else {
    try {
      canonicalPassedNames = canonicalPassedEnvironmentNames(
        contract.passedEnvironmentNames,
      );
    } catch (error) {
      problems.push(
        `portable proof command.executionInputs.passedEnvironmentNames is invalid: ${error.message}`,
      );
    }
    if (
      canonicalJson(contract.passedEnvironmentNames) !==
      canonicalJson(canonicalPassedNames)
    )
      problems.push(
        "portable proof command.executionInputs.passedEnvironmentNames must be unique, uppercase, and sorted",
      );
  }
  let expectedOpaqueArgv = [];
  try {
    expectedOpaqueArgv = opaqueArgvMetadata(command?.argv);
  } catch (error) {
    problems.push(
      `portable proof command.executionInputs.opaqueArgv cannot be derived: ${error.message}`,
    );
  }
  if (!Array.isArray(contract.opaqueArgv))
    problems.push(
      "portable proof command.executionInputs.opaqueArgv must be an array",
    );
  else {
    for (const [index, entry] of contract.opaqueArgv.entries()) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        canonicalJson(Object.keys(entry).sort()) !==
          canonicalJson(["flag", "flagIndex", "form", "valueIndex"])
      ) {
        problems.push(
          `portable proof command.executionInputs.opaqueArgv[${index}] fields are invalid`,
        );
      }
    }
    if (
      canonicalJson(contract.opaqueArgv) !== canonicalJson(expectedOpaqueArgv)
    )
      problems.push(
        "portable proof command.executionInputs.opaqueArgv must match the redacted command argv structure",
      );
  }
  const dynamic =
    canonicalPassedNames.length > 0 || expectedOpaqueArgv.length > 0;
  if (contract.stability !== (dynamic ? "opaque-dynamic" : "static"))
    problems.push(
      "portable proof command.executionInputs.stability does not match its opaque inputs",
    );
  if (contract.causalIdentityEligible !== !dynamic)
    problems.push(
      "portable proof command.executionInputs.causalIdentityEligible does not match its stability",
    );
  return problems;
}

export function redactCommandArgv(argv, baseSecretValues = []) {
  const bindings = secretArgvBindings(argv);
  const secretValues = [
    ...new Set([
      ...baseSecretValues,
      ...bindings.map((binding) => binding.value),
    ]),
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.length - left.length);
  const persisted = argv.map((entry) => redactText(entry, secretValues));
  for (const binding of bindings) {
    persisted[binding.flagIndex] =
      binding.form === "equals" ? `${binding.flag}=[REDACTED]` : binding.flag;
    if (binding.form === "split") persisted[binding.valueIndex] = "[REDACTED]";
  }
  return { argv: persisted, secretValues };
}

function secretArgvDisclosureProblems(argv) {
  let bindings;
  try {
    bindings = secretArgvBindings(argv);
  } catch {
    return ["proof artifact contains malformed secret-bearing command argv"];
  }
  return bindings.some(
    (binding) =>
      !SAFE_STRUCTURED_SECRET_VALUE_PATTERN.test(binding.value.trim()),
  )
    ? ["proof artifact contains a raw secret-bearing command argv value"]
    : [];
}

function safeChildEnvironment(passNames = []) {
  const requested = new Set([...SAFE_ENV_NAMES, ...passNames]);
  const sourceByUpper = new Map(
    Object.keys(process.env).map((name) => [name.toUpperCase(), name]),
  );
  const environment = {};
  for (const requestedName of requested) {
    const sourceName = sourceByUpper.get(String(requestedName).toUpperCase());
    if (sourceName && process.env[sourceName] !== undefined)
      environment[sourceName] = process.env[sourceName];
  }
  return environment;
}

function windowsPackageManagerCliCandidates(command, manager, env, execPath) {
  const managerCli = {
    npm: ["npm", "bin", "npm-cli.js"],
    pnpm: ["pnpm", "bin", "pnpm.cjs"],
    yarn: ["yarn", "bin", "yarn.js"],
  }[manager];
  const candidates = [];
  const commandDirectory = path.win32.dirname(command);
  if (commandDirectory && commandDirectory !== ".")
    candidates.push(path.join(commandDirectory, "node_modules", ...managerCli));
  candidates.push(
    path.join(path.dirname(execPath), "node_modules", ...managerCli),
  );
  if (
    typeof env.npm_execpath === "string" &&
    new Set(["npm-cli.js", "pnpm.cjs", "yarn.js"]).has(
      path.win32.basename(env.npm_execpath).toLowerCase(),
    )
  )
    candidates.push(env.npm_execpath);
  if (typeof env.APPDATA === "string")
    candidates.push(
      path.join(env.APPDATA, "npm", "node_modules", ...managerCli),
    );
  const where = spawnSync("where.exe", [`${manager}.cmd`], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env,
  });
  if (where.status === 0)
    for (const shim of String(where.stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      candidates.push(
        path.join(path.dirname(shim), "node_modules", ...managerCli),
      );
      if (manager !== "npm")
        candidates.push(
          path.join(
            path.dirname(shim),
            "node_modules",
            "corepack",
            "dist",
            `${manager}.js`,
          ),
        );
    }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

export function resolvePortableCommand(argv, options = {}) {
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.some((entry) => typeof entry !== "string" || entry.length === 0)
  )
    throw new Error("command argv must be a non-empty string array");
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const execPath = options.execPath || process.execPath;
  if (platform !== "win32") return { argv: [...argv], resolution: "direct" };
  const executable = path.win32.basename(argv[0]).toLowerCase();
  const manager = executable.replace(/\.cmd$/, "");
  if (!new Set(["npm", "pnpm", "yarn"]).has(manager))
    return { argv: [...argv], resolution: "direct" };
  const managerCli = windowsPackageManagerCliCandidates(
    argv[0],
    manager,
    env,
    execPath,
  ).find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile());
  if (!managerCli)
    throw new Error(
      `unable to resolve ${manager} to its JavaScript CLI without enabling a shell`,
    );
  return {
    argv: [execPath, managerCli, ...argv.slice(1)],
    resolution: `windows-${manager}-cli`,
  };
}

function boundedText(input, maxBytes, secretValues) {
  const redacted = redactText(input, secretValues);
  const bytes = Buffer.from(redacted, "utf8");
  const truncated = bytes.length > maxBytes;
  const text = truncated
    ? bytes.subarray(0, maxBytes).toString("utf8")
    : redacted;
  return {
    text,
    sha256: sha256(text),
    observedBytes: bytes.length,
    persistedBytes: Buffer.byteLength(text),
    truncated,
  };
}

function outputBinding(attempts) {
  return attempts.map((attempt) => ({
    index: attempt.index,
    exitCode: attempt.exitCode,
    signal: attempt.signal,
    timedOut: attempt.timedOut,
    spawnError: attempt.spawnError,
    stdoutSha256: attempt.stdout.sha256,
    stderrSha256: attempt.stderr.sha256,
  }));
}

function attemptSignature(attempt) {
  return sha256(
    canonicalJson({
      exitCode: attempt.exitCode,
      signal: attempt.signal,
      timedOut: attempt.timedOut,
      spawnError: attempt.spawnError,
      stdoutSha256: attempt.stdout.sha256,
      stderrSha256: attempt.stderr.sha256,
    }),
  );
}

function derivedOutcome(execution, source = {}) {
  const attempts = execution.attempts;
  const flaky = new Set(attempts.map(attemptSignature)).size > 1;
  const timedOut = attempts.some((attempt) => attempt.timedOut);
  const spawnFailed = attempts.some(
    (attempt) => attempt.spawnError && !attempt.timedOut,
  );
  const allGreen = attempts.every(
    (attempt) =>
      attempt.exitCode === 0 && !attempt.timedOut && !attempt.spawnError,
  );
  const allRed = attempts.every(
    (attempt) =>
      Number.isInteger(attempt.exitCode) &&
      attempt.exitCode !== 0 &&
      !attempt.timedOut &&
      !attempt.spawnError,
  );
  let status;
  if (flaky) status = "flaky";
  else if (timedOut) status = "timed-out";
  else if (spawnFailed) status = "spawn-failed";
  else if (source.stable === false) status = "source-mutated";
  else if (execution.mode === "red-baseline")
    status = allRed ? "red-confirmed" : "unexpected-green";
  else status = allGreen ? "passed" : "failed";
  return {
    status,
    flaky,
    successful: status === "passed" || status === "red-confirmed",
  };
}

function proofBindings(document) {
  const executionInputsSha256 = sha256(
    canonicalJson(document.command.executionInputs),
  );
  const commandSha256 = sha256(
    canonicalJson({
      argv: document.command.argv,
      requestedArgv: document.command.requestedArgv,
      resolution: document.command.resolution,
      executionInputsSha256,
    }),
  );
  const outputSha256 = sha256(
    canonicalJson(outputBinding(document.execution.attempts)),
  );
  const causalInputsSha256 = sha256(canonicalJson(document.causalInputs));
  const runSha256 = sha256(document.run.id);
  const commitSha256 = sha256(document.run.commit);
  const environmentSha256 = sha256(document.run.environment);
  const environmentSnapshotSha256 = sha256(canonicalJson(document.host));
  const sourceSha256 = sha256(canonicalJson(document.source));
  const envelopeSha256 = sha256(
    canonicalJson({
      schema: document.schema,
      commandSha256,
      executionInputsSha256,
      outputSha256,
      causalInputsSha256,
      runSha256,
      commitSha256,
      environmentSha256,
      environmentSnapshotSha256,
      sourceSha256,
      mode: document.execution.mode,
      repeat: document.execution.repeat,
      timeoutMs: document.execution.timeoutMs,
    }),
  );
  return {
    commandSha256,
    executionInputsSha256,
    outputSha256,
    causalInputsSha256,
    runSha256,
    commitSha256,
    environmentSha256,
    environmentSnapshotSha256,
    sourceSha256,
    envelopeSha256,
  };
}

export function secretDisclosureProblems(document) {
  const problems = [];
  function visit(value, key = "", inheritedSecretContext = false) {
    const benignNumericMetric =
      isBenignTokenMetricName(key) && isNumericMetricTree(value);
    if (isBenignTokenMetricName(key) && !benignNumericMetric) {
      problems.push(
        "proof artifact contains a non-numeric value under a token-metric key",
      );
    }
    const secretContext =
      inheritedSecretContext || (!benignNumericMetric && isSecretLikeName(key));
    if (
      secretContext &&
      (typeof value !== "string" ||
        !SAFE_STRUCTURED_SECRET_VALUE_PATTERN.test(value.trim()))
    ) {
      problems.push(
        "proof artifact contains a raw value under a secret-like key",
      );
    }
    if (typeof value === "string") {
      const redacted = redactText(value);
      if (redacted !== value)
        problems.push("proof artifact contains secret-like raw string output");
      return;
    }
    if (Array.isArray(value)) {
      if (new Set(["argv", "requested_argv"]).has(normalizedSecretName(key)))
        problems.push(...secretArgvDisclosureProblems(value));
      for (const entry of value) visit(entry, "", secretContext);
      return;
    }
    if (value && typeof value === "object") {
      for (const [entryKey, entry] of Object.entries(value))
        visit(entry, entryKey, secretContext);
    }
  }
  visit(document);
  return [...new Set(problems)];
}

export function agentSelfGrantProblems(value, location = "artifact") {
  const problems = [];
  if (!value || typeof value !== "object") return problems;
  if (
    !Array.isArray(value) &&
    value.status === "granted" &&
    value.actorType === "agent"
  )
    problems.push(`${location} contains an agent self-granted approval`);
  if (Array.isArray(value))
    value.forEach((entry, index) =>
      problems.push(...agentSelfGrantProblems(entry, `${location}[${index}]`)),
    );
  else
    for (const [key, entry] of Object.entries(value))
      problems.push(...agentSelfGrantProblems(entry, `${location}.${key}`));
  return problems;
}

export function validatePortableProof(document) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return { valid: false, problems: ["portable proof must be a JSON object"] };
  if (document.schema !== PORTABLE_PROOF_SCHEMA)
    problems.push(`portable proof schema must be ${PORTABLE_PROOF_SCHEMA}`);
  if (!safeIdentifier(document.run?.id))
    problems.push("portable proof run.id is invalid");
  if (!GIT_OBJECT_ID.test(document.run?.commit || ""))
    problems.push(
      "portable proof run.commit must be a 40- or 64-character Git object ID",
    );
  if (!safeIdentifier(document.run?.environment))
    problems.push("portable proof run.environment is invalid");
  if (
    !Array.isArray(document.command?.argv) ||
    document.command.argv.length === 0 ||
    document.command.argv.some(
      (entry) => typeof entry !== "string" || !entry.length,
    )
  )
    problems.push(
      "portable proof command.argv must be a non-empty string array",
    );
  if (
    document.command?.requestedArgv !== undefined &&
    (!Array.isArray(document.command.requestedArgv) ||
      document.command.requestedArgv.length === 0 ||
      document.command.requestedArgv.some(
        (entry) => typeof entry !== "string" || !entry.length,
      ))
  )
    problems.push(
      "portable proof command.requestedArgv must be a non-empty string array when present",
    );
  if (
    !new Set([
      "direct",
      "windows-npm-cli",
      "windows-pnpm-cli",
      "windows-yarn-cli",
    ]).has(document.command?.resolution)
  )
    problems.push("portable proof command.resolution is invalid");
  problems.push(...executionInputProblems(document.command));
  const causalInputs = Array.isArray(document.causalInputs)
    ? document.causalInputs
    : [];
  if (!Array.isArray(document.causalInputs))
    problems.push("portable proof causalInputs must be an array");
  const causalPaths = new Set();
  for (const [index, input] of causalInputs.entries()) {
    const label = `portable proof causalInputs[${index}]`;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    if (
      canonicalJson(Object.keys(input).sort()) !==
      canonicalJson(["afterSha256", "beforeSha256", "path"])
    )
      problems.push(
        `${label} must contain exactly path, beforeSha256, and afterSha256`,
      );
    try {
      assertCanonicalRepoRelativePath(input.path, `${label}.path`);
    } catch (error) {
      problems.push(error.message);
    }
    if (typeof input.path === "string") {
      if (causalPaths.has(input.path))
        problems.push(`${label}.path is duplicated`);
      causalPaths.add(input.path);
    }
    if (!SHA256.test(input.beforeSha256 || ""))
      problems.push(`${label}.beforeSha256 is invalid`);
    if (!SHA256.test(input.afterSha256 || ""))
      problems.push(`${label}.afterSha256 is invalid`);
  }
  const canonicalCausalInputs = [...causalInputs].sort((left, right) =>
    String(left?.path || "") < String(right?.path || "")
      ? -1
      : String(left?.path || "") > String(right?.path || "")
        ? 1
        : 0,
  );
  if (canonicalJson(causalInputs) !== canonicalJson(canonicalCausalInputs))
    problems.push("portable proof causalInputs must use canonical path order");
  if (document.execution?.shell !== false)
    problems.push("portable proof execution.shell must be false");
  if (
    !Number.isInteger(document.execution?.timeoutMs) ||
    document.execution.timeoutMs < 1 ||
    document.execution.timeoutMs > 600_000
  )
    problems.push("portable proof timeoutMs must be between 1 and 600000");
  if (
    !Number.isInteger(document.execution?.repeat) ||
    document.execution.repeat < 1 ||
    document.execution.repeat > 20
  )
    problems.push("portable proof repeat must be between 1 and 20");
  if (
    !Number.isInteger(document.execution?.maxOutputBytes) ||
    document.execution.maxOutputBytes < 256 ||
    document.execution.maxOutputBytes > 1_048_576
  )
    problems.push(
      "portable proof maxOutputBytes must be between 256 and 1048576",
    );
  if (!new Set(["green", "red-baseline"]).has(document.execution?.mode))
    problems.push("portable proof execution.mode is invalid");
  if (
    !Array.isArray(document.execution?.attempts) ||
    document.execution.attempts.length !== document.execution?.repeat
  )
    problems.push("portable proof attempts must match repeat");
  for (const [index, attempt] of (
    document.execution?.attempts || []
  ).entries()) {
    if (attempt.index !== index + 1)
      problems.push(`portable proof attempt ${index + 1} index is invalid`);
    if (!(attempt.exitCode === null || Number.isInteger(attempt.exitCode)))
      problems.push(`portable proof attempt ${index + 1} exitCode is invalid`);
    if (!(attempt.signal === null || typeof attempt.signal === "string"))
      problems.push(`portable proof attempt ${index + 1} signal is invalid`);
    if (typeof attempt.timedOut !== "boolean")
      problems.push(`portable proof attempt ${index + 1} timedOut is invalid`);
    if (!(
      attempt.spawnError === null || typeof attempt.spawnError === "string"
    ))
      problems.push(
        `portable proof attempt ${index + 1} spawnError is invalid`,
      );
    if (!Number.isInteger(attempt.durationMs) || attempt.durationMs < 0)
      problems.push(
        `portable proof attempt ${index + 1} durationMs is invalid`,
      );
    for (const stream of ["stdout", "stderr"]) {
      const output = attempt[stream];
      if (!output || typeof output.text !== "string")
        problems.push(
          `portable proof attempt ${index + 1} ${stream} is invalid`,
        );
      else {
        if (output.sha256 !== sha256(output.text))
          problems.push(
            `portable proof attempt ${index + 1} ${stream} digest does not match persisted output`,
          );
        if (Buffer.byteLength(output.text) > document.execution.maxOutputBytes)
          problems.push(
            `portable proof attempt ${index + 1} ${stream} exceeds persisted output bound`,
          );
        if (output.persistedBytes !== Buffer.byteLength(output.text))
          problems.push(
            `portable proof attempt ${index + 1} ${stream} persistedBytes is invalid`,
          );
      }
    }
  }
  const source = document.source;
  if (!source || typeof source !== "object" || Array.isArray(source))
    problems.push("portable proof source binding is required");
  else {
    if (source.gitHead !== document.run?.commit)
      problems.push("portable proof source.gitHead must match run.commit");
    if (!validGitTargetPath(source.targetPath))
      problems.push(
        "portable proof source.targetPath must be a normalized Git worktree-relative target path",
      );
    if (!SHA256.test(source.gitTreeSha256 || ""))
      problems.push("portable proof source.gitTreeSha256 is invalid");
    for (const field of [
      "beforeSha256",
      "afterSha256",
      "applicationBeforeSha256",
      "applicationAfterSha256",
      "validatorSha256",
    ])
      if (!SHA256.test(source[field] || ""))
        problems.push(`portable proof source.${field} is invalid`);
    if (
      typeof source.dirtyBefore !== "boolean" ||
      typeof source.dirtyAfter !== "boolean"
    )
      problems.push("portable proof source dirty flags are invalid");
    if (
      typeof source.stable !== "boolean" ||
      source.stable !== (source.beforeSha256 === source.afterSha256)
    )
      problems.push(
        "portable proof source.stable does not match the bound worktree states",
      );
    if (
      typeof source.applicationStable !== "boolean" ||
      source.applicationStable !==
        (source.applicationBeforeSha256 === source.applicationAfterSha256)
    )
      problems.push(
        "portable proof source.applicationStable does not match the application source projection",
      );
  }
  if (problems.length === 0) {
    const expected = proofBindings(document);
    for (const [name, digest] of Object.entries(expected)) {
      if (
        !SHA256.test(document.bindings?.[name] || "") ||
        document.bindings[name] !== digest
      )
        problems.push(`portable proof binding ${name} does not match`);
    }
    const signatures = new Set(
      document.execution.attempts.map(attemptSignature),
    );
    if (document.outcome?.flaky !== signatures.size > 1)
      problems.push("portable proof flaky outcome does not match attempts");
    const expectedOutcome = derivedOutcome(document.execution, document.source);
    for (const field of ["status", "flaky", "successful"]) {
      if (document.outcome?.[field] !== expectedOutcome[field])
        problems.push(
          `portable proof outcome.${field} does not match attempts`,
        );
    }
  }
  problems.push(...secretDisclosureProblems(document));
  return { valid: problems.length === 0, problems };
}

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1) : [];
  const args = {
    repo: process.cwd(),
    timeoutMs: 30_000,
    repeat: 1,
    maxOutputBytes: 16_384,
    mode: "green",
    redactEnv: [],
    passEnv: [],
    causalInputs: [],
  };
  const valueFor = (index, option) => {
    const value = optionArgs[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("-")
    ) {
      throw new Error(`${option} requires a non-empty, non-flag value`);
    }
    return value;
  };
  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === "--repo") args.repo = valueFor(index++, arg);
    else if (arg === "--run-id") args.runId = valueFor(index++, arg);
    else if (arg === "--commit") args.commit = valueFor(index++, arg);
    else if (arg === "--environment") args.environment = valueFor(index++, arg);
    else if (arg === "--output") args.output = valueFor(index++, arg);
    else if (arg === "--timeout-ms")
      args.timeoutMs = Number(valueFor(index++, arg));
    else if (arg === "--repeat") args.repeat = Number(valueFor(index++, arg));
    else if (arg === "--max-output-bytes")
      args.maxOutputBytes = Number(valueFor(index++, arg));
    else if (arg === "--red-baseline") args.mode = "red-baseline";
    else if (arg === "--redact-env")
      args.redactEnv.push(valueFor(index++, arg));
    else if (arg === "--pass-env") args.passEnv.push(valueFor(index++, arg));
    else if (arg === "--causal-input")
      args.causalInputs.push(valueFor(index++, arg));
    else if (arg === "--help" || arg === "-h") args.help = true;
    else {
      const diagnosticOption =
        /^--[A-Za-z][A-Za-z0-9_.-]{0,127}/.exec(String(arg))?.[0] ||
        "[invalid option]";
      throw new Error(`unknown argument: ${diagnosticOption}`);
    }
  }
  return { ...args, command };
}

function usage() {
  return "Usage: node scripts/proof-runner.mjs --repo . --run-id ID --commit SHA --environment NAME --output proof/portable.json [--timeout-ms N] [--repeat N] [--max-output-bytes N] [--red-baseline] [--causal-input repo/path ...] [--pass-env NAME] [--redact-env NAME] -- <executable> [args...]";
}

function execute(args) {
  if (!safeIdentifier(args.runId))
    throw new Error("--run-id must be a safe identifier");
  if (!GIT_OBJECT_ID.test(args.commit || ""))
    throw new Error("--commit must be a 40- or 64-character Git object ID");
  if (!safeIdentifier(args.environment))
    throw new Error("--environment must be a safe identifier");
  if (!args.output) throw new Error("--output is required");
  if (
    !Number.isInteger(args.timeoutMs) ||
    args.timeoutMs < 1 ||
    args.timeoutMs > 600_000
  )
    throw new Error("--timeout-ms must be between 1 and 600000");
  if (!Number.isInteger(args.repeat) || args.repeat < 1 || args.repeat > 20)
    throw new Error("--repeat must be between 1 and 20");
  if (
    !Number.isInteger(args.maxOutputBytes) ||
    args.maxOutputBytes < 256 ||
    args.maxOutputBytes > 1_048_576
  )
    throw new Error("--max-output-bytes must be between 256 and 1048576");
  if (!args.command.length)
    throw new Error("an executable argv array is required after --");

  const repoRoot = realpathSync(path.resolve(args.repo));
  const outputPath = resolveArtifactPath(repoRoot, args.output);
  if (existsSync(outputPath))
    throw new Error("proof artifacts are immutable; choose a new output path");
  const sourceBefore = trackedSourceState(repoRoot, args.commit);
  const applicationBefore = applicationSourceState(repoRoot, args.commit);
  const causalInputsBefore = causalInputState(repoRoot, args.causalInputs);
  const resolvedCommand = resolvePortableCommand(args.command);
  const childEnvironment = safeChildEnvironment(args.passEnv);
  const executionInputs = executionInputContract(
    args.passEnv,
    resolvedCommand.argv,
    childEnvironment,
  );
  const baseSecretValues = [
    ...new Set([
      ...explicitSecretValues([...args.redactEnv, ...args.passEnv]),
      ...localPathValues(),
    ]),
  ].sort((left, right) => right.length - left.length);
  const requestedArgvRedaction = redactCommandArgv(
    args.command,
    baseSecretValues,
  );
  const secretValues = requestedArgvRedaction.secretValues;
  const persistedRequestedArgv = requestedArgvRedaction.argv;
  const persistedArgv = redactCommandArgv(
    resolvedCommand.argv,
    secretValues,
  ).argv;
  const attempts = [];

  for (let index = 0; index < args.repeat; index += 1) {
    const started = Date.now();
    const result = spawnSync(
      resolvedCommand.argv[0],
      resolvedCommand.argv.slice(1),
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: childEnvironment,
        shell: false,
        timeout: args.timeoutMs,
        killSignal: "SIGTERM",
        maxBuffer: Math.max(1_048_576, args.maxOutputBytes * 4),
      },
    );
    const timedOut = result.error?.code === "ETIMEDOUT";
    attempts.push({
      index: index + 1,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null,
      timedOut,
      spawnError: result.error
        ? redactText(
            `${result.error.code || "SPAWN_ERROR"}: ${result.error.message}`,
            secretValues,
          )
        : null,
      durationMs: Date.now() - started,
      stdout: boundedText(result.stdout, args.maxOutputBytes, secretValues),
      stderr: boundedText(result.stderr, args.maxOutputBytes, secretValues),
    });
  }

  const sourceAfter = trackedSourceState(repoRoot, args.commit);
  const applicationAfter = applicationSourceState(repoRoot, args.commit);
  const causalInputsAfter = causalInputState(repoRoot, args.causalInputs);
  if (
    new Set([
      sourceBefore.targetPath,
      sourceAfter.targetPath,
      applicationBefore.targetPath,
      applicationAfter.targetPath,
    ]).size !== 1
  ) {
    throw new Error("proof target Git prefix changed during execution");
  }
  const source = {
    gitHead: sourceBefore.gitHead,
    targetPath: sourceBefore.targetPath,
    gitTreeSha256: sourceBefore.gitTreeSha256,
    beforeSha256: sourceBefore.worktreeSha256,
    afterSha256: sourceAfter.worktreeSha256,
    dirtyBefore: sourceBefore.dirty,
    dirtyAfter: sourceAfter.dirty,
    stable: sourceBefore.worktreeSha256 === sourceAfter.worktreeSha256,
    applicationBeforeSha256: applicationBefore.worktreeSha256,
    applicationAfterSha256: applicationAfter.worktreeSha256,
    applicationStable:
      applicationBefore.worktreeSha256 === applicationAfter.worktreeSha256,
    validatorSha256: sourceBefore.validatorSha256,
  };

  const artifact = {
    schema: PORTABLE_PROOF_SCHEMA,
    generatedAt: new Date().toISOString(),
    run: { id: args.runId, commit: args.commit, environment: args.environment },
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: Boolean(process.env.CI),
    },
    source,
    causalInputs: causalInputsBefore.map((before, index) => ({
      path: before.path,
      beforeSha256: before.sha256,
      afterSha256: causalInputsAfter[index]?.sha256,
    })),
    command: {
      argv: persistedArgv,
      requestedArgv: persistedRequestedArgv,
      resolution: resolvedCommand.resolution,
      executionInputs,
    },
    execution: {
      shell: false,
      mode: args.mode,
      timeoutMs: args.timeoutMs,
      repeat: args.repeat,
      maxOutputBytes: args.maxOutputBytes,
      attempts,
    },
    outcome: undefined,
  };
  artifact.outcome = derivedOutcome(artifact.execution, artifact.source);
  artifact.bindings = proofBindings(artifact);
  const validation = validatePortableProof(artifact);
  if (!validation.valid)
    throw new Error(
      `refusing to persist invalid proof: ${validation.problems.join("; ")}`,
    );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(
    JSON.stringify(
      {
        ok: artifact.outcome.successful,
        status: artifact.outcome.status,
        artifact: path.relative(repoRoot, outputPath),
        bindings: artifact.bindings,
      },
      null,
      2,
    ),
  );
  if (!artifact.outcome.successful) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(usage());
  execute(args);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
