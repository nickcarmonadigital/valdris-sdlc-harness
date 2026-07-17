#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORTABLE_PROOF_SCHEMA = "valdris.portable-proof.v1";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SECRET_NAME = /(?:^|_)(?:api_?key|auth|authorization|credential|database_?url|dsn|connection_?string|password|private_?key|secret|token)(?:_|$)/i;
const SAFE_ENV_NAMES = new Set([
  "APPDATA", "CI", "ComSpec", "GITHUB_ACTIONS", "HOME", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL",
  "LOCALAPPDATA", "PATH", "PATHEXT", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "SHELL", "SystemDrive", "SystemRoot", "TEMP", "TERM", "TMP", "TMPDIR", "USERPROFILE", "WINDIR",
]);
const LOCAL_PATH_ENV_NAMES = new Set(["HOME", "USERPROFILE"]);
const WINDOWS_RESERVED_COMPONENT = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const PROOF_RUNNER_FILE = fileURLToPath(import.meta.url);
const POST_PROOF_ARTIFACT_PATHS = Object.freeze(["proof/portable.json", "review/review.json", "run/packet.json"]);
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

export function isHarnessEvidencePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  return HARNESS_EVIDENCE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
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
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function assertPortableArtifactPath(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("artifact path must be a non-empty string");
  if (value.includes("\0") || /[\u0000-\u001f]/.test(value)) throw new Error("artifact path contains control characters");
  if (/^(?:\\\\[?.]\\|\\\?\?\\|\/\/[?.]\/)/.test(value)) throw new Error("Windows device namespace paths are forbidden");
  if (/^(?:\\\\|\/\/)[^\/\\]/.test(value)) throw new Error("UNC artifact paths are forbidden");

  const drivePrefix = /^[A-Za-z]:[\\/]/.test(value);
  const colonIndex = value.indexOf(":");
  if (colonIndex >= 0 && !(drivePrefix && colonIndex === 1 && value.indexOf(":", 2) === -1)) {
    throw new Error("artifact paths must not use NTFS alternate data streams or drive-relative forms");
  }
  if (drivePrefix && process.platform !== "win32") throw new Error("Windows drive artifact paths are not portable on this platform");

  const components = value.replace(/^[A-Za-z]:/, "").split(/[\\/]+/).filter(Boolean);
  for (const component of components) {
    if (component === "..") throw new Error("artifact paths must not contain parent traversal components");
    if (/[. ]$/.test(component)) throw new Error("artifact path components must not end in a dot or space");
    if (WINDOWS_RESERVED_COMPONENT.test(component)) throw new Error(`artifact path uses a reserved Windows device name: ${component}`);
  }
  return value;
}

export function resolveArtifactPath(repoRoot, relativeOrAbsolute, options = {}) {
  assertPortableArtifactPath(relativeOrAbsolute);
  const root = realpathSync(path.resolve(repoRoot));
  const target = path.resolve(root, relativeOrAbsolute);
  if (!isWithin(root, target)) throw new Error(`artifact path escapes repository: ${relativeOrAbsolute}`);
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) throw new Error(`artifact path must not be a symbolic link: ${relativeOrAbsolute}`);
    const real = realpathSync(target);
    if (!isWithin(root, real)) throw new Error(`artifact path resolves outside repository: ${relativeOrAbsolute}`);
  } else if (options.mustExist) {
    throw new Error(`artifact is missing: ${relativeOrAbsolute}`);
  } else {
    let ancestor = path.dirname(target);
    while (!existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
    const realAncestor = realpathSync(ancestor);
    if (!isWithin(root, realAncestor)) throw new Error(`artifact parent resolves outside repository: ${relativeOrAbsolute}`);
  }
  return target;
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
    const message = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr || result.error?.message || "git failed");
    throw new Error(`proof source state requires Git: ${message.trim().slice(-2000)}`);
  }
  return result.stdout;
}

function gitText(repoRoot, args) {
  const output = git(repoRoot, args);
  return Buffer.isBuffer(output) ? output.toString("utf8").trim() : String(output).trim();
}

