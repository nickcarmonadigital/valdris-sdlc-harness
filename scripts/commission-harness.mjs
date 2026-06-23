#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const VERSION = "0.2.0";

const DEFAULT_LANE_FAMILIES = [
  "intake-classify",
  "product-app-sdlc",
  "system-design",
  "cloud-platform-engineering",
  "data-integrations",
  "security-compliance",
  "qa-release",
  "reliability-observability",
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
      { id: "code_graph", label: "Should a code graph / Graphify scan be required before architecture work?", default: "yes when available; otherwise pin code anchors" },
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
  const hasPython = exists(repo, "pyproject.toml") || exists(repo, "requirements.txt");
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
    detectedInstall: packageJson ? npmExec : hasPython ? "python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt" : "project-specific",
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
  return `# ${answers.project_name} Agent Instructions\n\nThis repo is commissioned into the Universal Agentic SDLC Harness. Use this file as the Codex/agent front door.\n\n## Start here\n\n1. Read \`00_MAP.md\`.\n2. Read \`CONTEXT.md\`.\n3. For Codex live runs, also read \`docs/Codex Runtime Prompt.md\` when a RUN_ID/BRIDGE_URL is supplied.\n4. Route to the smallest matching lane family.\n5. Create or update a run packet before risky, ambiguous, architecture-impacting, production-impacting, or handoff-heavy work.\n\n## Human operating style\n\n- Primary operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Autonomy: ${answers.autonomy_level}\n- Avoid: ${answers.annoyances}\n\n## Source-of-truth order\n\n${answers.truth_order}\n\nWhen sources conflict, stop before Red Zone actions and ask ${answers.approval_owner}.\n\n## Parent taxonomy\n\nThe parent product is **Agentic SDLC Harness**. System design, production readiness, cloud/platform, QA/release, security, reliability, and self-healing are lane families inside the SDLC lifecycle.\n\n## Red Zone\n\nRead-only investigation is allowed: ${answers.read_only_allowed}.\n\nExplicit approval required before: ${answers.red_zone_actions}.\n\n## Finish line\n\nDone means: ${answers.done_definition}.\n\nNever claim done without proof artifacts, skip reasons for irrelevant nodes, and a human-readable handoff.\n`;
}

function renderClaude(answers) {
  return `# ${answers.project_name} Claude Code Harness\n\nYou are inside a Universal Agentic SDLC Harness commissioned repo.\n\n## Required flow\n\n\`intake -> route -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`\n\nAsk commissioning questions only when \`project-adapter.json\` is missing or incomplete. Once the adapter exists, use it as repo-specific context and avoid re-asking stable facts.\n\n## Mode rule\n\nSeparate Blueprint, Live Run, and Replay. Do not imply live telemetry unless real connector/MCP/CLI/API/watched-artifact events exist.\n\n## Required artifacts\n\n- \`run/intake.json\`\n- \`run/route.json\`\n- \`design/system_design.md\` when architecture/product/infra tradeoffs matter\n- \`production/layer-assessment.json\` for production-impacting work\n- \`cloud/service-map.json\` for cloud/platform work, or \`cloud/skip.json\` with reason\n- \`design/anchors.json\` for plans that cite code\n- \`approvals/redzone.json\` when Red Zone applies\n- \`qa/qa-plan.md\` when validation scope matters\n- \`qa/break-it-results.md\` for feature/bug/refactor/security/cloud/integration work, or skip reason\n- \`proof/proof.json\` before done\n- \`smoke/smoke_proof.json\` for deployed/provider/runtime behavior, or skip reason\n- \`self_heal/self_heal_report.md\` if the harness/process failed\n- \`handoff/final.md\` for the final answer\n\n## Response contract\n\nUse: Bottom line, Why, Proof, Risk, Fix/Plan, Your call. Keep process narration out of the final answer.\n`;
}

