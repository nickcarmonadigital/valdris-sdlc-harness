#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "0.5.0";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_LANE_FAMILIES = [
  "intake-classify",
  "repo-intelligence-graphify",
  "product-app-sdlc",
  "system-design",
  "architecture-quality-foundation",
  "enterprise-proof-bank",
  "cloud-platform-engineering",
  "data-integrations",
  "security-compliance",
  "qa-release",
  "reliability-observability",
  "evals-trajectory",
  "context-skills-memory",
  "tooling-sandbox-model-routing",
  "ai-economics",
  "background-pr-agents",
  "interop-mcp-a2a",
  "production-agent-lifecycle",
  "team-governance",
  "handoff",
  "harness-self-healing",
];

const PRODUCTION_LAYERS = [
  "frontend",
  "backend-api-logic",
  "database-storage",
  "auth-permissions-rls",
  "hosting-deployment",
  "cloud-compute",
  "cicd-version-control",
  "security",
  "rate-limiting",
  "caching-cdn",
  "load-balancing-scaling",
  "error-tracking-logs-observability",
  "availability-recovery-dr",
];

const QUESTION_GROUPS = [
  {
    id: "person",
    title: "Person / team operating style",
    questions: [
      { id: "operator_name", label: "Who is the primary human/operator for this repo?", default: "project owner" },
      { id: "answer_style", label: "How should agents report status?", default: "decision packet: bottom line, proof, risk, next call" },
      { id: "autonomy_level", label: "How much autonomy should the agent have before asking?", default: "read-only + local edits allowed; ask before external writes" },
      { id: "annoyances", label: "What agent behavior should be avoided?", default: "long process narration, fake proof, broad rewrites, skipping validation" },
    ],
  },
  {
    id: "project",
    title: "Project identity",
    questions: [
      { id: "project_name", label: "Project/product name?", defaultFrom: "projectName" },
      { id: "users", label: "Who are the real users/customers?", default: "internal users" },
      { id: "production_definition", label: "What does production mean here?", default: "main branch / deployed customer-facing environment" },
      { id: "worst_agent_failure", label: "What is the worst plausible agent-caused failure?", default: "breaking production, leaking secrets, corrupting customer data, or making false live-run claims" },
    ],
  },
  {
    id: "source_truth",
    title: "Source of truth",
    questions: [
      { id: "truth_order", label: "When sources conflict, what is the precedence order?", default: "live system, git/GitHub, CI/deploy workflows, issue tracker, docs, chat" },
      { id: "issue_tracker", label: "Issue tracker / work queue?", default: "GitHub Issues or Linear" },
      { id: "knowledge_base", label: "Stable docs / knowledge base location?", default: "docs/ in repo" },
    ],
  },
  {
    id: "repo",
    title: "Repo and architecture",
    questions: [
      { id: "repo_role", label: "Is this repo frontend, backend, monorepo, infra, docs, or mixed?", defaultFrom: "detectedRepoRole" },
      { id: "safe_edit_paths", label: "Which paths are safe for routine agent edits?", default: "src/, app/, components/, lib/, tests/, docs/" },
      { id: "review_required_paths", label: "Which paths require human review before merge?", default: "migrations/, infra/, auth, billing, secrets, deploy workflows, cloud/provider config" },
      { id: "code_graph", label: "Graphify/code graph requirement?", default: "required before codebase, debugging, architecture, refactor, or cross-file implementation work; docs-only may skip with explicit reason" },
    ],
  },
  {
    id: "branch_deploy",
    title: "Branch and deploy model",
    questions: [
      { id: "default_work_branch", label: "Default base branch for normal work?", default: "main" },
      { id: "staging_branch", label: "Staging branch/environment, if any?", default: "none or staging" },
      { id: "production_branch", label: "Production branch/environment?", default: "main / production" },
      { id: "merge_owner", label: "Who is allowed to merge or deploy?", default: "human maintainer" },
      { id: "deployment_proof", label: "What proves a deploy succeeded?", default: "CI green + deployment dashboard/health check + smoke test" },
    ],
  },
  {
    id: "validation",
    title: "Validation and proof",
    questions: [
      { id: "install_command", label: "Install command?", defaultFrom: "detectedInstall" },
      { id: "lint_command", label: "Lint command?", defaultFrom: "detectedLint" },
      { id: "typecheck_command", label: "Typecheck command?", defaultFrom: "detectedTypecheck" },
      { id: "test_command", label: "Test command?", defaultFrom: "detectedTest" },
      { id: "build_command", label: "Build command?", defaultFrom: "detectedBuild" },
      { id: "smoke_command", label: "Smoke/e2e command?", default: "manual or project-specific" },
      { id: "done_definition", label: "What does done require?", default: "required commands pass, required artifacts exist, skipped nodes have reasons, human handoff is clear" },
    ],
  },
  {
    id: "red_zone",
    title: "Red Zone / approval boundaries",
    questions: [
      { id: "red_zone_actions", label: "Which actions require explicit human approval?", default: "push, merge, deploy, production data writes, secrets/env changes, auth, billing, destructive ops, provider config, cloud resource mutation" },
      { id: "approval_owner", label: "Who can approve Red Zone actions?", default: "primary human/operator" },
      { id: "read_only_allowed", label: "Are read-only investigations allowed without asking?", default: "yes" },
    ],
  },
  {
    id: "lanes",
    title: "Work lanes",
    questions: [
      { id: "enabled_lanes", label: "Which lanes should this repo use?", default: "engineering-default, system-design, production-readiness, cloud-platform, qa-release, incidents, docs-product, infra, data, security" },
      { id: "custom_lanes", label: "Any repo-specific lanes?", default: "none" },
      { id: "adr_policy", label: "When should an ADR/decision record be required?", default: "hard-to-reverse architecture, data, security, provider, cloud/platform, or deployment decisions" },
    ],
  },
  {
    id: "system_design",
    title: "System design",
    questions: [
      { id: "system_design_triggers", label: "When must the System Design lane activate?", default: "new architecture, scaling, APIs, data modeling, service boundaries, reliability tradeoffs, hard-to-reverse decisions, ambiguous product behavior" },
      { id: "design_requirements", label: "Which design requirements matter most?", default: "latency, throughput, SLO/SLA, scale assumptions, data integrity, security, failure modes" },
      { id: "adr_required_for", label: "What decisions require ADRs?", default: "API contracts, data model changes, queue/workers, provider changes, auth/security, cloud/deploy topology" },
    ],
  },
  {
    id: "production_readiness",
    title: "Production readiness layer pack",
    questions: [
      { id: "production_layers", label: "Which production layers should be checked per run?", default: PRODUCTION_LAYERS.join(", ") },
      { id: "production_layer_skip_policy", label: "How should irrelevant production layers be handled?", default: "mark skipped with explicit reason; never silently omit" },
      { id: "production_readiness_proof", label: "What proof should production-impacting work attach?", default: "layer assessment, tests, deploy/health check, logs/request IDs, rollback path, smoke proof" },
    ],
  },
  {
    id: "cloud_platform",
    title: "Cloud / platform engineering",
    questions: [
      { id: "cloud_providers", label: "Cloud/platform providers in scope?", default: "AWS/Azure/GCP/Vercel/Supabase as applicable" },
      { id: "cloud_services", label: "Key cloud services this repo may touch?", default: "ECS/Lambda/EC2/S3/RDS/VPC/IAM/CloudWatch/Route53/load balancers/queues/workers" },
      { id: "iac_model", label: "How are cloud resources managed?", default: "IaC preferred; console/manual changes require approval and runbook notes" },
      { id: "observability_model", label: "What proves observability after deploy?", default: "logs, metrics/traces, dashboards, alerts, request IDs, CloudWatch/provider links" },
      { id: "cost_rollback_policy", label: "How should agents handle cost/scaling/rollback risk?", default: "flag spend/scaling changes, record rollback path, require approval for paid/prod resource mutation" },
    ],
  },
  {
    id: "qa_release",
    title: "QA and release",
    questions: [
      { id: "qa_plan_policy", label: "When is a QA plan required?", default: "feature, bug, refactor, integration, data, auth/security, cloud/platform, voice/runtime, or production-impacting work" },
      { id: "break_it_qa_policy", label: "What does let’s-break-it QA require?", default: "edge cases, malformed inputs, auth negative cases, stale data, latency/retries, concurrency, provider failures, rollback path" },
      { id: "live_smoke_criteria", label: "When is live/preview/staging smoke required?", default: "deployed behavior, provider/webhook/voice/worker/runtime, cloud/platform, auth/data, or anything local tests cannot simulate" },
    ],
  },
  {
    id: "modes_self_healing",
    title: "Modes and self-healing",
    questions: [
      { id: "telemetry_mode_policy", label: "How should Blueprint, Live Run, and Replay be separated?", default: "Blueprint is static topology, Live Run uses real connector events, Replay uses stored run packets; never imply fake live telemetry" },
      { id: "self_heal_allowed", label: "Can agents propose/open self-healing PRs for harness gaps?", default: "propose by default; open only if repo policy allows" },
      { id: "self_heal_pr_target", label: "Where should self-heal PRs change the harness?", default: "adapter, lane docs, gates, prompts/front doors, connector scripts, commissioning questions, validation/Red Zone docs" },
    ],
  },
  {
    id: "foundation_blueprint",
    title: "Good looks like / foundation blueprint",
    questions: [
      { id: "target_architecture_style", label: "What architecture style should this system follow?", default: "modular monolith by default; service boundaries only where scale/team/runtime isolation proves they are needed" },
      { id: "reference_architecture", label: "What reference architecture or golden path should agents compare against?", default: "thin UI, explicit API/service layer, typed domain modules, clear data access boundary, queue/worker boundary for async work, observable deploy path" },
      { id: "foundation_layers", label: "What foundational layers must exist before serious feature velocity?", default: "auth, data model, API contracts, validation, tests, CI/CD, environment config, observability, rollback, security boundaries, runbooks, ownership" },
      { id: "bad_foundation_signals", label: "What signals mean the foundation is weak or risky?", default: "business logic in UI/routes, no typed contracts, no migration policy, hidden provider coupling, no observability, no rollback, duplicated workflows, unclear ownership" },
      { id: "golden_path", label: "What is the happy-path way to add a normal feature?", default: "issue -> Graphify/anchors -> design if needed -> typed boundary -> tests/evals -> proof -> PR/handoff" },
      { id: "foundation_decision_owner", label: "Who decides if foundation work must happen before feature work?", default: "technical owner / architecture reviewer" },
    ],
  },
  {
    id: "code_quality_guardrails",
    title: "Anti-spaghetti code quality guardrails",
    questions: [
      { id: "module_boundaries", label: "What are the core modules/domains and what owns each boundary?", default: "UI, API, domain/service logic, data access, provider adapters, jobs/workers, auth/security, observability" },
      { id: "dependency_rules", label: "What dependency direction rules must code follow?", default: "UI calls API/actions; API calls services; services use repositories/adapters; domain logic does not import UI/provider SDKs directly" },
      { id: "anti_spaghetti_rules", label: "Which code smells should block or trigger review?", default: "large god files, circular dependencies, duplicated business rules, untyped payloads, broad catch-and-ignore, silent fallbacks, mixed auth/data/provider/UI logic" },
      { id: "complexity_budget", label: "What complexity budget should trigger refactor before more features?", default: "files over ~300 lines, functions over ~60 lines, modules with 5+ reasons to change, repeated logic in 3+ places, nested conditionals agents cannot explain" },
      { id: "refactor_triggers", label: "When should agents stop and propose a refactor instead of adding more code?", default: "new change touches too many unrelated files, requires copy-paste, crosses unclear boundaries, adds another provider special case, or hides missing data" },
      { id: "quality_gate_proof", label: "What proof shows the code stayed maintainable?", default: "small diff, boundary explanation, tests at correct layer, no new circular deps, no broad fallbacks, code review checklist, architecture note when boundaries changed" },
    ],
  },
  {
    id: "enterprise_proof_banks",
    title: "Enterprise proof banks / what good looks like",
    questions: [
      { id: "domain_pack", label: "Which domain proof pack should this repo use?", default: "enterprise-web-app by default; optionally API, AI product, infra/data, growth website, serious game, voice/runtime, or custom" },
      { id: "good_looks_like_artifacts", label: "What artifacts teach agents what good looks like?", default: "reference architecture, service map, data model, API contract, UI states, test strategy, observability plan, rollback/runbook, example high-quality PR" },
      { id: "scale_bar", label: "What scale/concurrency bar should serious work assume?", default: "explicit capacity model or load test for production-impacting paths; do not assume small-app traffic unless approved" },
      { id: "observability_bar", label: "What observability must exist for production work?", default: "structured logs, request/run IDs, metrics/traces when available, dashboard or provider links, alert/owner, smoke evidence" },
      { id: "rollback_bar", label: "What rollback/recovery proof is required?", default: "rollback command or procedure, migration rollback/data recovery note, feature flag/disable path, incident owner" },
    ],
  },
  {
    id: "eval_gate",
    title: "Eval gate",
    questions: [
      { id: "eval_required_for", label: "What changes require AI behavior evals, not just tests?", default: "prompts, RAG/retrieval, agent tools, model/provider routing, voice/runtime behavior, recommendations, policy decisions, safety-sensitive automation" },
      { id: "eval_dataset_owner", label: "Who owns eval datasets/examples?", default: "product/AI owner plus domain reviewer" },
      { id: "eval_acceptance_threshold", label: "What eval score blocks merge or deploy?", default: "project-specific; default block on critical regression, unsafe answer, tool misuse, or below agreed score threshold" },
      { id: "eval_run_location", label: "Where should evals run?", default: "local during development and CI before merge for AI behavior changes" },
      { id: "eval_artifacts", label: "What eval artifacts must be attached?", default: "evals/eval-plan.json, evals/results.json, failing examples, judge/config version, model/provider used" },
    ],
  },
  {
    id: "trajectory_gate",
    title: "Trajectory evaluation",
    questions: [
      { id: "bad_agent_trajectory", label: "What agent behaviors count as a bad path even if the final output passes?", default: "skipped Graphify/context, wrong tool order, excessive retries, ignored failures, unverifiable claims, unsafe shortcuts, human approval bypass attempts" },
      { id: "retry_loop_limit", label: "How many retries/loops are acceptable before escalation?", default: "3 focused attempts or 20 minutes without new evidence, then escalate with blocker packet" },
      { id: "forbidden_tool_sequences", label: "Which tool/action sequences are forbidden?", default: "write before context/graph on cross-file work; deploy before proof; approval.granted by agent; destructive action without pending human approval" },
      { id: "trajectory_scores", label: "What should the trajectory scorer grade?", default: "context loaded, tool selection, artifact sequence, recovery after failures, skip reasons, approval behavior, cost/retry discipline" },
      { id: "trajectory_artifacts", label: "What trajectory evidence must be stored?", default: "trajectory/trace.jsonl, tool calls, context loads, approval events, retry/failure ledger, final trajectory score" },
    ],
  },
  {
    id: "context_manifest",
    title: "Context manifest / ICM",
    questions: [
      { id: "always_load_context", label: "What context is always loaded?", default: "project adapter, source-truth order, repo map, current task/run packet, Red Zone rules, validation/proof rules" },
      { id: "lane_context_rules", label: "What context is loaded only by lane/task?", default: "architecture docs for design, cloud/runbooks for infra, eval sets for AI changes, security policy for auth/billing/data" },
      { id: "approval_required_context", label: "What context should never be loaded or used unless approved?", default: "secrets, production data, private customer data, billing/provider dashboards, sensitive logs" },
      { id: "stale_context_policy", label: "How should stale or conflicting context be handled?", default: "check live system/git first, mark stale docs, cite source date, ask before Red Zone decisions" },
      { id: "context_budget", label: "What is the token/context budget policy?", default: "load smallest sufficient lane context; summarize long docs; keep source links; fail if required context cannot fit or be retrieved" },
      { id: "context_artifacts", label: "What context artifacts must exist?", default: "context/manifest.yaml, context/budget.json, context/sources.json, context/loaded.md" },
    ],
  },
  {
    id: "skill_registry",
    title: "Skill registry / progressive disclosure",
    questions: [
      { id: "skill_inventory", label: "What skills/procedures exist for this team?", default: "debugging, feature build, incident, cloud deploy, data migration, security review, eval update, release, support triage" },
      { id: "skill_owner_policy", label: "Who owns and reviews each skill?", default: "named technical owner per skill with review required for production-impacting skills" },
      { id: "skill_activation_rules", label: "When should each skill activate?", default: "by lane, file path, risk class, work type, provider touched, or user command" },
      { id: "skill_tool_permissions", label: "What tools is each skill allowed to use?", default: "least privilege by skill; Red Zone tools require human approval" },
      { id: "skill_proof", label: "What proof does each skill need to produce?", default: "skill name/version, why selected, artifacts generated, commands run, eval/tests/smoke as applicable" },
      { id: "skill_registry_artifacts", label: "How are skills versioned and reviewed?", default: "skills/registry.yaml plus per-skill manifest with owner, version, triggers, allowed tools, proof, evals" },
    ],
  },
  {
    id: "memory_substrate",
    title: "Memory substrate",
    questions: [
      { id: "memory_should_remember", label: "What should agents remember across runs?", default: "stable project conventions, architecture decisions, recurring pitfalls, approved workflow preferences, durable integration facts" },
      { id: "memory_never_remember", label: "What should never be remembered?", default: "secrets, tokens, private customer data, transient task status, stale issue IDs, unverified claims" },
      { id: "memory_review_owner", label: "Who can review/edit/delete memory?", default: "project owner or delegated maintainer" },
      { id: "memory_retention_policy", label: "What retention/TTL should memory have?", default: "durable facts persist; run/task details expire or stay in run packets, not long-term memory" },
      { id: "memory_handoff_rule", label: "What memory use must be cited in handoff?", default: "cite retrieved memory/source when it materially affected a decision or risk claim" },
      { id: "memory_eval_policy", label: "How do we test whether memory is helping or harming?", default: "memory regression examples, stale-memory checks, source provenance audit, human review for corrections" },
    ],
  },
  {
    id: "tool_registry_hooks",
    title: "Tool registry and hooks",
    questions: [
      { id: "free_tools", label: "Which tools can agents use freely?", default: "read-only repo search/read, local tests/builds, safe file edits in approved paths, local docs generation" },
      { id: "approval_tools", label: "Which tools require approval?", default: "push/merge/deploy, production data, secrets/env, billing, auth policy, cloud mutation, provider dashboards, destructive commands" },
      { id: "forbidden_tools", label: "Which tools/actions are forbidden?", default: "secret exfiltration, prod destructive ops without scoped approval, bypassing CI/proof, claiming live telemetry from demo data" },
      { id: "pre_tool_hooks", label: "What hooks run before tool use?", default: "risk classify, Red Zone check, context/Graphify prerequisite check, sandbox/permission check" },
      { id: "post_edit_hooks", label: "What hooks run after file edits?", default: "format/lint/typecheck/test selection, graph freshness if cross-file, code smell scan, proof artifact update" },
      { id: "tool_audit_log", label: "What tool usage must be logged?", default: "tool name, args summary, risk class, approval ID if any, output digest, artifacts written" },
    ],
  },
  {
    id: "sandbox_manager",
    title: "Sandbox manager",
    questions: [
      { id: "execution_isolation", label: "Should each task run in a worktree, container, VM, or local repo?", default: "worktree per risky task; container/VM for untrusted or dependency-heavy runs; local repo for low-risk docs/read-only work" },
      { id: "filesystem_roots", label: "What filesystem roots are allowed?", default: "repo root and generated run packet only; no home/secrets/prod paths without approval" },
      { id: "network_policy", label: "Is network access allowed?", default: "read-only/public network by default; provider mutation/webhooks/prod endpoints require approval" },
      { id: "secrets_policy", label: "Are secrets available? If yes, which and under what approval?", default: "no secrets by default; scoped ephemeral secrets only after Red Zone approval" },
      { id: "sandbox_cleanup", label: "What cleanup happens after a run?", default: "preserve run packet/artifacts, clean temp files/worktrees when merged/closed, record leftover risk" },
      { id: "sandbox_escape_proof", label: "What proves the sandbox was not escaped?", default: "artifact-root validation, path/symlink checks, command cwd log, allowed-root audit, denied access events" },
    ],
  },
  {
    id: "model_routing",
    title: "Model routing",
    questions: [
      { id: "lane_model_policy", label: "Which model/provider should handle which lane?", default: "cheap/fast model for simple docs; stronger reasoning model for architecture, security, incident, eval, cross-file refactor, high-risk work" },
      { id: "strong_model_required_for", label: "What tasks require the strongest model?", default: "hard-to-reverse architecture, security/auth/billing/data, production incidents, agent eval design, ambiguous multi-system debugging" },
      { id: "cheap_model_allowed_for", label: "What tasks can use cheaper models?", default: "summaries, formatting, low-risk docs, simple deterministic edits after plan is approved" },
      { id: "model_fallback_path", label: "What is the fallback path if a model fails?", default: "retry once, switch provider/model, reduce context, escalate with failure reason and cost impact" },
      { id: "model_logging", label: "What model choices must be logged?", default: "provider/model, reason selected, cost/latency estimate, fallback/escalation, eval outcome when applicable" },
      { id: "model_quality_gate", label: "What model/cost quality threshold blocks completion?", default: "model failed required eval, exceeded budget without approval, or used an unapproved model for Red Zone/security work" },
    ],
  },
  {
    id: "ai_economics",
    title: "AI economics ledger",
    questions: [
      { id: "run_budget", label: "What budget applies per task/run/day/team?", default: "project-specific budget with approval for overage; track by run, lane, model, and human review time" },
      { id: "token_tracking", label: "Should token usage be tracked?", default: "yes for all model calls when provider telemetry is available; estimate otherwise" },
      { id: "human_review_tracking", label: "Should human review time be tracked?", default: "yes for high-risk/production work and background PR agents" },
      { id: "retry_cost_limit", label: "What retry-loop cost is unacceptable?", default: "repeated failures without new evidence, high token burn with no passing proof, or loops past retry limit" },
      { id: "spend_approval_policy", label: "What model/tool spend requires approval?", default: "large model batches, long-running agents, paid provider mutation, load tests, cloud resource changes" },
      { id: "cost_handoff", label: "What cost report should appear in handoff?", default: "models/tools used, rough token/cost, retries, human review time, waste loops avoided, budget exceptions" },
    ],
  },
  {
    id: "background_pr_agents",
    title: "Background PR agents",
    questions: [
      { id: "background_agents_allowed", label: "Can agents work asynchronously in the background?", default: "allowed for scoped issues with run packet, branch/worktree, budget, and reviewer" },
      { id: "agent_branch_policy", label: "Can agents create branches?", default: "yes for approved scoped tasks; branch name must include run/issue ID" },
      { id: "agent_pr_policy", label: "Can agents open PRs?", default: "yes when tests/proof/evals pass and PR includes run packet + risk/handoff" },
      { id: "background_pr_reviewer", label: "Who reviews background-agent PRs?", default: "code owner plus domain/security/cloud reviewer when touched" },
      { id: "background_pr_proof", label: "What proof must be attached before PR open?", default: "plan, diff summary, tests/evals/build, proof artifacts, cost, risk, rollback, screenshots/logs when useful" },
      { id: "stale_agent_cleanup", label: "When should stale/failed agent branches be closed?", default: "no progress after SLA, failing proof with no recovery, superseded task, or human cancellation" },
    ],
  },
  {
    id: "interop_mcp_a2a",
    title: "MCP / A2A interoperability",
    questions: [
      { id: "mcp_required", label: "Should this repo expose Valdris MCP tools?", default: "yes when external agents need live tool access; otherwise CLI bridge is acceptable for v0" },
      { id: "mcp_tools", label: "Which uash.* tools should exist?", default: "uash.start_run, uash.enter_node, uash.write_artifact, uash.fire_gate, uash.request_approval, uash.finish_line_check" },
      { id: "agent_runtimes", label: "What agent runtimes are allowed to connect?", default: "Claude Code, Codex, Hermes, OpenCode/Copilot if authenticated and policy-compatible" },
      { id: "a2a_needed", label: "Do we need A2A agent cards/capability discovery?", default: "needed for multi-agent/vendor-interoperable deployments; optional for local single-runtime MVP" },
      { id: "interop_auth_roots", label: "What auth/roots/tool permissions apply?", default: "least-privilege roots, scoped tokens, per-tool risk classes, Red Zone approval for mutation" },
      { id: "live_event_definition", label: "What counts as a real live connector event?", default: "event emitted by bridge/MCP/API/CLI/watched artifact from an active run; never static docs/demo data" },
    ],
  },
  {
    id: "production_agent_lifecycle",
    title: "Production-agent lifecycle",
    questions: [
      { id: "deploys_agents", label: "Does this team deploy agents, not just code?", default: "yes if prompts/tools/models/memory/evals run in production user workflows" },
      { id: "agent_definition", label: "What is an agent definition here?", default: "prompt/instructions, model route, tools, skills, memory policy, eval suite, owner, deployment environment" },
      { id: "agent_lifecycle_states", label: "What states exist for agents?", default: "draft, eval, canary, active, degraded, deprecated, rolled-back" },
      { id: "agent_promotion_gate", label: "What eval gates promote an agent?", default: "offline eval pass, safety/behavior checks, cost threshold, canary/observability, human approval for high-risk agents" },
      { id: "agent_observability", label: "What monitoring proves an agent is safe in production?", default: "success/failure rate, tool errors, user escalations, cost, latency, eval drift, incidents, sampled transcripts with privacy controls" },
      { id: "agent_rollback_owner", label: "Who owns rollback?", default: "agent/runtime owner plus production on-call or product owner" },
    ],
  },
  {
    id: "team_harness_registry",
    title: "Team harness registry",
    questions: [
      { id: "harness_owner", label: "Who owns the harness for this repo?", default: "technical owner / platform owner" },
      { id: "prompt_owner", label: "Who owns prompts/front doors?", default: "AI/runtime owner with code owner review" },
      { id: "eval_owner", label: "Who owns evals?", default: "AI/product owner plus domain reviewer" },
      { id: "connector_owner", label: "Who owns connectors/MCP/bridge integrations?", default: "platform/runtime owner" },
      { id: "harness_change_approval", label: "Who approves harness changes?", default: "harness owner; security/cloud owners for Red Zone policies" },
      { id: "harness_drift_check", label: "What drift check detects stale harness docs/gates?", default: "scheduled verifier checks generator output, Graphify freshness, docs/adapters version, missing eval/skill/tool registry owners" },
    ],
  },
  {
    id: "human_agent_protocol",
    title: "Human-agent operating protocol",
    questions: [
      { id: "decision_owner", label: "Who is the decision owner?", default: "primary operator unless a lane-specific owner is set" },
      { id: "normal_pr_reviewer", label: "Who reviews normal PRs?", default: "code owner or technical maintainer" },
      { id: "specialist_reviewers", label: "Who reviews security/auth/billing/cloud/data changes?", default: "security owner for auth/data/secrets, cloud owner for infra, billing owner for payments, product owner for customer-facing behavior" },
      { id: "escalation_path", label: "What is the escalation path?", default: "agent -> primary operator -> lane owner -> decision owner; Red Zone blocks until human approval" },
      { id: "blocked_agent_sla", label: "What is the SLA for blocked agents?", default: "15 minutes for local operator work, next business day for async team review unless incident/severity overrides" },
      { id: "human_contact_channels", label: "What channels should agents use to ask humans?", default: "platform comments/PR, Linear/GitHub issue, Slack/Telegram/email as configured; record answer in run packet" },
      { id: "approval_contract", label: "What does approval have to include?", default: "scope, run ID, artifact path, approver, expiry if temporary, risk accepted, exact action allowed" },
    ],
  },
];

