import { createHash } from "node:crypto";

export const WORKLOAD_CLASSIFICATION_SCHEMA = "uash.workload-classification.v1";
export const WORKLOAD_TAXONOMY_SCHEMA = "uash.workload-taxonomy-catalog.v1";
export const CANONICAL_WORKLOAD_TAXONOMY_SHA256 = "1d43a946a5aabe9919d46cdc52591950e85aa238e3d3886c3e6a2d65f157da14";

const TASK_TYPES = new Set(["ambiguous", "bug", "feature", "architecture-refactor", "security", "platform-release", "genai", "audit", "incident", "proof-handoff", "docs-only"]);
const AI_FEATURES = ["rag", "tools", "memory", "consequential", "userFacing", "sensitiveData", "autonomous"];
const MATURITY_PROFILE_FLOORS = { prototype: "T0", production: "T1", enterprise: "T2", regulated: "T3" };

export const DELIVERY_PRIMARY_BY_TASK = Object.freeze({
  ambiguous: "valdris-intake-route",
  bug: "valdris-bug-rca",
  feature: "valdris-feature-delivery",
  "architecture-refactor": "valdris-architecture-refactor",
  security: "valdris-security-audit",
  "platform-release": "valdris-platform-release",
  genai: "valdris-genai-assurance",
  audit: "valdris-intake-route",
  incident: "valdris-platform-release",
  "proof-handoff": "valdris-proof-handoff",
  "docs-only": "valdris-intake-route",
});

export const MANDATORY_RED_ZONE = Object.freeze([
  "production deploy or data mutation",
  "secrets/IAM/provider configuration",
  "billing/refund/reconciliation",
  "Apple signing/TestFlight/App Store actions",
  "customer or tester communication",
]);

export const MANDATORY_FORBIDDEN_ACTIONS = Object.freeze([
  "agent self-approval",
  "production mutation without approval",
  "secret access without approval",
  "fabricated evidence",
]);

export function deliveryPrimaryForTask(taskType) {
  return DELIVERY_PRIMARY_BY_TASK[taskType];
}

export function supportingSkillsForClassification(classification, primary = deliveryPrimaryForTask(classification?.taskType)) {
  const concerns = new Set(classification?.crossCuttingConcerns || []);
  const profiles = new Set(classification?.workloadProfiles || []);
  const packs = new Set(classification?.domainPacks || []);
  const candidates = [];
  if (classification?.ai?.workloadDetected) candidates.push("valdris-genai-assurance");
  if (
    ["identity-access-governance", "privacy-data-governance", "financial-transaction-integrity", "regulated-decision-governance", "multi-tenant-isolation"].some((id) => concerns.has(id))
    || ["regulated", "saas", "payments"].some((id) => profiles.has(id))
    || ["saas", "digital-commerce", "youth-ai-safety"].some((id) => packs.has(id))
  ) candidates.push("valdris-security-audit");
  if (
    ["async-workflow-orchestration", "realtime-state-coordination", "production-release-governance"].some((id) => concerns.has(id))
    || ["mobile", "realtime"].some((id) => profiles.has(id))
    || ["mobile-ios", "multiplayer-realtime"].some((id) => packs.has(id))
  ) candidates.push("valdris-platform-release");
  if (["async-workflow-orchestration", "realtime-state-coordination"].some((id) => concerns.has(id))) candidates.push("valdris-architecture-refactor");
  return unique(candidates).filter((name) => name !== primary).slice(0, 4);
}

export function executionBudgetForClassification(classification) {
  if (classification?.taskType === "docs-only" && !classification?.controlledDocumentation) return { attempts: 6, toolCalls: 120, tokens: 180000, costUsd: 25, wallClockMinutes: 240 };
  if (classification?.taskType === "docs-only") return { attempts: 10, toolCalls: 250, tokens: 500000, costUsd: 100, wallClockMinutes: 1440 };
  if (["ambiguous", "audit", "proof-handoff"].includes(classification?.taskType)) return { attempts: 10, toolCalls: 400, tokens: 600000, costUsd: 150, wallClockMinutes: 1440 };
  if (["bug", "security", "incident"].includes(classification?.taskType)) return { attempts: 14, toolCalls: 700, tokens: 1200000, costUsd: 400, wallClockMinutes: 2880 };
  if (classification?.effectiveTier === "T3") return { attempts: 24, toolCalls: 1200, tokens: 2500000, costUsd: 1000, wallClockMinutes: 10080 };
  if (classification?.effectiveTier === "T2") return { attempts: 20, toolCalls: 1000, tokens: 2000000, costUsd: 750, wallClockMinutes: 10080 };
  return { attempts: 14, toolCalls: 700, tokens: 1200000, costUsd: 400, wallClockMinutes: 4320 };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values)];
}

