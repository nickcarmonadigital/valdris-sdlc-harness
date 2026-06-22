#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const VERSION = "0.1.0";

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
      { id: "worst_agent_failure", label: "What is the worst plausible agent-caused failure?", default: "breaking production or corrupting customer data" },
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
      { id: "review_required_paths", label: "Which paths require human review before merge?", default: "migrations/, infra/, auth, billing, secrets, deploy workflows" },
      { id: "code_graph", label: "Should a code graph / Graphify scan be required before architecture work?", default: "yes when available" },
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
      { id: "done_definition", label: "What does done require?", default: "required commands pass, artifact proof exists, human handoff is clear" },
    ],
  },
  {
    id: "red_zone",
    title: "Red Zone / approval boundaries",
    questions: [
      { id: "red_zone_actions", label: "Which actions require explicit human approval?", default: "push, merge, deploy, production data writes, secrets/env changes, auth, billing, destructive ops, provider config" },
      { id: "approval_owner", label: "Who can approve Red Zone actions?", default: "primary human/operator" },
      { id: "read_only_allowed", label: "Are read-only investigations allowed without asking?", default: "yes" },
    ],
  },
  {
    id: "lanes",
    title: "Work lanes",
    questions: [
      { id: "enabled_lanes", label: "Which lanes should this repo use?", default: "engineering-default, incidents, docs-product, infra, data, security" },
      { id: "custom_lanes", label: "Any repo-specific lanes?", default: "none" },
      { id: "adr_policy", label: "When should an ADR/decision record be required?", default: "hard-to-reverse architecture, data, security, provider, or deployment decisions" },
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
  const role = [exists(repo, "app") || exists(repo, "pages") || exists(repo, "components") ? "frontend" : null, hasPython ? "backend/python" : null, exists(repo, "infra") ? "infra" : null, exists(repo, "docs") ? "docs" : null]
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
  return `# ${answers.project_name} Agent Instructions\n\nThis repo is commissioned into the Universal Agentic SDLC Harness. Use this file as the Codex/agent front door.\n\n## Start here\n\n1. Read \`00_MAP.md\`.\n2. Read \`CONTEXT.md\`.\n3. Route to the smallest matching lane.\n4. Create or update a run packet before risky, ambiguous, or handoff-heavy work.\n\n## Human operating style\n\n- Primary operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Autonomy: ${answers.autonomy_level}\n- Avoid: ${answers.annoyances}\n\n## Source-of-truth order\n\n${answers.truth_order}\n\nWhen sources conflict, stop before Red Zone actions and ask ${answers.approval_owner}.\n\n## Red Zone\n\nRead-only investigation is allowed: ${answers.read_only_allowed}.\n\nExplicit approval required before: ${answers.red_zone_actions}.\n\n## Finish line\n\nDone means: ${answers.done_definition}.\n\nNever claim done without proof artifacts and a human-readable handoff.\n`;
}

function renderClaude(answers) {
  return `# ${answers.project_name} Claude Code Harness\n\nYou are inside a Universal Agentic SDLC Harness commissioned repo.\n\n## Required flow\n\n\`intake -> route -> investigate -> design -> implement -> redzone -> prove -> handoff\`\n\nAsk commissioning questions only when \`project-adapter.json\` is missing or incomplete. Once the adapter exists, use it as repo-specific context and avoid re-asking stable facts.\n\n## Required artifacts\n\n- \`run/intake.json\`\n- \`run/route.json\`\n- \`design/anchors.json\` for plans that cite code\n- \`approvals/redzone.json\` when Red Zone applies\n- \`proof/proof.json\` before done\n- \`handoff/final.md\` for the final answer\n\n## Response contract\n\nUse: Bottom line, Why, Proof, Fix/Plan, Your call. Keep process narration out of the final answer.\n`;
}

function renderMap(answers, detected) {
  return `# ${answers.project_name} Harness Map\n\nGenerated by Universal Agentic SDLC Harness commissioning v${VERSION}.\n\n## Product identity\n\n- Users/customers: ${answers.users}\n- Production means: ${answers.production_definition}\n- Worst agent failure: ${answers.worst_agent_failure}\n\n## Detected repo shape\n\n- Repo path: \`${detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${detected.frameworks.length ? detected.frameworks.join(", ") : "none detected"}\n- Package manager: ${detected.packageManager}\n\n## Universal flow\n\n\`request -> intake -> route -> lane context -> artifact gates -> proof -> handoff\`\n\n## Enabled lanes\n\n${splitList(answers.enabled_lanes).map((lane) => `- ${lane}`).join("\n")}\n\nCustom lanes: ${answers.custom_lanes}.\n`;
}

function renderContext(answers) {
  return `# ${answers.project_name} Context Router\n\nUse this after \`00_MAP.md\`. Pick the smallest matching lane and load only the docs needed for that risk area.\n\n## Router\n\n| If the request is about | Use lane | Gate emphasis |\n|---|---|---|\n| Normal bug, feature, UI, backend, API, PR | engineering-default | design anchors + proof |\n| Production/user-facing incident | incidents | runtime evidence + Red Zone |\n| Data, schema, migrations, auth/RLS | data | migration/schema proof + Red Zone |\n| Infra, deploy, secrets, provider dashboards | infra/provider-config | approval + deploy proof |\n| Docs, process, harness changes | docs-product | coherence + review |\n| Security, billing, auth, permissions | security | human approval + security checklist |\n\n## Safe edit paths\n\n${answers.safe_edit_paths}\n\n## Review-required paths\n\n${answers.review_required_paths}\n\n## Branch/deploy model\n\n- Default work branch: ${answers.default_work_branch}\n- Staging: ${answers.staging_branch}\n- Production: ${answers.production_branch}\n- Merge/deploy owner: ${answers.merge_owner}\n- Deployment proof: ${answers.deployment_proof}\n\n## ADR policy\n\n${answers.adr_policy}\n`;
}

function renderValidation(answers) {
  return `# Validation Commands\n\nAgents must run the relevant commands and attach proof before claiming done.\n\n| Check | Command |\n|---|---|\n| Install | \`${answers.install_command}\` |\n| Lint | \`${answers.lint_command}\` |\n| Typecheck | \`${answers.typecheck_command}\` |\n| Test | \`${answers.test_command}\` |\n| Build | \`${answers.build_command}\` |\n| Smoke/e2e | \`${answers.smoke_command}\` |\n\nDone definition: ${answers.done_definition}.\n`;
}

function renderRedZone(answers) {
  return `# Red Zone Rules\n\nRead-only investigation allowed without asking: ${answers.read_only_allowed}.\n\nExplicit human approval owner: ${answers.approval_owner}.\n\nApproval required before:\n\n${splitList(answers.red_zone_actions).map((action) => `- ${action}`).join("\n")}\n\nIf an action is ambiguous, treat it as Red Zone and ask.\n`;
}

function renderRunTemplate(answers) {
  return `# Run Packet Template\n\nProject: ${answers.project_name}\n\n## Required artifacts\n\n- run/intake.json\n- run/route.json\n- design/anchors.json when design cites code\n- approvals/redzone.json when Red Zone applies\n- proof/proof.json before done\n- handoff/final.md\n\n## Final handoff shape\n\nBottom line\nWhy\nProof\nFix/Plan\nYour call\n`;
}

function renderReview(adapter) {
  const answers = adapter.answers;
  return `# Commissioning Review Packet\n\n## Bottom line\n\nGenerated a project-specific harness pack for **${answers.project_name}** at this output directory. Agents can now load \`AGENTS.md\` or \`CLAUDE.md\`, route by \`CONTEXT.md\`, and block done on proof artifacts.\n\n## What was detected\n\n- Repo: \`${adapter.detected.repoPath}\`\n- Role: ${answers.repo_role}\n- Frameworks/tools: ${adapter.detected.frameworks.join(", ") || "none detected"}\n- Package manager: ${adapter.detected.packageManager}\n\n## Human-supplied operating rules\n\n- Operator: ${answers.operator_name}\n- Answer style: ${answers.answer_style}\n- Approval owner: ${answers.approval_owner}\n- Red Zone: ${answers.red_zone_actions}\n\n## Next gate\n\nReview \`project-adapter.json\` and edit any defaults that are wrong before handing the pack to Claude Code/Codex.\n`;
}

function generatePack(args, detected, answers) {
  const out = path.resolve(args.out);
  const adapter = {
    schema: "uash.project-adapter.v1",
    generatedAt: new Date().toISOString(),
    generatorVersion: VERSION,
    detected,
    answers,
    lanes: splitList(answers.enabled_lanes),
    redZoneActions: splitList(answers.red_zone_actions),
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
  write(path.join(out, "00_MAP.md"), renderMap(answers, detected));
  write(path.join(out, "CONTEXT.md"), renderContext(answers));
  write(path.join(out, "docs/Validation Commands.md"), renderValidation(answers));
  write(path.join(out, "docs/Red Zone Rules.md"), renderRedZone(answers));
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
  console.log(`Front doors: ${path.join(result.out, "AGENTS.md")} and ${path.join(result.out, "CLAUDE.md")}`);
  console.log(`Review packet: ${path.join(result.out, "commissioning-review.md")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
