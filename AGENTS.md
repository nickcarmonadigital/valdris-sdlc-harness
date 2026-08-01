# Valdris SDLC Harness Agent Instructions

This repo builds Valdris: a repository-level SDLC assurance harness for AI coding agents.

## Start here

Before planning or editing, read:

1. `README.md`
2. `knowledge/index.md`
3. `skills/codex-routing.yaml`
4. `skills/registry.json`
5. `docs/GOAL_LOOP_AND_SKILL_ROUTER.md`
6. `docs/LAYER_ZERO_AND_ASSURANCE_TAXONOMY.md`
7. `docs/ENTERPRISE_CONTROL_MODEL_V2.md`
8. `docs/GENERATIVE_AI_ASSURANCE_PACK.md`
9. `docs/UNIVERSAL_COMMISSIONING_FLOW.md`
10. `docs/ARCHITECTURE.md`
11. `docs/CONNECTOR_EVENT_CONTRACT.md`
12. `knowledge/playbooks/clean-room-assurance-import.md`
13. `docs/import/PRIVATE_WORK_HARNESS_IMPORT_DECISION.md`
14. `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md`
15. `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md`

## Product rule

This is not an IDE, coding agent, or prompt library by itself. It installs repository controls, routes work, records coding-agent activity as structured evidence, checks required proof, and blocks completion when required checks or approvals are missing. Its qualified secondary role is a repository-level policy and evidence control plane around Claude Code, Codex, Hermes, and other external coding agents.

## Technical communication

Use `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md` and `policies/technical-communication.v1.json` for all technical and operational output. This behavior governs communication. It is not an SDLC layer, production domain, lifecycle stage, skill, gate, or product capability.

Answer the question first. Use one stable term for one meaning. Define unfamiliar terms once. Use short, direct sentences. Identify the actor, action, object, and condition when they affect meaning. Remove padding, repetition, decorative language, metaphors, analogies, slogans, dense noun chains, and inflated labels.

For a material public, architectural, legal, safety, or standards naming decision, inspect the mechanism and direct evidence, identify the applicable domain ontology, apply explicit category criteria, and open direct authoritative sources when local evidence is incomplete. Separate sourced facts from classification inference. Select the smallest supported term. State uncertainty instead of guessing. Use the classification-record template only when the decision needs an auditable evidence record; routine communication does not require one.

Use ASD-STE100 Issue 9 as the target authoring standard. Do not claim formal conformance unless the complete applicable writing rules and controlled dictionary have been checked for the output.

## Core loop

```text
commission repo/team
→ run GitNexus/code-intelligence scan
→ generate project-specific adapter
→ install AGENTS.md / CLAUDE.md / Claude slash-command / Codex prompt front doors
→ run external coding agent
→ stream events/artifacts/gates
→ block done until required proof exists
```

Codex discovers each skill from the YAML frontmatter in its `SKILL.md`; every Valdris skill explicitly allows implicit invocation in `agents/openai.yaml`. Use `skills/codex-routing.yaml` as the readable selection projection and `skills/registry.json` as the gate-authoritative registry.

The registry has two non-competing catalogs:

- Seven lifecycle skills select exactly one owning Valdris system: commission, route-goal, assure, connect-runtime, execute-workflow, prove-govern, or trust-improve.
- Eight work-type skills select exactly one primary skill per intake, delivery, or proof-handoff phase plus at most four supporting skills.

Use `node scripts/route-lifecycle-skill.mjs --request "<request>"` when the requested Valdris system is not explicit. Lifecycle routing never overrides the work primary bound in `run/route.json`. Durable loop state lives in `goal/goal.json`; runtime-native goal/loop state is advisory and cannot override Valdris proof gates or human approvals.

## Claude/Codex entrypoints

- Claude Code: read `CLAUDE.md`; generated target packs include `.claude/commands/valdris-sdlc-harness.md`.
- Codex/general agents: read `AGENTS.md`; generated target packs include `docs/Codex Runtime Prompt.md`.
- Live telemetry requires real bridge/MCP/CLI/API/watched-artifact events. Never claim a live run from static docs or demo data.

## Universal vs project-specific

Keep universal:

- commissioning interview
- project-adapter schema
- agent front doors
- router/lane pattern
- stage flow
- run packet model
- proof/red-zone/RCA/anchor gates
- answer contract
- connector event contract
- lane-context eval pattern
- GitNexus/code-intelligence gate
- OKF-style agent knowledge vault
- provenance, neutrality, privacy, and schema-compatibility gates
- Git/worktree- and application-source-bound portable proof, same-command/pre-post/path-bound RCA, Ed25519-attested full-evidence review, and native-validator-bound run-packet contracts
- structural/semantic/authoritative claim separation, pre-implementation readiness, AI/runtime identity, external authority receipts, and run-packet v3 catalog snapshots
- typed requirement traceability, registered tool/call evidence, durable memory heads, conditional model-judge calibration, runtime-driver/implementation receipts, reconciled economics, dependency provenance, complete declared MCP/A2A transcripts, and trace-v2 trajectory/decision binding
- ontology-grounded terminology, authoritative-source escalation, and controlled technical communication

Move into generated adapters:

- product/team names
- source-of-truth order
- branch/deploy model
- validation commands
- Red Zone actions and approvers
- safe edit paths and review-required paths
- enabled lanes
- human answer style
- domain ontology sources, controlled vocabulary, qualified terms, source escalation, citation policy, and technical-English profile
- provider/account identities, private topology, customer data, incidents, and real run packets

## Validation

Run before claiming done:

```bash
npm run typecheck
npm run dependency:audit
npm run format:check
npm run build
npm run knowledge:gate
npm run skills:gate
npm run catalog:gate
npm run verify:terminology
npm run provenance:gate
npm run neutrality:gate
npm run privacy:gate
npm run verify:release-privacy
npm run privacy:release
npm run schema:compat:gate
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:enterprise-ai
npm run verify:v09-assurance
npm run verify:run-packet-trust
npm run verify:work-harness-import
npm run verify:clean-room-convergence
npm run verify:commissioned-portability
npm run verify:harness
npm run verify:runtime-closure
npm run skills:install:codex
npm run skills:check:codex
npm run worktree:check
```

Run `npm run classification:record:check` only when a classification record is introduced or changed. Routine communication does not require a classification record.

The commissioned-portability verifier creates a temporary Git target, generates and commits `.valdris-harness`, retains an iOS-like binary product asset outside the clean-room scope, and executes the generated route, proof, signed-review, and run-packet path.

New packets use `valdris.run-packet.v3`. Semantic and authoritative claims must pass `authoritative-assurance-gate.mjs`; genuine packets emitted by the pinned pre-v3 runtime remain structural evidence only. The default authority trust store is empty, so the harness cannot certify itself. Never tag `v0.9.0` without a real commissioned provider-backed authoritative run.

## Answer style

Use decision packets: bottom line, why, proof, fix/plan, your call. Avoid process narration unless the user asks for the raw trace.
