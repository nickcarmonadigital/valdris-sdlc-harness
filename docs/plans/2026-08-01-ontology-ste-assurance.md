# Ontology-Grounded Classification and STE-Inspired Communication Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make ontology-grounded classification, authoritative-source escalation, and STE-inspired technical communication a documented, generated, structurally gated, adversarially tested cross-cutting practice in the Valdris SDLC Harness.

**Architecture:** Implement one canonical policy and one deep validation module. External coding agents inspect local evidence and perform web research when decisive properties remain unsupported. Valdris commissions the policy, records a classification decision, validates structural support, preserves it as typed evidence, and blocks unsupported completion where the route requires terminology assurance. The gate must distinguish structural validation from semantic or authoritative proof.

**Tech stack:** Node.js ESM scripts, JSON control catalogs and artifacts, existing commissioning generator, existing route/run-packet gates, Markdown front doors, deterministic SVG generation, GitNexus, npm verification scripts, GitHub Actions.

**Delivery:** Branch `codex/ontology-ste-assurance`; pull request targets `main`. Do not push directly to `main`.

---

## Fixed design decisions

1. This is a **cross-cutting assurance policy**, not Layer 14 and not a new optional skill.
2. Public description starts with the smallest supported category. `control plane` is secondary and qualified. `connector-first` remains internal integration wording.
3. Valdris is not the web-research agent. Claude Code, Codex, Hermes, or another external runtime performs retrieval. Valdris enforces the trigger, evidence record, uncertainty state, and finish-line behavior.
4. “100% knowledge” is operationalized as **full support from inspected evidence and explicit decisive criteria**. Model familiarity or confidence is not evidence.
5. Web verification is mandatory when local evidence does not support every decisive criterion.
6. Web sources must be read directly and recorded. Search snippets and generated summaries are not evidence.
7. Ordinary repository wording is `STE-inspired`. Formal ASD-STE100 compliance is prohibited unless the applicable official writing rules and controlled dictionary are implemented and proven.
8. Structural gates validate record shape, evidence binding, fail-closed states, and policy propagation. They do not claim semantic correctness.
9. A classification record is conditionally required for architecture naming, public product descriptions, taxonomy changes, external-framework claims, and terms identified as controlled or overloaded.
10. Routine code changes with no terminology claim do not require a classification record.

## Confirmed test seams

Tests exercise behavior through these repository interfaces:

1. `node scripts/terminology-gate.mjs --record <path> --policy <path>`
2. `node scripts/commission-harness.mjs ...` and the emitted project pack
3. `node scripts/route-request.mjs ...` and `run/route.json`
4. `node scripts/run-packet-gate.mjs ...` for conditional finish-line enforcement
5. `npm run terminology:gate`, `npm run verify:terminology`, `npm run verify:harness`, and `npm run verify:commissioned-portability`
6. `npm run visuals:gate` for deterministic README assets

---

## Task 0: Establish the exact branch and baseline

**Objective:** Ensure implementation is isolated from `main` and based on current public `origin/main`.

**Files:** No repository content changes.

**Steps:**

1. Fetch `origin/main`.
2. Verify local base and `git ls-remote` are identical.
3. Create `codex/ontology-ste-assurance` from that SHA in a dedicated worktree.
4. Verify an empty working tree.
5. Record the base SHA in the PR body and run packet.

**Verification:**

```bash
git rev-parse HEAD
git merge-base --is-ancestor origin/main HEAD
git status --short
```

Expected base: `5ad6e0eda8fec8717b959a22cd39fca837f29668` at plan creation.

---

## Task 1: Build the authoritative source register before freezing terms

**Objective:** Ground the policy and Valdris classification in direct authoritative sources.

**Files:**

- Create: `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md`
- Create: `classification/valdris-system-classification.v1.json`

**Required source classes:**

- Official ASD-STE100 source for the controlled-language and compliance boundary.
- Recognized standards/specifications or official domain documentation for lifecycle assurance and software-delivery terminology.
- Official technical definitions for architectural terms that remain in controlled vocabulary, including qualified `control plane` usage.
- Official documentation for the execution boundary of supported external coding agents where needed.

**Source register fields:**

- publisher
- document or page title
- URL
- publication/update date when available
- access date
- exact claim supported
- source class
- limitations

**Rules:**

