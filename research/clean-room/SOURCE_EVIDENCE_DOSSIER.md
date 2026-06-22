# Source Evidence Dossier — Clean-Room HumanLayer / Universal Harness Investigation

This dossier concatenates the source-specific evidence notes. It is clean-room: public/open-source/visible facts become independent functional requirements; it does not copy private HumanLayer UI, brand, binaries, or proprietary code.

## Coverage summary

- Evidence files: **24 / 24**
- Video transcript content was not invented; where extraction was blocked, the evidence file says so.
- Latest uploaded harness zip and Prompt Library are treated as Nick-provided harness inputs, not HumanLayer sources.


---

# Source 01: HumanLayer homepage

URL: https://www.humanlayer.dev/

## Inspection status

- Inspected via public HTML fetch by subagent.
- Fetch result: HTTP 200.
- Confidence: high for explicit page text/pricing/claims; medium for visible demo/mockup details because runtime behavior was not authenticated or verified.

## Public facts extracted

- HumanLayer positions itself as an **AI IDE, collaboration platform, and building blocks for a software factory**.
- It targets complex/brownfield codebases and claims teams can ship 2–3x faster across the SDLC while preserving code quality and architecture.
- It emphasizes **BYOK**: bring Claude/Codex/other subscriptions or API keys; no separate per-token HumanLayer bill.
- Visible product primitives: tasks, agent sessions, artifacts, workflows, worktrees, human + agent collaboration, daemon/runner topology, session visibility, issue/workflow intake.
- Visible workflows include **QRSPI**: Questions, Research, Design, Structure, Plan, Implement; plus RPI, RPI Outline, PRD-oriented, Oneshot, and Freeform modes.
- Visible artifacts include `research.md`, `design.md`, `structure.md`, `mockup.html`, `plan.md`, `design-discussion.md`, `implementation-plan.md`.
- Visible task/session states include `DONE`, `RUNNING`, `IDLE`, and `DRAFT`.
- Visible intake sources include inline, Linear, and Jira.
- Pricing visible: Starter free up to 3 team members / 200 sessions per month; Pro $100/user/month; Enterprise includes SSO/SAML, audit logs, custom terms, on-prem/private VPC.

## Clean-room requirements implied

- Task-centric workspace object containing sessions, artifacts, repo/worktree state, status, metadata, and collaborators.
- Multiple agent sessions per task with lifecycle status and audit/trace events.
- Versioned artifacts for research, design, structure, plan, mockups, implementation plans, proof, and handoff.
- Configurable phased workflows such as QRSPI/RPI, plus one-shot/freeform modes.
- Human review/comments on artifacts with accepted decisions injected back into agent context.
- Single-repo and multi-repo worktree/branch management.
- Provider-agnostic BYOK agent/model adapter layer.
- Daemon/runner topology: local first, remote/cloud later.
- Team/enterprise controls: audit, SSO/SAML-ready boundary, private deployment options.

## Clean-room boundary

Do not copy brand, page design, private app behavior, proprietary UI copy, or unauthenticated demo details. Use only public functional patterns.


---

# Source 02: HumanLayer blog index

URL: https://www.humanlayer.dev/blog

## Inspection status

- Inspected via public HTML fetch by subagent.
- Fetch result: HTTP 200.
- Confidence: high for index metadata/excerpts/tags/links; lower for article-level details unless article is separately fetched.

## Visible taxonomy

Tags visible on the blog index include:

- agents
- ai
- architecture
- best-practices
- claudecode
- context-engineering
- devex
- llm
- ralph-wiggum
- skills

## Visible posts / concepts

- Context Forking to Save Time, Tokens and Trouble — context forking as a primitive for reusing high-quality context.
- Long-Context Isn’t the Answer — context quality over context-window size.
- Getting Claude to Actually Read Your CLAUDE.md — conditional XML blocks / targeted instructions.
- Skill Issue: Harness Engineering for Coding Agents — harness engineering as configuration-point leverage.
- A Brief History of Ralph — RALPH/Ralph Wiggum loop history.
- Context-Efficient Backpressure for Coding Agents — wrappers to reduce verbose build/test output noise.
- Writing a good CLAUDE.md — repo instruction files as high-leverage agent configuration.
- Advanced Context Engineering for Coding Agents — solving hard problems in complex brownfield codebases.
- 12 Factor Agents — production-grade LLM agent architecture principles.

