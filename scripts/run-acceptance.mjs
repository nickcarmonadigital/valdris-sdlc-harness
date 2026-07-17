#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalRepoRelativePath } from "./proof-runner.mjs";
import { validatePrivacy } from "./privacy-gate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_NAME = "valdris-run-artifacts.json";
const BUNDLE_SCHEMA = "valdris.run-artifact-bundle.v1";
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILE_COUNT = 512;
const MAX_BUNDLE_ENTRIES = 1024;
const MAX_BUNDLE_DEPTH = 16;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const ALLOWED_ARTIFACT_ROOTS = new Set([
  "ai", "approvals", "cloud", "context", "design", "domain", "evals", "foundation", "goal", "graph",
  "handoff", "production", "proof", "qa", "rca", "review", "run", "self_heal", "smoke", "trajectory", "waivers",
]);
const SAFE_CHILD_ENV = new Set([
  "APPDATA", "CI", "ComSpec", "GITHUB_ACTIONS", "HOME", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL",
  "LOCALAPPDATA", "PATH", "PATHEXT", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "SHELL", "SystemDrive", "SystemRoot", "TEMP", "TERM", "TMP", "TMPDIR", "USERPROFILE", "WINDIR",
].map((name) => name.toLowerCase()));

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    bundle: process.env.VALDRIS_ARTIFACT_BUNDLE,
    sourceCommit: process.env.VALDRIS_SOURCE_COMMIT,
  };
  const valueFor = (index, option) => {
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("-")) throw new Error(`${option} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = valueFor(index++, "--repo");
    else if (arg === "--bundle") args.bundle = valueFor(index++, "--bundle");
    else if (arg === "--source-commit") args.sourceCommit = valueFor(index++, "--source-commit");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (typeof arg === "string" && arg.startsWith("-")) throw new Error("unknown option");
    else throw new Error("unexpected positional argument");
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} must contain exactly: ${wanted.join(", ")}`);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function git(repo, args, options = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: options.encoding || "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (options.allowFailure) return result;
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown Git error").trim()}`);
  return result.stdout;
}

function portableCollisionKey(relativePath) {
  return relativePath.normalize("NFC").toLowerCase();
}

function assertAllowedArtifactPath(relativePath) {
  assertCanonicalRepoRelativePath(relativePath, "artifact bundle path");
  if (Buffer.byteLength(relativePath, "utf8") > 512 || relativePath.split("/").some((component) => Buffer.byteLength(component, "utf8") > 160)) {
    throw new Error(`artifact bundle path is too long for portable hydration: ${relativePath}`);
  }
  const [root] = relativePath.split("/");
  if (!ALLOWED_ARTIFACT_ROOTS.has(root)) throw new Error(`artifact bundle path is outside the evidence namespaces: ${relativePath}`);
}

