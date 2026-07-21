#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
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
import {
  requiredReviewTrustSha256,
  reviewRoleProvenanceSha256,
  reviewTrustStoreSha256,
  validateReviewArtifact,
} from "./review-gate.mjs";
import { validateIntakeDocument } from "./intake-gate.mjs";
import {
  ROOT_DISCOVERY_LOADER_FILES,
  validateRootDiscoveryLoaderBytes,
  validateRootDiscoveryLoaderFile,
} from "./discovery-loader-contract.mjs";
import { EVIDENCE_NAMESPACE_SET } from "./evidence-namespaces.mjs";

export const RUN_PACKET_SCHEMA = "valdris.run-packet.v2";
export const RUN_PACKET_RUNTIME_SCHEMA = "valdris.run-packet-runtime.v1";
const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
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
const CODE_INTELLIGENCE_SUPPORT_PATHS = Object.freeze([
  { kind: "graph-freshness", path: "graph/freshness.json" },
  { kind: "design-anchors", path: "design/anchors.json" },
]);
export const BRIDGE_FINISH_LINE_GATE_SCRIPTS = Object.freeze([
  "enterprise-ai-gate-all.mjs",
  "rca-gate.mjs",
  "review-gate.mjs",
  "run-packet-gate.mjs",
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedRelative(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function runtimeFiles(directory, include, files = [], runtimeRoot = RUNTIME_ROOT) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const file = path.join(directory, entry.name);
    const stats = lstatSync(file);
    if (stats.isSymbolicLink()) throw new Error(`validation runtime cannot contain symbolic links: ${normalizedRelative(runtimeRoot, file)}`);
    if (stats.isDirectory()) runtimeFiles(file, include, files, runtimeRoot);
    else if (stats.isFile() && include(file)) files.push(file);
  }
  return files;
}

export function validationRuntimeBinding(repoRoot = RUNTIME_ROOT, expectedCommit, options = {}) {
  repoRoot = path.resolve(repoRoot);
  const runtimeRoot = path.resolve(options.runtimeRoot || RUNTIME_ROOT);
  const gitCommand = (cwd, args, options = {}) => {
    const result = spawnSync("git", ["-C", cwd, "--literal-pathspecs", ...args], {
      cwd,
      encoding: options.binary ? null : "utf8",
      input: options.input,
      shell: false,
      timeout: 30_000,
      killSignal: "SIGTERM",
      maxBuffer: 64 * 1024 * 1024,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
      const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
      throw new Error(`git ${args.join(" ")} failed: ${String(stderr || stdout || result.error?.message || "unknown git error").trim()}`);
    }
    return result.stdout;
  };
  const gitText = (cwd, args) => String(gitCommand(cwd, args)).replace(/\r?\n$/, "");
  const gitRaw = (cwd, args) => String(gitCommand(cwd, args));
  const runtimeGitRoot = realpathSync(gitText(runtimeRoot, ["rev-parse", "--show-toplevel"]));
  const targetGitRoot = realpathSync(gitText(repoRoot, ["rev-parse", "--show-toplevel"]));
  if (runtimeGitRoot !== targetGitRoot) throw new Error("validation runtime and packet repository must share one Git worktree");
  // Let Git spell the worktree-relative prefix so Windows 8.3 and long-path aliases bind identically.
  const runtimePrefix = gitText(runtimeRoot, ["rev-parse", "--show-prefix"]).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (runtimePrefix === ".." || runtimePrefix.startsWith("../") || path.posix.isAbsolute(runtimePrefix)) throw new Error("validation runtime Git prefix is invalid");
  // The packet target can itself be a subdirectory of a larger worktree. Ask Git for that
  // prefix too instead of deriving it from filesystem spellings or assuming the target is root.
  const targetPrefix = gitText(repoRoot, ["rev-parse", "--show-prefix"]).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (targetPrefix === ".." || targetPrefix.startsWith("../") || path.posix.isAbsolute(targetPrefix)) throw new Error("packet target Git prefix is invalid");
  const commissionedRuntimePath = targetPrefix ? `${targetPrefix}/.valdris-harness` : ".valdris-harness";
  const runtimeIsCanonicalPack = runtimePrefix === ".valdris-harness" || runtimePrefix.endsWith("/.valdris-harness");
  const commissioned = runtimeIsCanonicalPack || runtimePrefix !== targetPrefix;
  if (commissioned && runtimePrefix !== commissionedRuntimePath) {
    throw new Error(`validation runtime must be the target-nested .valdris-harness directory (expected Git path ${commissionedRuntimePath})`);
  }
  const commit = gitText(runtimeGitRoot, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40,64}$/i.test(expectedCommit || "") || expectedCommit !== commit) throw new Error("validation runtime Git HEAD must exactly match the packet commit");
  const tree = gitText(runtimeGitRoot, ["rev-parse", "HEAD^{tree}"]);
  const runtimeGitPath = (relativePath) => runtimePrefix ? `${runtimePrefix}/${relativePath}` : relativePath;
  const loaderGitPaths = commissioned ? ROOT_DISCOVERY_LOADER_FILES.map((fileName) => targetPrefix ? `${targetPrefix}/${fileName}` : fileName) : [];
  const adapterGitPath = commissioned ? runtimeGitPath("project-adapter.json") : null;
  const selectedTreeScopes = [runtimeGitPath("scripts"), runtimeGitPath("controls"), runtimeGitPath("skills/registry.json"), ...(adapterGitPath ? [adapterGitPath] : [])];
  const treeScopes = commissioned ? [runtimePrefix, ...loaderGitPaths] : selectedTreeScopes;
  const treeRecords = new Map();
  for (const record of gitRaw(runtimeGitRoot, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", ...treeScopes]).split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    if (tab === -1) throw new Error("validation runtime Git tree returned a malformed record");
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    const gitPath = record.slice(tab + 1);
    treeRecords.set(gitPath, { mode, type, oid, gitPath });
  }
  const runtimeTreePrefix = runtimePrefix ? `${runtimePrefix}/` : "";
  const completeRuntimeTreeRecords = commissioned
    ? [...treeRecords.values()].filter(({ gitPath }) => gitPath.startsWith(runtimeTreePrefix)).sort((left, right) => compareText(left.gitPath, right.gitPath))
    : [];
  if (commissioned) {
    for (const entry of completeRuntimeTreeRecords) {
      if (entry.type !== "blob" || !/^(?:100644|100755)$/.test(entry.mode)) throw new Error(`commissioned runtime path must be a regular committed blob: ${entry.gitPath}`);
    }
    const committedRuntimePaths = completeRuntimeTreeRecords.map(({ gitPath }) => gitPath.slice(runtimeTreePrefix.length));
    const liveRuntimePaths = runtimeFiles(runtimeRoot, () => true, [], runtimeRoot)
      .map((file) => normalizedRelative(runtimeRoot, file)).sort(compareText);
    if (canonicalJson(liveRuntimePaths) !== canonicalJson(committedRuntimePaths)) {
      throw new Error("complete commissioned runtime inventory does not match committed Git HEAD");
    }
  }
  const scriptsGitPrefix = `${runtimeGitPath("scripts")}/`;
  const candidateTreeRecords = [...treeRecords.values()].filter(({ gitPath }) => (
    gitPath.startsWith(scriptsGitPrefix)
    || (gitPath.startsWith(`${runtimeGitPath("controls")}/`) && gitPath.endsWith(".json"))
    || gitPath === runtimeGitPath("skills/registry.json")
    || gitPath === adapterGitPath
    || loaderGitPaths.includes(gitPath)
  ));
  for (const entry of candidateTreeRecords) {
    if (entry.type !== "blob" || !/^(?:100644|100755)$/.test(entry.mode) || !/^[a-f0-9]{40,64}$/i.test(entry.oid)) {
      throw new Error(`validation runtime path must be a regular committed blob: ${entry.gitPath}`);
    }
  }
  const runtimeIdentityTreeRecords = commissioned
    ? [...new Map([
        ...completeRuntimeTreeRecords,
        ...loaderGitPaths.map((gitPath) => treeRecords.get(gitPath)).filter(Boolean),
      ].map((entry) => [entry.gitPath, entry])).values()].sort((left, right) => compareText(left.gitPath, right.gitPath))
    : candidateTreeRecords;
  const uniqueOids = [...new Set(runtimeIdentityTreeRecords.map(({ oid }) => oid))];
  const batch = gitCommand(runtimeGitRoot, ["cat-file", "--batch"], { binary: true, input: Buffer.from(`${uniqueOids.join("\n")}\n`, "utf8") });
  const committedBlobs = new Map();
  let batchOffset = 0;
  for (const expectedOid of uniqueOids) {
    const headerEnd = batch.indexOf(0x0a, batchOffset);
    if (headerEnd === -1) throw new Error("validation runtime Git blob batch is truncated");
    const [oid, type, sizeText] = batch.subarray(batchOffset, headerEnd).toString("utf8").split(" ");
    const size = Number(sizeText);
    if (oid !== expectedOid || type !== "blob" || !Number.isSafeInteger(size) || size < 0) throw new Error("validation runtime Git blob batch is malformed");
    const start = headerEnd + 1;
    const end = start + size;
    if (end >= batch.length || batch[end] !== 0x0a) throw new Error("validation runtime Git blob batch has an invalid content boundary");
    committedBlobs.set(oid, Buffer.from(batch.subarray(start, end)));
    batchOffset = end + 1;
  }
  if (batchOffset !== batch.length) throw new Error("validation runtime Git blob batch contains unexpected trailing data");
  const committedRuntimeBlob = (relativePath, label) => {
    const gitPath = runtimeGitPath(relativePath);
    const entry = treeRecords.get(gitPath);
    if (!entry || !committedBlobs.has(entry.oid)) throw new Error(`${label} must be committed at ${gitPath}`);
    return committedBlobs.get(entry.oid);
  };
  const canonicalText = (bytes, label) => {
    const decoded = bytes.toString("utf8");
    if (bytes.includes(0) || !Buffer.from(decoded, "utf8").equals(bytes)) throw new Error(`${label} must be UTF-8 text`);
    return decoded.replace(/\r\n/g, "\n");
  };
  const assertLiveRuntimeFile = (relativePath, committedBytes, label) => {
    const file = path.join(runtimeRoot, ...relativePath.split("/"));
    const stats = lstatSync(file);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} must be a regular runtime file: ${relativePath}`);
    if (canonicalText(readFileSync(file), label) !== canonicalText(committedBytes, label)) throw new Error(`validation runtime files are dirty or untracked: ${label} does not match its committed Git blob: ${relativePath}`);
  };

  const scriptPaths = candidateTreeRecords
    .map(({ gitPath }) => gitPath)
    .filter((gitPath) => gitPath.startsWith(scriptsGitPrefix))
    .map((gitPath) => runtimePrefix ? gitPath.slice(runtimePrefix.length + 1) : gitPath)
    .sort(compareText);
  const unsupportedScript = scriptPaths.find((relativePath) => path.posix.extname(relativePath) !== ".mjs");
  if (unsupportedScript) throw new Error(`validation runtime scripts inventory contains an unsupported non-MJS file: ${unsupportedScript}`);
  const liveScriptPaths = runtimeFiles(path.join(runtimeRoot, "scripts"), () => true, [], runtimeRoot)
    .map((file) => normalizedRelative(runtimeRoot, file)).sort(compareText);
  if (canonicalJson(liveScriptPaths) !== canonicalJson(scriptPaths)) throw new Error("validation runtime executable scripts inventory does not match committed Git HEAD");
  for (const requiredScript of BRIDGE_FINISH_LINE_GATE_SCRIPTS) {
    if (!scriptPaths.includes(`scripts/${requiredScript}`)) throw new Error(`validation runtime is missing required bridge finish-line gate: scripts/${requiredScript}`);
  }
  const sources = scriptPaths.map((relativePath) => {
    const bytes = committedRuntimeBlob(relativePath, "validator source");
    assertLiveRuntimeFile(relativePath, bytes, "validator source");
    const canonicalBytes = Buffer.from(canonicalText(bytes, `validator source ${relativePath}`), "utf8");
    return { kind: "validator-source", path: relativePath, sha256: sha256(canonicalBytes) };
  });
  const controlsPrefix = `${runtimeGitPath("controls")}/`;
  const catalogPaths = candidateTreeRecords
    .map(({ gitPath }) => gitPath)
    .filter((gitPath) => gitPath.startsWith(controlsPrefix) && gitPath.endsWith(".json"))
    .map((gitPath) => runtimePrefix ? gitPath.slice(runtimePrefix.length + 1) : gitPath)
    .sort(compareText);
  const liveCatalogPaths = runtimeFiles(path.join(runtimeRoot, "controls"), (file) => file.endsWith(".json"), [], runtimeRoot)
    .map((file) => normalizedRelative(runtimeRoot, file)).sort(compareText);
  if (canonicalJson(liveCatalogPaths) !== canonicalJson(catalogPaths)) throw new Error("validation runtime control-catalog inventory does not match committed Git HEAD");
  const catalogs = catalogPaths.map((relativePath) => {
    const bytes = committedRuntimeBlob(relativePath, "control catalog");
    assertLiveRuntimeFile(relativePath, bytes, "control catalog");
    return { kind: "control-catalog", path: relativePath, sha256: sha256(bytes) };
  });
  const reviewTrustSha256 = requiredReviewTrustSha256();
  const reviewTrustRelativePath = "controls/review-trust.v1.json";
  const committedReviewTrustBytes = committedRuntimeBlob(reviewTrustRelativePath, "review trust store");
  let committedReviewTrust;
  let liveReviewTrust;
  try {
    committedReviewTrust = JSON.parse(committedReviewTrustBytes.toString("utf8"));
    liveReviewTrust = readJson(path.join(runtimeRoot, ...reviewTrustRelativePath.split("/")));
  } catch (error) {
    throw new Error(`review trust store must contain valid JSON: ${error.message}`);
  }
  if (reviewTrustStoreSha256(committedReviewTrust) !== reviewTrustSha256) {
    throw new Error("review trust store at committed Git HEAD does not match operator-held UASH_REVIEW_TRUST_SHA256");
  }
  if (reviewTrustStoreSha256(liveReviewTrust) !== reviewTrustSha256) {
    throw new Error("live review trust store does not match operator-held UASH_REVIEW_TRUST_SHA256");
  }
  const registryPath = "skills/registry.json";
  const registryBytes = committedRuntimeBlob(registryPath, "skill registry");
  assertLiveRuntimeFile(registryPath, registryBytes, "skill registry");
  const adapterFiles = commissioned ? (() => {
    const adapterPath = "project-adapter.json";
    const adapterBytes = committedRuntimeBlob(adapterPath, "project adapter");
    assertLiveRuntimeFile(adapterPath, adapterBytes, "project adapter");
    canonicalText(adapterBytes, "project adapter");
    try { JSON.parse(adapterBytes.toString("utf8")); }
    catch (error) { throw new Error(`project adapter must contain valid JSON: ${error.message}`); }
    return [{ kind: "project-adapter", path: adapterPath, sha256: sha256(adapterBytes) }];
  })() : [];
  const runtimeBoundFiles = [...sources, ...catalogs, { kind: "skill-registry", path: registryPath, sha256: sha256(registryBytes) }, ...adapterFiles];
  const discoveryLoaderFiles = commissioned ? ROOT_DISCOVERY_LOADER_FILES.map((fileName, index) => {
    validateRootDiscoveryLoaderFile(path.join(repoRoot, fileName), fileName);
    const entry = treeRecords.get(loaderGitPaths[index]);
    if (!entry || !committedBlobs.has(entry.oid)) throw new Error(`target-root discovery loaders must be Git-tracked: ${fileName}`);
    const bytes = committedBlobs.get(entry.oid);
    validateRootDiscoveryLoaderBytes(bytes, fileName);
    const liveBytes = readFileSync(path.join(repoRoot, fileName));
    if (canonicalText(liveBytes, `target-root discovery loader ${fileName}`) !== canonicalText(bytes, `committed target-root discovery loader ${fileName}`)) {
      throw new Error(`target-root discovery loaders are dirty or untracked: ${fileName} does not match its committed Git blob`);
    }
    return { kind: "target-root-discovery-loader", path: fileName, sha256: sha256(bytes) };
  }) : [];
  const files = [...runtimeBoundFiles, ...discoveryLoaderFiles]
    .sort((left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind));
  const runtimePaths = runtimeBoundFiles.map(({ path: relativePath }) => runtimeGitPath(relativePath));
  const boundGitPaths = commissioned
    ? [...completeRuntimeTreeRecords.map(({ gitPath }) => gitPath), ...loaderGitPaths]
    : runtimePaths;
  try {
    gitText(runtimeGitRoot, ["ls-files", "--error-unmatch", "--", ...boundGitPaths]);
  } catch (error) {
    throw new Error(`${commissioned ? "validation runtime files and target-root discovery loaders" : "validation runtime files"} must be Git-tracked: ${error.message}`);
  }
  const indexRecords = new Map();
  for (const record of gitRaw(runtimeGitRoot, ["ls-files", "--stage", "-z", "--", ...boundGitPaths]).split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    const gitPath = record.slice(tab + 1);
    if (tab === -1 || indexRecords.has(gitPath)) throw new Error(`validation runtime Git index has an invalid or duplicate entry: ${gitPath || "unknown"}`);
    indexRecords.set(gitPath, { mode, oid, stage });
  }
  const flagRecords = new Map();
  for (const record of gitRaw(runtimeGitRoot, ["ls-files", "-v", "-z", "--", ...boundGitPaths]).split("\0").filter(Boolean)) {
    flagRecords.set(record.slice(2), record[0]);
  }
  for (const gitPath of boundGitPaths) {
    const headEntry = treeRecords.get(gitPath);
    const indexEntry = indexRecords.get(gitPath);
    if (!headEntry || !indexEntry || indexEntry.stage !== "0" || indexEntry.mode !== headEntry.mode || indexEntry.oid !== headEntry.oid) {
      throw new Error(`validation runtime Git index does not exactly match committed HEAD: ${gitPath}`);
    }
    const flag = flagRecords.get(gitPath);
    if (!flag || flag === "S" || flag === flag.toLowerCase()) throw new Error(`validation runtime rejects assume-unchanged or skip-worktree index concealment flags: ${gitPath}`);
  }
  const dirty = gitRaw(runtimeGitRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...boundGitPaths]);
  const diff = gitRaw(runtimeGitRoot, ["diff", "--name-only", "-z", commit, "--", ...boundGitPaths]);
  if (dirty || diff) {
    const first = (dirty || diff).split("\0", 1)[0];
    if (commissioned && loaderGitPaths.some((loaderPath) => first.includes(loaderPath))) throw new Error(`target-root discovery loaders are dirty or untracked: ${first}`);
    throw new Error(`validation runtime files are dirty or untracked: ${first}`);
  }
  if (gitText(runtimeGitRoot, ["rev-parse", "HEAD"]) !== commit || gitText(runtimeGitRoot, ["rev-parse", "HEAD^{tree}"]) !== tree) {
    throw new Error("validation runtime Git HEAD changed during binding");
  }
  const source = {
    scheme: "git-head",
    commit,
    tree,
    targetPath: targetPrefix || ".",
    runtimePath: runtimePrefix || ".",
  };
  const runtimeIdentityFiles = commissioned
    ? runtimeIdentityTreeRecords.map(({ gitPath, mode, oid }) => ({
        path: gitPath,
        mode,
        sha256: sha256(committedBlobs.get(oid)),
      }))
    : files.map(({ kind, path: relativePath, sha256: digest }) => ({ kind, path: relativePath, sha256: digest }));
  const runtimeSha256 = sha256(canonicalJson({
    targetPath: source.targetPath,
    runtimePath: source.runtimePath,
    files: runtimeIdentityFiles,
  }));
  return {
    schema: RUN_PACKET_RUNTIME_SCHEMA,
    source,
    files,
    runtimeSha256,
    reviewTrustSha256,
    setSha256: sha256(canonicalJson({ source, files, runtimeSha256, reviewTrustSha256 })),
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
  if (!SHA256.test(declared.runtimeSha256 || "") || declared.runtimeSha256 !== actual.runtimeSha256) problems.push("run packet validation runtime runtimeSha256 does not match the trusted runtime and loader content");
  if (!SHA256.test(declared.reviewTrustSha256 || "") || declared.reviewTrustSha256 !== actual.reviewTrustSha256) problems.push("run packet validation runtime reviewTrustSha256 does not match the operator-held review trust-store pin");
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

export function canonicalRcaArtifactPresent(repoRoot) {
  return existsSync(path.resolve(repoRoot, CORE_GATE_PATHS.rca));
}

export function routeRequiredGates(route, intake = {}, classification = {}, options = {}) {
  const required = new Set(["portable-proof", "independent-review"]);
  if (routeRequiresRca(route, intake, classification) || options.rcaPresent === true) required.add("rca");
  for (const [gate, applicability] of Object.entries(route?.gateApplicability || {})) {
    if (!Object.hasOwn(ROUTE_GATE_POLICIES, gate)) throw new Error(`route declares unknown gate: ${gate}`);
    if (applicability?.status === "required") required.add(gate);
  }
  return [...required].sort();
}

export function supportingArtifactsForGate(gate, repoRoot) {
  if (gate !== "code-intelligence") return [];
  const root = realpathSync(path.resolve(repoRoot));
  const supporting = CODE_INTELLIGENCE_SUPPORT_PATHS.map(({ kind, path: artifactPath }) => {
    const file = resolveArtifactPath(root, artifactPath, { mustExist: true });
    return { kind, path: normalizedRelative(root, file), sha256: fileSha256(file) };
  });
  const graph = readJson(resolveArtifactPath(root, ROUTE_GATE_POLICIES[gate].path, { mustExist: true }));
  const freshness = readJson(resolveArtifactPath(root, "graph/freshness.json", { mustExist: true }));
  const backend = graph.codeIntelligence?.provider || freshness.codeIntelligence?.provider;
  if (backend === "gitnexus") {
    const evidenceArtifact = graph.codeIntelligence?.evidenceArtifact || freshness.codeIntelligence?.evidenceArtifact;
    if (typeof evidenceArtifact !== "string" || !evidenceArtifact.length) {
      throw new Error("GitNexus-backed code intelligence is missing its provider evidence artifact");
    }
    const file = resolveArtifactPath(root, evidenceArtifact, { mustExist: true });
    supporting.push({ kind: "provider-evidence", path: normalizedRelative(root, file), sha256: fileSha256(file) });
  }
  return supporting.sort((left, right) => compareText(left.kind, right.kind) || compareText(left.path, right.path));
}

function gateBindingValue(gateArtifacts) {
  return [...gateArtifacts]
    .map(({ gate, path: artifactPath, sha256: digest, required, runId, commit, environment, supportingArtifacts }) => {
      const value = { gate, path: artifactPath, sha256: digest, required, runId, commit, environment };
      if (Array.isArray(supportingArtifacts)) {
        value.supportingArtifacts = [...supportingArtifacts]
          .map(({ kind, path: supportingPath, sha256: supportingSha256 }) => ({ kind, path: supportingPath, sha256: supportingSha256 }))
          .sort((left, right) => compareText(left.kind, right.kind) || compareText(left.path, right.path));
      }
      return value;
    })
    .sort((left, right) => compareText(left.gate, right.gate));
}

export function reviewEvidenceBundle(document) {
  const inputs = Object.fromEntries(INPUT_NAMES.map((name) => {
    const input = document.inputs?.[name] || {};
    return [name, { path: input.path, sha256: input.sha256 }];
  }));
  const gateArtifacts = gateBindingValue((document.gateArtifacts || []).filter(({ gate }) => gate !== "independent-review"));
  const bundle = {
    schema: "valdris.review-evidence-bundle.v1",
    runId: document.runId,
    commit: document.commit,
    environment: document.environment,
    validationRuntimeSha256: document.validationRuntime?.setSha256,
    inputs,
    requiredGates: [...(document.requiredGates || [])].sort(compareText),
    gateArtifacts,
  };
  if (Array.isArray(document.artifactInventory)) bundle.artifactInventory = document.artifactInventory;
  return bundle;
}

export function reviewEvidenceBundleSha256(document) {
  return sha256(canonicalJson(reviewEvidenceBundle(document)));
}

export function packetBindings(document) {
  const generatedAtSha256 = sha256(document.generatedAt);
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
  const roleProvenanceSha256 = document.roleProvenanceSha256;
  const artifactInventorySha256 = Array.isArray(document.artifactInventory) ? sha256(canonicalJson(document.artifactInventory)) : null;
  const envelope = {
    schema: document.schema,
    generatedAtSha256,
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
    roleProvenanceSha256,
    requiredGates: [...document.requiredGates].sort(),
  };
  if (artifactInventorySha256) envelope.artifactInventorySha256 = artifactInventorySha256;
  const envelopeSha256 = sha256(canonicalJson(envelope));
  const bindings = { generatedAtSha256, runSha256, commitSha256, environmentSha256, intakeSha256, classificationSha256, routeSha256, goalSha256, gateArtifactsSha256, validationRuntimeSha256, evidenceBundleSha256, roleProvenanceSha256 };
  if (artifactInventorySha256) bindings.artifactInventorySha256 = artifactInventorySha256;
  return { ...bindings, envelopeSha256 };
}

function artifactInventoryProblems(inventory, repoRoot) {
  const problems = [];
  if (!Array.isArray(inventory)) return problems;
  let previous = "";
  let totalBytes = 0;
  const seen = new Set();
  for (const [index, entry] of inventory.entries()) {
    const label = `artifactInventory[${index}]`;
    const keys = entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry).sort() : [];
    if (JSON.stringify(keys) !== JSON.stringify(["path", "sha256", "size"])) {
      problems.push(`${label} must contain exactly path, sha256, and size`);
      continue;
    }
    if (typeof entry.path !== "string" || !entry.path.includes("/") || entry.path <= previous) problems.push(`${label}.path must be a strictly sorted repository-relative evidence path`);
    previous = entry.path;
    const root = entry.path.split("/", 1)[0];
    if (!EVIDENCE_NAMESPACE_SET.has(root)) problems.push(`${label}.path is outside the evidence namespaces`);
    const collisionKey = entry.path.normalize("NFC").toLowerCase();
    if (seen.has(collisionKey)) problems.push(`${label}.path collides on a portable filesystem`);
    seen.add(collisionKey);
    if (!SHA256.test(entry.sha256 || "")) problems.push(`${label}.sha256 must be a SHA-256 digest`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 10 * 1024 * 1024) problems.push(`${label}.size is invalid`);
    totalBytes += Number.isSafeInteger(entry.size) ? entry.size : 0;
    try {
      const file = resolveArtifactPath(repoRoot, entry.path, { mustExist: true });
      const stats = lstatSync(file);
      if (!stats.isFile() || stats.isSymbolicLink()) problems.push(`${label}.path must be a regular non-symlink file`);
      if (stats.size !== entry.size) problems.push(`${label}.size does not match`);
      if (SHA256.test(entry.sha256 || "") && fileSha256(file) !== entry.sha256) problems.push(`${label}.sha256 does not match`);
    } catch (error) {
      problems.push(`${label}.path is invalid: ${error.message}`);
    }
  }
  if (inventory.length > 512) problems.push("artifactInventory exceeds 512 files");
  if (totalBytes > 100 * 1024 * 1024) problems.push("artifactInventory exceeds 104857600 bytes");
  return problems;
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

function supportingArtifactProblems(gate, artifact, repoRoot) {
  const problems = [];
  if (gate !== "code-intelligence") {
    if (artifact?.supportingArtifacts !== undefined) problems.push(`gate ${gate} does not allow supportingArtifacts`);
    return problems;
  }
  let expected;
  try {
    expected = supportingArtifactsForGate(gate, repoRoot);
  } catch (error) {
    return [`gate ${gate} supporting artifacts cannot be derived: ${error.message}`];
  }
  const declared = artifact?.supportingArtifacts;
  if (!Array.isArray(declared)) return [`gate ${gate} supportingArtifacts must bind freshness, anchors, and applicable provider evidence`];
  const declaredByKind = new Map();
  for (const [index, supporting] of declared.entries()) {
    const label = `gate ${gate} supporting artifact ${index + 1}`;
    if (!supporting || typeof supporting !== "object" || Array.isArray(supporting)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    const keys = Object.keys(supporting).sort(compareText);
    if (canonicalJson(keys) !== canonicalJson(["kind", "path", "sha256"])) problems.push(`${label} must contain exactly kind, path, and sha256`);
    if (!safeIdentifier(supporting.kind)) problems.push(`${label} kind is invalid`);
    else if (declaredByKind.has(supporting.kind)) problems.push(`${label} duplicates kind ${supporting.kind}`);
    else declaredByKind.set(supporting.kind, supporting);
    if (typeof supporting.path !== "string" || !supporting.path.length) problems.push(`${label} path is required`);
    if (!SHA256.test(supporting.sha256 || "")) problems.push(`${label} sha256 is invalid`);
  }
  for (const expectedArtifact of expected) {
    const actual = declaredByKind.get(expectedArtifact.kind);
    if (!actual) {
      problems.push(`gate ${gate} supporting artifact is missing: ${expectedArtifact.kind}`);
      continue;
    }
    if (actual.path !== expectedArtifact.path) problems.push(`gate ${gate} supporting artifact ${expectedArtifact.kind} must use canonical path ${expectedArtifact.path}`);
    if (actual.sha256 !== expectedArtifact.sha256) problems.push(`gate ${gate} supporting artifact ${expectedArtifact.kind} digest does not match`);
  }
  const expectedKinds = new Set(expected.map(({ kind }) => kind));
  for (const kind of declaredByKind.keys()) {
    if (!expectedKinds.has(kind)) problems.push(`gate ${gate} supporting artifact is not applicable: ${kind}`);
  }
  const normalized = declared
    .map(({ kind, path: supportingPath, sha256: digest }) => ({ kind, path: supportingPath, sha256: digest }))
    .sort((left, right) => compareText(left.kind, right.kind) || compareText(left.path, right.path));
  if (canonicalJson(declared) !== canonicalJson(normalized)) problems.push(`gate ${gate} supportingArtifacts must use canonical order and fields`);
  return problems;
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
    for (const supporting of artifact?.supportingArtifacts || []) {
      if (typeof supporting?.path !== "string" || !SHA256.test(supporting.sha256 || "")) continue;
      try {
        const file = resolveArtifactPath(repoRoot, supporting.path, { mustExist: true });
        if (fileSha256(file) !== supporting.sha256) problems.push(`gate ${artifact.gate || "unknown"} supporting artifact ${supporting.kind || "unknown"} changed during packet validation`);
      } catch (error) {
        problems.push(`gate ${artifact.gate || "unknown"} supporting artifact ${supporting.kind || "unknown"} changed during packet validation: ${error.message}`);
      }
    }
  }
  const portableProof = (document.gateArtifacts || []).find(({ gate }) => gate === "portable-proof");
  if (portableProof?.path) {
    try {
      const proof = readJson(resolveArtifactPath(repoRoot, portableProof.path, { mustExist: true }));
      const currentApplication = applicationSourceState(repoRoot, document.commit);
      if (proof.source?.targetPath !== document.validationRuntime?.source?.targetPath || currentApplication.targetPath !== document.validationRuntime?.source?.targetPath) problems.push("portable-proof target path does not match the packet validation runtime target");
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
  if (typeof document.generatedAt !== "string" || !CANONICAL_ISO_TIMESTAMP.test(document.generatedAt) || Number.isNaN(Date.parse(document.generatedAt)) || new Date(document.generatedAt).toISOString() !== document.generatedAt) problems.push("run packet generatedAt must be a canonical ISO timestamp");
  if (!safeIdentifier(document.runId)) problems.push("run packet runId is invalid");
  if (!safeIdentifier(document.commit)) problems.push("run packet commit is invalid");
  if (!safeIdentifier(document.environment)) problems.push("run packet environment is invalid");
  if (!SHA256.test(document.roleProvenanceSha256 || "")) problems.push("run packet roleProvenanceSha256 must bind the signed four-role provenance roster");
  if (!Array.isArray(document.requiredGates) || document.requiredGates.some((gate) => !safeIdentifier(gate))) problems.push("run packet requiredGates must be safe identifiers");
  if (!Array.isArray(document.gateArtifacts)) problems.push("run packet gateArtifacts must be an array");
  problems.push(...artifactInventoryProblems(document.artifactInventory, repoRoot));
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
    try {
      expectedGates = routeRequiredGates(loadedInputs.route, loadedInputs.intake, loadedInputs.classification, {
        rcaPresent: canonicalRcaArtifactPresent(repoRoot),
      });
    }
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
    if (safeIdentifier(artifact?.gate)) problems.push(...supportingArtifactProblems(artifact.gate, artifact, repoRoot));
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
          if (gateDocument.source?.targetPath !== document.validationRuntime?.source?.targetPath || currentApplication.targetPath !== document.validationRuntime?.source?.targetPath) problems.push("portable-proof target path does not match the packet validation runtime target");
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
  if (reviewDocument) {
    try {
      if (document.roleProvenanceSha256 !== reviewRoleProvenanceSha256(reviewDocument)) problems.push("run packet role provenance digest does not match the signed independent review");
    } catch (error) {
      problems.push(`run packet role provenance cannot be bound: ${error.message}`);
    }
  }

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
