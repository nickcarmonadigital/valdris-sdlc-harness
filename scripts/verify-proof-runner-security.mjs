#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, isSecretLikeName, redactText, secretDisclosureProblems } from "./proof-runner.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROOF_RUNNER = path.join(SCRIPT_DIR, "proof-runner.mjs");

function run(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    shell: false,
    windowsHide: true,
  });
}

function git(root, ...args) {
  const result = run("git", ["-C", root, ...args], { cwd: root });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function runProof(root, args, options = {}) {
  return run(process.execPath, [PROOF_RUNNER, "--repo", root, ...args], { cwd: root, env: options.env });
}

function windowsShortPath(target) {
  if (process.platform !== "win32") return null;
  const parent = path.dirname(target);
  const name = path.basename(target);
  const result = run(process.env.ComSpec || "cmd.exe", [
    "/d",
    "/c",
    `for %I in (${name}) do @echo %~sI`,
  ], { cwd: parent });
  assert.equal(result.status, 0, `could not resolve Windows 8.3 path:\n${result.stdout}\n${result.stderr}`);
  const shortPath = result.stdout.trim();
  if (!shortPath) return null;
  return path.isAbsolute(shortPath) ? shortPath : path.join(parent, shortPath);
}

function expectRejected(result, message) {
  assert.notEqual(result.status, 0, "adversarial proof request was unexpectedly accepted");
  assert.match(`${result.stdout}\n${result.stderr}`, message);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const root = mkdtempSync(path.join(os.tmpdir(), "valdris-proof-security-"));
try {
  writeFileSync(path.join(root, "README.md"), "# Proof runner security fixture\n", "utf8");
  writeFileSync(path.join(root, "carrier.txt"), "carrier\n", "utf8");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "proof-runner-security-fixture", version: "1.0.0", private: true }, null, 2), "utf8");
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "proof-runner@example.com");
  git(root, "config", "user.name", "Proof Runner Verifier");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  const head = git(root, "rev-parse", "HEAD");

  const causalProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/causal-inputs.json",
    "--causal-input", "carrier.txt",
    "--causal-input", "README.md",
    "--", process.execPath, "-e", "process.exit(0)",
  ]);
  assert.equal(causalProof.status, 0, `${causalProof.stdout}\n${causalProof.stderr}`);
  const causalDocument = readJson(path.join(root, "proof", "causal-inputs.json"));
  assert.deepEqual(causalDocument.causalInputs.map(({ path: inputPath }) => inputPath), ["README.md", "carrier.txt"]);
  assert.equal(causalDocument.causalInputs[0].beforeSha256, createHash("sha256").update(readFileSync(path.join(root, "README.md"))).digest("hex"));
  assert.equal(causalDocument.causalInputs[0].afterSha256, causalDocument.causalInputs[0].beforeSha256);
  assert.equal(causalDocument.bindings.causalInputsSha256, createHash("sha256").update(canonicalJson(causalDocument.causalInputs)).digest("hex"));

  const absoluteCausalInput = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/absolute-causal-input.json", "--causal-input", path.join(root, "README.md"),
    "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(absoluteCausalInput, /causal input path must be repository-relative/);

  const nonCanonicalCausalInput = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/noncanonical-causal-input.json", "--causal-input", "./README.md",
    "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(nonCanonicalCausalInput, /causal input path must use canonical repository-relative POSIX form/);

  const duplicateCausalInput = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/duplicate-causal-input.json", "--causal-input", "README.md", "--causal-input", "README.md",
    "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(duplicateCausalInput, /causal input path was supplied more than once/);

  let symlinkCase = "causal input symlink skipped by host";
  const causalLink = path.join(root, "causal-link.md");
  try {
    symlinkSync("README.md", causalLink, "file");
    git(root, "add", "causal-link.md");
    const symlinkCausalInput = runProof(root, [
      "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
      "--output", "proof/symlink-causal-input.json", "--causal-input", "causal-link.md",
      "--", process.execPath, "-e", "process.exit(0)",
    ]);
    expectRejected(symlinkCausalInput, /causal input path must not traverse a symbolic link/);
    symlinkCase = "causal input symlink rejection";
  } catch (error) {
    if (existsSync(causalLink)) throw error;
  } finally {
    run("git", ["-C", root, "reset", "--quiet", "HEAD", "--", "causal-link.md"], { cwd: root });
    rmSync(causalLink, { force: true });
  }

  const shortRoot = windowsShortPath(root);
  if (shortRoot && path.resolve(shortRoot).toLowerCase() !== path.resolve(root).toLowerCase()) {
    const shortRootProof = runProof(shortRoot, [
      "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
      "--output", "proof/windows-short-root.json", "--", process.execPath, "-e", "process.exit(0)",
    ]);
    assert.equal(
      shortRootProof.status,
      0,
      `Windows 8.3 root ${JSON.stringify(shortRoot)} (exists=${existsSync(shortRoot)}) failed:\n${shortRootProof.stdout || ""}\n${shortRootProof.stderr || ""}\n${shortRootProof.error?.stack || shortRootProof.error || ""}`,
    );
  }

  mkdirSync(path.join(root, "nested"), { recursive: true });
  const nestedRoot = runProof(path.join(root, "nested"), [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/nested-root.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  assert.equal(nestedRoot.status, 0, `nested target proof failed:\n${nestedRoot.stdout || ""}\n${nestedRoot.stderr || ""}`);
  const nestedProof = readJson(path.join(root, "nested", "proof", "nested-root.json"));
  assert.equal(nestedProof.outcome.status, "passed");
  assert.equal(nestedProof.source.targetPath, "nested");

  const fakeCommit = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", "0".repeat(40), "--environment", "test",
    "--output", "proof/fake.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(fakeCommit, /--commit must exactly match Git HEAD/);
  assert.equal(existsSync(path.join(root, "proof", "fake.json")), false);

  const ads = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "carrier.txt:proof.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(ads, /alternate data streams|drive-relative/);
  assert.equal(existsSync(path.join(root, "carrier.txt:proof.json")), false);

  const deviceNamespace = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", String.raw`\\?\C:\proof.json`, "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(deviceNamespace, /device namespace/);

  const reserved = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/NUL.json", "--", process.execPath, "-e", "process.exit(0)",
  ]);
  expectRejected(reserved, /reserved Windows device name/);

  const localHome = process.env.USERPROFILE || process.env.HOME;
  assert.ok(localHome, "security verifier requires USERPROFILE or HOME");
  const pathProofPath = path.join(root, "proof", "path-redaction.json");
  const pathProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/path-redaction.json", "--", process.execPath, "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1])", localHome,
  ]);
  assert.equal(pathProof.status, 0, `${pathProof.stdout}\n${pathProof.stderr}`);
  const pathDocument = readJson(pathProofPath);
  const pathSerialized = JSON.stringify(pathDocument);
  assert.equal(pathSerialized.includes(localHome), false, "proof persisted a raw local home path");
  assert.ok(pathSerialized.includes("[REDACTED]"), "proof omitted the local-path redaction marker");
  assert.equal(pathDocument.source.gitHead, head);
  assert.equal(pathDocument.source.stable, true);
  assert.match(pathDocument.source.validatorSha256, /^[a-f0-9]{64}$/);
  assert.equal(pathDocument.source.validatorSha256, createHash("sha256").update(readFileSync(PROOF_RUNNER)).digest("hex"));

  const ambientSecretName = ["SYNTHETIC", "API", "KEY"].join("_");
  const ambientSecret = ["Ambient", "Argv", "Secret", "13579"].join("");
  const ambientProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/ambient-secret.json", "--", process.execPath, "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write(process.argv[1])", ambientSecret,
  ], { env: { ...process.env, [ambientSecretName]: ambientSecret } });
  assert.equal(ambientProof.status, 0, `${ambientProof.stdout}\n${ambientProof.stderr}`);
  assert.equal(JSON.stringify(readJson(path.join(root, "proof", "ambient-secret.json"))).includes(ambientSecret), false, "proof persisted an uppercase ambient secret from argv");
  assert.equal(`${ambientProof.stdout}\n${ambientProof.stderr}`.includes(ambientSecret), false, "proof runner echoed an uppercase ambient secret from argv");

  const splitArgvSecret = ["Ordinary", "Split", "Credential", "1731"].join("");
  const splitArgvProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/split-argv-secret.json", "--", process.execPath, "-e",
    "process.stdout.write(process.argv[2])", "--", "--api-key", splitArgvSecret,
  ]);
  assert.equal(splitArgvProof.status, 0, `${splitArgvProof.stdout}\n${splitArgvProof.stderr}`);
  const splitArgvDocument = readJson(path.join(root, "proof", "split-argv-secret.json"));
  const splitArgvSerialized = JSON.stringify(splitArgvDocument);
  assert.equal(splitArgvSerialized.includes(splitArgvSecret), false, "proof persisted a raw split-form secret flag value");
  assert.equal(`${splitArgvProof.stdout}\n${splitArgvProof.stderr}`.includes(splitArgvSecret), false, "proof runner echoed a raw split-form secret flag value");
  assert.deepEqual(splitArgvDocument.command.requestedArgv.slice(-2), ["--api-key", "[REDACTED]"], "proof did not preserve the split secret flag while redacting its value");
  assert.equal(splitArgvDocument.execution.attempts[0].stdout.text, "[REDACTED]", "proof output did not reuse the argv-derived secret redaction set");

  const equalsArgvSecret = ["Ordinary", "Equals", "Credential", "1933"].join("");
  const equalsArgvProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/equals-argv-secret.json", "--", process.execPath, "-e",
    "const arg = process.argv[1]; process.stdout.write(arg.slice(arg.indexOf('=') + 1))", "--", `--provider-access-token=${equalsArgvSecret}`,
  ]);
  assert.equal(equalsArgvProof.status, 0, `${equalsArgvProof.stdout}\n${equalsArgvProof.stderr}`);
  const equalsArgvDocument = readJson(path.join(root, "proof", "equals-argv-secret.json"));
  const equalsArgvSerialized = JSON.stringify(equalsArgvDocument);
  assert.equal(equalsArgvSerialized.includes(equalsArgvSecret), false, "proof persisted a raw equals-form secret flag value");
  assert.equal(`${equalsArgvProof.stdout}\n${equalsArgvProof.stderr}`.includes(equalsArgvSecret), false, "proof runner echoed a raw equals-form secret flag value");
  assert.equal(equalsArgvDocument.command.requestedArgv.at(-1), "--provider-access-token=[REDACTED]", "proof did not preserve the equals-form secret flag while redacting its value");
  assert.equal(equalsArgvDocument.execution.attempts[0].stdout.text, "[REDACTED]", "proof output did not reuse the equals-form argv-derived secret redaction set");

  const rawStructuredArgv = [process.execPath, "--password", splitArgvSecret];
  assert.ok(secretDisclosureProblems({ command: { argv: rawStructuredArgv } }).length > 0, "structured argv disclosure scan accepted a raw adjacent secret value");
  assert.ok(secretDisclosureProblems({ command: { requestedArgv: [process.execPath, `--token=${equalsArgvSecret}`] } }).length > 0, "structured argv disclosure scan accepted a raw equals-form secret value");
  assert.deepEqual(secretDisclosureProblems({
    command: {
      argv: [process.execPath, "--password", "[REDACTED]"],
      requestedArgv: [process.execPath, "--token=[REDACTED]"],
    },
  }), [], "structured argv disclosure scan rejected canonical redaction markers");

  const malformedSecretArgvCases = [
    { output: "proof/missing-secret-flag-value.json", argv: ["--secret"], message: /secret-bearing command flag --secret requires a value/ },
    { output: "proof/ambiguous-secret-flag-value.json", argv: ["--password", "--other"], message: /ambiguous flag-like split value/ },
    { output: "proof/empty-secret-flag-value.json", argv: ["--token="], message: /requires a non-empty value/ },
  ];
  for (const { output, argv, message } of malformedSecretArgvCases) {
    const malformed = runProof(root, [
      "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
      "--output", output, "--", process.execPath, "-e", "process.exit(0)", "--", ...argv,
    ]);
    expectRejected(malformed, message);
    assert.equal(existsSync(path.join(root, output)), false, `malformed secret argv persisted ${output}`);
  }

  const misplacedApiKey = ["Misplaced", "Api", "Key", "Value", "314159"].join("");
  const misplacedSecretFlag = run(process.execPath, [PROOF_RUNNER, `--api-key=${misplacedApiKey}`], { cwd: root });
  const misplacedSecretOutput = `${misplacedSecretFlag.stdout || ""}\n${misplacedSecretFlag.stderr || ""}`;
  assert.notEqual(misplacedSecretFlag.status, 0, "proof runner accepted a command secret flag before the argv separator");
  assert.equal(misplacedSecretOutput.includes(misplacedApiKey), false, "proof runner diagnostic echoed a misplaced equals-form API key");
  assert.match(misplacedSecretOutput, /unknown argument: --api-key/, "proof runner diagnostic omitted the misplaced flag name");

  const consumedApiKey = ["Consumed", "Api", "Key", "Value", "271828"].join("");
  const consumedSecretFlag = run(process.execPath, [PROOF_RUNNER, "--repo", `--api-key=${consumedApiKey}`], { cwd: root });
  const consumedSecretOutput = `${consumedSecretFlag.stdout || ""}\n${consumedSecretFlag.stderr || ""}`;
  assert.notEqual(consumedSecretFlag.status, 0, "proof runner consumed a secret flag as a known-option value");
  assert.equal(consumedSecretOutput.includes(consumedApiKey), false, "known-option diagnostic echoed a consumed equals-form API key");
  assert.match(consumedSecretOutput, /--repo requires a non-empty, non-flag value/, "proof runner did not fail at the malformed known option");

  const quotedSecret = ["Quoted", "Json", "Value", "123"].join("");
  const yamlSecret = ["Yaml", "Value", "456"].join("");
  const escapedSecret = ["Escaped", "Json", "Value", "789"].join("");
  const accessSecret = ["Access", "Token", "Value", "1011"].join("");
  const contaminatedSecret = ["Marker", "Suffix", "Value", "1213"].join("");
  const secretOutputScript = [
    "const quoted = ['Quoted', 'Json', 'Value', '123'].join('');",
    "const yaml = ['Yaml', 'Value', '456'].join('');",
    "const escaped = ['Escaped', 'Json', 'Value', '789'].join('');",
    "const access = ['Access', 'Token', 'Value', '1011'].join('');",
    "const contaminated = ['Marker', 'Suffix', 'Value', '1213'].join('');",
    "process.stdout.write(JSON.stringify({ token: quoted }) + '\\n');",
    "process.stdout.write(`password: \"${yaml}\"\\n`);",
    "process.stdout.write(`access_token=${access}\\n`);",
    "process.stdout.write(`refresh_token=\"[REDACTED] ${contaminated}\"\\n`);",
    'process.stderr.write(String.raw`{\\"api_key\\":\\"${escaped}\\"}`);',
  ].join("");
  const secretProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/secret-redaction.json", "--", process.execPath, "-e", secretOutputScript,
  ]);
  assert.equal(secretProof.status, 0, `${secretProof.stdout}\n${secretProof.stderr}`);
  const secretDocument = readJson(path.join(root, "proof", "secret-redaction.json"));
  const secretSerialized = JSON.stringify(secretDocument);
  for (const secret of [quotedSecret, yamlSecret, escapedSecret, accessSecret, contaminatedSecret]) {
    assert.equal(secretSerialized.includes(secret), false, "proof persisted secret-like command output");
    assert.equal(`${secretProof.stdout}\n${secretProof.stderr}`.includes(secret), false, "proof runner echoed secret-like command output");
  }
  assert.ok(secretDocument.execution.attempts[0].stdout.text.includes("[REDACTED]"));
  assert.ok(secretDocument.execution.attempts[0].stderr.text.includes("[REDACTED]"));

  const tokenKey = ["to", "ken"].join("");
  const unsafeNestedStrings = {
    nested: {
      [tokenKey]: quotedSecret,
      output: [
        JSON.stringify({ [tokenKey]: quotedSecret }),
        `password: "${yamlSecret}"`,
        String.raw`{\"api_key\":\"${escapedSecret}\"}`,
      ],
    },
  };
  assert.ok(secretDisclosureProblems(unsafeNestedStrings).length > 0, "recursive raw-string scan accepted nested secret output");
  assert.deepEqual(secretDisclosureProblems({
    nested: {
      [tokenKey]: "[REDACTED]",
      output: ['{"token":"[REDACTED]"}', "password: [REDACTED]"],
    },
  }), []);

  const benignTokenMetrics = {
    tokenCount: 1200,
    tokenCounts: { input: 800, output: 400 },
    tokenBudget: 5000,
    tokenBudgets: { requested: 5000, remaining: 3800 },
    promptTokenCount: 800,
    completionTokenBudget: 1000,
    inputTokens: 800,
    outputTokens: 400,
    totalTokens: 1200,
    tokens: 1200,
  };
  assert.deepEqual(secretDisclosureProblems({ metrics: benignTokenMetrics }), [], "GenAI token metrics were classified as secret-bearing");
  for (const key of ["tokenCount", "tokenCounts", "token_count", "token-counts", "tokenBudget", "tokenBudgets", "token_budget", "token-budgets", "promptTokenCount", "completionTokenBudget"]) {
    assert.equal(isSecretLikeName(key), false, `benign token metric was classified as secret-bearing: ${key}`);
  }
  for (const key of ["token", "access_token", "accessToken", "accessTokens", "refreshTokens", "auth_token", "authToken", "bearerToken", "bearerTokens", "apiTokens", "oauthTokens", "csrfTokens", "idTokens", "identityTokens", "verificationTokens", "resetTokens", "deviceTokens", "inputTokens", "outputTokens", "totalTokens", "tokens"]) {
    assert.equal(isSecretLikeName(key), true, `real token name was not classified as secret-bearing: ${key}`);
    assert.ok(secretDisclosureProblems({ [key]: quotedSecret }).length > 0, `real token value was accepted under ${key}`);
  }
  for (const unsafeMetric of [
    { tokenBudget: quotedSecret },
    { tokenCounts: { input: quotedSecret } },
    { inputTokens: [quotedSecret] },
    { tokens: { opaque: quotedSecret } },
  ]) {
    assert.ok(secretDisclosureProblems(unsafeMetric).length > 0, "non-numeric content was accepted under a benign token-metric name");
  }

  const rawAliasSecret = ["Raw", "Alias", "Secret", "1415"].join("");
  const rawAssignmentAliases = [
    "OPENAI_API_KEY", "STRIPE_CLIENT_SECRET", "CUSTOM_ACCESS_TOKEN", "REFRESH_TOKEN",
    "DATABASE_URL", "DB_URL", "PRIMARY_CONNECTION_STRING", "AUTHORIZATION", "PASSWORD", "CREDENTIALS",
    "apiKey", "accessToken", "clientSecret", "databaseUrl", "connectionString",
  ];
  for (const alias of rawAssignmentAliases) {
    for (const raw of [
      `${alias}=${rawAliasSecret}`,
      JSON.stringify({ [alias]: rawAliasSecret }),
      String.raw`{\"${alias}\":\"${rawAliasSecret}\"}`,
    ]) {
      assert.equal(redactText(raw).includes(rawAliasSecret), false, `raw assignment redaction missed ${alias}`);
      assert.ok(secretDisclosureProblems({ output: raw }).length > 0, `raw assignment disclosure scan missed ${alias}`);
    }
    assert.deepEqual(secretDisclosureProblems({ output: `${alias}=[REDACTED]` }), [], `raw assignment scan rejected an exact marker for ${alias}`);
  }

  for (const contaminated of [
    `token: [REDACTED] ${rawAliasSecret}`,
    JSON.stringify({ [tokenKey]: `[REDACTED] ${rawAliasSecret}` }),
    String.raw`{\"api_key\":\"[REDACTED] ${rawAliasSecret}\"}`,
  ]) {
    assert.equal(redactText(contaminated).includes(rawAliasSecret), false, "raw assignment redaction trusted a contaminated marker");
    assert.ok(secretDisclosureProblems({ output: contaminated }).length > 0, "raw assignment disclosure scan trusted a contaminated marker");
  }

  const structuredSecret = ["Structured", "Secret", "Value", "2468"].join("");
  const structuredSecretAliases = [
    "database-url", "database_url", "databaseUrl",
    "db-url", "db_url", "dbUrl",
    "api-key", "api_key", "apiKey",
    "private-key", "private_key", "privateKey",
    "connection-string", "connection_string", "connectionString",
    "access-token", "access_token", "accessToken",
    "refresh-token", "refresh_token", "refreshToken",
    "password", "client-password", "client_password", "clientPassword",
    "credential", "credentials", "service-credential", "service_credential", "serviceCredential",
  ];
  for (const alias of structuredSecretAliases) {
    const problems = secretDisclosureProblems({ nested: [{ payload: { [alias]: structuredSecret } }] });
    assert.ok(problems.length > 0, `recursive structured-secret scan accepted alias ${alias}`);
    assert.equal(JSON.stringify(problems).includes(structuredSecret), false, `structured-secret finding echoed raw value for ${alias}`);
    const contaminatedMarkerProblems = secretDisclosureProblems({ nested: [{ payload: { [alias]: `[REDACTED] ${structuredSecret}` } }] });
    assert.ok(contaminatedMarkerProblems.length > 0, `structured-secret scan accepted raw value after marker for ${alias}`);
    assert.equal(JSON.stringify(contaminatedMarkerProblems).includes(structuredSecret), false, `contaminated-marker finding echoed raw value for ${alias}`);
    for (const safeValue of ["[REDACTED]", "[REDACTED TOKEN]", "<redacted>", "[placeholder]", "<placeholder>"]) {
      assert.deepEqual(
        secretDisclosureProblems({ nested: [{ payload: { [alias]: safeValue } }] }),
        [],
        `recursive structured-secret scan rejected safe marker for ${alias}`,
      );
    }
  }

  const structuredContainerSecret = ["Structured", "Container", "Secret", "1617"].join("");
  const structuredContainerCases = [
    { key: ["api", "Key"].join(""), value: 123456789 },
    { key: "credentials", value: [structuredContainerSecret] },
    { key: ["private", "Key"].join(""), value: { value: structuredContainerSecret } },
    { key: ["access", "Token"].join(""), value: null },
    { key: "password", value: true },
  ];
  for (const { key, value } of structuredContainerCases) {
    const problems = secretDisclosureProblems({ nested: { [key]: value } });
    assert.ok(problems.length > 0, `structured-secret scan accepted non-string/container value for ${key}`);
    assert.equal(JSON.stringify(problems).includes(structuredContainerSecret), false, `structured-secret finding echoed a nested raw value for ${key}`);
  }

  mkdirSync(path.join(root, "proof"), { recursive: true });
  const npmProofPath = path.join(root, "proof", "npm.json");
  const npmProof = runProof(root, [
    "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
    "--output", "proof/npm.json", "--", "npm", "--version",
  ]);
  assert.equal(npmProof.status, 0, `${npmProof.stdout}\n${npmProof.stderr}`);
  const npmDocument = readJson(npmProofPath);
  assert.equal(npmDocument.outcome.status, "passed");
  assert.equal(npmDocument.execution.shell, false);
  assert.equal(npmDocument.command.resolution, process.platform === "win32" ? "windows-npm-cli" : "direct");
  if (process.platform === "win32") {
    assert.equal(path.basename(npmDocument.command.argv[0]).toLowerCase(), "node.exe");
    const npmCmdProof = runProof(root, [
      "--run-id", "EXAMPLE-RUN", "--commit", head, "--environment", "test",
      "--output", "proof/npm-cmd.json", "--", "npm.cmd", "--version",
    ]);
    assert.equal(npmCmdProof.status, 0, `${npmCmdProof.stdout}\n${npmCmdProof.stderr}`);
    assert.equal(readJson(path.join(root, "proof", "npm-cmd.json")).command.resolution, "windows-npm-cli");
  }

  console.log(JSON.stringify({
    ok: true,
    suite: "proof-runner-security",
    cases: ["Git-native worktree target including nested target", "repeatable digest-bound causal inputs", "absolute causal-input rejection", "noncanonical causal-input rejection", "duplicate causal-input rejection", symlinkCase, "fake Git revision", "NTFS ADS", "Windows device namespace", "reserved Windows device", "local path redaction", "uppercase ambient secret redaction", "split-form argv secret redaction", "equals-form argv secret redaction", "structured argv disclosure rejection", "malformed secret argv rejection", "misplaced secret flag diagnostic redaction", "quoted and escaped secret redaction", "raw secret-key aliases", "contaminated marker rejection", "recursive raw-string secret scan", "benign GenAI token metrics", "real token-name rejection", "structured secret-key aliases", "structured secret container rejection", "npm shell-free resolution"],
    platform: process.platform,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
