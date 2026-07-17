#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_PATH = "controls/provenance/thirteen-layers.upstream.v1.json";
const EXPECTED = Object.freeze({
  schema: "valdris.import_provenance/v1",
  repository: "https://github.com/nickcarmonadigital/13-layers-sdlc-harness",
  commit: "77853d410438ce7a2909a94c2db41d258e3d04a0",
  license: "MIT",
  licenseUrl: "https://github.com/nickcarmonadigital/13-layers-sdlc-harness/blob/77853d410438ce7a2909a94c2db41d258e3d04a0/LICENSE",
  files: Object.freeze({
    "controls/baseline/L01-frontend-foundations.json": "8e312a1e01c54b3594685b97a4dbe4c62c4c07f09e16e28ac88add05d3fa1863",
    "controls/baseline/L02-apis-and-backend-logic.json": "6adaf3666ebff974f5d6758a95e14727cda648a99dcccbb8f4d9990f5ebaa80a",
    "controls/baseline/L03-database-and-storage.json": "e1825ca409746a109a86f19847b1ecba999bb48bbb5ee71b91206fe3988beaf3",
    "controls/baseline/L04-authentication-and-permissions.json": "a2db62990420f8ccaa8cb46d7a919dd123d46e440b8d74ac5fb2b215157a54e6",
    "controls/baseline/L05-hosting-and-deployment.json": "9fd7732dbfa38d66bee7139c48458d47f8ce047516789133ffeedc71749e336d",
    "controls/baseline/L06-cloud-compute.json": "48f804acae8137094de81db70e664951de7e40a500922dd6cca162505f6a3cb2",
    "controls/baseline/L07-ci-cd-and-version-control.json": "6a2dda364b0e2b841c65a83185eb33379a833e403c111794d463037cae3fe4aa",
    "controls/baseline/L08-security-and-rls.json": "ff4b70c28bc78a8ea90cc7bbe3d2a32536c43dd933c149e1fcaf8bd2a26d206b",
    "controls/baseline/L09-rate-limiting.json": "e1ef940b4111578bf5a2caecbd9c4f1c5f9521109356587d221cde038be75193",
    "controls/baseline/L10-caching-and-cdn.json": "5ba8bc3e225cb39d371575230008cd348526c2038bacb6557924ce8c9916abf1",
    "controls/baseline/L11-load-balancing-and-scaling.json": "70673428b1d54622d48c75e97dea2e31ec1cbc413179f06717096ea453bbf9ac",
    "controls/baseline/L12-observability.json": "f074b5caf9a34785b988ad62e9f91f32d74260e74dcf66121c4d9b284c6da755",
    "controls/baseline/L13-availability-and-recovery.json": "f7567cb136aa91eb20a8130319ad0a5dd32423f44018e82abad56c7ba77dc739",
    "controls/capabilities/async-workflows.json": "0efbd3137c13e79bda6b1f48d9072deec2ac92982f460266c6ff92537f8c9e8d",
    "controls/profiles/ai-agentic.json": "5165c5b4b5bae81ca501c4867b84c0f2defc516b98708013851a1824986254f4",
    "controls/profiles/saas.json": "170a5a037d3843c5e36cd22e6e952ad1e5b99457eef379d658e51c0a042842e3",
    "gates/change.json": "87f34693ed1175e12cdf393987ef9035836088131b970aa5863acda44dec56f7",
    "gates/preflight.json": "590f3f517141c6b251c44adbe471f192f9f886fc1c642efe4720f25a3e0c82ee",
    "gates/pull-request.json": "06fbc8e88a5d81b9cb59209e5af51fc1a7a59dad44e31e6460529ac2e668960e",
    "gates/recovery.json": "c2723bf579cd283b79ea0f70f2b07042229884bb6a6ac752ffa5f4b94a9b79a8",
    "gates/release.json": "918b0bbfea61b1674dd55a112a69bb2b724537e01d0a44f7eaf3a5be4afd8d14",
    "gates/runtime.json": "11d81b8614f7dedeafbf13246e9f29df029793f9415fc9b6644e755a7b3d359d",
    "schemas/control-bundle.schema.json": "19a663e14ef0bf87195680dd4784ac0e3dde524d25796981bb5f42941f357061",
    "schemas/evidence.schema.json": "d08a1a0f575f1983c22a90993552575505a57574a8b5c4994abb40a8556e7bdc",
    "schemas/plan.schema.json": "4c319fcc58b369dbdb5bee2efaaf0df1b4c93702488ae1ffeb360b9e027a8105",
    "schemas/project.schema.json": "ca474c478cb004b0c5952b76a811466ad89d34a455ef468e89a4dbf1bb451ba2",
  }),
});

