# Executor path-identity security review

## Scope and authorization

This review covers the local attested proof executor's repository, output-root, commissioned binary, and operator-root path identity checks. The active PR goal authorizes repository remediation and adversarial local/CI verification. No production credentials, customer data, IAM, RLS, or destructive production testing are in scope.

## Assets and actors

- Assets: immutable Git source identity, isolated executor output, operator-owned receipt roots, commissioned Git/runtime binaries, executor receipts.
- Actors: trusted host operator/commissioner, OS root or Windows SYSTEM/Administrators, executor signing and receipt authorities, delivery agent, local executor, Git CLI, OCI runtime, and untrusted repository content.
- Trust boundaries: caller path input to filesystem identity; source worktree to isolated output; repository configuration to isolated Git execution; operator-owned root to agent-created child output; and the `trusted-host-operator-vs-isolated-untrusted-workload` boundary between the host trusted computing base and UID/GID 65534 container workload.

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
- Bound focused executor probes with 90/105-second executor/parent ceilings on POSIX and 300/330-second ceilings on hosted Windows, propagate the shared deadline through PowerShell ACL operations, and size CI ceilings above the sequential maximum: thirty minutes for the Ubuntu/Windows matrix and ten minutes for macOS.
- Commission exact executor CPU, memory, output-byte, wall-clock, scope, and cleanup-reserve limits; compare every runtime receipt to that policy and recompute elapsed time before accepting authority.

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
- Copy verified commissioned runtime bytes into a randomly rooted, operator-owned execution capsule before probing. Remove POSIX directory write authority and apply an owner-only read/execute ACL to the Windows capsule and parent; launch only the capsule, revalidate its ACL, root identity, path, and bytes around every command, and bind the capsule path, root, content, authority, and isolation-policy digests into the receipt.
- Bind the authoritative claim to an isolated Linux workload running as UID/GID 65534 with no host mounts, capsule access, network, or ambient secrets. Reject a POSIX host authority that equals the workload UID.
- Permit optional-seam skips only for typed probe deadlines, phase-specific anchored unavailable responses from `docker info`/`podman info`, and explicit platform incompatibility; misleading output, malformed identities, permission errors, binary drift, and unexpected verifier failures fail closed.
- Retain fail-closed behavior for Linux daemon pull, digest resolution, execution, receipt, or cleanup failures.

### Proof

The focused executor verifier accepts a Linux daemon identity, rejects Windows-container and unclassified identities, distinguishes expected unavailability from integrity failures, and drives the real non-dry executor preflight far enough to prove incompatible identities are rejected before output materialization. Its launch-time adversary replaces and restores the commissioned source before the simulated spawn returns, verifies the launched path is the distinct capsule, proves direct writes and renames against that capsule are blocked for the operation, validates the isolation-policy digest, and rejects an authority identity equal to UID 65534. The full v0.9 verifier must still pass on Ubuntu, macOS, and hosted Windows; Windows may report the optional real-runtime seam as skipped because the available daemon is incompatible, but that result cannot satisfy an authoritative release claim.

### Trusted computing base and same-principal limit

The local reference executor trusts the host operator, root or Windows SYSTEM/Administrators, the executor implementation, its signing key, and the operator-owned receipt roots. Local filesystem permissions cannot prevent arbitrary code already executing as one of those principals from changing permissions, replacing bytes, and restoring them. That condition is an authority compromise, not a successful local authoritative run. The commissioned policy is `external-isolation-required`: use an independently controlled account or external executor whose authority is inaccessible to the workload. A local executor receipt cannot authorize a strong claim without `valdris.executor-authority-separation-receipt.v1`, signed by a different commissioned actor/key and bound to the exact executor and isolation identities. The hardened capsule protects the declared workspace and other non-authority principals; it is not represented as owner-proof immutability.
