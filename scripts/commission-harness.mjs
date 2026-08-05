#!/usr/bin/env node
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import {
  ROOT_DISCOVERY_LOADER_FILES,
  ROOT_LOADER_END,
  ROOT_LOADER_START,
  renderRootDiscoveryLoader,
} from "./discovery-loader-contract.mjs";
import { portableManifestSha256 } from "./control-gate-lib.mjs";
import {
  declaredLocalEvidenceBytes,
  validateClassificationRecordFiles,
} from "./classification-record-check.mjs";

const VERSION = "0.9.0-rc.1";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_LANE_FAMILIES = [
  "intake-classify",
  "repo-intelligence-gitnexus",
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

const CANONICAL_NODE_IDS = [
  "intake",
  "route",
  "code-intelligence",
  "design-anchors",
  "system-design",
  "production-readiness",
  "cloud-platform",
  "implement",
  "redzone",
  "qa-break-it",
  "prove",
  "live-smoke",
  "self-heal",
  "handoff",
];

const ARTIFACT_BY_NODE = {
  intake: "run/intake.json",
  route: "run/route.json",
  "code-intelligence": "graph/graph.json",
  "design-anchors": "design/anchors.json",
  "system-design": "design/system_design.md",
  "production-readiness": "production/layer-assessment.json",
  "cloud-platform": "cloud/service-map.json",
  implement: "session/events.jsonl",
  redzone: "approvals/redzone.json",
  "qa-break-it": "qa/break-it-results.md",
  prove: "proof/proof.json",
  "live-smoke": "smoke/smoke_proof.json",
  "self-heal": "self_heal/self_heal_report.md",
  handoff: "handoff/final.md",
};

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
      {
        id: "operator_name",
        label: "Who is the primary human/operator for this repo?",
        default: "project owner",
      },
      {
        id: "answer_style",
        label: "How should agents report status?",
        default: "decision packet: bottom line, proof, risk, next call",
      },
      {
        id: "autonomy_level",
        label: "How much autonomy should the agent have before asking?",
        default: "read-only + local edits allowed; ask before external writes",
      },
      {
        id: "annoyances",
        label: "What agent behavior should be avoided?",
        default:
          "long process narration, fake proof, broad rewrites, skipping validation",
      },
    ],
  },
  {
    id: "project",
    title: "Project identity",
    questions: [
      {
        id: "project_name",
        label: "Project/product name?",
        defaultFrom: "projectName",
      },
      {
        id: "users",
        label: "Who are the real users/customers?",
        default: "internal users",
      },
      {
        id: "production_definition",
        label: "What does production mean here?",
        default: "main branch / deployed customer-facing environment",
      },
      {
        id: "worst_agent_failure",
        label: "What is the worst plausible agent-caused failure?",
        default:
          "breaking production, leaking secrets, corrupting customer data, or making false live-run claims",
      },
    ],
  },
  {
    id: "source_truth",
    title: "Source of truth",
    questions: [
      {
        id: "truth_order",
        label: "When sources conflict, what is the precedence order?",
        default:
          "live system, git/GitHub, CI/deploy workflows, issue tracker, docs, chat",
      },
      {
        id: "issue_tracker",
        label: "Issue tracker / work queue?",
        default: "GitHub Issues or Linear",
      },
      {
        id: "knowledge_base",
        label: "Stable docs / knowledge base location?",
        default: "docs/ in repo",
      },
    ],
  },
  {
    id: "repo",
    title: "Repo and architecture",
    questions: [
      {
        id: "repo_role",
        label:
          "Is this repo frontend, backend, monorepo, infra, docs, or mixed?",
        defaultFrom: "detectedRepoRole",
      },
      {
        id: "safe_edit_paths",
        label: "Which paths are safe for routine agent edits?",
        default: "src/, app/, components/, lib/, tests/, docs/",
      },
      {
        id: "review_required_paths",
        label: "Which paths require human review before merge?",
        default:
          "migrations/, infra/, auth, billing, secrets, deploy workflows, cloud/provider config",
      },
      {
        id: "code_graph",
        label: "GitNexus/code-intelligence requirement?",
        default:
          "GitNexus-backed code intelligence required before codebase, debugging, architecture, refactor, or cross-file implementation work; local static graph fallback allowed only when GitNexus is unavailable and the fallback is disclosed; docs-only may skip with explicit reason",
      },
    ],
  },
  {
    id: "branch_deploy",
    title: "Branch and deploy model",
    questions: [
      {
        id: "default_work_branch",
        label: "Default base branch for normal work?",
        default: "main",
      },
      {
        id: "staging_branch",
        label: "Staging branch/environment, if any?",
        default: "none or staging",
      },
      {
        id: "production_branch",
        label: "Production branch/environment?",
        default: "main / production",
      },
      {
        id: "merge_owner",
        label: "Who is allowed to merge or deploy?",
        default: "human maintainer",
      },
      {
        id: "deployment_proof",
        label: "What proves a deploy succeeded?",
        default: "CI green + deployment dashboard/health check + smoke test",
      },
    ],
  },
  {
    id: "validation",
    title: "Validation and proof",
    questions: [
      {
        id: "install_command",
        label: "Install command?",
        defaultFrom: "detectedInstall",
      },
      {
        id: "lint_command",
        label: "Lint command?",
        defaultFrom: "detectedLint",
      },
      {
        id: "typecheck_command",
        label: "Typecheck command?",
        defaultFrom: "detectedTypecheck",
      },
      {
        id: "test_command",
        label: "Test command?",
        defaultFrom: "detectedTest",
      },
      {
        id: "build_command",
        label: "Build command?",
        defaultFrom: "detectedBuild",
      },
      {
        id: "smoke_command",
        label: "Smoke/e2e command?",
        default: "manual or project-specific",
      },
      {
        id: "done_definition",
        label: "What does done require?",
        default:
          "required commands pass, required artifacts exist, skipped nodes have reasons, human handoff is clear",
      },
    ],
  },
  {
    id: "red_zone",
    title: "Red Zone / approval boundaries",
    questions: [
      {
        id: "red_zone_actions",
        label: "Which actions require explicit human approval?",
        default:
          "push, merge, deploy, production data writes, secrets/env changes, auth, billing, destructive ops, provider config, cloud resource mutation",
      },
      {
        id: "approval_owner",
        label: "Who can approve Red Zone actions?",
        default: "primary human/operator",
      },
      {
        id: "read_only_allowed",
        label: "Are read-only investigations allowed without asking?",
        default: "yes",
      },
    ],
  },
  {
    id: "lanes",
    title: "Work lanes",
    questions: [
      {
        id: "enabled_lanes",
        label: "Which lanes should this repo use?",
        default:
          "engineering-default, system-design, production-readiness, cloud-platform, qa-release, incidents, docs-product, infra, data, security",
      },
      {
        id: "custom_lanes",
        label: "Any repo-specific lanes?",
        default: "none",
      },
      {
        id: "adr_policy",
        label: "When should an ADR/decision record be required?",
        default:
          "hard-to-reverse architecture, data, security, provider, cloud/platform, or deployment decisions",
      },
    ],
  },
  {
    id: "system_design",
    title: "System design",
    questions: [
      {
        id: "system_design_triggers",
        label: "When must the System Design lane activate?",
        default:
          "new architecture, scaling, APIs, data modeling, service boundaries, reliability tradeoffs, hard-to-reverse decisions, ambiguous product behavior",
      },
      {
        id: "design_requirements",
        label: "Which design requirements matter most?",
        default:
          "latency, throughput, SLO/SLA, scale assumptions, data integrity, security, failure modes",
      },
      {
        id: "adr_required_for",
        label: "What decisions require ADRs?",
        default:
          "API contracts, data model changes, queue/workers, provider changes, auth/security, cloud/deploy topology",
      },
    ],
  },
  {
    id: "production_readiness",
    title: "Production readiness layer pack",
    questions: [
      {
        id: "production_layers",
        label: "Which production layers should be checked per run?",
        default: PRODUCTION_LAYERS.join(", "),
      },
      {
        id: "production_layer_skip_policy",
        label: "How should irrelevant production layers be handled?",
        default: "mark skipped with explicit reason; never silently omit",
      },
      {
        id: "production_readiness_proof",
        label: "What proof should production-impacting work attach?",
        default:
          "layer assessment, tests, deploy/health check, logs/request IDs, rollback path, smoke proof",
      },
    ],
  },
  {
    id: "cloud_platform",
    title: "Cloud / platform engineering",
    questions: [
      {
        id: "cloud_providers",
        label: "Cloud/platform providers in scope?",
        default: "AWS/Azure/GCP/Vercel/Supabase as applicable",
      },
      {
        id: "cloud_services",
        label: "Key cloud services this repo may touch?",
        default:
          "ECS/Lambda/EC2/S3/RDS/VPC/IAM/CloudWatch/Route53/load balancers/queues/workers",
      },
      {
        id: "iac_model",
        label: "How are cloud resources managed?",
        default:
          "IaC preferred; console/manual changes require approval and runbook notes",
      },
      {
        id: "observability_model",
        label: "What proves observability after deploy?",
        default:
          "logs, metrics/traces, dashboards, alerts, request IDs, CloudWatch/provider links",
      },
      {
        id: "cost_rollback_policy",
        label: "How should agents handle cost/scaling/rollback risk?",
        default:
          "flag spend/scaling changes, record rollback path, require approval for paid/prod resource mutation",
      },
    ],
  },
  {
    id: "qa_release",
    title: "QA and release",
    questions: [
      {
        id: "qa_plan_policy",
        label: "When is a QA plan required?",
        default:
          "feature, bug, refactor, integration, data, auth/security, cloud/platform, voice/runtime, or production-impacting work",
      },
      {
        id: "break_it_qa_policy",
        label: "What does let’s-break-it QA require?",
        default:
          "edge cases, malformed inputs, auth negative cases, stale data, latency/retries, concurrency, provider failures, rollback path",
      },
      {
        id: "live_smoke_criteria",
        label: "When is live/preview/staging smoke required?",
        default:
          "deployed behavior, provider/webhook/voice/worker/runtime, cloud/platform, auth/data, or anything local tests cannot simulate",
      },
    ],
  },
  {
    id: "modes_self_healing",
    title: "Modes and self-healing",
    questions: [
      {
        id: "telemetry_mode_policy",
        label: "How should Blueprint, Live Run, and Replay be separated?",
        default:
          "Blueprint is static topology, Live Run uses real connector events, Replay uses stored run packets; never imply fake live telemetry",
      },
      {
        id: "self_heal_allowed",
        label: "Can agents propose/open self-healing PRs for harness gaps?",
        default: "propose by default; open only if repo policy allows",
      },
      {
        id: "self_heal_pr_target",
        label: "Where should self-heal PRs change the harness?",
        default:
          "adapter, lane docs, gates, prompts/front doors, connector scripts, commissioning questions, validation/Red Zone docs",
      },
    ],
  },
  {
    id: "foundation_blueprint",
    title: "Good looks like / foundation blueprint",
    questions: [
      {
        id: "target_architecture_style",
        label: "What architecture style should this system follow?",
        default:
          "modular monolith by default; service boundaries only where scale/team/runtime isolation proves they are needed",
      },
      {
        id: "reference_architecture",
        label:
          "What reference architecture or golden path should agents compare against?",
        default:
          "thin UI, explicit API/service layer, typed domain modules, clear data access boundary, queue/worker boundary for async work, observable deploy path",
      },
      {
        id: "foundation_layers",
        label:
          "What foundational layers must exist before serious feature velocity?",
        default:
          "auth, data model, API contracts, validation, tests, CI/CD, environment config, observability, rollback, security boundaries, runbooks, ownership",
      },
      {
        id: "bad_foundation_signals",
        label: "What signals mean the foundation is weak or risky?",
        default:
          "business logic in UI/routes, no typed contracts, no migration policy, hidden provider coupling, no observability, no rollback, duplicated workflows, unclear ownership",
      },
      {
        id: "golden_path",
        label: "What is the happy-path way to add a normal feature?",
        default:
          "issue -> GitNexus/code-intelligence + anchors -> design if needed -> typed boundary -> tests/evals -> proof -> PR/handoff",
      },
      {
        id: "foundation_decision_owner",
        label:
          "Who decides if foundation work must happen before feature work?",
        default: "technical owner / architecture reviewer",
      },
    ],
  },
  {
    id: "code_quality_guardrails",
    title: "Anti-spaghetti code quality guardrails",
    questions: [
      {
        id: "module_boundaries",
        label: "What are the core modules/domains and what owns each boundary?",
        default:
          "UI, API, domain/service logic, data access, provider adapters, jobs/workers, auth/security, observability",
      },
      {
        id: "dependency_rules",
        label: "What dependency direction rules must code follow?",
        default:
          "UI calls API/actions; API calls services; services use repositories/adapters; domain logic does not import UI/provider SDKs directly",
      },
      {
        id: "anti_spaghetti_rules",
        label: "Which code smells should block or trigger review?",
        default:
          "large god files, circular dependencies, duplicated business rules, untyped payloads, broad catch-and-ignore, silent fallbacks, mixed auth/data/provider/UI logic",
      },
      {
        id: "complexity_budget",
        label:
          "What complexity budget should trigger refactor before more features?",
        default:
          "files over ~300 lines, functions over ~60 lines, modules with 5+ reasons to change, repeated logic in 3+ places, nested conditionals agents cannot explain",
      },
      {
        id: "refactor_triggers",
        label:
          "When should agents stop and propose a refactor instead of adding more code?",
        default:
          "new change touches too many unrelated files, requires copy-paste, crosses unclear boundaries, adds another provider special case, or hides missing data",
      },
      {
        id: "quality_gate_proof",
        label: "What proof shows the code stayed maintainable?",
        default:
          "small diff, boundary explanation, tests at correct layer, no new circular deps, no broad fallbacks, code review checklist, architecture note when boundaries changed",
      },
    ],
  },
  {
    id: "enterprise_proof_banks",
    title: "Enterprise proof banks / what good looks like",
    questions: [
      {
        id: "domain_pack",
        label: "Which domain proof pack should this repo use?",
        default:
          "enterprise-web-app by default; optionally API, AI product, infra/data, growth website, serious game, voice/runtime, or custom",
      },
      {
        id: "good_looks_like_artifacts",
        label: "What artifacts teach agents what good looks like?",
        default:
          "reference architecture, service map, data model, API contract, UI states, test strategy, observability plan, rollback/runbook, example high-quality PR",
      },
      {
        id: "scale_bar",
        label: "What scale/concurrency bar should serious work assume?",
        default:
          "explicit capacity model or load test for production-impacting paths; do not assume small-app traffic unless approved",
      },
      {
        id: "observability_bar",
        label: "What observability must exist for production work?",
        default:
          "structured logs, request/run IDs, metrics/traces when available, dashboard or provider links, alert/owner, smoke evidence",
      },
      {
        id: "rollback_bar",
        label: "What rollback/recovery proof is required?",
        default:
          "rollback command or procedure, migration rollback/data recovery note, feature flag/disable path, incident owner",
      },
    ],
  },
  {
    id: "eval_gate",
    title: "Eval gate",
    questions: [
      {
        id: "eval_required_for",
        label: "What changes require AI behavior evals, not just tests?",
        default:
          "prompts, RAG/retrieval, agent tools, model/provider routing, voice/runtime behavior, recommendations, policy decisions, safety-sensitive automation",
      },
      {
        id: "eval_dataset_owner",
        label: "Who owns eval datasets/examples?",
        default: "product/AI owner plus domain reviewer",
      },
      {
        id: "eval_acceptance_threshold",
        label: "What eval score blocks merge or deploy?",
        default:
          "project-specific; default block on critical regression, unsafe answer, tool misuse, or below agreed score threshold",
      },
      {
        id: "eval_run_location",
        label: "Where should evals run?",
        default:
          "local during development and CI before merge for AI behavior changes",
      },
      {
        id: "eval_artifacts",
        label: "What eval artifacts must be attached?",
        default:
          "evals/results.json, repo-specific context case set and answer key, paired baseline/candidate uash.context-arm-result.v1 JSON files, failing examples, evaluator/config version, model/provider used",
      },
    ],
  },
  {
    id: "trajectory_gate",
    title: "Trajectory evaluation",
    questions: [
      {
        id: "bad_agent_trajectory",
        label:
          "What agent behaviors count as a bad path even if the final output passes?",
        default:
          "skipped GitNexus/code-intelligence/context, wrong tool order, excessive retries, ignored failures, unverifiable claims, unsafe shortcuts, human approval bypass attempts",
      },
      {
        id: "retry_loop_limit",
        label: "How many retries/loops are acceptable before escalation?",
        default:
          "3 focused attempts or 20 minutes without new evidence, then escalate with blocker packet",
      },
      {
        id: "forbidden_tool_sequences",
        label: "Which tool/action sequences are forbidden?",
        default:
          "write before context/graph on cross-file work; deploy before proof; approval.granted by agent; destructive action without pending human approval",
      },
      {
        id: "trajectory_scores",
        label: "What should the trajectory scorer grade?",
        default:
          "context loaded, tool selection, artifact sequence, recovery after failures, skip reasons, approval behavior, cost/retry discipline",
      },
      {
        id: "trajectory_artifacts",
        label: "What trajectory evidence must be stored?",
        default:
          "trajectory/trajectory.json, tool calls, context loads, approval events, retry/failure ledger",
      },
    ],
  },
  {
    id: "context_manifest",
    title: "Context manifest / ICM",
    questions: [
      {
        id: "always_load_context",
        label: "What context is always loaded?",
        default:
          "project adapter, source-truth order, repo map, current task/run packet, Red Zone rules, validation/proof rules",
      },
      {
        id: "lane_context_rules",
        label: "What context is loaded only by lane/task?",
        default:
          "architecture docs for design, cloud/runbooks for infra, eval sets for AI changes, security policy for auth/billing/data",
      },
      {
        id: "approval_required_context",
        label: "What context should never be loaded or used unless approved?",
        default:
          "secrets, production data, private customer data, billing/provider dashboards, sensitive logs",
      },
      {
        id: "stale_context_policy",
        label: "How should stale or conflicting context be handled?",
        default:
          "check live system/git first, mark stale docs, cite source date, ask before Red Zone decisions",
      },
      {
        id: "context_budget",
        label: "What is the token/context budget policy?",
        default:
          "load smallest sufficient lane context; summarize long docs; keep source links; fail if required context cannot fit or be retrieved",
      },
      {
        id: "context_artifacts",
        label: "What context artifacts must exist?",
        default:
          "context/manifest.json, repo-specific context cases and answer key governed by uash.context-quality-eval.v1, context/budget.json, context/sources.json, context/loaded.md",
      },
    ],
  },
  {
    id: "skill_registry",
    title: "Skill registry / progressive disclosure",
    questions: [
      {
        id: "skill_inventory",
        label: "What skills/procedures exist for this team?",
        default:
          "debugging, feature build, incident, cloud deploy, data migration, security review, eval update, release, support triage",
      },
      {
        id: "skill_owner_policy",
        label: "Who owns and reviews each skill?",
        default:
          "named technical owner per skill with review required for production-impacting skills",
      },
      {
        id: "skill_activation_rules",
        label: "When should each skill activate?",
        default:
          "by lane, file path, risk class, work type, provider touched, or user command",
      },
      {
        id: "skill_tool_permissions",
        label: "What tools is each skill allowed to use?",
        default:
          "least privilege by skill; Red Zone tools require human approval",
      },
      {
        id: "skill_proof",
        label: "What proof does each skill need to produce?",
        default:
          "skill name/version, why selected, artifacts generated, commands run, eval/tests/smoke as applicable",
      },
      {
        id: "skill_registry_artifacts",
        label: "How are skills versioned and reviewed?",
        default:
          "skills/registry.json plus per-skill SKILL.md and agents/openai.yaml",
      },
    ],
  },
  {
    id: "memory_substrate",
    title: "Memory substrate",
    questions: [
      {
        id: "memory_should_remember",
        label: "What should agents remember across runs?",
        default:
          "stable project conventions, architecture decisions, recurring pitfalls, approved workflow preferences, durable integration facts",
      },
      {
        id: "memory_never_remember",
        label: "What should never be remembered?",
        default:
          "secrets, tokens, private customer data, transient task status, stale issue IDs, unverified claims",
      },
      {
        id: "memory_review_owner",
        label: "Who can review/edit/delete memory?",
        default: "project owner or delegated maintainer",
      },
      {
        id: "memory_retention_policy",
        label: "What retention/TTL should memory have?",
        default:
          "durable facts persist; run/task details expire or stay in run packets, not long-term memory",
      },
      {
        id: "memory_handoff_rule",
        label: "What memory use must be cited in handoff?",
        default:
          "cite retrieved memory/source when it materially affected a decision or risk claim",
      },
      {
        id: "memory_eval_policy",
        label: "How do we test whether memory is helping or harming?",
        default:
          "memory regression examples, stale-memory checks, source provenance audit, human review for corrections",
      },
    ],
  },
  {
    id: "tool_registry_hooks",
    title: "Tool registry and hooks",
    questions: [
      {
        id: "free_tools",
        label: "Which tools can agents use freely?",
        default:
          "read-only repo search/read, local tests/builds, safe file edits in approved paths, local docs generation",
      },
      {
        id: "approval_tools",
        label: "Which tools require approval?",
        default:
          "push/merge/deploy, production data, secrets/env, billing, auth policy, cloud mutation, provider dashboards, destructive commands",
      },
      {
        id: "forbidden_tools",
        label: "Which tools/actions are forbidden?",
        default:
          "secret exfiltration, prod destructive ops without scoped approval, bypassing CI/proof, claiming live telemetry from demo data",
      },
      {
        id: "pre_tool_hooks",
        label: "What hooks run before tool use?",
        default:
          "risk classify, Red Zone check, context/GitNexus prerequisite check, sandbox/permission check",
      },
      {
        id: "post_edit_hooks",
        label: "What hooks run after file edits?",
        default:
          "format/lint/typecheck/test selection, graph freshness if cross-file, code smell scan, proof artifact update",
      },
      {
        id: "tool_audit_log",
        label: "What tool usage must be logged?",
        default:
          "tool name, args summary, risk class, approval ID if any, output digest, artifacts written",
      },
    ],
  },
  {
    id: "sandbox_manager",
    title: "Sandbox manager",
    questions: [
      {
        id: "execution_isolation",
        label:
          "Should each task run in a worktree, container, VM, or local repo?",
        default:
          "worktree per risky task; container/VM for untrusted or dependency-heavy runs; local repo for low-risk docs/read-only work",
      },
      {
        id: "filesystem_roots",
        label: "What filesystem roots are allowed?",
        default:
          "repo root and generated run packet only; no home/secrets/prod paths without approval",
      },
      {
        id: "network_policy",
        label: "Is network access allowed?",
        default:
          "read-only/public network by default; provider mutation/webhooks/prod endpoints require approval",
      },
      {
        id: "secrets_policy",
        label: "Are secrets available? If yes, which and under what approval?",
        default:
          "no secrets by default; scoped ephemeral secrets only after Red Zone approval",
      },
      {
        id: "sandbox_cleanup",
        label: "What cleanup happens after a run?",
        default:
          "preserve run packet/artifacts, clean temp files/worktrees when merged/closed, record leftover risk",
      },
      {
        id: "sandbox_escape_proof",
        label: "What proves the sandbox was not escaped?",
        default:
          "artifact-root validation, path/symlink checks, command cwd log, allowed-root audit, denied access events",
      },
    ],
  },
  {
    id: "model_routing",
    title: "Model routing",
    questions: [
      {
        id: "lane_model_policy",
        label: "Which model/provider should handle which lane?",
        default:
          "cheap/fast model for simple docs; stronger reasoning model for architecture, security, incident, eval, cross-file refactor, high-risk work",
      },
      {
        id: "strong_model_required_for",
        label: "What tasks require the strongest model?",
        default:
          "hard-to-reverse architecture, security/auth/billing/data, production incidents, agent eval design, ambiguous multi-system debugging",
      },
      {
        id: "cheap_model_allowed_for",
        label: "What tasks can use cheaper models?",
        default:
          "summaries, formatting, low-risk docs, simple deterministic edits after plan is approved",
      },
      {
        id: "model_fallback_path",
        label: "What is the fallback path if a model fails?",
        default:
          "retry once, switch provider/model, reduce context, escalate with failure reason and cost impact",
      },
      {
        id: "model_logging",
        label: "What model choices must be logged?",
        default:
          "provider/model, reason selected, cost/latency estimate, fallback/escalation, eval outcome when applicable",
      },
      {
        id: "model_quality_gate",
        label: "What model/cost quality threshold blocks completion?",
        default:
          "model failed required eval, exceeded budget without approval, or used an unapproved model for Red Zone/security work",
      },
    ],
  },
  {
    id: "ai_economics",
    title: "AI economics ledger",
    questions: [
      {
        id: "run_budget",
        label: "What budget applies per task/run/day/team?",
        default:
          "project-specific budget with approval for overage; track by run, lane, model, and human review time",
      },
      {
        id: "token_tracking",
        label: "Should token usage be tracked?",
        default:
          "yes for all model calls when provider telemetry is available; estimate otherwise",
      },
      {
        id: "human_review_tracking",
        label: "Should human review time be tracked?",
        default: "yes for high-risk/production work and background PR agents",
      },
      {
        id: "retry_cost_limit",
        label: "What retry-loop cost is unacceptable?",
        default:
          "repeated failures without new evidence, high token burn with no passing proof, or loops past retry limit",
      },
      {
        id: "spend_approval_policy",
        label: "What model/tool spend requires approval?",
        default:
          "large model batches, long-running agents, paid provider mutation, load tests, cloud resource changes",
      },
      {
        id: "cost_handoff",
        label: "What cost report should appear in handoff?",
        default:
          "models/tools used, rough token/cost, retries, human review time, waste loops avoided, budget exceptions",
      },
    ],
  },
  {
    id: "background_pr_agents",
    title: "Background PR agents",
    questions: [
      {
        id: "background_agents_allowed",
        label: "Can agents work asynchronously in the background?",
        default:
          "allowed for scoped issues with run packet, branch/worktree, budget, and reviewer",
      },
      {
        id: "agent_branch_policy",
        label: "Can agents create branches?",
        default:
          "yes for approved scoped tasks; branch name must include run/issue ID",
      },
      {
        id: "agent_pr_policy",
        label: "Can agents open PRs?",
        default:
          "yes when tests/proof/evals pass and PR includes run packet + risk/handoff",
      },
      {
        id: "background_pr_reviewer",
        label: "Who reviews background-agent PRs?",
        default: "code owner plus domain/security/cloud reviewer when touched",
      },
      {
        id: "background_pr_proof",
        label: "What proof must be attached before PR open?",
        default:
          "plan, diff summary, tests/evals/build, proof artifacts, cost, risk, rollback, screenshots/logs when useful",
      },
      {
        id: "stale_agent_cleanup",
        label: "When should stale/failed agent branches be closed?",
        default:
          "no progress after SLA, failing proof with no recovery, superseded task, or human cancellation",
      },
    ],
  },
  {
    id: "interop_mcp_a2a",
    title: "MCP / A2A interoperability",
    questions: [
      {
        id: "mcp_required",
        label: "Should this repo expose Valdris MCP tools?",
        default:
          "yes when external agents need live tool access; otherwise CLI bridge is acceptable for v0",
      },
      {
        id: "mcp_tools",
        label: "Which uash.* tools should exist?",
        default:
          "uash.start_run, uash.enter_node, uash.write_artifact, uash.fire_gate, uash.request_approval, uash.finish_line_check",
      },
      {
        id: "agent_runtimes",
        label: "What agent runtimes are allowed to connect?",
        default:
          "Claude Code, Codex, Hermes, OpenCode/Copilot if authenticated and policy-compatible",
      },
      {
        id: "a2a_needed",
        label: "Do we need A2A agent cards/capability discovery?",
        default:
          "needed for multi-agent/vendor-interoperable deployments; optional for local single-runtime MVP",
      },
      {
        id: "interop_auth_roots",
        label: "What auth/roots/tool permissions apply?",
        default:
          "least-privilege roots, scoped tokens, per-tool risk classes, Red Zone approval for mutation",
      },
      {
        id: "live_event_definition",
        label: "What counts as a real live connector event?",
        default:
          "event emitted by bridge/MCP/API/CLI/watched artifact from an active run; never static docs/demo data",
      },
    ],
  },
  {
    id: "production_agent_lifecycle",
    title: "Production-agent lifecycle",
    questions: [
      {
        id: "deploys_agents",
        label: "Does this team deploy agents, not just code?",
        default:
          "yes if prompts/tools/models/memory/evals run in production user workflows",
      },
      {
        id: "agent_definition",
        label: "What is an agent definition here?",
        default:
          "prompt/instructions, model route, tools, skills, memory policy, eval suite, owner, deployment environment",
      },
      {
        id: "agent_lifecycle_states",
        label: "What states exist for agents?",
        default:
          "draft, eval, canary, active, degraded, deprecated, rolled-back",
      },
      {
        id: "agent_promotion_gate",
        label: "What eval gates promote an agent?",
        default:
          "offline eval pass, safety/behavior checks, cost threshold, canary/observability, human approval for high-risk agents",
      },
      {
        id: "agent_observability",
        label: "What monitoring proves an agent is safe in production?",
        default:
          "success/failure rate, tool errors, user escalations, cost, latency, eval drift, incidents, sampled transcripts with privacy controls",
      },
      {
        id: "agent_rollback_owner",
        label: "Who owns rollback?",
        default: "agent/runtime owner plus production on-call or product owner",
      },
    ],
  },
  {
    id: "team_harness_registry",
    title: "Team harness registry",
    questions: [
      {
        id: "harness_owner",
        label: "Who owns the harness for this repo?",
        default: "technical owner / platform owner",
      },
      {
        id: "prompt_owner",
        label: "Who owns prompts/front doors?",
        default: "AI/runtime owner with code owner review",
      },
      {
        id: "eval_owner",
        label: "Who owns evals?",
        default: "AI/product owner plus domain reviewer",
      },
      {
        id: "connector_owner",
        label: "Who owns connectors/MCP/bridge integrations?",
        default: "platform/runtime owner",
      },
      {
        id: "harness_change_approval",
        label: "Who approves harness changes?",
        default: "harness owner; security/cloud owners for Red Zone policies",
      },
      {
        id: "harness_drift_check",
        label: "What drift check detects stale harness docs/gates?",
        default:
          "scheduled verifier checks generator output, GitNexus/code-intelligence freshness, docs/adapters version, missing eval/skill/tool registry owners",
      },
    ],
  },
  {
    id: "human_agent_protocol",
    title: "Human-agent operating protocol",
    questions: [
      {
        id: "decision_owner",
        label: "Who is the decision owner?",
        default: "primary operator unless a lane-specific owner is set",
      },
      {
        id: "normal_pr_reviewer",
        label: "Who reviews normal PRs?",
        default: "code owner or technical maintainer",
      },
      {
        id: "specialist_reviewers",
        label: "Who reviews security/auth/billing/cloud/data changes?",
        default:
          "security owner for auth/data/secrets, cloud owner for infra, billing owner for payments, product owner for customer-facing behavior",
      },
      {
        id: "escalation_path",
        label: "What is the escalation path?",
        default:
          "agent -> primary operator -> lane owner -> decision owner; Red Zone blocks until human approval",
      },
      {
        id: "blocked_agent_sla",
        label: "What is the SLA for blocked agents?",
        default:
          "15 minutes for local operator work, next business day for async team review unless incident/severity overrides",
      },
      {
        id: "human_contact_channels",
        label: "What channels should agents use to ask humans?",
        default:
          "platform comments/PR, Linear/GitHub issue, Slack/Telegram/email as configured; record answer in run packet",
      },
      {
        id: "approval_contract",
        label: "What does approval have to include?",
        default:
          "scope, run ID, artifact path, approver, expiry if temporary, risk accepted, exact action allowed",
      },
    ],
  },
  {
    id: "ontology_terminology",
    title: "Ontology and technical terminology",
    questions: [
      {
        id: "domain_ontology_sources",
        label:
          "Which local or authoritative sources define the domain ontology and category criteria?",
        default:
          "repository architecture/domain records first; then standards bodies, official specifications, official documentation/repositories, and peer-reviewed literature",
      },
      {
        id: "controlled_vocabulary",
        label: "Which domain terms are approved or restricted?",
        default:
          "use the repository glossary and commissioned ontology; record one approved term per meaning and do not invent larger labels",
      },
      {
        id: "qualified_terms",
        label: "Which terms require explicit qualification or criteria?",
        default:
          "operating system requires resource/process/state/interface/permission/execution evidence; control plane requires the managed scope; compliance terms require formal proof",
      },
      {
        id: "authoritative_source_policy",
        label: "How should agents escalate missing classification evidence?",
        default:
          "search the web, open the direct authoritative source, record URL/publisher/title/access date/claim, corroborate contested claims, and keep secondary sources non-decisive",
      },
      {
        id: "web_research_availability",
        label:
          "What should happen when authoritative web research is unavailable?",
        default:
          "record blocked or incomplete research and conclude uncertain or not established; do not guess",
      },
      {
        id: "citation_policy",
        label: "What citation detail must classification records preserve?",
        default:
          "source origin and type, publisher, title, direct URL or repository path, revision when local, access date, supported claim, sourced facts, and separate inference",
      },
      {
        id: "technical_english_profile",
        label: "Which technical-English profile should agents use?",
        default:
          "ASD-STE100 Issue 9 target authoring profile: short direct sentences, one term per meaning, explicit actors/actions/conditions, no metaphor, and no formal conformance claim without a complete rule and dictionary check",
      },
    ],
  },
  {
    id: "apple_mobile_ios",
    title: "Apple / iOS platform commissioning",
    questions: [
      {
        id: "ios_scheme",
        label: "What Xcode scheme and workspace/project should CI build?",
        default:
          "commission exact workspace/project and shared scheme when iOS is detected; otherwise not applicable",
      },
      {
        id: "ios_bundle_id",
        label: "What bundle ID and Apple Developer team own the app?",
        default:
          "commissioned owner must provide; never infer signing identity",
      },
      {
        id: "ios_support_matrix",
        label: "What iOS/device support matrix is required?",
        default:
          "commission minimum iOS, iPhone/iPad devices, orientations, accessibility, and physical-device smoke",
      },
      {
        id: "ios_macos_runner",
        label: "Which approved macOS/Xcode runner supplies native proof?",
        default:
          "required before Xcode archive, simulator/device, signing, or TestFlight claims",
      },
      {
        id: "ios_signing_owner",
        label:
          "Who owns certificates, profiles, entitlements, and App Store Connect keys?",
        default: "human Apple platform owner; Red Zone",
      },
      {
        id: "ios_testflight_owner",
        label: "Who may upload/promote TestFlight builds and invite testers?",
        default: "human release owner; Red Zone",
      },
      {
        id: "ios_storekit_model",
        label:
          "What StoreKit products, entitlements, and server-side verification model apply?",
        default:
          "not applicable unless commerce is detected; otherwise commission exact products and authoritative ledger",
      },
      {
        id: "ios_push_model",
        label: "Does APNs apply and who owns its keys/payload privacy?",
        default: "not applicable unless push is used",
      },
    ],
  },
];

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    out: null,
    answers: null,
    projectName: null,
    printQuestions: false,
    yes: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--answers") args.answers = argv[++i];
    else if (arg === "--project-name") args.projectName = argv[++i];
    else if (arg === "--print-questions") args.printQuestions = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--force") args.force = true;
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
  console.log(
    `Universal Agentic SDLC Harness commissioning v${VERSION}\n\nUsage:\n  node scripts/commission-harness.mjs --repo /path/to/repo --project-name "My App" --out /path/to/repo/.valdris-harness\n  node scripts/commission-harness.mjs --print-questions\n\nOptions:\n  --repo <path>          Target Git repository root. Defaults to cwd.\n  --out <path>           Must be <repo>/.valdris-harness. Defaults to that canonical nested path.\n  --answers <json>       Optional reviewed overrides. Prior reviewed answers persist; generated defaults re-detect.\n  --project-name <name>  Project name.\n  --yes                  Non-interactive: use reviewed answers and current generated defaults.\n  --force                Refresh a recognized pack without resetting reviewed commissioning facts.\n  --print-questions      Print the commissioning question bank and exit.\n`,
  );
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
  const packageManager = exists(repo, "pnpm-lock.yaml")
    ? "pnpm"
    : exists(repo, "yarn.lock")
      ? "yarn"
      : exists(repo, "package-lock.json")
        ? "npm"
        : "npm";
  const run = packageManager === "npm" ? "npm run" : `${packageManager}`;
  const npmExec =
    packageManager === "npm" ? "npm install" : `${packageManager} install`;
  const hasRequirements = exists(repo, "requirements.txt");
  const hasPyproject = exists(repo, "pyproject.toml");
  const hasPython = hasPyproject || hasRequirements;
  const ignoredDiscoveryDirs = new Set([
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "DerivedData",
    "Pods",
  ]);
  const discovered = [];
  const queue = [{ dir: repo, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path
        .relative(repo, path.join(dir, entry.name))
        .replaceAll("\\", "/");
      discovered.push({ entry, relative });
      if (discovered.length > 100000)
        throw new Error(
          "Repository discovery exceeded 100,000 entries; narrow the repo or add an ignored generated directory",
        );
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !ignoredDiscoveryDirs.has(entry.name)
      )
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  const hasDiscoveredName = (predicate) =>
    discovered.some(({ entry, relative }) => predicate(entry, relative));
  const hasXcodeProject = hasDiscoveredName(
    (entry) =>
      entry.isDirectory() &&
      [".xcodeproj", ".xcworkspace"].some((suffix) =>
        entry.name.toLowerCase().endsWith(suffix),
      ),
  );
  const hasSwiftPackage = hasDiscoveredName(
    (entry) => entry.isFile() && entry.name === "Package.swift",
  );
  const hasPodfile = hasDiscoveredName(
    (entry) => entry.isFile() && entry.name === "Podfile",
  );
  const hasFastlane = hasDiscoveredName(
    (entry) => entry.isDirectory() && entry.name === "fastlane",
  );
  const hasIos = hasXcodeProject || hasPodfile || hasFastlane;
  const hasUnity = exists(repo, "Assets") && exists(repo, "ProjectSettings");
  const hasGodot = exists(repo, "project.godot");
  const hasUnreal = hasDiscoveredName(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".uproject"),
  );
  const frameworks = [];
  if (exists(repo, "next.config.ts") || exists(repo, "next.config.js"))
    frameworks.push("Next.js");
  if (exists(repo, "vite.config.ts") || exists(repo, "vite.config.js"))
    frameworks.push("Vite");
  if (hasPython) frameworks.push("Python");
  if (hasXcodeProject) frameworks.push("Xcode/iOS");
  if (hasSwiftPackage) frameworks.push("Swift Package Manager");
  if (hasPodfile) frameworks.push("CocoaPods");
  if (hasFastlane) frameworks.push("Fastlane");
  if (hasUnity) frameworks.push("Unity");
  if (hasGodot) frameworks.push("Godot");
  if (hasUnreal) frameworks.push("Unreal Engine");
  if (exists(repo, ".github/workflows")) frameworks.push("GitHub Actions");
  if (exists(repo, "Dockerfile") || exists(repo, "docker-compose.yml"))
    frameworks.push("Docker");
  if (
    exists(repo, "infra") ||
    exists(repo, "terraform") ||
    exists(repo, "cdk.json")
  )
    frameworks.push("IaC/infra");
  const role =
    [
      exists(repo, "app") || exists(repo, "pages") || exists(repo, "components")
        ? "frontend"
        : null,
      hasPython ? "backend/python" : null,
      hasIos ? "mobile/ios" : null,
      hasUnity || hasGodot || hasUnreal ? "game" : null,
      exists(repo, "api") || exists(repo, "server") ? "backend/api" : null,
      exists(repo, "infra") ||
      exists(repo, "terraform") ||
      exists(repo, "cdk.json")
        ? "infra/platform"
        : null,
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
          : hasSwiftPackage
            ? "swift package resolve (approved macOS/Xcode runner for iOS targets)"
            : hasPodfile
              ? "bundle exec pod install on an approved macOS runner"
              : "project-specific",
    detectedLint: has("lint") ? `${run} lint` : "project-specific",
    detectedTypecheck: has("typecheck")
      ? `${run} typecheck`
      : exists(repo, "tsconfig.json")
        ? "npx tsc --noEmit"
        : "project-specific",
    detectedTest: has("test")
      ? `${run} test`
      : hasPython
        ? "pytest"
        : hasSwiftPackage && !hasXcodeProject
          ? "swift test"
          : hasXcodeProject
            ? "commissioned xcodebuild test on approved macOS runner"
            : "project-specific",
    detectedBuild: has("build")
      ? `${run} build`
      : hasSwiftPackage && !hasXcodeProject
        ? "swift build"
        : hasXcodeProject
          ? "commissioned xcodebuild archive on approved macOS runner"
          : "project-specific",
  };
}