function parseArgs(argv) {
  const args = { repo: process.cwd(), out: "generated-harness", answers: null, projectName: null, printQuestions: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--answers") args.answers = argv[++i];
    else if (arg === "--project-name") args.projectName = argv[++i];
    else if (arg === "--print-questions") args.printQuestions = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Universal Agentic SDLC Harness commissioning v${VERSION}\n\nUsage:\n  node scripts/commission-harness.mjs --repo /path/to/repo --project-name "My App" --out ./generated-harness\n  node scripts/commission-harness.mjs --print-questions\n\nOptions:\n  --repo <path>          Repo to scan. Defaults to cwd.\n  --out <path>           Output harness pack directory. Defaults to generated-harness.\n  --answers <json>       Optional answers JSON file. Missing values are asked interactively.\n  --project-name <name>  Project name.\n  --yes                  Non-interactive: use defaults for missing answers.\n  --print-questions      Print the commissioning question bank and exit.\n`);
}

function exists(repo, file) {
  return fs.existsSync(path.join(repo, file));
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function detectRepo(repo) {
  const packageJson = readJsonIfExists(path.join(repo, "package.json"));
  const scripts = packageJson?.scripts ?? {};
  const has = (cmd) => typeof scripts[cmd] === "string";
  const packageManager = exists(repo, "pnpm-lock.yaml") ? "pnpm" : exists(repo, "yarn.lock") ? "yarn" : exists(repo, "package-lock.json") ? "npm" : "npm";
  const run = packageManager === "npm" ? "npm run" : `${packageManager}`;
  const npmExec = packageManager === "npm" ? "npm install" : `${packageManager} install`;
  const hasRequirements = exists(repo, "requirements.txt");
  const hasPyproject = exists(repo, "pyproject.toml");
  const hasPython = hasPyproject || hasRequirements;
  const frameworks = [];
  if (exists(repo, "next.config.ts") || exists(repo, "next.config.js")) frameworks.push("Next.js");
  if (exists(repo, "vite.config.ts") || exists(repo, "vite.config.js")) frameworks.push("Vite");
  if (hasPython) frameworks.push("Python");
  if (exists(repo, ".github/workflows")) frameworks.push("GitHub Actions");
  if (exists(repo, "Dockerfile") || exists(repo, "docker-compose.yml")) frameworks.push("Docker");
  if (exists(repo, "infra") || exists(repo, "terraform") || exists(repo, "cdk.json")) frameworks.push("IaC/infra");
  const role = [
    exists(repo, "app") || exists(repo, "pages") || exists(repo, "components") ? "frontend" : null,
    hasPython ? "backend/python" : null,
    exists(repo, "api") || exists(repo, "server") ? "backend/api" : null,
    exists(repo, "infra") || exists(repo, "terraform") || exists(repo, "cdk.json") ? "infra/platform" : null,
    exists(repo, "docs") ? "docs" : null,
  ]
    .filter(Boolean)
    .join(" + ") || "mixed/unknown";
  return {
    repoPath: path.resolve(repo),
    packageManager,
    frameworks,
    scripts,
    detectedRepoRole: role,
    detectedInstall: packageJson
      ? npmExec
      : hasRequirements
        ? "python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt"
        : hasPyproject
          ? "python3 -m venv .venv && . .venv/bin/activate && pip install -e ."
          : "project-specific",
    detectedLint: has("lint") ? `${run} lint` : "project-specific",
    detectedTypecheck: has("typecheck") ? `${run} typecheck` : exists(repo, "tsconfig.json") ? "npx tsc --noEmit" : "project-specific",
    detectedTest: has("test") ? `${run} test` : hasPython ? "pytest" : "project-specific",
    detectedBuild: has("build") ? `${run} build` : "project-specific",
  };
}

function questionList() {
  return QUESTION_GROUPS.flatMap((group) => group.questions.map((question) => ({ group: group.id, groupTitle: group.title, ...question })));
}

function defaultFor(question, detected, args) {
  if (question.defaultFrom === "projectName") return args.projectName || path.basename(detected.repoPath);
  if (question.defaultFrom && detected[question.defaultFrom]) return detected[question.defaultFrom];
  return question.default ?? "";
}

async function collectAnswers(args, detected) {
  const provided = args.answers ? readJsonIfExists(args.answers) : {};
  if (args.answers && !provided) throw new Error(`Could not parse answers JSON: ${args.answers}`);
  const answers = { ...(provided ?? {}) };
  if (args.projectName && !answers.project_name) answers.project_name = args.projectName;

  if (args.yes || !process.stdin.isTTY) {
    for (const question of questionList()) {
      if (!answers[question.id]) answers[question.id] = defaultFor(question, detected, args);
    }
    return answers;
  }

  const rl = readline.createInterface({ input, output });
  try {
    for (const group of QUESTION_GROUPS) {
      console.log(`\n## ${group.title}`);
      for (const question of group.questions) {
        if (answers[question.id]) continue;
        const fallback = defaultFor(question, detected, args);
        const response = await rl.question(`${question.label} [${fallback}]: `);
        answers[question.id] = response.trim() || fallback;
      }
    }
  } finally {
    rl.close();
  }
  return answers;
}

