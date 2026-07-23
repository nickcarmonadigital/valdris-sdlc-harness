#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateExecutionCleanupFailure,
  classifyRuntimeDaemonInfoFailure,
  cleanupRuntimeResources,
  commissionRuntimeExecutionBoundary,
  commissionedExecutable,
  createRuntimeCapsuleReleaser,
  createExecutionDeadline,
  finalizeExecutorCompletion,
  isolatedRuntimeEnvironment,
  materializeRawGitTreeSnapshot,
  probeRuntimeDaemonIdentity,
  referenceExecutorRuntimeCompatibility,
  runCommissionedRuntimeCommand,
  runtimeProbeFailureMayBeSkipped,
  stageCommissionedRuntimeExecutable,
  windowsRuntimeCapsuleAuxiliaryWriterRemovalArgs,
} from "./attested-proof-executor.mjs";
import {
  assertOperatorRootSecurity,
  assertOperatorRootUnchanged,
  hardenNewPrivateDirectory,
} from "./operator-root-security.mjs";
import { canonicalJson, sha256 } from "./proof-runner.mjs";
import {
  RUNTIME_EXECUTION_THREAT_BOUNDARY,
  RUNTIME_SAME_PRINCIPAL_COMPROMISE_POLICY,
  runtimeExecutionIsolationPolicy,
} from "./v09-assurance-lib.mjs";

const EXECUTOR_PROBE_WALL_CLOCK_MS =
  process.platform === "win32" ? 300_000 : 90_000;
const EXECUTOR_PROBE_PARENT_TIMEOUT_MS =
  process.platform === "win32" ? 330_000 : 105_000;
const RUNTIME_CAPSULE_FIXTURE_DEADLINE_MS =
  process.platform === "win32" ? 480_000 : 10_000;
const RUNTIME_COMMAND_FIXTURE_DEADLINE_MS =
  process.platform === "win32" ? 60_000 : 5_000;

const localSystemRemovalArgs = windowsRuntimeCapsuleAuxiliaryWriterRemovalArgs(
  "capsule-root",
  "S-1-5-18",
);
assert(
  localSystemRemovalArgs.includes("*S-1-5-32-544") &&
    !localSystemRemovalArgs.includes("*S-1-5-18"),
  "LocalSystem capsule protection removed its commissioned principal",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectFailure(label, operation, pattern) {
  try {
    operation();
  } catch (error) {
    if (pattern && !pattern.test(error.message))
      throw new Error(`${label} failed for the wrong reason: ${error.message}`);
    return;
  }
  throw new Error(`${label} unexpectedly passed`);
}

function finalFixtureFailure(primaryFailure, cleanupFailure) {
  if (primaryFailure && cleanupFailure)
    return new AggregateError(
      [primaryFailure, cleanupFailure],
      `attested executor verification failed: ${primaryFailure.message}; fixture cleanup also failed: ${cleanupFailure.message}`,
    );
  return primaryFailure || cleanupFailure;
}

const fixtureFailureAggregationProbe = finalFixtureFailure(
  new Error("primary fixture failure"),
  new Error("fixture cleanup failure"),
);
assert(
  fixtureFailureAggregationProbe instanceof AggregateError &&
    fixtureFailureAggregationProbe.errors.length === 2,
  "fixture cleanup failure masked the primary verifier failure",
);

let releaseValidationFails = true;
let releaseProtectionFails = true;
const releaseAttempts = {
  validation: 0,
  protection: 0,
  capsuleMode: 0,
  rootMode: 0,
};
const retryableCapsuleRelease = createRuntimeCapsuleReleaser({
  validate() {
    releaseAttempts.validation += 1;
    if (releaseValidationFails) throw new Error("release validation failure");
  },
  cleanupSteps: [
    () => {
      releaseAttempts.protection += 1;
      if (releaseProtectionFails) throw new Error("release protection failure");
    },
    () => {
      releaseAttempts.capsuleMode += 1;
    },
    () => {
      releaseAttempts.rootMode += 1;
    },
  ],
});
let compoundReleaseFailure;
try {
  retryableCapsuleRelease.release();
} catch (error) {
  compoundReleaseFailure = error;
}
assert(
  compoundReleaseFailure instanceof AggregateError &&
    compoundReleaseFailure.errors.length === 2 &&
    Object.values(releaseAttempts).every((attempts) => attempts === 1),
  "runtime capsule release hid a validation or cleanup failure",
);
releaseValidationFails = false;
releaseProtectionFails = false;
let persistedValidationFailure;
try {
  retryableCapsuleRelease.release();
} catch (error) {
  persistedValidationFailure = error;
}
retryableCapsuleRelease.release();
assert(
  /release validation failure/u.test(
    persistedValidationFailure?.message || "",
  ) &&
    releaseAttempts.validation === 1 &&
    releaseAttempts.protection === 2 &&
    releaseAttempts.capsuleMode === 1 &&
    releaseAttempts.rootMode === 1,
  "runtime capsule release was not retryable or idempotent",
);

let partialCleanupFails = true;
const partialCleanupAttempts = {
  validation: 0,
  protection: 0,
  capsuleMode: 0,
  rootMode: 0,
};
const partialCapsuleRelease = createRuntimeCapsuleReleaser({
  validate() {
    partialCleanupAttempts.validation += 1;
  },
  cleanupSteps: [
    () => {
      partialCleanupAttempts.protection += 1;
    },
    () => {
      partialCleanupAttempts.capsuleMode += 1;
      if (partialCleanupFails)
        throw new Error("partial mode restoration failure");
    },
    () => {
      partialCleanupAttempts.rootMode += 1;
    },
  ],
});
expectFailure(
  "partial runtime capsule cleanup",
  () => partialCapsuleRelease.release(),
  /partial mode restoration failure/u,
);
partialCleanupFails = false;
partialCapsuleRelease.release();
partialCapsuleRelease.release();
assert(
  partialCleanupAttempts.validation === 1 &&
    partialCleanupAttempts.protection === 1 &&
    partialCleanupAttempts.capsuleMode === 2 &&
    partialCleanupAttempts.rootMode === 1,
  "runtime capsule release repeated completed cleanup after a partial failure",
);

function executableOnPath(name) {
  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [name],
    { encoding: "utf8", shell: false, windowsHide: true },
  );
  if (lookup.error || lookup.status !== 0)
    throw new Error(`test prerequisite ${name} is unavailable`);
  return realpathSync.native(lookup.stdout.trim().split(/\r?\n/u)[0]);
}

