---
name: repository-cleanup-loop
description: Use when cleaning Statly repository hygiene, stale pull requests, branch sprawl, local status, or protected-file risk without starting feature work.
---

# Repository Cleanup Loop

## Purpose

Use this skill to reduce Statly repository noise without losing useful product intent. It is for scoped cleanup passes, stale PR triage, branch-sprawl control, and protected-file risk review.

This skill does not replace `AGENTS.md`, `.agents/skills/pr-babysitter/SKILL.md`, or council gates.

## When To Use

- Stale PR inventory, cleanup batches, or closure plans.
- Reviewing whether old branches are superseded by current `main`.
- Checking for protected/config/generated/local files in PRs.
- Preparing explicit closure comments that preserve future-task intent.

## When Not To Use

- Feature implementation.
- Broad refactors.
- Runtime bug fixes.
- Branch deletion or stash cleanup unless the user explicitly scopes that action.

## Required Inputs

- `AGENTS.md`
- `.agents/skills/pr-babysitter/SKILL.md`
- Current `git status --short --branch`
- Current PR list or scoped PR numbers
- User-approved cleanup boundary

## Protected Files

Never touch `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, generated `functions/lib` files, dataconnect local data, `node_modules`, `dist`, `coverage`, or `test-results`.

## Permission Model

| Action    | Allowed Without Approval                                            | Requires Explicit Approval                                                                                                                                                                                                                                         | Never Automatic                                |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Observe   | Read PR metadata, status, diffs, checks, comments, local git status | Reading private/external systems not named by the user                                                                                                                                                                                                             | Reading secrets                                |
| Plan      | Classify PRs, draft closure comments, recommend order               | Changing cleanup scope                                                                                                                                                                                                                                             | Treating numeric ranges as sufficient evidence |
| Implement | None for runtime code                                               | Documentation-only edits if requested                                                                                                                                                                                                                              | Runtime edits during cleanup                   |
| Push      | Not applicable                                                      | Only for a cleanup-doc branch if requested                                                                                                                                                                                                                         | Pushing product changes                        |
| Merge     | Not applicable                                                      | Only after explicit merge instruction and passing checks                                                                                                                                                                                                           | Merging stale/unknown checks                   |
| Close PRs | Not applicable                                                      | Only when the user explicitly authorizes closure of the named PR numbers. A triage, inventory, or inspection prompt that lists PRs is not closure authority. Before closing, post the requested closure or supersession comment, then close only the approved PRs. | Closing unapproved PRs                         |
| Delete    | Not allowed                                                         | Branch deletion only after explicit instruction                                                                                                                                                                                                                    | Deleting branches, stashes, or local state     |

## Loop

1. Inspect the current state.
   - Confirm branch, status, open PR count, and stash risk.
   - Re-check each PR is open before acting.
   - Confirm no PR is a protected merged PR such as recent accepted work.
2. Classify each scoped PR.
   - `merge candidate`, `fresh rebuild`, `superseded`, `stale`, `unsafe`, `hold`.
   - Check base branch, conflicts, review state, checks, and file risk.
3. Preserve useful intent.
   - Draft concise comments before closure.
   - Explain whether intent should become a fresh task from current `main`.
4. Act only inside scope.
   - Close only explicitly listed PRs.
   - Do not delete branches.
   - Do not edit runtime files.
5. Verify and report.
   - Report closed/skipped PRs, open count, branch, `git status --short --branch`, and stash state.

## Stop Conditions

- A PR is not in the explicit scope.
- A PR appears to be a clean merge candidate.
- A PR touches protected/local/generated state unexpectedly.
- Local git status becomes dirty unexpectedly.
- The task drifts into feature or runtime work.

## Verification Expectations

- `gh pr view` or equivalent for each scoped PR.
- File-risk scan for protected paths when closing or merging.
- `gh pr list --state open --limit 200` after cleanup.
- `git status --short --branch`.
- Stash list check when local DB stash risk is mentioned.
