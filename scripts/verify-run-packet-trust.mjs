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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewAttestationPayload } from "./review-gate.mjs";
import { routeRequiredGates, routeRequiresRca } from "./run-packet-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRE_V3_RUNTIME_COMMIT = "ea09ce53f3258e365a0ba160f16d61e3e6a9e2fc";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function gateBindingValue(gateArtifacts) {
  return [...gateArtifacts]
    .map(
      ({
        gate,
        path: artifactPath,
        sha256: digest,
        required,
        runId,
        commit,
        environment,
        supportingArtifacts,
      }) => {
        const value = {
          gate,
          path: artifactPath,
          sha256: digest,
          required,
          runId,
          commit,
          environment,
        };
        if (Array.isArray(supportingArtifacts)) {
          value.supportingArtifacts = [...supportingArtifacts]
            .map(
              ({ kind, path: supportingPath, sha256: supportingSha256 }) => ({
                kind,
                path: supportingPath,
                sha256: supportingSha256,
              }),
            )
            .sort((left, right) =>
              left.kind < right.kind
                ? -1
                : left.kind > right.kind
                  ? 1
                  : left.path < right.path
                    ? -1
                    : left.path > right.path
                      ? 1
                      : 0,
            );
        }
        return value;
      },
    )
    .sort((left, right) =>
      left.gate < right.gate ? -1 : left.gate > right.gate ? 1 : 0,
    );
}

function evidenceBundleSha256(document) {
  const inputs = Object.fromEntries(
    ["intake", "route", "classification", "goal"].map((name) => [
      name,
      {
        path: document.inputs[name].path,
        sha256: document.inputs[name].sha256,
      },
    ]),
  );
  const gateArtifacts = gateBindingValue(
    document.gateArtifacts.filter(({ gate }) => gate !== "independent-review"),
  );
  const bundle = {
    schema: "valdris.review-evidence-bundle.v1",
    runId: document.runId,
    commit: document.commit,
    environment: document.environment,
    validationRuntimeSha256: document.validationRuntime.setSha256,
    inputs,
    requiredGates: [...document.requiredGates].sort(),
    gateArtifacts,
  };
  if (document.schema === "valdris.run-packet.v3") {
    bundle.assuranceLevel = document.assuranceLevel;
    bundle.catalogSnapshotsSha256 = sha256(
      canonicalJson(document.catalogSnapshots),
    );
  }
  if (Array.isArray(document.artifactInventory))
    bundle.artifactInventory = document.artifactInventory;
  return sha256(canonicalJson(bundle));
}

function packetBindings(document) {
  const generatedAtSha256 = sha256(document.generatedAt);
  const intakeSha256 = document.inputs.intake.sha256;
  const classificationSha256 = document.inputs.classification.sha256;
  const routeSha256 = document.inputs.route.sha256;
  const goalSha256 = document.inputs.goal.sha256;
  const gateArtifactsSha256 = sha256(
    canonicalJson(gateBindingValue(document.gateArtifacts)),
  );
  const runSha256 = sha256(document.runId);
  const commitSha256 = sha256(document.commit);
  const environmentSha256 = sha256(document.environment);
  const validationRuntimeSha256 = document.validationRuntime.setSha256;
  const reviewedEvidenceBundleSha256 = evidenceBundleSha256(document);
  const roleProvenanceSha256 = document.roleProvenanceSha256;
  const artifactInventorySha256 = Array.isArray(document.artifactInventory)
    ? sha256(canonicalJson(document.artifactInventory))
    : null;
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
    evidenceBundleSha256: reviewedEvidenceBundleSha256,
    roleProvenanceSha256,
    requiredGates: [...document.requiredGates].sort(),
  };
  let assuranceLevelSha256;
  let catalogSnapshotsSha256;
  if (document.schema === "valdris.run-packet.v3") {
    assuranceLevelSha256 = sha256(document.assuranceLevel);
    catalogSnapshotsSha256 = sha256(canonicalJson(document.catalogSnapshots));
    envelope.assuranceLevelSha256 = assuranceLevelSha256;
    envelope.catalogSnapshotsSha256 = catalogSnapshotsSha256;
  }
  if (artifactInventorySha256)
    envelope.artifactInventorySha256 = artifactInventorySha256;
  const envelopeSha256 = sha256(canonicalJson(envelope));
  const bindings = {
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
    evidenceBundleSha256: reviewedEvidenceBundleSha256,
    roleProvenanceSha256,
  };
  if (artifactInventorySha256)
    bindings.artifactInventorySha256 = artifactInventorySha256;
  if (assuranceLevelSha256)
    bindings.assuranceLevelSha256 = assuranceLevelSha256;
  if (catalogSnapshotsSha256)
    bindings.catalogSnapshotsSha256 = catalogSnapshotsSha256;
  return { ...bindings, envelopeSha256 };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(runtimeRoot, script, args, cwd, env = process.env) {
  return spawnSync(
    process.execPath,
    [path.join(runtimeRoot, "scripts", script), ...args],
    {
      cwd,
      encoding: "utf8",
      env,
      shell: false,
    },
  );
}