function yamlValue(value) {
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(", ")}]`;
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function toYaml(obj, indent = 0) {
  const pad = " ".repeat(indent);
  return Object.entries(obj)
    .map(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return `${pad}${key}:\n${toYaml(value, indent + 2)}`;
      }
      if (Array.isArray(value) && value.every((item) => typeof item === "object")) {
        return `${pad}${key}:\n${value.map((item) => `${pad}  -\n${toYaml(item, indent + 4)}`).join("\n")}`;
      }
      return `${pad}${key}: ${yamlValue(value)}`;
    })
    .join("\n");
}

function splitList(value) {
  return String(value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, content) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function renderAgents(answers) {
  return `# ${answers.project_name} Agent Instructions\n\nThis repo is commissioned into the Universal Agentic SDLC Harness. Use this file as the Codex/agent front door.\n\n## Start here\n\n1. Read \`00_MAP.md\`.\n2. Read \`CONTEXT.md\`.\n3. Read \`docs/Good Looks Like Foundation.md\`, \`docs/Code Quality Guardrails.md\`, and \`docs/Enterprise Proof Bank.md\` before architecture, infra, feature, or refactor work.\n4. Read \`docs/Operating Intelligence Layer.md\` before AI/runtime/tooling/model/eval/memory work.\n5. Run or verify Graphify/code graph before codebase, architecture, refactor, debugging, or cross-file implementation work: \`node scripts/graphify-scan.mjs --repo . && node scripts/graphify-gate.mjs --repo . && node scripts/anchor-gate.mjs --repo .\` when scripts are available.\n6. For Codex live runs, also read \`docs/Codex Runtime Prompt.md\` when a RUN_ID/BRIDGE_URL is supplied.\n7. Route to the smallest matching lane family.\n8. Create or update a run packet before risky, ambiguous, architecture-impacting, production-impacting, or handoff-heavy work.\n\n## Human operating style\n\n- Primary operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Autonomy: ${answers.autonomy_level}\n- Avoid: ${answers.annoyances}\n\n## Source-of-truth order\n\n${answers.truth_order}\n\nWhen sources conflict, stop before Red Zone actions and ask ${answers.approval_owner}.\n\n## Parent taxonomy\n\nThe parent product is **Agentic SDLC Harness**. System design, production readiness, cloud/platform, QA/release, security, reliability, and self-healing are lane families inside the SDLC lifecycle.\n\n## Red Zone\n\nRead-only investigation is allowed: ${answers.read_only_allowed}.\n\nExplicit approval required before: ${answers.red_zone_actions}.\n\n## Finish line\n\nDone means: ${answers.done_definition}.\n\nNever claim done without proof artifacts, skip reasons for irrelevant nodes, and a human-readable handoff.\n`;
}