## Clean-room requirements implied

- Context quality controls: scoped context, compaction, forking/reuse, and progressive disclosure.
- Project instruction files: AGENTS.md/CLAUDE.md/provider equivalents generated per project.
- Conditional instruction blocks: activate context only when relevant.
- Harness engineering as product surface: skills, hooks, subagents, backpressure, validation gates.
- Build/test output wrappers: quiet success, actionable failure output.
- Brownfield-first workflows: research and plan before code.

## Clean-room boundary

Only the index was read here. Individual article content must be separately cited if used for specific technical claims.


---

# Source 03: Advanced Context Engineering for Coding Agents

URL: https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md

## Provenance

- Commit permalink: https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/18608dedb759256d86b1c0101de82ecef8a556ab/ace-fca.md
- Repo: `humanlayer/advanced-context-engineering-for-coding-agents`
- Path: `ace-fca.md`
- Commit: `18608dedb759256d86b1c0101de82ecef8a556ab`
- Blob SHA: `10935a32e7e915a0b3a1b20450c09acd54a195c4`
- Text SHA256: `ef2d4692afbac5c61d016b7e5f4b4dcdbf9f6426da31b8ac6ec54585ec6a955f`
- File length observed by subagent: 409 lines / 27,741 chars
- GitHub API license: no license detected; `/license` returned 404.

## Key public concepts extracted

- AI coding in complex/brownfield codebases depends on **context engineering**, not just stronger models.
- Core technique: **frequent intentional compaction** — deliberately structure the workflow around context management.
- Recommended context utilization target: approximately 40–60% depending on task complexity.
- LLMs are stateless functions: context window in, next step out.
- Context quality dimensions: correctness, completeness, size, and trajectory.
- Failure priorities: wrong information, missing information, then excess noise.
- Subagents are primarily about context control, not roleplay: fresh context in, compact findings out.
- Workflow: **Research → Plan → Implement**.
  - Research: understand codebase, relevant files, information flow, possible causes.
  - Plan: exact steps, files, tests/verification by phase.
  - Implement: execute phase-by-phase and compact verified status back into the plan.
- Human review is highest leverage at research/plan stages because a bad plan line can produce hundreds of bad code lines.
- Mental alignment: specs, plans, and research docs keep teams aligned on what changed and why.

## Clean-room requirements implied

- Context-budget-aware session management with compaction thresholds.
- Durable research, plan, and implementation-status artifacts.
- Subagents as context firewalls with source-scoped briefs and compact handoff outputs.
- Human review gates after research and planning, before mass implementation.
- Implementation loops that verify phase-by-phase and update the plan/status artifact.
- Team-alignment artifact store: specs/plans/research as durable explainability layer.

## Clean-room boundary

The repo had no detected license, so treat expressive prose/prompts/screenshots as reference-only. Reimplement concepts independently with original wording and cite source.


---

# Source 04: Applying 12-Factor Principles to Coding Agent SDKs

URL: https://github.com/ai-that-works/ai-that-works/tree/main/2026-01-13-applying-12-factor-principles-to-coding-agent-sdks

## Provenance

- Local clone created by subagent: `/root/cleanroom_ai_that_works`
- Commit-pinned URL: https://github.com/ai-that-works/ai-that-works/tree/8fe1d814279706cb5ac4ef35c2d0e50bfd68a595/2026-01-13-applying-12-factor-principles-to-coding-agent-sdks
- Main HEAD observed: `8fe1d814279706cb5ac4ef35c2d0e50bfd68a595`
- Last commit touching requested path: `802ac0d5c645375dc62f257e89117352884430e6`
- Subagent dossier: `/root/ai_that_works_2026_01_13_cleanroom_dossier.md`

## Key public concepts extracted

