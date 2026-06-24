# Break-it QA Results

## Targeted bypasses tested

- Invalid event/missing fields rejected.
- Missing `message` rejected.
- Direct `POST /runs` completion injection rejected.
- Event-level early `run.completed` rejected.
- `artifact.written` without `artifactRoot` rejected.
- Missing artifact file under `artifactRoot` rejected.
- Symlink/path escape artifact proof rejected.
- Red Zone completion without human grant rejected.
- Agent-emitted `approval.granted` rejected.
- Human grant without pending request rejected.
- `self_heal.detected` followed by skip still blocks completion.
- Positive completion succeeds only with verified files and skip reasons.

## Verdict

PASS for this self-heal loop. Remaining product-grade gaps are out of scope for this one pass: hosted DB, MCP server, adapter-defined custom nodes, and full operator UI wiring.
