---
name: valdris-commission
description: Commission or refresh Valdris for a target repository from discovery through a committed, portable project pack. Select only when the requested outcome is harness installation, project-adapter creation, front-door setup, or commissioned-pack repair; do not select for ordinary product delivery inside an already commissioned repository.
---

# Valdris Commission

This skill owns the **Commissioning** system. Its job is to make a repository ready to enter the Valdris control plane. It does not route or implement product work.

## Deterministic flow

1. Confirm the target repository and keep all project-specific facts in its generated adapter. Do not add customer, company, provider, topology, credential, or private incident facts to the public Valdris core.
2. Inspect the target's existing `AGENTS.md`, `CLAUDE.md`, source-of-truth files, branch policy, validation commands, deployment boundaries, risk paths, and operator authority. Reuse stable answers from an existing commissioned pack.
3. For a fresh install, run the canonical commission command from the Valdris source:

   `npm run commission -- --repo <target> --project-name "<name>" --out <target>/.valdris-harness --yes`

   To refresh an existing pack, first verify that `.valdris-harness` is a reviewed, generated Valdris pack and preserve its stable commissioned answers. Then run the explicit replacement form:

   `npm run commission -- --repo <target> --project-name "<name>" --out <target>/.valdris-harness --yes --force`

   Never use `--force` on an unrecognized directory. Supply reviewed answers when conservative defaults would change scope, authority, architecture, or proof.

4. Review `.valdris-harness/commissioning-review.md`, `.valdris-harness/project-adapter.json`, and the bounded loaders added to target-root `AGENTS.md` and `CLAUDE.md`.
5. Verify the generated workflow and lifecycle registries, all fifteen generated skills, controls, scripts, trust-store placeholders, and portable paths. Run the commissioned portability verifier and the skill-registry, provenance, neutrality, and privacy gates.
6. Commission operator-owned review and authority keys outside agent reach. Never generate, trust, or approve an agent-owned key.
7. Commit the complete `.valdris-harness` directory and the two bounded root loaders before creating a route. Do not claim a portable or reviewable pack from an uncommitted tree.

## Completion criterion

Commissioning is complete only when:

- the target contains a reviewed and committed `.valdris-harness/project-adapter.json`;
- `.valdris-harness/commissioning-review.md` identifies no unresolved blocking answer;
- target-root `AGENTS.md` and `CLAUDE.md` discover the pack without overwriting unrelated instructions;
- `.valdris-harness/skills/registry.json`, `codex-routing.yaml`, all 8 work-type skills, and all 7 lifecycle skills pass `skill-registry-gate.mjs`;
- generated Codex and Claude mirrors are byte-identical to the commissioned canonical skills;
- portability, provenance, neutrality, and privacy checks pass.

If any item fails, remain in this skill and repair commissioning. Otherwise hand off to `$valdris-route-goal`.
