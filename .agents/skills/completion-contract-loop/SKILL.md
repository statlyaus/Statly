---
name: completion-contract-loop
description: Use when Statly work has explicit done criteria, verification claims, residual risk, or a final report that must prove completion with evidence.
---

# Completion Contract Loop

## Purpose

Use this skill before claiming Statly work is complete. Every done criterion needs direct evidence, a skipped-check explanation, or an explicit residual-risk note.

## When To Use

- Before final reports for implementation, docs, PR cleanup, or verification work.
- When the user gives a `Done when` list.
- When browser/API behavior, CI, or local tests are part of the claim.

## When Not To Use

- Casual questions with no completion claim.
- Brainstorming where no action was taken.
- Replacing actual tests, browser checks, API checks, or council gates.

## Required Inputs

- User request and done criteria
- `AGENTS.md`
- Current `git status --short --branch`
- Commands/checks actually run
- PR numbers, routes, files, or URLs relevant to the claim

## Protected Files

Never touch `prisma/dev.db`, `.env`, secrets, `serviceAccountKey.json`, Firebase exports, generated `functions/lib` files, dataconnect local data, `node_modules`, `dist`, `coverage`, or `test-results`.

## Permission Model

| Action    | Allowed Without Approval                                             | Requires Explicit Approval                             | Never Automatic                              |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Observe   | Compare done criteria to evidence, inspect status/diff/check outputs | Additional external verification not requested         | Inventing evidence                           |
| Plan      | Identify missing proof and residual risk                             | Expanding scope to satisfy missing proof               | Moving goalposts silently                    |
| Implement | None                                                                 | Fixes only through the normal task loop                | Runtime changes from final-report mode       |
| Push      | Not applicable                                                       | Only if the active task already includes pushing       | Pushing unverified changes                   |
| Merge     | Not applicable                                                       | Only if merge was explicitly requested and checks pass | Merging because the report is ready          |
| Close     | Not applicable                                                       | Only if explicitly in scope                            | Closing issues/PRs as a substitute for proof |
| Delete    | Not allowed                                                          | Explicit approval only                                 | Deleting branches, stashes, or artifacts     |

## Contract

1. List the requested outcomes.
2. Map each outcome to evidence:
   - command output;
   - test result;
   - browser/API observation;
   - PR status;
   - file diff.
3. Mark missing evidence as residual risk.
4. Confirm protected files and unrelated files were not touched.
5. Report final status in plain language.

## Stop Conditions

- A done criterion has no evidence and no acceptable residual-risk note.
- Local status includes unexpected files.
- Verification would mutate protected local state.
- A claim depends on a check that was not run or failed.

## Verification Expectations

- `git status --short --branch`.
- Relevant targeted checks for touched files.
- `git diff --check` when files changed.
- Browser/API verification for behavior claims.
- Council Decision 2 before commit when committing is in scope.
