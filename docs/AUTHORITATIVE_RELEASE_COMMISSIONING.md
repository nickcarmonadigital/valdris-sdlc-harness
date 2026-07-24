# Authoritative Stable Release Commissioning

Stable Valdris releases are created only by `.github/workflows/authoritative-release.yml`. The workflow is manual and pre-tag: it validates evidence first, then its dedicated GitHub App creates the tag and published release. A tag-push workflow is intentionally insufficient because it can only detect a bad release after the tag exists.

Release candidates remain unchanged. Versions and tags containing a prerelease suffix, such as `0.9.0-rc.1` and `v0.9.0-rc.1`, are not authoritative and are rejected by the stable workflow.

A stable tag must exactly equal `v` plus the `package.json` version read from the candidate's resolved Git `HEAD`, never mutable worktree bytes. The local tag target, candidate `HEAD`, authoritative closure commit, executor `sourceCommit`, and applicable promotion commit must converge on that same commit; the bridge-head receipt must bind the same run and proof closure. A request for `v0.9.0` therefore fails against a committed `0.9.0-rc.1` candidate or evidence from another source revision.

## 1. Commission the authoritative evidence producer

Choose one same-repository workflow that performs the real commissioned authoritative run. Record its immutable GitHub numeric workflow ID and repository-relative path. The producer must:

- run by `workflow_dispatch` from the default branch;
- finish with GitHub status `completed` and conclusion `success`;
- execute the real commissioned OCI executor and rollback-resistant provider adapter rather than verifier fixtures;
- generate a complete authoritative run root;
- bind the authoritative closure and immutable executor to the intended Valdris release commit;
- place that root at `run-root/` in one artifact;
- place `release-source.json` beside `run-root/`; and
- upload exactly one artifact with the commissioned name.

`release-source.json` has this exact shape:

```json
{
  "schema": "valdris.authoritative-release-source.v1",
  "repository": "OWNER/REPOSITORY",
  "workflowRunId": 123456789,
  "workflowRunAttempt": 1,
  "workflowId": 987654,
  "workflowPath": ".github/workflows/authoritative-evidence.yml",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "artifactName": "valdris-authoritative-run",
  "runRoot": "run-root"
}
```

The release consumer queries that run and its artifact directly from the GitHub Actions API. It rejects missing, expired, duplicated, cross-repository, failed, non-manual, wrong-workflow, wrong-branch, or commit-mismatched evidence before downloading anything.

## 2. Protect the `authoritative-release` environment

Create an environment named exactly `authoritative-release` and configure:

- required human reviewers;
- prevention of self-review;
- deployment limited to the default branch;
- no administrator bypass for ordinary release operators; and
- environment secrets and variables unavailable to pull-request jobs.

Create these environment variables:

| Variable                                      | Required value                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `VALDRIS_TRUSTED_AUTHORITATIVE_WORKFLOW_ID`   | Numeric workflow ID of the commissioned evidence producer.                            |
| `VALDRIS_TRUSTED_AUTHORITATIVE_WORKFLOW_PATH` | Exact `.github/workflows/*.yml` path of that producer.                                |
| `VALDRIS_AUTHORITATIVE_ARTIFACT_NAME`         | Exact unique artifact name, for example `valdris-authoritative-run`.                  |
| `VALDRIS_TRUSTED_RELEASE_VALIDATOR_COMMIT`    | Reviewed lowercase commit containing the release-source and authoritative validators. |
| `VALDRIS_STABLE_TAG_RULESET_ID`               | Numeric ID of the active stable-tag ruleset described below.                          |
| `VALDRIS_RELEASE_APP_ID`                      | Numeric GitHub App ID that is the ruleset's sole bypass actor.                        |
| `VALDRIS_AUTHORITY_TRUST_SHA256`              | Operator-held canonical digest of the commissioned authority trust store.             |

Create this environment secret:

| Secret                      | Required value                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `VALDRIS_RELEASE_APP_TOKEN` | Short-lived installation token for the dedicated release GitHub App. It needs only repository contents release/tag creation access. |

The workflow's ordinary `GITHUB_TOKEN` has only `actions: read` and `contents: read`. It reads same-repository run metadata and downloads the artifact but cannot create a tag. Only `VALDRIS_RELEASE_APP_TOKEN` is used for the final release mutation.

Provision the App token immediately before dispatch or automate short-lived token rotation inside the protected environment. Do not store an unbounded personal access token under this name.

## 3. Restrict stable tags to the release App

Create a repository or organization tag ruleset for stable SemVer refs:

- include `refs/tags/v[0-9]*.[0-9]*.[0-9]*`;
- exclude `refs/tags/v*-*` so RC tags keep their existing non-authoritative flow;
- restrict tag creation, update, and deletion;
- grant bypass only to the dedicated release GitHub App used by the protected workflow;
- do not grant users, teams, repository administrators, or the ordinary GitHub Actions identity stable-tag creation bypass; and
- keep the ruleset active, not evaluation-only.

The workflow reads this ruleset immediately before release and requires the commissioned ID, `tag` target, active enforcement, exact include/exclude patterns, creation/update/deletion restrictions, and one `Integration` bypass actor whose numeric ID equals `VALDRIS_RELEASE_APP_ID`.

Verify the ruleset with a negative test: an administrator and the ordinary workflow token must both be unable to create `v999.999.999`, while the protected release App can create a commissioned test tag only after the evidence gate passes. Remove the test ref through the same authorized identity and record the ruleset/App IDs in private commissioning evidence.

## 4. Dispatch the stable release

From the default branch, dispatch **Authoritative Stable Release** with:

- `stable_tag`: exact stable SemVer equal to `v` plus the committed candidate `package.json` version, such as `v0.9.0` for version `0.9.0`;
- `trusted_run_id`: the successful commissioned producer run; and
- `source_commit`: the lowercase commit SHA recorded by that run.

The workflow fails closed unless all of the following occur in order:

1. protected environment and commissioned variables are present;
2. the trusted validator commit is checked out exactly;
3. the same-repository run and unique artifact metadata match workflow, branch, and source commit;
4. the intended commit is reachable from the default branch, and a credential-free local tag is resolved to that exact candidate `HEAD` for pre-release validation;
5. downloaded `release-source.json`, authoritative closure commit, and `run-root/` match the GitHub provenance and intended release commit;
6. `VALDRIS_AUTHORITY_TRUST_SHA256` validates the authoritative signatures;
7. the stable authoritative gate proves candidate `HEAD`, local tag target, committed package version, closure, executor source, applicable promotion, and bridge-run convergence before accepting the commissioned OCI executor and rollback-resistant provider execution;
8. the release token proves it is a GitHub App installation authorized for this repository;
9. the stable tag does not already exist; and
10. only then does the App create the tag and published release at the validated commit.

Run `npm run verify:authoritative-release-workflow` after any workflow, gate, or commissioning-document change.
