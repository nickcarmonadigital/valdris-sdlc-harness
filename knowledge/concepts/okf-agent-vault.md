---
type: Concept
title: OKF Agent Vault
description: Agent-readable markdown knowledge layer using OKF-style frontmatter, indexes, logs, and links.
resource: knowledge/index.md
tags: [okf, vault, markdown, obsidian, agents]
timestamp: 2026-07-04T00:00:00Z
---

# Definition

The agent vault is a small, navigable knowledge bundle over the repo. It gives Codex a first stop that is cheaper than reading every document and more stable than asking the user to repeat onboarding.

# Conventions

- `index.md` files provide progressive disclosure.
- `log.md` files record chronological knowledge changes.
- Concept files use YAML frontmatter with `type`, `title`, `description`, `resource`, `tags`, and `timestamp`.
- Links are bundle-relative when they point inside `knowledge/`.

# Maintenance

Update the vault whenever a repo change creates durable routing knowledge for future agents. Run:

```bash
npm run knowledge:gate
```

# Source Notes

See [OKF and LLM-Wiki Source Notes](/sources/okf-and-llm-wiki.md).
