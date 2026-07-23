#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateResult,
  parseRepoFileArgs,
  readJson,
} from "./control-gate-lib.mjs";
import { resolveArtifactPath } from "./proof-runner.mjs";
import {
  AUTHORITATIVE_CLOSURE_SCHEMA,
  V09_CANONICAL_ARTIFACTS,
  validateAuthoritativeClosureDocument,
} from "./v09-assurance-lib.mjs";

export function validateAuthoritativeAssurance(filePath, options = {}) {
  try {
    const repoRoot = path.resolve(options.repoRoot || process.cwd());
    const requestedAbsolute = path.resolve(filePath);
    const requestedRelative = path.relative(repoRoot, requestedAbsolute);
    if (
      !requestedRelative ||
      requestedRelative.split(path.sep).join("/") !==
        V09_CANONICAL_ARTIFACTS.authoritative
    )
      return {
        checked: true,
        valid: false,
        level: null,
        problems: [
          `authoritative closure must use canonical path ${V09_CANONICAL_ARTIFACTS.authoritative}`,
        ],
      };
    const canonicalFile = resolveArtifactPath(
      repoRoot,
      V09_CANONICAL_ARTIFACTS.authoritative,
      { mustExist: true },
    );
    const requestedFile = resolveArtifactPath(
      repoRoot,
      requestedRelative.split(path.sep).join("/"),
      { mustExist: true },
    );
    if (requestedFile !== canonicalFile)
      return {
        checked: true,
        valid: false,
        level: null,
        problems: [
          `authoritative closure must use canonical path ${V09_CANONICAL_ARTIFACTS.authoritative}`,
        ],
      };
    return validateAuthoritativeClosureDocument(
      readJson(canonicalFile),
      repoRoot,
      options,
    );
  } catch (error) {
    return {
      checked: true,
      valid: false,
      level: null,
      problems: [`authoritative closure must be valid JSON: ${error.message}`],
    };
  }
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: V09_CANONICAL_ARTIFACTS.authoritative,
  });
  if (args.help) {
    console.log(
      `Usage: node scripts/authoritative-assurance-gate.mjs --repo . [--file ${V09_CANONICAL_ARTIFACTS.authoritative}]`,
    );
    return;
  }
  const repoRoot = path.resolve(args.repo);
  if (
    args.file.split(path.sep).join("/") !==
    V09_CANONICAL_ARTIFACTS.authoritative
  )
    return gateResult(args.file, {
      checked: true,
      valid: false,
      schema: AUTHORITATIVE_CLOSURE_SCHEMA,
      problems: [
        `authoritative closure must use canonical path ${V09_CANONICAL_ARTIFACTS.authoritative}`,
      ],
    });
  let target;
  try {
    target = resolveArtifactPath(
      repoRoot,
      V09_CANONICAL_ARTIFACTS.authoritative,
      { mustExist: true },
    );
  } catch (error) {
    return gateResult(args.file, {
      checked: true,
      valid: false,
      schema: AUTHORITATIVE_CLOSURE_SCHEMA,
      problems: [`authoritative closure missing or unsafe: ${error.message}`],
    });
  }
  gateResult(args.file, validateAuthoritativeAssurance(target, { repoRoot }));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ ok: false, problems: [error.message] }, null, 2),
    );
    process.exit(1);
  });
}
