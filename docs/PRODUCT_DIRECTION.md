# Product Direction

## Correction from Nick

The platform should **not** become a full IDE.

It should be a connector/control plane that sits next to existing coding-agent products:

- Claude Code
- Codex
- Hermes
- OpenCode / Copilot later

## Best terminology

| Nick wording | Calibrated term |
|---|---|
| “Claude Code connector or Codex connector” | coding-agent runtime adapter |
| “visual on the left-hand side” | workflow telemetry panel / run visualizer |
| “n-flow of some sort” | node-based workflow visualization, similar to n8n/River/Temporal-style execution graph |
| “how the harness is working” | artifact-gated workflow observability |
| “not an IDE” | control plane, not editing surface |

## Product category

- **Standard category:** Internal Developer Platform / developer portal / control plane.
- **Emerging category:** Agentic SDLC platform / coding-agent orchestration layer.
- **Internal term:** Universal Agentic SDLC Harness.

## User experience

```text
User opens Codex or Claude Code
→ connector injects/generated project harness context
→ user asks agent to fix/build/research
→ harness creates task + run packet
→ Vercel UI shows the visual flow
→ each stage writes artifacts
→ required gates block completion if missing
→ final answer includes proof paths and human decisions
```

## What we are building first

A Vercel-hosted run visualizer and commissioning surface, backed by local/CLI runner adapters.

The first release should prove:

1. The platform can commission a repo.
2. It can generate a project-specific harness pack.
3. It can launch or wrap an external agent runtime.
4. It can stream run/stage/gate status.
5. It can block “done” when required artifacts are missing.

## What we are not building first

- Browser-based code editor.
- Full VS Code replacement.
- Private HumanLayer app clone.
- Hosted remote runner before local runner works.
- Enterprise SSO/audit before task/artifact/gate model works.