function git(gitCli, root, args, options = {}) {
  const result = spawnSync(
    gitCli,
    [
      "--no-optional-locks",
      "-c",
      "core.hooksPath=",
      "-c",
      "credential.helper=",
      "-C",
      root,
      ...args,
    ],
    {
      encoding: options.encoding ?? "utf8",
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        HOME: root,
        USERPROFILE: root,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `test Git command failed: ${result.error?.message || result.stderr || result.stdout}`,
    );
  return typeof result.stdout === "string"
    ? result.stdout.trim()
    : result.stdout;
}

function secureWindowsDirectory(target) {
  if (process.platform !== "win32") return;
  const powershell = path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:VALDRIS_TEST_ROOT
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $target
$acl.SetOwner($current)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($current, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl
`;
  const result = spawnSync(
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
    {
      encoding: "utf8",
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        VALDRIS_TEST_ROOT: target,
      },
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `failed to create restrictive Windows test root: ${
        result.error?.message || result.stderr || result.stdout
      }`,
    );
}

function runtimeResult(status, output = "") {
  return {
    status,
    stdout: status === 0 ? output : "",
    stderr: status === 0 ? "" : output,
  };
}

function executorArguments({ gitCliPath, gitCliSha256, repo, output }) {
  return [
    "--repo",
    repo,
    "--run-id",
    "EXECUTOR-WORKTREE-ROOT-CASE",
    "--image",
    `example.invalid/valdris@sha256:${"1".repeat(64)}`,
    "--command-json",
    '["true"]',
    "--command-identity-sha256",
    sha256(canonicalJson(["true"])),
    "--validator-sha256",
    "2".repeat(64),
    "--semantic-proof-set-sha256",
    "3".repeat(64),
    "--proof-input-set-sha256",
    "4".repeat(64),
    "--accepted-gate-artifacts-sha256",
    "5".repeat(64),
    "--git-cli",
    gitCliPath,
    "--git-cli-sha256",
    gitCliSha256,
    "--runtime",
    "docker",
    "--runtime-cli",
    process.execPath,
    "--runtime-cli-sha256",
    sha256(readFileSync(process.execPath)),
    "--daemon-identity-sha256",
    "6".repeat(64),
    "--output-dir",
    output,
    "--wall-clock-ms",
    String(EXECUTOR_PROBE_WALL_CLOCK_MS),
  ];
}

function executorDryRun(options) {
  assert(
    EXECUTOR_PROBE_PARENT_TIMEOUT_MS > EXECUTOR_PROBE_WALL_CLOCK_MS,
    "executor probe parent timeout must preserve time for child cleanup",
  );
  const executor = fileURLToPath(
    new URL("./attested-proof-executor.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [executor, ...executorArguments(options), "--dry-run"],
    {
      encoding: "utf8",
      shell: false,
      timeout: EXECUTOR_PROBE_PARENT_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  if (result.error)
    throw new Error(
      `executor CLI regression probe failed: ${result.error.message}`,
    );
  return result;
}

const root = realpathSync.native(
  mkdtempSync(path.join(tmpdir(), "valdris-executor-hardening-")),
);
let verifierFailure;
try {
  const linuxRuntimeCompatibility = referenceExecutorRuntimeCompatibility({
    operatingSystem: "linux",
    architecture: "amd64",
  });
  assert(
    linuxRuntimeCompatibility.supported === true,
    "the reference executor rejected a Linux OCI daemon",
  );
  const windowsRuntimeCompatibility = referenceExecutorRuntimeCompatibility({
    operatingSystem: "windows",
    architecture: "amd64",
  });
  assert(
    windowsRuntimeCompatibility.supported === false &&
      windowsRuntimeCompatibility.reason === "operating-system-incompatible",
    "the reference executor accepted a Windows-container daemon",
  );
  const missingRuntimeCompatibility = referenceExecutorRuntimeCompatibility({});
  assert(
    missingRuntimeCompatibility.supported === false &&
      missingRuntimeCompatibility.reason === "operating-system-unavailable",
    "the reference executor accepted an unclassified OCI daemon",
  );
  assert(
    classifyRuntimeDaemonInfoFailure("docker", {
      status: 1,
      stderr:
        "failed to connect to the docker API at npipe:////./pipe/docker_engine; check if the path is correct and if the daemon is running: open //./pipe/docker_engine: The system cannot find the file specified.",
    }) === "daemon-unavailable" &&
      classifyRuntimeDaemonInfoFailure("podman", {
        status: 1,
        stderr: "Error: unable to connect to Podman socket: connection refused",
      }) === "daemon-unavailable",
    "known local-default daemon failures were not classified as unavailable",
  );
  let typedTimeoutFailure;
  try {
    probeRuntimeDaemonIdentity(
      "docker",
      process.execPath,
      sha256(readFileSync(process.execPath)),
      {},
      {
        remaining(phase) {
          throw new Error(
            `executor total wall-clock deadline exceeded during ${phase}`,
          );
        },
        assert() {},
      },
    );
  } catch (error) {
    typedTimeoutFailure = error;
  }
  assert(
    runtimeProbeFailureMayBeSkipped(typedTimeoutFailure),
    "typed daemon-probe timeout was not skippable",
  );
  let cleanupNow = 1_000;
  const reserveWindowDeadline = createExecutionDeadline(
    100,
    cleanupNow,
    () => cleanupNow,
  );
  cleanupNow = 1_099;
  const cleanupCommands = [];
  const cleanupProblems = cleanupRuntimeResources({
    runtimeCli: process.execPath,
    runtimeCliSha256: sha256(readFileSync(process.execPath)),
    runtimeGuard: null,
    environment: {},
    deadline: reserveWindowDeadline,
    cidFile: path.join(root, "absent-cleanup.cid"),
    containerName: "cleanup-reserve-container",
    imageReferences: ["example.invalid/cleanup@sha256:" + "1".repeat(64)],
    runCommand(argv, phase, context) {
      const remaining = context.deadline.remaining(
        phase,
        context.deadlineOptions,
      );
      assert(
        context.deadlineOptions.reserveCleanup === false && remaining === 1,
        "cleanup command did not consume the reserved wall-clock window",
      );
      cleanupCommands.push(argv);
      if (phase.includes(" verify ")) return runtimeResult(1, "not found");
      if (phase.includes(" inspect ")) return runtimeResult(0, "present");
      return runtimeResult(0, "removed");
    },
  });
  assert(
    cleanupProblems.length === 0 && cleanupCommands.length === 6,
    `cleanup did not finish inside its reserved window: ${cleanupProblems.join("; ")}`,
  );
  const completionObservedStartedMs = Date.now();
  const completionDeadline = createExecutionDeadline(
    10_000,
    completionObservedStartedMs,
  );
  const completion = finalizeExecutorCompletion(completionDeadline, () => {
    const delayedValidation = spawnSync(
      process.execPath,
      [
        "-e",
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75)",
      ],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
    );
    if (delayedValidation.error || delayedValidation.status !== 0)
      throw new Error(
        `process-observed final validation fixture failed: ${delayedValidation.error?.message || delayedValidation.stderr}`,
      );
  });
  const completionObservedElapsedMs = Date.now() - completionObservedStartedMs;
  assert(
    completion.completedOperationElapsedMs >= 50 &&
      completion.completedOperationElapsedMs <= completionObservedElapsedMs &&
      Date.parse(completion.finishedAt) -
        Date.parse(completionDeadline.startedAt) ===
        completion.completedOperationElapsedMs,
    "signed executor completion duration did not include final process-observed validation",
  );
  for (const [runtimeKind, message] of [
    ["docker", "Docker local-default daemon identity returned malformed JSON"],
    ["docker", "Docker daemon did not expose a stable ID and version"],
    ["docker", "permission denied reading the daemon endpoint"],
    ["docker", "container runtime binary changed during verification"],
    ["docker", "permission denied after a deadline warning"],
    ["docker", "unexpected failure: The system cannot find the file specified"],
    ["docker", "error during connect: permission denied"],
    [
      "docker",
      "error during connect: permission denied reading the daemon endpoint",
    ],
    [
      "docker",
      "error during connect: remote TLS certificate validation failed",
    ],
    ["podman", "Error: unable to connect to Podman socket: permission denied"],
    [
      "podman",
      "Error: unable to connect to Podman socket: remote TLS certificate validation failed",
    ],
  ])
    assert(
      !runtimeProbeFailureMayBeSkipped(new Error(message)) &&
        classifyRuntimeDaemonInfoFailure(runtimeKind, {
          status: 1,
          stderr: message,
        }) === null,
      `unexpected ${runtimeKind} verifier failure was incorrectly skippable: ${message}`,
    );

  const gitCliPath = executableOnPath("git");
  const gitCliSha256 = sha256(readFileSync(gitCliPath));
  const commissionedGit = commissionedExecutable(
    "Git CLI",
    gitCliPath,
    gitCliSha256,
  );
  assert(
    commissionedGit.path === gitCliPath,
    "absolute Git path was not retained",
  );
  const aliasedCommissionedGit = commissionedExecutable(
    "Git CLI",
    process.platform === "win32" ? gitCliPath.toUpperCase() : gitCliPath,
    gitCliSha256,
  );
  assert(
    aliasedCommissionedGit.path === commissionedGit.path &&
      aliasedCommissionedGit.pathSha256 === commissionedGit.pathSha256,
    "commissioned executable identity changed under an equivalent path spelling",
  );
  expectFailure(
    "relative Git binary",
    () => commissionedExecutable("Git CLI", "git", gitCliSha256),
    /absolute/u,
  );
  expectFailure(
    "substituted Git binary",
    () => commissionedExecutable("Git CLI", gitCliPath, "0".repeat(64)),
    /commissioned/u,
  );

  const previousEnvironment = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USERPROFILE",
      "DOCKER_HOST",
      "CONTAINER_HOST",
      "DOCKER_CONTEXT",
      "CONTAINER_CONNECTION",
    ].map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    PATH: path.join(root, "poisoned-path"),
    HOME: path.join(root, "poisoned-home"),
    USERPROFILE: path.join(root, "poisoned-profile"),
    DOCKER_HOST: "tcp://attacker.invalid:2375",
    CONTAINER_HOST: "ssh://attacker.invalid",
    DOCKER_CONTEXT: "attacker",
    CONTAINER_CONNECTION: "attacker",
  });
  const isolatedHome = path.join(root, "runtime-home");
  mkdirSync(isolatedHome);
  const isolated = isolatedRuntimeEnvironment(isolatedHome);
  for (const forbidden of [
    "PATH",
    "DOCKER_HOST",
    "CONTAINER_HOST",
    "DOCKER_CONTEXT",
    "CONTAINER_CONNECTION",
  ])
    assert(
      !(forbidden in isolated),
      `runtime environment retained ${forbidden}`,
    );
  assert(
    isolated.HOME === isolatedHome && isolated.USERPROFILE === isolatedHome,
    "runtime HOME was not isolated",
  );
  let isolatedRuntimeCommand;
  const isolatedRuntimeResult = runCommissionedRuntimeCommand({
    runtimeCli: process.execPath,
    runtimeCliSha256: sha256(readFileSync(process.execPath)),
    environment: isolated,
    argv: ["image", "inspect", "fixture"],
    spawnSyncImpl(command, argv, options) {
      isolatedRuntimeCommand = { command, argv, options };
      return runtimeResult(0, "[]");
    },
  });
  assert(
    isolatedRuntimeResult.status === 0 &&
      isolatedRuntimeCommand.command ===
        realpathSync.native(process.execPath) &&
      isolatedRuntimeCommand.options.env === isolated &&
      [
        "DOCKER_HOST",
        "CONTAINER_HOST",
        "DOCKER_CONTEXT",
        "CONTAINER_CONNECTION",
      ].every((name) => !(name in isolatedRuntimeCommand.options.env)),
    "commissioned runtime command inherited an ambient endpoint selector",
  );
  const transientRuntime = path.join(root, "transient-runtime.bin");
  const commissionedRuntimeBytes = Buffer.from("commissioned runtime\n");
  writeFileSync(transientRuntime, commissionedRuntimeBytes);
  const transientRuntimeSha256 = sha256(commissionedRuntimeBytes);
  const capsuleParent = path.join(root, "runtime-capsule-parent");
  mkdirSync(capsuleParent);
  hardenNewPrivateDirectory(capsuleParent);
  const runtimeCapsule = stageCommissionedRuntimeExecutable({
    runtimeCli: transientRuntime,
    runtimeCliSha256: transientRuntimeSha256,
    privateRoot: capsuleParent,
    deadline: createExecutionDeadline(RUNTIME_CAPSULE_FIXTURE_DEADLINE_MS),
  });
  const expectedIsolationPolicy = runtimeExecutionIsolationPolicy({
    authorityIdentitySha256: runtimeCapsule.authorityIdentitySha256,
  });
  assert(
    runtimeCapsule.threatBoundary === RUNTIME_EXECUTION_THREAT_BOUNDARY &&
      runtimeCapsule.samePrincipalCompromisePolicy ===
        RUNTIME_SAME_PRINCIPAL_COMPROMISE_POLICY &&
      runtimeCapsule.containerUid === 65_534 &&
      runtimeCapsule.containerGid === 65_534 &&
      runtimeCapsule.hostMounts === false &&
      runtimeCapsule.capsuleAccess === false &&
      runtimeCapsule.isolationPolicySha256 ===
        expectedIsolationPolicy.policySha256,
    "runtime capsule did not bind the commissioned execution threat boundary",
  );
  expectFailure(
    "same-principal workload authority",
    () => commissionRuntimeExecutionBoundary({ type: "uid", id: "65534" }),
    /authority cannot equal the isolated workload UID/u,
  );
  let launchedRuntimePath;
  let sourceRestoredBeforeReturn = false;
  let capsuleWriteBlocked = false;
  let capsuleRenameBlocked = false;
  let transientRuntimeResult;
  try {
    transientRuntimeResult = runCommissionedRuntimeCommand({
      runtimeCli: runtimeCapsule.path,
      runtimeCliSha256: runtimeCapsule.sha256,
      environment: isolated,
      argv: ["run", "fixture"],
      deadline: createExecutionDeadline(RUNTIME_COMMAND_FIXTURE_DEADLINE_MS),
      phase: "transient runtime swap",
      deadlineOptions: { reserveCleanup: true },
      runtimeGuard: runtimeCapsule,
      spawnSyncImpl(command) {
        launchedRuntimePath = command;
        writeFileSync(transientRuntime, "uncommissioned runtime\n");
        writeFileSync(transientRuntime, commissionedRuntimeBytes);
        sourceRestoredBeforeReturn =
          sha256(readFileSync(transientRuntime)) === transientRuntimeSha256;
        try {
          writeFileSync(command, "uncommissioned capsule\n");
        } catch {
          capsuleWriteBlocked = true;
        }
        try {
          renameSync(command, `${command}.replacement`);
        } catch {
          capsuleRenameBlocked = true;
        }
        return runtimeResult(0, "trusted capsule output");
      },
    });
  } finally {
    runtimeCapsule.release();
  }
  assert(
    transientRuntimeResult.status === 0 &&
      transientRuntimeResult.stdout === "trusted capsule output" &&
      launchedRuntimePath === runtimeCapsule.path &&
      launchedRuntimePath !== realpathSync.native(transientRuntime) &&
      sourceRestoredBeforeReturn &&
      capsuleWriteBlocked &&
      capsuleRenameBlocked &&
      sha256(readFileSync(transientRuntime)) === transientRuntimeSha256,
    "transient source replacement could substitute the protected runtime capsule",
  );
  let windowsProtectedCapsuleLaunch = "not-applicable";
  if (process.platform === "win32") {
    const executableCapsuleParent = path.join(
      root,
      "executable-runtime-capsule-parent",
    );
    mkdirSync(executableCapsuleParent);
    hardenNewPrivateDirectory(executableCapsuleParent);
    const executableCapsule = stageCommissionedRuntimeExecutable({
      runtimeCli: process.execPath,
      runtimeCliSha256: sha256(readFileSync(process.execPath)),
      privateRoot: executableCapsuleParent,
      deadline: createExecutionDeadline(RUNTIME_CAPSULE_FIXTURE_DEADLINE_MS),
    });
    try {
      const launched = runCommissionedRuntimeCommand({
        runtimeCli: executableCapsule.path,
        runtimeCliSha256: executableCapsule.sha256,
        environment: isolated,
        argv: ["--version"],
        deadline: createExecutionDeadline(RUNTIME_CAPSULE_FIXTURE_DEADLINE_MS),
        phase: "Windows protected capsule launch",
        runtimeGuard: executableCapsule,
      });
      assert(
        launched.status === 0 && /^v\d+/u.test(launched.stdout.trim()),
        `Windows protected runtime capsule did not launch: ${
          launched.error?.message || launched.stderr || launched.stdout
        }`,
      );
      windowsProtectedCapsuleLaunch = true;
    } finally {
      executableCapsule.release();
    }
  }
  const executorLifecycleSource = readFileSync(
    fileURLToPath(new URL("./attested-proof-executor.mjs", import.meta.url)),
    "utf8",
  );
  assert(
    !/spawnWithinDeadline\(\s*runtimeCli(?:\.path)?\s*,/gu.test(
      executorLifecycleSource,
    ),
    "executor lifecycle bypasses commissioned runtime command checks",
  );
  for (const [name, value] of Object.entries(previousEnvironment))
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;

  const repo = path.join(root, "raw-tree-repo");
  mkdirSync(repo);
  git(gitCliPath, repo, ["init", "-q"]);
  git(gitCliPath, repo, ["config", "user.email", "verifier@example.invalid"]);
  git(gitCliPath, repo, ["config", "user.name", "Valdris Verifier"]);
  writeFileSync(
    path.join(repo, ".gitattributes"),
    "ignored.txt export-ignore\nsubst.txt export-subst\n",
  );
  writeFileSync(path.join(repo, "ignored.txt"), "must remain in raw tree\n");
  writeFileSync(path.join(repo, "subst.txt"), "$Format:%H$\n");
  git(gitCliPath, repo, ["add", "."]);
  git(gitCliPath, repo, ["commit", "-q", "-m", "attribute adversaries"]);
  const isolation = path.join(root, "git-isolation");
  mkdirSync(isolation);
  const hooks = path.join(isolation, "hooks");
  mkdirSync(hooks);
  const globalConfig = path.join(isolation, "global.gitconfig");
  writeFileSync(globalConfig, "");
  const source = {
    commit: git(gitCliPath, repo, ["rev-parse", "HEAD"]),
    tree: git(gitCliPath, repo, ["rev-parse", "HEAD^{tree}"]),
    objectFormat: git(gitCliPath, repo, ["rev-parse", "--show-object-format"]),
    filterDrivers: [],
  };
  const snapshot = materializeRawGitTreeSnapshot({
    gitCli: gitCliPath,
    repoRoot: repo,
    source,
    deadline: createExecutionDeadline(60_000),
    isolatedHooksRoot: hooks,
    isolatedGlobalConfig: globalConfig,
  });
  const byPath = new Map(
    snapshot.manifest.entries.map((entry) => [entry.path, entry]),
  );
  assert(
    byPath.has("ignored.txt"),
    "export-ignore removed a raw Git tree entry",
  );
  assert(
    byPath.get("subst.txt")?.contentSha256 === sha256("$Format:%H$\n"),
    "export-subst transformed raw Git object bytes",
  );
  assert(
    snapshot.manifestSha256 === sha256(canonicalJson(snapshot.manifest)),
    "raw Git tree manifest digest is not canonical",
  );
  const worktreeAlias =
    process.platform === "win32" ? repo.toUpperCase() : repo;
  const aliasedWorktree = executorDryRun({
    gitCliPath,
    gitCliSha256,
    repo: worktreeAlias,
    output: path.join(root, "case-aliased-worktree-output"),
  });
  assert(
    aliasedWorktree.status === 0,
    `executor rejected an equivalent worktree path spelling: ${
      aliasedWorktree.stderr || aliasedWorktree.stdout
    }`,
  );
  const insideSourceAlias = executorDryRun({
    gitCliPath,
    gitCliSha256,
    repo,
    output:
      process.platform === "win32"
        ? path.join(repo.toUpperCase(), "case-aliased-output")
        : path.join(repo, "inside-source-output"),
  });
  assert(
    insideSourceAlias.status !== 0 &&
      /isolated sibling|source boundary/u.test(
        insideSourceAlias.stderr || insideSourceAlias.stdout,
      ),
    "executor accepted an output directory inside the source through an aliased path spelling",
  );
  const instrumentedExecutorRoot = path.join(root, "instrumented-executor");
  cpSync(
    fileURLToPath(new URL(".", import.meta.url)),
    instrumentedExecutorRoot,
    {
      recursive: true,
    },
  );
  const executorSource = readFileSync(
    fileURLToPath(new URL("./attested-proof-executor.mjs", import.meta.url)),
    "utf8",
  );
  const probeCallAnchor = "          ...probeRuntimeDaemonIdentity(\n";
  const mainAnchor = "function main(argv) {";
  assert(
    executorSource.split(probeCallAnchor).length === 2 &&
      executorSource.split(mainAnchor).length === 2,
    "executor preflight fixture anchors drifted",
  );
  const fixtureProbe = `function fixtureProbeRuntimeDaemonIdentity() {
  const identity = JSON.parse(Buffer.from(process.env.VALDRIS_FIXTURE_DAEMON_IDENTITY_B64, "base64").toString("utf8"));
  return { identity, identitySha256: sha256(canonicalJson(identity)) };
}

`;
  const instrumentedExecutor = path.join(
    instrumentedExecutorRoot,
    "attested-proof-executor.mjs",
  );
  writeFileSync(
    instrumentedExecutor,
    executorSource
      .replace(
        probeCallAnchor,
        "          ...fixtureProbeRuntimeDaemonIdentity(\n",
      )
      .replace(mainAnchor, `${fixtureProbe}${mainAnchor}`),
  );
  for (const [label, identity, expected] of [
    [
      "Windows-container daemon",
      { operatingSystem: "windows", architecture: "amd64" },
      /operating-system-incompatible/u,
    ],
    ["unclassified daemon", {}, /operating-system-unavailable/u],
  ]) {
    const output = path.join(
      root,
      `${label.toLowerCase().replaceAll(/[^a-z]+/gu, "-")}-output`,
    );
    const result = spawnSync(
      process.execPath,
      [
        instrumentedExecutor,
        ...executorArguments({ gitCliPath, gitCliSha256, repo, output }),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          VALDRIS_FIXTURE_DAEMON_IDENTITY_B64: Buffer.from(
            JSON.stringify(identity),
          ).toString("base64"),
        },
        shell: false,
        timeout: EXECUTOR_PROBE_PARENT_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    assert(
      result.status !== 0 &&
        expected.test(result.stderr || result.stdout || result.error?.message),
      `${label} executor preflight failed for the wrong reason: ${
        result.stderr || result.stdout || result.error?.message
      }`,
    );
    assert(
      !existsSync(output),
      `${label} executor preflight materialized output before rejection`,
    );
  }
  git(gitCliPath, repo, [
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${source.commit},vendor/submodule`,
  ]);
  git(gitCliPath, repo, ["commit", "-q", "-m", "submodule adversary"]);
  expectFailure(
    "raw-tree submodule",
    () =>
      materializeRawGitTreeSnapshot({
        gitCli: gitCliPath,
        repoRoot: repo,
        source: {
          ...source,
          commit: git(gitCliPath, repo, ["rev-parse", "HEAD"]),
          tree: git(gitCliPath, repo, ["rev-parse", "HEAD^{tree}"]),
        },
        deadline: createExecutionDeadline(60_000),
        isolatedHooksRoot: hooks,
        isolatedGlobalConfig: globalConfig,
      }),
    /submodule/u,
  );

  const cleanupDeadline = createExecutionDeadline(60_000);
  const timeoutBeforeCidCommands = [];
  let containerPresent = true;
  const timeoutBeforeCidProblems = cleanupRuntimeResources({
    runtimeCli: "unused",
    environment: {},
    deadline: cleanupDeadline,
    cidFile: path.join(root, "missing.cid"),
    containerName: "unique-name-fallback",
    imageReferences: ["missing-image"],
    runCommand(argv) {
      timeoutBeforeCidCommands.push(argv.join(" "));
      if (argv[0] === "container" && argv[1] === "inspect")
        return containerPresent
          ? runtimeResult(0, "{}")
          : runtimeResult(1, "No such container");
      if (argv[0] === "rm") {
        containerPresent = false;
        return runtimeResult(0);
      }
      return runtimeResult(1, "No such image");
    },
  });
  assert(
    timeoutBeforeCidProblems.length === 0 &&
      timeoutBeforeCidCommands.includes("rm -f unique-name-fallback"),
    "container unique-name cleanup fallback did not prove absence",
  );

  const failedContainerRemoval = cleanupRuntimeResources({
    runtimeCli: "unused",
    environment: {},
    deadline: cleanupDeadline,
    cidFile: path.join(root, "missing-again.cid"),
    containerName: "stuck-container",
    imageReferences: [],
    runCommand(argv) {
      if (argv[0] === "rm") return runtimeResult(1, "permission denied");
      return runtimeResult(0, "{}");
    },
  });
  assert(
    failedContainerRemoval.some((problem) => /failed/u.test(problem)) &&
      failedContainerRemoval.some((problem) => /prove absence/u.test(problem)),
    "failed container removal was not aggregated and absence-checked",
  );

  const failedImageRemoval = cleanupRuntimeResources({
    runtimeCli: "unused",
    environment: {},
    deadline: cleanupDeadline,
    cidFile: path.join(root, "missing-third.cid"),
    containerName: "missing-container",
    imageReferences: ["stuck-image"],
    runCommand(argv) {
      if (argv[0] === "container") return runtimeResult(1, "No such container");
      if (argv[0] === "image" && argv[1] === "inspect")
        return runtimeResult(0, "{}");
      return runtimeResult(1, "image is in use");
    },
  });
  assert(
    failedImageRemoval.some((problem) =>
      /image cleanup failed/u.test(problem),
    ) && failedImageRemoval.some((problem) => /prove absence/u.test(problem)),
    "failed image deletion was not aggregated and absence-checked",
  );
  const aggregatedFailure = aggregateExecutionCleanupFailure(
    new Error("primary execution timeout"),
    ["container cleanup failed", "image cleanup failed"],
  );
  assert(
    aggregatedFailure instanceof AggregateError &&
      aggregatedFailure.errors.length === 3 &&
      /primary execution timeout/u.test(aggregatedFailure.message) &&
      /container cleanup failed/u.test(aggregatedFailure.message),
    "primary execution and cleanup failures were not preserved together",
  );

  const nonEmptyPrivateRoot = path.join(root, "non-empty-private-root");
  mkdirSync(nonEmptyPrivateRoot, { mode: 0o700 });
  writeFileSync(path.join(nonEmptyPrivateRoot, "untrusted-entry"), "blocked\n");
  expectFailure(
    "non-empty Windows private root",
    () => hardenNewPrivateDirectory(nonEmptyPrivateRoot, { platform: "win32" }),
    /must be empty before ownership hardening/u,
  );

  let windowsPostHardeningRace = "not-applicable";
  if (process.platform === "win32") {
    const racedPrivateRoot = path.join(root, "raced-private-root");
    mkdirSync(racedPrivateRoot);
    let hardeningCalls = 0;
    expectFailure(
      "post-hardening Windows private-root race",
      () =>
        hardenNewPrivateDirectory(racedPrivateRoot, {
          spawnSyncImpl(command, args, options) {
            const result = spawnSync(command, args, options);
            hardeningCalls += 1;
            if (!result.error && result.status === 0 && hardeningCalls === 1)
              writeFileSync(
                path.join(racedPrivateRoot, "raced-entry"),
                "blocked\n",
              );
            return result;
          },
        }),
      /changed during ownership hardening/u,
    );
    windowsPostHardeningRace = true;
  }

  const operatorRoot = path.join(root, "operator-root");
  mkdirSync(operatorRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(operatorRoot, 0o700);
  else secureWindowsDirectory(operatorRoot);
  const operatorIdentity = assertOperatorRootSecurity(operatorRoot);
  assertOperatorRootUnchanged(operatorRoot, operatorIdentity);
  const aliasedOperatorIdentity = assertOperatorRootSecurity(
    process.platform === "win32" ? operatorRoot.toUpperCase() : operatorRoot,
    {
      expectedPathSha256: operatorIdentity.pathSha256,
      expectedIdentitySha256: operatorIdentity.identitySha256,
    },
  );
  assert(
    operatorIdentity.identity.owner.id &&
      aliasedOperatorIdentity.path === operatorIdentity.path,
    "operator-root owner or native path identity was unstable",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        tests: {
          commissionedAbsoluteBinaries: true,
          equivalentCommissionedBinaryPathSpelling: true,
          linuxRuntimeCompatibility: true,
          windowsRuntimeCompatibilityRejected: true,
          unclassifiedRuntimeCompatibilityRejected: true,
          incompatibleRuntimeRejectedByExecutorPreflight: true,
          unavailableDaemonSkipClassification: true,
          malformedDaemonIdentityFailsClosed: true,
          poisonedPathAndContexts: true,
          poisonedRuntimeEndpointSelectors: true,
          transientRuntimeBinarySwapIsolatedByCapsule: true,
          runtimeThreatBoundaryCommissioned: true,
          samePrincipalWorkloadAuthorityRejected: true,
          windowsProtectedCapsuleLaunch,
          rawGitObjectTree: true,
          equivalentWorktreePathSpelling: true,
          aliasedOutputInsideSourceRejected: true,
          exportIgnoreAdversary: true,
          exportSubstAdversary: true,
          submoduleFailClosed: true,
          cleanupConsumesReservedDeadline: true,
          finalValidationIncludedInSignedDuration: true,
          cleanupUniqueNameFallback: true,
          cleanupFailureAggregation: true,
          runtimeCapsuleReleaseRetry: true,
          runtimeCapsulePartialCleanupRetry: true,
          nonEmptyPrivateRootRejected: true,
          windowsPostHardeningRace,
          operatorRootOwnerAndIdentity: true,
          equivalentOperatorRootPathSpelling: true,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  verifierFailure = error;
}
let fixtureCleanupFailure;
try {
  // Hosted Windows malware scanning can briefly retain the copied executable
  // after its synchronous launch exits. Keep cleanup bounded, but allow Node's
  // documented EPERM/EBUSY/ENOTEMPTY retry path to observe handle release.
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
} catch (error) {
  fixtureCleanupFailure = error;
}
const finalFailure = finalFixtureFailure(
  verifierFailure,
  fixtureCleanupFailure,
);
if (finalFailure) throw finalFailure;