- Read the source itself.
- Do not cite a search snippet.
- Separate sourced facts from Valdris classification inference.
- If a class lacks an authoritative published taxonomy, state that the selected term is a descriptive compound rather than pretending it is a formal standard class.

**Verification:**

- Every external claim in the classification record resolves to a source-register entry.
- Every URL is fetched successfully during implementation.
- No claim says ASD-STE100 compliant.

**Commit:**

```bash
git add docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md classification/valdris-system-classification.v1.json
git commit -m "docs: ground Valdris terminology in authoritative sources"
```

---

## Task 2: Define the canonical cross-cutting policy

**Objective:** Create one normative source for classification and communication behavior.

**Files:**

- Create: `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md`
- Create: `controls/terminology-policy.v1.json`
- Create: `knowledge/concepts/ontology-grounded-classification.md`
- Modify: `knowledge/index.md`
- Modify: `docs/LAYER_ZERO_AND_ASSURANCE_TAXONOMY.md`
- Modify: `docs/UNIVERSAL_COMMISSIONING_FLOW.md`
- Modify: `docs/ARCHITECTURE.md`

**Canonical procedure:**

```text
inspect direct mechanism and evidence
→ identify the applicable domain ontology
→ list candidate categories and decisive criteria
→ verify unsupported criteria with authoritative web sources
→ classify using the smallest supported category
→ select one stable term and define it plainly
→ label the term as standard, emerging, vendor-specific, internal, or uncertain
→ record sourced facts, inference, rejected terms, and unresolved uncertainty
```

**Controlled-language profile:**

- one approved term per meaning;
- define unfamiliar terms once;
- identify the actor and responsibility explicitly;
- use direct declarative sentences;
- avoid unnecessary noun chains, jargon, metaphors, and analogies;
- distinguish requirements from recommendations;
- qualify broad architecture terms;
- state uncertainty rather than expanding the label;
- call the policy STE-inspired, not formally ASD-STE100 compliant.

**Foundation integration:**

Add controls under the existing `product-domain` foundation capability; do not add a numbered layer:

- `FND-DOMAIN-002`: category and terminology decisions use observable properties, explicit criteria, and evidence.
- `FND-DOMAIN-003`: technical communication uses the commissioned controlled vocabulary and uncertainty rules.

**Knowledge node:**

The OKF knowledge node summarizes and points to the canonical policy. It must not duplicate or diverge from the normative procedure.

**Verification:**

```bash
npm run knowledge:gate
npm run catalog:gate
```

**Commit:**

```bash
git add docs controls/foundation-layer.v1.json knowledge
git commit -m "feat: define ontology and technical English policy"
```

---

## Task 3: Define the classification record and deep validation module

**Objective:** Provide one small interface that validates policy and classification records.

**Files:**

- Create: `classification/classification-record.template.json`
- Create: `scripts/terminology-policy-lib.mjs`
- Create: `scripts/terminology-gate.mjs`
- Create: `scripts/verify-terminology-policy.mjs`
- Modify: `package.json`

**Classification record contract:**

```json
{
  "schema": "valdris.ontology-classification.v1",
  "subject": {
    "name": "",
    "kind": "system|concept|term|architecture|product"
  },
  "observableMechanism": [],
  "responsibilityBoundary": {
    "owns": [],
    "doesNotOwn": []
  },
  "domain": "",
  "ontology": {
    "name": "",
    "sourceRefs": []
  },
  "candidateCategories": [],
  "classCriteria": [
    {
      "id": "",
      "description": "",
      "decisive": true,
      "status": "satisfied|not_satisfied|unknown|contested",
      "evidenceRefs": []
    }
  ],
  "localEvidenceInspected": true,
  "webVerification": {
    "required": false,
    "status": "not_required|completed|blocked|incomplete",
    "reason": ""
  },
  "evidence": [
    {
      "id": "",
      "origin": "local|web",
      "sourceType": "standard|official_specification|official_documentation|official_repository|peer_reviewed|reputable_secondary",
      "publisher": "",
      "title": "",
      "url": null,
      "repositoryPath": null,
      "revision": null,
      "accessedAt": "",
      "claim": ""
    }
  ],
  "sourcedFacts": [],
  "inferences": [],
  "selectedCategory": null,
  "selectedTerm": null,
  "plainMeaning": "",
  "termStatus": "standard|emerging|vendor_specific|internal|uncertain",
  "classificationStatus": "established|partially_supported|unsupported|contested|uncertain|not_established",
  "rejectedTerms": [],
  "uncertainties": []
}
```

