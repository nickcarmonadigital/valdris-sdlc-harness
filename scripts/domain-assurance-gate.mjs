#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evidencePolicyForEffectiveTier,
  existingFileWithinRepo,
  gateResult,
  isIsoTimestamp,
  nonEmpty,
  parseRepoFileArgs,
  readJson,
  resolveWithinRepo,
  sha256File,
  validateControl,
} from "./control-gate-lib.mjs";

export const DOMAIN_ASSURANCE_SCHEMA = "uash.domain-assurance.v1";
export const DOMAIN_INDEX_SCHEMA = "uash.domain-pack-index.v1";
export const DOMAIN_CATALOG_SCHEMA = "uash.domain-control-catalog.v1";
const ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PROFILES = new Set([
  "prototype",
  "production",
  "enterprise",
  "regulated",
]);
export const CANONICAL_DOMAIN_INDEX_SHA256 =
  "993b99ac179e6220a7d26c86181babf6c79fb37db55f760e277d50e5777d6324";
export const CANONICAL_DOMAIN_CATALOG_SHA256 = Object.freeze({
  saas: "4290d854d35217e9cc304a101ec53f378c24123407cd604229e0409da728b913",
  "mobile-ios":
    "c7ec574e021f25d54bd71d0717b4cf9abc675c753cae4ef1524da93848eeda28",
  "multiplayer-realtime":
    "953a499cdef8496e899b5e6d4118ead694d9a191d26c443cc32e5d93f3065da6",
  "digital-commerce":
    "cc57dbf35907911909104ed0821287a641782be33b9788d64c3b077486d2647f",
  "youth-ai-safety":
    "52796b6f8724e98843e569449ea703a91234a960663720a5eb78a26257790074",
});
const DOMAIN_CONTROL_IDS = {
  "mobile-ios": [
    "IOS-SUPPORT-001",
    "IOS-QUALITY-001",
    "IOS-SECURITY-001",
    "IOS-BUILD-001",
    "IOS-DISTRIBUTION-001",
    "IOS-PUSH-001",
  ],
  "multiplayer-realtime": [
    "MP-AUTHORITY-001",
    "MP-SESSION-001",
    "MP-MATCH-001",
    "MP-CAPACITY-001",
    "MP-STATE-001",
    "MP-INCIDENT-001",
  ],
  "digital-commerce": [
    "COM-AUTHORITY-001",
    "COM-IDEMPOTENCY-001",
    "COM-LIFECYCLE-001",
    "COM-RECONCILE-001",
    "COM-FRAUD-001",
    "COM-REDZONE-001",
  ],
  "youth-ai-safety": [
    "YOUTH-AUDIENCE-001",
    "YOUTH-CONTENT-001",
    "YOUTH-PRIVACY-001",
    "YOUTH-SOCIAL-001",
    "YOUTH-AI-AUTHORITY-001",
    "YOUTH-INCIDENT-001",
  ],
  saas: [
    "SAAS-TENANT-001",
    "SAAS-ROLES-001",
    "SAAS-ENTITLEMENTS-001",
    "SAAS-METERING-001",
    "SAAS-LIFECYCLE-001",
    "SAAS-AUDIT-001",
  ],
};
const DOMAIN_CONDITIONALS = {
  "IOS-DISTRIBUTION-001": "distribution",
  "IOS-PUSH-001": "push",
};
const IOS_IDENTITY_CONTROLS = new Set([
  "IOS-QUALITY-001",
  "IOS-BUILD-001",
  "IOS-DISTRIBUTION-001",
]);

