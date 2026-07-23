#!/usr/bin/env node
import { createPrivateKey, sign as signPayload } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, safeIdentifier, sha256 } from "./proof-runner.mjs";
import {
  AUTHORITY_TRUST_SHA256_ENV,
  authorityAttestationPayload,
} from "./v09-assurance-lib.mjs";
import {
  assertOperatorRootSecurity,
  assertOperatorRootUnchanged,
  hardenNewPrivateDirectory,
} from "./operator-root-security.mjs";

const SHA256 = /^[a-f0-9]{64}$/i;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FILTER_DRIVER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const CONTAINER_UID = 65_534;
const CONTAINER_GID = 65_534;
const MAX_SPAWN_TIMEOUT_MS = 2_147_483_647;
const RUNTIME_CAPSULE_SECURITY_TIMEOUT_MS = 10_000;

function canonicalExistingPath(target) {
  return realpathSync.native(path.resolve(target));
}

function canonicalFuturePath(target) {
  const resolved = path.resolve(target);
  return path.join(
    canonicalExistingPath(path.dirname(resolved)),
    path.basename(resolved),
  );
}

function containsPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function minimalEnvironment(names) {
  return Object.fromEntries(
    names
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
}

export function minimalGitEnvironment(isolatedGlobalConfig, isolatedHome) {
  return {
    ...minimalEnvironment(["SystemRoot", "WINDIR"]),
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: isolatedHome,
    TEMP: isolatedHome,
    TMP: isolatedHome,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: isolatedGlobalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
}

export function isolatedRuntimeEnvironment(isolatedHome) {
  return {
    ...minimalEnvironment(["SystemRoot", "WINDIR"]),
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, "xdg-config"),
    XDG_CACHE_HOME: path.join(isolatedHome, "xdg-cache"),
    DOCKER_CONFIG: path.join(isolatedHome, "docker"),
    CONTAINERS_CONF: path.join(isolatedHome, "containers.conf"),
    CONTAINERS_REGISTRIES_CONF: path.join(isolatedHome, "registries.conf"),
    CONTAINERS_STORAGE_CONF: path.join(isolatedHome, "storage.conf"),
    TEMP: isolatedHome,
    TMP: isolatedHome,
  };
}

function safeGitArguments(
  repoRoot,
  isolatedHooksRoot,
  args,
  filterDrivers = [],
) {
  const inertFilterArguments = filterDrivers.flatMap((driver) => [
    "-c",
    `filter.${driver}.process=`,
    "-c",
    `filter.${driver}.clean=`,
    "-c",
    `filter.${driver}.smudge=`,
    "-c",
    `filter.${driver}.required=false`,
  ]);
  return [
    "--no-optional-locks",
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.hooksPath=${isolatedHooksRoot}`,
    "-c",
    `core.worktree=${repoRoot}`,
    "-c",
    "core.pager=cat",
    "-c",
    "core.attributesFile=",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "credential.helper=",
    "-c",
    "submodule.recurse=false",
    ...inertFilterArguments,
    "-C",
    repoRoot,
    ...args,
  ];
}

export function createExecutionDeadline(
  limitMs,
  startedMs = Date.now(),
  now = () => Date.now(),
) {
  const cleanupReserveMs = Math.min(
    10_000,
    Math.max(1, Math.floor(limitMs / 10)),
  );
  const deadlineMs = startedMs + limitMs;
  const remaining = (phase, { reserveCleanup = false } = {}) => {
    const reserve = reserveCleanup ? cleanupReserveMs : 0;
    const value = Math.floor(deadlineMs - now() - reserve);
    if (value < 1)
      throw new Error(
        `executor total wall-clock deadline exceeded during ${phase}`,
      );
    return Math.min(value, MAX_SPAWN_TIMEOUT_MS);
  };
  return {
    startedAt: new Date(startedMs).toISOString(),
    limitMs,
    cleanupReserveMs,
    remaining,
    assert(phase, options) {
      remaining(phase, options);
    },
    elapsedMs() {
      return Math.max(0, now() - startedMs);
    },
  };
}

function spawnWithinDeadline(
  command,
  argv,
  options,
  deadline,
  phase,
  deadlineOptions = {},
  spawnSyncImpl = spawnSync,
) {
  const { maxTimeoutMs, ...remainingOptions } = deadlineOptions;
  const remaining = deadline.remaining(phase, remainingOptions);
  const result = spawnSyncImpl(command, argv, {
    ...options,
    timeout: Math.min(remaining, maxTimeoutMs || remaining),
  });
  if (result.error?.code === "ETIMEDOUT")
    throw new Error(
      `executor total wall-clock deadline exceeded during ${phase}`,
    );
  deadline.assert(phase, remainingOptions);
  return result;
}

function portableArtifactId(value) {
  return (
    ARTIFACT_ID.test(value || "") &&
    !WINDOWS_DEVICE_NAMES.test(String(value).split(".", 1)[0])
  );
}

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    runtime: "docker",
    network: "none",
    cpu: 2,
    memory: 1_073_741_824,
    outputBytes: 10_485_760,
    wallClockMs: 120_000,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--run-id") args.runId = argv[++index];
    else if (arg === "--image") args.image = argv[++index];
    else if (arg === "--command-json") args.commandJson = argv[++index];
    else if (arg === "--output-dir") args.outputDir = argv[++index];
    else if (arg === "--receipt") args.receipt = argv[++index];
    else if (arg === "--semantic-proof-set-sha256")
      args.semanticProofSetSha256 = argv[++index];
    else if (arg === "--proof-input-set-sha256")
      args.proofInputSetSha256 = argv[++index];
    else if (arg === "--accepted-gate-artifacts-sha256")
      args.acceptedGateArtifactsSha256 = argv[++index];
    else if (arg === "--command-identity-sha256")
      args.commandIdentitySha256 = argv[++index];
    else if (arg === "--validator-sha256") args.validatorSha256 = argv[++index];
    else if (arg === "--runtime") args.runtime = argv[++index];
    else if (arg === "--git-cli") args.gitCli = argv[++index];
    else if (arg === "--git-cli-sha256") args.gitCliSha256 = argv[++index];
    else if (arg === "--runtime-cli") args.runtimeCli = argv[++index];
    else if (arg === "--runtime-cli-sha256")
      args.runtimeCliSha256 = argv[++index];
    else if (arg === "--daemon-identity-sha256")
      args.daemonIdentitySha256 = argv[++index];
    else if (arg === "--network") args.network = argv[++index];
    else if (arg === "--cpu") args.cpu = Number(argv[++index]);
    else if (arg === "--memory") args.memory = Number(argv[++index]);
    else if (arg === "--output-bytes") args.outputBytes = Number(argv[++index]);
    else if (arg === "--wall-clock-ms")
      args.wallClockMs = Number(argv[++index]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function git(
  gitCli,
  repoRoot,
  args,
  deadline,
  isolatedHooksRoot,
  isolatedGlobalConfig,
  phase = `git ${args[0]}`,
  filterDrivers = [],
) {
  const result = spawnWithinDeadline(
    gitCli,
    safeGitArguments(repoRoot, isolatedHooksRoot, args, filterDrivers),
    {
      encoding: "utf8",
      env: minimalGitEnvironment(
        isolatedGlobalConfig,
        path.dirname(isolatedGlobalConfig),
      ),
      shell: false,
      windowsHide: true,
    },
    deadline,
    phase,
  );
  if (result.error)
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  return result.stdout.trim();
}

function trackedFilterDrivers(
  gitCli,
  repoRoot,
  deadline,
  isolatedHooksRoot,
  isolatedGlobalConfig,
) {
  const gitOptions = {
    cwd: repoRoot,
    encoding: null,
    env: minimalGitEnvironment(
      isolatedGlobalConfig,
      path.dirname(isolatedGlobalConfig),
    ),
    shell: false,
    maxBuffer: 67_108_864,
    windowsHide: true,
  };
  const tracked = spawnWithinDeadline(
    gitCli,
    safeGitArguments(repoRoot, isolatedHooksRoot, [
      "ls-files",
      "-z",
      "--cached",
    ]),
    gitOptions,
    deadline,
    "source preflight: tracked filter inventory",
  );
  if (tracked.error || tracked.status !== 0)
    throw new Error(
      `failed to inventory tracked paths before filter isolation: ${
        tracked.error?.message ||
        String(tracked.stderr || tracked.stdout || "").slice(-4000)
      }`,
    );
  if (!tracked.stdout.length) return [];
  const attributes = spawnWithinDeadline(
    gitCli,
    safeGitArguments(repoRoot, isolatedHooksRoot, [
      "check-attr",
      "-z",
      "--stdin",
      "filter",
    ]),
    { ...gitOptions, input: tracked.stdout },
    deadline,
    "source preflight: tracked filter attributes",
  );
  if (attributes.error || attributes.status !== 0)
    throw new Error(
      `failed to resolve tracked filter attributes: ${
        attributes.error?.message ||
        String(attributes.stderr || attributes.stdout || "").slice(-4000)
      }`,
    );
  const fields = attributes.stdout.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 3 !== 0)
    throw new Error("Git returned malformed tracked filter attributes");
  const drivers = new Set();
  for (let index = 0; index < fields.length; index += 3) {
    const attribute = fields[index + 1];
    const value = fields[index + 2];
    if (attribute !== "filter")
      throw new Error("Git returned an unexpected tracked attribute");
    if (value === "unspecified" || value === "unset") continue;
    if (value === "set" || !FILTER_DRIVER.test(value))
      throw new Error(
        `tracked path uses an ambiguous or unsafe filter driver: ${value}`,
      );
    drivers.add(value);
  }
  return [...drivers].sort();
}

function sourceState(
  gitCli,
  repoRoot,
  deadline,
  isolatedHooksRoot,
  isolatedGlobalConfig,
  phase = "source preflight",
) {
  const filterDrivers = trackedFilterDrivers(
    gitCli,
    repoRoot,
    deadline,
    isolatedHooksRoot,
    isolatedGlobalConfig,
  );
  const status = git(
    gitCli,
    repoRoot,
    ["status", "--porcelain=v1", "-z", "--ignore-submodules=all"],
    deadline,
    isolatedHooksRoot,
    isolatedGlobalConfig,
    `${phase}: status`,
    filterDrivers,
  );
  if (status.length)
    throw new Error("attested execution requires a clean source worktree");
  return {
    commit: git(
      gitCli,
      repoRoot,
      ["rev-parse", "HEAD"],
      deadline,
      isolatedHooksRoot,
      isolatedGlobalConfig,
      `${phase}: commit`,
    ),
    tree: git(
      gitCli,
      repoRoot,
      ["rev-parse", "HEAD^{tree}"],
      deadline,
      isolatedHooksRoot,
      isolatedGlobalConfig,
      `${phase}: tree`,
    ),
    objectFormat: git(
      gitCli,
      repoRoot,
      ["rev-parse", "--show-object-format"],
      deadline,
      isolatedHooksRoot,
      isolatedGlobalConfig,
      `${phase}: object format`,
    ),
    filterDrivers,
  };
}

export function commissionedExecutable(label, configuredPath, expectedSha256) {
  if (!configuredPath || !path.isAbsolute(configuredPath))
    throw new Error(`${label} path must be absolute`);
  if (!SHA256.test(expectedSha256 || ""))
    throw new Error(`${label} SHA256 is required`);
  if (!existsSync(configuredPath))
    throw new Error(`${label} path does not exist`);
  const stats = lstatSync(configuredPath);
  if (!stats.isFile() && !stats.isSymbolicLink())
    throw new Error(`${label} path must identify a file`);
  const realPath = canonicalExistingPath(configuredPath);
  const actualSha256 = sha256(readFileSync(realPath));
  if (actualSha256 !== expectedSha256.toLowerCase())
    throw new Error(`${label} binary does not match its commissioned SHA256`);
  return {
    path: realPath,
    pathSha256: sha256(realPath),
    sha256: actualSha256,
  };
}

function assertCommissionedExecutableUnchanged(label, commissioned) {
  if (
    !existsSync(commissioned.path) ||
    canonicalExistingPath(commissioned.path) !== commissioned.path ||
    sha256(readFileSync(commissioned.path)) !== commissioned.sha256
  )
    throw new Error(`${label} binary changed during attested execution`);
}

function windowsRuntimeCapsuleProtection(
  capsulePath,
  capsuleRoot,
  currentSid,
  environment,
  deadline,
) {
  const windowsRoot = environment.SystemRoot || environment.WINDIR;
  if (!windowsRoot)
    throw new Error(
      "SystemRoot is required to protect a Windows runtime capsule",
    );
  const powershell = path.join(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!existsSync(powershell))
    throw new Error(
      "Windows PowerShell is required to protect the runtime capsule",
    );
  const icacls = path.join(windowsRoot, "System32", "icacls.exe");
  if (!existsSync(icacls))
    throw new Error("icacls is required to protect the runtime capsule");
  if (!/^S-1-[0-9-]+$/iu.test(currentSid || ""))
    throw new Error("current Windows SID is required for capsule protection");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$capsule = $env:VALDRIS_RUNTIME_CAPSULE
$root = $env:VALDRIS_RUNTIME_CAPSULE_ROOT
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$rootAcl = Get-Acl -LiteralPath $root
$fileAcl = Get-Acl -LiteralPath $capsule
[PSCustomObject]@{
  currentSid = $current.Value
  rootOwnerSid = $rootAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  rootSddl = $rootAcl.Sddl
  fileOwnerSid = $fileAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  fileSddl = $fileAcl.Sddl
} | ConvertTo-Json -Compress
`;
  const invoke = ({ reserveCleanup = true } = {}) => {
    const phase = "Windows runtime capsule ACL inspection";
    const options = {
      encoding: "utf8",
      env: {
        SystemRoot: environment.SystemRoot,
        WINDIR: environment.WINDIR,
        VALDRIS_RUNTIME_CAPSULE: capsulePath,
        VALDRIS_RUNTIME_CAPSULE_ROOT: capsuleRoot,
      },
      maxBuffer: 1_048_576,
      shell: false,
      windowsHide: true,
    };
    const result = deadline
      ? spawnWithinDeadline(
          powershell,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
          ],
          options,
          deadline,
          phase,
          {
            reserveCleanup,
            maxTimeoutMs: RUNTIME_CAPSULE_SECURITY_TIMEOUT_MS,
          },
        )
      : spawnSync(
          powershell,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
          ],
          { ...options, timeout: RUNTIME_CAPSULE_SECURITY_TIMEOUT_MS },
        );
    if (result.error || result.status !== 0)
      throw new Error(
        `failed to inspect Windows runtime capsule ACL: ${
          result.error?.message || result.stderr || result.stdout
        }`,
      );
    let inspected;
    try {
      inspected = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        "Windows runtime capsule ACL inspection returned malformed JSON",
      );
    }
    const currentSid = String(inspected?.currentSid || "").toUpperCase();
    if (
      !currentSid ||
      String(inspected?.rootOwnerSid || "").toUpperCase() !== currentSid ||
      String(inspected?.fileOwnerSid || "").toUpperCase() !== currentSid ||
      typeof inspected?.rootSddl !== "string" ||
      typeof inspected?.fileSddl !== "string"
    )
      throw new Error("Windows runtime capsule ACL inspection is incomplete");
    return {
      currentSid,
      rootOwnerSid: currentSid,
      rootSddl: inspected.rootSddl,
      fileOwnerSid: currentSid,
      fileSddl: inspected.fileSddl,
    };
  };
  const runIcacls = (target, grant, { deadlineAware = true } = {}) => {
    const phase = "Windows runtime capsule ACL update";
    const argv = [
      target,
      "/inheritance:r",
      "/grant:r",
      `*${currentSid}:${grant}`,
    ];
    const options = {
      encoding: "utf8",
      env: { SystemRoot: environment.SystemRoot, WINDIR: environment.WINDIR },
      maxBuffer: 1_048_576,
      shell: false,
      windowsHide: true,
    };
    const result =
      deadline && deadlineAware
        ? spawnWithinDeadline(icacls, argv, options, deadline, phase, {
            reserveCleanup: true,
            maxTimeoutMs: RUNTIME_CAPSULE_SECURITY_TIMEOUT_MS,
          })
        : spawnSync(icacls, argv, {
            ...options,
            timeout: RUNTIME_CAPSULE_SECURITY_TIMEOUT_MS,
          });
    if (result.error || result.status !== 0)
      throw new Error(
        `failed to update Windows runtime capsule ACL: ${
          result.error?.message || result.stderr || result.stdout
        }`,
      );
  };
  const restore = () => {
    const failures = [];
    for (const [target, grant] of [
      [capsulePath, "(F)"],
      [capsuleRoot, "(OI)(CI)(F)"],
    ]) {
      try {
        runIcacls(target, grant, { deadlineAware: false });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `failed to release Windows runtime capsule ACL: ${failures
          .map((error) => error.message)
          .join("; ")}`,
      );
  };
  let protectedAcl;
  try {
    runIcacls(capsulePath, "(RX)");
    runIcacls(capsuleRoot, "(OI)(CI)(RX)");
    protectedAcl = invoke();
  } catch (error) {
    try {
      restore();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Windows runtime capsule protection failed: ${error.message}; cleanup failed: ${cleanupError.message}`,
      );
    }
    throw error;
  }
  const protectedAclSha256 = sha256(canonicalJson(protectedAcl));
  let released = false;
  return {
    protectedAclSha256,
    assertProtected(options) {
      if (released)
        throw new Error("Windows runtime capsule ACL protection is released");
      const current = invoke(options);
      if (sha256(canonicalJson(current)) !== protectedAclSha256)
        throw new Error("Windows runtime capsule ACL changed during execution");
    },
    release() {
      if (released) return;
      restore();
      released = true;
    },
  };
}

export function stageCommissionedRuntimeExecutable({
  runtimeCli,
  runtimeCliSha256,
  privateRoot,
  deadline,
  platform = process.platform,
  environment = process.env,
}) {
  deadline?.assert("runtime capsule staging", { reserveCleanup: true });
  const source = commissionedExecutable(
    "runtime CLI",
    runtimeCli,
    runtimeCliSha256,
  );
  const privateRootIdentity = assertOperatorRootSecurity(privateRoot, {
    platform,
    environment,
  });
  const capsuleRoot = path.join(privateRootIdentity.path, "runtime-capsule");
  mkdirSync(capsuleRoot, { mode: 0o700 });
  hardenNewPrivateDirectory(capsuleRoot, { platform, environment });
  const sourceBytes = readFileSync(source.path);
  if (sha256(sourceBytes) !== source.sha256)
    throw new Error("runtime CLI changed while staging the execution capsule");
  const capsulePath = path.join(
    capsuleRoot,
    platform === "win32" ? "runtime.exe" : "runtime",
  );
  writeFileSync(capsulePath, sourceBytes, {
    flag: "wx",
    mode: 0o500,
  });
  chmodSync(capsulePath, 0o500);
  const capsule = commissionedExecutable(
    "runtime execution capsule",
    capsulePath,
    source.sha256,
  );
  const capsuleProtection =
    platform === "win32"
      ? windowsRuntimeCapsuleProtection(
          capsule.path,
          capsuleRoot,
          privateRootIdentity.identity.owner.id,
          environment,
          deadline,
        )
      : { assertProtected() {}, release() {} };
  if (platform !== "win32") chmodSync(capsuleRoot, 0o500);
  const capsuleRootIdentity = assertOperatorRootSecurity(capsuleRoot, {
    platform,
    environment,
  });
  const assertProtected = (options) => {
    capsuleProtection.assertProtected(options);
    assertOperatorRootUnchanged(capsuleRoot, capsuleRootIdentity, {
      platform,
      environment,
    });
    const capsuleMode = lstatSync(capsule.path).mode & 0o777;
    if ((capsuleMode & 0o222) !== 0)
      throw new Error("runtime execution capsule regained write authority");
    assertCommissionedExecutableUnchanged("runtime execution capsule", capsule);
  };
  try {
    assertProtected({ reserveCleanup: true });
    deadline?.assert("runtime capsule staging", { reserveCleanup: true });
  } catch (error) {
    let cleanupFailure;
    try {
      capsuleProtection.release();
      chmodSync(capsule.path, 0o700);
      chmodSync(capsuleRoot, 0o700);
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
    }
    if (cleanupFailure)
      throw new AggregateError(
        [error, cleanupFailure],
        `runtime capsule staging failed: ${error.message}; cleanup failed: ${cleanupFailure.message}`,
      );
    throw error;
  }
  let released = false;
  return {
    ...capsule,
    sourcePath: source.path,
    sourcePathSha256: source.pathSha256,
    rootPathSha256: capsuleRootIdentity.pathSha256,
    rootIdentitySha256: capsuleRootIdentity.identitySha256,
    mode: "hardened-private-capsule",
    assertProtected,
    release() {
      if (released) return;
      released = true;
      let releaseFailure;
      try {
        assertProtected({ reserveCleanup: false });
      } catch (error) {
        releaseFailure = error;
      }
      try {
        capsuleProtection.release();
      } catch (error) {
        releaseFailure ||= error;
      }
      try {
        chmodSync(capsule.path, 0o700);
        chmodSync(capsuleRoot, 0o700);
      } catch (error) {
        releaseFailure ||= error;
      }
      if (releaseFailure) throw releaseFailure;
    },
  };
}

const AMBIENT_RUNTIME_ENDPOINT_VARIABLES = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "CONTAINER_HOST",
  "CONTAINER_CONNECTION",
];

export function runCommissionedRuntimeCommand({
  runtimeCli,
  runtimeCliSha256,
  environment,
  argv,
  options = {},
  deadline,
  phase,
  deadlineOptions = {},
  runtimeGuard,
  spawnSyncImpl = spawnSync,
}) {
  if (!environment || typeof environment !== "object")
    throw new Error("isolated runtime environment is required");
  for (const name of AMBIENT_RUNTIME_ENDPOINT_VARIABLES)
    if (Object.hasOwn(environment, name))
      throw new Error(`isolated runtime environment retained ${name}`);
  if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string"))
    throw new Error("runtime argv must be a string array");
  const guardDeadlineOptions = {
    reserveCleanup: deadlineOptions.reserveCleanup === true,
  };
  runtimeGuard?.assertProtected(guardDeadlineOptions);
  const commissioned = commissionedExecutable(
    "runtime CLI",
    runtimeCli,
    runtimeCliSha256,
  );
  const commandOptions = {
    encoding: "utf8",
    windowsHide: true,
    ...options,
    env: environment,
    shell: false,
  };
  let result;
  let executionFailure;
  try {
    if (deadline) {
      if (typeof phase !== "string" || !phase)
        throw new Error("runtime command phase is required with a deadline");
      result = spawnWithinDeadline(
        commissioned.path,
        argv,
        commandOptions,
        deadline,
        phase,
        deadlineOptions,
        spawnSyncImpl,
      );
    } else result = spawnSyncImpl(commissioned.path, argv, commandOptions);
  } catch (error) {
    executionFailure = error;
  }
  let integrityFailure;
  try {
    assertCommissionedExecutableUnchanged("runtime CLI", commissioned);
    runtimeGuard?.assertProtected(guardDeadlineOptions);
  } catch (error) {
    integrityFailure = error;
  }
  if (integrityFailure) throw integrityFailure;
  if (executionFailure) throw executionFailure;
  return result;
}

const RUNTIME_DAEMON_UNAVAILABLE_PATTERNS = {
  docker: [
    /^Cannot connect to the Docker daemon at [^\r\n]+\. Is the docker daemon running\?$/iu,
    /^failed to connect to the docker API at [^\r\n]+; check if the path is correct and if the daemon is running: [^\r\n]*(?:connection refused|no such file or directory|the system cannot find the file specified)[^\r\n]*$/iu,
  ],
  podman: [
    /^Error: (?:unable|failed) to connect to Podman socket: [^\r\n]*(?:connection refused|no such file or directory|the system cannot find the file specified)[^\r\n]*$/iu,
  ],
};

export function classifyRuntimeDaemonInfoFailure(runtimeKind, result) {
  if (
    !["docker", "podman"].includes(runtimeKind) ||
    result?.error ||
    result?.status === 0
  )
    return null;
  const stderr = String(result?.stderr || "").trim();
  return RUNTIME_DAEMON_UNAVAILABLE_PATTERNS[runtimeKind].some((pattern) =>
    pattern.test(stderr),
  )
    ? "daemon-unavailable"
    : null;
}

class RuntimeDaemonProbeUnavailableError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "RuntimeDaemonProbeUnavailableError";
    this.reason = reason;
  }
}

function runtimeInfoWithinDeadline(
  runtimeKind,
  runtimeCli,
  runtimeCliSha256,
  runtimeGuard,
  argv,
  environment,
  deadline,
  label,
) {
  let result;
  try {
    result = runCommissionedRuntimeCommand({
      runtimeCli,
      runtimeCliSha256,
      environment,
      argv,
      options: {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 4_194_304,
      },
      deadline,
      phase: label,
      runtimeGuard,
    });
  } catch (error) {
    if (
      error.message ===
      `executor total wall-clock deadline exceeded during ${label}`
    )
      throw new RuntimeDaemonProbeUnavailableError(
        "daemon-probe-timeout",
        error.message,
      );
    throw error;
  }
  const unavailableReason = classifyRuntimeDaemonInfoFailure(
    runtimeKind,
    result,
  );
  if (unavailableReason)
    throw new RuntimeDaemonProbeUnavailableError(
      unavailableReason,
      `${label} unavailable: ${result.stderr}`,
    );
  return result;
}

function parseRuntimeJson(result, label) {
  if (result.error || result.status !== 0)
    throw new Error(
      `${label} failed: ${
        result.error
          ? [
              result.error.message,
              result.error.code ? `code=${result.error.code}` : null,
              Number.isInteger(result.error.errno)
                ? `errno=${result.error.errno}`
                : null,
              result.error.syscall ? `syscall=${result.error.syscall}` : null,
            ]
              .filter(Boolean)
              .join("; ")
          : result.stderr || result.stdout
      }`,
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
}

export function probeRuntimeDaemonIdentity(
  runtimeKind,
  runtimeCli,
  runtimeCliSha256,
  environment,
  deadline,
  runtimeGuard,
) {
  if (!["docker", "podman"].includes(runtimeKind))
    throw new Error("runtime kind must be docker or podman");
  let document;
  if (runtimeKind === "docker") {
    document = parseRuntimeJson(
      runtimeInfoWithinDeadline(
        runtimeKind,
        runtimeCli,
        runtimeCliSha256,
        runtimeGuard,
        ["info", "--format", "{{json .}}"],
        environment,
        deadline,
        "Docker local-default daemon identity",
      ),
      "Docker local-default daemon identity",
    );
    if (
      typeof document.ID !== "string" ||
      !document.ID ||
      typeof document.ServerVersion !== "string" ||
      !document.ServerVersion
    )
      throw new Error("Docker daemon did not expose a stable ID and version");
    document = {
      schema: "valdris.oci-daemon-identity.v1",
      runtimeKind,
      endpoint: "local-default",
      daemonId: document.ID,
      daemonVersion: document.ServerVersion,
      operatingSystem: document.OSType,
      architecture: document.Architecture,
    };
  } else {
    document = parseRuntimeJson(
      runtimeInfoWithinDeadline(
        runtimeKind,
        runtimeCli,
        runtimeCliSha256,
        runtimeGuard,
        ["info", "--format", "json"],
        environment,
        deadline,
        "Podman local-default daemon identity",
      ),
      "Podman local-default daemon identity",
    );
    const daemonId =
      document.host?.machineID ||
      document.host?.machineId ||
      document.store?.graphRoot;
    const daemonVersion =
      document.version?.Version ||
      document.version?.version ||
      document.host?.serviceIsRemoteVersion;
    if (
      typeof daemonId !== "string" ||
      !daemonId ||
      typeof daemonVersion !== "string" ||
      !daemonVersion
    )
      throw new Error("Podman daemon did not expose a stable ID and version");
    document = {
      schema: "valdris.oci-daemon-identity.v1",
      runtimeKind,
      endpoint: "local-default",
      daemonId,
      daemonVersion,
      operatingSystem: document.host?.os,
      architecture: document.host?.arch,
    };
  }
  const identity = Object.fromEntries(
    Object.entries(document).filter(([, value]) => value !== undefined),
  );
  return {
    identity,
    identitySha256: sha256(canonicalJson(identity)),
  };
}

export function referenceExecutorRuntimeCompatibility(identity) {
  const operatingSystem =
    typeof identity?.operatingSystem === "string"
      ? identity.operatingSystem.trim().toLowerCase()
      : "";
  const architecture =
    typeof identity?.architecture === "string"
      ? identity.architecture.trim().toLowerCase()
      : "";
  if (!operatingSystem)
    return {
      supported: false,
      reason: "operating-system-unavailable",
      requiredOperatingSystem: "linux",
    };
  if (operatingSystem !== "linux")
    return {
      supported: false,
      reason: "operating-system-incompatible",
      operatingSystem,
      requiredOperatingSystem: "linux",
    };
  return {
    supported: true,
    operatingSystem,
    architecture: architecture || "unknown",
  };
}

export function runtimeProbeFailureMayBeSkipped(error) {
  return error instanceof RuntimeDaemonProbeUnavailableError;
}

function tarString(header, value, offset, length, label) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length)
    throw new Error(`Git tree ${label} exceeds the portable ustar limit`);
  bytes.copy(header, offset);
}

function tarOctal(header, value, offset, length) {
  const octal = Math.trunc(value)
    .toString(8)
    .padStart(length - 1, "0");
  if (octal.length > length - 1)
    throw new Error("Git tree entry exceeds the portable ustar numeric limit");
  tarString(header, `${octal}\0`, offset, length, "numeric field");
}

function splitTarPath(value) {
  if (Buffer.byteLength(value) <= 100) return { name: value, prefix: "" };
  const trailingSlash = value.endsWith("/");
  const candidate = trailingSlash ? value.slice(0, -1) : value;
  for (
    let index = candidate.lastIndexOf("/");
    index > 0;
    index = candidate.lastIndexOf("/", index - 1)
  ) {
    const prefix = candidate.slice(0, index);
    const name = `${candidate.slice(index + 1)}${trailingSlash ? "/" : ""}`;
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100)
      return { name, prefix };
  }
  throw new Error(`Git tree path exceeds the portable ustar limit: ${value}`);
}

function tarEntry({
  entryPath,
  mode,
  bytes = Buffer.alloc(0),
  linkTarget,
  directory = false,
}) {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(entryPath);
  tarString(header, name, 0, 100, "path");
  tarOctal(header, mode, 100, 8);
  tarOctal(header, 0, 108, 8);
  tarOctal(header, 0, 116, 8);
  tarOctal(header, linkTarget === undefined ? bytes.length : 0, 124, 12);
  tarOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = directory ? 0x35 : linkTarget === undefined ? 0x30 : 0x32;
  if (linkTarget !== undefined)
    tarString(header, linkTarget, 157, 100, "symbolic-link target");
  tarString(header, "ustar\0", 257, 6, "magic");
  tarString(header, "00", 263, 2, "version");
  tarString(header, "valdris", 265, 32, "owner");
  tarString(header, "valdris", 297, 32, "group");
  tarString(header, prefix, 345, 155, "path prefix");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  const checksumField = `${checksum.toString(8).padStart(6, "0")}\0 `;
  tarString(header, checksumField, 148, 8, "checksum");
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return [header, bytes, padding];
}

function parseGitTreeRecords(raw, objectFormat) {
  const decoded = raw.toString("utf8");
  if (Buffer.from(decoded, "utf8").compare(raw) !== 0)
    throw new Error("Git tree contains a non-UTF-8 path");
  const records = decoded.split("\0");
  if (records.at(-1) === "") records.pop();
  const oidLength = objectFormat === "sha256" ? 64 : 40;
  return records.map((record) => {
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("Git returned a malformed tree record");
    const metadata = record.slice(0, tab).split(" ");
    const entryPath = record.slice(tab + 1);
    if (
      metadata.length !== 3 ||
      !/^[0-7]{6}$/.test(metadata[0]) ||
      !new RegExp(`^[a-f0-9]{${oidLength}}$`, "i").test(metadata[2]) ||
      !entryPath ||
      Buffer.from(entryPath, "utf8").toString("utf8") !== entryPath ||
      path.posix.isAbsolute(entryPath) ||
      entryPath
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error(
        "Git tree contains an unsupported path or object identity",
      );
    return {
      mode: metadata[0],
      type: metadata[1],
      objectId: metadata[2].toLowerCase(),
      path: entryPath,
    };
  });
}

function compareUtf8Path(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function materializeRawGitTreeSnapshot({
  gitCli,
  repoRoot,
  source,
  deadline,
  isolatedHooksRoot,
  isolatedGlobalConfig,
}) {
  if (!["sha1", "sha256"].includes(source.objectFormat))
    throw new Error(`unsupported Git object format: ${source.objectFormat}`);
  const listing = spawnWithinDeadline(
    gitCli,
    safeGitArguments(
      repoRoot,
      isolatedHooksRoot,
      ["ls-tree", "-rz", "--full-tree", "-r", source.commit],
      source.filterDrivers,
    ),
    {
      cwd: repoRoot,
      encoding: null,
      env: minimalGitEnvironment(
        isolatedGlobalConfig,
        path.dirname(isolatedGlobalConfig),
      ),
      shell: false,
      maxBuffer: 67_108_864,
      windowsHide: true,
    },
    deadline,
    "raw Git tree inventory",
    { reserveCleanup: true },
  );
  if (listing.error || listing.status !== 0)
    throw new Error(
      `failed to inventory raw Git tree: ${listing.error?.message || listing.stderr || listing.stdout}`,
    );
  const entries = parseGitTreeRecords(listing.stdout, source.objectFormat);
  if (entries.length > 10_000)
    throw new Error("raw Git tree exceeds the maximum entry count");
  const archiveParts = [];
  const manifestEntries = [];
  const directories = new Set(["workspace"]);
  for (const entry of entries) {
    if (entry.type === "commit" || entry.mode === "160000")
      throw new Error(
        `raw Git tree contains unsupported submodule: ${entry.path}`,
      );
    if (entry.type !== "blob")
      throw new Error(`raw Git tree contains unsupported entry: ${entry.path}`);
    const components = entry.path.split("/");
    for (let index = 1; index < components.length; index += 1)
      directories.add(`workspace/${components.slice(0, index).join("/")}`);
  }
  for (const directory of [...directories].sort(compareUtf8Path))
    archiveParts.push(
      ...tarEntry({
        entryPath: `${directory}/`,
        mode: 0o755,
        bytes: Buffer.alloc(0),
        directory: true,
      }),
    );
  for (const entry of entries) {
    const blob = spawnWithinDeadline(
      gitCli,
      safeGitArguments(
        repoRoot,
        isolatedHooksRoot,
        ["cat-file", "blob", entry.objectId],
        source.filterDrivers,
      ),
      {
        cwd: repoRoot,
        encoding: null,
        env: minimalGitEnvironment(
          isolatedGlobalConfig,
          path.dirname(isolatedGlobalConfig),
        ),
        shell: false,
        maxBuffer: 536_870_912,
        windowsHide: true,
      },
      deadline,
      `raw Git object ${entry.path}`,
      { reserveCleanup: true },
    );
    if (blob.error || blob.status !== 0)
      throw new Error(
        `failed to read raw Git object ${entry.path}: ${
          blob.error?.message || blob.stderr || blob.stdout
        }`,
      );
    const content = blob.stdout;
    const contentSha256 = sha256(content);
    const archivePath = `workspace/${entry.path}`;
    if (entry.mode === "120000") {
      const linkTarget = content.toString("utf8");
      if (
        !linkTarget ||
        Buffer.from(linkTarget, "utf8").compare(content) !== 0 ||
        Buffer.byteLength(linkTarget) > 100
      )
        throw new Error(
          `raw Git symbolic link is not representable safely: ${entry.path}`,
        );
      archiveParts.push(
        ...tarEntry({
          entryPath: archivePath,
          mode: 0o777,
          linkTarget,
        }),
      );
    } else if (entry.mode === "100644" || entry.mode === "100755") {
      archiveParts.push(
        ...tarEntry({
          entryPath: archivePath,
          mode: entry.mode === "100755" ? 0o755 : 0o644,
          bytes: content,
        }),
      );
    } else
      throw new Error(
        `raw Git tree contains unsupported mode ${entry.mode}: ${entry.path}`,
      );
    manifestEntries.push({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      objectId: entry.objectId,
      size: content.length,
      contentSha256,
    });
  }
  archiveParts.push(Buffer.alloc(1024));
  const archiveBytes = archiveParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  if (archiveBytes > 536_870_912)
    throw new Error("raw Git tree exceeds the maximum snapshot size");
  const archive = Buffer.concat(archiveParts);
  const manifest = {
    schema: "valdris.git-object-tree-manifest.v1",
    commit: source.commit,
    tree: source.tree,
    objectFormat: source.objectFormat,
    entries: manifestEntries.sort((left, right) =>
      compareUtf8Path(left.path, right.path),
    ),
  };
  return {
    archive,
    manifest,
    manifestSha256: sha256(canonicalJson(manifest)),
    snapshotSha256: sha256(archive),
  };
}

function runtimeResultProblem(result) {
  return (
    result.error?.message || result.stderr || result.stdout || "unknown failure"
  );
}

function isRuntimeNotFound(result) {
  return (
    result.status !== 0 &&
    /(no such (container|image|object)|not found|does not exist)/i.test(
      String(result.stderr || result.stdout || ""),
    )
  );
}

export function cleanupRuntimeResources({
  runtimeCli,
  runtimeCliSha256,
  runtimeGuard,
  environment,
  deadline,
  cidFile,
  containerName,
  imageReferences,
  runCommand,
}) {
  const problems = [];
  const run = (argv, phase) => {
    try {
      if (runCommand) return runCommand(argv, phase);
      return runCommissionedRuntimeCommand({
        runtimeCli,
        runtimeCliSha256,
        environment,
        argv,
        options: {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 1_048_576,
        },
        deadline,
        phase,
        runtimeGuard,
      });
    } catch (error) {
      problems.push(`${phase}: ${error.message}`);
      return null;
    }
  };
  const containerCandidates = new Set([containerName]);
  if (existsSync(cidFile)) {
    const containerId = readFileSync(cidFile, "utf8").trim();
    if (/^[a-f0-9]{12,64}$/i.test(containerId))
      containerCandidates.add(containerId);
    else
      problems.push("container cleanup: cidfile contains an invalid identity");
  }
  for (const identity of containerCandidates) {
    const before = run(
      ["container", "inspect", identity],
      `container cleanup inspect ${identity}`,
    );
    if (!before) continue;
    if (isRuntimeNotFound(before)) continue;
    if (before.error || before.status !== 0) {
      problems.push(
        `container cleanup could not establish presence for ${identity}: ${runtimeResultProblem(before)}`,
      );
      continue;
    }
    const removed = run(
      ["rm", "-f", identity],
      `container cleanup remove ${identity}`,
    );
    if (!removed || removed.error || removed.status !== 0)
      problems.push(
        `container cleanup failed for ${identity}: ${
          removed
            ? runtimeResultProblem(removed)
            : "cleanup command unavailable"
        }`,
      );
    const after = run(
      ["container", "inspect", identity],
      `container cleanup verify ${identity}`,
    );
    if (!after) continue;
    if (!isRuntimeNotFound(after))
      problems.push(
        `container cleanup did not prove absence for ${identity}: ${runtimeResultProblem(after)}`,
      );
  }
  for (const image of imageReferences) {
    const before = run(
      ["image", "inspect", image],
      `image cleanup inspect ${image}`,
    );
    if (!before) continue;
    if (isRuntimeNotFound(before)) continue;
    if (before.error || before.status !== 0) {
      problems.push(
        `image cleanup could not establish presence for ${image}: ${runtimeResultProblem(before)}`,
      );
      continue;
    }
    const removed = run(
      ["image", "rm", "-f", image],
      `image cleanup remove ${image}`,
    );
    if (!removed || removed.error || removed.status !== 0)
      problems.push(
        `image cleanup failed for ${image}: ${
          removed
            ? runtimeResultProblem(removed)
            : "cleanup command unavailable"
        }`,
      );
    const after = run(
      ["image", "inspect", image],
      `image cleanup verify ${image}`,
    );
    if (!after) continue;
    if (!isRuntimeNotFound(after))
      problems.push(
        `image cleanup did not prove absence for ${image}: ${runtimeResultProblem(after)}`,
      );
  }
  return problems;
}

export function aggregateExecutionCleanupFailure(
  primaryFailure,
  cleanupProblems,
) {
  if (!primaryFailure && cleanupProblems.length === 0) return null;
  return new AggregateError(
    [
      ...(primaryFailure ? [primaryFailure] : []),
      ...cleanupProblems.map((problem) => new Error(problem)),
    ],
    [
      primaryFailure && `execution failed: ${primaryFailure.message}`,
      cleanupProblems.length && `cleanup failed: ${cleanupProblems.join("; ")}`,
    ]
      .filter(Boolean)
      .join("; "),
  );
}

function outputInventory(root, directory, deadline, records = [], depth = 0) {
  deadline?.assert("output inventory", { reserveCleanup: true });
  if (depth > 4) throw new Error("executor output exceeds maximum depth");
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const target = path.join(directory, entry.name);
    const stats = lstatSync(target);
    if (stats.isSymbolicLink())
      throw new Error(
        `executor output cannot contain symbolic links: ${path.relative(root, target)}`,
      );
    if (stats.isDirectory())
      outputInventory(root, target, deadline, records, depth + 1);
    else if (stats.isFile()) {
      records.push({
        path: path.relative(root, target).split(path.sep).join("/"),
        size: stats.size,
        sha256: sha256(readFileSync(target)),
      });
      if (records.length > 512)
        throw new Error("executor output exceeds maximum file count");
    }
  }
  return records;
}

export function materializeVerifiedOutputEnvelope(
  raw,
  outputRoot,
  args,
  source,
) {
  const assertMaterializationDeadline = () => {
    args.deadline?.assert("output materialization", {
      reserveCleanup: true,
    });
    args.assertOutputBoundary?.();
  };
  assertMaterializationDeadline();
  const resolvedOutputRoot = path.resolve(outputRoot);
  assertNoLinkComponents(resolvedOutputRoot);
  const expectedOutputRoot = existsSync(resolvedOutputRoot)
    ? canonicalExistingPath(resolvedOutputRoot)
    : canonicalFuturePath(resolvedOutputRoot);
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error(
      "executor must emit one valdris.proof-executor-output.v1 JSON envelope on stdout",
    );
  }
  if (
    !envelope ||
    envelope.schema !== "valdris.proof-executor-output.v1" ||
    envelope.runId !== args.runId ||
    envelope.sourceCommit !== source.commit ||
    envelope.status !== "passed"
  )
    throw new Error("executor output envelope identity or status is invalid");
  if (envelope.validatorSha256 !== args.validatorSha256.toLowerCase())
    throw new Error(
      "executor output envelope validator does not match the commissioned identity",
    );
  const categories = [
    ["semanticProofArtifacts", args.semanticProofSetSha256],
    ["proofInputArtifacts", args.proofInputSetSha256],
    ["acceptedGateArtifacts", args.acceptedGateArtifactsSha256],
  ];
  const files = [];
  for (const [field, expectedDigest] of categories) {
    assertMaterializationDeadline();
    const artifacts = envelope[field];
    if (!Array.isArray(artifacts) || artifacts.length === 0)
      throw new Error(`executor output envelope.${field} must be non-empty`);
    const identities = new Set();
    let manifestSha256 = null;
    for (const artifact of artifacts) {
      assertMaterializationDeadline();
      if (
        !artifact ||
        !portableArtifactId(artifact.id) ||
        identities.has(artifact.id) ||
        !SHA256.test(artifact.sha256 || "") ||
        typeof artifact.contentBase64 !== "string"
      )
        throw new Error(
          `executor output envelope.${field} is invalid or duplicated`,
        );
      identities.add(artifact.id);
      const bytes = Buffer.from(artifact.contentBase64, "base64");
      if (bytes.toString("base64") !== artifact.contentBase64)
        throw new Error(
          `executor output envelope.${field} has non-canonical base64`,
        );
      if (sha256(bytes) !== artifact.sha256.toLowerCase())
        throw new Error(
          `executor output envelope.${field} artifact digest mismatch`,
        );
      if (artifact.id === "manifest") {
        let manifest;
        try {
          manifest = JSON.parse(bytes.toString("utf8"));
        } catch {
          throw new Error(
            `executor output envelope.${field} manifest must be JSON`,
          );
        }
        if (Buffer.from(canonicalJson(manifest)).compare(bytes) !== 0)
          throw new Error(
            `executor output envelope.${field} manifest must use canonical JSON bytes`,
          );
        manifestSha256 = sha256(bytes);
      }
      files.push({ field, id: artifact.id, bytes });
    }
    if (!manifestSha256)
      throw new Error(
        `executor output envelope.${field} must contain one canonical manifest artifact`,
      );
    if (manifestSha256 !== expectedDigest.toLowerCase())
      throw new Error(
        `executor-derived ${field} manifest digest does not match the commissioned expectation`,
      );
  }
  if (files.length > 256)
    throw new Error("executor output envelope exceeds maximum artifact count");
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  const resultBytes = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`);
  if (totalBytes + resultBytes.length > args.outputBytes)
    throw new Error("executor output exceeded the commissioned byte limit");
  if (args.precreatedOutputRoot) {
    assertMaterializationDeadline();
    if (
      !existsSync(outputRoot) ||
      canonicalExistingPath(outputRoot) !== expectedOutputRoot ||
      readdirSync(outputRoot).length !== 0
    )
      throw new Error(
        "executor precreated output root is missing, aliased, or not empty",
      );
  } else mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
  for (const file of files) {
    assertMaterializationDeadline();
    if (canonicalExistingPath(outputRoot) !== expectedOutputRoot)
      throw new Error("executor output root changed during materialization");
    const directory = path.resolve(outputRoot, file.field);
    mkdirSync(directory, { recursive: true });
    const target = path.resolve(directory, `${file.id}.bin`);
    if (path.dirname(target) !== directory)
      throw new Error("executor artifact path escaped its output category");
    writeFileSync(target, file.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  if (canonicalExistingPath(outputRoot) !== expectedOutputRoot)
    throw new Error("executor output root changed during materialization");
  writeFileSync(path.join(outputRoot, "result.json"), resultBytes, {
    flag: "wx",
    mode: 0o600,
  });
  assertMaterializationDeadline();
}

function assertNoLinkComponents(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const component of resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (!existsSync(cursor)) break;
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink())
      throw new Error(
        `executor path cannot traverse a symbolic link or junction: ${cursor}`,
      );
  }
}

function signReceipt(document) {
  const keyFile = process.env.VALDRIS_EXECUTOR_PRIVATE_KEY_FILE;
  const keyId = process.env.VALDRIS_EXECUTOR_KEY_ID;
  const trustPin = process.env[AUTHORITY_TRUST_SHA256_ENV];
  if (!keyFile || !existsSync(keyFile))
    throw new Error(
      "VALDRIS_EXECUTOR_PRIVATE_KEY_FILE must reference an operator-controlled Ed25519 private key",
    );
  if (!safeIdentifier(keyId))
    throw new Error("VALDRIS_EXECUTOR_KEY_ID is required");
  if (!SHA256.test(trustPin || ""))
    throw new Error(`${AUTHORITY_TRUST_SHA256_ENV} is required`);
  document.authorityTrustSha256 = trustPin.toLowerCase();
  document.attestation = {
    scheme: "ed25519",
    keyId,
    signedAt: new Date().toISOString(),
  };
  const payload = canonicalJson(authorityAttestationPayload(document));
  document.attestation.payloadSha256 = sha256(payload);
  document.attestation.signature = signPayload(
    null,
    Buffer.from(payload),
    createPrivateKey(readFileSync(keyFile)),
  ).toString("base64");
  return document;
}

function main(argv) {
  const operationStartedMs = Date.now();
  const args = parseArgs(argv);
  if (args.help)
    return console.log(
      'Usage: node scripts/attested-proof-executor.mjs --repo . --run-id ID --image IMAGE@sha256:DIGEST --command-json \'["command","arg"]\' --semantic-proof-set-sha256 SHA256 --proof-input-set-sha256 SHA256 --accepted-gate-artifacts-sha256 SHA256 --git-cli ABSOLUTE_PATH --git-cli-sha256 SHA256 --runtime docker|podman --runtime-cli ABSOLUTE_PATH --runtime-cli-sha256 SHA256 --daemon-identity-sha256 SHA256 --output-dir PATH --receipt PATH [--network none] [--dry-run]',
    );
  if (!safeIdentifier(args.runId))
    throw new Error("--run-id must be a safe identifier");
  if (!SHA256.test(args.semanticProofSetSha256 || ""))
    throw new Error("--semantic-proof-set-sha256 is required");
  if (!SHA256.test(args.proofInputSetSha256 || ""))
    throw new Error("--proof-input-set-sha256 is required");
  if (!SHA256.test(args.acceptedGateArtifactsSha256 || ""))
    throw new Error("--accepted-gate-artifacts-sha256 is required");
  if (!SHA256.test(args.commandIdentitySha256 || ""))
    throw new Error("--command-identity-sha256 is required");
  if (!SHA256.test(args.validatorSha256 || ""))
    throw new Error("--validator-sha256 is required");
  if (!/^[^\s]+@sha256:[a-f0-9]{64}$/i.test(args.image || ""))
    throw new Error("--image must be immutable and include @sha256:DIGEST");
  if (!["docker", "podman"].includes(args.runtime))
    throw new Error("--runtime must be docker or podman");
  const gitCli = commissionedExecutable(
    "Git CLI",
    args.gitCli,
    args.gitCliSha256,
  );
  const runtimeCli = commissionedExecutable(
    "runtime CLI",
    args.runtimeCli,
    args.runtimeCliSha256,
  );
  if (!SHA256.test(args.daemonIdentitySha256 || ""))
    throw new Error("--daemon-identity-sha256 is required");
  if (args.network !== "none")
    throw new Error(
      "the reference executor only supports --network none; commission a separately attested allowlist adapter for networked proof",
    );
  if (
    !Number.isFinite(args.cpu) ||
    args.cpu <= 0 ||
    !Number.isSafeInteger(args.memory) ||
    args.memory < 1 ||
    !Number.isSafeInteger(args.outputBytes) ||
    args.outputBytes < 1 ||
    !Number.isSafeInteger(args.wallClockMs) ||
    args.wallClockMs < 1
  )
    throw new Error("executor resource limits are invalid");
  const deadline = createExecutionDeadline(
    args.wallClockMs,
    operationStartedMs,
  );
  let command;
  try {
    command = JSON.parse(args.commandJson);
  } catch {
    throw new Error("--command-json must be valid JSON");
  }
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((entry) => typeof entry !== "string" || !entry.length)
  )
    throw new Error("--command-json must be a non-empty string array");
  const commandIdentitySha256 = sha256(canonicalJson(command));
  if (commandIdentitySha256 !== args.commandIdentitySha256.toLowerCase())
    throw new Error(
      "--command-identity-sha256 does not match the commissioned argv",
    );
  const repoRoot = canonicalExistingPath(args.repo);
  const outputRoot = path.resolve(args.outputDir || "");
  if (!args.outputDir)
    throw new Error(
      "--output-dir must be an isolated sibling of the source repository",
    );
  assertNoLinkComponents(path.dirname(outputRoot));
  const outputRootExists = existsSync(outputRoot);
  const futureOutputRoot = outputRootExists
    ? canonicalExistingPath(outputRoot)
    : canonicalFuturePath(outputRoot);
  if (
    containsPath(repoRoot, futureOutputRoot) ||
    containsPath(futureOutputRoot, repoRoot)
  )
    throw new Error("--output-dir resolves across the source boundary");
  if (outputRootExists) throw new Error("--output-dir must not already exist");
  const canonicalOutputParent = path.dirname(futureOutputRoot);
  const gitIsolationRoot = mkdtempSync(
    path.join(tmpdir(), "valdris-git-isolation-"),
  );
  hardenNewPrivateDirectory(gitIsolationRoot);
  const isolatedHooksRoot = path.join(gitIsolationRoot, "hooks");
  mkdirSync(isolatedHooksRoot, { mode: 0o700 });
  chmodSync(isolatedHooksRoot, 0o700);
  const isolatedGlobalConfig = path.join(gitIsolationRoot, "global.gitconfig");
  writeFileSync(isolatedGlobalConfig, "", { flag: "wx", mode: 0o600 });
  const runtimeIsolationRoot = path.join(gitIsolationRoot, "runtime-home");
  mkdirSync(runtimeIsolationRoot, { mode: 0o700 });
  for (const directory of ["xdg-config", "xdg-cache", "docker"])
    mkdirSync(path.join(runtimeIsolationRoot, directory), { mode: 0o700 });
  for (const file of ["containers.conf", "registries.conf", "storage.conf"])
    writeFileSync(path.join(runtimeIsolationRoot, file), "", {
      flag: "wx",
      mode: 0o600,
    });
  let runtimeCapsule;
  let gitIsolationCleaned = false;
  const cleanupGitIsolation = () => {
    if (gitIsolationCleaned) return;
    let cleanupProblem;
    try {
      deadline.assert("isolated Git cleanup");
    } catch (error) {
      cleanupProblem = error;
    }
    try {
      runtimeCapsule?.release();
    } catch (error) {
      cleanupProblem ||= error;
    }
    try {
      rmSync(gitIsolationRoot, { recursive: true, force: true });
      gitIsolationCleaned = true;
    } catch (error) {
      cleanupProblem ||= error;
    }
    try {
      deadline.assert("isolated Git cleanup");
    } catch (error) {
      cleanupProblem ||= error;
    }
    if (cleanupProblem) throw cleanupProblem;
  };
  let operationFailure;
  try {
    const executionRuntime = args.dryRun
      ? runtimeCli
      : (runtimeCapsule = stageCommissionedRuntimeExecutable({
          runtimeCli: runtimeCli.path,
          runtimeCliSha256: runtimeCli.sha256,
          privateRoot: gitIsolationRoot,
          deadline,
        }));
    const before = sourceState(
      gitCli.path,
      repoRoot,
      deadline,
      isolatedHooksRoot,
      isolatedGlobalConfig,
    );
    const gitTopLevel = canonicalExistingPath(
      git(
        gitCli.path,
        repoRoot,
        ["rev-parse", "--show-toplevel"],
        deadline,
        isolatedHooksRoot,
        isolatedGlobalConfig,
        "source preflight: top-level",
      ),
    );
    if (gitTopLevel !== repoRoot)
      throw new Error("--repo must resolve to the Git top-level worktree");
    const cleanEnvironment = isolatedRuntimeEnvironment(runtimeIsolationRoot);
    const daemon = args.dryRun
      ? {
          identity: null,
          identitySha256: args.daemonIdentitySha256.toLowerCase(),
          verified: false,
        }
      : {
          ...probeRuntimeDaemonIdentity(
            args.runtime,
            executionRuntime.path,
            executionRuntime.sha256,
            cleanEnvironment,
            deadline,
            executionRuntime,
          ),
          verified: true,
        };
    const runtimeCompatibility = args.dryRun
      ? null
      : referenceExecutorRuntimeCompatibility(daemon.identity);
    if (!args.dryRun && !runtimeCompatibility.supported)
      throw new Error(
        `reference executor requires a Linux OCI daemon: ${runtimeCompatibility.reason}`,
      );
    if (
      !args.dryRun &&
      daemon.identitySha256 !== args.daemonIdentitySha256.toLowerCase()
    )
      throw new Error(
        "local-default OCI daemon identity does not match commissioning",
      );
    let containerName = "<unique-content-addressed-container>";
    let cidFile = "<exclusive-cidfile>";
    const runtimeArguments = (executionImage) => [
      "run",
      "--rm",
      "--read-only",
      "--name",
      containerName,
      "--cidfile",
      cidFile,
      "--pids-limit",
      "256",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "65534:65534",
      "--network",
      args.network === "none" ? "none" : "bridge",
      "--cpus",
      String(args.cpu),
      "--memory",
      String(args.memory),
      "--memory-swap",
      String(args.memory),
      "--ulimit",
      "nofile=1024:1024",
      "--tmpfs",
      `/output:rw,nosuid,nodev,noexec,size=${args.outputBytes},mode=0700,uid=${CONTAINER_UID},gid=${CONTAINER_GID}`,
      "--tmpfs",
      `/tmp:rw,nosuid,nodev,noexec,size=${Math.min(args.memory, 67_108_864)},mode=0700,uid=${CONTAINER_UID},gid=${CONTAINER_GID}`,
      "--workdir",
      "/workspace",
      executionImage,
      ...command,
    ];
    const plan = {
      schema: "valdris.proof-executor-plan.v1",
      runtime: {
        kind: args.runtime,
        endpoint: "local-default",
        cli: runtimeCli,
        executionMode: args.dryRun
          ? "planned-hardened-private-capsule"
          : executionRuntime.mode,
        executionPathSha256: args.dryRun ? null : executionRuntime.pathSha256,
        executionRootIdentitySha256: args.dryRun
          ? null
          : executionRuntime.rootIdentitySha256,
        daemonIdentitySha256: daemon.identitySha256,
        daemonIdentityVerified: daemon.verified,
      },
      git: gitCli,
      argv: [
        executionRuntime.path,
        ...runtimeArguments("<content-addressed-execution-image>"),
      ],
      source: {
        path: repoRoot,
        commit: before.commit,
        tree: before.tree,
        readOnly: true,
        strategy: "git-raw-object-tree-to-immutable-oci-layer",
      },
      commissionedBaseImage: args.image,
      output: { path: outputRoot, isolated: true, maxBytes: args.outputBytes },
      environment: { inheritedSecrets: false, networkPolicy: args.network },
      limits: {
        cpu: args.cpu,
        memory: args.memory,
        outputBytes: args.outputBytes,
        wallClockMs: args.wallClockMs,
        wallClockScope:
          "total host operation: preflight, archive, import, build, inspect, execution, materialization, and cleanup",
        cleanupReserveMs: deadline.cleanupReserveMs,
      },
    };
    if (args.dryRun) {
      deadline.assert("dry-run plan");
      cleanupGitIsolation();
      return console.log(
        JSON.stringify({ ok: true, dryRun: true, plan }, null, 2),
      );
    }
    if (!args.receipt)
      throw new Error("--receipt is required outside dry-run mode");
    const receiptPath = path.resolve(args.receipt);
    if (receiptPath !== path.join(futureOutputRoot, "executor-receipt.json"))
      throw new Error(
        "--receipt must be the isolated output file executor-receipt.json",
      );
    const secureOutputRootValue = process.env.VALDRIS_EXECUTOR_OUTPUT_ROOT;
    const secureOutputRootPathSha256 =
      process.env.VALDRIS_EXECUTOR_OUTPUT_ROOT_PATH_SHA256;
    const secureOutputRootIdentitySha256 =
      process.env.VALDRIS_EXECUTOR_OUTPUT_ROOT_IDENTITY_SHA256;
    if (
      !secureOutputRootValue ||
      !SHA256.test(secureOutputRootPathSha256 || "") ||
      !SHA256.test(secureOutputRootIdentitySha256 || "")
    )
      throw new Error(
        "VALDRIS_EXECUTOR_OUTPUT_ROOT, VALDRIS_EXECUTOR_OUTPUT_ROOT_PATH_SHA256, and VALDRIS_EXECUTOR_OUTPUT_ROOT_IDENTITY_SHA256 are required outside dry-run mode",
      );
    const secureOutputBoundary = assertOperatorRootSecurity(
      secureOutputRootValue,
      {
        expectedPathSha256: secureOutputRootPathSha256,
        expectedIdentitySha256: secureOutputRootIdentitySha256,
      },
    );
    const secureOutputRoot = secureOutputBoundary.path;
    if (path.dirname(futureOutputRoot) !== secureOutputRoot)
      throw new Error(
        "--output-dir must be a direct child of the commissioned operator-owned output root",
      );
    const outputRootPolicySha256 = sha256(
      canonicalJson({
        pathSha256: secureOutputBoundary.pathSha256,
        identitySha256: secureOutputBoundary.identitySha256,
      }),
    );
    mkdirSync(outputRoot, { recursive: false, mode: 0o700 });
    assertOperatorRootUnchanged(secureOutputRoot, secureOutputBoundary);
    if (canonicalExistingPath(outputRoot) !== futureOutputRoot)
      throw new Error("--output-dir changed during exclusive creation");
    const executionOutputBoundary = assertOperatorRootSecurity(outputRoot);
    const buildRoot = mkdtempSync(
      path.join(tmpdir(), "valdris-proof-image-context-"),
    );
    hardenNewPrivateDirectory(buildRoot);
    const tagNonce = sha256(
      `${args.runId}:${before.commit}:${Date.now()}:${buildRoot}`,
    ).slice(0, 24);
    const sourceTag = `valdris-source-${tagNonce}:local`;
    const executionTag = `valdris-execution-${tagNonce}:local`;
    containerName = `valdris-${tagNonce}`;
    cidFile = path.join(buildRoot, "container.cid");
    let workCompleted = false;
    let receiptFields;
    let executionImageSha256;
    let primaryFailure;
    try {
      const sourceSnapshot = materializeRawGitTreeSnapshot({
        gitCli: gitCli.path,
        repoRoot,
        source: before,
        deadline,
        isolatedHooksRoot,
        isolatedGlobalConfig,
      });
      const imported = runCommissionedRuntimeCommand({
        runtimeCli: executionRuntime.path,
        runtimeCliSha256: executionRuntime.sha256,
        environment: cleanEnvironment,
        argv: ["import", "-", sourceTag],
        options: {
          cwd: buildRoot,
          input: sourceSnapshot.archive,
          encoding: "utf8",
          maxBuffer: 65_536,
          windowsHide: true,
        },
        deadline,
        phase: "source image import",
        deadlineOptions: { reserveCleanup: true },
        runtimeGuard: executionRuntime,
      });
      if (imported.error || imported.status !== 0)
        throw new Error(
          `failed to import frozen source image: ${imported.error?.message || imported.stderr || imported.stdout}`,
        );
      writeFileSync(
        path.join(buildRoot, "Dockerfile"),
        `FROM ${args.image}\nCOPY --from=${sourceTag} /workspace/ /workspace/\nWORKDIR /workspace\nENTRYPOINT []\n`,
        { flag: "wx", mode: 0o600 },
      );
      const built = runCommissionedRuntimeCommand({
        runtimeCli: executionRuntime.path,
        runtimeCliSha256: executionRuntime.sha256,
        environment: cleanEnvironment,
        argv: [
          "build",
          "--pull=false",
          "--no-cache",
          "--network=none",
          "--tag",
          executionTag,
          buildRoot,
        ],
        options: {
          cwd: buildRoot,
          encoding: "utf8",
          maxBuffer: 4_194_304,
          windowsHide: true,
        },
        deadline,
        phase: "execution image build",
        deadlineOptions: { reserveCleanup: true },
        runtimeGuard: executionRuntime,
      });
      if (built.error || built.status !== 0)
        throw new Error(
          `failed to build immutable execution image: ${built.error?.message || built.stderr || built.stdout}`,
        );
      const inspected = runCommissionedRuntimeCommand({
        runtimeCli: executionRuntime.path,
        runtimeCliSha256: executionRuntime.sha256,
        environment: cleanEnvironment,
        argv: ["image", "inspect", "--format={{.Id}}", executionTag],
        options: {
          encoding: "utf8",
          maxBuffer: 65_536,
          windowsHide: true,
        },
        deadline,
        phase: "execution image inspection",
        deadlineOptions: { reserveCleanup: true },
        runtimeGuard: executionRuntime,
      });
      const executionImageId = String(inspected.stdout || "").trim();
      if (
        inspected.error ||
        inspected.status !== 0 ||
        !/^sha256:[a-f0-9]{64}$/i.test(executionImageId)
      )
        throw new Error(
          `failed to resolve immutable execution image: ${inspected.error?.message || inspected.stderr || inspected.stdout}`,
        );
      executionImageSha256 = executionImageId.slice(7).toLowerCase();
      const invocation = runtimeArguments(executionImageId);
      const result = runCommissionedRuntimeCommand({
        runtimeCli: executionRuntime.path,
        runtimeCliSha256: executionRuntime.sha256,
        environment: cleanEnvironment,
        argv: invocation,
        options: {
          cwd: buildRoot,
          encoding: "utf8",
          killSignal: "SIGTERM",
          maxBuffer: args.outputBytes + 65_536,
          windowsHide: true,
        },
        deadline,
        phase: "container execution",
        deadlineOptions: { reserveCleanup: true },
        runtimeGuard: executionRuntime,
      });
      if (result.error)
        throw new Error(`executor failed: ${result.error.message}`);
      if (result.status !== 0)
        throw new Error(
          `executor command failed with ${result.status}: ${(result.stderr || result.stdout || "").slice(-4000)}`,
        );
      const after = sourceState(
        gitCli.path,
        repoRoot,
        deadline,
        isolatedHooksRoot,
        isolatedGlobalConfig,
        "source postflight",
      );
      if (canonicalJson(after) !== canonicalJson(before))
        throw new Error(
          "source commit or tree changed during attested execution",
        );
      materializeVerifiedOutputEnvelope(
        result.stdout,
        outputRoot,
        {
          ...args,
          precreatedOutputRoot: true,
          deadline,
          assertOutputBoundary() {
            assertOperatorRootUnchanged(secureOutputRoot, secureOutputBoundary);
            assertOperatorRootUnchanged(outputRoot, executionOutputBoundary);
          },
        },
        before,
      );
      const canonicalOutputRoot = canonicalExistingPath(outputRoot);
      if (canonicalOutputRoot !== futureOutputRoot)
        throw new Error("--output-dir resolved across the output boundary");
      const inventory = outputInventory(outputRoot, outputRoot, deadline);
      const totalBytes = inventory.reduce((sum, entry) => sum + entry.size, 0);
      if (totalBytes > args.outputBytes)
        throw new Error("executor output exceeded the commissioned byte limit");
      assertOperatorRootUnchanged(secureOutputRoot, secureOutputBoundary);
      assertOperatorRootUnchanged(outputRoot, executionOutputBoundary);
      assertCommissionedExecutableUnchanged("Git CLI", gitCli);
      assertCommissionedExecutableUnchanged(
        "runtime execution capsule",
        executionRuntime,
      );
      const finalDaemon = probeRuntimeDaemonIdentity(
        args.runtime,
        executionRuntime.path,
        executionRuntime.sha256,
        cleanEnvironment,
        deadline,
        executionRuntime,
      );
      if (finalDaemon.identitySha256 !== daemon.identitySha256)
        throw new Error(
          "OCI daemon identity changed during attested execution",
        );
      receiptFields = {
        invocation,
        resultStatus: result.status,
        sourceSnapshotSha256: sourceSnapshot.snapshotSha256,
        sourceSnapshotManifest: sourceSnapshot.manifest,
        sourceSnapshotManifestSha256: sourceSnapshot.manifestSha256,
        inventory,
        executionImageSha256,
      };
      workCompleted = true;
    } catch (error) {
      primaryFailure = error;
    } finally {
      const cleanupProblems = cleanupRuntimeResources({
        runtimeCli: executionRuntime.path,
        runtimeCliSha256: executionRuntime.sha256,
        runtimeGuard: executionRuntime,
        environment: cleanEnvironment,
        deadline,
        cidFile,
        containerName,
        imageReferences: [executionTag, sourceTag],
      });
      const canonicalTempRoot = path.resolve(tmpdir());
      const canonicalBuildRoot = path.resolve(buildRoot);
      const ownsBuildRoot =
        canonicalBuildRoot.startsWith(`${canonicalTempRoot}${path.sep}`) &&
        path
          .basename(canonicalBuildRoot)
          .startsWith("valdris-proof-image-context-");
      if (!ownsBuildRoot) {
        cleanupProblems.push(
          "refusing to remove an unowned executor build context",
        );
      } else {
        try {
          deadline.assert("build-context cleanup");
        } catch (error) {
          cleanupProblems.push(error.message);
        }
        try {
          rmSync(canonicalBuildRoot, { recursive: true, force: true });
        } catch (error) {
          cleanupProblems.push(error.message);
        }
        try {
          deadline.assert("build-context cleanup");
        } catch (error) {
          cleanupProblems.push(error.message);
        }
      }
      if (!workCompleted || cleanupProblems.length) {
        try {
          if (existsSync(outputRoot))
            rmSync(outputRoot, { recursive: true, force: true });
        } catch (error) {
          cleanupProblems.push(error.message);
        }
      }
      const executionCleanupFailure = aggregateExecutionCleanupFailure(
        primaryFailure,
        cleanupProblems,
      );
      if (executionCleanupFailure) throw executionCleanupFailure;
    }
    if (!workCompleted || !receiptFields)
      throw new Error("executor work did not reach receipt finalization");
    try {
      cleanupGitIsolation();
    } catch (error) {
      if (existsSync(outputRoot))
        rmSync(outputRoot, { recursive: true, force: true });
      throw error;
    }
    try {
      deadline.assert("receipt signing");
      const finishedAt = new Date().toISOString();
      const receipt = signReceipt({
        schema: "valdris.proof-executor-receipt.v1",
        actor: {
          id: process.env.VALDRIS_EXECUTOR_ACTOR_ID || "oci-reference-executor",
          type: "service",
        },
        eventId: `executor-${args.runId}-${Date.now()}`,
        correlationSha256: sha256(
          canonicalJson({
            runId: args.runId,
            commit: before.commit,
            image: args.image,
          }),
        ),
        issuedAt: finishedAt,
        expiresAt: new Date(
          Date.parse(finishedAt) + 24 * 60 * 60 * 1000,
        ).toISOString(),
        runId: args.runId,
        sourceCommit: before.commit,
        sourceTreeSha256: sha256(before.tree),
        workingTreeSha256: sha256(before.tree),
        argvSha256: sha256(canonicalJson(receiptFields.invocation)),
        commandIdentitySha256,
        validatorSha256: args.validatorSha256.toLowerCase(),
        inputSetSha256: sha256(
          canonicalJson({
            source: before,
            sourceSnapshotSha256: receiptFields.sourceSnapshotSha256,
            sourceSnapshotManifestSha256:
              receiptFields.sourceSnapshotManifestSha256,
            commissionedBaseImage: args.image,
            executionImageSha256: receiptFields.executionImageSha256,
            runtimeKind: args.runtime,
            runtimeCliSha256: runtimeCli.sha256,
            runtimeExecutionMode: executionRuntime.mode,
            runtimeExecutionPathSha256: executionRuntime.pathSha256,
            runtimeExecutionRootIdentitySha256:
              executionRuntime.rootIdentitySha256,
            gitCliSha256: gitCli.sha256,
            daemonIdentitySha256: daemon.identitySha256,
          }),
        ),
        semanticProofSetSha256: args.semanticProofSetSha256.toLowerCase(),
        proofInputSetSha256: args.proofInputSetSha256.toLowerCase(),
        acceptedGateArtifactsSha256:
          args.acceptedGateArtifactsSha256.toLowerCase(),
        outputSetSha256: sha256(canonicalJson(receiptFields.inventory)),
        imageSha256: args.image
          .slice(args.image.lastIndexOf("sha256:") + 7)
          .toLowerCase(),
        sourceSnapshotSha256: receiptFields.sourceSnapshotSha256,
        sourceSnapshotManifest: receiptFields.sourceSnapshotManifest,
        sourceSnapshotManifestSha256:
          receiptFields.sourceSnapshotManifestSha256,
        executionImageSha256: receiptFields.executionImageSha256,
        executorId: "oci-reference-executor",
        readOnlySource: true,
        sourceSnapshotMode: "git-raw-object-tree-content-addressed-oci-layer",
        liveWorktreeMount: false,
        isolatedOutput: true,
        exclusiveOutputRoot: true,
        outputRootPathSha256: secureOutputBoundary.pathSha256,
        outputRootIdentitySha256: secureOutputBoundary.identitySha256,
        outputDirectoryIdentitySha256: executionOutputBoundary.identitySha256,
        outputRootPolicySha256,
        containerIdentity: "cidfile-and-unique-name",
        inheritAmbientSecrets: false,
        runtimeKind: args.runtime,
        runtimeEndpoint: "local-default",
        runtimeCliPath: runtimeCli.path,
        runtimeCliPathSha256: runtimeCli.pathSha256,
        runtimeCliSha256: runtimeCli.sha256,
        runtimeExecutionMode: executionRuntime.mode,
        runtimeExecutionPathSha256: executionRuntime.pathSha256,
        runtimeExecutionSha256: executionRuntime.sha256,
        runtimeExecutionRootPathSha256: executionRuntime.rootPathSha256,
        runtimeExecutionRootIdentitySha256: executionRuntime.rootIdentitySha256,
        gitCliPath: gitCli.path,
        gitCliPathSha256: gitCli.pathSha256,
        gitCliSha256: gitCli.sha256,
        daemonIdentity: daemon.identity,
        daemonIdentitySha256: daemon.identitySha256,
        networkPolicy: args.network,
        limits: {
          cpu: args.cpu,
          memory: args.memory,
          outputBytes: args.outputBytes,
          wallClockMs: args.wallClockMs,
          wallClockScope: plan.limits.wallClockScope,
        },
        startedAt: deadline.startedAt,
        finishedAt,
        exitCode: receiptFields.resultStatus,
        mutationResult: "source-frozen-immutable-image",
      });
      assertOperatorRootUnchanged(secureOutputRoot, secureOutputBoundary);
      if (canonicalExistingPath(outputRoot) !== futureOutputRoot)
        throw new Error("executor output root changed before receipt commit");
      mkdirSync(path.dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: "wx",
      });
      deadline.assert("receipt commit");
      console.log(
        JSON.stringify(
          {
            ok: true,
            receipt: receiptPath,
            outputSetSha256: receipt.outputSetSha256,
            totalDurationMs: deadline.elapsedMs(),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      if (existsSync(outputRoot))
        rmSync(outputRoot, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    operationFailure = error;
  } finally {
    try {
      cleanupGitIsolation();
    } catch (cleanupError) {
      throw aggregateExecutionCleanupFailure(operationFailure, [
        `isolated Git/runtime cleanup failed: ${cleanupError.message}`,
      ]);
    }
  }
  if (operationFailure) throw operationFailure;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
