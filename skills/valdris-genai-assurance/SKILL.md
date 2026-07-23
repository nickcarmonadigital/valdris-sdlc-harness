---
name: valdris-genai-assurance
description: Apply production assurance to AI, agent, RAG, model, prompt, tool, memory, and multimodal changes. Select as the primary when the requested outcome is AI assurance, evaluation, safety, model/prompt/provider behavior, RAG quality, or agent/tool governance. Use as a supporting lane when a feature or platform change merely includes AI; do not replace the main delivery skill for an otherwise product-focused build.
---

# Valdris GenAI Assurance

Treat GenAI as a cross-cutting assurance pack over the 13 production layers.

1. Validate the authorized intake, deterministic classification, route, code-intelligence packet, and route-required Layer 0 foundation assessment before changing or assuring AI behavior.
2. Inventory and digest models, providers, prompts, tools, skills, datasets, retrieval corpora, memory policy, eval plan, smoke tests, and observability policy in `uash.ai-workload-identity.v1`. Runtime selection must bind that identity; substituting a model, provider, prompt, tool set, corpus, or memory policy starts a new reviewed identity.
3. Define deterministic tests plus eval datasets, rubrics, thresholds, and owners for nondeterministic behavior. Mark every evaluator as `deterministic` or `model`; model judges additionally require an unexpired independent `uash.model-judge-calibration.v1` bound to human labels and critical-slice agreement/error limits.
4. Test grounding, citations, retrieval authorization, tenant isolation, stale sources, and deletion propagation when RAG is used.
5. Test prompt injection, jailbreaks, unsafe tool use, excessive agency, sensitive disclosure, and fallback behavior.
6. Enforce `valdris.tool-registry.v1`, observed call receipts, durable memory-head receipts, least-privilege scopes, sandbox/network boundaries, deterministic execution budgets, retry ceilings, and human approval for consequential actions.
7. Record trajectory, exact observable trace bytes, decision evidence, model/tool latency, tokens, calls, retry waste, spend, human review, and tenant attribution in the trace-v2 and economics contracts without logging secrets, private content, or private chain-of-thought.
8. Require canary/shadow evidence and a model/prompt/provider rollback path before production promotion.
9. For semantic or authoritative claims, derive effective tiers and workload profiles from immutable routing, require owner-commissioned thresholds, versioned semantic adapters, a runtime-driver/implementation receipt, a signed runtime-conformance receipt, exact context-budget reconciliation, durable memory continuity, complete declared MCP/A2A transcripts, and eval/trajectory/smoke results bound to the risk-derived plan. Authoritative model-routing, trace-v2, usage, memory-head, and implementation receipts must bind their provider, policy, lifecycle, identity, counts, cost, currency, and session fields.
10. Write `ai/assurance.json` and run every route-required AI, eval, production, trajectory, smoke, domain, and authoritative-assurance gate.

For games or youth-facing products, also cover age-appropriate content, moderation, hidden-state confidentiality, age-rating/privacy implications, and whether the model can affect purchases, progression, social features, or player safety. Activate the relevant domain pack rather than treating these as generic prompt-quality concerns.

A demo or one successful response is not production proof.