function assertGitWorktreeRoot(repoRoot, message) {
  const insideWorktree = gitText(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
  const prefix = gitText(repoRoot, ["rev-parse", "--show-prefix"]);
  if (insideWorktree !== "true" || prefix !== "") throw new Error(message);
}

function untrackedBinding(repoRoot, pathspec = []) {
  const output = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", ...pathspec]);
  const paths = (Buffer.isBuffer(output) ? output.toString("utf8") : String(output)).split("\0").filter(Boolean).sort();
  const entries = [];
  for (const relativePath of paths) {
    const target = resolveArtifactPath(repoRoot, relativePath, { mustExist: true });
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) entries.push({ path: relativePath.split(path.sep).join("/"), type: "symlink", sha256: sha256(readlinkSync(target)) });
    else if (stat.isFile()) entries.push({ path: relativePath.split(path.sep).join("/"), type: "file", sha256: fileSha256(target) });
    else entries.push({ path: relativePath.split(path.sep).join("/"), type: "other", sha256: sha256(String(stat.mode)) });
  }
  return { count: entries.length, sha256: sha256(canonicalJson(entries)) };
}

export function trackedSourceState(repoRoot, expectedCommit) {
  const root = realpathSync(path.resolve(repoRoot));
  assertGitWorktreeRoot(root, "proof --repo must be the Git worktree root");
  const head = gitText(root, ["rev-parse", "--verify", "HEAD"]);
  if (expectedCommit !== head) throw new Error(`--commit must exactly match Git HEAD (${head})`);
  const tree = gitText(root, ["rev-parse", "HEAD^{tree}"]);
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const diff = git(root, ["diff", "--binary", "--full-index", "HEAD", "--"]);
  const untracked = untrackedBinding(root);
  const state = {
    gitHead: head,
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
  assertGitWorktreeRoot(root, "application source state requires the Git worktree root");
  const head = gitText(root, ["rev-parse", "--verify", "HEAD"]);
  if (expectedCommit !== head) throw new Error(`application source commit must exactly match Git HEAD (${head})`);
  const pathspec = ["--", ".", ...POST_PROOF_ARTIFACT_PATHS.map((entry) => `:(exclude,literal)${entry}`)];
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...pathspec]);
  const diff = git(root, ["diff", "--binary", "--full-index", "HEAD", ...pathspec]);
  const untracked = untrackedBinding(root, pathspec);
  const state = {
    gitHead: head,
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
    if (SECRET_NAME.test(name)) selected.add(name);
  }
  const sourceByUpper = new Map(Object.keys(process.env).map((name) => [name.toUpperCase(), name]));
  return [...selected]
    .map((name) => process.env[sourceByUpper.get(String(name).toUpperCase())])
    .filter((value) => typeof value === "string" && value.length >= 1)
    .sort((left, right) => right.length - left.length);
}

function localPathValues() {
  const sourceByUpper = new Map(Object.keys(process.env).map((name) => [name.toUpperCase(), name]));
  const values = new Set();
  for (const requestedName of LOCAL_PATH_ENV_NAMES) {
    const sourceName = sourceByUpper.get(requestedName);
    const value = sourceName ? process.env[sourceName] : undefined;
    if (typeof value !== "string" || value.length < 2) continue;
    values.add(value);
    values.add(value.replaceAll("\\", "/"));
    values.add(value.replaceAll("/", "\\"));
  }
  return [...values].filter((value) => value.length >= 2).sort((left, right) => right.length - left.length);
}

