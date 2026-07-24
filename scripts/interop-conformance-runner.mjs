#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTEROP_TESTS,
  interopConformanceExpectation,
  validateInteropTranscriptDocument,
} from "./operating-contracts-lib.mjs";
import {
  assertCanonicalRepoRelativePath,
  canonicalJson,
  resolveArtifactPath,
  safeIdentifier,
  sha256,
} from "./proof-runner.mjs";

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    timeoutMs: 10_000,
    outputBytes: 1_048_576,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") args.repo = argv[++index];
    else if (arg === "--protocol") args.protocol = argv[++index];
    else if (arg === "--version") args.version = argv[++index];
    else if (arg === "--identity-sha256") args.identitySha256 = argv[++index];
    else if (arg === "--auth-root-sha256") args.authRootSha256 = argv[++index];
    else if (arg === "--capabilities-json")
      args.capabilitiesJson = argv[++index];
    else if (arg === "--command-json") args.commandJson = argv[++index];
    else if (arg === "--run-id") args.runId = argv[++index];
    else if (arg === "--commit") args.commit = argv[++index];
    else if (arg === "--environment") args.environment = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg === "--output-bytes") args.outputBytes = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function assertResponse(id, response, request, expectedResult) {
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error(`interop test ${id} response must be a JSON object`);
  const expectedFields = [
    "correlationId",
    "id",
    "protocol",
    "requestSha256",
    "result",
    "schema",
    "status",
    "version",
  ];
  if (
    canonicalJson(Object.keys(response).sort()) !==
    canonicalJson(expectedFields)
  )
    throw new Error(
      `interop test ${id} response must use the exact typed response fields`,
    );
  if (
    response.schema !== "valdris.interop-conformance-response.v1" ||
    response.id !== id ||
    response.status !== "passed" ||
    response.protocol !== request.protocol ||
    response.version !== request.version ||
    response.correlationId !== request.correlationId ||
    response.requestSha256 !== sha256(canonicalJson(request))
  )
    throw new Error(
      `interop test ${id} response envelope does not bind the request, protocol, version, and correlation`,
    );
  if (
    !response.result ||
    typeof response.result !== "object" ||
    Array.isArray(response.result) ||
    canonicalJson(response.result) !== canonicalJson(expectedResult)
  )
    throw new Error(
      `interop test ${id} response result does not satisfy its typed behavioral assertion`,
    );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/interop-conformance-runner.mjs --repo . --protocol mcp|a2a --version VERSION --identity-sha256 SHA256 --auth-root-sha256 SHA256 --capabilities-json '[\"tools\"]' --command-json '[\"adapter\"]' --run-id ID --commit SHA --environment ENV --output runtime/interop/mcp.json",
    );
  const digest = (value) => /^[a-f0-9]{64}$/i.test(value || "");
  if (!["mcp", "a2a"].includes(args.protocol))
    throw new Error("--protocol must be mcp or a2a");
  if (
    !args.version ||
    !safeIdentifier(args.runId) ||
    !safeIdentifier(args.commit) ||
    !safeIdentifier(args.environment) ||
    !digest(args.identitySha256) ||
    !digest(args.authRootSha256)
  )
    throw new Error("interop subject and identities are invalid");
  if (
    !Number.isSafeInteger(args.timeoutMs) ||
    args.timeoutMs < 1 ||
    !Number.isSafeInteger(args.outputBytes) ||
    args.outputBytes < 1
  )
    throw new Error("interop execution limits are invalid");
  let capabilities;
  let command;
  try {
    capabilities = JSON.parse(args.capabilitiesJson);
    command = JSON.parse(args.commandJson);
  } catch {
    throw new Error("capabilities and command must be valid JSON arrays");
  }
  if (
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    capabilities.some((entry) => !safeIdentifier(entry)) ||
    new Set(capabilities).size !== capabilities.length ||
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((entry) => typeof entry !== "string" || !entry.length)
  )
    throw new Error("capabilities and command must be non-empty unique arrays");
  const cleanEnvironment = Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "HOME", "USERPROFILE"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  const tests = INTEROP_TESTS.map((id) => {
    const expectation = interopConformanceExpectation(id, {
      ...args,
      capabilities,
    });
    const { request, expectedResult } = expectation;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const result = spawnSync(command[0], command.slice(1), {
      cwd: path.resolve(args.repo),
      encoding: "utf8",
      env: cleanEnvironment,
      input: `${JSON.stringify(request)}\n`,
      shell: false,
      timeout: args.timeoutMs,
      maxBuffer: args.outputBytes,
      windowsHide: true,
    });
    const durationMs = Date.now() - started;
    const finishedAt = new Date().toISOString();
    if (result.error || result.status !== 0)
      throw new Error(
        `interop test ${id} failed: ${result.error?.message || result.stderr || result.stdout}`,
      );
    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw new Error(`interop test ${id} returned invalid JSON`);
    }
    assertResponse(id, response, request, expectedResult);
    if (id === "timeout" && durationMs > request.test.deadlineMs)
      throw new Error(
        `interop test ${id} exceeded its independently measured deadline`,
      );
    return {
      id,
      status: "passed",
      requestSha256: expectation.requestSha256,
      responseSha256: sha256(canonicalJson(response)),
      assertionSha256: expectation.assertionSha256,
      startedAt,
      finishedAt,
    };
  });
  const transcript = {
    schema: "valdris.interop-transcript.v1",
    generatedAt: new Date().toISOString(),
    status: "ready",
    runId: args.runId,
    commit: args.commit,
    environment: args.environment,
    protocol: args.protocol,
    version: args.version,
    identitySha256: args.identitySha256.toLowerCase(),
    authRootSha256: args.authRootSha256.toLowerCase(),
    capabilities,
    capabilitySetSha256: sha256(canonicalJson(capabilities)),
    timeoutMs: args.timeoutMs,
    tests,
  };
  const validation = validateInteropTranscriptDocument(transcript, {
    protocol: args.protocol,
    version: args.version,
    identitySha256: args.identitySha256.toLowerCase(),
    authRootSha256: args.authRootSha256.toLowerCase(),
    capabilities,
    capabilitySetSha256: sha256(canonicalJson(capabilities)),
    timeoutMs: args.timeoutMs,
    allowPendingExecutionReceipt: true,
  });
  if (!validation.valid)
    throw new Error(
      `interop transcript is invalid: ${validation.problems.join("; ")}`,
    );
  const output = args.output || `runtime/interop/${args.protocol}.json`;
  assertCanonicalRepoRelativePath(output, "interop transcript output");
  const target = resolveArtifactPath(path.resolve(args.repo), output, {
    mustExist: false,
  });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(transcript, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        output,
        tests: tests.length,
        attestationRequired: true,
      },
      null,
      2,
    ),
  );
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