function renderClaude(answers) {
  return `# ${answers.project_name} Claude Code Harness\n\nYou are inside a Universal Agentic SDLC Harness commissioned repo.\n\n## Required flow\n\n\`intake -> route -> graphify -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`\n\nAsk commissioning questions only when \`project-adapter.json\` is missing or incomplete. Once the adapter exists, use it as repo-specific context and avoid re-asking stable facts.\n\n## Mode rule\n\nSeparate Blueprint, Live Run, and Replay. Do not imply live telemetry unless real connector/MCP/CLI/API/watched-artifact events exist.\n\n## Required artifacts\n\n- \`run/intake.json\`\n- \`run/route.json\`\n- \`graph/graph.json\` from Graphify/code-graph scan, or explicit skip reason for docs-only/non-code work\n- \`graph/freshness.json\` proving graph commit/freshness\n- \`design/anchors.json\` for codebase claims and blast-radius reasoning\n- \`design/system_design.md\` when architecture/product/infra tradeoffs matter\n- \`production/layer-assessment.json\` for production-impacting work\n- \`cloud/service-map.json\` for cloud/platform work, or \`cloud/skip.json\` with reason\n- \`approvals/redzone.json\` when Red Zone applies\n- \`qa/qa-plan.md\` when validation scope matters\n- \`qa/break-it-results.md\` for feature/bug/refactor/security/cloud/integration work, or skip reason\n- \`proof/proof.json\` before done\n- \`smoke/smoke_proof.json\` for deployed/provider/runtime behavior, or skip reason\n- \`self_heal/self_heal_report.md\` if the harness/process failed\n- \`handoff/final.md\` for the final answer\n\n## Response contract\n\nUse: Bottom line, Why, Proof, Risk, Fix/Plan, Your call. Keep process narration out of the final answer.\n`;
}

