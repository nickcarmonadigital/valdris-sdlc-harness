# Synthetic Run Packet Template

This directory documents the project-neutral run-packet shape. Do not commit live customer, incident, provider, console, log, or operational evidence to the universal harness.

A completed commissioned run binds:

- authorized intake and route;
- workload classification and Layer 0 assessment;
- goal and checkpoint state;
- portable proof receipts;
- typed RCA when the route is a bug, regression, incident, or self-heal;
- an independent review decision;
- hashes for every required gate artifact;
- final handoff and any human-only approvals.

Use `scripts/run-create.mjs` to assemble `run/packet.json`, then validate it with `scripts/run-packet-gate.mjs`.
