#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPO_ROOT_MARKER, sanitizeCodeIntelligenceEvidence } from "./code-intelligence-scan.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function writeBytes(root, relativePath, bytes) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function runGate(script, repo, extraArgs = []) {
  const result = spawnSync(process.execPath, [path.join(REPO, "scripts", script), "--repo", repo, ...extraArgs], {
    cwd: REPO,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${script} did not emit one JSON document (exit ${result.status}): ${text}`);
  }
  return { ...result, payload, text };
}

function withRestrictedValues(config, fn) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "valdris-restricted-values-"));
  const file = path.join(directory, "restricted-values.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  try {
    return fn(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function cloneManifest(root) {
  const source = path.join(REPO, "controls", "provenance", "thirteen-layers.upstream.v1.json");
  write(root, "controls/provenance/thirteen-layers.upstream.v1.json", readFileSync(source, "utf8"));
}

function expectPass(result, gate) {
  assert.equal(result.status, 0, result.text);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.gate, gate);
  assert.deepEqual(result.payload.findings, []);
}

function expectRedactedFailure(result, gate, forbidden = []) {
  assert.equal(result.status, 1, result.text);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.gate, gate);
  assert.ok(result.payload.findings.length > 0);
  for (const finding of result.payload.findings) {
    assert.match(finding.redacted, /^\[REDACTED:[A-Z0-9_-]+\]$/);
    assert.match(finding.fingerprint, /^[a-f0-9]{12}$/);
    assert.equal(typeof finding.path, "string");
    assert.equal(Number.isInteger(finding.line), true);
  }
  for (const value of forbidden) assert.equal(result.text.toLowerCase().includes(value.toLowerCase()), false);
}

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test("pinned MIT provenance manifest passes offline", (root) => {
  cloneManifest(root);
  const result = runGate("provenance-gate.mjs", root);
  expectPass(result, "import-provenance");
  assert.equal(result.payload.source.commit, "77853d410438ce7a2909a94c2db41d258e3d04a0");
  assert.equal(result.payload.source.license, "MIT");
  assert.equal(result.payload.fileCount, 26);
  assert.equal(result.payload.networkRequired, false);
});

test("provenance rejects source drift", (root) => {
  cloneManifest(root);
  const target = path.join(root, "controls/provenance/thirteen-layers.upstream.v1.json");
  const manifest = JSON.parse(readFileSync(target, "utf8"));
  manifest.source.commit = "0000000000000000000000000000000000000000";
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const result = runGate("provenance-gate.mjs", root);
  assert.equal(result.status, 1, result.text);
  assert.equal(result.payload.ok, false);
  assert.ok(result.payload.findings.some((item) => item.code === "SOURCE_COMMIT_MISMATCH"));
});

test("provenance rejects unverifiable file records", (root) => {
  cloneManifest(root);
  const target = path.join(root, "controls/provenance/thirteen-layers.upstream.v1.json");
  const manifest = JSON.parse(readFileSync(target, "utf8"));
  manifest.files["../outside.json"] = "not-a-sha256";
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const result = runGate("provenance-gate.mjs", root);
  assert.equal(result.status, 1, result.text);
  assert.ok(result.payload.findings.some((item) => item.code === "UNSAFE_SOURCE_PATH"));
  assert.ok(result.payload.findings.some((item) => item.code === "INVALID_SHA256"));
});

test("neutral public surfaces pass", (root) => {
  write(root, "README.md", "# Example harness\n\nProviders and branches are commissioned per project.\n");
  write(root, "controls/example.json", '{"issueId":"${issue_id}","provider":"${provider}"}\n');
  write(root, "docs/import/decision.md", "Restricted-source behavior is used only as behavioral input.\n");
  expectPass(runGate("neutrality-gate.mjs", root), "import-neutrality");
});

test("runtime restricted values catch root residue without echoing it", (root) => {
  const organization = "Restricted Example Organization";
  const person = "Restricted Example Person";
  const prefix = "SYNTHX";
  const issue = `${prefix}-4821`;
  write(root, "NOTICE.md", `${organization} approval belongs to ${person}; issue ${issue}.\n`);
  withRestrictedValues({ values: [organization, person], issuePrefixes: [prefix] }, (file) => {
    const result = runGate("neutrality-gate.mjs", root, ["--restricted-values", file]);
    expectRedactedFailure(result, "import-neutrality", [organization, person, issue]);
    assert.ok(result.payload.findings.some((item) => item.category === "restricted-value"));
    assert.ok(result.payload.findings.some((item) => item.category === "restricted-issue-id"));
    assert.ok(result.payload.findings.every((item) => item.path === "NOTICE.md"));
  });
});

test("commissioned mode permits commissioned identity", (root) => {
  const identity = "Commissioned Example Studio";
  const providerKey = [["data", "base"].join(""), "provider"].join("_");
  write(root, "project-adapter.json", `${JSON.stringify({ project: { name: identity }, [providerKey]: "ExampleDB" })}\n`);
  write(root, "README.md", `# ${identity}\n`);
  expectPass(runGate("neutrality-gate.mjs", root, ["--mode", "commissioned"]), "import-neutrality");
});

