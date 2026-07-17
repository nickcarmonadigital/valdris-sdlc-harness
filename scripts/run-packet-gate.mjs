#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentSelfGrantProblems,
  applicationSourceState,
  canonicalJson,
  fileSha256,
  readJson,
  resolveArtifactPath,
  safeIdentifier,
  secretDisclosureProblems,
  sha256,
  validatePortableProof,
} from "./proof-runner.mjs";
import { validateRcaArtifact } from "./rca-gate.mjs";
import { validateReviewArtifact } from "./review-gate.mjs";
import { validateIntakeDocument } from "./intake-gate.mjs";

export const RUN_PACKET_SCHEMA = "valdris.run-packet.v1";
export const RUN_PACKET_RUNTIME_SCHEMA = "valdris.run-packet-runtime.v1";
const SHA256 = /^[a-f0-9]{64}$/i;
const VALIDATOR_TIMEOUT_MS = 120_000;
const INPUT_NAMES = ["intake", "route", "classification", "goal"];
export const CANONICAL_INPUT_PATHS = Object.freeze({
  intake: "run/intake.json",
  classification: "run/workload-classification.json",
  route: "run/route.json",
  goal: "goal/goal.json",
});
const INPUT_GATE_SCRIPTS = Object.freeze({
  intake: "intake-gate.mjs",
  classification: "workload-classification-gate.mjs",
  route: "route-gate.mjs",
  goal: "goal-gate.mjs",
});
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.resolve(SCRIPT_DIR, "..");
const ROUTE_GATE_POLICIES = Object.freeze({
  "code-intelligence": { path: "graph/graph.json", script: "code-intelligence-gate-all.mjs" },
  foundation: { path: "foundation/assessment.json", script: "foundation-gate.mjs" },
  production: { path: "production/layer-assessment.json", script: "production-layer-gate.mjs" },
  "ai-assurance": { path: "ai/assurance.json", script: "ai-assurance-gate.mjs" },
  "domain-assurance": { path: "domain/assurance.json", script: "domain-assurance-gate.mjs" },
  eval: { path: "evals/results.json", script: "eval-gate.mjs" },
  trajectory: { path: "trajectory/trajectory.json", script: "trajectory-gate.mjs" },
  smoke: { path: "smoke/smoke_proof.json", script: "smoke-gate.mjs" },
});
const CORE_GATE_PATHS = Object.freeze({
  "portable-proof": "proof/portable.json",
  "independent-review": "review/review.json",
  rca: "rca/rca.json",
});
const VALIDATION_ENTRY_SCRIPTS = Object.freeze([
  "run-packet-gate.mjs",
  "run-create.mjs",
  "proof-runner.mjs",
  "rca-gate.mjs",
  "review-gate.mjs",
  ...Object.values(INPUT_GATE_SCRIPTS),
  ...Object.values(ROUTE_GATE_POLICIES).map(({ script }) => script),
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedRelative(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function runtimeFiles(directory, include, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const file = path.join(directory, entry.name);
    const stats = lstatSync(file);
    if (stats.isSymbolicLink()) throw new Error(`validation runtime cannot contain symbolic links: ${normalizedRelative(RUNTIME_ROOT, file)}`);
    if (stats.isDirectory()) runtimeFiles(file, include, files);
    else if (stats.isFile() && include(file)) files.push(file);
  }
  return files;
}

function validatorSourceFiles() {
  const files = new Set();
  const pending = [...VALIDATION_ENTRY_SCRIPTS].map((name) => path.join(SCRIPT_DIR, name));
  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (files.has(file)) continue;
    if (path.dirname(file) !== SCRIPT_DIR) throw new Error(`validator source escapes scripts directory: ${file}`);
    const stats = lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`validator source must be a regular file: ${normalizedRelative(RUNTIME_ROOT, file)}`);
    files.add(file);
    const source = readFileSync(file, "utf8");
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g);
    for (const match of imports) {
      const dependency = path.resolve(path.dirname(file), match[1]);
      if (path.extname(dependency) === ".mjs" && !files.has(dependency)) pending.push(dependency);
    }
  }
  return [...files].sort((left, right) => compareText(normalizedRelative(RUNTIME_ROOT, left), normalizedRelative(RUNTIME_ROOT, right)));
}