function questionList() {
  return QUESTION_GROUPS.flatMap((group) =>
    group.questions.map((question) => ({
      group: group.id,
      groupTitle: group.title,
      ...question,
    })),
  );
}

function defaultFor(question, detected, args) {
  if (question.defaultFrom === "projectName")
    return args.projectName || path.basename(detected.repoPath);
  if (question.defaultFrom && detected[question.defaultFrom])
    return detected[question.defaultFrom];
  return question.default ?? "";
}

async function collectAnswers(args, detected) {
  const questions = questionList();
  const questionIds = new Set(questions.map(({ id }) => id));
  const canonicalOut = path.join(
    path.resolve(detected.repoPath),
    ".valdris-harness",
  );
  const requestedOut = path.resolve(args.out || canonicalOut);
  let preserved = {};
  let preservedSources = {};
  if (
    args.force &&
    requestedOut === canonicalOut &&
    fs.existsSync(requestedOut)
  ) {
    const entries = fs.readdirSync(requestedOut);
    if (entries.length) {
      const marker = readJsonIfExists(
        path.join(requestedOut, "project-adapter.json"),
      );
      if (
        marker?.schema !== "uash.project-adapter.v2" ||
        !marker?.generatorVersion ||
        !marker?.answers ||
        typeof marker.answers !== "object" ||
        Array.isArray(marker.answers)
      )
        throw new Error(
          "Refusing --force because the output is not a recognized generated Valdris pack with reusable commissioning answers",
        );
      const previousDetected = {
        ...(marker.detected || {}),
        repoPath: detected.repoPath,
      };
      for (const question of questions) {
        if (!Object.hasOwn(marker.answers, question.id)) continue;
        const source = marker.commissioning?.answerSources?.[question.id];
        const reviewedSource = source === "reviewed" || source === "explicit";
        const generatedSource = source === "generated-default";
        const previousDefault = defaultFor(question, previousDetected, {
          projectName: null,
        });
        if (
          reviewedSource ||
          (!generatedSource &&
            source === undefined &&
            marker.answers[question.id] !== previousDefault)
        ) {
          preserved[question.id] = marker.answers[question.id];
          preservedSources[question.id] =
            source === "explicit" ? "explicit" : "reviewed";
        }
      }
    }
  }
  const provided = args.answers ? readJsonIfExists(args.answers) : {};
  if (args.answers && !provided)
    throw new Error(`Could not parse answers JSON: ${args.answers}`);
  const answers = { ...preserved, ...(provided ?? {}) };
  const answerSources = { ...preservedSources };
  for (const key of Object.keys(provided || {}))
    if (questionIds.has(key)) answerSources[key] = "reviewed";
  if (args.projectName) {
    answers.project_name = args.projectName;
    answerSources.project_name = "explicit";
  }

  if (args.yes || !process.stdin.isTTY) {
    for (const question of questions) {
      if (!answers[question.id]) {
        answers[question.id] = defaultFor(question, detected, args);
        answerSources[question.id] = "generated-default";
      }
    }
    return { answers, answerSources };
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
        answerSources[question.id] = response.trim()
          ? "reviewed"
          : "generated-default";
      }
    }
  } finally {
    rl.close();
  }
  return { answers, answerSources };
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
      if (
        Array.isArray(value) &&
        value.every((item) => typeof item === "object")
      ) {
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
  fs.writeFileSync(
    file,
    content.endsWith("\n") ? content : `${content}\n`,
    "utf8",
  );
}