- Core architecture pattern: **deterministic outer harness + bounded agentic inner loops**.
- Core control-flow rule: **do not use prompts for control flow; use control flow for control flow**.
- Structured outputs act as state-machine gates.
- `src/structured-planning-with-json.ts` demonstrates phases such as design discussion, structure/outline, and implementation plan, each with schemas and deterministic routing.
- RALPH loop principle: one step per loop; verify; update plan/commit; stop/rerun rather than forcing long unbounded model runs.
- Claude Agent SDK examples wrap `query()` with async message generators, session IDs, schema output, event logging, and deterministic post-processing.
- Workflow state persists as JSON; raw SDK events persist as JSONL for replay/audit/evals.
- BurritoOps examples let model propose actions, while deterministic code validates preconditions before side effects.

## Clean-room requirements implied

- Workflow engine should own state/control flow; the LLM should fill typed artifacts or propose actions.
- Every phase should have schema/contract outputs and explicit exit criteria.
- Run events and raw agent/tool events should be persisted for replay/audit/evals.
- One-step-per-loop mode should be available for implementation workers.
- Verification should be deterministic and outside the model where possible.
- Human approval gates should be explicit state transitions, not hidden prompt instructions.

## Blockers / limitations

- No root `LICENSE` file found in the repo tree by subagent; treat source as reference-only unless license is clarified.
- Bun was unavailable, so TypeScript examples/tests were not executed.
- Some whiteboards were image-only and not OCR’d.

## Confidence

High for control-flow/structured-output/RALPH patterns from source files; medium for runtime behavior because examples were not executed.


---

# Source 05: hitchhiker guide to riptide

URL: https://www.youtube.com/watch?v=eKWCx9nKe4I

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: hitchhiker's guide to riptide - feb 2026
  - author/channel: HumanLayer
  - thumbnail: https://i.ytimg.com/vi/eKWCx9nKe4I/hqdefault.jpg
- noembed: HTTP 200
  - title: hitchhiker's guide to riptide - feb 2026
  - author/channel: HumanLayer
  - thumbnail: https://i.ytimg.com/vi/eKWCx9nKe4I/hqdefault.jpg

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] eKWCx9nKe4I: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 06: Applying 12-Factor Principles video

URL: https://www.youtube.com/watch?v=qgAny0sEdIk

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: Applying 12-Factor Principles to Coding Agent SDKs:🦄 #40
  - author/channel: Boundary
  - thumbnail: https://i.ytimg.com/vi/qgAny0sEdIk/hqdefault.jpg
- noembed: HTTP 200
  - title: Applying 12-Factor Principles to Coding Agent SDKs:🦄 #40
  - author/channel: Boundary
  - thumbnail: https://i.ytimg.com/vi/qgAny0sEdIk/hqdefault.jpg

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] qgAny0sEdIk: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 07: HumanLayer Platform Demo

URL: https://www.youtube.com/watch?v=KQoSiBbsVso

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: HumanLayer - Platform Demo
  - author/channel: HumanLayer
  - thumbnail: https://i.ytimg.com/vi/KQoSiBbsVso/hqdefault.jpg
- noembed: HTTP 200
  - title: HumanLayer - Platform Demo
  - author/channel: HumanLayer
  - thumbnail: https://i.ytimg.com/vi/KQoSiBbsVso/hqdefault.jpg

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] KQoSiBbsVso: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 08: No Vibes Allowed complex codebases

URL: https://www.youtube.com/watch?v=rmvDxxNubIg

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: No Vibes Allowed: Solving Hard Problems in Complex Codebases – Dex Horthy, HumanLayer
  - author/channel: AI Engineer
  - thumbnail: https://i.ytimg.com/vi/rmvDxxNubIg/hqdefault.jpg
- noembed: HTTP 200
  - title: No Vibes Allowed: Solving Hard Problems in Complex Codebases – Dex Horthy, HumanLayer
  - author/channel: AI Engineer
  - thumbnail: https://i.ytimg.com/vi/rmvDxxNubIg/hqdefault.jpg

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] rmvDxxNubIg: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 09: Advanced Context Engineering for Agents

URL: https://www.youtube.com/watch?v=IS_y40zY-hc

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: Advanced Context Engineering for Agents
  - author/channel: YC Root Access
  - thumbnail: https://i.ytimg.com/vi/IS_y40zY-hc/hqdefault.jpg