export function validationRuntimeBinding(repoRoot = RUNTIME_ROOT, expectedCommit) {
  const sources = validatorSourceFiles()
    .map((file) => ({ kind: "validator-source", path: normalizedRelative(RUNTIME_ROOT, file), sha256: fileSha256(file) }));
  const catalogs = runtimeFiles(path.join(RUNTIME_ROOT, "controls"), (file) => file.endsWith(".json"))
    .map((file) => ({ kind: "control-catalog", path: normalizedRelative(RUNTIME_ROOT, file), sha256: fileSha256(file) }));
  const registry = path.join(RUNTIME_ROOT, "skills", "registry.json");
  const registryStats = lstatSync(registry);
  if (registryStats.isSymbolicLink() || !registryStats.isFile()) throw new Error("skill registry must be a regular runtime file");
  const files = [...sources, ...catalogs, { kind: "skill-registry", path: "skills/registry.json", sha256: fileSha256(registry) }]
    .sort((left, right) => compareText(left.path, right.path));
  repoRoot = path.resolve(repoRoot);
  const git = (cwd, args) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { cwd, encoding: "utf8", shell: false, timeout: 30_000, killSignal: "SIGTERM", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown git error").trim()}`);
    return result.stdout.trim();
  };
  const runtimeGitRoot = realpathSync(git(RUNTIME_ROOT, ["rev-parse", "--show-toplevel"]));
  const targetGitRoot = realpathSync(git(repoRoot, ["rev-parse", "--show-toplevel"]));
  if (runtimeGitRoot !== targetGitRoot) throw new Error("validation runtime and packet repository must share one Git worktree");
  const commit = git(runtimeGitRoot, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40,64}$/i.test(expectedCommit || "") || expectedCommit !== commit) throw new Error("validation runtime Git HEAD must exactly match the packet commit");
  const tree = git(runtimeGitRoot, ["rev-parse", "HEAD^{tree}"]);
  const runtimePaths = files.map((entry) => normalizedRelative(runtimeGitRoot, path.join(RUNTIME_ROOT, entry.path)));
  git(runtimeGitRoot, ["ls-files", "--error-unmatch", "--", ...runtimePaths]);
  const dirty = git(runtimeGitRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...runtimePaths]);
  if (dirty) throw new Error(`validation runtime files are dirty or untracked: ${dirty.split(/\r?\n/, 1)[0]}`);
  const source = {
    scheme: "git-head",
    commit,
    tree,
    runtimePath: normalizedRelative(runtimeGitRoot, RUNTIME_ROOT) || ".",
  };
  return {
    schema: RUN_PACKET_RUNTIME_SCHEMA,
    source,
    files,
    setSha256: sha256(canonicalJson({ source, files })),
  };
}

function validationRuntimeProblems(declared, repoRoot, expectedCommit) {
  const problems = [];
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
    return { valid: false, problems: ["run packet validationRuntime is required"] };
  }
  let actual;
  try { actual = validationRuntimeBinding(repoRoot, expectedCommit); }
  catch (error) { return { valid: false, problems: [`current validation runtime cannot be trusted: ${error.message}`] }; }
  if (declared.schema !== RUN_PACKET_RUNTIME_SCHEMA) problems.push(`run packet validationRuntime schema must be ${RUN_PACKET_RUNTIME_SCHEMA}`);
  if (canonicalJson(declared.source) !== canonicalJson(actual.source)) problems.push("run packet validation runtime Git source does not match the trusted clean HEAD");
  if (!Array.isArray(declared.files)) problems.push("run packet validationRuntime files must be an array");
  else if (canonicalJson(declared.files) !== canonicalJson(actual.files)) problems.push("run packet validation runtime does not match current validator/catalog files");
  if (!SHA256.test(declared.setSha256 || "") || declared.setSha256 !== actual.setSha256) problems.push("run packet validation runtime setSha256 does not match current validator/catalog files");
  return { valid: problems.length === 0, problems };
}

