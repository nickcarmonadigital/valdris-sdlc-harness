# Valdris SDLC Harness — Mermaid Maps

These diagrams are the **repo operating map**, not a raw import graph.

A raw diagram with every file would turn into spaghetti. These maps keep the repo readable by grouping files by responsibility, lane, gate, artifact, and runtime boundary.

## How to read the maps

| Term | Meaning |
|---|---|
| **Lane** | Type of work routed through the harness: bug, feature, cloud, security, incident, QA, etc. |
| **Stage** | Step inside the work: intake, route, design, implement, prove, handoff. |
| **Gate** | Blocking verification check: proof, Red Zone, smoke, finish-line, self-heal. |
| **Layer** | Production-readiness dimension: frontend, backend, DB, auth, cloud, observability, recovery, etc. |
| **Artifact** | Evidence file proving the stage/gate happened. |

> Mode note: these are **Blueprint** diagrams. A real **Live Run** requires connector events from Claude Code, Codex, Hermes, MCP/API/CLI emitters, or watched artifacts.

---

## 1. Whole repo operating map

![Whole repo operating map](assets/mermaid/whole-repo-operating-map.svg)

<details>
<summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef front fill:#082f49,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
  classDef app fill:#111827,stroke:#60a5fa,color:#dbeafe,stroke-width:2px
  classDef docs fill:#172554,stroke:#818cf8,color:#e0e7ff,stroke-width:2px
  classDef gen fill:#422006,stroke:#f59e0b,color:#fffbeb,stroke-width:2px
  classDef runtime fill:#134e4a,stroke:#2dd4bf,color:#ccfbf1,stroke-width:2px
  classDef gate fill:#4c0519,stroke:#fb7185,color:#ffe4e6,stroke-width:2px
  classDef evidence fill:#052e16,stroke:#22c55e,color:#dcfce7,stroke-width:2px

  subgraph FD["Front doors"]
    README["README.md"]
    AGENTS["AGENTS.md"]
    CLAUDE["CLAUDE.md"]
  end

  subgraph DOCS["Operating docs and contracts"]
    ARCH["docs/ARCHITECTURE.md"]
    CONTRACT["docs/CONNECTOR_EVENT_CONTRACT.md"]
    LANES["docs/SDLC_LANE_TAXONOMY.md"]
    MODES["docs/MODES_BLUEPRINT_LIVE_REPLAY.md"]
    PROD["docs/PRODUCTION_READINESS_LAYER_PACK.md"]
    PROOF["docs/ENTERPRISE_PROOF_BANK.md"]
    OI["docs/OPERATING_INTELLIGENCE_LAYER.md"]
    TESTDAY["docs/TEST_DAY_ACCEPTANCE_GATES.md"]
    MAP["docs/HARNESS_REPO_MAP.md"]
  end

  subgraph APP["Visual control-plane app"]
    ROUTES["app/"]
    COMPONENTS["components/"]
    LIB["lib/"]
    API["app/api/runs/demo/events"]
  end

  subgraph COMMISSION["Commissioning generator"]
    COMMISSION_SCRIPT["scripts/commission-harness.mjs"]
    TEMPLATES["templates/"]
    GENERATED["generated harness pack"]
  end

  subgraph RUNTIME["Runtime connector layer"]
    BRIDGE["scripts/claude-code-bridge.mjs"]
    EMITTER["scripts/uash-emit-event.mjs"]
    SIM["scripts/simulate-agent-run.mjs"]
  end

  subgraph GRAPHIFY["Repo intelligence and anchors"]
    SCAN["scripts/code-intelligence-scan.mjs"]
    GITNEXUS["graph/gitnexus.json"]
    GRAPH_GATE["scripts/graphify-gate.mjs"]
    ANCHOR_GATE["scripts/anchor-gate.mjs"]
    GRAPH["graph/graph.json"]
    ANCHORS["design/anchors.json"]
  end

  subgraph GATES["Verification and finish-line gates"]
    VERIFY["scripts/verify-harness.mjs"]
    PROOF["proof/proof.json"]
    SMOKE["smoke/smoke_proof.json"]
    REDZONE["approvals/redzone.json"]
    SELFHEAL["self_heal/self_heal_report.md"]
  end

  subgraph RUNS["Run packets and evidence"]
    RUN_TEMPLATE["runs/_run-template/"]
    EVENTS["session/events.jsonl"]
    HANDOFF["handoff/final.md"]
  end

  FD --> DOCS
  FD --> COMMISSION_SCRIPT
  DOCS --> COMMISSION_SCRIPT
  TEMPLATES --> COMMISSION_SCRIPT
  COMMISSION_SCRIPT --> GENERATED

  GENERATED --> AGENTS
  GENERATED --> CLAUDE
  GENERATED --> RUN_TEMPLATE
  GENERATED --> RUNTIME

  EMITTER --> BRIDGE
  SIM --> BRIDGE
  BRIDGE --> EVENTS

  SCAN --> GRAPH
  SCAN --> ANCHORS
  GRAPH --> GRAPH_GATE
  ANCHORS --> ANCHOR_GATE

  GRAPHIFY --> GATES
  EVENTS --> GATES
  VERIFY --> GATES

  GATES --> HANDOFF
  GATES --> SELFHEAL

  ROUTES --> COMPONENTS
  COMPONENTS --> LIB
  API --> APP
  EVENTS --> APP
  GRAPH --> APP
  GATES --> APP

  class README,AGENTS,CLAUDE front
  class ROUTES,COMPONENTS,LIB,API app
  class ARCH,CONTRACT,LANES,MODES,PROD,MAP docs
  class COMMISSION_SCRIPT,TEMPLATES,GENERATED gen
  class BRIDGE,EMITTER,SIM runtime
  class VERIFY,PROOF,SMOKE,REDZONE,SELFHEAL,GRAPH_GATE,ANCHOR_GATE gate
  class RUN_TEMPLATE,EVENTS,HANDOFF,GRAPH,ANCHORS evidence
