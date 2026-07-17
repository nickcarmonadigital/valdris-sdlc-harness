#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentSelfGrantProblems,
  assertPortableArtifactPath,
  fileSha256,
  isHarnessEvidencePath,
  readJson,
  resolveArtifactPath,
  safeIdentifier,
  secretDisclosureProblems,
  validatePortableProof,
} from "./proof-runner.mjs";

export const RCA_SCHEMA = "valdris.rca.v1";
const SHA256 = /^[a-f0-9]{64}$/i;
const RUNTIME_EVIDENCE_TYPES = new Set(["runtime-command", "runtime-log", "runtime-trace", "runtime-metric"]);
const EVIDENCE_TYPES = new Set([...RUNTIME_EVIDENCE_TYPES, "change-artifact"]);
const EVIDENCE_PHASES = new Set(["reproduction", "diagnosis", "fix", "post-fix-regression"]);

function nonEmpty(value, minimum = 1) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function git(repoRoot, args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", shell: false, timeout: 30_000, killSignal: "SIGTERM", stdio: ["ignore", "pipe", "pipe"] });
}

function revisionProblems(document, repoRoot) {
  const problems = [];
  const regression = document.regression || {};
  const preFixCommit = regression.preFixCommit;
  const postFixCommit = regression.postFixCommit;
  if (!safeIdentifier(regression.id)) problems.push("RCA regression.id is invalid");
  if (!SHA256.test(regression.commandSha256 || "")) problems.push("RCA regression.commandSha256 must bind one regression command");
  if (!nonEmpty(regression.failureSignature, 4)) problems.push("RCA regression.failureSignature must identify the reproduced failure");
  if (!/^[a-f0-9]{40,64}$/i.test(preFixCommit || "")) problems.push("RCA regression.preFixCommit must be a Git commit hash");
  if (!/^[a-f0-9]{40,64}$/i.test(postFixCommit || "")) problems.push("RCA regression.postFixCommit must be a Git commit hash");
  if (preFixCommit && postFixCommit && preFixCommit === postFixCommit) problems.push("RCA pre-fix and post-fix commits must be distinct");
  if (postFixCommit && document.commit !== postFixCommit) problems.push("RCA commit must equal regression.postFixCommit");
  for (const [label, revision] of [["pre-fix", preFixCommit], ["post-fix", postFixCommit]]) {
    if (!/^[a-f0-9]{40,64}$/i.test(revision || "")) continue;
    const exists = git(repoRoot, ["cat-file", "-e", `${revision}^{commit}`]);
    if (exists.status !== 0) problems.push(`RCA ${label} commit does not exist in the repository`);
  }
  if (/^[a-f0-9]{40,64}$/i.test(preFixCommit || "") && /^[a-f0-9]{40,64}$/i.test(postFixCommit || "") && preFixCommit !== postFixCommit) {
    const changed = git(repoRoot, ["diff", "--name-only", "-z", preFixCommit, postFixCommit, "--"]);
    if (changed.status !== 0) problems.push("RCA could not verify the pre-fix to post-fix source change");
    else {
      const changedPaths = changed.stdout.split("\0").filter(Boolean).map((entry) => entry.replaceAll("\\", "/"));
      const declaredFixPaths = Array.isArray(document.fix?.changedPaths) ? document.fix.changedPaths : [];
      const affectedPaths = Array.isArray(document.rootCause?.affectedPaths) ? document.rootCause.affectedPaths : [];
      if (changedPaths.length === 0) problems.push("RCA pre-fix and post-fix commits have no source change");
      if (declaredFixPaths.length === 0) problems.push("RCA fix.changedPaths must identify changed source paths");
      if (affectedPaths.length === 0) problems.push("RCA rootCause.affectedPaths must identify the causal source paths");
      for (const [label, paths] of [["fix.changedPaths", declaredFixPaths], ["rootCause.affectedPaths", affectedPaths]]) {
        for (const value of paths) {
          try {
            assertPortableArtifactPath(value);
            if (path.isAbsolute(value)) throw new Error("path must be repository-relative");
          } catch (error) {
            problems.push(`RCA ${label} contains an invalid path: ${error.message}`);
          }
        }
      }
      for (const value of declaredFixPaths) if (!changedPaths.includes(value)) problems.push(`RCA fix.changedPaths is not present in the pre/post diff: ${value}`);
      const causalFixPaths = affectedPaths.filter((value) => declaredFixPaths.includes(value) && changedPaths.includes(value));
      if (causalFixPaths.length === 0) problems.push("RCA root cause and fix must overlap on a changed source path");
      else if (!causalFixPaths.some((value) => !isHarnessEvidencePath(value) && !/^docs?\//.test(value))) problems.push("RCA causal fix path must itself be a changed non-evidence source path");
    }
  }
  if (/^[a-f0-9]{40,64}$/i.test(postFixCommit || "")) {
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    if (head.status !== 0 || head.stdout.trim() !== postFixCommit) problems.push("RCA post-fix commit must equal current Git HEAD");
  }
  return problems;
}

export function validateRcaArtifact(document, repoRoot) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["RCA artifact must be a JSON object"] };
  if (document.schema !== RCA_SCHEMA) problems.push(`RCA schema must be ${RCA_SCHEMA}`);
  if (document.status !== "confirmed") problems.push("RCA gate requires status confirmed");
  if (!safeIdentifier(document.runId)) problems.push("RCA runId is invalid");
  if (!safeIdentifier(document.commit)) problems.push("RCA commit is invalid");
  if (!safeIdentifier(document.environment)) problems.push("RCA environment is invalid");
  if (!safeIdentifier(document.symptom?.id)) problems.push("RCA symptom.id is invalid");
  if (!nonEmpty(document.symptom?.summary, 8)) problems.push("RCA symptom.summary must describe the observed symptom");
  if (!nonEmpty(document.rootCause?.summary, 8)) problems.push("RCA rootCause.summary is required");
  if (!nonEmpty(document.rootCause?.causalMechanism, 8)) problems.push("RCA rootCause.causalMechanism is required");
  if (!nonEmpty(document.fix?.summary, 8)) problems.push("RCA fix.summary is required");
  if (!nonEmpty(document.regression?.summary, 8)) problems.push("RCA regression.summary is required");
  problems.push(...revisionProblems(document, repoRoot));
  if (!Array.isArray(document.evidence) || document.evidence.length === 0) problems.push("confirmed RCA requires typed evidence");

  const evidenceById = new Map();
  const runtimeProofByPhase = new Map();
  for (const [index, evidence] of (document.evidence || []).entries()) {
    const label = `RCA evidence ${index + 1}`;
    if (!safeIdentifier(evidence?.id)) problems.push(`${label} id is invalid`);
    else if (evidenceById.has(evidence.id)) problems.push(`${label} id is duplicated`);
    else evidenceById.set(evidence.id, evidence);
    if (!EVIDENCE_TYPES.has(evidence?.type)) problems.push(`${label} type must be typed RCA evidence`);
    if (!EVIDENCE_PHASES.has(evidence?.phase)) problems.push(`${label} phase is invalid`);
    if (evidence?.symptomId !== document.symptom?.id) problems.push(`${label} must tie directly to symptom.id`);
    if (!nonEmpty(evidence?.observation, 8)) problems.push(`${label} observation must describe the symptom and evidence tie`);
    if (!nonEmpty(evidence?.artifact)) {
      problems.push(`${label} artifact is required`);
      continue;
    }
    if (!SHA256.test(evidence.sha256 || "")) problems.push(`${label} sha256 is invalid`);
    try {
      const artifactPath = resolveArtifactPath(repoRoot, evidence.artifact, { mustExist: true });
      if (SHA256.test(evidence.sha256 || "") && fileSha256(artifactPath) !== evidence.sha256) problems.push(`${label} sha256 does not match its artifact`);
      problems.push(...secretDisclosureProblems(readFileSync(artifactPath, "utf8")).map((problem) => `${label} ${problem}`));
      if (evidence.type === "runtime-command") {
        let proof;
        try { proof = readJson(artifactPath); }
        catch (error) { problems.push(`${label} runtime-command artifact must be valid JSON: ${error.message}`); continue; }
        const proofValidation = validatePortableProof(proof);
        if (!proofValidation.valid) problems.push(`${label} portable proof is invalid: ${proofValidation.problems.join("; ")}`);
        if (proof.source?.dirtyBefore !== false || proof.source?.dirtyAfter !== false || proof.source?.stable !== true) problems.push(`${label} regression proof must execute against a stable clean committed tree`);
        const expectedCommit = evidence.phase === "reproduction" ? document.regression?.preFixCommit : document.regression?.postFixCommit;
        if (proof.run?.id !== document.runId || proof.run?.commit !== expectedCommit || proof.run?.environment !== document.environment) problems.push(`${label} portable proof subject does not match the RCA regression phase`);
        if (evidence.phase === "reproduction" && (proof.execution?.mode !== "red-baseline" || proof.outcome?.status !== "red-confirmed")) problems.push(`${label} reproduction requires a red-confirmed portable proof`);
        if (evidence.phase === "post-fix-regression" && (proof.execution?.mode !== "green" || proof.outcome?.status !== "passed" || proof.outcome?.successful !== true)) problems.push(`${label} post-fix regression requires a passed green portable proof`);
        if (!SHA256.test(evidence.proofBindingSha256 || "") || evidence.proofBindingSha256 !== proof.bindings?.envelopeSha256) problems.push(`${label} proofBindingSha256 does not match the portable proof`);
        if (evidence.regressionId !== document.regression?.id) problems.push(`${label} regressionId must match RCA regression.id`);
        if (proof.bindings?.commandSha256 !== document.regression?.commandSha256) problems.push(`${label} command does not match the bound regression identity`);
        if (["reproduction", "post-fix-regression"].includes(evidence.phase)) runtimeProofByPhase.set(evidence.phase, proof);
      }
    } catch (error) {
      problems.push(`${label} artifact is invalid: ${error.message}`);
    }
  }

  const references = [
    ["symptom.evidenceIds", document.symptom?.evidenceIds, "reproduction", new Set(["runtime-command"])],
    ["rootCause.evidenceIds", document.rootCause?.evidenceIds, "diagnosis", RUNTIME_EVIDENCE_TYPES],
    ["fix.evidenceIds", document.fix?.evidenceIds, "fix", new Set(["change-artifact"])],
    ["regression.evidenceIds", document.regression?.evidenceIds, "post-fix-regression", new Set(["runtime-command"])],
  ];
  for (const [field, ids, requiredPhase, requiredTypes] of references) {
    if (!Array.isArray(ids) || ids.length === 0) problems.push(`RCA ${field} must reference typed evidence`);
    else {
      for (const id of ids) {
        if (!evidenceById.has(id)) problems.push(`RCA ${field} references unknown evidence: ${id}`);
      }
      if (!ids.some((id) => evidenceById.get(id)?.phase === requiredPhase && requiredTypes.has(evidenceById.get(id)?.type))) problems.push(`RCA ${field} must bind ${requiredPhase} evidence`);
    }
  }
  if (![...evidenceById.values()].some((evidence) => evidence.type === "runtime-command" && evidence.phase === "reproduction")) problems.push("confirmed RCA requires a red reproduction portable proof");
  if (![...evidenceById.values()].some((evidence) => evidence.type === "runtime-command" && evidence.phase === "post-fix-regression")) problems.push("confirmed RCA requires a passed post-fix regression portable proof");
  const reproductionProof = runtimeProofByPhase.get("reproduction");
  const regressionProof = runtimeProofByPhase.get("post-fix-regression");
  if (reproductionProof && regressionProof && reproductionProof.bindings?.commandSha256 !== regressionProof.bindings?.commandSha256) problems.push("RCA reproduction and post-fix regression must execute the same command identity");
  if (reproductionProof && nonEmpty(document.regression?.failureSignature, 4)) {
    const signature = document.regression.failureSignature;
    const attempts = reproductionProof.execution?.attempts || [];
    if (!attempts.length || attempts.some((attempt) => !`${attempt.stdout?.text || ""}\n${attempt.stderr?.text || ""}`.includes(signature))) problems.push("RCA reproduction proof does not contain the declared failure signature in every attempt");
  }
  problems.push(...agentSelfGrantProblems(document, "rca"));
  problems.push(...secretDisclosureProblems(document));
  return { valid: problems.length === 0, problems, evidenceCount: evidenceById.size };
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), file: "rca/rca.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--file") args.file = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node scripts/rca-gate.mjs --repo . [--file rca/rca.json]");
  const repoRoot = path.resolve(args.repo);
  const file = resolveArtifactPath(repoRoot, args.file, { mustExist: true });
  const result = validateRcaArtifact(readJson(file), repoRoot);
  console.log(JSON.stringify({ ok: result.valid, artifact: path.relative(repoRoot, file), evidenceCount: result.evidenceCount || 0, problems: result.problems }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
