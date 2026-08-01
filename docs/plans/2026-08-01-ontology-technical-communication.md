# Ontology-Grounded Technical Communication Implementation Plan

**Status:** Final design after operator correction

## Goal

Make ontology-grounded terminology and controlled technical English the default authoring behavior for Valdris repository agents and commissioned agent front doors.

The behavior must follow this sequence for material naming decisions:

```text
inspect the subject and direct evidence
→ identify the applicable domain ontology
→ apply explicit category criteria
→ select the smallest defensible domain term
→ define the term plainly when needed
→ distinguish sourced facts from classification inference
→ state uncertainty instead of guessing
→ communicate the result directly
```

## Classification

Valdris is a **repository-level SDLC assurance harness for AI coding agents**.

Plain meaning:

> It installs repository controls, routes work, records coding-agent activity as structured evidence, checks required proof, and blocks completion when required checks or approvals are missing.

Qualified secondary role:

> Valdris acts as a repository-level policy and evidence control plane around external coding agents.

`Control plane` is not the lead public category. `Connector-first` is an internal integration characteristic.

## Design rules

1. The communication behavior governs agent speech and writing.
2. It is not an SDLC layer, production domain, lifecycle stage, skill, gate, connector node, product capability, or subsystem.
3. Routine communication does not require a classification record.
4. A material public, architectural, legal, safety, or standards naming decision can retain an evidence-backed classification record.
5. Agents inspect local evidence before external sources.
6. Agents open direct authoritative sources when local evidence cannot establish a decisive criterion or term status.
7. Sourced facts remain separate from classification inference.
8. Unsupported outcomes remain `uncertain` or `not_established`.
9. CI validates supplied records deterministically. CI does not make uncontrolled live web requests.
10. ASD-STE100 Issue 9 is the target authoring standard.
11. Formal conformance is not claimed unless the complete applicable writing rules and controlled dictionary have been checked for the output.

## Repository surfaces

### Canonical references

- `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md`
- `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md`
- `policies/technical-communication.v1.json`
- `knowledge/concepts/ontology-grounded-classification.md`

### Material classification evidence

- `classification/valdris-system-classification.v1.json`
- `classification/classification-record.template.json`
- `scripts/terminology-policy-lib.mjs`
- `scripts/classification-record-check.mjs`
- `scripts/verify-terminology-policy.mjs`

The checker is an optional record-quality tool. It is not a route or completion gate.

### Agent communication surfaces

- root `AGENTS.md`
- root `CLAUDE.md`
- generated pack `AGENTS.md`
- generated pack `CLAUDE.md`
- generated Claude command
- generated Codex prompt
- commissioned `project-adapter.json`

### Public surfaces

- `README.md`
- architecture and commissioning documentation
- deterministic README visual source and generated assets

## Required implementation

1. Preserve the canonical Valdris classification and direct-source register.
2. Configure `technicalCommunication` in commissioned adapters.
3. Propagate the same communication rules to all generated front doors.
4. Commission ontology sources, controlled vocabulary, qualified terms, source-escalation behavior, citation requirements, and the Issue 9 target profile.
5. Provide the classification template and checker only for material decisions that need an audit record.
6. Do not add terminology to route applicability, run packets, evidence namespaces, skill registries, or completion gates.
7. Lead the README with the supported Valdris category.
8. Preserve Matt Murphy/The Faction attribution for the source 13-layer T1 Foundation and production-readiness model.
9. Do not add a terminology component to architecture diagrams.
10. Update only visual wording that conflicts with the public classification.

## Verification

The final branch must prove:

1. the canonical policy and Valdris classification record are structurally valid;
2. unsupported decisive criteria trigger authoritative-source escalation or an uncertain outcome;
3. generated front doors contain the communication contract;
4. generated adapters use `technicalCommunication` and do not use `terminologyAssurance`;
5. routine generated routes do not contain a terminology gate or classification artifact;
6. generated package scripts and CI do not include `terminology:gate`;
7. the optional classification-record checker accepts the canonical record and rejects incomplete or unsupported records;
8. README wording, attribution, and generated visuals agree;
9. the full harness verifier passes;
10. independent reviewers find no blocking correctness, architecture, security, or claim-integrity defects.

## Delivery

1. Run formatting and all relevant verification commands.
2. Run independent review against the final diff.
3. Fix all blocking findings.
4. Re-run verification at the exact final commit.
5. Push `codex/ontology-ste-assurance`.
6. Open a pull request targeting `main`.
7. Report the PR URL and exact verification evidence.
