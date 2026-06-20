---
name: pr-babysitter
description: Use when monitoring Statly pull requests, triaging stale PRs, following up on CI or review feedback, preparing PR status reports, or deciding next PR actions.
---

# PR Babysitter

## Purpose

Use this skill to keep Statly pull requests moving without broadening scope. A PR babysitter inspects status, identifies the next unblocker, applies or prompts for bounded fixes, re-runs checks, and reports the remaining decision clearly.

This skill does not replace Statly council gates. Substantive fixes still require Decision 1 before work and Decision 2 before commit.

## Inputs

- PR URL or branch name
- Current `git status --short --branch`
- Relevant issue, review, CI, or stale-PR context
- `AGENTS.md`
- Any source-of-truth spec or plan named by the PR

## Standard PR Loop

1. Inspect.
   - Identify branch, target base, changed files, CI state, review state, conflicts, and stale age.
   - Read the PR description and unresolved comments before editing.
   - Separate product defects from documentation, test, CI, and merge hygiene issues.

2. Decide the action boundary.
   - No code changes: summarize status, owner, blocker, and next prompt.
   - Documentation-only change: keep edits to docs or skill files.
   - Runtime/test change: run Statly council Decision 1 before editing.
   - Merge/commit action: require passing checks and Decision 2.

3. Fix only the blocker.
   - Address unresolved review comments directly.
   - Prefer the smallest fix that preserves the PR's stated intent.
   - Do not mix stale cleanup, refactors, dependency updates, or unrelated product work into a babysitting pass.

4. Re-run checks.
   - Run the failed CI command locally when possible.
   - Run targeted tests for edited boundaries.
   - Review `git diff` and `git status --short`.
   - If committing is in scope, stage only intended files and run Decision 2.

5. Report.
   - State current PR status, what changed, checks run, what remains blocked, and the next owner/action.
   - Include links, branch names, commands, and concrete failure messages when available.

## Stale PR Triage

Use this order when a PR is stale:

1. Confirm whether the PR still matches the current source-of-truth docs.
2. Check whether `origin/main` already contains the intended change.
3. Classify the stale state:
   - `ready`: checks pass, reviews resolved, no conflicts.
   - `needs-rebase`: scope still valid, branch is behind or conflicted.
   - `needs-fix`: CI, tests, browser verification, or review comments remain unresolved.
   - `superseded`: newer merged work makes the PR obsolete.
   - `abandon`: product direction changed or the PR solves the wrong boundary.
4. Recommend one next action, not a menu of vague options.

## Prompt Templates

### PR Status Check

```text
Use the pr-babysitter skill.

PR:
[URL or branch]

Goal:
Inspect status only. Do not edit files.

Report:
- Current branch/base
- CI and review state
- Conflicts or stale risk
- One recommended next action
```

### CI Follow-Up

```text
Use the pr-babysitter skill.

PR:
[URL or branch]

Goal:
Fix only the failing CI boundary.

Constraints:
- Preserve Statly council gates.
- Do not touch protected files.
- Do not broaden PR scope.

Done when:
- Failing CI path is identified.
- Minimal fix is applied.
- Relevant local check passes or residual risk is reported.
```

### Stale PR Triage

```text
Use the pr-babysitter skill.

PR list:
[URLs or branch names]

Goal:
Classify each PR as ready, needs-rebase, needs-fix, superseded, or abandon.

Report:
- Classification
- Evidence
- Next action
- Whether council review is required before edits
```

## Escalation Rules

- Ask the user before abandoning or closing a PR.
- Ask the user before changing product direction.
- Do not request approval merely because the work is routine after council Decision 1 has proceeded.
- Stop and update the plan if the required fix crosses into a different product boundary than the PR described.

## Common Mistakes

| Mistake                                         | Correction                                                    |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Treating stale as automatically obsolete        | Compare against `origin/main` and source-of-truth docs first. |
| Fixing multiple unrelated PR issues in one pass | Fix the current blocker and report the rest.                  |
| Reading only CI summaries                       | Inspect the failing command, logs, and changed files.         |
| Staging unrelated dirty files                   | Stage explicit intended paths only.                           |
| Reporting "blocked" without a next owner        | Name the blocker and who or what can unblock it.              |