- noembed: HTTP 200
  - title: Advanced Context Engineering for Agents
  - author/channel: YC Root Access
  - thumbnail: https://i.ytimg.com/vi/IS_y40zY-hc/hqdefault.jpg

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] IS_y40zY-hc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 10: AIE Miami live timestamp

URL: https://www.youtube.com/live/6IxSbMhT7v4?t=1943s

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: AIE Miami Keynote & Talks ft. OpenCode. Google Deepmind, OpenAI, and more!
  - author/channel: AI Engineer
  - thumbnail: https://i.ytimg.com/vi/6IxSbMhT7v4/hqdefault.jpg
- noembed: HTTP 200
  - title: None
  - author/channel: None
  - thumbnail: None

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] 6IxSbMhT7v4: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 11: Making Agents Ship in Complex Brownfield Codebases

URL: https://www.youtube.com/watch?v=kBqRubi7dSk&t=1859s

## Metadata attempts
- youtube_oembed: HTTP 200
  - title: Making Agents Ship in Complex Brownfield Codebases | Dex Horothy, CEO of HumanLayer
  - author/channel: The Modern Software Developer
  - thumbnail: https://i.ytimg.com/vi/kBqRubi7dSk/hqdefault.jpg
- noembed: HTTP 200
  - title: Making Agents Ship in Complex Brownfield Codebases | Dex Horothy, CEO of HumanLayer
  - author/channel: The Modern Software Developer
  - thumbnail: https://i.ytimg.com/vi/kBqRubi7dSk/hqdefault.jpg

## Transcript extraction attempts
- yt-dlp dump-json exit code: 1
  - blocker: `ERROR: [youtube] kBqRubi7dSk: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies`

## Clean-room evidence value
- Evidence available from public oEmbed metadata only in this run. Do not claim transcript-specific content unless a transcript is later obtained.
- Use titles/channels to prioritize manual follow-up or authenticated transcript capture.

## Clean-room requirements implied
- Video ingestion subsystem should track metadata source, transcript availability, blocker reason, and confidence separately.
- The platform should never silently invent transcript content when extraction is blocked.

## Confidence
- High for oEmbed title/channel metadata when HTTP 200.
- Low for content-level claims because transcripts were blocked/not captured.


---

# Source 12: homebrew-humanlayer

URL: https://github.com/humanlayer/homebrew-humanlayer
Local path inspected: `/root/humanlayer_survey/repos/homebrew-humanlayer`

## Provenance

- Commit: `97ca10345217b6ef1313b80014208dc0bf40f2ac`
- Latest commit subject/date: `Update riptide-dev and humanlayer-dev to 0.115.2` — 2026-06-17
- Local status: clean; remote HEAD matched local commit per subagent.
- License: Apache-2.0 for tap/cask metadata repo. Does not establish license for `.dmg` app binaries.

## Evidence / signals

- Public Homebrew tap for macOS distribution of HumanLayer/Riptide app builds.
- Casks define production, beta, and dev channels: `humanlayer`, `humanlayer-beta`, `humanlayer-dev`, `riptide`, `riptide-beta`, `riptide-dev`.
- Current cask version observed: `0.115.2`.
- Release assets are `.dmg` files from GitHub releases.
- Casks expose app bundles such as `HumanLayer.app`, beta/dev variants, and Riptide variants.
- Casks symlink bundled binaries named `riptided`, `riptided-beta`, `riptided-dev`.
- Public storage/log paths include `~/.humanlayer/riptide/logs/`, `~/Library/Application Support/HumanLayer*`, and `~/Library/Logs/com.humanlayer.riptide*`.
- README appears naming-drifted: mentions `humanlayer`, `hld`, Claude Code MCP approvals, and `codelayer`, while current casks expose `riptided`.

## Clean-room requirements

- Treat as distribution/topology evidence only: desktop app + local daemon naming + release channels.
- Do not download, decompile, or reverse-engineer `.dmg` binaries.
- Rebuild runner/daemon independently; use public package metadata only for compatibility understanding.

## Confidence

High for packaging/version/channel/path evidence; low for internal app implementation.


---

# Source 13: distilled

