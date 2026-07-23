#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentSelfGrantProblems,
  assertCanonicalRepoRelativePath,
  assertPortableArtifactPath,
  canonicalJson,
  fileSha256,
  isHarnessEvidencePath,
  readJson,
  resolveArtifactPath,
  safeIdentifier,
  secretDisclosureProblems,
  sha256,
  validatePortableProof,
} from "./proof-runner.mjs";

export const RCA_SCHEMA = "valdris.rca.v1";
const SHA256 = /^[a-f0-9]{64}$/i;
const RUNTIME_EVIDENCE_TYPES = new Set([
  "runtime-command",
  "runtime-log",
  "runtime-trace",
  "runtime-metric",
]);
const EVIDENCE_TYPES = new Set([...RUNTIME_EVIDENCE_TYPES, "change-artifact"]);
const EVIDENCE_PHASES = new Set([
  "reproduction",
  "diagnosis",
  "fix",
  "post-fix-regression",
]);
const CAUSAL_CLASSES = new Set(["source-change", "documentation-process"]);
const DOCUMENTATION_ROOT_FILES = new Set([
  "readme.md",
  "claude.md",
  "agents.md",
]);
const DOCUMENTATION_DIRECTORY_SEGMENTS = new Set([
  "doc",
  "docs",
  "playbook",
  "playbooks",
  "process",
  "processes",
]);

function nonEmpty(value, minimum = 1) {
  return typeof value === "string" && value.trim().length >= minimum;
}

function git(repoRoot, args, options = {}) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: options.encoding ?? "utf8",
    shell: false,
    timeout: 30_000,
    killSignal: "SIGTERM",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function documentationProcessPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  const basename = parts.at(-1)?.toLowerCase() || "";
  if (parts.length === 1 && DOCUMENTATION_ROOT_FILES.has(basename)) return true;
  if (!basename.endsWith(".md")) return false;
  return parts
    .slice(0, -1)
    .some((segment) =>
      DOCUMENTATION_DIRECTORY_SEGMENTS.has(segment.toLowerCase()),
    );
}

function targetGitPrefix(repoRoot) {
  const result = git(repoRoot, ["rev-parse", "--show-prefix"]);
  if (result.status !== 0)
    throw new Error("RCA could not resolve the target Git prefix");
  const prefix = result.stdout.replace(/\r?\n$/, "").replaceAll("\\", "/");
  if (
    prefix === ".." ||
    prefix.startsWith("../") ||
    path.posix.isAbsolute(prefix)
  )
    throw new Error("RCA target Git prefix is invalid");
  return prefix;
}

function committedRegularFileSha256(repoRoot, revision, relativePath) {
  const gitPath = `${targetGitPrefix(repoRoot)}${relativePath}`;
  const tree = git(
    repoRoot,
    [
      "ls-tree",
      "--full-name",
      "-z",
      revision,
      "--",
      `:(top,literal)${gitPath}`,
    ],
    { encoding: null },
  );
  if (tree.status !== 0)
    throw new Error(`cannot inspect ${relativePath} at ${revision}`);
  const record = Buffer.from(tree.stdout || [])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (record.length !== 1)
    throw new Error(
      `causal input must exist exactly once at ${revision}: ${relativePath}`,
    );
  const separator = record[0].indexOf("\t");
  const header = separator >= 0 ? record[0].slice(0, separator).split(" ") : [];
  const recordedPath = separator >= 0 ? record[0].slice(separator + 1) : "";
  if (
    !new Set(["100644", "100755"]).has(header[0]) ||
    header[1] !== "blob" ||
    recordedPath !== gitPath
  ) {
    throw new Error(
      `causal input must be a regular non-symlink Git file at ${revision}: ${relativePath}`,
    );
  }
  const blob = git(repoRoot, ["cat-file", "blob", `${revision}:${gitPath}`], {
    encoding: null,
  });
  if (blob.status !== 0)
    throw new Error(`cannot read ${relativePath} at ${revision}`);
  return fileSha256Buffer(blob.stdout);
}

function fileSha256Buffer(value) {
  return sha256(Buffer.from(value || []));
}