export function redactText(input, secretValues = []) {
  let value = String(input ?? "");
  for (const secret of secretValues) value = value.split(secret).join("[REDACTED]");
  return value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:api[_-]?key|authorization|credential|database[_-]?url|dsn|connection[_-]?string|password|private[_-]?key|secret|token)\s*[:=]\s*["']?[^\s,"']{1,}["']?/gi, (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`)
    .replace(/\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/)[^\s:@/]+:[^\s@/]+@/gi, "$1[REDACTED]@")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]");
}

function safeChildEnvironment(passNames = []) {
  const requested = new Set([...SAFE_ENV_NAMES, ...passNames]);
  const sourceByUpper = new Map(Object.keys(process.env).map((name) => [name.toUpperCase(), name]));
  const environment = {};
  for (const requestedName of requested) {
    const sourceName = sourceByUpper.get(String(requestedName).toUpperCase());
    if (sourceName && process.env[sourceName] !== undefined) environment[sourceName] = process.env[sourceName];
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
  if (commandDirectory && commandDirectory !== ".") candidates.push(path.join(commandDirectory, "node_modules", ...managerCli));
  candidates.push(path.join(path.dirname(execPath), "node_modules", ...managerCli));
  if (typeof env.npm_execpath === "string" && new Set(["npm-cli.js", "pnpm.cjs", "yarn.js"]).has(path.win32.basename(env.npm_execpath).toLowerCase())) candidates.push(env.npm_execpath);
  if (typeof env.APPDATA === "string") candidates.push(path.join(env.APPDATA, "npm", "node_modules", ...managerCli));
  const where = spawnSync("where.exe", [`${manager}.cmd`], { encoding: "utf8", shell: false, windowsHide: true, env });
  if (where.status === 0) for (const shim of String(where.stdout || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    candidates.push(path.join(path.dirname(shim), "node_modules", ...managerCli));
    if (manager !== "npm") candidates.push(path.join(path.dirname(shim), "node_modules", "corepack", "dist", `${manager}.js`));
  }
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

export function resolvePortableCommand(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new Error("command argv must be a non-empty string array");
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const execPath = options.execPath || process.execPath;
  if (platform !== "win32") return { argv: [...argv], resolution: "direct" };
  const executable = path.win32.basename(argv[0]).toLowerCase();
  const manager = executable.replace(/\.cmd$/, "");
  if (!new Set(["npm", "pnpm", "yarn"]).has(manager)) return { argv: [...argv], resolution: "direct" };
  const managerCli = windowsPackageManagerCliCandidates(argv[0], manager, env, execPath).find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile());
  if (!managerCli) throw new Error(`unable to resolve ${manager} to its JavaScript CLI without enabling a shell`);
  return { argv: [execPath, managerCli, ...argv.slice(1)], resolution: `windows-${manager}-cli` };
}

function boundedText(input, maxBytes, secretValues) {
  const redacted = redactText(input, secretValues);
  const bytes = Buffer.from(redacted, "utf8");
  const truncated = bytes.length > maxBytes;
  const text = truncated ? bytes.subarray(0, maxBytes).toString("utf8") : redacted;
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
  return sha256(canonicalJson({
    exitCode: attempt.exitCode,
    signal: attempt.signal,
    timedOut: attempt.timedOut,
    spawnError: attempt.spawnError,
    stdoutSha256: attempt.stdout.sha256,
    stderrSha256: attempt.stderr.sha256,
  }));
}

function derivedOutcome(execution, source = {}) {
  const attempts = execution.attempts;
  const flaky = new Set(attempts.map(attemptSignature)).size > 1;
  const timedOut = attempts.some((attempt) => attempt.timedOut);
  const spawnFailed = attempts.some((attempt) => attempt.spawnError && !attempt.timedOut);
  const allGreen = attempts.every((attempt) => attempt.exitCode === 0 && !attempt.timedOut && !attempt.spawnError);
  const allRed = attempts.every((attempt) => Number.isInteger(attempt.exitCode) && attempt.exitCode !== 0 && !attempt.timedOut && !attempt.spawnError);
  let status;
  if (flaky) status = "flaky";
  else if (timedOut) status = "timed-out";
  else if (spawnFailed) status = "spawn-failed";
  else if (source.stable === false) status = "source-mutated";
  else if (execution.mode === "red-baseline") status = allRed ? "red-confirmed" : "unexpected-green";
  else status = allGreen ? "passed" : "failed";
  return { status, flaky, successful: status === "passed" || status === "red-confirmed" };
}

function proofBindings(document) {
  const commandSha256 = sha256(canonicalJson(document.command.argv));
  const outputSha256 = sha256(canonicalJson(outputBinding(document.execution.attempts)));
  const runSha256 = sha256(document.run.id);
  const commitSha256 = sha256(document.run.commit);
  const environmentSha256 = sha256(document.run.environment);
  const environmentSnapshotSha256 = sha256(canonicalJson(document.host));
  const sourceSha256 = sha256(canonicalJson(document.source));
  const envelopeSha256 = sha256(canonicalJson({
    schema: document.schema,
    commandSha256,
    outputSha256,
    runSha256,
    commitSha256,
    environmentSha256,
    environmentSnapshotSha256,
    sourceSha256,
    mode: document.execution.mode,
    repeat: document.execution.repeat,
    timeoutMs: document.execution.timeoutMs,
  }));
  return { commandSha256, outputSha256, runSha256, commitSha256, environmentSha256, environmentSnapshotSha256, sourceSha256, envelopeSha256 };
}

export function secretDisclosureProblems(document) {
  const serialized = JSON.stringify(document);
  const problems = [];
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(serialized)) problems.push("proof artifact contains a raw private key");
  if (/\bBearer\s+(?!\[REDACTED\])\S{8,}/i.test(serialized)) problems.push("proof artifact contains a raw bearer credential");
  if (/\b(?:api[_-]?key|credential|database[_-]?url|dsn|connection[_-]?string|password|private[_-]?key|secret|token)\s*[:=]\s*(?!\[REDACTED\])[^\s,"']{1,}/i.test(serialized)) problems.push("proof artifact contains secret-like raw output");
  if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/[^\s:@/]+:[^\s@/]+@/i.test(serialized)) problems.push("proof artifact contains a raw connection credential");
  return problems;
}

export function agentSelfGrantProblems(value, location = "artifact") {
  const problems = [];
  if (!value || typeof value !== "object") return problems;
  if (!Array.isArray(value) && value.status === "granted" && value.actorType === "agent") problems.push(`${location} contains an agent self-granted approval`);
  if (Array.isArray(value)) value.forEach((entry, index) => problems.push(...agentSelfGrantProblems(entry, `${location}[${index}]`)));
  else for (const [key, entry] of Object.entries(value)) problems.push(...agentSelfGrantProblems(entry, `${location}.${key}`));
  return problems;
}

export function validatePortableProof(document) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["portable proof must be a JSON object"] };
  if (document.schema !== PORTABLE_PROOF_SCHEMA) problems.push(`portable proof schema must be ${PORTABLE_PROOF_SCHEMA}`);
  if (!safeIdentifier(document.run?.id)) problems.push("portable proof run.id is invalid");
  if (!GIT_OBJECT_ID.test(document.run?.commit || "")) problems.push("portable proof run.commit must be a 40- or 64-character Git object ID");
  if (!safeIdentifier(document.run?.environment)) problems.push("portable proof run.environment is invalid");
  if (!Array.isArray(document.command?.argv) || document.command.argv.length === 0 || document.command.argv.some((entry) => typeof entry !== "string" || !entry.length)) problems.push("portable proof command.argv must be a non-empty string array");
  if (document.command?.requestedArgv !== undefined && (!Array.isArray(document.command.requestedArgv) || document.command.requestedArgv.length === 0 || document.command.requestedArgv.some((entry) => typeof entry !== "string" || !entry.length))) problems.push("portable proof command.requestedArgv must be a non-empty string array when present");
  if (!new Set(["direct", "windows-npm-cli", "windows-pnpm-cli", "windows-yarn-cli"]).has(document.command?.resolution)) problems.push("portable proof command.resolution is invalid");
  if (document.execution?.shell !== false) problems.push("portable proof execution.shell must be false");
  if (!Number.isInteger(document.execution?.timeoutMs) || document.execution.timeoutMs < 1 || document.execution.timeoutMs > 600_000) problems.push("portable proof timeoutMs must be between 1 and 600000");
  if (!Number.isInteger(document.execution?.repeat) || document.execution.repeat < 1 || document.execution.repeat > 20) problems.push("portable proof repeat must be between 1 and 20");
  if (!Number.isInteger(document.execution?.maxOutputBytes) || document.execution.maxOutputBytes < 256 || document.execution.maxOutputBytes > 1_048_576) problems.push("portable proof maxOutputBytes must be between 256 and 1048576");
  if (!new Set(["green", "red-baseline"]).has(document.execution?.mode)) problems.push("portable proof execution.mode is invalid");
  if (!Array.isArray(document.execution?.attempts) || document.execution.attempts.length !== document.execution?.repeat) problems.push("portable proof attempts must match repeat");
  for (const [index, attempt] of (document.execution?.attempts || []).entries()) {
    if (attempt.index !== index + 1) problems.push(`portable proof attempt ${index + 1} index is invalid`);
    if (!(attempt.exitCode === null || Number.isInteger(attempt.exitCode))) problems.push(`portable proof attempt ${index + 1} exitCode is invalid`);
    if (!(attempt.signal === null || typeof attempt.signal === "string")) problems.push(`portable proof attempt ${index + 1} signal is invalid`);
    if (typeof attempt.timedOut !== "boolean") problems.push(`portable proof attempt ${index + 1} timedOut is invalid`);
    if (!(attempt.spawnError === null || typeof attempt.spawnError === "string")) problems.push(`portable proof attempt ${index + 1} spawnError is invalid`);
    if (!Number.isInteger(attempt.durationMs) || attempt.durationMs < 0) problems.push(`portable proof attempt ${index + 1} durationMs is invalid`);
    for (const stream of ["stdout", "stderr"]) {
      const output = attempt[stream];
      if (!output || typeof output.text !== "string") problems.push(`portable proof attempt ${index + 1} ${stream} is invalid`);
      else {
        if (output.sha256 !== sha256(output.text)) problems.push(`portable proof attempt ${index + 1} ${stream} digest does not match persisted output`);
        if (Buffer.byteLength(output.text) > document.execution.maxOutputBytes) problems.push(`portable proof attempt ${index + 1} ${stream} exceeds persisted output bound`);
        if (output.persistedBytes !== Buffer.byteLength(output.text)) problems.push(`portable proof attempt ${index + 1} ${stream} persistedBytes is invalid`);
      }
    }
  }
  const source = document.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) problems.push("portable proof source binding is required");
  else {
    if (source.gitHead !== document.run?.commit) problems.push("portable proof source.gitHead must match run.commit");
    if (!SHA256.test(source.gitTreeSha256 || "")) problems.push("portable proof source.gitTreeSha256 is invalid");
    for (const field of ["beforeSha256", "afterSha256", "applicationBeforeSha256", "applicationAfterSha256", "validatorSha256"]) if (!SHA256.test(source[field] || "")) problems.push(`portable proof source.${field} is invalid`);
    if (typeof source.dirtyBefore !== "boolean" || typeof source.dirtyAfter !== "boolean") problems.push("portable proof source dirty flags are invalid");
    if (typeof source.stable !== "boolean" || source.stable !== (source.beforeSha256 === source.afterSha256)) problems.push("portable proof source.stable does not match the bound worktree states");
    if (typeof source.applicationStable !== "boolean" || source.applicationStable !== (source.applicationBeforeSha256 === source.applicationAfterSha256)) problems.push("portable proof source.applicationStable does not match the application source projection");
  }
  if (problems.length === 0) {
    const expected = proofBindings(document);
    for (const [name, digest] of Object.entries(expected)) {
      if (!SHA256.test(document.bindings?.[name] || "") || document.bindings[name] !== digest) problems.push(`portable proof binding ${name} does not match`);
    }
    const signatures = new Set(document.execution.attempts.map(attemptSignature));
    if (document.outcome?.flaky !== (signatures.size > 1)) problems.push("portable proof flaky outcome does not match attempts");
    const expectedOutcome = derivedOutcome(document.execution, document.source);
    for (const field of ["status", "flaky", "successful"]) {
      if (document.outcome?.[field] !== expectedOutcome[field]) problems.push(`portable proof outcome.${field} does not match attempts`);
    }
  }
  problems.push(...secretDisclosureProblems(document));
  return { valid: problems.length === 0, problems };
}

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const optionArgs = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1) : [];
  const args = { repo: process.cwd(), timeoutMs: 30_000, repeat: 1, maxOutputBytes: 16_384, mode: "green", redactEnv: [], passEnv: [] };
  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === "--repo") args.repo = optionArgs[++index];
    else if (arg === "--run-id") args.runId = optionArgs[++index];
    else if (arg === "--commit") args.commit = optionArgs[++index];
    else if (arg === "--environment") args.environment = optionArgs[++index];
    else if (arg === "--output") args.output = optionArgs[++index];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(optionArgs[++index]);
    else if (arg === "--repeat") args.repeat = Number(optionArgs[++index]);
    else if (arg === "--max-output-bytes") args.maxOutputBytes = Number(optionArgs[++index]);
    else if (arg === "--red-baseline") args.mode = "red-baseline";
    else if (arg === "--redact-env") args.redactEnv.push(optionArgs[++index]);
    else if (arg === "--pass-env") args.passEnv.push(optionArgs[++index]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { ...args, command };
}

function usage() {
  return "Usage: node scripts/proof-runner.mjs --repo . --run-id ID --commit SHA --environment NAME --output proof/portable.json [--timeout-ms N] [--repeat N] [--max-output-bytes N] [--red-baseline] [--pass-env NAME] [--redact-env NAME] -- <executable> [args...]";
}

function execute(args) {
  if (!safeIdentifier(args.runId)) throw new Error("--run-id must be a safe identifier");
  if (!GIT_OBJECT_ID.test(args.commit || "")) throw new Error("--commit must be a 40- or 64-character Git object ID");
  if (!safeIdentifier(args.environment)) throw new Error("--environment must be a safe identifier");
  if (!args.output) throw new Error("--output is required");
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1 || args.timeoutMs > 600_000) throw new Error("--timeout-ms must be between 1 and 600000");
  if (!Number.isInteger(args.repeat) || args.repeat < 1 || args.repeat > 20) throw new Error("--repeat must be between 1 and 20");
  if (!Number.isInteger(args.maxOutputBytes) || args.maxOutputBytes < 256 || args.maxOutputBytes > 1_048_576) throw new Error("--max-output-bytes must be between 256 and 1048576");
  if (!args.command.length) throw new Error("an executable argv array is required after --");

  const repoRoot = realpathSync(path.resolve(args.repo));
  const outputPath = resolveArtifactPath(repoRoot, args.output);
  if (existsSync(outputPath)) throw new Error("proof artifacts are immutable; choose a new output path");
  const sourceBefore = trackedSourceState(repoRoot, args.commit);
  const applicationBefore = applicationSourceState(repoRoot, args.commit);
  const resolvedCommand = resolvePortableCommand(args.command);
  const secretValues = [...new Set([...explicitSecretValues([...args.redactEnv, ...args.passEnv]), ...localPathValues()])]
    .sort((left, right) => right.length - left.length);
  const childEnvironment = safeChildEnvironment(args.passEnv);
  const persistedRequestedArgv = args.command.map((entry) => redactText(entry, secretValues));
  const persistedArgv = resolvedCommand.argv.map((entry) => redactText(entry, secretValues));
  const attempts = [];

  for (let index = 0; index < args.repeat; index += 1) {
    const started = Date.now();
    const result = spawnSync(resolvedCommand.argv[0], resolvedCommand.argv.slice(1), {
      cwd: repoRoot,
      encoding: "utf8",
      env: childEnvironment,
      shell: false,
      timeout: args.timeoutMs,
      killSignal: "SIGTERM",
      maxBuffer: Math.max(1_048_576, args.maxOutputBytes * 4),
    });
    const timedOut = result.error?.code === "ETIMEDOUT";
    attempts.push({
      index: index + 1,
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null,
      timedOut,
      spawnError: result.error ? redactText(`${result.error.code || "SPAWN_ERROR"}: ${result.error.message}`, secretValues) : null,
      durationMs: Date.now() - started,
      stdout: boundedText(result.stdout, args.maxOutputBytes, secretValues),
      stderr: boundedText(result.stderr, args.maxOutputBytes, secretValues),
    });
  }

  const sourceAfter = trackedSourceState(repoRoot, args.commit);
  const applicationAfter = applicationSourceState(repoRoot, args.commit);
  const source = {
    gitHead: sourceBefore.gitHead,
    gitTreeSha256: sourceBefore.gitTreeSha256,
    beforeSha256: sourceBefore.worktreeSha256,
    afterSha256: sourceAfter.worktreeSha256,
    dirtyBefore: sourceBefore.dirty,
    dirtyAfter: sourceAfter.dirty,
    stable: sourceBefore.worktreeSha256 === sourceAfter.worktreeSha256,
    applicationBeforeSha256: applicationBefore.worktreeSha256,
    applicationAfterSha256: applicationAfter.worktreeSha256,
    applicationStable: applicationBefore.worktreeSha256 === applicationAfter.worktreeSha256,
    validatorSha256: sourceBefore.validatorSha256,
  };

  const artifact = {
    schema: PORTABLE_PROOF_SCHEMA,
    generatedAt: new Date().toISOString(),
    run: { id: args.runId, commit: args.commit, environment: args.environment },
    host: { platform: process.platform, arch: process.arch, node: process.version, ci: Boolean(process.env.CI) },
    source,
    command: { argv: persistedArgv, requestedArgv: persistedRequestedArgv, resolution: resolvedCommand.resolution },
    execution: { shell: false, mode: args.mode, timeoutMs: args.timeoutMs, repeat: args.repeat, maxOutputBytes: args.maxOutputBytes, attempts },
    outcome: undefined,
  };
  artifact.outcome = derivedOutcome(artifact.execution, artifact.source);
  artifact.bindings = proofBindings(artifact);
  const validation = validatePortableProof(artifact);
  if (!validation.valid) throw new Error(`refusing to persist invalid proof: ${validation.problems.join("; ")}`);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ ok: artifact.outcome.successful, status: artifact.outcome.status, artifact: path.relative(repoRoot, outputPath), bindings: artifact.bindings }, null, 2));
  if (!artifact.outcome.successful) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(usage());
  execute(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
