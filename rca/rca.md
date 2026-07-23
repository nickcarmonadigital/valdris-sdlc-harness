# Windows executor worktree-root rejection

## Symptom

The hosted Windows `verify:v09-assurance` job completed its earlier assurance cases, then failed its executor dry-run baseline with:

```text
--repo must resolve to the Git top-level worktree
```

The same fixture passed on Ubuntu and macOS.

## Deterministic reproduction

Run:

```bash
npm run verify:attested-executor
```

The verifier invokes the real `attested-proof-executor.mjs` CLI with a case-equivalent Windows spelling of the same Git worktree. Before the fix it failed with the hosted error. The verifier also supplies a case-aliased output directory inside the source and requires the executor to reject it.

## Root cause

Windows `realpathSync()` preserved the casing supplied by its caller, while `git rev-parse --show-toplevel` returned the same directory using the filesystem's stored casing. The executor compared those path strings with `!==`, so two spellings of one filesystem object were treated as different worktrees.

The same case-sensitive string and prefix comparisons were also used at the source/output boundary. A differently cased spelling could therefore misclassify an output path inside the repository as an external sibling.

## First incorrect state transition

The executor correctly resolved both paths to the same Windows directory, then incorrectly transitioned from `source preflight` to `rejected` because equality was evaluated on caller-preserved strings rather than native canonical paths.

## Blast radius

- Hosted or local Windows runs whose temp/root spelling differs from Git's spelling could be rejected.
- Windows source/output boundary checks could misclassify case-aliased paths.
- Operator-root and commissioned executable path digests could vary by caller-supplied casing even when the filesystem object was unchanged.
- POSIX behavior was not affected because path casing is significant there.

## Fix

- Canonicalize existing paths with `realpathSync.native()` before identity, digest, and equality checks.
- Derive future output paths from the native-canonical existing parent.
- Evaluate source/output overlap with `path.relative()` after native canonicalization.
- Preserve link/junction rejection and fail-closed output-root identity checks.
- Run the executor hardening verifier as a five-minute CI preflight, with shorter nested child-process deadlines, before the long semantic/authoritative suite.

## Rejected hypotheses

- Git resolved a nested or different worktree: disproved by the case-only local reproduction.
- Repository-controlled hooks or filters changed the result: the isolated Git environment remained active and the focused repro needed no hooks.
- A trailing separator caused the mismatch: the reproduction remained after normalized path resolution and varied only path casing.
- The runtime identity repair regressed: the current-head host/boot/process preflight passed on the same Windows runner before this failure.

## Proof

- Red before fix: `verify:attested-executor` rejected the case-equivalent worktree with the exact hosted error.
- Green after fix: the same CLI regression passes and the aliased inside-source output is rejected.
- Required follow-up: full Windows `verify:v09-assurance`, `verify:harness`, runtime closure, privacy, code-intelligence, and clean-worktree gates must pass in CI before merge.

## Hosted verifier timing follow-up

The first fail-fast CI run reached the new real-CLI regression but the verifier killed its child at 30 seconds on the hosted Windows image. That was a verifier ceiling, not an executor rejection. Each of the verifier's two real-CLI probes now commissions a 90-second executor wall-clock limit and retains a separate 105-second parent kill ceiling for cleanup. Their aggregate 210-second child ceiling plus verifier overhead runs under a five-minute job-step ceiling. This preserves nested, fail-closed deadlines while remaining far earlier than the long assurance suite.

## Windows-container OCI compatibility follow-up

The next hosted run passed the path/identity preflight, import, convergence, proof-security, portable-execution, and run-packet gates. At the end of `verify:v09-assurance`, however, the runtime seam treated a responsive Docker daemon as sufficient proof of compatibility and attempted to pull the Linux-only verifier image. GitHub's Windows runner exposed a Windows-container daemon, so Docker rejected `busybox:1.36.1` with `no matching manifest for windows/amd64`.

The first incorrect transition was `daemon responsive` to `reference executor available`. The reference executor requires Linux container semantics (`/bin/sh`, numeric UID/GID, Linux tmpfs and security options), so daemon reachability alone was not a valid capability claim.

The fix binds availability to the daemon identity already returned by `docker info` or `podman info`:

- Linux daemons may enter the real OCI seam.
- Windows-container and unclassified daemons are recorded as incompatible and the optional seam is skipped.
- The executor itself independently rejects a non-Linux daemon before source materialization when invoked outside dry-run mode.
- Image inspect, pull, and cleanup use the exact commissioned runtime binary path instead of resolving the runtime name through ambient `PATH`.
- The isolated local-default runtime environment used for identity probing remains active for image inspect, pull, execution, and cleanup, so ambient Docker or Podman endpoint selectors cannot retarget later lifecycle operations.
- Only typed probe-deadline failures or phase-specific, anchored `docker info`/`podman info` unavailable responses may produce an optional-seam skip. Misleading error text, malformed identity, permission, binary-integrity, and verifier failures remain fatal.
- The commissioned runtime is copied from verified bytes into a randomly rooted, owner-restricted execution capsule before any daemon probe. POSIX capsules remove directory write authority; Windows capsules apply an owner-only read/execute ACL to both the executable and parent directory. Every daemon probe, source import, image build, image inspection, container run, and cleanup command launches only that protected capsule and revalidates its ACL, root identity, path, and bytes before and after the spawn. The receipt binds the commissioned source identity plus the capsule path, root, and content digests.

This does not weaken authoritative release eligibility. A skipped local reference seam remains non-authoritative; an actual authoritative claim still requires a commissioned compatible executor and provider-backed receipts. Focused proof covers the classifier and the actual non-dry executor preflight, including rejection before output materialization.
