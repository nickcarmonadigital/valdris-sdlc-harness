---
name: valdris-genai-assurance
description: Apply production assurance to AI, agent, RAG, model, prompt, tool, memory, and multimodal changes. Select as the primary when the requested outcome is AI assurance, evaluation, safety, model/prompt/provider behavior, RAG quality, or agent/tool governance. Use as a supporting lane when a feature or platform change merely includes AI; do not replace the main delivery skill for an otherwise product-focused build.
---

# Valdris GenAI Assurance

Treat GenAI as a cross-cutting assurance pack over the 13 production layers.

1. Inventory models, providers, prompts, tools, skills, datasets, retrieval corpora, memory, and runtime versions.
2. Define deterministic tests plus eval datasets, rubrics, thresholds, and owners for nondeterministic behavior.
3. Test grounding, citations, retrieval authorization, tenant isolation, stale sources, and deletion propagation when RAG is used.
4. Test prompt injection, jailbreaks, unsafe tool use, excessive agency, sensitive disclosure, and fallback behavior.
5. Enforce least-privilege tools, sandbox/network boundaries, budgets, retry ceilings, and human approval for consequential actions.
6. Record trajectory, model/tool latency, tokens, cost, safety results, and user feedback without logging secrets or private content.
7. Require canary/shadow evidence and a model/prompt/provider rollback path before production promotion.
8. Write `ai/assurance.json` and run the AI assurance gate.

For games or youth-facing products, also cover age-appropriate content, moderation, hidden-state confidentiality, age-rating/privacy implications, and whether the model can affect purchases, progression, social features, or player safety. Activate the relevant domain pack rather than treating these as generic prompt-quality concerns.

A demo or one successful response is not production proof.
