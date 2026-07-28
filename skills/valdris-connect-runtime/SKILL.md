---
name: valdris-connect-runtime
description: Connect Codex, Claude, Hermes, or a custom agent to a commissioned Valdris run and establish truthful local, Live Run, or replay state. Select for runtime adapters, bridge sessions, event streaming, leases, or replay; do not select merely because an ordinary coding task happens to be performed by an agent.
---

# Valdris Connect Runtime

This skill owns **Runtime Connectivity**. Valdris governs the run; the connected runtime performs engineering actions.

## Deterministic flow

1. Require a bound route, goal, and resolved pre-implementation assurance. Read the commissioned runtime adapter and select exactly one mode: Blueprint/local, Live Run, or Replay.
2. Write or validate `run/mode.json`. Never describe local artifacts as live telemetry and never describe replayed events as a current execution.
3. For Live Run, require an operator-created run ID and bridge URL. An agent receives only `UASH_BRIDGE_ACCESS_TOKEN`. Keep `UASH_BRIDGE_INTEGRITY_KEY` and `UASH_HUMAN_APPROVAL_TOKEN` outside the agent environment.
4. Establish the runtime lease and, when required by the tier, validate `runtime/driver.json`, `runtime/driver-state.json`, implementation receipts, runtime identity, and signed conformance.
5. Emit real events before and after each node, gate, artifact, skip, failure, approval request, and completion. Bind the correct artifact root on the first event. Use bounded payloads and redact credentials.
6. An agent may request approval, then must stop. Only the scoped human owner may grant or deny it from a separate operator-held credential boundary.
7. For local mode, preserve the same artifact contract without claiming a connector or ledger exists. For replay, verify the stored event and artifact identities before drawing conclusions.
8. Run bridge credential, lease, process-lifecycle, and runtime-identity checks applicable to the commissioned mode.

## Completion criterion

Connectivity is ready only when the mode is explicit; the connected runtime and run ID match the route and goal; Live Run has a valid lease plus real events; local mode has no live claim; replay is labeled and identity-checked; and no operator-only credential entered the agent boundary.

If the runtime cannot be trusted, remain blocked. Otherwise hand off to `$valdris-execute-workflow`.