function runGit(repoRoot, args) {
  return spawnSync("git", ["-C", repoRoot, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}

function expectOk(result, label) {
  assert(result.status === 0, `${label} failed:\n${output(result)}`);
}

function expectFailure(result, label, expectedText) {
  const text = output(result);
  assert(result.status !== 0, `${label} was unexpectedly accepted`);
  if (expectedText)
    assert(
      text.includes(expectedText),
      `${label} failed for the wrong reason; expected ${JSON.stringify(expectedText)} in:\n${text}`,
    );
}

function verifyGenuinePreV3PacketCompatibility() {
  // Historical CLIs compare argv[1] with import.meta.url lexically. Resolve the
  // macOS /var -> /private/var alias for both the outer worktree and every temp
  // fixture created by the pinned verifier so its nested CLI main guards run.
  const canonicalTempRoot = realpathSync(os.tmpdir());
  const worktreeParent = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "valdris-pre-v3-worktree-")),
  );
  const worktree = path.join(worktreeParent, "runtime");
  const fixtureParent = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "valdris-pre-v3-fixture-")),
  );
  const fixture = path.join(fixtureParent, "repository");
  const add = spawnSync(
    "git",
    [
      "-C",
      ROOT,
      "worktree",
      "add",
      "--detach",
      worktree,
      PRE_V3_RUNTIME_COMMIT,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  expectOk(add, "pre-v3 runtime worktree creation");
  try {
    const verifierPath = path.join(
      worktree,
      "scripts",
      "verify-run-packet-trust.mjs",
    );
    const source = readFileSync(verifierPath, "utf8");
    const marker =
      "console.log(JSON.stringify({ ok: true, positiveCases: 8, adversarialRejections: 38 }, null, 2));";
    assert(
      source.includes(marker),
      "pre-v3 verifier export marker is unavailable",
    );
    writeFileSync(
      verifierPath,
      source.replace(
        marker,
        `if (!process.env.VALDRIS_LEGACY_FIXTURE_OUT) throw new Error("legacy fixture export path is required");\n    cpSync(repoRoot, process.env.VALDRIS_LEGACY_FIXTURE_OUT, { recursive: true });\n    ${marker}`,
      ),
      "utf8",
    );
    const historical = spawnSync(process.execPath, [verifierPath], {
      cwd: worktree,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        TMPDIR: canonicalTempRoot,
        TMP: canonicalTempRoot,
        TEMP: canonicalTempRoot,
        VALDRIS_LEGACY_FIXTURE_OUT: fixture,
      },
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    expectOk(historical, "pinned pre-v3 packet fixture generation");
    const packet = readJson(path.join(fixture, "run", "packet.json"));
    assert(
      packet.schema === "valdris.run-packet.v2" &&
        packet.assuranceLevel === undefined,
      "pinned pre-v3 creator did not emit a genuine v2 packet",
    );
    const reviewTrustSha256 = sha256(
      canonicalJson(
        readJson(path.join(fixture, "controls", "review-trust.v1.json")),
      ),
    );
    const currentValidation = run(
      ROOT,
      "run-packet-gate.mjs",
      ["--repo", fixture, "--file", "run/packet.json"],
      fixture,
      { ...process.env, UASH_REVIEW_TRUST_SHA256: reviewTrustSha256 },
    );
    expectOk(currentValidation, "current validation of genuine pre-v3 packet");
    const result = JSON.parse(currentValidation.stdout);
    assert(
      result.historical === true &&
        result.assuranceLevel === "structural" &&
        result.revalidationMode === "integrity-only",
      "genuine pre-v3 packet was promoted beyond structural evidence",
    );
  } finally {
    spawnSync("git", ["-C", ROOT, "worktree", "remove", "--force", worktree], {
      encoding: "utf8",
      windowsHide: true,
    });
    rmSync(worktreeParent, { recursive: true, force: true });
    rmSync(fixtureParent, { recursive: true, force: true });
  }
}

function copyRuntime(runtimeRoot) {
  for (const directory of ["scripts", "controls", "skills"]) {
    cpSync(path.join(ROOT, directory), path.join(runtimeRoot, directory), {
      recursive: true,
    });
  }
  const trajectoryGate = path.join(
    runtimeRoot,
    "scripts",
    "trajectory-gate.mjs",
  );
  const trajectorySource = readFileSync(trajectoryGate, "utf8").replace(
    'import { existsSync } from "node:fs";',
    'import { appendFileSync, existsSync } from "node:fs";',
  );
  writeFileSync(
    trajectoryGate,
    `${trajectorySource}\n// Deterministic test-fixture hook: this exists only in the committed temporary runtime.\n{\n  const repoArg = process.argv.indexOf("--repo");\n  const fixtureRoot = repoArg >= 0 ? path.resolve(process.argv[repoArg + 1]) : process.cwd();\n  if (process.env.VALDRIS_TEST_MUTATE_GOAL === "1") {\n    appendFileSync(path.join(fixtureRoot, "goal", "goal.json"), "\\n ");\n  }\n}\n`,
    "utf8",
  );
  return runtimeRoot;
}

function refreshPacketInputs(packet, repoRoot) {
  for (const input of Object.values(packet.inputs)) {
    input.sha256 = sha256(readFileSync(path.join(repoRoot, input.path)));
  }
  packet.bindings = packetBindings(packet);
}

function refreshPacketGate(packet, repoRoot, gate) {
  const artifact = packet.gateArtifacts.find((entry) => entry.gate === gate);
  assert(artifact, `packet is missing gate ${gate}`);
  artifact.sha256 = sha256(readFileSync(path.join(repoRoot, artifact.path)));
  packet.bindings = packetBindings(packet);
}

function approvalEvidence(goal, conditionId, approvedAt, expiresAt) {
  return {
    type: "approval",
    subject: conditionId,
    runId: goal.goalId,
    commit: goal.commit,
    environment: goal.environment,
    trustTier: "human-approved",
    producer: {
      name: "Synthetic Packet Owner",
      version: "1.0.0",
      kind: "human",
    },
    actorType: "human",
    actor: "Synthetic Packet Owner",
    approvalId: `APPROVAL-${conditionId.toUpperCase()}`,
    scope: conditionId,
    status: "granted",
    approvedAt,
    expiresAt,
  };
}

function verifyReviewTrustStoreSchema(root) {
  const repoRoot = path.join(root, "review-trust-schema");
  mkdirSync(repoRoot, { recursive: true });
  const runtimeRoot = copyRuntime(repoRoot);
  const { publicKey } = generateKeyPairSync("ed25519");
  const readmePath = path.join(repoRoot, "README.md");
  writeFileSync(
    readmePath,
    "# Synthetic review trust schema fixture\n",
    "utf8",
  );
  const baseKey = {
    keyId: "EXAMPLE-REVIEW-KEY-001",
    algorithm: "ed25519",
    status: "active",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    allowedActorIds: ["EXAMPLE-ACTOR-REVIEWER"],
    allowedActorTypes: ["agent"],
  };

  function expectRejected(keys, label, expectedText) {
    const trustStore = { schema: "valdris.review-trust.v1", keys };
    const reviewTrustSha256 = sha256(canonicalJson(trustStore));
    writeJson(
      path.join(repoRoot, "controls", "review-trust.v1.json"),
      trustStore,
    );
    writeJson(path.join(repoRoot, "review", "review.json"), {
      schema: "valdris.review.v2",
      generatedAt: "2026-01-01T00:00:00.000Z",
      runId: "EXAMPLE-REVIEW-TRUST-SCHEMA-001",
      commit: "EXAMPLE-COMMIT",
      environment: "synthetic-test",
      status: "passed",
      subject: {
        artifact: "README.md",
        sha256: sha256(readFileSync(readmePath)),
      },
      reviewTrustSha256,
      validationRuntimeSha256: "a".repeat(64),
      evidenceBundleSha256: "b".repeat(64),
      roleProvenance: {
        schema: "valdris.review-role-provenance.v1",
        independentReviewer: {
          actorId: "EXAMPLE-ACTOR-REVIEWER",
          actorType: "agent",
          sessionId: "EXAMPLE-SESSION-REVIEW",
          executionId: "EXAMPLE-EXECUTION-REVIEW",
          evidence: { kind: "review-evidence-bundle", sha256: "b".repeat(64) },
        },
      },
      decision: {
        status: "accepted",
        summary: "Synthetic trust-store schema review.",
      },
      findings: [],
      blockers: [],
      attestation: {
        scheme: "ed25519",
        keyId: "EXAMPLE-REVIEW-KEY-001",
        signedAt: "2026-01-01T00:00:00.000Z",
        payloadSha256: "c".repeat(64),
        signature: "AA==",
      },
    });
    expectFailure(
      run(
        runtimeRoot,
        "review-gate.mjs",
        ["--repo", repoRoot, "--file", "review/review.json"],
        repoRoot,
        { ...process.env, UASH_REVIEW_TRUST_SHA256: reviewTrustSha256 },
      ),
      label,
      expectedText,
    );
  }

  expectRejected(
    [{ ...baseKey, allowedActorIds: "EXAMPLE-ACTOR-REVIEWER" }],
    "review trust store with a scalar allowedActorIds allowlist",
    "review trust store key 1 allowedActorIds must be a non-empty array when present",
  );
  expectRejected(
    [{ ...baseKey, allowedActorTypes: "agent" }],
    "review trust store with a scalar allowedActorTypes allowlist",
    "review trust store key 1 allowedActorTypes must be a non-empty array when present",
  );
  const typoActorKey = { ...baseKey, allowedActorId: "EXAMPLE-ACTOR-REVIEWER" };
  delete typoActorKey.allowedActorIds;
  expectRejected(
    [typoActorKey],
    "review trust store with a misspelled actor allowlist field",
    "review trust store key 1 contains unsupported field: allowedActorId",
  );
  expectRejected(
    [baseKey, { ...baseKey, keyId: "../ATTACKER-KEY", status: "revoked" }],
    "review trust store with an unsafe unrelated keyId",
    "review trust store key 2 keyId is invalid",
  );
  expectRejected(
    [baseKey, { ...baseKey, status: "revoked" }],
    "review trust store with a duplicate keyId across statuses",
    "review trust store key 2 keyId duplicates key 1",
  );
  expectRejected(
    [
      baseKey,
      { ...baseKey, keyId: "EXAMPLE-OTHER-KEY-001", status: "enabled" },
    ],
    "review trust store with an unsupported key status",
    "review trust store key 2 status must be active or revoked",
  );
  expectRejected(
    [
      baseKey,
      {
        ...baseKey,
        keyId: "EXAMPLE-OTHER-KEY-001",
        status: "revoked",
        algorithm: "rsa",
      },
    ],
    "review trust store with an unsupported algorithm on an unrelated key",
    "review trust store key 2 algorithm must be ed25519",
  );
  expectRejected(
    [{ ...baseKey, allowedActorIds: [] }],
    "review trust store with an empty allowedActorIds allowlist",
    "review trust store key 1 allowedActorIds must be a non-empty array when present",
  );
  expectRejected(
    [{ ...baseKey, allowedActorTypes: [] }],
    "review trust store with an empty allowedActorTypes allowlist",
    "review trust store key 1 allowedActorTypes must be a non-empty array when present",
  );
  expectRejected(
    [{ ...baseKey, allowedActorIds: ["../ATTACKER"] }],
    "review trust store with an unsafe actor allowlist entry",
    "review trust store key 1 allowedActorIds entry 1 is invalid",
  );
  expectRejected(
    [{ ...baseKey, allowedActorTypes: ["robot"] }],
    "review trust store with an unsupported actor type allowlist entry",
    "review trust store key 1 allowedActorTypes entry 1 is invalid",
  );
}

function createValidPacketFixture(root) {
  const repoRoot = path.join(root, "target");
  mkdirSync(repoRoot, { recursive: true });
  const runtimeRoot = copyRuntime(repoRoot);
  const keyId = "EXAMPLE-REVIEW-KEY-001";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(
    path.join(repoRoot, "README.md"),
    "# Synthetic packet trust fixture\n",
    "utf8",
  );
  mkdirSync(path.join(repoRoot, "run"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "run", "app.js"),
    "export const productRuntime = true;\n",
    "utf8",
  );
  writeJson(path.join(repoRoot, "controls", "review-trust.v1.json"), {
    schema: "valdris.review-trust.v1",
    keys: [
      {
        keyId,
        algorithm: "ed25519",
        status: "active",
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        allowedActorIds: ["EXAMPLE-ACTOR-REVIEWER"],
        allowedActorTypes: ["agent"],
      },
    ],
  });
  const reviewTrustSha256 = sha256(
    canonicalJson(
      readJson(path.join(repoRoot, "controls", "review-trust.v1.json")),
    ),
  );
  process.env.UASH_REVIEW_TRUST_SHA256 = reviewTrustSha256;
  for (const [args, label] of [
    [["init"], "fixture git init"],
    [["config", "user.email", "fixture@example.com"], "fixture git email"],
    [["config", "user.name", "Synthetic Packet Owner"], "fixture git name"],
    [["add", "."], "fixture git add"],
    [
      ["commit", "-m", "test: initialize packet trust fixture"],
      "fixture git commit",
    ],
  ])
    expectOk(runGit(repoRoot, args), label);
  const runId = "EXAMPLE-PACKET-TRUST-001";
  const environment = "synthetic-test";
  const routeRequest = run(
    runtimeRoot,
    "route-request.mjs",
    [
      "--repo",
      repoRoot,
      "--run-id",
      runId,
      "--profile",
      "prototype",
      "--environment",
      environment,
      "--actor",
      "Synthetic Packet Owner",
      "--request",
      "Copy edit the README wording only.",
    ],
    repoRoot,
  );
  expectOk(routeRequest, "route-request fixture creation");
  assert(
    readJson(path.join(repoRoot, "run", "route.json")).taskType === "docs-only",
    "fixture request did not produce a docs-only route",
  );
  const routedInputs = {
    intake: readJson(path.join(repoRoot, "run", "intake.json")),
    classification: readJson(
      path.join(repoRoot, "run", "workload-classification.json"),
    ),
    route: readJson(path.join(repoRoot, "run", "route.json")),
  };
  for (const assuranceLevel of ["semantic", "authoritative"]) {
    const required = routeRequiredGates(
      routedInputs.route,
      routedInputs.intake,
      routedInputs.classification,
      { assuranceLevel },
    );
    for (const gate of [
      "eval",
      "trajectory",
      "smoke",
      "authoritative-assurance",
    ])
      assert(
        required.includes(gate),
        `${assuranceLevel} closure omitted required evidence gate ${gate}`,
      );
  }

  const goalPath = path.join(repoRoot, "goal", "goal.json");
  const goal = readJson(goalPath);
  const completedAt = new Date().toISOString();
  const approvedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const expiresAt = new Date(
    Date.parse(completedAt) + 60 * 60 * 1000,
  ).toISOString();
  goal.revision += 1;
  goal.generatedAt = completedAt;
  goal.updatedAt = completedAt;
  goal.status = "completed";
  goal.stoppingConditions = goal.stoppingConditions.map((condition) => ({
    ...condition,
    status: "passed",
    evidence: [approvalEvidence(goal, condition.id, approvedAt, expiresAt)],
  }));
  goal.checkpoints = goal.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    status: "passed",
    summary: "Synthetic docs-only route completed with packet trust proof.",
  }));
  writeJson(goalPath, goal);

  const tracePath = path.join(repoRoot, "trajectory", "trace.jsonl");
  mkdirSync(path.dirname(tracePath), { recursive: true });
  writeFileSync(
    tracePath,
    `${JSON.stringify({ runId, event: "synthetic-packet-complete" })}\n`,
    "utf8",
  );
  writeJson(path.join(repoRoot, "trajectory", "trajectory.json"), {
    schema: "uash.trajectory.v1",
    goalId: runId,
    generatedAt: completedAt,
    profile: goal.profile,
    commit: goal.commit,
    environment,
    finalStatus: "completed",
    budget: {
      limits: goal.budgets,
      used: {
        attempts: 1,
        toolCalls: 1,
        tokens: 1,
        costUsd: 0,
        wallClockMinutes: 1,
      },
    },
    attempts: [
      {
        id: "ATTEMPT-001",
        outcome: "succeeded",
        usage: { toolCalls: 1, tokens: 1, costUsd: 0, wallClockMinutes: 1 },
        actions: ["copy edit documentation"],
        startedAt: approvedAt,
        completedAt,
      },
    ],
    forbiddenActions: [],
    violations: [],
    tracePath: "trajectory/trace.jsonl",
    traceDigest: sha256(readFileSync(tracePath)),
  });

  const proof = run(
    runtimeRoot,
    "proof-runner.mjs",
    [
      "--repo",
      repoRoot,
      "--run-id",
      runId,
      "--commit",
      goal.commit,
      "--environment",
      environment,
      "--output",
      "proof/portable.json",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('packet-trust-ok')",
    ],
    repoRoot,
  );
  expectOk(proof, "portable proof fixture creation");
  const proofPath = path.join(repoRoot, "proof", "portable.json");
  const proofDigest = sha256(readFileSync(proofPath));
  writeJson(path.join(repoRoot, "evals", "results.json"), {
    schema: "synthetic.eval-results.v1",
  });
  writeJson(path.join(repoRoot, "smoke", "smoke_proof.json"), {
    schema: "synthetic.smoke-proof.v1",
  });
  for (const assuranceLevel of ["semantic", "authoritative"]) {
    const acceptedGateSet = run(
      runtimeRoot,
      "run-create.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        runId,
        "--commit",
        goal.commit,
        "--environment",
        environment,
        "--assurance-level",
        assuranceLevel,
        "--proof",
        "proof/portable.json",
        "--gate",
        "eval=evals/results.json",
        "--gate",
        "trajectory=trajectory/trajectory.json",
        "--gate",
        "smoke=smoke/smoke_proof.json",
        "--print-accepted-gate-set",
      ],
      repoRoot,
    );
    expectOk(
      acceptedGateSet,
      `${assuranceLevel} pre-closure gate-set creation for a docs-only route`,
    );
    assert(
      /^[a-f0-9]{64}$/u.test(
        JSON.parse(acceptedGateSet.stdout).acceptedGateArtifactsSha256 || "",
      ),
      `${assuranceLevel} docs-only pre-closure gate set was not digest-bound`,
    );
  }
  rmSync(path.join(repoRoot, "evals"), { recursive: true, force: true });
  rmSync(path.join(repoRoot, "smoke"), { recursive: true, force: true });
  const runtimeBindingResult = run(
    runtimeRoot,
    "run-packet-gate.mjs",
    ["--repo", repoRoot, "--print-runtime-binding", "--commit", goal.commit],
    repoRoot,
  );
  expectOk(runtimeBindingResult, "validation runtime binding creation");
  const runtimeBinding = JSON.parse(runtimeBindingResult.stdout);
  assert(
    runtimeBinding.source?.runtimePath === ".",
    "root validation runtime must use the Git-native worktree-relative path",
  );
  const evidenceBundleResult = run(
    runtimeRoot,
    "run-create.mjs",
    [
      "--repo",
      repoRoot,
      "--run-id",
      runId,
      "--commit",
      goal.commit,
      "--environment",
      environment,
      "--proof",
      "proof/portable.json",
      "--gate",
      "trajectory=trajectory/trajectory.json",
      "--print-evidence-bundle",
    ],
    repoRoot,
  );
  expectOk(evidenceBundleResult, "review evidence bundle creation");
  const evidenceBundle = JSON.parse(evidenceBundleResult.stdout);
  const review = {
    schema: "valdris.review.v2",
    generatedAt: completedAt,
    runId,
    commit: goal.commit,
    environment,
    status: "passed",
    subject: { artifact: "proof/portable.json", sha256: proofDigest },
    reviewTrustSha256,
    validationRuntimeSha256: runtimeBinding.setSha256,
    evidenceBundleSha256: evidenceBundle.evidenceBundleSha256,
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
          sha256: sha256(
            readFileSync(path.join(repoRoot, "run", "route.json")),
          ),
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
          sha256: proofDigest,
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
          sha256: proofDigest,
        },
      },
      independentReviewer: {
        actorId: "EXAMPLE-ACTOR-REVIEWER",
        actorType: "agent",
        sessionId: "EXAMPLE-SESSION-REVIEW",
        executionId: "EXAMPLE-EXECUTION-REVIEW",
        evidence: {
          kind: "review-evidence-bundle",
          sha256: evidenceBundle.evidenceBundleSha256,
        },
      },
    },
    decision: {
      status: "accepted",
      summary: "Synthetic packet proof satisfies the focused trust contract.",
    },
    findings: [],
    blockers: [],
  };
  review.attestation = { scheme: "ed25519", keyId, signedAt: completedAt };
  const serializedAttestation = canonicalJson(reviewAttestationPayload(review));
  review.attestation.payloadSha256 = sha256(serializedAttestation);
  review.attestation.signature = signPayload(
    null,
    Buffer.from(serializedAttestation, "utf8"),
    privateKey,
  ).toString("base64");
  writeJson(path.join(repoRoot, "review", "review.json"), review);

  const environmentWithoutReviewTrust = { ...process.env };
  delete environmentWithoutReviewTrust.UASH_REVIEW_TRUST_SHA256;
  expectFailure(
    run(
      runtimeRoot,
      "review-gate.mjs",
      ["--repo", repoRoot, "--file", "review/review.json"],
      repoRoot,
      environmentWithoutReviewTrust,
    ),
    "signed review without an operator-held trust-store pin",
    "UASH_REVIEW_TRUST_SHA256 is required",
  );
  expectFailure(
    run(
      runtimeRoot,
      "review-gate.mjs",
      ["--repo", repoRoot, "--file", "review/review.json"],
      repoRoot,
      { ...process.env, UASH_REVIEW_TRUST_SHA256: "not-a-sha256-digest" },
    ),
    "signed review with a malformed trust-store pin",
    "UASH_REVIEW_TRUST_SHA256 must be a 64-character SHA-256 digest",
  );

  const trustStorePath = path.join(
    repoRoot,
    "controls",
    "review-trust.v1.json",
  );
  const trustStoreSource = readFileSync(trustStorePath, "utf8");
  try {
    writeFileSync(
      trustStorePath,
      trustStoreSource.replace(/\r?\n/g, "\r\n"),
      "utf8",
    );
    expectOk(
      run(
        runtimeRoot,
        "review-gate.mjs",
        ["--repo", repoRoot, "--file", "review/review.json"],
        repoRoot,
      ),
      "signed review with a Git-equivalent CRLF trust store",
    );
  } finally {
    writeFileSync(trustStorePath, trustStoreSource, "utf8");
  }

  const packet = run(
    runtimeRoot,
    "run-create.mjs",
    [
      "--repo",
      repoRoot,
      "--run-id",
      runId,
      "--commit",
      goal.commit,
      "--environment",
      environment,
      "--proof",
      "proof/portable.json",
      "--review",
      "review/review.json",
      "--gate",
      "trajectory=trajectory/trajectory.json",
      "--output",
      "run/packet.json",
    ],
    repoRoot,
  );
  expectOk(packet, "valid packet fixture creation");
  expectOk(
    run(
      runtimeRoot,
      "run-packet-gate.mjs",
      ["--repo", repoRoot, "--file", "run/packet.json"],
      repoRoot,
    ),
    "valid packet fixture validation",
  );
  return { runtimeRoot, repoRoot, reviewTrustSha256 };
}