**Validator invariants:**

1. Every decisive criterion has at least one valid evidence reference.
2. `classificationStatus=established` requires every decisive criterion to be `satisfied`.
3. Any unsupported, unknown, or contested decisive criterion makes web verification required.
4. Required web verification cannot be `not_required`.
5. `completed` web verification requires at least one direct web evidence record from an allowed authoritative source class.
6. Secondary-only evidence cannot establish a disputed or decisive class criterion.
7. `blocked` or `incomplete` research requires `uncertain` or `not_established`, unresolved alternatives, and no overconfident final category.
8. Sourced facts and inferences are separate arrays.
9. Search snippets, anonymous pages, and generated summaries are not allowed source types.
10. Formal ASD-STE100 compliance wording fails unless an explicit separately proven compliance profile is present; v1 provides no such profile.
11. Structural validation output states explicitly that it is not semantic proof.

**Public interface:**

```js
validateTerminologyPolicy(policy)
validateClassificationRecord(record, policy)
requiresWebVerification(record)
formatProblems(problems)
```

No caller should need to know validation internals.

**TDD order:**

1. valid locally established classification;
2. unknown decisive criterion forces web verification;
3. authoritative web evidence permits establishment;
4. secondary-only evidence fails;
5. blocked research fails closed;
6. sourced fact/inference collapse fails;
7. unproven ASD compliance claim fails;
8. malformed evidence references fail.

**Commands:**

```bash
node scripts/verify-terminology-policy.mjs
npm run terminology:gate
```

**Commit:**

```bash
git add classification scripts/terminology-* package.json
git commit -m "feat: add fail-closed terminology assurance gate"
```

---

## Task 4: Make the policy conditional in routes and binding at the finish line

**Objective:** Require classification evidence for applicable work without burdening routine implementation tasks.

**Files:**

- Modify: `scripts/route-request.mjs`
- Modify: `scripts/route-gate.mjs`
- Modify: `scripts/evidence-namespaces.mjs`
- Modify: `scripts/run-create.mjs`
- Modify: `scripts/run-packet-gate.mjs`
- Modify: `scripts/claude-code-bridge.mjs`
- Modify: `scripts/verify-routing-convergence.mjs`
- Modify: `scripts/verify-run-packet-trust.mjs`

**Route contract:**

Add a `terminology_assurance` object:

```json
{
  "required": true,
  "reason": "public product classification changed",
  "record_path": "classification/classification.json",
  "policy_version": "valdris.terminology-policy.v1"
}
```

**Required when work changes:**

- public product/system category;
- architecture naming or responsibility boundaries;
- taxonomy or controlled vocabulary;
- README, public docs, or generated agent instructions containing controlled terms;
- claims derived from an external framework or standard;
- a term identified as overloaded or restricted by commissioned policy.

**Not automatically required for:**

- routine bug fixes;
- dependency updates;
- implementation changes that do not alter terminology or public classification.

**Fail-closed behavior:**

- Required route + missing record: fail.
- Required route + invalid record: fail.
- Required route + unresolved research presented as established: fail.
- Required route + honest uncertain/not-established record: preserve uncertainty; completion can proceed only if the task did not require a resolved public term or a human explicitly accepts the unresolved state.

**Evidence namespace:**

Add a stable `classification` namespace and bind the record path and digest into the run packet.

**Connector behavior:**

Use existing `node.started`, `artifact.created`, `gate.passed/failed`, and `node.completed` events. Do not invent new connector event types. Use conditional node ID `ontology-classification` when the route requires it.

**Verification:**

- Positive route with valid record passes.
- Missing record fails.
- Tampered record digest fails.
- Routine bug route remains compatible.
- Historical packet compatibility remains structural-only and is not upgraded.

**Commit:**

```bash
git add scripts
git commit -m "feat: bind terminology assurance to routes and run packets"
```

---

## Task 5: Commission project-specific ontology and source policy

**Objective:** Generate the complete practice into every commissioned target repository.

**Files:**

- Modify: `scripts/commission-harness.mjs`
- Modify: `docs/COMMISSIONING_QUESTION_BANK.md`
- Modify: `scripts/verify-commissioned-portability.mjs`
- Modify: `scripts/verify-harness.mjs`