export function routeRequiresRca(route, intake = {}, classification = {}) {
  const taskTypes = [classification?.taskType, route?.taskType].map((value) => String(value || "").toLowerCase());
  const correctiveTypes = new Set(["bug", "regression", "incident", "self-heal", "self_heal"]);
  if (correctiveTypes.has(taskTypes[0])) return true;
  const routeSignals = Array.isArray(route?.requestSignals) ? route.requestSignals.join(" ") : "";
  const classificationSignals = Array.isArray(classification?.matchedSignals) ? classification.matchedSignals.join(" ") : "";
  const trustedSignals = `${routeSignals} ${classificationSignals} ${intake?.requestText || ""}`;
  const incidentOrRegression = /\b(?:production\s+incident|incident\s+response|outage|regression)\b/i.test(trustedSignals);
  const correctiveSelfHeal = /\b(?:apply|perform|execute|run|remediate|recover(?:y)?|corrective)\b.{0,48}\bself[-_ ]?heal(?:ing)?\b|\bself[-_ ]?heal(?:ing)?\b.{0,48}\b(?:remediation|recovery|corrective\s+work)\b/i.test(trustedSignals);
  if (incidentOrRegression || correctiveSelfHeal) return true;
  const classificationIsIntakeBound = SHA256.test(classification?.requestSha256 || "") && classification.requestSha256 === intake?.requestSha256;
  if (classificationIsIntakeBound && taskTypes[0]) return false;
  if (correctiveTypes.has(taskTypes[1])) return true;
  return false;
}

export function routeRequiredGates(route, intake = {}, classification = {}) {
  const required = new Set(["portable-proof", "independent-review"]);
  if (routeRequiresRca(route, intake, classification)) required.add("rca");
  for (const [gate, applicability] of Object.entries(route?.gateApplicability || {})) {
    if (!Object.hasOwn(ROUTE_GATE_POLICIES, gate)) throw new Error(`route declares unknown gate: ${gate}`);
    if (applicability?.status === "required") required.add(gate);
  }
  return [...required].sort();
}

function gateBindingValue(gateArtifacts) {
  return [...gateArtifacts]
    .map(({ gate, path: artifactPath, sha256: digest, required, runId, commit, environment }) => ({ gate, path: artifactPath, sha256: digest, required, runId, commit, environment }))
    .sort((left, right) => compareText(left.gate, right.gate));
}

export function reviewEvidenceBundle(document) {
  const inputs = Object.fromEntries(INPUT_NAMES.map((name) => {
    const input = document.inputs?.[name] || {};
    return [name, { path: input.path, sha256: input.sha256 }];
  }));
  const gateArtifacts = gateBindingValue((document.gateArtifacts || []).filter(({ gate }) => gate !== "independent-review"));
  return {
    schema: "valdris.review-evidence-bundle.v1",
    runId: document.runId,
    commit: document.commit,
    environment: document.environment,
    validationRuntimeSha256: document.validationRuntime?.setSha256,
    inputs,
    requiredGates: [...(document.requiredGates || [])].sort(compareText),
    gateArtifacts,
  };
}

export function reviewEvidenceBundleSha256(document) {
  return sha256(canonicalJson(reviewEvidenceBundle(document)));
}