```

</details>

---

## 2. Universal core vs project adapter

This is the public product shape: universal harness logic stays reusable, while each repo gets a generated adapter.

![Universal core vs project adapter](assets/mermaid/universal-core-vs-project-adapter.svg)

<details>
<summary>Mermaid source</summary>

```mermaid
flowchart LR
  classDef universal fill:#082f49,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
  classDef adapter fill:#422006,stroke:#f59e0b,color:#fffbeb,stroke-width:2px
  classDef repo fill:#052e16,stroke:#22c55e,color:#dcfce7,stroke-width:2px
  classDef gate fill:#4c0519,stroke:#fb7185,color:#ffe4e6,stroke-width:2px

  USER["team or operator"] --> INTERVIEW["commissioning interview"]
  REPO["target repository"] --> SCAN["GitNexus code-intelligence index"]

  subgraph CORE["Universal core"]
    SCHEMA["adapter schema"]
    LANES["lane taxonomy"]
    STAGES["canonical stage flow"]
    EVENTS["connector event contract"]
    GATES["proof and approval gates"]
    MONITOR["visual flow monitor"]
  end

  subgraph ADAPTER["Generated project adapter"]
    TRUTH["source-of-truth order"]
    COMMANDS["validation commands"]
    REDZONE["Red Zone owners"]
    ENABLED["enabled lanes"]
    STYLE["answer and handoff style"]
  end

  subgraph TARGET["Project-specific harness pack"]
    A["AGENTS.md"]
    C["CLAUDE.md"]
    CMD["Claude slash command"]
    CODEX["Codex runtime prompt"]
    RUNS["run packet template"]
  end

  INTERVIEW --> CORE
  SCAN --> CORE
  CORE --> ADAPTER
  ADAPTER --> TARGET
  TARGET --> AGENTRUN["Claude Code / Codex / Hermes run"]
  AGENTRUN --> GATES
  GATES --> HANDOFF["proof-backed handoff"]

  class SCHEMA,LANES,STAGES,EVENTS,GATES,MONITOR universal
  class TRUTH,COMMANDS,REDZONE,ENABLED,STYLE adapter
  class A,C,CMD,CODEX,RUNS,TARGET repo
  class GATES,HANDOFF gate
