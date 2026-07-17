#!/usr/bin/env node
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileSha256, readJson, resolveArtifactPath, safeIdentifier } from "./proof-runner.mjs";
import { CANONICAL_INPUT_PATHS, packetBindings, reviewEvidenceBundle, reviewEvidenceBundleSha256, routeRequiredGates, RUN_PACKET_SCHEMA, validateRunPacket, validationRuntimeBinding } from "./run-packet-gate.mjs";

function normalizedRelative(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function parseGate(value) {
  const separator = String(value || "").indexOf("=");
  if (separator < 1 || separator === value.length - 1) throw new Error("--gate must use name=artifact/path.json");
  return { name: value.slice(0, separator), artifactPath: value.slice(separator + 1) };
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), intake: "run/intake.json", route: "run/route.json", classification: "run/workload-classification.json", goal: "goal/goal.json", output: "run/packet.json", gates: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--run-id") args.runId = argv[++index];
    else if (arg === "--commit") args.commit = argv[++index];
    else if (arg === "--environment") args.environment = argv[++index];
    else if (arg === "--intake") args.intake = argv[++index];
    else if (arg === "--route") args.route = argv[++index];
    else if (arg === "--classification") args.classification = argv[++index];
    else if (arg === "--goal") args.goal = argv[++index];
    else if (arg === "--proof") args.proof = argv[++index];
    else if (arg === "--review") args.review = argv[++index];
    else if (arg === "--rca") args.rca = argv[++index];
    else if (arg === "--gate") args.gates.push(parseGate(argv[++index]));
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--print-evidence-bundle") args.printEvidenceBundle = true;
    else if (arg === "--force") throw new Error("--force is disabled: run packets are immutable");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return "Usage: node scripts/run-create.mjs --repo . --run-id ID --commit SHA --environment NAME --proof proof/portable.json [--review review/review.json | --print-evidence-bundle] [--rca rca/rca.json] [--gate name=path] [--intake run/intake.json] [--route run/route.json] [--classification run/workload-classification.json] [--goal goal/goal.json] [--output run/packet.json]";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(usage());
  if (!safeIdentifier(args.runId)) throw new Error("--run-id must be a safe identifier");
  if (!safeIdentifier(args.commit)) throw new Error("--commit must be a safe identifier");
  if (!safeIdentifier(args.environment)) throw new Error("--environment must be a safe identifier");
  if (!args.proof) throw new Error("--proof is required");
  if (!args.review && !args.printEvidenceBundle) throw new Error("--review is required unless --print-evidence-bundle is used");

  const repoRoot = realpathSync(path.resolve(args.repo));
  const inputFiles = {
    intake: resolveArtifactPath(repoRoot, args.intake, { mustExist: true }),
    route: resolveArtifactPath(repoRoot, args.route, { mustExist: true }),
    classification: resolveArtifactPath(repoRoot, args.classification, { mustExist: true }),
    goal: resolveArtifactPath(repoRoot, args.goal, { mustExist: true }),
  };
  for (const [name, file] of Object.entries(inputFiles)) {
    if (normalizedRelative(repoRoot, file) !== CANONICAL_INPUT_PATHS[name]) {
      throw new Error(`input ${name} must use canonical path ${CANONICAL_INPUT_PATHS[name]}`);
    }
  }
  const intake = readJson(inputFiles.intake);
  const classification = readJson(inputFiles.classification);
  const route = readJson(inputFiles.route);
  const requiredGates = routeRequiredGates(route, intake, classification);
  const suppliedGates = new Map();
  const addGate = (name, artifactPath) => {
    if (!artifactPath) return;
    if (!safeIdentifier(name)) throw new Error(`gate name is invalid: ${name}`);
    if (suppliedGates.has(name)) throw new Error(`gate was supplied more than once: ${name}`);
    suppliedGates.set(name, artifactPath);
  };
  addGate("portable-proof", args.proof);
  addGate("independent-review", args.review);
  addGate("rca", args.rca);
  for (const gate of args.gates) addGate(gate.name, gate.artifactPath);
  for (const gate of requiredGates) {
    if (args.printEvidenceBundle && gate === "independent-review") continue;
    if (!suppliedGates.has(gate)) throw new Error(`required gate artifact was not supplied: ${gate}`);
  }
  for (const gate of suppliedGates.keys()) {
    if (!requiredGates.includes(gate)) throw new Error(`gate is not required by this route: ${gate}`);
  }

  const gateArtifacts = requiredGates.filter((gate) => suppliedGates.has(gate)).map((gate) => {
    const file = resolveArtifactPath(repoRoot, suppliedGates.get(gate), { mustExist: true });
    return { gate, path: normalizedRelative(repoRoot, file), sha256: fileSha256(file), required: true, runId: args.runId, commit: args.commit, environment: args.environment };
  });
  const packet = {
    schema: RUN_PACKET_SCHEMA,
    generatedAt: new Date().toISOString(),
    status: "ready",
    runId: args.runId,
    commit: args.commit,
    environment: args.environment,
    inputs: Object.fromEntries(Object.entries(inputFiles).map(([name, file]) => [name, { path: normalizedRelative(repoRoot, file), sha256: fileSha256(file) }])),
    validationRuntime: validationRuntimeBinding(repoRoot, args.commit),
    requiredGates,
    gateArtifacts,
  };
  if (args.printEvidenceBundle) {
    const evidenceBundle = reviewEvidenceBundle(packet);
    return console.log(JSON.stringify({ ok: true, evidenceBundle, evidenceBundleSha256: reviewEvidenceBundleSha256(packet) }, null, 2));
  }
  packet.bindings = packetBindings(packet);
  const validation = validateRunPacket(packet, repoRoot);
  if (!validation.valid) throw new Error(`refusing to create invalid run packet: ${validation.problems.join("; ")}`);

  const output = resolveArtifactPath(repoRoot, args.output);
  if (existsSync(output)) throw new Error("run packets are immutable; choose a new output path");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ ok: true, artifact: normalizedRelative(repoRoot, output), runId: packet.runId, requiredGates: packet.requiredGates, binding: packet.bindings.envelopeSha256 }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
