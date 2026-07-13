# Valdris Agent Knowledge Vault

This is the agent-facing OKF bundle for the Valdris SDLC Harness. Start here, choose the smallest relevant section, then open the linked concept or playbook.

# Systems

* [Valdris SDLC Harness](systems/valdris-sdlc-harness.md) - the product/control-plane system this repo implements.
* [Connector Event Runtime](systems/connector-event-runtime.md) - bridge, events, artifacts, approvals, and finish-line enforcement.

# Playbooks

* [Engineering Task Routing](playbooks/engineering-task-routing.md) - use for normal Codex engineering tasks.
* [GitNexus Code Intelligence](playbooks/gitnexus-code-intelligence.md) - use before codebase, architecture, debugging, refactor, or cross-file claims.
* [Production Readiness 13 Layers](playbooks/production-readiness-13-layers.md) - use when a task can affect production behavior.
* [Goal Loop and Skill Routing](playbooks/goal-loop-skill-routing.md) - turn a request into one primary skill, bounded checkpoints, and proof-bearing stopping conditions.
* [Generative AI Assurance](playbooks/genai-assurance.md) - use when models, prompts, retrieval, tools, memory, or agents affect behavior.

# Concepts

* [Proof-First Harness](concepts/proof-first-harness.md) - the core operating principle behind gates and final answers.
* [OKF Agent Vault](concepts/okf-agent-vault.md) - why this `knowledge/` folder exists and how agents should maintain it.
* [Typed Evidence](concepts/typed-evidence.md) - the control-level proof contract for enterprise and AI gates.

# Sources

* [OKF and LLM-Wiki Source Notes](sources/okf-and-llm-wiki.md) - source references behind the vault shape.
