# Enterprise and Agentic-AI Research Synthesis (2026)

This research set audits the supplied 1317 paper and thirteen Enterprise Kit PDFs, checks their claims against current primary sources, evaluates Valdris against those requirements, and converts the findings into implementation decisions.

## Reports

- `enterprise-controls.md` — standards baseline, thirteen-layer matrix, supplied-PDF contradictions, 18 missing-control findings, typed evidence schema, and 16 concrete gate implications.
- `genai-assurance.md` — 70 research controls across AI assurance profiles, RAG, prompts, models, tools, memory, agents, safety, observability, cost, lifecycle, Red Zones, and the thirteen-layer overlay.
- `agent-workflows.md` — eight-skill router, durable goals/checkpoints, Codex and Claude adapters, MCP/A2A boundaries, GitHub enforcement, Matt Pocock skill mapping, and golden-path tests.
- `pdf-source-manifest.json` — hashes, byte sizes, page counts, audit date, and extraction-tool metadata for all 14 supplied PDFs without redistributing their contents.
- `skill-forward-tests.md` — cold-start payment-regression and iOS/AI-game routing tests, defects found, and corrections applied.

## Bottom line

The supplied material is valuable architecture guidance, but it is not sufficient as executable enterprise assurance. The 1317 paper is strongest as a goal-loop and agent-harness philosophy. The thirteen layer PDFs correctly expand “full stack,” yet their final prompts regress to generic checklist questions and do not prove control ownership, workload profile, dependency relationships, evidence identity, freshness, integrity, environment/commit binding, waiver governance, or AI-specific safety.

Valdris already had the right control-plane shape. Its key pre-v0.7 weakness was the same one: structural artifacts could pass on evidence-shaped text. The implementation therefore makes four decisions:

1. Keep the thirteen layers as the universal production map, but expand each required layer into named control IDs and an acyclic dependency graph.
2. Treat generative AI as a cross-cutting assurance overlay, not a fourteenth infrastructure layer.
3. Store durable goal/checkpoint/evidence state in Valdris, independent of any runtime-native goal loop or experimental protocol task feature.
4. Require typed, resolvable, subject-bound evidence and human-only approvals before finish-line completion.

## Implemented from the findings

- 39 production controls and ten executable AI assurance domains.
- Typed artifact, command, metric, approval, and provider-report evidence.
- Intake, route, goal, context, skill-registry, code-intelligence, eval, trajectory, production, AI, domain, live-smoke, and expiring-waiver validators.
- Eight phased workflow skills plus forward tests.
- Initial iOS, realtime multiplayer, digital-commerce, and youth-AI domain packs.
- A positive end-to-end fixture, nested commissioned-pack portability proof, bridge finish-line enforcement, and mutation-specific adversarial negative fixtures.

These reports are engineering research, not a certification or legal opinion. Workload-specific regulatory applicability and organizational control ownership still require qualified human review.
