#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as signPayload } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  return spawnSync(process.execPath, [path.join(options.scriptDir || SCRIPT_DIR, script), ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    shell: false,
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function expectFailure(result, label, expectedText) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert(result.status !== 0, `${label} was unexpectedly accepted`);
  if (expectedText) assert(output.includes(expectedText), `${label} failed for the wrong reason; expected ${JSON.stringify(expectedText)} in:\n${output}`);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] });
  assert(result.status === 0, `git ${args.join(" ")} failed:\n${result.stdout || ""}\n${result.stderr || ""}`);
  return result.stdout.trim();
}

function main() {
  const root = mkdtempSync(path.join(tmpdir(), "valdris-portable-proof-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const reviewRuntimeScripts = path.join(root, ".valdris-harness", "scripts");
    mkdirSync(reviewRuntimeScripts, { recursive: true });
    for (const script of ["review-gate.mjs", "proof-runner.mjs"]) cpSync(path.join(SCRIPT_DIR, script), path.join(reviewRuntimeScripts, script));
    writeFileSync(path.join(root, ".gitignore"), "proof/\nrca/\nreview/\nrun/\ngoal/\nfoundation/\nflaky-state\n", "utf8");
    writeFileSync(path.join(root, "fixture-status.txt"), "broken\n", "utf8");
    mkdirSync(path.join(root, "cloud"), { recursive: true });
    writeFileSync(path.join(root, "cloud", "service-map.json"), "{\"status\":\"before\"}\n", "utf8");
    writeJson(path.join(root, ".valdris-harness", "controls", "review-trust.v1.json"), {
      schema: "valdris.review-trust.v1",
      keys: [{ keyId: "EXAMPLE-REVIEW-KEY-001", algorithm: "ed25519", status: "active", publicKeyPem: publicKey, allowedActorIds: ["EXAMPLE-ACTOR-REVIEWER"], allowedActorTypes: ["agent"] }],
    });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "verification@example.com"]);
    runGit(root, ["config", "user.name", "Valdris Verification"]);
    runGit(root, ["add", ".gitignore", "fixture-status.txt", "cloud/service-map.json", ".valdris-harness"]);
    runGit(root, ["commit", "-m", "test: create failing regression fixture"]);
    const PRE_FIX_COMMIT = runGit(root, ["rev-parse", "HEAD"]);
    const REGRESSION_COMMAND = [
      process.execPath,
      "-e",
      "const fs=require('node:fs');const value=fs.readFileSync('fixture-status.txt','utf8').trim();if(value!=='fixed'){process.stderr.write('synthetic-regression-signature');process.exit(7)}process.stdout.write('portable-ok')",
    ];

    const redOutput = path.join(root, "proof", "red.json");
    const red = run("proof-runner.mjs", [
      "--repo", root,
      "--run-id", "EXAMPLE-RUN-001",
      "--commit", PRE_FIX_COMMIT,
      "--environment", "synthetic-test",
      "--output", redOutput,
      "--repeat", "2",
      "--red-baseline",
      "--",
      ...REGRESSION_COMMAND,
    ], { cwd: root });
    assert(red.status === 0, `red baseline was not accepted:\n${red.stdout}\n${red.stderr}`);
    const redArtifact = readJson(redOutput);
    assert(redArtifact.outcome?.status === "red-confirmed", "red baseline did not persist red-confirmed");

    writeFileSync(path.join(root, "fixture-status.txt"), "fixed\n", "utf8");
    writeFileSync(path.join(root, "cloud", "service-map.json"), "{\"status\":\"after\"}\n", "utf8");
    runGit(root, ["add", "fixture-status.txt", "cloud/service-map.json"]);
    runGit(root, ["commit", "-m", "fix: repair regression fixture"]);
    const POST_FIX_COMMIT = runGit(root, ["rev-parse", "HEAD"]);

    const output = path.join(root, "proof", "portable.json");
    const result = run("proof-runner.mjs", [
      "--repo", root,
      "--run-id", "EXAMPLE-RUN-001",
      "--commit", POST_FIX_COMMIT,
      "--environment", "synthetic-test",
      "--output", output,
      "--repeat", "2",
      "--",
      ...REGRESSION_COMMAND,
    ], { cwd: root });
    assert(result.status === 0, `portable proof command failed:\n${result.stdout}\n${result.stderr}`);
    const artifact = readJson(output);
    assert(artifact.outcome?.status === "passed", "portable proof did not persist a passed outcome");
    assert(artifact.execution?.shell === false, "portable proof did not record shell:false");
    assert(artifact.bindings?.runSha256 === digest("EXAMPLE-RUN-001"), "portable proof did not bind the run identifier");
    assert(artifact.bindings?.commitSha256 === digest(POST_FIX_COMMIT), "portable proof did not bind the commit");
    assert(artifact.bindings?.environmentSha256 === digest("synthetic-test"), "portable proof did not bind the environment");

    const unexpectedGreenOutput = path.join(root, "proof", "unexpected-green.json");
    const unexpectedGreen = run("proof-runner.mjs", [
      "--repo", root, "--run-id", "EXAMPLE-RUN-001", "--commit", POST_FIX_COMMIT,
      "--environment", "synthetic-test", "--output", unexpectedGreenOutput, "--red-baseline", "--",
      process.execPath, "-e", "process.exit(0)",
    ], { cwd: root });
    assert(unexpectedGreen.status === 1, "unexpected green red-baseline command was accepted");
    assert(readJson(unexpectedGreenOutput).outcome?.status === "unexpected-green", "unexpected green status was not persisted");

    const stateFile = path.join(root, "flaky-state");
    const flakyOutput = path.join(root, "proof", "flaky.json");
    const flaky = run("proof-runner.mjs", [
      "--repo", root, "--run-id", "EXAMPLE-RUN-001", "--commit", POST_FIX_COMMIT,
      "--environment", "synthetic-test", "--output", flakyOutput, "--repeat", "2", "--",
      process.execPath, "-e",
      "const fs=require('node:fs');const p=process.argv[1];if(fs.existsSync(p)){process.stdout.write('second');process.exit(0)}fs.writeFileSync(p,'1');process.stdout.write('first');process.exit(1)",
      stateFile,
    ], { cwd: root });
    assert(flaky.status === 1, "flaky repeated command was accepted");
    assert(readJson(flakyOutput).outcome?.status === "flaky", "flaky repeated command was not detected");

    const timeoutOutput = path.join(root, "proof", "timeout.json");
    const timedOut = run("proof-runner.mjs", [
      "--repo", root, "--run-id", "EXAMPLE-RUN-001", "--commit", POST_FIX_COMMIT,
      "--environment", "synthetic-test", "--output", timeoutOutput, "--timeout-ms", "50", "--",
      process.execPath, "-e", "setTimeout(() => {}, 1000)",
    ], { cwd: root });
    assert(timedOut.status === 1, "timed-out command was accepted");
    assert(readJson(timeoutOutput).outcome?.status === "timed-out", "timeout status was not persisted");

    const secret = "synthetic-secret-value-12345";
    const databaseSecret = "postgres://fixture-user:fixture-password@example.invalid/db";
    const dsnSecret = "Server=example.invalid;Password=fixture-dsn-secret";
    const connectionSecret = "mongodb://fixture-user:fixture-password@example.invalid/data";
    const boundedOutput = path.join(root, "proof", "bounded.json");
    const bounded = run("proof-runner.mjs", [
      "--repo", root, "--run-id", "EXAMPLE-RUN-001", "--commit", POST_FIX_COMMIT,
      "--environment", "synthetic-test", "--output", boundedOutput, "--max-output-bytes", "256",
      "--pass-env", "SYNTHETIC_SECRET", "--redact-env", "SYNTHETIC_SECRET", "--",
      process.execPath, "-e", "process.stdout.write('token='+process.env.SYNTHETIC_SECRET+'\\ndatabase='+String(process.env.DATABASE_URL)+'\\ndsn='+String(process.env.APP_DSN)+'\\nconnection='+String(process.env.PRIMARY_CONNECTION_STRING)+'\\n'+'x'.repeat(1000))",
    ], { cwd: root, env: { ...process.env, SYNTHETIC_SECRET: secret, DATABASE_URL: databaseSecret, APP_DSN: dsnSecret, PRIMARY_CONNECTION_STRING: connectionSecret } });
    assert(bounded.status === 0, `bounded/redacted proof failed:\n${bounded.stderr}`);
    const boundedArtifact = readJson(boundedOutput);
    const serialized = JSON.stringify(boundedArtifact);
    assert(!serialized.includes(secret), "proof persisted a raw secret");
    assert(!serialized.includes(databaseSecret) && !serialized.includes(dsnSecret) && !serialized.includes(connectionSecret), "proof persisted an inherited connection secret");
    assert(serialized.includes("[REDACTED]"), "proof did not preserve a redaction marker");
    assert(boundedArtifact.execution.attempts[0].stdout.text.includes("database=undefined"), "proof command inherited DATABASE_URL instead of the safe explicit environment");
    assert(boundedArtifact.execution.attempts[0].stdout.persistedBytes <= 256, "proof exceeded the persisted output bound");
    assert(boundedArtifact.execution.attempts[0].stdout.truncated === true, "proof did not mark truncated output");

    const rcaPath = path.join(root, "rca", "rca.json");
    const causalEvidencePath = path.join(root, "rca", "causal-evidence.json");
    const fixEvidencePath = path.join(root, "rca", "fix-evidence.json");
    writeJson(causalEvidencePath, { schema: "synthetic.causal-evidence.v1", observation: "The fixture source calls process.exit(7) on the reproduced path." });
    writeJson(fixEvidencePath, { schema: "synthetic.change-evidence.v1", change: "The post-fix fixture returns success and preserves the neighboring behavior." });
    const rcaDocument = {
      schema: "valdris.rca.v1",
      generatedAt: new Date().toISOString(),
      runId: "EXAMPLE-RUN-001",
      commit: POST_FIX_COMMIT,
      environment: "synthetic-test",
      status: "confirmed",
      symptom: { id: "EXAMPLE-SYMPTOM-001", summary: "Synthetic command exits with code 7.", evidenceIds: ["EXAMPLE-REPRODUCTION-001"] },
      rootCause: { summary: "Synthetic fixture deliberately exits non-zero.", causalMechanism: "The fixture calls process.exit(7).", affectedPaths: ["fixture-status.txt"], evidenceIds: ["EXAMPLE-CAUSE-001"] },
      fix: { summary: "The fixture was changed to return success.", changedPaths: ["fixture-status.txt"], evidenceIds: ["EXAMPLE-FIX-001"] },
      regression: {
        id: "EXAMPLE-REGRESSION-IDENTITY-001",
        summary: "The same regression command fails before the fix and passes after it.",
        commandSha256: artifact.bindings.commandSha256,
        failureSignature: "synthetic-regression-signature",
        preFixCommit: PRE_FIX_COMMIT,
        postFixCommit: POST_FIX_COMMIT,
        evidenceIds: ["EXAMPLE-REGRESSION-001"],
      },
      evidence: [{
        id: "EXAMPLE-REPRODUCTION-001",
        type: "runtime-command",
        phase: "reproduction",
        symptomId: "EXAMPLE-SYMPTOM-001",
        observation: "The synthetic symptom is reproduced by a bounded runtime command.",
        artifact: "proof/red.json",
        sha256: digest(readFileSync(redOutput)),
        proofBindingSha256: redArtifact.bindings.envelopeSha256,
        regressionId: "EXAMPLE-REGRESSION-IDENTITY-001",
      }, {
        id: "EXAMPLE-CAUSE-001", type: "runtime-log", phase: "diagnosis", symptomId: "EXAMPLE-SYMPTOM-001",
        observation: "The causal trace identifies the deliberate non-zero exit in the reproduced path.",
        artifact: "rca/causal-evidence.json", sha256: digest(readFileSync(causalEvidencePath)),
      }, {
        id: "EXAMPLE-FIX-001", type: "change-artifact", phase: "fix", symptomId: "EXAMPLE-SYMPTOM-001",
        observation: "The change artifact identifies the repair applied to the failing path.",
        artifact: "rca/fix-evidence.json", sha256: digest(readFileSync(fixEvidencePath)),
      }, {
        id: "EXAMPLE-REGRESSION-001", type: "runtime-command", phase: "post-fix-regression", symptomId: "EXAMPLE-SYMPTOM-001",
        observation: "The post-fix regression command passes after the repair.",
        artifact: "proof/portable.json", sha256: digest(readFileSync(output)), proofBindingSha256: artifact.bindings.envelopeSha256,
        regressionId: "EXAMPLE-REGRESSION-IDENTITY-001",
      }],
    };
    writeJson(rcaPath, rcaDocument);
    const rca = run("rca-gate.mjs", ["--repo", root, "--file", "rca/rca.json"], { cwd: root });
    assert(rca.status === 0, `typed runtime RCA was rejected:\n${rca.stdout}\n${rca.stderr}`);

    const evidenceOnlyPathRca = structuredClone(rcaDocument);
    evidenceOnlyPathRca.rootCause.affectedPaths = ["cloud/service-map.json"];
    evidenceOnlyPathRca.fix.changedPaths = ["cloud/service-map.json"];
    writeJson(path.join(root, "rca", "evidence-only-path.json"), evidenceOnlyPathRca);
    expectFailure(
      run("rca-gate.mjs", ["--repo", root, "--file", "rca/evidence-only-path.json"], { cwd: root }),
      "RCA using an evidence-only causal path plus an unrelated source cover change",
      "causal fix path must itself be a changed non-evidence source path",
    );

    const narrativeRcaPath = path.join(root, "rca", "narrative-only.json");
    const narrativeRca = structuredClone(rcaDocument);
    narrativeRca.evidence[0].type = "analysis";
    writeJson(narrativeRcaPath, narrativeRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/narrative-only.json"], { cwd: root }), "narrative-only RCA", "typed RCA evidence");

    const untiedRcaPath = path.join(root, "rca", "untied.json");
    const untiedRca = structuredClone(rcaDocument);
    untiedRca.evidence[0].symptomId = "EXAMPLE-SYMPTOM-OTHER";
    writeJson(untiedRcaPath, untiedRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/untied.json"], { cwd: root }), "symptom-untied RCA", "tie directly to symptom.id");

    const selfGrantedRcaPath = path.join(root, "rca", "self-granted.json");
    const selfGrantedRca = structuredClone(rcaDocument);
    selfGrantedRca.approval = { status: "granted", actorType: "agent", actor: "EXAMPLE-ACTOR-IMPLEMENTER" };
    writeJson(selfGrantedRcaPath, selfGrantedRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/self-granted.json"], { cwd: root }), "agent self-granted RCA", "agent self-granted approval");

    const missingFixRca = structuredClone(rcaDocument);
    missingFixRca.fix.evidenceIds = [];
    writeJson(path.join(root, "rca", "missing-fix.json"), missingFixRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/missing-fix.json"], { cwd: root }), "RCA without fix evidence", "fix.evidenceIds");

    const missingRegressionRca = structuredClone(rcaDocument);
    missingRegressionRca.regression.evidenceIds = [];
    missingRegressionRca.evidence = missingRegressionRca.evidence.filter((entry) => entry.phase !== "post-fix-regression");
    writeJson(path.join(root, "rca", "missing-regression.json"), missingRegressionRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/missing-regression.json"], { cwd: root }), "RCA without regression proof", "post-fix regression portable proof");

    const redRegressionRca = structuredClone(rcaDocument);
    const regressionEvidence = redRegressionRca.evidence.find((entry) => entry.phase === "post-fix-regression");
    regressionEvidence.artifact = "proof/red.json";
    regressionEvidence.sha256 = digest(readFileSync(redOutput));
    regressionEvidence.proofBindingSha256 = redArtifact.bindings.envelopeSha256;
    writeJson(path.join(root, "rca", "red-regression.json"), redRegressionRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/red-regression.json"], { cwd: root }), "RCA with red regression proof", "passed green portable proof");

    const unrelatedRegressionRca = structuredClone(rcaDocument);
    const unrelatedEvidence = unrelatedRegressionRca.evidence.find((entry) => entry.phase === "post-fix-regression");
    unrelatedEvidence.artifact = "proof/bounded.json";
    unrelatedEvidence.sha256 = digest(readFileSync(boundedOutput));
    unrelatedEvidence.proofBindingSha256 = boundedArtifact.bindings.envelopeSha256;
    writeJson(path.join(root, "rca", "unrelated-regression.json"), unrelatedRegressionRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/unrelated-regression.json"], { cwd: root }), "RCA with unrelated green command", "bound regression identity");

    const unboundCauseRca = structuredClone(rcaDocument);
    unboundCauseRca.rootCause.evidenceIds = ["EXAMPLE-REPRODUCTION-001"];
    writeJson(path.join(root, "rca", "unbound-cause.json"), unboundCauseRca);
    expectFailure(run("rca-gate.mjs", ["--repo", root, "--file", "rca/unbound-cause.json"], { cwd: root }), "RCA without causal evidence binding", "must bind diagnosis evidence");

    const reviewPath = path.join(root, "review", "review.json");
    const proofSha256 = digest(readFileSync(output));
    const reviewDocument = {
      schema: "valdris.review.v1",
      generatedAt: new Date().toISOString(),
      runId: "EXAMPLE-RUN-001",
      commit: POST_FIX_COMMIT,
      environment: "synthetic-test",
      status: "passed",
      subject: { artifact: "proof/portable.json", sha256: proofSha256 },
      validationRuntimeSha256: "0".repeat(64),
      evidenceBundleSha256: "1".repeat(64),
      implementationProvenance: {
        actorId: "EXAMPLE-ACTOR-IMPLEMENTER",
        actorType: "agent",
        sessionId: "EXAMPLE-SESSION-IMPLEMENT",
        executionId: "EXAMPLE-EXECUTION-IMPLEMENT",
        artifactSha256: proofSha256,
      },
      reviewProvenance: {
        actorId: "EXAMPLE-ACTOR-REVIEWER",
        actorType: "agent",
        sessionId: "EXAMPLE-SESSION-REVIEW",
        executionId: "EXAMPLE-EXECUTION-REVIEW",
        observedArtifactSha256: proofSha256,
      },
      decision: { status: "accepted", summary: "Synthetic artifact satisfies the portable proof contract." },
      findings: [],
      blockers: [],
    };
    reviewDocument.attestation = { scheme: "ed25519", keyId: "EXAMPLE-REVIEW-KEY-001", signedAt: new Date().toISOString() };
    const reviewPayload = canonicalJson(reviewAttestationPayload(reviewDocument));
    reviewDocument.attestation.payloadSha256 = digest(reviewPayload);
    reviewDocument.attestation.signature = signPayload(null, Buffer.from(reviewPayload, "utf8"), privateKey).toString("base64");
    writeJson(reviewPath, reviewDocument);
    const review = run("review-gate.mjs", ["--repo", root, "--file", "review/review.json"], { cwd: root, scriptDir: reviewRuntimeScripts });
    assert(review.status === 0, `independent review was rejected:\n${review.stdout}\n${review.stderr}`);

    const sameReviewerPath = path.join(root, "review", "same-reviewer.json");
    const sameReviewer = structuredClone(reviewDocument);
    sameReviewer.reviewProvenance.actorId = sameReviewer.implementationProvenance.actorId;
    writeJson(sameReviewerPath, sameReviewer);
    expectFailure(run("review-gate.mjs", ["--repo", root, "--file", "review/same-reviewer.json"], { cwd: root, scriptDir: reviewRuntimeScripts }), "same-actor review", "actorId matches implementation provenance");

    const blockedReviewPath = path.join(root, "review", "blocked.json");
    const blockedReview = structuredClone(reviewDocument);
    blockedReview.blockers = [{ id: "EXAMPLE-BLOCKER-001", status: "open", summary: "Synthetic unresolved blocker." }];
    writeJson(blockedReviewPath, blockedReview);
    expectFailure(run("review-gate.mjs", ["--repo", root, "--file", "review/blocked.json"], { cwd: root, scriptDir: reviewRuntimeScripts }), "review with open blocker", "remains open");

    const selfGrantedReviewPath = path.join(root, "review", "self-granted.json");
    const selfGrantedReview = structuredClone(reviewDocument);
    selfGrantedReview.approval = { status: "granted", actorType: "agent", actor: "EXAMPLE-ACTOR-REVIEWER" };
    writeJson(selfGrantedReviewPath, selfGrantedReview);
    expectFailure(run("review-gate.mjs", ["--repo", root, "--file", "review/self-granted.json"], { cwd: root, scriptDir: reviewRuntimeScripts }), "agent self-granted review", "agent self-granted approval");

    const forgedReview = structuredClone(reviewDocument);
    forgedReview.reviewProvenance.actorId = "EXAMPLE-FORGED-REVIEWER";
    forgedReview.reviewProvenance.sessionId = "EXAMPLE-FORGED-SESSION";
    forgedReview.reviewProvenance.executionId = "EXAMPLE-FORGED-EXECUTION";
    writeJson(path.join(root, "review", "forged.json"), forgedReview);
    expectFailure(run("review-gate.mjs", ["--repo", root, "--file", "review/forged.json"], { cwd: root, scriptDir: reviewRuntimeScripts }), "forged independent-review metadata", "attestation");

    console.log(JSON.stringify({ ok: true, seams: ["proof-runner CLI exit + JSON artifact", "RCA gate CLI exit", "review gate CLI exit"], proofCases: 6, rcaCases: 10, reviewCases: 5, adversarialRejections: 16 }, null, 2));
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
