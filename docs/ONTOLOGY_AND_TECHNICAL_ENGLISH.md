# Ontology-Grounded Terminology and Controlled Technical English

## Status

This document is the canonical Valdris policy for terminology selection, source verification, and controlled technical communication.

It governs how agents speak and write. It is not an SDLC layer, production domain, lifecycle stage, skill, gate, product capability, or subsystem. Every agent front door and commissioned project pack must apply it.

## Purpose

Use direct technical English for all technical and operational output. Use evidence and explicit class criteria when a material term must be selected. If local evidence is incomplete, verify the missing facts and class definitions with authoritative sources. Communicate the result with one stable term per meaning and explicit uncertainty.

## Exact terms

- **Ontology:** an explicit model of the kinds of things in a domain, their defining properties, and their relationships.
- **Taxonomy:** the category hierarchy within an ontology.
- **Classification:** assignment of a specific thing to the category whose defining properties it satisfies.
- **Terminology:** the selected word or phrase for that category.
- **Semantics:** the meaning carried by the selected term.
- **Controlled vocabulary:** the approved terms and meanings for a project or domain.
- **Schema:** the required structure of a record.
- **Knowledge graph:** actual entities and relationships represented as a graph.
- **Term status:** whether a term is standard, emerging, vendor-specific, internal, contested, or uncertain.

Ontology defines available kinds and their relationships. Taxonomy organizes categories. Classification applies criteria. Terminology names the result. Do not use these terms as synonyms.

## Material terminology procedure

Use this procedure for a material public, architectural, legal, safety, or standards naming decision. Routine communication does not require a classification record.

1. Inspect the direct source: repository, runtime, specification, documentation, or supplied artifact.
2. Describe the observable mechanism without using the proposed product label.
3. Record load-bearing capabilities, state, interfaces, authority, execution responsibilities, and exclusions.
4. Identify the applicable domain ontology and source.
5. List candidate categories and decisive criteria.
6. Bind every decisive criterion to evidence.
7. If local evidence does not fully support every decisive criterion, perform authoritative web verification.
8. Read each source directly and record its publisher, title, URL, date, supported claim, and limits.
9. Separate sourced facts from classification inference.
10. Select the smallest category that satisfies all decisive criteria.
11. Reject larger or fashionable terms whose criteria are not satisfied.
12. Select one stable term, define it plainly, and record its term status.
13. Preserve disputed facts, rejected alternatives, and unresolved uncertainty.

## Evidence escalation and web verification

Model familiarity, confidence, or repeated usage is not evidence.

Web verification is mandatory when any decisive property or class definition remains unsupported after direct local inspection.

Use sources in this order:

1. formal standards, specifications, regulators, and recognized standards bodies;
2. official vendor or project documentation and official source repositories;
3. peer-reviewed or otherwise authoritative domain literature;
4. reputable secondary sources for corroboration only.

Do not use these as evidence:

- search-result snippets;
- generated summaries without direct-source inspection;
- anonymous pages;
- unsourced marketing claims;
- a model's confidence score.

Corroborate a material claim when a primary source is unclear, self-interested, disputed, or does not define the applicable taxonomy.

If web access is blocked or the evidence remains incomplete:

- use `uncertain` or `not_established`;
- preserve the unresolved candidates;
- do not promote a provisional term to an established category;
- do not select a larger term to hide the evidence gap.

## Evidence states

- `established`: all decisive criteria are satisfied by bound evidence.
- `partially_supported`: some support exists, but at least one material point is incomplete.
- `unsupported`: available evidence does not support the claim.
- `contested`: authoritative sources or decisive evidence conflict.
- `uncertain`: the evidence cannot currently resolve the classification.
- `not_established`: no final category has been established.

Do not invent a numerical confidence score unless a separate method defines how to calculate it.

## Term status

- `standard`: a recognized standard or established domain source defines the term in the applicable sense.
- `emerging`: domain usage exists, but no stable formal definition controls the complete term.
- `vendor_specific`: a vendor defines or owns the term for its products or services.
- `internal`: Valdris or the commissioned project defines the term for internal use.
- `contested`: authoritative sources use or define the term incompatibly in the applicable context.
- `uncertain`: the term's status is not established.

A product name and a technical classification can differ. Branding does not prove a category.

## ASD-STE100 Issue 9 target authoring profile

Valdris uses ASD-STE100 Issue 9 as the target authoring standard for technical and operational communication:

1. Use one approved term for one meaning.
2. Define an unfamiliar term at first use.
3. Identify the actor when responsibility matters.
4. Use direct declarative sentences.
5. Keep each instruction to one primary action when practical.
6. Use concrete verbs and named artifacts.
7. Separate requirements, recommendations, facts, and inference.
8. Avoid unnecessary jargon, noun chains, metaphors, and analogies.
9. Qualify broad architecture terms with the resource and authority scope they control.
10. State uncertainty directly.

## Conformance boundary

ASD-STE100 is a formal controlled natural language with official writing rules and a controlled dictionary. Selecting Issue 9 as the target authoring standard does not prove that an output conforms to it.

Do not claim formal conformance unless the complete applicable Issue 9 writing rules and controlled dictionary have been checked for the output. Record the conformance status as `not_verified` until that check exists.

See `docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md` for direct sources and limitations.

## Classification-record use

A classification record is recommended for material naming decisions such as:

- a public product or system category;
- architecture terminology or responsibility boundaries;
- a taxonomy or controlled vocabulary;
- a claim derived from an external standard or framework;
- a term that the commissioned policy requires to be qualified.

The record is required only when the applicable publication, architecture, legal, safety, standards, or review process requires auditable evidence.

Routine communication, documentation edits, code changes, and instructions do not require a record. If they introduce or change a material classification, apply the preceding record policy.

## Classification record

Use schema `valdris.ontology-classification.v1`.

A valid record includes:

- observable mechanism;
- responsibility boundary;
- domain and ontology;
- candidate categories;
- decisive criteria and evidence references;
- local evidence inspected;
- web-verification trigger and state;
- source metadata;
- sourced facts and inference in separate fields;
- selected category and term when established;
- plain meaning and term status;
- rejected terms and uncertainty.

Structural validation does not prove semantic correctness. Human or authoritative review remains necessary where policy, legal, safety, or public-positioning consequences require it.

## Valdris controlled terminology

| Term                                                                             | Plain meaning                                                                                                                                                          | Status                                | Boundary                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| repository-level SDLC assurance harness for AI coding agents                     | Software that installs repository controls, routes work, records external coding-agent activity as evidence, checks required proof, and blocks unsupported completion. | emerging descriptive compound         | Primary public category; not a formal standards class.                                                   |
| repository-level policy and evidence control plane around external coding agents | The part that coordinates policy, run state, evidence, gates, and approvals around a defined repository workflow.                                                      | emerging qualified description         | Secondary description only; always state the controlled scope. The underlying `control plane` term is standard; this complete Valdris phrase is not. |
| connector-first                                                                  | Integration design that prioritizes normalized runtime events and artifacts.                                                                                           | Valdris internal                      | Do not use as the primary product category.                                                              |
| proof-first                                                                      | Operating principle that requires evidence before completion.                                                                                                          | Valdris internal                      | Do not imply that structural evidence alone is semantic or authoritative proof.                          |
| coding agent                                                                     | External tool that can inspect a repository and perform implementation work.                                                                                           | emerging domain term                  | Claude Code, Codex, Hermes, or another runtime performs implementation; Valdris is not the coding agent. |
| Layer 0                                                                          | Unnumbered foundation assurance that precedes production-domain evaluation.                                                                                            | Valdris internal                      | It is not Layer 14.                                                                                      |
| 13 production domains                                                            | Production-readiness assurance categories derived from the attributed source model.                                                                                    | Valdris taxonomy                      | They are not thirteen literal runtime layers.                                                            |

## Valdris classification

The repository's sourced classification record is `classification/valdris-system-classification.v1.json`.

Selected category:

> Valdris is a repository-level SDLC assurance harness for AI coding agents.

Plain meaning:

> It installs repository controls, routes work, records external coding-agent activity as evidence, checks required proof, and blocks unsupported completion.

Qualified secondary role:

> Valdris acts as a repository-level policy and evidence control plane around external coding agents.

## Record-check boundary

The classification-record check proves:

- required fields exist;
- evidence references resolve;
- decisive criteria have evidence;
- unsupported criteria trigger web verification;
- blocked or incomplete research fails closed;
- sourced facts and inference are separate;
- controlled terms and formal-conformance claims follow policy.

The check does not prove that an ontology or classification is semantically correct. Do not report structural validation as authoritative classification proof.
