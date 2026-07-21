#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { canonicalJson } from "./proof-runner.mjs";
import {
  applySkillRetirementPlan,
  planSkillRetirement,
} from "./retire-local-skills.mjs";
import { reviewAttestationPayload } from "./review-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const executedBindings = new Set();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(name, fn, bindings = []) {
  try {
    fn();
    checks.push({ name, ok: true });
    for (const binding of bindings) executedBindings.add(binding);
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(script, args, options = {}) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", script), ...args],
    {
      cwd: options.cwd || ROOT,
      env: options.env || process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runAbsolute(script, args, cwd, env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function runGit(repo, args) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(
    result.status === 0,
    `git ${args.join(" ")} failed: ${output(result).slice(-2000)}`,
  );
  return result.stdout.trim();
}

function replaceExactStrings(value, replacements) {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value))
    return value.map((entry) => replaceExactStrings(entry, replacements));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceExactStrings(entry, replacements),
      ]),
    );
  return value;
}

function rewriteJsonArtifacts(target, replacements) {
  const roots = [
    "ai",
    "context",
    "design",
    "domain",
    "evals",
    "foundation",
    "goal",
    "graph",
    "production",
    "proof",
    "run",
    "smoke",
    "trajectory",
    "waivers",
  ];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const document = JSON.parse(readFileSync(file, "utf8"));
        writeJson(file, replaceExactStrings(document, replacements));
      }
    }
  };
  for (const root of roots) visit(path.join(target, root));
}