export function packetBindings(document) {
  const intakeSha256 = document.inputs.intake.sha256;
  const classificationSha256 = document.inputs.classification.sha256;
  const routeSha256 = document.inputs.route.sha256;
  const goalSha256 = document.inputs.goal.sha256;
  const gateArtifactsSha256 = sha256(canonicalJson(gateBindingValue(document.gateArtifacts)));
  const runSha256 = sha256(document.runId);
  const commitSha256 = sha256(document.commit);
  const environmentSha256 = sha256(document.environment);
  const validationRuntimeSha256 = document.validationRuntime.setSha256;
  const evidenceBundleSha256 = reviewEvidenceBundleSha256(document);
  const envelopeSha256 = sha256(canonicalJson({
    schema: document.schema,
    runSha256,
    commitSha256,
    environmentSha256,
    intakeSha256,
    classificationSha256,
    routeSha256,
    goalSha256,
    gateArtifactsSha256,
    validationRuntimeSha256,
    evidenceBundleSha256,
    requiredGates: [...document.requiredGates].sort(),
  }));
  return { runSha256, commitSha256, environmentSha256, intakeSha256, classificationSha256, routeSha256, goalSha256, gateArtifactsSha256, validationRuntimeSha256, evidenceBundleSha256, envelopeSha256 };
}

function subjectProblems(document, expected, label) {
  const problems = [];
  const aliases = [
    ["run identifier", [document?.runId, document?.goalId, document?.run?.id], expected.runId],
    ["commit", [document?.commit, document?.run?.commit], expected.commit],
    ["environment", [document?.environment, document?.run?.environment], expected.environment],
  ];
  for (const [field, values, expectedValue] of aliases) {
    const present = values.filter((value) => value !== undefined);
    if (present.length === 0 || present.some((value) => value !== expectedValue)) problems.push(`${label} ${field} does not match the packet`);
  }
  return problems;
}

function nativeGateProblems(gate, repoRoot) {
  const policy = ROUTE_GATE_POLICIES[gate];
  if (!policy) return [`unknown native gate: ${gate}`];
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, policy.script), "--repo", repoRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: VALIDATOR_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
  if (result.status === 0) return [];
  const output = (result.stderr || result.stdout || "native gate returned no output").trim().slice(-4000);
  return [`gate ${gate} failed native validator ${policy.script}: ${output}`];
}

function nativeInputProblems(name, repoRoot) {
  const script = INPUT_GATE_SCRIPTS[name];
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, script), "--repo", repoRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: VALIDATOR_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });
  if (result.status === 0) return [];
  const output = (result.stderr || result.stdout || "native validator returned no output").trim().slice(-4000);
  return [`input ${name} failed native validator ${script}: ${output}`];
}

function finalIntegrityProblems(document, repoRoot) {
  const problems = [...validationRuntimeProblems(document.validationRuntime, repoRoot, document.commit).problems];
  for (const name of INPUT_NAMES) {
    const input = document.inputs?.[name];
    if (!input || typeof input.path !== "string" || !SHA256.test(input.sha256 || "")) continue;
    try {
      const file = resolveArtifactPath(repoRoot, input.path, { mustExist: true });
      if (fileSha256(file) !== input.sha256) problems.push(`input ${name} changed during packet validation`);
    } catch (error) {
      problems.push(`input ${name} changed during packet validation: ${error.message}`);
    }
  }
  for (const artifact of document.gateArtifacts || []) {
    if (typeof artifact?.path !== "string" || !SHA256.test(artifact.sha256 || "")) continue;
    try {
      const file = resolveArtifactPath(repoRoot, artifact.path, { mustExist: true });
      if (fileSha256(file) !== artifact.sha256) problems.push(`gate ${artifact.gate || "unknown"} changed during packet validation`);
    } catch (error) {
      problems.push(`gate ${artifact.gate || "unknown"} changed during packet validation: ${error.message}`);
    }
  }
  const portableProof = (document.gateArtifacts || []).find(({ gate }) => gate === "portable-proof");
  if (portableProof?.path) {
    try {
      const proof = readJson(resolveArtifactPath(repoRoot, portableProof.path, { mustExist: true }));
      const currentApplication = applicationSourceState(repoRoot, document.commit);
      if (proof.source?.applicationAfterSha256 !== currentApplication.worktreeSha256) problems.push("application source changed during final packet validation");
    } catch (error) {
      problems.push(`application source final rebind failed: ${error.message}`);
    }
  }
  return problems;
}

