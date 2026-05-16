# Branch Completion Guide

Use this guide after repo changes and before staging, committing, pushing, opening a PR, or claiming a branch is complete.

The goal is to keep branches reviewable and finish the Git workflow deliberately: inspect the branch, classify the diff, verify behavior, stage intentionally, commit clearly, then prepare the push or PR. This complements the existing pre-push hook; it does not replace it.

## Principles

- Prefer focused topic branches and coherent commits.
- Treat the staging area as a review boundary, not a dumping ground.
- Keep local artifacts, generated scratch output, secrets, and unrelated user changes out of commits.
- Run the narrowest useful verification first, then the broader branch gate when practical.
- Use commit messages that explain the user-facing or operational purpose of the change.

## 1. Inspect Branch State

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
npm run branch:complete
```

Confirm:

- the active branch is the intended branch
- the worktree contents match the task
- `git diff --check` has no whitespace errors
- local-only or generated files are understood before staging

If the branch includes changes you did not make, do not revert them. Work around them when unrelated, and ask only if they block the task.

## 2. Classify The Diff

Classify changed files before staging:

- product/source changes
- tests and fixtures
- docs and runbooks
- configuration and scripts
- generated files or local artifacts
- unrelated user changes

Do not stage these without explicit approval:

- `.env*` files except reviewed examples such as `.env.example`
- secrets or credentials
- `.firebase-data/`, Firebase emulator exports, or local database files
- `dataconnect/.dataconnect/`
- `.next/`, `dist/`, coverage, cache, or build output
- `node_modules/`
- one-off reports, screenshots, temporary files, or scratch exports
- broad mixed-concern diffs that should be split into separate commits or PRs

For Footywire, import, rebuild, rematerialization, or read-model changes, also apply the verification requirements in `AGENTS.md`.

## 3. Verify Behavior

Choose the narrowest checks that prove the change:

```bash
npx vitest run path/to/relevant.test.ts
npm run typecheck
npm run lint
npm run prepush
```

Use `npm run prepush` before pushing when practical. If it is too broad for the current step, run focused checks and record why the full gate was skipped.

For UI work, verify the relevant route or component behavior in a browser when practical. For data pipeline work, verify raw persistence, rebuild/rematerialization, and reconciliation for the affected scope where commands exist.

## 4. Stage Intentionally

Stage coherent files only:

```bash
git add path/to/file path/to/test
git diff --cached --stat
git diff --cached --check
```

Confirm the staged diff:

- contains only the intended concern
- excludes unrelated user changes
- excludes local/generated artifacts
- includes tests or docs when the change requires them
- has no whitespace errors

Use partial staging when a file contains multiple unrelated concerns.

## 5. Commit Clearly

Use Conventional Commit style:

```text
type(scope): summary
```

Recommended types:

- `feat`: user-visible capability
- `fix`: bug fix
- `docs`: documentation-only change
- `test`: test-only change
- `refactor`: behavior-preserving code change
- `chore`: tooling, maintenance, or repository hygiene
- `data`: reviewed data or fixture update

Examples:

```text
chore(git): add branch completion workflow
fix(import): rebuild read models after round repair
docs(data): document player identity convergence protocol
```

Add a commit body when the change has migration, operational, security, data-contract, or verification implications.

## 6. Prepare Push Or PR Handoff

Before pushing or opening a PR, run:

```bash
git status --short --branch
npm run branch:complete
npm run prepush
```

The PR summary should include:

- what changed and why
- verification performed
- migration or operational risk
- known gaps or follow-ups
- screenshots or browser notes for UI changes

If `npm run prepush` cannot run, state the blocker and the closest completed verification.
