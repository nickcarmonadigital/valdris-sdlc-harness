#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privacyGate = path.join(repo, "scripts", "privacy-gate.mjs");

function write(target, value) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function runGate(fixture) {
  return spawnSync(process.execPath, [privacyGate, "--repo", fixture, "--release-artifact", ".next"], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    killSignal: "SIGTERM",
  });
}

function parseOutput(result) {
  assert.notEqual(result.status, null, `privacy gate did not exit: ${result.error?.message || "unknown error"}`);
  assert.ok(result.stdout.trim(), `privacy gate returned no JSON: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const fixture = mkdtempSync(path.join(os.tmpdir(), "valdris-release-privacy-"));
const missingFixture = mkdtempSync(path.join(os.tmpdir(), "valdris-release-privacy-missing-"));
const syntheticToken = `github_pat_${"A7".repeat(18)}`;
const syntheticWindowsPath = ["C:", "Users", "builder", "src", "page.ts"].join("\\");
const sourceMapPath = path.join(fixture, ".next", "server", "app", "page.js.map");
const cleanSourceMap = JSON.stringify({
  version: 3,
  file: "page.js",
  sources: ["webpack://_N_E/./app/page.ts"],
  sourcesContent: ["export default function Page() { return null; }"],
  names: [],
  mappings: "",
});
const compressedSourceMaps = [
  { extension: "gz", bytes: gzipSync(cleanSourceMap) },
  { extension: "br", bytes: brotliCompressSync(cleanSourceMap) },
  {
    extension: "zip",
    bytes: Buffer.from(
      "UEsDBBQAAAAIAGxO8VyJ1QTvPgAAAEQAAAALAAAAcGFnZS5qcy5tYXCrVipLLSrOzM9TsjLWUUrLzElVslIqSExP1csqVtJRKs4vLUpOLVayio7VUcpLzIUxcxMLCjLz0oE8JaVaAFBLAQIUABQAAAAIAGxO8VyJ1QTvPgAAAEQAAAALAAAAAAAAAAAAAAAAAAAAAABwYWdlLmpzLm1hcFBLBQYAAAAAAQABADkAAABnAAAAAAA=",
      "base64",
    ),
  },
];

try {
  write(path.join(fixture, ".next", "BUILD_ID"), "fixture-build\n");
  write(
    path.join(fixture, ".next", "server", "app", "page.js"),
    'const token = "configured"; const password = process.env.PASSWORD; export default token;\n',
  );
  write(path.join(fixture, ".next", "static", "chunks", "app.js"), 'self.__nextChunk = { status: "ready" };\n');
  write(path.join(fixture, ".next", "static", "media", "font.woff2"), Buffer.from([0, 1, 2, 3, 4]));

  // These are build-time/generated surfaces, except source maps which may be deployed or uploaded.
  write(path.join(fixture, ".next", "cache", "turbopack", "cache.sst"), Buffer.from([0, 4, 8, 12]));
  write(path.join(fixture, ".next", "dev", "server", "noisy.js"), `const token = "${syntheticToken}";\n`);
  write(sourceMapPath, `${cleanSourceMap}\n`);
  write(
    path.join(fixture, ".next", "server", "app", "page.js.nft.json"),
    `${JSON.stringify({ files: [["sk", "async", "storage", "instance"].join("-")] })}\n`,
  );
  write(path.join(fixture, ".next", "required-server-files.json"), `${JSON.stringify({ appDir: path.dirname(syntheticWindowsPath) })}\n`);

  const clean = runGate(fixture);
  const cleanOutput = parseOutput(clean);
  assert.equal(clean.status, 0, `generated Next noise must not fail the release scan: ${clean.stdout}${clean.stderr}`);
  assert.equal(cleanOutput.ok, true, "clean release artifact must pass");
  assert.equal(cleanOutput.gate, "release-artifact-privacy", "release scan must have its own gate identity");
  assert.equal(cleanOutput.scope?.mode, "release-artifact", "release scan must report its scope mode");
  assert.deepEqual(cleanOutput.scope?.paths, [".next"], "release scan must report the scanned artifact root");
  assert.ok(cleanOutput.scannedFiles >= 3, "release scan must inspect production text files");
  assert.ok(cleanOutput.skippedBinaryFiles >= 1, "release scan must account for expected binary assets");
  assert.equal(cleanOutput.unscannableBinaryFiles, 0, "clean production code must remain text-scannable");
  assert.equal(cleanOutput.unscannableSourceMapFiles, 0, "clean plain-text source maps must remain scannable");
  assert.ok(cleanOutput.excludedGeneratedEntries >= 3, "release scan must account for generated-noise exclusions");

  write(sourceMapPath, `${JSON.stringify({
    version: 3,
    file: "page.js",
    sources: ["webpack://_N_E/./app/page.ts"],
    sourcesContent: [`export const releaseCredential = "${syntheticToken}";`],
    names: [],
    mappings: "",
  })}\n`);
  const leakedSourceMap = runGate(fixture);
  const leakedSourceMapOutput = parseOutput(leakedSourceMap);
  assert.equal(leakedSourceMap.status, 1, "a credential embedded in a deployable source map must fail");
  assert.ok(
    leakedSourceMapOutput.findings.some((finding) => finding.category === "secret" && finding.path === ".next/server/app/page.js.map"),
    "release scan must identify the leaking source map without echoing the credential",
  );
  assert.ok(!`${leakedSourceMap.stdout}${leakedSourceMap.stderr}`.includes(syntheticToken), "source-map findings must redact secret material");

  write(sourceMapPath, `${JSON.stringify({
    version: 3,
    file: "page.js",
    sources: [syntheticWindowsPath],
    sourcesContent: ["export default function Page() { return null; }"],
    names: [],
    mappings: "",
  })}\n`);
  const pathLeakingSourceMap = runGate(fixture);
  const pathLeakingSourceMapOutput = parseOutput(pathLeakingSourceMap);
  assert.equal(pathLeakingSourceMap.status, 1, "a local user path embedded in a deployable source map must fail");
  assert.ok(
    pathLeakingSourceMapOutput.findings.some((finding) => finding.category === "local-user-path" && finding.path === ".next/server/app/page.js.map"),
    "release scan must identify the path-leaking source map without echoing the path",
  );
  assert.ok(!`${pathLeakingSourceMap.stdout}${pathLeakingSourceMap.stderr}`.includes(syntheticWindowsPath), "source-map findings must redact local user paths");
  write(sourceMapPath, `${cleanSourceMap}\n`);

  for (const compressedSourceMap of compressedSourceMaps) {
    const compressedPath = `${sourceMapPath}.${compressedSourceMap.extension}`;
    const relativeCompressedPath = `.next/server/app/page.js.map.${compressedSourceMap.extension}`;
    write(compressedPath, compressedSourceMap.bytes);
    const result = runGate(fixture);
    const output = parseOutput(result);
    assert.equal(result.status, 1, `a compressed ${compressedSourceMap.extension} source map must fail closed`);
    assert.equal(output.unscannableSourceMapFiles, 1, "the release scan must account for the rejected compressed source map");
    assert.ok(
      output.findings.some((finding) => finding.category === "unscannable-release-source-map" && finding.path === relativeCompressedPath),
      `release scan must explicitly identify the unscannable ${compressedSourceMap.extension} source map`,
    );
    rmSync(compressedPath, { force: true });
  }

  write(path.join(fixture, ".next", "server", "app", "page.js"), Buffer.from([0, 9, 8, 7]));
  const binaryCode = runGate(fixture);
  const binaryCodeOutput = parseOutput(binaryCode);
  assert.equal(binaryCode.status, 1, "binary content disguised as deployable code must fail closed");
  assert.ok(
    binaryCodeOutput.findings.some((finding) => finding.category === "unscannable-release-binary" && finding.path === ".next/server/app/page.js"),
    "release scan must distinguish expected assets from unscannable executable content",
  );

  write(path.join(fixture, ".next", "server", "app", "page.js"), `const apiKey = "${syntheticToken}";\n`);
  const leaked = runGate(fixture);
  const leakedOutput = parseOutput(leaked);
  assert.equal(leaked.status, 1, "a credential embedded in deployable server output must fail");
  assert.equal(leakedOutput.ok, false, "leaked release artifact must report failure");
  assert.ok(
    leakedOutput.findings.some((finding) => finding.category === "secret" && finding.path === ".next/server/app/page.js"),
    "release scan must identify the deployable bundle without echoing the credential",
  );
  assert.ok(!`${leaked.stdout}${leaked.stderr}`.includes(syntheticToken), "release scan output must redact secret material");

  const missing = runGate(missingFixture);
  assert.notEqual(missing.status, 0, "a missing release artifact must fail closed");
  assert.ok(!`${missing.stdout}${missing.stderr}`.includes(missingFixture), "gate errors must not disclose local fixture paths");

  console.log("Release artifact privacy verifier passed (clean source map, source-map leaks, compressed source-map rejection, generated noise, binary code, embedded secret, missing artifact).");
} finally {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(missingFixture, { recursive: true, force: true });
}