**Commissioning fields:**

- domain ontology or authoritative reference sources;
- existing glossary or controlled vocabulary;
- approved public category terms;
- internal/vendor-specific terms;
- overloaded or prohibited unqualified terms;
- authoritative web domains or source classes;
- network/research availability;
- citation requirements;
- technical communication profile.

**Generated adapter shape:**

```json
{
  "terminology_policy": {
    "policy_version": "valdris.terminology-policy.v1",
    "ontology_sources": [],
    "controlled_vocabulary": [],
    "qualified_terms": [],
    "restricted_unqualified_terms": [],
    "web_verification": {
      "required_when_local_evidence_incomplete": true,
      "primary_source_required_for_decisive_claims": true,
      "network_available": true,
      "blocked_behavior": "uncertain"
    }
  }
}
```

**Generated files:**

- `.valdris-harness/docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md`
- `.valdris-harness/controls/terminology-policy.v1.json`
- `.valdris-harness/classification/classification-record.template.json`
- `.valdris-harness/scripts/terminology-policy-lib.mjs`
- `.valdris-harness/scripts/terminology-gate.mjs`

**Generated front doors must state:**

- local evidence first;
- web verification when decisive support is incomplete;
- primary/authoritative source preference;
- facts separate from inference;
- uncertainty is preserved;
- STE-inspired, not formal ASD compliance;
- exact gate command.

**Verification:**