function normalizeGeneratedJsonLineEndings(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) normalizeGeneratedJsonLineEndings(target);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const current = fs.readFileSync(target, "utf8");
      const normalized = current.replace(/\r\n?/g, "\n");
      if (normalized !== current) fs.writeFileSync(target, normalized, "utf8");
    }
  }
}

function contentSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function writePortableValdrisClassification(out) {
  const sourceRecordPath = path.join(
    HARNESS_ROOT,
    "classification",
    "valdris-system-classification.v1.json",
  );
  const sourceValidation = validateClassificationRecordFiles(sourceRecordPath, {
    repoRoot: HARNESS_ROOT,
  });
  if (!sourceValidation.valid)
    throw new Error(
      `canonical Valdris classification record is invalid: ${sourceValidation.problems.join("; ")}`,
    );
  const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8"));
  for (const evidence of sourceRecord.evidence || []) {
    if (evidence?.origin !== "local") continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(evidence.id || ""))
      throw new Error("Valdris classification evidence id is not portable");
    if (
      typeof evidence.repositoryPath !== "string" ||
      /[\\:\u0000-\u001f\u007f]/.test(evidence.repositoryPath) ||
      path.posix.isAbsolute(evidence.repositoryPath) ||
      evidence.repositoryPath
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    )
      throw new Error(
        `Valdris classification evidence ${evidence.id} path is not portable`,
      );
    const bytes = declaredLocalEvidenceBytes(HARNESS_ROOT, evidence);
    if (!bytes)
      throw new Error(
        `Valdris classification evidence ${evidence.id} bytes are unavailable at the declared revision`,
      );
    const portablePath = path.posix.join(
      ".valdris-harness",
      "classification",
      "evidence",
      evidence.id,
      path.posix.basename(evidence.repositoryPath),
    );
    const target = path.join(
      out,
      "classification",
      "evidence",
      evidence.id,
      path.basename(evidence.repositoryPath),
    );
    mkdirp(path.dirname(target));
    fs.writeFileSync(target, bytes);
    evidence.repositoryPath = portablePath;
    evidence.revision = `sha256:${contentSha256(bytes)}`;
  }
  write(
    path.join(out, "classification", "valdris-system-classification.v1.json"),
    JSON.stringify(sourceRecord, null, 2),
  );
}

function commissionedPackManifest(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) {
        const relative = path.relative(root, target).replaceAll("\\", "/");
        if (relative !== "commissioning-manifest.json")
          files.push({
            path: relative,
            sha256: portableManifestSha256(fs.readFileSync(target)),
          });
      } else {
        throw new Error(
          `generated pack manifest rejects non-regular path: ${target}`,
        );
      }
    }
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    schema: "valdris.commissioned-pack-manifest.v1",
    files,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function reviewTrustStoreSha256(file) {
  return contentSha256(
    canonicalJson(JSON.parse(fs.readFileSync(file, "utf8"))),
  );
}

function planRootDiscoveryLoader(repoRoot, fileName) {
  const target = path.join(repoRoot, fileName);
  const loader = renderRootDiscoveryLoader(fileName);
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT")
      return {
        fileName,
        target,
        action: "created",
        content: loader,
        original: { exists: false },
      };
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Cannot install Valdris discovery loader: target-root ${fileName} must be a regular file, not a symlink or directory`,
    );
  }
  const bytes = fs.readFileSync(target);
  const current = bytes.toString("utf8");
  if (bytes.includes(0) || !Buffer.from(current, "utf8").equals(bytes)) {
    throw new Error(
      `Cannot install Valdris discovery loader: target-root ${fileName} is not a supported UTF-8 text file`,
    );
  }
  const start = current.indexOf(ROOT_LOADER_START);
  const end = current.indexOf(ROOT_LOADER_END);
  const hasStart = start !== -1;
  const hasEnd = end !== -1;
  if (
    hasStart !== hasEnd ||
    (hasStart &&
      (start > end ||
        current.indexOf(ROOT_LOADER_START, start + ROOT_LOADER_START.length) !==
          -1 ||
        current.indexOf(ROOT_LOADER_END, end + ROOT_LOADER_END.length) !== -1))
  ) {
    throw new Error(
      `Cannot install Valdris discovery loader: target-root ${fileName} contains malformed or duplicate Valdris loader markers; repair it manually before commissioning`,
    );
  }
  if (hasStart) {
    const suffixStart = end + ROOT_LOADER_END.length;
    const suffix = current.slice(suffixStart).replace(/^\r?\n/, "");
    return {
      fileName,
      target,
      action: "refreshed",
      content: `${current.slice(0, start)}${loader}${suffix}`,
      original: {
        exists: true,
        bytes,
        sha256: contentSha256(bytes),
        mode: stats.mode & 0o777,
      },
    };
  }

  const separator =
    current.length === 0
      ? ""
      : current.endsWith("\n\n")
        ? ""
        : current.endsWith("\n")
          ? "\n"
          : "\n\n";
  return {
    fileName,
    target,
    action: "merged",
    content: `${current}${separator}${loader}`,
    original: {
      exists: true,
      bytes,
      sha256: contentSha256(bytes),
      mode: stats.mode & 0o777,
    },
  };
}

function assertRootLoaderPlanUnchanged(plan) {
  let stats;
  try {
    stats = fs.lstatSync(plan.target);
  } catch (error) {
    if (error?.code === "ENOENT" && plan.original.exists === false) return;
    if (error?.code === "ENOENT")
      throw new Error(
        `Cannot install Valdris discovery loaders: target-root ${plan.fileName} changed after commissioning inspection (file was removed)`,
      );
    throw error;
  }
  if (plan.original.exists === false)
    throw new Error(
      `Cannot install Valdris discovery loaders: target-root ${plan.fileName} changed after commissioning inspection (file was created)`,
    );
  if (stats.isSymbolicLink() || !stats.isFile())
    throw new Error(
      `Cannot install Valdris discovery loaders: target-root ${plan.fileName} changed after commissioning inspection (path is no longer a regular file)`,
    );
  const digest = contentSha256(fs.readFileSync(plan.target));
  if (digest !== plan.original.sha256)
    throw new Error(
      `Cannot install Valdris discovery loaders: target-root ${plan.fileName} changed after commissioning inspection (content digest differs)`,
    );
}

function stageAtomicFile(target, content, mode, purpose) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.valdris-${purpose}-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } catch (error) {
    try {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    } catch {}
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  fs.closeSync(descriptor);
  return temporary;
}

function atomicReplacePlan(plan, staged) {
  const stagedStats = fs.lstatSync(staged);
  const installedState = {
    dev: stagedStats.dev,
    ino: stagedStats.ino,
    sha256: contentSha256(fs.readFileSync(staged)),
  };
  if (plan.original.exists === false) {
    fs.linkSync(staged, plan.target);
    fs.rmSync(staged, { force: true });
  } else {
    fs.renameSync(staged, plan.target);
  }
  return installedState;
}

function rollbackRootLoaderPlan(plan, installedState) {
  let currentStats;
  try {
    currentStats = fs.lstatSync(plan.target);
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error(
        "rollback conflict: installed loader was removed concurrently",
      );
    throw error;
  }
  if (currentStats.isSymbolicLink() || !currentStats.isFile())
    throw new Error(
      "rollback conflict: installed loader path changed type concurrently",
    );
  const currentDigest = contentSha256(fs.readFileSync(plan.target));
  if (
    currentDigest !== installedState.sha256 ||
    currentStats.dev !== installedState.dev ||
    currentStats.ino !== installedState.ino
  ) {
    throw new Error(
      "rollback conflict: installed loader was replaced or edited concurrently; preserving current content",
    );
  }
  if (plan.original.exists === false) {
    fs.rmSync(plan.target, { force: true });
    return;
  }
  const restore = stageAtomicFile(
    plan.target,
    plan.original.bytes,
    plan.original.mode || 0o644,
    "rollback",
  );
  try {
    fs.renameSync(restore, plan.target);
  } finally {
    fs.rmSync(restore, { force: true });
  }
}

export function installRootDiscoveryLoaders(plans, options = {}) {
  for (const plan of plans) assertRootLoaderPlanUnchanged(plan);
  const staged = [];
  try {
    for (const plan of plans)
      staged.push({
        plan,
        temporary: stageAtomicFile(
          plan.target,
          plan.content,
          plan.original.mode || 0o644,
          "install",
        ),
      });
  } catch (error) {
    for (const entry of staged) fs.rmSync(entry.temporary, { force: true });
    throw error;
  }
  const installed = [];
  try {
    for (const [index, entry] of staged.entries()) {
      options.beforeReplace?.(entry.plan, index);
      assertRootLoaderPlanUnchanged(entry.plan);
      const installedState = atomicReplacePlan(entry.plan, entry.temporary);
      entry.temporary = null;
      installed.push({ plan: entry.plan, installedState });
    }
  } catch (error) {
    const rollbackProblems = [];
    for (const { plan, installedState } of installed.reverse()) {
      try {
        rollbackRootLoaderPlan(plan, installedState);
      } catch (rollbackError) {
        rollbackProblems.push(`${plan.fileName}: ${rollbackError.message}`);
      }
    }
    if (rollbackProblems.length > 0)
      throw new Error(
        `${error.message}; discovery-loader rollback failed: ${rollbackProblems.join("; ")}`,
      );
    throw error;
  } finally {
    for (const entry of staged) {
      if (entry.temporary) fs.rmSync(entry.temporary, { force: true });
    }
  }
}

function targetRootRuntimePaths(content) {
  return String(content)
    .replaceAll("node scripts/", "node .valdris-harness/scripts/")
    .replaceAll(
      "`project-adapter.json`",
      "`.valdris-harness/project-adapter.json`",
    )
    .replaceAll("`project.yaml`", "`.valdris-harness/project.yaml`")
    .replaceAll("`AGENTS.md`", "`.valdris-harness/AGENTS.md`")
    .replaceAll("`CLAUDE.md`", "`.valdris-harness/CLAUDE.md`")
    .replaceAll("`00_MAP.md`", "`.valdris-harness/00_MAP.md`")
    .replaceAll("`CONTEXT.md`", "`.valdris-harness/CONTEXT.md`")
    .replaceAll("`docs/", "`.valdris-harness/docs/")
    .replaceAll("`knowledge/", "`.valdris-harness/knowledge/")
    .replaceAll("`classification/", "`.valdris-harness/classification/")
    .replaceAll("`skills/", "`.valdris-harness/skills/")
    .replaceAll("`controls/", "`.valdris-harness/controls/")
    .replaceAll("`scripts/", "`.valdris-harness/scripts/")
    .replaceAll("`runs/", "`.valdris-harness/runs/")
    .replaceAll("`.agents/", "`.valdris-harness/.agents/")
    .replaceAll("`.claude/", "`.valdris-harness/.claude/")
    .replaceAll(
      "Commit that entire directory before portable proof, signed review, or run-packet creation",
      "Commit that entire directory plus the bounded target-root `AGENTS.md` and `CLAUDE.md` discovery loaders before portable proof, signed review, or run-packet creation",
    )
    .replaceAll(
      "git add .valdris-harness\n",
      "git add .valdris-harness AGENTS.md CLAUDE.md\n",
    );
}

function renderAgents(answers) {
  return `# ${answers.project_name} Agent Instructions\n\nThis repo is commissioned into the Universal Agentic SDLC Harness. Use this file as the Codex/agent front door.\n\n## Start here\n\n1. Read \`00_MAP.md\`.\n2. Read \`CONTEXT.md\`.\n3. If \`project-adapter.json\` exists, use it as repo-specific truth and do not regenerate or re-ask stable commissioning facts unless the pack is incomplete.\n4. Read \`docs/Good Looks Like Foundation.md\`, \`docs/Code Quality Guardrails.md\`, and \`docs/Enterprise Proof Bank.md\` before architecture, infra, feature, or refactor work.\n5. Read \`docs/Operating Intelligence Layer.md\` before AI/runtime/tooling/model/eval/memory work.\n6. Run GitNexus/code intelligence before codebase, architecture, refactor, debugging, or cross-file implementation work: \`node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local\`, then \`node scripts/code-intelligence-gate-all.mjs --repo .\` when scripts are available. If it falls back to local static graph, disclose that and do not claim GitNexus-backed analysis.\n7. For Codex live runs, also read \`docs/Codex Runtime Prompt.md\` when a RUN_ID/BRIDGE_URL is supplied.\n8. Route to the smallest matching lane family.\n9. Create or update a run packet before risky, ambiguous, architecture-impacting, production-impacting, or handoff-heavy work.\n\n## Human operating style\n\n- Primary operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Autonomy: ${answers.autonomy_level}\n- Avoid: ${answers.annoyances}\n\n## Source-of-truth order\n\n${answers.truth_order}\n\nWhen sources conflict, stop before Red Zone actions and ask ${answers.approval_owner}.\n\n## Parent taxonomy\n\nThe parent product is **Agentic SDLC Harness**. System design, production readiness, cloud/platform, QA/release, security, reliability, and self-healing are lane families inside the SDLC lifecycle.\n\n## Red Zone\n\nRead-only investigation is allowed: ${answers.read_only_allowed}.\n\nExplicit approval required before: ${answers.red_zone_actions}.\n\n## Finish line\n\nDone means: ${answers.done_definition}.\n\nNever claim done without proof artifacts, skip reasons for irrelevant nodes, and a human-readable handoff.\n`;
}

