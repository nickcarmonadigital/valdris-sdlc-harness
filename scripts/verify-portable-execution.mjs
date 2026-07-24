#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./proof-runner.mjs";
import { reviewAttestationPayload } from "./review-gate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(script, args, options = {}) {
  return spawnSync(
    process.execPath,
    [path.join(options.scriptDir || SCRIPT_DIR, script), ...args],
    {
      cwd: options.cwd,
      encoding: "utf8",
      env: options.env || process.env,
      shell: false,
    },
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function expectFailure(result, label, expectedText) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert(result.status !== 0, `${label} was unexpectedly accepted`);
  if (expectedText)
    assert(
      output.includes(expectedText),
      `${label} failed for the wrong reason; expected ${JSON.stringify(expectedText)} in:\n${output}`,
    );
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(
    result.status === 0,
    `git ${args.join(" ")} failed:\n${result.stdout || ""}\n${result.stderr || ""}`,
  );
  return result.stdout.trim();
}

function main() {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "valdris-portable-proof-")),
  );
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const reviewRuntimeScripts = path.join(root, ".valdris-harness", "scripts");
    mkdirSync(reviewRuntimeScripts, { recursive: true });
    for (const script of ["review-gate.mjs", "proof-runner.mjs"])
      cpSync(
        path.join(SCRIPT_DIR, script),
        path.join(reviewRuntimeScripts, script),
      );
    writeFileSync(
      path.join(root, ".gitignore"),
      "proof/\nrca/\nreview/\nrun/\ngoal/\nfoundation/\nflaky-state\n",
      "utf8",
    );
    writeFileSync(path.join(root, "fixture-status.txt"), "broken\n", "utf8");
    mkdirSync(path.join(root, "cloud"), { recursive: true });
    writeFileSync(
      path.join(root, "cloud", "service-map.json"),
      '{"status":"before"}\n',
      "utf8",
    );
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(
      path.join(root, "docs", "incident-process.md"),
      "broken\n",
      "utf8",
    );
    const nestedTarget = path.join(root, "packages", "nested-app");
    mkdirSync(nestedTarget, { recursive: true });
    writeFileSync(path.join(nestedTarget, "README.md"), "broken\n", "utf8");
    writeJson(
      path.join(root, ".valdris-harness", "controls", "review-trust.v1.json"),
      {
        schema: "valdris.review-trust.v1",
        keys: [
          {
            keyId: "EXAMPLE-REVIEW-KEY-001",
            algorithm: "ed25519",
            status: "active",
            publicKeyPem: publicKey,
            allowedActorIds: ["EXAMPLE-ACTOR-REVIEWER"],
            allowedActorTypes: ["agent"],
          },
        ],
      },
    );
    const reviewTrustSha256 = digest(
      canonicalJson(
        readJson(
          path.join(
            root,
            ".valdris-harness",
            "controls",
            "review-trust.v1.json",
          ),
        ),
      ),
    );
    process.env.UASH_REVIEW_TRUST_SHA256 = reviewTrustSha256;
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "verification@example.com"]);
    runGit(root, ["config", "user.name", "Valdris Verification"]);
    runGit(root, [
      "add",
      ".gitignore",
      "fixture-status.txt",
      "cloud/service-map.json",
      "docs/incident-process.md",
      "packages/nested-app/README.md",
      ".valdris-harness",
    ]);
    runGit(root, ["commit", "-m", "test: create failing regression fixture"]);
    const PRE_FIX_COMMIT = runGit(root, ["rev-parse", "HEAD"]);
    const REGRESSION_COMMAND = [
      process.execPath,
      "-e",
      "const fs=require('node:fs');const value=fs.readFileSync('fixture-status.txt','utf8').trim();if(value!=='fixed'){process.stderr.write('synthetic-regression-signature');process.exit(7)}process.stdout.write('portable-ok')",
    ];
    const DOCUMENTATION_REGRESSION_COMMAND = [
      process.execPath,
      "-e",
      "const fs=require('node:fs');const value=fs.readFileSync('docs/incident-process.md','utf8').trim();if(value!=='fixed'){process.stderr.write('documentation-process-regression');process.exit(9)}process.stdout.write('documentation-process-ok')",
    ];
    const NESTED_DOCUMENTATION_REGRESSION_COMMAND = [
      process.execPath,
      "-e",
      "const fs=require('node:fs');const value=fs.readFileSync('README.md','utf8').trim();if(value!=='fixed'){process.stderr.write('nested-documentation-regression');process.exit(11)}process.stdout.write('nested-documentation-ok')",
    ];
    const OPAQUE_ENV_REGRESSION_COMMAND = [
      process.execPath,
      "-e",
      "if(!String(process.env.FEATURE_FLAG||'').includes('green')){process.stderr.write('opaque-environment-regression');process.exit(12)}process.stdout.write('opaque-environment-ok')",
    ];
    const ALLOWLISTED_ENV_REGRESSION_COMMAND = [
      process.execPath,
      "-e",
      "if(!String(process.env.CI||'').includes('green')){process.stderr.write('allowlisted-environment-regression');process.exit(14)}process.stdout.write('allowlisted-environment-ok')",
    ];
    const OPAQUE_SECRET_ARGV_REGRESSION_COMMAND = (secret) => [
      process.execPath,
      "-e",
      "const value=process.argv.at(-1);if(!String(value).includes('green')){process.stderr.write('opaque-secret-argv-regression');process.exit(13)}process.stdout.write('opaque-secret-argv-ok')",
      "--",
      "--api-key",
      secret,
    ];

    const redOutput = path.join(root, "proof", "red.json");
    const red = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        redOutput,
        "--repeat",
        "2",
        "--red-baseline",
        "--",
        ...REGRESSION_COMMAND,
      ],
      { cwd: root },
    );
    assert(
      red.status === 0,
      `red baseline was not accepted:\n${red.stdout}\n${red.stderr}`,
    );
    const redArtifact = readJson(redOutput);
    assert(
      redArtifact.outcome?.status === "red-confirmed",
      "red baseline did not persist red-confirmed",
    );

    const documentationRedOutput = path.join(
      root,
      "proof",
      "documentation-red.json",
    );
    const documentationRed = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        documentationRedOutput,
        "--repeat",
        "2",
        "--causal-input",
        "docs/incident-process.md",
        "--red-baseline",
        "--",
        ...DOCUMENTATION_REGRESSION_COMMAND,
      ],
      { cwd: root },
    );
    assert(
      documentationRed.status === 0,
      `documentation-process red baseline was not accepted:\n${documentationRed.stdout}\n${documentationRed.stderr}`,
    );
    const documentationRedArtifact = readJson(documentationRedOutput);
    assert(
      documentationRedArtifact.outcome?.status === "red-confirmed",
      "documentation-process red baseline did not persist red-confirmed",
    );
    assert(
      documentationRedArtifact.causalInputs?.[0]?.path ===
        "docs/incident-process.md",
      "documentation-process red proof did not bind its canonical causal input path",
    );
    assert(
      documentationRedArtifact.causalInputs?.[0]?.beforeSha256 ===
        digest("broken\n"),
      "documentation-process red proof did not bind the exact pre-command causal input bytes",
    );
    assert(
      documentationRedArtifact.causalInputs?.[0]?.afterSha256 ===
        digest("broken\n"),
      "documentation-process red proof did not bind the exact post-command causal input bytes",
    );
    assert(
      documentationRedArtifact.bindings?.causalInputsSha256 ===
        digest(canonicalJson(documentationRedArtifact.causalInputs)),
      "documentation-process red proof did not envelope-bind its causal inputs",
    );

    const documentationCoverRedOutput = path.join(
      root,
      "proof",
      "documentation-cover-red.json",
    );
    const documentationCoverRed = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        documentationCoverRedOutput,
        "--causal-input",
        "fixture-status.txt",
        "--red-baseline",
        "--",
        ...DOCUMENTATION_REGRESSION_COMMAND,
      ],
      { cwd: root },
    );
    assert(
      documentationCoverRed.status === 0,
      `documentation cover-change red proof failed:\n${documentationCoverRed.stdout}\n${documentationCoverRed.stderr}`,
    );
    const documentationCoverRedArtifact = readJson(documentationCoverRedOutput);

    const nestedDocumentationRedOutput = path.join(
      nestedTarget,
      "proof",
      "nested-documentation-red.json",
    );
    const nestedDocumentationRed = run(
      "proof-runner.mjs",
      [
        "--repo",
        nestedTarget,
        "--run-id",
        "EXAMPLE-NESTED-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        "proof/nested-documentation-red.json",
        "--causal-input",
        "README.md",
        "--red-baseline",
        "--",
        ...NESTED_DOCUMENTATION_REGRESSION_COMMAND,
      ],
      { cwd: nestedTarget },
    );
    assert(
      nestedDocumentationRed.status === 0,
      `nested documentation red proof failed:\n${nestedDocumentationRed.stdout}\n${nestedDocumentationRed.stderr}`,
    );
    const nestedDocumentationRedArtifact = readJson(
      nestedDocumentationRedOutput,
    );
    assert(
      nestedDocumentationRedArtifact.source?.targetPath ===
        "packages/nested-app",
      "nested documentation proof did not bind its Git target prefix",
    );
    assert(
      nestedDocumentationRedArtifact.causalInputs?.[0]?.path === "README.md",
      "nested documentation proof did not keep its causal path target-relative",
    );

    const opaqueEnvironmentRedOutput = path.join(
      root,
      "proof",
      "opaque-environment-red.json",
    );
    const opaqueEnvironmentRedValue = "opaque-feature-red-271828";
    const opaqueEnvironmentRed = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        opaqueEnvironmentRedOutput,
        "--pass-env",
        "FEATURE_FLAG",
        "--red-baseline",
        "--",
        ...OPAQUE_ENV_REGRESSION_COMMAND,
      ],
      {
        cwd: root,
        env: { ...process.env, FEATURE_FLAG: opaqueEnvironmentRedValue },
      },
    );
    assert(
      opaqueEnvironmentRed.status === 0,
      `opaque environment red proof failed:\n${opaqueEnvironmentRed.stdout}\n${opaqueEnvironmentRed.stderr}`,
    );
    const opaqueEnvironmentRedArtifact = readJson(opaqueEnvironmentRedOutput);

    const allowlistedEnvironmentRedValue = "allowlisted-environment-red-271828";
    const allowlistedEnvironmentRedOutput = path.join(
      root,
      "proof",
      "allowlisted-environment-red.json",
    );
    const allowlistedEnvironmentRed = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        allowlistedEnvironmentRedOutput,
        "--red-baseline",
        "--",
        ...ALLOWLISTED_ENV_REGRESSION_COMMAND,
      ],
      {
        cwd: root,
        env: { ...process.env, CI: allowlistedEnvironmentRedValue },
      },
    );
    assert(
      allowlistedEnvironmentRed.status === 0,
      `allowlisted environment red proof failed:\n${allowlistedEnvironmentRed.stdout}\n${allowlistedEnvironmentRed.stderr}`,
    );
    const allowlistedEnvironmentRedArtifact = readJson(
      allowlistedEnvironmentRedOutput,
    );

    const opaqueSecretRedValue = "opaque-credential-red-161803";
    const opaqueSecretRedOutput = path.join(
      root,
      "proof",
      "opaque-secret-red.json",
    );
    const opaqueSecretRed = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        PRE_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        opaqueSecretRedOutput,
        "--red-baseline",
        "--",
        ...OPAQUE_SECRET_ARGV_REGRESSION_COMMAND(opaqueSecretRedValue),
      ],
      { cwd: root },
    );
    assert(
      opaqueSecretRed.status === 0,
      `opaque secret argv red proof failed:\n${opaqueSecretRed.stdout}\n${opaqueSecretRed.stderr}`,
    );
    const opaqueSecretRedArtifact = readJson(opaqueSecretRedOutput);

    writeFileSync(path.join(root, "fixture-status.txt"), "fixed\n", "utf8");
    writeFileSync(
      path.join(root, "cloud", "service-map.json"),
      '{"status":"after"}\n',
      "utf8",
    );
    writeFileSync(
      path.join(root, "docs", "incident-process.md"),
      "fixed\n",
      "utf8",
    );
    writeFileSync(path.join(nestedTarget, "README.md"), "fixed\n", "utf8");
    runGit(root, [
      "add",
      "fixture-status.txt",
      "cloud/service-map.json",
      "docs/incident-process.md",
      "packages/nested-app/README.md",
    ]);
    runGit(root, ["commit", "-m", "fix: repair regression fixture"]);
    const POST_FIX_COMMIT = runGit(root, ["rev-parse", "HEAD"]);

    const output = path.join(root, "proof", "portable.json");
    const result = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        output,
        "--repeat",
        "2",
        "--",
        ...REGRESSION_COMMAND,
      ],
      { cwd: root },
    );
    assert(
      result.status === 0,
      `portable proof command failed:\n${result.stdout}\n${result.stderr}`,
    );
    const artifact = readJson(output);
    assert(
      artifact.outcome?.status === "passed",
      "portable proof did not persist a passed outcome",
    );
    assert(
      artifact.execution?.shell === false,
      "portable proof did not record shell:false",
    );
    assert(
      artifact.bindings?.runSha256 === digest("EXAMPLE-RUN-001"),
      "portable proof did not bind the run identifier",
    );
    assert(
      artifact.bindings?.commitSha256 === digest(POST_FIX_COMMIT),
      "portable proof did not bind the commit",
    );
    assert(
      artifact.bindings?.environmentSha256 === digest("synthetic-test"),
      "portable proof did not bind the environment",
    );

    const documentationGreenOutput = path.join(
      root,
      "proof",
      "documentation-green.json",
    );
    const documentationGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        documentationGreenOutput,
        "--repeat",
        "2",
        "--causal-input",
        "docs/incident-process.md",
        "--",
        ...DOCUMENTATION_REGRESSION_COMMAND,
      ],
      { cwd: root },
    );
    assert(
      documentationGreen.status === 0,
      `documentation-process green proof failed:\n${documentationGreen.stdout}\n${documentationGreen.stderr}`,
    );
    const documentationGreenArtifact = readJson(documentationGreenOutput);
    assert(
      documentationGreenArtifact.outcome?.status === "passed",
      "documentation-process green proof did not persist passed",
    );
    assert(
      documentationGreenArtifact.causalInputs?.[0]?.beforeSha256 ===
        digest("fixed\n"),
      "documentation-process green proof did not bind the exact pre-command causal input bytes",
    );
    assert(
      documentationGreenArtifact.causalInputs?.[0]?.afterSha256 ===
        digest("fixed\n"),
      "documentation-process green proof did not bind the exact post-command causal input bytes",
    );
    assert(
      documentationGreenArtifact.bindings?.causalInputsSha256 ===
        digest(canonicalJson(documentationGreenArtifact.causalInputs)),
      "documentation-process green proof did not envelope-bind its causal inputs",
    );

    const documentationCoverGreenOutput = path.join(
      root,
      "proof",
      "documentation-cover-green.json",
    );
    const documentationCoverGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        documentationCoverGreenOutput,
        "--causal-input",
        "fixture-status.txt",
        "--",
        ...DOCUMENTATION_REGRESSION_COMMAND,
      ],
      { cwd: root },
    );
    assert(
      documentationCoverGreen.status === 0,
      `documentation cover-change green proof failed:\n${documentationCoverGreen.stdout}\n${documentationCoverGreen.stderr}`,
    );
    const documentationCoverGreenArtifact = readJson(
      documentationCoverGreenOutput,
    );

    const nestedDocumentationGreenOutput = path.join(
      nestedTarget,
      "proof",
      "nested-documentation-green.json",
    );
    const nestedDocumentationGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        nestedTarget,
        "--run-id",
        "EXAMPLE-NESTED-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        "proof/nested-documentation-green.json",
        "--causal-input",
        "README.md",
        "--",
        ...NESTED_DOCUMENTATION_REGRESSION_COMMAND,
      ],
      { cwd: nestedTarget },
    );
    assert(
      nestedDocumentationGreen.status === 0,
      `nested documentation green proof failed:\n${nestedDocumentationGreen.stdout}\n${nestedDocumentationGreen.stderr}`,
    );
    const nestedDocumentationGreenArtifact = readJson(
      nestedDocumentationGreenOutput,
    );

    const opaqueEnvironmentGreenOutput = path.join(
      root,
      "proof",
      "opaque-environment-green.json",
    );
    const opaqueEnvironmentGreenValue = "opaque-feature-green-314159";
    const opaqueEnvironmentGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        opaqueEnvironmentGreenOutput,
        "--pass-env",
        "FEATURE_FLAG",
        "--",
        ...OPAQUE_ENV_REGRESSION_COMMAND,
      ],
      {
        cwd: root,
        env: { ...process.env, FEATURE_FLAG: opaqueEnvironmentGreenValue },
      },
    );
    assert(
      opaqueEnvironmentGreen.status === 0,
      `opaque environment green proof failed:\n${opaqueEnvironmentGreen.stdout}\n${opaqueEnvironmentGreen.stderr}`,
    );
    const opaqueEnvironmentGreenArtifact = readJson(
      opaqueEnvironmentGreenOutput,
    );
    for (const [label, opaqueArtifact, rawValue] of [
      ["red", opaqueEnvironmentRedArtifact, opaqueEnvironmentRedValue],
      ["green", opaqueEnvironmentGreenArtifact, opaqueEnvironmentGreenValue],
    ]) {
      assert(
        opaqueArtifact.command?.executionInputs?.stability === "opaque-dynamic",
        `${label} pass-env proof was not marked opaque-dynamic`,
      );
      assert(
        opaqueArtifact.command?.executionInputs?.causalIdentityEligible ===
          false,
        `${label} pass-env proof remained RCA-eligible`,
      );
      assert(
        !JSON.stringify(opaqueArtifact).includes(rawValue),
        `${label} pass-env proof persisted the raw effective value`,
      );
    }

    const allowlistedEnvironmentGreenValue =
      "allowlisted-environment-green-314159";
    const allowlistedEnvironmentGreenOutput = path.join(
      root,
      "proof",
      "allowlisted-environment-green.json",
    );
    const allowlistedEnvironmentGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        allowlistedEnvironmentGreenOutput,
        "--",
        ...ALLOWLISTED_ENV_REGRESSION_COMMAND,
      ],
      {
        cwd: root,
        env: { ...process.env, CI: allowlistedEnvironmentGreenValue },
      },
    );
    assert(
      allowlistedEnvironmentGreen.status === 0,
      `allowlisted environment green proof failed:\n${allowlistedEnvironmentGreen.stdout}\n${allowlistedEnvironmentGreen.stderr}`,
    );
    const allowlistedEnvironmentGreenArtifact = readJson(
      allowlistedEnvironmentGreenOutput,
    );
    assert(
      allowlistedEnvironmentRedArtifact.command?.executionInputs?.stability ===
        "static",
      "allowlisted red proof was not kept RCA-eligible",
    );
    assert(
      allowlistedEnvironmentGreenArtifact.command?.executionInputs
        ?.stability === "static",
      "allowlisted green proof was not kept RCA-eligible",
    );
    assert(
      allowlistedEnvironmentRedArtifact.command?.executionInputs
        ?.allowlistedEnvironmentSha256 !==
        allowlistedEnvironmentGreenArtifact.command?.executionInputs
          ?.allowlistedEnvironmentSha256,
      "allowlisted environment changes did not change the persisted input identity",
    );
    assert(
      allowlistedEnvironmentRedArtifact.bindings?.commandSha256 !==
        allowlistedEnvironmentGreenArtifact.bindings?.commandSha256,
      "allowlisted environment changes did not change the bound command identity",
    );
    assert(
      !JSON.stringify(allowlistedEnvironmentRedArtifact).includes(
        allowlistedEnvironmentRedValue,
      ) &&
        !JSON.stringify(allowlistedEnvironmentGreenArtifact).includes(
          allowlistedEnvironmentGreenValue,
        ),
      "allowlisted environment identity persisted raw environment values",
    );

    const opaqueSecretGreenValue = "opaque-credential-green-141421";
    const opaqueSecretGreenOutput = path.join(
      root,
      "proof",
      "opaque-secret-green.json",
    );
    const opaqueSecretGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        opaqueSecretGreenOutput,
        "--",
        ...OPAQUE_SECRET_ARGV_REGRESSION_COMMAND(opaqueSecretGreenValue),
      ],
      { cwd: root },
    );
    assert(
      opaqueSecretGreen.status === 0,
      `opaque secret argv green proof failed:\n${opaqueSecretGreen.stdout}\n${opaqueSecretGreen.stderr}`,
    );
    const opaqueSecretGreenArtifact = readJson(opaqueSecretGreenOutput);
    for (const [label, opaqueArtifact, rawValue] of [
      ["red", opaqueSecretRedArtifact, opaqueSecretRedValue],
      ["green", opaqueSecretGreenArtifact, opaqueSecretGreenValue],
    ]) {
      assert(
        opaqueArtifact.command?.executionInputs?.stability === "opaque-dynamic",
        `${label} secret-argv proof was not marked opaque-dynamic`,
      );
      assert(
        opaqueArtifact.command?.executionInputs?.causalIdentityEligible ===
          false,
        `${label} secret-argv proof remained RCA-eligible`,
      );
      assert(
        !JSON.stringify(opaqueArtifact).includes(rawValue),
        `${label} secret-argv proof persisted the raw value`,
      );
    }

    const unexpectedGreenOutput = path.join(
      root,
      "proof",
      "unexpected-green.json",
    );
    const unexpectedGreen = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        unexpectedGreenOutput,
        "--red-baseline",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
      { cwd: root },
    );
    assert(
      unexpectedGreen.status === 1,
      "unexpected green red-baseline command was accepted",
    );
    assert(
      readJson(unexpectedGreenOutput).outcome?.status === "unexpected-green",
      "unexpected green status was not persisted",
    );

    const stateFile = path.join(root, "flaky-state");
    const flakyOutput = path.join(root, "proof", "flaky.json");
    const flaky = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        flakyOutput,
        "--repeat",
        "2",
        "--",
        process.execPath,
        "-e",
        "const fs=require('node:fs');const p=process.argv[1];if(fs.existsSync(p)){process.stdout.write('second');process.exit(0)}fs.writeFileSync(p,'1');process.stdout.write('first');process.exit(1)",
        stateFile,
      ],
      { cwd: root },
    );
    assert(flaky.status === 1, "flaky repeated command was accepted");
    assert(
      readJson(flakyOutput).outcome?.status === "flaky",
      "flaky repeated command was not detected",
    );

    const timeoutOutput = path.join(root, "proof", "timeout.json");
    const timedOut = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        timeoutOutput,
        "--timeout-ms",
        "50",
        "--",
        process.execPath,
        "-e",
        "setTimeout(() => {}, 1000)",
      ],
      { cwd: root },
    );
    assert(timedOut.status === 1, "timed-out command was accepted");
    assert(
      readJson(timeoutOutput).outcome?.status === "timed-out",
      "timeout status was not persisted",
    );

    const secret = "synthetic-secret-value-12345";
    const databaseSecret = [
      "postgres",
      "://fixture-user:",
      "fixture-password",
      "@example.invalid/db",
    ].join("");
    const dsnSecret = "Server=example.invalid;Password=fixture-dsn-secret";
    const connectionSecret = [
      "mongodb",
      "://fixture-user:",
      "fixture-password",
      "@example.invalid/data",
    ].join("");
    const boundedOutput = path.join(root, "proof", "bounded.json");
    const boundedEnvironment = {
      ...process.env,
      SYNTHETIC_SECRET: secret,
      [["DATABASE", "URL"].join("_")]: databaseSecret,
      APP_DSN: dsnSecret,
      PRIMARY_CONNECTION_STRING: connectionSecret,
    };
    const bounded = run(
      "proof-runner.mjs",
      [
        "--repo",
        root,
        "--run-id",
        "EXAMPLE-RUN-001",
        "--commit",
        POST_FIX_COMMIT,
        "--environment",
        "synthetic-test",
        "--output",
        boundedOutput,
        "--max-output-bytes",
        "256",
        "--pass-env",
        "SYNTHETIC_SECRET",
        "--redact-env",
        "SYNTHETIC_SECRET",
        "--",
        process.execPath,
        "-e",
        "const tokenKey=['to','ken'].join(''); process.stdout.write(tokenKey+'='+process.env.SYNTHETIC_SECRET+'\\ndatabase='+String(process.env.DATABASE_URL)+'\\ndsn='+String(process.env.APP_DSN)+'\\nconnection='+String(process.env.PRIMARY_CONNECTION_STRING)+'\\n'+'x'.repeat(1000))",
      ],
      { cwd: root, env: boundedEnvironment },
    );
    assert(
      bounded.status === 0,
      `bounded/redacted proof failed:\n${bounded.stderr}`,
    );
    const boundedArtifact = readJson(boundedOutput);
    const serialized = JSON.stringify(boundedArtifact);
    assert(!serialized.includes(secret), "proof persisted a raw secret");
    assert(
      !serialized.includes(databaseSecret) &&
        !serialized.includes(dsnSecret) &&
        !serialized.includes(connectionSecret),
      "proof persisted an inherited connection secret",
    );
    assert(
      serialized.includes("[REDACTED]"),
      "proof did not preserve a redaction marker",
    );
    assert(
      boundedArtifact.execution.attempts[0].stdout.text.includes(
        "database=undefined",
      ),
      "proof command inherited DATABASE_URL instead of the safe explicit environment",
    );
    assert(
      boundedArtifact.execution.attempts[0].stdout.persistedBytes <= 256,
      "proof exceeded the persisted output bound",
    );
    assert(
      boundedArtifact.execution.attempts[0].stdout.truncated === true,
      "proof did not mark truncated output",
    );

    const rcaPath = path.join(root, "rca", "rca.json");
    const causalEvidencePath = path.join(root, "rca", "causal-evidence.json");
    const fixEvidencePath = path.join(root, "rca", "fix-evidence.json");
    writeJson(causalEvidencePath, {
      schema: "synthetic.causal-evidence.v1",
      observation:
        "The fixture source calls process.exit(7) on the reproduced path.",
    });
    writeJson(fixEvidencePath, {
      schema: "synthetic.change-evidence.v1",
      change:
        "The post-fix fixture returns success and preserves the neighboring behavior.",
    });
    const rcaDocument = {
      schema: "valdris.rca.v1",
      generatedAt: new Date().toISOString(),
      runId: "EXAMPLE-RUN-001",
      commit: POST_FIX_COMMIT,
      environment: "synthetic-test",
      status: "confirmed",
      symptom: {
        id: "EXAMPLE-SYMPTOM-001",
        summary: "Synthetic command exits with code 7.",
        evidenceIds: ["EXAMPLE-REPRODUCTION-001"],
      },
      rootCause: {
        summary: "Synthetic fixture deliberately exits non-zero.",
        causalMechanism: "The fixture calls process.exit(7).",
        affectedPaths: ["fixture-status.txt"],
        evidenceIds: ["EXAMPLE-CAUSE-001"],
      },
      fix: {
        summary: "The fixture was changed to return success.",
        changedPaths: ["fixture-status.txt"],
        evidenceIds: ["EXAMPLE-FIX-001"],
      },
      regression: {
        id: "EXAMPLE-REGRESSION-IDENTITY-001",
        summary:
          "The same regression command fails before the fix and passes after it.",
        commandSha256: artifact.bindings.commandSha256,
        failureSignature: "synthetic-regression-signature",
        preFixCommit: PRE_FIX_COMMIT,
        postFixCommit: POST_FIX_COMMIT,
        evidenceIds: ["EXAMPLE-REGRESSION-001"],
      },
      evidence: [
        {
          id: "EXAMPLE-REPRODUCTION-001",
          type: "runtime-command",
          phase: "reproduction",
          symptomId: "EXAMPLE-SYMPTOM-001",
          observation:
            "The synthetic symptom is reproduced by a bounded runtime command.",
          artifact: "proof/red.json",
          sha256: digest(readFileSync(redOutput)),
          proofBindingSha256: redArtifact.bindings.envelopeSha256,
          regressionId: "EXAMPLE-REGRESSION-IDENTITY-001",
        },
        {
          id: "EXAMPLE-CAUSE-001",
          type: "runtime-log",
          phase: "diagnosis",
          symptomId: "EXAMPLE-SYMPTOM-001",
          observation:
            "The causal trace identifies the deliberate non-zero exit in the reproduced path.",
          artifact: "rca/causal-evidence.json",
          sha256: digest(readFileSync(causalEvidencePath)),
        },
        {
          id: "EXAMPLE-FIX-001",
          type: "change-artifact",
          phase: "fix",
          symptomId: "EXAMPLE-SYMPTOM-001",
          observation:
            "The change artifact identifies the repair applied to the failing path.",
          artifact: "rca/fix-evidence.json",
          sha256: digest(readFileSync(fixEvidencePath)),
        },
        {
          id: "EXAMPLE-REGRESSION-001",
          type: "runtime-command",
          phase: "post-fix-regression",
          symptomId: "EXAMPLE-SYMPTOM-001",
          observation:
            "The post-fix regression command passes after the repair.",
          artifact: "proof/portable.json",
          sha256: digest(readFileSync(output)),
          proofBindingSha256: artifact.bindings.envelopeSha256,
          regressionId: "EXAMPLE-REGRESSION-IDENTITY-001",
        },
      ],
    };
    writeJson(rcaPath, rcaDocument);
    const rca = run(
      "rca-gate.mjs",
      ["--repo", root, "--file", "rca/rca.json"],
      { cwd: root },
    );
    assert(
      rca.status === 0,
      `typed runtime RCA was rejected:\n${rca.stdout}\n${rca.stderr}`,
    );

    const documentationCausalEvidencePath = path.join(
      root,
      "rca",
      "documentation-causal-evidence.json",
    );
    const documentationFixEvidencePath = path.join(
      root,
      "rca",
      "documentation-fix-evidence.json",
    );
    writeJson(documentationCausalEvidencePath, {
      schema: "synthetic.documentation-causal-evidence.v1",
      observation:
        "The regression command reads the broken incident process document directly.",
    });
    writeJson(documentationFixEvidencePath, {
      schema: "synthetic.documentation-change-evidence.v1",
      change:
        "The causal incident process document now contains the passing state.",
    });
    const documentationRca = structuredClone(rcaDocument);
    documentationRca.symptom = {
      id: "EXAMPLE-SYMPTOM-001",
      summary:
        "The incident process document leaves the regression command in a failing state.",
      evidenceIds: ["EXAMPLE-REPRODUCTION-001"],
    };
    documentationRca.rootCause = {
      summary: "The incident process document encodes the broken behavior.",
      causalMechanism:
        "The regression command reads the document as its direct runtime input.",
      causalClass: "documentation-process",
      affectedPaths: ["docs/incident-process.md"],
      evidenceIds: ["EXAMPLE-CAUSE-001"],
    };
    documentationRca.fix = {
      summary: "The causal incident process document was corrected.",
      remediationClass: "documentation-process",
      changedPaths: ["docs/incident-process.md"],
      evidenceIds: ["EXAMPLE-FIX-001"],
    };
    documentationRca.regression = {
      ...documentationRca.regression,
      id: "EXAMPLE-DOCUMENTATION-REGRESSION-001",
      summary:
        "The same document-backed command fails before the process repair and passes after it.",
      commandSha256: documentationGreenArtifact.bindings.commandSha256,
      failureSignature: "documentation-process-regression",
      causalInputs: [
        {
          path: "docs/incident-process.md",
          preFixSha256: digest("broken\n"),
          postFixSha256: digest("fixed\n"),
        },
      ],
    };
    documentationRca.evidence = structuredClone(rcaDocument.evidence);
    Object.assign(documentationRca.evidence[0], {
      artifact: "proof/documentation-red.json",
      sha256: digest(readFileSync(documentationRedOutput)),
      proofBindingSha256: documentationRedArtifact.bindings.envelopeSha256,
      regressionId: documentationRca.regression.id,
      observation:
        "The document-backed symptom is reproduced by the exact bounded regression command.",
    });
    Object.assign(documentationRca.evidence[1], {
      artifact: "rca/documentation-causal-evidence.json",
      sha256: digest(readFileSync(documentationCausalEvidencePath)),
      observation:
        "The diagnosis binds the broken process document to the reproduced command input.",
    });
    Object.assign(documentationRca.evidence[2], {
      artifact: "rca/documentation-fix-evidence.json",
      sha256: digest(readFileSync(documentationFixEvidencePath)),
      observation:
        "The change evidence identifies the corrected causal process document.",
    });
    Object.assign(documentationRca.evidence[3], {
      artifact: "proof/documentation-green.json",
      sha256: digest(readFileSync(documentationGreenOutput)),
      proofBindingSha256: documentationGreenArtifact.bindings.envelopeSha256,
      regressionId: documentationRca.regression.id,
      observation:
        "The same document-backed regression command passes after the process repair.",
    });
    writeJson(
      path.join(root, "rca", "documentation-process.json"),
      documentationRca,
    );
    const documentationRcaResult = run(
      "rca-gate.mjs",
      ["--repo", root, "--file", "rca/documentation-process.json"],
      { cwd: root },
    );
    assert(
      documentationRcaResult.status === 0,
      `typed documentation-process RCA was rejected:\n${documentationRcaResult.stdout}\n${documentationRcaResult.stderr}`,
    );

    const nestedCausalEvidencePath = path.join(
      nestedTarget,
      "rca",
      "nested-documentation-causal-evidence.json",
    );
    const nestedFixEvidencePath = path.join(
      nestedTarget,
      "rca",
      "nested-documentation-fix-evidence.json",
    );
    writeJson(nestedCausalEvidencePath, {
      schema: "synthetic.documentation-causal-evidence.v1",
      observation:
        "The nested regression reads the target-relative README directly.",
    });
    writeJson(nestedFixEvidencePath, {
      schema: "synthetic.documentation-change-evidence.v1",
      change:
        "The nested target README now contains the passing process state.",
    });
    const nestedDocumentationRca = structuredClone(documentationRca);
    nestedDocumentationRca.runId = "EXAMPLE-NESTED-RUN-001";
    nestedDocumentationRca.symptom.summary =
      "The nested target README leaves its regression command in a failing state.";
    nestedDocumentationRca.rootCause = {
      summary: "The nested target README encodes the broken process behavior.",
      causalMechanism:
        "The target-relative regression command reads README.md directly.",
      causalClass: "documentation-process",
      affectedPaths: ["README.md"],
      evidenceIds: ["EXAMPLE-CAUSE-001"],
    };
    nestedDocumentationRca.fix = {
      summary: "The nested target README process state was corrected.",
      remediationClass: "documentation-process",
      changedPaths: ["README.md"],
      evidenceIds: ["EXAMPLE-FIX-001"],
    };
    nestedDocumentationRca.regression = {
      ...nestedDocumentationRca.regression,
      id: "EXAMPLE-NESTED-DOCUMENTATION-REGRESSION-001",
      summary:
        "The same target-relative README regression fails before and passes after the nested repair.",
      commandSha256: nestedDocumentationGreenArtifact.bindings.commandSha256,
      failureSignature: "nested-documentation-regression",
      causalInputs: [
        {
          path: "README.md",
          preFixSha256: digest("broken\n"),
          postFixSha256: digest("fixed\n"),
        },
      ],
    };
    Object.assign(nestedDocumentationRca.evidence[0], {
      artifact: "proof/nested-documentation-red.json",
      sha256: digest(readFileSync(nestedDocumentationRedOutput)),
      proofBindingSha256:
        nestedDocumentationRedArtifact.bindings.envelopeSha256,
      regressionId: nestedDocumentationRca.regression.id,
    });
    Object.assign(nestedDocumentationRca.evidence[1], {
      artifact: "rca/nested-documentation-causal-evidence.json",
      sha256: digest(readFileSync(nestedCausalEvidencePath)),
    });
    Object.assign(nestedDocumentationRca.evidence[2], {
      artifact: "rca/nested-documentation-fix-evidence.json",
      sha256: digest(readFileSync(nestedFixEvidencePath)),
    });
    Object.assign(nestedDocumentationRca.evidence[3], {
      artifact: "proof/nested-documentation-green.json",
      sha256: digest(readFileSync(nestedDocumentationGreenOutput)),
      proofBindingSha256:
        nestedDocumentationGreenArtifact.bindings.envelopeSha256,
      regressionId: nestedDocumentationRca.regression.id,
    });
    writeJson(
      path.join(nestedTarget, "rca", "nested-documentation-process.json"),
      nestedDocumentationRca,
    );
    const nestedDocumentationRcaResult = run(
      "rca-gate.mjs",
      [
        "--repo",
        nestedTarget,
        "--file",
        "rca/nested-documentation-process.json",
      ],
      { cwd: nestedTarget },
    );
    assert(
      nestedDocumentationRcaResult.status === 0,
      `nested target documentation-process RCA was rejected:\n${nestedDocumentationRcaResult.stdout}\n${nestedDocumentationRcaResult.stderr}`,
    );

    const opaqueEnvironmentRca = structuredClone(rcaDocument);
    Object.assign(opaqueEnvironmentRca.regression, {
      id: "EXAMPLE-OPAQUE-ENVIRONMENT-REGRESSION-001",
      summary:
        "Opaque passed environment values must not masquerade as one causal command identity.",
      commandSha256: opaqueEnvironmentGreenArtifact.bindings.commandSha256,
      failureSignature: "opaque-environment-regression",
    });
    Object.assign(opaqueEnvironmentRca.evidence[0], {
      artifact: "proof/opaque-environment-red.json",
      sha256: digest(readFileSync(opaqueEnvironmentRedOutput)),
      proofBindingSha256: opaqueEnvironmentRedArtifact.bindings.envelopeSha256,
      regressionId: opaqueEnvironmentRca.regression.id,
    });
    Object.assign(opaqueEnvironmentRca.evidence[3], {
      artifact: "proof/opaque-environment-green.json",
      sha256: digest(readFileSync(opaqueEnvironmentGreenOutput)),
      proofBindingSha256:
        opaqueEnvironmentGreenArtifact.bindings.envelopeSha256,
      regressionId: opaqueEnvironmentRca.regression.id,
    });
    writeJson(
      path.join(root, "rca", "opaque-environment-identity.json"),
      opaqueEnvironmentRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/opaque-environment-identity.json"],
        { cwd: root },
      ),
      "RCA whose red and green proofs use different opaque passed-environment values",
      "opaque dynamic execution inputs are ineligible for RCA causal identity",
    );

    const allowlistedEnvironmentRca = structuredClone(rcaDocument);
    Object.assign(allowlistedEnvironmentRca.regression, {
      id: "EXAMPLE-ALLOWLISTED-ENVIRONMENT-REGRESSION-001",
      summary:
        "Distinct allowlisted environment values must produce distinct causal command identities.",
      commandSha256: allowlistedEnvironmentGreenArtifact.bindings.commandSha256,
      failureSignature: "allowlisted-environment-regression",
    });
    Object.assign(allowlistedEnvironmentRca.evidence[0], {
      artifact: "proof/allowlisted-environment-red.json",
      sha256: digest(readFileSync(allowlistedEnvironmentRedOutput)),
      proofBindingSha256:
        allowlistedEnvironmentRedArtifact.bindings.envelopeSha256,
      regressionId: allowlistedEnvironmentRca.regression.id,
    });
    Object.assign(allowlistedEnvironmentRca.evidence[3], {
      artifact: "proof/allowlisted-environment-green.json",
      sha256: digest(readFileSync(allowlistedEnvironmentGreenOutput)),
      proofBindingSha256:
        allowlistedEnvironmentGreenArtifact.bindings.envelopeSha256,
      regressionId: allowlistedEnvironmentRca.regression.id,
    });
    writeJson(
      path.join(root, "rca", "allowlisted-environment-identity.json"),
      allowlistedEnvironmentRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/allowlisted-environment-identity.json"],
        { cwd: root },
      ),
      "RCA whose red and green proofs use different allowlisted environment values",
      "command does not match the bound regression identity",
    );

    const opaqueSecretArgvRca = structuredClone(rcaDocument);
    Object.assign(opaqueSecretArgvRca.regression, {
      id: "EXAMPLE-OPAQUE-SECRET-ARGV-REGRESSION-001",
      summary:
        "Distinct opaque secret argv values must not masquerade as one causal command identity.",
      commandSha256: opaqueSecretGreenArtifact.bindings.commandSha256,
      failureSignature: "opaque-secret-argv-regression",
    });
    Object.assign(opaqueSecretArgvRca.evidence[0], {
      artifact: "proof/opaque-secret-red.json",
      sha256: digest(readFileSync(opaqueSecretRedOutput)),
      proofBindingSha256: opaqueSecretRedArtifact.bindings.envelopeSha256,
      regressionId: opaqueSecretArgvRca.regression.id,
    });
    Object.assign(opaqueSecretArgvRca.evidence[3], {
      artifact: "proof/opaque-secret-green.json",
      sha256: digest(readFileSync(opaqueSecretGreenOutput)),
      proofBindingSha256: opaqueSecretGreenArtifact.bindings.envelopeSha256,
      regressionId: opaqueSecretArgvRca.regression.id,
    });
    writeJson(
      path.join(root, "rca", "opaque-secret-argv-identity.json"),
      opaqueSecretArgvRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/opaque-secret-argv-identity.json"],
        { cwd: root },
      ),
      "RCA whose red and green proofs use distinct opaque secret argv values",
      "opaque dynamic execution inputs are ineligible for RCA causal identity",
    );

    const missingDocumentationCausalInput = structuredClone(documentationRca);
    delete missingDocumentationCausalInput.regression.causalInputs;
    writeJson(
      path.join(root, "rca", "documentation-process-missing-causal-input.json"),
      missingDocumentationCausalInput,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        [
          "--repo",
          root,
          "--file",
          "rca/documentation-process-missing-causal-input.json",
        ],
        { cwd: root },
      ),
      "documentation-process RCA without digest-bound causal inputs",
      "documentation/process causal path is missing from regression.causalInputs",
    );

    const mismatchedDocumentationCausalInput =
      structuredClone(documentationRca);
    mismatchedDocumentationCausalInput.regression.causalInputs[0].preFixSha256 =
      "0".repeat(64);
    writeJson(
      path.join(
        root,
        "rca",
        "documentation-process-mismatched-causal-input.json",
      ),
      mismatchedDocumentationCausalInput,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        [
          "--repo",
          root,
          "--file",
          "rca/documentation-process-mismatched-causal-input.json",
        ],
        { cwd: root },
      ),
      "documentation-process RCA with a forged pre-fix causal-input digest",
      "preFixSha256 does not match the exact pre-fix Git bytes",
    );

    const documentationCoverChangeRca = structuredClone(documentationRca);
    Object.assign(documentationCoverChangeRca.evidence[0], {
      artifact: "proof/documentation-cover-red.json",
      sha256: digest(readFileSync(documentationCoverRedOutput)),
      proofBindingSha256: documentationCoverRedArtifact.bindings.envelopeSha256,
    });
    Object.assign(documentationCoverChangeRca.evidence[3], {
      artifact: "proof/documentation-cover-green.json",
      sha256: digest(readFileSync(documentationCoverGreenOutput)),
      proofBindingSha256:
        documentationCoverGreenArtifact.bindings.envelopeSha256,
    });
    writeJson(
      path.join(root, "rca", "documentation-process-cover-change.json"),
      documentationCoverChangeRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        [
          "--repo",
          root,
          "--file",
          "rca/documentation-process-cover-change.json",
        ],
        { cwd: root },
      ),
      "documentation-process RCA whose proofs bind only an unrelated cover change",
      "reproduction proof is missing digest-bound causal input: docs/incident-process.md",
    );

    const untypedDocumentationRca = structuredClone(documentationRca);
    delete untypedDocumentationRca.rootCause.causalClass;
    delete untypedDocumentationRca.fix.remediationClass;
    writeJson(
      path.join(root, "rca", "documentation-process-untyped.json"),
      untypedDocumentationRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/documentation-process-untyped.json"],
        { cwd: root },
      ),
      "documentation-only RCA without typed cause/remediation classes",
      "documentation-only causal fix requires rootCause.causalClass and fix.remediationClass to be documentation-process",
    );

    const mismatchedDocumentationRca = structuredClone(documentationRca);
    mismatchedDocumentationRca.fix.remediationClass = "source-change";
    writeJson(
      path.join(root, "rca", "documentation-process-mismatched.json"),
      mismatchedDocumentationRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/documentation-process-mismatched.json"],
        { cwd: root },
      ),
      "documentation-only RCA with mismatched cause/remediation classes",
      "rootCause.causalClass and fix.remediationClass must match",
    );

    const evidenceOnlyPathRca = structuredClone(rcaDocument);
    evidenceOnlyPathRca.rootCause.affectedPaths = ["cloud/service-map.json"];
    evidenceOnlyPathRca.fix.changedPaths = ["cloud/service-map.json"];
    writeJson(
      path.join(root, "rca", "evidence-only-path.json"),
      evidenceOnlyPathRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/evidence-only-path.json"],
        { cwd: root },
      ),
      "RCA using an evidence-only causal path plus an unrelated source cover change",
      "causal fix path must itself be a changed non-evidence source path",
    );

    const narrativeRcaPath = path.join(root, "rca", "narrative-only.json");
    const narrativeRca = structuredClone(rcaDocument);
    narrativeRca.evidence[0].type = "analysis";
    writeJson(narrativeRcaPath, narrativeRca);
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/narrative-only.json"],
        { cwd: root },
      ),
      "narrative-only RCA",
      "typed RCA evidence",
    );

    const untiedRcaPath = path.join(root, "rca", "untied.json");
    const untiedRca = structuredClone(rcaDocument);
    untiedRca.evidence[0].symptomId = "EXAMPLE-SYMPTOM-OTHER";
    writeJson(untiedRcaPath, untiedRca);
    expectFailure(
      run("rca-gate.mjs", ["--repo", root, "--file", "rca/untied.json"], {
        cwd: root,
      }),
      "symptom-untied RCA",
      "tie directly to symptom.id",
    );

    const selfGrantedRcaPath = path.join(root, "rca", "self-granted.json");
    const selfGrantedRca = structuredClone(rcaDocument);
    selfGrantedRca.approval = {
      status: "granted",
      actorType: "agent",
      actor: "EXAMPLE-ACTOR-IMPLEMENTER",
    };
    writeJson(selfGrantedRcaPath, selfGrantedRca);
    expectFailure(
      run("rca-gate.mjs", ["--repo", root, "--file", "rca/self-granted.json"], {
        cwd: root,
      }),
      "agent self-granted RCA",
      "agent self-granted approval",
    );

    const missingFixRca = structuredClone(rcaDocument);
    missingFixRca.fix.evidenceIds = [];
    writeJson(path.join(root, "rca", "missing-fix.json"), missingFixRca);
    expectFailure(
      run("rca-gate.mjs", ["--repo", root, "--file", "rca/missing-fix.json"], {
        cwd: root,
      }),
      "RCA without fix evidence",
      "fix.evidenceIds",
    );

    const missingRegressionRca = structuredClone(rcaDocument);
    missingRegressionRca.regression.evidenceIds = [];
    missingRegressionRca.evidence = missingRegressionRca.evidence.filter(
      (entry) => entry.phase !== "post-fix-regression",
    );
    writeJson(
      path.join(root, "rca", "missing-regression.json"),
      missingRegressionRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/missing-regression.json"],
        { cwd: root },
      ),
      "RCA without regression proof",
      "post-fix regression portable proof",
    );

    const redRegressionRca = structuredClone(rcaDocument);
    const regressionEvidence = redRegressionRca.evidence.find(
      (entry) => entry.phase === "post-fix-regression",
    );
    regressionEvidence.artifact = "proof/red.json";
    regressionEvidence.sha256 = digest(readFileSync(redOutput));
    regressionEvidence.proofBindingSha256 = redArtifact.bindings.envelopeSha256;
    writeJson(path.join(root, "rca", "red-regression.json"), redRegressionRca);
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/red-regression.json"],
        { cwd: root },
      ),
      "RCA with red regression proof",
      "passed green portable proof",
    );

    const unrelatedRegressionRca = structuredClone(rcaDocument);
    const unrelatedEvidence = unrelatedRegressionRca.evidence.find(
      (entry) => entry.phase === "post-fix-regression",
    );
    unrelatedEvidence.artifact = "proof/bounded.json";
    unrelatedEvidence.sha256 = digest(readFileSync(boundedOutput));
    unrelatedEvidence.proofBindingSha256 =
      boundedArtifact.bindings.envelopeSha256;
    writeJson(
      path.join(root, "rca", "unrelated-regression.json"),
      unrelatedRegressionRca,
    );
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/unrelated-regression.json"],
        { cwd: root },
      ),
      "RCA with unrelated green command",
      "bound regression identity",
    );

    const unboundCauseRca = structuredClone(rcaDocument);
    unboundCauseRca.rootCause.evidenceIds = ["EXAMPLE-REPRODUCTION-001"];
    writeJson(path.join(root, "rca", "unbound-cause.json"), unboundCauseRca);
    expectFailure(
      run(
        "rca-gate.mjs",
        ["--repo", root, "--file", "rca/unbound-cause.json"],
        { cwd: root },
      ),
      "RCA without causal evidence binding",
      "must bind diagnosis evidence",
    );

    const reviewPath = path.join(root, "review", "review.json");
    const proofSha256 = digest(readFileSync(output));
    const routePath = path.join(root, "run", "route.json");
    writeJson(routePath, {
      schema: "uash.route.v2",
      status: "synthetic-scout-evidence",
    });
    const routeSha256 = digest(readFileSync(routePath));
    const reviewDocument = {
      schema: "valdris.review.v2",
      generatedAt: new Date().toISOString(),
      runId: "EXAMPLE-RUN-001",
      commit: POST_FIX_COMMIT,
      environment: "synthetic-test",
      status: "passed",
      subject: { artifact: "proof/portable.json", sha256: proofSha256 },
      reviewTrustSha256,
      validationRuntimeSha256: "0".repeat(64),
      evidenceBundleSha256: "1".repeat(64),
      roleProvenance: {
        schema: "valdris.review-role-provenance.v1",
        scout: {
          actorId: "EXAMPLE-ACTOR-SCOUT",
          actorType: "agent",
          sessionId: "EXAMPLE-SESSION-SCOUT",
          executionId: "EXAMPLE-EXECUTION-SCOUT",
          evidence: {
            kind: "artifact",
            path: "run/route.json",
            sha256: routeSha256,
          },
        },
        implementer: {
          actorId: "EXAMPLE-ACTOR-IMPLEMENTER",
          actorType: "agent",
          sessionId: "EXAMPLE-SESSION-IMPLEMENT",
          executionId: "EXAMPLE-EXECUTION-IMPLEMENT",
          evidence: {
            kind: "artifact",
            path: "proof/portable.json",
            sha256: proofSha256,
          },
        },
        verifier: {
          actorId: "EXAMPLE-ACTOR-VERIFIER",
          actorType: "agent",
          sessionId: "EXAMPLE-SESSION-VERIFY",
          executionId: "EXAMPLE-EXECUTION-VERIFY",
          evidence: {
            kind: "artifact",
            path: "proof/portable.json",
            sha256: proofSha256,
          },
        },
        independentReviewer: {
          actorId: "EXAMPLE-ACTOR-REVIEWER",
          actorType: "agent",
          sessionId: "EXAMPLE-SESSION-REVIEW",
          executionId: "EXAMPLE-EXECUTION-REVIEW",
          evidence: { kind: "review-evidence-bundle", sha256: "1".repeat(64) },
        },
      },
      decision: {
        status: "accepted",
        summary: "Synthetic artifact satisfies the portable proof contract.",
      },
      findings: [],
      blockers: [],
    };
    reviewDocument.attestation = {
      scheme: "ed25519",
      keyId: "EXAMPLE-REVIEW-KEY-001",
      signedAt: new Date().toISOString(),
    };
    const reviewPayload = canonicalJson(
      reviewAttestationPayload(reviewDocument),
    );
    reviewDocument.attestation.payloadSha256 = digest(reviewPayload);
    reviewDocument.attestation.signature = signPayload(
      null,
      Buffer.from(reviewPayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(reviewPath, reviewDocument);
    const review = run(
      "review-gate.mjs",
      ["--repo", root, "--file", "review/review.json"],
      { cwd: root, scriptDir: reviewRuntimeScripts },
    );
    assert(
      review.status === 0,
      `independent review was rejected:\n${review.stdout}\n${review.stderr}`,
    );

    const malformedPortablePath = path.join(
      root,
      "proof",
      "malformed-portable.json",
    );
    const malformedPortable = structuredClone(artifact);
    malformedPortable.execution.attempts = {};
    writeJson(malformedPortablePath, malformedPortable);
    const malformedPortableSha256 = digest(readFileSync(malformedPortablePath));
    const malformedPortableReview = structuredClone(reviewDocument);
    malformedPortableReview.subject = {
      artifact: "proof/malformed-portable.json",
      sha256: malformedPortableSha256,
    };
    malformedPortableReview.roleProvenance.implementer.evidence = {
      kind: "artifact",
      path: "proof/malformed-portable.json",
      sha256: malformedPortableSha256,
    };
    malformedPortableReview.roleProvenance.verifier.evidence = {
      kind: "artifact",
      path: "proof/malformed-portable.json",
      sha256: malformedPortableSha256,
    };
    const malformedPortablePayload = canonicalJson(
      reviewAttestationPayload(malformedPortableReview),
    );
    malformedPortableReview.attestation.payloadSha256 = digest(
      malformedPortablePayload,
    );
    malformedPortableReview.attestation.signature = signPayload(
      null,
      Buffer.from(malformedPortablePayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(
      path.join(root, "review", "malformed-portable.json"),
      malformedPortableReview,
    );
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/malformed-portable.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "signed review over a malformed portable proof",
      "reviewed portable proof validation failed",
    );

    const malformedJsonPath = path.join(
      root,
      "proof",
      "malformed-subject.json",
    );
    writeFileSync(malformedJsonPath, '{"schema":', "utf8");
    const malformedJsonSha256 = digest(readFileSync(malformedJsonPath));
    const malformedJsonReview = structuredClone(reviewDocument);
    malformedJsonReview.subject = {
      artifact: "proof/malformed-subject.json",
      sha256: malformedJsonSha256,
    };
    malformedJsonReview.roleProvenance.implementer.evidence = {
      kind: "artifact",
      path: "proof/malformed-subject.json",
      sha256: malformedJsonSha256,
    };
    malformedJsonReview.roleProvenance.verifier.evidence = {
      kind: "artifact",
      path: "proof/malformed-subject.json",
      sha256: malformedJsonSha256,
    };
    const malformedJsonPayload = canonicalJson(
      reviewAttestationPayload(malformedJsonReview),
    );
    malformedJsonReview.attestation.payloadSha256 =
      digest(malformedJsonPayload);
    malformedJsonReview.attestation.signature = signPayload(
      null,
      Buffer.from(malformedJsonPayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(
      path.join(root, "review", "malformed-json-subject.json"),
      malformedJsonReview,
    );
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/malformed-json-subject.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "signed review over malformed JSON",
      "declares JSON but contains malformed JSON",
    );

    const missingScout = structuredClone(reviewDocument);
    delete missingScout.roleProvenance.scout;
    writeJson(path.join(root, "review", "missing-scout.json"), missingScout);
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/missing-scout.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "review without scout provenance",
      "roleProvenance.scout is required",
    );

    const collapsedActor = structuredClone(reviewDocument);
    collapsedActor.roleProvenance.scout.actorId =
      collapsedActor.roleProvenance.implementer.actorId;
    const collapsedActorPayload = canonicalJson(
      reviewAttestationPayload(collapsedActor),
    );
    collapsedActor.attestation.payloadSha256 = digest(collapsedActorPayload);
    collapsedActor.attestation.signature = signPayload(
      null,
      Buffer.from(collapsedActorPayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(
      path.join(root, "review", "collapsed-actor.json"),
      collapsedActor,
    );
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/collapsed-actor.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "review with collapsed scout and implementer actor",
      "actorId is reused",
    );

    const collapsedSession = structuredClone(reviewDocument);
    collapsedSession.roleProvenance.verifier.sessionId =
      collapsedSession.roleProvenance.implementer.sessionId;
    const collapsedSessionPayload = canonicalJson(
      reviewAttestationPayload(collapsedSession),
    );
    collapsedSession.attestation.payloadSha256 = digest(
      collapsedSessionPayload,
    );
    collapsedSession.attestation.signature = signPayload(
      null,
      Buffer.from(collapsedSessionPayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(
      path.join(root, "review", "collapsed-session.json"),
      collapsedSession,
    );
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/collapsed-session.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "review with reused implementer and verifier session",
      "sessionId is reused",
    );

    const collapsedExecution = structuredClone(reviewDocument);
    collapsedExecution.roleProvenance.independentReviewer.executionId =
      collapsedExecution.roleProvenance.scout.executionId;
    const collapsedExecutionPayload = canonicalJson(
      reviewAttestationPayload(collapsedExecution),
    );
    collapsedExecution.attestation.payloadSha256 = digest(
      collapsedExecutionPayload,
    );
    collapsedExecution.attestation.signature = signPayload(
      null,
      Buffer.from(collapsedExecutionPayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(
      path.join(root, "review", "collapsed-execution.json"),
      collapsedExecution,
    );
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/collapsed-execution.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "review with reused scout and independent-reviewer execution",
      "executionId is reused",
    );

    const sameReviewerPath = path.join(root, "review", "same-reviewer.json");
    const sameReviewer = structuredClone(reviewDocument);
    sameReviewer.roleProvenance.independentReviewer.actorId =
      sameReviewer.roleProvenance.implementer.actorId;
    const sameReviewerPayload = canonicalJson(
      reviewAttestationPayload(sameReviewer),
    );
    sameReviewer.attestation.payloadSha256 = digest(sameReviewerPayload);
    sameReviewer.attestation.signature = signPayload(
      null,
      Buffer.from(sameReviewerPayload, "utf8"),
      privateKey,
    ).toString("base64");
    writeJson(sameReviewerPath, sameReviewer);
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/same-reviewer.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "same-actor review",
      "actorId is reused",
    );

    const blockedReviewPath = path.join(root, "review", "blocked.json");
    const blockedReview = structuredClone(reviewDocument);
    blockedReview.blockers = [
      {
        id: "EXAMPLE-BLOCKER-001",
        status: "open",
        summary: "Synthetic unresolved blocker.",
      },
    ];
    writeJson(blockedReviewPath, blockedReview);
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/blocked.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "review with open blocker",
      "remains open",
    );

    const selfGrantedReviewPath = path.join(
      root,
      "review",
      "self-granted.json",
    );
    const selfGrantedReview = structuredClone(reviewDocument);
    selfGrantedReview.approval = {
      status: "granted",
      actorType: "agent",
      actor: "EXAMPLE-ACTOR-REVIEWER",
    };
    writeJson(selfGrantedReviewPath, selfGrantedReview);
    expectFailure(
      run(
        "review-gate.mjs",
        ["--repo", root, "--file", "review/self-granted.json"],
        { cwd: root, scriptDir: reviewRuntimeScripts },
      ),
      "agent self-granted review",
      "agent self-granted approval",
    );

    const forgedReview = structuredClone(reviewDocument);
    forgedReview.roleProvenance.independentReviewer.actorId =
      "EXAMPLE-FORGED-REVIEWER";
    forgedReview.roleProvenance.independentReviewer.sessionId =
      "EXAMPLE-FORGED-SESSION";
    forgedReview.roleProvenance.independentReviewer.executionId =
      "EXAMPLE-FORGED-EXECUTION";
    writeJson(path.join(root, "review", "forged.json"), forgedReview);
    expectFailure(
      run("review-gate.mjs", ["--repo", root, "--file", "review/forged.json"], {
        cwd: root,
        scriptDir: reviewRuntimeScripts,
      }),
      "forged independent-review metadata",
      "attestation",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          seams: [
            "proof-runner CLI exit + JSON artifact",
            "RCA gate CLI exit",
            "review gate CLI exit",
          ],
          proofCases: 18,
          rcaCases: 20,
          reviewCases: 10,
          adversarialRejections: 29,
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