function validateDomainEvidenceContract(control, label, packIdentity) {
  const evidence = Array.isArray(control?.evidence) ? control.evidence : [];
  const problems = [];
  if (IOS_IDENTITY_CONTROLS.has(control?.id)) {
    for (const item of evidence) {
      for (const field of [
        "buildId",
        "scheme",
        "bundleAndTeam",
        "commissioningSha256",
      ]) {
        const expected =
          field === "buildId" ? packIdentity?.buildId : packIdentity?.[field];
        const actual =
          field === "buildId" ? item?.targetIdentifier : item?.[field];
        if (!nonEmpty(expected) || actual !== expected)
          problems.push(
            `${label} evidence must bind ${field} to the mobile-ios pack identity`,
          );
      }
    }
  }
  if (control?.id === "IOS-QUALITY-001") {
    const nativeTests = evidence.find(
      (item) =>
        item?.type === "command" &&
        /^\s*xcodebuild\b/i.test(item.command || "") &&
        /\btest\b/i.test(item.command || "") &&
        item.runnerOs === "macos" &&
        item.trustTier === "ci-attested" &&
        item.producer?.kind === "ci" &&
        ["simulator", "physical"].includes(item.deviceClass),
    );
    if (!nativeTests)
      problems.push(
        `${label} requires CI-attested xcodebuild test evidence from a macOS simulator or physical device destination`,
      );
  }
  if (control?.id === "IOS-BUILD-001") {
    const nativeArchive = evidence.find(
      (item) =>
        item?.type === "command" &&
        /^\s*xcodebuild\b/i.test(item.command || "") &&
        /\barchive\b/i.test(item.command || ""),
    );
    const buildReceipt = evidence.find(
      (item) =>
        item?.type === "provider-report" &&
        /github actions|xcode cloud/i.test(item.provider || ""),
    );
    if (!nativeArchive)
      problems.push(`${label} requires xcodebuild archive command evidence`);
    else {
      if (nativeArchive.runnerOs !== "macos")
        problems.push(`${label} command evidence runnerOs must be macos`);
      if (
        nativeArchive.trustTier !== "ci-attested" ||
        nativeArchive.producer?.kind !== "ci"
      )
        problems.push(`${label} command evidence must be CI-attested`);
    }
    if (!buildReceipt)
      problems.push(
        `${label} requires a GitHub Actions/Xcode Cloud provider receipt for the archive job`,
      );
  }
  if (control?.id === "IOS-DISTRIBUTION-001") {
    const providerReport = evidence.find(
      (item) =>
        item?.type === "provider-report" &&
        /app store connect|testflight/i.test(item.provider || "") &&
        /^https:\/\/(appstoreconnect|itunesconnect)\.apple\.com\//i.test(
          item.url || "",
        ),
    );
    const humanApproval = evidence.find(
      (item) =>
        item?.type === "approval" &&
        item.actorType === "human" &&
        item.status === "granted" &&
        ["testflight-release", "app-store-release"].includes(item.scope) &&
        nonEmpty(item.bridgeEventId),
    );
    if (!providerReport)
      problems.push(
        `${label} requires an App Store Connect/TestFlight provider report`,
      );
    if (!humanApproval)
      problems.push(
        `${label} requires scoped human release approval with a token-gated bridgeEventId`,
      );
  }
  return problems;
}