function parseArgs(argv) {
  const args = { repo: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") args.repo = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function finding(code, message) {
  return { code, message };
}

export function validateProvenance(repo) {
  const findings = [];
  const target = path.resolve(repo, MANIFEST_PATH);
  if (!existsSync(target)) {
    findings.push(finding("MANIFEST_MISSING", `${MANIFEST_PATH} is required`));
    return result(findings);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    findings.push(finding("MANIFEST_INVALID_JSON", `manifest is not valid JSON: ${error.message}`));
    return result(findings);
  }

  if (manifest.schema !== EXPECTED.schema) findings.push(finding("SCHEMA_MISMATCH", `schema must be ${EXPECTED.schema}`));
  if (manifest.source?.repository !== EXPECTED.repository) findings.push(finding("SOURCE_REPOSITORY_MISMATCH", "source repository does not match the approved upstream"));
  if (manifest.source?.commit !== EXPECTED.commit) findings.push(finding("SOURCE_COMMIT_MISMATCH", "source commit does not match the approved immutable revision"));
  if (manifest.source?.license !== EXPECTED.license) findings.push(finding("SOURCE_LICENSE_MISMATCH", "source license must be MIT"));
  if (manifest.source?.licenseUrl !== EXPECTED.licenseUrl) findings.push(finding("LICENSE_URL_MISMATCH", "license URL must be revision-bound"));
  if (manifest.verification?.digestAlgorithm !== "sha256") findings.push(finding("DIGEST_ALGORITHM_MISMATCH", "digest algorithm must be sha256"));
  if (manifest.verification?.pathBase !== "upstream-repository-root") findings.push(finding("PATH_BASE_MISMATCH", "file paths must be relative to the upstream repository root"));
  if (manifest.verification?.networkRequired !== false) findings.push(finding("NETWORK_POLICY_MISMATCH", "verification must not require network access"));

  const files = manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files) ? manifest.files : {};
  for (const [sourcePath, digest] of Object.entries(files)) {
    const normalized = sourcePath.replaceAll("\\", "/");
    if (normalized !== sourcePath || path.posix.isAbsolute(sourcePath) || normalized.split("/").includes("..")) {
      findings.push(finding("UNSAFE_SOURCE_PATH", "manifest contains a source path outside the upstream root"));
    }
    if (!/^[a-f0-9]{64}$/.test(String(digest))) findings.push(finding("INVALID_SHA256", "manifest contains an invalid sha256 digest"));
  }

  for (const [sourcePath, digest] of Object.entries(EXPECTED.files)) {
    if (!(sourcePath in files)) findings.push(finding("SOURCE_FILE_MISSING", `approved source inventory is missing ${sourcePath}`));
    else if (files[sourcePath] !== digest) findings.push(finding("SOURCE_DIGEST_MISMATCH", `approved digest does not match for ${sourcePath}`));
  }
  for (const sourcePath of Object.keys(files)) {
    if (!(sourcePath in EXPECTED.files)) findings.push(finding("UNAPPROVED_SOURCE_FILE", "manifest contains a file outside the approved source inventory"));
  }
  return result(findings, Object.keys(files).length);
}

function result(findings, fileCount = 0) {
  return {
    ok: findings.length === 0,
    gate: "import-provenance",
    source: { commit: EXPECTED.commit, license: EXPECTED.license },
    fileCount,
    networkRequired: false,
    findings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/provenance-gate.mjs --repo .");
    return;
  }
  const output = validateProvenance(path.resolve(args.repo));
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(JSON.stringify({ ok: false, gate: "import-provenance", findings: [finding("GATE_ERROR", error.message)] }, null, 2));
    process.exitCode = 1;
  });
}
