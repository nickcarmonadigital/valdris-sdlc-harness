# Ontology and Controlled Technical English Source Register

This register records the authoritative external sources used by the Valdris ontology-grounded terminology and controlled technical English policy.

**Access date:** 2026-08-01

## Evidence rules

- Inspect the direct repository, runtime, specification, or supplied artifact first.
- Use web research when local evidence and explicit class criteria do not fully support a classification.
- Read the source itself. A search-result snippet or generated summary is not evidence.
- Prefer standards bodies, official specifications, official project documentation, official source repositories, and peer-reviewed literature.
- Record sourced facts separately from Valdris classification inference.
- If evidence remains incomplete, use `uncertain` or `not established`. Do not select a larger term to hide the gap.

## Project attribution boundary

The README preserves the project's supplied attribution of the source model to Matt Murphy and The Faction. The external sources in this register do not independently establish that named attribution. The phrase “T1 Foundation” is a quoted source-model label. It is unrelated to the Valdris `T1` assurance tier, which means “Locally Verified.”

## Source register

### SRC-ASD-STE-HOME

- **Publisher:** ASD Simplified Technical English Maintenance Group (STEMG)
- **Title:** ASD-STE100 Home Page
- **URL:** https://www.asd-ste100.org/
- **Published/version date:** Issue 9, 2025-01-15
- **Source class:** formal standard owner / official operational website
- **Claims supported:**
  - ASD-STE100 is a controlled natural language and an international standard for technical documentation.
  - Issue 9 is dated 2025-01-15.
- **Limitations:** This source establishes ASD-STE100's status and scope. It does not establish that Valdris conforms to the standard.

### SRC-ASD-STE-ABOUT

- **Publisher:** ASD Simplified Technical English Maintenance Group (STEMG)
- **Title:** About ASD-STE100
- **URL:** https://www.asd-ste100.org/about.html
- **Publication date:** not stated on the page
- **Source class:** formal standard owner / official operational website
- **Claims supported:**
  - ASD-STE100 contains writing rules and a controlled-vocabulary dictionary.
  - The writing rules cover grammar and style.
  - The dictionary specifies approved general words.
  - The standard generally uses one word for one meaning and permits project-specific technical names and technical verbs under defined rules and categories.
- **Limitations:** Short sentences, a glossary, or one-term-per-meaning guidance alone do not prove formal conformance. Valdris selects Issue 9 as the target authoring standard but records conformance as `not_verified` unless the complete applicable official rules and controlled dictionary have been checked for the output.

### SRC-W3C-OWL-OVERVIEW

- **Publisher:** World Wide Web Consortium (W3C)
- **Title:** OWL 2 Web Ontology Language Document Overview (Second Edition)
- **URL:** https://www.w3.org/TR/owl2-overview/
- **Publication date:** 2012-12-11
- **Source class:** W3C Recommendation
- **Claims supported:**
  - Ontologies are formalized vocabularies of terms, often for a specific domain and community.
  - They define terms by describing relationships with other terms.
  - OWL ontologies can contain classes, properties, individuals, and data values.
- **Limitations:** Valdris does not require OWL serialization or claim OWL conformance. The source supports the meaning of ontology; the Valdris record format is a smaller operational representation.

### SRC-NIST-SSDF

- **Publisher:** National Institute of Standards and Technology (NIST)
- **Title:** SP 800-218, Secure Software Development Framework (SSDF) Version 1.1
- **URL:** https://csrc.nist.gov/pubs/sp/800/218/final
- **Publication date:** 2022-02-03
- **Source class:** government standard publication / official framework
- **Claims supported:**
  - Secure software-development practices can be integrated into each SDLC implementation.
  - The SSDF is a core set of high-level practices, not a complete product implementation.
  - A framework can provide a common vocabulary for software-development activities and supplier communication.
- **Limitations:** NIST does not define a product category named `repository-level SDLC assurance harness`. Valdris uses that phrase as a descriptive compound based on its observable mechanism and boundaries.

### SRC-K8S-COMPONENTS

- **Publisher:** Kubernetes project
- **Title:** Kubernetes Components
- **URL:** https://kubernetes.io/docs/concepts/overview/components/
- **Publication date:** not used; current documentation accessed 2026-08-01
- **Source class:** official project documentation
- **Claims supported:**
  - A Kubernetes cluster has a control plane and worker nodes.
  - Kubernetes control-plane components manage the overall state of the cluster.
  - The control plane includes interfaces, state storage, scheduling, and controllers.
- **Limitations:** This is a concrete control-plane example, not a universal standard definition. It supports the requirement that `control plane` must identify the state, resources, interfaces, and execution scope being controlled. It does not make every policy dashboard or connector a control plane.

### SRC-ANTHROPIC-CLAUDE-CODE

- **Publisher:** Anthropic
- **Title:** Claude Code overview
- **URL:** https://docs.anthropic.com/en/docs/claude-code/overview
- **Publication date:** not stated on the page
- **Source class:** official vendor documentation
- **Claims supported:**
  - Claude Code is an agentic coding tool.
  - It reads codebases, edits files, runs commands, and integrates with development tools.
- **Limitations:** Vendor documentation establishes Claude Code's execution responsibilities. It does not establish the category of Valdris.

### SRC-GITHUB-CODING-AGENT

- **Publisher:** GitHub
- **Title:** About GitHub Copilot cloud agent
- **URL:** https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- **Publication date:** not stated on the page
- **Source class:** official vendor documentation
- **Claims supported:**
  - A coding agent can research a repository, create a plan, make code changes on a branch, and optionally open a pull request.
  - GitHub distinguishes a cloud coding agent from local IDE agent mode.
- **Limitations:** This source describes one vendor's coding agent. It supports the external-agent execution boundary but does not define every coding agent or the Valdris category.

## Sourced facts versus Valdris inference

### Sourced facts

- ASD-STE100 is a formal controlled natural language with writing rules and a controlled dictionary.
- W3C describes ontologies as formalized domain vocabularies whose terms are defined through relationships.
- NIST describes SSDF as practices integrated into SDLC implementations and as a common vocabulary.
- Kubernetes uses `control plane` for components that manage cluster state and coordinate work.
- Anthropic and GitHub describe coding agents as tools that inspect repositories and perform implementation work.

### Valdris classification inference

No cited source defines `repository-level SDLC assurance harness for AI coding agents` as a formal standards class. Valdris selects it as an emerging descriptive compound because the repository commissions controls into target repositories, routes work, records agent activity as evidence, evaluates gates, and preserves run packets while an external coding agent performs implementation.

`Repository-level policy and evidence control plane around external coding agents` is a qualified secondary architectural description. It is not the lead product category.