```

</details>

---

## 3. Work lanes map

These are the lanes people should see first when asking, “where does my work go?”

![Work lanes map](assets/mermaid/work-lanes-map.svg)

<details>
<summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef orient fill:#082f49,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
  classDef lane fill:#111827,stroke:#64748b,color:#e5e7eb,stroke-width:1.5px
  classDef core fill:#172554,stroke:#818cf8,color:#e0e7ff,stroke-width:2px
  classDef gate fill:#4c0519,stroke:#fb7185,color:#ffe4e6,stroke-width:2px
  classDef artifact fill:#052e16,stroke:#22c55e,color:#dcfce7,stroke-width:2px

  FD["Front doors: AGENTS.md / CLAUDE.md / Codex prompt"] --> ORIENT["Orient and route: 00_MAP / CONTEXT / project adapter"]
  ORIENT --> CLASSIFY["Lane classification"]

  subgraph LANES["Generated work lanes"]
    ENG["engineering-default"]
    DESIGN["system-design"]
    PROD["production-readiness"]
    CLOUD["cloud-platform"]
    QA["qa-release"]
    INCIDENT["incidents"]
    DOCS["docs-product"]
    INFRA["infra"]
    DATA["data"]
    SECURITY["security"]
    RUNTIME["agent-runtime"]
    SUPPORT["support-triage"]
    PROVIDER["provider-config"]
    VOICE["voice-vapi"]
    RAG["rag-kb-evals"]
  end

  CLASSIFY --> ENG
  CLASSIFY --> DESIGN
  CLASSIFY --> PROD
  CLASSIFY --> CLOUD
  CLASSIFY --> QA
  CLASSIFY --> INCIDENT
  CLASSIFY --> DOCS
  CLASSIFY --> INFRA
  CLASSIFY --> DATA
  CLASSIFY --> SECURITY
  CLASSIFY --> RUNTIME
  CLASSIFY --> SUPPORT
  CLASSIFY --> PROVIDER
  CLASSIFY --> VOICE
  CLASSIFY --> RAG

  LANES --> STAGES["Shared stage flow: intake → route → graphify → design anchors → implement → validate → handoff"]
  STAGES --> GATES["Shared gates: RCA / anchor / Red Zone / proof / smoke / finish-line / self-heal"]
  GATES --> ARTIFACTS["Run packet artifacts: graph.json / anchors.json / proof.json / smoke_proof.json / final.md"]

  class FD,ORIENT,CLASSIFY orient
  class ENG,DESIGN,PROD,CLOUD,QA,INCIDENT,DOCS,INFRA,DATA,SECURITY,RUNTIME,SUPPORT,PROVIDER,VOICE,RAG lane
  class STAGES core
  class GATES gate
  class ARTIFACTS artifact
```

</details>

---

## 4. Connector event flow

The connector is what turns external agent work into harness-observable events.

![Connector event flow](assets/mermaid/connector-event-flow.svg)

<details>
<summary>Mermaid source</summary>

```mermaid
flowchart LR
  classDef agent fill:#111827,stroke:#60a5fa,color:#dbeafe,stroke-width:2px
  classDef bridge fill:#134e4a,stroke:#2dd4bf,color:#ccfbf1,stroke-width:2px
  classDef store fill:#052e16,stroke:#22c55e,color:#dcfce7,stroke-width:2px
  classDef reject fill:#4c0519,stroke:#fb7185,color:#ffe4e6,stroke-width:2px
  classDef app fill:#172554,stroke:#818cf8,color:#e0e7ff,stroke-width:2px

  subgraph AGENTS["External coding-agent runtimes"]
    CLAUDE["Claude Code"]
    CODEX["Codex"]
    HERMES["Hermes"]
    FUTURE["future runtime"]
  end

  AGENTS --> EMIT["CLI emitter / MCP / API / watched artifact"]
  EMIT --> BRIDGE["local connector bridge"]

  BRIDGE --> VALIDATE["strict event validation"]
  VALIDATE --> STORE["event ledger and run packet"]
  STORE --> GATEENGINE["gate engine"]
  STORE --> UI["visual run monitor"]

  VALIDATE -->|bad event| REJECT1["reject: unknown node or bad schema"]
  GATEENGINE -->|missing artifact| REJECT2["block: finish-line not satisfied"]
  GATEENGINE -->|agent approval| REJECT3["block: Red Zone needs human"]
  GATEENGINE -->|harness gap| SELFHEAL["self-heal artifact or PR"]
  GATEENGINE -->|passed| HANDOFF["proof-backed handoff"]

  class CLAUDE,CODEX,HERMES,FUTURE,AGENTS agent
  class EMIT,BRIDGE,VALIDATE bridge
  class STORE store
  class GATEENGINE,UI app
  class REJECT1,REJECT2,REJECT3,SELFHEAL reject
  class HANDOFF store
```

</details>

---

## 5. 13-layer production readiness pack

The 13 layers are not the whole harness. They are a production-readiness pack that activates when a task touches real product, infra, deploy, users, data, security, or reliability.

![13-layer production readiness pack](assets/mermaid/production-readiness-13-layer-pack.svg)

