#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTEROP_TESTS,
  validateInteropTranscriptDocument,
} from "./operating-contracts-lib.mjs";
import {
  assertCanonicalRepoRelativePath,
  canonicalJson,
  resolveArtifactPath,
  safeIdentifier,
  sha256,
} from "./proof-runner.mjs";

const REQUEST_SCHEMA = "valdris.interop-conformance-request.v1";
const RESPONSE_SCHEMA = "valdris.interop-conformance-response.v1";
const ASSERTION_SCHEMA = "valdris.interop-conformance-assertion.v1";
const REQUEST_ENVELOPE_SCHEMA = "valdris.interop-envelope.request.v1";
const RESPONSE_ENVELOPE_SCHEMA = "valdris.interop-envelope.response.v1";

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

function challenge(args, id, purpose) {
  return sha256(
    canonicalJson({
      protocol: args.protocol,
      version: args.version,
      runId: args.runId,
      identitySha256: args.identitySha256.toLowerCase(),
      authRootSha256: args.authRootSha256.toLowerCase(),
      id,
      purpose,
    }),
  );
}

function testContract(id, args, capabilities) {
  const capabilitySetSha256 = sha256(canonicalJson(capabilities));
  switch (id) {
    case "initialize":
      return {
        request: {
          operation: "initialize",
          clientIdentitySha256: challenge(args, id, "client-identity"),
          supportedVersions: [args.version],
          requestedCapabilities: capabilities,
        },
        expectedResult: {
          initialized: true,
          selectedVersion: args.version,
          serverIdentitySha256: args.identitySha256.toLowerCase(),
          authRootSha256: args.authRootSha256.toLowerCase(),
          capabilitySetSha256,
        },
      };
    case "version-negotiation": {
      const unsupportedVersion = `${args.version}-unsupported`;
      return {
        request: {
          operation: "negotiate-version",
          offeredVersions: [unsupportedVersion, args.version],
        },
        expectedResult: {
          negotiation: "compatible",
          selectedVersion: args.version,
          rejectedVersions: [unsupportedVersion],
        },
      };
    }
    case "auth-root-isolation": {
      const rejectedRootSha256 = challenge(args, id, "unauthorized-auth-root");
      return {
        request: {
          operation: "probe-auth-root",
          authorizedRootSha256: args.authRootSha256.toLowerCase(),
          candidateRootSha256: rejectedRootSha256,
        },
        expectedResult: {
          isolation: "enforced",
          allowedRootSha256: args.authRootSha256.toLowerCase(),
          rejectedRootSha256,
        },
      };
    }
    case "capability-discovery": {
      const unknownCapability = "valdris-unknown-capability";
      return {
        request: {
          operation: "discover-capabilities",
          requestedCapabilities: [...capabilities, unknownCapability],
        },
        expectedResult: {
          advertisedCapabilities: capabilities,
          unsupportedCapabilities: [unknownCapability],
          capabilitySetSha256,
        },
      };
    }
    case "schema-negotiation": {
      const unsupportedSchema = "valdris.interop-envelope.v0";
      return {
        request: {
          operation: "negotiate-schema",
          requestSchemas: [unsupportedSchema, REQUEST_ENVELOPE_SCHEMA],
          responseSchemas: [unsupportedSchema, RESPONSE_ENVELOPE_SCHEMA],
        },
        expectedResult: {
          negotiation: "compatible",
          selectedRequestSchema: REQUEST_ENVELOPE_SCHEMA,
          selectedResponseSchema: RESPONSE_ENVELOPE_SCHEMA,
          rejectedSchemas: [unsupportedSchema],
        },
      };
    }
    case "event-correlation": {
      const payloadSha256 = challenge(args, id, "event-payload");
      const correlationId = challenge(args, id, "correlation");
      return {
        request: {
          operation: "correlate-event",
          event: {
            correlationId,
            payloadSha256,
          },
        },
        expectedResult: {
          correlationId,
          eventSha256: sha256(canonicalJson({ correlationId, payloadSha256 })),
          correlated: true,
        },
      };
    }
    case "timeout":
      return {
        request: {
          operation: "deadline-probe",
          deadlineMs: args.timeoutMs,
          workloadSha256: challenge(args, id, "bounded-workload"),
        },
        expectedResult: {
          deadlineMs: args.timeoutMs,
          deadlineEnforced: true,
          timedOut: false,
          completedWithinDeadline: true,
        },
      };
    case "cancellation": {
      const cancellationTokenSha256 = challenge(args, id, "cancellation-token");
      return {
        request: {
          operation: "cancel",
          cancellationTokenSha256,
          pendingOperationSha256: challenge(args, id, "pending-operation"),
        },
        expectedResult: {
          cancellationTokenSha256,
          cancelled: true,
          mutationObserved: false,
        },
      };
    }
    case "unknown-tool-rejection": {
      const toolName = `valdris.unknown.${challenge(args, id, "tool").slice(0, 16)}`;
      return {
        request: {
          operation: "invoke-tool",
          toolName,
          argumentsSha256: challenge(args, id, "tool-arguments"),
        },
        expectedResult: {
          decision: "rejected",
          errorCode: "UNKNOWN_TOOL",
          toolNameSha256: sha256(toolName),
        },
      };
    }
    case "replay-protection": {
      const nonce = challenge(args, id, "replay-nonce");
      return {
        request: {
          operation: "replay-probe",
          nonce,
          sequence: 1,
          attempts: 2,
        },
        expectedResult: {
          nonceSha256: sha256(nonce),
          firstDecision: "accepted",
          replayDecision: "rejected",
          errorCode: "REPLAY_DETECTED",
        },
      };
    }
    default:
      throw new Error(`unsupported interop conformance test: ${id}`);
  }
}

function buildRequest(id, args, capabilities) {
  const contract = testContract(id, args, capabilities);
  const request = {
    schema: REQUEST_SCHEMA,
    protocol: args.protocol,
    version: args.version,
    id,
    correlationId: challenge(args, id, "request-correlation"),
    identitySha256: args.identitySha256.toLowerCase(),
    authRootSha256: args.authRootSha256.toLowerCase(),
    capabilities,
    test: contract.request,
  };
  return { request, expectedResult: contract.expectedResult };
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
    response.schema !== RESPONSE_SCHEMA ||
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
    const { request, expectedResult } = buildRequest(id, args, capabilities);
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
      requestSha256: sha256(canonicalJson(request)),
      responseSha256: sha256(canonicalJson(response)),
      assertionSha256: sha256(
        canonicalJson({
          schema: ASSERTION_SCHEMA,
          id,
          requestSchema: REQUEST_SCHEMA,
          responseSchema: RESPONSE_SCHEMA,
          expectedResult,
        }),
      ),
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
    capabilitySetSha256: sha256(canonicalJson(capabilities)),
    tests,
  };
  const validation = validateInteropTranscriptDocument(transcript, {
    protocol: args.protocol,
    version: args.version,
    identitySha256: args.identitySha256.toLowerCase(),
    capabilitySetSha256: sha256(canonicalJson(capabilities)),
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
    JSON.stringify({ ok: true, output, tests: tests.length }, null, 2),
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
