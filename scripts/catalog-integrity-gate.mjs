#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateResult, parseRepoFileArgs } from "./control-gate-lib.mjs";

const ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const CANONICAL_CATALOG_SHA256 = Object.freeze({
  "controls/workload-taxonomy.v1.json":
    "1d43a946a5aabe9919d46cdc52591950e85aa238e3d3886c3e6a2d65f157da14",
  "controls/foundation-layer.v1.json":
    "a7403ada1c5dad44e126544337a5c2884ac1eaac43e6f6c2daf1bb2df90b319e",
  "controls/production-layers.v2.json":
    "19bbb930c70eb99093fd2318b9fb45e4fc5543e8158c9c5d2e893c0d708ec3e5",
  "controls/genai-assurance.v1.json":
    "dbdfe7854f000dd6312f0c7c08fc882ec1b39bec411de9ccd52a423c3a358ebc",
  "controls/domain-packs/index.json":
    "993b99ac179e6220a7d26c86181babf6c79fb37db55f760e277d50e5777d6324",
  "controls/domain-packs/saas.v1.json":
    "4290d854d35217e9cc304a101ec53f378c24123407cd604229e0409da728b913",
  "controls/domain-packs/mobile-ios.v1.json":
    "c7ec574e021f25d54bd71d0717b4cf9abc675c753cae4ef1524da93848eeda28",
  "controls/domain-packs/multiplayer-realtime.v1.json":
    "953a499cdef8496e899b5e6d4118ead694d9a191d26c443cc32e5d93f3065da6",
  "controls/domain-packs/digital-commerce.v1.json":
    "cc57dbf35907911909104ed0821287a641782be33b9788d64c3b077486d2647f",
  "controls/domain-packs/youth-ai-safety.v1.json":
    "52796b6f8724e98843e569449ea703a91234a960663720a5eb78a26257790074",
  "controls/provenance/thirteen-layers.upstream.v1.json":
    "8e5901e1894f94e0ecec37433718d9b51a11a7e143c76519c066074846ea9260",
  "controls/crosswalks/thirteen-layers-to-uash.v1.json":
    "41269ae1176199c79a7693438497b61bcaa4440d142ccdf4a32ea911ad2ed00e",
  "controls/assurance-execution-policy.v1.json":
    "8c44818fbdedf8c7bb3333e76fa53e5cd7256b035390fe49abf4abb899b62655",
  "controls/capability-packs/async-workflows.v1.json":
    "dbe9b82d84aa66be8285b057467b049bcba55a71a81b13cb54276d205dd87392",
  "controls/clean-room-behaviors.v1.json":
    "d27dd758d131d7bef1b40f09db0692e1b1cb8a4716e2aa8ae76b623ea28090fb",
  "controls/authoritative-assurance.v1.json":
    "b0a123ec4e451dd0775cc6b152caeb72d2e321f9e4b39b85b12bb7075966c2b3",
});

function semanticSha256(filePath) {
  return createHash("sha256")
    .update(JSON.stringify(JSON.parse(readFileSync(filePath, "utf8"))))
    .digest("hex");
}

export function validateCatalogIntegrity(assetRoot = ASSET_ROOT) {
  const problems = [];
  for (const [relativePath, expected] of Object.entries(
    CANONICAL_CATALOG_SHA256,
  )) {
    const target = path.resolve(assetRoot, relativePath);
    if (!existsSync(target)) {
      problems.push(`canonical catalog missing: ${relativePath}`);
      continue;
    }
    try {
      if (semanticSha256(target) !== expected)
        problems.push(`canonical catalog integrity mismatch: ${relativePath}`);
    } catch (error) {
      problems.push(
        `canonical catalog is not valid JSON: ${relativePath}: ${error.message}`,
      );
    }
  }
  return {
    checked: true,
    valid: problems.length === 0,
    catalogCount: Object.keys(CANONICAL_CATALOG_SHA256).length,
    problems,
  };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2));
  if (args.help)
    return console.log(
      "Usage: node scripts/catalog-integrity-gate.mjs --repo .",
    );
  gateResult(
    "canonical control catalogs",
    validateCatalogIntegrity(ASSET_ROOT),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