URL: https://github.com/humanlayer/distilled
Local path inspected: `/root/humanlayer_survey/repos/distilled`

## Provenance

- Commit: `2ca3920f001724ad225c4ae07ad088b742818cec`
- Latest subject/date: `resend` — 2026-06-16
- Local status: clean; remote HEAD matched local commit per subagent.
- License: root Apache-2.0; most package manifests Apache-2.0. `packages/resend/README.md` says MIT while package/root signals differ, so subpackage license needs clarification.

## Evidence / signals

- Effect-native TypeScript/Bun monorepo for generated cloud-provider SDKs.
- Core concepts: typed operations, schema annotations for HTTP method/path/params/body/pagination, typed errors, retry policies, pagination streams.
- `.gitmodules` points at vendor specs/submodules like Stripe OpenAPI, Resend OpenAPI, AWS Smithy repos, Cloudflare SDK, etc.
- `scripts/create-sdk-full.ts` defines a staged SDK creation pipeline: scaffold package/generator → discover real API errors and patch SDK → generate tests → generate cleanup/nuke script.
- Uses Claude tooling in generation workflow; root package includes `@anthropic-ai/claude-agent-sdk`.
- Resend package evidence: credentials from `RESEND_API_KEY`, optional base URL, resources for emails/domains/API keys/audiences/segments/templates/webhooks/automations/events/logs.
- Repo text still references `alchemy-run/distilled` in places despite current HumanLayer repo location, implying docs/repo rename drift.

## Clean-room requirements

- Model provider/API integrations as generated SDK/adapters with typed operation specs, typed errors, retries, and test/nuke stages.
- Add persistent metadata/workspace cache so generators do not rediscover vendor facts repeatedly.
- Treat staged SDK generation as a useful pattern, not code to copy.
- If reusing code, preserve Apache notices and audit submodule/vendor licenses.

## Confidence

High for static architecture/generator/package signals; medium for generated SDK completeness without building/submodules.


---

# Source 14: pulumi-resend

URL: https://github.com/humanlayer/pulumi-resend
Local path inspected: `/root/humanlayer_survey/repos/pulumi-resend`

## Provenance

- Commit: `f0360f223b0645dbdc292d0c7acb6a0b4c610b54`
- Latest subject/date: `Merge pull request #3 ... template publishing support` — 2026-06-16
- Local status: clean; remote HEAD matched local commit per subagent.
- License: MIT.

## Evidence / signals

- Native Pulumi provider for Resend email infrastructure as code.
- Published package: `@humanlayer/pulumi-resend`; schema version observed `0.3.3`.
- Uses Go + `pulumi-go-provider/infer`, not Terraform bridge.
- Config: `resend:apiKey`, fallback `RESEND_API_KEY`, secret-marked.
- Resend REST client patterns: bearer auth, JSON encode/decode, API error wrapper, pagination helper, 429 retry with `Retry-After`/exponential delay.
- Resources include domains, domain verification, API keys, automations, contact properties, events, segments, templates, topics, webhooks.
- Functions include send email, batch email, event, broadcast.
- Naming drift: `go.mod` uses `github.com/kylemistele/pulumi-resend`; examples and package naming differ.

## Clean-room requirements

- Provider-config lane should support email-domain/template/webhook/contact/audience/broadcast infrastructure as high-risk provider config.
- Secrets/config must be modeled as Red Zone with explicit approval before mutation.
- Use public Resend API docs as primary for independent implementation; this repo is evidence of needed surfaces.

## Confidence

High for static resource/function/config evidence; no live Resend API validation.


---

# Source 15: pulumi-stripe

URL: https://github.com/humanlayer/pulumi-stripe
Local path inspected: `/root/humanlayer_survey/repos/pulumi-stripe`

## Provenance

- Commit: `ca505a8ea7eb92bd105f5b06e5aeaeec80fe2faf`
- Latest subject/date: `Merge pull request #6 ... fix-nodejs-sdk-packaging` — 2026-04-13
- Local status: clean; remote HEAD matched local commit per subagent.
- License: root MIT, but bridge/shim derives from Stripe Terraform provider with MPL-2.0 considerations.

## Evidence / signals

