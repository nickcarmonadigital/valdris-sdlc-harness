import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256 } from "./proof-runner.mjs";

const SHA256 = /^[a-f0-9]{64}$/i;
const WINDOWS_REPARSE_POINT = 0x400;
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
  return realpathSync(path.resolve(target));
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

function windowsPowerShellPath(environment) {
  const systemRoot = environment.SystemRoot || environment.WINDIR;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot))
    throw new Error(
      "SystemRoot is required to inspect a Windows operator root",
    );
  const candidate = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!existsSync(candidate))
    throw new Error(
      "Windows PowerShell is unavailable for operator-root ACL inspection",
    );
  return realpathSync(candidate);
}

function inspectWindowsAcl(realPath, { environment, spawnSyncImpl }) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:VALDRIS_OPERATOR_ROOT_TARGET
$item = Get-Item -LiteralPath $target -Force
$acl = Get-Acl -LiteralPath $target
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ownerSid = $acl.Owner
try {
  $ownerSid = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
} catch {}
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
        VALDRIS_OPERATOR_ROOT_TARGET: realPath,
      },
      shell: false,
      windowsHide: true,
      maxBuffer: 1_048_576,
      timeout: 15_000,
    },
  );
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
  { environment = process.env, spawnSyncImpl = spawnSync } = {},
) {
  const linkStats = lstatSync(realPath);
  const stats = statSync(realPath, { bigint: true });
  if (!linkStats.isDirectory() || linkStats.isSymbolicLink())
    throw new Error("operator root must be a real directory");
  const acl = inspectWindowsAcl(realPath, { environment, spawnSyncImpl });
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
  } = {},
) {
  const realPath = canonicalRealPath(target);
  const identity =
    platform === "win32"
      ? inspectWindowsRoot(realPath, { environment, spawnSyncImpl })
      : inspectPosixRoot(realPath);
  identity.platform = platform;
  const identitySha256 = sha256(canonicalJson(identity));
  return {
    path: realPath,
    pathSha256: sha256(realPath),
    identity,
    identitySha256,
  };
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
  } = {},
) {
  const realPath = canonicalRealPath(target);
  const stats = lstatSync(realPath);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("private directory must be a real directory");
  if (platform !== "win32") {
    chmodSync(realPath, 0o700);
    return assertOperatorRootSecurity(realPath, { platform });
  }
  const powershell = windowsPowerShellPath(environment);
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:VALDRIS_OPERATOR_ROOT_TARGET
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $target
$ownerSid = $acl.Owner
try {
  $ownerSid = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value
} catch {}
if ($ownerSid -ne $current.Value) { throw "private directory is not owned by current SID" }
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($current, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl
`;
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
        VALDRIS_OPERATOR_ROOT_TARGET: realPath,
      },
      shell: false,
      windowsHide: true,
      maxBuffer: 1_048_576,
      timeout: 15_000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `failed to harden Windows private directory: ${
        result.error?.message || result.stderr || result.stdout
      }`,
    );
  return assertOperatorRootSecurity(realPath, {
    platform,
    environment,
    spawnSyncImpl,
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
