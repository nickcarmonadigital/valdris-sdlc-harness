# Valdris SDLC Harness

Valdris SDLC Harness is a connector-first control plane for making any repository AI-operable without turning the product into another IDE.

It commissions a repo/team, generates a project-specific harness pack, connects to Claude Code, Codex, Hermes, or future coding-agent runtimes, and blocks “done” until required proof artifacts exist.

## Product thesis

```text
commission repo/team
→ generate project-specific harness adapter
→ launch or guide an existing coding-agent runtime
→ stream task/session/artifact/gate telemetry
→ block done until required proof artifacts exist
```

## What stays universal from the uploaded harness zip

The zip’s reusable value is the **operating pattern**, not the Utari-specific names/rules.

| Universal piece | What stays | What becomes project-specific |
|---|---|---|
| Front doors | `AGENTS.md` / `CLAUDE.md` tell agents how to enter the harness | Product name, repo paths, source-truth order |
| Router | `00_MAP.md` / `CONTEXT.md` route by work type | Lanes enabled for that repo/team |
| Stage flow | `intake → route → investigate → design → implement → redzone → prove → handoff` | Stage docs/gotchas for the project |
| Run packet | Durable task/session/artifact/proof/handoff record | Issue IDs, owners, branch names, artifacts |
| Proof gates | Mechanical checks before done | Actual lint/type/test/build/smoke commands |
| Red Zone | Explicit human approval before risky actions | Which actions are risky and who can approve |
| Answer contract | Bottom line, why, proof, fix/plan, your call | Tone, verbosity, owner names |
| Code graph / Graphify slot | Agents anchor claims to code structure | Repo-specific graph path and refresh command |
| Self-healing corrections | Harness claims can be corrected with evidence | Repo-specific correction process |
| Lane-context evals | Measure whether context improves agent output | Repo-specific cases and answer keys |

## What this repo is

- Next.js/Vercel-ready application shell.
- Interactive run queue, selected-run inspector, metrics, create-run form, and action controls.
- Visual workflow board with animated agent chips.
- N8N-style Flow Monitor that shows Graphify, Matt Pocock-style skill packs, gate status, failed nodes, and skip reasons for every run.
- Local bridge at `http://127.0.0.1:8787` for agent runtime events.
- On-prem JSONL event adapter; no Supabase required for v0.
- Local commissioning CLI that generates `project-adapter.json`, front doors, validation docs, red-zone docs, and a run template.

## What this repo is not

- Not an IDE.
- Not a HumanLayer clone.
- Not a prompt library by itself.
- Not a generic watered-down copy of a repo-specific harness.

It is the control plane plus commissioning/gate layer around agents users already use.

## Scripts

```bash
npm install
npm run typecheck
npm run build
npm run commission:questions
npm run commission -- --repo /path/to/repo --project-name "Example" --out ./generated-harness
npm run simulate:agent
npm run bridge:claude
npm run dev
```

`npm run commission` scans a repo, asks/merges the human operating questions, and generates a project-specific harness pack with:

```text
project-adapter.json
project.yaml
AGENTS.md
CLAUDE.md
00_MAP.md
CONTEXT.md
docs/Validation Commands.md
docs/Red Zone Rules.md
runs/_run-template/README.md
commissioning-review.md
```

## First MVP

Build local commissioning + connector simulation before a full hosted platform:

```bash
npm run commission -- --repo /path/to/repo --project-name "Example" --out ./generated-harness
npm run bridge:claude
npm run dev
```

The app renders the run flow and required artifact status while the actual code edits happen inside Codex, Claude Code, Hermes, or another connected runtime.
