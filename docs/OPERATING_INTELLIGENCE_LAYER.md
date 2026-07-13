# Operating Intelligence Layer

## Bottom line

The original control-plane skeleton is necessary but not sufficient. The PDF / paper-gap pattern says Valdris also needs operating intelligence: evals, trajectory review, context manifests, skills, memory, tool permissions, sandboxing, model routing, AI economics, background PR agents, interoperability, production-agent lifecycle, team ownership, and human-agent protocols.

This document is the durable map for that layer. The v0.7 commissioning generator captures these rules and now ships executable goal, context, skill, eval, trajectory, production, AI, and domain-assurance gates.

## Operating-intelligence families

| Family | Why it exists | Commissioning group | Canonical artifacts |
|---|---|---|---|
| Maturity / stakes classifier | Not every task deserves the same autonomy or proof burden. | project identity, validation, enterprise proof banks | `run/route.json`, `production/layer-assessment.json` |
| Tests + evals | AI behavior changes need evals in addition to tests. | eval gate | `evals/results.json`, datasets, rubrics, thresholds |
| Trajectory evaluation | A final artifact can pass while the agent path was unsafe or wasteful. | trajectory evaluation | `trajectory/trajectory.json`, retry/failure ledger |
| Context manifest / ICM | Agents need the right context, not unlimited context. | context manifest / ICM | `context/manifest.json`, hashed loaded-file ledger |
| Skill registry | Procedures should load only when relevant and with version/owner/proof. | skill registry | `skills/registry.json`, eight `SKILL.md` workflows |
| Memory substrate | Durable memory must help future runs without storing secrets/stale task state. | memory substrate | memory policy, provenance, review log |
| Tool registry + hooks | Tool use needs risk classes, hooks, and audit logs. | tool registry and hooks | `tools/registry.yaml`, hook outputs, audit log |
| Sandbox manager | Runs need allowed roots, network policy, secret policy, cleanup, escape proof. | sandbox manager | sandbox policy, allowed-root audit |
| Model routing | Strong/cheap model choice should be explicit and logged. | model routing | model route log, fallback record |
| AI economics | Token burn, retry loops, and human review time are product costs. | AI economics ledger | `cost/ledger.json`, handoff cost notes |
| Background PR agents | Async agents need branch/PR/reviewer/proof/stale-cleanup policy. | background PR agents | PR run packet, branch policy, proof bundle |
| MCP / A2A interoperability | External runtimes need tool contracts, auth roots, and live-event definitions. | MCP / A2A interoperability | MCP tool manifest, A2A policy, connector auth |
| Production-agent lifecycle | Deployed agents need states, eval gates, observability, and rollback. | production-agent lifecycle | lifecycle state, eval/canary/rollback proof |
| Team harness registry | Prompts, evals, connectors, skills, and proof banks need owners. | team harness registry | registry/owner map, drift checks |
| Human-agent protocol | Approvals and escalations must be scoped, durable, and auditable. | human-agent operating protocol | approval contract, contact channels, SLA |

## Pattern from paper-gap mining

The recurring missing/partial patterns are:

1. vibe/structured/agentic maturity classifier;
2. stakes-based verification tiers;
3. tests plus evals as a mandatory pair;
4. trajectory evaluation of the agent path, not only final artifacts;
5. static/dynamic context manifest and token/cost budgeting;
6. skill registry with progressive disclosure;
7. memory substrate with retention/review/evals;
8. agent loop state: plan, act, observe, iterate, stop condition;
9. harness component manifest: instructions, tools, sandboxes, orchestration, hooks, observability, evals;
10. tool registry, scoped permissions, hook runner, sandbox manager;
11. orchestrator layer: subtask DAGs, subagents, model/runtime routing, fan-out/fan-in;
12. MCP/A2A standards layer;
13. background PR agents;
14. production-agent lifecycle: create, eval, deploy, observe, refine;
15. AI development economics: token burn, prompt-loop waste, review time, hidden debt, OpEx;
16. human-agent team protocols: owners, escalation, approvals, reviewer routing, SLA/block timers.

## Current implementation status

| Layer | Current status | Notes |
|---|---|---|
| Commissioning questions | Built | `scripts/commission-harness.mjs --print-questions` emits 31 groups / 158 questions. |
| Generated adapter fields | Built structurally | `project-adapter.json` includes `operatingIntelligence`, `enterpriseProofBank`, `teamHarnessRegistry`, `humanAgentProtocol`. |
| Generated docs | Built structurally | Generated packs include Good Looks Like, Code Quality, Enterprise Proof Bank, Operating Intelligence, Team Registry, Human Agent Protocol. |
| Verifier assertions | Built structurally | `npm run verify:harness` checks expanded groups, adapter fields, and generated docs. |
| Executable goal/context/skill/eval/trajectory gates | Built + adversarially verified | Strict JSON validators reject incomplete goals, secret context, registry escapes, failing thresholds, violations, and budget overruns. |
| Enterprise production controls | Built + adversarially verified | 39 catalog controls use typed evidence under `uash.production-readiness.v2`. |
| Generative AI assurance | Built + adversarially verified | Ten cross-cutting controls plus RAG/tool/memory activation, eval, and trajectory gates. |
| Domain packs | Built initial set | iOS, realtime multiplayer, digital commerce, and youth-AI catalogs with a generic assurance gate. |
| Hosted backend / MCP daemon / A2A runtime | Partial/future | Local bridge is verified; product-grade connector runtime remains next phase. |

## Rule

When a run touches AI behavior, multi-agent execution, provider/tool permissions, memory, context, model selection, background agents, or production agent behavior, it must route through this layer. If the layer is not implemented enough to prove safety, the harness must mark the run partial or blocked instead of pretending the skeleton is enough.