function verifyNativeCorrectiveRoute(root) {
  const repoRoot = path.join(root, "corrective-route");
  mkdirSync(repoRoot, { recursive: true });
  const runtimeRoot = copyRuntime(repoRoot);
  writeFileSync(
    path.join(repoRoot, "README.md"),
    "# Corrective route fixture\n",
    "utf8",
  );
  for (const [args, label] of [
    [["init"], "corrective fixture git init"],
    [
      ["config", "user.email", "fixture@example.com"],
      "corrective fixture git email",
    ],
    [
      ["config", "user.name", "Synthetic Packet Owner"],
      "corrective fixture git name",
    ],
    [["add", "."], "corrective fixture git add"],
    [
      ["commit", "-m", "test: initialize corrective route fixture"],
      "corrective fixture git commit",
    ],
  ])
    expectOk(runGit(repoRoot, args), label);
  expectOk(
    run(
      runtimeRoot,
      "route-request.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        "EXAMPLE-CORRECTIVE-ROUTE-001",
        "--profile",
        "prototype",
        "--environment",
        "synthetic-test",
        "--actor",
        "Synthetic Packet Owner",
        "--request",
        "Perform corrective self-heal remediation for the failed harness run.",
      ],
      repoRoot,
    ),
    "native corrective route creation",
  );
  const intake = readJson(path.join(repoRoot, "run", "intake.json"));
  const classification = readJson(
    path.join(repoRoot, "run", "workload-classification.json"),
  );
  const route = readJson(path.join(repoRoot, "run", "route.json"));
  for (const [script, label] of [
    ["intake-gate.mjs", "corrective intake"],
    ["workload-classification-gate.mjs", "corrective classification"],
    ["route-gate.mjs", "corrective route"],
  ])
    expectOk(run(runtimeRoot, script, ["--repo", repoRoot], repoRoot), label);
  assert(
    routeRequiresRca(route, intake, classification),
    "native-valid corrective self-heal route did not require RCA",
  );
  assert(
    routeRequiredGates(route, intake, classification).includes("rca"),
    "native-valid corrective self-heal gate set omitted RCA",
  );
}

