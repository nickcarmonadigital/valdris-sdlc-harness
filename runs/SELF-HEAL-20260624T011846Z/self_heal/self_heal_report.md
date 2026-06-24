# Self-Heal Report

## Gap detected

The harness audit found permissive bridge validation, claim-based proof, Red Zone bypass, self-heal completion bypass, symlink/path artifact proof bypass, stale connector docs, and non-self-contained generated packs.

## Fix implemented

- Bridge contract upgraded to `uash.connector-events.v0.3`.
- Events now require strict fields: `type`, `actor`, `message`, `status`, `runMode`, `eventSource`, `nodeId`.
- Invalid event types, actors, statuses, modes, sources, and node IDs are rejected.
- `artifact.written` now requires `artifactRoot` and verifies the real file.
- Finish-line requires verified required artifacts or explicit skip reasons.
- Artifact symlinks/path escapes are rejected.
- `POST /runs` cannot create completed runs or inject artifact truth.
- Red Zone approval grants/denials require human actor and an existing pending approval.
- `self_heal.detected` requires later `self_heal.pr_opened` or `self_heal.pr_proposed`.
- Commissioned packs now include the emitter and safer generated guidance.

## Review result

Independent second-pass reviews passed after follow-up doc/generated-pack fixes.
