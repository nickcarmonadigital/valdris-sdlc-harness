import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256 } from "./proof-runner.mjs";

const SHA256 = /^[a-f0-9]{64}$/i;
const WINDOWS_REPARSE_POINT = 0x400;
const WINDOWS_ACL_COMMAND_TIMEOUT_MS = 60_000;
const WINDOWS_WRITE_RIGHTS =
  0x00000002n | // WriteData / CreateFiles
  0x00000004n | // AppendData / CreateDirectories
  0x00000010n | // WriteExtendedAttributes
  0x00000040n | // DeleteSubdirectoriesAndFiles
  0x00000100n | // WriteAttributes
  0x00010000n | // Delete
  0x00040000n | // ChangePermissions
  0x00080000n; // TakeOwnership
const WINDOWS_TRUSTED_WRITER_SIDS = new Set([
  "S-1-3-0", // Creator Owner: resolves to the creating principal.
  "S-1-5-18", // Local System.
  "S-1-5-32-544", // Built-in Administrators.
]);

function fileIdentity(stats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
  };
}

function canonicalRealPath(target) {
  if (!target || !path.isAbsolute(target))
    throw new Error("operator root must be an absolute path");
  if (!existsSync(target)) throw new Error("operator root does not exist");
  return realpathSync.native(path.resolve(target));
}

function inspectPosixRoot(realPath) {
  const linkStats = lstatSync(realPath);
  const stats = statSync(realPath, { bigint: true });
  if (!linkStats.isDirectory() || linkStats.isSymbolicLink())
    throw new Error("operator root must be a real directory");
  if (typeof process.getuid !== "function")
    throw new Error("current POSIX UID is unavailable");
  const currentUid = process.getuid();
  if (Number(stats.uid) !== currentUid)
    throw new Error(
      `operator root must be owned by current UID ${currentUid}; found ${stats.uid}`,
    );
  const mode = Number(stats.mode & 0o777n);
  if ((mode & 0o022) !== 0)
    throw new Error(
      `operator root cannot be group- or world-writable; mode is ${mode.toString(8).padStart(3, "0")}`,
    );
  return {
    platform: process.platform,
    realPath,
    owner: { type: "uid", id: String(stats.uid) },
    permissions: {
      mode: mode.toString(8).padStart(3, "0"),
      groupWritable: false,
      worldWritable: false,
    },
    fileIdentity: fileIdentity(stats),
    reparsePoint: false,
  };
}

export function windowsPowerShellPath(environment) {
  const systemRoot = environment.SystemRoot || environment.WINDIR;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw new Error(
      "SystemRoot is required to inspect a Windows operator root",
    );
  const programFiles =
    environment.ProgramFiles || environment.ProgramW6432 || "";
  const candidates = [
    programFiles && path.win32.isAbsolute(programFiles)
      ? path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe")
      : null,
    path.win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  ].filter(Boolean);
  const candidate = candidates.find((file) => existsSync(file));
  if (!candidate)
    throw new Error(
      "PowerShell is unavailable for Windows operator-root ACL inspection",
    );
  return realpathSync.native(candidate);
}

function windowsOperationTimeout(
  deadline,
  phase,
  { reserveCleanup = false } = {},
) {
  if (!deadline) return WINDOWS_ACL_COMMAND_TIMEOUT_MS;
  return Math.min(
    WINDOWS_ACL_COMMAND_TIMEOUT_MS,
    deadline.remaining(phase, { reserveCleanup }),
  );
}

function assertWindowsOperationDeadline(
  result,
  deadline,
  phase,
  { reserveCleanup = false } = {},
) {
  if (result.error?.code === "ETIMEDOUT" && deadline)
    throw new Error(
      `executor total wall-clock deadline exceeded during ${phase}`,
    );
  deadline?.assert(phase, { reserveCleanup });
}