function renderClaudeCommand(answers) {
  return `# ${answers.project_name} / Valdris SDLC Harness\n\nUse this slash command when the user wants Claude Code to work under the Valdris SDLC Harness.\n\n## Required inputs\n\nThe user should provide:\n\n\`RUN_ID=<run-id>\`\n\`BRIDGE_URL=http://127.0.0.1:8787\`\n\`<task text>\`\n\nIf RUN_ID is missing, ask for it before changing files. Do not invent one.\n\n## Runtime protocol\n\n1. Read \`project-adapter.json\`, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`.\n2. Follow the node flow: \`intake -> route -> graphify -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`.\n3. Emit a bridge event before/after every node, gate, artifact, approval, skip, failure, and completion.\n4. Use explicit skip reasons for irrelevant nodes.\n5. Use failure reasons plus recovery paths for failed nodes.\n6. Do not emit \`run.completed\` until proof exists and every required node is passed or skipped with a reason. The bridge should reject early completion.\n\n## Event command\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake "Claude Code started harness intake" --artifact run/intake.json --status ok --actor claude-code --mode live --source bridge\n\`\`\`\n\nCommissioned packs include \`scripts/uash-emit-event.mjs\`; run event commands from the generated pack root or from a repo where that script has been installed.\n\nRed Zone approval request example:\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required" --artifact approvals/redzone.json --status needs_approval --actor harness --mode live --source bridge --approval-owner "${answers.approval_owner}" --approval-scope "redzone"\n\`\`\`\n\nOnly a human approval event may grant/deny approval:\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone "Human approved scoped Red Zone action" --artifact approvals/redzone.json --status ok --actor human --mode live --source bridge --approval-owner "${answers.approval_owner}" --approval-scope "redzone"\n\`\`\`\n\n## Final answer\n\nBottom line, Why, Proof, Risk, Fix/Plan, Your call, Lane taken, Gates/artifacts, Skipped nodes/reasons, Self-heal needed/opened.\n`;
}

function renderCodexPrompt(answers) {
  return `# ${answers.project_name} Codex Runtime Prompt\n\nCodex should treat \`AGENTS.md\` as the primary front door and this file as the copy/paste run prompt when a specific harness run is started.\n\n## Start protocol\n\n1. Read \`AGENTS.md\`, \`project-adapter.json\`, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`.\n2. Classify the task into the smallest matching lane family.\n3. Use the flow: \`intake -> route -> graphify -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`.\n4. Emit real bridge events when RUN_ID and BRIDGE_URL are provided; otherwise write the same artifacts locally and say telemetry is not live.\n5. Never claim done until proof exists and every required node is passed or skipped with an explicit reason.\n\n## Event command shape\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" <event-type> <node-id> "<message>" \\\n  --artifact <path> \\\n  --status <ok|warn|blocked|skipped|failed|needs_approval> \\\n  --actor codex \\\n  --mode live \\\n  --source bridge \\\n  [--artifact-root "$PWD"] \\\n  [--approval-owner "..."] \\\n  [--approval-scope "..."] \\\n  [--skip-reason "..."] \\\n  [--failure-reason "..."] \\\n  [--recovery-path "..."] \\\n  [--self-heal-pr-url "..."]\n\`\`\`\n\n## Red Zone approval events\n\nAgents may request approval, but only a human approval event may grant or deny it.\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required" \\\n  --artifact approvals/redzone.json \\\n  --status needs_approval \\\n  --actor codex \\\n  --mode live \\\n  --source bridge \\\n  --approval-owner "${answers.approval_owner}" \\\n  --approval-scope "redzone"\n\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone "Human approved scoped Red Zone action" \\\n  --artifact approvals/redzone.json \\\n  --status ok \\\n  --actor human \\\n  --mode live \\\n  --source bridge \\\n  --approval-owner "${answers.approval_owner}" \\\n  --approval-scope "redzone"\n\`\`\`\n\n## Required handoff\n\nBottom line, Why, Proof, Risk, Fix/Plan, Your call, Lane taken, Gates/artifacts, Skipped nodes/reasons, Self-heal needed/opened.\n`;
}

function renderMap(answers, detected) {
  return `# ${answers.project_name} Harness Map\n\nGenerated by Universal Agentic SDLC Harness commissioning v${VERSION}.\n\n## Product identity\n\n- Users/customers: ${answers.users}\n- Production means: ${answers.production_definition}\n- Worst agent failure: ${answers.worst_agent_failure}\n\n## Detected repo shape\n\n- Repo path: \`${detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${detected.frameworks.length ? detected.frameworks.join(", ") : "none detected"}\n- Package manager: ${detected.packageManager}\n\n## Universal flow\n\n\`request -> intake -> route -> graphify/code graph -> design anchors -> system design -> production readiness -> implementation -> QA/proof/smoke -> handoff -> self-heal\`\n\n## Lane families\n\n${DEFAULT_LANE_FAMILIES.map((lane) => `- ${lane}`).join("\n")}\n\n## Enabled lanes\n\n${splitList(answers.enabled_lanes).map((lane) => `- ${lane}`).join("\n")}\n\nCustom lanes: ${answers.custom_lanes}.\n\n## Production Readiness Layer Pack\n\n${splitList(answers.production_layers).map((lane) => `- ${lane}`).join("\n")}\n`;
}

function renderContext(answers) {
  return `# ${answers.project_name} Context Router\n\nUse this after \`00_MAP.md\`. Pick the smallest matching lane and load only the docs needed for that risk area.\n\n## Router\n\n| If the request is about | Use lane | Gate emphasis |\n|---|---|---|\n| Normal bug, feature, UI, backend, API, PR | engineering-default | design anchors + proof |\n| New architecture, API/data model, scale, tradeoffs | system-design | SDD/ADR + anchors |\n| Production readiness, deployability, real full-stack layers | production-readiness | layer assessment + skip reasons |\n| AWS/Azure/GCP/Vercel/Supabase infra, deploy, IAM, secrets | cloud-platform | service map + approval + rollback/live smoke |\n| Production/user-facing incident | incidents | runtime evidence + Red Zone |\n| Data, schema, migrations, auth/RLS | data | migration/schema proof + Red Zone |\n| Security, billing, auth, permissions | security | human approval + security checklist |\n| QA, release, regression, smoke | qa-release | QA plan + break-it + live smoke |\n| Docs, process, harness changes | docs-product | coherence + review + no fake telemetry |\n\n## Safe edit paths\n\n${answers.safe_edit_paths}\n\n## Review-required paths\n\n${answers.review_required_paths}\n\n## Branch/deploy model\n\n- Default work branch: ${answers.default_work_branch}\n- Staging: ${answers.staging_branch}\n- Production: ${answers.production_branch}\n- Merge/deploy owner: ${answers.merge_owner}\n- Deployment proof: ${answers.deployment_proof}\n\n## System design triggers\n\n${answers.system_design_triggers}\n\n## ADR policy\n\n${answers.adr_policy}\n`;
}

function renderValidation(answers) {
  return `# Validation Commands\n\nAgents must run the relevant commands and attach proof before claiming done.\n\n| Check | Command |\n|---|---|\n| Install | \`${answers.install_command}\` |\n| Lint | \`${answers.lint_command}\` |\n| Typecheck | \`${answers.typecheck_command}\` |\n| Test | \`${answers.test_command}\` |\n| Build | \`${answers.build_command}\` |\n| Smoke/e2e | \`${answers.smoke_command}\` |\n\n## Done definition\n\n${answers.done_definition}.\n\n## Finish-line rule\n\nEvery required node must be passed or skipped with an explicit reason. Failed nodes need a recovery path.\n`;
}

function renderRedZone(answers) {
  return `# Red Zone Rules\n\nRead-only investigation allowed without asking: ${answers.read_only_allowed}.\n\nExplicit human approval owner: ${answers.approval_owner}.\n\nApproval required before:\n\n${splitList(answers.red_zone_actions).map((action) => `- ${action}`).join("\n")}\n\nIf an action is ambiguous, treat it as Red Zone and ask.\n`;
}