<details>
<summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef product fill:#082f49,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
  classDef platform fill:#422006,stroke:#f59e0b,color:#fffbeb,stroke-width:2px
  classDef ops fill:#134e4a,stroke:#2dd4bf,color:#ccfbf1,stroke-width:2px
  classDef gate fill:#4c0519,stroke:#fb7185,color:#ffe4e6,stroke-width:2px

  RUN["production-impacting run"] --> PACK["production readiness layer pack"]

  subgraph PRODUCT["Product surface"]
    L1["01 Frontend"]
    L2["02 Backend / API"]
    L3["03 Database / storage"]
    L4["04 Auth / permissions / RLS"]
  end

  subgraph PLATFORM["Platform surface"]
    L5["05 Hosting / deployment"]
    L6["06 Cloud / compute"]
    L7["07 CI/CD / version control"]
    L8["08 Security"]
    L9["09 Rate limiting"]
    L10["10 Caching / CDN"]
    L11["11 Load balancing / scaling"]
  end

  subgraph OPS["Operational survival"]
    L12["12 Logs / observability"]
    L13["13 Availability / recovery / DR"]
  end

  PACK --> PRODUCT
  PACK --> PLATFORM
  PACK --> OPS

  PRODUCT --> STATUS["required / passed / failed / pending / skipped with reason"]
  PLATFORM --> STATUS
  OPS --> STATUS
  STATUS --> PROOF["production/layer-assessment.json"]
  PROOF --> FINISH["finish-line gate"]

  class L1,L2,L3,L4,PRODUCT product
  class L5,L6,L7,L8,L9,L10,L11,PLATFORM platform
  class L12,L13,OPS ops
  class STATUS,PROOF,FINISH gate
```

</details>

---

## 6. Generated harness pack

This is what `npm run commission` creates for a target repo.

![Generated harness pack](assets/mermaid/generated-harness-pack.svg)

<details>
<summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef input fill:#082f49,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px
  classDef generated fill:#052e16,stroke:#22c55e,color:#dcfce7,stroke-width:2px
  classDef docs fill:#172554,stroke:#818cf8,color:#e0e7ff,stroke-width:2px
  classDef script fill:#422006,stroke:#f59e0b,color:#fffbeb,stroke-width:2px

  REPO["target repo"] --> COMMISSION["commission-harness.mjs"]
  ANSWERS["human answers"] --> COMMISSION
  GRAPH["GitNexus index"] --> COMMISSION

  subgraph FRONT["Agent front doors"]
    A["AGENTS.md"]
    C["CLAUDE.md"]
    SLASH[".claude/commands/valdris-sdlc-harness.md"]
    CODEX["docs/Codex Runtime Prompt.md"]
  end

  subgraph CONFIG["Project adapter"]
    ADAPTER["project-adapter.json"]
    YAML["project.yaml"]
    MAP["00_MAP.md"]
    CONTEXT["CONTEXT.md"]
  end

  subgraph OPERATING_DOCS["Operating docs"]
    VALIDATION["docs/Validation Commands.md"]
    REDZONE["docs/Red Zone Rules.md"]
    PROD["docs/Production Readiness Layers.md"]
    CLOUD["docs/Cloud Platform Engineering.md"]
    QA["docs/QA and Live Smoke.md"]
    MODES["docs/Modes Blueprint Live Replay.md"]
    SELF["docs/Self-Healing Loop.md"]
  end

  subgraph RUNPACK["Run packet"]
    TEMPLATE["runs/_run-template/README.md"]
    REVIEW["commissioning-review.md"]
  end

  subgraph GENERATED_SCRIPTS["Generated helper scripts"]
    EMITTER["scripts/uash-emit-event.mjs"]
    GSCAN["scripts/code-intelligence-scan.mjs"]
  end

  COMMISSION --> FRONT
  COMMISSION --> CONFIG
  COMMISSION --> OPERATING_DOCS
  COMMISSION --> RUNPACK
  COMMISSION --> GENERATED_SCRIPTS

  class REPO,ANSWERS,GRAPH,COMMISSION input
  class A,C,SLASH,CODEX,ADAPTER,YAML,MAP,CONTEXT,TEMPLATE,REVIEW generated
  class VALIDATION,REDZONE,PROD,CLOUD,QA,MODES,SELF docs
  class EMITTER,GSCAN script
```

</details>

---

## 7. README rule of thumb

For the README, keep only one simple overview image/diagram and link here for the deeper maps.

Recommended README line:

```md
For lane-by-lane and repo-level Mermaid diagrams, see [Repo Mermaid Maps](docs/REPO_MERMAID_MAPS.md).
```

That keeps the README readable while still giving technical users a full visual map.
