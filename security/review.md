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

## OCI daemon capability review

### Finding

A responsive local Docker or Podman daemon was previously considered sufficient to enter the Linux reference-executor seam. On a Windows-container daemon this caused a late incompatible-image pull, and image lifecycle commands used a bare runtime name after the probe had already identified and hashed an absolute binary.

### Remediation

- Derive compatibility from the attested daemon identity and require `operatingSystem=linux` for the Linux reference executor.
- Treat missing or non-Linux operating-system identity as incompatible, never as authoritative execution.
- Enforce the same Linux requirement inside the real executor before source materialization.
- Use the exact probed and hashed runtime binary for image inspect, pull, executor invocation, and cleanup.
- Keep one isolated local-default environment across daemon probing and every image lifecycle command; discard ambient endpoint and context selectors.
- Hash the runtime binary before probing and revalidate it immediately before and after every daemon probe, source import, image build, image inspection, container run, and cleanup command; reject command output before materialization or receipt logic after any detected swap.
- Permit optional-seam skips only for typed probe deadlines, phase-specific anchored unavailable responses from `docker info`/`podman info`, and explicit platform incompatibility; misleading output, malformed identities, permission errors, binary drift, and unexpected verifier failures fail closed.
- Retain fail-closed behavior for Linux daemon pull, digest resolution, execution, receipt, or cleanup failures.

### Proof

The focused executor verifier accepts a Linux daemon identity, rejects Windows-container and unclassified identities, distinguishes expected unavailability from integrity failures, drives the real non-dry executor preflight far enough to prove incompatible identities are rejected before output materialization, and simulates a runtime-binary replacement during a command to prove its output cannot be accepted even if the commissioned bytes are restored afterward. The full v0.9 verifier must still pass on Ubuntu, macOS, and hosted Windows; Windows may report the optional real-runtime seam as skipped because the available daemon is incompatible, but that result cannot satisfy an authoritative release claim.
