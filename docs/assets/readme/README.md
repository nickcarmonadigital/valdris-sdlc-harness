# README visual sources

The public diagrams in this folder have two source types.

## Generated SVGs

Run:

```bash
npm run render:readme-visuals
npm run visuals:gate
```

The generator in `scripts/render-readme-visuals.mjs` owns:

- `request-routing-eight-skill-map.svg`
- `work-lanes-map.svg`
- `assurance-model.svg`
- `valdris-proof-to-done-flow.svg`
- `runtime-connectivity-event-flow.svg`
- `trust-model.svg`
- the older supporting repository, commissioning, monitor, and pack maps

When routing, skills, lane families, assurance domains, runtime contracts, or
trust rules change, update the generator first and regenerate every SVG.

## Curated assets

- `valdris-complete-system-map.svg` is the editable whole-harness overview.
- `valdris-durable-goal-routing-loop.png` explains durable goal control.

Before changing or replacing a curated asset, verify its labels against:

- `skills/registry.json`
- `controls/production-layers.v2.json`
- `controls/workload-taxonomy.v1.json`
- `docs/GOAL_LOOP_AND_SKILL_ROUTER.md`
- `docs/LAYER_ZERO_AND_ASSURANCE_TAXONOMY.md`
- `docs/V09_AUTHORITATIVE_ASSURANCE.md`

Do not publish a diagram that turns Layer 0 into domain 14, replaces the
canonical thirteen production domains with another control taxonomy, merges
workflow skills with commissioned lanes, or implies that human approval can
replace failed technical proof.