function tarOctal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function tarArchive(name, content, options = {}) {
  const body = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(tarOctal(0o644, 8), 100, 8, "ascii");
  header.write(tarOctal(0, 8), 108, 8, "ascii");
  header.write(tarOctal(0, 8), 116, 8, "ascii");
  header.write(tarOctal(body.length, 12), 124, 12, "ascii");
  header.write(tarOctal(Math.floor(Date.now() / 1000), 12), 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = (options.type ?? "0").charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (options.uname) header.write(options.uname, 265, 32, "utf8");
  if (options.prefix) header.write(options.prefix, 345, 155, "utf8");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
}

function gzipWithFilename(content, filename) {
  const plain = gzipSync(content);
  return Buffer.concat([
    plain.subarray(0, 3),
    Buffer.from([plain[3] | 0x08]),
    plain.subarray(4, 10),
    Buffer.from(`${filename}\0`, "utf8"),
    plain.subarray(10),
  ]);
}

function routeCase(
  tempRoot,
  id,
  request,
  expectedType,
  expectedPrimary,
  inspect = () => true,
) {
  const repo = path.join(tempRoot, `route-${id}`);
  mkdirSync(repo, { recursive: true });
  const result = run("route-request.mjs", [
    "--repo",
    repo,
    "--run-id",
    `CONVERGENCE-${id}`,
    "--profile",
    "production",
    "--request",
    request,
  ]);
  assert(
    result.status === 0,
    `${id} route creation failed: ${output(result).slice(-1000)}`,
  );
  const classification = JSON.parse(
    readFileSync(
      path.join(repo, "run", "workload-classification.json"),
      "utf8",
    ),
  );
  const route = JSON.parse(
    readFileSync(path.join(repo, "run", "route.json"), "utf8"),
  );
  assert(
    classification.taskType === expectedType,
    `${id} classified as ${classification.taskType}`,
  );
  assert(
    route.skillPhases[1].primary === expectedPrimary,
    `${id} routed to ${route.skillPhases[1].primary}`,
  );
  assert(
    inspect(route, classification),
    `${id} route-specific assurance failed`,
  );
  for (const gate of [
    "intake-gate.mjs",
    "workload-classification-gate.mjs",
    "route-gate.mjs",
  ]) {
    const gateResult = run(gate, ["--repo", repo]);
    assert(
      gateResult.status === 0,
      `${id} failed ${gate}: ${output(gateResult).slice(-1000)}`,
    );
  }
}

function parseWorkflowActionSteps(workflow) {
  const jobsIndex = workflow.indexOf("jobs:\n");
  assert(jobsIndex >= 0, "protected residue workflow has no jobs mapping");
  const steps = [];
  let job = "";
  let step = null;
  let inWith = false;
  for (const line of workflow.slice(jobsIndex + "jobs:\n".length).split("\n")) {
    const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (jobMatch) {
      job = jobMatch[1];
      step = null;
      inWith = false;
      continue;
    }
    const stepMatch = line.match(/^      - name:\s*(.+?)\s*$/);
    if (stepMatch) {
      step = { job, name: stepMatch[1], uses: "", with: {} };
      steps.push(step);
      inWith = false;
      continue;
    }
    if (!step) continue;
    const usesMatch = line.match(/^        uses:\s*([^\s#]+)/);
    if (usesMatch) {
      step.uses = usesMatch[1];
      inWith = false;
      continue;
    }
    if (/^        with:\s*$/.test(line)) {
      inWith = true;
      continue;
    }
    const withMatch = inWith
      ? line.match(/^          ([a-zA-Z0-9_-]+):\s*(.*?)\s*$/)
      : null;
    if (withMatch) {
      step.with[withMatch[1]] = withMatch[2];
      continue;
    }
    if (/^        [a-zA-Z0-9_-]+:/.test(line) || /^      - /.test(line))
      inWith = false;
  }
  return steps;
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "valdris-convergence-"));
try {
  const catalog = JSON.parse(
    readFileSync(
      path.join(ROOT, "controls", "clean-room-behaviors.v1.json"),
      "utf8",
    ),
  );
  record("generic behavior catalog is complete and non-crosswalk", () => {
    assert(
      catalog.schema === "valdris.clean-room-behavior-catalog.v1" &&
        catalog.policy?.privateCrosswalkPublishable === false,
      "behavior catalog policy is invalid",
    );
    assert(
      Array.isArray(catalog.behaviors) && catalog.behaviors.length >= 30,
      "behavior catalog is incomplete",
    );
    assert(
      new Set(catalog.behaviors.map(({ id }) => id)).size ===
        catalog.behaviors.length,
      "behavior IDs are duplicated",
    );
    for (const behavior of catalog.behaviors) {
      assert(
        ["COVERED", "EXTEND", "EXCLUDE"].includes(behavior.disposition),
        `${behavior.id} has an invalid disposition`,
      );
      if (behavior.disposition === "EXCLUDE")
        assert(
          typeof behavior.exclusionReason === "string" &&
            behavior.exclusionReason.length >= 30 &&
            !behavior.verification,
          `${behavior.id} exclusion is not explicit`,
        );
      else
        assert(
          typeof behavior.verification === "string" &&
            /^[a-z0-9-]+:[a-z0-9-]+$/.test(behavior.verification),
          `${behavior.id} has no generic verifier binding`,
        );
    }
  });

  record(
    "protected residue workflow contract is pinned, isolated, encrypted, and owner-gated",
    () => {
      const workflow = readFileSync(
        path.join(
          ROOT,
          ".github",
          "workflows",
          "restricted-residue-attestation.yml",
        ),
        "utf8",
      );
      const codeowners = readFileSync(
        path.join(ROOT, ".github", "CODEOWNERS"),
        "utf8",
      );
      const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
      const authorizeIndex = workflow.indexOf("  authorize:");
      const buildIndex = workflow.indexOf("  build-surfaces:");
      const attestIndex = workflow.indexOf("  attest:");
      assert(
        authorizeIndex >= 0 &&
          authorizeIndex < buildIndex &&
          buildIndex < attestIndex,
        "protected authorization does not precede candidate construction and attestation",
      );
      for (const token of [
        "needs: authorize",
        "VALDRIS_ARTIFACT_ENCRYPTION_PUBLIC_KEY_SHA256",
        'node-version: "24.18.0"',
        "node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d",
        "--network none",
        "--read-only",
        "--cap-add SETPCAP",
        "--bounding-set=-all",
        "candidate-container.cid",
        "docker rm -f",
        "--tmpfs /workspace/.next",
        "--tmpfs /outputs",
        "--tmpfs /sealed",
        "--apparent-size",
        "surface-key-envelope.enc",
        "-mac HMAC",
        "cmp -s",
        "path: ${{ runner.temp }}/encrypted/*",
        "github.run_attempt",
        "--generated-pack-archive",
        "VALDRIS_TRUSTED_VALIDATOR_COMMIT",
      ])
        assert(
          workflow.includes(token),
          `protected residue workflow contract omitted ${token}`,
        );
      assert(
        workflow.indexOf("cmp -s") < workflow.indexOf(" enc -d "),
        "ciphertext authentication does not precede decryption",
      );
      const actionSteps = parseWorkflowActionSteps(workflow).filter(
        ({ uses }) => uses,
      );
      const lexicalUses = [...workflow.matchAll(/^\s+uses:\s*([^\s#]+)/gm)].map(
        (match) => match[1],
      );
      assert(
        actionSteps.length === lexicalUses.length,
        "workflow action parser did not account for every uses reference",
      );
      const allowedActions = new Set([
        "actions/checkout",
        "actions/setup-node",
        "actions/upload-artifact",
        "actions/download-artifact",
      ]);
      for (const step of actionSteps) {
        const actionMatch = step.uses.match(/^([^@]+)@([a-f0-9]{40})$/);
        assert(
          actionMatch,
          `${step.name} does not pin its action by full commit SHA`,
        );
        assert(
          allowedActions.has(actionMatch[1]),
          `${step.name} uses an unapproved third-party action`,
        );
      }
      const uploads = actionSteps.filter(({ uses }) =>
        uses.startsWith("actions/upload-artifact@"),
      );
      assert(
        uploads.length === 1,
        "protected residue workflow must have exactly one artifact upload step",
      );
      assert(
        uploads[0].job === "build-surfaces",
        "artifact upload must run only in the isolated build-surfaces job",
      );
      assert(
        uploads[0].with.path === "${{ runner.temp }}/encrypted/*",
        "artifact upload path must contain only encrypted surfaces",
      );
      assert(
        uploads[0].with["if-no-files-found"] === "error" &&
          uploads[0].with["retention-days"] === "1",
        "artifact upload must fail closed and retain ciphertext briefly",
      );
      const downloads = actionSteps.filter(({ uses }) =>
        uses.startsWith("actions/download-artifact@"),
      );
      assert(
        downloads.length === 1 && downloads[0].job === "attest",
        "encrypted surfaces must be downloaded exactly once on the protected attestation job",
      );
      assert(
        downloads[0].with.path === "${{ runner.temp }}/encrypted",
        "artifact download path is not the bounded encrypted handoff directory",
      );
      for (const ownerPath of [
        "/.github/CODEOWNERS",
        "/.github/workflows/restricted-residue-attestation.yml",
        "/scripts/restricted-residue-gate.mjs",
        "/scripts/retire-local-skills.mjs",
      ])
        assert(
          codeowners.includes(`${ownerPath} @nickcarmonadigital`),
          `CODEOWNERS omitted ${ownerPath}`,
        );
      for (const policy of [
        "prevent-self-review",
        "job_workflow_ref",
        "protected default branch",
        "independent required reviewer",
      ])
        assert(
          readme.includes(policy),
          `commissioning documentation omitted ${policy}`,
        );
    },
  );

  const publicRepo = path.join(tempRoot, "public-repo");
  const generatedPack = path.join(tempRoot, "generated-pack");
  const knowledgeVault = path.join(publicRepo, "knowledge");
  const installedManifest = path.join(tempRoot, "installed-skills.json");
  const archive = path.join(tempRoot, "release.tgz");
  mkdirSync(knowledgeVault, { recursive: true });
  mkdirSync(generatedPack, { recursive: true });
  const restrictedName = ["Synthetic", "Restricted", "Identity"].join("-");
  const restrictedUnicode = "Caf\u00e9RestrictedBoundary";
  const restrictedPath = ["C:", "Users", "restricted", "private-repo"].join(
    "\\",
  );
  const issuePrefix = ["PR", "V"].join("");
  const residueManifest = path.join(tempRoot, "restricted-values.json");
  writeJson(residueManifest, {
    schema: "valdris.restricted-residue-input.v1",
    values: [restrictedName, restrictedPath, restrictedUnicode],
    issuePrefixes: [issuePrefix],
  });
  writeFileSync(
    path.join(publicRepo, "README.md"),
    "neutral public content\n",
    "utf8",
  );
  writeFileSync(
    path.join(generatedPack, "prompt.md"),
    `Do not publish ${restrictedName}.\n`,
    "utf8",
  );
  writeFileSync(
    path.join(knowledgeVault, "note.md"),
    `Historical ticket ${issuePrefix}-447 must stay private.\n`,
    "utf8",
  );
  writeJson(installedManifest, { installed: [{ source: restrictedPath }] });
  writeFileSync(
    archive,
    gzipSync(
      tarArchive("package/private.txt", `restricted=${restrictedName}\n`),
    ),
  );

  record(
    "restricted residue is found across every public surface without disclosure",
    () => {
      const result = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
        "--generated-pack",
        generatedPack,
        "--knowledge-vault",
        knowledgeVault,
        "--installed-skill-manifest",
        installedManifest,
      ]);
      const text = output(result);
      assert(result.status !== 0, "restricted residue was accepted");
      assert(
        !text.includes(restrictedName) &&
          !text.includes(restrictedPath) &&
          !text.includes(`${issuePrefix}-447`),
        "restricted residue leaked into diagnostics",
      );
      const payload = JSON.parse(result.stdout);
      for (const prefix of [
        "repository-",
        "release-archive-",
        "generated-pack-",
        "knowledge-vault-",
        "installed-skill-manifest-",
      ])
        assert(
          payload.findings.some(({ surface }) => surface.startsWith(prefix)),
          `surface ${prefix} was not covered`,
        );
    },
    ["convergence:restricted-residue-surfaces"],
  );

  record(
    "encoded, normalized, binary, shipping-directory, and nested-archive residue is rejected",
    () => {
      writeFileSync(
        path.join(generatedPack, "prompt.md"),
        "neutral generated content\n",
        "utf8",
      );
      writeFileSync(
        path.join(knowledgeVault, "note.md"),
        "neutral knowledge content\n",
        "utf8",
      );
      mkdirSync(path.join(generatedPack, "dist"), { recursive: true });
      mkdirSync(path.join(generatedPack, ".next"), { recursive: true });
      writeFileSync(
        path.join(generatedPack, "dist", "utf16.txt"),
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(restrictedName, "utf16le"),
        ]),
      );
      writeFileSync(
        path.join(generatedPack, ".next", "normalized.txt"),
        restrictedUnicode.normalize("NFD"),
        "utf8",
      );
      writeFileSync(
        path.join(generatedPack, "binary.dat"),
        Buffer.concat([
          Buffer.from([0x00, 0x89, 0x01]),
          Buffer.from(restrictedName, "utf16le"),
          Buffer.from([0xff, 0x00]),
        ]),
      );
      for (const relative of [
        "dist/utf16.txt",
        ".next/normalized.txt",
        "binary.dat",
      ]) {
        const isolated = path.join(
          tempRoot,
          `isolated-${relative.replace(/[/.]/g, "-")}`,
        );
        mkdirSync(isolated, { recursive: true });
        const source = path.join(generatedPack, ...relative.split("/"));
        writeFileSync(path.join(isolated, "fixture.bin"), readFileSync(source));
        const result = run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          residueManifest,
          "--generated-pack",
          isolated,
        ]);
        assert(
          result.status !== 0 &&
            JSON.parse(result.stdout).findings.some(
              ({ surface }) => surface === "generated-pack-1",
            ),
          `isolated encoded residue passed: ${relative}`,
        );
        assert(
          !output(result).includes(restrictedName) &&
            JSON.parse(result.stdout).findings.every(
              (finding) => !Object.hasOwn(finding, "fingerprint"),
            ),
          `encoded residue diagnostics leaked for ${relative}`,
        );
      }
      const utf32 = Buffer.alloc(3 + restrictedName.length * 4);
      for (let index = 0; index < restrictedName.length; index += 1)
        utf32.writeUInt32LE(restrictedName.codePointAt(index), 3 + index * 4);
      const utf32Pack = path.join(tempRoot, "isolated-utf32");
      mkdirSync(utf32Pack, { recursive: true });
      writeFileSync(path.join(utf32Pack, "fixture.bin"), utf32);
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          residueManifest,
          "--generated-pack",
          utf32Pack,
        ]).status !== 0,
        "odd-offset UTF-32 residue was accepted",
      );

      writeFileSync(
        archive,
        gzipSync(tarArchive(".valdris-harness/prompt.md", restrictedName)),
      );
      const archivedPack = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--generated-pack-archive",
        archive,
      ]);
      assert(
        archivedPack.status !== 0 &&
          JSON.parse(archivedPack.stdout).findings.some(
            ({ surface }) => surface === "generated-pack-1",
          ),
        "encrypted-handoff generated-pack archive residue was accepted",
      );

      const nestedArchive = gzipSync(
        tarArchive("nested/private.txt", restrictedName),
      );
      writeFileSync(
        archive,
        gzipSync(tarArchive("package/nested.tgz", nestedArchive)),
      );
      const nested = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
      ]);
      assert(
        nested.status !== 0 &&
          JSON.parse(nested.stdout).findings.some(
            ({ surface }) => surface === "release-archive-1",
          ),
        "nested compressed release residue was not scanned",
      );

      const nestedGzipMetadata = gzipWithFilename(
        Buffer.from("neutral nested content", "utf8"),
        restrictedName,
      );
      writeFileSync(
        archive,
        gzipSync(tarArchive("package/nested.gz", nestedGzipMetadata)),
      );
      const nestedGzipName = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
      ]);
      assert(
        nestedGzipName.status !== 0 &&
          JSON.parse(nestedGzipName.stdout).findings.some(
            ({ surface }) => surface === "release-archive-1",
          ),
        "nested gzip filename metadata residue was accepted",
      );

      writeFileSync(
        archive,
        gzipSync(
          tarArchive("private.txt", "neutral", { prefix: restrictedName }),
        ),
      );
      const prefixed = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
      ]);
      assert(
        prefixed.status !== 0 &&
          JSON.parse(prefixed.stdout).findings.some(
            ({ surface }) => surface === "release-archive-1",
          ),
        "USTAR prefix residue was accepted",
      );

      writeFileSync(
        archive,
        gzipSync(
          tarArchive("public.txt", "neutral", { uname: restrictedName }),
        ),
      );
      const tarOwner = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
      ]);
      assert(
        tarOwner.status !== 0 &&
          JSON.parse(tarOwner.stdout).findings.some(
            ({ surface }) => surface === "release-archive-1",
          ),
        "USTAR owner metadata residue was accepted",
      );

      const gzipWithRestrictedName = gzipWithFilename(
        tarArchive("public.txt", "neutral"),
        restrictedName,
      );
      writeFileSync(archive, gzipWithRestrictedName);
      const gzipName = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
      ]);
      assert(
        gzipName.status !== 0 &&
          JSON.parse(gzipName.stdout).findings.some(
            ({ surface }) => surface === "release-archive-1",
          ),
        "gzip filename metadata residue was accepted",
      );

      writeFileSync(
        archive,
        gzipSync(tarArchive("directory/", restrictedName, { type: "5" })),
      );
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          residueManifest,
          "--release-archive",
          archive,
        ]).status !== 0,
        "tar directory payload residue was accepted",
      );

      writeFileSync(archive, gzipSync(tarArchive("pipe", "", { type: "6" })));
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          residueManifest,
          "--release-archive",
          archive,
        ]).status !== 0,
        "tar FIFO special entry was accepted",
      );

      writeFileSync(
        archive,
        gzipSync(
          Buffer.concat([
            tarArchive("public.txt", "neutral"),
            Buffer.from(restrictedName),
          ]),
        ),
      );
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          residueManifest,
          "--release-archive",
          archive,
        ]).status !== 0,
        "nonzero trailing archive content was accepted",
      );

      const expansionBomb = gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
      writeFileSync(
        archive,
        gzipSync(tarArchive("package/high-ratio.gz", expansionBomb)),
      );
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          residueManifest,
          "--release-archive",
          archive,
        ]).status !== 0,
        "oversized nested gzip expansion was accepted",
      );

      mkdirSync(path.join(publicRepo, "dist"), { recursive: true });
      writeFileSync(
        path.join(publicRepo, "dist", "private.txt"),
        restrictedName,
        "utf8",
      );
      writeFileSync(
        archive,
        gzipSync(tarArchive("package/public.txt", "neutral release content\n")),
      );
      const coveredBuildDirectory = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        archive,
      ]);
      assert(
        coveredBuildDirectory.status !== 0 &&
          JSON.parse(coveredBuildDirectory.stdout).findings.some(
            ({ surface }) => surface === "repository-1",
          ),
        "an unrelated release archive disabled repository dist coverage",
      );
      rmSync(path.join(publicRepo, "dist"), { recursive: true, force: true });
      rmSync(path.join(generatedPack, "dist"), {
        recursive: true,
        force: true,
      });
      rmSync(path.join(generatedPack, ".next"), {
        recursive: true,
        force: true,
      });
      rmSync(path.join(generatedPack, "binary.dat"), { force: true });
    },
  );

  record("clean residue surfaces pass", () => {
    writeFileSync(
      path.join(generatedPack, "prompt.md"),
      "neutral generated content\n",
      "utf8",
    );
    writeFileSync(
      path.join(knowledgeVault, "note.md"),
      "neutral knowledge content\n",
      "utf8",
    );
    writeJson(installedManifest, { installed: [{ source: "public-catalog" }] });
    writeFileSync(
      archive,
      gzipSync(tarArchive("package/public.txt", "neutral release content\n")),
    );
    const result = run("restricted-residue-gate.mjs", [
      "--repo",
      publicRepo,
      "--manifest",
      residueManifest,
      "--release-archive",
      archive,
      "--generated-pack",
      generatedPack,
      "--knowledge-vault",
      knowledgeVault,
      "--installed-skill-manifest",
      installedManifest,
    ]);
    assert(
      result.status === 0,
      `clean residue surfaces failed: ${output(result).slice(-1000)}`,
    );
  });

  record(
    "malformed restricted inputs fail without path or value disclosure",
    () => {
      const malformedManifest = path.join(
        tempRoot,
        `${restrictedName}-malformed.json`,
      );
      writeFileSync(malformedManifest, `{"value":"${restrictedPath}"`, "utf8");
      const badManifest = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        malformedManifest,
      ]);
      assert(
        badManifest.status !== 0 &&
          !output(badManifest).includes(restrictedName) &&
          !output(badManifest).includes(restrictedPath),
        "malformed manifest diagnostics disclosed restricted input",
      );
      const missingArchive = path.join(
        tempRoot,
        `${restrictedName}-missing.tgz`,
      );
      const badSurface = run("restricted-residue-gate.mjs", [
        "--repo",
        publicRepo,
        "--manifest",
        residueManifest,
        "--release-archive",
        missingArchive,
      ]);
      assert(
        badSurface.status !== 0 &&
          !output(badSurface).includes(restrictedName) &&
          !output(badSurface).includes(missingArchive),
        "missing surface diagnostics disclosed a restricted path",
      );
    },
  );

  record(
    "restricted manifests are bounded regular files with no symlinked parent",
    () => {
      const oversizedManifest = path.join(
        tempRoot,
        "oversized-restricted-values.json",
      );
      writeFileSync(oversizedManifest, Buffer.alloc(1024 * 1024 + 1, 0x20));
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          oversizedManifest,
        ]).status !== 0,
        "oversized restricted manifest was accepted",
      );
      const actualParent = path.join(tempRoot, "manifest-parent");
      const linkedParent = path.join(tempRoot, "manifest-parent-link");
      mkdirSync(actualParent, { recursive: true });
      writeJson(path.join(actualParent, "manifest.json"), {
        schema: "valdris.restricted-residue-input.v1",
        values: [restrictedName],
        issuePrefixes: [],
      });
      symlinkSync(
        actualParent,
        linkedParent,
        process.platform === "win32" ? "junction" : "dir",
      );
      assert(
        run("restricted-residue-gate.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          path.join(linkedParent, "manifest.json"),
        ]).status !== 0,
        "symlink-parent restricted manifest was accepted",
      );
    },
  );

  const codexRoot = path.join(tempRoot, ".codex", "skills");
  const claudeRoot = path.join(tempRoot, ".claude", "skills");
  const retiredName = ["retired", "fixture", "skill"].join("-");
  const preservedName = ["preserved", "fixture", "skill"].join("-");
  mkdirSync(path.join(codexRoot, retiredName), { recursive: true });
  mkdirSync(path.join(claudeRoot, retiredName), { recursive: true });
  mkdirSync(path.join(codexRoot, preservedName), { recursive: true });
  writeFileSync(
    path.join(codexRoot, retiredName, "SKILL.md"),
    "retired\n",
    "utf8",
  );
  writeFileSync(
    path.join(claudeRoot, retiredName, "SKILL.md"),
    "retired\n",
    "utf8",
  );
  const retirementManifest = path.join(tempRoot, "retirement.json");
  writeJson(retirementManifest, {
    schema: "valdris.skill-retirement-manifest.v1",
    entries: [{ name: retiredName, roots: ["codex", "claude"] }],
  });
  const retirementArgs = [
    "--repo",
    publicRepo,
    "--manifest",
    retirementManifest,
    "--codex-root",
    codexRoot,
    "--claude-root",
    claudeRoot,
  ];

  record("skill retirement defaults to redacted dry-run", () => {
    const result = run("retire-local-skills.mjs", retirementArgs);
    assert(
      result.status === 0 &&
        existsSync(path.join(codexRoot, retiredName)) &&
        existsSync(path.join(claudeRoot, retiredName)),
      "dry-run changed local skills",
    );
    assert(
      !output(result).includes(retiredName) &&
        !output(result).includes(codexRoot),
      "dry-run disclosed private skill identity or root",
    );
  });

  record(
    "skill retirement apply removes only exact commissioned entries",
    () => {
      const result = run("retire-local-skills.mjs", [
        ...retirementArgs,
        "--apply",
      ]);
      assert(
        result.status === 0 &&
          !existsSync(path.join(codexRoot, retiredName)) &&
          !existsSync(path.join(claudeRoot, retiredName)),
        "apply did not remove exact retired skills",
      );
      assert(
        existsSync(path.join(codexRoot, preservedName)),
        "apply removed an unlisted skill",
      );
    },
    ["convergence:safe-skill-retirement"],
  );

  record(
    "skill retirement rejects traversal and case-insensitive ambiguity",
    () => {
      writeJson(retirementManifest, {
        schema: "valdris.skill-retirement-manifest.v1",
        entries: [{ name: "../escape", roots: ["codex"] }],
      });
      assert(
        run("retire-local-skills.mjs", retirementArgs).status !== 0,
        "traversal entry was accepted",
      );
      writeJson(retirementManifest, {
        schema: "valdris.skill-retirement-manifest.v1",
        entries: [
          { name: preservedName, roots: ["codex"] },
          { name: preservedName.toUpperCase(), roots: ["codex"] },
        ],
      });
      assert(
        run("retire-local-skills.mjs", retirementArgs).status !== 0,
        "case-insensitive duplicate was accepted",
      );
    },
  );

  record(
    "malformed retirement manifest fails without local identity disclosure",
    () => {
      writeFileSync(retirementManifest, `{"name":"${retiredName}"`, "utf8");
      const result = run("retire-local-skills.mjs", retirementArgs);
      assert(
        result.status !== 0 &&
          !output(result).includes(retiredName) &&
          !output(result).includes(codexRoot),
        "malformed retirement diagnostics disclosed local skill identity",
      );
    },
  );

  record("skill retirement rejects symlink escape", () => {
    const outside = path.join(tempRoot, "outside-skill");
    const linkedName = ["linked", "fixture", "skill"].join("-");
    mkdirSync(outside, { recursive: true });
    symlinkSync(
      outside,
      path.join(codexRoot, linkedName),
      process.platform === "win32" ? "junction" : "dir",
    );
    writeJson(retirementManifest, {
      schema: "valdris.skill-retirement-manifest.v1",
      entries: [{ name: linkedName, roots: ["codex"] }],
    });
    assert(
      run("retire-local-skills.mjs", retirementArgs).status !== 0 &&
        existsSync(outside),
      "symlink escape was followed or removed",
    );
  });

  record(
    "skill retirement rejects oversized or symlink-parent manifests",
    () => {
      const oversizedManifest = path.join(
        tempRoot,
        "oversized-retirement.json",
      );
      writeFileSync(oversizedManifest, Buffer.alloc(1024 * 1024 + 1, 0x20));
      assert(
        run("retire-local-skills.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          oversizedManifest,
          "--codex-root",
          codexRoot,
        ]).status !== 0,
        "oversized retirement manifest was accepted",
      );
      const actualParent = path.join(tempRoot, "retirement-parent");
      const linkedParent = path.join(tempRoot, "retirement-parent-link");
      mkdirSync(actualParent, { recursive: true });
      writeJson(path.join(actualParent, "manifest.json"), {
        schema: "valdris.skill-retirement-manifest.v1",
        entries: [],
      });
      symlinkSync(
        actualParent,
        linkedParent,
        process.platform === "win32" ? "junction" : "dir",
      );
      assert(
        run("retire-local-skills.mjs", [
          "--repo",
          publicRepo,
          "--manifest",
          path.join(linkedParent, "manifest.json"),
          "--codex-root",
          codexRoot,
        ]).status !== 0,
        "symlink-parent retirement manifest was accepted",
      );
    },
  );

  record(
    "skill retirement preserves a same-name replacement after planning",
    () => {
      const swapName = "swap-fixture-skill";
      const swapTarget = path.join(codexRoot, swapName);
      const original = path.join(codexRoot, "original-swap-fixture");
      mkdirSync(swapTarget, { recursive: true });
      writeFileSync(path.join(swapTarget, "SKILL.md"), "original\n", "utf8");
      writeJson(retirementManifest, {
        schema: "valdris.skill-retirement-manifest.v1",
        entries: [{ name: swapName, roots: ["codex"] }],
      });
      const prepared = planSkillRetirement({
        repo: publicRepo,
        manifest: retirementManifest,
        roots: { codex: codexRoot },
        apply: true,
      });
      renameSync(swapTarget, original);
      mkdirSync(swapTarget, { recursive: true });
      writeFileSync(path.join(swapTarget, "SKILL.md"), "replacement\n", "utf8");
      let rejected = false;
      try {
        applySkillRetirementPlan(prepared);
      } catch {
        rejected = true;
      }
      assert(
        rejected &&
          readFileSync(path.join(swapTarget, "SKILL.md"), "utf8") ===
            "replacement\n",
        "planned retirement deleted a same-name replacement",
      );
    },
  );

  record(
    "enterprise AI focused suite executes structural control behaviors",
    () => {
      const result = run("verify-enterprise-ai.mjs", []);
      assert(
        result.status === 0,
        `enterprise AI focused suite failed: ${output(result).slice(-3000)}`,
      );
    },
    ["suite:enterprise-ai"],
  );

  record(
    "portable execution focused suite executes RCA behavior",
    () => {
      const result = run("verify-portable-execution.mjs", []);
      assert(
        result.status === 0,
        `portable execution focused suite failed: ${output(result).slice(-3000)}`,
      );
    },
    ["suite:portable-execution"],
  );

  record(
    "run-packet trust focused suite executes corrective self-heal routing",
    () => {
      const result = run("verify-run-packet-trust.mjs", []);
      assert(
        result.status === 0,
        `run-packet trust focused suite failed: ${output(result).slice(-3000)}`,
      );
    },
    ["suite:run-packet-trust"],
  );

  record(
    "generated skill mirrors reject drift",
    () => {
      const target = path.join(tempRoot, "skill-drift-target");
      mkdirSync(target, { recursive: true });
      const commission = run("commission-harness.mjs", [
        "--repo",
        target,
        "--project-name",
        "Skill Drift Target",
        "--yes",
      ]);
      assert(
        commission.status === 0,
        `skill drift target commissioning failed: ${output(commission).slice(-2000)}`,
      );
      const pack = path.join(target, ".valdris-harness");
      const mirror = path.join(
        pack,
        ".agents",
        "skills",
        "valdris-intake-route",
        "SKILL.md",
      );
      writeFileSync(
        mirror,
        `${readFileSync(mirror, "utf8")}\nsynthetic drift\n`,
        "utf8",
      );
      const gate = runAbsolute(
        path.join(pack, "scripts", "skill-registry-gate.mjs"),
        ["--repo", pack],
        target,
      );
      assert(
        gate.status !== 0 &&
          output(gate).includes("differs from canonical skill"),
        "generated Codex skill drift was accepted",
      );
    },
    ["convergence:skill-drift"],
  );

  const routeCases = [
    [
      "ambiguous-intake",
      "Make it better",
      "ambiguous",
      "valdris-intake-route",
      (_route, classification) =>
        classification.materialUnknowns.some(
          ({ id }) => id === "scope-definition",
        ),
    ],
    [
      "audit",
      "Audit this repository end to end",
      "audit",
      "valdris-intake-route",
    ],
    [
      "feature",
      "Build a full-stack customer portal",
      "feature",
      "valdris-feature-delivery",
    ],
    ["bug-rca", "Fix the duplicate retry bug", "bug", "valdris-bug-rca"],
    [
      "architecture",
      "Refactor the service module boundaries",
      "architecture-refactor",
      "valdris-architecture-refactor",
    ],
    [
      "security",
      "Audit authorization and tenant isolation",
      "security",
      "valdris-security-audit",
    ],
    [
      "platform-release",
      "Ship the current build to TestFlight",
      "platform-release",
      "valdris-platform-release",
    ],
    [
      "genai",
      "Audit our RAG model quality",
      "genai",
      "valdris-genai-assurance",
    ],
    [
      "proof-handoff",
      "Verify this is ready to merge",
      "proof-handoff",
      "valdris-proof-handoff",
    ],
    [
      "manual-provider-change",
      "Manually change production provider configuration",
      "platform-release",
      "valdris-platform-release",
      (route) => route.gateApplicability.smoke.status === "required",
    ],
    [
      "manual-data-change",
      "Manually change production customer data",
      "platform-release",
      "valdris-platform-release",
      (route) => route.gateApplicability.smoke.status === "required",
    ],
    [
      "documentation-only",
      "Write a README",
      "docs-only",
      "valdris-intake-route",
      (route) => route.gateApplicability.foundation.status === "not-applicable",
    ],
    [
      "mixed-intent",
      "Fix the retry bug and deploy the repair",
      "bug",
      "valdris-bug-rca",
      (route) =>
        route.skillPhases[1].supporting.includes("valdris-platform-release") &&
        route.gateApplicability.smoke.status === "required",
    ],
  ];
  routeCases.push([
    "manual-bug-precedence",
    "Fix the duplicate retry bug by manually changing customer data in production",
    "bug",
    "valdris-bug-rca",
    (route) =>
      route.skillPhases[1].supporting.includes("valdris-platform-release") &&
      route.gateApplicability.smoke.status === "required",
  ]);
  for (const [
    id,
    request,
    expectedType,
    expectedPrimary,
    inspect,
  ] of routeCases)
    record(
      `route ${id}`,
      () =>
        routeCase(
          tempRoot,
          id,
          request,
          expectedType,
          expectedPrimary,
          inspect,
        ),
      [`route:${id}`],
    );
  record(
    "complete routing matrix executed",
    () => {
      assert(
        routeCases.every(([id]) =>
          checks.some((check) => check.name === `route ${id}` && check.ok),
        ),
        "one or more route cases did not execute successfully",
      );
    },
    ["convergence:route-matrix"],
  );

  record(
    "neutral full-stack target completes a commissioned structural run",
    () => {
      const target = path.join(tempRoot, "neutral-full-stack-target");
      mkdirSync(path.join(target, "src"), { recursive: true });
      writeFileSync(
        path.join(target, "package.json"),
        `${JSON.stringify({ name: "neutral-full-stack-target", private: true, type: "module" }, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(target, "src", "application.mjs"),
        "export const application = 'neutral-full-stack';\n",
        "utf8",
      );
      writeFileSync(
        path.join(target, "src", "verification-fixture.js"),
        "export function verifiedFixture() { return 'verified'; }\n",
        "utf8",
      );
      runGit(target, ["init"]);
      runGit(target, ["config", "user.email", "neutral-pilot@example.com"]);
      runGit(target, ["config", "user.name", "Neutral Pilot"]);
      runGit(target, ["add", "."]);
      runGit(target, [
        "commit",
        "-m",
        "test: initialize neutral full-stack target",
      ]);

      const commission = run("commission-harness.mjs", [
        "--repo",
        target,
        "--project-name",
        "Neutral Full Stack Target",
        "--yes",
      ]);
      assert(
        commission.status === 0,
        `neutral target commissioning failed: ${output(commission).slice(-2000)}`,
      );
      const pack = path.join(target, ".valdris-harness");
      for (const relative of [
        ".agents/skills/valdris-intake-route/SKILL.md",
        ".claude/skills/valdris-intake-route/SKILL.md",
        "scripts/enterprise-ai-gate-all.mjs",
      ])
        assert(
          existsSync(path.join(pack, relative)),
          `commissioned pack is missing ${relative}`,
        );

      const reviewKeyId = "NEUTRAL-PILOT-REVIEW-KEY-001";
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const reviewTrustPath = path.join(
        pack,
        "controls",
        "review-trust.v1.json",
      );
      writeJson(reviewTrustPath, {
        schema: "valdris.review-trust.v1",
        keys: [
          {
            keyId: reviewKeyId,
            algorithm: "ed25519",
            status: "active",
            publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
            allowedActorIds: ["NEUTRAL-PILOT-REVIEWER"],
            allowedActorTypes: ["agent"],
          },
        ],
      });
      const reviewTrustSha256 = sha256(
        canonicalJson(JSON.parse(readFileSync(reviewTrustPath, "utf8"))),
      );
      runGit(target, ["add", ".valdris-harness", "AGENTS.md", "CLAUDE.md"]);
      runGit(target, [
        "commit",
        "-m",
        "chore: commission neutral Valdris runtime",
      ]);
      const commit = runGit(target, ["rev-parse", "HEAD"]);
      const pilotRequest =
        "Build and evaluate a neutral full-stack application with a frontend, API, database, authentication, hosting, cloud compute, CI/CD, security, rate limiting, caching, scaling, observability, recovery, and an AI assistant using RAG, tools, memory, and async workflow orchestration.";
      const generatedRouteResult = runAbsolute(
        path.join(pack, "scripts", "route-request.mjs"),
        [
          "--repo",
          target,
          "--run-id",
          "VERIFY-001",
          "--profile",
          "enterprise",
          "--environment",
          "verification",
          "--actor",
          "Neutral Pilot Owner",
          "--request",
          pilotRequest,
        ],
        target,
      );
      assert(
        generatedRouteResult.status === 0,
        `generated natural-language route failed: ${output(generatedRouteResult).slice(-2000)}`,
      );
      const intakePath = path.join(target, "run", "intake.json");
      const classificationPath = path.join(
        target,
        "run",
        "workload-classification.json",
      );
      const routePath = path.join(target, "run", "route.json");
      const goalPath = path.join(target, "goal", "goal.json");
      const initialGeneratedGoal = JSON.parse(readFileSync(goalPath, "utf8"));
      const routedCheckpointResult = runAbsolute(
        path.join(pack, "scripts", "goal-transition.mjs"),
        [
          "--repo",
          target,
          "--expected-revision",
          String(initialGeneratedGoal.revision),
          "--checkpoint",
          initialGeneratedGoal.checkpoints[0].id,
          "--checkpoint-status",
          "passed",
          "--summary",
          "Natural-language intake and immutable routing completed in the commissioned harness.",
        ],
        target,
      );
      assert(
        routedCheckpointResult.status === 0,
        `generated intake-route checkpoint transition failed: ${output(routedCheckpointResult).slice(-2000)}`,
      );
      const routedGoal = JSON.parse(readFileSync(goalPath, "utf8"));
      const progressResult = runAbsolute(
        path.join(pack, "scripts", "goal-transition.mjs"),
        [
          "--repo",
          target,
          "--expected-revision",
          String(routedGoal.revision),
          "--checkpoint",
          "commissioned-full-stack-pilot",
          "--checkpoint-status",
          "progress",
          "--summary",
          "Commissioned natural-language route entered the structural assurance loop.",
        ],
        target,
      );
      assert(
        progressResult.status === 0,
        `generated goal checkpoint transition failed: ${output(progressResult).slice(-2000)}`,
      );
      const generatedInputs = {
        intake: readFileSync(intakePath),
        classification: readFileSync(classificationPath),
        route: readFileSync(routePath),
        goal: JSON.parse(readFileSync(goalPath, "utf8")),
      };

      const fixture = run("verify-enterprise-ai.mjs", [
        "--write-fixture",
        target,
      ]);
      assert(
        fixture.status === 0,
        `neutral full-stack fixture creation failed: ${output(fixture).slice(-2000)}`,
      );
      const oldClassificationSha256 = sha256(readFileSync(classificationPath));
      const oldRouteSha256 = sha256(readFileSync(routePath));
      rewriteJsonArtifacts(target, new Map([["verify-enterprise-ai", commit]]));
      writeFileSync(intakePath, generatedInputs.intake);
      writeFileSync(classificationPath, generatedInputs.classification);
      writeFileSync(routePath, generatedInputs.route);
      const classificationSha256 = sha256(readFileSync(classificationPath));
      const routeDocument = JSON.parse(readFileSync(routePath, "utf8"));
      assert(
        routeDocument.intakeSha256 === sha256(readFileSync(intakePath)) &&
          routeDocument.workloadClassificationSha256 === classificationSha256,
        "generated route lost its intake or classification binding",
      );
      const routeSha256 = sha256(readFileSync(routePath));
      rewriteJsonArtifacts(
        target,
        new Map([
          [oldClassificationSha256, classificationSha256],
          [oldRouteSha256, routeSha256],
        ]),
      );
      const contextManifestPath = path.join(target, "context", "manifest.json");
      const contextManifestSha256 = sha256(readFileSync(contextManifestPath));
      const contextBaselinePath = path.join(
        target,
        "proof",
        "context-baseline-results.json",
      );
      const contextCandidatePath = path.join(
        target,
        "proof",
        "context-candidate-results.json",
      );
      for (const resultPath of [contextBaselinePath, contextCandidatePath]) {
        const result = JSON.parse(readFileSync(resultPath, "utf8"));
        result.contextManifestSha256 = contextManifestSha256;
        writeJson(resultPath, result);
      }
      const evalPath = path.join(target, "evals", "results.json");
      const evaluation = JSON.parse(readFileSync(evalPath, "utf8"));
      const contextSuite = evaluation.suites.find(
        ({ id }) => id === "context-lane-quality",
      );
      contextSuite.resultDigest = sha256(readFileSync(contextCandidatePath));
      contextSuite.contextComparison.contextManifestSha256 =
        contextManifestSha256;
      contextSuite.contextComparison.baseline.resultDigest = sha256(
        readFileSync(contextBaselinePath),
      );
      contextSuite.contextComparison.candidate.resultDigest = sha256(
        readFileSync(contextCandidatePath),
      );
      writeJson(evalPath, evaluation);
      const foundationPath = path.join(target, "foundation", "assessment.json");
      const foundation = JSON.parse(readFileSync(foundationPath, "utf8"));
      foundation.catalogSha256 = sha256(
        readFileSync(path.join(pack, "controls", "foundation-layer.v1.json")),
      );
      writeJson(foundationPath, foundation);
      writeJson(goalPath, generatedInputs.goal);
      rmSync(path.join(target, "controls"), { recursive: true, force: true });
      rmSync(path.join(target, "skills"), { recursive: true, force: true });

      let currentGoal = JSON.parse(readFileSync(goalPath, "utf8"));
      for (const checkpoint of currentGoal.checkpoints) {
        if (checkpoint.status === "passed") continue;
        const passedCheckpoint = runAbsolute(
          path.join(pack, "scripts", "goal-transition.mjs"),
          [
            "--repo",
            target,
            "--expected-revision",
            String(currentGoal.revision),
            "--checkpoint",
            checkpoint.id,
            "--checkpoint-status",
            "passed",
            "--summary",
            "All commissioned structural gates and evidence artifacts are ready for closure.",
          ],
          target,
        );
        assert(
          passedCheckpoint.status === 0,
          `generated goal checkpoint completion failed: ${output(passedCheckpoint).slice(-2000)}`,
        );
        currentGoal = JSON.parse(readFileSync(goalPath, "utf8"));
      }
      for (const condition of currentGoal.stoppingConditions) {
        const evidencePath = path.join(
          tempRoot,
          `goal-evidence-${condition.id}.json`,
        );
        writeJson(evidencePath, [
          {
            type: "artifact",
            subject: condition.id,
            runId: currentGoal.goalId,
            trustTier: "ci-attested",
            producer: {
              name: "valdris-convergence-verifier",
              version: "0.8.0",
              kind: "ci",
            },
            path: "proof/evidence.txt",
            sha256: sha256(
              readFileSync(path.join(target, "proof", "evidence.txt")),
            ),
            generatedAt: new Date().toISOString(),
            commit,
            environment: currentGoal.environment,
          },
        ]);
        const conditionResult = runAbsolute(
          path.join(pack, "scripts", "goal-transition.mjs"),
          [
            "--repo",
            target,
            "--expected-revision",
            String(currentGoal.revision),
            "--condition",
            condition.id,
            "--condition-status",
            "passed",
            "--evidence-file",
            evidencePath,
          ],
          target,
        );
        assert(
          conditionResult.status === 0,
          `generated goal condition transition failed: ${output(conditionResult).slice(-2000)}`,
        );
        currentGoal = JSON.parse(readFileSync(goalPath, "utf8"));
      }
      const completedGoalResult = runAbsolute(
        path.join(pack, "scripts", "goal-transition.mjs"),
        [
          "--repo",
          target,
          "--expected-revision",
          String(currentGoal.revision),
          "--goal-status",
          "completed",
        ],
        target,
      );
      assert(
        completedGoalResult.status === 0,
        `generated goal completion transition failed: ${output(completedGoalResult).slice(-2000)}`,
      );

      const intake = JSON.parse(readFileSync(intakePath, "utf8"));
      const route = JSON.parse(readFileSync(routePath, "utf8"));
      const goal = JSON.parse(readFileSync(goalPath, "utf8"));
      const production = JSON.parse(
        readFileSync(
          path.join(target, "production", "layer-assessment.json"),
          "utf8",
        ),
      );
      assert(
        intake.requestText.includes("neutral full-stack application"),
        "pilot intake is not the neutral full-stack workload",
      );
      assert(
        route.schema === "uash.route.v2" &&
          route.foundation.initialApplicability === "required",
        "pilot route does not bind Layer 0",
      );
      assert(
        route.productionLayers.length === 13 &&
          route.productionLayers.every(
            ({ initialApplicability }) => initialApplicability === "required",
          ),
        "pilot route does not require all 13 assurance domains",
      );
      assert(
        production.layers.length === 13 &&
          production.layers.every(
            ({ applicability, status }) =>
              applicability === "required" && status === "passed",
          ),
        "pilot did not pass all 13 assurance domains",
      );
      assert(
        goal.status === "completed" &&
          goal.initialRouteSha256 === sha256(readFileSync(routePath)),
        "pilot goal is not completed against its immutable route",
      );
      assert(
        goal.stoppingConditions.every(({ status }) => status === "passed") &&
          goal.checkpoints.every(({ status }) => status === "passed"),
        "pilot goal loop is incomplete",
      );

      const routeDigest = sha256(readFileSync(routePath));
      const reroute = runAbsolute(
        path.join(pack, "scripts", "route-request.mjs"),
        ["--repo", target, "--request", "Replace the accepted route"],
        target,
      );
      assert(
        reroute.status !== 0,
        "accepted route was overwritten without explicit replacement authority",
      );
      assert(
        sha256(readFileSync(routePath)) === routeDigest,
        "failed reroute mutated the immutable route",
      );

      for (const gate of [
        "intake-gate.mjs",
        "workload-classification-gate.mjs",
        "route-gate.mjs",
        "foundation-gate.mjs",
        "production-layer-gate.mjs",
        "ai-assurance-gate.mjs",
        "goal-gate.mjs",
        "eval-gate.mjs",
        "trajectory-gate.mjs",
        "enterprise-ai-gate-all.mjs",
      ]) {
        const result = runAbsolute(
          path.join(pack, "scripts", gate),
          ["--repo", target],
          target,
        );
        assert(
          result.status === 0,
          `commissioned neutral target failed ${gate}: ${output(result).slice(-2000)}`,
        );
      }

      const previousTrustPin = process.env.UASH_REVIEW_TRUST_SHA256;
      process.env.UASH_REVIEW_TRUST_SHA256 = reviewTrustSha256;
      try {
        const proofPath = path.join(target, "proof", "portable.json");
        const proof = runAbsolute(
          path.join(pack, "scripts", "proof-runner.mjs"),
          [
            "--repo",
            target,
            "--run-id",
            goal.goalId,
            "--commit",
            commit,
            "--environment",
            goal.environment,
            "--output",
            "proof/portable.json",
            "--",
            process.execPath,
            "-e",
            "process.stdout.write('neutral-full-stack-structural-proof')",
          ],
          target,
        );
        assert(
          proof.status === 0,
          `neutral portable proof failed: ${output(proof).slice(-2000)}`,
        );

        const runtimeResult = runAbsolute(
          path.join(pack, "scripts", "run-packet-gate.mjs"),
          ["--repo", target, "--print-runtime-binding", "--commit", commit],
          target,
        );
        assert(
          runtimeResult.status === 0,
          `neutral runtime binding failed: ${output(runtimeResult).slice(-2000)}`,
        );
        const runtimeBinding = JSON.parse(runtimeResult.stdout);
        const gateArguments = [
          "--gate",
          "code-intelligence=graph/graph.json",
          "--gate",
          "foundation=foundation/assessment.json",
          "--gate",
          "production=production/layer-assessment.json",
          "--gate",
          "ai-assurance=ai/assurance.json",
          "--gate",
          "eval=evals/results.json",
          "--gate",
          "trajectory=trajectory/trajectory.json",
        ];
        const bundleResult = runAbsolute(
          path.join(pack, "scripts", "run-create.mjs"),
          [
            "--repo",
            target,
            "--run-id",
            goal.goalId,
            "--commit",
            commit,
            "--environment",
            goal.environment,
            "--proof",
            "proof/portable.json",
            ...gateArguments,
            "--print-evidence-bundle",
          ],
          target,
        );
        assert(
          bundleResult.status === 0,
          `neutral review bundle failed: ${output(bundleResult).slice(-2000)}`,
        );
        const evidenceBundle = JSON.parse(bundleResult.stdout);
        const generatedAt = new Date().toISOString();
        const proofDigest = sha256(readFileSync(proofPath));
        const review = {
          schema: "valdris.review.v2",
          generatedAt,
          runId: goal.goalId,
          commit,
          environment: goal.environment,
          status: "passed",
          subject: { artifact: "proof/portable.json", sha256: proofDigest },
          reviewTrustSha256,
          validationRuntimeSha256: runtimeBinding.setSha256,
          evidenceBundleSha256: evidenceBundle.evidenceBundleSha256,
          roleProvenance: {
            schema: "valdris.review-role-provenance.v1",
            scout: {
              actorId: "NEUTRAL-PILOT-SCOUT",
              actorType: "agent",
              sessionId: "NEUTRAL-PILOT-SCOUT-SESSION",
              executionId: "NEUTRAL-PILOT-SCOUT-EXECUTION",
              evidence: {
                kind: "artifact",
                path: "run/route.json",
                sha256: routeDigest,
              },
            },
            implementer: {
              actorId: "NEUTRAL-PILOT-IMPLEMENTER",
              actorType: "agent",
              sessionId: "NEUTRAL-PILOT-IMPLEMENTER-SESSION",
              executionId: "NEUTRAL-PILOT-IMPLEMENTER-EXECUTION",
              evidence: {
                kind: "artifact",
                path: "proof/portable.json",
                sha256: proofDigest,
              },
            },
            verifier: {
              actorId: "NEUTRAL-PILOT-VERIFIER",
              actorType: "agent",
              sessionId: "NEUTRAL-PILOT-VERIFIER-SESSION",
              executionId: "NEUTRAL-PILOT-VERIFIER-EXECUTION",
              evidence: {
                kind: "artifact",
                path: "proof/portable.json",
                sha256: proofDigest,
              },
            },
            independentReviewer: {
              actorId: "NEUTRAL-PILOT-REVIEWER",
              actorType: "agent",
              sessionId: "NEUTRAL-PILOT-REVIEW-SESSION",
              executionId: "NEUTRAL-PILOT-REVIEW-EXECUTION",
              evidence: {
                kind: "review-evidence-bundle",
                sha256: evidenceBundle.evidenceBundleSha256,
              },
            },
          },
          decision: {
            status: "accepted",
            summary:
              "Neutral commissioned structural proof satisfies the v0.8 finish-line contract.",
          },
          findings: [],
          blockers: [],
        };
        review.attestation = {
          scheme: "ed25519",
          keyId: reviewKeyId,
          signedAt: generatedAt,
        };
        const serialized = canonicalJson(reviewAttestationPayload(review));
        review.attestation.payloadSha256 = sha256(serialized);
        review.attestation.signature = signPayload(
          null,
          Buffer.from(serialized, "utf8"),
          privateKey,
        ).toString("base64");
        writeJson(path.join(target, "review", "review.json"), review);
        const reviewResult = runAbsolute(
          path.join(pack, "scripts", "review-gate.mjs"),
          ["--repo", target, "--file", "review/review.json"],
          target,
        );
        assert(
          reviewResult.status === 0,
          `neutral independent review failed: ${output(reviewResult).slice(-2000)}`,
        );

        const packetResult = runAbsolute(
          path.join(pack, "scripts", "run-create.mjs"),
          [
            "--repo",
            target,
            "--run-id",
            goal.goalId,
            "--commit",
            commit,
            "--environment",
            goal.environment,
            "--proof",
            "proof/portable.json",
            "--review",
            "review/review.json",
            ...gateArguments,
            "--output",
            "run/packet.json",
          ],
          target,
        );
        assert(
          packetResult.status === 0,
          `neutral run-packet creation failed: ${output(packetResult).slice(-2000)}`,
        );
        const packetGate = runAbsolute(
          path.join(pack, "scripts", "run-packet-gate.mjs"),
          ["--repo", target, "--file", "run/packet.json"],
          target,
        );
        assert(
          packetGate.status === 0,
          `neutral run-packet finish line failed: ${output(packetGate).slice(-2000)}`,
        );
        const packet = JSON.parse(
          readFileSync(path.join(target, "run", "packet.json"), "utf8"),
        );
        assert(
          packet.status === "ready" &&
            packet.requiredGates.includes("independent-review") &&
            packet.requiredGates.includes("production"),
          "neutral finish-line packet is incomplete",
        );
      } finally {
        if (previousTrustPin === undefined)
          delete process.env.UASH_REVIEW_TRUST_SHA256;
        else process.env.UASH_REVIEW_TRUST_SHA256 = previousTrustPin;
      }
    },
    [
      "convergence:neutral-full-stack",
      "convergence:generated-skill-packs",
      "convergence:goal-loop",
      "convergence:structural-controls",
      "convergence:finish-line",
      "convergence:proof-lifecycle",
    ],
  );

  record("every admitted behavior resolves to an executed verification", () => {
    const unresolved = catalog.behaviors
      .filter(({ disposition }) => disposition !== "EXCLUDE")
      .filter(({ verification }) => !executedBindings.has(verification))
      .map(({ id }) => id);
    assert(
      unresolved.length === 0,
      `behavior catalog has unresolved verification bindings: ${unresolved.join(", ")}`,
    );
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const failed = checks.filter((check) => !check.ok);
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      schema: "valdris.clean-room-convergence-verification.v1",
      checked: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      failures: failed,
      endToEnd: "neutral commissioned full-stack structural pilot",
      delegatedCompletion: [
        "verify:commissioned-portability",
        "verify:harness",
      ],
    },
    null,
    2,
  ),
);
if (failed.length) process.exit(1);