function renderGraphify(answers) {
  return `# Graphify / Code Graph\n\nGraphify/code graph is a first-class harness node, not optional background context.\n\n## Policy\n\n${answers.code_graph}.\n\n## Required artifacts\n\n- \`graph/graph.json\` — repo topology/code graph artifact.\n- \`graph/freshness.json\` — git commit/freshness proof for the graph.\n- \`design/anchors.json\` — code anchors the agent must cite before architecture, refactor, debugging, or cross-file implementation claims.\n\n## Commands\n\n\`\`\`bash\nnode scripts/graphify-scan.mjs --repo .\nnode scripts/graphify-gate.mjs --repo .\nnode scripts/anchor-gate.mjs --repo .\n\`\`\`\n\nIf an external Graphify service is configured, its adapter may replace the local scanner, but the artifact contract stays the same. Never claim external Graphify ran unless it did.\n\n## Skip rule\n\nOnly docs-only/non-code runs may skip this node, and the run must emit \`node.skipped\` for \`graphify\` and \`design-anchors\` with explicit reasons.\n`;
}

function renderProductionReadiness(answers) {
  return `# Production Readiness Layers\n\nFor every run, classify which production layers are touched. Relevant layers become required gates; irrelevant layers are skipped with reasons.\n\n${splitList(answers.production_layers).map((layer) => `- ${layer}`).join("\n")}\n\n## Skip policy\n\n${answers.production_layer_skip_policy}\n\n## Required proof\n\n${answers.production_readiness_proof}\n`;
}

function renderCloudPlatform(answers) {
  return `# Cloud / Platform Engineering\n\n## Providers\n\n${answers.cloud_providers}\n\n## Services in scope\n\n${answers.cloud_services}\n\n## IaC / manual policy\n\n${answers.iac_model}\n\n## Observability proof\n\n${answers.observability_model}\n\n## Cost / rollback policy\n\n${answers.cost_rollback_policy}\n\n## Cloud/platform subchecks\n\nThese are subchecks inside the base bridge node \`cloud-platform\`; record their results in \`cloud/service-map.json\` or related cloud artifacts. Do not emit them as bridge \`nodeId\` values unless a future adapter explicitly registers custom nodes.\n\n- cloud-intake\n- aws-service-map\n- iam-secrets-check\n- networking-check\n- iac-diff-check\n- deploy-plan\n- observability-proof\n- cost-risk-check\n- rollback-plan\n- live-smoke\n- runbook-update\n`;
}

function renderQaSmoke(answers) {
  return `# QA and Live Smoke\n\n## QA plan policy\n\n${answers.qa_plan_policy}\n\n## Let's-break-it QA\n\n${answers.break_it_qa_policy}\n\nRequired artifact: \`qa/break-it-results.md\`.\n\n## Live smoke criteria\n\n${answers.live_smoke_criteria}\n\nRequired artifact when applicable: \`smoke/smoke_proof.json\`.\n`;
}

function renderModes(answers) {
  return `# Blueprint / Live Run / Replay Modes\n\n${answers.telemetry_mode_policy}\n\n## Rule\n\n- Blueprint explains topology only.\n- Live Run uses real connector/MCP/CLI/API/watched-artifact events.\n- Replay uses stored run packets/events/artifacts.\n\nNever imply fake live telemetry.\n`;
}

function renderSelfHealing(answers) {
  return `# Harness Self-Healing Loop\n\nCan agents propose/open self-healing PRs: ${answers.self_heal_allowed}.\n\nSelf-heal PR target areas: ${answers.self_heal_pr_target}.\n\n## When to trigger\n\nTrigger self-heal when a run exposes:\n\n- repo adapter gap\n- lane procedure gap\n- gate policy gap\n- connector/telemetry bug\n- docs/onboarding gap\n- missing validation command\n- missing Red Zone rule\n- missing production-readiness layer\n\nRequired artifact: \`self_heal/self_heal_report.md\`.\n`;
}

function renderGoodLooksLike(answers) {
  return `# Good Looks Like / Foundation Blueprint\n\nThis document is the anti-spaghetti north star for the repo. Agents should compare proposed work against this baseline before adding more code.\n\n## Target architecture style\n\n${answers.target_architecture_style}\n\n## Reference architecture / golden path\n\n${answers.reference_architecture}\n\n## Foundation layers required before serious feature velocity\n\n${splitList(answers.foundation_layers).map((layer) => `- ${layer}`).join("\n")}\n\n## Weak-foundation warning signs\n\n${splitList(answers.bad_foundation_signals).map((signal) => `- ${signal}`).join("\n")}\n\n## Normal feature golden path\n\n${answers.golden_path}\n\n## Foundation decision owner\n\n${answers.foundation_decision_owner}\n\n## Rule\n\nIf feature work requires more spaghetti to ship, stop and propose a foundation fix first.\n`;
}

function renderCodeQualityGuardrails(answers) {
  return `# Code Quality Guardrails\n\nUse this as the maintainability / anti-spaghetti review contract. A code smell is a hypothesis, not a verdict: prove impact, then make the smallest safe fix.\n\n## Module boundaries\n\n${answers.module_boundaries}\n\n## Dependency direction\n\n${answers.dependency_rules}\n\n## Smells that block or trigger review\n\n${splitList(answers.anti_spaghetti_rules).map((rule) => `- ${rule}`).join("\n")}\n\n## Complexity budget\n\n${answers.complexity_budget}\n\n## Refactor triggers\n\n${answers.refactor_triggers}\n\n## Maintainability proof\n\n${answers.quality_gate_proof}\n\n## Required review output\n\n- Boundary touched\n- Risk introduced or removed\n- Tests/proof at the right layer\n- Any duplication/fallback/circular dependency found\n- Smallest safe refactor if the boundary is degrading\n`;
}

function renderEnterpriseProofBank(answers) {
  return `# Enterprise Proof Bank\n\nThis file answers: “what does good look like?” for production-grade work. Do not accept toy proof for serious builds.\n\n## Domain pack\n\n${answers.domain_pack}\n\n## Teaching artifacts\n\n${splitList(answers.good_looks_like_artifacts).map((artifact) => `- ${artifact}`).join("\n")}\n\n## Scale / concurrency bar\n\n${answers.scale_bar}\n\n## Observability bar\n\n${answers.observability_bar}\n\n## Rollback / recovery bar\n\n${answers.rollback_bar}\n\n## Universal proof dimensions\n\n- Functional correctness\n- Scale / concurrency\n- Reliability / recovery\n- Security / auth / data boundaries\n- Data integrity\n- Observability\n- Cost / FinOps\n- Performance\n- Domain-specific proof\n- Live smoke\n- Operator handoff\n`;
}

function renderOperatingIntelligence(answers) {
  return `# Operating Intelligence Layer\n\nThis is the maturity layer above the basic control-plane skeleton: evals, trajectory, context, skills, memory, tools, sandboxing, model routing, economics, PR agents, interop, and production-agent lifecycle.\n\n## Eval gate\n\n- Required for: ${answers.eval_required_for}\n- Dataset owner: ${answers.eval_dataset_owner}\n- Blocking threshold: ${answers.eval_acceptance_threshold}\n- Run location: ${answers.eval_run_location}\n- Artifacts: ${answers.eval_artifacts}\n\n## Trajectory evaluation\n\n- Bad trajectory: ${answers.bad_agent_trajectory}\n- Retry/loop limit: ${answers.retry_loop_limit}\n- Forbidden sequences: ${answers.forbidden_tool_sequences}\n- Score dimensions: ${answers.trajectory_scores}\n- Artifacts: ${answers.trajectory_artifacts}\n\n## Context manifest / ICM\n\n- Always loaded: ${answers.always_load_context}\n- Lane/task context: ${answers.lane_context_rules}\n- Approval-required context: ${answers.approval_required_context}\n- Stale/conflict policy: ${answers.stale_context_policy}\n- Budget: ${answers.context_budget}\n- Artifacts: ${answers.context_artifacts}\n\n## Skill registry\n\n- Inventory: ${answers.skill_inventory}\n- Owners/review: ${answers.skill_owner_policy}\n- Activation: ${answers.skill_activation_rules}\n- Tool permissions: ${answers.skill_tool_permissions}\n- Proof: ${answers.skill_proof}\n- Registry artifacts: ${answers.skill_registry_artifacts}\n\n## Memory substrate\n\n- Remember: ${answers.memory_should_remember}\n- Never remember: ${answers.memory_never_remember}\n- Review owner: ${answers.memory_review_owner}\n- Retention: ${answers.memory_retention_policy}\n- Handoff rule: ${answers.memory_handoff_rule}\n- Eval policy: ${answers.memory_eval_policy}\n\n## Tool registry and hooks\n\n- Free tools: ${answers.free_tools}\n- Approval tools: ${answers.approval_tools}\n- Forbidden tools: ${answers.forbidden_tools}\n- Pre-tool hooks: ${answers.pre_tool_hooks}\n- Post-edit hooks: ${answers.post_edit_hooks}\n- Audit log: ${answers.tool_audit_log}\n\n## Sandbox manager\n\n- Isolation: ${answers.execution_isolation}\n- Filesystem roots: ${answers.filesystem_roots}\n- Network: ${answers.network_policy}\n- Secrets: ${answers.secrets_policy}\n- Cleanup: ${answers.sandbox_cleanup}\n- Escape proof: ${answers.sandbox_escape_proof}\n\n## Model routing\n\n- Lane model policy: ${answers.lane_model_policy}\n- Strong model required for: ${answers.strong_model_required_for}\n- Cheap model allowed for: ${answers.cheap_model_allowed_for}\n- Fallback: ${answers.model_fallback_path}\n- Logging: ${answers.model_logging}\n- Quality gate: ${answers.model_quality_gate}\n\n## AI economics\n\n- Run budget: ${answers.run_budget}\n- Token tracking: ${answers.token_tracking}\n- Human review tracking: ${answers.human_review_tracking}\n- Retry cost limit: ${answers.retry_cost_limit}\n- Spend approval: ${answers.spend_approval_policy}\n- Cost handoff: ${answers.cost_handoff}\n\n## Background PR agents\n\n- Allowed: ${answers.background_agents_allowed}\n- Branch policy: ${answers.agent_branch_policy}\n- PR policy: ${answers.agent_pr_policy}\n- Reviewer: ${answers.background_pr_reviewer}\n- Proof: ${answers.background_pr_proof}\n- Stale cleanup: ${answers.stale_agent_cleanup}\n\n## MCP / A2A interoperability\n\n- MCP required: ${answers.mcp_required}\n- MCP tools: ${answers.mcp_tools}\n- Allowed runtimes: ${answers.agent_runtimes}\n- A2A needed: ${answers.a2a_needed}\n- Auth/roots: ${answers.interop_auth_roots}\n- Live event definition: ${answers.live_event_definition}\n\n## Production-agent lifecycle\n\n- Deploys agents: ${answers.deploys_agents}\n- Agent definition: ${answers.agent_definition}\n- States: ${answers.agent_lifecycle_states}\n- Promotion gate: ${answers.agent_promotion_gate}\n- Observability: ${answers.agent_observability}\n- Rollback owner: ${answers.agent_rollback_owner}\n`;
}

