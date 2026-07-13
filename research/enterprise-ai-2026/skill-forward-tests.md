# Valdris Skill Forward Tests

Date: 2026-07-12

Two fresh-agent cold-start scenarios tested whether `skills/registry.json` and the eight `SKILL.md` files produced a safe, specific route without access to the implementation plan.

## Scenario 1: payment regression

Prompt: checkout began double-charging some customers after a deployment; diagnose and fix without production-data access or deployment.

Cold route:

- Primary: `valdris-bug-rca`.
- Supporting: `valdris-platform-release`, `valdris-proof-handoff`; security becomes conditional on auth/tenant/webhook/secret evidence.
- Required boundaries: local/synthetic reproduction, no production data/log payload, no charge/refund/void/reconciliation, no containment/rollback/deploy, no provider config, and no customer communication.
- Business invariant: one logical checkout produces at most one provider charge across concurrency and retries.

Defects found and corrected:

- payment/reconciliation/customer-communication Red Zones were incomplete;
- production instrumentation needed an explicit approval boundary;
- intake needed a `potentially-affected` layer state;
- eval, smoke, AI, and domain gates needed conditional applicability;
- code repair, incident containment, financial reconciliation, and communication needed separate authority lanes.

## Scenario 2: full-stack iOS AI game

Prompt: build a multiplayer iOS game with an AI dungeon master, accounts, purchases, cloud saves, matchmaking, and TestFlight delivery.

Cold route:

- Intake primary first, feature-delivery primary after route acceptance, proof-handoff primary at completion.
- Supporting: GenAI assurance, security audit, platform/release.
- All thirteen layers began required or potentially affected.
- AI-3 was selected for consequential tool-bearing behavior.
- Domain packs: mobile iOS, multiplayer realtime, digital commerce, and youth AI safety when minors are in the intended audience.
- Xcode/signing/TestFlight evidence remained blocked on an approved macOS runner and human Apple authority.

Defects found and corrected:

- no phase-transition or deterministic tie-break model;
- no automatic iOS/realtime/commerce/youth domain activation;
- no Apple-specific commissioning or repo detection;
- mobile distribution was conflated with backend deployment;
- missing TestFlight and Apple-credential Red Zones;
- no host-capability fallback rule;
- no conditional APNs/RAG/tool/memory applicability;
- generated skills were not installed in `.agents/skills` and `.claude/skills`.

## Result

The corrected router now validates intake/route digests, three skill phases, catalog/registry hashes, all thirteen initial layer classifications, AI profile/features, trigger-driven domain packs, conditional gates, authority boundaries, rejected alternatives, and Red Zones. The iOS example at `examples/ios-ai-game/` preserves the cold-test goal and route as a non-proof blueprint.

## Independent finish-line adversarial review

Three additional read-only agents attempted to bypass the completed implementation. Their confirmed reproductions drove these corrections:

- proof and handoff became non-skippable bridge invariants;
- code-intelligence and live-smoke joined the route-conditional aggregate finish line;
- production applicability can no longer contradict required routed layers;
- the goal pins the authorized intake request and initial route digests, and live completion requires token-gated human approval bound to the current route file digest;
- nested adapters auto-load even when `--adapter-path` is omitted;
- failed/cancelled/blocked goals cannot pass the generated active-goal CI branch;
- output overwrite and `--force` are limited to recognized generated packs outside the target/ancestor boundary;
- iOS discovery traverses deep monorepos while excluding generated/vendor directories and symlinks;
- native iOS build/distribution controls require macOS Xcode command evidence, external CI/Apple provider receipts, exact release approval scopes, and bridge-event correlation;
- TestFlight smoke requires trusted evidence bound to the exact target identifier;
- verifier timestamps are generated at runtime, so the golden path does not expire after 72 hours;
- equivalent AI feature objects no longer fail because of JSON key order;
- non-AI iOS requests validate as AI-0 rather than matching the derived phrase `non-AI workload`.

The final enterprise verifier exercises 11 always-selected positive gates, conditionally adds code-intelligence and smoke, and rejects 23 mutation-specific adversarial cases. Provider/CI trust metadata is still not a cryptographic identity by itself; release claims require imported protected-CI/provider receipts or signed attestations, and the documentation states that boundary explicitly.
