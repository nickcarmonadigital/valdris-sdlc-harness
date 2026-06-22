# Prompt Library Integration — Universal Anti-Skip Flow Enforcement

Source: latest uploaded harness zip `/root/.hermes/cache/documents/doc_625c778a47b8_agentic-sdlc-harness-main (3).zip`, file `references/Prompt Library.md`.

## Bottom line

The new Prompt Library is the missing enforcement layer. It converts the harness from “good instructions” into an **artifact-gated workflow**.

> A run is not complete because an agent says it is complete. A run is complete only when required gate artifacts exist and pass.

## Core rule to universalize

In the Utari harness, the prompt library names these gate artifacts:

| Gate | Required artifact |
|---|---|
| RCA / cause proof | `rca/rca.json` |
| Validation proof | `proof/proof.json` |
| Code/design anchoring | `design/anchors.json` |
| Live deployed behavior | `smoke/smoke_proof.json` |
| Harness contradiction | `correction/<slug>` PR / correction artifact |

Universal platform translation:

```text
Workflow claim -> required gate set -> artifact paths -> validator -> final answer allowed
```

If a required artifact is missing, the platform marks the run as **skipped gate**, not done.

## Universal Master Flow

The Prompt Library’s Master Flow becomes a configurable universal workflow template:

1. **Preflight** — verify repo freshness/source-of-truth before code claims.
2. **Route** — pick lane + work type.
3. **Evidence-first investigation** — runtime/logs/live state before root cause claims.
4. **Feature design** — grill/spec/ADR for hard-to-reverse decisions.
5. **Acceptance-first plan** — red baseline before fix.
6. **Red Zone classification** — stop before destructive/high-risk actions.
7. **Validation** — proof gate, evals, smoke gate, finish-line gate.
8. **Self-heal** — correction when harness docs conflict with primary evidence.
9. **Answer Contract** — bottom line, why, proof, fix, user call, fired gates + paths.

## Product requirements

### 1. Run packet validator

The platform must compute required artifacts from the lane/work type/change type.

Example:

```yaml
required_artifacts:
  behavioral_bug:
    - rca/rca.json
    - proof/proof.json
  feature_with_code_anchors:
    - design/anchors.json
    - proof/baseline.json
    - proof/proof.json
  deploy:
    - deploy/deploy_proof.json
    - smoke/smoke_proof.json
```

### 2. Final-answer blocker

The final answer UI/agent wrapper should block or warn when the agent says done but required artifacts are missing.

```text
Cannot mark done:
- missing proof/proof.json
- smoke required but smoke/smoke_proof.json missing
- Red Zone action detected without approval artifact
```

### 3. Anti-skip nudge library

The L1–L12 anti-skip nudges become platform-level remediation buttons:

| Nudge | Platform action |
|---|---|
| Cause without evidence | Reopen RCA stage and require runtime evidence |
| No proof | Run proof gate / mark blocked |
| Skipped preflight | Run freshness/source-of-truth check |
| No Red Zone classification | Run redzone gate and request approval |
| Ignored contradiction | Open correction workflow |
| No lane | Force route/classification stage |
| No live smoke | Require smoke gate for deployed change |
| No red baseline | Reopen acceptance-first planning |
| Process narration | Convert final to Answer Contract |
| Unbacked neighbor-path claim | Require pinned source citation |
| No artifacts at end | Fail finish-line validator |
| Prod not verified | Require prod deploy verification/watch window |

### 4. Prompt packs per lane

Prompt Library sections become generated prompt packs:

- orient/classify
- RCA/evidence-first
- design/ADR
- implementation/red baseline
- validation/proof/smoke
- ship/deploy/promote
- operate/watch
- Graphify queries
- self-heal/correction
- lane full-flow prompts

### 5. Commissioning interview addition

During harness commissioning, ask:

- What artifacts prove RCA?
- What artifacts prove tests/validation?
- What artifacts prove deployment behavior?
- What actions require Red Zone approval?
- What source-of-truth must be quoted in preflight?
- What is the final Answer Contract style?

## Clean-room implementation note

Do not hard-code Utari terms. Universalize by replacing Utari-specific fields with project config:

```yaml
project:
  name: Example
lanes:
  - engineering-default
  - incidents
source_truth:
  branch_model_ref: .github/workflows
red_zone:
  - production_deploy
  - secrets
  - billing
artifacts:
  rca: rca/rca.json
  proof: proof/proof.json
  smoke: smoke/smoke_proof.json
```