function syncValdrisSkillTree(source, target) {
  mkdirp(target);
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (
      (entry.isDirectory() && entry.name.startsWith("valdris-")) ||
      ["registry.json", "codex-routing.yaml"].includes(entry.name)
    ) {
      fs.rmSync(path.join(target, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
  fs.cpSync(source, target, { recursive: true });
}

function renderClaude(answers) {
  return `# ${answers.project_name} Claude Code Harness\n\nYou are inside a Universal Agentic SDLC Harness commissioned repo.\n\n## Required flow\n\n\`intake -> route -> code-intelligence -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`\n\nAsk commissioning questions only when \`project-adapter.json\` is missing or incomplete. Once the adapter exists, use it as repo-specific context and avoid re-asking stable facts.\n\n## Mode rule\n\nSeparate Blueprint, Live Run, and Replay. Do not imply live telemetry unless real connector/MCP/CLI/API/watched-artifact events exist.\n\n## Required artifacts\n\n- \`run/intake.json\`\n- \`run/route.json\`\n- \`graph/graph.json\` from GitNexus/code-intelligence scan, or explicit skip reason for docs-only/non-code work\n- \`graph/gitnexus.json\` with GitNexus index evidence when GitNexus is available; disclose local fallback if it is missing\n- \`graph/freshness.json\` proving graph commit/freshness\n- \`design/anchors.json\` for codebase claims and blast-radius reasoning\n- \`design/system_design.md\` when architecture/product/infra tradeoffs matter\n- \`production/layer-assessment.json\` for production-impacting work\n- \`cloud/service-map.json\` for cloud/platform work, or \`cloud/skip.json\` with reason\n- \`approvals/redzone.json\` when Red Zone applies\n- \`qa/qa-plan.md\` when validation scope matters\n- \`qa/break-it-results.md\` for feature/bug/refactor/security/cloud/integration work, or skip reason\n- \`proof/proof.json\` before done\n- \`smoke/smoke_proof.json\` for deployed/provider/runtime behavior, or skip reason\n- \`self_heal/self_heal_report.md\` if the harness/process failed\n- \`handoff/final.md\` for the final answer\n\n## Response contract\n\nUse: Bottom line, Why, Proof, Risk, Fix/Plan, Your call. Keep process narration out of the final answer.\n`;
}

function renderClaudeCommand(answers) {
  return `# ${answers.project_name} / Valdris SDLC Harness\n\nUse this slash command when the user wants Claude Code to work under the Valdris SDLC Harness.\n\n## Required inputs\n\nThe user should provide:\n\n\`RUN_ID=<run-id>\`\n\`BRIDGE_URL=http://127.0.0.1:8787\`\n\`<task text>\`\n\nIf RUN_ID is missing, ask for it before changing files. Do not invent one.\n\n## Runtime protocol\n\n1. Read \`project-adapter.json\`, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`.\n2. Follow the node flow: \`intake -> route -> code-intelligence -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`.\n3. Emit a bridge event before/after every node, gate, artifact, approval, skip, failure, and completion.\n4. Use explicit skip reasons for irrelevant nodes.\n5. Use failure reasons plus recovery paths for failed nodes.\n6. Do not emit \`run.completed\` until \`proof/proof.json\` validates as passing \`uash.proof.v1\`, \`production/layer-assessment.json\` validates all 13 production layers, and every required node is passed or skipped with a reason. The bridge should reject early completion.\n\n## Event command\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake "Claude Code started harness intake" --artifact run/intake.json --status ok --actor claude-code --mode live --source bridge --artifact-root "$PWD"\n\`\`\`\n\nCommissioned packs include \`scripts/uash-emit-event.mjs\`; run event commands from the generated pack root or from a repo where that script has been installed.\n\nRed Zone approval request example:\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required" --artifact approvals/redzone.json --status needs_approval --actor harness --mode live --source bridge --approval-owner "${answers.approval_owner}" --approval-scope "redzone" --artifact-root "$PWD"\n\`\`\`\n\nOnly a real operator/human approval event may grant/deny approval. Agents must not self-approve. The operator runs the grant from a separate shell holding both bridge credentials; the emitter reads the human approval token from that operator-only environment and never from process arguments or request bodies:\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone "Human approved scoped Red Zone action" --artifact approvals/redzone.json --status ok --actor human --mode live --source bridge --approval-owner "${answers.approval_owner}" --approval-scope "redzone" --artifact-root "$PWD"\n\`\`\`\n\n## Final answer\n\nBottom line, Why, Proof, Risk, Fix/Plan, Your call, Lane taken, Gates/artifacts, Skipped nodes/reasons, Self-heal needed/opened.\n`;
}

function renderCodexPrompt(answers) {
  return `# ${answers.project_name} Codex Runtime Prompt\n\nCodex should treat \`AGENTS.md\` as the primary front door and this file as the copy/paste run prompt when a specific harness run is started.\n\n## Start protocol\n\n1. Read \`AGENTS.md\`, \`project-adapter.json\`, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`. If the commissioned files exist, do not regenerate the pack or re-ask stable commissioning facts unless required files/scripts are missing.\n2. Classify the task into the smallest matching lane family.\n3. Use the flow: \`intake -> route -> code-intelligence -> design-anchors -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`.\n4. For codebase, architecture, refactor, debugging, or cross-file work, run \`node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local\`, then \`node scripts/code-intelligence-gate-all.mjs --repo .\`. If it falls back to local static graph, disclose that and do not claim GitNexus-backed analysis.\n5. Emit real bridge events when RUN_ID and BRIDGE_URL are provided; otherwise write the same artifacts locally and say telemetry is not live.\n6. In live mode, set \`UASH_BRIDGE_URL="$BRIDGE_URL"\`, run event commands from the artifact root that contains the pack, and include \`--artifact-root "$PWD"\` on the first event or create/sync the run with the correct artifactRoot first.\n7. Never claim done until \`proof/proof.json\` validates as passing \`uash.proof.v1\`, \`production/layer-assessment.json\` validates all 13 production layers, and every required node is passed or skipped with an explicit reason.\n\n## Event command shape\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" <event-type> <node-id> "<message>" \\\n  --artifact <path> \\\n  --status <ok|warn|blocked|skipped|failed|needs_approval> \\\n  --actor codex \\\n  --mode live \\\n  --source bridge \\\n  --artifact-root "$PWD" \\\n  [--approval-owner "..."] \\\n  [--approval-scope "..."] \\\n  [--skip-reason "..."] \\\n  [--failure-reason "..."] \\\n  [--recovery-path "..."] \\\n  [--self-heal-pr-url "..."]
\`\`\`\n\n## Red Zone approval events\n\nAgents may request approval, then must stop. A real operator grants or denies from a separate shell holding both bridge credentials. The emitter reads \`UASH_HUMAN_APPROVAL_TOKEN\` from that operator-only environment and sends it as a header; it never accepts the human token through process arguments or request bodies, and neither credential is persisted.\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.requested redzone "Red Zone approval required" \\\n  --artifact approvals/redzone.json \\\n  --status needs_approval \\\n  --actor codex \\\n  --mode live \\\n  --source bridge \\\n  --approval-owner "${answers.approval_owner}" \\\n  --approval-scope "redzone"\n\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone "Human approved scoped Red Zone action" \\\n  --artifact approvals/redzone.json \\\n  --status ok \\\n  --actor human \\\n  --mode live \\\n  --source bridge \\\n  --approval-owner "${answers.approval_owner}" \\\n  --approval-scope "redzone"\n\`\`\`\n\n## Required handoff\n\nBottom line, Why, Proof, Risk, Fix/Plan, Your call, Lane taken, Gates/artifacts, Skipped nodes/reasons, Self-heal needed/opened.\n`;
}

function renderMap(answers, detected) {
  return `# ${answers.project_name} Harness Map\n\nGenerated by Universal Agentic SDLC Harness commissioning v${VERSION}.\n\n## Product identity\n\n- Users/customers: ${answers.users}\n- Production means: ${answers.production_definition}\n- Worst agent failure: ${answers.worst_agent_failure}\n\n## Detected repo shape\n\n- Repo path: \`${detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${detected.frameworks.length ? detected.frameworks.join(", ") : "none detected"}\n- Package manager: ${detected.packageManager}\n\n## Universal flow\n\n\`request -> intake -> route -> GitNexus/code intelligence -> design anchors -> system design -> production readiness -> implementation -> QA/proof/smoke -> handoff -> self-heal\`\n\n## Lane families\n\n${DEFAULT_LANE_FAMILIES.map((lane) => `- ${lane}`).join("\n")}\n\n## Enabled lanes\n\n${splitList(
    answers.enabled_lanes,
  )
    .map((lane) => `- ${lane}`)
    .join(
      "\n",
    )}\n\nCustom lanes: ${answers.custom_lanes}.\n\n## Production Readiness Layer Pack\n\n${splitList(
    answers.production_layers,
  )
    .map((lane) => `- ${lane}`)
    .join("\n")}\n`;
}

function renderContext(answers) {
  return `# ${answers.project_name} Context Router\n\nUse this after \`00_MAP.md\`. Pick the smallest matching lane and load only the docs needed for that risk area.\n\n## Router\n\n| If the request is about | Use lane | Gate emphasis |\n|---|---|---|\n| Normal bug, feature, UI, backend, API, PR | engineering-default | design anchors + proof |\n| New architecture, API/data model, scale, tradeoffs | system-design | SDD/ADR + anchors |\n| Production readiness, deployability, real full-stack layers | production-readiness | layer assessment + skip reasons |\n| AWS/Azure/GCP/Vercel/Supabase infra, deploy, IAM, secrets | cloud-platform | service map + approval + rollback/live smoke |\n| Production/user-facing incident | incidents | runtime evidence + Red Zone |\n| Data, schema, migrations, auth/RLS | data | migration/schema proof + Red Zone |\n| Security, billing, auth, permissions | security | human approval + security checklist |\n| QA, release, regression, smoke | qa-release | QA plan + break-it + live smoke |\n| Docs, process, harness changes | docs-product | coherence + review + no fake telemetry |\n\n## Safe edit paths\n\n${answers.safe_edit_paths}\n\n## Review-required paths\n\n${answers.review_required_paths}\n\n## Branch/deploy model\n\n- Default work branch: ${answers.default_work_branch}\n- Staging: ${answers.staging_branch}\n- Production: ${answers.production_branch}\n- Merge/deploy owner: ${answers.merge_owner}\n- Deployment proof: ${answers.deployment_proof}\n\n## System design triggers\n\n${answers.system_design_triggers}\n\n## ADR policy\n\n${answers.adr_policy}\n`;
}

function renderOrderedV08Closure(paths) {
  return `## Ordered v0.9 completion closure

Run this sequence from the target repository root. Proof is not complete until the final packet gate passes.

Before freezing evidence, an operator or protected CI context must supply \`UASH_REVIEW_TRUST_SHA256\` as the canonical-JSON SHA-256 of the reviewed \`.valdris-harness/controls/review-trust.v1.json\`. Review, packet, and bridge validators fail closed when it is missing, malformed, or different from either the live or reviewed-commit store. This environment value is an external authority input: an agent-controlled shell setting its own digest does not establish trust. For rotation, the operator reviews the new store and updates the protected pin out of band before accepting it; validators never auto-enroll from repository bytes.

### 1. Completed goal

\`goal/goal.json\` must be complete, not merely active, and every stopping condition must pass.

\`\`\`bash
node ${paths.scriptFromRepo}/goal-gate.mjs --repo .
\`\`\`

### 2. Enterprise and AI assurance

Validate every route-required foundation, context, production, AI, domain, eval, trajectory, smoke, waiver, and portable-proof artifact.

\`\`\`bash
node ${paths.scriptFromRepo}/enterprise-ai-gate-all.mjs --repo .
\`\`\`

### 3. RCA when applicable

Bug, regression, incident, and self-heal routes require \`rca/rca.json\`. Any RCA artifact that exists is validated even when the route did not originally require one. Documentation/process repairs must declare repeatable proof-runner \`--causal-input\` paths and bind their exact pre/post Git bytes into both portable proofs.

\`\`\`bash
node ${paths.scriptFromRepo}/rca-gate.mjs --repo .
\`\`\`

### 4. Freeze the pre-review evidence bundle

Supply one repeated \`--gate name=artifact/path.json\` argument for every gate required by the validated route, and add \`--rca rca/rca.json\` when RCA is required or present. The printed \`evidenceBundleSha256\` is the independent review subject.

\`\`\`bash
node ${paths.scriptFromRepo}/run-create.mjs --repo . --run-id "$RUN_ID" --commit "$COMMIT" --environment "$ENVIRONMENT" --proof proof/portable.json --gate "<required-gate>=<artifact-path>" --print-evidence-bundle
\`\`\`

### 5. Four-role signed review

Create \`review/review.json\` as \`valdris.review.v2\` with exactly \`scout\`, \`implementer\`, \`verifier\`, and \`independentReviewer\`. The \`actorId\`, \`sessionId\`, and \`executionId\` values must each be pairwise distinct across all four roles. The trusted independent reviewer signs the frozen evidence bundle and complete role roster with Ed25519 using an active public key already commissioned in \`.valdris-harness/controls/review-trust.v1.json\`; an agent may not add or trust its own key.

\`\`\`bash
node ${paths.scriptFromRepo}/review-gate.mjs --repo .
\`\`\`

### 6. Create and validate the final run packet

Repeat the identical route-required \`--gate\` arguments and conditional \`--rca\` argument used for the evidence bundle. Select \`--assurance-level structural|semantic|authoritative\`; semantic and authoritative packets also supply \`--gate authoritative-assurance=assurance/authoritative.json\`. Creation fails if any reviewed input changed. The immutable output is \`valdris.run-packet.v3\`; v2 remains historical structural evidence only.

\`\`\`bash
node ${paths.scriptFromRepo}/run-create.mjs --repo . --run-id "$RUN_ID" --commit "$COMMIT" --environment "$ENVIRONMENT" --proof proof/portable.json --review review/review.json --gate "<required-gate>=<artifact-path>" --output run/packet.json
node ${paths.scriptFromRepo}/run-packet-gate.mjs --repo .
\`\`\`
`;
}

function renderValidation(answers, paths) {
  return `# Validation Commands\n\nRun these from the target repository root and attach proof before claiming done. The complete \`.valdris-harness\` directory must already be committed in this target worktree.\n\n| Check | Command |\n|---|---|\n| Install | \`${answers.install_command}\` |\n| Knowledge vault | \`node ${paths.scriptFromRepo}/okf-vault-gate.mjs --repo ${paths.packFromRepo}\` |\n| Skill registry | \`node ${paths.scriptFromRepo}/skill-registry-gate.mjs --repo ${paths.packFromRepo}\` |\n| Clean-room pack privacy | \`node ${paths.scriptFromRepo}/privacy-gate.mjs --repo ${paths.packFromRepo}\` |\n| Generated graph/anchor privacy | \`node ${paths.scriptFromRepo}/privacy-gate.mjs --repo . --include graph --include design/anchors.json\` |\n| Active goal shape | \`node ${paths.scriptFromRepo}/goal-gate.mjs --repo . --allow-active\` |\n| Completed goal | \`node ${paths.scriptFromRepo}/goal-gate.mjs --repo .\` |\n| Enterprise + AI finish line | \`node ${paths.scriptFromRepo}/enterprise-ai-gate-all.mjs --repo .\` |\n| RCA when applicable | \`node ${paths.scriptFromRepo}/rca-gate.mjs --repo .\` |\n| Independent review | \`node ${paths.scriptFromRepo}/review-gate.mjs --repo .\` |\n| Final run packet | \`node ${paths.scriptFromRepo}/run-packet-gate.mjs --repo .\` |\n| Hydrated CI acceptance | \`node ${paths.scriptFromRepo}/run-acceptance.mjs --repo . --bundle <extracted-artifact-directory> --source-commit <full-git-sha>\` |\n| Lint | \`${answers.lint_command}\` |\n| Typecheck | \`${answers.typecheck_command}\` |\n| Test | \`${answers.test_command}\` |\n| Build | \`${answers.build_command}\` |\n| Smoke/e2e | \`${answers.smoke_command}\` |\n\nDo not run the clean-room full-tree binary policy over the product repository. Product binaries are governed by the commissioned product asset/security policy; only generated graph and anchor evidence uses the bounded \`--include\` scan above.\n\n## CI workflow split\n\n\`.github/workflows/valdris-assurance.yml\` is the always-on structural commissioning check and never assumes a run packet exists. \`.github/workflows/valdris-run-acceptance.yml\` is an explicit protected-environment acceptance action. Configure required reviewers and the operator-held \`UASH_REVIEW_TRUST_SHA256\` environment variable on the \`valdris-run-acceptance\` environment. It checks out the exact full commit SHA, downloads an artifact bundle outside the checkout, and invokes the commissioned acceptance CLI.\n\nThe extracted bundle must contain \`valdris-run-artifacts.json\` with schema \`valdris.run-artifact-bundle.v1\`, the exact \`sourceCommit\`, and a strictly sorted \`files\` array of \`path\`, lowercase \`sha256\`, and integer \`size\`. Bundle paths are limited to Valdris evidence namespaces; the CLI rejects symlinks, undeclared files, portable path collisions, pre-existing destinations, source/validator overwrites, an unclean checkout, and a packet whose commit differs from checkout \`HEAD\`.\n\n## Done definition\n\n${answers.done_definition}.\n\n## Finish-line rule\n\nEvery required node must be passed or skipped with an explicit reason, except proof and handoff, which are non-skippable. Failed nodes need a recovery path. The \`prove\` node requires passing \`uash.proof.v1\`; production-impacting work requires typed control evidence in \`uash.production-readiness.v2\`; AI work requires \`uash.ai-assurance.v1\`; and a completed goal requires every stopping condition plus token-gated route approval to pass. Runtime-native loops do not override these gates or human approvals.\n\n${renderOrderedV08Closure(paths)}`;
}

function renderAgentKnowledgeVault(answers) {
  return `# Agent Knowledge Vault\n\nThis commissioned pack includes an OKF-style agent knowledge vault under \`knowledge/\`.\n\n## Purpose\n\nUse \`knowledge/index.md\` as the first low-token map after \`AGENTS.md\`. It gives agents progressive disclosure over systems, playbooks, concepts, and source notes without loading every doc.\n\n## Required shape\n\n- \`knowledge/index.md\` lists the top-level sections.\n- \`knowledge/log.md\` records durable knowledge changes with ISO date headings.\n- Concept files use YAML frontmatter with \`type\`, \`title\`, and \`description\`.\n- Internal links stay inside \`knowledge/\`.\n\n## Gate\n\n\`\`\`bash\nnode scripts/okf-vault-gate.mjs --repo .\n\`\`\`\n\nUpdate the vault when stable routing knowledge changes for ${answers.project_name}.\n`;
}

function renderKnowledgeVaultFiles(answers) {
  const now = new Date().toISOString();
  return {
    "knowledge/index.md": `# ${answers.project_name} Agent Knowledge Vault\n\nStart here for progressive disclosure. Open the smallest linked page that matches the task.\n\n# Systems\n\n* [${answers.project_name}](systems/project-system.md) - repo identity, production definition, and source-of-truth order.\n\n# Playbooks\n\n* [Engineering Task Routing](playbooks/engineering-task-routing.md) - first route for normal Codex engineering tasks.\n* [GitNexus Code Intelligence](playbooks/gitnexus-code-intelligence.md) - repo-intelligence route for code-impacting work.\n* [Production Readiness 13 Layers](playbooks/production-readiness-13-layers.md) - full-stack production impact route.\n\n# Concepts\n\n* [Proof-First Handoff](concepts/proof-first-handoff.md) - final-answer and artifact standard.\n`,
    "knowledge/log.md": `# Knowledge Vault Update Log\n\n## ${now.slice(0, 10)}\n\n* **Creation**: Generated the OKF-style agent knowledge vault for ${answers.project_name}.\n`,
    "knowledge/systems/index.md": `# Systems\n\n* [${answers.project_name}](project-system.md) - commissioned repo system profile.\n`,
    "knowledge/systems/project-system.md": `---\ntype: System\ntitle: ${answers.project_name}\ndescription: Commissioned repo profile for Valdris SDLC Harness agents.\nresource: project-adapter.json\ntags: [valdris, commissioned-repo, system]\ntimestamp: ${now}\n---\n\n# Identity\n\n- Users/customers: ${answers.users}\n- Production means: ${answers.production_definition}\n- Worst agent failure: ${answers.worst_agent_failure}\n\n# Source Of Truth\n\n${answers.truth_order}\n\n# Related Playbooks\n\n* [Engineering Task Routing](/playbooks/engineering-task-routing.md)\n* [GitNexus Code Intelligence](/playbooks/gitnexus-code-intelligence.md)\n* [Production Readiness 13 Layers](/playbooks/production-readiness-13-layers.md)\n`,
    "knowledge/playbooks/index.md": `# Playbooks\n\n* [Engineering Task Routing](engineering-task-routing.md) - choose context and gates.\n* [GitNexus Code Intelligence](gitnexus-code-intelligence.md) - scan/gate code intelligence.\n* [Production Readiness 13 Layers](production-readiness-13-layers.md) - classify production impact.\n`,
    "knowledge/playbooks/engineering-task-routing.md": `---\ntype: Playbook\ntitle: Engineering Task Routing\ndescription: First routing page for Valdris-guided Codex engineering tasks.\nresource: CONTEXT.md\ntags: [codex, routing, engineering, playbook]\ntimestamp: ${now}\n---\n\n# Start\n\nRead \`project-adapter.json\`, this vault, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`.\n\n# Route\n\n1. Code, architecture, debugging, refactor, or cross-file work uses [GitNexus Code Intelligence](/playbooks/gitnexus-code-intelligence.md).\n2. Production-impacting work uses [Production Readiness 13 Layers](/playbooks/production-readiness-13-layers.md).\n3. Docs-only work may skip code nodes with explicit reasons, but durable routing knowledge updates should update \`knowledge/\`.\n\n# Proof\n\nRun the commands listed in \`docs/Validation Commands.md\` and report artifacts before claiming done.\n`,
    "knowledge/playbooks/gitnexus-code-intelligence.md": `---\ntype: Playbook\ntitle: GitNexus Code Intelligence\ndescription: Required repo-intelligence route before codebase, architecture, refactor, debugging, or cross-file implementation claims.\nresource: scripts/code-intelligence-scan.mjs\ntags: [gitnexus, code-intelligence, graph, anchors]\ntimestamp: ${now}\n---\n\n# Commands\n\n\`\`\`bash\nnode scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local\nnode scripts/code-intelligence-gate-all.mjs --repo .\n\`\`\`\n\nUse strict mode when GitNexus itself must be proved:\n\n\`\`\`bash\nnode scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback none --strict\n\`\`\`\n\n# Disclosure\n\nIf local fallback occurs, disclose it and do not claim GitNexus-backed analysis.\n`,
    "knowledge/playbooks/production-readiness-13-layers.md": `---\ntype: Playbook\ntitle: Production Readiness 13 Layers\ndescription: Full-stack production readiness route for production-impacting engineering tasks.\nresource: scripts/production-layer-gate.mjs\ntags: [production, full-stack, readiness, proof]\ntimestamp: ${now}\n---\n\n# Required Artifact\n\n\`production/layer-assessment.json\` must classify all 13 canonical production layers exactly once.\n\n# Command\n\n\`\`\`bash\nnode scripts/production-layer-gate.mjs --repo .\n\`\`\`\n\n# Blocking States\n\n\`failed\`, \`pending\`, \`blocked\`, \`required\`, and \`needs_approval\` block completion.\n`,
    "knowledge/concepts/index.md": `# Concepts\n\n* [Proof-First Handoff](proof-first-handoff.md) - artifacts beat claims.\n`,
    "knowledge/concepts/proof-first-handoff.md": `---\ntype: Concept\ntitle: Proof-First Handoff\ndescription: Final answers and completion claims must be backed by proof artifacts and validation commands.\nresource: docs/Proof Schema.md\ntags: [proof, handoff, artifacts, validation]\ntimestamp: ${now}\n---\n\n# Rule\n\nArtifacts beat claims. Do not claim done without passing proof, skip reasons for irrelevant nodes, and a human-readable handoff.\n\n# Related Playbook\n\nUse [Engineering Task Routing](/playbooks/engineering-task-routing.md) before finalizing.\n`,
  };
}

function renderRedZone(answers) {
  return `# Red Zone Rules\n\nRead-only investigation allowed without asking: ${answers.read_only_allowed}.\n\nExplicit human approval owner: ${answers.approval_owner}.\n\nApproval required before:\n\n${splitList(
    answers.red_zone_actions,
  )
    .map((action) => `- ${action}`)
    .join("\n")}\n\nIf an action is ambiguous, treat it as Red Zone and ask.\n`;
}

function renderCodeIntelligence(answers) {
  return `# GitNexus / Code Intelligence\n\nThe \`code-intelligence\` node is the harness' first-class repo-intelligence gate. GitNexus is the preferred backend for that gate; the stable Valdris artifacts remain \`graph/graph.json\`, \`graph/freshness.json\`, and \`design/anchors.json\` so the rest of the SDLC flow stays backend-agnostic.\n\n## Policy\n\n${answers.code_graph}.\n\n## Required artifacts\n\n- \`graph/gitnexus.json\` - GitNexus index evidence: command, package, license boundary, status, and index alias.\n- \`graph/graph.json\` - stable harness graph artifact generated as the local projection for the run.\n- \`graph/freshness.json\` - git commit/freshness proof for the graph.\n- \`design/anchors.json\` - code anchors the agent must cite before architecture, refactor, debugging, or cross-file implementation claims.\n\n## Commands\n\n\`\`\`bash\nnode scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local\nnode scripts/code-intelligence-gate-all.mjs --repo .\n\`\`\`\n\nUse \`--strict\` or \`--fallback none\` when a run must fail if GitNexus cannot index. If the script falls back to the local static graph, the handoff must say GitNexus was unavailable and must not claim GitNexus-backed analysis. Until a future exporter consumes GitNexus graph output directly, describe the default success path as GitNexus indexed plus local stable projection.\n\n## License boundary\n\nGitNexus is invoked externally with \`npx gitnexus@latest analyze --index-only\`. Do not vendor GitNexus code into this harness pack, and treat commercial/product use as requiring license review or a commercial permission path.\n\n## Skip rule\n\nOnly docs-only/non-code runs may skip this node, and the run must emit \`node.skipped\` for \`code-intelligence\` and \`design-anchors\` with explicit reasons.\n`;
}

function renderProductionReadiness(answers) {
  return `# Production Readiness Layers v2\n\nThe catalog at \`controls/production-layers.v2.json\` defines 13 dependency-ordered layers and their control IDs. A required layer passes only when every required control has typed, resolvable evidence. A non-applicable layer must be explicitly skipped with a reason.\n\n${splitList(
    answers.production_layers,
  )
    .map((layer) => `- ${layer}`)
    .join(
      "\n",
    )}\n\n## Artifact shape\n\n\`production/layer-assessment.json\` uses \`uash.production-readiness.v2\` and binds the run to a profile, environment, commit, owner, applicability decision, catalog control IDs, and typed evidence arrays. Artifact evidence is path-resolved and hashed for enterprise/regulated profiles; command evidence needs an output digest; metrics must meet their thresholds; approvals must name a real human actor.\n\nRun:\n\n\`\`\`bash\nnode scripts/production-layer-gate.mjs --repo .\n\`\`\`\n\nLegacy v1 artifacts remain readable for historical compatibility, but newly commissioned work uses v2.\n\n## Skip policy\n\n${answers.production_layer_skip_policy}\n\n## Required proof\n\n${answers.production_readiness_proof}\n`;
}

function renderCloudPlatform(answers) {
  return `# Cloud / Platform Engineering\n\n## Providers\n\n${answers.cloud_providers}\n\n## Services in scope\n\n${answers.cloud_services}\n\n## IaC / manual policy\n\n${answers.iac_model}\n\n## Observability proof\n\n${answers.observability_model}\n\n## Cost / rollback policy\n\n${answers.cost_rollback_policy}\n\n## Cloud/platform subchecks\n\nThese are subchecks inside the base bridge node \`cloud-platform\`; record their results in \`cloud/service-map.json\` or related cloud artifacts. Do not emit them as bridge \`nodeId\` values unless a future adapter explicitly registers custom nodes.\n\n- cloud-intake\n- aws-service-map\n- iam-secrets-check\n- networking-check\n- iac-diff-check\n- deploy-plan\n- observability-proof\n- cost-risk-check\n- rollback-plan\n- live-smoke\n- runbook-update\n`;
}

function renderQaSmoke(answers) {
  return `# QA and Live Smoke\n\n## QA plan policy\n\n${answers.qa_plan_policy}\n\n## Let's-break-it QA\n\n${answers.break_it_qa_policy}\n\nRequired artifact: \`qa/break-it-results.md\`.\n\n## Live smoke criteria\n\n${answers.live_smoke_criteria}\n\nRequired artifact when applicable: \`smoke/smoke_proof.json\`.\n`;
}

function renderModes(answers) {
  return `# Blueprint / Live Run / Replay Modes\n\n${answers.telemetry_mode_policy}\n\n## Rule\n\n- Blueprint explains topology only.\n- Demo is bundled seed data only; it is not a connector mode.\n- Live Run uses real connector/MCP/CLI/API/watched-artifact events.\n- Replay uses stored run packets/events/artifacts.\n\nNever imply fake live telemetry.\n`;
}

function renderSelfHealing(answers) {
  return `# Harness Self-Healing Loop\n\nCan agents propose/open self-healing PRs: ${answers.self_heal_allowed}.\n\nSelf-heal PR target areas: ${answers.self_heal_pr_target}.\n\n## When to trigger\n\nTrigger self-heal when a run exposes:\n\n- repo adapter gap\n- lane procedure gap\n- gate policy gap\n- connector/telemetry bug\n- docs/onboarding gap\n- missing validation command\n- missing Red Zone rule\n- missing production-readiness layer\n\nRequired artifact: \`self_heal/self_heal_report.md\`.\n`;
}

function renderGoodLooksLike(answers) {
  return `# Good Looks Like / Foundation Blueprint\n\nThis document is the anti-spaghetti north star for the repo. Agents should compare proposed work against this baseline before adding more code.\n\n## Target architecture style\n\n${answers.target_architecture_style}\n\n## Reference architecture / golden path\n\n${answers.reference_architecture}\n\n## Foundation layers required before serious feature velocity\n\n${splitList(
    answers.foundation_layers,
  )
    .map((layer) => `- ${layer}`)
    .join("\n")}\n\n## Weak-foundation warning signs\n\n${splitList(
    answers.bad_foundation_signals,
  )
    .map((signal) => `- ${signal}`)
    .join(
      "\n",
    )}\n\n## Normal feature golden path\n\n${answers.golden_path}\n\n## Foundation decision owner\n\n${answers.foundation_decision_owner}\n\n## Rule\n\nIf feature work requires more spaghetti to ship, stop and propose a foundation fix first.\n`;
}

function renderCodeQualityGuardrails(answers) {
  return `# Code Quality Guardrails\n\nUse this as the maintainability / anti-spaghetti review contract. A code smell is a hypothesis, not a verdict: prove impact, then make the smallest safe fix.\n\n## Module boundaries\n\n${answers.module_boundaries}\n\n## Dependency direction\n\n${answers.dependency_rules}\n\n## Smells that block or trigger review\n\n${splitList(
    answers.anti_spaghetti_rules,
  )
    .map((rule) => `- ${rule}`)
    .join(
      "\n",
    )}\n\n## Complexity budget\n\n${answers.complexity_budget}\n\n## Refactor triggers\n\n${answers.refactor_triggers}\n\n## Maintainability proof\n\n${answers.quality_gate_proof}\n\n## Required review output\n\n- Boundary touched\n- Risk introduced or removed\n- Tests/proof at the right layer\n- Any duplication/fallback/circular dependency found\n- Smallest safe refactor if the boundary is degrading\n`;
}

function renderEnterpriseProofBank(answers) {
  return `# Enterprise Proof Bank\n\nThis file answers: “what does good look like?” for production-grade work. Do not accept toy proof for serious builds.\n\n## Domain pack\n\n${answers.domain_pack}\n\n## Teaching artifacts\n\n${splitList(
    answers.good_looks_like_artifacts,
  )
    .map((artifact) => `- ${artifact}`)
    .join(
      "\n",
    )}\n\n## Scale / concurrency bar\n\n${answers.scale_bar}\n\n## Observability bar\n\n${answers.observability_bar}\n\n## Rollback / recovery bar\n\n${answers.rollback_bar}\n\n## Universal proof dimensions\n\n- Functional correctness\n- Scale / concurrency\n- Reliability / recovery\n- Security / auth / data boundaries\n- Data integrity\n- Observability\n- Cost / FinOps\n- Performance\n- Domain-specific proof\n- Live smoke\n- Operator handoff\n`;
}

function renderOperatingIntelligence(answers) {
  return `# Operating Intelligence Layer\n\nThis is the maturity layer above the basic control-plane skeleton: evals, trajectory, context, skills, memory, tools, sandboxing, model routing, economics, PR agents, interop, and production-agent lifecycle.\n\n## Eval gate\n\n- Required for: ${answers.eval_required_for}\n- Dataset owner: ${answers.eval_dataset_owner}\n- Blocking threshold: ${answers.eval_acceptance_threshold}\n- Run location: ${answers.eval_run_location}\n- Artifacts: ${answers.eval_artifacts}\n- Context quality: every loaded context manifest must commission one repo-specific case set and answer key, then bind a paired no-context or limited-context baseline and loaded-context candidate in \`evals/results.json\`. Both arms use the same cases, evaluator, model, prompt, and config. The candidate must meet its threshold, improve by the commissioned direction-aware minimum delta, and have zero critical regressions.\n\n## Trajectory evaluation\n\n- Bad trajectory: ${answers.bad_agent_trajectory}\n- Retry/loop limit: ${answers.retry_loop_limit}\n- Forbidden sequences: ${answers.forbidden_tool_sequences}\n- Score dimensions: ${answers.trajectory_scores}\n- Artifacts: ${answers.trajectory_artifacts}\n\n## Context manifest / ICM\n\n- Always loaded: ${answers.always_load_context}\n- Lane/task context: ${answers.lane_context_rules}\n- Approval-required context: ${answers.approval_required_context}\n- Stale/conflict policy: ${answers.stale_context_policy}\n- Budget: ${answers.context_budget}\n- Artifacts: ${answers.context_artifacts}\n- Quality contract: \`context/manifest.json.contextQuality\` uses \`uash.context-quality-eval.v1\`; its suite ID, baseline mode, versioned case-set and answer-key identities, metric direction, threshold, and positive minimum delta are mandatory whenever context is loaded.\n\n## Skill registry\n\n- Inventory: ${answers.skill_inventory}\n- Owners/review: ${answers.skill_owner_policy}\n- Activation: ${answers.skill_activation_rules}\n- Tool permissions: ${answers.skill_tool_permissions}\n- Proof: ${answers.skill_proof}\n- Registry artifacts: ${answers.skill_registry_artifacts}\n\n## Memory substrate\n\n- Remember: ${answers.memory_should_remember}\n- Never remember: ${answers.memory_never_remember}\n- Review owner: ${answers.memory_review_owner}\n- Retention: ${answers.memory_retention_policy}\n- Handoff rule: ${answers.memory_handoff_rule}\n- Eval policy: ${answers.memory_eval_policy}\n\n## Tool registry and hooks\n\n- Free tools: ${answers.free_tools}\n- Approval tools: ${answers.approval_tools}\n- Forbidden tools: ${answers.forbidden_tools}\n- Pre-tool hooks: ${answers.pre_tool_hooks}\n- Post-edit hooks: ${answers.post_edit_hooks}\n- Audit log: ${answers.tool_audit_log}\n\n## Sandbox manager\n\n- Isolation: ${answers.execution_isolation}\n- Filesystem roots: ${answers.filesystem_roots}\n- Network: ${answers.network_policy}\n- Secrets: ${answers.secrets_policy}\n- Cleanup: ${answers.sandbox_cleanup}\n- Escape proof: ${answers.sandbox_escape_proof}\n\n## Model routing\n\n- Lane model policy: ${answers.lane_model_policy}\n- Strong model required for: ${answers.strong_model_required_for}\n- Cheap model allowed for: ${answers.cheap_model_allowed_for}\n- Fallback: ${answers.model_fallback_path}\n- Logging: ${answers.model_logging}\n- Quality gate: ${answers.model_quality_gate}\n\n## AI economics\n\n- Run budget: ${answers.run_budget}\n- Token tracking: ${answers.token_tracking}\n- Human review tracking: ${answers.human_review_tracking}\n- Retry cost limit: ${answers.retry_cost_limit}\n- Spend approval: ${answers.spend_approval_policy}\n- Cost handoff: ${answers.cost_handoff}\n\n## Background PR agents\n\n- Allowed: ${answers.background_agents_allowed}\n- Branch policy: ${answers.agent_branch_policy}\n- PR policy: ${answers.agent_pr_policy}\n- Reviewer: ${answers.background_pr_reviewer}\n- Proof: ${answers.background_pr_proof}\n- Stale cleanup: ${answers.stale_agent_cleanup}\n\n## MCP / A2A interoperability\n\n- MCP required: ${answers.mcp_required}\n- MCP tools: ${answers.mcp_tools}\n- Allowed runtimes: ${answers.agent_runtimes}\n- A2A needed: ${answers.a2a_needed}\n- Auth/roots: ${answers.interop_auth_roots}\n- Live event definition: ${answers.live_event_definition}\n\n## Production-agent lifecycle\n\n- Deploys agents: ${answers.deploys_agents}\n- Agent definition: ${answers.agent_definition}\n- States: ${answers.agent_lifecycle_states}\n- Promotion gate: ${answers.agent_promotion_gate}\n- Observability: ${answers.agent_observability}\n- Rollback owner: ${answers.agent_rollback_owner}\n`;
}

function renderContextArmResultProtocol() {
  return `\n## Deterministic context arm result contract\n\nEach baseline and loaded-context candidate must point to a digested JSON document using \`uash.context-arm-result.v1\`. The document binds the exact context manifest, run/profile/commit/environment, suite and context mode, case-set and answer-key identities, evaluator, model, prompt, config, and metric. It records one ordered value and critical-regression flag per commissioned case. \`aggregate.method\` is \`arithmetic-mean\`; the gate derives aggregate value, case count, and critical-regression count from those rows and cross-binds them to the arm, suite, and comparison. Unstructured result logs or detached declared scores do not satisfy the finish line.\n`;
}

function renderV09OperatingContracts() {
  return `\n## Executable v0.9 operating contracts\n\n- \`run/requirements-contract.json\` maps requirements to acceptance, sealed red tests, eval suites, schema identities, and goal stopping conditions.\n- \`runtime/tool-registry.json\` and observed call receipts bind tool schemas, effects, approvals, retry/idempotency, hooks, and least-privilege scopes.\n- Durable memory-head receipts advance provider/store-bound state across sessions and isolation scopes.\n- \`runtime/driver.json\` and \`runtime/driver-state.json\` bind the external Codex, Claude Code, Hermes, or custom runtime to the goal, lease, checkpoint, stop policy, and implementation receipt.\n- Model evaluators require an independent, unexpired \`uash.model-judge-calibration.v1\`; deterministic evaluators do not.\n- \`runtime/economics.json\` reconciles usage, calls, retries, latency, spend, human review, and tenant attribution.\n- Declared MCP/A2A surfaces require the complete \`valdris.interop-transcript.v1\` suite and a separately signed \`valdris.interop-execution-receipt.v1\` that binds the exact adapter command/source, trusted runner, executor, auth root, timeout, transcript, and request/response/assertion sets. The runtime commissions distinct executor and authority principals, and runner output remains pending until that independent signer attaches the receipt.\n- \`valdris.trace-receipt.v2\` cross-binds the evaluated trajectory, exact observable trace bytes, redaction policy, and decision evidence.\n- Added or updated dependencies require approved \`valdris.dependency-provenance.v1\`.\n- Authoritative proof uses raw-Git-object OCI execution with commissioned Git/runtime/daemon and secure output-root identities. A GitHub bridge head additionally binds one canonical hostname, explicit sequence/head/history CAS, cumulative checkpoint, commissioned full-replay attestation, three-phase protection observations, deterministic resume, cleanup outcome, and a secure operator receipt root.\n\nValidate one document with \`node scripts/operating-contract-gate.mjs --repo . --file <path>\`; validate all cross-bindings through the semantic/authoritative closure.\n`;
}

function renderOperatingContractValidation(paths) {
  return `\n## v0.9 operating contracts\n\nValidate a canonical operating document with:\n\n\`\`\`bash\nnode ${paths.scriptFromRepo}/operating-contract-gate.mjs --repo . --file run/requirements-contract.json\n\`\`\`\n\nFor long-running external-agent execution, advance \`runtime/driver-state.json\` with \`runtime-driver-state.mjs\` using an expected-head compare-and-swap. The complete semantic/authoritative gate cross-binds requirements, tools/calls, durable memory, runtime driver, economics, interop, dependency provenance, and trace-v2 evidence. Authoritative GitHub head proof must use the commissioned canonical hostname, explicit history CAS and cumulative checkpoint, external replay attestation, three protection observations, deterministic resume, cleanup evidence, and a secure operator receipt root.\n`;
}

function renderTeamHarnessRegistry(answers) {
  return `# Team Harness Registry\n\n## Ownership\n\n- Harness owner: ${answers.harness_owner}\n- Prompt/front-door owner: ${answers.prompt_owner}\n- Eval owner: ${answers.eval_owner}\n- Connector owner: ${answers.connector_owner}\n- Harness change approval: ${answers.harness_change_approval}\n\n## Drift check\n\n${answers.harness_drift_check}\n\n## Registry rule\n\nPrompts, skills, evals, connectors, model routes, tools, and proof banks need owners, versions, review policy, and drift checks. If nobody owns a harness object, the agent should treat it as risky/stale.\n`;
}

function renderHumanAgentProtocol(answers) {
  return `# Human-Agent Operating Protocol\n\n## Decision and review owners\n\n- Decision owner: ${answers.decision_owner}\n- Normal PR reviewer: ${answers.normal_pr_reviewer}\n- Specialist reviewers: ${answers.specialist_reviewers}\n\n## Escalation and SLA\n\n- Escalation path: ${answers.escalation_path}\n- Blocked-agent SLA: ${answers.blocked_agent_sla}\n- Contact channels: ${answers.human_contact_channels}\n\n## Approval contract\n\n${answers.approval_contract}\n\n## Rule\n\nApprovals are durable scoped objects, not vibes. Agents may request approval; they may not grant it to themselves.\n`;
}

function renderProofSchema(answers, paths) {
  return `# UASH Proof Schema v1

The finish line accepts proof only when \`proof/proof.json\` conforms to passing \`uash.proof.v1\`: \`status: "passed"\`, at least one command, and every command \`exitCode: 0\`. A file that only says \`{"exitCode":0}\`, or a schema-shaped failed proof, is not enough.

## Minimal passing shape

\`\`\`json
{
  "schema": "uash.proof.v1",
  "generatedAt": "2026-07-03T00:00:00.000Z",
  "runId": "EXAMPLE-RUN-123",
  "status": "passed",
  "summary": "All required validation commands passed.",
  "commands": [
    {
      "command": "npm run typecheck",
      "exitCode": 0,
      "startedAt": "2026-07-03T00:00:00.000Z",
      "completedAt": "2026-07-03T00:00:01.000Z",
      "outputDigest": "sha256:<digest>",
      "stdoutTail": "..."
    }
  ]
}
\`\`\`

## Generate it

\`\`\`bash
node scripts/uash-write-proof.mjs --run-id "$RUN_ID" \\
  --command "${answers.typecheck_command}" \\
  --command "${answers.build_command}" \\
  --out proof/proof.json
\`\`\`

## Bridge rule

When \`artifact.written\` is emitted for the \`prove\` node, the bridge parses the file and rejects it unless this schema, \`status: "passed"\`, and zero-exit command evidence are present.

## v0.9 completion envelope

proof/proof.json is necessary but not sufficient. Final completion also requires the ordered goal, enterprise/AI, conditional RCA, frozen pre-review evidence, signed four-role review, and immutable run-packet closure below. \`review/review.json\` uses \`valdris.review.v2\`; new \`run/packet.json\` artifacts use \`valdris.run-packet.v3\`. Historical v2 packets are structural evidence only.

${renderOrderedV08Closure(paths)}
`;
}

function renderRunTemplate(answers, finishLineArtifacts) {
  const requiredArtifactLines = finishLineArtifacts
    .map((artifact) => `- \`${artifact}\``)
    .join("\n");
  return `# Run Packet Template\n\nProject: ${answers.project_name}\n\n## Required finish-line artifacts\n\nThese entries are generated from \`project-adapter.json.finishLineAssurance.requiredArtifacts\` so the operator front door and machine-readable policy stay aligned:\n\n${requiredArtifactLines}\n\n## Supporting node artifacts\n\n- \`run/mode.json\`\n- \`graph/gitnexus.json\` with GitNexus index evidence when available, or a disclosed local-fallback reason\n- \`graph/freshness.json\` proving graph commit/freshness\n- \`design/system_design.md\` when design/architecture matters\n- \`cloud/service-map.json\` for cloud/platform work, or \`cloud/skip.json\` with reason\n- \`approvals/redzone.json\` when Red Zone applies\n- \`qa/qa-plan.md\` when validation scope matters\n- \`qa/break-it-results.md\` or explicit skip reason\n- \`proof/proof.json\` (passing \`uash.proof.v1\`) before done\n- \`self_heal/self_heal_report.md\` when a process/harness gap is found\n- \`handoff/final.md\`\n\nThe complete .valdris-harness runtime and trust store must be committed in the same target worktree before portable proof. After every non-review gate artifact exists, run .valdris-harness/scripts/run-create.mjs with --print-evidence-bundle; the independent reviewer must sign the returned evidenceBundleSha256 before final packet creation. Any later input, RCA, gate, runtime, or application-source change is rejected. Clean-room privacy scans the pack; the scoped evidence check scans graph/ and design/anchors.json without applying the harness binary allowlist to arbitrary product assets.\n\n## Final handoff shape\n\nBottom line\nWhy\nProof\nRisk\nFix/Plan\nYour call\nSkipped nodes / reasons\n`;
}

function renderFourRoleProtocol() {
  return `
## Four-role portable closure

- \`review/review.json\` uses \`valdris.review.v2\` and declares exactly \`scout\`, \`implementer\`, \`verifier\`, and \`independentReviewer\`.
- \`actorId\`, \`sessionId\`, and \`executionId\` are pairwise distinct across all four roles. There is no implicit same-actor or same-session relaxation.
- Scout evidence binds \`run/route.json\`; implementer and verifier evidence bind \`proof/portable.json\`; the independent reviewer binds the pre-review \`evidenceBundleSha256\`.
- The trusted Ed25519 review signature covers the entire role roster. \`valdris.run-packet.v3\` exposes \`roleProvenanceSha256\`, assurance level, and resolved catalog snapshots and binds them into the final envelope.
- Any future tier-scaled relaxation requires a versioned contract change and an explicit governed waiver.
`;
}

function renderGoalSkillProtocol() {
  return `\n## Valdris v0.9 goal and skill protocol\n\n1. Discover Codex skills from their \`SKILL.md\` YAML frontmatter, then read \`.valdris-harness/skills/codex-routing.yaml\` and the gate-authoritative \`.valdris-harness/skills/registry.json\`.\n2. Use the seven lifecycle skills to select the owning Valdris lifecycle system: commission -> route-goal -> assure -> connect-runtime -> execute-workflow -> prove-govern -> trust-improve. Select exactly one lifecycle skill for the requested system operation.\n3. Inside routed engineering work, use the separate eight-skill work catalog: select one primary work skill for the current intake, delivery, or proof-handoff phase plus the smallest supporting set. Lifecycle skills never replace the route's work primary.\n4. Store durable multi-checkpoint state in \`goal/goal.json\`; runtime-native goal/loop state is advisory only.\n5. Run provenance, neutrality, pack-scoped privacy, generated-evidence privacy, and schema-compatibility gates before trusting imported or generated assurance content.\n6. Activate the production, AI, eval, trajectory, smoke, RCA, and domain gates only when the adapter and route make them applicable; justify non-applicability.\n7. Treat async workflows, orchestration, memory, model routing, and interop as cross-cutting capabilities over Layer 0 and the thirteen production-assurance domains, never as Layer 14.\n8. Run \`node .valdris-harness/scripts/enterprise-ai-gate-all.mjs --repo .\`, then validate the Ed25519-attested independent review against the committed review trust store. For semantic or authoritative claims, also validate \`assurance/authoritative.json\` against the operator-pinned authority trust store before creating \`valdris.run-packet.v3\`. Agents may not add or trust their own key.\n9. Before live completion, request and receive token-gated human approval with scope \`route\` and artifact \`run/route.json\`; the bridge binds that approval to the route digest.\n\nNo runtime may override a failing Valdris gate or grant its own Red Zone approval.\n`;
}

function renderBridgeCredentialBoundary(agentName) {
  return `
## Bridge credential boundary

This section is authoritative for every bridge command above. Launch the ${agentName} process with only \`UASH_BRIDGE_ACCESS_TOKEN\`; the emitter supplies it as \`x-uash-bridge-token\` for ordinary API reads and writes. Never put the bridge-only \`UASH_BRIDGE_INTEGRITY_KEY\` or operator-held \`UASH_HUMAN_APPROVAL_TOKEN\` in an agent prompt, environment, client bundle, or generated evidence.

An agent may emit \`approval.requested\`, then must stop. A real operator grants or denies from a separate shell that has both \`UASH_BRIDGE_ACCESS_TOKEN\` for API access and the distinct \`UASH_HUMAN_APPROVAL_TOKEN\` for the human decision. The emitter reads both credentials from that operator-only environment and sends them as headers; it never accepts the human token through process arguments or request bodies. Possession of the access token alone cannot self-approve.
`;
}

function hardenGeneratedConnectorPrompt(content, agentName) {
  return String(content)
    .replace(
      "If RUN_ID is missing, ask for it before changing files. Do not invent one.",
      `If RUN_ID is missing, ask for it before changing files. Do not invent one. Launch ${agentName} with only UASH_BRIDGE_ACCESS_TOKEN; never load the integrity or human-approval credential into the agent process.`,
    )
    .replace(
      "Only a real operator/human approval event may grant/deny approval. Agents must not self-approve; the operator grant requires the operator-held bridge token:",
      "Only a real operator/human approval event may grant/deny approval. Agents must not self-approve; the operator runs the grant from a separate shell holding both the bridge access token and the distinct human approval token:",
    )
    .replace(
      "Commissioned packs include `scripts/uash-emit-event.mjs`; run event commands from the generated pack root or from a repo where that script has been installed.",
      "Commissioned packs include `.valdris-harness/scripts/uash-emit-event.mjs`; run event commands from the target repository root, invoke that nested script path, and pass the target root as `--artifact-root`.",
    );
}

function renderLayerZeroProtocol() {
  return `
## Layer 0 workload and foundation assurance

Layer 0 runs inside the stable \`route\` stage; do not invent a new connector node ID. First validate \`run/workload-classification.json\` as \`uash.workload-classification.v1\`, then validate \`foundation/assessment.json\` as \`uash.foundation-assessment.v1\` before implementation and before resolving the 13 production-readiness domains. The route uses \`uash.route.v2\` and digest-binds the classification so later mutation invalidates the reviewed route.

The workload taxonomy can activate the \`saas\`, \`mobile-ios\`, \`multiplayer-realtime\`, \`digital-commerce\`, and \`youth-ai-safety\` domain packs. Domain-pack assurance remains separate from workload classification.

The Foundation / Good Looks Like layer is numbered 0 because it establishes product/domain intent, requirements, quality attributes, architecture boundaries, data/transaction semantics, engineering/test strategy, and decision ownership before production evidence is accepted. It is not a fourteenth production domain.

Async and multi-agent orchestration are cross-cutting execution concerns. Route them through the applicable foundation, production, AI, trajectory, authority, and proof gates instead of modeling orchestration as another production domain.
`;
}

function renderTerminologyProtocol(answers, paths) {
  return `
## Ontology-grounded terminology and controlled technical English

This communication profile governs how agents speak and write. It is not an SDLC layer, production domain, lifecycle stage, skill, gate, or product capability.

For all technical and operational output:

1. Answer the user's question first.
2. Use one stable term for one meaning. Define unfamiliar terms once.
3. Use short, direct sentences with explicit actors, actions, objects, and conditions when they affect meaning.
4. Keep one primary instruction or decision in each sentence when practical.
5. Remove padding, repetition, decorative language, metaphors, analogies, slogans, dense noun chains, and inflated labels.
6. Preserve necessary technical distinctions and state uncertainty directly.

When a material public, architectural, legal, safety, or standards term must be selected:

1. Inspect the actual mechanism and direct evidence.
2. Identify the applicable domain ontology and explicit category criteria.
3. If local evidence cannot establish a criterion or term status, open direct authoritative sources.
4. Separate sourced facts from classification inference and corroborate contested claims.
5. Select the smallest supported term or category, define it plainly, and state its status and uncertainty.
6. If evidence remains incomplete, conclude \`uncertain\` or \`not_established\`. Do not guess.

Use \`${paths.packFromRepo}/docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md\` and \`${paths.packFromRepo}/policies/technical-communication.v1.json\`. For a material naming decision that needs an audit record, start from \`${paths.packFromRepo}/classification/classification-record.template.json\` and check it with \`node ${paths.scriptFromRepo}/classification-record-check.mjs --repo . --file <record-path> --catalog ${paths.packFromRepo}/policies/technical-communication.v1.json\`. Routine communication does not require a classification record.

Commissioned ontology sources: ${answers.domain_ontology_sources}

Commissioned controlled vocabulary: ${answers.controlled_vocabulary}

Qualified terms: ${answers.qualified_terms}

Source escalation: ${answers.authoritative_source_policy}

Unavailable-web rule: ${answers.web_research_availability}

Citation policy: ${answers.citation_policy}

Technical-English profile: ${answers.technical_english_profile}

ASD-STE100 Issue 9 is the target authoring standard. Do not claim formal conformance unless the complete applicable writing rules and controlled dictionary have been checked for the output.
`;
}

function renderLayerZeroValidation(paths) {
  return `
## Layer 0 validation

Run these from the target repository root:

\`\`\`bash
node ${paths.scriptFromRepo}/catalog-integrity-gate.mjs --repo .
node ${paths.scriptFromRepo}/intake-gate.mjs --repo .
node ${paths.scriptFromRepo}/workload-classification-gate.mjs --repo .
node ${paths.scriptFromRepo}/route-gate.mjs --repo .
node ${paths.scriptFromRepo}/foundation-gate.mjs --repo .
node ${paths.scriptFromRepo}/goal-gate.mjs --repo . --allow-active
\`\`\`

New routes use \`uash.route.v2\`. Workload classification stays inside the stable \`route\` connector stage, and Layer 0 foundation assurance must resolve before implementation and the 13 production-readiness domains.
`;
}

function renderInstalledPathProtocol(repo, out) {
  const relativePack = path.relative(repo, out).replaceAll("\\", "/") || ".";
  const scriptPrefix =
    relativePack === "." ? "scripts" : `${relativePack}/scripts`;
  const adapterPath =
    relativePack === "."
      ? "project-adapter.json"
      : `${relativePack}/project-adapter.json`;
  return `\n## Installed pack command paths\n\nRun these commands from the **target repository root**. The only supported v0.8 installation is the target-nested, same-worktree pack at \`${relativePack}\`. Commit that entire directory before portable proof, signed review, or run-packet creation; validators reject an untracked, dirty, external, or differently located validation runtime.\n\n\`\`\`bash\ngit add ${relativePack}\ngit commit -m \"chore: commission Valdris harness\"\nnode ${scriptPrefix}/route-request.mjs --repo . --request \"<task>\" --actor \"<human>\"\nnode ${scriptPrefix}/enterprise-ai-gate-all.mjs --repo .\nUASH_BRIDGE_URL=\"$BRIDGE_URL\" node ${scriptPrefix}/uash-emit-event.mjs \"$RUN_ID\" node.entered intake \"Agent started intake\" --artifact run/intake.json --status ok --actor codex --artifact-root \"$PWD\" --adapter-path ${adapterPath}\n\`\`\`\n\nEvery first nested-pack bridge event must include both \`--artifact-root\` and \`--adapter-path\` so the v0.8 adapter cannot be bypassed. Clean-room privacy applies to \`${relativePack}\`; product assets follow the target project's reviewed asset/security policy. After code-intelligence generation, separately scan \`graph/\` and \`design/anchors.json\` with the scoped evidence command from \`docs/Validation Commands.md\`.\n`;
}

function renderReview(adapter) {
  const answers = adapter.answers;
  return `# Commissioning Review Packet\n\n## Bottom line\n\nGenerated a project-specific harness pack for **${answers.project_name}** at \`.valdris-harness\`. This target-nested directory is the validation runtime and must be committed in the same Git worktree as the product before portable proof, signed review, or run-packet creation.\n\n## What was detected\n\n- Repo: \`${adapter.detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${adapter.detected.frameworks.join(", ") || "none detected"}\n- Package manager: ${adapter.detected.packageManager}\n\n## Human-supplied operating rules\n\n- Operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Approval owner: ${answers.approval_owner}\n- Red Zone: ${answers.red_zone_actions}\n\n## v0.6 commissioning + trust-boundary hardening\n\n- Commissioning question groups: ${adapter.commissioning.questionGroups}\n- Commissioning questions: ${adapter.commissioning.questionCount}\n- Target-root discovery loaders: ${Object.entries(
    adapter.installation.discoveryLoaders,
  )
    .map(([file, loader]) => `${file} (${loader.action})`)
    .join(
      ", ",
    )}\n- GitNexus/code intelligence policy: ${answers.code_graph}\n- Code-intelligence backend: GitNexus preferred, local static graph fallback disclosed\n- System Design lane triggers: ${answers.system_design_triggers}\n- Foundation blueprint: ${answers.reference_architecture}\n- Anti-spaghetti guardrails: ${answers.anti_spaghetti_rules}\n- Ontology and terminology sources: ${answers.domain_ontology_sources}\n- Technical-English profile: ${answers.technical_english_profile}\n- Technical communication: cross-cutting authoring behavior; authoritative-source escalation; optional evidence record for auditable material naming decisions\n- Enterprise proof-bank domain pack: ${answers.domain_pack}\n- Operating intelligence: evals, trajectory, context, skills, memory, tools/hooks, sandbox, model routing, economics, PR agents, MCP/A2A, agent lifecycle\n- Production layers checked: ${splitList(answers.production_layers).length}\n- Cloud/platform providers: ${answers.cloud_providers}\n- Break-it QA policy: ${answers.break_it_qa_policy}\n- Mode policy: ${answers.telemetry_mode_policy}\n- Self-heal policy: ${answers.self_heal_allowed}\n- Clean-room privacy scope: \`.valdris-harness\`; generated \`graph/\` and \`design/anchors.json\` are checked separately, while product binaries use the target's reviewed asset policy\n- Signed review trust: configure at least one operator-owned Ed25519 public key in \`.valdris-harness/controls/review-trust.v1.json\`; the generated empty trust store intentionally blocks final completion\n\n## Next gate\n\nReview \`.valdris-harness/project-adapter.json\` plus the bounded Valdris loader blocks installed in target-root \`AGENTS.md\` and \`CLAUDE.md\`, commission the review trust store without exposing the private key to agents, and commit the complete pack and root discovery loaders before handing the repo to Claude Code/Codex.\n`;
}

function renderReviewTrustPinProtocol(adapter) {
  return `\n## Operator-held review trust pin\n\n- Generated trust-store digest: \`${adapter.reviewTrust.generatedDigest}\` using canonical-JSON SHA-256. This commissioning value is informational, not its own authority.\n- Configure the reviewed digest out of band as protected \`UASH_REVIEW_TRUST_SHA256\` before review, packet, bridge, or CI validation.\n- A delivery-agent-controlled shell cannot establish this external trust boundary merely by setting its own environment variable.\n- For governed rotation, a human operator reviews the new store and updates the protected pin before accepting it; validators never learn or auto-update the pin from the checkout under validation.\n`;
}

function generatePack(args, detected, answers, answerSources) {
  const repoRoot = path.resolve(detected.repoPath);
  const canonicalOut = path.join(repoRoot, ".valdris-harness");
  const out = path.resolve(args.out || canonicalOut);
  if (
    path.relative(canonicalOut, out) !== "" ||
    path.relative(out, canonicalOut) !== ""
  ) {
    throw new Error(
      `Valdris v0.9 requires the committed target-nested pack at ${canonicalOut}; set --out to <repo>/.valdris-harness`,
    );
  }
  if (fs.existsSync(out)) {
    const outputStats = fs.lstatSync(out);
    if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
      throw new Error(
        "Refusing a .valdris-harness output that is a symbolic link or is not a directory",
      );
    }
  }
  const outputIsNonEmpty = fs.existsSync(out) && fs.readdirSync(out).length > 0;
  if (outputIsNonEmpty && !args.force)
    throw new Error(
      `Output directory is not empty: ${out}. Use --force only to replace a reviewed generated pack.`,
    );
  if (outputIsNonEmpty && args.force) {
    const marker = readJsonIfExists(path.join(out, "project-adapter.json"));
    if (
      marker?.schema !== "uash.project-adapter.v2" ||
      !marker?.generatorVersion
    )
      throw new Error(
        "Refusing --force because the output is not a recognized generated Valdris pack",
      );
  }
  const packFromRepo =
    path.relative(repoRoot, out).replaceAll("\\", "/") || ".";
  const repoFromPack =
    path.relative(out, repoRoot).replaceAll("\\", "/") || ".";
  const scriptFromRepo =
    packFromRepo === "." ? "scripts" : `${packFromRepo}/scripts`;
  const rootLoaderPlans = ROOT_DISCOVERY_LOADER_FILES.map((fileName) =>
    planRootDiscoveryLoader(repoRoot, fileName),
  );
  const generatedReviewTrustSha256 = reviewTrustStoreSha256(
    path.join(HARNESS_ROOT, "controls", "review-trust.v1.json"),
  );
  const generatedAuthorityTrustSha256 = reviewTrustStoreSha256(
    path.join(HARNESS_ROOT, "controls", "authority-trust.v1.json"),
  );
  const adapter = {
    schema: "uash.project-adapter.v2",
    generatedAt: new Date().toISOString(),
    generatorVersion: VERSION,
    detected: { ...detected, repoPath: "." },
    answers,
    commissioning: {
      questionGroups: QUESTION_GROUPS.length,
      questionCount: questionList().length,
      version: VERSION,
      answerSources,
    },
    installation: {
      pathBasis: "target-repository-root",
      targetRoot: ".",
      packRoot: ".valdris-harness",
      commitRequired: true,
      sameGitWorktreeRequired: true,
      discoveryLoaders: Object.fromEntries(
        rootLoaderPlans.map((plan) => [
          plan.fileName,
          {
            target: plan.fileName,
            loads: `.valdris-harness/${plan.fileName}`,
            action: plan.action,
          },
        ]),
      ),
      discoveryLoadersCommitRequired: true,
      discoveryLoaderPolicy:
        "Commissioning creates or safely merges bounded Valdris loader blocks at the target root; unsafe files or malformed/duplicate markers block installation.",
      policy:
        "The complete .valdris-harness directory and its bounded target-root AGENTS.md/CLAUDE.md discovery loaders must be committed in the target repository before portable proof, independent review, or run-packet creation.",
    },
    laneFamilies: DEFAULT_LANE_FAMILIES,
    lanes: splitList(answers.enabled_lanes),
    redZoneActions: splitList(answers.red_zone_actions),
    codeGraph: {
      nodeId: "code-intelligence",
      primaryProvider: "GitNexus",
      provider:
        "GitNexus-backed code intelligence with local static graph fallback",
      package: "gitnexus@latest",
      sourceRepo: "https://github.com/abhigyanpatwari/GitNexus",
      license: "PolyForm-Noncommercial-1.0.0",
      licenseBoundary:
        "Invoked externally with npx in index-only mode; GitNexus code is not vendored into generated harness packs.",
      fallbackProvider: "local-static-code-graph",
      policy: answers.code_graph,
      requiredArtifacts: [
        "graph/graph.json",
        "graph/freshness.json",
        "design/anchors.json",
      ],
      preferredArtifacts: ["graph/gitnexus.json"],
      scanCommand: `node ${scriptFromRepo}/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local`,
      strictScanCommand: `node ${scriptFromRepo}/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback none --strict`,
      gateCommand: `node ${scriptFromRepo}/code-intelligence-gate-all.mjs --repo .`,
      skipAllowedOnlyFor:
        "docs-only or non-code work with explicit skip reasons for code-intelligence and design-anchors",
      fallbackDisclosureRequired: true,
    },
    workloadTaxonomy: {
      schema: "uash.workload-classification.v1",
      catalogSchema: "uash.workload-taxonomy-catalog.v1",
      catalog: "controls/workload-taxonomy.v1.json",
      artifact: "run/workload-classification.json",
      routeSchema: "uash.route.v2",
      stableNodeId: "route",
      gateCommand: `node ${scriptFromRepo}/workload-classification-gate.mjs --repo .`,
      enforcement: "gate",
      policy:
        "Classify workload tier and profiles before route decisions; uncertainty may widen assurance but may not silently downgrade it.",
    },
    technicalCommunication: {
      policySchema: "valdris.terminology-policy.v1",
      policy: "policies/technical-communication.v1.json",
      canonicalDocument: "docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md",
      sourceRegister: "docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md",
      appliesTo: "All technical and operational agent output.",
      targetStandard: {
        name: "ASD-STE100",
        issue: "9",
        publicationDate: "2025-01-15",
        conformanceStatus: "not_verified",
      },
      localEvidenceFirst: true,
      authoritativeWebEscalation: answers.authoritative_source_policy,
      unavailableWebDisposition: answers.web_research_availability,
      citationPolicy: answers.citation_policy,
      controlledVocabulary: answers.controlled_vocabulary,
      qualifiedTerms: answers.qualified_terms,
      technicalEnglishProfile: answers.technical_english_profile,
      materialClassification: {
        schema: "valdris.ontology-classification.v1",
        template: "classification/classification-record.template.json",
        requiredForRoutineCommunication: false,
        requiredWhen:
          "A material public, architectural, legal, safety, or standards naming decision needs an auditable evidence record.",
        checkCommand: `node ${scriptFromRepo}/classification-record-check.mjs --repo . --file <record-path> --catalog ${packFromRepo}/policies/technical-communication.v1.json`,
      },
    },
    foundationAssurance: {
      schema: "uash.foundation-assessment.v1",
      catalogSchema: "uash.foundation-control-catalog.v1",
      catalog: "controls/foundation-layer.v1.json",
      artifact: "foundation/assessment.json",
      requiredBindings: [
        "catalogSha256",
        "workloadClassificationSha256",
        "runId",
        "profile",
        "effectiveTier",
        "commit",
        "environment",
      ],
      layer: {
        id: "foundation",
        number: 0,
        title: "Foundation / Good Looks Like",
      },
      gateCommand: `node ${scriptFromRepo}/foundation-gate.mjs --repo .`,
      enforcement: "gate",
      requiredBefore: ["implementation", "13 production-readiness domains"],
      asyncOrchestration:
        "Cross-cutting execution concern governed by foundation, production, AI, trajectory, authority, and proof gates; not a separate production domain.",
    },
    productionReadiness: {
      layers: splitList(answers.production_layers),
      schema: "uash.production-readiness.v2",
      catalog: "controls/production-layers.v2.json",
      gateCommand: `node ${scriptFromRepo}/production-layer-gate.mjs --repo .`,
      skipPolicy: answers.production_layer_skip_policy,
      proof: answers.production_readiness_proof,
    },
    generativeAiAssurance: {
      schema: "uash.ai-assurance.v1",
      catalog: "controls/genai-assurance.v1.json",
      artifact: "ai/assurance.json",
      profiles: ["AI-0", "AI-1", "AI-2", "AI-3"],
      gateCommand: `node ${scriptFromRepo}/ai-assurance-gate.mjs --repo .`,
      policy:
        "Cross-cutting assurance overlay; not a fourteenth infrastructure layer. Required when models, prompts, retrieval, tools, memory, or agents affect behavior.",
    },
    domainAssurance: {
      schema: "uash.domain-assurance.v1",
      index: "controls/domain-packs/index.json",
      availablePacks: [
        "saas",
        "mobile-ios",
        "multiplayer-realtime",
        "digital-commerce",
        "youth-ai-safety",
      ],
      artifact: "domain/assurance.json",
      gateCommand: `node ${scriptFromRepo}/domain-assurance-gate.mjs --repo .`,
    },
    mobileIos: {
      detected: detected.frameworks.some((framework) =>
        ["Xcode/iOS", "CocoaPods", "Fastlane"].includes(framework),
      ),
      scheme: answers.ios_scheme,
      bundleAndTeam: answers.ios_bundle_id,
      supportMatrix: answers.ios_support_matrix,
      macosRunner: answers.ios_macos_runner,
      signingOwner: answers.ios_signing_owner,
      testflightOwner: answers.ios_testflight_owner,
      storeKitModel: answers.ios_storekit_model,
      pushModel: answers.ios_push_model,
      redZone: [
        "signing credentials",
        "App Store Connect keys",
        "TestFlight upload/promotion",
        "tester invitation",
        "real StoreKit configuration",
      ],
    },
    goalLoop: {
      schema: "uash.goal.v1",
      artifact: "goal/goal.json",
      gateCommand: `node ${scriptFromRepo}/goal-gate.mjs --repo .`,
      transitionCommand: `node ${scriptFromRepo}/goal-transition.mjs --repo . --expected-revision <n> ...`,
      finishAuthority:
        "Valdris gates and human approvals; runtime-native goal/loop state is advisory acceleration only.",
    },
    skillRouter: {
      schema: "uash.skill-registry.v2",
      registry: "skills/registry.json",
      codexRouting: "skills/codex-routing.yaml",
      implicitInvocation: true,
      workflowCatalogSize: 8,
      lifecycleCatalogSize: 7,
      lifecycleRouteCommand: `node ${scriptFromRepo}/route-lifecycle-skill.mjs --repo . --request "<request>"`,
      gateCommand: `node ${scriptFromRepo}/skill-registry-gate.mjs --repo ${packFromRepo}`,
      selection:
        "One lifecycle skill for the owning system; inside routed work, one primary work skill plus the smallest supporting set.",
    },
    cleanRoomAssurance: {
      provenanceManifest:
        "controls/provenance/thirteen-layers.upstream.v1.json",
      crosswalk: "controls/crosswalks/thirteen-layers-to-uash.v1.json",
      executionPolicy: "controls/assurance-execution-policy.v1.json",
      gates: [
        "provenance-gate.mjs",
        "neutrality-gate.mjs",
        "privacy-gate.mjs",
        "schema-compat-gate.mjs",
      ],
      policy:
        "Restricted project inputs contribute behavioral requirements only; public copied assets require pinned provenance and integrity verification.",
      privacyScope: {
        pack: ".valdris-harness",
        packCommand: `node ${scriptFromRepo}/privacy-gate.mjs --repo ${packFromRepo}`,
        generatedEvidence: ["graph", "design/anchors.json"],
        generatedEvidenceCommand: `node ${scriptFromRepo}/privacy-gate.mjs --repo . --include graph --include design/anchors.json`,
        productAssetsPolicy:
          "Product binaries are outside the clean-room import gate and remain governed by the target repository's commissioned asset, privacy, security, and supply-chain policies.",
      },
    },
    crossCuttingCapabilities: {
      asyncWorkflows: {
        catalog: "controls/capability-packs/async-workflows.v1.json",
        productionLayer: false,
        policy:
          "Assess async workflows across every affected existing domain; never create Layer 14 for orchestration.",
      },
    },
    portableExecution: {
      proofCommand: `node ${scriptFromRepo}/proof-runner.mjs --repo . --run-id <id> --commit <sha> --environment <name> --output proof/portable.json [--causal-input <repo/path> ...] -- <executable> [args...]`,
      rcaGateCommand: `node ${scriptFromRepo}/rca-gate.mjs --repo .`,
      reviewGateCommand: `node ${scriptFromRepo}/review-gate.mjs --repo .`,
      runPacketGateCommand: `node ${scriptFromRepo}/run-packet-gate.mjs --repo .`,
      roleSeparation: {
        schema: "valdris.review-role-provenance.v1",
        reviewSchema: "valdris.review.v2",
        runPacketSchema: "valdris.run-packet.v3",
        historicalRunPacketSchema: "valdris.run-packet.v2",
        requiredRoles: [
          "scout",
          "implementer",
          "verifier",
          "independentReviewer",
        ],
        pairwiseDistinctIdentityFields: ["actorId", "sessionId", "executionId"],
        evidenceBindings: {
          scout: "run/route.json",
          implementer: "proof/portable.json",
          verifier: "proof/portable.json",
          independentReviewer: "review evidenceBundleSha256",
        },
        waiverPolicy:
          "Role collapse is forbidden. Any future tier-scaled relaxation requires an explicit governed waiver and a versioned contract change.",
      },
    },
    reviewTrust: {
      schema: "valdris.review-trust.v1",
      path: ".valdris-harness/controls/review-trust.v1.json",
      algorithm: "ed25519",
      privateKeyPolicy:
        "Private review keys remain outside the repository and outside agent reach; agents may not add or activate their own trusted key.",
      pinEnvironment: "UASH_REVIEW_TRUST_SHA256",
      pinDigestScheme: "sha256-canonical-json",
      generatedDigest: generatedReviewTrustSha256,
      generatedDigestAuthority:
        "Informational commissioning handoff only. The authoritative pin is operator/CI-held outside the repository under validation.",
      rotationPolicy:
        "A human operator updates the protected out-of-band pin before a reviewed trust-store rotation is accepted; validators never auto-enroll from repository bytes.",
      commissioned: false,
    },
    authoritativeAssurance: {
      releaseStatus: "release-candidate",
      levels: ["structural", "semantic", "authoritative"],
      policy: ".valdris-harness/controls/authoritative-assurance.v1.json",
      trustStore: ".valdris-harness/controls/authority-trust.v1.json",
      trustPinEnvironment: "VALDRIS_AUTHORITY_TRUST_SHA256",
      generatedTrustDigest: generatedAuthorityTrustSha256,
      authoritativeClaimAvailable: "derived-at-runtime",
      runtimeExecutionBoundary: {
        policySchema: "valdris.runtime-execution-isolation-policy.v1",
        threatBoundary: "trusted-host-operator-vs-isolated-untrusted-workload",
        samePrincipalCompromisePolicy: "external-isolation-required",
        authoritySeparationMode: "independent-external-principal",
        requiredAuthoritySeparationReceipt:
          "valdris.executor-authority-separation-receipt.v1",
        requiredCommissionedLimits: [
          "cpu",
          "memory",
          "outputBytes",
          "wallClockMs",
          "wallClockScope",
          "cleanupReserveMs",
        ],
        trustedComputingBase: [
          "host operator and operating-system administrator roots",
          "executor signing and receipt roots",
        ],
        untrustedWorkload: {
          uid: 65534,
          gid: 65534,
          networkPolicy: "none",
          hostMounts: false,
          capsuleAccess: false,
          ambientSecrets: false,
        },
      },
      commissioningRule:
        "Authoritative claims require provider-backed signed approval, executor, independently signed external-principal authority separation, model-routing, trace, usage, and rollback-resistant bridge-head receipts. The executing agent cannot enroll its own key.",
      gateCommand: `node ${scriptFromRepo}/authoritative-assurance-gate.mjs --repo .`,
      readinessCommand: `node ${scriptFromRepo}/assurance-readiness.mjs --repo . --level authoritative`,
      referenceExecutor: `node ${scriptFromRepo}/attested-proof-executor.mjs`,
      referenceHeadAdapter: `node ${scriptFromRepo}/github-bridge-head.mjs`,
    },
    finishLineAssurance: {
      required: true,
      gateCommand: `node ${scriptFromRepo}/enterprise-ai-gate-all.mjs --repo .`,
      packetRequired: true,
      independentReviewRequired: true,
      rcaRequiredFor: ["bug", "regression", "incident", "self-heal"],
      packetGateCommand: `node ${scriptFromRepo}/run-packet-gate.mjs --repo .`,
      reviewGateCommand: `node ${scriptFromRepo}/review-gate.mjs --repo .`,
      rcaGateCommand: `node ${scriptFromRepo}/rca-gate.mjs --repo .`,
      requiredArtifacts: [
        "run/intake.json",
        "run/workload-classification.json",
        "run/route.json",
        "foundation/assessment.json when foundation applies",
        "goal/goal.json",
        "context/manifest.json",
        "graph + anchors when code intelligence applies",
        "production/layer-assessment.json when production applies",
        "ai/assurance.json",
        "domain/assurance.json",
        "evals/results.json",
        "paired uash.context-arm-result.v1 JSON files referenced by evals/results.json",
        "trajectory/trajectory.json",
        "smoke/smoke_proof.json when smoke applies",
        "waivers/waivers.json",
        "proof/portable.json",
        "rca/rca.json when RCA applies",
        ".valdris-harness/controls/review-trust.v1.json with an operator-commissioned active key",
        "review/review.json",
        "run/packet.json",
        "run/implementation-readiness.json for semantic or authoritative claims",
        "assurance/semantic.json for semantic or authoritative claims",
        "runtime/session.json for semantic or authoritative claims",
        "review/change-review.json for semantic or authoritative claims",
        "assurance/authoritative.json for authoritative claims",
        "release/promotion.json when promoting prototype evidence",
        "learning/feedback-loop.json when changing the harness from production learning",
        ".valdris-harness/controls/authority-trust.v1.json with operator-commissioned keys",
        ".valdris-harness/skills/codex-routing.yaml",
        ".valdris-harness/skills/registry.json",
      ],
      binding: [
        "runId",
        "profile",
        "commit",
        "environment",
        "assuranceLevel",
        "catalogSnapshots",
        "roleProvenanceSha256",
      ],
    },
    knowledgeVault: {
      format: "OKF v0.1",
      root: "knowledge/",
      index: "knowledge/index.md",
      log: "knowledge/log.md",
      gateCommand: `node ${scriptFromRepo}/okf-vault-gate.mjs --repo ${packFromRepo}`,
      policy:
        "Use as the first progressive-disclosure map after AGENTS.md; update when durable routing knowledge changes.",
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
        contextQualityComparisonRequired: true,
        contextComparisonSchema: "uash.context-comparison.v1",
        contextArmResultSchema: "uash.context-arm-result.v1",
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
        contextQuality: {
          schema: "uash.context-quality-eval.v1",
          requiredWhenContextLoaded: true,
          baselineModes: ["no-context", "limited-context"],
          resultsArtifact: "evals/results.json",
          armResultSchema: "uash.context-arm-result.v1",
          invariant:
            "same repo case set, answer key, evaluator, model, prompt, and config; direction-aware positive delta; candidate threshold; zero critical regressions",
        },
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
    runtime: {
      connectorContractVersion: "uash.connector-events.v0.5",
      canonicalNodes: CANONICAL_NODE_IDS,
      requiredNodes: CANONICAL_NODE_IDS,
      artifactByNode: ARTIFACT_BY_NODE,
      adapterAwareBridge: true,
      adapterPathPolicy:
        "adapterPath must resolve inside the run artifactRoot, UASH_REPO_ROOT, or UASH_ADAPTER_ROOTS; arbitrary absolute files are rejected",
    },
    proofSchema: {
      schema: "uash.proof.v1",
      generatorScript: "scripts/uash-write-proof.mjs",
      requiredCommandFields: [
        "command",
        "exitCode",
        "completedAt",
        "stdoutTail|stderrTail|outputDigest",
      ],
      existenceOnlyProofRejected: true,
    },
    humanApproval: {
      tokenRequiredForGrant: true,
      preferredHeader: "x-uash-human-token",
      operatorEnvironment: "UASH_HUMAN_APPROVAL_TOKEN",
      processArgvAccepted: false,
      requestBodyAccepted: false,
      neverPersistRawToken: true,
      approvalOwner: answers.approval_owner,
    },
    ciEnforcement: {
      workflowTemplate: ".github/workflows/valdris-assurance.yml",
      structuralWorkflowTemplate: ".github/workflows/valdris-assurance.yml",
      acceptanceWorkflowTemplate:
        ".github/workflows/valdris-run-acceptance.yml",
      installationRequired:
        "Copy both workflow templates to the target repo's top-level .github/workflows. Protect the valdris-run-acceptance environment with required reviewers and set its UASH_REVIEW_TRUST_SHA256 variable from operator-held state.",
      alwaysOnCommands: [
        `node ${scriptFromRepo}/okf-vault-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/skill-registry-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/catalog-integrity-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/provenance-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/neutrality-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/privacy-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/schema-compat-gate.mjs --repo ${packFromRepo}`,
      ],
      acceptanceCommand: `node ${scriptFromRepo}/run-acceptance.mjs --repo . --bundle <extracted-artifact-directory> --source-commit <full-git-sha>`,
      requiredCommands: [
        `node ${scriptFromRepo}/okf-vault-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/skill-registry-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/catalog-integrity-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/provenance-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/neutrality-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/privacy-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/schema-compat-gate.mjs --repo ${packFromRepo}`,
        `node ${scriptFromRepo}/run-acceptance.mjs --repo . --bundle <extracted-artifact-directory> --source-commit <full-git-sha>`,
      ],
    },
    telemetryModes: {
      policy: answers.telemetry_mode_policy,
      modes: ["blueprint", "live", "replay"],
      demoDataLabel:
        "Demo is allowed for bundled seed scenarios only; it is not a connector run mode",
    },
    selfHealing: {
      allowed: answers.self_heal_allowed,
      target: answers.self_heal_pr_target,
    },
    nodeStateContract: {
      states: [
        "passed",
        "active",
        "failed",
        "skipped",
        "pending",
        "needs_approval",
      ],
      skippedRequiresReason: true,
      failedRequiresRecoveryPath: true,
      finishLineRequiresAllPassedOrSkipped: true,
    },
    validation: {
      install: answers.install_command,
      knowledge: `node ${scriptFromRepo}/okf-vault-gate.mjs --repo ${packFromRepo}`,
      skills: `node ${scriptFromRepo}/skill-registry-gate.mjs --repo ${packFromRepo}`,
      catalogs: `node ${scriptFromRepo}/catalog-integrity-gate.mjs --repo ${packFromRepo}`,
      provenance: `node ${scriptFromRepo}/provenance-gate.mjs --repo ${packFromRepo}`,
      neutrality: `node ${scriptFromRepo}/neutrality-gate.mjs --repo ${packFromRepo}`,
      privacy: `node ${scriptFromRepo}/privacy-gate.mjs --repo ${packFromRepo}`,
      restrictedResidue: `node ${scriptFromRepo}/restricted-residue-gate.mjs --repo ${packFromRepo} --manifest <external-restricted-values-manifest>`,
      skillRetirementDryRun: `node ${scriptFromRepo}/retire-local-skills.mjs --repo ${packFromRepo} --manifest <external-retirement-manifest> --codex-root <local-.codex/skills> --claude-root <local-.claude/skills>`,
      generatedEvidencePrivacy: `node ${scriptFromRepo}/privacy-gate.mjs --repo . --include graph --include design/anchors.json`,
      schemaCompatibility: `node ${scriptFromRepo}/schema-compat-gate.mjs --repo ${packFromRepo}`,
      materialClassification: `node ${scriptFromRepo}/classification-record-check.mjs --repo . --file <record-path> --catalog ${packFromRepo}/policies/technical-communication.v1.json`,
      classification: `node ${scriptFromRepo}/workload-classification-gate.mjs --repo .`,
      route: `node ${scriptFromRepo}/route-gate.mjs --repo .`,
      foundation: `node ${scriptFromRepo}/foundation-gate.mjs --repo .`,
      activeGoal: `node ${scriptFromRepo}/goal-gate.mjs --repo . --allow-active`,
      completedGoal: `node ${scriptFromRepo}/goal-gate.mjs --repo .`,
      enterpriseAi: `node ${scriptFromRepo}/enterprise-ai-gate-all.mjs --repo .`,
      rcaWhenApplicable: `node ${scriptFromRepo}/rca-gate.mjs --repo .`,
      preReviewEvidenceBundle: `node ${scriptFromRepo}/run-create.mjs --repo . --run-id <runId> --commit <commit> --environment <environment> --proof proof/portable.json [--rca rca/rca.json] --gate <name>=<artifact-path> --print-evidence-bundle`,
      review: `node ${scriptFromRepo}/review-gate.mjs --repo .`,
      runPacketCreate: `node ${scriptFromRepo}/run-create.mjs --repo . --run-id <runId> --commit <commit> --environment <environment> --proof proof/portable.json --review review/review.json [--rca rca/rca.json] --gate <name>=<artifact-path> --output run/packet.json`,
      runPacket: `node ${scriptFromRepo}/run-packet-gate.mjs --repo .`,
      runAcceptance: `node ${scriptFromRepo}/run-acceptance.mjs --repo . --bundle <extracted-artifact-directory> --source-commit <full-git-sha>`,
      orderedClosure: [
        "completedGoal",
        "enterpriseAi",
        "rcaWhenApplicable",
        "preReviewEvidenceBundle",
        "review",
        "runPacketCreate",
        "runPacket",
      ],
      finishLine: `node ${scriptFromRepo}/enterprise-ai-gate-all.mjs --repo .`,
      lint: answers.lint_command,
      typecheck: answers.typecheck_command,
      test: answers.test_command,
      build: answers.build_command,
      smoke: answers.smoke_command,
    },
  };

  if (args.force && fs.existsSync(out))
    fs.rmSync(out, { recursive: true, force: true });
  mkdirp(out);
  fs.copyFileSync(
    path.join(HARNESS_ROOT, "THIRD_PARTY_NOTICES.md"),
    path.join(out, "THIRD_PARTY_NOTICES.md"),
  );
  const installedPathProtocol = renderInstalledPathProtocol(repoRoot, out);
  const writePackText = (relativePath, content) =>
    write(path.join(out, relativePath), targetRootRuntimePaths(content));
  write(
    path.join(out, "project-adapter.json"),
    JSON.stringify(adapter, null, 2),
  );
  write(path.join(out, "project.yaml"), toYaml(adapter));
  writePackText(
    "AGENTS.md",
    renderAgents(answers) +
      renderTerminologyProtocol(answers, { scriptFromRepo, packFromRepo }) +
      renderGoalSkillProtocol() +
      renderFourRoleProtocol() +
      renderLayerZeroProtocol() +
      renderOrderedV08Closure({ scriptFromRepo }) +
      installedPathProtocol,
  );
  writePackText(
    "CLAUDE.md",
    renderClaude(answers) +
      renderTerminologyProtocol(answers, { scriptFromRepo, packFromRepo }) +
      renderGoalSkillProtocol() +
      renderFourRoleProtocol() +
      renderLayerZeroProtocol() +
      renderOrderedV08Closure({ scriptFromRepo }) +
      installedPathProtocol,
  );
  writePackText(
    ".claude/commands/valdris-sdlc-harness.md",
    hardenGeneratedConnectorPrompt(
      renderClaudeCommand(answers),
      "Claude Code",
    ) +
      renderBridgeCredentialBoundary("Claude Code") +
      renderTerminologyProtocol(answers, { scriptFromRepo, packFromRepo }) +
      renderGoalSkillProtocol() +
      renderFourRoleProtocol() +
      renderLayerZeroProtocol() +
      renderOrderedV08Closure({ scriptFromRepo }) +
      installedPathProtocol,
  );
  writePackText(
    "docs/Codex Runtime Prompt.md",
    hardenGeneratedConnectorPrompt(renderCodexPrompt(answers), "Codex") +
      renderBridgeCredentialBoundary("Codex") +
      renderTerminologyProtocol(answers, { scriptFromRepo, packFromRepo }) +
      renderGoalSkillProtocol() +
      renderFourRoleProtocol() +
      renderLayerZeroProtocol() +
      renderOrderedV08Closure({ scriptFromRepo }) +
      installedPathProtocol,
  );
  writePackText(
    "00_MAP.md",
    renderMap(answers, adapter.detected) + renderLayerZeroProtocol(),
  );
  writePackText("CONTEXT.md", renderContext(answers));
  writePackText(
    "docs/Validation Commands.md",
    renderValidation(answers, { scriptFromRepo, packFromRepo }) +
      renderLayerZeroValidation({ scriptFromRepo }) +
      renderOperatingContractValidation({ scriptFromRepo }),
  );
  writePackText(
    "docs/Proof Schema.md",
    renderProofSchema(answers, { scriptFromRepo }),
  );
  writePackText("docs/Red Zone Rules.md", renderRedZone(answers));
  writePackText(
    "docs/Code Intelligence Graph.md",
    renderCodeIntelligence(answers),
  );
  writePackText(
    "docs/GitNexus Code Intelligence.md",
    renderCodeIntelligence(answers),
  );
  writePackText(
    "docs/Production Readiness Layers.md",
    renderProductionReadiness(answers) + renderLayerZeroProtocol(),
  );
  writePackText(
    "docs/Cloud Platform Engineering.md",
    renderCloudPlatform(answers),
  );
  writePackText("docs/QA and Live Smoke.md", renderQaSmoke(answers));
  writePackText("docs/Modes Blueprint Live Replay.md", renderModes(answers));
  writePackText("docs/Self-Healing Loop.md", renderSelfHealing(answers));
  writePackText(
    "docs/Good Looks Like Foundation.md",
    renderGoodLooksLike(answers) + renderLayerZeroProtocol(),
  );
  writePackText(
    "docs/Code Quality Guardrails.md",
    renderCodeQualityGuardrails(answers),
  );
  writePackText(
    "docs/Enterprise Proof Bank.md",
    renderEnterpriseProofBank(answers),
  );
  writePackText(
    "docs/Operating Intelligence Layer.md",
    renderOperatingIntelligence(answers) +
      renderContextArmResultProtocol() +
      renderV09OperatingContracts() +
      renderLayerZeroProtocol(),
  );
  writePackText(
    "docs/Team Harness Registry.md",
    renderTeamHarnessRegistry(answers),
  );
  writePackText(
    "docs/Human Agent Protocol.md",
    renderHumanAgentProtocol(answers),
  );
  writePackText(
    "docs/Agent Knowledge Vault.md",
    renderAgentKnowledgeVault(answers),
  );
  writePackText(
    "docs/ONTOLOGY_AND_TECHNICAL_ENGLISH.md",
    fs.readFileSync(
      path.join(HARNESS_ROOT, "docs", "ONTOLOGY_AND_TECHNICAL_ENGLISH.md"),
      "utf8",
    ) + renderTerminologyProtocol(answers, { scriptFromRepo, packFromRepo }),
  );
  writePackText(
    "docs/ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md",
    fs.readFileSync(
      path.join(
        HARNESS_ROOT,
        "docs",
        "ONTOLOGY_AND_TECHNICAL_ENGLISH_SOURCES.md",
      ),
      "utf8",
    ),
  );
  mkdirp(path.join(out, "classification"));
  fs.copyFileSync(
    path.join(
      HARNESS_ROOT,
      "classification",
      "classification-record.template.json",
    ),
    path.join(out, "classification", "classification-record.template.json"),
  );
  writePortableValdrisClassification(out);
  for (const docName of [
    "ENTERPRISE_CONTROL_MODEL_V2.md",
    "GENERATIVE_AI_ASSURANCE_PACK.md",
    "GOAL_LOOP_AND_SKILL_ROUTER.md",
    "V09_AUTHORITATIVE_ASSURANCE.md",
  ]) {
    writePackText(
      path.join("docs", docName),
      fs.readFileSync(path.join(HARNESS_ROOT, "docs", docName), "utf8"),
    );
  }
  for (const [relativePath, content] of Object.entries(
    renderKnowledgeVaultFiles(answers),
  )) {
    writePackText(relativePath, content);
  }
  for (const relativePath of [
    "playbooks/layer-zero-assurance.md",
    "playbooks/production-readiness-13-layers.md",
    "playbooks/goal-loop-skill-routing.md",
    "playbooks/genai-assurance.md",
    "playbooks/clean-room-assurance-import.md",
    "playbooks/semantic-authoritative-assurance.md",
    "concepts/proof-first-harness.md",
    "concepts/typed-evidence.md",
    "concepts/ontology-grounded-classification.md",
  ]) {
    writePackText(
      path.join("knowledge", relativePath),
      fs.readFileSync(
        path.join(HARNESS_ROOT, "knowledge", relativePath),
        "utf8",
      ),
    );
  }
  fs.appendFileSync(
    path.join(out, "knowledge", "index.md"),
    "\n* [Layer Zero Assurance](playbooks/layer-zero-assurance.md) - bound workload and foundation contract.\n* [Goal Loop and Skill Routing](playbooks/goal-loop-skill-routing.md) - bounded durable execution.\n* [Generative AI Assurance](playbooks/genai-assurance.md) - cross-cutting AI controls.\n* [Clean-room Assurance Import](playbooks/clean-room-assurance-import.md) - provenance, neutrality, privacy, and schema-compatibility boundary.\n* [Semantic and Authoritative Assurance](playbooks/semantic-authoritative-assurance.md) - semantic adapters, runtime identity, external receipts, and v3 closure.\n* [Typed Evidence](concepts/typed-evidence.md) - resolvable proof contract.\n",
  );
  fs.appendFileSync(
    path.join(out, "knowledge", "playbooks", "index.md"),
    "\n* [Layer Zero Assurance](layer-zero-assurance.md) - bound workload and foundation contract.\n* [Goal Loop and Skill Routing](goal-loop-skill-routing.md) - bounded durable execution.\n* [Generative AI Assurance](genai-assurance.md) - cross-cutting AI controls.\n* [Clean-room Assurance Import](clean-room-assurance-import.md) - restricted-source integration boundary.\n* [Semantic and Authoritative Assurance](semantic-authoritative-assurance.md) - semantic adapters, runtime identity, external receipts, and v3 closure.\n",
  );
  fs.appendFileSync(
    path.join(out, "knowledge", "concepts", "index.md"),
    "\n* [Typed Evidence](typed-evidence.md) - resolvable proof contract.\n* [Ontology-Grounded Classification](ontology-grounded-classification.md) - evidence, category criteria, authoritative-source escalation, and calibrated terminology.\n",
  );
  for (const relativePath of [
    "knowledge/index.md",
    "knowledge/systems/project-system.md",
    "knowledge/playbooks/index.md",
    "knowledge/playbooks/engineering-task-routing.md",
  ]) {
    const target = path.join(out, relativePath);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replaceAll(
          "Production Readiness 13 Layers",
          "Production Assurance: 13 Domains",
        ),
      "utf8",
    );
  }
  writePackText(
    "runs/_run-template/README.md",
    renderRunTemplate(answers, adapter.finishLineAssurance.requiredArtifacts) +
      renderFourRoleProtocol() +
      renderLayerZeroProtocol(),
  );
  for (const scriptName of [
    "uash-emit-event.mjs",
    "uash-write-proof.mjs",
    "code-intelligence-scan.mjs",
    "code-intelligence-local-scan.mjs",
    "code-intelligence-gate.mjs",
    "anchor-gate.mjs",
    "code-intelligence-gate-all.mjs",
    "control-gate-lib.mjs",
    "terminology-policy-lib.mjs",
    "classification-record-check.mjs",
    "catalog-integrity-gate.mjs",
    "provenance-gate.mjs",
    "neutrality-gate.mjs",
    "privacy-gate.mjs",
    "restricted-residue-gate.mjs",
    "retire-local-skills.mjs",
    "schema-compat-gate.mjs",
    "intake-gate.mjs",
    "workload-classifier-lib.mjs",
    "workload-classification-gate.mjs",
    "foundation-gate.mjs",
    "route-request.mjs",
    "route-lifecycle-skill.mjs",
    "route-gate.mjs",
    "production-layer-gate.mjs",
    "ai-assurance-gate.mjs",
    "domain-assurance-gate.mjs",
    "goal-gate.mjs",
    "goal-transition.mjs",
    "eval-gate.mjs",
    "trajectory-gate.mjs",
    "smoke-gate.mjs",
    "waiver-gate.mjs",
    "context-manifest-gate.mjs",
    "skill-registry-gate.mjs",
    "install-codex-skills.mjs",
    "enterprise-ai-gate-all.mjs",
    "okf-vault-gate.mjs",
    "discovery-loader-contract.mjs",
    "evidence-namespaces.mjs",
    "proof-runner.mjs",
    "rca-gate.mjs",
    "review-gate.mjs",
    "operating-contracts-lib.mjs",
    "operating-contract-gate.mjs",
    "interop-conformance-runner.mjs",
    "runtime-driver-state.mjs",
    "v09-assurance-lib.mjs",
    "authoritative-assurance-gate.mjs",
    "assurance-readiness.mjs",
    "operator-root-security.mjs",
    "attested-proof-executor.mjs",
    "github-bridge-head.mjs",
    "authoritative-release-gate.mjs",
    "verify-v09-assurance.mjs",
    "run-create.mjs",
    "run-packet-gate.mjs",
    "run-acceptance.mjs",
  ]) {
    const scriptSource = path.join(SCRIPT_DIR, scriptName);
    const scriptTarget = path.join(out, "scripts", scriptName);
    mkdirp(path.dirname(scriptTarget));
    fs.copyFileSync(scriptSource, scriptTarget);
    fs.chmodSync(scriptTarget, 0o755);
  }
  fs.cpSync(path.join(HARNESS_ROOT, "controls"), path.join(out, "controls"), {
    recursive: true,
  });
  fs.cpSync(path.join(HARNESS_ROOT, "policies"), path.join(out, "policies"), {
    recursive: true,
  });
  syncValdrisSkillTree(
    path.join(HARNESS_ROOT, "skills"),
    path.join(out, "skills"),
  );
  syncValdrisSkillTree(
    path.join(HARNESS_ROOT, "skills"),
    path.join(out, ".agents", "skills"),
  );
  syncValdrisSkillTree(
    path.join(HARNESS_ROOT, "skills"),
    path.join(out, ".claude", "skills"),
  );
  for (const generatedJsonRoot of [
    "controls",
    "policies",
    "skills",
    path.join(".agents", "skills"),
    path.join(".claude", "skills"),
  ]) {
    normalizeGeneratedJsonLineEndings(path.join(out, generatedJsonRoot));
  }
  write(
    path.join(out, "package.json"),
    JSON.stringify(
      {
        name: `${
          answers.project_name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "project"
        }-valdris-harness`,
        version: VERSION,
        private: true,
        type: "module",
        scripts: {
          "knowledge:gate": "node scripts/okf-vault-gate.mjs --repo .",
          "skills:gate": "node scripts/skill-registry-gate.mjs --repo .",
          "skills:install:codex": "node scripts/install-codex-skills.mjs",
          "skills:check:codex": "node scripts/install-codex-skills.mjs --check",
          "catalog:gate": "node scripts/catalog-integrity-gate.mjs --repo .",

          "provenance:gate": "node scripts/provenance-gate.mjs --repo .",
          "neutrality:gate": "node scripts/neutrality-gate.mjs --repo .",
          "privacy:gate": "node scripts/privacy-gate.mjs --repo .",
          "restricted-residue:gate":
            "node scripts/restricted-residue-gate.mjs --repo .",
          "skills:retire-local":
            "node scripts/retire-local-skills.mjs --repo .",
          "evidence:privacy:gate": `node scripts/privacy-gate.mjs --repo "${repoFromPack}" --include graph --include design/anchors.json`,
          "schema:compat:gate": "node scripts/schema-compat-gate.mjs --repo .",
          "intake:gate": `node scripts/intake-gate.mjs --repo \"${repoFromPack}\"`,
          "classification:gate": `node scripts/workload-classification-gate.mjs --repo \"${repoFromPack}\"`,
          "foundation:gate": `node scripts/foundation-gate.mjs --repo \"${repoFromPack}\"`,
          "route:gate": `node scripts/route-gate.mjs --repo \"${repoFromPack}\"`,
          "route:request": `node scripts/route-request.mjs --repo \"${repoFromPack}\"`,
          "lifecycle:route": `node scripts/route-lifecycle-skill.mjs --repo \"${repoFromPack}\"`,
          "goal:transition": `node scripts/goal-transition.mjs --repo \"${repoFromPack}\"`,
          "goal:gate:active": `node scripts/goal-gate.mjs --repo \"${repoFromPack}\" --allow-active`,
          "run:packet:gate": `node scripts/run-packet-gate.mjs --repo \"${repoFromPack}\"`,
          "run:accept": `node scripts/run-acceptance.mjs --repo \"${repoFromPack}\"`,
          "proof:run": `node scripts/proof-runner.mjs --repo "${repoFromPack}"`,
          "rca:gate": `node scripts/rca-gate.mjs --repo \"${repoFromPack}\"`,
          "review:gate": `node scripts/review-gate.mjs --repo \"${repoFromPack}\"`,
          "authoritative:gate": `node scripts/authoritative-assurance-gate.mjs --repo \"${repoFromPack}\"`,
          "operating-contract:gate": `node scripts/operating-contract-gate.mjs --repo \"${repoFromPack}\"`,
          "interop:conformance": `node scripts/interop-conformance-runner.mjs --repo \"${repoFromPack}\"`,
          "assurance:readiness": `node scripts/assurance-readiness.mjs --repo \"${repoFromPack}\"`,
          "runtime:driver:state": `node scripts/runtime-driver-state.mjs --repo \"${repoFromPack}\"`,
          "proof:execute:attested": `node scripts/attested-proof-executor.mjs --repo "${repoFromPack}"`,
          "bridge:head:github": `node scripts/github-bridge-head.mjs --repo "${repoFromPack}"`,
          "release:gate:authoritative":
            "node scripts/authoritative-release-gate.mjs",
          "verify:v09-assurance": "node scripts/verify-v09-assurance.mjs",
          "enterprise-ai:gate": `node scripts/enterprise-ai-gate-all.mjs --repo \"${repoFromPack}\"`,
        },
      },
      null,
      2,
    ),
  );
  write(
    path.join(out, ".github/workflows/valdris-assurance.yml"),
    `name: Valdris Structural Assurance

on:
  pull_request:
  push:

permissions:
  contents: read

jobs:
  structural-assurance:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "24"
      - name: Validate knowledge vault
        run: node ${scriptFromRepo}/okf-vault-gate.mjs --repo ${packFromRepo}
      - name: Validate skill registry
        run: node ${scriptFromRepo}/skill-registry-gate.mjs --repo ${packFromRepo}
      - name: Validate canonical catalogs
        run: node ${scriptFromRepo}/catalog-integrity-gate.mjs --repo ${packFromRepo}

      - name: Validate public-source provenance
        run: node ${scriptFromRepo}/provenance-gate.mjs --repo ${packFromRepo}
      - name: Validate project neutrality
        run: node ${scriptFromRepo}/neutrality-gate.mjs --repo ${packFromRepo}
      - name: Validate privacy boundary
        run: node ${scriptFromRepo}/privacy-gate.mjs --repo ${packFromRepo}
      - name: Validate assurance schema compatibility
        run: node ${scriptFromRepo}/schema-compat-gate.mjs --repo ${packFromRepo}
      - name: Validate semantic and authoritative assurance machinery
        run: node ${scriptFromRepo}/verify-v09-assurance.mjs
`,
  );
  write(
    path.join(out, ".github/workflows/valdris-run-acceptance.yml"),
    `name: Valdris Run Acceptance

on:
  workflow_dispatch:
    inputs:
      source_commit:
        description: Full Git commit SHA bound by the completed Valdris packet
        required: true
        type: string
      artifact_run_id:
        description: GitHub Actions run ID that uploaded the completed artifact bundle
        required: true
        type: string
      artifact_name:
        description: Name of the uploaded Valdris artifact bundle
        required: true
        default: valdris-run-artifacts
        type: string

permissions:
  actions: read
  contents: read

jobs:
  run-acceptance:
    environment: valdris-run-acceptance
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    env:
      UASH_REVIEW_TRUST_SHA256: \${{ vars.UASH_REVIEW_TRUST_SHA256 }}
      VALDRIS_AUTHORITY_TRUST_SHA256: \${{ vars.VALDRIS_AUTHORITY_TRUST_SHA256 }}
    steps:
      - name: Validate exact source commit input
        env:
          VALDRIS_SOURCE_COMMIT: \${{ inputs.source_commit }}
        run: node -e "if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(process.env.VALDRIS_SOURCE_COMMIT||'')) throw new Error('source_commit must be a lowercase full Git object ID')"
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: \${{ inputs.source_commit }}
          fetch-depth: 0
          persist-credentials: false
      - name: Materialize canonical Git bytes
        run: |
          git config core.autocrlf false
          git checkout-index --force --all
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "24"
      - name: Require operator-held review trust pin
        run: node -e "if(!/^[a-f0-9]{64}$/.test(process.env.UASH_REVIEW_TRUST_SHA256||'')) throw new Error('Configure UASH_REVIEW_TRUST_SHA256 on the protected valdris-run-acceptance environment')"
      - name: Download completed Valdris artifact bundle
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: \${{ inputs.artifact_name }}
          path: \${{ runner.temp }}/valdris-run-artifacts
          run-id: \${{ inputs.artifact_run_id }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
      - name: Hydrate and validate the exact completed run
        env:
          VALDRIS_SOURCE_COMMIT: \${{ inputs.source_commit }}
          VALDRIS_ARTIFACT_BUNDLE: \${{ runner.temp }}/valdris-run-artifacts
        run: node ${scriptFromRepo}/run-acceptance.mjs --repo .
`,
  );
  writePackText(
    "commissioning-review.md",
    renderReview(adapter).replace(
      "## v0.6 commissioning + trust-boundary hardening",
      "## v0.8 clean-room assurance commissioning",
    ) +
      renderReviewTrustPinProtocol(adapter) +
      renderLayerZeroProtocol(),
  );
  writePackText(
    "commissioning-manifest.json",
    `${JSON.stringify(commissionedPackManifest(out), null, 2)}\n`,
  );
  installRootDiscoveryLoaders(rootLoaderPlans);
  return { out, adapter, rootLoaderPlans };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.printQuestions) {
    console.log(JSON.stringify(QUESTION_GROUPS, null, 2));
    return;
  }
  const requestedRepo = path.resolve(args.repo);
  if (
    !fs.existsSync(requestedRepo) ||
    !fs.statSync(requestedRepo).isDirectory()
  )
    throw new Error(`Repo path not found: ${requestedRepo}`);
  const repo = fs.realpathSync(requestedRepo);
  const detected = detectRepo(repo);
  const { answers, answerSources } = await collectAnswers(args, detected);
  const result = generatePack(args, detected, answers, answerSources);
  console.log(`Generated Valdris SDLC harness pack: ${result.out}`);
  console.log(`Project: ${answers.project_name}`);
  console.log(
    `Front doors: ${path.join(result.out, "AGENTS.md")}, ${path.join(result.out, "CLAUDE.md")}, ${path.join(result.out, ".claude/commands/valdris-sdlc-harness.md")}, and ${path.join(result.out, "docs/Codex Runtime Prompt.md")}`,
  );
  console.log(
    `Target-root discovery loaders: ${result.rootLoaderPlans.map((plan) => `${plan.target} (${plan.action})`).join(", ")}`,
  );
  console.log(
    `Review packet: ${path.join(result.out, "commissioning-review.md")}`,
  );
  console.log(
    `Generated review trust digest (canonical JSON SHA-256, informational until operator-approved): ${result.adapter.reviewTrust.generatedDigest}`,
  );
  console.log(
    "Operator action: after reviewing the trust store, set its digest out of band as protected UASH_REVIEW_TRUST_SHA256 before review, packet, bridge, or CI validation.",
  );
  console.log(
    `Generated authority trust digest (canonical JSON SHA-256, intentionally empty until commissioned): ${result.adapter.authoritativeAssurance.generatedTrustDigest}`,
  );
  console.log(
    "Operator action: add only reviewed public keys, then pin the protected digest as VALDRIS_AUTHORITY_TRUST_SHA256 before any semantic or authoritative claim. Do not tag v0.9.0 until a real provider-backed authoritative run passes.",
  );
}

export { planRootDiscoveryLoader };

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
