# Full-Stack iOS AI Game Commissioning Example

This is a blueprint, not a claim that an iOS game has already been built or shipped. It demonstrates the exact route Valdris should create for a request such as:

> Build a multiplayer iOS game with an AI dungeon master, accounts, purchases, cloud saves, matchmaking, and ship it to TestFlight.

## Commission a target repository

From the Valdris repo:

```bash
npm run commission -- --repo /path/to/game-repo --project-name "Full Stack iOS AI Game" --out /path/to/game-repo/.valdris-harness --yes
```

`--yes` is a structural bootstrap only. Before implementation, replace every generic or "commissioned owner must provide" default in `project-adapter.json` with real product, Xcode scheme, Apple team, macOS runner, signing owner, TestFlight owner, validation, authority, and evidence facts. Prefer interactive commissioning or a reviewed `--answers` file for an actual build.

Then copy the blueprint decisions from `route-blueprint.json` and `goal-blueprint.json` into the target run packet, replacing assumptions with commissioned product facts.

Or generate the executable starting artifacts directly from the target root:

```bash
node .valdris-harness/scripts/route-request.mjs --repo . --profile enterprise --actor "Nick" --request "Build a multiplayer iOS game with an AI dungeon master, accounts, purchases, cloud saves, matchmaking, and ship it to TestFlight."
```

Review the conservative classifications, resolve architecture and authority unknowns, then run the active-start gates before implementation:

```bash
node .valdris-harness/scripts/intake-gate.mjs --repo .
node .valdris-harness/scripts/route-gate.mjs --repo .
node .valdris-harness/scripts/goal-gate.mjs --repo . --allow-active
```

## Skill phases

1. `valdris-intake-route` is primary while architecture-changing unknowns are resolved.
2. `valdris-feature-delivery` becomes primary for vertical delivery.
3. `valdris-proof-handoff` becomes primary at the finish line.

Supporting skills are `valdris-genai-assurance`, `valdris-security-audit`, and `valdris-platform-release`. The four domain packs are mobile iOS, multiplayer realtime, digital commerce, and youth AI safety when the intended audience includes minors.

## First tracer bullet

`authenticate -> create/join match -> one multiplayer turn -> AI narrative -> authoritative state commit -> disconnect/reconnect -> resume`

Build deterministic tests and the first AI eval dataset before expanding into purchases, full matchmaking, recovery, capacity, and release.

## Non-negotiable platform boundary

A Windows agent may author iOS source and complete backend/control-plane work, but it cannot truthfully produce macOS/Xcode, simulator/device, signing, App Store Connect, or TestFlight proof. `IOS-QUALITY-001` requires CI-attested native tests, `IOS-BUILD-001` requires CI-attested `xcodebuild archive` evidence plus an external build receipt, and `IOS-DISTRIBUTION-001` requires an App Store Connect/TestFlight provider report plus scoped human approval. Those artifacts and Apple smoke must share the commissioned scheme, bundle/team reference, adapter digest, and immutable build ID. The stopping conditions remain open until that evidence exists.

For Apple release approval, first emit the matching `approval.requested` event, then predeclare a unique grant event ID, store it as `bridgeEventId` in the `IOS-DISTRIBUTION-001` approval evidence, and grant against the exact domain packet:

```bash
UASH_BRIDGE_URL="$BRIDGE_URL" node .valdris-harness/scripts/uash-emit-event.mjs "$RUN_ID" approval.granted redzone "Human approved this TestFlight build" \
  --event-id "$RELEASE_EVENT_ID" \
  --artifact domain/assurance.json \
  --status ok --actor human \
  --approval-owner "$RELEASE_OWNER" --approval-scope testflight-release \
  --human-token "$UASH_HUMAN_APPROVAL_TOKEN"
```

The bridge hashes `domain/assurance.json` at grant time. Rewriting the build identity or domain packet after approval invalidates completion.
