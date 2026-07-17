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

## Non-negotiable product boundary

Do not turn this into a browser IDE. The product is a commissioning/control-plane layer that connects to Claude Code, Codex, Hermes, and other coding-agent runtimes.

## Build discipline

When modifying code, prove the result with:

```bash
npm run typecheck
npm run build
npm run knowledge:gate
npm run skills:gate
npm run catalog:gate
npm run provenance:gate
npm run neutrality:gate
npm run privacy:gate
npm run verify:release-privacy
npm run privacy:release
npm run schema:compat:gate
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:enterprise-ai
npm run verify:work-harness-import
npm run verify:commissioned-portability
npm run verify:harness
```

When modifying commissioning behavior, the required `verify:commissioned-portability` and `verify:harness` commands above create isolated temporary target repositories, exercise commissioning, and clean them up. Do not commission this harness repository into a non-canonical output path.

## Final-answer shape

Bottom line, why, proof, fix/plan, your call.