function walkBundle(root) {
  const files = [];
  const pending = [{ directory: root, depth: 0 }];
  let entriesSeen = 0;
  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    const entries = readdirSync(directory, { withFileTypes: true });
    entriesSeen += entries.length;
    if (entriesSeen > MAX_BUNDLE_ENTRIES) throw new Error(`artifact bundle exceeds the ${MAX_BUNDLE_ENTRIES}-entry traversal limit`);
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stats = lstatSync(target);
      const relativePath = path.relative(root, target).split(path.sep).join("/");
      if (stats.isSymbolicLink()) throw new Error(`artifact bundle must not contain symbolic links: ${relativePath}`);
      if (stats.isDirectory()) {
        if (depth + 1 > MAX_BUNDLE_DEPTH) throw new Error(`artifact bundle exceeds the ${MAX_BUNDLE_DEPTH}-directory depth limit`);
        pending.push({ directory: target, depth: depth + 1 });
      } else if (stats.isFile()) files.push(relativePath);
      else throw new Error(`artifact bundle must contain only directories and regular files: ${relativePath}`);
    }
  }
  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function readAndValidateManifest(bundleRoot, expectedSourceCommit) {
  const manifestPath = path.join(bundleRoot, MANIFEST_NAME);
  if (!existsSync(manifestPath)) throw new Error(`artifact bundle is missing ${MANIFEST_NAME}`);
  const stats = lstatSync(manifestPath);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${MANIFEST_NAME} must be a regular non-symlink file`);
  if (stats.size > MAX_MANIFEST_BYTES) throw new Error(`${MANIFEST_NAME} exceeds the ${MAX_MANIFEST_BYTES}-byte limit`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch { throw new Error(`${MANIFEST_NAME} must be valid JSON`); }
  exactKeys(manifest, ["schema", "sourceCommit", "files"], "artifact bundle manifest");
  if (manifest.schema !== BUNDLE_SCHEMA) throw new Error(`artifact bundle schema must be ${BUNDLE_SCHEMA}`);
  if (!GIT_OBJECT_ID.test(manifest.sourceCommit || "")) throw new Error("artifact bundle sourceCommit must be a lowercase full Git object ID");
  if (manifest.sourceCommit !== expectedSourceCommit) throw new Error("artifact bundle sourceCommit does not match --source-commit");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("artifact bundle files must be a non-empty array");
  if (manifest.files.length > MAX_FILE_COUNT) throw new Error(`artifact bundle exceeds the ${MAX_FILE_COUNT}-file limit`);

  let previousPath = "";
  let totalBytes = 0;
  const portablePaths = new Map();
  for (const [index, file] of manifest.files.entries()) {
    exactKeys(file, ["path", "sha256", "size"], `artifact bundle file ${index + 1}`);
    assertAllowedArtifactPath(file.path);
    if (file.path <= previousPath) throw new Error("artifact bundle files must be strictly sorted by canonical path");
    previousPath = file.path;
    if (!SHA256.test(file.sha256 || "")) throw new Error(`artifact bundle digest must be lowercase SHA-256: ${file.path}`);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) throw new Error(`artifact bundle file size is invalid or exceeds ${MAX_FILE_BYTES} bytes: ${file.path}`);
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`artifact bundle exceeds the ${MAX_TOTAL_BYTES}-byte aggregate limit`);
    const collisionKey = portableCollisionKey(file.path);
    const prior = portablePaths.get(collisionKey);
    if (prior) throw new Error(`artifact bundle paths collide on a portable filesystem: ${prior} and ${file.path}`);
    portablePaths.set(collisionKey, file.path);
  }
  if (!manifest.files.some((file) => file.path === "run/packet.json")) throw new Error("artifact bundle must contain run/packet.json");

  const inventory = walkBundle(bundleRoot).filter((relativePath) => relativePath !== MANIFEST_NAME);
  const inventoryCollisionKeys = new Set();
  for (const relativePath of inventory) {
    assertAllowedArtifactPath(relativePath);
    const collisionKey = portableCollisionKey(relativePath);
    if (inventoryCollisionKeys.has(collisionKey)) throw new Error(`artifact bundle inventory has a portable path collision: ${relativePath}`);
    inventoryCollisionKeys.add(collisionKey);
  }
  const declared = manifest.files.map((file) => file.path);
  if (JSON.stringify(inventory) !== JSON.stringify(declared)) throw new Error("artifact bundle inventory must exactly match the manifest; undeclared, missing, or misordered files are forbidden");

  for (const file of manifest.files) {
    const source = path.join(bundleRoot, ...file.path.split("/"));
    const sourceStats = lstatSync(source);
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error(`artifact bundle entry must be a regular non-symlink file: ${file.path}`);
    if (sourceStats.size !== file.size) throw new Error(`artifact bundle size does not match the manifest: ${file.path}`);
    if (sha256(readFileSync(source)) !== file.sha256) throw new Error(`artifact bundle digest does not match the manifest: ${file.path}`);
  }
  return manifest;
}

function assertCleanSourceCheckout(repoRoot) {
  for (const args of [["diff", "--quiet", "--", "."], ["diff", "--cached", "--quiet", "--", "."]]) {
    const result = git(repoRoot, args, { allowFailure: true });
    if (result.status !== 0) throw new Error("source checkout contains tracked changes before artifact hydration");
  }
  for (const args of [
    ["ls-files", "--others", "--exclude-standard", "-z", "--", "."],
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", "."],
  ]) {
    const output = git(repoRoot, args);
    if (output.length > 0) throw new Error("source checkout contains pre-existing untracked or ignored files before artifact hydration");
  }
}

function assertSafeDestination(repoRoot, relativePath) {
  const destination = path.join(repoRoot, ...relativePath.split("/"));
  if (!isWithin(repoRoot, destination)) throw new Error(`artifact destination escapes the source checkout: ${relativePath}`);
  if (existsSync(destination)) throw new Error(`artifact hydration refuses to overwrite an existing source or validator path: ${relativePath}`);
  let cursor = repoRoot;
  for (const component of relativePath.split("/").slice(0, -1)) {
    cursor = path.join(cursor, component);
    if (!existsSync(cursor)) continue;
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`artifact hydration parent must be a real directory: ${relativePath}`);
  }
  return destination;
}

function ensureSafeParent(repoRoot, relativePath, createdDirectories) {
  let cursor = repoRoot;
  for (const component of relativePath.split("/").slice(0, -1)) {
    cursor = path.join(cursor, component);
    if (!existsSync(cursor)) {
      mkdirSync(cursor);
      createdDirectories.push(cursor);
    }
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`artifact hydration parent must remain a real directory: ${relativePath}`);
  }
}

function hydrateArtifacts(repoRoot, bundleRoot, files) {
  const destinations = new Map(files.map((file) => [file.path, assertSafeDestination(repoRoot, file.path)]));
  const createdFiles = [];
  const createdDirectories = [];
  try {
    for (const file of files) {
      ensureSafeParent(repoRoot, file.path, createdDirectories);
      const source = path.join(bundleRoot, ...file.path.split("/"));
      const destination = destinations.get(file.path);
      copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
      createdFiles.push(destination);
      const stats = lstatSync(destination);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== file.size || sha256(readFileSync(destination)) !== file.sha256) {
        throw new Error(`hydrated artifact failed its post-copy integrity check: ${file.path}`);
      }
    }
  } catch (error) {
    for (const file of createdFiles.reverse()) rmSync(file, { force: true });
    for (const directory of createdDirectories.reverse()) {
      try { rmdirSync(directory); } catch {}
    }
    throw error;
  }
}

function childEnvironment(trustPin) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (SAFE_CHILD_ENV.has(name.toLowerCase()) && typeof value === "string") env[name] = value;
  env.UASH_REVIEW_TRUST_SHA256 = trustPin;
  return env;
}

function runGate(scriptPath, args, cwd, env, label) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-8000);
    throw new Error(`${label} failed${result.error ? `: ${result.error.message}` : ""}${output ? `:\n${output}` : ""}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/run-acceptance.mjs --repo . [--bundle <extracted-artifact-directory>] [--source-commit <full-git-sha>]\n\nVALDRIS_ARTIFACT_BUNDLE and VALDRIS_SOURCE_COMMIT provide injection-safe defaults for CI. The bundle must contain ${MANIFEST_NAME} using ${BUNDLE_SCHEMA}.`);
    return;
  }
  if (!args.bundle || !args.sourceCommit) throw new Error("--bundle and --source-commit are required");
  if (!GIT_OBJECT_ID.test(args.sourceCommit)) throw new Error("--source-commit must be a lowercase full Git object ID");
  const trustPin = process.env.UASH_REVIEW_TRUST_SHA256 || "";
  if (!SHA256.test(trustPin)) throw new Error("operator-held UASH_REVIEW_TRUST_SHA256 must be a lowercase SHA-256 digest");

  const repoInput = path.resolve(args.repo);
  if (!existsSync(repoInput) || !lstatSync(repoInput).isDirectory()) throw new Error("--repo must identify an existing directory");
  const repoRoot = realpathSync(repoInput);
  const expectedScriptDir = path.join(repoRoot, ".valdris-harness", "scripts");
  if (!existsSync(expectedScriptDir) || realpathSync(expectedScriptDir) !== realpathSync(SCRIPT_DIR)) {
    throw new Error("run acceptance must execute from the source checkout's committed .valdris-harness runtime");
  }
  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim().toLowerCase();
  if (head !== args.sourceCommit) throw new Error("source checkout HEAD does not match --source-commit");
  assertCleanSourceCheckout(repoRoot);

  const bundleInput = path.resolve(args.bundle);
  if (!existsSync(bundleInput) || lstatSync(bundleInput).isSymbolicLink() || !lstatSync(bundleInput).isDirectory()) throw new Error("--bundle must identify a real non-symlink directory");
  const bundleRoot = realpathSync(bundleInput);
  if (isWithin(repoRoot, bundleRoot)) throw new Error("artifact bundle must be outside the source checkout");
  const manifest = readAndValidateManifest(bundleRoot, args.sourceCommit);
  const packetEntry = manifest.files.find((file) => file.path === "run/packet.json");
  let packet;
  try { packet = JSON.parse(readFileSync(path.join(bundleRoot, ...packetEntry.path.split("/")), "utf8")); }
  catch { throw new Error("bundled run/packet.json must be valid JSON"); }
  if (packet.commit !== head) throw new Error("bundled run packet commit does not match the exact source checkout HEAD");

  hydrateArtifacts(repoRoot, bundleRoot, manifest.files);
  const privacy = validatePrivacy(repoRoot, { includes: manifest.files.map((file) => file.path) });
  if (!privacy.ok) throw new Error(`hydrated artifact privacy validation failed: ${privacy.findings.map((finding) => `${finding.category}:${finding.fingerprint}`).join(", ")}`);

  const env = childEnvironment(trustPin);
  const packRoot = path.join(repoRoot, ".valdris-harness");
  const script = (name) => path.join(SCRIPT_DIR, name);
  const gates = [
    ["knowledge vault", "okf-vault-gate.mjs", ["--repo", packRoot]],
    ["skill registry", "skill-registry-gate.mjs", ["--repo", packRoot]],
    ["catalog integrity", "catalog-integrity-gate.mjs", ["--repo", packRoot]],
    ["public provenance", "provenance-gate.mjs", ["--repo", packRoot]],
    ["project neutrality", "neutrality-gate.mjs", ["--repo", packRoot]],
    ["pack privacy", "privacy-gate.mjs", ["--repo", packRoot]],
    ["schema compatibility", "schema-compat-gate.mjs", ["--repo", packRoot]],
    ["enterprise and AI assurance", "enterprise-ai-gate-all.mjs", ["--repo", repoRoot]],
  ];
  if (manifest.files.some((file) => file.path === "rca/rca.json")) gates.push(["RCA", "rca-gate.mjs", ["--repo", repoRoot]]);
  gates.push(
    ["independent review", "review-gate.mjs", ["--repo", repoRoot]],
    ["final run packet", "run-packet-gate.mjs", ["--repo", repoRoot]],
  );
  for (const [label, fileName, gateArgs] of gates) runGate(script(fileName), gateArgs, repoRoot, env, label);

  console.log(JSON.stringify({
    ok: true,
    schema: "valdris.run-acceptance-result.v1",
    sourceCommit: head,
    packetRunId: packet.runId,
    hydratedFiles: manifest.files.length,
    trustPinSha256: sha256(trustPin),
    pathEnvironmentKeys: Object.keys(env).filter((name) => name.toLowerCase() === "path"),
    gates: gates.map(([label]) => label),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Valdris run acceptance failed: ${error.message}`);
    process.exitCode = 1;
  });
}
