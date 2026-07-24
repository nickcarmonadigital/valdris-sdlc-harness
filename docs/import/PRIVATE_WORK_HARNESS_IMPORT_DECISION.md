# Private Work Harness Import Decision

Status: accepted boundary for implementation

## Decision

The private work harness is a behavioral input, not a source tree to copy. Valdris may adopt generally useful outcomes only when they are independently implemented, provider-neutral, project-neutral, privacy-safe, and covered by public CLI proof.

The only approved verbatim kernel input is the separately identified MIT-licensed public upstream. Its repository, immutable commit, license, and 26-file digest inventory are recorded in `controls/provenance/thirteen-layers.upstream.v1.json`.

## Enforcement scope and public history

This boundary is enforced against three publishable surfaces: the current canonical tree at the revision being reviewed, release artifacts assembled from that tree, and commissioned packs generated after this contract took effect. Each surface must pass the applicable provenance, neutrality, privacy, and compatibility gates before publication or use.

An ordinary pull request or release does not delete Git objects that were already published. Earlier public commits may therefore retain material that is absent from the current tree. Rewriting or filtering public history, force-updating refs, coordinating downstream clones and forks, and revoking any exposed credentials are separate destructive operations that require explicit repository-owner authorization. The full-history secret scan can detect supported secret patterns in reachable history; it does not purge history. `docs/decisions/ADR-0001-public-history-retention.md` records the owner decision to retain that residual exposure for this non-destructive merge without claiming historical objects were purged.

## Material excluded from Valdris

The following private work harness material must not enter canonical Valdris surfaces:

- organization, product, repository, and internal service identities;
- employee, operator, approver, customer, or other real-person identities;
- internal ticket prefixes, issue numbers, run identifiers, thread identifiers, and account identifiers;
- fixed branch names, promotion chains, environment names, or approval ownership;
- provider-specific lane names or assumptions that a particular tracker, database, cloud, deployment, voice, payment, review, or support provider is mandatory;
- real project adapters, architecture inventories, access findings, weakness registers, deployment runbooks, or copied product workflows;
- personal workstation instructions, home-directory paths, machine names, and editor or device setup;
- active run packets, console output, logs, traces, support transcripts, incident evidence, postmortems, URLs, commits, screenshots, and customer content;
- credentials, tokens, secrets, private endpoints, personal contact data, and non-synthetic identifiers;
- historical procedures whose meaning depends on private teams, systems, or organizational policy; and
- generated graphs, caches, bytecode, build output, or other reproducible machine artifacts.

These exclusions must remain outside the current canonical tree, its release artifacts, and newly generated commissioned packs. They are not retained in those surfaces as comments, fixtures, examples, snapshots, or denylist output. This current-surface rule does not make a claim about pre-existing public commit objects; the history boundary above applies.

## Material that must be parameterized

Reusable concepts from the private work harness must use commissioned values:

| Private assumption class                                                            | Valdris replacement                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Ticket namespace and issue key                                                      | `${tracker}` and `${issue_id}`                          |
| Named operator or approver                                                          | commissioned roles and approval policy                  |
| Fixed branch or environment topology                                                | target-generated branch and promotion model             |
| Fixed data, cloud, deployment, communications, payment, review, or support provider | optional provider adapter selected during commissioning |
| Private product lane                                                                | capability-based generic lane                           |
| Project-specific command, path, or repository                                       | commissioned project adapter value                      |
| Real incident or run packet                                                         | documented synthetic fixture using example identifiers  |

Provider examples may appear in comparative documentation, but executable defaults must not silently select one provider.

## Capabilities eligible for independent implementation

Valdris may independently implement these general behaviors without copying private prose or code:

- resumable, tier-scaled run packets;
- scout, implementer, verifier, and independent-review separation;
- subject-bound proof, timeout policy, repeated execution, and flaky-result detection;
- regression baselines that demonstrate failure before repair;
- executable RCA for bug work (including regressions), incidents, and self-heal corrective work, with bound pre-fix reproduction and post-fix regression proof;
- executable review, migration, packet, and finish-line gates;
- explicit assurance states and governed waiver handling;
- privacy and secret scanning for run artifacts;
- evaluation of whether loaded context improves agent outcomes;
- harness-coherence and controlled self-correction checks; and
- asynchronous workflow state, handoff, replay, observability, and versioning as a cross-cutting concern rather than an additional production layer.

## Enforced import boundary

The import is acceptable only when all of these offline checks pass:

1. `node scripts/provenance-gate.mjs --repo .` verifies the approved public source revision, MIT license, and exact digest inventory.
2. `node scripts/neutrality-gate.mjs --repo .` recursively rejects restricted-source identity and ticket values supplied at import time, without persisting or echoing those values, plus generic fixed-topology and fixed-provider assumptions. Commissioned adapter identities and provider selections remain allowed in commissioned mode.
3. `node scripts/privacy-gate.mjs --repo .` recursively scans this canonical harness root, rejects secrets, local user paths, raw operational evidence, non-example contact data, and non-example identifiers without echoing detected values, and fails closed on binary files unless a shipped public asset matches its approved path and SHA-256. Commissioned products instead scan their `.valdris-harness` pack and use bounded `--include` scopes for generated graph/anchor evidence; arbitrary product binaries are governed by project policy.
4. `node scripts/verify-import-boundaries.mjs` proves passing and adversarial CLI behavior, including recursive discovery and binary-policy rejection, through exit status and JSON output.
5. `npm run verify:release-privacy` proves the deployable-release scanner rejects synthetic credentials, local-user paths, and unsafe binary code while preserving redaction.
6. `npm run privacy:release` scans the built `.next` release artifact after `npm run build`.

No proof means the current-tree, release-artifact, or newly generated pack boundary is not satisfied. Passing these checks does not claim that historical public commits were removed.