- Pulumi provider for Stripe resources built via `pulumi-terraform-bridge`.
- Published package: `@humanlayer/pulumi-stripe`; observed version `0.1.3`.
- Config: secret `apiKey`, env default `STRIPE_API_KEY`.
- Resources include products, prices, customers, coupons, promotion codes, shipping/tax rates, entitlements features, webhook endpoints, billing meters, v2 billing constructs, event destinations.
- Product signal: billing/subscription/provider-config surfaces are first-class operational concerns.

## Clean-room requirements

- Billing/provider config belongs in Red Zone: explicit approval, current-vs-intended diff, rollback, verification.
- If building Stripe adapter, use Stripe public API docs and independent implementation; do not copy generated shim code unless complying with MIT/MPL obligations.

## Confidence

High for static resource/config/packaging evidence; medium for legal/license interpretation.


---

# Source 16: react-hotkeys-hook

URL: https://github.com/humanlayer/react-hotkeys-hook
Local path inspected: `/root/humanlayer_survey/repos/react-hotkeys-hook`

## Provenance

- Commit: `05a278023749aa70a48745adfd2699c12637deeb`
- Latest subject/date: `Merge pull request #5 from humanlayer/publish-humanlayer` — 2026-03-28
- Local status: clean; remote HEAD matched local commit per subagent.
- License: MIT; upstream attribution to Johannes Klauss remains.

## Evidence / signals

- HumanLayer fork/package of React hotkeys hook library, published as `@humanlayer/react-hotkeys-hook`.
- UI capability signals: scoped keyboard shortcuts, sequences like `g>g`, `HotkeysProvider`, `useHotkeys`, `useRecordHotkeys`, global scope enable/disable/toggle, form/contentEditable gating, Shadow DOM handling, metadata/descriptions for hotkeys, registry of bound shortcuts.

## Clean-room requirements

- Universal platform UI should have command-palette/keyboard-driven navigation and action surface.
- Hotkey registry should expose metadata for discoverability and support scope-aware shortcuts.
- Reuse only with MIT attribution; otherwise reimplement independently.

## Confidence

High for API/package evidence; medium for HumanLayer-specific product intent.


---

# Source 17: skills

URL: https://github.com/humanlayer/skills
Local path inspected: `/root/humanlayer_survey/repos/skills`

## Provenance

- Commit: `ecf602e2f9bb445831e36592af92c36bfad18960`
- Latest subject/date: `add marketplace.json and plugin.json, remove skills-lock.json` — 2026-03-17
- Local status: clean; remote HEAD matched local commit per subagent.
- License: MIT.

## Evidence / signals

- Repo packages Claude Code skills/plugins.
- Marketplace/plugin model: `.claude-plugin/marketplace.json`, plugin metadata, skill directory with `SKILL.md`.
- Main skill: `improve-claude-md`.
- Concept: rewrite `CLAUDE.md` using targeted `<important if="condition">` blocks so task-specific instructions activate when relevant.
- Transformation: keep foundational project context bare, preserve commands, split broad rules into conditional blocks, remove stale/low-value guidance.

## Clean-room requirements

- Universal harness should generate provider-specific front doors and skills/plugins, not only docs.
- Instruction activation should be conditional/progressive rather than one massive context dump.
- If reusing skill text/code, include MIT license notice; otherwise reimplement concept independently.

## Confidence

High for license/plugin structure/skill behavior.


---

# Source 18: rpi-coordination-template

URL: https://github.com/humanlayer/rpi-coordination-template
Local path inspected: `/root/humanlayer_survey/repos/rpi-coordination-template`

## Provenance

- Commit: `a960b753c6b74b953ba16fa3dd4f3ae0708f46e4`
- Latest subject/date: `Update CLAUDE.md` — 2026-03-09
- Local status: clean; remote HEAD matched local commit per subagent.
- GitHub marks repo as template.
- License: none detected.

## Evidence / signals

- Minimal coordination repo template for working across multiple sibling repositories.
- Layout: coordination repo beside multiple product repos; run sessions from coordination repo.
- `.claude/settings.json` uses `permissions.additionalDirectories` for sibling repo access.
- `CLAUDE.md` has conditional `<important if=...>` guidance for RPI flows, remote freshness checks, and per-task worktrees under sibling `workspaces/`.