function inspectWindowsAcl(
  realPath,
  {
    environment,
    spawnSyncImpl,
    deadline,
    deadlinePhase = "Windows operator-root ACL inspection",
    reserveCleanup = false,
  },
) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:VALDRIS_OPERATOR_ROOT_TARGET
$item = Get-Item -LiteralPath $target -Force
$acl = Get-Acl -LiteralPath $target
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [PSCustomObject]@{
    sid = $_.IdentityReference.Value
    type = $_.AccessControlType.ToString()
    rights = ([Int64]$_.FileSystemRights).ToString()
    inherited = [bool]$_.IsInherited
  }
})
[PSCustomObject]@{
  currentSid = $currentSid
  ownerSid = $ownerSid
  attributes = [Int64]$item.Attributes
  rules = $rules
} | ConvertTo-Json -Depth 5 -Compress
`;
  const powershell = windowsPowerShellPath(environment);
  const result = spawnSyncImpl(
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
        SystemRoot: environment.SystemRoot,
        WINDIR: environment.WINDIR,
        ProgramFiles: environment.ProgramFiles,
        ProgramW6432: environment.ProgramW6432,
        VALDRIS_OPERATOR_ROOT_TARGET: realPath,
      },
      shell: false,
      windowsHide: true,
      maxBuffer: 1_048_576,
      timeout: windowsOperationTimeout(deadline, deadlinePhase, {
        reserveCleanup,
      }),
    },
  );
  assertWindowsOperationDeadline(result, deadline, deadlinePhase, {
    reserveCleanup,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `failed to inspect Windows operator-root ACL: ${
        result.error?.message || result.stderr || result.stdout
      }`,
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "Windows operator-root ACL inspection returned malformed JSON",
    );
  }
}

function inspectWindowsRoot(
  realPath,
  {
    environment = process.env,
    spawnSyncImpl = spawnSync,
    deadline,
    deadlinePhase,
    reserveCleanup,
  } = {},
) {
  const linkStats = lstatSync(realPath);
  const stats = statSync(realPath, { bigint: true });
  if (!linkStats.isDirectory() || linkStats.isSymbolicLink())
    throw new Error("operator root must be a real directory");
  const acl = inspectWindowsAcl(realPath, {
    environment,
    spawnSyncImpl,
    deadline,
    deadlinePhase,
    reserveCleanup,
  });
  if (
    !acl ||
    typeof acl.currentSid !== "string" ||
    typeof acl.ownerSid !== "string" ||
    !Array.isArray(acl.rules)
  )
    throw new Error("Windows operator-root ACL inspection is incomplete");
  if (
    (Number(acl.attributes) & WINDOWS_REPARSE_POINT) !== 0 ||
    (Number(linkStats.mode) & WINDOWS_REPARSE_POINT) !== 0
  )
    throw new Error("operator root cannot be a Windows reparse point");
  if (acl.ownerSid.toUpperCase() !== acl.currentSid.toUpperCase())
    throw new Error(
      `operator root must be owned by current SID ${acl.currentSid}; found ${acl.ownerSid}`,
    );
  const rules = acl.rules
    .map((rule) => ({
      sid: String(rule.sid).toUpperCase(),
      type: String(rule.type),
      rights: String(rule.rights),
      inherited: rule.inherited === true,
    }))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  for (const rule of rules) {
    let rights;
    try {
      rights = BigInt(rule.rights);
    } catch {
      throw new Error("Windows operator-root ACL contains malformed rights");
    }
    if (
      rule.type === "Allow" &&
      (rights & WINDOWS_WRITE_RIGHTS) !== 0n &&
      rule.sid !== acl.currentSid.toUpperCase() &&
      !WINDOWS_TRUSTED_WRITER_SIDS.has(rule.sid)
    )
      throw new Error(
        `operator root grants write authority to untrusted SID ${rule.sid}`,
      );
  }
  return {
    platform: process.platform,
    realPath,
    owner: { type: "sid", id: acl.currentSid.toUpperCase() },
    permissions: {
      dacl: rules,
      broadWriteAccess: false,
    },
    fileIdentity: fileIdentity(stats),
    reparsePoint: false,
  };
}

export function inspectOperatorRoot(
  target,
  {
    platform = process.platform,
    environment = process.env,
    spawnSyncImpl = spawnSync,
    deadline,
    deadlinePhase = "operator-root inspection",
    reserveCleanup = false,
  } = {},
) {
  deadline?.assert(deadlinePhase, { reserveCleanup });
  const realPath = canonicalRealPath(target);
  const identity =
    platform === "win32"
      ? inspectWindowsRoot(realPath, {
          environment,
          spawnSyncImpl,
          deadline,
          deadlinePhase,
          reserveCleanup,
        })
      : inspectPosixRoot(realPath);
  identity.platform = platform;
  const identitySha256 = sha256(canonicalJson(identity));
  const inspected = {
    path: realPath,
    pathSha256: sha256(realPath),
    identity,
    identitySha256,
  };
  deadline?.assert(deadlinePhase, { reserveCleanup });
  return inspected;
}

export function assertOperatorRootSecurity(
  target,
  { expectedPathSha256, expectedIdentitySha256, ...inspectionOptions } = {},
) {
  if (expectedPathSha256 !== undefined && !SHA256.test(expectedPathSha256))
    throw new Error("commissioned operator-root path digest is invalid");
  if (
    expectedIdentitySha256 !== undefined &&
    !SHA256.test(expectedIdentitySha256)
  )
    throw new Error("commissioned operator-root identity digest is invalid");
  const inspected = inspectOperatorRoot(target, inspectionOptions);
  if (
    expectedPathSha256 &&
    inspected.pathSha256 !== expectedPathSha256.toLowerCase()
  )
    throw new Error(
      "operator root path does not match its commissioned digest",
    );
  if (
    expectedIdentitySha256 &&
    inspected.identitySha256 !== expectedIdentitySha256.toLowerCase()
  )
    throw new Error(
      "operator root owner, permissions, or stable file identity changed from commissioning",
    );
  return inspected;
}

export function assertOperatorRootUnchanged(
  target,
  expected,
  inspectionOptions = {},
) {
  if (!expected?.pathSha256 || !expected?.identitySha256)
    throw new Error("expected operator-root identity is incomplete");
  return assertOperatorRootSecurity(target, {
    expectedPathSha256: expected.pathSha256,
    expectedIdentitySha256: expected.identitySha256,
    ...inspectionOptions,
  });
}

export function hardenNewPrivateDirectory(
  target,
  {
    platform = process.platform,
    environment = process.env,
    spawnSyncImpl = spawnSync,
    deadline,
    deadlinePhase = "Windows private-directory hardening",
    reserveCleanup = false,
  } = {},
) {
  deadline?.assert(deadlinePhase, { reserveCleanup });
  const realPath = canonicalRealPath(target);
  const stats = lstatSync(realPath);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("private directory must be a real directory");
  if (platform !== "win32") {
    chmodSync(realPath, 0o700);
    return assertOperatorRootSecurity(realPath, { platform });
  }
  if (readdirSync(realPath).length !== 0)
    throw new Error(
      "new Windows private directory must be empty before ownership hardening",
    );
  const systemRoot = environment.SystemRoot || environment.WINDIR;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw new Error(
      "SystemRoot is required to harden a Windows private directory",
    );
  const whoami = path.win32.join(systemRoot, "System32", "whoami.exe");
  const icacls = path.win32.join(systemRoot, "System32", "icacls.exe");
  for (const [binary, label] of [
    [whoami, "whoami"],
    [icacls, "icacls"],
  ])
    if (!existsSync(binary))
      throw new Error(
        `Windows ${label} is unavailable for private-directory hardening`,
      );
  const runNative = (command, args, phase) => {
    const result = spawnSyncImpl(command, args, {
      encoding: "utf8",
      env: {
        SystemRoot: environment.SystemRoot,
        WINDIR: environment.WINDIR,
      },
      shell: false,
      windowsHide: true,
      maxBuffer: 1_048_576,
      timeout: windowsOperationTimeout(deadline, phase, {
        reserveCleanup,
      }),
    });
    assertWindowsOperationDeadline(result, deadline, phase, {
      reserveCleanup,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `failed to harden Windows private directory during ${phase}: ${
          result.error?.message || result.stderr || result.stdout
        }`,
      );
    if (readdirSync(realPath).length !== 0)
      throw new Error(
        "new Windows private directory changed during ownership hardening",
      );
    return result;
  };
  const identity = runNative(
    whoami,
    ["/user", "/fo", "csv", "/nh"],
    `${deadlinePhase} identity`,
  );
  const currentSid = identity.stdout.match(/S-\d(?:-\d+)+/iu)?.[0];
  if (!currentSid)
    throw new Error(
      "Windows private-directory hardening could not resolve the current SID",
    );
  runNative(
    icacls,
    [realPath, "/setowner", `*${currentSid}`, "/Q"],
    `${deadlinePhase} owner`,
  );
  runNative(
    icacls,
    [
      realPath,
      "/inheritance:r",
      "/grant:r",
      `*${currentSid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
      "*S-1-5-32-544:(OI)(CI)F",
      "/Q",
    ],
    `${deadlinePhase} permissions`,
  );
  if (readdirSync(realPath).length !== 0)
    throw new Error(
      "new Windows private directory changed during ownership hardening",
    );
  return assertOperatorRootSecurity(realPath, {
    platform,
    environment,
    spawnSyncImpl,
    deadline,
    deadlinePhase: `${deadlinePhase} verification`,
    reserveCleanup,
  });
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: node scripts/operator-root-security.mjs --root ABSOLUTE_PATH",
    );
    return;
  }
  const rootIndex = argv.indexOf("--root");
  if (rootIndex < 0 || !argv[rootIndex + 1] || argv.length !== 2)
    throw new Error("--root ABSOLUTE_PATH is required");
  console.log(
    JSON.stringify(assertOperatorRootSecurity(argv[rootIndex + 1]), null, 2),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
