import { spawnSync } from "node:child_process";

export const DEFAULT_GIT_TIMEOUT_MS = 15_000;

export function runBoundedGit(repoRoot, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Git command timeout must be a positive finite number");
  return spawnSync(
    options.executable || "git",
    [...(options.prefixArgs || []), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}