export function validateDomainAssurance(document, options) {
  const {
    repoRoot,
    index,
    catalogRoot = repoRoot,
    classification,
    classificationSha256,
    evidenceProfile,
    minimumTechnicalTrust,
  } = options;
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document))
    return {
      valid: false,
      problems: ["domain assurance must be a JSON object"],
    };
  if (document.schema !== DOMAIN_ASSURANCE_SCHEMA)
    problems.push(`domain assurance schema must be ${DOMAIN_ASSURANCE_SCHEMA}`);
  if (index?.schema !== DOMAIN_INDEX_SCHEMA || !Array.isArray(index.packs))
    problems.push(`domain pack index schema must be ${DOMAIN_INDEX_SCHEMA}`);
  if (
    createHash("sha256").update(JSON.stringify(index)).digest("hex") !==
    CANONICAL_DOMAIN_INDEX_SHA256
  )
    problems.push(
      "domain pack index does not match the locked canonical v1 policy; change the index and validator together under a reviewed version update",
    );
  if (!isIsoTimestamp(document.generatedAt))
    problems.push("domain assurance generatedAt must be an ISO timestamp");
  if (!nonEmpty(document.runId))
    problems.push("domain assurance runId is required");
  if (!PROFILES.has(document.profile))
    problems.push("domain assurance profile is invalid");
  if (!nonEmpty(document.environment))
    problems.push("domain assurance environment is required");
  if (!nonEmpty(document.commit))
    problems.push("domain assurance commit is required");
  if (!evidencePolicyForEffectiveTier(document.effectiveTier))
    problems.push("domain assurance effectiveTier is invalid");
  if (!/^[a-f0-9]{64}$/i.test(nonEmpty(document.workloadClassificationSha256)))
    problems.push(
      "domain assurance workloadClassificationSha256 must be a SHA-256 digest",
    );
  if (classification) {
    if (document.runId !== classification.runId)
      problems.push(
        "domain assurance runId must match workload classification",
      );
    if (document.profile !== classification.requestedProfile)
      problems.push(
        "domain assurance profile must match workload classification",
      );
    if (document.effectiveTier !== classification.effectiveTier)
      problems.push(
        "domain assurance effectiveTier must match workload classification",
      );
    if (document.commit !== classification.commit)
      problems.push(
        "domain assurance commit must match workload classification",
      );
    if (document.environment !== classification.environment)
      problems.push(
        "domain assurance environment must match workload classification",
      );
    if (document.workloadClassificationSha256 !== classificationSha256)
      problems.push(
        "domain assurance workloadClassificationSha256 does not match run/workload-classification.json",
      );
  }
  const packs = Array.isArray(document.packs) ? document.packs : [];
  if (!Array.isArray(document.packs))
    problems.push("domain assurance packs must be an array");
  if (
    classification &&
    JSON.stringify(packs.map((pack) => pack?.id).sort()) !==
      JSON.stringify([...(classification.domainPacks || [])].sort())
  )
    problems.push("domain assurance packs must match workload classification");
  if (packs.length === 0) {
    if (document.status !== "skipped")
      problems.push("domain assurance with no active packs must be skipped");
    if (!nonEmpty(document.skipReason))
      problems.push("domain assurance skipped without skipReason");
    return {
      valid: problems.length === 0,
      schema: document.schema,
      activePacks: 0,
      controlCount: 0,
      problems,
    };
  }
  if (document.status !== "passed")
    problems.push("domain assurance with active packs must be passed");
  const seenPacks = new Set();
  let controlCount = 0;
  for (const pack of packs) {
    const packId = nonEmpty(pack?.id);
    if (seenPacks.has(packId))
      problems.push(`domain pack duplicated: ${packId}`);
    seenPacks.add(packId);
    const indexEntry = (index?.packs || []).find((item) => item.id === packId);
    if (!indexEntry) {
      problems.push(`unknown domain pack: ${packId || "missing"}`);
      continue;
    }
    const catalogPath = resolveWithinRepo(catalogRoot, indexEntry.path);
    if (!catalogPath || !existingFileWithinRepo(catalogRoot, catalogPath)) {
      problems.push(`domain catalog missing: ${indexEntry.path}`);
      continue;
    }
    const catalog = readJson(catalogPath);
    if (
      createHash("sha256").update(JSON.stringify(catalog)).digest("hex") !==
      CANONICAL_DOMAIN_CATALOG_SHA256[packId]
    )
      problems.push(
        `domain catalog ${packId} does not match the locked canonical v1 policy; change the catalog and validator together under a reviewed version update`,
      );
    if (
      catalog.schema !== DOMAIN_CATALOG_SCHEMA ||
      catalog.id !== packId ||
      !Array.isArray(catalog.controls)
    ) {
      problems.push(`domain catalog ${packId} is invalid`);
      continue;
    }
    const catalogIds = catalog.controls.map((control) => control.id);
    for (const expected of DOMAIN_CONTROL_IDS[packId] || [])
      if (!catalogIds.includes(expected))
        problems.push(
          `domain catalog ${packId} missing canonical control: ${expected}`,
        );
    for (const actual of catalogIds)
      if (!(DOMAIN_CONTROL_IDS[packId] || []).includes(actual))
        problems.push(
          `domain catalog ${packId} has unknown control: ${actual}`,
        );
    for (const control of catalog.controls) {
      if (!nonEmpty(control.requirement))
        problems.push(
          `domain catalog ${packId} control ${control.id || "missing"} requirement is required`,
        );
      const expectedConditional = DOMAIN_CONDITIONALS[control.id];
      if ((control.conditional || undefined) !== expectedConditional)
        problems.push(
          `domain catalog ${packId} control ${control.id || "missing"} conditional must be ${expectedConditional || "absent"}`,
        );
    }
    const conditionalFeatures = [
      ...new Set(
        catalog.controls.map((control) => control.conditional).filter(Boolean),
      ),
    ];
    for (const feature of conditionalFeatures)
      if (typeof pack.features?.[feature] !== "boolean")
        problems.push(
          `domain pack ${packId} features.${feature} must be boolean`,
        );
    if (
      classification &&
      JSON.stringify(pack.features || {}) !==
        JSON.stringify(classification.domainFeatures?.[packId] || {})
    )
      problems.push(
        `domain pack ${packId} features must match workload classification`,
      );
    const expectedControls = catalog.controls.filter(
      (control) =>
        !control.conditional || pack.features?.[control.conditional] === true,
    );
    if (packId === "mobile-ios") {
      for (const field of [
        "buildId",
        "scheme",
        "bundleAndTeam",
        "commissioningSha256",
      ])
        if (!nonEmpty(pack.identity?.[field]))
          problems.push(`domain pack mobile-ios identity.${field} is required`);
      if (!/^[a-f0-9]{64}$/i.test(nonEmpty(pack.identity?.commissioningSha256)))
        problems.push(
          "domain pack mobile-ios identity.commissioningSha256 must be a SHA-256 digest",
        );
    }
    const controls = Array.isArray(pack.controls) ? pack.controls : [];
    const seenControls = new Set();
    for (const control of controls) {
      const id = nonEmpty(control?.id);
      if (seenControls.has(id))
        problems.push(`domain control duplicated in ${packId}: ${id}`);
      seenControls.add(id);
      const definition = catalog.controls.find((item) => item.id === id);
      if (!definition)
        problems.push(
          `unknown domain control in ${packId}: ${id || "missing"}`,
        );
      else if (
        definition.conditional &&
        pack.features?.[definition.conditional] !== true
      )
        problems.push(
          `inactive conditional domain control included in ${packId}: ${id}`,
        );
      problems.push(
        ...validateControl(control, {
          repoRoot,
          profile: evidenceProfile,
          minimumTechnicalTrust,
          label: `domain control ${id || "missing"}`,
          allowSkipped: false,
          asOf: document.generatedAt,
          runId: document.runId,
          commit: document.commit,
          environment: document.environment,
        }),
      );
      problems.push(
        ...validateDomainEvidenceContract(
          control,
          `domain control ${id || "missing"}`,
          pack.identity,
        ),
      );
    }
    for (const required of expectedControls)
      if (!seenControls.has(required.id))
        problems.push(`domain pack ${packId} missing control: ${required.id}`);
    controlCount += seenControls.size;
  }
  return {
    valid: problems.length === 0,
    schema: document.schema,
    activePacks: seenPacks.size,
    controlCount,
    problems,
  };
}

