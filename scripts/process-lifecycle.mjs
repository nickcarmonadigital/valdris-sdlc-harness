function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(
      () => finish(childHasExited(child)),
      Math.max(0, timeoutMs),
    );
    child.once("exit", onExit);
    if (childHasExited(child)) finish(true);
  });
}

export async function terminateChildProcess(child, options = {}) {
  if (childHasExited(child)) return;
  const label = options.label || "child process";
  const gracefulMs = options.gracefulMs ?? 1_500;
  const forceMs = options.forceMs ?? 1_500;
  if (
    !Number.isFinite(gracefulMs) ||
    gracefulMs < 0 ||
    !Number.isFinite(forceMs) ||
    forceMs < 0
  ) {
    throw new Error(
      "child shutdown timeouts must be finite non-negative numbers",
    );
  }

  child.kill("SIGTERM");
  if (await waitForChildExit(child, gracefulMs)) return;
  child.kill("SIGKILL");
  if (await waitForChildExit(child, forceMs)) return;
  throw new Error(`${label} did not exit after forced shutdown`);
}
