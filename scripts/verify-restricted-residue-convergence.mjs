#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  gzipWithFilename,
  tarArchive,
  writeJsonFixture as writeJson,
} from "./verification/clean-room-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

export const RESTRICTED_RESIDUE_CONVERGENCE_BINDINGS = Object.freeze([
  "convergence:restricted-residue-surfaces",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function run(script, args) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", script), ...args],
    {
      cwd: ROOT,
      env: process.env,
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

function main() {
  const tempRoot = realpathSync(
    mkdtempSync(
      path.join(os.tmpdir(), "valdris-restricted-residue-convergence-"),
    ),
  );
  try {
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
      "restricted residue in an empty generated-pack directory is rejected",
      () => {
        const emptyDirectoryRepo = path.join(tempRoot, "empty-directory-repo");
        const emptyDirectoryPack = path.join(tempRoot, "empty-directory-pack");
        mkdirSync(emptyDirectoryRepo, { recursive: true });
        mkdirSync(path.join(emptyDirectoryPack, restrictedName), {
          recursive: true,
        });
        writeFileSync(
          path.join(emptyDirectoryRepo, "README.md"),
          "neutral\n",
          "utf8",
        );
        const result = run("restricted-residue-gate.mjs", [
          "--repo",
          emptyDirectoryRepo,
          "--manifest",
          residueManifest,
          "--generated-pack",
          emptyDirectoryPack,
        ]);
        assert(
          result.status !== 0,
          "restricted empty directory name was accepted",
        );
        assert(
          !output(result).includes(restrictedName),
          "restricted empty directory name leaked into diagnostics",
        );
      },
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
          writeFileSync(
            path.join(isolated, "fixture.bin"),
            readFileSync(source),
          );
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

        const expansionBomb = gzipSync(
          Buffer.alloc(16 * 1024 * 1024 + 1, 0x20),
        );
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
          gzipSync(
            tarArchive("package/public.txt", "neutral release content\n"),
          ),
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
      writeJson(installedManifest, {
        installed: [{ source: "public-catalog" }],
      });
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
        writeFileSync(
          malformedManifest,
          `{"value":"${restrictedPath}"`,
          "utf8",
        );
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
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  const failures = checks.filter(({ ok }) => !ok);
  const payload = {
    ok: failures.length === 0,
    gate: "restricted-residue-convergence",
    checked: checks.length,
    passed: checks.length - failures.length,
    failures,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url))
  main();