function renderTeamHarnessRegistry(answers) {
  return `# Team Harness Registry\n\n## Ownership\n\n- Harness owner: ${answers.harness_owner}\n- Prompt/front-door owner: ${answers.prompt_owner}\n- Eval owner: ${answers.eval_owner}\n- Connector owner: ${answers.connector_owner}\n- Harness change approval: ${answers.harness_change_approval}\n\n## Drift check\n\n${answers.harness_drift_check}\n\n## Registry rule\n\nPrompts, skills, evals, connectors, model routes, tools, and proof banks need owners, versions, review policy, and drift checks. If nobody owns a harness object, the agent should treat it as risky/stale.\n`;
}

function renderHumanAgentProtocol(answers) {
  return `# Human-Agent Operating Protocol\n\n## Decision and review owners\n\n- Decision owner: ${answers.decision_owner}\n- Normal PR reviewer: ${answers.normal_pr_reviewer}\n- Specialist reviewers: ${answers.specialist_reviewers}\n\n## Escalation and SLA\n\n- Escalation path: ${answers.escalation_path}\n- Blocked-agent SLA: ${answers.blocked_agent_sla}\n- Contact channels: ${answers.human_contact_channels}\n\n## Approval contract\n\n${answers.approval_contract}\n\n## Rule\n\nApprovals are durable scoped objects, not vibes. Agents may request approval; they may not grant it to themselves.\n`;
}

function renderRunTemplate(answers) {
  return `# Run Packet Template\n\nProject: ${answers.project_name}\n\n## Required artifacts\n\n- run/mode.json\n- run/intake.json\n- run/route.json\n- graph/graph.json from Graphify/code-graph scan, or graph skip reason for docs-only/non-code work\n- graph/freshness.json proving graph commit/freshness\n- design/anchors.json for codebase claims and blast-radius reasoning\n- design/system_design.md when design/architecture matters\n- production/layer-assessment.json for production-impacting work\n- cloud/service-map.json for cloud/platform work, or cloud/skip.json with reason\n- approvals/redzone.json when Red Zone applies\n- qa/qa-plan.md when validation scope matters\n- qa/break-it-results.md or explicit skip reason\n- proof/proof.json before done\n- smoke/smoke_proof.json or explicit skip reason\n- self_heal/self_heal_report.md when process/harness gap is found\n- handoff/final.md\n\n## Final handoff shape\n\nBottom line\nWhy\nProof\nRisk\nFix/Plan\nYour call\nSkipped nodes / reasons\n`;
}

function renderReview(adapter) {
  const answers = adapter.answers;
  return `# Commissioning Review Packet\n\n## Bottom line\n\nGenerated a project-specific harness pack for **${answers.project_name}** at this output directory. Agents can now load \`AGENTS.md\`, \`CLAUDE.md\`, the Claude slash command, or the Codex runtime prompt, route by \`CONTEXT.md\`, and block done on proof artifacts, skip reasons, QA/live-smoke, and self-healing checks.\n\n## What was detected\n\n- Repo: \`${adapter.detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${adapter.detected.frameworks.join(", ") || "none detected"}\n- Package manager: ${adapter.detected.packageManager}\n\n## Human-supplied operating rules\n\n- Operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Approval owner: ${answers.approval_owner}\n- Red Zone: ${answers.red_zone_actions}\n\n## v0.5 commissioning + foundation additions\n\n- Commissioning question groups: ${adapter.commissioning.questionGroups}\n- Commissioning questions: ${adapter.commissioning.questionCount}\n- Graphify/code graph policy: ${answers.code_graph}\n- System Design lane triggers: ${answers.system_design_triggers}\n- Foundation blueprint: ${answers.reference_architecture}\n- Anti-spaghetti guardrails: ${answers.anti_spaghetti_rules}\n- Enterprise proof-bank domain pack: ${answers.domain_pack}\n- Operating intelligence: evals, trajectory, context, skills, memory, tools/hooks, sandbox, model routing, economics, PR agents, MCP/A2A, agent lifecycle\n- Production layers checked: ${splitList(answers.production_layers).length}\n- Cloud/platform providers: ${answers.cloud_providers}\n- Break-it QA policy: ${answers.break_it_qa_policy}\n- Mode policy: ${answers.telemetry_mode_policy}\n- Self-heal policy: ${answers.self_heal_allowed}\n\n## Next gate\n\nReview \`project-adapter.json\` and edit any defaults that are wrong before handing the pack to Claude Code/Codex.\n`;
}