function verifyReviewTrustSelfEnrollmentRejected(
  runtimeRoot,
  repoRoot,
  operatorTrustSha256,
) {
  const attackerKeyId = "ATTACKER-SELF-ENROLLED-KEY";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const trustStorePath = path.join(
    repoRoot,
    "controls",
    "review-trust.v1.json",
  );
  writeJson(trustStorePath, {
    schema: "valdris.review-trust.v1",
    keys: [
      {
        keyId: attackerKeyId,
        algorithm: "ed25519",
        status: "active",
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        allowedActorIds: ["ATTACKER-INDEPENDENT-REVIEWER"],
        allowedActorTypes: ["agent"],
      },
    ],
  });
  expectOk(
    runGit(repoRoot, ["add", "controls/review-trust.v1.json"]),
    "self-enrollment trust-store stage",
  );
  expectOk(
    runGit(repoRoot, [
      "commit",
      "-m",
      "test: attacker self-enrolls review key",
    ]),
    "self-enrollment trust-store commit",
  );
  const attackerTrustSha256 = sha256(canonicalJson(readJson(trustStorePath)));
  const attackerEnvironment = {
    ...process.env,
    UASH_REVIEW_TRUST_SHA256: attackerTrustSha256,
  };
  const operatorEnvironment = {
    ...process.env,
    UASH_REVIEW_TRUST_SHA256: operatorTrustSha256,
  };

  for (const file of [
    "intake.json",
    "workload-classification.json",
    "route.json",
    "packet.json",
  ]) {
    rmSync(path.join(repoRoot, "run", file), { force: true });
  }
  for (const directory of ["goal", "proof", "review", "trajectory"]) {
    rmSync(path.join(repoRoot, directory), { recursive: true, force: true });
  }

  const runId = "EXAMPLE-SELF-ENROLLMENT-ATTACK-001";
  const environment = "synthetic-test";
  expectOk(
    run(
      runtimeRoot,
      "route-request.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        runId,
        "--profile",
        "prototype",
        "--environment",
        environment,
        "--actor",
        "Synthetic Packet Owner",
        "--request",
        "Copy edit one documentation sentence.",
      ],
      repoRoot,
      attackerEnvironment,
    ),
    "self-enrollment route creation",
  );

  const goalPath = path.join(repoRoot, "goal", "goal.json");
  const goal = readJson(goalPath);
  const completedAt = new Date().toISOString();
  const approvedAt = new Date(Date.parse(completedAt) - 1000).toISOString();
  const expiresAt = new Date(
    Date.parse(completedAt) + 60 * 60 * 1000,
  ).toISOString();
  goal.revision += 1;
  goal.generatedAt = completedAt;
  goal.updatedAt = completedAt;
  goal.status = "completed";
  goal.stoppingConditions = goal.stoppingConditions.map((condition) => ({
    ...condition,
    status: "passed",
    evidence: [approvalEvidence(goal, condition.id, approvedAt, expiresAt)],
  }));
  goal.checkpoints = goal.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    status: "passed",
    summary: "Self-enrollment adversary fixture reached review closure.",
  }));
  writeJson(goalPath, goal);

  const tracePath = path.join(repoRoot, "trajectory", "trace.jsonl");
  mkdirSync(path.dirname(tracePath), { recursive: true });
  writeFileSync(
    tracePath,
    `${JSON.stringify({ runId, event: "self-enrollment-attack" })}\n`,
    "utf8",
  );
  writeJson(path.join(repoRoot, "trajectory", "trajectory.json"), {
    schema: "uash.trajectory.v1",
    goalId: runId,
    generatedAt: completedAt,
    profile: goal.profile,
    commit: goal.commit,
    environment,
    finalStatus: "completed",
    budget: {
      limits: goal.budgets,
      used: {
        attempts: 1,
        toolCalls: 1,
        tokens: 1,
        costUsd: 0,
        wallClockMinutes: 1,
      },
    },
    attempts: [
      {
        id: "ATTACK-ATTEMPT-001",
        outcome: "succeeded",
        usage: { toolCalls: 1, tokens: 1, costUsd: 0, wallClockMinutes: 1 },
        actions: ["self-enroll attacker review key"],
        startedAt: approvedAt,
        completedAt,
      },
    ],
    forbiddenActions: [],
    violations: [],
    tracePath: "trajectory/trace.jsonl",
    traceDigest: sha256(readFileSync(tracePath)),
  });

  expectOk(
    run(
      runtimeRoot,
      "proof-runner.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        runId,
        "--commit",
        goal.commit,
        "--environment",
        environment,
        "--output",
        "proof/portable.json",
        "--",
        process.execPath,
        "-e",
        "process.stdout.write('self-enrollment-proof')",
      ],
      repoRoot,
      attackerEnvironment,
    ),
    "self-enrollment portable proof",
  );
  const proofDigest = sha256(
    readFileSync(path.join(repoRoot, "proof", "portable.json")),
  );
  const runtimeBindingResult = run(
    runtimeRoot,
    "run-packet-gate.mjs",
    ["--repo", repoRoot, "--print-runtime-binding", "--commit", goal.commit],
    repoRoot,
    attackerEnvironment,
  );
  expectOk(runtimeBindingResult, "self-enrollment validation runtime binding");
  const runtimeBinding = JSON.parse(runtimeBindingResult.stdout);
  const evidenceBundleResult = run(
    runtimeRoot,
    "run-create.mjs",
    [
      "--repo",
      repoRoot,
      "--run-id",
      runId,
      "--commit",
      goal.commit,
      "--environment",
      environment,
      "--proof",
      "proof/portable.json",
      "--gate",
      "trajectory=trajectory/trajectory.json",
      "--print-evidence-bundle",
    ],
    repoRoot,
    attackerEnvironment,
  );
  expectOk(evidenceBundleResult, "self-enrollment evidence bundle");
  const evidenceBundleSha256 = JSON.parse(
    evidenceBundleResult.stdout,
  ).evidenceBundleSha256;
  const review = {
    schema: "valdris.review.v2",
    generatedAt: completedAt,
    runId,
    commit: goal.commit,
    environment,
    status: "passed",
    subject: { artifact: "proof/portable.json", sha256: proofDigest },
    reviewTrustSha256: attackerTrustSha256,
    validationRuntimeSha256: runtimeBinding.setSha256,
    evidenceBundleSha256,
    roleProvenance: {
      schema: "valdris.review-role-provenance.v1",
      scout: {
        actorId: "ATTACKER-SCOUT",
        actorType: "agent",
        sessionId: "ATTACKER-SCOUT-SESSION",
        executionId: "ATTACKER-SCOUT-EXECUTION",
        evidence: {
          kind: "artifact",
          path: "run/route.json",
          sha256: sha256(
            readFileSync(path.join(repoRoot, "run", "route.json")),
          ),
        },
      },
      implementer: {
        actorId: "ATTACKER-IMPLEMENTER",
        actorType: "agent",
        sessionId: "ATTACKER-IMPLEMENTER-SESSION",
        executionId: "ATTACKER-IMPLEMENTER-EXECUTION",
        evidence: {
          kind: "artifact",
          path: "proof/portable.json",
          sha256: proofDigest,
        },
      },
      verifier: {
        actorId: "ATTACKER-VERIFIER",
        actorType: "agent",
        sessionId: "ATTACKER-VERIFIER-SESSION",
        executionId: "ATTACKER-VERIFIER-EXECUTION",
        evidence: {
          kind: "artifact",
          path: "proof/portable.json",
          sha256: proofDigest,
        },
      },
      independentReviewer: {
        actorId: "ATTACKER-INDEPENDENT-REVIEWER",
        actorType: "agent",
        sessionId: "ATTACKER-REVIEW-SESSION",
        executionId: "ATTACKER-REVIEW-EXECUTION",
        evidence: {
          kind: "review-evidence-bundle",
          sha256: evidenceBundleSha256,
        },
      },
    },
    decision: {
      status: "accepted",
      summary:
        "Attacker-controlled review is internally consistent but externally unauthorized.",
    },
    findings: [],
    blockers: [],
  };
  review.attestation = {
    scheme: "ed25519",
    keyId: attackerKeyId,
    signedAt: completedAt,
  };
  const serialized = canonicalJson(reviewAttestationPayload(review));
  review.attestation.payloadSha256 = sha256(serialized);
  review.attestation.signature = signPayload(
    null,
    Buffer.from(serialized, "utf8"),
    privateKey,
  ).toString("base64");
  writeJson(path.join(repoRoot, "review", "review.json"), review);

  expectOk(
    run(
      runtimeRoot,
      "review-gate.mjs",
      ["--repo", repoRoot],
      repoRoot,
      attackerEnvironment,
    ),
    "attacker-local self-enrolled review fixture",
  );
  expectFailure(
    run(
      runtimeRoot,
      "review-gate.mjs",
      ["--repo", repoRoot],
      repoRoot,
      operatorEnvironment,
    ),
    "self-enrolled attacker review under retained operator pin",
    "does not match operator-held UASH_REVIEW_TRUST_SHA256",
  );
  expectOk(
    run(
      runtimeRoot,
      "run-create.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        runId,
        "--commit",
        goal.commit,
        "--environment",
        environment,
        "--proof",
        "proof/portable.json",
        "--review",
        "review/review.json",
        "--gate",
        "trajectory=trajectory/trajectory.json",
        "--output",
        "run/packet.json",
      ],
      repoRoot,
      attackerEnvironment,
    ),
    "attacker-local self-enrolled packet fixture",
  );
  expectOk(
    run(
      runtimeRoot,
      "run-packet-gate.mjs",
      ["--repo", repoRoot],
      repoRoot,
      attackerEnvironment,
    ),
    "attacker-local self-enrolled packet validation",
  );
  expectFailure(
    run(
      runtimeRoot,
      "run-packet-gate.mjs",
      ["--repo", repoRoot],
      repoRoot,
      operatorEnvironment,
    ),
    "self-enrolled attacker packet under retained operator pin",
    "does not match operator-held UASH_REVIEW_TRUST_SHA256",
  );
}

