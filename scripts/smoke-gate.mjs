#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  validateControl,
} from "./control-gate-lib.mjs";

export const SMOKE_SCHEMA = "uash.live-smoke.v1";
const PROFILES = new Set([
  "prototype",
  "production",
  "enterprise",
  "regulated",
]);

export function validateSmoke(document, { repoRoot }) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return {
      valid: false,
      problems: ["live smoke proof must be a JSON object"],
    };
  if (document.schema !== SMOKE_SCHEMA)
    problems.push(`live smoke schema must be ${SMOKE_SCHEMA}`);
  if (!isIsoTimestamp(document.generatedAt))
    problems.push("live smoke generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId)) problems.push("live smoke runId is required");
  if (!PROFILES.has(document.profile))
    problems.push("live smoke profile is invalid");
  if (!nonEmpty(document.commit))
    problems.push("live smoke commit is required");
  if (!nonEmpty(document.environment))
    problems.push("live smoke environment is required");
  if (document.status !== "passed")
    problems.push("live smoke status must be passed");
  if (!nonEmpty(document.target?.kind))
    problems.push("live smoke target.kind is required");
  if (!nonEmpty(document.target?.identifier))
    problems.push("live smoke target.identifier is required");
  const control = document.control;
  if (control?.id !== "LIVE-SMOKE-001")
    problems.push("live smoke control.id must be LIVE-SMOKE-001");
  problems.push(
    ...validateControl(control, {
      repoRoot,
      profile: document.profile,
      label: "live smoke control",
      allowSkipped: false,
      asOf: document.generatedAt,
      runId: document.runId,
      commit: document.commit,
      environment: document.environment,
    }),
  );
  const evidence = Array.isArray(control?.evidence) ? control.evidence : [];
  const trustedRuntimeEvidence = evidence.some(
    (item) =>
      item?.type === "provider-report" ||
      (item?.type === "command" &&
        item.trustTier === "ci-attested" &&
        item.producer?.kind === "ci"),
  );
  if (!trustedRuntimeEvidence)
    problems.push(
      "LIVE-SMOKE-001 requires CI-command or provider-attested evidence from the target environment",
    );
  if (
    !evidence.some(
      (item) => item?.targetIdentifier === document.target?.identifier,
    )
  )
    problems.push(
      "LIVE-SMOKE-001 evidence must bind targetIdentifier to target.identifier",
    );
  if (["testflight", "app-store"].includes(document.target?.kind)) {
    const appleReport = evidence.find(
      (item) =>
        item?.type === "provider-report" &&
        /app store connect|testflight/i.test(item.provider || "") &&
        /^https:\/\/(appstoreconnect|itunesconnect)\.apple\.com\//i.test(
          item.url || "",
        ),
    );
    if (!appleReport)
      problems.push(
        "TestFlight/App Store smoke requires an Apple provider report",
      );
    for (const field of ["scheme", "bundleAndTeam", "commissioningSha256"]) {
      if (!nonEmpty(document.target?.[field]))
        problems.push(`TestFlight/App Store smoke target.${field} is required`);
      if (!evidence.some((item) => item?.[field] === document.target?.[field]))
        problems.push(
          `TestFlight/App Store smoke evidence must bind ${field} to the target`,
        );
    }
    if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.target?.commissioningSha256)))
      problems.push(
        "TestFlight/App Store smoke target.commissioningSha256 must be a SHA-256 digest",
      );
  }
  return { valid: problems.length === 0, schema: document.schema, problems };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: "smoke/smoke_proof.json",
  });
  if (args.help)
    return console.log(
      "Usage: node scripts/smoke-gate.mjs --repo . [--file smoke/smoke_proof.json]",
    );
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  if (!existsSync(target))
    return gateResult(args.file, {
      valid: false,
      problems: [`live smoke proof missing: ${args.file}`],
    });
  try {
    gateResult(args.file, validateSmoke(readJson(target), { repoRoot }));
  } catch (error) {
    gateResult(args.file, {
      valid: false,
      problems: [`live smoke proof must be valid JSON: ${error.message}`],
    });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
