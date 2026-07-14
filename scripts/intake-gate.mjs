#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, isIsoTimestamp, nonEmpty, parseRepoFileArgs, readJson } from "./control-gate-lib.mjs";
import { MANDATORY_FORBIDDEN_ACTIONS } from "./workload-classifier-lib.mjs";

export const INTAKE_SCHEMA = "uash.intake.v1";
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);
const EXECUTION_BUDGET_LIMITS = Object.freeze({ attempts: 24, toolCalls: 1200, tokens: 2500000, costUsd: 1000, wallClockMinutes: 10080 });

export function validateIntakeDocument(document) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["intake must be a JSON object"] };
  if (document.schema !== INTAKE_SCHEMA) problems.push(`intake schema must be ${INTAKE_SCHEMA}`);
  if (!nonEmpty(document.runId)) problems.push("intake runId is required");
  if (!isIsoTimestamp(document.receivedAt)) problems.push("intake receivedAt must be an ISO timestamp");
  if (!PROFILES.has(document.profile)) problems.push("intake profile is invalid");
  if (document.requestedProfile !== document.profile) problems.push("intake requestedProfile must match profile");
  if (!nonEmpty(document.commit)) problems.push("intake commit is required");
  if (!nonEmpty(document.environment)) problems.push("intake environment is required");
  if (!nonEmpty(document.requestText)) problems.push("intake requestText is required");
  const digest = createHash("sha256").update(nonEmpty(document.requestText)).digest("hex");
  if (document.requestSha256 !== digest) problems.push("intake requestSha256 does not match requestText");
  if (document.source?.actorType !== "human" || !nonEmpty(document.source?.actor)) problems.push("intake source must identify a human actor");
  for (const field of ["constraints", "exclusions", "allowedActions", "forbiddenActions"]) if (!Array.isArray(document[field]) || document[field].some((item) => !nonEmpty(item))) problems.push(`intake ${field} must be a string array`);
  for (const action of MANDATORY_FORBIDDEN_ACTIONS) if (!document.forbiddenActions?.includes(action)) problems.push(`intake forbiddenActions missing mandatory boundary: ${action}`);
  for (const action of document.allowedActions || []) if (/\b(without (?:human )?approval|bypass approval|self[- ]?approv|read secrets?|access secrets?|deploy production|production mutation)\b/i.test(action)) problems.push(`intake allowedActions contains an unsafe authority claim: ${action}`);
  if (!nonEmpty(document.outcome)) problems.push("intake outcome is required");
  if (!document.executionBudget || typeof document.executionBudget !== "object" || Array.isArray(document.executionBudget)) problems.push("intake executionBudget is required");
  else for (const [field, maximum] of Object.entries(EXECUTION_BUDGET_LIMITS)) {
    const value = document.executionBudget[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) problems.push(`intake executionBudget.${field} must be a positive number`);
    else if (value > maximum) problems.push(`intake executionBudget.${field} exceeds the immutable conservative ceiling ${maximum}`);
  }
  if (!Array.isArray(document.stoppingConditions) || document.stoppingConditions.length === 0 || document.stoppingConditions.some((item) => !nonEmpty(item))) problems.push("intake stoppingConditions must be a non-empty string array");
  return { valid: problems.length === 0, schema: document.schema, runId: document.runId, requestSha256: document.requestSha256, problems };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "run/intake.json" });
  if (args.help) return console.log("Usage: node scripts/intake-gate.mjs --repo . [--file run/intake.json]");
  const target = path.resolve(args.repo, args.file);
  if (!existsSync(target)) return gateResult(args.file, { valid: false, problems: [`intake missing: ${args.file}`] });
  try { gateResult(args.file, validateIntakeDocument(readJson(target))); }
  catch (error) { gateResult(args.file, { valid: false, problems: [`intake must be valid JSON: ${error.message}`] }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