export function validateRunPacket(document, repoRoot) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["run packet must be a JSON object"] };
  if (document.schema !== RUN_PACKET_SCHEMA) problems.push(`run packet schema must be ${RUN_PACKET_SCHEMA}`);
  if (document.status !== "ready") problems.push("run packet status must be ready");
  if (!safeIdentifier(document.runId)) problems.push("run packet runId is invalid");
  if (!safeIdentifier(document.commit)) problems.push("run packet commit is invalid");
  if (!safeIdentifier(document.environment)) problems.push("run packet environment is invalid");
  if (!Array.isArray(document.requiredGates) || document.requiredGates.some((gate) => !safeIdentifier(gate))) problems.push("run packet requiredGates must be safe identifiers");
  if (!Array.isArray(document.gateArtifacts)) problems.push("run packet gateArtifacts must be an array");
  const runtimeValidation = validationRuntimeProblems(document.validationRuntime, repoRoot, document.commit);
  problems.push(...runtimeValidation.problems);

  const loadedInputs = {};
  for (const name of INPUT_NAMES) {
    const input = document.inputs?.[name];
    if (!input || typeof input.path !== "string" || !SHA256.test(input.sha256 || "")) {
      problems.push(`run packet input ${name} must declare path and SHA-256 digest`);
      continue;
    }
    try {
      const file = resolveArtifactPath(repoRoot, input.path, { mustExist: true });
      const actualPath = normalizedRelative(repoRoot, file);
      if (input.path !== CANONICAL_INPUT_PATHS[name] || actualPath !== CANONICAL_INPUT_PATHS[name]) {
        problems.push(`input ${name} must use canonical path ${CANONICAL_INPUT_PATHS[name]}`);
      }
      const actual = fileSha256(file);
      if (actual !== input.sha256) problems.push(`run packet input ${name} digest does not match`);
      loadedInputs[name] = readJson(file);
      problems.push(...agentSelfGrantProblems(loadedInputs[name], `input ${name}`));
      problems.push(...secretDisclosureProblems(loadedInputs[name]));
    } catch (error) {
      problems.push(`run packet input ${name} is invalid: ${error.message}`);
    }
  }

  const expected = { runId: document.runId, commit: document.commit, environment: document.environment };
  for (const name of INPUT_NAMES) {
    if (loadedInputs[name]) problems.push(...subjectProblems(loadedInputs[name], expected, `input ${name}`));
  }
  if (loadedInputs.intake) {
    const result = validateIntakeDocument(loadedInputs.intake);
    if (!result.valid) problems.push(`input intake is invalid: ${result.problems.join("; ")}`);
  }
  const expectedInputSchemas = { intake: "uash.intake.v1", route: "uash.route.v2", classification: "uash.workload-classification.v1", goal: "uash.goal.v1" };
  for (const [name, schema] of Object.entries(expectedInputSchemas)) {
    if (loadedInputs[name] && loadedInputs[name].schema !== schema) problems.push(`input ${name} schema must be ${schema}`);
  }
  for (const name of INPUT_NAMES) {
    if (runtimeValidation.valid && loadedInputs[name] && document.inputs?.[name]?.path === CANONICAL_INPUT_PATHS[name]) {
      problems.push(...nativeInputProblems(name, repoRoot));
    }
  }
  if (loadedInputs.route && loadedInputs.intake && loadedInputs.route.intakeSha256 !== document.inputs?.intake?.sha256) problems.push("route is not bound to the packet intake");
  if (loadedInputs.route && loadedInputs.classification && loadedInputs.route.workloadClassificationSha256 !== document.inputs?.classification?.sha256) problems.push("route is not bound to the packet workload classification");
  if (loadedInputs.goal && loadedInputs.classification && loadedInputs.goal.workloadClassificationSha256 !== document.inputs?.classification?.sha256) problems.push("goal is not bound to the packet workload classification");
  if (loadedInputs.goal && loadedInputs.route && loadedInputs.goal.initialRouteSha256 !== document.inputs?.route?.sha256) problems.push("goal is not bound to the packet route");
  if (loadedInputs.goal && loadedInputs.intake && loadedInputs.goal.requestSha256 !== loadedInputs.intake.requestSha256) problems.push("goal is not bound to the packet intake request");

  let expectedGates = [];
  if (loadedInputs.route) {
    try { expectedGates = routeRequiredGates(loadedInputs.route, loadedInputs.intake, loadedInputs.classification); }
    catch (error) { problems.push(error.message); }
  }
  const declaredGates = Array.isArray(document.requiredGates) ? [...new Set(document.requiredGates)].sort() : [];
  if (JSON.stringify(declaredGates) !== JSON.stringify(expectedGates)) problems.push(`requiredGates must exactly match route-derived gates: ${expectedGates.join(", ")}`);

  const artifactsByGate = new Map();
  for (const [index, artifact] of (document.gateArtifacts || []).entries()) {
    const label = `gate artifact ${index + 1}`;
    if (!safeIdentifier(artifact?.gate)) problems.push(`${label} gate is invalid`);
    else if (artifactsByGate.has(artifact.gate)) problems.push(`${label} duplicates gate ${artifact.gate}`);
    else artifactsByGate.set(artifact.gate, artifact);
    if (artifact?.required !== true) problems.push(`${label} must be marked required`);
    if (artifact?.runId !== document.runId || artifact?.commit !== document.commit || artifact?.environment !== document.environment) problems.push(`${label} subject binding does not match the packet`);
    if (typeof artifact?.path !== "string" || !artifact.path.length) problems.push(`${label} path is required`);
    if (!SHA256.test(artifact?.sha256 || "")) problems.push(`${label} sha256 is invalid`);
  }
  for (const gate of expectedGates) {
    if (!artifactsByGate.has(gate)) problems.push(`required gate artifact is missing: ${gate}`);
  }

  const loadedGateDocuments = new Map();
  for (const [gate, artifact] of artifactsByGate.entries()) {
    if (!expectedGates.includes(gate)) problems.push(`gate artifact is not required by this route: ${gate}`);
    if (typeof artifact.path !== "string") continue;
    try {
      const file = resolveArtifactPath(repoRoot, artifact.path, { mustExist: true });
      const expectedPath = CORE_GATE_PATHS[gate] || ROUTE_GATE_POLICIES[gate]?.path;
      const actualPath = normalizedRelative(repoRoot, file);
      if (!expectedPath) {
        problems.push(`gate ${gate} is unknown and has no native validator`);
        continue;
      }
      if (actualPath !== expectedPath) {
        problems.push(`gate ${gate} must use canonical artifact path ${expectedPath}`);
        continue;
      }
      if (SHA256.test(artifact.sha256 || "") && fileSha256(file) !== artifact.sha256) problems.push(`gate ${gate} digest does not match`);
      let gateDocument;
      try { gateDocument = readJson(file); }
      catch (error) { problems.push(`gate ${gate} artifact must be valid JSON: ${error.message}`); continue; }
      loadedGateDocuments.set(gate, gateDocument);
      if (gate === "portable-proof") {
        const result = validatePortableProof(gateDocument);
        if (!result.valid) problems.push(`portable-proof gate is invalid: ${result.problems.join("; ")}`);
        if (gateDocument.outcome?.status !== "passed") problems.push("portable-proof gate must contain a passed green proof");
        problems.push(...subjectProblems(gateDocument, expected, "portable-proof gate"));
        try {
          const currentApplication = applicationSourceState(repoRoot, document.commit);
          if (gateDocument.source?.applicationAfterSha256 !== currentApplication.worktreeSha256) problems.push("application source changed after portable proof");
        } catch (error) {
          problems.push(`application source cannot be rebound after portable proof: ${error.message}`);
        }
      } else if (gate === "independent-review") {
        const result = validateReviewArtifact(gateDocument, repoRoot);
        if (!result.valid) problems.push(`independent-review gate is invalid: ${result.problems.join("; ")}`);
        problems.push(...subjectProblems(gateDocument, expected, "independent-review gate"));
      } else if (gate === "rca") {
        const result = validateRcaArtifact(gateDocument, repoRoot);
        if (!result.valid) problems.push(`RCA gate is invalid: ${result.problems.join("; ")}`);
        problems.push(...subjectProblems(gateDocument, expected, "RCA gate"));
      } else if (runtimeValidation.valid) {
        problems.push(...agentSelfGrantProblems(gateDocument, `gate ${gate}`));
        problems.push(...secretDisclosureProblems(gateDocument));
        if (gate === "code-intelligence") {
          if (gateDocument?.git?.commit !== expected.commit) problems.push("gate code-intelligence commit does not match the packet");
        } else {
          problems.push(...subjectProblems(gateDocument, expected, `gate ${gate}`));
        }
        problems.push(...nativeGateProblems(gate, repoRoot));
      }
    } catch (error) {
      problems.push(`gate ${gate} artifact is invalid: ${error.message}`);
    }
  }

  const portableProofArtifact = artifactsByGate.get("portable-proof");
  const reviewDocument = loadedGateDocuments.get("independent-review");
  if (portableProofArtifact && reviewDocument && reviewDocument.subject?.sha256 !== portableProofArtifact.sha256) problems.push("independent review must be bound to the packet portable proof artifact");
  if (reviewDocument && reviewDocument.validationRuntimeSha256 !== document.validationRuntime?.setSha256) problems.push("independent review must be bound to the packet validation runtime");
  if (reviewDocument && reviewDocument.evidenceBundleSha256 !== reviewEvidenceBundleSha256(document)) problems.push("independent review must be bound to every packet input and required evidence artifact");

  if (problems.length === 0) {
    problems.push(...finalIntegrityProblems(document, repoRoot));
  }
  if (problems.length === 0) {
    const expectedBindings = packetBindings(document);
    for (const [name, digest] of Object.entries(expectedBindings)) {
      if (!SHA256.test(document.bindings?.[name] || "") || document.bindings[name] !== digest) problems.push(`run packet binding ${name} does not match`);
    }
  }
  problems.push(...agentSelfGrantProblems(document, "run packet"));
  problems.push(...secretDisclosureProblems(document));
  return { valid: problems.length === 0, problems, requiredGates: expectedGates };
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), file: "run/packet.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--file") args.file = argv[++index];
    else if (arg === "--commit") args.commit = argv[++index];
    else if (arg === "--print-runtime-binding") args.printRuntimeBinding = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/run-packet-gate.mjs --repo . [--file run/packet.json] [--print-runtime-binding --commit SHA]");
  const repoRoot = path.resolve(args.repo);
  if (args.printRuntimeBinding) {
    if (!args.commit) throw new Error("--commit is required with --print-runtime-binding");
    return console.log(JSON.stringify(validationRuntimeBinding(repoRoot, args.commit), null, 2));
  }
  const file = resolveArtifactPath(repoRoot, args.file, { mustExist: true });
  const result = validateRunPacket(readJson(file), repoRoot);
  console.log(JSON.stringify({ ok: result.valid, artifact: normalizedRelative(repoRoot, file), requiredGates: result.requiredGates, problems: result.problems }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