function hasAiSignal(request) {
  return /\b(ai|llms?|rag|prompts?|embeddings?|agents?|agentic|generative|machine learning|neural network|computer vision|speech model|dungeon master|langgraph|gpt(?:-[a-z0-9.]+)?|claude|openai|anthropic|gemini|vertex ai|bedrock|hugging face|llama|mistral|cohere|chatbots?|copilots?|vector search|vector (?:database|db)|semantic search|retrieval[- ]augmented generation|inference|fine[- ]?tun(?:e|ed|ing)|function calling|tool calling|mcp|language models?|foundation models?|model (?:provider|inference|safety|evaluation))\b/i.test(request);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function triggerMatches(text, trigger) {
  const source = normalized(text).toLowerCase();
  const candidate = normalized(trigger).toLowerCase();
  if (!source || !candidate) return false;
  if (/^[a-z0-9]+$/i.test(candidate)) return new RegExp(`\\b${escapeRegExp(candidate)}(?:s|es)?\\b`, "i").test(source);
  return source.includes(candidate);
}

export function classifyTaskIntent(request) {
  const compact = request.trim().replace(/\s+/g, " ");
  const reviewIntent = /\b(audit|review|assess(?:ment)?)\b/i.test(request);
  const changeIntent = /\b(fix|repair|remediat(?:e|ed|ion)|implement|build|add|change|update|refactor|migrat(?:e|ed|ing|ion)|redesign|apply)\b/i.test(request);
  const docsArtifact = /\b(document(?:ation)?|docs?|readme|release notes?|changelog|copy edit)\b/i.test(request);
  if (/^(?:please\s+)?(?:make|improve|change|update|fix|review|audit)\s+(?:it|this|that|things?|something)(?:\s+better)?[.!?]*$/i.test(compact) || /^(?:please\s+)?help(?:\s+me)?[.!?]*$/i.test(compact)) return "ambiguous";
  if (docsArtifact && !/\b(implement|build|fix|repair|deploy|runtime behavior|code change|source change)\b/i.test(request)) return "docs-only";
  if (/\b(ready to merge|merge readiness|handoff|close (?:the )?issue|release ready|final (?:proof|verification)|verify (?:this|it) is ready)\b/i.test(request)) return "proof-handoff";
  if (/\b(incident|outage|sev[- ]?[0-9]+)\b/i.test(request)) return "incident";
  if (/\b(security|vulnerab(?:le|ility|ilities)?|auth|permissions?|rls|tenant|secrets?|compliance|privacy|prompt[- ]injection)\b/i.test(request) && /\b(audit|review|assess(?:ment)?|test|verify|remediat(?:e|ed|ion)|fix|repair|defenses?)\b/i.test(request)) return "security";
  if (/\b(bug|broken|regression|failing|fails?|fix|repair|resolve|debug|troubleshoot|issue with|problem with|does not|doesn't|timeout|crash(?:es|ed|ing)?|errors?|exceptions?|memory leak|not working|incorrect|double[- ]charg(?:e[sd]?|ing)?|duplicate[- ]charg(?:e[sd]?|ing)?|root cause)\b/i.test(request)) return "bug";
  if (/\b(?:manual(?:ly)?|direct(?:ly)?)\b.*\b(?:production\s+data|customer\s+data|database\s+(?:data|record)|provider\s+config(?:uration)?)\b/i.test(request)) return "platform-release";
  if (/\b(architect(?:ure|ural)?|refactor(?:ing)?|migrat(?:e|ed|ing|ion)|redesign|module boundar(?:y|ies))\b/i.test(request) && (!reviewIntent || changeIntent)) return "architecture-refactor";
  if (/\b(testflight|app store|ship|publish|promote)\b/i.test(request) && !/\b(build|create|develop)\s+(a|an|the|new)\b/i.test(request)) return "platform-release";
  if (/\b(deploy|release|rollback|cloud|infrastructure|slo|failover|backup)\b/i.test(request) && !/\b(build|feature|add|implement|game|app)\b/i.test(request)) return "platform-release";
  if (hasAiSignal(request) && (/\b(audit|review|assess(?:ment)?|test|verify|evaluat(?:e|ion)|safety|quality|governance)\b/i.test(request) || !/\b(build|feature|add|implement|integrat(?:e|ion)|game|app)\b/i.test(request))) return "genai";
  if (/\b(documentation|docs[- ]only|readme only|copy edit)\b/i.test(request) && !/\b(code|runtime|behavior|implement|build|fix)\b/i.test(request)) return "docs-only";
  if (/\b(audit|review|assess)\b/i.test(request)) return "audit";
  return "feature";
}

function isControlledAssuranceDocumentation(request) {
  const controlledArtifact = /\b(policy|policies|runbook|playbook|model card|system card|threat model|risk assessment|control(?:s| catalogue| catalog)?|compliance evidence|audit evidence|data retention|rollback procedure|incident response|reconciliation procedure|security standard|privacy notice|data processing agreement)\b/i.test(request);
  const governedSubject = /\b(security|privacy|compliance|regulated|regulatory|hipaa|pci|sox|gdpr|ferpa|coppa|patient|medical|health|phi|pii|payment|billing|refund|reconciliation|rollback|incident|outage|prompt injection|ai safety|model risk|credit|loan|lending|hiring|insurance|underwriting|youth|children|minors?)\b/i.test(request);
  return controlledArtifact && governedSubject;
}

export function classifyAiWorkload(request) {
  const workloadDetected = hasAiSignal(request);
  const features = {
    rag: workloadDetected && /\b(rag|retriev|retrieval[- ]augmented generation|knowledge base|lore corpus|embeddings?|vector search|vector (?:database|db)|semantic search)\b/i.test(request),
    tools: workloadDetected && /\b(agent|tools?|function calling|tool calling|mcp|action|purchase|billing|dungeon master|state[- ]chang|workflow|orchestrat)\b/i.test(request),
    memory: workloadDetected && /\b(memory|remember|campaign|cloud save|player state|dungeon master)\b/i.test(request),
    consequential: workloadDetected && /\b(purchases?|billing|payments?|entitlements?|state[- ]chang(?:e|es|ed|ing)|account actions?|regulated|high[- ]impact|approv(?:e|es|ed|ing|al)|den(?:y|ies|ied|ying)|credit|lending|loans?|hiring|employment|medical|health|legal|insurance|housing|education decisions?)\b/i.test(request),
    userFacing: workloadDetected && /\b(user|player|customer|game|app|chat|assistant)\b/i.test(request),
    sensitiveData: workloadDetected && /\b(account|personal data|private|customer data|player data|sensitive data|pii|phi|medical records?|health records?|financial data|credentials?|biometric|regulated)\b/i.test(request),
    autonomous: workloadDetected && /\b(autonom(?:ous|ously|y)|unsupervised|without human review|take actions?|invoke tools?|execute actions?|self[- ]direct(?:ed)?)\b/i.test(request),
  };
  const aiProfile = !workloadDetected ? "AI-0" : features.consequential || features.sensitiveData || features.autonomous ? "AI-3" : Object.values(features).some(Boolean) ? "AI-2" : "AI-1";
  return { workloadDetected, aiProfile, features };
}

function tierMap(taxonomy) {
  return new Map((taxonomy?.assuranceTiers || []).map((tier) => [tier.id, tier]));
}

function effectiveTier(requestedProfile, profiles, taxonomy, additionalFloors = []) {
  const tiers = tierMap(taxonomy);
  let selected = tiers.get(MATURITY_PROFILE_FLOORS[requestedProfile]);
  for (const minimumTier of [...profiles.map((profile) => profile.minimumTier), ...additionalFloors]) {
    const floor = tiers.get(minimumTier);
    if (floor && (!selected || floor.rank > selected.rank)) selected = floor;
  }
  return selected?.id || MATURITY_PROFILE_FLOORS[requestedProfile];
}

function primaryArchetype(request, domainPacks, ai, taskType) {
  if (domainPacks.includes("mobile-ios") || /\b(android|native mobile|mobile app|mobile application)\b/i.test(request)) return "mobile-native";
  if (domainPacks.includes("multiplayer-realtime") || /\bgame\b/i.test(request)) return "game-realtime";
  if (taskType === "platform-release") return "platform-infrastructure";
  if (/\b(library|sdk|cli|command line|package)\b/i.test(request)) return "library-cli";
  if (/\b(api|service|backend)\b/i.test(request) && !/\b(frontend|web app|mobile|game)\b/i.test(request)) return "api-service";
  if (ai.workloadDetected && !/\b(app|website|game|mobile|frontend)\b/i.test(request)) return "ai-agent-system";
  return "web-full-stack";
}

function selectedDomainPacks(request, domainIndex) {
  const selected = [];
  for (const pack of domainIndex?.packs || []) {
    if ((pack.triggers || []).some((trigger) => triggerMatches(request, trigger))) selected.push(pack.id);
  }
  if (/\b(child|children|minor|teen|youth)\b/i.test(request) && !selected.includes("youth-ai-safety")) selected.push("youth-ai-safety");
  return unique(selected);
}

function selectedWorkloadProfiles(request, requestedProfile, ai, domainPacks, taxonomy) {
  return (taxonomy?.workloadProfiles || []).filter((profile) => {
    if (profile.requiresAi) return ai.workloadDetected;
    if (profile.id === "regulated" && requestedProfile === "regulated") return true;
    if ((profile.domainPacks || []).some((pack) => domainPacks.includes(pack))) return true;
    return (profile.triggers || []).some((trigger) => triggerMatches(request, trigger));
  });
}

const PROFILE_ACTIVATED_DOMAIN_PACKS = Object.freeze({
  saas: ["saas"],
  payments: ["digital-commerce"],
});

function selectedConcerns(request, taxonomy, ai) {
  return (taxonomy?.crossCuttingConcerns || []).filter((concern) => {
    if (concern.id === "generative-ai-governance") return ai.workloadDetected;
    return (concern.triggers || []).some((trigger) => triggerMatches(request, trigger));
  });
}

export function isFullStackRequest(request) {
  if (/\b(library|sdk|cli|command line|package)\b/i.test(request) && !/\b(web app|website|mobile app|mobile application|ios app|android app|game|user interface|frontend)\b/i.test(request)) return false;
  if (/\b(full[- ]stack|saas|multi[- ]tenant application)\b/i.test(request)) return true;
  const client = /\b(frontend|front-end|web app|website|mobile app|mobile application|ios app|iphone app|ipad app|game|ui|user interface)\b/i.test(request);
  const serverOrState = /\b(backend|back-end|api|server|service|database|storage|cloud saves?|multiplayer|matchmaking|accounts?|purchases?|billing|payments?|authoritative state)\b/i.test(request);
  return client && serverOrState;
}

export function requiresLiveSmoke(request) {
  return /\b(ship|deploy|release|testflight|app store|production)\b/i.test(request)
    || /\b(provider integration|integrat(?:e|es|ed|ing|ion) (?:an? )?(?:external |model |payment |identity |cloud )?provider|live provider|commissioned provider behavior|provider config(?:uration)?|manual(?:ly)? (?:change|edit|update|mutate) (?:customer |production )?(?:data|database records?))\b/i.test(request);
}

const DIRECT_LAYER_SIGNALS = Object.freeze({
  frontend: /\b(frontend|front-end|ui|user interface|react|next\.?js|vue|angular|swiftui|component|website|static site|landing page|mobile|ios|iphone|ipad)\b/i,
  "backend-api-logic": /\b(backend|back-end|api|endpoint|server|service|business logic|graphql|rest)\b/i,
  "database-storage": /\b(database|db|sql|schema|migration|storage|postgres|mysql|sqlite|dynamodb|supabase)\b/i,
  "auth-permissions-rls": /\b(auth|authentication|authorization|oauth|oidc|saml|jwt|login|sign[- ]?in|session|mfa|passkey|api key|permissions?|roles?|rbac|sso|scim|rls|row[- ]level security)\b/i,
  "hosting-deployment": /\b(hosting|host|deployment|deploy|release|publish|promotion|testflight|app store)\b/i,
  "cloud-compute": /\b(cloud|aws|azure|gcp|vercel|lambda|serverless|compute|containers?|kubernetes|k8s|ecs|cloud run)\b/i,
  "cicd-version-control": /\b(ci\/?cd|continuous integration|continuous delivery|github actions|pipeline|version control|git|branch|pull request|merge)\b/i,
  security: /\b(security|vulnerabilit(?:y|ies)|threat|secrets?|encryption|supply chain|prompt injection|privacy)\b/i,
  "rate-limiting": /\b(rate limit(?:s|ing|ed)?|throttl(?:e|es|ed|ing)|quotas?|backpressure|abuse prevention|concurrency limit(?:s|ing|ed)?)\b/i,
  "caching-cdn": /\b(cache|caching|cdn|content delivery network|invalidation)\b/i,
  "load-balancing-scaling": /\b(load balanc(?:e|er|ers|ing|ed)|autoscal(?:e|es|ed|ing)|scaling|capacity|horizontal scale|traffic split)\b/i,
  "error-tracking-logs-observability": /\b(observability|telemetry|log(?:s|ging|ged)?|traces?|metrics?|monitoring|error tracking|alerts?|slo|error budget)\b/i,
  "availability-recovery-dr": /\b(availability|backup|restore|recovery|disaster recovery|failover|incident|outage|rto|rpo|rollback)\b/i,
});

function directLayersForRequest(request) {
  return Object.entries(DIRECT_LAYER_SIGNALS).filter(([, pattern]) => pattern.test(request)).map(([layer]) => layer);
}

function selectedDomainFeatures(request, domainPacks) {
  const features = {};
  if (domainPacks.includes("mobile-ios")) {
    features["mobile-ios"] = {
      push: /\b(push notifications?|notifications?|apns)\b/i.test(request),
      distribution: /\b(testflight|app store|ship|publish|promote|distribution|release)\b/i.test(request),
    };
  }
  return features;
}

function dependencyClosedLayers(initialLayers, productionCatalog) {
  const required = new Set(initialLayers);
  const definitions = new Map((productionCatalog?.layers || []).map((layer) => [layer.layer, layer]));
  const visited = new Set();
  const visit = (layer) => {
    if (visited.has(layer)) return;
    visited.add(layer);
    for (const dependency of definitions.get(layer)?.dependencies || []) {
      if (!required.has(dependency)) required.add(dependency);
      visit(dependency);
    }
  };
  for (const layer of [...required]) visit(layer);
  return required;
}

export function classifyWorkload(input) {
  const {
    runId,
    generatedAt,
    requestText,
    requestSha256 = sha256(requestText),
    requestedProfile,
    environment,
    commit,
    taxonomy,
    domainIndex,
    productionLayers,
    productionCatalog,
    catalogDigests,
  } = input;
  const taskType = classifyTaskIntent(requestText);
  const isDocsOnly = taskType === "docs-only";
  const controlledDocumentation = isDocsOnly && isControlledAssuranceDocumentation(requestText);
  const assuranceRelevant = !isDocsOnly || controlledDocumentation;
  const detectedAi = classifyAiWorkload(requestText);
  const ai = assuranceRelevant ? detectedAi : { workloadDetected: false, aiProfile: "AI-0", features: Object.fromEntries(AI_FEATURES.map((feature) => [feature, false])) };
  let domainPacks = assuranceRelevant ? selectedDomainPacks(requestText, domainIndex) : [];
  let profileDefinitions = [];
  if (assuranceRelevant) {
    for (let pass = 0; pass <= (taxonomy?.workloadProfiles || []).length; pass += 1) {
      profileDefinitions = selectedWorkloadProfiles(requestText, requestedProfile, ai, domainPacks, taxonomy);
      const expanded = unique([...domainPacks, ...profileDefinitions.flatMap((profile) => PROFILE_ACTIVATED_DOMAIN_PACKS[profile.id] || [])]);
      if (expanded.length === domainPacks.length) break;
      domainPacks = expanded;
    }
  }
  const concernDefinitions = assuranceRelevant ? selectedConcerns(requestText, taxonomy, ai) : [];
  const workloadProfiles = profileDefinitions.map((profile) => profile.id);
  const domainFeatures = selectedDomainFeatures(requestText, domainPacks);
  const crossCuttingConcerns = concernDefinitions.map((concern) => concern.id);
  const concernLayers = concernDefinitions.flatMap((concern) => concern.productionLayers || []);
  const directLayers = directLayersForRequest(requestText);
  const isFullStack = isFullStackRequest(requestText);
  const initialRequired = isFullStack ? productionLayers : [...directLayers, ...concernLayers, "security", "cicd-version-control", "error-tracking-logs-observability"];
  const requiredByConcern = isDocsOnly ? new Set() : dependencyClosedLayers(initialRequired, productionCatalog);
  const initialProductionLayers = productionLayers.map((layer) => {
    if (isDocsOnly) return { layer, initialApplicability: "not-applicable", reason: "Docs-only route; reconsider if implementation or runtime behavior enters scope." };
    if (isFullStack || requiredByConcern.has(layer)) return { layer, initialApplicability: "required" };
    return { layer, initialApplicability: "potentially-affected" };
  });
  const requiredGates = {
    "code-intelligence": !isDocsOnly,
    foundation: !isDocsOnly || controlledDocumentation,
    production: !isDocsOnly,
    "ai-assurance": !isDocsOnly && ai.workloadDetected,
    "domain-assurance": !isDocsOnly && domainPacks.length > 0,
    eval: !isDocsOnly && (ai.workloadDetected || /\b(eval(?:uation)?|benchmark|quality threshold|accuracy|precision|recall|pass rate)\b/i.test(requestText)),
    trajectory: true,
    smoke: !isDocsOnly && requiresLiveSmoke(requestText),
  };
  const matchedSignals = unique([
    taskType,
    ...workloadProfiles.map((id) => `profile:${id}`),
    ...crossCuttingConcerns.map((id) => `concern:${id}`),
    ...domainPacks.map((id) => `domain-pack:${id}`),
    ...(controlledDocumentation ? ["docs:controlled-assurance"] : isDocsOnly ? ["docs:ordinary"] : []),
    ai.workloadDetected ? `ai:${ai.aiProfile}` : "ai:none",
  ]);
  const unknowns = [];
  const materialUnknowns = [];
  if (taskType === "ambiguous") {
    const summary = "The requested outcome, affected artifact, and authorized change scope require accountable human clarification before delivery begins.";
    unknowns.push(summary);
    materialUnknowns.push({ id: "scope-definition", resolution: "human-acknowledgement", summary });
  }
  if (!workloadProfiles.length && !isDocsOnly) unknowns.push("No specialized workload profile matched; keep potentially affected production domains open until route review.");
  if (profileDefinitions.some((profile) => profile.id === "regulated") || (!isDocsOnly && requestedProfile === "regulated")) {
    const summary = "Regulatory applicability requires human/legal confirmation; classification only raises assurance and never certifies compliance.";
    unknowns.push(summary);
    materialUnknowns.push({ id: "regulatory-applicability", resolution: "human-acknowledgement", summary });
  }
  if (domainPacks.includes("youth-ai-safety")) {
    const summary = "Youth, age-rating, privacy, consent, and child-safety applicability requires confirmation by the accountable human owner.";
    unknowns.push(summary);
    materialUnknowns.push({ id: "youth-safety-applicability", resolution: "human-acknowledgement", summary });
  }
  if (controlledDocumentation) {
    const summary = "A controlled assurance document changes governed expectations and requires accountable human/domain-owner review even when runtime behavior is unchanged.";
    unknowns.push(summary);
    materialUnknowns.push({ id: "controlled-assurance-document-review", resolution: "human-acknowledgement", summary });
  }
  return {
    schema: WORKLOAD_CLASSIFICATION_SCHEMA,
    generatedAt,
    runId,
    requestSha256,
    profile: requestedProfile,
    requestedProfile,
    profileTierFloor: MATURITY_PROFILE_FLOORS[requestedProfile],
    effectiveTier: effectiveTier(requestedProfile, profileDefinitions, taxonomy, ai.aiProfile === "AI-3" ? ["T3"] : []),
    environment,
    commit,
    taskType,
    controlledDocumentation,
    primaryArchetype: primaryArchetype(requestText, domainPacks, ai, taskType),
    workloadProfiles,
    crossCuttingConcerns,
    domainPacks,
    domainFeatures,
    ai,
    foundation: {
      initialApplicability: isDocsOnly && !controlledDocumentation ? "not-applicable" : "required",
      ...(isDocsOnly && !controlledDocumentation ? { reason: "Ordinary docs-only route has no governed product, requirements, architecture, or engineering-strategy change." } : {}),
    },
    productionLayers: initialProductionLayers,
    requiredGates,
    matchedSignals,
    confidence: unknowns.length ? "medium" : "high",
    unknowns,
    materialUnknowns,
    catalogDigests,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateWorkloadTaxonomy(taxonomy, options = {}) {
  const { productionLayers = [], productionControlIds = [], aiControlIds = [], domainPackIds = [] } = options;
  const problems = [];
  if (taxonomy?.schema !== WORKLOAD_TAXONOMY_SCHEMA) problems.push(`workload taxonomy schema must be ${WORKLOAD_TAXONOMY_SCHEMA}`);
  if (sha256(JSON.stringify(taxonomy)) !== CANONICAL_WORKLOAD_TAXONOMY_SHA256) problems.push("workload taxonomy does not match the locked canonical v1 policy; change the catalog and validator together under a reviewed version update");
  const tiers = Array.isArray(taxonomy?.assuranceTiers) ? taxonomy.assuranceTiers : [];
  const tierIds = new Set();
  const ranks = new Set();
  for (const tier of tiers) {
    if (!normalized(tier?.id) || !Number.isInteger(tier?.rank) || !normalized(tier?.label) || !["automated-local", "ci-attested", "provider-attested"].includes(tier?.minimumTechnicalTrust) || typeof tier?.externalAttestationRequired !== "boolean") problems.push("workload taxonomy has an invalid assurance tier");
    if (tierIds.has(tier?.id)) problems.push(`workload taxonomy assurance tier duplicated: ${tier?.id}`);
    if (ranks.has(tier?.rank)) problems.push(`workload taxonomy assurance tier rank duplicated: ${tier?.rank}`);
    tierIds.add(tier?.id);
    ranks.add(tier?.rank);
  }
  for (const required of ["T0", "T1", "T2", "T3"]) if (!tierIds.has(required)) problems.push(`workload taxonomy missing assurance tier: ${required}`);
  const profileIds = new Set();
  for (const profile of taxonomy?.workloadProfiles || []) {
    if (!normalized(profile?.id) || !normalized(profile?.title) || !tierIds.has(profile?.minimumTier)) problems.push(`workload taxonomy has an invalid workload profile: ${profile?.id || "missing"}`);
    if (profileIds.has(profile?.id)) problems.push(`workload taxonomy workload profile duplicated: ${profile?.id}`);
    profileIds.add(profile?.id);
    if (!Array.isArray(profile?.triggers) || !Array.isArray(profile?.domainPacks) || typeof profile?.requiresAi !== "boolean") problems.push(`workload taxonomy profile ${profile?.id || "missing"} has invalid selectors`);
    for (const pack of profile?.domainPacks || []) if (domainPackIds.length && !domainPackIds.includes(pack)) problems.push(`workload taxonomy profile ${profile.id} references unknown domain pack: ${pack}`);
  }
  const concernIds = new Set();
  for (const concern of taxonomy?.crossCuttingConcerns || []) {
    if (!normalized(concern?.id) || !normalized(concern?.title) || !Array.isArray(concern?.triggers)) problems.push(`workload taxonomy has an invalid cross-cutting concern: ${concern?.id || "missing"}`);
    if (concernIds.has(concern?.id)) problems.push(`workload taxonomy concern duplicated: ${concern?.id}`);
    concernIds.add(concern?.id);
    for (const layer of concern?.productionLayers || []) if (productionLayers.length && !productionLayers.includes(layer)) problems.push(`workload taxonomy concern ${concern.id} references unknown production layer: ${layer}`);
    for (const control of concern?.controlIds || []) if (productionControlIds.length && !productionControlIds.includes(control)) problems.push(`workload taxonomy concern ${concern.id} references unknown production control: ${control}`);
    for (const control of concern?.aiControlIds || []) if (aiControlIds.length && !aiControlIds.includes(control)) problems.push(`workload taxonomy concern ${concern.id} references unknown AI control: ${control}`);
  }
  const evidenceTypes = taxonomy?.proofAxis?.evidenceTypes;
  const binding = taxonomy?.proofAxis?.binding;
  if (!Array.isArray(evidenceTypes) || !["artifact", "command", "metric", "approval", "provider-report"].every((type) => evidenceTypes.includes(type))) problems.push("workload taxonomy proofAxis must declare all typed evidence types");
  if (!Array.isArray(binding) || !["subject", "runId", "profile", "commit", "environment", "producer", "trustTier", "timestamp"].every((field) => binding.includes(field))) problems.push("workload taxonomy proofAxis binding is incomplete");
  return problems;
}

export function validateWorkloadClassification(document, options = {}) {
  const { intake, taxonomy, domainIndex, productionLayers, productionCatalog, expectedCatalogDigests } = options;
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) return ["workload classification must be a JSON object"];
  if (document.schema !== WORKLOAD_CLASSIFICATION_SCHEMA) problems.push(`workload classification schema must be ${WORKLOAD_CLASSIFICATION_SCHEMA}`);
  if (!normalized(document.runId)) problems.push("workload classification runId is required");
  if (Number.isNaN(Date.parse(document.generatedAt))) problems.push("workload classification generatedAt must be an ISO timestamp");
  if (!TASK_TYPES.has(document.taskType)) problems.push("workload classification taskType is invalid");
  if (intake?.runId !== document.runId) problems.push("workload classification runId must match intake runId");
  if (intake?.requestSha256 !== document.requestSha256) problems.push("workload classification requestSha256 must match intake requestSha256");
  const intakeProfile = intake?.requestedProfile || intake?.profile;
  if (intakeProfile !== document.requestedProfile || intake?.profile !== document.profile) problems.push("workload classification profile must match the authorized intake profile");
  if (intake?.commit !== document.commit) problems.push("workload classification commit must match intake commit");
  if (intake?.environment !== document.environment) problems.push("workload classification environment must match intake environment");
  const tiers = tierMap(taxonomy);
  if (!Object.hasOwn(MATURITY_PROFILE_FLOORS, document.requestedProfile) || !tiers.has(document.effectiveTier)) problems.push("workload classification profile or assurance tier is invalid");
  if (document.profile !== document.requestedProfile) problems.push("workload classification profile must match requestedProfile");
  if (document.profileTierFloor !== MATURITY_PROFILE_FLOORS[document.requestedProfile]) problems.push("workload classification profileTierFloor does not match requestedProfile");
  const requestedFloor = tiers.get(MATURITY_PROFILE_FLOORS[document.requestedProfile]);
  if (requestedFloor && tiers.has(document.effectiveTier) && tiers.get(document.effectiveTier).rank < requestedFloor.rank) problems.push("workload classification effectiveTier cannot downgrade the requested maturity profile");
  for (const field of ["workloadProfiles", "crossCuttingConcerns", "domainPacks", "productionLayers", "matchedSignals", "unknowns"]) if (!Array.isArray(document[field])) problems.push(`workload classification ${field} must be an array`);
  for (const field of ["workloadProfiles", "crossCuttingConcerns", "domainPacks"]) if (new Set(document[field] || []).size !== (document[field] || []).length) problems.push(`workload classification ${field} contains duplicates`);
  for (const feature of AI_FEATURES) if (typeof document.ai?.features?.[feature] !== "boolean") problems.push(`workload classification ai.features.${feature} must be boolean`);
  if (typeof document.ai?.workloadDetected !== "boolean" || !normalized(document.ai?.aiProfile)) problems.push("workload classification AI projection is invalid");
  for (const [key, value] of Object.entries(expectedCatalogDigests || {})) if (document.catalogDigests?.[key] !== value) problems.push(`workload classification catalog digest mismatch: ${key}`);
  if (intake && taxonomy && domainIndex && productionLayers) {
    const expected = classifyWorkload({
      runId: document.runId,
      generatedAt: document.generatedAt,
      requestText: intake.requestText,
      requestSha256: intake.requestSha256,
      requestedProfile: document.requestedProfile,
      environment: document.environment,
      commit: document.commit,
      taxonomy,
      domainIndex,
      productionLayers,
      productionCatalog,
      catalogDigests: expectedCatalogDigests,
    });
    for (const field of ["profileTierFloor", "effectiveTier", "taskType", "controlledDocumentation", "primaryArchetype", "workloadProfiles", "crossCuttingConcerns", "domainPacks", "domainFeatures", "ai", "foundation", "productionLayers", "requiredGates", "matchedSignals", "confidence", "unknowns", "materialUnknowns"]) {
      if (!sameJson(document[field], expected[field])) problems.push(`workload classification ${field} does not match deterministic classification`);
    }
  }
  return problems;
}
