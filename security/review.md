# Executor path-identity security review

## Scope and authorization

This review covers the local attested proof executor's repository, output-root, commissioned binary, and operator-root path identity checks. The active PR goal authorizes repository remediation and adversarial local/CI verification. No production credentials, customer data, IAM, RLS, or destructive production testing are in scope.

## Assets and actors

- Assets: immutable Git source identity, isolated executor output, operator-owned receipt roots, commissioned Git/runtime binaries, executor receipts.
- Actors: operator/commissioner, delivery agent, local executor, Git CLI, OCI runtime, untrusted repository content.
- Trust boundaries: caller path input to filesystem identity; source worktree to isolated output; repository configuration to isolated Git execution; operator-owned root to agent-created child output.

## Finding

### Windows path spelling was treated as filesystem identity

- Severity: high for assurance correctness; medium for direct exploitability in the dry-run boundary.
- Evidence: a case-equivalent path to one worktree was rejected, while a case-aliased child output could evade the initial source/output string-prefix test.
- Impact: false-negative authoritative proof on Windows and weakened defense-in-depth around source/output separation.
- Affected users: Windows operators and hosted Windows CI.
- Remediation confidence: high; the real CLI seam deterministically reproduces both positive and negative cases.

## Remediation

- Use native filesystem canonicalization for existing path identities and digests.
- Construct non-existing output targets from a native-canonical existing parent.
- Check containment only after canonicalization.
- Continue rejecting symbolic links/junctions, pre-existing output roots, source overlap, path mutation, and operator-root identity drift.
- Execute the focused path/identity verifier before expensive assurance suites on every CI platform.
- Bound each of the two focused executor probes with nested 90-second executor and 105-second parent ceilings, under a five-minute aggregate CI ceiling, so hosted setup cannot hang indefinitely.

## Positive and negative proof

- Positive: an equivalent Windows worktree spelling is accepted and resolves to the Git top-level worktree.
- Negative: an aliased output directory inside the source is rejected.
- Negative controls retained: poisoned PATH/runtime contexts, Git filters, fsmonitor, export attributes, submodules, cleanup failure aggregation, private-root races, and operator-root ownership/identity.

## Residual risk

The executor still relies on platform filesystem and Git semantics. Authoritative claims therefore continue to require commissioned binary digests, immutable source materialization, operator-root identity, runtime/daemon identity, and provider-backed receipts; path canonicalization alone is not authority.