function generatePack(args, detected, answers) {
  const out = path.resolve(args.out);
  const adapter = {
    schema: "uash.project-adapter.v2",
    generatedAt: new Date().toISOString(),
    generatorVersion: VERSION,
    detected,
    answers,
    commissioning: {
      questionGroups: QUESTION_GROUPS.length,
      questionCount: questionList().length,
      version: VERSION,
    },
    laneFamilies: DEFAULT_LANE_FAMILIES,
    lanes: splitList(answers.enabled_lanes),
    redZoneActions: splitList(answers.red_zone_actions),
    codeGraph: {
      provider: "Graphify-compatible local scanner",
      policy: answers.code_graph,
      requiredArtifacts: ["graph/graph.json", "graph/freshness.json", "design/anchors.json"],
      scanCommand: "node scripts/graphify-scan.mjs --repo .",
      gateCommand: "node scripts/graphify-gate.mjs --repo . && node scripts/anchor-gate.mjs --repo .",
      skipAllowedOnlyFor: "docs-only or non-code work with explicit skip reasons for graphify and design-anchors",
    },
    productionReadiness: {
      layers: splitList(answers.production_layers),
      skipPolicy: answers.production_layer_skip_policy,
      proof: answers.production_readiness_proof,
    },
    systemDesign: {
      triggers: answers.system_design_triggers,
      requirements: answers.design_requirements,
      adrRequiredFor: answers.adr_required_for,
    },
    cloudPlatform: {
      providers: answers.cloud_providers,
      services: splitList(answers.cloud_services),
      iacModel: answers.iac_model,
      observability: answers.observability_model,
      costRollback: answers.cost_rollback_policy,
    },
    qaRelease: {
      qaPlanPolicy: answers.qa_plan_policy,
      breakItQaPolicy: answers.break_it_qa_policy,
      liveSmokeCriteria: answers.live_smoke_criteria,
    },
    foundationBlueprint: {
      architectureStyle: answers.target_architecture_style,
      referenceArchitecture: answers.reference_architecture,
      foundationLayers: splitList(answers.foundation_layers),
      badFoundationSignals: splitList(answers.bad_foundation_signals),
      goldenPath: answers.golden_path,
      decisionOwner: answers.foundation_decision_owner,
    },
    codeQualityGuardrails: {
      moduleBoundaries: splitList(answers.module_boundaries),
      dependencyRules: answers.dependency_rules,
      antiSpaghettiRules: splitList(answers.anti_spaghetti_rules),
      complexityBudget: answers.complexity_budget,
      refactorTriggers: answers.refactor_triggers,
      proof: answers.quality_gate_proof,
    },
    enterpriseProofBank: {
      domainPack: answers.domain_pack,
      goodLooksLikeArtifacts: splitList(answers.good_looks_like_artifacts),
      scaleBar: answers.scale_bar,
      observabilityBar: answers.observability_bar,
      rollbackBar: answers.rollback_bar,
    },
    operatingIntelligence: {
      evalGate: {
        requiredFor: answers.eval_required_for,
        datasetOwner: answers.eval_dataset_owner,
        threshold: answers.eval_acceptance_threshold,
        runLocation: answers.eval_run_location,
        artifacts: splitList(answers.eval_artifacts),
      },
      trajectoryGate: {
        badTrajectory: answers.bad_agent_trajectory,
        retryLoopLimit: answers.retry_loop_limit,
        forbiddenSequences: answers.forbidden_tool_sequences,
        scoreDimensions: answers.trajectory_scores,
        artifacts: splitList(answers.trajectory_artifacts),
      },
      contextManifest: {
        alwaysLoad: answers.always_load_context,
        laneRules: answers.lane_context_rules,
        approvalRequired: answers.approval_required_context,
        stalePolicy: answers.stale_context_policy,
        budget: answers.context_budget,
        artifacts: splitList(answers.context_artifacts),
      },
      skillRegistry: {
        inventory: splitList(answers.skill_inventory),
        ownerPolicy: answers.skill_owner_policy,
        activationRules: answers.skill_activation_rules,
        toolPermissions: answers.skill_tool_permissions,
        proof: answers.skill_proof,
        artifacts: splitList(answers.skill_registry_artifacts),
      },
      memory: {
        remember: answers.memory_should_remember,
        neverRemember: answers.memory_never_remember,
        reviewOwner: answers.memory_review_owner,
        retention: answers.memory_retention_policy,
        handoffRule: answers.memory_handoff_rule,
        evalPolicy: answers.memory_eval_policy,
      },
      toolRegistryHooks: {
        freeTools: answers.free_tools,
        approvalTools: answers.approval_tools,
        forbiddenTools: answers.forbidden_tools,
        preToolHooks: answers.pre_tool_hooks,
        postEditHooks: answers.post_edit_hooks,
        auditLog: answers.tool_audit_log,
      },
      sandboxManager: {
        isolation: answers.execution_isolation,
        filesystemRoots: answers.filesystem_roots,
        networkPolicy: answers.network_policy,
        secretsPolicy: answers.secrets_policy,
        cleanup: answers.sandbox_cleanup,
        escapeProof: answers.sandbox_escape_proof,
      },
      modelRouting: {
        lanePolicy: answers.lane_model_policy,
        strongModelRequiredFor: answers.strong_model_required_for,
        cheapModelAllowedFor: answers.cheap_model_allowed_for,
        fallbackPath: answers.model_fallback_path,
        logging: answers.model_logging,
        qualityGate: answers.model_quality_gate,
      },
      aiEconomics: {
        runBudget: answers.run_budget,
        tokenTracking: answers.token_tracking,
        humanReviewTracking: answers.human_review_tracking,
        retryCostLimit: answers.retry_cost_limit,
        spendApprovalPolicy: answers.spend_approval_policy,
        costHandoff: answers.cost_handoff,
      },
      backgroundPrAgents: {
        allowed: answers.background_agents_allowed,
        branchPolicy: answers.agent_branch_policy,
        prPolicy: answers.agent_pr_policy,
        reviewer: answers.background_pr_reviewer,
        proof: answers.background_pr_proof,
        staleCleanup: answers.stale_agent_cleanup,
      },
      interop: {
        mcpRequired: answers.mcp_required,
        mcpTools: splitList(answers.mcp_tools),
        agentRuntimes: splitList(answers.agent_runtimes),
        a2aNeeded: answers.a2a_needed,
        authRoots: answers.interop_auth_roots,
        liveEventDefinition: answers.live_event_definition,
      },
      productionAgentLifecycle: {
        deploysAgents: answers.deploys_agents,
        definition: answers.agent_definition,
        states: splitList(answers.agent_lifecycle_states),
        promotionGate: answers.agent_promotion_gate,
        observability: answers.agent_observability,
        rollbackOwner: answers.agent_rollback_owner,
      },
    },
    teamHarnessRegistry: {
      harnessOwner: answers.harness_owner,
      promptOwner: answers.prompt_owner,
      evalOwner: answers.eval_owner,
      connectorOwner: answers.connector_owner,
      changeApproval: answers.harness_change_approval,
      driftCheck: answers.harness_drift_check,
    },
    humanAgentProtocol: {
      decisionOwner: answers.decision_owner,
      normalPrReviewer: answers.normal_pr_reviewer,
      specialistReviewers: answers.specialist_reviewers,
      escalationPath: answers.escalation_path,
      blockedAgentSla: answers.blocked_agent_sla,
      contactChannels: answers.human_contact_channels,
      approvalContract: answers.approval_contract,
    },
    telemetryModes: {
      policy: answers.telemetry_mode_policy,
      modes: ["blueprint", "live", "replay"],
    },
    selfHealing: {
      allowed: answers.self_heal_allowed,
      target: answers.self_heal_pr_target,
    },
    nodeStateContract: {
      states: ["passed", "active", "failed", "skipped", "pending", "needs_approval"],
      skippedRequiresReason: true,
      failedRequiresRecoveryPath: true,
      finishLineRequiresAllPassedOrSkipped: true,
    },
    validation: {
      install: answers.install_command,
      lint: answers.lint_command,
      typecheck: answers.typecheck_command,
      test: answers.test_command,
      build: answers.build_command,
      smoke: answers.smoke_command,
    },
  };

  mkdirp(out);
  write(path.join(out, "project-adapter.json"), JSON.stringify(adapter, null, 2));
  write(path.join(out, "project.yaml"), toYaml(adapter));
  write(path.join(out, "AGENTS.md"), renderAgents(answers));
  write(path.join(out, "CLAUDE.md"), renderClaude(answers));
  write(path.join(out, ".claude/commands/valdris-sdlc-harness.md"), renderClaudeCommand(answers));
  write(path.join(out, "docs/Codex Runtime Prompt.md"), renderCodexPrompt(answers));
  write(path.join(out, "00_MAP.md"), renderMap(answers, detected));
  write(path.join(out, "CONTEXT.md"), renderContext(answers));
  write(path.join(out, "docs/Validation Commands.md"), renderValidation(answers));
  write(path.join(out, "docs/Red Zone Rules.md"), renderRedZone(answers));
  write(path.join(out, "docs/Graphify Code Graph.md"), renderGraphify(answers));
  write(path.join(out, "docs/Production Readiness Layers.md"), renderProductionReadiness(answers));
  write(path.join(out, "docs/Cloud Platform Engineering.md"), renderCloudPlatform(answers));
  write(path.join(out, "docs/QA and Live Smoke.md"), renderQaSmoke(answers));
  write(path.join(out, "docs/Modes Blueprint Live Replay.md"), renderModes(answers));
  write(path.join(out, "docs/Self-Healing Loop.md"), renderSelfHealing(answers));
  write(path.join(out, "docs/Good Looks Like Foundation.md"), renderGoodLooksLike(answers));
  write(path.join(out, "docs/Code Quality Guardrails.md"), renderCodeQualityGuardrails(answers));
  write(path.join(out, "docs/Enterprise Proof Bank.md"), renderEnterpriseProofBank(answers));
  write(path.join(out, "docs/Operating Intelligence Layer.md"), renderOperatingIntelligence(answers));
  write(path.join(out, "docs/Team Harness Registry.md"), renderTeamHarnessRegistry(answers));
  write(path.join(out, "docs/Human Agent Protocol.md"), renderHumanAgentProtocol(answers));
  write(path.join(out, "runs/_run-template/README.md"), renderRunTemplate(answers));
  for (const scriptName of ["uash-emit-event.mjs", "graphify-scan.mjs", "graphify-gate.mjs", "anchor-gate.mjs"]) {
    const scriptSource = path.join(SCRIPT_DIR, scriptName);
    const scriptTarget = path.join(out, "scripts", scriptName);
    mkdirp(path.dirname(scriptTarget));
    fs.copyFileSync(scriptSource, scriptTarget);
    fs.chmodSync(scriptTarget, 0o755);
  }
  write(path.join(out, "commissioning-review.md"), renderReview(adapter));
  return { out, adapter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.printQuestions) {
    console.log(JSON.stringify(QUESTION_GROUPS, null, 2));
    return;
  }
  const repo = path.resolve(args.repo);
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new Error(`Repo path not found: ${repo}`);
  const detected = detectRepo(repo);
  const answers = await collectAnswers(args, detected);
  const result = generatePack(args, detected, answers);
  console.log(`Generated Valdris SDLC harness pack: ${result.out}`);
  console.log(`Project: ${answers.project_name}`);
  console.log(`Front doors: ${path.join(result.out, "AGENTS.md")}, ${path.join(result.out, "CLAUDE.md")}, ${path.join(result.out, ".claude/commands/valdris-sdlc-harness.md")}, and ${path.join(result.out, "docs/Codex Runtime Prompt.md")}`);
  console.log(`Review packet: ${path.join(result.out, "commissioning-review.md")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