## Clean-room requirements

- Universal platform must support multi-repo / coordination-repo projects.
- Commissioning interview should ask whether work is mono-repo, multi-repo, or coordination-repo.
- Generated harness should define allowed repo directories and worktree-per-task conventions.
- No-license source: use facts/ideas only, not text/config copying.

## Confidence

High for template workflow; high that reuse should be reference-only unless license is clarified.


---

# Source 19: 12-factor-agents

URL: https://github.com/humanlayer/12-factor-agents
Local path inspected: `/root/humanlayer_survey/repos/12-factor-agents`

## Provenance

- Commit: `d20c728368bf9c189d6d7aab704744decb6ec0cc`
- Latest subject/date: merge PR #72 — 2025-09-21
- Local status: clean; remote HEAD matched local commit per subagent.
- License: top-level Apache-2.0; README says content/images CC BY-SA 4.0 and code Apache-2.0; one package metadata says ISC, so note mixed metadata.

## Evidence / signals

- 12 principles: natural language to tool calls, own prompts, own context window, tools as structured outputs, unify execution/business state, launch/pause/resume, contact humans with tools, own control flow, compact errors, small focused agents, trigger anywhere, stateless reducer.
- Template model: `Thread`, `Event`, serialize thread for LLM, tool-call loop, human-facing intents, file-backed thread store.
- Server/outer-loop resumes threads from event callbacks for conversations, human contacts, and function calls.
- A2H draft models: Message, NewConversation, HumanContact, FunctionCall, ContactChannel.

## Clean-room requirements

- Platform owns prompts/context/control flow; LLM proposes structured actions.
- Treat humans as tools/input/approval transitions.
- Persist thread/task state and make agent resumable/pauseable.
- Keep focused agents and allow triggers from UI, webhook, chat, cron, CI, issue tracker.
- Avoid copying prose/images due CC BY-SA unless complying.

## Confidence

High for principles and workflows; medium for package-level license interpretation.


---

# Source 20: agentcontrolplane

URL: https://github.com/humanlayer/agentcontrolplane
Local path inspected: `/root/humanlayer_survey/repos/agentcontrolplane`

## Provenance

- Commit: `eaa2a7ed1d9cb4e13dc53defaf420e36f481dcad`
- Latest subject/date: `restore readme` — 2025-07-02
- Local status: clean; remote HEAD matched local commit per subagent.
- License: LICENSE says Apache Software License 2.0; GitHub API classifier reported NOASSERTION likely due short/noncanonical license file.

## Evidence / signals

- Kubernetes-native AI agent orchestrator/operator based on CRDs.
- Core objects: `LLM`, `Agent`, `MCPServer`, `ContactChannel`, `Task`, `ToolCall`.
- `LLM`: providers include OpenAI, Anthropic, Mistral, Google, Vertex; credentials via K8s Secret refs.
- `Agent`: LLM ref, system prompt, MCP servers, human contact channels, sub-agents.
- `MCPServer`: stdio/http transport, command/args/env/url/resources, optional approval channel.
- `ContactChannel`: Slack/email; HumanLayer API key refs.
- `Task`: agent ref + user message/context window; phases include Initializing, Pending, ReadyForLLM, ToolCallsPending, FinalAnswer, Failed.
- `ToolCall`: types MCP, HumanContact, DelegateToAgent; phases include pending/running/succeeded/failed/human approval/input/subagent states.
- Workflow: build context → call LLM → final answer or create durable ToolCall CRs → execute/poll tools/human/subagents → append results → continue.
- Controllers use Kubernetes Leases for distributed task LLM locking.

## Clean-room requirements

- Reimplement object model in our own DB-first way: LLM configs, agents, tool servers, contact channels, tasks, tool calls, approvals, child tasks.
- Treat human approval/input as durable tool-call state, not chat side-channel.
- Make Kubernetes optional/enterprise later; start with Postgres/SQLite worker-controller loop.
- If copying code/YAML, comply with Apache notices; clean-room path is independent implementation from public API concepts.

## Confidence