function regressionCausalInputState(document, repoRoot) {
  const problems = [];
  const declared = document.regression?.causalInputs;
  if (declared === undefined)
    return { entries: [], byPath: new Map(), problems };
  if (!Array.isArray(declared) || declared.length === 0)
    return {
      entries: [],
      byPath: new Map(),
      problems: [
        "RCA regression.causalInputs must be a non-empty array when supplied",
      ],
    };
  const byPath = new Map();
  for (const [index, entry] of declared.entries()) {
    const label = `RCA regression.causalInputs[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    if (
      canonicalJson(Object.keys(entry).sort()) !==
      canonicalJson(["path", "postFixSha256", "preFixSha256"])
    )
      problems.push(
        `${label} must contain exactly path, preFixSha256, and postFixSha256`,
      );
    try {
      assertCanonicalRepoRelativePath(entry.path, `${label}.path`);
    } catch (error) {
      problems.push(error.message);
    }
    if (typeof entry.path === "string") {
      if (byPath.has(entry.path)) problems.push(`${label}.path is duplicated`);
      else byPath.set(entry.path, entry);
    }
    if (!SHA256.test(entry.preFixSha256 || ""))
      problems.push(`${label}.preFixSha256 is invalid`);
    if (!SHA256.test(entry.postFixSha256 || ""))
      problems.push(`${label}.postFixSha256 is invalid`);
    if (
      SHA256.test(entry.preFixSha256 || "") &&
      SHA256.test(entry.postFixSha256 || "") &&
      entry.preFixSha256 === entry.postFixSha256
    )
      problems.push(`${label} pre-fix and post-fix digests must differ`);
    if (
      /^[a-f0-9]{40,64}$/i.test(document.regression?.preFixCommit || "") &&
      SHA256.test(entry.preFixSha256 || "")
    ) {
      try {
        if (
          committedRegularFileSha256(
            repoRoot,
            document.regression.preFixCommit,
            entry.path,
          ) !== entry.preFixSha256
        )
          problems.push(
            `${label}.preFixSha256 does not match the exact pre-fix Git bytes`,
          );
      } catch (error) {
        problems.push(`${label} pre-fix binding is invalid: ${error.message}`);
      }
    }
    if (
      /^[a-f0-9]{40,64}$/i.test(document.regression?.postFixCommit || "") &&
      SHA256.test(entry.postFixSha256 || "")
    ) {
      try {
        if (
          committedRegularFileSha256(
            repoRoot,
            document.regression.postFixCommit,
            entry.path,
          ) !== entry.postFixSha256
        )
          problems.push(
            `${label}.postFixSha256 does not match the exact post-fix Git bytes`,
          );
      } catch (error) {
        problems.push(`${label} post-fix binding is invalid: ${error.message}`);
      }
    }
  }
  const normalized = [...declared].sort((left, right) =>
    String(left?.path || "") < String(right?.path || "")
      ? -1
      : String(left?.path || "") > String(right?.path || "")
        ? 1
        : 0,
  );
  if (canonicalJson(declared) !== canonicalJson(normalized))
    problems.push("RCA regression.causalInputs must use canonical path order");
  return { entries: declared, byPath, problems };
}

function causalProofBindingProblems(
  document,
  reproductionProof,
  regressionProof,
) {
  const problems = [];
  const declared = Array.isArray(document.regression?.causalInputs)
    ? document.regression.causalInputs
    : [];
  for (const entry of declared) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string")
      continue;
    for (const [phase, proof, expectedDigest] of [
      ["reproduction", reproductionProof, entry.preFixSha256],
      ["post-fix regression", regressionProof, entry.postFixSha256],
    ]) {
      if (!proof) continue;
      const bound = (proof.causalInputs || []).find(
        (candidate) => candidate?.path === entry.path,
      );
      if (!bound) {
        problems.push(
          `RCA ${phase} proof is missing digest-bound causal input: ${entry.path}`,
        );
        continue;
      }
      if (
        bound.beforeSha256 !== expectedDigest ||
        bound.afterSha256 !== expectedDigest
      ) {
        problems.push(
          `RCA ${phase} proof causal input does not match the exact ${phase === "reproduction" ? "pre-fix" : "post-fix"} Git bytes: ${entry.path}`,
        );
      }
    }
  }
  return problems;
}

function revisionProblems(document, repoRoot) {
  const problems = [];
  const regression = document.regression || {};
  const preFixCommit = regression.preFixCommit;
  const postFixCommit = regression.postFixCommit;
  const causalInputs = regressionCausalInputState(document, repoRoot);
  problems.push(...causalInputs.problems);
  if (!safeIdentifier(regression.id))
    problems.push("RCA regression.id is invalid");
  if (!SHA256.test(regression.commandSha256 || ""))
    problems.push(
      "RCA regression.commandSha256 must bind one regression command",
    );
  if (!nonEmpty(regression.failureSignature, 4))
    problems.push(
      "RCA regression.failureSignature must identify the reproduced failure",
    );
  if (!/^[a-f0-9]{40,64}$/i.test(preFixCommit || ""))
    problems.push("RCA regression.preFixCommit must be a Git commit hash");
  if (!/^[a-f0-9]{40,64}$/i.test(postFixCommit || ""))
    problems.push("RCA regression.postFixCommit must be a Git commit hash");
  if (preFixCommit && postFixCommit && preFixCommit === postFixCommit)
    problems.push("RCA pre-fix and post-fix commits must be distinct");
  if (postFixCommit && document.commit !== postFixCommit)
    problems.push("RCA commit must equal regression.postFixCommit");
  for (const [label, revision] of [
    ["pre-fix", preFixCommit],
    ["post-fix", postFixCommit],
  ]) {
    if (!/^[a-f0-9]{40,64}$/i.test(revision || "")) continue;
    const exists = git(repoRoot, ["cat-file", "-e", `${revision}^{commit}`]);
    if (exists.status !== 0)
      problems.push(`RCA ${label} commit does not exist in the repository`);
  }
  if (
    /^[a-f0-9]{40,64}$/i.test(preFixCommit || "") &&
    /^[a-f0-9]{40,64}$/i.test(postFixCommit || "") &&
    preFixCommit !== postFixCommit
  ) {
    const targetPrefix = targetGitPrefix(repoRoot);
    const targetPathspec = targetPrefix
      ? `:(top,literal)${targetPrefix.replace(/\/$/, "")}`
      : ".";
    const changed = git(repoRoot, [
      "diff",
      "--name-only",
      "-z",
      preFixCommit,
      postFixCommit,
      "--",
      targetPathspec,
    ]);
    if (changed.status !== 0)
      problems.push(
        "RCA could not verify the pre-fix to post-fix source change",
      );
    else {
      const changedPaths = [];
      for (const entry of changed.stdout
        .split("\0")
        .filter(Boolean)
        .map((value) => value.replaceAll("\\", "/"))) {
        if (targetPrefix && !entry.startsWith(targetPrefix)) {
          problems.push(
            `RCA pre/post diff escaped the commissioned target prefix: ${entry}`,
          );
          continue;
        }
        const targetRelative = targetPrefix
          ? entry.slice(targetPrefix.length)
          : entry;
        if (targetRelative) changedPaths.push(targetRelative);
      }
      const declaredFixPaths = Array.isArray(document.fix?.changedPaths)
        ? document.fix.changedPaths
        : [];
      const affectedPaths = Array.isArray(document.rootCause?.affectedPaths)
        ? document.rootCause.affectedPaths
        : [];
      if (changedPaths.length === 0)
        problems.push("RCA pre-fix and post-fix commits have no source change");
      if (declaredFixPaths.length === 0)
        problems.push(
          "RCA fix.changedPaths must identify changed source paths",
        );
      if (affectedPaths.length === 0)
        problems.push(
          "RCA rootCause.affectedPaths must identify the causal source paths",
        );
      for (const [label, paths] of [
        ["fix.changedPaths", declaredFixPaths],
        ["rootCause.affectedPaths", affectedPaths],
      ]) {
        for (const value of paths) {
          try {
            assertPortableArtifactPath(value);
            if (path.isAbsolute(value))
              throw new Error("path must be repository-relative");
          } catch (error) {
            problems.push(
              `RCA ${label} contains an invalid path: ${error.message}`,
            );
          }
        }
      }
      for (const value of declaredFixPaths)
        if (!changedPaths.includes(value))
          problems.push(
            `RCA fix.changedPaths is not present in the pre/post diff: ${value}`,
          );
      const causalFixPaths = affectedPaths.filter(
        (value) =>
          declaredFixPaths.includes(value) && changedPaths.includes(value),
      );
      if (causalFixPaths.length === 0)
        problems.push(
          "RCA root cause and fix must overlap on a changed source path",
        );
      else {
        const causalClass = document.rootCause?.causalClass;
        const remediationClass = document.fix?.remediationClass;
        if (causalClass !== undefined && !CAUSAL_CLASSES.has(causalClass))
          problems.push(
            "RCA rootCause.causalClass must be source-change or documentation-process when supplied",
          );
        if (
          remediationClass !== undefined &&
          !CAUSAL_CLASSES.has(remediationClass)
        )
          problems.push(
            "RCA fix.remediationClass must be source-change or documentation-process when supplied",
          );
        if (
          causalClass !== undefined &&
          remediationClass !== undefined &&
          causalClass !== remediationClass
        )
          problems.push(
            "RCA rootCause.causalClass and fix.remediationClass must match",
          );
        const nonEvidenceCausalPaths = causalFixPaths.filter(
          (value) => !isHarnessEvidencePath(value),
        );
        const documentationCausalPaths = nonEvidenceCausalPaths.filter(
          documentationProcessPath,
        );
        const sourceCausalPaths = nonEvidenceCausalPaths.filter(
          (value) => !documentationProcessPath(value),
        );
        for (const entry of causalInputs.entries) {
          if (
            typeof entry?.path === "string" &&
            !causalFixPaths.includes(entry.path)
          )
            problems.push(
              `RCA regression.causalInputs path must be a declared causal changed path: ${entry.path}`,
            );
        }
        for (const causalPath of documentationCausalPaths) {
          if (!causalInputs.byPath.has(causalPath))
            problems.push(
              `RCA documentation/process causal path is missing from regression.causalInputs: ${causalPath}`,
            );
        }
        if (
          sourceCausalPaths.length === 0 &&
          documentationCausalPaths.length === 0
        ) {
          problems.push(
            "RCA causal fix path must itself be a changed non-evidence source path or a typed documentation-process path",
          );
        } else if (sourceCausalPaths.length === 0) {
          if (
            causalClass !== "documentation-process" ||
            remediationClass !== "documentation-process"
          ) {
            problems.push(
              "RCA documentation-only causal fix requires rootCause.causalClass and fix.remediationClass to be documentation-process",
            );
          }
        } else if (
          causalClass === "documentation-process" ||
          remediationClass === "documentation-process"
        ) {
          problems.push(
            "RCA documentation-process classification cannot be used when the causal fix includes a non-documentation source path",
          );
        }
      }
    }
  }
  if (/^[a-f0-9]{40,64}$/i.test(postFixCommit || "")) {
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    if (head.status !== 0 || head.stdout.trim() !== postFixCommit)
      problems.push("RCA post-fix commit must equal current Git HEAD");
  }
  return problems;
}

export function validateRcaArtifact(document, repoRoot) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return { valid: false, problems: ["RCA artifact must be a JSON object"] };
  if (document.schema !== RCA_SCHEMA)
    problems.push(`RCA schema must be ${RCA_SCHEMA}`);
  if (document.status !== "confirmed")
    problems.push("RCA gate requires status confirmed");
  if (!safeIdentifier(document.runId)) problems.push("RCA runId is invalid");
  if (!safeIdentifier(document.commit)) problems.push("RCA commit is invalid");
  if (!safeIdentifier(document.environment))
    problems.push("RCA environment is invalid");
  if (!safeIdentifier(document.symptom?.id))
    problems.push("RCA symptom.id is invalid");
  if (!nonEmpty(document.symptom?.summary, 8))
    problems.push("RCA symptom.summary must describe the observed symptom");
  if (!nonEmpty(document.rootCause?.summary, 8))
    problems.push("RCA rootCause.summary is required");
  if (!nonEmpty(document.rootCause?.causalMechanism, 8))
    problems.push("RCA rootCause.causalMechanism is required");
  if (!nonEmpty(document.fix?.summary, 8))
    problems.push("RCA fix.summary is required");
  if (!nonEmpty(document.regression?.summary, 8))
    problems.push("RCA regression.summary is required");
  problems.push(...revisionProblems(document, repoRoot));
  if (!Array.isArray(document.evidence) || document.evidence.length === 0)
    problems.push("confirmed RCA requires typed evidence");

  const evidenceById = new Map();
  const runtimeProofByPhase = new Map();
  for (const [index, evidence] of (document.evidence || []).entries()) {
    const label = `RCA evidence ${index + 1}`;
    if (!safeIdentifier(evidence?.id)) problems.push(`${label} id is invalid`);
    else if (evidenceById.has(evidence.id))
      problems.push(`${label} id is duplicated`);
    else evidenceById.set(evidence.id, evidence);
    if (!EVIDENCE_TYPES.has(evidence?.type))
      problems.push(`${label} type must be typed RCA evidence`);
    if (!EVIDENCE_PHASES.has(evidence?.phase))
      problems.push(`${label} phase is invalid`);
    if (evidence?.symptomId !== document.symptom?.id)
      problems.push(`${label} must tie directly to symptom.id`);
    if (!nonEmpty(evidence?.observation, 8))
      problems.push(
        `${label} observation must describe the symptom and evidence tie`,
      );
    if (!nonEmpty(evidence?.artifact)) {
      problems.push(`${label} artifact is required`);
      continue;
    }
    if (!SHA256.test(evidence.sha256 || ""))
      problems.push(`${label} sha256 is invalid`);
    try {
      const artifactPath = resolveArtifactPath(repoRoot, evidence.artifact, {
        mustExist: true,
      });
      if (
        SHA256.test(evidence.sha256 || "") &&
        fileSha256(artifactPath) !== evidence.sha256
      )
        problems.push(`${label} sha256 does not match its artifact`);
      problems.push(
        ...secretDisclosureProblems(readFileSync(artifactPath, "utf8")).map(
          (problem) => `${label} ${problem}`,
        ),
      );
      if (evidence.type === "runtime-command") {
        let proof;
        try {
          proof = readJson(artifactPath);
        } catch (error) {
          problems.push(
            `${label} runtime-command artifact must be valid JSON: ${error.message}`,
          );
          continue;
        }
        const proofValidation = validatePortableProof(proof);
        if (!proofValidation.valid)
          problems.push(
            `${label} portable proof is invalid: ${proofValidation.problems.join("; ")}`,
          );
        if (
          ["reproduction", "post-fix-regression"].includes(evidence.phase) &&
          (proof.command?.executionInputs?.stability !== "static" ||
            proof.command?.executionInputs?.causalIdentityEligible !== true)
        ) {
          problems.push(
            `${label} opaque dynamic execution inputs are ineligible for RCA causal identity`,
          );
        }
        if (
          proof.source?.dirtyBefore !== false ||
          proof.source?.dirtyAfter !== false ||
          proof.source?.stable !== true
        )
          problems.push(
            `${label} regression proof must execute against a stable clean committed tree`,
          );
        const expectedCommit =
          evidence.phase === "reproduction"
            ? document.regression?.preFixCommit
            : document.regression?.postFixCommit;
        if (
          proof.run?.id !== document.runId ||
          proof.run?.commit !== expectedCommit ||
          proof.run?.environment !== document.environment
        )
          problems.push(
            `${label} portable proof subject does not match the RCA regression phase`,
          );
        if (
          evidence.phase === "reproduction" &&
          (proof.execution?.mode !== "red-baseline" ||
            proof.outcome?.status !== "red-confirmed")
        )
          problems.push(
            `${label} reproduction requires a red-confirmed portable proof`,
          );
        if (
          evidence.phase === "post-fix-regression" &&
          (proof.execution?.mode !== "green" ||
            proof.outcome?.status !== "passed" ||
            proof.outcome?.successful !== true)
        )
          problems.push(
            `${label} post-fix regression requires a passed green portable proof`,
          );
        if (
          !SHA256.test(evidence.proofBindingSha256 || "") ||
          evidence.proofBindingSha256 !== proof.bindings?.envelopeSha256
        )
          problems.push(
            `${label} proofBindingSha256 does not match the portable proof`,
          );
        if (evidence.regressionId !== document.regression?.id)
          problems.push(`${label} regressionId must match RCA regression.id`);
        if (
          proof.bindings?.commandSha256 !== document.regression?.commandSha256
        )
          problems.push(
            `${label} command does not match the bound regression identity`,
          );
        if (["reproduction", "post-fix-regression"].includes(evidence.phase))
          runtimeProofByPhase.set(evidence.phase, proof);
      }
    } catch (error) {
      problems.push(`${label} artifact is invalid: ${error.message}`);
    }
  }

  const references = [
    [
      "symptom.evidenceIds",
      document.symptom?.evidenceIds,
      "reproduction",
      new Set(["runtime-command"]),
    ],
    [
      "rootCause.evidenceIds",
      document.rootCause?.evidenceIds,
      "diagnosis",
      RUNTIME_EVIDENCE_TYPES,
    ],
    [
      "fix.evidenceIds",
      document.fix?.evidenceIds,
      "fix",
      new Set(["change-artifact"]),
    ],
    [
      "regression.evidenceIds",
      document.regression?.evidenceIds,
      "post-fix-regression",
      new Set(["runtime-command"]),
    ],
  ];
  for (const [field, ids, requiredPhase, requiredTypes] of references) {
    if (!Array.isArray(ids) || ids.length === 0)
      problems.push(`RCA ${field} must reference typed evidence`);
    else {
      for (const id of ids) {
        if (!evidenceById.has(id))
          problems.push(`RCA ${field} references unknown evidence: ${id}`);
      }
      if (
        !ids.some(
          (id) =>
            evidenceById.get(id)?.phase === requiredPhase &&
            requiredTypes.has(evidenceById.get(id)?.type),
        )
      )
        problems.push(`RCA ${field} must bind ${requiredPhase} evidence`);
    }
  }
  if (
    ![...evidenceById.values()].some(
      (evidence) =>
        evidence.type === "runtime-command" &&
        evidence.phase === "reproduction",
    )
  )
    problems.push("confirmed RCA requires a red reproduction portable proof");
  if (
    ![...evidenceById.values()].some(
      (evidence) =>
        evidence.type === "runtime-command" &&
        evidence.phase === "post-fix-regression",
    )
  )
    problems.push(
      "confirmed RCA requires a passed post-fix regression portable proof",
    );
  const reproductionProof = runtimeProofByPhase.get("reproduction");
  const regressionProof = runtimeProofByPhase.get("post-fix-regression");
  problems.push(
    ...causalProofBindingProblems(document, reproductionProof, regressionProof),
  );
  if (
    reproductionProof &&
    regressionProof &&
    reproductionProof.bindings?.commandSha256 !==
      regressionProof.bindings?.commandSha256
  )
    problems.push(
      "RCA reproduction and post-fix regression must execute the same command identity",
    );
  if (reproductionProof && nonEmpty(document.regression?.failureSignature, 4)) {
    const signature = document.regression.failureSignature;
    const attempts = reproductionProof.execution?.attempts || [];
    if (
      !attempts.length ||
      attempts.some(
        (attempt) =>
          !`${attempt.stdout?.text || ""}\n${attempt.stderr?.text || ""}`.includes(
            signature,
          ),
      )
    )
      problems.push(
        "RCA reproduction proof does not contain the declared failure signature in every attempt",
      );
  }
  problems.push(...agentSelfGrantProblems(document, "rca"));
  problems.push(...secretDisclosureProblems(document));
  return {
    valid: problems.length === 0,
    problems,
    evidenceCount: evidenceById.size,
  };
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
  if (args.help)
    return console.log(
      "Usage: node scripts/rca-gate.mjs --repo . [--file rca/rca.json]",
    );
  const repoRoot = path.resolve(args.repo);
  const file = resolveArtifactPath(repoRoot, args.file, { mustExist: true });
  const result = validateRcaArtifact(readJson(file), repoRoot);
  console.log(
    JSON.stringify(
      {
        ok: result.valid,
        artifact: path.relative(repoRoot, file),
        evidenceCount: result.evidenceCount || 0,
        problems: result.problems,
      },
      null,
      2,
    ),
  );
  if (!result.valid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