test("neutrality scans CI paths and rejects generic fixed topology and provider lanes", (root) => {
  const branches = [["sta", "ging"].join(""), ["ma", "in"].join(""), ["prod", "uction"].join("")];
  const topology = `${branches[0]} -> ${branches[1]} -> ${branches[2]}`;
  const providerLane = ["data", "acmedb"].join("-");
  write(root, ".github/workflows/release.yml", `name: release\n# Promote ${topology} through ${providerLane}.\n`);
  const result = runGate("neutrality-gate.mjs", root, ["--mode", "commissioned"]);
  expectRedactedFailure(result, "import-neutrality", [topology, providerLane]);
  assert.ok(result.payload.findings.some((item) => item.category === "fixed-branch-topology"));
  assert.ok(result.payload.findings.some((item) => item.category === "fixed-provider-lane"));
  assert.ok(result.payload.findings.every((item) => item.path === ".github/workflows/release.yml"));
});

test("neutrality checks every provider-lane match on a line", (root) => {
  const genericLane = ["data", "platform"].join("-");
  const providerLane = ["data", ["supa", "base"].join("")].join("-");
  write(root, "docs/lanes.md", `${genericLane} ${providerLane}\n`);
  const result = runGate("neutrality-gate.mjs", root);
  expectRedactedFailure(result, "import-neutrality", [providerLane]);
  assert.ok(result.payload.findings.some((item) => item.category === "fixed-provider-lane" && item.path === "docs/lanes.md"));
});

test("commissioned mode still enforces optional restricted-source values", (root) => {
  const restricted = "Synthetic Restricted Source";
  write(root, "project-adapter.json", '{"project":{"name":"Commissioned Example Studio"}}\n');
  write(root, "docs/source-note.md", `${restricted}\n`);
  withRestrictedValues({ values: [restricted], issuePrefixes: [] }, (file) => {
    const result = runGate("neutrality-gate.mjs", root, ["--mode", "commissioned", "--restricted-values", file]);
    expectRedactedFailure(result, "import-neutrality", [restricted]);
  });
});

test("synthetic privacy fixtures pass", (root) => {
  write(root, "examples/synthetic-run.json", '{"email":"operator@example.com","userId":"EXAMPLE-USER-001","token":"<redacted>"}\n');
  const windowsPlaceholder = ["C:", "Users", "<user>", "proof.json"].join("\\");
  const unixPlaceholder = ["", "Users", "<user>", "proof.json"].join("/");
  write(root, "docs/import/privacy.md", `Use ${windowsPlaceholder} and ${unixPlaceholder} only as placeholders.\n`);
  expectPass(runGate("privacy-gate.mjs", root), "import-privacy");
});