function main() {
  verifyGenuinePreV3PacketCompatibility();
  const featureIntake = {
    requestText: "Build a self-healing capability for the workflow engine.",
  };
  featureIntake.requestSha256 = sha256(featureIntake.requestText);
  assert(
    routeRequiresRca(
      { taskType: "feature", requestSignals: ["self-healing capability"] },
      featureIntake,
      { taskType: "feature", requestSha256: featureIntake.requestSha256 },
    ) === false,
    "feature request for a self-healing capability was incorrectly classified as corrective RCA work",
  );
  const correctiveIntake = {
    requestText:
      "Perform corrective self-heal remediation for the failed harness run.",
  };
  correctiveIntake.requestSha256 = sha256(correctiveIntake.requestText);
  assert(
    routeRequiresRca(
      {
        taskType: "feature",
        requestSignals: ["corrective self-heal remediation"],
      },
      correctiveIntake,
      { taskType: "feature", requestSha256: correctiveIntake.requestSha256 },
    ) === true,
    "intake-bound corrective self-heal work did not require RCA",
  );
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "valdris-run-packet-trust-")),
  );
  try {
    verifyReviewTrustStoreSchema(root);
    verifyNativeCorrectiveRoute(root);
    const { runtimeRoot, repoRoot, reviewTrustSha256 } =
      createValidPacketFixture(root);
    const packet = readJson(path.join(repoRoot, "run", "packet.json"));
    assert(
      packet.bindings?.generatedAtSha256 === sha256(packet.generatedAt),
      "run packet did not digest-bind generatedAt",
    );
    assert(
      /^[a-f0-9]{64}$/.test(packet.roleProvenanceSha256 || ""),
      "run packet did not expose the signed four-role provenance digest",
    );
    assert(
      packet.validationRuntime?.reviewTrustSha256 === reviewTrustSha256,
      "run packet validation runtime did not bind the operator-held review trust-store pin",
    );
    const packetPath = path.join(repoRoot, "run", "packet.json");
    const originalPacket = readFileSync(packetPath, "utf8");

    const substitutedCatalog = structuredClone(packet);
    substitutedCatalog.catalogSnapshots[0].document = {
      ...substitutedCatalog.catalogSnapshots[0].document,
      description: "recomputed substitution",
    };
    substitutedCatalog.catalogSnapshots[0].sha256 = sha256(
      canonicalJson(substitutedCatalog.catalogSnapshots[0].document),
    );
    substitutedCatalog.bindings = packetBindings(substitutedCatalog);
    writeJson(
      path.join(repoRoot, "run", "substituted-catalog-packet.json"),
      substitutedCatalog,
    );
    expectFailure(
      run(
        runtimeRoot,
        "run-packet-gate.mjs",
        ["--repo", repoRoot, "--file", "run/substituted-catalog-packet.json"],
        repoRoot,
      ),
      "packet with a recomputed embedded catalog substitution",
      "document does not match packet-commit source bytes",
    );
    rmSync(path.join(repoRoot, "run", "substituted-catalog-packet.json"), {
      force: true,
    });

    const forgedRoleDigest = structuredClone(packet);
    forgedRoleDigest.roleProvenanceSha256 = "f".repeat(64);
    forgedRoleDigest.bindings = packetBindings(forgedRoleDigest);
    writeJson(
      path.join(repoRoot, "run", "forged-role-provenance-packet.json"),
      forgedRoleDigest,
    );
    expectFailure(
      run(
        runtimeRoot,
        "run-packet-gate.mjs",
        [
          "--repo",
          repoRoot,
          "--file",
          "run/forged-role-provenance-packet.json",
        ],
        repoRoot,
      ),
      "packet with a rebound forged four-role provenance digest",
      "run packet role provenance digest does not match the signed independent review",
    );
    rmSync(path.join(repoRoot, "run", "forged-role-provenance-packet.json"), {
      force: true,
    });
    try {
      const nonCanonicalTimestamp = structuredClone(packet);
      nonCanonicalTimestamp.generatedAt =
        nonCanonicalTimestamp.generatedAt.replace(/\.\d{3}Z$/, "Z");
      nonCanonicalTimestamp.bindings = packetBindings(nonCanonicalTimestamp);
      writeJson(packetPath, nonCanonicalTimestamp);
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
        ),
        "packet with a parseable but non-canonical timestamp",
        "generatedAt must be a canonical ISO timestamp",
      );

      const reboundTimestamp = structuredClone(packet);
      reboundTimestamp.generatedAt = new Date(
        Date.parse(reboundTimestamp.generatedAt) + 1000,
      ).toISOString();
      writeJson(packetPath, reboundTimestamp);
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
        ),
        "packet whose generatedAt changed without rebinding",
        "binding generatedAtSha256 does not match",
      );
    } finally {
      writeFileSync(packetPath, originalPacket, "utf8");
    }

    try {
      const forgedRuntimeIdentity = structuredClone(packet);
      forgedRuntimeIdentity.validationRuntime.runtimeSha256 = "0".repeat(64);
      forgedRuntimeIdentity.bindings = packetBindings(forgedRuntimeIdentity);
      writeJson(packetPath, forgedRuntimeIdentity);
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
        ),
        "packet with a forged stable runtime identity",
        "runtimeSha256 does not match the trusted runtime and loader content",
      );
    } finally {
      writeFileSync(packetPath, originalPacket, "utf8");
    }

    const optionalRcaPath = path.join(repoRoot, "rca", "rca.json");
    writeJson(optionalRcaPath, {
      schema: "valdris.rca.v1",
      status: "confirmed",
      marker: "before-review",
    });
    expectFailure(
      run(
        runtimeRoot,
        "run-packet-gate.mjs",
        ["--repo", repoRoot, "--file", "run/packet.json"],
        repoRoot,
      ),
      "packet that omits a present canonical optional RCA artifact",
      "requiredGates must exactly match route-derived gates",
    );
    expectFailure(
      run(
        runtimeRoot,
        "run-create.mjs",
        [
          "--repo",
          repoRoot,
          "--run-id",
          packet.runId,
          "--commit",
          packet.commit,
          "--environment",
          packet.environment,
          "--proof",
          "proof/portable.json",
          "--gate",
          "trajectory=trajectory/trajectory.json",
          "--print-evidence-bundle",
        ],
        repoRoot,
      ),
      "review evidence creation that omits a present canonical optional RCA artifact",
      "required gate artifact was not supplied: rca",
    );
    const optionalRcaBundleResult = run(
      runtimeRoot,
      "run-create.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        packet.runId,
        "--commit",
        packet.commit,
        "--environment",
        packet.environment,
        "--proof",
        "proof/portable.json",
        "--rca",
        "rca/rca.json",
        "--gate",
        "trajectory=trajectory/trajectory.json",
        "--print-evidence-bundle",
      ],
      repoRoot,
    );
    expectOk(
      optionalRcaBundleResult,
      "review evidence creation with a present optional RCA artifact",
    );
    const optionalRcaBundle = JSON.parse(optionalRcaBundleResult.stdout);
    const optionalRcaBinding =
      optionalRcaBundle.evidenceBundle.gateArtifacts.find(
        ({ gate }) => gate === "rca",
      );
    assert(
      optionalRcaBundle.evidenceBundle.requiredGates.includes("rca"),
      "present optional RCA was omitted from review requiredGates",
    );
    assert(
      optionalRcaBinding?.path === "rca/rca.json",
      "present optional RCA was omitted from the review evidence bundle",
    );
    assert(
      optionalRcaBinding.sha256 === sha256(readFileSync(optionalRcaPath)),
      "review evidence bundle did not digest-bind the present optional RCA",
    );
    writeJson(optionalRcaPath, {
      schema: "valdris.rca.v1",
      status: "confirmed",
      marker: "after-review-tamper",
    });
    const tamperedRcaBundleResult = run(
      runtimeRoot,
      "run-create.mjs",
      [
        "--repo",
        repoRoot,
        "--run-id",
        packet.runId,
        "--commit",
        packet.commit,
        "--environment",
        packet.environment,
        "--proof",
        "proof/portable.json",
        "--rca",
        "rca/rca.json",
        "--gate",
        "trajectory=trajectory/trajectory.json",
        "--print-evidence-bundle",
      ],
      repoRoot,
    );
    expectOk(
      tamperedRcaBundleResult,
      "review evidence regeneration after optional RCA tamper",
    );
    assert(
      JSON.parse(tamperedRcaBundleResult.stdout).evidenceBundleSha256 !==
        optionalRcaBundle.evidenceBundleSha256,
      "optional RCA tamper did not change the signed review evidence digest",
    );
    writeJson(path.join(repoRoot, "rca", "unbound.json"), {
      schema: "synthetic.unbound-evidence.v1",
    });
    expectFailure(
      run(
        runtimeRoot,
        "run-packet-gate.mjs",
        ["--repo", repoRoot, "--file", "run/packet.json"],
        repoRoot,
      ),
      "packet after noncanonical post-proof RCA-like artifact creation",
      "application source changed after portable proof",
    );
    rmSync(path.join(repoRoot, "rca"), { recursive: true, force: true });

    const routePathForCodeIntelligence = path.join(
      repoRoot,
      "run",
      "route.json",
    );
    const originalRouteForCodeIntelligence = readFileSync(
      routePathForCodeIntelligence,
      "utf8",
    );
    try {
      expectOk(
        run(
          runtimeRoot,
          "code-intelligence-scan.mjs",
          ["--repo", repoRoot, "--provider", "local"],
          repoRoot,
        ),
        "code-intelligence supporting-artifact fixture scan",
      );
      const graphPath = path.join(repoRoot, "graph", "graph.json");
      const freshnessPath = path.join(repoRoot, "graph", "freshness.json");
      const anchorsPath = path.join(repoRoot, "design", "anchors.json");
      const providerEvidencePath = path.join(
        repoRoot,
        "graph",
        "gitnexus.json",
      );
      const graph = readJson(graphPath);
      graph.codeIntelligence = {
        provider: "gitnexus",
        primaryBackend: "GitNexus",
        evidenceArtifact: "graph/gitnexus.json",
      };
      writeJson(graphPath, graph);
      const freshness = readJson(freshnessPath);
      freshness.codeIntelligence = {
        provider: "gitnexus",
        primaryBackend: "GitNexus",
        evidenceArtifact: "graph/gitnexus.json",
      };
      writeJson(freshnessPath, freshness);
      writeJson(providerEvidencePath, {
        schema: "uash.gitnexus.evidence.v0.1",
        provider: "GitNexus",
        ok: true,
      });
      const codeIntelligenceRoute = readJson(routePathForCodeIntelligence);
      codeIntelligenceRoute.gateApplicability["code-intelligence"] = {
        status: "required",
      };
      writeJson(routePathForCodeIntelligence, codeIntelligenceRoute);

      const codeIntelligenceBundleResult = run(
        runtimeRoot,
        "run-create.mjs",
        [
          "--repo",
          repoRoot,
          "--run-id",
          packet.runId,
          "--commit",
          packet.commit,
          "--environment",
          packet.environment,
          "--proof",
          "proof/portable.json",
          "--gate",
          "trajectory=trajectory/trajectory.json",
          "--gate",
          "code-intelligence=graph/graph.json",
          "--print-evidence-bundle",
        ],
        repoRoot,
      );
      expectOk(
        codeIntelligenceBundleResult,
        "review evidence creation with code-intelligence sidecars",
      );
      const codeIntelligenceBundle = JSON.parse(
        codeIntelligenceBundleResult.stdout,
      );
      const codeIntelligenceBinding =
        codeIntelligenceBundle.evidenceBundle.gateArtifacts.find(
          ({ gate }) => gate === "code-intelligence",
        );
      assert(
        Array.isArray(codeIntelligenceBinding?.supportingArtifacts),
        "code-intelligence gate omitted supportingArtifacts from review evidence",
      );
      const supportByKind = new Map(
        codeIntelligenceBinding.supportingArtifacts.map((entry) => [
          entry.kind,
          entry,
        ]),
      );
      for (const [kind, expectedPath, absolutePath] of [
        ["graph-freshness", "graph/freshness.json", freshnessPath],
        ["design-anchors", "design/anchors.json", anchorsPath],
        ["provider-evidence", "graph/gitnexus.json", providerEvidencePath],
      ]) {
        const supporting = supportByKind.get(kind);
        assert(
          supporting?.path === expectedPath,
          `code-intelligence ${kind} path was not bound canonically`,
        );
        assert(
          supporting.sha256 === sha256(readFileSync(absolutePath)),
          `code-intelligence ${kind} digest was not bound`,
        );
      }

      const syntheticCodeIntelligencePacket = structuredClone(packet);
      syntheticCodeIntelligencePacket.inputs.route.sha256 = sha256(
        readFileSync(routePathForCodeIntelligence),
      );
      syntheticCodeIntelligencePacket.requiredGates = [
        ...codeIntelligenceBundle.evidenceBundle.requiredGates,
      ];
      syntheticCodeIntelligencePacket.gateArtifacts = [
        ...packet.gateArtifacts.filter(
          ({ gate }) => gate !== "independent-review",
        ),
        codeIntelligenceBinding,
        packet.gateArtifacts.find(({ gate }) => gate === "independent-review"),
      ];
      syntheticCodeIntelligencePacket.bindings = packetBindings(
        syntheticCodeIntelligencePacket,
      );
      const codeIntelligencePacketPath = path.join(
        repoRoot,
        "run",
        "code-intelligence-sidecar-packet.json",
      );

      const originalFreshness = readFileSync(freshnessPath, "utf8");
      try {
        writeJson(freshnessPath, {
          ...readJson(freshnessPath),
          tampered: true,
        });
        writeJson(codeIntelligencePacketPath, syntheticCodeIntelligencePacket);
        expectFailure(
          run(
            runtimeRoot,
            "run-packet-gate.mjs",
            [
              "--repo",
              repoRoot,
              "--file",
              "run/code-intelligence-sidecar-packet.json",
            ],
            repoRoot,
          ),
          "packet after code-intelligence freshness tamper",
          "gate code-intelligence supporting artifact graph-freshness digest does not match",
        );
      } finally {
        writeFileSync(freshnessPath, originalFreshness, "utf8");
      }

      const originalAnchors = readFileSync(anchorsPath, "utf8");
      try {
        writeJson(anchorsPath, { ...readJson(anchorsPath), tampered: true });
        writeJson(codeIntelligencePacketPath, syntheticCodeIntelligencePacket);
        expectFailure(
          run(
            runtimeRoot,
            "run-packet-gate.mjs",
            [
              "--repo",
              repoRoot,
              "--file",
              "run/code-intelligence-sidecar-packet.json",
            ],
            repoRoot,
          ),
          "packet after code-intelligence design-anchor tamper",
          "gate code-intelligence supporting artifact design-anchors digest does not match",
        );
      } finally {
        writeFileSync(anchorsPath, originalAnchors, "utf8");
      }

      const originalProviderEvidence = readFileSync(
        providerEvidencePath,
        "utf8",
      );
      try {
        writeJson(providerEvidencePath, {
          ...readJson(providerEvidencePath),
          tampered: true,
        });
        writeJson(codeIntelligencePacketPath, syntheticCodeIntelligencePacket);
        expectFailure(
          run(
            runtimeRoot,
            "run-packet-gate.mjs",
            [
              "--repo",
              repoRoot,
              "--file",
              "run/code-intelligence-sidecar-packet.json",
            ],
            repoRoot,
          ),
          "packet after code-intelligence provider-evidence tamper",
          "gate code-intelligence supporting artifact provider-evidence digest does not match",
        );
      } finally {
        writeFileSync(providerEvidencePath, originalProviderEvidence, "utf8");
      }
      rmSync(codeIntelligencePacketPath, { force: true });
    } finally {
      writeFileSync(
        routePathForCodeIntelligence,
        originalRouteForCodeIntelligence,
        "utf8",
      );
      rmSync(path.join(repoRoot, "graph"), { recursive: true, force: true });
      rmSync(path.join(repoRoot, "design"), { recursive: true, force: true });
    }
    const readmePath = path.join(repoRoot, "README.md");
    const originalReadme = readFileSync(readmePath, "utf8");
    try {
      writeFileSync(
        readmePath,
        `${originalReadme}\nPost-proof application mutation.\n`,
        "utf8",
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
        ),
        "packet after application source mutation",
        "application source changed after portable proof",
      );
    } finally {
      writeFileSync(readmePath, originalReadme, "utf8");
    }
    const collidingSourcePath = path.join(repoRoot, "run", "app.js");
    const originalCollidingSource = readFileSync(collidingSourcePath, "utf8");
    try {
      writeFileSync(
        collidingSourcePath,
        "export const productRuntime = false;\n",
        "utf8",
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
        ),
        "packet after tracked source mutation inside a harness-named directory",
        "application source changed after portable proof",
      );
    } finally {
      writeFileSync(collidingSourcePath, originalCollidingSource, "utf8");
    }
    mkdirSync(path.join(repoRoot, "run", "alternate"), { recursive: true });
    cpSync(
      path.join(repoRoot, "run", "intake.json"),
      path.join(repoRoot, "run", "alternate", "intake.json"),
    );
    const noncanonicalInputPacket = structuredClone(packet);
    noncanonicalInputPacket.inputs.intake.path = "run/alternate/intake.json";
    writeJson(
      path.join(repoRoot, "run", "noncanonical-input-packet.json"),
      noncanonicalInputPacket,
    );
    expectFailure(
      run(
        runtimeRoot,
        "run-packet-gate.mjs",
        ["--repo", repoRoot, "--file", "run/noncanonical-input-packet.json"],
        repoRoot,
      ),
      "packet with noncanonical intake path",
      "input intake must use canonical path run/intake.json",
    );
    expectFailure(
      run(
        runtimeRoot,
        "run-create.mjs",
        [
          "--repo",
          repoRoot,
          "--run-id",
          packet.runId,
          "--commit",
          packet.commit,
          "--environment",
          packet.environment,
          "--intake",
          "run/alternate/intake.json",
          "--proof",
          "proof/portable.json",
          "--review",
          "review/review.json",
          "--gate",
          "trajectory=trajectory/trajectory.json",
          "--output",
          "run/noncanonical-create-packet.json",
        ],
        repoRoot,
      ),
      "run-create with noncanonical intake path",
      "input intake must use canonical path run/intake.json",
    );

    const classificationPath = path.join(
      repoRoot,
      "run",
      "workload-classification.json",
    );
    const routePath = path.join(repoRoot, "run", "route.json");
    const goalPath = path.join(repoRoot, "goal", "goal.json");
    const intakePath = path.join(repoRoot, "run", "intake.json");
    const originals = {
      intake: readFileSync(intakePath, "utf8"),
      classification: readFileSync(classificationPath, "utf8"),
      route: readFileSync(routePath, "utf8"),
      goal: readFileSync(goalPath, "utf8"),
    };
    try {
      const changedRoute = readJson(routePath);
      changedRoute.generatedAt = new Date(
        Date.parse(changedRoute.generatedAt) + 1000,
      ).toISOString();
      writeJson(routePath, changedRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const postReviewRoutePacket = structuredClone(packet);
      refreshPacketInputs(postReviewRoutePacket, repoRoot);
      writeJson(
        path.join(repoRoot, "run", "post-review-route-packet.json"),
        postReviewRoutePacket,
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/post-review-route-packet.json"],
          repoRoot,
        ),
        "packet with semantically valid post-review route mutation",
        "independent review must be bound to every packet input and required evidence artifact",
      );
    } finally {
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    const trajectoryPath = path.join(repoRoot, "trajectory", "trajectory.json");
    const originalTrajectory = readFileSync(trajectoryPath, "utf8");
    try {
      const crossRunTrajectory = readJson(trajectoryPath);
      crossRunTrajectory.goalId = "EXAMPLE-OTHER-RUN-001";
      crossRunTrajectory.runId = packet.runId;
      crossRunTrajectory.commit = "EXAMPLE-OTHER-COMMIT";
      crossRunTrajectory.environment = "other-environment";
      crossRunTrajectory.run = {
        id: packet.runId,
        commit: packet.commit,
        environment: packet.environment,
      };
      writeJson(trajectoryPath, crossRunTrajectory);
      const crossRunPacket = structuredClone(packet);
      refreshPacketGate(crossRunPacket, repoRoot, "trajectory");
      writeJson(
        path.join(repoRoot, "run", "cross-run-trajectory-packet.json"),
        crossRunPacket,
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          [
            "--repo",
            repoRoot,
            "--file",
            "run/cross-run-trajectory-packet.json",
          ],
          repoRoot,
        ),
        "packet reusing trajectory evidence from another run",
        "gate trajectory run identifier does not match the packet",
      );
    } finally {
      writeFileSync(trajectoryPath, originalTrajectory, "utf8");
    }
    try {
      const invalidClassification = readJson(classificationPath);
      invalidClassification.effectiveTier = "T9";
      writeJson(classificationPath, invalidClassification);
      const reboundRoute = readJson(routePath);
      reboundRoute.workloadClassificationSha256 = sha256(
        readFileSync(classificationPath),
      );
      writeJson(routePath, reboundRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.workloadClassificationSha256 = sha256(
        readFileSync(classificationPath),
      );
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const invalidClassificationPacket = structuredClone(packet);
      refreshPacketInputs(invalidClassificationPacket, repoRoot);
      writeJson(
        path.join(repoRoot, "run", "invalid-classification-packet.json"),
        invalidClassificationPacket,
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          [
            "--repo",
            repoRoot,
            "--file",
            "run/invalid-classification-packet.json",
          ],
          repoRoot,
        ),
        "packet with semantically invalid workload classification",
        "input classification failed native validator workload-classification-gate.mjs",
      );
    } finally {
      writeFileSync(classificationPath, originals.classification, "utf8");
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    try {
      const incidentIntake = readJson(intakePath);
      incidentIntake.requestText =
        "Investigate and repair a production incident affecting customers.";
      incidentIntake.requestSha256 = sha256(incidentIntake.requestText);
      writeJson(intakePath, incidentIntake);
      const forgedFeatureRoute = readJson(routePath);
      forgedFeatureRoute.taskType = "feature";
      forgedFeatureRoute.intakeSha256 = sha256(readFileSync(intakePath));
      writeJson(routePath, forgedFeatureRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.requestSha256 = incidentIntake.requestSha256;
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const forgedIncidentPacket = structuredClone(packet);
      refreshPacketInputs(forgedIncidentPacket, repoRoot);
      writeJson(
        path.join(repoRoot, "run", "forged-feature-incident-packet.json"),
        forgedIncidentPacket,
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          [
            "--repo",
            repoRoot,
            "--file",
            "run/forged-feature-incident-packet.json",
          ],
          repoRoot,
        ),
        "packet with forged feature route over incident intake",
        "requiredGates must exactly match route-derived gates",
      );
    } finally {
      writeFileSync(intakePath, originals.intake, "utf8");
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    try {
      const invalidRoute = readJson(routePath);
      invalidRoute.profile = "invalid-profile";
      writeJson(routePath, invalidRoute);
      const reboundGoal = readJson(goalPath);
      reboundGoal.initialRouteSha256 = sha256(readFileSync(routePath));
      writeJson(goalPath, reboundGoal);
      const invalidRoutePacket = structuredClone(packet);
      refreshPacketInputs(invalidRoutePacket, repoRoot);
      writeJson(
        path.join(repoRoot, "run", "invalid-route-packet.json"),
        invalidRoutePacket,
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/invalid-route-packet.json"],
          repoRoot,
        ),
        "packet with semantically invalid route",
        "input route failed native validator route-gate.mjs",
      );
    } finally {
      writeFileSync(routePath, originals.route, "utf8");
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    try {
      const incompleteGoal = readJson(goalPath);
      incompleteGoal.status = "in_progress";
      writeJson(goalPath, incompleteGoal);
      const incompleteGoalPacket = structuredClone(packet);
      refreshPacketInputs(incompleteGoalPacket, repoRoot);
      writeJson(
        path.join(repoRoot, "run", "incomplete-goal-packet.json"),
        incompleteGoalPacket,
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/incomplete-goal-packet.json"],
          repoRoot,
        ),
        "packet with incomplete finish-line goal",
        "input goal failed native validator goal-gate.mjs",
      );
    } finally {
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    rmSync(path.join(repoRoot, "run", "alternate"), {
      recursive: true,
      force: true,
    });
    for (const file of [
      "noncanonical-input-packet.json",
      "invalid-classification-packet.json",
      "forged-feature-incident-packet.json",
      "invalid-route-packet.json",
      "incomplete-goal-packet.json",
      "post-review-route-packet.json",
      "cross-run-trajectory-packet.json",
    ])
      rmSync(path.join(repoRoot, "run", file), { force: true });

    try {
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
          { ...process.env, VALDRIS_TEST_MUTATE_GOAL: "1" },
        ),
        "packet whose goal changes during native validation",
        "input goal changed during packet validation",
      );
    } finally {
      writeFileSync(goalPath, originals.goal, "utf8");
    }

    const routeGatePath = path.join(runtimeRoot, "scripts", "route-gate.mjs");
    const originalRouteGate = readFileSync(routeGatePath, "utf8");
    try {
      writeFileSync(
        routeGatePath,
        `${originalRouteGate}\n// synthetic validator drift\n`,
        "utf8",
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-create.mjs",
          [
            "--repo",
            repoRoot,
            "--run-id",
            packet.runId,
            "--commit",
            packet.commit,
            "--environment",
            packet.environment,
            "--proof",
            "proof/portable.json",
            "--review",
            "review/review.json",
            "--gate",
            "trajectory=trajectory/trajectory.json",
            "--output",
            "run/dirty-runtime-create-packet.json",
          ],
          repoRoot,
        ),
        "packet creation under dirty validator runtime",
        "validation runtime files are dirty or untracked",
      );
      expectFailure(
        run(
          runtimeRoot,
          "run-packet-gate.mjs",
          ["--repo", repoRoot, "--file", "run/packet.json"],
          repoRoot,
        ),
        "packet after validator runtime drift",
        "validation runtime files are dirty or untracked",
      );
    } finally {
      writeFileSync(routeGatePath, originalRouteGate, "utf8");
    }
    writeFileSync(
      path.join(repoRoot, "README.md"),
      `${readFileSync(path.join(repoRoot, "README.md"), "utf8")}\nhistorical-head-advance\n`,
    );
    expectOk(runGit(repoRoot, ["add", "README.md"]), "historical head stage");
    expectOk(
      runGit(repoRoot, ["commit", "-qm", "advance after packet"]),
      "historical head commit",
    );
    const historicalPacket = run(
      runtimeRoot,
      "run-packet-gate.mjs",
      ["--repo", repoRoot, "--file", "run/packet.json"],
      repoRoot,
    );
    expectOk(historicalPacket, "historical packet integrity inspection");
    const historicalResult = JSON.parse(historicalPacket.stdout);
    assert(
      historicalResult.historical === true &&
        historicalResult.assuranceLevel === "structural" &&
        historicalResult.recordedAssuranceLevel === packet.assuranceLevel &&
        historicalResult.revalidationMode === "integrity-only",
      "historical packet did not downgrade to integrity-only structural evidence",
    );
    verifyReviewTrustSelfEnrollmentRejected(
      runtimeRoot,
      repoRoot,
      reviewTrustSha256,
    );
    console.log(
      JSON.stringify(
        { ok: true, positiveCases: 9, adversarialRejections: 39 },
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
