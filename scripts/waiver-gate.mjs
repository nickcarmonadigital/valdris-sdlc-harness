#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, isIsoTimestamp, nonEmpty, parseRepoFileArgs, readJson } from "./control-gate-lib.mjs";

export const WAIVER_SCHEMA = "uash.waiver-ledger.v1";
const PROFILES = new Set(["prototype", "production", "enterprise", "regulated"]);

export function validateWaiverLedgerDocument(document) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return { valid: false, problems: ["waiver ledger must be a JSON object"] };
  if (document.schema !== WAIVER_SCHEMA) problems.push(`waiver ledger schema must be ${WAIVER_SCHEMA}`);
  if (!nonEmpty(document.runId)) problems.push("waiver ledger runId is required");
  if (!PROFILES.has(document.profile)) problems.push("waiver ledger profile is invalid");
  if (!nonEmpty(document.commit)) problems.push("waiver ledger commit is required");
  if (!nonEmpty(document.environment)) problems.push("waiver ledger environment is required");
  if (!isIsoTimestamp(document.generatedAt)) problems.push("waiver ledger generatedAt must be an ISO timestamp");
  if (!Array.isArray(document.waivers)) problems.push("waiver ledger waivers must be an array");
  const ids = new Set();
  for (const [index, waiver] of (document.waivers || []).entries()) {
    const label = `waiver[${index}]`;
    if (!nonEmpty(waiver.id)) problems.push(`${label}.id is required`);
    else if (ids.has(waiver.id)) problems.push(`waiver duplicated: ${waiver.id}`);
    else ids.add(waiver.id);
    if (!nonEmpty(waiver.controlId)) problems.push(`${label}.controlId is required`);
    if (waiver.status !== "active") problems.push(`${label}.status must be active`);
    if (!nonEmpty(waiver.reason)) problems.push(`${label}.reason is required`);
    if (!nonEmpty(waiver.riskOwner) || waiver.riskOwnerType !== "human") problems.push(`${label} must name a human risk owner`);
    if (!nonEmpty(waiver.approvedBy) || waiver.approvedByType !== "human") problems.push(`${label} must name a human approver`);
    if (!nonEmpty(waiver.approvalEventId)) problems.push(`${label}.approvalEventId is required`);
    if (!nonEmpty(waiver.scope)) problems.push(`${label}.scope is required`);
    if (!Array.isArray(waiver.compensatingControls) || waiver.compensatingControls.length === 0 || waiver.compensatingControls.some((item) => !nonEmpty(item))) problems.push(`${label}.compensatingControls must be non-empty`);
    if (!/^https:\/\//i.test(nonEmpty(waiver.remediationIssue))) problems.push(`${label}.remediationIssue must use https`);
    if (!isIsoTimestamp(waiver.issuedAt) || !isIsoTimestamp(waiver.expiresAt)) problems.push(`${label} issuedAt and expiresAt must be ISO timestamps`);
    if (isIsoTimestamp(waiver.issuedAt) && isIsoTimestamp(waiver.expiresAt) && Date.parse(waiver.expiresAt) <= Date.parse(waiver.issuedAt)) problems.push(`${label}.expiresAt must be after issuedAt`);
    if (isIsoTimestamp(waiver.expiresAt) && Date.parse(waiver.expiresAt) < Date.parse(document.generatedAt)) problems.push(`${label} is expired`);
  }
  return { valid: problems.length === 0, schema: document.schema, runId: document.runId, waiverCount: document.waivers?.length || 0, problems };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), { file: "waivers/waivers.json" });
  if (args.help) return console.log("Usage: node scripts/waiver-gate.mjs --repo . [--file waivers/waivers.json]");
  const target = path.resolve(args.repo, args.file);
  if (!existsSync(target)) return gateResult(args.file, { valid: false, problems: [`waiver ledger missing: ${args.file}`] });
  try { gateResult(args.file, validateWaiverLedgerDocument(readJson(target))); }
  catch (error) { gateResult(args.file, { valid: false, problems: [`waiver ledger must be valid JSON: ${error.message}`] }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
