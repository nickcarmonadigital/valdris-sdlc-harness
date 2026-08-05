# Valdris SDLC Harness Claude Instructions

You are working inside the Valdris SDLC Harness repo.

## Required orientation

Read:

1. `README.md`
2. `AGENTS.md`
3. `knowledge/index.md`
4. `skills/registry.json`
5. `docs/GOAL_LOOP_AND_SKILL_ROUTER.md`
6. `docs/ENTERPRISE_CONTROL_MODEL_V2.md`
7. `docs/GENERATIVE_AI_ASSURANCE_PACK.md`
8. `docs/UNIVERSAL_COMMISSIONING_FLOW.md`
9. `docs/CLAUDE_CODE_CONNECTOR.md`
10. `knowledge/playbooks/clean-room-assurance-import.md`
11. `docs/import/PRIVATE_WORK_HARNESS_IMPORT_DECISION.md`
12. `docs/V09_AUTHORITATIVE_ASSURANCE.md`
13. `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md`
14. `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md`

## Non-negotiable product boundary

Do not turn this into a browser IDE or coding agent. Valdris is a repository-level SDLC assurance harness for AI coding agents. It installs repository controls, routes work, records coding-agent activity as structured evidence, checks required proof, and blocks completion when required checks or approvals are missing. Its qualified secondary role is a repository-level policy and evidence control plane around external coding agents.

For semantic or authoritative agent work, bind the typed requirement, tools/calls, durable memory heads, conditional model-judge calibration, runtime-driver/implementation, economics, declared interop, dependency-provenance, and trace-v2 artifacts documented in `docs/V09_AUTHORITATIVE_ASSURANCE.md`. Provider runtimes perform implementation; Layer 0 governs their goal, evidence, approvals, and stop conditions. Do not create Layer 14.

Follow `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md` for all technical and operational output. Answer first. Use one stable term for one meaning. Use short, direct sentences. Remove padding, repetition, decorative language, metaphors, analogies, slogans, dense noun chains, and inflated labels. For a material naming decision, inspect the mechanism and direct evidence, identify the applicable domain ontology, apply explicit category criteria, and open direct authoritative sources when local evidence is incomplete. Separate sourced facts from classification inference. State uncertainty instead of guessing. Routine communication does not require a classification record. Use ASD-STE100 Issue 9 as the target authoring standard, but do not claim formal conformance unless the complete applicable writing rules and controlled dictionary have been checked for the output.

## Build discipline

When modifying code, prove the result with:

```bash
npm run typecheck
npm run dependency:audit
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
npm run verify:commissioned-portability
npm run verify:harness
```

Run `npm run classification:record:check` only when a classification record is introduced or changed. Routine communication does not require a classification record.

When modifying commissioning behavior, the required `verify:commissioned-portability` and `verify:harness` commands above create isolated temporary target repositories, exercise commissioning, and clean them up. Do not commission this harness repository into a non-canonical output path.

## Final-answer shape

Bottom line, why, proof, fix/plan, your call.
