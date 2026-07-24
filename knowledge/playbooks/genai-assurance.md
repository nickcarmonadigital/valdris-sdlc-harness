---
type: Playbook
title: Generative AI Assurance
description: Activate cross-cutting controls for models, prompts, RAG, tools, memory, agents, evals, and AI lifecycle risk.
resource: controls/genai-assurance.v1.json
tags: [ai, genai, rag, agents, evals, safety]
timestamp: 2026-07-12T00:00:00.000Z
---

# Detect

AI assurance applies when a model, provider, prompt, embedding, retrieval corpus, AI tool, AI memory, or agent can affect workload behavior.

# Route

Use `valdris-genai-assurance` as primary for AI-centered work or supporting for an AI-bearing feature, security audit, architecture change, or release.

# Prove

Write `ai/assurance.json`, set `rag`, `tools`, and `memory` feature flags explicitly, and prove all active catalog controls. Also write and validate `evals/results.json` and `trajectory/trajectory.json`.

# Red Zone

Human approval remains required for consequential tools, sensitive AI data, provider/model production promotion, weakened safety policy, destructive corpus/memory changes, and production rollout or rollback.

# Finish

Run `node scripts/enterprise-ai-gate-all.mjs --repo .`. Runtime-native completion is advisory until Valdris gates and approvals pass.

# Related

- [Goal Loop and Skill Routing](/playbooks/goal-loop-skill-routing.md)
- [Typed Evidence](/concepts/typed-evidence.md)