High for CRD/domain model extraction; medium-high for controller workflow because source was statically inspected, not executed.


---

# Source 21: Latest uploaded agentic SDLC harness zip

Path: `/root/.hermes/cache/documents/doc_625c778a47b8_agentic-sdlc-harness-main (3).zip`

## Provenance

- Exists: True
- SHA256: `0721b3a8189ecf6ee1a600e5a3fccc6cf435a4694554fd2b425823b6c8e2003b`
- File count: 251
- Prompt Library present: `True`

## Clean-room evidence value

This is Nick's updated project harness reference, not a HumanLayer source. It supplies the universalization target: a filesystem-native agentic SDLC harness with lanes, gates, run packets, prompts, and anti-skip flow enforcement.


---

# Source 22: Latest extracted harness

Path: `/tmp/agentic-sdlc-harness-main-3/agentic-sdlc-harness-main`

## Inventory signals

- Exists: True
- Root files: ['README.md', 'CONTEXT.md', '00_MAP.md', 'INDEX.md', 'REVIEW_ORDER.md', 'CLAUDE.md', '.mcp.json', '.pre-commit-config.yaml', '.gitignore', 'AGENTS.md']
- Workspace CONTEXT files: 61
- Core gate scripts: 12
- Prompt Library path: `/tmp/agentic-sdlc-harness-main-3/agentic-sdlc-harness-main/references/Prompt Library.md`

## Clean-room evidence value

This source defines the project-specific Utari implementation that should be split into:

1. Universal core: lanes/stages, run packets, gate scripts, Answer Contract, Graphify pattern, ADR/self-heal pattern.
2. Project adapter: Utari-specific source truth, branch/deploy rules, Red Zone, validation commands, Linear/Jelani/team style, runtime maps.


---

# Source 23: Prompt Library local

Path: `/tmp/agentic-sdlc-harness-main-3/agentic-sdlc-harness-main/references/Prompt Library.md`

## Provenance

- Exists: True
- Lines: 417
- Chars: 20947
- SHA256: `d141433a78a672511106f779a0bac1bc66e3b512afda0d78690c2e6090bd619a`

## Sections

- The one rule that makes this work
- A. The Master Flow Prompt (use this every time)
- B. Orient and classify
- C. Investigate and prove cause (RCA, evidence-first)
- D. Design (ICM tiers and decisions)
- E. Implement (acceptance-first)
- F. Validate (proof, evals, smoke)
- G. Ship (staging QA, deploy_verify, promote)
- H. Operate (watch and reconcile)
- I. Full-lane prompts (the whole route, one per lane)
- J. Graphify (ground-truth, query before you guess)
- K. Self-healing and harness maintenance
- L. Anti-skip nudges (when it shortcuts the flow)

## Key evidence

- Lines 8-20 establish the critical anti-skip rule: ICM gates must write artifacts such as `rca/rca.json`, `proof/proof.json`, `design/anchors.json`, and `smoke/smoke_proof.json`; missing file means skipped gate.
- Lines 24-64 define the Master Flow Prompt: preflight, route, logs-first RCA, feature grill/PRD, acceptance-first red baseline, redzone stop, proof/smoke/finish-line gates, self-healing correction PR, and Answer Contract final shape.
- Lines 401-416 define anti-skip nudges L1-L12, each forcing a missing artifact/gate/route/evidence step.

## Clean-room requirements

- Universal platform must make gates artifact-backed, not answer-backed.
- Every task final answer must include lane, fired gates, artifact paths, skipped gates, and why.
- Add run-packet validator that fails completion if required files are missing.
- Add prompt-library templates as configurable workflow prompts per lane.

## Confidence

High — file read directly from latest uploaded zip extraction.


---

# Source 24: Prompt Library GitHub

URL: `https://raw.githubusercontent.com/Nickmegladon/agentic-sdlc-harness/main/references/Prompt%20Library.md`

## Fetch result

- Status: HTTP 404
- Raw length: 0
- Raw SHA256: ``
- Same as local extracted Prompt Library: `unknown`

## Clean-room evidence value

Use the local extracted file as primary if GitHub raw is blocked or changes. If `raw_same` is true, the GitHub source corroborates the uploaded zip version.