test("generated stable graph does not persist its absolute repository root", (root) => {
  write(root, "src/index.js", "export const value = 1;\n");
  const scan = spawnSync(process.execPath, [path.join(REPO, "scripts", "code-intelligence-local-scan.mjs"), "--repo", root], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(scan.status, 0, `${scan.stdout || ""}${scan.stderr || ""}`);
  const graphText = readFileSync(path.join(root, "graph", "graph.json"), "utf8");
  assert.equal(JSON.parse(graphText).repoRoot, REPO_ROOT_MARKER);

  const evidence = sanitizeCodeIntelligenceEvidence({
    repoRoot: root,
    commands: {
      analyze: {
        command: path.join(root, "tools", "npx"),
        args: ["analyze", root],
        spawnedCommand: path.join(root, "tools", "launcher"),
        stdout: `Indexed ${root.replaceAll("\\", "/")}`,
        stderr: `Diagnostic for ${root}`,
      },
      status: {
        command: path.join(root, "tools", "npx"),
        args: ["status", root.replaceAll("\\", "/")],
        spawnedCommand: path.join(root, "tools", "launcher"),
        stdout: `Repository: ${root}`,
        stderr: `Status diagnostic for ${root.replaceAll("\\", "/")}`,
      },
    },
  }, root);
  assert.equal(evidence.repoRoot, REPO_ROOT_MARKER);
  assert.deepEqual(evidence.commands.analyze.args, ["analyze", REPO_ROOT_MARKER]);
  const rootVariants = [root, root.replaceAll("\\", "/")].map((value) => value.toLowerCase());
  function evidenceStrings(value) {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(evidenceStrings);
    if (value && typeof value === "object") return Object.values(value).flatMap(evidenceStrings);
    return [];
  }
  for (const command of Object.values(evidence.commands)) {
    const strings = evidenceStrings(command).map((value) => value.toLowerCase());
    assert.equal(strings.some((value) => rootVariants.some((variant) => value.includes(variant))), false, "GitNexus command evidence retained the absolute repository root");
    assert.ok(strings.some((value) => value.includes(REPO_ROOT_MARKER)), "GitNexus command evidence lost its repo-relative marker");
  }
  write(root, "graph/gitnexus.json", `${JSON.stringify(evidence, null, 2)}\n`);
  expectPass(runGate("privacy-gate.mjs", root), "import-privacy");

  const graph = JSON.parse(graphText);
  const unrelatedLocalPath = process.platform === "win32"
    ? ["C:", "Users", "unrelated-user", "private.txt"].join("\\")
    : ["", "home", "unrelated-user", "private.txt"].join("/");
  graph.unrelatedLocalPath = unrelatedLocalPath;
  write(root, "graph/graph.json", `${JSON.stringify(graph, null, 2)}\n`);
  const injected = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(injected, "import-privacy", [unrelatedLocalPath]);
  assert.ok(injected.payload.findings.some((item) => item.category === "local-user-path" && item.path === "graph/graph.json"));
});

test("privacy ignores schema types and code identifier references", (root) => {
  write(root, "docs/contract.md", "type Event = { sessionId: string };\n");
  write(root, "scripts/reader.mjs", "const runId = document.runId;\n");
  expectPass(runGate("privacy-gate.mjs", root), "import-privacy");
});

test("privacy scans root files and rejects secrets without echoing material", (root) => {
  const secret = `gh${"p"}_${"a".repeat(36)}`;
  const secretKey = ["access", "Token"].join("");
  write(root, "SECURITY.txt", `${secretKey}=${secret}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [secret]);
  assert.ok(result.payload.findings.some((item) => item.category === "secret" && item.path === "SECURITY.txt"));
});

test("privacy does not let example prose mask a real-looking secret", (root) => {
  const secret = `gh${"p"}_${"b".repeat(36)}`;
  write(root, "examples/unsafe.md", `Example credential for documentation: ${secret}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [secret]);
  assert.ok(result.payload.findings.some((item) => item.category === "secret"));
});

test("privacy scans publishable dist output", (root) => {
  const secret = `gh${"p"}_${"c".repeat(36)}`;
  write(root, "dist/bundle.js", `export const credential = "${secret}";\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [secret]);
  assert.ok(result.payload.findings.some((item) => item.category === "secret" && item.path === "dist/bundle.js"));
});

test("privacy scans tracked files inside ignored deploy directories", (root) => {
  const secret = `sk-${"T".repeat(32)}`;
  write(root, ".next/server/private.js", `export const credential = "${secret}";\n`);
  for (const args of [["init"], ["add", ".next/server/private.js"]]) {
    const git = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, windowsHide: true });
    assert.equal(git.status, 0, `git ${args.join(" ")} failed: ${git.stderr || git.stdout}`);
  }
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [secret]);
  assert.ok(result.payload.findings.some((item) => item.category === "secret" && item.path === ".next/server/private.js"));
});

test("privacy checks a real password after an exact redacted placeholder", (root) => {
  const credentialValue = ["Actual", "Pass", "1234"].join("");
  write(root, "config/runtime.env", `password=<redacted> password=${credentialValue}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [credentialValue]);
  assert.equal(result.payload.findings.filter((item) => item.category === "secret").length, 1);
});

test("privacy checks a real email after an example-domain email", (root) => {
  const safeEmail = ["operator", "example.com"].join("@");
  const realEmail = ["worker", "internal.invalid"].join("@");
  write(root, "docs/contacts.md", `${safeEmail} ${realEmail}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [realEmail]);
  assert.equal(result.payload.findings.filter((item) => item.category === "non-example-email").length, 1);
});

test("privacy does not treat example in an email local-part as safe", (root) => {
  const email = [["example", "worker"].join("-"), "internal.invalid"].join("@");
  write(root, "docs/owner.md", `${email}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [email]);
  assert.ok(result.payload.findings.some((item) => item.category === "non-example-email"));
});

test("privacy scans CI paths and rejects local paths, contact data, and identifiers", (root) => {
  const email = ["worker", "internal.invalid"].join("@");
  const identifier = ["9ce0cabc", "2ea0", "4d22", "9afd", "b8f34bd0b177"].join("-");
  const localPath = ["C:", "Users", "actual-user", "Desktop", "proof.json"].join("\\");
  write(root, ".github/workflows/incident.yml", `# Owner ${email}; userId=${identifier}; artifact=${localPath}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [email, identifier, localPath]);
  assert.ok(result.payload.findings.some((item) => item.category === "local-user-path"));
  assert.ok(result.payload.findings.some((item) => item.category === "non-example-email"));
  assert.ok(result.payload.findings.some((item) => item.category === "non-example-id"));
  assert.ok(result.payload.findings.every((item) => item.path === ".github/workflows/incident.yml"));
});

test("privacy rejects JSON-escaped and slash-form Windows user paths", (root) => {
  const escapedPath = ["C:", "Users", "actual-user", "Desktop", "proof.json"].join("\\\\");
  const slashPath = ["D:", "Users", "actual-user", "proof.json"].join("/");
  write(root, "project-adapter.json", `${JSON.stringify({ escapedPath, slashPath }, null, 2)}\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [escapedPath, slashPath]);
  assert.ok(result.payload.findings.filter((item) => item.category === "local-user-path").length >= 2);
});

test("privacy rejects a local path wrapped in HTML markup", (root) => {
  const localPath = ["C:", "Users", "actual-user", "Desktop", "proof.json"].join("\\");
  write(root, "docs/incident.md", `<code>${localPath}</code>\n`);
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", [localPath]);
  assert.ok(result.payload.findings.some((item) => item.category === "local-user-path"));
});

test("privacy rejects raw run and log evidence by path", (root) => {
  write(root, "runs/active/run-483/proof.json", '{"status":"passed"}\n');
  write(root, "logs/session.log", "raw console output\n");
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", ["raw console output"]);
  assert.ok(result.payload.findings.filter((item) => item.category === "raw-operational-evidence").length >= 2);
});

test("privacy rejects misleading example and template names under runs and logs", (root) => {
  write(root, "runs/example-template-live/proof.json", '{"status":"passed"}\n');
  write(root, "logs/template-example.log", "operational output\n");
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy", ["operational output"]);
  assert.equal(result.payload.findings.filter((item) => item.category === "raw-operational-evidence").length, 2);
});

test("privacy permits only the exact approved run-template fixture path", (root) => {
  write(root, "runs/_run-template/README.md", "# Project-neutral run packet template\n");
  expectPass(runGate("privacy-gate.mjs", root), "import-privacy");
});

test("privacy allows the exact public UI screenshot", (root) => {
  const relativePath = "docs/assets/flow-monitor-screenshot.png";
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(REPO, relativePath), target);
  const result = runGate("privacy-gate.mjs", root);
  expectPass(result, "import-privacy");
  assert.equal(result.payload.binaryFiles, 1);
  assert.equal(result.payload.approvedBinaryFiles, 1);
  assert.equal(result.payload.unapprovedBinaryFiles, 0);
});

test("privacy fails closed on unapproved binary content", (root) => {
  writeBytes(root, "docs/assets/unreviewed.bin", Buffer.from([0, 1, 2, 3, 255]));
  const result = runGate("privacy-gate.mjs", root);
  expectRedactedFailure(result, "import-privacy");
  assert.equal(result.payload.binaryFiles, 1);
  assert.equal(result.payload.approvedBinaryFiles, 0);
  assert.equal(result.payload.unapprovedBinaryFiles, 1);
  assert.ok(result.payload.findings.some((item) => item.category === "unapproved-binary"));
});

let passed = 0;
for (const { name, fn } of cases) {
  const root = mkdtempSync(path.join(os.tmpdir(), "valdris-import-boundaries-"));
  try {
    fn(root);
    passed += 1;
    console.log(`PASS ${name}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, suite: "import-boundaries", passed, total: cases.length }));