Generate a disposable fixture and inspect:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/commands/valdris-sdlc-harness.md`
- `docs/Codex Runtime Prompt.md`
- `project-adapter.json`
- generated policy, template, and gate files.

Run the generated gate inside the fixture with positive and negative records.

**Commit:**

```bash
git add scripts/commission-harness.mjs scripts/verify-commissioned-portability.mjs scripts/verify-harness.mjs docs/COMMISSIONING_QUESTION_BANK.md
git commit -m "feat: commission ontology and source-verification policy"
```

---

## Task 6: Update root front doors and all portable instruction surfaces

**Objective:** Ensure no agent path can miss the cross-cutting policy.

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `meta-skills/valdris-sdlc-harness/SKILL.md`
- Modify: all 15 `skills/*/SKILL.md`
- Modify: `skills/registry.json`
- Modify: `skills/codex-routing.yaml`
- Modify: `scripts/skill-registry-gate.mjs`
- Modify: `scripts/verify-lifecycle-skills.mjs`
- Modify: `templates/codex/valdris-sdlc-harness.md`

**Design:**

- Front doors contain the concise mandatory procedure.
- Skill files contain a short policy reference, not a duplicate full policy.
- Registry metadata carries a required policy reference for every skill.
- `skills:gate` fails if a skill omits or points away from the canonical policy.
- The policy is always-on and does not consume a primary/supporting skill slot.

**Root product description:**

Use the evidence-supported category in the first sentence. Keep a qualified secondary architectural role. Do not lead with `connector-first control plane`.

**Verification:**

```bash
npm run skills:gate
npm run verify:lifecycle-skills
npm run skills:install:codex
npm run skills:check:codex
```

Add negative fixtures that remove the policy reference from one lifecycle and one work-type skill; both must fail.

**Commit:**

```bash
git add AGENTS.md CLAUDE.md meta-skills skills scripts/skill-registry-gate.mjs scripts/verify-lifecycle-skills.mjs templates
git commit -m "docs: propagate classification policy to agent front doors"
```

---

## Task 7: Restructure README and public terminology

**Objective:** Make the README demonstrate mechanism-first classification and stable technical language.

**Files:**

- Modify: `README.md`
- Modify: `knowledge/systems/valdris-sdlc-harness.md`
- Modify: `docs/PRODUCT_DIRECTION.md`
- Modify: `docs/CLEAN_ROOM_NOTES.md`
- Modify: `app/docs/page.tsx`
- Modify only public-facing strings in other files found by the terminology inventory.

**README order:**

1. What Valdris is.
2. What it does in plain language.
3. What it does not do.
4. Mechanism and responsibility boundary.
5. Why the selected category fits.
6. Controlled terminology and term status.
7. Operating flow.
8. Assurance model and proof.
9. Maturity and proof boundary.
10. Installation and verification.

**Required positioning:**

- External coding agents write code.
- Valdris commissions controls, routes work, records structured evidence, evaluates gates, and preserves run packets.
- `control plane` appears only as a qualified secondary architectural role where accurate.
- `connector-first` is identified as internal integration wording, not the public product category.
- Matt Murphy/The Faction receive explicit attribution for the 13 Layers production-readiness model.
- Valdris ownership is limited to its software implementation around commissioning, routing, evidence, gates, approvals, telemetry, verification, and agent integration.

**Terminology table columns:**

- term
- plain meaning
- taxonomy/category
- domain status
- qualification or boundary

**Repository terminology lint:**

The gate scopes strict wording checks to public and instruction surfaces. Do not rename internal code identifiers such as `ControlPlaneApp` unless they leak into user-facing copy.

**Commit:**

```bash
git add README.md knowledge/systems docs app/docs/page.tsx
git commit -m "docs: classify Valdris from mechanism and evidence"
```

---

## Task 8: Add one classification visual and preserve valid operational diagrams

**Objective:** Teach the new procedure without replacing diagrams that already explain proof and routing correctly.

**Files:**

- Modify: `scripts/render-readme-visuals.mjs`
- Create: `docs/assets/readme/ontology-classification-flow.svg` through the renderer
- Modify: `docs/assets/readme/valdris-complete-system-map.svg` only if label changes are required
- Modify: `README.md`

**New visual sequence:**

```text
DIRECT EVIDENCE
mechanism · state · interfaces · authority · execution boundary
        ↓
DOMAIN ONTOLOGY
classes · defining properties · relationships
        ↓
CLASSIFICATION
candidate categories · decisive criteria · rejected terms
        ↓
SOURCE ESCALATION
local gaps → authoritative web sources → facts vs inference
        ↓
TERMINOLOGY
selected term · plain meaning · standard/emerging/vendor/internal/uncertain
        ↓
COMMUNICATION
one term per meaning · direct sentences · explicit uncertainty
```

**Keep:**

- proof-to-done flow;
- durable goal/routing loop;
- assurance model;
- generated-pack and connector diagrams that remain accurate.

**Verification:**

```bash
npm run visuals:render
npm run visuals:gate
```

Render the affected SVGs to PNG with headless Chromium and inspect readability at desktop and mobile widths.

**Commit:**

```bash
git add scripts/render-readme-visuals.mjs docs/assets/readme README.md
git commit -m "docs: add ontology classification proof visual"
```

---

## Task 9: Add adversarial end-to-end verification

**Objective:** Prove the policy fails closed and is present in actual generated packs.

**Files:**

- Modify: `scripts/verify-terminology-policy.mjs`
- Modify: `scripts/verify-harness.mjs`
- Modify: `scripts/verify-commissioned-portability.mjs`
- Modify: `scripts/verify-run-packet-trust.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Required negative cases:**

1. Missing ontology name/source.
2. Selected category with an unsatisfied decisive criterion.
3. Unknown criterion with `webVerification.required=false`.
4. Required web verification with no web evidence.
5. Search snippet or generated summary presented as a source.
6. Reputable-secondary-only evidence used for a decisive disputed claim.
7. Facts and inference collapsed into one unsourced assertion.
8. Blocked research followed by an `established` status.
9. Unqualified `control plane` on a controlled public surface.
10. `operating system` label without required system properties.
11. Formal ASD-STE100 compliance claim without the applicable official profile.
12. Missing policy from generated `AGENTS.md`.
13. Missing policy from generated `CLAUDE.md`.
14. Missing policy from generated Claude command.
15. Missing policy from generated Codex prompt.
16. Required route with missing classification artifact.
17. Classification artifact changed after its digest entered the run packet.
18. Skill registry entry missing canonical policy reference.

**Required positive cases:**

1. Locally established category with all decisive criteria evidenced.
2. Incomplete local evidence escalated to authoritative web sources.
3. Honest `uncertain` classification when network research is blocked.
4. Routine bug fix route without terminology assurance requirement.
5. Qualified secondary control-plane description.
6. Generated commissioned pack executes its own terminology gate.
7. Current Valdris classification record passes structurally while declaring that semantic correctness still requires review.

**CI commands:**

Add the new verifier to the normal gate chain and public instructions.

**Commit:**

```bash
git add scripts package.json .github/workflows/ci.yml
git commit -m "test: verify ontology and terminology assurance"
```

---

## Task 10: Run full verification and exact-head review

**Objective:** Establish local correctness, repository cleanliness, and review readiness.

**Commands:**

```bash
npm run typecheck
npm run dependency:audit
npm run format:check
npm run build
npm run knowledge:gate
npm run skills:gate
npm run catalog:gate
npm run provenance:gate
npm run neutrality:gate
npm run privacy:gate
npm run verify:release-privacy
npm run privacy:release
npm run schema:compat:gate
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:terminology
npm run terminology:gate
npm run verify:enterprise-ai
npm run verify:v09-assurance
npm run verify:run-packet-trust
npm run verify:work-harness-import
npm run verify:clean-room-convergence
npm run verify:commissioned-portability
npm run verify:harness
npm run verify:runtime-closure
npm run visuals:gate
npm run worktree:check
```

**Review lanes:**

1. Specification compliance.
2. Code and gate quality.
3. Terminology and source-quality review.
4. Generated-pack portability.
5. README and rendered-visual intent check.

Any implementation change after review invalidates the affected review and requires re-review.

**GitNexus:**

Re-index the exact implementation head and run impact/context checks for the policy module, commissioning generator, run packet, and skill gate.

**Final local proof:**

```bash
git status --short
git diff origin/main...HEAD --check
git log --oneline origin/main..HEAD
git rev-parse HEAD
```

---

## Task 11: Push branch and open the PR to `main`

**Objective:** Deliver a reviewable GitHub pull request without modifying `main` directly.

**Steps:**

1. Push `codex/ontology-ste-assurance`.
2. Verify remote branch SHA equals local `HEAD`.
3. Open a PR with base `main` and head `codex/ontology-ste-assurance`.
4. Include:
   - problem and classification;
   - authoritative-source boundary;
   - structural vs semantic proof boundary;
   - generated surfaces;
   - gate and negative-test matrix;
   - README/image changes;
   - Matt Murphy/The Faction attribution;
   - exact verification commands and results;
   - base and head SHAs.
5. Inspect GitHub Actions and review-bot findings.
6. Fix actionable findings on the PR branch and rerun exact-head verification.
7. Leave the PR open for review. Do not merge unless Nick separately authorizes merge.

**Commands:**

```bash
git push -u origin codex/ontology-ste-assurance
env -u GITHUB_TOKEN -u GH_TOKEN gh pr create \
  --repo nickcarmonadigital/valdris-sdlc-harness \
  --base main \
  --head codex/ontology-ste-assurance \
  --title "feat: add ontology and terminology assurance" \
  --body-file /tmp/valdris-ontology-ste-pr.md
```

**Remote proof:**

```bash
git rev-list --left-right --count origin/codex/ontology-ste-assurance...HEAD
git ls-remote origin refs/heads/codex/ontology-ste-assurance
env -u GITHUB_TOKEN -u GH_TOKEN gh pr view --json url,baseRefName,headRefName,headRefOid,statusCheckRollup,mergeStateStatus
```

Expected:

- base: `main`
- head: `codex/ontology-ste-assurance`
- remote head SHA equals local exact-head SHA
- PR remains open pending review/merge authorization

---

## Definition of done

The update is complete only when all statements below are true:

- [ ] Canonical policy exists and uses factual authoritative sources.
- [ ] Web verification is mandatory when local decisive evidence is incomplete.
- [ ] Source quality, facts/inference separation, and uncertainty are represented structurally.
- [ ] Formal ASD-STE100 compliance is not claimed.
- [ ] Valdris itself has a sourced classification record.
- [ ] Foundation controls include ontology and technical-communication requirements without adding Layer 14.
- [ ] Route and run-packet paths enforce conditional terminology assurance.
- [ ] Root and generated agent front doors include the same rule.
- [ ] All 15 skills point to the canonical policy, and the registry gate verifies it.
- [ ] README starts with mechanism-supported classification and accurate execution boundaries.
- [ ] Matt Murphy/The Faction attribution is explicit and ownership boundaries are accurate.
- [ ] Existing valid operational diagrams remain; one deterministic classification visual is added.
- [ ] Adversarial negative cases fail for the intended reasons.
- [ ] Full repository verification passes at the exact final head.
- [ ] Working tree is clean.
- [ ] Branch is pushed.
- [ ] Pull request targets `main`.
- [ ] PR checks and review findings are reported honestly.
