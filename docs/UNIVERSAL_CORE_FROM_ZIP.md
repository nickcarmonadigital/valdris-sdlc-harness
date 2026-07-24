# Universal Core From The Uploaded Harness Zip

## Bottom line

The universal value of the uploaded zip is the **agentic SDLC operating model**. Keep the structure, gates, run packets, front doors, and answer contracts. Move product names, deployment rules, team owners, validation commands, and red-zone specifics into a generated project adapter.

## Keep in the universal core

1. **Commissioning interview**
   - Ask the human/operator for facts a code graph cannot infer.
   - Capture source-of-truth order, approval owners, answer style, production definition, Red Zone boundaries, and validation expectations.

2. **Project adapter schema**
   - Store generated repo/team facts in `project-adapter.json` and `project.yaml`.
   - Agents read this before touching code.

3. **Agent front doors**
   - Generate `AGENTS.md` for Codex and general coding agents.
   - Generate `CLAUDE.md` or slash-command templates for Claude Code.
   - Keep the front doors thin: point to the adapter, router, lanes, gates, and run packet.

4. **Router and lanes**
   - Keep `00_MAP.md` and `CONTEXT.md` as the default map/router pattern.
   - Generate only the lanes a repo needs.
   - Default lane set: engineering-default, incidents, data, infra/provider-config, security, docs-product.

5. **Stage flow**
   - Current v0.8 execution sequence:
     ```text
     intake -> workload classification + Layer 0 -> route -> code intelligence + design -> implement -> Red Zone -> QA -> prove -> live smoke -> self-heal -> signed review -> run packet -> handoff
     ```
   - Every stage either writes an artifact or validates one.

6. **Run packet model**
   - Keep a durable folder/file structure for every non-trivial run.
   - Required artifact families:
     - `run/intake.json`
     - `run/workload-classification.json`
     - `run/route.json`
     - `foundation/assessment.json`
     - `goal/goal.json`
     - `context/manifest.json`
     - `ai/assurance.json`
     - `domain/assurance.json`
     - `evals/results.json` plus its typed context-arm result files
     - `trajectory/trajectory.json`
     - `waivers/waivers.json`
     - `design/anchors.json`
     - `session/events.jsonl`
     - `approvals/redzone.json`
     - `proof/proof.json`
     - `proof/portable.json`
     - `rca/rca.json` when corrective-work RCA is required or supplied
     - `review/review.json` using the signed four-role `valdris.review.v2` contract
     - `run/packet.json` using `valdris.run-packet.v3` with an explicit assurance level and catalog snapshots; v2 is historical structural evidence only
     - `handoff/final.md`

7. **Mechanical gates**
   - Proof gate: no proof artifact, no done.
   - Layer 0 gate: no workload classification and required foundation assurance, no implementation.
   - Red Zone gate: no explicit approval, no risky mutation.
   - RCA gate: no runtime evidence, no confirmed cause claim.
   - Anchor gate: no fresh code anchors, no architecture claim.
   - Enterprise/AI aggregate gate: no coherent goal, context, control, eval, trajectory, and waiver state, no completion.
   - Review and run-packet gates: no authorized four-role signature and digest-bound final packet, no completion.
   - Smoke/deploy/migration gates as optional project modules.

8. **Answer contract**
   - Final answers stay decision-packet shaped:
     - Bottom line
     - Why
     - Proof
     - Fix/Plan
     - Your call

9. **Connector event contract**
   - Agents emit events like:
     - `run.created`
     - `agent.connected`
     - `node.entered`
     - `gate.fired`
     - `artifact.written`
     - `approval.requested`
     - `run.blocked`
     - `run.completed`
   - The visualizer consumes events. The coding agent remains the editing surface.

10. **Context-quality evals**
    - Keep the A/B pattern that measures whether lane context improves agent answers.
    - Each commissioned repo gets its own cases and answer keys.
    - Executable mapping: `context/manifest.json.contextQuality` commissions the provider-neutral case/answer identities and improvement policy; the matching `evals/results.json` suite binds the exact manifest and proves paired baseline/candidate `uash.context-arm-result.v1` JSON documents through `uash.context-comparison.v1`. The gate derives each aggregate and critical-regression count from ordered per-case evidence, so detached declared scores cannot pass.

## Move into the generated project adapter

These must not live in the universal core:

| Adapter field                   | Why it is project-specific                                             |
| ------------------------------- | ---------------------------------------------------------------------- |
| Product/company names           | Different per repo/team                                                |
| Users/customers                 | Defines blast radius and UX expectations                               |
| Production definition           | Branch/deploy models differ wildly                                     |
| Merge/deploy owner              | Human authority differs by org                                         |
| Source-of-truth order           | Some teams trust GitHub first, others Linear/Jira/docs/live dashboards |
| Validation commands             | Every stack has different tests/build/evals                            |
| Safe edit paths                 | Depends on architecture and ownership                                  |
| Review-required paths           | Depends on auth/data/billing/infra surfaces                            |
| Red Zone actions                | Risk profile differs by product                                        |
| Answer style                    | Human preference differs                                               |
| Lane set                        | Repos need different work lanes                                        |
| GitNexus/code-intelligence path | Generated per repo snapshot                                            |

## Product rule

```text
Universal core = the rules of the operating system.
Project adapter = the local laws of this repo/team.
Agent connector = how Claude Code/Codex/Hermes obey the rules.
Run packet = the evidence that they did.
```

## Practical implementation in this repo

- `scripts/commission-harness.mjs` is the first local commissioning CLI.
- `docs/UNIVERSAL_COMMISSIONING_FLOW.md` describes the product flow.
- `templates/claude-code/commands/valdris-sdlc-harness.md` is the generic Claude Code slash-command template.
- `scripts/claude-code-bridge.mjs` and `scripts/uash-emit-event.mjs` implement the local event bridge.