function renderClaudeCommand(answers) {
  return `# ${answers.project_name} / Valdris SDLC Harness\n\nUse this slash command when the user wants Claude Code to work under the Valdris SDLC Harness.\n\n## Required inputs\n\nThe user should provide:\n\n\`RUN_ID=<run-id>\`\n\`BRIDGE_URL=http://127.0.0.1:8787\`\n\`<task text>\`\n\nIf RUN_ID is missing, ask for it before changing files. Do not invent one.\n\n## Runtime protocol\n\n1. Read \`project-adapter.json\`, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`.\n2. Follow the node flow: \`intake -> route -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`.\n3. Emit a bridge event before/after every node, gate, artifact, approval, skip, failure, and completion.\n4. Use explicit skip reasons for irrelevant nodes.\n5. Use failure reasons plus recovery paths for failed nodes.\n6. Do not emit \`run.completed\` until proof exists and every required node is passed or skipped with a reason. The bridge should reject early completion.\n\n## Event command\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" node.entered intake "Claude Code started harness intake" --artifact run/intake.json --status ok --actor claude-code --mode live --source bridge\n\`\`\`\n\nIf \`scripts/uash-emit-event.mjs\` is not present in the target repo, run the command from the Valdris SDLC Harness repo or copy the script into the target repo.\n\n## Final answer\n\nBottom line, Why, Proof, Risk, Fix/Plan, Your call, Lane taken, Gates/artifacts, Skipped nodes/reasons, Self-heal needed/opened.\n`;
}

function renderCodexPrompt(answers) {
  return `# ${answers.project_name} Codex Runtime Prompt\n\nCodex should treat \`AGENTS.md\` as the primary front door and this file as the copy/paste run prompt when a specific harness run is started.\n\n## Start protocol\n\n1. Read \`AGENTS.md\`, \`project-adapter.json\`, \`00_MAP.md\`, \`CONTEXT.md\`, and \`docs/Validation Commands.md\`.\n2. Classify the task into the smallest matching lane family.\n3. Use the flow: \`intake -> route -> system-design -> production-readiness -> cloud-platform -> implement -> redzone -> qa-break-it -> prove -> live-smoke -> self-heal -> handoff\`.\n4. Emit real bridge events when RUN_ID and BRIDGE_URL are provided; otherwise write the same artifacts locally and say telemetry is not live.\n5. Never claim done until proof exists and every required node is passed or skipped with an explicit reason.\n\n## Event command shape\n\n\`\`\`bash\nUASH_BRIDGE_URL="$BRIDGE_URL" node scripts/uash-emit-event.mjs "$RUN_ID" <event-type> <node-id> "<message>" \\\n  --artifact <path> \\\n  --status <ok|warn|blocked|skipped|failed|needs_approval> \\\n  --actor codex \\\n  [--skip-reason "..."] \\\n  [--failure-reason "..."] \\\n  [--recovery-path "..."]\n\`\`\`\n\n## Required handoff\n\nBottom line, Why, Proof, Risk, Fix/Plan, Your call, Lane taken, Gates/artifacts, Skipped nodes/reasons, Self-heal needed/opened.\n`;
}

