# Generative AI Assurance Pack

Generative AI is a cross-cutting assurance overlay, not a fourteenth infrastructure layer. An AI feature still traverses the relevant frontend, API, data, auth, deployment, security, rate, cache, scale, observability, and recovery controls; this pack adds the risks unique to models, retrieval, tools, memory, and probabilistic behavior.

## Activation

Every run writes `ai/assurance.json`.

- If no AI workload exists, use `aiProfile: "AI-0"`, `workloadDetected: false`, `status: skipped`, and a precise `skipReason`.
- Use `AI-1` for bounded assistive low-consequence AI with human verification, `AI-2` for material user-facing/retrieval/memory/operational behavior, and `AI-3` for consequential or autonomous behavior and state-changing authority.
- If models, prompts, embeddings, retrieval, agents, AI tools, or AI memory affect behavior, use `workloadDetected: true` and prove every active catalog control. Consequential behavior is rejected below `AI-3`.
- Set `features.rag`, `features.tools`, `features.memory`, and `features.consequential` explicitly. Conditional controls are required only when their feature is active.

## Control domains

The catalog at `controls/genai-assurance.v1.json` covers:

1. Versioned inventory of models, providers, prompts, tools, skills, datasets, corpora, memory, and policies.
2. Evals with datasets, rubrics, thresholds, owners, and model/provider/config versions.
3. Provenance, consent, classification, retention, residency, and deletion for AI data.
4. Retrieval grounding, citations, freshness, authorization, and tenant isolation when RAG is used.
5. Prompt injection, jailbreak, disclosure, harmful output, and excessive-agency cases.
6. Least-privilege tools, typed contracts, sandboxing, budgets, and human approval for consequential calls.
7. Isolated, reviewable, expirable, and deletable memory.
8. Traces for version, latency, tokens, cost, safety, tools, retrieval, evals, and feedback without sensitive-payload leakage.
9. Per-run and per-tenant token, tool, retry, latency, and spend budgets.
10. Regression evals, canaries, rollback, degraded modes, and incident response for AI changes.

## Evals are not ordinary tests

Deterministic code tests and nondeterministic model evals are both required. An eval suite must identify its dataset, rubric, threshold, observed result, evaluator/config version, commit, environment, and time. The gate recomputes the threshold decision; a self-declared `passed` flag cannot override a failing score.

Safety suites include adversarial and negative cases, not only happy-path quality. Tool-using agents additionally need trajectory checks for forbidden sequences, budget overruns, repeated failures, approval bypass, and success reached by an unsafe path.

## Runtime rule

Native Codex or Claude goal/loop features may manage execution, but they are never finish-line authority. Valdris owns durable goal state, evidence gates, approval boundaries, and the final handoff. MCP and A2A are interoperability boundaries; neither is the canonical goal database.

## Commands

```bash
npm run ai:gate
npm run eval:gate
npm run trajectory:gate
npm run waiver:gate
npm run enterprise-ai:gate
```

See `research/enterprise-ai-2026/genai-assurance.md` for the primary-source research and `research/enterprise-ai-2026/agent-workflows.md` for runtime/protocol architecture.
