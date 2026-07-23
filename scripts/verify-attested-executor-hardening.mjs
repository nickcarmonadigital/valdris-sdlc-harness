#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateExecutionCleanupFailure,
  cleanupRuntimeResources,
  commissionedExecutable,
  createExecutionDeadline,
  isolatedRuntimeEnvironment,
  materializeRawGitTreeSnapshot,
} from "./attested-proof-executor.mjs";
import {
  assertOperatorRootSecurity,
  assertOperatorRootUnchanged,
  hardenNewPrivateDirectory,
} from "./operator-root-security.mjs";
import { canonicalJson, sha256 } from "./proof-runner.mjs";

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

function executorDryRun({ gitCliPath, gitCliSha256, repo, output }) {
  const executor = fileURLToPath(
    new URL("./attested-proof-executor.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [
      executor,
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
      "--dry-run",
    ],
    {
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
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
try {
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
          poisonedPathAndContexts: true,
          rawGitObjectTree: true,
          equivalentWorktreePathSpelling: true,
          aliasedOutputInsideSourceRejected: true,
          exportIgnoreAdversary: true,
          exportSubstAdversary: true,
          submoduleFailClosed: true,
          cleanupUniqueNameFallback: true,
          cleanupFailureAggregation: true,
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
} finally {
  rmSync(root, { recursive: true, force: true });
}