async function main() {
  const args = parseRepoFileArgs(process.argv.slice(2), {
    file: "domain/assurance.json",
    catalog: "controls/domain-packs/index.json",
  });
  if (args.help)
    return console.log(
      "Usage: node scripts/domain-assurance-gate.mjs --repo . [--file domain/assurance.json] [--catalog controls/domain-packs/index.json]",
    );
  const repoRoot = path.resolve(args.repo);
  const target = path.resolve(repoRoot, args.file);
  const requestedIndexPath = path.resolve(repoRoot, args.catalog);
  const indexPath =
    args.catalog === "controls/domain-packs/index.json"
      ? path.join(ASSET_ROOT, "controls", "domain-packs", "index.json")
      : requestedIndexPath;
  if (!existsSync(target))
    return gateResult(args.file, {
      valid: false,
      problems: [`domain assurance missing: ${args.file}`],
    });
  if (!existsSync(indexPath))
    return gateResult(args.file, {
      valid: false,
      problems: [`domain pack index missing: ${args.catalog}`],
    });
  const catalogRoot = path.resolve(indexPath, "..", "..", "..");
  const classificationPath = path.join(
    repoRoot,
    "run",
    "workload-classification.json",
  );
  if (!existingFileWithinRepo(repoRoot, classificationPath))
    return gateResult(args.file, {
      valid: false,
      problems: [
        "domain assurance requires a real non-symlink run/workload-classification.json inside the repository",
      ],
    });
  try {
    const classification = readJson(classificationPath);
    const evidencePolicy = evidencePolicyForEffectiveTier(
      classification.effectiveTier,
    );
    if (!evidencePolicy)
      return gateResult(args.file, {
        valid: false,
        problems: [
          `domain assurance effective tier has no evidence policy: ${classification.effectiveTier || "missing"}`,
        ],
      });
    gateResult(
      args.file,
      validateDomainAssurance(readJson(target), {
        repoRoot,
        index: readJson(indexPath),
        catalogRoot,
        classification,
        classificationSha256: sha256File(classificationPath),
        evidenceProfile: evidencePolicy.profile,
        minimumTechnicalTrust: evidencePolicy.minimumTechnicalTrust,
      }),
    );
  } catch (error) {
    gateResult(args.file, {
      valid: false,
      problems: [
        `domain assurance or catalog must be valid JSON: ${error.message}`,
      ],
    });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
