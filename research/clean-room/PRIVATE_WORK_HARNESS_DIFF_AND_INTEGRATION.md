# Private Work Harness Diff and Universal Integration

Source: a restricted private work-harness snapshot. Its project content was inspected for behavioral comparison and was not imported.

## What changed materially

The restricted harness strengthens the prompt-library and master-flow enforcement pattern. The reusable behavior is:

```text
lane -> stage -> gate -> artifact -> finish-line validator -> answer contract
```

## What stays universal

These components generalize to any software team:

| Universal component | Why it generalizes |
|---|---|
| Root map | front door for agents |
| Context router | source-of-truth and lane routing |
| Workspace context | lane contracts |
| Stage folders | SDLC state machine |
| Run packet template | durable per-work artifact bundle |
| Proof, RCA, smoke, red-zone, and review gates | mechanical enforcement |
| Answer contract | consistent final answer shape |
| Code-intelligence integration pattern | code-graph grounding |
| ADR and self-heal pattern | durable decision and correction loop |
| Prompt-library pattern | anti-skip workflow invocation layer |

## What is project-specific

These facts belong in a commissioned project adapter and must not ship as universal defaults:

- company, product, and customer identities;
- named people, approvers, and permission assignments;
- branch names, workflow names, and deployment semantics;
- provider, account, environment, and tracker details;
- runtime maps, support taxonomies, and internal topology;
- personal response-style instructions;
- incident histories, customer identifiers, and live run packets.

## Universal split

```text
universal-harness-core/
  gates/
  lane templates/
  run packet schema/
  prompt library templates/
  answer contract schema/
  code-intelligence adapter/
  adr/self-heal schema/

project-adapter/
  project.yaml
  source_truth.yaml
  validation.yaml
  red_zone.yaml
  team_permissions.yaml
  generated docs/
  generated workspaces/
```

## Integration design

1. A commissioning interview collects team context that code intelligence cannot infer.
2. A code-intelligence scan fills topology, symbols, entrypoints, blast radius, and graph freshness.
3. The generator instantiates the universal core with a project adapter.
4. A coherence check proves the generated stages, gates, and documentation agree.
5. Prompt templates create project-specific master-flow prompts and anti-skip nudges.
6. Work tracking bootstraps lanes and cards without assuming a provider.
7. A finish-line validator blocks completion until the required gate artifacts exist.

## Product insight

The reusable behavior is a filesystem-native software-delivery control system for agents. Clean-room integration means reimplementing those behaviors behind Valdris-native schemas and gates while excluding private project content.
