# Verification And Branches

## Branch context

For code-impacting work, refresh:

```bash
git status --short
git branch --show-current
git branch -vv --all
git log --oneline --decorate --all -n 12
```

Do not rely on static branch notes in this skill.

## Code intelligence

If `knowledge/index.md` exists and the task changes stable repo-routing knowledge, update the vault and run:

```bash
node scripts/okf-vault-gate.mjs --repo .
```

Run:

```bash
node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback local
node scripts/code-intelligence-gate-all.mjs --repo .
```

Use strict mode when GitNexus is required:

```bash
node scripts/code-intelligence-scan.mjs --repo . --provider gitnexus --fallback none --strict
```

If fallback occurs, say local static graph fallback was used and do not claim GitNexus-backed analysis. Current stable graph artifacts may be a local projection even when GitNexus indexing succeeds.

## Production layers

The 13 canonical layers are:

`frontend`, `backend-api-logic`, `database-storage`, `auth-permissions-rls`, `hosting-deployment`, `cloud-compute`, `cicd-version-control`, `security`, `rate-limiting`, `caching-cdn`, `load-balancing-scaling`, `error-tracking-logs-observability`, `availability-recovery-dr`.

For production-impacting work, validate:

```bash
node scripts/production-layer-gate.mjs --repo .
```

Each layer must appear exactly once. `passed` needs evidence. `skipped` needs a reason. `failed`, `pending`, `blocked`, `required`, or `needs_approval` blocks completion.

## Final proof

Prefer repo validation commands from `docs/Validation Commands.md` or `project-adapter.json`. For the Valdris harness repo, the normal proof stack is:

```bash
npm run typecheck
npm run build
npm run verify:release-privacy
npm run privacy:release
npm run knowledge:gate
npm run code-intelligence:scan
npm run code-intelligence:gate
npm run verify:harness
```

This compact meta-skill stack delegates the remaining repository gates to the canonical release sequence in root `AGENTS.md`; it does not replace that sequence.

Use `npm run code-intelligence:scan:strict` when proving the Windows-safe GitNexus path itself.