function renderMap(answers, detected) {
  return `# ${answers.project_name} Harness Map\n\nGenerated by Universal Agentic SDLC Harness commissioning v${VERSION}.\n\n## Product identity\n\n- Users/customers: ${answers.users}\n- Production means: ${answers.production_definition}\n- Worst agent failure: ${answers.worst_agent_failure}\n\n## Detected repo shape\n\n- Repo path: \`${detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${detected.frameworks.length ? detected.frameworks.join(", ") : "none detected"}\n- Package manager: ${detected.packageManager}\n\n## Universal flow\n\n\`request -> intake -> route -> system design -> production readiness -> implementation -> QA/proof/smoke -> handoff -> self-heal\`\n\n## Lane families\n\n${DEFAULT_LANE_FAMILIES.map((lane) => `- ${lane}`).join("\n")}\n\n## Enabled lanes\n\n${splitList(answers.enabled_lanes).map((lane) => `- ${lane}`).join("\n")}\n\nCustom lanes: ${answers.custom_lanes}.\n\n## Production Readiness Layer Pack\n\n${splitList(answers.production_layers).map((lane) => `- ${lane}`).join("\n")}\n`;
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

function renderProductionReadiness(answers) {
  return `# Production Readiness Layers\n\nFor every run, classify which production layers are touched. Relevant layers become required gates; irrelevant layers are skipped with reasons.\n\n${splitList(answers.production_layers).map((layer) => `- ${layer}`).join("\n")}\n\n## Skip policy\n\n${answers.production_layer_skip_policy}\n\n## Required proof\n\n${answers.production_readiness_proof}\n`;
}

function renderCloudPlatform(answers) {
  return `# Cloud / Platform Engineering\n\n## Providers\n\n${answers.cloud_providers}\n\n## Services in scope\n\n${answers.cloud_services}\n\n## IaC / manual policy\n\n${answers.iac_model}\n\n## Observability proof\n\n${answers.observability_model}\n\n## Cost / rollback policy\n\n${answers.cost_rollback_policy}\n\n## Required node pack\n\n- cloud-intake\n- aws-service-map\n- iam-secrets-check\n- networking-check\n- iac-diff-check\n- deploy-plan\n- observability-proof\n- cost-risk-check\n- rollback-plan\n- live-smoke\n- runbook-update\n`;
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

function renderRunTemplate(answers) {
  return `# Run Packet Template\n\nProject: ${answers.project_name}\n\n## Required artifacts\n\n- run/mode.json\n- run/intake.json\n- run/route.json\n- design/system_design.md when design/architecture matters\n- production/layer-assessment.json for production-impacting work\n- cloud/service-map.json for cloud/platform work, or cloud/skip.json with reason\n- design/anchors.json when design cites code\n- approvals/redzone.json when Red Zone applies\n- qa/qa-plan.md when validation scope matters\n- qa/break-it-results.md or explicit skip reason\n- proof/proof.json before done\n- smoke/smoke_proof.json or explicit skip reason\n- self_heal/self_heal_report.md when process/harness gap is found\n- handoff/final.md\n\n## Final handoff shape\n\nBottom line\nWhy\nProof\nRisk\nFix/Plan\nYour call\nSkipped nodes / reasons\n`;
}

function renderReview(adapter) {
  const answers = adapter.answers;
  return `# Commissioning Review Packet\n\n## Bottom line\n\nGenerated a project-specific harness pack for **${answers.project_name}** at this output directory. Agents can now load \`AGENTS.md\`, \`CLAUDE.md\`, the Claude slash command, or the Codex runtime prompt, route by \`CONTEXT.md\`, and block done on proof artifacts, skip reasons, QA/live-smoke, and self-healing checks.\n\n## What was detected\n\n- Repo: \`${adapter.detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${adapter.detected.frameworks.join(", ") || "none detected"}\n- Package manager: ${adapter.detected.packageManager}\n\n## Human-supplied operating rules\n\n- Operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Approval owner: ${answers.approval_owner}\n- Red Zone: ${answers.red_zone_actions}\n\n## v0.2 additions\n\n- System Design lane triggers: ${answers.system_design_triggers}\n- Production layers checked: ${splitList(answers.production_layers).length}\n- Cloud/platform providers: ${answers.cloud_providers}\n- Break-it QA policy: ${answers.break_it_qa_policy}\n- Mode policy: ${answers.telemetry_mode_policy}\n- Self-heal policy: ${answers.self_heal_allowed}\n\n## Next gate\n\nReview \`project-adapter.json\` and edit any defaults that are wrong before handing the pack to Claude Code/Codex.\n`;
}

function generatePack(args, detected, answers) {
  const out = path.resolve(args.out);
  const adapter = {
    schema: "uash.project-adapter.v2",
    generatedAt: new Date().toISOString(),
    generatorVersion: VERSION,
    detected,
    answers,
    laneFamilies: DEFAULT_LANE_FAMILIES,
    lanes: splitList(answers.enabled_lanes),
    redZoneActions: splitList(answers.red_zone_actions),
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
  write(path.join(out, "docs/Production Readiness Layers.md"), renderProductionReadiness(answers));
  write(path.join(out, "docs/Cloud Platform Engineering.md"), renderCloudPlatform(answers));
  write(path.join(out, "docs/QA and Live Smoke.md"), renderQaSmoke(answers));
  write(path.join(out, "docs/Modes Blueprint Live Replay.md"), renderModes(answers));
  write(path.join(out, "docs/Self-Healing Loop.md"), renderSelfHealing(answers));
  write(path.join(out, "runs/_run-template/README.md"), renderRunTemplate(answers));
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
